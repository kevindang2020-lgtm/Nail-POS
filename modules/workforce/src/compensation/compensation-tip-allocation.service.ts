/**
 * compensation-tip-allocation.service.ts — MANUAL per-technician tip allocation for one ticket
 * (POST /pos/tickets/:id/tip-allocation, permission tips.adjust). Payroll mandate §22–§28 (explicit allocations, SUM ==
 * tip, explicit split wins, locked after payment → corrections are a Tip Adjustment with reason/actor/audit).
 *
 * ticket_tip_allocations is the ONE tip store (the engine writes the computed split there on payment; this endpoint
 * writes an explicit split). When the ticket is already PAID the immutable snapshot keeps its original tip rows — the
 * correction is recorded as signed `tip_correction` ledger entries (posted) so period earnings move WITHOUT rewriting
 * history (§14/§21). When the ticket is not yet paid, the rows simply govern the payment-time snapshot
 * (customer-directed allocation passed to the engine). Ported from the other chat (Oct 12 2026).
 */
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { AuditService } from '@aipowersalon/audit';
import { KyselyCompensationPorts } from './compensation.kysely.ports';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export class TipAllocationError extends Error { constructor(msg: string, public status = 400, public code: 'TIP_ALLOCATION_INVALID' | 'TIP_ALLOCATION_LOCKED' | 'TIP_ADJUSTMENT_INVALID' | null = null) { super(msg); this.name = 'TipAllocationError'; } }

export interface TipAllocationCtx { tenantId: string; branchId: string | null; userId: string; role: string; permissions: string[] }
export interface TipAllocationInput { allocations: { technicianId: string; tipCents: number }[]; reason?: string }

/** PURE: validate allocations against the ticket tip. */
export function validateTipAllocation(ticketTipCents: number, allocations: { technicianId: string; tipCents: number }[] | undefined, eligibleTechIds: Set<string>): string[] {
  const errors: string[] = [];
  if (!Array.isArray(allocations) || allocations.length === 0) return ['allocations[] is required.'];
  const seen = new Set<string>();
  let sum = 0;
  for (const a of allocations) {
    if (!a || typeof a.technicianId !== 'string' || !a.technicianId) { errors.push('technicianId is required.'); continue; }
    if (seen.has(a.technicianId)) errors.push(`Technician ${a.technicianId} appears twice.`);
    seen.add(a.technicianId);
    if (!Number.isInteger(a.tipCents) || a.tipCents < 0) errors.push(`tipCents must be a non-negative integer (technician ${a.technicianId}).`);
    if (eligibleTechIds.size && !eligibleTechIds.has(a.technicianId)) errors.push(`Technician ${a.technicianId} did not work this ticket.`);
    sum += Number.isInteger(a.tipCents) ? a.tipCents : 0;
  }
  if (sum !== ticketTipCents) errors.push(`Allocations total ${sum} but the ticket tip is ${ticketTipCents}.`);
  return errors;
}

/** PURE: the signed tip_correction delta per technician for a PAID ticket — target allocation minus what the snapshot
 *  already credits, net of earlier manual corrections. Σ deltas == 0 when the target sums to the snapshot tip (§26). */
export function tipCorrectionDeltas(
  target: { technicianId: string; tipCents: number }[], snapped: Map<string, number>, corrected: Map<string, number>,
): { technicianId: string; deltaCents: number }[] {
  const techs = new Set<string>([...snapped.keys(), ...target.map((a) => a.technicianId)]);
  const out: { technicianId: string; deltaCents: number }[] = [];
  for (const id of techs) {
    const want = target.find((a) => a.technicianId === id)?.tipCents ?? 0;
    const current = (snapped.get(id) ?? 0) + (corrected.get(id) ?? 0);
    const delta = want - current;
    if (delta !== 0) out.push({ technicianId: id, deltaCents: delta });
  }
  return out;
}

export class TipAllocationService {
  constructor(private readonly db: Kysely<DB> | null, private readonly audit?: AuditService) {}

