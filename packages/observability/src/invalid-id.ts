// invalid-id.ts — w4 sweep SW-02 / SW-21: a malformed or missing id the CLIENT sent is a 400 INVALID_ID. The request
// telemetry filter turns PostgreSQL's 22P02 into this answer; a handler that knows its id is required checks it FIRST
// with requireUuidId, so the id never reaches the database (no failed statement, no error-log noise) — same answer.
export const UUID_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuidId = (v: unknown): v is string => typeof v === 'string' && UUID_ID_PATTERN.test(v);
/** The client-safe 400 INVALID_ID error (exposed: the exception filter answers it as is). */
export function invalidIdClientError(): Error & { status: number; code: string; expose: true } {
  return Object.assign(new Error('One of the ids in this request is not valid.'), { status: 400, code: 'INVALID_ID', expose: true as const });
}
/** The id, or a thrown 400 INVALID_ID before any query. */
export function requireUuidId(v: unknown): string {
  if (!isUuidId(v)) throw invalidIdClientError();
  return v;
}
