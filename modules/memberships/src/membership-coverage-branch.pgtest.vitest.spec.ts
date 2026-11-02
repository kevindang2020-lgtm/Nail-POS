// membership-coverage-branch.pgtest — Security Deep Scan §75 (found by the live IDOR branch rows, Oct 27 2026): a ticket's
// membership coverage is read only from the ticket's own location.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyMembershipEnrollRepository } from './membership-enroll.kysely.repository';

const T = '7c000000-0000-4000-8000-000000000001', B1 = '7c000000-0000-4000-8000-0000000000b1', B2 = '7c000000-0000-4000-8000-0000000000b2';
const C = '7c000000-0000-4000-8000-0000000000d1', TK = '7c000000-0000-4000-8000-0000000000c1';
const ctx = (branchId: string) => ({ tenantId: T, branchId, userId: 'u', role: 'MANAGER', permissions: ['pos.memberships.view'] });
let repo: KyselyMembershipEnrollRepository;
beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','X','X','memcov','MEMCOV1','active');
    INSERT INTO branches (id, tenant_id, name) VALUES ('${B1}','${T}','One'), ('${B2}','${T}','Two');
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${C}','${T}','${B2}','A','B','A B');
    INSERT INTO tickets (id, tenant_id, branch_id, customer_id) VALUES ('${TK}','${T}','${B2}','${C}');`);
  repo = new KyselyMembershipEnrollRepository(kyselyFor(pg));
}, 120_000);

describe('§75 membership coverage is location-scoped', () => {
  it('the ticket\'s location finds its customer; another location finds nothing; no location selected keeps the tenant rule', async () => {
    expect(await repo.ticketCustomerId(ctx(B2) as any, TK)).toBe(C);
    expect(await repo.ticketCustomerId(ctx(B1) as any, TK)).toBeNull();
    expect(await repo.ticketCustomerId(ctx('') as any, TK)).toBe(C);
  });
});
