// deals-lifecycle.scheduler.ts — BUILD_PLAN Phase 5: the deals background work, on the platform's ONE job runner.
// CROSS-TENANT BY DESIGN: a platform sweep — it walks every salon's deals by status and time, and each write names the
// row's own tenant in its WHERE.
//
// Every minute (single-owner across processes, runTick):
//   activation   scheduled deals whose start has come → active                       (deal.published)
//   expiry       live deals past their end → expired                                  (deal.expired)   — bug 6: "nothing expires a deal"
//   sold out     a capped deal whose every place is redeemed → sold_out              (deal.sold_out)
//   holds        reservations left unbooked past their 10 minutes → expired
//   safety net   a cancelled / no-show appointment still holding a place → released  (bug 12, for any path that did
//                not emit appointment.canceled / appointment.no_show)
//   reconcile    an application on a ticket that IS paid but was never marked redeemed (the post-payment hook failed)
//                → redeemed; one on a ticket that was removed → released
// Every ten minutes:
//   aggregation  deal_daily_stats for today and yesterday, recomputed from the facts (idempotent)
//   daily check  the promotion reconciliation run, recorded once per salon per 24 hours (extras Promotions Management 10)
import { runTick } from '@aipowersalon/observability';
import { utcDate } from '@aipowersalon/date-time';
import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, registerJobHandler, jobHandlerFor, type AppDatabase } from '@aipowersalon/database';
import { runsBackgroundJob } from '@aipowersalon/config';
import { OutboxWriter, createDomainEvent, DOMAIN_EVENTS } from '@aipowersalon/events';
import { KyselyDealsLedger } from './deals-ledger.kysely';
import { canMoveToSql } from '@aipowersalon/database';
import { DEAL_REDEMPTION_HOLD, DEAL } from './deal-lifecycles';
import { runScheduledPromotionChecks } from '../salon-promotions/coupon-center';

const rowsOf = (r: any): any[] => (r && Array.isArray(r.rows) ? r.rows : []);
export const DEALS_JOB = { lifecycle: 'deals.lifecycle', aggregate: 'deals.aggregate_daily', promotionChecks: 'deals.promotion_checks_daily' } as const;
const TICK_MS = 60_000;
const AGGREGATE_EVERY_MS = 10 * 60_000;
const BATCH = 500;

export interface LifecycleResult { activated: number; expired: number; soldOut: number; holdsExpired: number; appointmentPlacesReleased: number; reconciledPaid: number; releasedAbandoned: number }

async function systemEvent(trx: any, outbox: OutboxWriter | null, type: any, tenantId: string, branchId: string | null, dealId: string, payload: Record<string, unknown>) {
  if (outbox) await outbox.write(trx, createDomainEvent({ eventType: type, tenantId, branchId: branchId ?? undefined, aggregateType: 'deal', aggregateId: dealId, actorType: 'system', payload: { dealId, ...payload } }));
  await sql`INSERT INTO audit_logs (tenant_id, role, action_type, entity_type, entity_id, metadata_json) VALUES (${tenantId}, 'SYSTEM', ${String(type).replace('.', '_')}, 'deal', ${dealId}, ${JSON.stringify(payload)}::jsonb)`.execute(trx);
}

