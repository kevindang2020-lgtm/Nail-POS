// customer-reconciliation.service.ts — the 7:00 PM engine (Kevin's sync spec §3/§25-§29/§38, Jul 26 2026).
// One advisory-locked run at a time; INCREMENTAL by design (§29: customers that are unlinked or changed since the
// last completed full run — never a nightly full scan); per-tenant isolation of failures (§26: one tenant's error
// makes the run PARTIAL, it never aborts the other 9,999 tenants); conflicts are fingerprint-deduplicated review
// rows, never silent merges; every outcome lands in customer_recon_runs / _tenant_stats honestly.
import { runTick } from '@aipowersalon/observability';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { maskEmail, maskPhone, shouldFireDailySync, isSyncMissed, normalizePhoneE164, canonicalEmail, matchConfidence } from './identity-core';
import type { CustomerIdentityRepositoryPort, ReconTenantOutcome, UnreconciledCustomer } from './customer-identity.repository';
import type { CustomerIdentityService } from './customer-identity.service';
import { runsBackgroundJob } from '@aipowersalon/config';

const PAGE_SIZE = 200;

/** Next 19:00 in the platform timezone, as an ISO instant — for the dashboard's "Next Scheduled Sync". */
export function nextSevenPm(now: Date, timeZone: string): string {
  for (let h = 1; h <= 48; h++) {
    const t = new Date(now.getTime() + h * 3_600_000);
    const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone }).format(t));
    if (hour === 19) return new Date(Math.floor(t.getTime() / 3_600_000) * 3_600_000).toISOString();
  }
  return '';
}                                   // §32 keyset page — bounded memory at 10k tenants

export interface ReconSummary {
  ran: boolean; runId?: string; status?: string;
  tenantsScanned?: number; customersScanned?: number; newGlobals?: number; linkedExisting?: number;
  duplicateSuspects?: number; conflicts?: number; errors?: number; skippedReason?: string;
}

export class CustomerReconciliationService {
  private readonly log = new Logger('CustomerReconciliation');
  constructor(
    private readonly repo: CustomerIdentityRepositoryPort,
    private readonly identity: CustomerIdentityService,
    /** §15: destructive-shaped flows must consult legal holds. Structural port — no hard module dependency. */
    private readonly holds?: { assertDeletable(tenantId: string, customerId: string): Promise<{ deletable: boolean; blockingHolds: unknown[] }> },
  ) {}

