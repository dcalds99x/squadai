"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState, useTransition } from "react";
import { type ActionState, approveAction, requestChangesAction } from "@/app/(office)/actions";

const QUICK = ["shorter", "formal", "example", "title"] as const;

export function DecisionBar({
  deliveryId,
  reviewerName,
}: {
  deliveryId: string;
  reviewerName: string;
}) {
  const t = useTranslations("decision");
  const tc = useTranslations("common");
  const [mode, setMode] = useState<"idle" | "adjust">("idle");
  const [approveState, setApproveState] = useState<ActionState>({});
  const [approving, startApprove] = useTransition();
  const [state, action, pending] = useActionState<ActionState, FormData>(requestChangesAction, {});
  const [feedback, setFeedback] = useState("");

  const error = approveState.error ?? state.error;

  return (
    <section
      aria-label={t("label")}
      className="sticky bottom-4 rounded-[18px] border border-line-strong bg-surface p-4 shadow-[0_10px_30px_rgba(27,29,42,0.12)]"
    >
      {mode === "idle" ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[15px]">
            {t.rich("prompt", {
              strong: (chunks) => <strong>{chunks}</strong>,
              muted: (chunks) => <span className="text-muted">{chunks}</span>,
            })}
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setMode("adjust")}
              className="h-12 rounded-xl border border-line-strong bg-surface px-[18px] font-semibold"
            >
              {t("requestChanges")}
            </button>
            <button
              type="button"
              disabled={approving}
              onClick={() =>
                startApprove(async () => setApproveState(await approveAction(deliveryId)))
              }
              className="h-12 rounded-xl bg-brand px-[22px] font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
            >
              {approving ? t("approving") : t("approve")}
            </button>
          </div>
        </div>
      ) : (
        <form action={action} className="flex flex-col gap-2.5">
          <input type="hidden" name="deliveryId" value={deliveryId} />
          <label htmlFor="feedback" className="text-[15px] font-semibold">
            {t("whatToChange")}
          </label>
          <textarea
            id="feedback"
            name="feedback"
            rows={2}
            required
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder={t("placeholder")}
            className="resize-y rounded-xl border border-line-strong px-3 py-2.5"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              {QUICK.map((key) => {
                const q = t(`quick.${key}`);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFeedback((f) => (f ? `${f}. ${q}` : q))}
                    className="h-9 rounded-full border border-line-strong bg-[#F8F9FC] px-3 text-[13px] text-ink-2"
                  >
                    {q}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode("idle")}
                className="h-11 px-3.5 text-sm font-semibold text-muted"
              >
                {tc("cancel")}
              </button>
              <button
                type="submit"
                disabled={pending}
                className="h-11 rounded-xl bg-brand px-[18px] text-sm font-semibold text-white disabled:opacity-60"
              >
                {pending ? tc("sending") : t("sendTo", { name: reviewerName })}
              </button>
            </div>
          </div>
          <span className="text-xs text-subtle">{t("relay", { name: reviewerName })}</span>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-2 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
          {error}
        </p>
      )}
    </section>
  );
}
