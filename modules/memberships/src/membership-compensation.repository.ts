// membership-compensation.repository.ts — port + in-memory adapter for booking membership-redemption commission into the
// existing compensation_adjustments ledger (the same ledger payroll already aggregates). The membership module never
// recomputes the split; it reads the frozen techCents from each redemption and appends a positive adjustment.
import type { MembershipCompEntry, RedemptionForComp } from './membership-compensation-core';
import { MEMBERSHIP_COMP_REASON_PREFIX } from './membership-compensation-core';

export interface MembershipCompContext { tenantId: string; branchId: string; userId: string; role: string; permissions: string[] }

/** A booked adjustment row shape (subset of compensation_adjustments) the in-memory adapter records. */
export interface BookedAdjustment {
  tenantId: string; branchId: string | null; technicianId: string; ticketId: string; serviceLineId: string | null;
  category: string; amountCents: number; reason: string; status: string; source: string; requestedBy: string | null; approvedBy: string | null;
}

export interface MembershipCompRepositoryPort {
  redemptionsForTicketComp(ctx: MembershipCompContext, ticketId: string): Promise<RedemptionForComp[]>;
  bookedLineIds(ctx: MembershipCompContext, ticketId: string): Promise<Set<string>>;
  appendAdjustments(ctx: MembershipCompContext, ticketId: string, entries: MembershipCompEntry[]): Promise<number>;
}

export class InMemoryMembershipCompRepository implements MembershipCompRepositoryPort {
  private redemptions = new Map<string, RedemptionForComp[]>(); // ticketId -> redemptions
  readonly adjustments: BookedAdjustment[] = [];

  seedRedemption(ticketId: string, r: RedemptionForComp) {
    const list = this.redemptions.get(ticketId) || [];
    list.push(r);
    this.redemptions.set(ticketId, list);
  }

  async redemptionsForTicketComp(_c: MembershipCompContext, ticketId: string): Promise<RedemptionForComp[]> {
    return this.redemptions.get(ticketId) || [];
  }

  async bookedLineIds(_c: MembershipCompContext, ticketId: string): Promise<Set<string>> {
    const s = new Set<string>();
    for (const a of this.adjustments) {
      if (a.ticketId === ticketId && a.serviceLineId && a.reason.startsWith(MEMBERSHIP_COMP_REASON_PREFIX)) s.add(a.serviceLineId);
    }
    return s;
  }

  async appendAdjustments(ctx: MembershipCompContext, ticketId: string, entries: MembershipCompEntry[]): Promise<number> {
    for (const e of entries) {
      this.adjustments.push({
        tenantId: ctx.tenantId, branchId: ctx.branchId || null, technicianId: e.technicianId, ticketId,
        serviceLineId: e.serviceLineId, category: 'commission_correction', amountCents: e.amountCents, reason: e.reason,
        status: 'applied', source: 'manual', requestedBy: ctx.userId, approvedBy: ctx.userId,
      });
    }
    return entries.length;
  }
}
