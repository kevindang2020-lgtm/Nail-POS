// @aipowersalon/observability tracing — W3C trace context, spans, and the OTLP/HTTP JSON exporter (BUILD_PLAN Phase 11).
export { parseTraceparent, formatTraceparent, newSpanId, type SpanContext } from './traceparent';
export type { SpanData, SpanKind, SpanLink, SpanStatusCode, AttributeValue } from './span-data';
export {
  Span, startSpan, withSpan, activeSpanContext, currentTraceparent, configureTracing, tracingEnabled, tracingConfigFromEnv,
  flushTracing, shutdownTracing, nowMs, setLocalSpanSink, runOutsideSpan, type LocalSpanSink, type StartSpanOptions, type TracingConfig,
} from './span';
export {
  BatchSpanProcessor, SimpleSpanProcessor, InMemorySpanExporter, OtlpHttpJsonExporter, toOtlpJson, parseOtlpHeaders, msToUnixNano,
  spansDropped, spansExported, type SpanExporter, type SpanProcessor, type BatchOptions,
} from './exporter';
export { runEventConsumer, type EventConsumerMeta } from './consumer';
