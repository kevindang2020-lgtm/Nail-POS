// customer-identity.service.ts — real-time duplicate prevention (Kevin's sync spec §7/§8, Jul 26 2026).
// Called AFTER a tenant customer row is created (or on demand for one customer). It never blocks or fails the
// tenant's own create: identity linking is best-effort at the edge, with the 7 PM reconciliation as the safety
// net (§4). The tenant's `customers` row is never mutated here — Kevin's rule: tenant data stays tenant-owned;
// only the LINK and the GLOBAL identity are written.
import { systemContext } from '@aipowersalon/tenant-context';
import { Logger } from '@nestjs/common';
import {
  normalizePhoneE164, canonicalEmail, canonicalName, decideOnCreate, maskPhone, maskEmail,
  type IdentitySnapshot,
} from './identity-core';
import type { CustomerIdentityRepositoryPort } from './customer-identity.repository';

/** §25 audit sink — structural, so the identity module doesn't hard-depend on the audit module's class.
 *  The platform's AuditService.record() is already best-effort (never throws into the caller). */
export interface IdentityAuditLike {
  record(ctx: { tenantId: string; userId?: string | null; role?: string | null; actorName?: string | null },
         input: { module: string; action: string; resourceType?: string | null; resourceId?: string | null; summary?: string | null; metadata?: Record<string, unknown> }): Promise<unknown>;
}

export interface TenantCustomerIdentity {
  tenantId: string; customerId: string;
  firstName?: string | null; lastName?: string | null; fullName?: string | null;
  phoneRaw?: string | null; email?: string | null;
  /** Set when the value arrived through a verified path (OTP activation, verified import). */
  phoneVerifiedAt?: string | null; emailVerifiedAt?: string | null;
}

export type LinkOutcome =
  | { outcome: 'linked'; globalCustomerId: string; confidence: string; createdGlobal: boolean }
  | { outcome: 'already_linked'; globalCustomerId: string }
  | { outcome: 'review'; reason: string; candidateIds: string[] }
  | { outcome: 'no_identifiers' }
  | { outcome: 'error'; message: string };

export class CustomerIdentityService {
  private readonly log = new Logger('CustomerIdentity');
  constructor(private readonly repo: CustomerIdentityRepositoryPort, private readonly audit?: IdentityAuditLike) {}

  /** §25: every identity change is auditable. Tenant-scoped (the audit trail is per-tenant), masked values only,
   *  and best-effort — an audit failure never changes the identity outcome. */
  private async writeAudit(tenantId: string, action: string, customerId: string, globalCustomerId: string | null, summary: string, metadata: Record<string, unknown>, runId: string | null): Promise<void> {
    if (!this.audit) return;
    try {
      await this.audit.record(
        { ...systemContext({ tenantId, actor: 'customer-identity' }), actorName: 'Customer Identity' },   // B-14: the ONE system-context shape; the audit row keeps no user id and names the job
        { module: 'customer_identity', action, resourceType: 'customer', resourceId: customerId, summary, metadata: { ...metadata, globalCustomerId, reconciliationRunId: runId } },
      );
    } catch { /* audit is never load-bearing */ }
  }

  /** §7 for IMPORTS: link a bounded batch of a tenant's still-unlinked customers right after an import commits.
   *  Bounded on purpose — a 50,000-row import must not make 50,000 identity round-trips inside one HTTP request.
   *  Whatever exceeds the cap is left unlinked and is picked up by the next reconciliation pass, which is exactly
   *  what the incremental cursor selects for. Returns what happened so the caller can tell the truth in its
   *  import summary. */
  async linkUnlinkedForTenant(tenantId: string, cap = 500): Promise<{ linked: number; newGlobals: number; review: number; deferred: boolean }> {
    const out = { linked: 0, newGlobals: 0, review: 0, deferred: false };
    try {
      const page = await this.repo.customersToReconcile(tenantId, null, null, cap + 1, false);
      if (page.length > cap) out.deferred = true;                  // more remain than we will do inline
      for (const c of page.slice(0, cap)) {
        const r = await this.ensureLinked({
          tenantId: c.tenantId, customerId: c.customerId,
          firstName: c.firstName, lastName: c.lastName, fullName: c.fullName,
          phoneRaw: c.phoneRaw, email: c.email,
        }, 'import');
        if (r.outcome === 'linked') { out.linked++; if (r.createdGlobal) out.newGlobals++; }
        else if (r.outcome === 'review') out.review++;
      }
    } catch (e: any) {
      this.log.error(`import linking failed for tenant ${tenantId}: ${e?.message ?? e}`);   // nightly pass still covers it
    }
    return out;
  }

