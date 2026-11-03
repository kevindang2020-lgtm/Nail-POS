// cash-drawer.repository.ts — Kysely persistence + the expected-cash computation. Register cash sales are approved
// cash payments for the branch/date whose ticket has NO confirmed cash-to-tech record (those belong to the technician,
// not the register). Refunds are cash payments with status 'refunded'. The drawer row holds the float + count + outcome.
import { canMoveToSql } from '@aipowersalon/database';
import { REVENUE_BEARING_STATUSES } from '@aipowersalon/api-contracts';
import { CASH_DRAWER_SESSION } from '../checkout/checkout-lifecycles';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';
import { projectionDeliversRealtime } from '@aipowersalon/config';
import { Kysely, sql } from 'kysely';
import { branchTimeZone, tenantTimeZone, type DB } from '@aipowersalon/database';
import { businessDate } from '@aipowersalon/date-time';
import { DrawerState, DrawerStatus, OwnerDrawerSummary, CashMovement, num, isUuid } from './cash-drawer.dto';

export interface DrawerCtx { tenantId: string; branchId?: string | null; userId?: string | null; role?: string; permissions?: string[]; }
interface Computed { salesCents: number; refundsCents: number; paymentCount: number; }

export class CashDrawerRepository {
  constructor(private readonly db: Kysely<DB>, private readonly outbox?: OutboxWriter) {}
  /** The clock (tests set it). */
  now: () => number = Date.now;
  private zone(ctx: DrawerCtx, branchId?: string | null): Promise<string> { return branchId ? branchTimeZone(this.db, ctx.tenantId, branchId) : tenantTimeZone(this.db, ctx.tenantId); }
  /**
   * The drawer's business date when the caller sends none: the BRANCH's date (the salon's, with no branch) — Oct 6 2026.
   * It was the server's UTC date, so from 8 pm in New York the front desk opened and counted TOMORROW's drawer.
   */
  async today(ctx: DrawerCtx): Promise<string> { return businessDate(await this.zone(ctx, isUuid(ctx.branchId) ? ctx.branchId : null), new Date(this.now())); }
  /** Will the domain event reach clients through the realtime projection? (outbox AND publisher on — 6f3b0ed) */
  emitsDomainEvents(): boolean { return projectionDeliversRealtime(this.outbox != null); }
  /** Record a drawer fact in the SAME transaction as the write it describes (§343: the projection broadcasts it). */
  private async fact(trx: any, ctx: DrawerCtx, type: string, aggregateId: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.outbox) return;
    await this.outbox.write(trx, createDomainEvent({ eventType: type as any, tenantId: ctx.tenantId, branchId: (payload.branchId as string) ?? undefined,
      aggregateType: 'cash_drawer', aggregateId, actorId: isUuid(ctx.userId) ? ctx.userId! : undefined, actorType: 'user', payload }));
  }

  /** Register cash for a branch/date: approved cash sales not attributable to a tech cash-to-tech hand-off, minus cash refunds. */
  async computeRegisterCash(ctx: DrawerCtx, branchId: string, date: string): Promise<Computed> {
    // a payment belongs to the business date it was taken on AT THE BRANCH (was its UTC date: evening cash after 8 pm in
    // New York went to the next day's drawer, so tonight's count came up short and tomorrow's over)
    const tz = await this.zone(ctx, branchId);
    const sales = await this.db.selectFrom('payments as p')
      .select((eb: any) => [eb.fn.coalesce(eb.fn.sum('p.amount_cents'), sql`0`).as('cents'), eb.fn.count('p.id').as('cnt')])
      .where('p.tenant_id', '=', ctx.tenantId).where('p.branch_id', '=', branchId).where('p.method', '=', 'cash').where('p.status', 'in', [...REVENUE_BEARING_STATUSES])   // incl. 'partial' — the cash part of a split (wave 4 PILOT)
      .where(sql`(p.created_at at time zone ${tz})::date = ${date}` as any)
      .where(sql`(p.ticket_id IS NULL OR NOT EXISTS (SELECT 1 FROM cash_payment_confirmations c WHERE c.ticket_id = p.ticket_id AND c.tenant_id = ${ctx.tenantId} AND c.status = 'confirmed'))` as any)
      .executeTakeFirst();   // a failed read must FAIL — it used to read as $0 and reconcile then stored a false shortage (audit Nov 3 2026)
    const refunds = await this.db.selectFrom('payments as p')
      .select((eb: any) => eb.fn.coalesce(eb.fn.sum('p.amount_cents'), sql`0`).as('cents'))
      .where('p.tenant_id', '=', ctx.tenantId).where('p.branch_id', '=', branchId).where('p.method', '=', 'cash').where('p.status', '=', 'refunded')
      .where(sql`(p.created_at at time zone ${tz})::date = ${date}` as any)
      .executeTakeFirst();
    return { salesCents: num((sales as any)?.cents), refundsCents: num((refunds as any)?.cents), paymentCount: num((sales as any)?.cnt) };
  }

  /** Net mid-shift cash movements for a branch/date/register. */
  async computeMovements(ctx: DrawerCtx, branchId: string, registerId: string, date: string): Promise<{ paidInCents: number; paidOutCents: number }> {
    const r = await this.db.selectFrom('cash_drawer_movements')
      .select([
        sql<number>`COALESCE(SUM(amount_cents) FILTER (WHERE direction='in'),0)`.as('in_cents'),
        sql<number>`COALESCE(SUM(amount_cents) FILTER (WHERE direction='out'),0)`.as('out_cents'),
      ])
      .where('tenant_id', '=', ctx.tenantId).where('branch_id', '=', branchId).where('register_id', '=', registerId).where('business_date', '=', date).where('voided_at', 'is', null)
      .executeTakeFirst();
    return { paidInCents: num(r?.in_cents), paidOutCents: num(r?.out_cents) };
  }

  private async getRow(ctx: DrawerCtx, branchId: string, registerId: string, date: string): Promise<any | undefined> {
    return this.db.selectFrom('cash_drawer_sessions').selectAll().where('tenant_id', '=', ctx.tenantId).where('branch_id', '=', branchId).where('register_id', '=', registerId).where('business_date', '=', date).executeTakeFirst();
  }

  async state(ctx: DrawerCtx, branchId: string, registerId: string, date: string): Promise<DrawerState> {
    const [c, mv, row] = await Promise.all([this.computeRegisterCash(ctx, branchId, date), this.computeMovements(ctx, branchId, registerId, date), this.getRow(ctx, branchId, registerId, date)]);
    const openingFloatCents = row ? num(row.opening_float_cents) : 0;
    const liveExpected = openingFloatCents + c.salesCents - c.refundsCents + mv.paidInCents - mv.paidOutCents;
    // a COUNTED drawer keeps the figures it was counted against — a later payment / refund / float edit used to change a
    // reconciled day's expected cash and variance after the fact (audit Nov 3 2026); the live figure is reported beside it
    const counted = !!row && row.counted_cents != null && row.expected_cash_cents != null && (row.status === 'reconciled' || row.status === 'discrepancy');
    const expectedCashCents = counted ? num(row.expected_cash_cents) : liveExpected;
    return {
      branchId, registerId, businessDate: date,
      openingFloatCents, expectedSalesCents: counted ? num(row.expected_sales_cents) : c.salesCents, refundsCents: counted ? num(row.refunds_cents) : c.refundsCents, paidInCents: mv.paidInCents, paidOutCents: mv.paidOutCents, expectedCashCents,
      liveExpectedCashCents: liveExpected, changedSinceCount: counted ? liveExpected !== expectedCashCents : false,
      countedCents: row && row.counted_cents != null ? num(row.counted_cents) : null,
      varianceCents: row && row.counted_cents != null ? num(row.counted_cents) - expectedCashCents : null,
      cashPaymentCount: c.paymentCount,
      status: (row?.status as DrawerStatus) ?? 'open',
      openedAt: row?.opened_at ? new Date(row.opened_at).toISOString() : null,
      reconciledAt: row?.reconciled_at ? new Date(row.reconciled_at).toISOString() : null,
      notes: row?.notes ?? null,
    };
  }

  /** Set/adjust the opening float. Doesn't downgrade an already-reconciled drawer's status. */
  async open(ctx: DrawerCtx, branchId: string, registerId: string, date: string, floatCents: number): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
    await trx.insertInto('cash_drawer_sessions').values({
      tenant_id: ctx.tenantId, branch_id: branchId, register_id: registerId, business_date: date,
      opening_float_cents: floatCents, status: 'open',
      opened_by_user_id: isUuid(ctx.userId) ? ctx.userId : null, opened_at: sql`now()`,
    }).onConflict((oc: any) => oc.columns(['tenant_id', 'branch_id', 'register_id', 'business_date']).doUpdateSet({
      opening_float_cents: floatCents,
      // Phase 12 (#27): CASH_DRAWER_SESSION decides — only a drawer that may (re)open becomes open; a counted one keeps its result
      status: sql`CASE WHEN ${canMoveToSql(CASH_DRAWER_SESSION, 'open', 'cash_drawer_sessions')} THEN 'open' ELSE cash_drawer_sessions.status END`,
      opened_by_user_id: isUuid(ctx.userId) ? ctx.userId : null, opened_at: sql`COALESCE(cash_drawer_sessions.opened_at, now())`, updated_at: sql`now()`,
    })).execute();
    await this.fact(trx, ctx, DOMAIN_EVENTS.CASH_DRAWER_OPENED, `${branchId}:${date}`, { branchId, businessDate: date, openingFloatCents: floatCents });
    });
  }

  /** Count the drawer and reconcile. reconciled if exact, else discrepancy. */
  async reconcile(ctx: DrawerCtx, branchId: string, registerId: string, date: string, countedCents: number, notes: string | null): Promise<{ applied: boolean; status: DrawerStatus; varianceCents: number; expectedCashCents: number; salesCents: number; refundsCents: number; openingFloatCents: number }> {
    const c = await this.computeRegisterCash(ctx, branchId, date);
    const mv = await this.computeMovements(ctx, branchId, registerId, date);
    const row = await this.getRow(ctx, branchId, registerId, date);
    const openingFloatCents = row ? num(row.opening_float_cents) : 0;
    const expectedCashCents = openingFloatCents + c.salesCents - c.refundsCents + mv.paidInCents - mv.paidOutCents;
    const variance = countedCents - expectedCashCents;
    const status: DrawerStatus = variance === 0 ? 'reconciled' : 'discrepancy';
    let applied = false;
    await this.db.transaction().execute(async (trx) => {
    const res = await trx.insertInto('cash_drawer_sessions').values({
      tenant_id: ctx.tenantId, branch_id: branchId, register_id: registerId, business_date: date,
      opening_float_cents: openingFloatCents,
      expected_sales_cents: c.salesCents, refunds_cents: c.refundsCents, expected_cash_cents: expectedCashCents,
      counted_cents: countedCents, variance_cents: variance, cash_payment_count: c.paymentCount, status,
      reconciled_by_user_id: isUuid(ctx.userId) ? ctx.userId : null, reconciled_at: sql`now()`, notes,
    }).onConflict((oc: any) => oc.columns(['tenant_id', 'branch_id', 'register_id', 'business_date']).doUpdateSet({
      expected_sales_cents: c.salesCents, refunds_cents: c.refundsCents, expected_cash_cents: expectedCashCents,
      counted_cents: countedCents, variance_cents: variance, cash_payment_count: c.paymentCount, status,
      reconciled_by_user_id: isUuid(ctx.userId) ? ctx.userId : null, reconciled_at: sql`now()`, notes, updated_at: sql`now()`,
    }).where(canMoveToSql(CASH_DRAWER_SESSION, status, 'cash_drawer_sessions'))).executeTakeFirst();
    applied = Number(res?.numInsertedOrUpdatedRows ?? 0) > 0;
    if (applied) await this.fact(trx, ctx, DOMAIN_EVENTS.CASH_DRAWER_RECONCILED, `${branchId}:${date}`, { branchId, businessDate: date, status, expectedCashCents, countedCents, varianceCents: variance });
    });
    // the state machine refused the move (e.g. a cancelled drawer): report what IS stored, never the status we computed
    if (!applied) { const now = await this.getRow(ctx, branchId, registerId, date); return { applied, status: (now?.status as DrawerStatus) ?? 'open', varianceCents: num(now?.variance_cents), expectedCashCents: num(now?.expected_cash_cents), salesCents: num(now?.expected_sales_cents), refundsCents: num(now?.refunds_cents), openingFloatCents: num(now?.opening_float_cents) }; }
    return { applied, status, varianceCents: variance, expectedCashCents, salesCents: c.salesCents, refundsCents: c.refundsCents, openingFloatCents };
  }

  /** Owner read-only: per-branch register drawer state across the tenant for a date (salon-wide oversight). */
  async ownerList(ctx: DrawerCtx, date: string): Promise<OwnerDrawerSummary> {
    const branches = await this.db.selectFrom('branches').select(['id', 'name'])
      .where('tenant_id', '=', ctx.tenantId).where('status', '=', 'active').orderBy('name').execute().catch(() => [] as any[]);
    const rows = [];
    for (const b of branches) {
      // NOTE: for ownerList, we might need to select all registers for a branch, but for now we aggregate the 'main' register as a proxy, or select all rows directly
      const branchRegisters = await this.db.selectFrom('cash_drawer_sessions').select('register_id').distinct().where('tenant_id', '=', ctx.tenantId).where('branch_id', '=', b.id as string).where('business_date', '=', date).execute().catch(() => [{register_id: 'main'}]);
      if (branchRegisters.length === 0) branchRegisters.push({ register_id: 'main' });
      for (const r of branchRegisters) {
        const st = await this.state(ctx, b.id as string, r.register_id as string, date);
        rows.push({ ...st, branchName: b.name });
      }
    }
    return { businessDate: date, branches: rows };
  }

  async addMovement(ctx: DrawerCtx, branchId: string, registerId: string, date: string, direction: 'in' | 'out', amountCents: number, reason: string | null, note: string | null): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      // a counted drawer is closed for the day: cash in / out after the count would silently change a settled result
      const sess: any = await trx.selectFrom('cash_drawer_sessions').select('status').where('tenant_id', '=', ctx.tenantId).where('branch_id', '=', branchId).where('register_id', '=', registerId).where('business_date', '=', date).forUpdate().executeTakeFirst();
      if (sess && (sess.status === 'reconciled' || sess.status === 'discrepancy')) throw Object.assign(new Error('This drawer was already counted for the day. Reopen it to record cash in or out.'), { drawerCode: 'DRAWER_ALREADY_COUNTED' });
      const row: any = await trx.insertInto('cash_drawer_movements').values({
        tenant_id: ctx.tenantId, branch_id: branchId, register_id: registerId, business_date: date,
        direction, amount_cents: amountCents, reason, note, created_by_user_id: isUuid(ctx.userId) ? ctx.userId : null,
      }).returning('id').executeTakeFirst();
      await this.fact(trx, ctx, DOMAIN_EVENTS.CASH_DRAWER_MOVEMENT_RECORDED, String(row?.id ?? `${branchId}:${date}`), { branchId, registerId, businessDate: date, direction, amountCents });
    });
  }

  /**
   * Payroll cash from the register (Weekly Paycheck mandate §12): a PAYROLL_CASH_PAYOUT "out" movement linked to the
   * payroll payout, written in the CALLER's transaction (the payout and the drawer move together or not at all) and
   * idempotent on its key (a retried "prepare cash" is one withdrawal). The drawer's expected cash drops by it.
   */
  async payrollWithdraw(trx: any, ctx: DrawerCtx, x: { branchId: string; registerId: string; amountCents: number; payoutId: string; idempotencyKey: string; note: string }): Promise<{ movementId: string }> {
    const date = businessDate(await this.zone(ctx, x.branchId), new Date(this.now()));
    const ins: any = await trx.insertInto('cash_drawer_movements').values({
      tenant_id: ctx.tenantId, branch_id: x.branchId, register_id: x.registerId, business_date: date, direction: 'out', amount_cents: x.amountCents,
      reason: 'PAYROLL_CASH_PAYOUT', note: x.note.slice(0, 200), created_by_user_id: isUuid(ctx.userId) ? ctx.userId : null,
      source_type: 'payroll_payout', source_id: x.payoutId, idempotency_key: x.idempotencyKey,
    } as never).onConflict((oc: any) => oc.columns(['tenant_id', 'idempotency_key']).where('idempotency_key', 'is not', null).doNothing()).returning('id').executeTakeFirst();
    if (ins) {
      await this.fact(trx, ctx, DOMAIN_EVENTS.CASH_DRAWER_MOVEMENT_RECORDED, String(ins.id), { branchId: x.branchId, registerId: x.registerId, businessDate: date, direction: 'out', amountCents: x.amountCents, sourceType: 'payroll_payout', sourceId: x.payoutId });
      return { movementId: String(ins.id) };
    }
    const ex: any = await trx.selectFrom('cash_drawer_movements').select('id').where('tenant_id', '=', ctx.tenantId).where('idempotency_key', '=', x.idempotencyKey).executeTakeFirstOrThrow();
    return { movementId: String(ex.id) };
  }
  /** Canceled payroll cash goes back in the drawer: the linked movement is voided (kept in history), in the caller's transaction. */
  async payrollReverse(trx: any, ctx: DrawerCtx, movementId: string): Promise<void> {
    const row: any = await trx.updateTable('cash_drawer_movements').set({ voided_at: sql`now()`, voided_by_user_id: isUuid(ctx.userId) ? ctx.userId : null } as never)
      .where('id', '=', movementId).where('tenant_id', '=', ctx.tenantId).where('voided_at', 'is', null)
      .returning(['branch_id', sql<string>`to_char(business_date, 'YYYY-MM-DD')`.as('business_date')] as never).executeTakeFirst();
    if (row) await this.fact(trx, ctx, DOMAIN_EVENTS.CASH_DRAWER_MOVEMENT_VOIDED, movementId, { branchId: row.branch_id, businessDate: row.business_date, voidedMovementId: movementId, sourceType: 'payroll_payout' });
  }
  /** The cash the drawer should hold right now (today's expected cash) — what payroll may take out. */
  async availableNow(ctx: DrawerCtx, branchId: string, registerId: string): Promise<number> {
    const date = businessDate(await this.zone(ctx, branchId), new Date(this.now()));
    return (await this.state(ctx, branchId, registerId, date)).expectedCashCents;
  }

  async listMovements(ctx: DrawerCtx, branchId: string, registerId: string, date: string): Promise<CashMovement[]> {
    const rows = await this.db.selectFrom('cash_drawer_movements').selectAll()
      .where('tenant_id', '=', ctx.tenantId).where('branch_id', '=', branchId).where('register_id', '=', registerId).where('business_date', '=', date)
      .orderBy('created_at', 'desc').execute().catch(() => [] as any[]);
    return rows.map((r: any) => ({ id: r.id, direction: r.direction, amountCents: num(r.amount_cents), reason: r.reason, note: r.note, createdAt: r.created_at ? new Date(r.created_at).toISOString() : null, voided: !!r.voided_at }));
  }

  async voidMovement(ctx: DrawerCtx, movementId: string): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const row: any = await trx.updateTable('cash_drawer_movements')
        .set({ voided_at: sql`now()`, voided_by_user_id: isUuid(ctx.userId) ? ctx.userId : null })
        .where('id', '=', movementId).where('tenant_id', '=', ctx.tenantId).where('voided_at', 'is', null)
        .returning(['branch_id', sql<string>`to_char(business_date, 'YYYY-MM-DD')`.as('business_date')]).executeTakeFirst();   // a DATE, as the calendar day (a JS Date would stringify as 'Sat Sep 26')
      if (!row) return false;
      await this.fact(trx, ctx, DOMAIN_EVENTS.CASH_DRAWER_MOVEMENT_VOIDED, movementId, { branchId: row.branch_id, businessDate: row.business_date, voidedMovementId: movementId });
      return true;
    }).catch(() => false);
  }

  async audit(ctx: DrawerCtx, action: string, branchId: string, metadata: any): Promise<void> {
    if (!isUuid(ctx.tenantId)) return;
    try { await this.db.insertInto('owner_audit_log').values({ tenant_id: ctx.tenantId, branch_id: branchId, user_id: isUuid(ctx.userId) ? ctx.userId : null, role: ctx.role ?? null, action, entity_type: 'cash_drawer', entity_id: branchId, metadata: JSON.stringify(metadata ?? {}) }).execute(); } catch { /* audit never blocks */ }
  }
  async alert(ctx: DrawerCtx, severity: 'info' | 'warning' | 'critical', code: string, message: string, branchId: string, meta: any): Promise<void> {
    if (!isUuid(ctx.tenantId)) return;
    try { await this.db.insertInto('owner_alerts').values({ tenant_id: ctx.tenantId, branch_id: branchId, category: 'cash_drawer', severity, status: 'new', title: code, body: message, metadata: JSON.stringify(meta ?? {}) }).execute(); } catch { /* alerts never block */ }
  }
}
