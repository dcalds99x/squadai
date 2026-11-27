"use client";

import { useTranslations } from "next-intl";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { readableLiveText, useLiveTexts } from "@/lib/live-events";

/** Step work that becomes (part of) the delivery; chat and discussion stay in the room. */
const DRAFT_KINDS = new Set(["research", "draft", "review", "contribution", "synthesis"]);

/**
 * The delivery as an agent writes it, rendered like the finished document. It
 * goes away once the step is done and the real version has loaded.
 */
export function LiveDraft({
  requestId,
  versions,
}: {
  requestId: string;
  /** Number of versions loaded; a new one replaces the live text. */
  versions: number;
}) {
  const t = useTranslations("delivery");
  const title = (name: string) => t("liveTitle", { name });
  const note = t("liveNote");
  const live = useLiveTexts({ requestId }, versions).filter(
    (l) => DRAFT_KINDS.has(l.kind) && readableLiveText(l.text),
  );
  const current = live.at(-1);
  if (!current) return null;
  return (
    <section
      aria-live="polite"
      aria-label={title(current.agentName)}
      className="msg-in flex flex-col gap-3 rounded-[18px] border-2 border-brand/40 bg-surface p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="flex items-center gap-2 text-sm">
          <span className="size-2 animate-pulse rounded-full bg-brand" />
          {title(current.agentName)}
        </strong>
        <span className="text-xs text-subtle">{note}</span>
      </div>
      <div className="doc">
        <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]}>
          {readableLiveText(current.text)}
        </ReactMarkdown>
        {!current.done && <span className="stream-caret" aria-hidden="true" />}
      </div>
    </section>
  );
}
