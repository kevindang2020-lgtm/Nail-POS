// gift-cards-closeout.pgtest — GIFT CARDS extras 12 "Reconciliation to daily closeout", against the REAL schema: for one salon
// day (America/New_York) the Gift Cards summary compares the ledger's redemptions with the gift-card tenders the register took,
// names the rows with no partner on either side, names activations with no paid sale ticket, and splits the day's liability
// movement into parts that add up to the net. Read-only; another day's and another salon's rows are not counted.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { GiftCardsScreenRepository } from './gift-cards-screen.repository';

const P = 'f8a2b3c4-0000-4000-8000-0000002';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), BX = id('b9'), U = id('e1');
const ctx = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: ['pos.checkout.view'] } as any;
const ctxOther = { ...ctx, tenantId: T2, branchId: BX };
let pg: any; let r: GiftCardsScreenRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
async function card(tenant: string, code: string, last4: string, bal: number, saleTicket: string | null = null) {
  return (await q(`insert into gift_cards (tenant_id, branch_id, code, card_number_last4, initial_balance_cents, balance_cents, purchased_cents, status, sale_ticket_id) values ($1,$2,$3,$4,10000,$5,10000,'active',$6) returning id`,
    [tenant, tenant === T ? B : BX, code, last4, bal, saleTicket])).rows[0].id as string;
}
async function txn(tenant: string, cardId: string, type: string, cents: number, after: number, at: string, o: { payment?: string | null; key?: string } = {}) {
  return (await q(`insert into gift_card_transactions (tenant_id, branch_id, gift_card_id, type, amount_cents, balance_after_cents, payment_id, idempotency_key, created_at) values ($1,null,$2,$3,$4,$5,$6,$7,$8::timestamptz) returning id`,
    [tenant, cardId, type, cents, after, o.payment ?? null, o.key ?? null, at])).rows[0].id as string;
}
async function pay(tenant: string, pid: string, cents: number, at: string, status = 'approved', method = 'gift_card') {
  await q(`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, created_at, approved_at) values ($1,$2,$3,$8,$4,$5,0,$6,$7::timestamptz,$7::timestamptz)`,
    [pid, tenant, tenant === T ? B : BX, method, cents, status, at, tenant === T ? id('c1') : id('c9')]);
}
const day = async (c: any, d: string) => (await r.summary(c, r.filters(await r.period(c, { preset: 'custom', from: d, to: d }), {}))).closeout;

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Lotus LLC','Lotus','gc-lotus','GCL001','active'), ($2,'Other LLC','Other','gc-other','GCL002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Cherry Hill','active','America/New_York'), ($3,$4,'Elsewhere','active','America/New_York')`, [B, T, BX, T2]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Bo','Walk','Bo Walk')`, [id('f1'), T, B]);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, ticket_number) values ($1,$2,$3,$5,'paid',10000,'T-1'), ($4,$2,$3,$5,'open',10000,'T-2')`, [id('c1'), T, B, id('c2'), id('f1')]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Al','Other','Al Other')`, [id('f9'), T2, BX]);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, ticket_number) values ($1,$2,$3,$4,'paid',2000,'T-9')`, [id('c9'), T2, BX, id('f9')]);
  r = new GiftCardsScreenRepository(kyselyFor(pg));

  // Nov 10 (salon day, New York). 14:00Z = 9:00 New York.
  const a = await card(T, 'GC-SOLD00001', '1111', 4500, id('c1'));            // sold on a PAID ticket
  await txn(T, a, 'activate', 10000, 10000, '2026-11-10T14:00:00Z');
  await txn(T, a, 'redeem', 3000, 7000, '2026-11-10T15:00:00Z', { payment: id('d1') });   // matched tender
  await pay(T, id('d1'), 3000, '2026-11-10T15:00:00Z');
  await txn(T, a, 'redeem', 2500, 4500, '2026-11-10T16:00:00Z');                          // no tender behind it
  const b = await card(T, 'GC-OPEN00001', '2222', 12000, id('c2'));          // its sale ticket is still open
  await txn(T, b, 'activate', 10000, 10000, '2026-11-10T17:00:00Z');
  await txn(T, b, 'adjust', 2000, 12000, '2026-11-10T17:30:00Z', { key: 'reload:x1' });   // reload
  const c = await card(T, 'GC-PROMO0001', '3333', 0, null);                  // no sale ticket at all
  await txn(T, c, 'activate', 5000, 5000, '2026-11-10T18:00:00Z');
  await txn(T, c, 'redeem', 1000, 4000, '2026-11-10T18:30:00Z', { payment: id('d3') });
  await pay(T, id('d3'), 1000, '2026-11-10T18:30:00Z');
  await txn(T, c, 'refund', 1000, 5000, '2026-11-10T19:00:00Z');                          // credited back onto the card
  await txn(T, c, 'adjust', -500, 4500, '2026-11-10T19:10:00Z');                          // manager correction
  await txn(T, c, 'expire', 4500, 0, '2026-11-10T19:20:00Z');
  await pay(T, id('d4'), 1500, '2026-11-10T20:00:00Z');                                    // gift tender, no ledger row
  await pay(T, id('d5'), 9999, '2026-11-10T20:05:00Z', 'declined');                        // not a tender the register took
  await pay(T, id('d6'), 7777, '2026-11-10T20:10:00Z', 'approved', 'card');                // not a gift-card tender
  // Nov 11 04:30Z = Nov 10 23:30 New York — still the Nov 10 salon day
  await txn(T, a, 'redeem', 500, 4000, '2026-11-11T04:30:00Z', { payment: id('d7') });
  await pay(T, id('d7'), 500, '2026-11-11T04:30:00Z');
  // Nov 11 salon day
  await txn(T, a, 'redeem', 700, 3300, '2026-11-11T15:00:00Z', { payment: id('d8') });
  await pay(T, id('d8'), 700, '2026-11-11T15:00:00Z');
  // another salon, same day
  const x = await card(T2, 'GC-OTHER0001', '9999', 5000, null);
  await txn(T2, x, 'activate', 5000, 5000, '2026-11-10T15:00:00Z');
  await pay(T2, id('d9'), 2000, '2026-11-10T15:00:00Z');
}, 180_000);

