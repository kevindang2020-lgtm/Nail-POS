/**
 * compensation-recovery.ts — the COMPENSATION RECOVERY WORKER (Payroll mandate §195–§197, §55, §118; wave 2 Oct 12 2026).
 *
 * A confirmed customer payment is never rolled back because the post-payment compensation step failed (§195): checkout
 * logs `compensation_snapshot_failed` and moves on. This worker makes that failure DURABLE and RETRIED:
 *   1. detect — paid tickets (last 45 days) with live service lines and NO compensation snapshot → a 'missing_snapshot'
 *      exception (one per ticket); paid snapshot rows with no technician → 'missing_technician' (§144, blocking);
 *   2. retry — every open / retrying 'missing_snapshot' whose next_attempt_at has come: CompensationService.snapshotPaidTicket
 *      (idempotent — the snapshot is write-once ON CONFLICT DO NOTHING); success resolves the exception, failure bumps
 *      attempts and backs off exponentially (2^n minutes, capped at 6 h) with the error recorded;
 *   3. chargebacks (§55) — a chargeback matched to a payment whose ticket has a snapshot gets ONE set of reversal entries
 *      (chargeback_id idempotency, migration 614) in 'pending_review' — never counted until an owner approves it — and a
 *      'chargeback_review' exception; tenant policy tenant_settings.compensation.chargebackPolicy = 'none' turns it off.
 *      A chargeback the salon WON rejects its still-pending reversal entries and resolves the exception.
 * Scheduler safety (§118): one controlled scheduler — runTick + runsBackgroundJob('standard') + runAsSingleOwner (a
 * cluster-wide advisory lease), so N API replicas run it once per tick. Off with COMPENSATION_RECOVERY=off.
 */
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { canMoveToSql, runAsSingleOwner, type DB } from '@aipowersalon/database';
import { runsBackgroundJob } from '@aipowersalon/config';
import { runTick } from '@aipowersalon/observability';
import { CompensationExceptionsRepository } from './compensation-exceptions.repository';
import { buildRefundReversal } from './compensation-adjustments';
import type { CompensationService } from './compensation.service';
import { COMPENSATION_ADJUSTMENT } from '../workforce-lifecycles';

export const RECOVERY_TICK_MS = 5 * 60_000;
export const RECOVERY_LOOKBACK_DAYS = 45;
/** PURE: exponential back-off for the n-th failed attempt (minutes 2^n, capped at 6 hours). */
export function nextAttemptDelayMs(attempts: number): number { return Math.min(6 * 60, 2 ** Math.max(0, Math.min(12, attempts))) * 60_000; }
export function recoveryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.COMPENSATION_RECOVERY ?? '').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'no' || v === 'off');
}

export interface RecoveryReport { detectedMissing: number; detectedUnassigned: number; retried: number; recovered: number; chargebacksReversed: number; chargebacksWon: number }

