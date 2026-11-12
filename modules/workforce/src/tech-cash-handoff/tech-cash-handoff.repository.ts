// tech-cash-handoff.repository.ts — Kysely persistence. Expected cash is derived from confirmed
// Skip-the-Line cash-to-tech payments (cash_payment_confirmations); the hand-off + reconciliation
// lives in tech_cash_handoffs. Audit -> owner_audit_log, discrepancy alert -> owner_alerts.
import { canMoveToSql, defineStateMachine } from '@aipowersalon/database';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';
import { projectionDeliversRealtime } from '@aipowersalon/config';
import { Kysely, sql, type RawBuilder, type SqlBool } from 'kysely';
import { branchTimeZone, tenantTimeZone, type DB } from '@aipowersalon/database';
import { businessDate } from '@aipowersalon/date-time';
import { CashHandoff, CashHandoffDetail, HandoffLine, HandoffStatus, num, isUuid, TechCashHandoffError, TechCashHandoffVersionConflict } from './tech-cash-handoff.dto';
import { withCode } from '@aipowersalon/api-contracts';

/** BUILD_PLAN Phase 12 (#27): tech_cash_handoffs.status — a technician's cash for the day: open, submitted to the front desk
 *  (re-submittable), then counted: reconciled or discrepancy (a recount may flip between them). The upserts below carry
 *  canMoveToSql(TECH_CASH_HANDOFF, to): exactly the moves they have always made. */
export const TECH_CASH_HANDOFF = defineStateMachine({
  name: 'tech_cash_handoff', table: 'tech_cash_handoffs', column: 'status',
  // End-of-Day Cash 17 (Kevin, Nov 12 2026): a reconciled unit is CLOSED — it moves only to 'reopened' (reopen, with the
  // dedicated permission and a reason); a reopened unit is counted again and closes as reconciled / discrepancy.
  states: ['open', 'submitted', 'reconciled', 'discrepancy', 'cancelled', 'reopened'],
  transitions: { open: ['submitted', 'reconciled', 'discrepancy'], submitted: ['submitted', 'reconciled', 'discrepancy'], reconciled: ['reopened'], discrepancy: ['reconciled', 'discrepancy'], cancelled: ['submitted', 'reconciled', 'discrepancy'], reopened: ['reconciled', 'discrepancy'] },
  initial: ['submitted', 'reconciled', 'discrepancy'],
});

