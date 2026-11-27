import type { AvatarSpec } from "@squadai/core";
import { Avatar } from "@squadai/ui";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { formatDuration } from "@/lib/format";
import { toolLabel } from "@/lib/tool-labels";
import { ToolDecision } from "./tool-decision";

export interface PendingItem {
  id: string;
  createdAt: Date;
  approvalKind: "delivery" | "tool" | "checkpoint";
  question: string;
  payload: { tool?: string; input?: Record<string, unknown> } | null;
  deliveryId: string;
  title: string;
  kind: string;
  teamName: string;
  agentName: string | null;
  avatar: AvatarSpec | null;
}

function summarize(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  const text = Object.entries(input)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" · ");
  return text.length > 220 ? `${text.slice(0, 217)}…` : text;
}

export async function PendingList({ items, now }: { items: PendingItem[]; now: Date }) {
  const [t, tTools, locale] = await Promise.all([
    getTranslations("waiting"),
    getTranslations("tools"),
    getLocale(),
  ]);
  if (items.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-2xl border border-line bg-surface px-5 py-4 text-ok">
        <span aria-hidden="true">✓</span> {t("empty")}
      </p>
    );
  }
  const age = (d: Date) =>
    formatDuration(Math.max(1, Math.floor((now.getTime() - d.getTime()) / 60_000)), locale);
  const strong = (chunks: ReactNode) => <strong>{chunks}</strong>;
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((p) => (
        <li
          key={p.id}
          className="flex flex-wrap items-center gap-3.5 rounded-2xl border border-line bg-surface px-4 py-3.5"
        >
          {p.avatar && <Avatar spec={p.avatar} name={p.agentName ?? ""} size={40} decorative />}
          {p.approvalKind === "checkpoint" ? (
            <>
              <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-1">
                <span className="text-[15px]">
                  {t.rich("checkpoint", { agent: p.agentName ?? t("agentFallback"), strong })}
                </span>
                <span className="rounded-lg bg-canvas px-2.5 py-1.5 text-[13px] text-ink-2">
                  {p.question}
                </span>
                <span className="text-xs text-subtle">
                  {t("toolContext", { team: p.teamName, title: p.title, age: age(p.createdAt) })}
                </span>
              </div>
              <ToolDecision approvalId={p.id} checkpoint />
            </>
          ) : p.approvalKind === "tool" ? (
            <>
              <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-1">
                <span className="text-[15px]">
                  {t.rich("wantsTool", {
                    agent: p.agentName ?? t("agentFallback"),
                    tool: toolLabel(tTools, p.payload?.tool ?? ""),
                    strong,
                  })}
                </span>
                <span className="rounded-lg bg-canvas px-2.5 py-1.5 font-mono text-xs text-ink-2">
                  {summarize(p.payload?.input)}
                </span>
                <span className="text-xs text-subtle">
                  {t("toolContext", { team: p.teamName, title: p.title, age: age(p.createdAt) })}
                </span>
              </div>
              <ToolDecision approvalId={p.id} />
            </>
          ) : (
            <>
              <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-0.5">
                <span className="text-[15px]">
                  <strong>{p.title}</strong>
                </span>
                <span className="text-[13px] text-subtle">
                  {t("deliveryContext", {
                    team: p.teamName,
                    kind: p.kind,
                    age: age(p.createdAt),
                  })}
                </span>
              </div>
              <Link
                href={`/deliveries/${p.deliveryId}`}
                className="inline-flex h-11 items-center rounded-xl bg-brand px-4 text-sm font-semibold text-white"
              >
                {t("review")}
              </Link>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
