"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { hireTeamAction } from "@/app/(office)/actions";

export function HireButton({ templateId, again }: { templateId: string; again: boolean }) {
  const t = useTranslations("hire");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await hireTeamAction(templateId);
            if (result?.error) setError(result.error);
          })
        }
        className={`h-11 w-full rounded-xl font-semibold disabled:opacity-60 ${
          again
            ? "border border-line-strong bg-surface text-ink"
            : "bg-brand text-white hover:bg-brand-strong"
        }`}
      >
        {pending ? t("hiring") : again ? t("again") : t("hireThis")}
      </button>
      {error && (
        <span role="alert" className="text-sm text-warn">
          {error}
        </span>
      )}
    </div>
  );
}
