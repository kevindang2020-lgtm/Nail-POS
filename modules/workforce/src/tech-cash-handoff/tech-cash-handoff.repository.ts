// tech-cash-handoff.repository.ts — Kysely persistence. Expected cash is derived from confirmed
// Skip-the-Line cash-to-tech payments (cash_payment_confirmations); the hand-off + reconciliation
// lives in tech_cash_handoffs. Audit -> owner_audit_log, discrepancy alert -> owner_alerts.
import { canMoveToSql, defineStateMachine } from '@aipowersalon/database';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';
import { projectionDeliversRealtime } from '@aipowersalon/config';
import { Kysely, sql } from 'kysely';
import { branchTimeZone, tenantTimeZone, type DB } from '@aipowersalon/database';
import { businessDate } from '@aipowersalon/date-time';
import { CashHandoff, CashHandoffDetail, HandoffLine, HandoffStatus, num, isUuid } from './tech-cash-handoff.dto';

/** BUILD_PLAN Phase 12 (#27): tech_cash_handoffs.status — a technician's cash for the day: open, submitted to the front desk
 *  (re-submittable), then counted: reconciled or discrepancy (a recount may flip between them). The upserts below carry
 *  canMoveToSql(TECH_CASH_HANDOFF, to): exactly the moves they have always made. */
export const TECH_CASH_HANDOFF = defineStateMachine({
  name: 'tech_cash_handoff', table: 'tech_cash_handoffs', column: 'status',
  states: ['open', 'submitted', 'reconciled', 'discrepancy', 'cancelled'],
  transitions: { open: ['submitted', 'reconciled', 'discrepancy'], submitted: ['submitted', 'reconciled', 'discrepancy'], reconciled: ['reconciled', 'discrepancy'], discrepancy: ['reconciled', 'discrepancy'], cancelled: ['submitted', 'reconciled', 'discrepancy'] },
  initial: ['submitted', 'reconciled', 'discrepancy'],
});

export interface TCHCtx { tenantId: string; branchId?: string | null; userId?: string | null; role?: string; permissions?: string[]; }
interface Expected { expectedCents: number; paymentCount: number; lines: HandoffLine[]; }

