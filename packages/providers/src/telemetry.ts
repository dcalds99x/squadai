/**
 * Spans for model calls, named and tagged with the OpenTelemetry GenAI
 * conventions (`gen_ai.*`), so Langfuse, Jaeger or any OTLP backend shows
 * model, tokens and cost. Without a registered SDK these calls are no-ops.
 *
 * Prompts and answers stay out of traces unless SQUADAI_TRACE_CONTENT=1:
 * they may hold customer data, and traces often leave the server.
 */
import { type Attributes, type Span, SpanStatusCode, trace } from "@opentelemetry/api";

export const tracer = trace.getTracer("squadai");

export function traceContent(): boolean {
  return process.env.SQUADAI_TRACE_CONTENT === "1";
}

/** Runs `fn` inside a span that records errors and always ends. */
export async function inSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error).slice(0, 300) });
      throw error;
    } finally {
      span.end();
    }
  });
}

/** Text for a span attribute, cut to a size backends accept. */
export function clip(text: string, max = 8000): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
