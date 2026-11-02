// span-data.ts — the finished-span record handed to a processor/exporter. Plain data: no methods, no context.
export type SpanKind = 'internal' | 'server' | 'client' | 'producer' | 'consumer';
export type SpanStatusCode = 'unset' | 'ok' | 'error';
export type AttributeValue = string | number | boolean;

export interface SpanLink { traceId: string; spanId: string }

export interface SpanData {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: SpanKind;
  /** Epoch milliseconds, fractional (performance.timeOrigin + performance.now()). */
  startMs: number;
  endMs: number;
  /** Ids, route TEMPLATES, statement SHAPES, status codes. Never a value a customer typed (Constitution 11 §134). */
  attributes: Record<string, AttributeValue>;
  status: { code: SpanStatusCode; message?: string };
  links?: SpanLink[];
}
