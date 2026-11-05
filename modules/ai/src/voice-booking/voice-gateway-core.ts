// voice-gateway-core.ts — pure building blocks for the AI-receptionist Booking Gateway (Phase 1). No I/O.
// Provides: the {success,data,meta}/{success,error} envelope Retell parses, the stable error taxonomy (§24),
// canonical payload hashing for idempotency, branch-timezone ISO timestamps, phone masking, and a per-key
// fixed-window rate limiter (in-process; see BOOKING_GATEWAY.md for the single-instance caveat).
import { createHash } from 'node:crypto';
import { HttpException } from '@nestjs/common';

// ---- Error taxonomy (stable codes Retell can branch on) ----
export interface GwErrorSpec { status: number; retryable: boolean; suggestedAction?: string }
export const GW_ERRORS: Record<string, GwErrorSpec> = {
  INVALID_API_KEY:                  { status: 401, retryable: false },
  INSUFFICIENT_SCOPE:               { status: 403, retryable: false },
  RATE_LIMIT_EXCEEDED:              { status: 429, retryable: true,  suggestedAction: 'WAIT_AND_RETRY' },
  VALIDATION_ERROR:                 { status: 400, retryable: false, suggestedAction: 'FIX_REQUEST' },
  SERVICE_NOT_FOUND:                { status: 404, retryable: false },
  CUSTOMER_NOT_FOUND:               { status: 404, retryable: false },
  CUSTOMER_MATCH_AMBIGUOUS:         { status: 409, retryable: false, suggestedAction: 'HANDOFF_TO_HUMAN' },
  CUSTOMER_CONSENT_REQUIRED:        { status: 400, retryable: false, suggestedAction: 'ASK_FOR_CONSENT' },
  APPOINTMENT_NOT_FOUND:            { status: 404, retryable: false },
  APPOINTMENT_NOT_MODIFIABLE:       { status: 409, retryable: false, suggestedAction: 'HANDOFF_TO_HUMAN' },
  CALLER_VERIFICATION_REQUIRED:     { status: 403, retryable: false, suggestedAction: 'VERIFY_CALLER' },
  CONFIRMATION_REQUIRED:            { status: 400, retryable: false, suggestedAction: 'CONFIRM_WITH_CALLER' },
  SLOT_UNAVAILABLE:                 { status: 409, retryable: true,  suggestedAction: 'CHECK_AVAILABILITY' },
  SALON_CLOSED:                     { status: 422, retryable: false, suggestedAction: 'CHECK_HOURS' },
  BOOKING_RULE_VIOLATION:           { status: 422, retryable: false, suggestedAction: 'HANDOFF_TO_HUMAN' },
  IDEMPOTENCY_CONFLICT:             { status: 409, retryable: false },
  IDEMPOTENCY_IN_FLIGHT:            { status: 409, retryable: true,  suggestedAction: 'WAIT_AND_RETRY' },
  HUMAN_HANDOFF_REQUIRED:           { status: 503, retryable: false, suggestedAction: 'HANDOFF_TO_HUMAN' },
  // Phase 4: the salon requires a verified phone and verification cannot be performed right now. Not "slot unavailable"
  // (the audit found the policy's "temporarily unavailable" text word-matched into SLOT_UNAVAILABLE, so the agent
  // offered other times that would all fail the same way).
  PHONE_VERIFICATION_UNAVAILABLE:   { status: 503, retryable: false, suggestedAction: 'HANDOFF_TO_HUMAN' },
  INTEGRATION_TEMPORARILY_UNAVAILABLE: { status: 503, retryable: true, suggestedAction: 'WAIT_AND_RETRY' },
  INTERNAL_ERROR:                   { status: 500, retryable: true },
};

export interface GwMeta { requestId: string; tenantTimezone?: string | null; idempotentReplay?: boolean }
export const gwOk = <T>(data: T, meta: GwMeta) => ({ success: true as const, data, meta });

