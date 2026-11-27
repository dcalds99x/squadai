import type { DbOrTx } from "@squadai/db";
import { describe, expect, it } from "vitest";
import { createStreamer, type OfficeEvent } from "../src/events.ts";

const base = { workspaceId: "w", teamId: "t", requestId: "r", agentName: "Téo", kind: "draft" };

describe("streamer", () => {
  it("batches what an agent writes into numbered pieces, then marks it done", async () => {
    const sent: OfficeEvent[] = [];
    const s = createStreamer({} as DbOrTx, base, async (e) => {
      sent.push(e);
    });
    for (const word of ["Solar ", "panels ", "pay ", "back ", "in ", "years."]) s.onDelta(word);
    await s.done();

    const pieces = sent.map((e) => e.stream);
    expect(sent.every((e) => e.type === "stream" && e.requestId === "r")).toBe(true);
    expect(pieces.map((p) => p?.seq)).toEqual(pieces.map((_, i) => i));
    expect(pieces.map((p) => p?.text).join("")).toBe("Solar panels pay back in years.");
    expect(pieces.at(-1)?.done).toBe(true);
    // Batched: far fewer pieces than words.
    expect(sent.length).toBeLessThan(6);
  });

  it("splits long text under the NOTIFY size limit", async () => {
    const sent: OfficeEvent[] = [];
    const s = createStreamer({} as DbOrTx, base, async (e) => {
      sent.push(e);
    });
    s.onDelta("x".repeat(4000));
    await s.done();
    const texts = sent.map((e) => e.stream?.text ?? "");
    expect(texts.every((t) => t.length <= 1500)).toBe(true);
    expect(texts.join("")).toHaveLength(4000);
  });

  it("tells the browser to start over when Plan B takes over", async () => {
    const sent: OfficeEvent[] = [];
    const s = createStreamer({} as DbOrTx, base, async (e) => {
      sent.push(e);
    });
    s.onDelta("half an answer");
    await new Promise((r) => setTimeout(r, 150));
    s.onRestart();
    s.onDelta("the full answer");
    await s.done();
    const reset = sent.find((e) => e.stream?.reset);
    expect(reset?.stream?.text).toBe("the full answer");
  });
});
