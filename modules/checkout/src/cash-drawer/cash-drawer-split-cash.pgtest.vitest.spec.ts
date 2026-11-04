// cash-drawer-split-cash.pgtest — cash taken as PART of a split is register cash too (wave 4 PILOT, Oct 13 2026).
//
// Found by live-pilot-day.mjs: the manager took $20.00 cash on the Pay app and the rest by Tap to Pay. The payment row is
// 'partial' — a revenue-bearing status (api-contracts REVENUE_BEARING_STATUSES: "split captures → 'partial'"), counted by
// Reports and the payments mix — but the cash drawer summed only 'approved', so tonight's expected cash was $20.00 short.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { CashDrawerRepository } from './cash-drawer.repository';
import { CashDrawerService } from './cash-drawer.service';

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

describe('a counted drawer stays as counted (Cash Drawer guide audit, Nov 3 2026)', () => {
  it('expected / variance are frozen at the count; a later sale shows as the live figure, not a moved result', async () => {
    const day = new Date().toISOString().slice(0, 10);
    await repo.open(ctx, B, 'main', day, 10000);
    const r = await repo.reconcile(ctx, B, 'main', day, 10000 + 2000 + 6717, null);
    expect(r).toMatchObject({ applied: true, status: 'reconciled', varianceCents: 0 });
    await pg.exec(`INSERT INTO payments (tenant_id, branch_id, ticket_id, method, amount_cents, status) VALUES ('${T}', '${B}', '${K2}', 'cash', 500, 'approved')`);
    const s = await repo.state(ctx, B, 'main', day);
    expect(s).toMatchObject({ status: 'reconciled', expectedCashCents: 18717, varianceCents: 0, liveExpectedCashCents: 19217, changedSinceCount: true });
  });
  it('Nov 3 audit — re-opening a counted drawer does not change the float it was counted against', async () => {
    const day = new Date().toISOString().slice(0, 10);
    await repo.open(ctx, B, 'main', day, 99999);
    const s = await repo.state(ctx, B, 'main', day);
    expect(s).toMatchObject({ status: 'reconciled', openingFloatCents: 10000 });
  });
  it('cash in / out after the count is refused until the drawer is reopened', async () => {
    const day = new Date().toISOString().slice(0, 10);
    await expect(repo.addMovement(ctx, B, 'main', day, 'out', 1000, 'lunch', null)).rejects.toMatchObject({ drawerCode: 'DRAWER_ALREADY_COUNTED' });
  });
  it('a failed read fails — it is never $0 (that stored a false shortage)', async () => {
    const broken = new CashDrawerRepository({ selectFrom: () => { throw new Error('db down'); } } as any);
    await expect(broken.computeRegisterCash({ ...ctx }, B, '2026-11-03').catch((e: Error) => { throw e; })).rejects.toThrow();
  });
});

describe('D15 (Nov 4 2026): cash belongs to the register that took it', () => {
  it('each station drawer reads its own cash; main reads the cash with no station; the registers list names them', async () => {
    const T2 = 'a9002000-0000-4000-8000-000000000001', B2 = 'a9002000-0000-4000-8000-000000000002', S1 = 'a9002000-0000-4000-8000-0000000000a1', S2 = 'a9002000-0000-4000-8000-0000000000a2';
    const K1 = 'a9002000-0000-4000-8000-0000000000e1', K3 = 'a9002000-0000-4000-8000-0000000000e3', K4 = 'a9002000-0000-4000-8000-0000000000e4';
    await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T2}', 'Two LLC', 'Two Registers', 'two-reg', 'TWOREG', 'active');
      INSERT INTO branches (id, tenant_id, name, status, timezone) VALUES ('${B2}', '${T2}', 'Main', 'active', 'UTC');
      INSERT INTO pos_stations (id, tenant_id, branch_id, name) VALUES ('${S1}', '${T2}', '${B2}', 'Front'), ('${S2}', '${T2}', '${B2}', 'Back');
      INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('a9002000-0000-4000-8000-0000000000c1', '${T2}', '${B2}', 'R', 'G', 'R G');
      INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, checkout_register_id) VALUES ('${K1}', '${T2}', '${B2}', 'a9002000-0000-4000-8000-0000000000c1', 'paid', '${S1}'), ('${K3}', '${T2}', '${B2}', 'a9002000-0000-4000-8000-0000000000c1', 'paid', '${S2}'), ('${K4}', '${T2}', '${B2}', 'a9002000-0000-4000-8000-0000000000c1', 'paid', null);
      INSERT INTO payments (tenant_id, branch_id, ticket_id, method, amount_cents, status) VALUES ('${T2}', '${B2}', '${K1}', 'cash', 1000, 'approved'), ('${T2}', '${B2}', '${K3}', 'cash', 2000, 'approved'), ('${T2}', '${B2}', '${K4}', 'cash', 500, 'approved');`);
    const c2: any = { tenantId: T2, branchId: B2, userId: 'u', role: 'OWNER', permissions: [] };
    const day = new Date().toISOString().slice(0, 10);
    expect((await pg.query(`SELECT register_id FROM payments WHERE ticket_id = '${K1}'`)).rows[0].register_id).toBe(S1);   // filled by the trigger
    expect((await repo.state(c2, B2, S1, day)).expectedSalesCents).toBe(1000);
    expect((await repo.state(c2, B2, S2, day)).expectedSalesCents).toBe(2000);
    expect((await repo.state(c2, B2, 'main', day)).expectedSalesCents).toBe(500);   // was 3500 on every register
    expect((await repo.registers(c2, B2)).map((r) => r.registerId)).toEqual(['main', S2, S1]);   // main first, then by name (Back, Front)
    expect((await repo.state(ctx, B, 'main', day)).expectedSalesCents).toBeGreaterThan(0);        // a location without stations keeps all its cash on main
  });
  it('a drawer of another location is refused — reads and writes alike', async () => {
    const svc = new CashDrawerService(repo);
    const S1 = 'a9002000-0000-4000-8000-0000000000a1';   // a station of the other salon above
    await expect(svc.getDrawer(ctx, undefined, S1)).rejects.toMatchObject({ apiCode: 'REGISTER_NOT_IN_BRANCH' });
    await expect(svc.openDrawer({ ...ctx, permissions: ['pos.checkout.take_payment'] }, { registerId: S1, openingFloatCents: 100 })).rejects.toMatchObject({ apiCode: 'REGISTER_NOT_IN_BRANCH' });
    await expect(svc.listMovements(ctx, undefined, 'not-a-register')).rejects.toMatchObject({ apiCode: 'REGISTER_NOT_IN_BRANCH' });
    const c2: any = { tenantId: 'a9002000-0000-4000-8000-000000000001', branchId: 'a9002000-0000-4000-8000-000000000002', userId: 'u', role: 'OWNER', permissions: [] };
    expect((await svc.getDrawer(c2, undefined, S1)).registerId).toBe(S1);
  });
});
