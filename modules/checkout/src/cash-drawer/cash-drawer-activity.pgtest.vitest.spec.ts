// cash-drawer-activity.pgtest — the Cash Drawer Activity ledger (SUNMI Cash Drawer addendum §08–§09, Nov 7 2026): every
// cash event of one register — float, cash sales, cash refunds, cash in / out — newest first, server-paged, read from the
// same rows as the drawer's own math (the ledger's in − out equals float + sales − refunds + in − out), searched by
// customer, phone digits (never returned), #ticket, employee or reason; a customer only through Ticket → Customer.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { CashDrawerRepository } from './cash-drawer.repository';

const T = 'a9002000-0000-4000-8000-000000000001', B = 'a9002000-0000-4000-8000-000000000002', T2 = 'a9002000-0000-4000-8000-000000000003', B2 = 'a9002000-0000-4000-8000-000000000004';
const K = 'a9002000-0000-4000-8000-0000000000e1', K2 = 'a9002000-0000-4000-8000-0000000000e2', K9 = 'a9002000-0000-4000-8000-0000000000e9', C9 = 'a9002000-0000-4000-8000-0000000000c9', C = 'a9002000-0000-4000-8000-0000000000c1', C2 = 'a9002000-0000-4000-8000-0000000000c2', U = 'a9002000-0000-4000-8000-0000000000f1';
let pg: any; let repo: CashDrawerRepository;
const ctx: any = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: [] };
const day = new Date().toISOString().slice(0, 10);
const f = (x: Partial<{ kind: string | null; q: string; page: number; pageSize: number }> = {}) => ({ from: day, to: day, kind: null, q: '', page: 1, pageSize: 10, ...x });

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'Cash LLC', 'Cash Salon', 'cash-act', 'CASHACT', 'active'), ('${T2}', 'Other', 'Other', 'cash-oth', 'CASHOTH', 'active');
    INSERT INTO branches (id, tenant_id, name, status, timezone) VALUES ('${B}', '${T}', 'Main', 'active', 'UTC'), ('${B2}', '${T2}', 'Other', 'active', 'UTC');
    INSERT INTO users (id, tenant_id, full_name, email, password_hash, status, role) VALUES ('${U}', '${T}', 'Rosa Front', 'rosa@cash.test', 'x', 'active', 'MANAGER');
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) VALUES ('${C}', '${T}', '${B}', 'Nina', 'Ortiz', 'Nina Ortiz', '+16095550142'), ('${C2}', '${T}', '${B}', 'Lee', 'Park', 'Lee Park', null);
    INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, ticket_number) VALUES ('${K}', '${T}', '${B}', '${C}', 'paid', '1042'), ('${K2}', '${T}', '${B}', '${C2}', 'paid', '1043');
    INSERT INTO payments (tenant_id, branch_id, ticket_id, method, amount_cents, status, created_by_user_id) VALUES
      ('${T}', '${B}', '${K}', 'cash', 4500, 'approved', '${U}'), ('${T}', '${B}', '${K}', 'card', 7000, 'approved', '${U}'),
      ('${T}', '${B}', '${K2}', 'cash', 1500, 'refunded', '${U}'), ('${T}', '${B}', '${K2}', 'cash', 999, 'declined', '${U}');
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${C9}', '${T2}', '${B2}', 'X', 'Y', 'X Y');
    INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, ticket_number) VALUES ('${K9}', '${T2}', '${B2}', '${C9}', 'paid', '1042');
    INSERT INTO payments (tenant_id, branch_id, ticket_id, method, amount_cents, status) VALUES ('${T2}', '${B2}', '${K9}', 'cash', 88800, 'approved');
  `);
  repo = new CashDrawerRepository(kyselyFor(pg) as any);
  await repo.open(ctx, B, 'main', day, 10000);
  await repo.addMovement(ctx, B, 'main', day, 'out', 2000, 'petty cash', null);
  await repo.addMovement(ctx, B, 'main', day, 'in', 500, 'float top-up', null);
}, 180_000);

describe('Cash Drawer Activity ledger', () => {
  it('lists every cash event of the register, newest first — never a card, a declined row or another salon', async () => {
    const r = await repo.activity(ctx, B, 'main', f());
    expect(r.items.map((x) => x.kind).sort()).toEqual(['cash_in', 'cash_out', 'float', 'refund', 'sale']);
    expect(r.items.some((x) => x.cashInCents === 7000 || x.cashInCents === 999 || x.cashInCents === 88800)).toBe(false);
    const at = r.items.map((x) => x.at!); expect([...at].sort().reverse()).toEqual(at);
  });
  it('adds up to the drawer: in − out = float + cash sales − refunds + cash in − cash out', async () => {
    const r = await repo.activity(ctx, B, 'main', f());
    const st = await repo.state(ctx, B, 'main', day);
    expect(r.totals.cashInCents - r.totals.cashOutCents).toBe(st.expectedCashCents);
  });
  it('a sale names its ticket, customer and employee; a movement has no customer (none is invented)', async () => {
    const r = await repo.activity(ctx, B, 'main', f());
    expect(r.items.find((x) => x.kind === 'sale')).toMatchObject({ ticketNumber: '1042', customer: 'Nina Ortiz', employee: 'Rosa Front', cashInCents: 4500 });
    expect(r.items.find((x) => x.kind === 'cash_out')).toMatchObject({ customer: null, reason: 'petty cash', cashOutCents: 2000 });
    expect(r.items.find((x) => x.kind === 'refund')).toMatchObject({ ticketNumber: '1043', customer: 'Lee Park', cashOutCents: 1500 });
    expect(JSON.stringify(r)).not.toContain('5550142');   // the phone is searchable, never returned
  });
  it('one search box: customer name, phone digits in any format, #ticket, employee, reason', async () => {
    const kinds = async (q: string) => (await repo.activity(ctx, B, 'main', f({ q }))).items.map((x) => x.kind).sort();
    expect(await kinds('nina')).toEqual(['sale']);
    expect(await kinds('(609) 555-0142')).toEqual(['sale']);
    expect(await kinds('#1043')).toEqual(['refund']);
    expect(await kinds('petty')).toEqual(['cash_out']);
    expect((await kinds('rosa')).length).toBe(5);
    expect(await kinds('nobody-at-all')).toEqual([]);
  });
  it('filters by kind and pages on the server with a true total', async () => {
    expect((await repo.activity(ctx, B, 'main', f({ kind: 'cash_in' }))).items.map((x) => x.reason)).toEqual(['float top-up']);
    const p1 = await repo.activity(ctx, B, 'main', f({ pageSize: 2 })); const p3 = await repo.activity(ctx, B, 'main', f({ pageSize: 2, page: 3 }));
    expect([p1.total, p1.pages, p1.items.length, p3.items.length]).toEqual([5, 3, 2, 1]);
  });
  it('a voided cash out stays listed as voided and leaves the totals', async () => {
    const out = (await repo.activity(ctx, B, 'main', f({ kind: 'cash_out' }))).items[0];
    await repo.voidMovement(ctx, out.id);
    const r = await repo.activity(ctx, B, 'main', f());
    expect(r.items.find((x) => x.id === out.id)?.state).toBe('voided');
    expect(r.totals.cashInCents - r.totals.cashOutCents).toBe((await repo.state(ctx, B, 'main', day)).expectedCashCents);
  });
  it('another day is empty', async () => {
    expect((await repo.activity(ctx, B, 'main', { ...f(), from: '2020-01-01', to: '2020-01-02' })).total).toBe(0);
  });
});
