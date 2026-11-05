import { describe, it, expect, beforeEach } from 'vitest';
import { MembershipCompService, ValidationError } from './membership-compensation.service';
import { InMemoryMembershipCompRepository, type MembershipCompContext } from './membership-compensation.repository';

const ctx: MembershipCompContext = { tenantId: 'T1', branchId: 'B1', userId: 'u1', role: 'OWNER', permissions: ['customers.edit'] };
let repo: InMemoryMembershipCompRepository;
let svc: MembershipCompService;

beforeEach(() => {
  repo = new InMemoryMembershipCompRepository();
  svc = new MembershipCompService(repo);
  repo.seedRedemption('tk1', { redemptionId: 'r1', serviceLineId: 'sl1', technicianId: 't1', commissionBasisSnapshot: JSON.stringify({ basis: 'standard', techCents: 3600, ownerCents: 2400 }) });
  repo.seedRedemption('tk1', { redemptionId: 'r2', serviceLineId: 'sl2', technicianId: 't1', commissionBasisSnapshot: JSON.stringify({ basis: 'standard', techCents: 3000 }) });
  repo.seedRedemption('tk1', { redemptionId: 'r3', serviceLineId: 'sl3', technicianId: null, commissionBasisSnapshot: JSON.stringify({ techCents: 1000 }) }); // no tech → skipped
});

describe('MembershipCompService.bookTicketMembershipComp', () => {
  it('books a positive adjustment per redemption with frozen tech earnings, skipping no-tech lines', async () => {
    const r = await svc.bookTicketMembershipComp(ctx, 'tk1');
    expect(r.booked).toBe(2);
    expect(r.skipped).toBe(1);
    expect(r.totalTechCents).toBe(6600);
    expect(repo.adjustments).toHaveLength(2);
    expect(repo.adjustments.every((a) => a.category === 'commission_correction' && a.status === 'applied' && a.source === 'manual')).toBe(true);
    expect(repo.adjustments.find((a) => a.serviceLineId === 'sl1')?.amountCents).toBe(3600);
  });

  it('is idempotent — re-running books nothing more', async () => {
    await svc.bookTicketMembershipComp(ctx, 'tk1');
    const again = await svc.bookTicketMembershipComp(ctx, 'tk1');
    expect(again.booked).toBe(0);
    expect(again.skipped).toBe(3);
    expect(again.totalTechCents).toBe(0);
    expect(repo.adjustments).toHaveLength(2);
  });

  it('rejects a missing ticketId', async () => {
    await expect(svc.bookTicketMembershipComp(ctx, '')).rejects.toBeInstanceOf(ValidationError);
  });
});
