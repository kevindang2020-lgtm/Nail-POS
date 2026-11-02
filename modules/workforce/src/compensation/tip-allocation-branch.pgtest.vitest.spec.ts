// tip-allocation-branch.pgtest — Security Deep Scan §75 (found by the live IDOR branch rows, Oct 27 2026): a ticket's tip split
// is read and re-split only from the ticket's own location. Another location's manager gets 404, on the read AND the write.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { TipAllocationService } from './compensation-tip-allocation.service';

const T = '7b000000-0000-4000-8000-000000000001', B1 = '7b000000-0000-4000-8000-0000000000b1', B2 = '7b000000-0000-4000-8000-0000000000b2';
const TK = '7b000000-0000-4000-8000-0000000000c1', C = '7b000000-0000-4000-8000-0000000000d1';
const ctx = (branchId: string | null) => ({ tenantId: T, branchId, userId: '7b000000-0000-4000-8000-0000000000f1', role: 'MANAGER', permissions: ['tips.adjust'] });
let svc: TipAllocationService;
beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','X','X','tipbr','TIPBR1','active');
    INSERT INTO branches (id, tenant_id, name) VALUES ('${B1}','${T}','One'), ('${B2}','${T}','Two');
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${C}','${T}','${B2}','A','B','A B');
    INSERT INTO tickets (id, tenant_id, branch_id, customer_id, tip_cents) VALUES ('${TK}','${T}','${B2}','${C}', 1000);`);
  svc = new TipAllocationService(kyselyFor(pg));
}, 120_000);

describe('§75 tip allocation is location-scoped', () => {
  it('the ticket\'s own location reads it; another location gets 404 on read and write', async () => {
    expect((await svc.current(ctx(B2) as any, TK)).ticketId).toBe(TK);
    await expect(svc.current(ctx(B1) as any, TK)).rejects.toMatchObject({ status: 404 });
    await expect(svc.allocate(ctx(B1) as any, TK, { allocations: [] })).rejects.toMatchObject({ status: 404 });
  });
});
