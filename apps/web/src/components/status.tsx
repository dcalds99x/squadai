import { useTranslations } from "next-intl";

const STYLES = {
  in_progress: "bg-brand-soft text-brand-strong",
  awaiting_approval: "bg-warn-soft text-warn",
  delivered: "bg-ok-soft text-ok",
  cancelled: "bg-[#EEF0F6] text-ink-2",
  failed: "bg-[#FDECEC] text-danger",
} as const;

export type StatusKey = keyof typeof STYLES;

export function StatusPill({ status }: { status: StatusKey }) {
  const t = useTranslations("status");
  return (
    <span
      className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${STYLES[status]}`}
    >
      {t(status)}
    </span>
  );
}
