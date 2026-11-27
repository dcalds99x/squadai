/**
 * The case study's pieces work with the real squadai code: the orders MCP
 * server through the engine's MCP client, and the custom team through the
 * catalog's validation.
 */
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { TeamTemplateSchema } from "@squadai/catalog";
import { discoverMcpTools, mcpTools, type ToolContext } from "@squadai/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { startOrdersServer } from "../src/server.ts";

const TOKEN = "test-token";
let server: Server;
let url = "";

beforeAll(async () => {
  server = await startOrdersServer({ port: 0, token: TOKEN });
  url = `http://localhost:${(server.address() as AddressInfo).port}/mcp`;
});

afterAll(() => new Promise<void>((done) => server.close(() => done())));

describe("orders MCP connector", () => {
  it("lists its tools to squadai's MCP client", async () => {
    const tools = await discoverMcpTools(url, TOKEN);
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_order",
      "orders_for_customer",
      "return_eligibility",
    ]);
  });

  it("refuses a wrong token", async () => {
    await expect(discoverMcpTools(url, "wrong")).rejects.toThrow();
  });

  it("answers an agent's tool call", async () => {
    const tools = await discoverMcpTools(url, TOKEN);
    const defs = mcpTools(
      [{ id: "1", kind: "mcp", name: "orders", url, secret: TOKEN, config: {}, tools }],
      "en",
    );
    const getOrder = defs.find((d) => d.name === "mcp.orders.get_order");
    expect(getOrder).toBeDefined();
    const outcome = await getOrder?.run({ order_id: "PC-10421" }, {} as ToolContext);
    expect(outcome?.kind).toBe("result");
    expect(outcome?.kind === "result" && outcome.text).toContain("RR123456789PT");

    const eligibility = defs.find((d) => d.name === "mcp.orders.return_eligibility");
    const answer = await eligibility?.run(
      { order_id: "PC-10421", today: "2026-11-27" },
      {} as ToolContext,
    );
    expect(answer?.kind === "result" && answer.text).toContain('"eligible": true');
  });
});

describe("Pedal & Co. support team", () => {
  it("is a valid team template whose order tools match the connector", () => {
    const yaml = readFileSync(new URL("../../support-team.yaml", import.meta.url), "utf8");
    const team = TeamTemplateSchema.parse(parse(yaml));
    expect(team.lead).toBe("gabi");
    const orderTools = new Set(
      team.agents.flatMap((a) => Object.keys(a.tools).filter((t) => t.startsWith("mcp.orders."))),
    );
    expect([...orderTools].sort()).toEqual([
      "mcp.orders.get_order",
      "mcp.orders.orders_for_customer",
      "mcp.orders.return_eligibility",
    ]);
  });
});
