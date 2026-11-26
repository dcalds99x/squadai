"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { retryRequestAction } from "@/app/(office)/actions";

export function RetryButton({ requestId }: { requestId: string }) {
  const t = useTranslations("team");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await retryRequestAction(requestId);
            setError(result.error ?? null);
          })
        }
        className="h-9 self-start rounded-lg bg-surface px-3 text-[13px] font-semibold text-ink disabled:opacity-60"
      >
        {pending ? t("retrying") : t("retry")}
      </button>
      {error && <span role="alert">{error}</span>}
    </span>
  );
}