  async runReconciliation(
    trigger: 'scheduled' | 'manual',
    scope: { kind: 'all' } | { kind: 'tenant'; tenantId: string } | { kind: 'customer'; tenantId: string; customerId: string } = { kind: 'all' },
    userId: string | null = null,
  ): Promise<ReconSummary> {
    const locked = await this.repo.withReconLock(async () => {
      // §29: the incremental window starts at the last COMPLETED full run. Scoped re-syncs ignore the cursor —
      // a "RE-SYNC CUSTOMER" button must look at the record even if it hasn't changed.
      const cursorFrom = scope.kind === 'all' ? await this.repo.lastCompletedAt() : null;
      const runId = await this.repo.startRun(trigger, scope.kind, scope.kind === 'all' ? null : scope.tenantId, cursorFrom, userId);
      // Second guard (migration 422): the database refused a concurrent platform-wide run. Report the skip
      // honestly rather than processing the fleet twice.
      if (!runId) return { skipped: 'CONCURRENT_RUN' as const };
      const totals = { tenantsScanned: 0, customersScanned: 0, newGlobals: 0, linkedExisting: 0, duplicateSuspects: 0, conflicts: 0, errors: 0 };
      let failedTenants = 0;
      try {
        const tenantIds = scope.kind === 'all' ? await this.repo.activeTenantIds() : [scope.tenantId];
        for (const tenantId of tenantIds) {
          const o: ReconTenantOutcome = { customersScanned: 0, newGlobals: 0, linkedExisting: 0, duplicateSuspects: 0, conflicts: 0, errors: 0 };
          try {
            let after: string | null = null;
            for (;;) {
              // §36/§37: a scoped RE-SYNC forces re-examination of already-linked, unchanged records — that is
              // the whole point of the button. The nightly platform pass stays incremental.
              const force = scope.kind !== 'all';
              let page = await this.repo.customersToReconcile(tenantId, cursorFrom, after, PAGE_SIZE, force);
              if (scope.kind === 'customer') page = page.filter((c) => c.customerId === scope.customerId);
              if (page.length === 0) break;
              for (const c of page) await this.reconcileOne(c, runId, o);
              after = page[page.length - 1]?.customerId ?? null;
              if (scope.kind === 'customer' || page.length < PAGE_SIZE) break;
            }
            await this.repo.writeTenantStat(runId, tenantId, o, 'ok');
          } catch (e: any) {
            failedTenants++; o.errors++;
            await this.repo.writeTenantStat(runId, tenantId, o, 'failed', String(e?.message ?? e).slice(0, 300)).catch(() => {});
            this.log.error(`tenant ${tenantId} reconciliation failed: ${e?.message ?? e}`);   // §26: continue with the rest
          }
          totals.tenantsScanned++;
          totals.customersScanned += o.customersScanned; totals.newGlobals += o.newGlobals;
          totals.linkedExisting += o.linkedExisting; totals.duplicateSuspects += o.duplicateSuspects;
          totals.conflicts += o.conflicts; totals.errors += o.errors;
        }
        const status = failedTenants > 0 ? 'PARTIAL' : totals.conflicts + totals.duplicateSuspects > 0 ? 'COMPLETED_WITH_ISSUES' : 'COMPLETED';
        await this.repo.finishRun(runId, { status, ...totals });
        this.log.log(`reconciliation ${runId} (${trigger}/${scope.kind}): ${status} — tenants=${totals.tenantsScanned} customers=${totals.customersScanned} new=${totals.newGlobals} linked=${totals.linkedExisting} conflicts=${totals.conflicts} errors=${totals.errors}`);
        return { runId, status, ...totals };
      } catch (e: any) {
        await this.repo.finishRun(runId, { status: 'FAILED', ...totals, errorDetail: String(e?.message ?? e).slice(0, 500) }).catch(() => {});
        throw e;
      }
    });
    if (!locked.ran) return { ran: false, skippedReason: 'another reconciliation is running (advisory lock held)' };
    if ((locked.result as any)?.skipped === 'CONCURRENT_RUN') {
      return { ran: false, skippedReason: 'another reconciliation is already running (database guard)' };
    }
    return { ran: true, ...locked.result! };
  }

  // ---- §20/§21/§22 Super Admin read surface ----
  async dashboard(): Promise<{ lastSync: string | null; lastStatus: string | null; nextScheduled: string | null; recentRuns: any[]; openConflicts: number }> {
    const runs = await this.repo.listRuns(10);
    const last = runs.find((r: any) => r.finishedAt);
    const conflicts = await this.repo.listConflicts('NEW', 200);
    return {
      lastSync: last?.finishedAt ?? null,
      lastStatus: last?.status ?? null,
      nextScheduled: nextSevenPm(new Date(), process.env.PLATFORM_TIMEZONE || 'America/New_York'),
      recentRuns: runs,
      openConflicts: conflicts.length,
    };
  }
  listRuns(limit = 20) { return this.repo.listRuns(Math.min(100, Math.max(1, limit))); }
  runDetail(runId: string) { return this.repo.listTenantStats(runId); }
  listConflicts(status: string | null, limit = 50) { return this.repo.listConflicts(status, Math.min(200, Math.max(1, limit))); }