export class TechCashHandoffRepository {
  constructor(private readonly db: Kysely<DB>, private readonly outbox?: OutboxWriter) {}
  /** The clock (tests set it). */
  now: () => number = Date.now;
  private zone(ctx: TCHCtx): Promise<string> { return isUuid(ctx.branchId) ? branchTimeZone(this.db, ctx.tenantId, ctx.branchId) : tenantTimeZone(this.db, ctx.tenantId); }
  /** The business date a hand-off defaults to: the BRANCH's (Oct 6 2026 — was the server's UTC date). */
  async today(ctx: TCHCtx): Promise<string> { return businessDate(await this.zone(ctx), new Date(this.now())); }
  /** Will the domain event reach clients through the realtime projection? (outbox AND publisher on — 6f3b0ed) */
  emitsDomainEvents(): boolean { return projectionDeliversRealtime(this.outbox != null); }
  /** Record a hand-off fact in the SAME transaction as the write it describes (§343: the projection broadcasts it). */
  private async fact(trx: any, ctx: TCHCtx, type: string, technicianId: string, date: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.outbox) return;
    await this.outbox.write(trx, createDomainEvent({ eventType: type as any, tenantId: ctx.tenantId, branchId: (ctx.branchId as string) || undefined,
      aggregateType: 'cash_handoff', aggregateId: `${technicianId}:${date}`, actorId: isUuid(ctx.userId) ? ctx.userId! : undefined, actorType: 'user',
      payload: { technicianId, businessDate: date, ...payload } }));
  }

  async resolveTechnicianId(ctx: TCHCtx): Promise<string | null> {
    if (!ctx.tenantId || !ctx.userId) return null;
    const r = await this.db.selectFrom('technicians').select('id').where('tenant_id', '=', ctx.tenantId).where('user_id', '=', ctx.userId).where('is_active', '=', true).executeTakeFirst().catch(() => undefined);
    return (r as any)?.id ?? null;
  }
  private async technicianName(ctx: TCHCtx, techId: string): Promise<string> {
    const r = await this.db.selectFrom('technicians').select('full_name').where('tenant_id', '=', ctx.tenantId).where('id', '=', techId).executeTakeFirst().catch(() => undefined);
    return (r as any)?.full_name || '';
  }

  /** Cash a technician physically collected on a date (confirmed cash-to-tech only). */
  async expectedCashForTech(ctx: TCHCtx, technicianId: string, date: string): Promise<Expected> {
    const rows = await this.db.selectFrom('cash_payment_confirmations as c')
      .leftJoin('tickets as t', 't.id', 'c.ticket_id')
      .leftJoin('customers as cu', 'cu.id', 'c.customer_id')
      .select(['c.ticket_id as ticketId', 'c.amount_cents as amountCents', 'c.confirmed_at as confirmedAt', 't.ticket_number as ticketNumber', 'cu.full_name as customerName'])
      .where('c.tenant_id', '=', ctx.tenantId).where('c.technician_id', '=', technicianId).where('c.status', '=', 'confirmed')
      .where(sql`(c.confirmed_at at time zone ${await this.zone(ctx)})::date = ${date}` as any)   // the branch's date (was the UTC date)
      .orderBy('c.confirmed_at', 'asc').execute().catch(() => []);
    const lines: HandoffLine[] = (rows as any[]).map((r) => ({
      ticketId: r.ticketId,
      ticketNumber: r.ticketNumber ? '#' + r.ticketNumber : '#' + String(r.ticketId).slice(0, 6),
      customerName: r.customerName || '',
      amountCents: num(r.amountCents),
      confirmedAt: r.confirmedAt ? new Date(r.confirmedAt).toISOString() : null,
    }));
    return { expectedCents: lines.reduce((a, l) => a + l.amountCents, 0), paymentCount: lines.length, lines };
  }

  private async getRow(ctx: TCHCtx, technicianId: string, date: string): Promise<any | undefined> {
    return this.db.selectFrom('tech_cash_handoffs').selectAll().where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', technicianId).where('business_date', '=', date as any).executeTakeFirst().catch(() => undefined);
  }

  private toHandoff(techId: string, techName: string, date: string, exp: { expectedCents: number; paymentCount: number }, row: any): CashHandoff {
    return {
      technicianId: techId, technicianName: techName, businessDate: date,
      expectedCents: exp.expectedCents, paymentCount: exp.paymentCount,
      countedCents: row && row.counted_cents != null ? num(row.counted_cents) : null,
      varianceCents: row && row.variance_cents != null ? num(row.variance_cents) : null,
      status: (row?.status as HandoffStatus) ?? 'open',
      submittedAt: row?.submitted_at ? new Date(row.submitted_at).toISOString() : null,
      reconciledAt: row?.reconciled_at ? new Date(row.reconciled_at).toISOString() : null,
      notes: row?.notes ?? null,
    };
  }

  async handoffForTech(ctx: TCHCtx, technicianId: string, date: string): Promise<CashHandoffDetail> {
    const [exp, row, name] = await Promise.all([this.expectedCashForTech(ctx, technicianId, date), this.getRow(ctx, technicianId, date), this.technicianName(ctx, technicianId)]);
    return { ...this.toHandoff(technicianId, name, date, exp, row), lines: exp.lines };
  }

  /** The end-of-day board: every tech with cash that day (plus any existing hand-off rows). */
  async listForDay(ctx: TCHCtx, date: string): Promise<CashHandoff[]> {
    const agg = await this.db.selectFrom('cash_payment_confirmations as c')
      .select((eb: any) => ['c.technician_id as technicianId', eb.fn.sum('c.amount_cents').as('expectedCents'), eb.fn.count('c.id').as('paymentCount')])
      .where('c.tenant_id', '=', ctx.tenantId).where('c.status', '=', 'confirmed').where('c.technician_id', 'is not', null)
      .where(sql`(c.confirmed_at at time zone ${await this.zone(ctx)})::date = ${date}` as any)   // the branch's date (was the UTC date)
      .groupBy('c.technician_id').execute().catch(() => []);
    const rows = await this.db.selectFrom('tech_cash_handoffs').selectAll().where('tenant_id', '=', ctx.tenantId).where('business_date', '=', date as any).execute().catch(() => []);
    const aggMap = new Map((agg as any[]).map((a) => [a.technicianId, a]));
    const rowMap = new Map((rows as any[]).map((r) => [r.technician_id, r]));
    const ids = Array.from(new Set([...aggMap.keys(), ...rowMap.keys()].filter(Boolean))) as string[];
    if (ids.length === 0) return [];
    const names = await this.db.selectFrom('technicians').select(['id', 'full_name']).where('tenant_id', '=', ctx.tenantId).where('id', 'in', ids).execute().catch(() => []);
    const nameMap = new Map((names as any[]).map((n) => [n.id, n.full_name]));
    return ids.map((id) => {
      const a: any = aggMap.get(id); const row: any = rowMap.get(id);
      const exp = { expectedCents: a ? num(a.expectedCents) : num(row?.expected_cents), paymentCount: a ? num(a.paymentCount) : num(row?.payment_count) };
      return this.toHandoff(id, nameMap.get(id) || '', date, exp, row);
    }).sort((x, y) => x.technicianName.localeCompare(y.technicianName));
  }

  /** Tech marks the day's cash as handed off. Won't downgrade an already-reconciled row. */
  async submit(ctx: TCHCtx, technicianId: string, date: string, exp: { expectedCents: number; paymentCount: number }): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
    await trx.insertInto('tech_cash_handoffs').values({
      tenant_id: ctx.tenantId, branch_id: (ctx.branchId as any) ?? null, technician_id: technicianId, business_date: date as any,
      expected_cents: exp.expectedCents, payment_count: exp.paymentCount, status: 'submitted',
      submitted_by_user_id: isUuid(ctx.userId) ? ctx.userId : null, submitted_at: sql`now()`,
    } as any).onConflict((oc: any) => oc.columns(['tenant_id', 'technician_id', 'business_date']).doUpdateSet({
      expected_cents: exp.expectedCents, payment_count: exp.paymentCount,
      // Phase 12 (#27): TECH_CASH_HANDOFF decides — a counted handoff keeps its result when the technician re-submits
      status: sql`CASE WHEN ${canMoveToSql(TECH_CASH_HANDOFF, 'submitted', 'tech_cash_handoffs')} THEN 'submitted' ELSE tech_cash_handoffs.status END`,
      submitted_by_user_id: isUuid(ctx.userId) ? ctx.userId : null, submitted_at: sql`COALESCE(tech_cash_handoffs.submitted_at, now())`, updated_at: sql`now()`,
    } as any)).execute();
    await this.fact(trx, ctx, DOMAIN_EVENTS.CASH_HANDOFF_SUBMITTED, technicianId, date, { expectedCents: exp.expectedCents, paymentCount: exp.paymentCount });
    });
  }

  /** Front desk counts the cash and reconciles. reconciled if exact, else discrepancy. */
  async reconcile(ctx: TCHCtx, technicianId: string, date: string, exp: { expectedCents: number; paymentCount: number }, countedCents: number, notes: string | null): Promise<{ status: HandoffStatus; varianceCents: number }> {
    const variance = countedCents - exp.expectedCents;
    const status: HandoffStatus = variance === 0 ? 'reconciled' : 'discrepancy';
    await this.db.transaction().execute(async (trx) => {
    await trx.insertInto('tech_cash_handoffs').values({
      tenant_id: ctx.tenantId, branch_id: (ctx.branchId as any) ?? null, technician_id: technicianId, business_date: date as any,
      expected_cents: exp.expectedCents, payment_count: exp.paymentCount, counted_cents: countedCents, variance_cents: variance, status,
      reconciled_by_user_id: isUuid(ctx.userId) ? ctx.userId : null, reconciled_at: sql`now()`, notes,
    } as any).onConflict((oc: any) => oc.columns(['tenant_id', 'technician_id', 'business_date']).doUpdateSet({
      expected_cents: exp.expectedCents, payment_count: exp.paymentCount, counted_cents: countedCents, variance_cents: variance, status,
      reconciled_by_user_id: isUuid(ctx.userId) ? ctx.userId : null, reconciled_at: sql`now()`, notes, updated_at: sql`now()`,
    } as any).where(canMoveToSql(TECH_CASH_HANDOFF, status, 'tech_cash_handoffs') as any)).execute();
    await this.fact(trx, ctx, DOMAIN_EVENTS.CASH_HANDOFF_RECONCILED, technicianId, date, { expectedCents: exp.expectedCents, countedCents, varianceCents: variance, status });
    });
    return { status, varianceCents: variance };
  }

  async audit(ctx: TCHCtx, action: string, entityId: string | null, metadata: any): Promise<void> {
    if (!isUuid(ctx.tenantId)) return;
    try { await this.db.insertInto('owner_audit_log').values({ tenant_id: ctx.tenantId, branch_id: (ctx.branchId as any) ?? null, user_id: isUuid(ctx.userId) ? ctx.userId : null, role: ctx.role ?? null, action, entity_type: 'tech_cash_handoff', entity_id: entityId, metadata: JSON.stringify(metadata ?? {}) } as any).execute(); } catch { /* audit never blocks */ }
  }
  async alert(ctx: TCHCtx, severity: 'info' | 'warning' | 'critical', code: string, message: string, meta: any): Promise<void> {
    if (!isUuid(ctx.tenantId)) return;
    try { await this.db.insertInto('owner_alerts').values({ tenant_id: ctx.tenantId, branch_id: (ctx.branchId as any) ?? null, category: 'tech_cash_handoff', severity, status: 'new', title: code, body: message, metadata: JSON.stringify(meta ?? {}) } as any).execute(); } catch { /* alerts never block */ }
  }
}
