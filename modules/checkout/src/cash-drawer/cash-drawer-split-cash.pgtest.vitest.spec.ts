// cash-drawer-split-cash.pgtest — cash taken as PART of a split is register cash too (wave 4 PILOT, Oct 13 2026).
//
// Found by live-pilot-day.mjs: the manager took $20.00 cash on the Pay app and the rest by Tap to Pay. The payment row is
// 'partial' — a revenue-bearing status (api-contracts REVENUE_BEARING_STATUSES: "split captures → 'partial'"), counted by
// Reports and the payments mix — but the cash drawer summed only 'approved', so tonight's expected cash was $20.00 short.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { CashDrawerRepository } from './cash-drawer.repository';

const T = 'a9001000-0000-4000-8000-000000000001', B = 'a9001000-0000-4000-8000-000000000002', K = 'a9001000-0000-4000-8000-0000000000e1', K2 = 'a9001000-0000-4000-8000-0000000000e2', C = 'a9001000-0000-4000-8000-0000000000c1';
let pg: any; let repo: CashDrawerRepository;
const ctx: any = { tenantId: T, branchId: B, userId: 'u', role: 'OWNER', permissions: [] };

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'Cash LLC', 'Cash Salon', 'cash-salon', 'CASHSALON', 'active');
    INSERT INTO branches (id, tenant_id, name, status, timezone) VALUES ('${B}', '${T}', 'Main', 'active', 'UTC');
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${C}', '${T}', '${B}', 'N', 'O', 'N O');
    INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status) VALUES ('${K}', '${T}', '${B}', '${C}', 'paid'), ('${K2}', '${T}', '${B}', '${C}', 'paid');
    INSERT INTO payments (tenant_id, branch_id, ticket_id, method, amount_cents, status) VALUES ('${T}', '${B}', '${K}', 'cash', 2000, 'partial'), ('${T}', '${B}', '${K}', 'card', 7005, 'approved'), ('${T}', '${B}', '${K2}', 'cash', 6717, 'approved'), ('${T}', '${B}', '${K2}', 'cash', 999, 'declined');
  `);
  repo = new CashDrawerRepository(kyselyFor(pg) as any);
}, 180_000);

describe('register cash', () => {
  it('counts the cash part of a split (partial) with the plain cash sales; never a declined row or a card', async () => {
    const day = new Date().toISOString().slice(0, 10);
    const c: any = await repo.computeRegisterCash(ctx, B, day);
    expect(c.salesCents ?? c.cashSalesCents ?? c.sales).toBe(2000 + 6717);
  });
});
