import type { FlowStepKind, PlaybookMode } from "@squadai/core";
import type { PlaybookStepDef } from "@squadai/db";
import { resolveFlow } from "@squadai/engine";
import { getTranslations } from "next-intl/server";

type NodeKind = FlowStepKind | "plan" | "parallel" | "combine" | "decides";

interface FlowNode {
  /** Stable within one flow: steps never reorder. */
  id: string;
  kind: NodeKind;
  who: string[];
  /** Review loops: who the draft goes back to, and how many rounds. */
  loop?: { back: string; rounds: number };
}

const TONE: Record<NodeKind, string> = {
  research: "text-[#1D6FD6]",
  draft: "text-brand-strong",
  review: "text-ok",
  discuss: "text-[#B4590B]",
  checkpoint: "text-ink",
  plan: "text-brand-strong",
  parallel: "text-[#1D6FD6]",
  combine: "text-brand-strong",
  decides: "text-brand-strong",
};

/** Turns a playbook (or a free-form request) into the nodes people see. */
export function flowNodes(
  playbook: { mode: PlaybookMode; steps: PlaybookStepDef[] } | { mode: "adaptive"; lead: string },
  nameOf: (key: string) => string,
): FlowNode[] {
  return shape(playbook, nameOf).map((n, i) => ({ ...n, id: `${i}:${n.kind}` }));
}

function shape(
  playbook: { mode: PlaybookMode; steps: PlaybookStepDef[] } | { mode: "adaptive"; lead: string },
  nameOf: (key: string) => string,
): Omit<FlowNode, "id">[] {
  if (playbook.mode === "adaptive") {
    return [
      { kind: "plan", who: [playbook.lead] },
      { kind: "decides", who: [] },
    ];
  }
  const steps = playbook.steps;
  if (playbook.mode === "coordinator") {
    const [lead, ...rest] = steps;
    return [
      { kind: "plan", who: lead ? [nameOf(lead.agentKey)] : [] },
      { kind: "parallel", who: [...new Set(rest.map((s) => nameOf(s.agentKey)))] },
      { kind: "combine", who: lead ? [nameOf(lead.agentKey)] : [] },
    ];
  }
  if (playbook.mode === "parallel") {
    const last = steps.at(-1);
    return [
      { kind: "parallel", who: [...new Set(steps.slice(0, -1).map((s) => nameOf(s.agentKey)))] },
      { kind: "combine", who: last ? [nameOf(last.agentKey)] : [] },
    ];
  }
  let writer: string | null = null;
  return resolveFlow(steps).map((s) => {
    const name = nameOf(s.agentKey);
    if (s.kind === "draft") writer = name;
    if (s.kind === "discuss") return { kind: s.kind, who: [name, ...(s.with ?? []).map(nameOf)] };
    if (s.kind === "review" && (s.rounds ?? 1) > 1 && writer && writer !== name)
      return { kind: s.kind, who: [name], loop: { back: writer, rounds: s.rounds ?? 1 } };
    return { kind: s.kind, who: s.kind === "checkpoint" ? [] : [name] };
  });
}

/**
 * How a team works, drawn as a small flow: who does what, where they talk it
 * over, where the draft can go back for another round, and where you step in.
 */
export async function FlowDiagram({
  nodes,
  approval,
  label,
}: {
  nodes: FlowNode[];
  approval: boolean;
  label: string;
}) {
  const t = await getTranslations("flow");
  return (
    <ol aria-label={label} className="flex flex-wrap items-stretch gap-1.5 text-xs">
      {nodes.map((n, i) => (
        <li key={n.id} className="flex items-center gap-1.5">
          <span
            className={`flex flex-col gap-0.5 rounded-xl px-2.5 py-1.5 ${
              n.kind === "checkpoint"
                ? "border border-dashed border-line-strong bg-surface"
                : n.kind === "decides"
                  ? "border border-dashed border-brand/50 bg-brand-wash"
                  : "bg-canvas"
            }`}
          >
            <span className={`text-[10px] font-bold tracking-wider uppercase ${TONE[n.kind]}`}>
              {t(`kinds.${n.kind}`)}
            </span>
            {n.who.length > 0 && (
              <strong className="text-[13px] font-semibold">{n.who.join(" · ")}</strong>
            )}
            {n.loop && (
              <span className="text-[11px] text-muted">
                <span aria-hidden="true">↺ </span>
                {t("loop", { name: n.loop.back, rounds: n.loop.rounds })}
              </span>
            )}
          </span>
          {(i < nodes.length - 1 || approval) && (
            <span aria-hidden="true" className="text-subtle">
              →
            </span>
          )}
        </li>
      ))}
      {approval && (
        <li className="flex items-center rounded-xl bg-ink px-2.5 py-1.5 font-semibold text-white">
          {t("approve")}
        </li>
      )}
    </ol>
  );
}
