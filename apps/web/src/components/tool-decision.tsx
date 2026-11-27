"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { decideToolAction } from "@/app/(office)/actions-tools";

/** Allow / don't allow a tool, or (for a checkpoint) go on / stop here. */
export function ToolDecision({
  approvalId,
  checkpoint = false,
}: {
  approvalId: string;
  checkpoint?: boolean;
}) {
  const t = useTranslations("waiting");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const decide = (allow: boolean) =>
    start(async () => {
      const result = await decideToolAction(approvalId, allow);
      setError(result.error ?? null);
    });
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => decide(false)}
          className="h-11 rounded-xl border border-line-strong bg-surface px-4 text-sm font-semibold disabled:opacity-60"
        >
          {checkpoint ? t("stop") : t("deny")}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => decide(true)}
          className="h-11 rounded-xl bg-brand px-4 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? "…" : checkpoint ? t("continue") : t("allow")}
        </button>
      </div>
      {error && (
        <span role="alert" className="text-xs text-warn">
          {error}
        </span>
      )}
    </div>
  );
}
