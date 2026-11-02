// coded-error.ts — Vietnamese POS §2 / §21 / §58 (V-5, Oct 27 2026): a refusal the user sees carries a REGISTRY code (+ params)
// beside its English sentence, so every app words it in the user's language (POS ns/errors, Owner / Tech App catalogs).
//
//   throw withCode(new ValidationError('Ticket not found'), 'TICKET_NOT_FOUND');
//   throw withCode(new BookingValidationError(`Service ${name} is inactive`), 'SERVICE_INACTIVE', { name });
//
// The thrown error keeps its class, its English message and whatever status its controller maps it to (the route's answer is
// unchanged); `withCode` adds `apiCode` / `apiParams` (own names — many error classes already use `code` for their own kind,
// e.g. TechError('not_found', …), which controllers branch on). The platform exception filter (@aipowersalon/observability)
// answers the code: from the exception itself, or — when a controller re-threw the sentence as a fresh HttpException — from
// the coded errors this request threw with the same sentence (the request-scoped sink below). Browser-safe, no imports.
import type { ApiErrorCode } from './errors';

export type CodedParams = Record<string, string | number | boolean | null | undefined>;
export interface CodedFields { apiCode: ApiErrorCode; apiParams?: CodedParams }
export type CodedErrorSink = (err: Error & CodedFields) => void;

const SINK = Symbol.for('aipowersalon.codedErrorSink');   // on globalThis: one sink even if two copies of this package load
type G = typeof globalThis & { [SINK]?: CodedErrorSink | null };

/** the API process registers where coded errors are remembered for the current request (observability request-telemetry) */
export function setCodedErrorSink(sink: CodedErrorSink | null): void { (globalThis as G)[SINK] = sink; }

/** attach a registry code (+ params) to an error and return it — `throw withCode(new XError('…'), 'CODE', { … })` */
export function withCode<E extends Error>(err: E, code: ApiErrorCode, params?: CodedParams): E & CodedFields {
  const e = err as E & CodedFields;
  e.apiCode = code;
  if (params) {
    const clean: CodedParams = {};
    for (const [k, v] of Object.entries(params)) if (v !== undefined) clean[k] = v;
    e.apiParams = clean;
  }
  (globalThis as G)[SINK]?.(e);   // the sink only records (observability request-telemetry); it never throws
  return e;
}

/** the code + params an error carries, if `withCode` gave it one */
export function codedFieldsOf(err: unknown): CodedFields | null {
  const e = err as Partial<CodedFields> | null;
  return e && typeof e === 'object' && typeof e.apiCode === 'string' ? { apiCode: e.apiCode as ApiErrorCode, ...(e.apiParams ? { apiParams: e.apiParams } : {}) } : null;
}