/** One pass of the lifecycle. Public so ops (and tests) can run it without waiting for the timer. */
export async function runDealsLifecycle(db: AppDatabase, outbox: OutboxWriter | null): Promise<LifecycleResult> {
  const d: any = db;
  const out: LifecycleResult = { activated: 0, expired: 0, soldOut: 0, holdsExpired: 0, appointmentPlacesReleased: 0, reconciledPaid: 0, releasedAbandoned: 0 };
  await d.transaction().execute(async (trx: any) => {
    const act = rowsOf(await sql`UPDATE deals SET status = 'active', published_at = COALESCE(published_at, now()), version = version + 1, updated_at = now()
                                  WHERE ${canMoveToSql(DEAL, 'active')} AND id IN (SELECT id FROM deals WHERE status = 'scheduled' AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now()) AND suspended_at IS NULL LIMIT ${BATCH})
                                  RETURNING id, tenant_id, branch_id`.execute(trx));
    for (const r of act) await systemEvent(trx, outbox, DOMAIN_EVENTS.DEAL_PUBLISHED, String(r.tenant_id), r.branch_id, String(r.id), { from: 'scheduled', to: 'active', by: 'schedule' });
    out.activated = act.length;
    const exp = rowsOf(await sql`UPDATE deals SET status = 'expired', expired_at = now(), version = version + 1, updated_at = now()
                                  WHERE ${canMoveToSql(DEAL, 'expired')} AND id IN (SELECT id FROM deals WHERE status IN ('approved','scheduled','active','paused') AND ends_at IS NOT NULL AND ends_at <= now() LIMIT ${BATCH})
                                  RETURNING id, tenant_id, branch_id`.execute(trx));
    for (const r of exp) await systemEvent(trx, outbox, DOMAIN_EVENTS.DEAL_EXPIRED, String(r.tenant_id), r.branch_id, String(r.id), { to: 'expired', by: 'schedule' });
    out.expired = exp.length;
    const sold = rowsOf(await sql`UPDATE deals SET status = 'sold_out', version = version + 1, updated_at = now()
                                   WHERE ${canMoveToSql(DEAL, 'sold_out')} AND id IN (SELECT id FROM deals WHERE status = 'active' AND max_redemptions IS NOT NULL AND redemption_count >= max_redemptions LIMIT ${BATCH})
                                   RETURNING id, tenant_id, branch_id`.execute(trx));
    for (const r of sold) await systemEvent(trx, outbox, DOMAIN_EVENTS.DEAL_SOLD_OUT, String(r.tenant_id), r.branch_id, String(r.id), { to: 'sold_out' });
    out.soldOut = sold.length;
    out.holdsExpired = rowsOf(await sql`UPDATE deal_redemption_holds SET status = 'expired', updated_at = now()
                                         WHERE ${canMoveToSql(DEAL_REDEMPTION_HOLD, 'expired')} AND id IN (SELECT id FROM deal_redemption_holds WHERE status = 'held' AND expires_at < now() LIMIT ${BATCH * 4}) RETURNING id`.execute(trx)).length;
  });
  const ledger = new KyselyDealsLedger(db, outbox);
  // safety net for bug 12: places still held by cancelled / no-show appointments
  const stale = rowsOf(await sql`SELECT DISTINCT h.tenant_id, h.appointment_id FROM deal_redemption_holds h
                                   JOIN pos_tech_appointments a ON a.id = h.appointment_id AND a.tenant_id = h.tenant_id
                                  WHERE h.status IN ('held','consumed') AND a.status IN ('cancelled','canceled','no_show') LIMIT ${BATCH}`.execute(d));
  for (const r of stale) out.appointmentPlacesReleased += await ledger.releaseForAppointment(String(r.tenant_id), String(r.appointment_id), 'appointment_cancelled_sweep');
  // applications on paid tickets that were never marked redeemed; applications on tickets that were removed
  const paid = rowsOf(await sql`SELECT DISTINCT r.tenant_id, r.ticket_id FROM deal_redemptions r JOIN tickets t ON t.id = r.ticket_id AND t.tenant_id = r.tenant_id
                                 WHERE r.status = 'applied' AND (t.status = 'paid' OR t.payment_status = 'paid') LIMIT ${BATCH}`.execute(d));
  for (const r of paid) out.reconciledPaid += (await ledger.markTicketPaid(String(r.tenant_id), String(r.ticket_id))).redeemed;
  const gone = rowsOf(await sql`SELECT r.tenant_id, r.id FROM deal_redemptions r JOIN tickets t ON t.id = r.ticket_id AND t.tenant_id = r.tenant_id
                                 WHERE r.status = 'applied' AND (t.removed_at IS NOT NULL OR t.status IN ('cancelled','canceled','void','voided')) LIMIT ${BATCH}`.execute(d));
  for (const r of gone) if (await ledger.release(String(r.tenant_id), String(r.id), 'ticket_removed', null)) out.releasedAbandoned++;
  return out;
}

