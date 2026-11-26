"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { exportToNotionAction } from "../../actions-tools";

export function ExportButtons({ deliveryId, notion }: { deliveryId: string; notion: boolean }) {
  const t = useTranslations("delivery");
  const tc = useTranslations("common");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok?: boolean; error?: string; message?: string }>({});
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={`/deliveries/${deliveryId}/markdown`}
        className="inline-flex h-10 items-center rounded-xl border border-line-strong bg-surface px-3.5 text-sm font-semibold"
      >
        {t("download")}
      </a>
      {notion && (
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => setResult(await exportToNotionAction(deliveryId)))}
          className="h-10 rounded-xl border border-line-strong bg-surface px-3.5 text-sm font-semibold disabled:opacity-60"
        >
          {pending ? tc("sending") : t("toNotion")}
        </button>
      )}
      {result.ok && result.message && (
        <a
          href={result.message}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-semibold text-ok"
        >
          {t("openNotion")}
        </a>
      )}
      {result.error && (
        <span role="alert" className="text-sm text-warn">
          {result.error}
        </span>
      )}
    </div>
  );
}
