/**
 * A run shows up as one trace: run → steps → model calls and tools, with the
 * GenAI attributes backends like Langfuse read. Skipped without DATABASE_URL.
 */
import { randomUUID } from "node:crypto";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { createDb, createWorkspaceForUser, schema } from "@squadai/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequest, loadModelContext, runRequest } from "../src/index.ts";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("tracing", () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const db = createDb(url as string, { max: 2 });
  const userId = `trace-${randomUUID()}`;
  let workspaceId = "";

  beforeAll(async () => {
    provider.register();
    await db
      .insert(schema.user)
      .values({ id: userId, name: "Tess", email: `${userId}@example.test` });
    ({ workspaceId } = await createWorkspaceForUser(db, {
      userId,
      userName: "Tess",
      locale: "en",
    }));
    await db
      .update(schema.workspace)
      .set({ settings: { demoMode: true, locale: "en" } })
      .where(eq(schema.workspace.id, workspaceId));
  });

  afterAll(async () => {
    await provider.shutdown();
    await db.delete(schema.workspace).where(eq(schema.workspace.id, workspaceId));
    await db.delete(schema.user).where(eq(schema.user.id, userId));
    await db.close();
  });

  it("traces a run, its steps and every model call", async () => {
    const [team] = await db
      .select()
      .from(schema.team)
      .where(eq(schema.team.workspaceId, workspaceId));
    const [pb] = await db
      .select()
      .from(schema.playbook)
      .where(
        and(eq(schema.playbook.teamId, team?.id as string), eq(schema.playbook.key, "newsletter")),
      );
    const { requestId } = await createRequest(db, {
      workspaceId,
      teamId: team?.id as string,
      playbookId: pb?.id as string,
      userId,
      prompt: "A newsletter about city cycling",
    });
    await runRequest(
      { db, loadModels: (ws) => loadModelContext(db, ws, { masterKey: null }) },
      { requestId },
    );

    const spans = exporter.getFinishedSpans();
    const runSpan = spans.find((s) => s.name === "squadai.run");
    expect(runSpan?.attributes["squadai.outcome"]).toBe("awaiting_approval");
    expect(runSpan?.attributes["squadai.team"]).toBe("Content & SEO");
    const traceId = runSpan?.spanContext().traceId;

    const steps = spans.filter((s) => s.name.startsWith("squadai.step "));
    expect(steps.map((s) => s.attributes["squadai.step_kind"])).toEqual([
      "research",
      "draft",
      "review",
    ]);
    for (const s of steps) {
      expect(s.spanContext().traceId).toBe(traceId);
      expect(s.parentSpanContext?.spanId).toBe(runSpan?.spanContext().spanId);
    }

    const calls = spans.filter((s) => s.attributes["gen_ai.operation.name"] === "chat");
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const c of calls) {
      expect(c.attributes["gen_ai.usage.input_tokens"]).toBeGreaterThan(0);
      expect(c.attributes["gen_ai.usage.output_tokens"]).toBeGreaterThan(0);
      // Content stays out unless SQUADAI_TRACE_CONTENT=1.
      expect(c.attributes["gen_ai.prompt"]).toBeUndefined();
    }
    expect(spans.some((s) => s.name === "squadai.tool web_search")).toBe(true);
  });
});
