// customer-directory-f1-finance.pgtest — Customer Directory guide §47 / §48 / §72 / §73 (Nov 6 2026): a merge moves what a
// customer OWNS and never creates or destroys value. Before and after a merge the salon holds the same loyalty points
// (moved as a balanced pair of ledger entries), the same gift-card balance, the same payments and refunds; a repeated
// merge is refused and adds nothing; another salon's customer with the same phone is untouched.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { mergeCustomersTx } from './customer-merge';

const T = 'f1a00000-0000-4000-8000-0000000000a1', T2 = 'f1a00000-0000-4000-8000-0000000000a2';
const B = 'f1b00000-0000-4000-8000-0000000000b1', B2 = 'f1b00000-0000-4000-8000-0000000000b2';
const P = 'f1c00000-0000-4000-8000-0000000000c1', D = 'f1c00000-0000-4000-8000-0000000000c2', X = 'f1c00000-0000-4000-8000-0000000000c3';
const TK = 'f1d00000-0000-4000-8000-0000000000d1', PAY = 'f1e00000-0000-4000-8000-0000000000e1';
let db: Kysely<any>;
const q = async (s: any) => (await s.execute(db)).rows as any[];
const n = async (s: any) => Number((await q(s))[0]?.n ?? 0);

async function totals(tenant: string) {
  return {
    points: await n(sql`select coalesce(sum(points_balance), 0)::int as n from customer_loyalty_profiles where tenant_id = ${tenant}`),
    ledgerNet: await n(sql`select coalesce(sum(delta), 0)::int as n from loyalty_ledger where tenant_id = ${tenant}`),
    giftCents: await n(sql`select coalesce(sum(balance_cents), 0)::int as n from gift_cards where tenant_id = ${tenant}`),
    payments: await n(sql`select coalesce(sum(amount_cents), 0)::int as n from payments where tenant_id = ${tenant}`),
    paymentRows: await n(sql`select count(*)::int as n from payments where tenant_id = ${tenant}`),
    refunds: await n(sql`select coalesce(sum(amount_cents), 0)::int as n from payment_refunds where tenant_id = ${tenant}`),
  };
}

beforeAll(async () => {
  db = kyselyFor(await migratedPglite()) as unknown as Kysely<any>;
  for (const [t, code] of [[T, 'F1FA'], [T2, 'F1FB']]) await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${t}, ${code}, ${code}, ${code.toLowerCase()}, ${code}, 'active')`.execute(db);
  await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active'), (${B2}, ${T2}, 'Other', 'active')`.execute(db);
  await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, phone_display, normalized_phone, status) values
    (${P}, ${T}, ${B}, 'Maria', 'Lopez', 'Maria Lopez', '+18565550177', '+18565550177', 'active'),
    (${D}, ${T}, ${B}, 'Maria', 'Lopez', 'Maria Lopez', '+18565550177', '+18565550177', 'active'),
    (${X}, ${T2}, ${B2}, 'Maria', 'Lopez', 'Maria Lopez', '+18565550177', '+18565550177', 'active')`.execute(db);
  await sql`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, points_balance, total_earned_points) values
    (${T}, ${B}, ${P}, 100, 100), (${T}, ${B}, ${D}, 40, 60), (${T2}, ${B2}, ${X}, 75, 75)`.execute(db);
  await sql`insert into gift_cards (tenant_id, branch_id, code, balance_cents, status, customer_id) values
    (${T}, ${B}, 'F1-GC-D', 2500, 'active', ${D}), (${T}, ${B}, 'F1-GC-P', 1000, 'active', ${P}), (${T2}, ${B2}, 'F1-GC-X', 900, 'active', ${X})`.execute(db);
  await sql`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents) values (${TK}, ${T}, ${B}, ${D}, 'paid', 6000)`.execute(db);
  await sql`insert into payments (id, tenant_id, branch_id, ticket_id, method, status, amount_cents) values (${PAY}, ${T}, ${B}, ${TK}, 'card', 'approved', 6000)`.execute(db);
  await sql`insert into payment_refunds (tenant_id, branch_id, payment_id, amount_cents, status) values (${T}, ${B}, ${PAY}, 1500, 'refunded')`.execute(db);
}, 120_000);

describe('§73 a merge conserves value', () => {
  it('points, gift-card balance, payments and refunds are the same before and after; only ownership moves', async () => {
    const before = await totals(T); const otherBefore = await totals(T2);
    const r = await db.transaction().execute((trx) => mergeCustomersTx(trx, { tenantId: T, branchId: B, userId: null }, P, [D], { groupId: 'f1-test' }, null));
    expect(r.moved).toMatchObject({ gift_cards: 1, tickets: 1, loyalty_points: 40 });
    const after = await totals(T);
    expect(after.points).toBe(before.points);          // 140 before (100 + 40), 140 after on the survivor
    expect(after.ledgerNet).toBe(before.ledgerNet);    // the move is a balanced pair: −40 on the source, +40 on the survivor
    expect(after.giftCents).toBe(before.giftCents);
    expect(after).toMatchObject({ payments: before.payments, paymentRows: before.paymentRows, refunds: before.refunds });
    expect((await q(sql`select customer_id from gift_cards where tenant_id = ${T} and code = 'F1-GC-D'`))[0].customer_id).toBe(P);
    expect((await q(sql`select customer_id from tickets where id = ${TK}`))[0].customer_id).toBe(P);
    const pair = await q(sql`select customer_id, delta from loyalty_ledger where tenant_id = ${T} and entry_type = 'merge' order by delta`);
    expect(pair.map((x: any) => [x.customer_id, Number(x.delta)])).toEqual([[D, -40], [P, 40]]);
    expect(await totals(T2)).toEqual(otherBefore);     // another salon's same-phone customer: untouched
    expect((await q(sql`select status from customers where id = ${X}`))[0].status).toBe('active');
  });

  it('a repeated merge is refused and adds nothing (no second ledger pair, no second log)', async () => {
    const before = await totals(T);
    const logs = await n(sql`select count(*)::int as n from customer_merge_logs where tenant_id = ${T}`);
    await expect(db.transaction().execute((trx) => mergeCustomersTx(trx, { tenantId: T, branchId: B, userId: null }, P, [D], { groupId: 'f1-test' }, null)))
      .rejects.toMatchObject({ code: 'DUPLICATE_ALREADY_MERGED' });
    expect(await totals(T)).toEqual(before);
    expect(await n(sql`select count(*)::int as n from customer_merge_logs where tenant_id = ${T}`)).toBe(logs);
    expect(await n(sql`select count(*)::int as n from loyalty_ledger where tenant_id = ${T} and entry_type = 'merge'`)).toBe(2);
  });

  it('another salon\'s customer cannot be merged in (it is "already merged or archived" from this salon\'s view)', async () => {
    const P2 = 'f1c00000-0000-4000-8000-0000000000c4';
    await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, status) values (${P2}, ${T}, ${B}, 'Ana', 'B', 'Ana B', 'active')`.execute(db);
    await expect(db.transaction().execute((trx) => mergeCustomersTx(trx, { tenantId: T, branchId: B, userId: null }, P2, [X], { groupId: 'f1-x' }, null)))
      .rejects.toMatchObject({ code: 'DUPLICATE_ALREADY_MERGED' });
    expect((await q(sql`select customer_id from gift_cards where code = 'F1-GC-X'`))[0].customer_id).toBe(X);
  });
});
