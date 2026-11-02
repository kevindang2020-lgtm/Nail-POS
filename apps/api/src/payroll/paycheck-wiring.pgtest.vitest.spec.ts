// paycheck-wiring.pgtest — Weekly Paycheck §12 on the REAL schema (PGlite, every migration): the API's binding of the
// payroll cash port to the register drawer (CashDrawerRepository). Payroll cash from a drawer is a linked
// PAYROLL_CASH_PAYOUT "out" movement written in the CALLER's transaction; a retried prepare is ONE withdrawal (its
// idempotency key); the drawer's expected cash drops by it; canceling voids the movement (kept, never deleted) and the
// cash is back in the drawer.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { CashDrawerRepository } from '@aipowersalon/checkout';
import { payrollCashDrawerFor } from './paycheck-wiring';

const U = (n: number) => `e1a90000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = U(1), B = U(2), MGR = U(3), PAYOUT = U(4);
let pg: any; let db: any;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows as any[];
const ctx = { tenantId: T, branchId: B, userId: MGR, role: 'MANAGER', permissions: [] as string[] };

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Drawer LLC','Drawer','pay-drawer','PAYD01','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [B, T]);
}, 240_000);

describe('payroll cash ↔ register drawer (the API binding)', () => {
  it('withdraws once per key, lowers the expected cash, and a cancel puts it back', async () => {
    const repo = new CashDrawerRepository(db);
    const port = payrollCashDrawerFor(repo);
    const today = await repo.today(ctx);
    await repo.addMovement(ctx, B, 'main', today, 'in', 100_000, 'float', 'opening cash');
    expect(await port.availableCents(ctx, { branchId: B, registerId: 'main' })).toBe(100_000);
    const x = { branchId: B, registerId: 'main', amountCents: 30_000, payoutId: PAYOUT, idempotencyKey: `payroll_cash:${PAYOUT}`, note: 'Payroll cash — Mia Chen' };
    const a = await db.transaction().execute((trx: any) => port.withdraw(trx, ctx, x));
    const b = await db.transaction().execute((trx: any) => port.withdraw(trx, ctx, x));   // a retried "prepare cash"
    expect(b.movementId).toBe(a.movementId);
    expect(await port.availableCents(ctx, { branchId: B, registerId: 'main' })).toBe(70_000);
    const [m] = await q(`select direction, amount_cents, reason, source_type, source_id from cash_drawer_movements where id = $1`, [a.movementId]);
    expect(m).toMatchObject({ direction: 'out', reason: 'PAYROLL_CASH_PAYOUT', source_type: 'payroll_payout', source_id: PAYOUT });
    expect(Number(m.amount_cents)).toBe(30_000);
    await db.transaction().execute((trx: any) => port.reverse(trx, ctx, a.movementId));
    expect(await port.availableCents(ctx, { branchId: B, registerId: 'main' })).toBe(100_000);
    expect((await q(`select voided_at from cash_drawer_movements where id = $1`, [a.movementId]))[0].voided_at).not.toBeNull();   // kept in history
  });
  it('a withdrawal that fails rolls back with its transaction (the drawer and the payout move together)', async () => {
    const repo = new CashDrawerRepository(db);
    const port = payrollCashDrawerFor(repo);
    const x = { branchId: B, registerId: 'main', amountCents: 5_000, payoutId: U(5), idempotencyKey: `payroll_cash:${U(5)}`, note: 'Payroll cash' };
    await expect(db.transaction().execute(async (trx: any) => { await port.withdraw(trx, ctx, x); throw new Error('payout update failed'); })).rejects.toThrow('payout update failed');
    expect(await q(`select 1 from cash_drawer_movements where idempotency_key = $1`, [x.idempotencyKey])).toHaveLength(0);
  });
});