/** Throw a stable, Retell-parsable error. Message is caller-safe (spoken-aloud quality); never internals. */
export function gwFail(code: keyof typeof GW_ERRORS, message: string, requestId: string, extra?: Record<string, unknown>): never {
  const spec = GW_ERRORS[code] ?? GW_ERRORS.INTERNAL_ERROR;
  throw new HttpException(
    { success: false, error: { code, message, retryable: spec.retryable, ...(spec.suggestedAction ? { suggestedAction: spec.suggestedAction } : {}), ...(extra ?? {}) }, meta: { requestId } },
    spec.status,
  );
}

/** Map internal exceptions to the taxonomy. Never leaks stack traces, SQL, or internal identifiers. */
export function mapGatewayError(e: unknown, requestId: string): never {
  if (e instanceof HttpException) throw e; // already enveloped
  const name = (e as any)?.name ?? '';
  const msg = String((e as any)?.message ?? '');
  if (name === 'ConflictError') gwFail('SLOT_UNAVAILABLE', 'That appointment time is no longer available.', requestId);
  if (name === 'ValidationError') {
    if (/store hours|closed/i.test(msg)) gwFail('SALON_CLOSED', 'The salon is closed at that time.', requestId);
    if (/window|lead|advance|cutoff/i.test(msg)) gwFail('BOOKING_RULE_VIOLATION', msg, requestId);
    gwFail('VALIDATION_ERROR', msg || 'The request was not valid.', requestId);
  }
  if (/not found/i.test(msg)) gwFail('APPOINTMENT_NOT_FOUND', 'I couldn\u2019t find that appointment.', requestId);
  gwFail('INTERNAL_ERROR', 'Something went wrong on our side. Please try again.', requestId);
}

// ---- Request correlation + idempotency hashing ----
export const newRequestId = () => 'req_' + createHash('sha256').update(String(Math.random()) + Date.now()).digest('hex').slice(0, 12);
export const requestIdOf = (provided?: unknown) => (typeof provided === 'string' && provided.trim() ? provided.trim().slice(0, 80) : newRequestId());

/** Stable hash of a payload (key-sorted) so a retried identical request hashes identically. */
export function hashPayload(payload: unknown): string {
  const canon = (v: any): any => Array.isArray(v) ? v.map(canon)
    : (v && typeof v === 'object') ? Object.keys(v).sort().reduce((o, k) => (v[k] === undefined ? o : ((o[k] = canon(v[k])), o)), {} as any)
    : v;
  return createHash('sha256').update(JSON.stringify(canon(payload))).digest('hex');
}

// ---- Timezone-aware display (branch timezone from store_hours_settings / BookingSettings) ----
/** ISO timestamp with the branch's real UTC offset for a salon-local date + HH:MM. Falls back to offsetless local. */
export function isoAt(date: string, hhmm: string, tz: string | null | undefined): string {
  if (!tz) return `${date}T${hhmm}:00`;
  try {
    const probe = new Date(`${date}T${hhmm}:00Z`);
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(probe).find((p) => p.type === 'timeZoneName')?.value ?? '';
    const m = /GMT([+-]\d{2}:\d{2})/.exec(part);
    return `${date}T${hhmm}:00${m ? m[1] : ''}`;
  } catch { return `${date}T${hhmm}:00`; }
}

export const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
export function dayNameOf(date: string): string { return DAY_NAMES[new Date(`${date}T12:00:00Z`).getUTCDay()]; }
export function addDays(date: string, n: number): string { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

export const maskPhone = (p?: string | null) => { const d = String(p ?? '').replace(/\D+/g, ''); return d.length >= 4 ? `***-***-${d.slice(-4)}` : null; };

// ---- Fixed-window per-key rate limiter (in-process; the deployment today is single-instance) ----
export class FixedWindowLimiter {
  private hits = new Map<string, { n: number; resetAt: number }>();
  constructor(private readonly max: number, private readonly windowMs: number) {}
  allow(key: string, now = Date.now()): { ok: boolean; retryAfterSec: number } {
    const cur = this.hits.get(key);
    if (!cur || now >= cur.resetAt) { this.hits.set(key, { n: 1, resetAt: now + this.windowMs }); return { ok: true, retryAfterSec: 0 }; }
    if (cur.n < this.max) { cur.n++; return { ok: true, retryAfterSec: 0 }; }
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)) };
  }
}
