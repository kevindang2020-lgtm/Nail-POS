// refund-approval.pgtest — Constitution 12 §93 (finding M9): large and cash refunds need an owner or manager.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { refundNeedsApprover, refundThresholds, APPROVE_REFUND_CAPABILITY } from './refund-approval';
import { ROLE_PERMISSIONS } from '@aipowersalon/permissions';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

const T = { cashCents: 5_000, anyCents: 20_000 };
describe('the rule', () => {
  it('cash: cumulative over $50 needs an approver; card: over $200', () => {
    expect(refundNeedsApprover('cash', 0, 5_000, T)).toBe(false);
    expect(refundNeedsApprover('cash', 0, 5_001, T)).toBe(true);
    expect(refundNeedsApprover('card', 0, 5_001, T)).toBe(false);
    expect(refundNeedsApprover('card', 0, 20_001, T)).toBe(true);
  });
  it('CUMULATIVE — ten $49 refunds cannot walk past a $50 limit', () => {
    expect(refundNeedsApprover('cash', 4_900, 4_900, T)).toBe(true);
    expect(refundNeedsApprover('card', 19_000, 1_500, T)).toBe(true);
  });
  it('thresholds are configurable; nonsense falls back to the defaults', () => {
    expect(refundThresholds({ REFUND_CASH_MANAGER_THRESHOLD_CENTS: '1000', REFUND_MANAGER_THRESHOLD_CENTS: '9000' })).toEqual({ cashCents: 1_000, anyCents: 9_000 });
    expect(refundThresholds({ REFUND_CASH_MANAGER_THRESHOLD_CENTS: 'lots' })).toEqual({ cashCents: 5_000, anyCents: 20_000 });
  });
});

describe('who holds the approval capability', () => {
  const holds = (role: string) => (ROLE_PERMISSIONS as any)[role].includes(APPROVE_REFUND_CAPABILITY);
  it('owners and managers do', () => { expect(holds('OWNER')).toBe(true); expect(holds('MANAGER')).toBe(true); });
  it('front desk and reception do NOT — they keep routine refunds below the limit', () => {
    expect(holds('FRONT_DESK')).toBe(false); expect(holds('RECEPTION')).toBe(false);
  });
});

describe('in-memory repository applies the same cumulative rule', () => {
  const ctx: CheckoutContext = { tenantId: 't', branchId: 'b', userId: 'u', role: 'FRONT_DESK', permissions: [] } as any;
  it('two $30 cash refunds by front desk: the first passes, the second ($60 cumulative) needs approval', async () => {
    const repo = new InMemoryCheckoutRepository();
    expect((await repo.reserveRefundAtomic(ctx, { paymentId: 'p', capturedCents: 10_000, amountCents: 3_000, method: 'cash' })).ok).toBe(true);
    expect(await repo.reserveRefundAtomic(ctx, { paymentId: 'p', capturedCents: 10_000, amountCents: 3_000, method: 'cash' })).toMatchObject({ ok: false, approvalRequired: true });
  });
  it('an approver passes the same refund', async () => {
    const repo = new InMemoryCheckoutRepository();
    expect((await repo.reserveRefundAtomic(ctx, { paymentId: 'p', capturedCents: 10_000, amountCents: 8_000, method: 'cash', canApprove: true })).ok).toBe(true);
  });
});