  /** §9/§10/§17/§18: apply a PROVEN identity value to the global profile.
   *  Rules enforced here, not by the caller:
   *   • the value must already be verified by the caller's own flow (SMS OTP / verified email link);
   *   • if another ACTIVE global identity already holds this VERIFIED identifier, we DO NOT merge or overwrite —
   *     we raise a conflict for review (§9: "POTENTIAL CUSTOMER IDENTITY CONFLICT");
   *   • a verified global value is never replaced by an unverified one (§12);
   *   • the write is version-guarded (§30) so a stale writer loses to a newer change.
   *  Only GLOBAL identity fields move. Tenant notes/history/loyalty are untouched — nothing crosses salons. */
  async applyVerifiedIdentity(input: { tenantId: string; customerId: string; e164?: string | null; email?: string | null }): Promise<{ outcome: 'updated' | 'conflict' | 'not_linked' | 'stale' | 'noop' | 'error'; globalCustomerId?: string; conflictWith?: string }> {
    try {
      const link = await this.repo.linkFor(input.tenantId, input.customerId);
      if (!link) return { outcome: 'not_linked' };                 // the 7 PM pass will link it, then this applies
      const g = await this.repo.globalById(link.globalCustomerId);
      if (!g) return { outcome: 'not_linked' };

      const phone = normalizePhoneE164(input.e164 ?? null);
      const email = canonicalEmail(input.email ?? null);
      if (!phone && !email) return { outcome: 'noop' };

      let changes = 0;
      for (const [field, value] of [['phone', phone], ['email', email]] as const) {
        if (!value) continue;
        const current = field === 'phone' ? g.phone : g.email;
        if (current === value) continue;                            // already ours — no version bump for a no-op
        changes++;
        const other = await this.repo.otherGlobalWithVerified(field, value, g.id);
        if (other) {
          await this.writeAudit(input.tenantId, 'CUSTOMER_CONFLICT_CREATED', input.customerId, g.id,
            `Verified ${field} already belongs to another global customer — flagged, nothing overwritten`,
            { field, valueMasked: field === 'phone' ? maskPhone(value) : maskEmail(value), otherGlobalCustomerId: other }, null);
          return { outcome: 'conflict', globalCustomerId: g.id, conflictWith: other };
        }
      }

      if (changes === 0) return { outcome: 'noop', globalCustomerId: g.id };   // nothing to write (e.g. only casing differed)
      const ok = await this.repo.updateGlobalIdentity(g.id, {
        phone: phone ?? undefined, phoneDisplay: input.e164 ?? undefined, phoneVerifiedAt: phone ? new Date().toISOString() : undefined,
        email: email ?? undefined, emailVerifiedAt: email ? new Date().toISOString() : undefined,
      }, g.version);
      if (!ok) return { outcome: 'stale', globalCustomerId: g.id };  // §30: someone newer won; never clobber
      await this.writeAudit(input.tenantId, phone ? 'CUSTOMER_PHONE_UPDATED' : 'CUSTOMER_EMAIL_UPDATED', input.customerId, g.id,
        'Verified identity value propagated to the global customer profile',
        { phoneMasked: phone ? maskPhone(phone) : undefined, emailMasked: email ? maskEmail(email) : undefined }, null);
      return { outcome: 'updated', globalCustomerId: g.id };
    } catch (e: any) {
      this.log.error(`applyVerifiedIdentity failed for ${input.customerId}: ${e?.message ?? e}`);
      return { outcome: 'error' };
    }
  }

  /** Narrow adapter for the phone-change module's GlobalIdentityPort. */
  async applyVerifiedPhone(input: { tenantId: string; customerId: string; e164: string }): Promise<{ outcome: string }> {
    return this.applyVerifiedIdentity({ tenantId: input.tenantId, customerId: input.customerId, e164: input.e164 });
  }

