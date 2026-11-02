// membership-compensation.service.ts — books the technician's membership-service commission for a ticket. Reads the
// ticket's immutable redemptions, skips any line already booked (idempotent on re-run), maps each via the pure core, and
// appends positive adjustments. Intended to be invoked at checkout finalize for the ticket; safe to call more than once.
import type { MembershipCompContext, MembershipCompRepositoryPort } from './membership-compensation.repository';
import type { MembershipCompEntry } from './membership-compensation-core';
import { redemptionToCompEntry } from './membership-compensation-core';

export class ValidationError extends Error {}

export interface BookMembershipCompResult {
  ticketId: string; booked: number; skipped: number; totalTechCents: number;
  lines: Array<{ serviceLineId: string | null; technicianId: string; amountCents: number }>;
}

export class MembershipCompService {
  constructor(private readonly repo: MembershipCompRepositoryPort) {}

  async bookTicketMembershipComp(ctx: MembershipCompContext, ticketId: string): Promise<BookMembershipCompResult> {
    if (!ticketId) throw new ValidationError('ticketId is required');
    const reds = await this.repo.redemptionsForTicketComp(ctx, ticketId);
    const already = await this.repo.bookedLineIds(ctx, ticketId);

    const entries: MembershipCompEntry[] = [];
    let skipped = 0;
    for (const r of reds) {
      if (r.serviceLineId && already.has(r.serviceLineId)) { skipped++; continue; } // already booked → idempotent skip
      const entry = redemptionToCompEntry(r);
      if (!entry) { skipped++; continue; }                                          // no tech / no booked earnings
      entries.push(entry);
    }

    const booked = entries.length ? await this.repo.appendAdjustments(ctx, ticketId, entries) : 0;
    const totalTechCents = entries.reduce((a, e) => a + e.amountCents, 0);
    return { ticketId, booked, skipped, totalTechCents, lines: entries.map((e) => ({ serviceLineId: e.serviceLineId, technicianId: e.technicianId, amountCents: e.amountCents })) };
  }
}
