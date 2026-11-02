// traceparent.ts — W3C Trace Context (https://www.w3.org/TR/trace-context/) `traceparent`: read and write.
//
//   00-<32 hex trace id>-<16 hex parent span id>-<2 hex flags>
//
// Strict on purpose: an inbound header is CLIENT input. Anything we cannot read exactly — wrong length, upper case, an
// all-zero id, version ff, version 00 with trailing fields — is refused and the request starts its own trace (§3.3:
// "if the vendor failed to parse traceparent, it MUST NOT attempt to parse tracestate" — we do not read tracestate at
// all). A higher version is read by its first four fields, as the spec asks, so a newer caller still joins.
import { randomBytes } from 'node:crypto';

export interface SpanContext {
  traceId: string;
  spanId: string;
  /** The W3C `sampled` flag (bit 0 of trace-flags). */
  sampled: boolean;
}

const TRACEPARENT = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(-.*)?$/;
const ZERO = /^0+$/;

export function parseTraceparent(value: unknown): SpanContext | undefined {
  if (typeof value !== 'string' || value.length > 512) return undefined;
  const m = TRACEPARENT.exec(value.trim());
  if (!m) return undefined;
  const [, version, traceId, spanId, flags, rest] = m;
  if (version === 'ff') return undefined;
  if (version === '00' && rest !== undefined) return undefined;
  if (ZERO.test(traceId) || ZERO.test(spanId)) return undefined;
  return { traceId, spanId, sampled: (parseInt(flags, 16) & 1) === 1 };
}

export function formatTraceparent(c: SpanContext): string {
  return `00-${c.traceId}-${c.spanId}-${c.sampled ? '01' : '00'}`;
}

/** 16 lowercase hex, never all zeros. */
export function newSpanId(): string {
  for (;;) { const id = randomBytes(8).toString('hex'); if (!ZERO.test(id)) return id; }
}
