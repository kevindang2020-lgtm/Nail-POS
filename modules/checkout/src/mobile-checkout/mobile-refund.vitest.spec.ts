// mobile-refund.vitest.spec.ts — the mobile refund/void endpoints delegate to the canonical checkout engine (no
// duplicated refund logic), and listTicketPayments reads the ticket's captured payments. Delegation is asserted with a
// mock checkout; the query is exercised against real PG.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { MobileCheckoutService } from './mobile-checkout.service';

const ctx: any = { tenantId: 'ec000000-0000-0000-0000-000000000001', branchId: 'ec000000-0000-0000-0000-0000000000b1', userId: 'u1', permissions: [] };

describe('MobileCheckoutService — refund/void delegate to the canonical engine', () => {
  it('refundPayment forwards reason + amount to checkout.refund and returns its result', async () => {
    const checkout = { refund: vi.fn().mockResolvedValue({ refundId: 'r1', status: 'refunded' }), void: vi.fn() };
    const svc = new MobileCheckoutService(undefined as any, {} as any, checkout as any, {} as any, {} as any);
    const r = await svc.refundPayment(ctx, 'pay1', { reason: 'customer request', amountCents: 500 });
    expect(checkout.refund).toHaveBeenCalledWith(ctx, 'pay1', { reason: 'customer request', amountCents: 500 });
    expect(r).toEqual({ refundId: 'r1', status: 'refunded' });
  });

  it('refundPayment passes the SELECTED SERVICES and tip flag through to the engine (they were silently dropped before Oct 1 2026)', async () => {
    const checkout = { refund: vi.fn().mockResolvedValue({ refundId: 'r1', status: 'refunded' }), void: vi.fn() };
    const svc = new MobileCheckoutService(undefined as any, {} as any, checkout as any, {} as any, {} as any);
    await svc.refundPayment(ctx, 'pay1', { reason: 'one service redone', amountCents: 2500, serviceLineIds: ['l3'], tipRefunded: true });
    expect(checkout.refund).toHaveBeenCalledWith(ctx, 'pay1', { reason: 'one service redone', amountCents: 2500, serviceLineIds: ['l3'], tipRefunded: true });
  });
  it('Functional Decision 20: refundTicket / refundPreview delegate to the canonical checkout engine', async () => {
    const checkout = { refund: vi.fn(), void: vi.fn(), refundTicket: vi.fn().mockResolvedValue({ refundedCents: 5000 }), refundAllocationPreview: vi.fn().mockResolvedValue({ allocations: [] }) };
    const svc = new MobileCheckoutService(undefined as any, {} as any, checkout as any, {} as any, {} as any);
    await svc.refundTicket(ctx, 'tk1', { reason: 'redo', amountCents: 5000 });
    expect(checkout.refundTicket).toHaveBeenCalledWith(ctx, 'tk1', { reason: 'redo', amountCents: 5000 });
    await svc.refundPreview(ctx, 'tk1', 5000);
    expect(checkout.refundAllocationPreview).toHaveBeenCalledWith(ctx, 'tk1', 5000);
  });
  it('refundPayment forwards an empty reason (the engine enforces the requirement, not this layer)', async () => {
    const checkout = { refund: vi.fn().mockResolvedValue({}), void: vi.fn() };
    const svc = new MobileCheckoutService(undefined as any, {} as any, checkout as any, {} as any, {} as any);
    await svc.refundPayment(ctx, 'pay1', {});
    expect(checkout.refund).toHaveBeenCalledWith(ctx, 'pay1', { reason: '', amountCents: undefined });
  });

  it('voidPayment forwards reason to checkout.void and returns its result', async () => {
    const checkout = { refund: vi.fn(), void: vi.fn().mockResolvedValue({ status: 'voided' }) };
    const svc = new MobileCheckoutService(undefined as any, {} as any, checkout as any, {} as any, {} as any);
    const r = await svc.voidPayment(ctx, 'pay1', { reason: 'wrong amount' });
    expect(checkout.void).toHaveBeenCalledWith(ctx, 'pay1', { reason: 'wrong amount' });
    expect(r).toEqual({ status: 'voided' });
  });

  it('listTicketPayments degrades to [] without a db', async () => {
    const svc = new MobileCheckoutService(undefined as any, {} as any, {} as any, {} as any, {} as any);
    expect(await svc.listTicketPayments(ctx, 'ec000000-0000-0000-0000-0000000000a1')).toEqual([]);
  });
});

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() { const pg = this.pg; return { async executeQuery(q: any) { const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]); return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) }; }, streamQuery() { throw new Error('nu'); } } as any; }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}

const T1 = 'ec000000-0000-0000-0000-0000000000a1';
const T2 = 'ec000000-0000-0000-0000-0000000000a2';

describe('MobileCheckoutService.listTicketPayments (real PG)', () => {
  let svc: MobileCheckoutService;
  beforeAll(async () => {
    const pg = await PGlite.create();
    await pg.exec(`CREATE TABLE payments (id uuid primary key default gen_random_uuid(), tenant_id uuid, branch_id uuid, ticket_id uuid, method text, amount_cents bigint, tip_cents bigint default 0, status text, created_at timestamptz default now())`);
    await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto').catch(() => {});
    await pg.query(`INSERT INTO payments (tenant_id, branch_id, ticket_id, method, amount_cents, status) VALUES
      ($1,$2,$3,'card',5000,'approved'),
      ($1,$2,$3,'cash',2000,'partial'),
      ($1,$2,$3,'card',1000,'voided'),
      ($1,$2,$4,'card',9000,'approved')`, [ctx.tenantId, ctx.branchId, T1, T2]);
    const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
    svc = new MobileCheckoutService(db as any, {} as any, {} as any, {} as any, {} as any);
  });

  it('returns only the ticket\'s approved/partial payments', async () => {
    const rows = await svc.listTicketPayments(ctx, T1);
    expect(rows).toHaveLength(2); // approved + partial; not the voided one, not T2's
    expect(rows.map((r) => r.status).sort()).toEqual(['approved', 'partial']);
    expect(rows.find((r) => r.method === 'card')!.amountCents).toBe(5000);
  });
});
