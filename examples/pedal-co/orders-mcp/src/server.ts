/**
 * Orders MCP server for Pedal & Co. (a fictional client, see ../README.md).
 *
 * Gives squadai's support team read-only access to orders and returns over
 * MCP's Streamable HTTP transport, behind a bearer token. In a real
 * deployment `ORDERS` would be the client's order API or database; here it is
 * sample data, so the example runs anywhere.
 *
 *   ORDERS_MCP_TOKEN=change-me node src/server.ts     # http://localhost:8787/mcp
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

interface Order {
  id: string;
  customer: string;
  status: "processing" | "shipped" | "delivered" | "returned";
  carrier: string | null;
  tracking: string | null;
  placedAt: string;
  items: { sku: string; name: string; qty: number }[];
}

const ORDERS: Order[] = [
  {
    id: "PC-10421",
    customer: "ana@example.com",
    status: "shipped",
    carrier: "CTT",
    tracking: "RR123456789PT",
    placedAt: "2026-11-20",
    items: [{ sku: "CH-11-105", name: "11-speed chain", qty: 1 }],
  },
  {
    id: "PC-10433",
    customer: "joao@example.com",
    status: "processing",
    carrier: null,
    tracking: null,
    placedAt: "2026-11-25",
    items: [{ sku: "BP-DISC-R", name: "Disc brake pads (resin)", qty: 2 }],
  },
  {
    id: "PC-10398",
    customer: "ana@example.com",
    status: "returned",
    carrier: "CTT",
    tracking: "RR987654321PT",
    placedAt: "2026-11-02",
    items: [{ sku: "TY-700-28", name: "700x28 tyre", qty: 2 }],
  },
];

const RETURN_WINDOW_DAYS = 30;

const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

/** A fresh MCP server per request: the transport is stateless. */
function mcpServer(): McpServer {
  const server = new McpServer({ name: "pedal-co-orders", version: "1.0.0" });

  server.registerTool(
    "get_order",
    {
      description:
        "Looks up one order by its number (like PC-10421): status, carrier, tracking and items.",
      inputSchema: { order_id: z.string().describe("Order number, e.g. PC-10421") },
    },
    async ({ order_id }) => {
      const order = ORDERS.find((o) => o.id.toLowerCase() === order_id.trim().toLowerCase());
      return order ? json(order) : json({ error: `No order ${order_id}.` });
    },
  );

  server.registerTool(
    "orders_for_customer",
    {
      description: "Lists a customer's orders by email, newest first.",
      inputSchema: { email: z.string().email() },
    },
    async ({ email }) =>
      json(
        ORDERS.filter((o) => o.customer === email.toLowerCase()).sort((a, b) =>
          b.placedAt.localeCompare(a.placedAt),
        ),
      ),
  );

  server.registerTool(
    "return_eligibility",
    {
      description: `Says whether an order can still be returned (${RETURN_WINDOW_DAYS}-day window, not already returned).`,
      inputSchema: {
        order_id: z.string(),
        today: z.string().optional().describe("YYYY-MM-DD; defaults to today"),
      },
    },
    async ({ order_id, today }) => {
      const order = ORDERS.find((o) => o.id.toLowerCase() === order_id.trim().toLowerCase());
      if (!order) return json({ error: `No order ${order_id}.` });
      const days = Math.floor(
        (Date.parse(today ?? new Date().toISOString().slice(0, 10)) - Date.parse(order.placedAt)) /
          86_400_000,
      );
      const eligible = order.status !== "returned" && days <= RETURN_WINDOW_DAYS;
      return json({
        order_id: order.id,
        eligible,
        days_since_order: days,
        window_days: RETURN_WINDOW_DAYS,
      });
    },
  );

  return server;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

/** Starts the server. Every request needs `Authorization: Bearer <token>`. */
export function startOrdersServer(options: { port: number; token: string }): Promise<Server> {
  const http = createServer(async (req, res) => {
    if (req.url !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    if (req.headers.authorization !== `Bearer ${options.token}`) {
      res.writeHead(401, { "content-type": "application/json" }).end('{"error":"unauthorized"}');
      return;
    }
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const server = mcpServer();
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(
        req,
        res,
        req.method === "POST" ? await readBody(req) : undefined,
      );
    } catch (error) {
      if (!res.headersSent) res.writeHead(500).end(String(error));
    }
  });
  return new Promise((resolve) => http.listen(options.port, () => resolve(http)));
}

// Run directly (the tests import it instead).
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const token = process.env.ORDERS_MCP_TOKEN;
  if (!token) throw new Error("Set ORDERS_MCP_TOKEN.");
  const port = Number(process.env.PORT ?? 8787);
  await startOrdersServer({ port, token });
  console.log(`Pedal & Co. orders MCP on http://localhost:${port}/mcp`);
}