/** deal_daily_stats for a day, recomputed from the facts (analytics events + the application ledger). Idempotent. */
/**
 * Roll one SALON-LOCAL day into deal_daily_stats. `day` is a calendar date read in each deal's own timezone (its branch's,
 * else the salon's first branch with one, else UTC) — so an evening redemption in Los Angeles lands on that evening's day,
 * not tomorrow's UTC day. The coarse UTC bounds (day−1 … day+2) keep the scans on the created_at / redeemed_at indexes.
 */
export async function aggregateDealDay(db: AppDatabase, day: string): Promise<number> {
  const r = await sql`
    WITH dz AS (
      SELECT d.id, d.tenant_id,
             COALESCE(b.timezone, (SELECT b2.timezone FROM branches b2 WHERE b2.tenant_id = d.tenant_id AND b2.timezone IS NOT NULL ORDER BY b2.created_at LIMIT 1), 'UTC') AS tz
        FROM deals d LEFT JOIN branches b ON b.id = d.branch_id AND b.tenant_id = d.tenant_id
    ),
    e AS (
      SELECT ev.deal_id, count(*) FILTER (WHERE ev.event_type='view') AS views, count(*) FILTER (WHERE ev.event_type='save') AS saves,
             count(*) FILTER (WHERE ev.event_type='booking_start') AS booking_starts, count(*) FILTER (WHERE ev.event_type='booking') AS bookings,
             count(*) FILTER (WHERE ev.event_type='apply') AS applications
        FROM deal_analytics_events ev JOIN dz ON dz.id = ev.deal_id AND dz.tenant_id = ev.tenant_id
       WHERE ev.created_at >= ${day}::date - 1 AND ev.created_at < ${day}::date + 2 AND (ev.created_at AT TIME ZONE dz.tz)::date = ${day}::date
       GROUP BY ev.deal_id
    ),
    x AS (
      SELECT r.deal_id,
             count(*) FILTER (WHERE (r.redeemed_at AT TIME ZONE dz.tz)::date = ${day}::date) AS redemptions,
             count(*) FILTER (WHERE (r.reversed_at AT TIME ZONE dz.tz)::date = ${day}::date) AS reversals,
             COALESCE(sum(r.amount_discounted_cents) FILTER (WHERE (r.redeemed_at AT TIME ZONE dz.tz)::date = ${day}::date), 0) AS discounted,
             COALESCE(sum(r.reversed_cents) FILTER (WHERE (r.reversed_at AT TIME ZONE dz.tz)::date = ${day}::date), 0) AS reversed
        FROM deal_redemptions r JOIN dz ON dz.id = r.deal_id AND dz.tenant_id = r.tenant_id
       WHERE (r.redeemed_at >= ${day}::date - 1 AND r.redeemed_at < ${day}::date + 2) OR (r.reversed_at >= ${day}::date - 1 AND r.reversed_at < ${day}::date + 2)
       GROUP BY r.deal_id
    )
    INSERT INTO deal_daily_stats (deal_id, tenant_id, day, views, saves, booking_starts, bookings, applications, redemptions, reversals, discounted_cents, reversed_cents, updated_at)
    SELECT d.id, d.tenant_id, ${day}::date,
      COALESCE(e.views,0), COALESCE(e.saves,0), COALESCE(e.booking_starts,0), COALESCE(e.bookings,0), COALESCE(e.applications,0),
      COALESCE(x.redemptions,0), COALESCE(x.reversals,0), COALESCE(x.discounted,0), COALESCE(x.reversed,0), now()
    FROM deals d LEFT JOIN e ON e.deal_id = d.id LEFT JOIN x ON x.deal_id = d.id
    WHERE e.deal_id IS NOT NULL OR x.deal_id IS NOT NULL
    ON CONFLICT (deal_id, day) DO UPDATE SET views = EXCLUDED.views, saves = EXCLUDED.saves, booking_starts = EXCLUDED.booking_starts, bookings = EXCLUDED.bookings,
      applications = EXCLUDED.applications, redemptions = EXCLUDED.redemptions, reversals = EXCLUDED.reversals, discounted_cents = EXCLUDED.discounted_cents,
      reversed_cents = EXCLUDED.reversed_cents, updated_at = now()`.execute(db as any);
  return Number((r as any).numAffectedRows ?? 0);
}

