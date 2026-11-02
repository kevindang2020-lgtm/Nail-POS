// security-events.ts — Constitution 12 §186–194, §267–269: record security events; group them; never sample them away.
//
// ONE recorder for the whole platform. It stamps each event with the ambient request/correlation ids and actor
// (Constitution 11 request context), passes the free-text reason through the same redaction the logger uses — so a
// careless caller cannot write a token or a phone number into the permanent record (§188) — and never throws into
// the caller: a security event that fails to write is LOGGED at ERROR, it never breaks the request (§286 of C11).
//
// §194 NOT SAMPLED: every call writes a row. Volume is kept sane at the SOURCE (callers record failures and changes,
// not every successful request), not by dropping rows here.
//
// §191/§269 GROUPING, NOT PAGING PER EVENT: `countRecent` lets a detector ask "how many of these in the last N
// minutes?" — C11's cross-tenant escalation and the Security Center use it; nothing pages on a single denied request.
import { getContext, maskValueSecrets, maskEmail, maskPhone, log as rootLog, registry } from '@aipowersalon/observability';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE } from '@aipowersalon/database';

const log = rootLog.withContext({ component: 'security-events' });

/** §189 catalog. The database CHECK constraint carries the same list — a test keeps them identical. */
export const SECURITY_EVENT_TYPES = [
  'LOGIN_FAILED_BURST', 'MFA_ENROLLED', 'MFA_CONFIRMED', 'MFA_REPLACE_REFUSED', 'MFA_DISABLED', 'MFA_RESET', 'MFA_RECOVERY_CODES_GENERATED',
  'SESSION_REVOKED', 'SESSIONS_REVOKED_ALL', 'PRIVILEGE_ESCALATION_ATTEMPT', 'CROSS_TENANT_ACCESS_ATTEMPT',
  'SUPPORT_MODE_STARTED', 'SUPPORT_MODE_ENDED', 'API_KEY_CREATED', 'API_KEY_REVOKED',
  'WEBHOOK_SIGNATURE_FAILED', 'SMS_ABUSE_DETECTED', 'SECRET_ROTATED', 'KEY_FALLBACK_IN_USE',
  'FRAUD_PATTERN_DETECTED',
  // Security Deep Scan §136 / §29: a request refused by the Super Admin network policy (blocked or outside the allowlist)
  'NETWORK_POLICY_DENIED',
] as const;
export type SecurityEventType = typeof SECURITY_EVENT_TYPES[number];
export type SecuritySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** §190 default severity per type; a caller may raise it (never silently lower it below LOW). */
export const DEFAULT_SEVERITY: Readonly<Record<SecurityEventType, SecuritySeverity>> = {
  LOGIN_FAILED_BURST: 'MEDIUM', MFA_ENROLLED: 'LOW', MFA_CONFIRMED: 'LOW', MFA_REPLACE_REFUSED: 'HIGH', MFA_DISABLED: 'HIGH', MFA_RESET: 'HIGH', MFA_RECOVERY_CODES_GENERATED: 'MEDIUM',
  SESSION_REVOKED: 'LOW', SESSIONS_REVOKED_ALL: 'MEDIUM', PRIVILEGE_ESCALATION_ATTEMPT: 'HIGH', CROSS_TENANT_ACCESS_ATTEMPT: 'HIGH',
  SUPPORT_MODE_STARTED: 'MEDIUM', SUPPORT_MODE_ENDED: 'LOW', API_KEY_CREATED: 'LOW', API_KEY_REVOKED: 'MEDIUM',
  WEBHOOK_SIGNATURE_FAILED: 'MEDIUM', SMS_ABUSE_DETECTED: 'HIGH', SECRET_ROTATED: 'MEDIUM', KEY_FALLBACK_IN_USE: 'CRITICAL',
  FRAUD_PATTERN_DETECTED: 'HIGH', NETWORK_POLICY_DENIED: 'HIGH',
};

export interface SecurityEventInput {
  type: SecurityEventType;
  severity?: SecuritySeverity;
  tenantId?: string | null;
  actorType?: string | null;
  actorId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  reason?: string | null;
  ip?: string | null;
  device?: string | null;
}

