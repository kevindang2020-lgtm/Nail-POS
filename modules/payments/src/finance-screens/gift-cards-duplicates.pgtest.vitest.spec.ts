// gift-cards-duplicates.pgtest — GIFT CARDS extras 08 "Duplicate issuance and double-spend alerts", against the REAL schema:
// the Gift Cards summary names repeated payment references, overlapping redemptions, duplicate activations and an activation
// on a still-unpaid card — each with its card + ledger row ids — and never changes a balance. A clean card raises nothing;
// another salon's rows are invisible.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { GiftCardsScreenRepository } from './gift-cards-screen.repository';

const P = 'f8a2b3c4-0000-4000-8000-0000001';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), BX = id('b9'), U = id('e1');
const ctx = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: ['pos.checkout.view'] } as any;
const ctxOther = { ...ctx, tenantId: T2, branchId: BX };
let pg: any; let r: GiftCardsScreenRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
async function card(tenant: string, branch: string, code: string, last4: string, status = 'active', bal = 10000) {
  return (await q(`insert into gift_cards (tenant_id, branch_id, code, card_number_last4, initial_balance_cents, balance_cents, purchased_cents, status) values ($1,$2,$3,$4,$5,$6,$5,$7) returning id`,
    [tenant, branch, code, last4, 10000, bal, status])).rows[0].id as string;
}
async function txn(tenant: string, cardId: string, type: string, cents: number, after: number, o: { payment?: string | null; ticket?: string | null; at?: string } = {}) {
  return (await q(`insert into gift_card_transactions (tenant_id, branch_id, gift_card_id, type, amount_cents, balance_after_cents, payment_id, ticket_id, created_at) values ($1,null,$2,$3,$4,$5,$6,$7,coalesce($8::timestamptz, now())) returning id`,
    [tenant, cardId, type, cents, after, o.payment ?? null, o.ticket ?? null, o.at ?? null])).rows[0].id as string;
}
const summary = async (c = ctx) => r.summary(c, r.filters(await r.period(c, { preset: 'all' }), {}));

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Lotus LLC','Lotus','gd-lotus','GDL001','active'), ($2,'Other LLC','Other','gd-other','GDL002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Cherry Hill','active','America/New_York'), ($3,$4,'Elsewhere','active','America/New_York')`, [B, T, BX, T2]);
  r = new GiftCardsScreenRepository(kyselyFor(pg));
}, 180_000);

describe('Gift Cards — duplicate issuance and double-spend alerts (read-only)', () => {
  it('a clean card (one activation, two spaced redemptions on their own payments) raises nothing', async () => {
    const c = await card(T, B, 'GC-CLEAN0001', '1111', 'active', 5000);
    await txn(T, c, 'activate', 10000, 10000, { at: '2026-11-01T15:00:00Z' });
    await txn(T, c, 'redeem', 3000, 7000, { payment: id('d1'), at: '2026-11-02T15:00:00Z' });
    await txn(T, c, 'redeem', 2000, 5000, { payment: id('d2'), at: '2026-11-02T15:10:00Z' });
    const d = (await summary()).duplicates;
    expect(d).toEqual({ total: 0, capped: false, counts: { repeatedPayment: 0, overlappingRedemption: 0, multipleActivation: 0, activatedWhilePending: 0 }, sample: [] });
  });
  it('names each signal with the card (masked) and the exact ledger rows, and changes no balance', async () => {
    const a = await card(T, B, 'GC-DOUBLE0001', '2222', 'active', 4000);
    await txn(T, a, 'activate', 10000, 10000, { at: '2026-11-03T15:00:00Z' });
    const r1 = await txn(T, a, 'redeem', 3000, 7000, { payment: id('d3'), at: '2026-11-04T15:00:00Z' });
    const r2 = await txn(T, a, 'redeem', 3000, 4000, { payment: id('d3'), at: '2026-11-04T16:00:00Z' });   // same tender spent twice
    const b = await card(T, B, 'GC-RACE00001', '3333', 'active', 2000);
    await txn(T, b, 'activate', 10000, 10000, { at: '2026-11-03T15:00:00Z' });
    const o1 = await txn(T, b, 'redeem', 4000, 6000, { payment: id('d4'), at: '2026-11-05T15:00:00Z' });
    const o2 = await txn(T, b, 'redeem', 4000, 2000, { payment: id('d5'), at: '2026-11-05T15:00:30Z' });   // 30 s apart, two tenders
    const c = await card(T, B, 'GC-TWICE0001', '4444', 'active', 20000);
    const a1 = await txn(T, c, 'activate', 10000, 10000, { at: '2026-11-06T15:00:00Z' });
    const a2 = await txn(T, c, 'issue', 10000, 20000, { at: '2026-11-06T15:05:00Z' });
    const p = await card(T, B, 'GC-PENDING01', '5555', 'pending_payment', 0);
    const pa = await txn(T, p, 'activate', 10000, 10000, { at: '2026-11-07T15:00:00Z' });
    const balances = (await q(`select id, balance_cents from gift_cards where tenant_id = $1 order by id`, [T])).rows;

    const d = (await summary()).duplicates;
    expect(d.counts).toEqual({ repeatedPayment: 1, overlappingRedemption: 1, multipleActivation: 1, activatedWhilePending: 1 });
    expect(d.total).toBe(4); expect(d.capped).toBe(false);
    const by = Object.fromEntries(d.sample.map((s: any) => [s.kind, s]));
    expect(by.repeatedPayment).toMatchObject({ cardId: a, card: '•••• 2222', ledgerIds: [r1, r2], amountCents: 6000 });
    expect(by.overlappingRedemption).toMatchObject({ cardId: b, card: '•••• 3333', ledgerIds: [o1, o2], amountCents: 8000 });
    expect(by.multipleActivation).toMatchObject({ cardId: c, ledgerIds: [a1, a2], amountCents: 20000 });
    expect(by.activatedWhilePending).toMatchObject({ cardId: p, ledgerIds: [pa] });
    expect(JSON.stringify(d)).not.toMatch(/GC-DOUBLE|GC-RACE|GC-TWICE|GC-PENDING/);   // never the redeemable code
    expect((await q(`select id, balance_cents from gift_cards where tenant_id = $1 order by id`, [T])).rows).toEqual(balances);   // read-only
    // another salon sees none of it
    expect((await summary(ctxOther)).duplicates.total).toBe(0);
  });
});
