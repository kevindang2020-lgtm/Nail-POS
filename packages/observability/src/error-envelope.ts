// error-envelope.ts — Constitution 5 §28–31 (re-applied Oct 4 2026): turn whatever a handler threw into the standard
// error envelope `{ error: { code, message, details, action }, requestId }` — as a SUPERSET of today's body, so every
// field an existing app reads (top-level code / message / ok / statusCode / reference) is still there.
//   • code: the thrower's code when it named one (older free-form codes keep working), else the registry's code for the
//     status. message: the thrower's message, unless it could leak internals (§31) — then the registry's safe default.
//   • a ValidationPipe failure (message: string[]) → VALIDATION_FAILED with the messages in details.messages.
//   • details: the thrower's details object, with stack / sql / query / trace keys dropped at any depth.
import { ERROR_REGISTRY, codeForStatus, clientActionFor, isRegisteredCode } from '@aipowersalon/api-contracts';

const LEAKS: RegExp[] = [
  /[\w./\\-]+\.(?:[tj]sx?|mjs|cjs):\d+(?::\d+)?/,                       // a stack frame's file:line(:col)
  /\b(?:select|insert|update|delete)\b[\s\S]{0,120}\b(?:from|into|set|where)\b/i,   // SQL
  /relation\s+"[^"]+"\s+does not exist/i, /duplicate key value violates/i, /violates\s+(?:foreign key|unique|check|not-null)\s+constraint/i,
  /\bcolumn\s+"[^"]+"/i, /\bsyntax error at or near\b/i,
  /\b(?:ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo)\b/, /\.(?:railway|svc|cluster)\.internal\b/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,                             // a JWT
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}/, /\bSG\.[A-Za-z0-9_-]{10,}/, // provider secrets
];
export const leaksInternals = (s: string): boolean => LEAKS.some((r) => r.test(s));
const DROP_KEYS = /^(stack|sql|query|trace|stacktrace|cause)$/i;
function scrubDetails(v: unknown, depth = 0): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || depth > 4) return {};
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (DROP_KEYS.test(k)) continue;
    if (typeof x === 'string') { if (!leaksInternals(x)) out[k] = x; }
    else if (x && typeof x === 'object' && !Array.isArray(x)) out[k] = scrubDetails(x, depth + 1);
    else if (Array.isArray(x)) out[k] = x.filter((e) => typeof e !== 'string' || !leaksInternals(e)).slice(0, 50);
    else out[k] = x;
  }
  return out;
}

export interface EnvelopeInput { status: number; body: Record<string, unknown>; requestId?: string; unexpected: boolean }
/** RFC 6749 §5.2 / RFC 7009: an OAuth endpoint's error IS a protocol message — `error` is a STRING code that OAuth client
 *  libraries read. It passes through exactly as thrown (only requestId is added); the envelope would break every client. */
export function isOAuthProtocolError(b: Record<string, unknown>): boolean {
  return typeof b?.error === 'string' && typeof b?.error_description === 'string' && /^[a-z_]+$/.test(b.error);
}
export function toErrorEnvelope(i: EnvelopeInput): Record<string, unknown> {
  const b = i.body ?? {};
  if (!i.unexpected && isOAuthProtocolError(b)) return { error: b.error, error_description: b.error_description, ...(i.requestId ? { requestId: i.requestId } : {}) };
  const validation = Array.isArray(b.message);
  const code = i.unexpected ? 'INTERNAL_ERROR' : validation ? 'VALIDATION_FAILED' : (typeof b.code === 'string' && b.code ? b.code : codeForStatus(i.status));
  const def = isRegisteredCode(code) ? ERROR_REGISTRY[code].message : ERROR_REGISTRY[codeForStatus(i.status)].message;
  const raw = typeof b.message === 'string' ? b.message : '';
  const message = i.unexpected || validation || !raw || leaksInternals(raw) ? def : raw;
  const details: Record<string, unknown> = { ...scrubDetails(b.details), ...(validation ? { messages: (b.message as unknown[]).filter((m) => typeof m === 'string' && !leaksInternals(m)).slice(0, 50) } : {}) };
  const { error: _nestStatusText, ...rawLegacy } = b as Record<string, unknown>;   // Nest's `error: "Bad Request"` text gives way to the envelope object
  // §31 applies to the legacy top-level fields too — they ride along in the response, so a leak there is still a leak.
  const legacy: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(rawLegacy)) {
    if (DROP_KEYS.test(k)) continue;
    if (typeof x === 'string') { if (!leaksInternals(x)) legacy[k] = x; }
    else if (k === 'details' || (x && typeof x === 'object' && !Array.isArray(x))) legacy[k] = scrubDetails(x);
    else if (Array.isArray(x)) legacy[k] = x.filter((e) => typeof e !== 'string' || !leaksInternals(e));
    else legacy[k] = x;
  }
  return {
    ...legacy,
    code: typeof legacy.code === 'string' && legacy.code ? legacy.code : code,   // compatibility twins for apps that read the top level
    message: validation ? legacy.message : (typeof legacy.message === 'string' && !leaksInternals(legacy.message) ? legacy.message : message),
    error: { code, message, details, action: clientActionFor(code) },
    statusCode: i.status, requestId: i.requestId, reference: i.requestId,
  };
}