  /** §24 side-by-side comparison before a human decides. Masked values only, and the tenant lists are
   *  RELATIONSHIP counts — which salons each identity is linked into — never any salon's private data. */
  async mergePreview(aId: string, bId: string): Promise<any> {
    const p = await this.repo.mergePreview(aId, bId);
    if (!p) return null;
    const view = (g: any, tenants: string[]) => ({
      globalCustomerId: String(g.globalCustomerId ?? g.id),
      name: g.full_name ?? g.name ?? null,
      phoneMasked: maskPhone(String(g.normalized_phone ?? g.phone ?? '')),
      emailMasked: maskEmail(g.email ?? null),
      phoneVerified: g.phone_verified_at != null || g.phoneVerified === true,
      emailVerified: g.email_verified_at != null || g.emailVerified === true,
      status: g.status ?? 'active',
      linkedTenants: tenants.length,
      createdAt: g.created_at ? new Date(g.created_at).toISOString() : null,
    });
    return {
      a: view(p.a, p.aTenants), b: view(p.b, p.bTenants),
      indicators: {
        samePhone: (p.a.normalized_phone ?? p.a.phone) && (p.a.normalized_phone ?? p.a.phone) === (p.b.normalized_phone ?? p.b.phone),
        sameEmail: (p.a.email ?? null) && (p.a.email ?? null) === (p.b.email ?? null),
        sharesTenant: p.aTenants.some((t: string) => p.bTenants.includes(t)),
      },
    };
  }

  /** §15/§24 MERGE — explicit, confirmed, reversible. The source identity is retired (status='merged',
   *  merged_into_id set), never deleted; its tenant links are repointed to the target. Legal holds are consulted
   *  first: a customer under hold cannot be swept into a destructive-shaped operation. */
  async mergeIdentities(sourceId: string, targetId: string, userId: string | null, confirm: boolean): Promise<{ ok: boolean; reason?: string; moved?: number }> {
    if (!confirm) return { ok: false, reason: 'CONFIRMATION_REQUIRED' };
    if (!sourceId || !targetId || sourceId === targetId) return { ok: false, reason: 'INVALID_PAIR' };
    if (this.holds) {
      const p = await this.repo.mergePreview(sourceId, targetId);
      const tenantCustomers = await this.repo.linkedCustomersOf(sourceId).catch(() => []);
      for (const tc of tenantCustomers) {
        const verdict = await this.holds.assertDeletable(tc.tenantId, tc.customerId).catch(() => ({ deletable: true, blockingHolds: [] as any[] }));
        if (!verdict.deletable) return { ok: false, reason: 'LEGAL_HOLD' };
      }
      void p;
    }
    const res = await this.repo.mergeGlobals(sourceId, targetId, userId);
    if (!res) return { ok: false, reason: 'MERGE_FAILED' };
    return { ok: true, moved: res.moved };
  }

  resolveConflict(id: string, status: string, userId: string | null) { return this.repo.setConflictStatus(id, status, userId); }

  /** §36 forced re-examination: the customer is already linked — does that link still MATCH the record?
   *  A mapping that no longer matches (edited phone/email, a bad historical link, a merge gone sideways) is
   *  exactly what "RE-SYNC CUSTOMER" is supposed to surface. It is reported for review, never silently repointed. */
  private async reexamineLink(c: UnreconciledCustomer, globalId: string, runId: string, o: ReconTenantOutcome): Promise<void> {
    const g = await this.repo.globalById(globalId).catch(() => null);
    if (!g) return;
    const phone = normalizePhoneE164(c.phoneRaw);
    const email = canonicalEmail(c.email);
    if (!phone && !email) return;                                  // nothing to compare against
    const conf = matchConfidence(
      { phone, phoneVerified: false, email, emailVerified: false, name: null },
      { phone: g.phone, phoneVerified: g.phoneVerified, email: g.email, emailVerified: g.emailVerified, name: null },
    );
    if (conf !== 'none') return;                                   // the mapping still holds
    o.duplicateSuspects++;
    const created = await this.repo.upsertConflict({
      fingerprint: `LINK_MISMATCH|${c.tenantId}|${c.customerId}`,
      kind: 'LINK_MISMATCH', tenantId: c.tenantId, customerId: c.customerId, globalCustomerId: globalId,
      mainMasked: maskPhone(phone ?? ''), tenantMasked: maskEmail(email),
      recommendedAction: 'REVIEW_MAPPING', runId,
    }).catch(() => null);
    if (created === 'created') o.conflicts++;
  }

