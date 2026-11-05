// membership-compensation.kysely.repository.ts — Postgres adapter. Reads the immutable redemption snapshots for a ticket
// and appends positive technician adjustments into compensation_adjustments (status 'applied' so payroll picks them up).
// It never edits ticket_compensation_snapshots and never recomputes a split — the techCents are frozen on the redemption.
import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { MembershipCompRepositoryPort, MembershipCompContext } from './membership-compensation.repository';
import type { MembershipCompEntry, RedemptionForComp } from './membership-compensation-core';
import { MEMBERSHIP_COMP_REASON_PREFIX } from './membership-compensation-core';

export class KyselyMembershipCompRepository implements MembershipCompRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}

  async redemptionsForTicketComp(ctx: MembershipCompContext, ticketId: string): Promise<RedemptionForComp[]> {
    const r = await sql<{ id: string; service_line_id: string | null; technician_id: string | null; commission_basis_snapshot: string | null }>`
      select id, service_line_id, technician_id, commission_basis_snapshot
      from membership_redemptions where ticket_id = ${ticketId} and tenant_id = ${ctx.tenantId}`.execute(this.db);
    return r.rows.map((x) => ({ redemptionId: x.id, serviceLineId: x.service_line_id, technicianId: x.technician_id, commissionBasisSnapshot: x.commission_basis_snapshot }));
  }

  async bookedLineIds(ctx: MembershipCompContext, ticketId: string): Promise<Set<string>> {
    const like = `${MEMBERSHIP_COMP_REASON_PREFIX}%`;
    const r = await sql<{ service_line_id: string | null }>`
      select service_line_id from compensation_adjustments
      where ticket_id = ${ticketId} and tenant_id = ${ctx.tenantId} and service_line_id is not null and reason like ${like}`.execute(this.db);
    const s = new Set<string>();
    for (const row of r.rows) if (row.service_line_id) s.add(row.service_line_id);
    return s;
  }

  /**
   * Append the entries — once per (ticket, service line). Phase 15 round 3: the service skips lines bookedLineIds() already
   * shows, but two runs at once (the POS / terminal post-payment work and a manual "book" retry) both read "nothing booked"
   * and both appended: the technician was paid the membership commission twice. Now the appends for one ticket run under
   * a per-ticket transaction lock and each line is inserted only if no membership-commission row exists for it yet.
   * Returns the rows actually written.
   */
  async appendAdjustments(ctx: MembershipCompContext, ticketId: string, entries: MembershipCompEntry[]): Promise<number> {
    if (entries.length === 0) return 0;
    const like = `${MEMBERSHIP_COMP_REASON_PREFIX}%`;
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${'membership-comp:' + ctx.tenantId + ':' + ticketId}))`.execute(trx);
      let written = 0;
      for (const e of entries) {
        const r = await sql`
          insert into compensation_adjustments
            (tenant_id, branch_id, technician_id, ticket_id, service_line_id, period_id, category, amount_cents, reason, status, source, targets_future_period, requested_by, approved_by)
          select ${ctx.tenantId}, ${ctx.branchId || null}, ${e.technicianId}, ${ticketId}, ${e.serviceLineId}, ${null}, ${'commission_correction'}, ${e.amountCents}, ${e.reason}, ${'applied'}, ${'manual'}, ${false}, ${ctx.userId || null}, ${ctx.userId || null}
          where ${e.serviceLineId}::uuid is null or not exists (
            select 1 from compensation_adjustments
            where tenant_id = ${ctx.tenantId} and ticket_id = ${ticketId} and service_line_id = ${e.serviceLineId}::uuid and reason like ${like})
        `.execute(trx);
        written += Number(r.numAffectedRows ?? 0);
      }
      return written;
    });
  }
}