  /** Resolve-or-create the global identity for one tenant customer and link it. Idempotent; never throws. */
  async ensureLinked(c: TenantCustomerIdentity, source: 'realtime' | 'reconciliation' | 'activation' | 'import' = 'realtime', runId: string | null = null): Promise<LinkOutcome> {
    try {
      const existing = await this.repo.linkFor(c.tenantId, c.customerId);
      if (existing) return { outcome: 'already_linked', globalCustomerId: existing.globalCustomerId };

      const phone = normalizePhoneE164(c.phoneRaw ?? null);
      const email = canonicalEmail(c.email ?? null);
      if (!phone && !email) return { outcome: 'no_identifiers' };   // name alone never creates a global identity

      const incoming: IdentitySnapshot = {
        phone, phoneVerified: !!c.phoneVerifiedAt,
        email, emailVerified: !!c.emailVerifiedAt,
        name: canonicalName(c.fullName ?? `${c.firstName ?? ''} ${c.lastName ?? ''}`),
      };
      const candidates = await this.repo.findCandidates(phone, email);
      const decision = decideOnCreate(incoming, candidates);

      if (decision.kind === 'review') {
        this.log.log(`identity review for customer ${c.customerId}: ${decision.reason} (${maskPhone(phone ?? '')}/${maskEmail(email)})`);
        await this.writeAudit(c.tenantId, 'CUSTOMER_DUPLICATE_FLAGGED', c.customerId, null,
          `Ambiguous identity (${decision.reason}) — flagged for review, nothing merged`,
          { reason: decision.reason, candidateIds: decision.candidateIds, phoneMasked: maskPhone(phone ?? ''), emailMasked: maskEmail(email), source }, runId);
        return { outcome: 'review', reason: decision.reason, candidateIds: decision.candidateIds };
      }

      let globalId: string; let createdGlobal = false; let confidence = 'strong';
      if (decision.kind === 'link') {
        globalId = decision.globalCustomerId; confidence = decision.confidence;
      } else {
        const created = await this.repo.createGlobal({
          firstName: c.firstName ?? null, lastName: c.lastName ?? null,
          fullName: c.fullName ?? ([c.firstName, c.lastName].filter(Boolean).join(' ') || null),
          phone, phoneDisplay: c.phoneRaw ?? null, phoneVerifiedAt: c.phoneVerifiedAt ?? null,
          email, emailVerifiedAt: c.emailVerifiedAt ?? null,
        });
        globalId = created.id; createdGlobal = created.created;
        if (!created.created) {
          confidence = 'strong';                                   // §8: lost the race → the winner IS the match
          await this.writeAudit(c.tenantId, 'CUSTOMER_DUPLICATE_PREVENTED', c.customerId, globalId,
            'Concurrent create lost the verified-identity race — linked the winner instead of duplicating',
            { via: 'verified_unique_race', source }, runId);
        }
      }
      const link = await this.repo.createLink({ tenantId: c.tenantId, customerId: c.customerId, globalCustomerId: globalId, confidence: confidence as any, source, runId });
      if (!link.created) {
        const now = await this.repo.linkFor(c.tenantId, c.customerId);         // idempotent retry raced us — report the truth
        if (now) return { outcome: 'already_linked', globalCustomerId: now.globalCustomerId };
      }
      await this.writeAudit(
        c.tenantId,
        createdGlobal ? 'CUSTOMER_GLOBAL_CREATED' : 'CUSTOMER_GLOBAL_LINKED',
        c.customerId, globalId,
        createdGlobal ? 'New global customer identity created for this salon customer'
                      : 'Linked to an existing global customer identity — duplicate global customer prevented',
        { confidence, source, phoneMasked: maskPhone(phone ?? ''), emailMasked: maskEmail(email), duplicatePrevented: !createdGlobal },
        runId,
      );
      return { outcome: 'linked', globalCustomerId: globalId, confidence, createdGlobal };
    } catch (e: any) {
      this.log.error(`ensureLinked failed for customer ${c.customerId}: ${e?.message ?? e}`);
      return { outcome: 'error', message: String(e?.message ?? e).slice(0, 300) };
    }
  }
}