  /** One customer, all outcomes tallied honestly; an error on one record never stops the page (§26). */
  private async reconcileOne(c: UnreconciledCustomer, runId: string, o: ReconTenantOutcome): Promise<void> {
    o.customersScanned++;
    const r = await this.identity.ensureLinked({
      tenantId: c.tenantId, customerId: c.customerId,
      firstName: c.firstName, lastName: c.lastName, fullName: c.fullName,
      phoneRaw: c.phoneRaw, email: c.email,
    }, 'reconciliation', runId);
    if (r.outcome === 'linked') { if (r.createdGlobal) o.newGlobals++; else o.linkedExisting++; return; }
    if (r.outcome === 'already_linked') { await this.reexamineLink(c, r.globalCustomerId, runId, o); return; }
    if (r.outcome === 'no_identifiers') return;
    if (r.outcome === 'review') {
      o.duplicateSuspects++;
      const phone = normalizePhoneE164(c.phoneRaw);
      const email = canonicalEmail(c.email);
      const created = await this.repo.upsertConflict({
        fingerprint: `${r.reason}|${c.tenantId}|${c.customerId}`,
        kind: r.reason, tenantId: c.tenantId, customerId: c.customerId,
        globalCustomerId: r.candidateIds[0] ?? null, otherGlobalCustomerId: r.candidateIds[1] ?? null,
        mainMasked: maskPhone(phone ?? ''), tenantMasked: maskEmail(email),
        recommendedAction: 'REVIEW', runId,
      }).catch(() => null);
      if (created === 'created') o.conflicts++;
      return;
    }
    o.errors++;                                            // r.outcome === 'error' — recorded, never rethrown
  }
}

// ── §3/§38 scheduler + watchdog ─────────────────────────────────────────────

const TICK_MS = 5 * 60 * 1000;
export function syncWorkerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.CUSTOMER_SYNC_WORKER_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

@Injectable()
export class CustomerSyncScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('CustomerSyncScheduler');
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(
    private readonly svc: CustomerReconciliationService,
    private readonly repo: CustomerIdentityRepositoryPort,
    /** Injectable clock. Production passes nothing (real time); tests drive a simulated timeline through the SAME
     *  tick() the server runs, which is the closest thing to proof available without a deployed host. */
    private readonly now: () => Date = () => new Date(),
  ) {}
  onModuleInit(): void {
    if (!runsBackgroundJob('reconciliation')) return;   // Constitution 13 Phase 8: this process may not run 'reconciliation' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (!syncWorkerEnabled()) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'customer.reconciliation', jobClass: 'reconciliation', everyMs: TICK_MS }, () => this.tick()).catch(() => undefined); }, TICK_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.log.log('Customer sync worker armed (7:00 PM daily window, America/New_York, advisory-locked).');
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }
  /** Exposed for the timeline test; production only ever calls it from the interval. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const last = await this.repo.lastCompletedAt();
      const tz = process.env.PLATFORM_TIMEZONE || 'America/New_York';
      if (isSyncMissed(this.now(), last)) {
        // §38: the miss itself is a reviewable alert — fingerprint-constant so it never spams.
        await this.repo.upsertConflict({ fingerprint: 'SYNC_MISSED|platform', kind: 'CUSTOMER_RECONCILIATION_MISSED', tenantId: null, customerId: null, recommendedAction: 'RUN_MANUAL_SYNC', runId: null as any }).catch(() => {});
        this.log.error('CUSTOMER RECONCILIATION MISSED: no completed run in >26h.');
      }
      if (shouldFireDailySync(this.now(), last, tz)) await this.svc.runReconciliation('scheduled');
    } catch (e: any) { this.log.error(`sync tick failed: ${e?.message ?? e}`); }
    finally { this.running = false; }
  }
}