export const securityEventsTotal = registry.counter('aipowersalon_security_events_total', 'Security events recorded', ['type', 'severity']);
export const securityEventWriteFailures = registry.counter('aipowersalon_security_event_write_failures_total', 'Security events that failed to persist', ['type']);

const clip = (v: unknown, n: number) => (v === null || v === undefined ? null : String(v).slice(0, n));

/**
 * §188 a free-text reason is written to a permanent, append-only record — so it is scrubbed BY VALUE before it
 * lands: tokens, JWTs, provider secrets and Luhn-valid card numbers (the logger's own masker), plus emails and
 * phone numbers, which the logger masks by KEY but a sentence would carry by value.
 */
export function scrubReason(s: string): string {
  return maskValueSecrets(s)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (m) => maskEmail(m))
    .replace(/\+?\d[\d\s().-]{8,}\d/g, (m) => (m.replace(/\D/g, '').length >= 10 ? maskPhone(m) : m));
}

@Injectable()
export class SecurityEvents {
  // The key ring's fallback sink (§41: a derived or constant key in use is CRITICAL) is wired by the API's
  // KeyFallbackReporter, not here — this recorder no longer imports the key ring (Constitution 13 §94/§105).
  constructor(@Optional() @Inject(DATABASE) private readonly db: any) {}

  /** Never throws. Returns true when the row was written. */
  async record(e: SecurityEventInput): Promise<boolean> {
    const severity = e.severity ?? DEFAULT_SEVERITY[e.type];
    securityEventsTotal.inc({ type: e.type, severity });
    const ctx = getContext();
    const row = {
      type: e.type, severity,
      tenantId: e.tenantId ?? ctx?.tenantId ?? null,
      actorType: clip(e.actorType ?? ctx?.actorType, 40), actorId: clip(e.actorId ?? ctx?.actorId, 80),
      resourceType: clip(e.resourceType, 60), resourceId: clip(e.resourceId, 120),
      reason: e.reason ? clip(scrubReason(String(e.reason)), 500) : null,
      requestId: clip(ctx?.requestId, 60), correlationId: clip(ctx?.correlationId, 80),
      ip: clip(e.ip, 64), device: clip(e.device, 200),
    };
    // Every event is also a structured log line (at WARN from MEDIUM up) — searchable where logs are kept.
    (severity === 'LOW' ? log.info : log.warn).call(log, 'security.event', { eventType: row.type, severity, tenantId: row.tenantId, actorId: row.actorId, resourceType: row.resourceType, resourceId: row.resourceId });
    if (!this.db) return false;
    try {
      await sql`insert into security_events (event_type, severity, tenant_id, actor_type, actor_id, resource_type, resource_id, reason, request_id, correlation_id, ip, device)
                values (${row.type}, ${row.severity}, ${row.tenantId}, ${row.actorType}, ${row.actorId}, ${row.resourceType}, ${row.resourceId}, ${row.reason}, ${row.requestId}, ${row.correlationId}, ${row.ip}, ${row.device})`.execute(this.db);
      return true;
    } catch (err) {
      securityEventWriteFailures.inc({ type: e.type });
      log.error('security.event_write_failed', { eventType: e.type, error: (err as Error).message });
      return false;
    }
  }

  /** §191 grouping support: how many of these in the last `minutes`, optionally for one actor or tenant. */
  async countRecent(type: SecurityEventType, minutes: number, by: { actorId?: string; tenantId?: string } = {}): Promise<number> {
    if (!this.db) return 0;
    const since = new Date(Date.now() - minutes * 60_000);
    const r = await sql<{ n: number }>`select count(*)::int n from security_events where event_type = ${type} and occurred_at >= ${since}
        and (${by.actorId ?? null}::text is null or actor_id = ${by.actorId ?? null})
        and (${by.tenantId ?? null}::uuid is null or tenant_id = ${by.tenantId ?? null}::uuid)`.execute(this.db);
    return r.rows[0]?.n ?? 0;
  }
}