describe('Gift Cards — reconciliation to daily closeout (read-only)', () => {
  it('compares redemptions with tenders, names the unpartnered rows, and splits the liability movement', async () => {
    const before = (await q(`select id, balance_cents from gift_cards order by id`)).rows;
    const k = await day(ctx, '2026-11-10');
    expect(k.basis).toBe('period');
    expect(k.redemptions).toMatchObject({ ledgerCents: 3000 + 2500 + 1000 + 500, ledgerRows: 4, tenderCents: 3000 + 1000 + 1500 + 500, tenders: 4, differenceCents: 6000 - 7000 });
    expect(k.redemptions.withoutTender.count).toBe(1);
    expect(k.redemptions.withoutTender.sample[0]).toMatchObject({ card: '•••• 1111', amountCents: 2500 });
    expect(k.redemptions.withoutLedger).toMatchObject({ count: 1, capped: false, sample: [{ paymentId: id('d4'), amountCents: 1500 }] });
    expect(k.issuance.ledgerCents).toBe(25000); expect(k.issuance.ledgerRows).toBe(3);
    expect(k.issuance.withoutPaidSale.count).toBe(2);
    expect(k.issuance.withoutPaidSale.sample.map((s: any) => s.card)).toEqual(['•••• 2222', '•••• 3333']);
    const L = k.liability;
    expect(L).toEqual({ issuedCents: 25000, reloadedCents: 2000, redeemedCents: 7000, refundedBackCents: 1000, otherAdjustmentsCents: -500, expiredCents: 4500, netChangeCents: 16000 });
    expect(L.issuedCents + L.reloadedCents - L.redeemedCents + L.refundedBackCents + L.otherAdjustmentsCents - L.expiredCents).toBe(L.netChangeCents);
    expect(JSON.stringify(k)).not.toMatch(/GC-SOLD|GC-OPEN|GC-PROMO/);   // never the redeemable code
    expect((await q(`select id, balance_cents from gift_cards order by id`)).rows).toEqual(before);   // read-only
  });
  it('the next salon day counts only its own rows; another salon sees only its own', async () => {
    const k = await day(ctx, '2026-11-11');
    expect(k.redemptions).toMatchObject({ ledgerCents: 700, tenderCents: 700, differenceCents: 0 });
    expect(k.redemptions.withoutTender.count).toBe(0); expect(k.redemptions.withoutLedger.count).toBe(0);
    expect(k.liability.netChangeCents).toBe(-700);
    const o = await day(ctxOther, '2026-11-10');
    expect(o.redemptions).toMatchObject({ ledgerCents: 0, tenderCents: 2000 });
    expect(o.redemptions.withoutLedger.sample[0].paymentId).toBe(id('d9'));
    expect(o.issuance.ledgerCents).toBe(5000);
  });
});

