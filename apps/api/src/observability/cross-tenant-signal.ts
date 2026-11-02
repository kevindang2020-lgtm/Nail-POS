// cross-tenant-signal.ts — Constitution 11 §118–121, §262: a signal when someone reaches for another salon's data.
//
// The platform already BLOCKS this: TenantContextMiddleware strips tenantId/branchId from every non-Super-Admin
// body and query, and tenant comes only from the signed session. What was missing is NOTICING. A request naming a
// tenant other than the caller's own is either a bug in a client or someone probing the boundary — both worth knowing.
//
// WHAT COUNTS. Only a supplied tenant id that DIFFERS from the session's. A client echoing its own tenant id is
// harmless (and common), and a different BRANCH id is routine for multi-branch staff — neither is a signal.
//
// WHAT HAPPENS (§120: "should generate a security signal; repeated/systematic events escalate"):
//   every attempt  → a WARN log line (actor, own tenant, named tenant, path, request/correlation ids) and a counter;
//   repeated       → ESCALATION_COUNT attempts by one account within ESCALATION_WINDOW_MS opens ONE security incident in
//                    the security domain's own table (decision D8: observability emits into it, does not own it) and
//                    ONE platform alert, which pages by email (P2). Both are idempotent per account per hour, so
//                    several API instances or a sustained probe produce one incident, not hundreds.
// Severity is P2, not P1: §99's P1 is a cross-tenant INCIDENT — data actually crossing. These attempts were blocked.
//
// NEVER IN THE REQUEST PATH. Recording is synchronous and in-memory; the escalation writes are fire-and-forget and a
// failure is logged, never thrown (§286).
import { registry, log as rootLog, getContext } from '@aipowersalon/observability';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { DATABASE } from '@aipowersalon/database';
import { SecurityEvents } from '@aipowersalon/security-center';

const log = rootLog.withContext({ component: 'security-signal' });
export const ESCALATION_COUNT = 5;
export const ESCALATION_WINDOW_MS = 10 * 60_000;
export const crossTenantAttempts = registry.counter('aipowersalon_security_cross_tenant_attempts_total', 'Requests naming a tenant other than the caller\'s own (blocked)', ['actor_type']);
export const crossTenantEscalations = registry.counter('aipowersalon_security_cross_tenant_escalations_total', 'Accounts escalated for repeated cross-tenant attempts', []);

const TENANT_KEYS = ['tenantId', 'tenant_id'] as const;

/** The tenant a request NAMED, when it differs from the caller's own. Pure. Null when there is nothing to signal. */
export function namedForeignTenant(sessionTenantId: string | null | undefined, ...sources: unknown[]): string | null {
  const own = String(sessionTenantId ?? '').trim().toLowerCase();
  for (const src of sources) {
    if (!src || typeof src !== 'object') continue;
    for (const k of TENANT_KEYS) {
      const v = (src as Record<string, unknown>)[k];
      if (typeof v !== 'string') continue;
      const named = v.trim();
      if (named && named.toLowerCase() !== own) return named.slice(0, 64);
    }
  }
  return null;
}

/** Deterministic, idempotent per account per hour — two instances produce the same ref and the second is a no-op. */
export function escalationRef(actorId: string, at: Date): string {
  const hour = at.toISOString().slice(0, 13).replace(/[-T]/g, '');
  return `SEC-XT-${hour}-${createHash('sha256').update(actorId).digest('hex').slice(0, 10)}`;
}

@Injectable()
export class CrossTenantSignal {
  private readonly windows = new Map<string, number[]>();
  now: () => number = Date.now;
  constructor(@Optional() @Inject(DATABASE) private readonly db: any, @Optional() private readonly securityEvents?: SecurityEvents) {}

  /** Called by TenantContextMiddleware before it strips. Returns true when this call escalated. Never throws. */
  observe(input: { actorId: string | null | undefined; actorType: string; sessionTenantId: string | null | undefined; namedTenantId: string; method: string; path: string }): boolean {
    try {
      crossTenantAttempts.inc({ actor_type: String(input.actorType || 'unknown').toLowerCase() });
      const ctx = getContext();
      log.warn('security.cross_tenant_attempt', {
        actorId: input.actorId ?? null, actorType: input.actorType, ownTenantId: input.sessionTenantId ?? null,
        namedTenantId: input.namedTenantId, method: input.method, path: String(input.path).split('?')[0].slice(0, 200),
      });
      // Constitution 12 §189/§199: every attempt is a permanent security event — the evidence a probe leaves.
      void this.securityEvents?.record({ type: 'CROSS_TENANT_ACCESS_ATTEMPT', tenantId: input.sessionTenantId ?? null, actorType: String(input.actorType || 'user').toLowerCase(), actorId: input.actorId ?? null, resourceType: 'tenant', resourceId: input.namedTenantId, reason: `${input.method} ${String(input.path).split('?')[0].slice(0, 160)}` });
      const actor = input.actorId || 'anonymous';
      const now = this.now();
      const w = (this.windows.get(actor) ?? []).filter((t) => now - t < ESCALATION_WINDOW_MS);
      w.push(now);
      this.windows.set(actor, w);
      if (this.windows.size > 5_000) this.windows.clear();     // bounded under a distributed flood (§289)
      if (w.length !== ESCALATION_COUNT) return false;          // escalate once, on reaching the threshold
      crossTenantEscalations.inc();
      void this.escalate(actor, input, ctx?.correlationId ?? null, new Date(now));
      return true;
    } catch { return false; }
  }

  async escalate(actorId: string, input: { actorType: string; sessionTenantId: string | null | undefined; namedTenantId: string }, correlationId: string | null, at: Date): Promise<void> {
    if (!this.db) return;
    const ref = escalationRef(actorId, at);
    const title = `Repeated cross-tenant access attempts by one ${String(input.actorType).toLowerCase()} account`;
    const detail = `${ESCALATION_COUNT} requests in ${ESCALATION_WINDOW_MS / 60_000} minutes named a tenant other than the account's own. ` +
      `All were blocked (tenant comes only from the signed session). Account ${actorId}, own tenant ${input.sessionTenantId ?? 'none'}, ` +
      `last named ${input.namedTenantId}. A client bug or someone probing the boundary. Runbook: RUNBOOKS.md#cross-tenant-security-incident`;
    try {
      await sql`insert into security_incidents (incident_ref, title, description, category, severity, status, detection_source, tenant_id, correlation_id, detected_at)
                values (${ref}, ${title}, ${detail}, 'cross_tenant_access', 'high', 'detected', 'observability', ${input.sessionTenantId || null}, ${correlationId}, ${at})
                on conflict (incident_ref) do nothing`.execute(this.db);
      await sql`insert into alerts (id, tenant_id, tenant_name, title, message, type, severity, status, related_module, related_record_id, dedupe_key)
                values (gen_random_uuid(), null, 'Platform', ${title}, ${detail}, 'security', 'high', 'unread', 'security_signal', ${ref}, ${ref})
                on conflict (dedupe_key) do nothing`.execute(this.db);
    } catch (e) {
      log.error('security.escalation_failed', { ref, error: (e as Error).message });
    }
  }
}
