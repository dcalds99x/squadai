import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/** Tables scroll sideways on narrow screens instead of squeezing their columns. */
const components: Components = {
  table: ({ node: _, ...props }) => (
    <div className="doc-table">
      <table {...props} />
    </div>
  ),
  a: ({ node: _, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
};

/**
 * Renders agent output as GitHub-flavored Markdown (tables, task lists,
 * strikethrough, autolinks). Raw HTML in the text is never rendered.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="doc">
      <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
