import ReactMarkdown from "react-markdown";

/** Renders agent output. Raw HTML in the text is never rendered. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="doc">
      <ReactMarkdown skipHtml>{children}</ReactMarkdown>
    </div>
  );
}