export interface TCHCtx { tenantId: string; branchId?: string | null; userId?: string | null; role?: string; permissions?: string[]; }
interface Expected { expectedCents: number; paymentCount: number; lines: HandoffLine[]; }
interface UnitRow { id: string; status: string; version: number | string; counted_cents: number | string | null; expected_cents: number | string; variance_cents: number | string | null }
interface EventRow { id: string; counted_total_cents: number | string | null; variance_cents: number | string | null; drawer_movement_id: string | null }

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
    return r?.id ?? null;
  }
  private async technicianName(ctx: TCHCtx, techId: string): Promise<string> {
    const r = await this.db.selectFrom('technicians').select('full_name').where('tenant_id', '=', ctx.tenantId).where('id', '=', techId).executeTakeFirst().catch(() => undefined);
    return r?.full_name || '';
  }

  /** Cash a technician physically collected on a date (confirmed cash-to-tech only). */
  /** this location (rows with no location belong to the salon as a whole), or the whole salon for a salon-wide session */
  private branchScope(ctx: TCHCtx, col: 'c.branch_id' | 'branch_id'): RawBuilder<SqlBool> {
    if (!(ctx.branchId && isUuid(ctx.branchId))) return sql<SqlBool>`true`;
    return col === 'c.branch_id' ? sql<SqlBool>`(c.branch_id = ${ctx.branchId}::uuid or c.branch_id is null)` : sql<SqlBool>`(branch_id = ${ctx.branchId}::uuid or branch_id is null)`;
  }

  async expectedCashForTech(ctx: TCHCtx, technicianId: string, date: string): Promise<Expected> {
    const rows = await this.db.selectFrom('cash_payment_confirmations as c')
      .leftJoin('tickets as t', 't.id', 'c.ticket_id')
      .leftJoin('customers as cu', 'cu.id', 'c.customer_id')
      .select(['c.ticket_id as ticketId', 'c.amount_cents as amountCents', 'c.confirmed_at as confirmedAt', 't.ticket_number as ticketNumber', 'cu.full_name as customerName'])
      .where('c.tenant_id', '=', ctx.tenantId).where('c.technician_id', '=', technicianId).where('c.status', '=', 'confirmed')
      .where(sql`(c.confirmed_at at time zone ${await this.zone(ctx)})::date = ${date}` as any)   // the branch's date (was the UTC date)
      .where(this.branchScope(ctx, 'c.branch_id'))
      // cash for a ticket that was later voided or removed is not money the technician still holds
      .where(sql<SqlBool>`(t.id is null or (t.removed_at is null and t.status not in ('void', 'voided', 'canceled', 'cancelled')))`)
      // a failed read FAILS — it used to read as $0 expected, and a count then stored a fake overage (audit Nov 3 2026)
      .orderBy('c.confirmed_at', 'asc').execute();
    const lines: HandoffLine[] = rows.map((r) => ({
      ticketId: r.ticketId,
      ticketNumber: r.ticketNumber ? '#' + r.ticketNumber : '#' + String(r.ticketId).slice(0, 6),
      customerName: r.customerName || '',
      amountCents: num(r.amountCents),
      confirmedAt: r.confirmedAt ? new Date(r.confirmedAt).toISOString() : null,
    }));
    return { expectedCents: lines.reduce((a, l) => a + l.amountCents, 0), paymentCount: lines.length, lines };
  }

  private async getRow(ctx: TCHCtx, technicianId: string, date: string): Promise<any | undefined> {
    return this.db.selectFrom('tech_cash_handoffs').selectAll().where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', technicianId).where('business_date', '=', date).executeTakeFirst();
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
      // End-of-Day Cash (Oct 29 2026): the unit's version (optimistic concurrency), its resolution and its drawer transfers
      version: row ? num(row.version ?? 1) : 0,
      resolution: row?.resolved_at ? { reason: row.resolution_reason ?? null, at: new Date(row.resolved_at).toISOString() } : null,
      drawerTransferCents: row ? num(row.drawer_transfer_cents ?? 0) : 0,
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
      .where(this.branchScope(ctx, 'c.branch_id'))
      .where(sql<SqlBool>`not exists (select 1 from tickets tv where tv.tenant_id = c.tenant_id and tv.id = c.ticket_id and (tv.removed_at is not null or tv.status in ('void', 'voided', 'canceled', 'cancelled')))`)
      .groupBy('c.technician_id').execute();
    // this location's hand-offs only (a front desk saw and counted other branches' technician cash — audit Nov 3 2026)
    const rows = await this.db.selectFrom('tech_cash_handoffs').selectAll().where('tenant_id', '=', ctx.tenantId).where('business_date', '=', date).where(this.branchScope(ctx, 'branch_id')).execute();
    const aggMap = new Map(agg.map((a) => [a.technicianId, a]));
    const rowMap = new Map(rows.map((r) => [r.technician_id, r]));
    const ids = Array.from(new Set([...aggMap.keys(), ...rowMap.keys()].filter(Boolean))) as string[];
    if (ids.length === 0) return [];
    const names = await this.db.selectFrom('technicians').select(['id', 'full_name']).where('tenant_id', '=', ctx.tenantId).where('id', 'in', ids).execute().catch(() => []);
    const nameMap = new Map(names.map((n) => [n.id, n.full_name]));
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
      tenant_id: ctx.tenantId, branch_id: ctx.branchId ?? null, technician_id: technicianId, business_date: date,
      expected_cents: exp.expectedCents, payment_count: exp.paymentCount, status: 'submitted',
      submitted_by_user_id: isUuid(ctx.userId) ? ctx.userId : null, submitted_at: sql`now()`,
    }).onConflict((oc: any) => oc.columns(['tenant_id', 'technician_id', 'business_date']).doUpdateSet({
      expected_cents: exp.expectedCents, payment_count: exp.paymentCount,
      // Phase 12 (#27): TECH_CASH_HANDOFF decides — a counted handoff keeps its result when the technician re-submits
      status: sql`CASE WHEN ${canMoveToSql(TECH_CASH_HANDOFF, 'submitted', 'tech_cash_handoffs')} THEN 'submitted' ELSE tech_cash_handoffs.status END`,
      submitted_by_user_id: isUuid(ctx.userId) ? ctx.userId : null, submitted_at: sql`COALESCE(tech_cash_handoffs.submitted_at, now())`, updated_at: sql`now()`,
    })).execute();
    await this.fact(trx, ctx, DOMAIN_EVENTS.CASH_HANDOFF_SUBMITTED, technicianId, date, { expectedCents: exp.expectedCents, paymentCount: exp.paymentCount });
    });
  }

  /**
   * Front desk counts the cash and reconciles. reconciled if exact, else discrepancy (shown as "under review").
   * End-of-Day Cash mandate (Oct 29 2026) §15–§17:
   *   • every count is an immutable EVENT (tech_cash_handoff_events) — a recount never erases the first count;
   *   • `mode: 'add'` is a PARTIAL hand-off: the accepted total becomes the previous total + this amount ($200 + $100
   *     reconcile $300 exactly once); `mode: 'replace'` (default) is a count / recount of the whole unit;
   *   • `expectedVersion` is optimistic concurrency: a second counter who saw an older version is refused (409) instead
   *     of silently overwriting a verified count;
   *   • `idempotencyKey` makes a double tap / retried request ONE event — the second call returns the first result;
   *   • `transferToDrawer` records the accepted cash entering the register as ONE cash_drawer_movements 'in' row linked
   *     to the event (never a sale, never a second tender; idempotent on the event id).
   */
  async reconcile(ctx: TCHCtx, technicianId: string, date: string, exp: { expectedCents: number; paymentCount: number }, countedCents: number, notes: string | null,
    opts: { mode?: 'replace' | 'add'; denominations?: Array<{ denominationCents: number; quantity: number }> | null; expectedVersion?: number | null; idempotencyKey?: string | null; transferToDrawer?: boolean; registerId?: string | null } = {},
  ): Promise<{ status: HandoffStatus; varianceCents: number; countedCents: number; version: number; eventId: string | null; drawerMovementId: string | null; replayed: boolean }> {
    // Raw SQL with explicit columns (tech_cash_handoff_events and the new unit columns are migration 715): every statement
    // carries the tenant literally; the unit row is locked for the whole count.
    const T = ctx.tenantId; const B = isUuid(ctx.branchId) ? ctx.branchId : null; const actor = isUuid(ctx.userId) ? ctx.userId : null;
    return this.db.transaction().execute(async (trx) => {
      if (opts.idempotencyKey) {
        const seen = (await sql<EventRow>`select id, counted_total_cents, variance_cents, drawer_movement_id from tech_cash_handoff_events where tenant_id = ${T} and idempotency_key = ${opts.idempotencyKey}`.execute(trx)).rows[0];
        if (seen) {
          const row = (await sql<UnitRow>`select id, status, version, counted_cents, expected_cents, variance_cents from tech_cash_handoffs where tenant_id = ${T} and technician_id = ${technicianId}::uuid and business_date = ${date}::date`.execute(trx)).rows[0];
          return { status: (row?.status as HandoffStatus) ?? 'open', varianceCents: num(seen.variance_cents), countedCents: num(seen.counted_total_cents), version: num(row?.version ?? 1), eventId: String(seen.id), drawerMovementId: seen.drawer_movement_id ? String(seen.drawer_movement_id) : null, replayed: true };
        }
      }
      const existing = (await sql<UnitRow>`select id, status, version, counted_cents, expected_cents, variance_cents from tech_cash_handoffs where tenant_id = ${T} and technician_id = ${technicianId}::uuid and business_date = ${date}::date for update`.execute(trx)).rows[0];
      if (opts.expectedVersion != null && existing && num(existing.version) !== opts.expectedVersion) {
        throw new TechCashHandoffVersionConflict(num(existing.version), existing.counted_cents != null ? num(existing.counted_cents) : null, String(existing.status));
      }
      if (existing && existing.status === 'reconciled') throw withCode(new TechCashHandoffError('closed', 'This cash count is closed. A manager can reopen it with a reason.', 409), 'HANDOFF_NOT_COUNTABLE');
      const previous = existing && existing.counted_cents != null ? num(existing.counted_cents) : 0;
      const total = opts.mode === 'add' ? previous + countedCents : countedCents;
      const variance = total - exp.expectedCents;
      const status: HandoffStatus = variance === 0 ? 'reconciled' : 'discrepancy';
      const eventType = opts.mode === 'add' ? 'partial' : existing && existing.counted_cents != null ? 'recount' : 'counted';
      const denominations = Array.isArray(opts.denominations) && opts.denominations.length ? JSON.stringify(opts.denominations) : null;
      // a new count of a resolved unit starts a fresh review: the resolution no longer describes these figures
      const up = (await sql<{ id: string; version: number }>`insert into tech_cash_handoffs (tenant_id, branch_id, technician_id, business_date, expected_cents, payment_count, counted_cents, variance_cents, status, reconciled_by_user_id, reconciled_at, notes, denominations_json, version)
          values (${T}, ${B}, ${technicianId}::uuid, ${date}::date, ${exp.expectedCents}, ${exp.paymentCount}, ${total}, ${variance}, ${status}, ${actor}, now(), ${notes}, ${denominations}::jsonb, 1)
        on conflict (tenant_id, technician_id, business_date) do update set expected_cents = excluded.expected_cents, payment_count = excluded.payment_count, counted_cents = excluded.counted_cents, variance_cents = excluded.variance_cents,
          status = excluded.status, reconciled_by_user_id = excluded.reconciled_by_user_id, reconciled_at = now(), notes = excluded.notes, denominations_json = excluded.denominations_json, updated_at = now(),
          version = tech_cash_handoffs.version + 1, resolution_reason = null, resolved_by_user_id = null, resolved_at = null
        where tech_cash_handoffs.tenant_id = ${T} and ${canMoveToSql(TECH_CASH_HANDOFF, status, 'tech_cash_handoffs')}
        returning id, version`.execute(trx)).rows[0];
      if (!up) throw withCode(new TechCashHandoffError('not_countable', 'This hand-off cannot be counted in its current state.', 409), 'HANDOFF_NOT_COUNTABLE');
      const ev = (await sql<{ id: string }>`insert into tech_cash_handoff_events (tenant_id, branch_id, technician_id, business_date, handoff_id, event_type, amount_cents, expected_cents, counted_total_cents, variance_cents, denominations_json, reason, actor_user_id, idempotency_key)
        values (${T}, ${B}, ${technicianId}::uuid, ${date}::date, ${up.id}::uuid, ${eventType}, ${countedCents}, ${exp.expectedCents}, ${total}, ${variance}, ${denominations}::jsonb, ${notes}, ${actor}, ${opts.idempotencyKey ?? null}) returning id`.execute(trx)).rows[0];
      let drawerMovementId: string | null = null;
      if (opts.transferToDrawer && countedCents > 0 && B) {
        // the custody transfer into the register — the drawer's expected cash rises by what was physically received, once
        const reg = opts.registerId || 'main';
        const mv = (await sql<{ id: string }>`insert into cash_drawer_movements (tenant_id, branch_id, register_id, business_date, direction, amount_cents, reason, note, created_by_user_id, source_type, source_id, idempotency_key)
          values (${T}, ${B}, ${reg}, ${date}::date, 'in', ${countedCents}, 'TECH_CASH_HANDOFF', ${('Technician cash hand-off' + (notes ? ': ' + notes : '')).slice(0, 200)}, ${actor}, 'tech_cash_handoff', ${up.id}::uuid, ${'tech_cash_handoff:' + String(ev.id)})
          on conflict (tenant_id, idempotency_key) where idempotency_key is not null do nothing returning id`.execute(trx)).rows[0];
        if (mv) {
          drawerMovementId = String(mv.id);
          await sql`update tech_cash_handoffs set drawer_transfer_cents = drawer_transfer_cents + ${countedCents} where tenant_id = ${T} and id = ${up.id}::uuid`.execute(trx);
          await sql`update tech_cash_handoff_events set drawer_movement_id = ${mv.id}::uuid where tenant_id = ${T} and id = ${ev.id}::uuid`.execute(trx);
          await sql`insert into tech_cash_handoff_events (tenant_id, branch_id, technician_id, business_date, handoff_id, event_type, amount_cents, expected_cents, counted_total_cents, variance_cents, actor_user_id, drawer_movement_id, created_at)
            values (${T}, ${B}, ${technicianId}::uuid, ${date}::date, ${up.id}::uuid, 'drawer_transfer', ${countedCents}, ${exp.expectedCents}, ${total}, ${variance}, ${actor}, ${mv.id}::uuid, clock_timestamp())`.execute(trx);
          await this.fact(trx, ctx, DOMAIN_EVENTS.CASH_DRAWER_MOVEMENT_RECORDED, technicianId, date, { movementId: drawerMovementId, branchId: B, registerId: reg, direction: 'in', amountCents: countedCents, sourceType: 'tech_cash_handoff', sourceId: String(up.id) });
        }
      }
      await this.fact(trx, ctx, DOMAIN_EVENTS.CASH_HANDOFF_RECONCILED, technicianId, date, { expectedCents: exp.expectedCents, countedCents: total, varianceCents: variance, status, mode: opts.mode ?? 'replace', eventId: String(ev.id) });
      return { status, varianceCents: variance, countedCents: total, version: num(up.version), eventId: String(ev.id), drawerMovementId, replayed: false };
    });
  }

  /**
   * A manager resolves a discrepancy (mandate §17 "Under Review → Resolved"): the ORIGINAL expected / counted / variance
   * figures are kept; the resolution (reason, approver, time) is recorded on the unit and as an event, and the unit moves
   * discrepancy → reconciled (the lifecycle's own transition) so it is counted as reconciled — labelled "resolved".
   */
  async resolve(ctx: TCHCtx, technicianId: string, date: string, reason: string, expectedVersion: number | null): Promise<{ version: number; varianceCents: number }> {
    const T = ctx.tenantId; const B = isUuid(ctx.branchId) ? ctx.branchId : null; const actor = isUuid(ctx.userId) ? ctx.userId : null;
    return this.db.transaction().execute(async (trx) => {
      const row = (await sql<UnitRow>`select id, status, version, counted_cents, expected_cents, variance_cents from tech_cash_handoffs where tenant_id = ${T} and technician_id = ${technicianId}::uuid and business_date = ${date}::date for update`.execute(trx)).rows[0];
      if (!row) throw withCode(new TechCashHandoffError('not_found', 'That cash hand-off could not be found.', 404), 'HANDOFF_NOT_FOUND');
      if (expectedVersion != null && num(row.version) !== expectedVersion) throw new TechCashHandoffVersionConflict(num(row.version), row.counted_cents != null ? num(row.counted_cents) : null, String(row.status));
      const notReview = () => withCode(new TechCashHandoffError('not_under_review', 'Only a hand-off under review can be resolved.', 409), 'HANDOFF_NOT_UNDER_REVIEW');
      if (row.status !== 'discrepancy') throw notReview();
      const up = (await sql<{ version: number }>`update tech_cash_handoffs set status = 'reconciled', resolution_reason = ${reason}, resolved_by_user_id = ${actor}, resolved_at = now(), version = version + 1, updated_at = now()
        where tenant_id = ${T} and id = ${row.id}::uuid and ${canMoveToSql(TECH_CASH_HANDOFF, 'reconciled', 'tech_cash_handoffs')} returning version`.execute(trx)).rows[0];
      if (!up) throw notReview();
      await sql`insert into tech_cash_handoff_events (tenant_id, branch_id, technician_id, business_date, handoff_id, event_type, amount_cents, expected_cents, counted_total_cents, variance_cents, reason, actor_user_id)
        values (${T}, ${B}, ${technicianId}::uuid, ${date}::date, ${row.id}::uuid, 'resolved', ${row.counted_cents}, ${row.expected_cents}, ${row.counted_cents}, ${row.variance_cents}, ${reason}, ${actor})`.execute(trx);
      await this.fact(trx, ctx, DOMAIN_EVENTS.CASH_HANDOFF_RECONCILED, technicianId, date, { expectedCents: num(row.expected_cents), countedCents: num(row.counted_cents), varianceCents: num(row.variance_cents), status: 'reconciled', resolved: true });
      return { version: num(up.version), varianceCents: num(row.variance_cents) };
    });
  }

  /**
   * End-of-Day Cash 17 (Kevin, Nov 12 2026): reopen a CLOSED (reconciled) unit. Nothing is erased: expected / counted /
   * variance and any resolution stay on the unit and the 'reopened' event records them as they were; the unit says who
   * reopened it, when and why (reopen_count counts every reopen). The next count recomputes the expected cash from the source
   * payments and closes it again. Returns the before / after the audit row keeps.
   */
  async reopen(ctx: TCHCtx, technicianId: string, date: string, reason: string, expectedVersion: number | null) {
    const T = ctx.tenantId; const B = isUuid(ctx.branchId) ? ctx.branchId : null; const actor = isUuid(ctx.userId) ? ctx.userId : null;
    type Row = UnitRow & { resolution_reason: string | null; resolved_at: string | null; reconciled_at: string | null; reopen_count: number | string };
    return this.db.transaction().execute(async (trx) => {
      const row = (await sql<Row>`select id, status, version, counted_cents, expected_cents, variance_cents, resolution_reason, resolved_at, reconciled_at, reopen_count from tech_cash_handoffs
        where tenant_id = ${T} and technician_id = ${technicianId}::uuid and business_date = ${date}::date and (${B}::uuid is null or branch_id is null or branch_id = ${B}::uuid) for update`.execute(trx)).rows[0];
      if (!row) throw withCode(new TechCashHandoffError('not_found', 'That cash hand-off could not be found.', 404), 'HANDOFF_NOT_FOUND');
      if (expectedVersion != null && num(row.version) !== expectedVersion) throw new TechCashHandoffVersionConflict(num(row.version), row.counted_cents != null ? num(row.counted_cents) : null, String(row.status));
      const notClosed = () => withCode(new TechCashHandoffError('not_closed', 'Only a closed (reconciled) cash count can be reopened.', 409), 'INVALID_STATE_TRANSITION');
      if (row.status !== 'reconciled') throw notClosed();
      const up = (await sql<{ version: number }>`update tech_cash_handoffs set status = 'reopened', reopened_at = now(), reopened_by_user_id = ${actor}, reopen_reason = ${reason}, reopen_count = reopen_count + 1,
          version = version + 1, updated_at = now()
        where tenant_id = ${T} and id = ${row.id}::uuid and ${canMoveToSql(TECH_CASH_HANDOFF, 'reopened', 'tech_cash_handoffs')} returning version`.execute(trx)).rows[0];
      if (!up) throw notClosed();
      const ev = (await sql<{ id: string }>`insert into tech_cash_handoff_events (tenant_id, branch_id, technician_id, business_date, handoff_id, event_type, amount_cents, expected_cents, counted_total_cents, variance_cents, reason, actor_user_id)
        values (${T}, ${B}, ${technicianId}::uuid, ${date}::date, ${row.id}::uuid, 'reopened', ${row.counted_cents}, ${row.expected_cents}, ${row.counted_cents}, ${row.variance_cents}, ${reason}, ${actor}) returning id`.execute(trx)).rows[0];
      const before = { status: String(row.status), expectedCents: num(row.expected_cents), countedCents: row.counted_cents == null ? null : num(row.counted_cents), varianceCents: row.variance_cents == null ? null : num(row.variance_cents),
        resolutionReason: row.resolution_reason ?? null, closedAt: row.reconciled_at ? new Date(row.reconciled_at).toISOString() : null, version: num(row.version) };
      const after = { ...before, status: 'reopened', version: num(up.version), reopenReason: reason, reopenCount: num(row.reopen_count) + 1 };
      return { before, after, eventId: String(ev.id) };
    });
  }

  async audit(ctx: TCHCtx, action: string, entityId: string | null, metadata: any): Promise<void> {
    if (!isUuid(ctx.tenantId)) return;
    try { await this.db.insertInto('owner_audit_log').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId ?? null, user_id: isUuid(ctx.userId) ? ctx.userId : null, role: ctx.role ?? null, action, entity_type: 'tech_cash_handoff', entity_id: entityId, metadata: JSON.stringify(metadata ?? {}) }).execute(); } catch { /* audit never blocks */ }
  }
  async alert(ctx: TCHCtx, severity: 'info' | 'warning' | 'critical', code: string, message: string, meta: any): Promise<void> {
    if (!isUuid(ctx.tenantId)) return;
    try { await this.db.insertInto('owner_alerts').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId ?? null, category: 'tech_cash_handoff', severity, status: 'new', title: code, body: message, metadata: JSON.stringify(meta ?? {}) }).execute(); } catch { /* alerts never block */ }
  }
}
