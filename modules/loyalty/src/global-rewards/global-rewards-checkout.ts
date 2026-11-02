// global-rewards-checkout.ts — binds the rewards network to Checkout (Final Completion guide §04) under the string token
// 'GLOBAL_REWARDS_CHECKOUT' (checkout never imports loyalty: GlobalRewardsCheckoutPort in checkout.service.ts). Also the
// hold-EXPIRY sweep: a HELD reward past its deadline on a ticket that never got paid is EXPIRED and its tender voided; a
// paid ticket's hold is finalized instead; a ticket with an unresolved card tender keeps its protective hold (§6.4).
import { Global, Module, Injectable, Inject, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import { DATABASE, runAsSingleOwner, type AppDatabase } from '@aipowersalon/database';
import { logException, runTick } from '@aipowersalon/observability';
import { runsBackgroundJob } from '@aipowersalon/config';
import { GlobalRewardsRepository } from './global-rewards.repository';
import { holdForTicket, releaseHold, redemptionQuote, finalizeForPaidTicket } from './rewards-redemption';
import { dailyBooksCheck } from './rewards-books-check';

type Row = Record<string, any>;
const n = (v: unknown): number => (v == null ? 0 : Number(v));
export const GLOBAL_REWARDS_CHECKOUT_TOKEN = 'GLOBAL_REWARDS_CHECKOUT';

export class GlobalRewardsCheckoutAdapter {
  private readonly repo: GlobalRewardsRepository;
  constructor(private readonly db: Kysely<any>) { this.repo = new GlobalRewardsRepository(db); }
  quote(ctx: { tenantId: string }, a: { ticketId: string; customerId: string | null; dueCents: number }) {
    return redemptionQuote(this.db, this.repo, { tenantId: ctx.tenantId, customerId: a.customerId, dueCents: a.dueCents }) as Promise<Record<string, unknown> & { available: boolean }>;
  }
  async current(ctx: { tenantId: string }, ticketId: string) {
    const r = (await sql<Row>`SELECT r.id, r.payment_id, r.point_tenths, r.value_cents, r.status, r.expires_at FROM reward_redemptions r
      WHERE r.tenant_id = ${ctx.tenantId}::uuid AND r.ticket_id = ${ticketId}::uuid ORDER BY r.created_at DESC LIMIT 1`.execute(this.db)).rows[0];
    return r ? { redemptionId: String(r.id), paymentId: r.payment_id ? String(r.payment_id) : null, pointTenths: n(r.point_tenths), valueCents: n(r.value_cents), status: String(r.status), expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null } : null;
  }
  hold(exec: unknown, ctx: { tenantId: string; branchId?: string | null; userId?: string | null; role?: string | null }, a: { ticketId: string; customerId: string; blocks: number; dueCents: number; paymentId: string; idempotencyKey: string }) {
    return holdForTicket(exec as Transaction<any>, this.repo, { tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, userId: ctx.userId ?? null, role: ctx.role ?? null }, a);
  }
  async release(exec: unknown, ctx: { tenantId: string; userId?: string | null }, a: { redemptionId: string; reason: string }) {
    return !!(await releaseHold(exec as Transaction<any>, { tenantId: ctx.tenantId, userId: ctx.userId ?? null }, { redemptionId: a.redemptionId, to: 'RELEASED', reason: a.reason }));
  }
}

/**
 * One sweep (the job runs it every minute; tests call it directly). Per expired hold, in its own transaction:
 *   ticket PAID              → finalize (the paid event is authoritative; the hold was valid when the ticket was paid)
 *   unresolved card tender   → keep the protective hold (never release points while money may be moving)
 *   otherwise                → EXPIRED: points back to the customer, the reward tender voided (never confirms later)
 */
export async function expireHolds(db: Kysely<any>, now = new Date(), limit = 200): Promise<{ expired: number; finalized: number; kept: number }> {
  const repo = new GlobalRewardsRepository(db);
  const due = (await sql<Row>`SELECT r.id, r.tenant_id, r.ticket_id, r.payment_id FROM reward_redemptions r WHERE r.status = 'HELD' AND r.expires_at < ${now.toISOString()}::timestamptz
    ORDER BY r.expires_at LIMIT ${limit}`.execute(db)).rows;
  const out = { expired: 0, finalized: 0, kept: 0 };
  for (const h of due) {
    try {
      await db.transaction().execute(async (trx) => {
        const T = String(h.tenant_id);
        // the ticket row lock serializes this sweep with a payment completing on the same ticket
        const t = (await sql<Row>`SELECT t.status FROM tickets t WHERE t.id = ${h.ticket_id}::uuid AND t.tenant_id = ${T}::uuid FOR UPDATE`.execute(trx)).rows[0];
        if (t?.status === 'paid') { const f = await finalizeForPaidTicket(trx, repo, { tenantId: T, ticketId: String(h.ticket_id) }); if (f.outcome === 'confirmed') out.finalized++; return; }
        const unresolved = (await sql<Row>`SELECT 1 AS x FROM payments p WHERE p.tenant_id = ${T}::uuid AND p.ticket_id = ${h.ticket_id}::uuid
          AND p.method <> 'global_reward' AND p.status IN ('processing', 'pending', 'requires_action', 'created') LIMIT 1`.execute(trx)).rows[0];
        if (unresolved) { out.kept++; return; }
        const r = await releaseHold(trx, { tenantId: T, userId: null }, { redemptionId: String(h.id), to: 'EXPIRED', reason: 'hold_deadline_passed' });
        if (!r) return;
        if (r.paymentId) await sql`UPDATE payments p SET status = 'voided' WHERE p.id = ${r.paymentId}::uuid AND p.tenant_id = ${T}::uuid AND p.method = 'global_reward' AND p.status IN ('approved', 'partial')`.execute(trx);
        await sql`UPDATE tickets t SET status = 'ready_for_payment', updated_at = now() WHERE t.id = ${h.ticket_id}::uuid AND t.tenant_id = ${T}::uuid AND t.status = 'payment_in_progress'
          AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.tenant_id = ${T}::uuid AND p.ticket_id = t.id AND p.status IN ('approved', 'partial'))`.execute(trx);
        out.expired++;
      });
    } catch (e) { logException(e, { where: 'global-rewards.expire-holds', redemptionId: String(h.id) }); }
  }
  return out;
}

@Injectable()
export class RewardHoldExpiryJob implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(@Inject(DATABASE) private readonly db: AppDatabase) {}
  onModuleInit() {
    if (!runsBackgroundJob('critical')) return;   // money-adjacent: releases held points
    if (!this.db || process.env.GLOBAL_REWARDS_HOLD_SWEEP === 'off') return;
    const every = 60_000;
    this.timer = setInterval(() => {
      void runTick({ jobType: 'loyalty.reward_hold_expiry', jobClass: 'critical', everyMs: every },
        () => runAsSingleOwner(this.db as Kysely<any>, 'loyalty.reward_hold_expiry', () => expireHolds(this.db as Kysely<any>))).catch((e) => logException(e, { where: 'global-rewards.expire-holds.tick' }));
    }, every);
    this.timer.unref?.();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}

/** Final Completion guide §07: the DAILY books check (the manual "Run check" uses the same checker). Ticks hourly; each day's
 *  run key runs once (missed days are caught up, up to 3 back). GLOBAL_REWARDS_BOOKS_CHECK=off stops it. */
@Injectable()
export class RewardsBooksCheckJob implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(@Inject(DATABASE) private readonly db: AppDatabase) {}
  onModuleInit() {
    if (!runsBackgroundJob('reconciliation')) return;
    if (!this.db || process.env.GLOBAL_REWARDS_BOOKS_CHECK === 'off') return;
    const every = 3_600_000;
    this.timer = setInterval(() => {
      void runTick({ jobType: 'loyalty.books_check_daily', jobClass: 'reconciliation', everyMs: every },
        () => runAsSingleOwner(this.db as Kysely<any>, 'loyalty.books_check_daily', () => dailyBooksCheck(this.db as Kysely<any>))).catch((e) => logException(e, { where: 'global-rewards.books-check.tick' }));
    }, every);
    this.timer.unref?.();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}

@Global()
@Module({
  providers: [
    { provide: GLOBAL_REWARDS_CHECKOUT_TOKEN, useFactory: (db: AppDatabase) => (db ? new GlobalRewardsCheckoutAdapter(db as Kysely<any>) : null), inject: [DATABASE] },
    RewardHoldExpiryJob, RewardsBooksCheckJob,
  ],
  exports: [GLOBAL_REWARDS_CHECKOUT_TOKEN],
})
export class GlobalRewardsCheckoutModule {}