export function registerDealsJobHandlers(db: AppDatabase | null, outbox: OutboxWriter | null): void {
  if (!db) return;
  if (!jobHandlerFor(DEALS_JOB.lifecycle)) registerJobHandler(DEALS_JOB.lifecycle, async () => ({ ...(await runDealsLifecycle(db, outbox)) }));
  if (!jobHandlerFor(DEALS_JOB.aggregate)) registerJobHandler(DEALS_JOB.aggregate, async (payload) => {
    const day = typeof payload.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.day) ? payload.day : utcDate();
    return { day, rows: await aggregateDealDay(db, day) };
  });
  // extras Promotions Management 10: the daily reconciliation run (each salon at most once per 24 hours)
  if (!jobHandlerFor(DEALS_JOB.promotionChecks)) registerJobHandler(DEALS_JOB.promotionChecks, async () => ({ salons: await runScheduledPromotionChecks(db) }));
}

/** On unless DEALS_LIFECYCLE_ENABLED is explicitly off. */
export function dealsLifecycleEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.DEALS_LIFECYCLE_ENABLED ?? '').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'no' || v === 'off');
}

@Injectable()
export class DealsLifecycleScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('DealsLifecycle');
  private timer: NodeJS.Timeout | null = null;
  private aggTimer: NodeJS.Timeout | null = null;
  private readonly outbox = new OutboxWriter();
  constructor(@Inject(DATABASE) private readonly db: AppDatabase | null) {}

  onModuleInit(): void {
    registerDealsJobHandlers(this.db, this.outbox);
    if (!this.db || !runsBackgroundJob('standard') || !dealsLifecycleEnabled()) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'deals.lifecycle', jobClass: 'standard', everyMs: TICK_MS }, () => this.tick()).catch(() => undefined); }, TICK_MS);
    this.aggTimer = setInterval(() => { void runTick({ jobType: 'deals.aggregate_daily', jobClass: 'standard', everyMs: AGGREGATE_EVERY_MS }, () => this.aggregate()).catch(() => undefined); }, AGGREGATE_EVERY_MS);
    this.timer.unref?.(); this.aggTimer.unref?.();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); if (this.aggTimer) clearInterval(this.aggTimer); this.timer = null; this.aggTimer = null; }

  async tick(): Promise<LifecycleResult | null> {
    if (!this.db) return null;
    const r = await runDealsLifecycle(this.db, this.outbox);
    if (Object.values(r).some((n) => n > 0)) this.log.log(`deals lifecycle: ${JSON.stringify(r)}`);
    return r;
  }
  async aggregate(): Promise<void> {
    if (!this.db) return;
    // the salon-local "today" is one of these three calendar dates wherever the salon is (UTC−12 … UTC+14);
    // re-rolling yesterday catches late refunds and events that arrived after its last run
    const now = Date.now();
    for (const at of [now - 86_400_000, now, now + 86_400_000]) await aggregateDealDay(this.db, utcDate(new Date(at)));
    // extras Promotions Management 10: the daily promotion reconciliation (salons without a scheduled run in the last 23 hours)
    const checked = await runScheduledPromotionChecks(this.db);
    if (checked) this.log.log(`daily promotion reconciliation: ${checked} salon(s)`);
  }
}