describe('database repository — under the advisory lock', () => {
  let pg: any; let db: any; let repo: any;
  const TEN = 'c9c9c9c9-0000-4000-8000-00000000000a';
  const ctx: CheckoutContext = { tenantId: TEN, branchId: null as any, userId: 'c8c8c8c8-0000-4000-8000-00000000000a', role: 'FRONT_DESK', permissions: [] } as any;
  beforeAll(async () => {
    pg = await migratedPglite(); db = kyselyFor(pg);
    await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${TEN}', 'R', 'R', 'rfnd-t', 'RFND1', 'active') ON CONFLICT DO NOTHING`);
    const { KyselyCheckoutRepository } = await import('./checkout.kysely.repository') as any;
    repo = new KyselyCheckoutRepository(db);
  });
  // a refund is OF a real payment (fk_payment_refunds_payment, Phase 10 migration 538): branch → customer → ticket → payment
  const pay = async () => {
    const r = (await pg.query(`WITH b AS (INSERT INTO branches (tenant_id, name) VALUES ($1, 'R') RETURNING id),
      c AS (INSERT INTO customers (tenant_id, branch_id, first_name, last_name, full_name) SELECT $1, b.id, 'R', 'R', 'R R' FROM b RETURNING id, branch_id),
      t AS (INSERT INTO tickets (tenant_id, branch_id, customer_id) SELECT $1, c.branch_id, c.id FROM c RETURNING id, branch_id)
      INSERT INTO payments (tenant_id, branch_id, ticket_id, method, amount_cents, status) SELECT $1, t.branch_id, t.id, 'cash', 10000, 'approved' FROM t RETURNING id`, [TEN])).rows[0];
    return String(r.id);
  };
  it('cumulative against REAL prior refunds: $30 + $30 cash by front desk → the second needs approval', async () => {
    const id = await pay();
    expect((await repo.reserveRefundAtomic(ctx, { paymentId: id, capturedCents: 10_000, amountCents: 3_000, method: 'cash' })).ok).toBe(true);
    expect(await repo.reserveRefundAtomic(ctx, { paymentId: id, capturedCents: 10_000, amountCents: 3_000, method: 'cash' })).toMatchObject({ ok: false, approvalRequired: true });
  });
  it('the rule is evaluated INSIDE the advisory-locked transaction, after the re-sum and before the insert', () => {
    // CONCURRENCY CANNOT BE PROVEN ON PGLITE: it has a single session, and a PostgreSQL advisory lock never blocks the
    // session that holds it — so two Promise.all reservations never wait for each other there. Verified directly: the
    // PRE-EXISTING over-refund cap lets two $30 refunds of a $50 payment both pass on PGlite, exactly as this rule
    // would. On real PostgreSQL each request holds its own pooled connection and the lock serializes them. So what
    // this test pins is the POSITION: lock → re-sum → cap → approval rule → insert, all in one transaction.
    const src = readFileSync(join(process.cwd(), 'src/checkout/checkout.kysely.repository.ts'), 'utf8');
    const body = src.slice(src.indexOf('async reserveRefundAtomic('), src.indexOf('async releaseRefund('));
    const at = (needle: string) => { const i = body.indexOf(needle); expect(i, needle).toBeGreaterThan(-1); return i; };
    const lock = at('pg_advisory_xact_lock'), sum = at("eb.fn.sum('amount_cents')"), rule = at('refundNeedsApprover('), insert = at("insertInto('payment_refunds')");
    expect(lock).toBeLessThan(sum); expect(sum).toBeLessThan(rule); expect(rule).toBeLessThan(insert);
    expect(body.slice(rule - 80, rule)).toMatch(/!input\.canApprove/);
  });
  it('a manager passes; the over-refund cap still applies to everyone', async () => {
    const id = await pay();
    expect((await repo.reserveRefundAtomic(ctx, { paymentId: id, capturedCents: 10_000, amountCents: 9_000, method: 'cash', canApprove: true })).ok).toBe(true);
    expect(await repo.reserveRefundAtomic(ctx, { paymentId: id, capturedCents: 10_000, amountCents: 2_000, method: 'cash', canApprove: true })).toMatchObject({ ok: false, refundable: 1_000 });
  });
});

describe('every refund path carries the rule', () => {
  it('all three reservation calls in the service pass canApprove from the caller\'s own capability (or an approved request) and the salon\'s limits', () => {
    const src = readFileSync(join(process.cwd(), 'src/checkout/checkout.service.ts'), 'utf8');
    const calls = src.match(/reserveRefundAtomic\(ctx, \{[^}]*\}/g) ?? [];
    expect(calls).toHaveLength(3);
    // BUILD_PLAN Phase 9: `approved` is true only inside executeApprovedRefund (opts.approvalId), never from a request body
    for (const c of calls) expect(c).toMatch(/canApprove: approved \|\| hasPermission\((ctx as any|permCtx\(ctx\)), APPROVE_REFUND_CAPABILITY\), thresholds,/);
    expect(src).toMatch(/const approved = !!opts\?\.approvalId;/);
    expect(src.match(/\{ approvalId: request\.id \}/g) ?? []).toHaveLength(1);   // the only caller that sets it: the engine's executor
  });
});