@Injectable()
export class CompensationRecoveryWorker implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null; private running = false;
  private readonly log = new Logger('CompensationRecoveryWorker');
  private readonly exceptions: CompensationExceptionsRepository | null;
  // constructed by PayrollModule's factory (database + the compensation service) — no DI tokens of its own
  constructor(private readonly db: Kysely<DB> | null, private readonly compensation: Pick<CompensationService, 'snapshotPaidTicket'> | null,
              private readonly now: () => number = Date.now) {
    this.exceptions = db ? new CompensationExceptionsRepository(db) : null;
  }
  onModuleInit(): void {
    if (!this.db || !this.compensation || !runsBackgroundJob('standard') || !recoveryEnabled()) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'compensation.recovery', jobClass: 'standard', everyMs: RECOVERY_TICK_MS }, () => this.runOnce()).catch(() => undefined); }, RECOVERY_TICK_MS);
    this.timer.unref?.();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** One pass, cluster-wide single owner. Safe to call from a test or the live proof script. */
  async runOnce(tenantId?: string): Promise<RecoveryReport> {
    const empty: RecoveryReport = { detectedMissing: 0, detectedUnassigned: 0, retried: 0, recovered: 0, chargebacksReversed: 0, chargebacksWon: 0 };
    if (!this.db || !this.compensation || this.running) return empty;
    this.running = true;
    try {
      const out = await runAsSingleOwner(this.db, 'compensation-recovery', () => this.pass(tenantId));
      return out.ran ? out.result : empty;
    } finally { this.running = false; }
  }

  private async pass(tenantId?: string): Promise<RecoveryReport> {
    const db = this.db!; const ex = this.exceptions!;
    const r: RecoveryReport = { detectedMissing: 0, detectedUnassigned: 0, retried: 0, recovered: 0, chargebacksReversed: 0, chargebacksWon: 0 };
    const since = new Date(this.now() - RECOVERY_LOOKBACK_DAYS * 86_400_000).toISOString();
    const tenantFilter = tenantId ? sql`and t.tenant_id = ${tenantId}` : sql``;
    // 1a. paid tickets with service lines and no snapshot
    const missing = (await sql<{ tenant_id: string; ticket_id: string; branch_id: string | null }>`
      select t.tenant_id, t.id as ticket_id, t.branch_id from tickets t
      where t.status = 'paid' and t.paid_at >= ${since} ${tenantFilter}
        and exists (select 1 from ticket_service_lines l where l.tenant_id = t.tenant_id and l.ticket_id = t.id and l.removed_at is null)
        and not exists (select 1 from ticket_compensation_snapshots s where s.tenant_id = t.tenant_id and s.ticket_id = t.id)
      order by t.paid_at asc limit 200`.execute(db)).rows;
    for (const m of missing) {
      await ex.raise(m.tenant_id, { kind: 'missing_snapshot', severity: 'blocking', dedupeKey: m.ticket_id, ticketId: m.ticket_id, branchId: m.branch_id, detail: { reason: 'paid ticket has no compensation snapshot' } });
      r.detectedMissing++;
    }
    // 1b. snapshot rows with no technician (unassigned service line) — the owner must assign it (blocking)
    const unassigned = (await sql<{ tenant_id: string; ticket_id: string; branch_id: string | null }>`
      select distinct s.tenant_id, s.ticket_id, s.branch_id from ticket_compensation_snapshots s
      where s.technician_id is null and s.tech_service_earnings_cents <> 0 and s.snapshot_at >= ${since} ${tenantId ? sql`and s.tenant_id = ${tenantId}` : sql``} limit 200`.execute(db)).rows;
    for (const u of unassigned) {
      await ex.raise(u.tenant_id, { kind: 'missing_technician', severity: 'blocking', dedupeKey: u.ticket_id, ticketId: u.ticket_id, branchId: u.branch_id, detail: { reason: 'a paid service line has no technician' } });
      r.detectedUnassigned++;
    }
    // 2. retry due missing snapshots
    const due = await db.selectFrom('compensation_exceptions').select(['id', 'tenant_id', 'branch_id', 'ticket_id', 'attempts'])
      .where('kind', '=', 'missing_snapshot').where('status', 'in', ['open', 'retrying'])
      .where((eb) => eb.or([eb('next_attempt_at', 'is', null), eb('next_attempt_at', '<=', new Date(this.now()).toISOString() as any)]))
      .$if(!!tenantId, (q) => q.where('tenant_id', '=', tenantId!)).orderBy('created_at', 'asc').limit(100).execute();
    for (const d of due) {
      if (!d.ticket_id) continue;
      r.retried++;
      const res = await this.compensation!.snapshotPaidTicket({ tenantId: d.tenant_id, branchId: d.branch_id ?? null }, d.ticket_id).catch((e: any) => ({ ok: false, error: e?.message || String(e) }));
      if (res.ok) { await ex.setStatus(d.tenant_id, d.id, 'resolved', { note: 'Commission record written by the recovery worker.' }); r.recovered++; }
      else {
        const attempts = Number(d.attempts || 0) + 1;
        await ex.setStatus(d.tenant_id, d.id, 'retrying', { lastError: res.error ?? 'snapshot failed', bumpAttempt: true, nextAttemptAt: new Date(this.now() + nextAttemptDelayMs(attempts)).toISOString() });
      }
    }
    // 3. chargebacks → pending-review reversal (once per case), won → reject the pending entries
    const cbs = (await sql<{ id: string; tenant_id: string; branch_id: string | null; status: string; amount_cents: number; ticket_id: string; captured: number }>`
      select c.id, c.tenant_id, c.branch_id, c.status, c.amount_cents, p.ticket_id,
             (select coalesce(sum(p2.amount_cents), 0) from payments p2 where p2.tenant_id = c.tenant_id and p2.ticket_id = p.ticket_id) as captured
      from chargebacks c join payments p on p.tenant_id = c.tenant_id and p.id = c.payment_id
      where c.opened_at >= ${since} and p.ticket_id is not null ${tenantId ? sql`and c.tenant_id = ${tenantId}` : sql``}
      order by c.opened_at asc limit 200`.execute(db)).rows;
    for (const c of cbs) {
      if (await this.chargebackPolicy(c.tenant_id) === 'none') continue;
      if (c.status === 'won') {
        const rej = await db.updateTable('compensation_adjustments').set({ status: 'rejected', decided_at: sql`now()`, decision_reason: 'Chargeback won by the salon' })
          .where('tenant_id', '=', c.tenant_id).where('chargeback_id', '=', c.id).where('status', '=', 'pending_review').where(canMoveToSql(COMPENSATION_ADJUSTMENT, 'rejected') as any).executeTakeFirst();
        if (Number(rej?.numUpdatedRows ?? 0) > 0) r.chargebacksWon++;
        await ex.resolveByKey(c.tenant_id, 'chargeback_review', c.id, 'Chargeback won — reversal rejected automatically.');
        continue;
      }
      const have = await db.selectFrom('compensation_adjustments').select(['id']).where('tenant_id', '=', c.tenant_id).where('chargeback_id', '=', c.id).limit(1).executeTakeFirst();
      if (have) continue;
      const snap = await db.selectFrom('ticket_compensation_snapshots')
        .select(['service_line_id', 'technician_id', 'tech_service_earnings_cents', 'salon_service_share_cents', 'supply_cents', 'card_tip_cents', 'cash_tip_cents', 'retail_commission_cents'])
        .where('tenant_id', '=', c.tenant_id).where('ticket_id', '=', c.ticket_id).execute();
      if (!snap.length) continue;
      // a partial chargeback reverses pro-rata (disputed / captured), largest-remainder exact (§52/§55)
      const scaled = buildRefundReversal(c.ticket_id, snap.map((x: any) => ({ ...x, tech_service_earnings_cents: Number(x.tech_service_earnings_cents), salon_service_share_cents: Number(x.salon_service_share_cents),
        supply_cents: Number(x.supply_cents), card_tip_cents: Number(x.card_tip_cents), cash_tip_cents: Number(x.cash_tip_cents), retail_commission_cents: Number(x.retail_commission_cents) })),
        { type: 'chargeback', refundedCents: Number(c.amount_cents) || undefined, capturedCents: Number(c.captured) || undefined },
        { reason: 'Chargeback received — reversal waits for the owner\'s decision', requestedBy: null, chargebackId: c.id });
      if (!scaled.length) continue;
      const ins = await db.insertInto('compensation_adjustments').values(scaled.map((e) => ({
        tenant_id: c.tenant_id, branch_id: c.branch_id ?? null, technician_id: e.technicianId, ticket_id: e.ticketId, service_line_id: e.serviceLineId, period_id: null,
        category: e.category, amount_cents: e.amountCents, reason: e.reason, status: e.status, source: 'chargeback', targets_future_period: false, requested_by: null, approved_by: null, chargeback_id: c.id,
      }))).onConflict((oc) => oc.expression(sql`tenant_id, chargeback_id, COALESCE(service_line_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(technician_id, '00000000-0000-0000-0000-000000000000'::uuid), category`)
        .where('chargeback_id', 'is not', null).doNothing()).returning(['id']).execute();
      if (ins.length) {
        r.chargebacksReversed++;
        await ex.raise(c.tenant_id, { kind: 'chargeback_review', severity: 'warning', dedupeKey: c.id, ticketId: c.ticket_id, branchId: c.branch_id, detail: { entries: ins.length, chargebackStatus: c.status } });
      }
    }
    if (r.detectedMissing || r.retried || r.chargebacksReversed) this.log.log(`compensation recovery: ${JSON.stringify(r)}`);
    return r;
  }

  private async chargebackPolicy(tenantId: string): Promise<'review' | 'none'> {
    try {
      const s: any = await this.db!.selectFrom('tenant_settings').select(['settings_json']).where('tenant_id', '=', tenantId).where('category', '=', 'compensation').where('branch_id', 'is', null).executeTakeFirst();
      const j = s?.settings_json ? (typeof s.settings_json === 'string' ? JSON.parse(s.settings_json) : s.settings_json) : null;
      return j?.chargebackPolicy === 'none' ? 'none' : 'review';
    } catch { return 'review'; }
  }
}