  /** The ticket's current split + every technician who worked it (the POS re-split editor). Tenant-scoped. */
  async current(ctx: TipAllocationCtx, ticketId: string): Promise<{ ticketId: string; tipCents: number; status: string; locked: boolean; allocations: { technicianId: string; name: string | null; tipCents: number }[] }> {
    if (!this.db) throw new TipAllocationError('Tip allocation is unavailable (no database).', 503);
    // Security Deep Scan §75: the ticket must be in the session's location (another location's manager finds nothing)
    let tq = this.db.selectFrom('tickets').select(['id', 'tip_cents', 'status']).where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId);
    if (ctx.branchId) tq = tq.where('branch_id', '=', ctx.branchId);
    const t: any = await tq.executeTakeFirst();
    if (!t) throw withCode(new TipAllocationError('Ticket not found', 404), 'TICKET_NOT_FOUND');
    const lines: any[] = await this.db.selectFrom('ticket_service_lines').select(['technician_id']).where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId).where('removed_at', 'is', null).execute();
    const helpers: any[] = await this.db.selectFrom('ticket_service_line_allocations').select(['technician_id']).where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId).execute().catch(() => []);
    const rows: any[] = await this.db.selectFrom('ticket_tip_allocations').select(['technician_id', 'tip_cents']).where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId).execute();
    const ids = [...new Set<string>([...lines.map((l) => l.technician_id), ...helpers.map((h) => h.technician_id), ...rows.map((r) => r.technician_id)].filter(Boolean))];
    const names: any[] = ids.length ? await this.db.selectFrom('technicians').select(['id', 'full_name']).where('tenant_id', '=', ctx.tenantId).where('id', 'in', ids).execute() : [];
    const nameOf = new Map<string, string>(names.map((n) => [n.id, n.full_name]));
    const amt = new Map<string, number>(rows.map((r) => [r.technician_id, Number(r.tip_cents || 0)]));
    return { ticketId, tipCents: Math.max(0, Math.round(Number(t.tip_cents || 0))), status: t.status, locked: t.status === 'paid',
      allocations: ids.map((id) => ({ technicianId: id, name: nameOf.get(id) ?? null, tipCents: amt.get(id) ?? 0 })) };
  }

  async allocate(ctx: TipAllocationCtx, ticketId: string, input: TipAllocationInput): Promise<{ ok: true; ticketId: string; tipCents: number; allocations: { technicianId: string; tipCents: number }[]; corrections: number }> {
    if (!this.db) throw new TipAllocationError('Tip allocation is unavailable (no database).', 503);
    let tq = this.db.selectFrom('tickets').select(['id', 'tip_cents', 'status', 'branch_id'])
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId);
    if (ctx.branchId) tq = tq.where('branch_id', '=', ctx.branchId);   // §75: same location only (write path)
    const t: any = await tq.executeTakeFirst();
    if (!t) throw withCode(new TipAllocationError('Ticket not found', 404), 'TICKET_NOT_FOUND');
    const tip = Math.max(0, Math.round(Number(t.tip_cents || 0)));
    const lines: any[] = await this.db.selectFrom('ticket_service_lines').select(['technician_id'])
      .where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId).where('removed_at', 'is', null).execute();
    const allocRows: any[] = await this.db.selectFrom('ticket_service_line_allocations').select(['technician_id'])
      .where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId).execute().catch(() => []);
    const eligible = new Set<string>([...lines.map((l) => l.technician_id).filter(Boolean), ...allocRows.map((a) => a.technician_id)]);
    const errors = validateTipAllocation(tip, input?.allocations, eligible);
    if (errors.length) throw new TipAllocationError(errors.join(' '), 400, 'TIP_ALLOCATION_INVALID');

    const before: any[] = await this.db.selectFrom('ticket_tip_allocations').select(['technician_id', 'tip_cents'])
      .where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId).execute();
    const prev = new Map<string, number>(before.map((r) => [r.technician_id, Number(r.tip_cents || 0)]));
    // §28 tip lock (wave 2): once the payment is confirmed the allocation is LOCKED — a CHANGE is a recorded Tip Adjustment
    // with a reason, never a silent re-split. (Before payment the split is still being set up and needs no reason; sending
    // the split that is already on file changes nothing and needs none either.)
    const unchanged = input.allocations.length === prev.size && input.allocations.every((a) => prev.get(a.technicianId) === a.tipCents);
    if (t.status === 'paid' && !unchanged && String(input?.reason ?? '').trim().length < 3) {
      throw new TipAllocationError('This ticket is paid, so its tip is locked. Give a reason to record a tip adjustment.', 409, 'TIP_ALLOCATION_LOCKED');
    }

    // PAID ticket: the snapshot is immutable — the delta per technician becomes posted tip_correction ledger entries,
    // written in the SAME transaction as the allocation rows so the store and the ledger can never disagree.
    const paid = t.status === 'paid';
    let corrections = 0;
    const routing = paid ? await new KyselyCompensationPorts(this.db).lockedPeriodRouting({ tenantId: ctx.tenantId, branchId: t.branch_id ?? ctx.branchId }, ticketId).catch(() => null) : null;
    await this.db.transaction().execute(async (trx: any) => {
      await trx.deleteFrom('ticket_tip_allocations').where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId).execute();
      await trx.insertInto('ticket_tip_allocations').values(input.allocations.map((a) => ({
        tenant_id: ctx.tenantId, branch_id: t.branch_id ?? ctx.branchId, ticket_id: ticketId, technician_id: a.technicianId, tip_cents: a.tipCents,
      }))).execute();
      if (!paid) return;
      const snap: any[] = await trx.selectFrom('ticket_compensation_snapshots').select(['technician_id', 'card_tip_cents', 'cash_tip_cents'])
        .where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId).execute().catch(() => []);
      if (!snap.length) return;
      const snapped = new Map<string, number>();
      for (const r of snap) if (r.technician_id) snapped.set(r.technician_id, (snapped.get(r.technician_id) ?? 0) + Number(r.card_tip_cents || 0) + Number(r.cash_tip_cents || 0));
      const priorCorr: any[] = await trx.selectFrom('compensation_adjustments').select(['technician_id', 'amount_cents'])
        .where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId).where('category', '=', 'tip_correction').where('source', '=', 'manual')
        .where('status', 'in', ['posted', 'approved', 'applied']).execute().catch(() => []);
      const corrected = new Map<string, number>();
      for (const r of priorCorr) if (r.technician_id) corrected.set(r.technician_id, (corrected.get(r.technician_id) ?? 0) + Number(r.amount_cents || 0));
      const entries = tipCorrectionDeltas(input.allocations, snapped, corrected).map((d) => ({
        tenant_id: ctx.tenantId, branch_id: t.branch_id ?? ctx.branchId, technician_id: d.technicianId, ticket_id: ticketId, service_line_id: null, period_id: null,
        category: 'tip_correction', amount_cents: d.deltaCents, reason: (input.reason || 'Manual tip allocation').slice(0, 500), status: 'posted', source: 'manual',
        targets_future_period: !!routing?.locked, requested_by: ctx.userId, approved_by: ctx.userId,
        // §54/§129: a ticket whose pay period is already approved / paid → the correction lands in the next open period
        ...(routing?.locked ? { period_id: routing.targetPeriodId, original_period_id: routing.originalPeriodId } : {}), reason_code: 'tip_adjustment',
      }));
      if (entries.length) { await trx.insertInto('compensation_adjustments').values(entries).execute(); corrections = entries.length; }
    });

    await this.audit?.record(
      { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role },
      { module: 'compensation', action: 'ticket.tip_allocation_set', resourceType: 'ticket', resourceId: ticketId, severity: 'medium',
        metadata: { tipCents: tip, before: [...prev].map(([technicianId, tipCents]) => ({ technicianId, tipCents })), after: input.allocations, reason: input.reason ?? null, paid, corrections } },
    );
    return { ok: true, ticketId, tipCents: tip, allocations: input.allocations, corrections };
  }

  /** D15/D19 gaps (Nov 5 2026): a FREE-FORM tip adjustment on a PAID ticket — one technician, a signed amount, a reason. It is a
   *  compensating posted `tip_correction` ledger entry (the collected tip and the card charge never change; a real card refund
   *  goes through the processor). The technician must have worked the ticket; a negative amount can never take her earned tip
   *  on this ticket below zero; a pay period already approved / paid routes it to the next open one. One transaction, the
   *  ticket row locked so two adjustments cannot both pass the floor check; the route needs an Idempotency-Key. */
  async adjust(ctx: TipAllocationCtx, ticketId: string, input: { technicianId: string; amountCents: number; reason: string }): Promise<{ ok: true; ticketId: string; technicianId: string; amountCents: number; earnedCents: number; adjustmentId: string; routedToNextPeriod: boolean }> {
    if (!this.db) throw withCode(new TipAllocationError('Tip allocation is unavailable (no database).', 503), 'SERVICE_UNAVAILABLE');
    const amount = Number(input?.amountCents);
    const reason = String(input?.reason ?? '').trim();
    if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 100000) throw new TipAllocationError('Enter an adjustment between -$1,000 and $1,000, not zero.', 400, 'TIP_ADJUSTMENT_INVALID');
    if (reason.length < 3) throw new TipAllocationError('Give a reason for the tip adjustment.', 400, 'TIP_ADJUSTMENT_INVALID');
    const db = this.db;
    let tq = db.selectFrom('tickets').select(['id', 'status', 'branch_id']).where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId);
    if (ctx.branchId) tq = tq.where('branch_id', '=', ctx.branchId);
    const t0: any = await tq.executeTakeFirst();
    if (!t0) throw withCode(new TipAllocationError('Ticket not found', 404), 'TICKET_NOT_FOUND');
    if (t0.status !== 'paid') throw new TipAllocationError('A tip adjustment is for a paid ticket. Before payment, change the tip split instead.', 409, 'TIP_ADJUSTMENT_INVALID');
    const routing = await new KyselyCompensationPorts(db).lockedPeriodRouting({ tenantId: ctx.tenantId, branchId: t0.branch_id ?? ctx.branchId }, ticketId);
    const out = await db.transaction().execute(async (trx: any) => {
      await trx.selectFrom('tickets').select('id').where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).forUpdate().executeTakeFirst();
      const worked = await trx.selectFrom('ticket_service_lines').select('technician_id').where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId)
        .where('removed_at', 'is', null).where('technician_id', '=', input.technicianId).executeTakeFirst();
      const helped = worked ? null : await trx.selectFrom('ticket_tip_allocations').select('technician_id').where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId).where('technician_id', '=', input.technicianId).executeTakeFirst();
      if (!worked && !helped) throw new TipAllocationError('That technician did not work this ticket.', 400, 'TIP_ADJUSTMENT_INVALID');
      const snap: any[] = await trx.selectFrom('ticket_compensation_snapshots').select(['card_tip_cents', 'cash_tip_cents']).where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId).where('technician_id', '=', input.technicianId).execute();
      const alloc: any = snap.length ? null : await trx.selectFrom('ticket_tip_allocations').select('tip_cents').where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId).where('technician_id', '=', input.technicianId).executeTakeFirst();
      const base = snap.length ? snap.reduce((a, r) => a + Number(r.card_tip_cents || 0) + Number(r.cash_tip_cents || 0), 0) : Number(alloc?.tip_cents || 0);
      const prior: any[] = await trx.selectFrom('compensation_adjustments').select('amount_cents').where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId)
        .where('technician_id', '=', input.technicianId).where('category', '=', 'tip_correction').where('status', 'in', ['posted', 'approved', 'applied']).execute();
      const earned = base + prior.reduce((a, r) => a + Number(r.amount_cents || 0), 0);
      if (earned + amount < 0) throw new TipAllocationError(`That would take this technician's tip on the ticket below zero (now ${earned} cents).`, 409, 'TIP_ADJUSTMENT_INVALID');
      const row: any = await trx.insertInto('compensation_adjustments').values({
        tenant_id: ctx.tenantId, branch_id: t0.branch_id ?? ctx.branchId, technician_id: input.technicianId, ticket_id: ticketId, service_line_id: null, period_id: null,
        category: 'tip_correction', amount_cents: amount, reason: reason.slice(0, 500), status: 'posted', source: 'manual',
        targets_future_period: !!routing?.locked, requested_by: ctx.userId, approved_by: ctx.userId,
        ...(routing?.locked ? { period_id: routing.targetPeriodId, original_period_id: routing.originalPeriodId } : {}), reason_code: 'tip_adjustment_manual',
      }).returning('id').executeTakeFirst();
      return { id: String(row.id), earned: earned + amount };
    });
    await this.audit?.record(
      { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role },
      { module: 'compensation', action: 'ticket.tip_adjusted', resourceType: 'ticket', resourceId: ticketId, severity: 'medium',
        metadata: { technicianId: input.technicianId, amountCents: amount, reason, adjustmentId: out.id, earnedCents: out.earned, routedToNextPeriod: !!routing?.locked } },
    );
    return { ok: true, ticketId, technicianId: input.technicianId, amountCents: amount, earnedCents: out.earned, adjustmentId: out.id, routedToNextPeriod: !!routing?.locked };
  }
}
