/** compensation-adjustments.repository.ts — append-only persistence + reads for the adjustment ledger (§21/§24). */
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { COUNTED_ADJUSTMENT_STATUSES, type AdjustmentEntry } from './compensation-adjustments';

export class CompensationAdjustmentsRepository {
  constructor(private readonly db: Kysely<DB>) {}

  /** Append ledger entries (never updates an existing row — corrections are new rows). */
  async append(tenantId: string, branchId: string | null, entries: AdjustmentEntry[]): Promise<number> {
    if (entries.length === 0) return 0;
    const res = await (this.db as any).insertInto('compensation_adjustments').values(entries.map((e) => ({
      tenant_id: tenantId, branch_id: branchId, technician_id: e.technicianId, ticket_id: e.ticketId,
      service_line_id: e.serviceLineId, period_id: e.periodId, category: e.category, amount_cents: e.amountCents,
      reason: e.reason, status: e.status, source: e.source, targets_future_period: e.targetsFuturePeriod,
      requested_by: e.requestedBy, approved_by: e.approvedBy, refund_payment_id: e.refundPaymentId ?? null,
    }))).execute().catch(() => []);
    return Array.isArray(res) ? entries.length : 0;
  }

  /** Net counted (posted/approved/applied) adjustment cents for a technician in a HALF-OPEN period [from, to). Wave 2
   *  (§54/§129): an entry routed to a specific period (period_id) counts in THAT period only; an unrouted entry counts in
   *  the period its created_at falls in. */
  async netForTechnicianPeriod(tenantId: string, technicianId: string, fromIso: string, toIso: string, periodId?: string | null): Promise<number> {
    const b = await this.breakdownForTechnicianPeriod(tenantId, technicianId, fromIso, toIso, periodId);
    return b.otherCents + b.bonusCents - b.deductionCents;
  }

  /** The counted ledger for a technician + period, split into bonus (§62), deduction (§59, returned POSITIVE) and the rest. */
  async breakdownForTechnicianPeriod(tenantId: string, technicianId: string, fromIso: string, toIso: string, periodId?: string | null): Promise<{ bonusCents: number; deductionCents: number; otherCents: number }> {
    const rows: any[] = await (this.db as any).selectFrom('compensation_adjustments')
      .select(['amount_cents', 'category']).where('tenant_id', '=', tenantId).where('technician_id', '=', technicianId)
      .where('status', 'in', [...COUNTED_ADJUSTMENT_STATUSES])
      .where((eb: any) => {
        // no period given (earnings windows, legacy callers): every counted entry created in the window, as before
        if (!periodId) return eb.and([eb('created_at', '>=', fromIso), eb('created_at', '<', toIso)]);
        const unrouted = eb.and([eb('period_id', 'is', null), eb('created_at', '>=', fromIso), eb('created_at', '<', toIso)]);
        return eb.or([eb('period_id', '=', periodId), unrouted]);
      })
      .execute();
    let bonusCents = 0, deductionCents = 0, otherCents = 0;
    for (const r of rows) {
      const a = Number(r.amount_cents || 0);
      if (r.category === 'bonus') bonusCents += a; else if (r.category === 'deduction') deductionCents += -a; else otherCents += a;
    }
    return { bonusCents, deductionCents, otherCents };
  }

  /** Exceptions awaiting review (chargebacks, large adjustments) for the owner queue (§35). */
  async pendingReview(tenantId: string): Promise<any[]> {
    return (this.db as any).selectFrom('compensation_adjustments').selectAll()
      .where('tenant_id', '=', tenantId).where('status', 'in', ['pending', 'pending_review'])
      .orderBy('created_at', 'desc').execute().catch(() => []);
  }
}