describe('extras GIFT CARDS 05 / 11 (round 10) — balance verified at, and why a card can or cannot pay', () => {
  it('an active card with balance can pay its balance; void / redeemed / pending say why not; locations follow the gift-card setting the way checkout reads it', async () => {
    const { resolveGiftCardSaleSettings } = await import('../../../checkout/src/checkout/checkout-settings.resolver');
    const db = kyselyFor(pg);
    const live = await card(T, 'GC-ELIG00001', '4444', 2500);
    await txn(T, live, 'activate', 2500, 2500, '2026-11-11T14:00:00Z');
    let d: any = await r.detail(ctx, live);
    expect(d.eligibility).toMatchObject({ reason: 'active', canSpend: true, spendableCents: 2500, pinRequired: false });
    expect(d.verification).toMatchObject({ lastMovementAt: '2026-11-11T14:00:00.000Z', source: 'live_ledger' });
    expect(Date.parse(d.verification.checkedAt)).toBeGreaterThan(Date.parse('2026-11-11T14:00:00Z'));
    // no setting stored → checkout's default; the screen agrees with checkout's own resolver
    expect(d.eligibility.locations).toBe((await resolveGiftCardSaleSettings(db as never, T, B)).crossBranchRedemption ? 'any_branch' : 'issuing_branch_only');
    await q(`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values ($1, null, 'gift-card-settings', '{"crossBranchRedemption": false}'::jsonb)`, [T]);
    d = await r.detail(ctx, live);
    expect((await resolveGiftCardSaleSettings(db as never, T, B)).crossBranchRedemption).toBe(false);
    expect(d.eligibility).toMatchObject({ locations: 'issuing_branch_only', branch: 'Cherry Hill' });
    await q(`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values ($1, $2, 'gift-card-settings', '{"crossBranchRedemption": true}'::jsonb)`, [T, B]);
    expect((await r.detail(ctx, live)).eligibility.locations).toBe('any_branch');               // the branch row wins, as in checkout
    expect((await resolveGiftCardSaleSettings(db as never, T, B)).crossBranchRedemption).toBe(true);
    for (const [status, bal, why] of [['void', 2500, 'void'], ['redeemed', 0, 'redeemed'], ['pending_payment', 2500, 'pending_payment'], ['active', 0, 'no_balance']] as const) {
      await q(`update gift_cards set status = $1, balance_cents = $2 where id = $3`, [status, bal, live]);
      expect((await r.detail(ctx, live)).eligibility).toMatchObject({ reason: why, canSpend: false, spendableCents: 0 });
    }
    await q(`delete from tenant_settings where tenant_id = $1 and category = 'gift-card-settings'`, [T]);
  });
});
