"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import type { ActionState } from "@/app/(office)/actions";

/**
 * A button that asks before doing something hard to undo. The question opens
 * right under the button; Escape or "Keep" closes it.
 */
export function ConfirmAction({
  label,
  question,
  detail,
  confirmLabel,
  keepLabel,
  pendingLabel,
  run,
  danger = false,
}: {
  label: string;
  question: string;
  detail?: string;
  confirmLabel: string;
  keepLabel: string;
  pendingLabel: string;
  run: () => Promise<ActionState>;
  danger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const id = useId();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOpen((o) => !o);
          setError(null);
        }}
        className={`inline-flex min-h-10 items-center rounded-xl border px-3.5 text-sm font-semibold transition ${
          danger
            ? "border-[#F3C6C2] bg-surface text-[#B42318] hover:bg-[#FEF3F2]"
            : "border-line-strong bg-surface text-ink-2 hover:border-ink-2"
        }`}
      >
        {label}
      </button>
      {open && (
        <div
          id={id}
          role="alertdialog"
          aria-label={question}
          className="msg-in absolute top-full right-0 z-20 mt-2 flex w-[300px] flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-[0_12px_32px_rgba(27,29,42,0.16)]"
        >
          <div className="flex flex-col gap-1">
            <strong className="text-sm">{question}</strong>
            {detail && <span className="text-[13px] leading-snug text-muted">{detail}</span>}
          </div>
          {error && (
            <span role="alert" className="text-xs text-warn">
              {error}
            </span>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-10 rounded-xl px-3 text-sm font-semibold text-muted hover:text-ink"
            >
              {keepLabel}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await run();
                  if (result.error) setError(result.error);
                  else setOpen(false);
                })
              }
              className={`h-10 rounded-xl px-3.5 text-sm font-semibold text-white disabled:opacity-60 ${
                danger ? "bg-[#C2362F] hover:bg-[#A42B25]" : "bg-brand hover:bg-brand-strong"
              }`}
            >
              {pending ? pendingLabel : confirmLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
