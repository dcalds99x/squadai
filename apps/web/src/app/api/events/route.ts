import { getDb, getPrimaryWorkspace } from "@squadai/db";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { subscribe } from "@/lib/events-hub";

export const dynamic = "force-dynamic";

/** Server-Sent Events: tells the open page that something in the office changed. */
export async function GET(request: Request) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const workspace = await getPrimaryWorkspace(getDb(), session.user.id);
  if (!workspace) return new Response("No workspace", { status: 404 });

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    async start(controller) {
      const write = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const unsubscribe = await subscribe(workspace.id, (event) =>
        write(`data: ${JSON.stringify(event)}\n\n`),
      );
      const keepAlive = setInterval(() => write(": ping\n\n"), 25_000);
      cleanup = () => {
        clearInterval(keepAlive);
        unsubscribe();
      };
      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
      write("retry: 3000\n\n");
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
