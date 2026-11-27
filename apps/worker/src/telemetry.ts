/**
 * Sends traces over OTLP when an endpoint is configured; otherwise does nothing
 * and the engine's spans are no-ops. Works with any OTLP backend:
 *
 * - Jaeger (local): `docker compose --profile tracing up -d`, then
 *   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
 * - Langfuse: OTEL_EXPORTER_OTLP_ENDPOINT=https://cloud.langfuse.com/api/public/otel
 *   and OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic <base64 of public:secret key>"
 *
 * The exporter reads the standard OTEL_* variables itself.
 */

import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import type { Logger } from "@squadai/core";

export function startTelemetry(log: Logger): { shutdown(): Promise<void> } | null {
  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return null;
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? "squadai-worker",
    }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
  });
  provider.register();
  log.info("tracing on", {
    endpoint: endpoint.replace(/\/\/[^@/]*@/, "//"),
    content: process.env.SQUADAI_TRACE_CONTENT === "1",
  });
  return provider;
}
