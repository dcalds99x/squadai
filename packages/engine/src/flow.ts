/**
 * How a team works through a request, step by step. A flow is a list of steps,
 * each with a kind (see FLOW_STEP_KINDS): research, draft, review (which may
 * loop back to the writer), discuss and checkpoint. Playbooks give a fixed
 * flow; for a free-form request the team lead writes one (see parseFlowPlan).
 *
 * These helpers are pure, so the runner can replay a flow deterministically
 * when it resumes after a pause or a crash.
 */
import { FLOW_STEP_KINDS, type FlowStepKind, MAX_REVIEW_ROUNDS } from "@squadai/core";
import type { PlaybookStepDef } from "@squadai/db";

export type FlowStep = PlaybookStepDef & { kind: FlowStepKind };

/**
 * Fills in each step's kind. Steps without one follow the position rule early
 * playbooks were written for: first = research, last of three or more = review,
 * anything else = draft.
 */
export function resolveFlow(steps: PlaybookStepDef[]): FlowStep[] {
  return steps.map((s, i) => ({
    ...s,
    kind:
      s.kind ??
      (steps.length > 1 && i === 0
        ? "research"
        : steps.length > 2 && i === steps.length - 1
          ? "review"
          : "draft"),
  }));
}

/** The kinds that write the delivery. A revision only re-runs these. */
export function producesText(kind: FlowStepKind): boolean {
  return kind === "draft" || kind === "review";
}

/** The first line a reviewer writes when it may send the draft back. A protocol token. */
const VERDICT = /^\s*(?:\*\*)?VERDICT(?:\*\*)?\s*:\s*(approve|revise)\b.*$/im;

/**
 * Reads a reviewer's verdict and removes the line. A review without one
 * counts as approved: the reviewer revised the text itself.
 */
export function parseVerdict(text: string): { revise: boolean; text: string } {
  const match = VERDICT.exec(text);
  if (!match) return { revise: false, text: text.trim() };
  return {
    revise: match[1]?.toLowerCase() === "revise",
    text: text.replace(match[0], "").trim(),
  };
}

export type FlowPlan =
  | { fit: "in"; title: string; steps: FlowStep[] }
  | { fit: "out"; reason: string };

const MAX_PLAN_STEPS = 6;

/**
 * Reads the lead's plan for a free-form request:
 * {"fit":"in","title":"…","steps":[{"agent","kind","task","with","rounds"}]}
 * or {"fit":"out","reason":"…"}. Keys are protocol tokens. Invalid steps are
 * dropped; a plan with nothing that writes gets a draft by the lead, so a
 * request always ends with a delivery. Returns null when there is no JSON.
 */
export function parseFlowPlan(text: string, agentKeys: string[], leadKey: string): FlowPlan | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: { fit?: unknown; reason?: unknown; title?: unknown; steps?: unknown };
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (parsed.fit === "out") {
    return { fit: "out", reason: typeof parsed.reason === "string" ? parsed.reason.trim() : "" };
  }
  const raw = Array.isArray(parsed.steps) ? parsed.steps : [];
  const steps: FlowStep[] = [];
  let drafted = false;
  for (const item of raw as Record<string, unknown>[]) {
    if (steps.length >= MAX_PLAN_STEPS) break;
    const agentKey = typeof item.agent === "string" ? item.agent : "";
    const kind = FLOW_STEP_KINDS.find((k) => k === item.kind);
    const task = typeof item.task === "string" ? item.task.trim() : "";
    if (!agentKeys.includes(agentKey) || !kind || !task) continue;
    // A review needs something to review.
    if (kind === "review" && !drafted) continue;
    const step: FlowStep = { agentKey, kind, task };
    if (kind === "discuss") {
      const others = (Array.isArray(item.with) ? item.with : []).filter(
        (k): k is string => typeof k === "string" && k !== agentKey && agentKeys.includes(k),
      );
      if (others.length === 0) continue;
      step.with = [...new Set(others)].slice(0, 3);
    }
    if (kind === "review") {
      const rounds = Number(item.rounds);
      step.rounds = Number.isInteger(rounds) ? Math.min(MAX_REVIEW_ROUNDS, Math.max(1, rounds)) : 1;
    }
    if (kind === "draft") drafted = true;
    steps.push(step);
  }
  const title = typeof parsed.title === "string" ? parsed.title.trim().slice(0, 80) : "";
  if (!drafted) {
    // Keep what the lead planned before the writing, then the lead writes.
    const before = steps.filter((s) => s.kind !== "review" && s.kind !== "checkpoint");
    return {
      fit: "in",
      title,
      steps: [
        ...before.slice(0, MAX_PLAN_STEPS - 1),
        { agentKey: leadKey, kind: "draft", task: title || "—" },
      ],
    };
  }
  return { fit: "in", title, steps };
}

/**
 * The flow when the lead's plan can't be read: someone researches, the lead
 * writes, someone else reviews. Uses whoever the team has.
 */
export function defaultFlow(agentKeys: string[], leadKey: string, task: string): FlowStep[] {
  const others = agentKeys.filter((k) => k !== leadKey);
  const steps: FlowStep[] = [];
  if (others[0]) steps.push({ agentKey: others[0], kind: "research", task });
  steps.push({ agentKey: leadKey, kind: "draft", task });
  const reviewer = others[1] ?? others[0];
  if (reviewer) steps.push({ agentKey: reviewer, kind: "review", task, rounds: 2 });
  return steps;
}
