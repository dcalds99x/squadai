"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { subscribeLive, useLiveConnected } from "@/lib/live-events";

/**
 * Keeps a server-rendered page current: listens to office events and asks
 * Next.js to re-render. Pass `teamId` to react only to one team's events.
 */
export function LiveRefresh({ teamId, deliveryId }: { teamId?: string; deliveryId?: string }) {
  const t = useTranslations("common");
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connected = useLiveConnected();

  useEffect(() => {
    const unsubscribe = subscribeLive((event) => {
      // Live text is drawn in place; only real changes reload the page.
      if (event.type === "stream") return;
      if (teamId && event.teamId && event.teamId !== teamId) return;
      if (
        deliveryId &&
        event.deliveryId &&
        event.deliveryId !== deliveryId &&
        event.teamId !== teamId
      )
        return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 250);
    });
    return () => {
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [router, teamId, deliveryId]);

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-subtle" aria-live="polite">
      <span className={`size-2 rounded-full ${connected ? "bg-[#16A34A]" : "bg-[#9AA0B8]"}`} />
      {connected ? t("live") : t("reconnecting")}
    </span>
  );
}
