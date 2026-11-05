// cash-drawer-count-details.pgtest — D15 Cash Drawer gaps (Nov 5 2026): a count can carry its bill / coin breakdown (must add
// up), is refused when the expected cash moved since the counter was shown it, a difference over the review limit waits for a
// manager's sign-off (once; a re-count clears it), and the history lists past drawers with status / search / pages.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { CashDrawerRepository } from './cash-drawer.repository';
import { CashDrawerService } from './cash-drawer.service';

const P = 'a9002000-0000-4000-8000-0000000000';
const T = P + '01', B = P + '02', K = P + 'e1', C = P + 'c1', U = P + 'f1', M = P + 'f2';
const front: any = { tenantId: T, branchId: B, userId: U, role: 'FRONT_DESK', permissions: ['pos.checkout.take_payment', 'pos.checkout.view'] };
const manager: any = { tenantId: T, branchId: B, userId: M, role: 'MANAGER', permissions: ['pos.checkout.take_payment', 'pos.checkout.view', 'checkout.manage_overrides'] };
let pg: any; let svc: CashDrawerService; let day: string;

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'Cash LLC', 'Cash Salon', 'cash-two', 'CASHTWO', 'active');
    INSERT INTO branches (id, tenant_id, name, status, timezone) VALUES ('${B}', '${T}', 'Main', 'active', 'UTC');
    INSERT INTO users (id, tenant_id, role, email, full_name) VALUES ('${U}', '${T}', 'FRONT_DESK', 'f@cash.test', 'Fran Desk'), ('${M}', '${T}', 'MANAGER', 'm@cash.test', 'Mo Manager');
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${C}', '${T}', '${B}', 'N', 'O', 'N O');
    INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status) VALUES ('${K}', '${T}', '${B}', '${C}', 'paid');
    INSERT INTO payments (tenant_id, branch_id, ticket_id, method, amount_cents, status) VALUES ('${T}', '${B}', '${K}', 'cash', 5000, 'approved');
  `);
  svc = new CashDrawerService(new CashDrawerRepository(kyselyFor(pg) as any));
  day = new Date().toISOString().slice(0, 10);
  await svc.openDrawer(front, { date: day, openingFloatCents: 10000 });
}, 180_000);

describe('cash drawer count details', () => {
  it('a breakdown that does not add up and a stale expected figure are refused; nothing is written', async () => {
    await expect(svc.reconcileDrawer(front, { date: day, countedCents: 15000, denominations: { '10000': 1, '2000': 2 } })).rejects.toMatchObject({ httpStatus: 400 });
    await expect(svc.reconcileDrawer(front, { date: day, countedCents: 15000, denominations: { '300': 1 } })).rejects.toMatchObject({ httpStatus: 400 });
    await expect(svc.reconcileDrawer(front, { date: day, countedCents: 15000, expectedCashCents: 12000 })).rejects.toMatchObject({ httpStatus: 409 });
    expect((await svc.getDrawer(front, day)).status).toBe('open');
  });
  it('$30 short: counted with its breakdown, marked for review; front desk cannot sign off, a manager can — once', async () => {
    const s = await svc.reconcileDrawer(front, { date: day, countedCents: 12000, expectedCashCents: 15000, denominations: { '10000': 1, '1000': 2 }, notes: 'busy day' });
    expect(s).toMatchObject({ status: 'discrepancy', varianceCents: -3000, approvalRequired: true, approvedAt: null, denominations: { '10000': 1, '1000': 2 } });
    await expect(svc.approveCount(front, { date: day, note: 'ok' })).rejects.toMatchObject({ httpStatus: 403 });
    const a = await svc.approveCount(manager, { date: day, note: 'Change given twice, confirmed on camera' });
    expect(a.approvedBy).toBe('Mo Manager');
    await expect(svc.approveCount(manager, { date: day, note: 'again' })).rejects.toMatchObject({ httpStatus: 409 });
    const h: any = await svc.history(manager, { status: 'discrepancy', q: 'busy' });
    expect(h.items).toHaveLength(1);
    expect(h.items[0]).toMatchObject({ businessDate: day, countedBy: 'Fran Desk', approvedBy: 'Mo Manager', varianceCents: -3000 });
    expect((await svc.history(manager, { status: 'needs_review' })).total).toBe(0);
    expect((await svc.history(manager, { q: 'nothing like this' })).total).toBe(0);
  });
  it('a small difference needs no review', async () => {
    const d2 = '2026-01-02';
    await svc.openDrawer(front, { date: d2, openingFloatCents: 1000 });
    const s = await svc.reconcileDrawer(front, { date: d2, countedCents: 990 });
    expect(s).toMatchObject({ varianceCents: -10, approvalRequired: false });
  });
});
