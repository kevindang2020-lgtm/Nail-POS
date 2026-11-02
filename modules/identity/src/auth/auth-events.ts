// auth-events.ts — Constitution 3 §55–57, §88, §147 (Step 5, Oct 3 2026): the typed authentication event log.
// Writing an event NEVER blocks the action it describes (fail-soft), and NEVER stores a credential: scrubAuthMetadata
// drops any key that names a password, code, token, secret or OTP, and identifiers are masked before they get here.
import { sql } from 'kysely';

export const AUTH_EVENT_TYPES = [
  'LOGIN_SUCCEEDED', 'LOGIN_FAILED', 'MFA_FAILED', 'RECOVERY_CODE_USED', 'RECOVERY_CODES_GENERATED',
  'REFRESH_REUSE_DETECTED', 'LOGOUT', 'STEP_UP_SUCCEEDED', 'STEP_UP_FAILED',
  'DEVICE_TRUSTED', 'DEVICE_REVOKED', 'DEVICE_BLOCKED', 'DEVICE_BLOCKED_SIGNIN',
  'NEW_DEVICE_ALERT_SENT', 'NOT_ME_REPORTED', 'RISK_ELEVATED', 'STUFFING_BLOCKED',
  'SESSION_ENDED_ACCESS_CHANGED',   // Oct 6 2026: a token refresh found the account gone, inactive, or in another role/salon
  // BUILD_PLAN Phase 13 D (Constitution 6 §37–39): the biometric device credential
  'BIOMETRIC_ENROLLED', 'BIOMETRIC_LOGIN_SUCCEEDED', 'BIOMETRIC_LOGIN_FAILED', 'BIOMETRIC_REUSE_DETECTED',
  'PIN_UNLOCK_FAILED',   // Oct 12 2026 (POS auto-lock): a wrong / rate-limited quick-unlock PIN; reason session_ended on the last allowed one
  'PIN_SET_FAILED', 'PIN_SET',   // Oct 12 2026 merge (workforce audit P0 #6): /auth/set-pin re-authentication failed (the fleet-wide 5/10 min window counts these) / succeeded
  // Security Deep Scan C4: the Postgres attempt budget (auth-attempt-budget.ts) — one row per failed second-factor / step-up /
  // change-password / temporary-password guess (reason = the kind), and the row that says an account's budget ran out
  'ATTEMPT_BUDGET_SPENT', 'ATTEMPT_BUDGET_LOCKED',
  'PASSWORD_RESET_REQUESTED',
  // S-A13 (Security Deep Scan §29 / §136): platform sign-in from a device not approved for platform use (refused, or recorded in
  // report mode), and a device becoming approved (reason = first_device / email / device)
  'PLATFORM_DEVICE_APPROVAL_REQUIRED', 'PLATFORM_DEVICE_APPROVED',   // C12: one forgot / admin reset request (identifier as a keyed hash only) — the shared reset counters
] as const;
export type AuthEventType = (typeof AUTH_EVENT_TYPES)[number];
export type AuthEventOutcome = 'success' | 'failure' | 'info';
export interface AuthEvent {
  type: AuthEventType; outcome: AuthEventOutcome;
  userId?: string | null; tenantId?: string | null; sessionId?: string | null;
  ip?: string | null; userAgent?: string | null; reason?: string | null; metadata?: Record<string, unknown>;
}
const CREDENTIAL_KEY = /pass(word)?|pwd|code|otp|token|secret|pin\b|credential|authorization|cookie/i;
/** Drop credential-named keys (at any depth) and cap sizes — nothing in auth_events can be replayed. */
export function scrubAuthMetadata(m: unknown, depth = 0): Record<string, unknown> {
  if (!m || typeof m !== 'object' || depth > 3) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m as Record<string, unknown>).slice(0, 30)) {
    if (CREDENTIAL_KEY.test(k)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = scrubAuthMetadata(v, depth + 1);
    else if (typeof v === 'string') out[k] = v.slice(0, 200);
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v;
  }
  return out;
}
/** "maria@salon.com" → "m***@salon.com"; "+18565550101" → "***0101" — an identifier shown, never stored whole on a failure. */
export function maskIdentifier(id: unknown): string | null {
  const s = String(id ?? '').trim(); if (!s) return null;
  if (s.includes('@')) { const [u, d] = s.split('@'); return `${u.slice(0, 1)}***@${d}`.slice(0, 120); }
  const digits = s.replace(/\D/g, ''); return digits.length >= 4 ? `***${digits.slice(-4)}` : '***';
}
const isUuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

export interface AuthEventSink { record(e: AuthEvent): Promise<void> }
export class KyselyAuthEvents implements AuthEventSink {
  constructor(private readonly db: any) {}
  async record(e: AuthEvent): Promise<void> {
    if (!AUTH_EVENT_TYPES.includes(e.type)) return;
    try {
      await sql`insert into auth_events (event_type, outcome, user_id, tenant_id, session_id, ip, user_agent, reason, metadata)
        values (${e.type}, ${e.outcome}, ${isUuid(e.userId) ? e.userId : null}::uuid, ${isUuid(e.tenantId) ? e.tenantId : null}::uuid, ${isUuid(e.sessionId) ? e.sessionId : null}::uuid,
                ${e.ip ? String(e.ip).slice(0, 64) : null}, ${e.userAgent ? String(e.userAgent).slice(0, 300) : null}, ${e.reason ? String(e.reason).slice(0, 120) : null},
                ${JSON.stringify(scrubAuthMetadata(e.metadata))}::jsonb)`.execute(this.db);
    } catch { /* the event log never blocks the action it describes */ }
  }
  /** The signed-in user's own recent events (the security screen, Step 8). */
  async listForUser(userId: string, limit = 50): Promise<{ type: string; outcome: string; occurredAt: string; ip: string | null; reason: string | null; metadata: unknown }[]> {
    const r: any = await sql`select event_type, outcome, occurred_at, ip, reason, metadata from auth_events where user_id = ${userId}::uuid order by occurred_at desc limit ${Math.min(200, Math.max(1, limit))}`.execute(this.db);
    return r.rows.map((x: any) => ({ type: x.event_type, outcome: x.outcome, occurredAt: new Date(x.occurred_at).toISOString(), ip: x.ip, reason: x.reason, metadata: x.metadata }));
  }
}
export class InMemoryAuthEvents implements AuthEventSink {
  events: (AuthEvent & { metadata: Record<string, unknown> })[] = [];
  async record(e: AuthEvent) { this.events.push({ ...e, metadata: scrubAuthMetadata(e.metadata) }); }
}
