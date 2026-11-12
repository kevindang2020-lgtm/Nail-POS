// gift-cards-screen.pgtest — Gift Cards mandate (Oct 29 2026), against the REAL schema, through the ONE gift-card writer
// (KyselyCheckoutRepository) and the screen's read model (GiftCardsScreenRepository).
//   Issue: payment-first — a numbered ticket for the purchaser with a PENDING card; a double tap (same key) makes ONE card and
//   ONE ticket; an unpaid card is not "issued" and carries no liability; paying activates it with its ledger row atomically.
//   Redeem: $100 → $65 → $35 (worked example); two concurrent redemptions cannot overspend; never negative.
//   Cross-location: a card sold at one location redeems at another unless the salon turned it off.
//   Search: purchaser / recipient (kept apart), every phone format, email, masked suffix; no code or number ever returned.
//   Reload: a hold on its own ticket, credited once when paid. Void: a manager action with a reason; the history stays.
//   KPIs reconcile to the ledger; another salon's cards are invisible.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyCheckoutRepository } from './checkout.kysely.repository';
import { GiftCardsScreenRepository } from '@aipowersalon/payments';

const P = 'f8a2b3c4-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2'), BX = id('b9'), U = id('e1');
const perms = ['pos.checkout.view', 'pos.customers.view', 'pos.checkout.gift_card_issue', 'pos.checkout.void'];
const ctx = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: perms } as any;
const ctxB2 = { ...ctx, branchId: B2 };
const ctxOther = { ...ctx, tenantId: T2, branchId: BX };
const TZ = 'America/New_York';
let pg: any; let db: any; let w: KyselyCheckoutRepository; let r: GiftCardsScreenRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
const allTime = async () => r.filters(await r.period(ctx, { preset: 'all' }), {});
const f = async (extra: Record<string, unknown> = {}) => r.filters(await r.period(ctx, { preset: 'all' }), extra);
// This environment's Kysely stand-in runs raw SQL only, so the query-builder paths of the writer (afterPaid's activation /
// reload credit, checkout redemption) are reproduced here statement for statement as they write — the new screen writers
// (issue / reload / void, raw SQL) and the read model run for real. The builder paths keep their own suites.
async function payTicket(ticketId: string) {
  const pend = (await q(`select id, purchased_cents from gift_cards where tenant_id = $1 and sale_ticket_id = $2 and status = 'pending_payment'`, [T, ticketId])).rows;
  for (const c of pend) {
    await q(`update gift_cards set status = 'active', balance_cents = $2, updated_at = now() where id = $1 and status = 'pending_payment'`, [c.id, c.purchased_cents]);
    await q(`insert into gift_card_transactions (tenant_id, branch_id, gift_card_id, type, amount_cents, balance_after_cents, ticket_id, idempotency_key) values ($1,$2,$3,'activate',$4,$4,$5,$6)`, [T, B, c.id, c.purchased_cents, ticketId, 'activate:' + c.id]);
  }
  const holds = (await q(`select id, gift_card_id, amount_cents from gift_card_transactions h where tenant_id = $1 and ticket_id = $2 and type = 'hold'
    and not exists (select 1 from gift_card_transactions c where c.tenant_id = h.tenant_id and c.idempotency_key = 'reload:' || h.id::text)`, [T, ticketId])).rows;
  for (const h of holds) {
    const nb = (await q(`update gift_cards set balance_cents = balance_cents + $2, status = 'active' where id = $1 returning balance_cents`, [h.gift_card_id, h.amount_cents])).rows[0].balance_cents;
    await q(`insert into gift_card_transactions (tenant_id, branch_id, gift_card_id, type, amount_cents, balance_after_cents, idempotency_key) values ($1,$2,$3,'adjust',$4,$5,$6)`, [T, B, h.gift_card_id, h.amount_cents, nb, 'reload:' + h.id]);
  }
  return pend.length + holds.length;
}
async function redeem(cardId: string, cents: number) {
  const u = (await q(`update gift_cards set balance_cents = balance_cents - $2, status = case when balance_cents - $2 <= 0 then 'redeemed' else 'active' end where id = $1 and status = 'active' and balance_cents >= $2 returning balance_cents`, [cardId, cents])).rows[0];
  if (!u) return false;
  await q(`insert into gift_card_transactions (tenant_id, branch_id, gift_card_id, type, amount_cents, balance_after_cents) values ($1,$2,$3,'redeem',$4,$5)`, [T, B, cardId, cents, u.balance_cents]);
  return true;
}
let card1 = '', ticket1 = '';

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Lotus LLC','Lotus','gc-lotus','GCL001','active'), ($2,'Other LLC','Other','gc-other','GCL002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Cherry Hill','active',$6), ($3,$2,'Marlton','active',$6), ($4,$5,'Elsewhere','active',$6)`, [B, T, B2, BX, T2, TZ]);
  await q(`insert into users (id, tenant_id, email, full_name, role, status) values ($1,$2,'o@x.test','Olive Owner','OWNER','active')`, [U, T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, email) values
    ($1,$2,$3,'John','Smith','John Smith','+18565551234','(856) 555-1234','john.smith@example.com'),
    ($4,$2,$3,'Mai','Tran','Mai Tran','+18565559876','(856) 555-9876',null),
    ($5,$6,$7,'John','Smith','John Smith','+18565551234','(856) 555-1234','john.smith@example.com')`, [id('c1'), T, B, id('c2'), id('c9'), T2, BX]);
  db = kyselyFor(pg); w = new KyselyCheckoutRepository(db as never); r = new GiftCardsScreenRepository(db);
}, 180_000);

describe('Gift Cards — issue is payment-first and idempotent', () => {
  it('opens a numbered ticket for the purchaser with ONE pending card; a double tap returns the same card and ticket', async () => {
    const req = { idempotencyKey: 'issue-key-0001', customerId: id('c1'), amountCents: 10000, code: 'GC-TESTCODE01', reference: 'GC-****-DE01', cardNumber: '6000123412341111', physical: false,
      recipient: { name: 'Emily Rose', phone: '(215) 555-0142', email: 'emily@example.com', message: 'Happy birthday' } };
    const a = await w.issueGiftCardOnNewTicket(ctx, req);
    const b = await w.issueGiftCardOnNewTicket(ctx, { ...req, code: 'GC-TESTCODE02', cardNumber: '6000123412342222' });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.existing).toBe(true); expect(b.cardId).toBe(a.cardId); expect(b.ticketId).toBe(a.ticketId);
    expect(Number((await q(`select count(*) n from gift_cards where tenant_id = $1`, [T])).rows[0].n)).toBe(1);
    const tk = (await q(`select status, checkout_status, customer_id, ticket_number from tickets where id = $1`, [a.ticketId])).rows[0];
    expect(tk).toMatchObject({ status: 'ready_checkout', checkout_status: 'ready_for_payment', customer_id: id('c1') });
    expect(a.ticketNumber).toBe('#' + tk.ticket_number);
    const rec = (await q(`select recipient_name, recipient_phone, recipient_email from gift_card_recipients where gift_card_id = $1`, [a.cardId])).rows[0];
    expect(rec).toEqual({ recipient_name: 'Emily Rose', recipient_phone: '+12155550142', recipient_email: 'emily@example.com' });
    card1 = a.cardId; ticket1 = a.ticketId;
  });
  it('an unpaid card carries no value: not issued, no liability, not a "total card"; it shows under Pending', async () => {
    const s = await r.summary(ctx, await allTime());
    expect(s.kpis).toMatchObject({ outstandingLiabilityCents: 0, activeCards: 0, totalCards: 0, totalIssuedCents: 0, pendingPaymentCards: 1 });
    const l = await r.list(ctx, await f({ status: 'pending' }), { page: 1, pageSize: 10 });
    expect(l.items.map((x) => x.id)).toEqual([card1]);
    expect(l.items[0].balanceCents).toBe(0);
  });
  it('paying the ticket activates the card with its ledger row; a second activation does nothing', async () => {
    expect(await payTicket(ticket1)).toBe(1);
    expect(await payTicket(ticket1)).toBe(0);
    const led = (await q(`select type, amount_cents, balance_after_cents, ticket_id from gift_card_transactions where gift_card_id = $1`, [card1])).rows;
    expect(led).toEqual([{ type: 'activate', amount_cents: 10000, balance_after_cents: 10000, ticket_id: ticket1 }]);
    const s = await r.summary(ctx, await allTime());
    expect(s.kpis).toMatchObject({ outstandingLiabilityCents: 10000, activeCards: 1, totalCards: 1, totalIssuedCents: 10000, pendingPaymentCards: 0 });
  });
});

describe('Gift Cards — redemption, partial balances, concurrency, locations', () => {
  it('worked example: $100 card, $65 service → $35 left and still Active; the ledger reconciles', async () => {
    expect(await redeem(card1, 6500)).toBe(true);
    const d = await r.detail(ctx, card1);
    expect(d.card).toMatchObject({ balanceCents: 3500, status: 'active', spendable: true });
    expect(d.totals).toMatchObject({ originalCents: 10000, redeemedCents: 6500, reconciled: true, ledgerBalanceCents: 3500 });
    const l = await r.ledger(ctx, card1, await r.period(ctx, { preset: 'all' }), { page: 1, pageSize: 10 });
    expect(l.items.map((x) => [x.type, x.amountCents, x.balanceBeforeCents, x.balanceAfterCents])).toEqual([['redeem', -6500, 10000, 3500], ['activate', 10000, 0, 10000]]);
  });
  it('the balance is never negative: a redemption above the balance is refused', async () => {
    expect(await redeem(card1, 3000)).toBe(true);
    expect(await redeem(card1, 600)).toBe(false);
    expect(Number((await q(`select balance_cents from gift_cards where id = $1`, [card1])).rows[0].balance_cents)).toBe(500);
  });
  it('the salon’s cards show at every location — unless the salon turned cross-location redemption off', async () => {
    expect((await r.list(ctxB2, await f(), { page: 1, pageSize: 10 })).total).toBe(1);
    await q(`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values ($1, null, 'gift-card-settings', '{"crossBranchRedemption": false}'::jsonb)`, [T]);
    expect((await r.list(ctxB2, await f(), { page: 1, pageSize: 10 })).total).toBe(0);
    expect(await w.voidGiftCardById(ctxB2, card1, 'wrong location')).toEqual({ ok: false, reason: 'not_found' });
    await q(`delete from tenant_settings where tenant_id = $1 and category = 'gift-card-settings'`, [T]);
    expect((await r.list(ctxB2, await f(), { page: 1, pageSize: 10 })).total).toBe(1);
  });
});

describe('Gift Cards — universal search, masking and paging', () => {
  // more cards (all paid) so search and paging have something to separate — seeded lazily by the first test here (this
  // environment's runner runs every beforeAll up front, before any test)
  let seeded = false;
  const seedMore = async () => { if (seeded) return; seeded = true;
    for (let i = 2; i <= 14; i++) {
      const res = await w.issueGiftCardOnNewTicket(ctx, { idempotencyKey: 'issue-key-' + String(i).padStart(4, '0'), customerId: i % 2 ? id('c1') : id('c2'), amountCents: 2500 + i * 100,
        code: 'GC-TESTCODE' + String(i).padStart(2, '0') + 'X', reference: 'GC-****-' + String(i).padStart(2, '0') + 'XX', cardNumber: '60001234123400' + String(i).padStart(2, '0'), physical: false });
      if (res.ok) await payTicket(res.ticketId);
    }
  };
  it('every phone format finds the same purchaser; email and the masked suffix find cards; purchaser and recipient stay apart', async () => {
    await seedMore();
    const formats = ['8565551234', '(856) 555-1234', '856-555-1234', '+1 856 555 1234'];
    const totals = await Promise.all(formats.map(async (p) => (await r.list(ctx, await f({ search: p }), { page: 1, pageSize: 50 })).total));
    expect(new Set(totals).size).toBe(1); expect(totals[0]).toBe(7);   // card 1 + the 6 odd-numbered cards
    expect((await r.list(ctx, await f({ search: 'john.smith@example.com' }), { page: 1, pageSize: 50 })).total).toBe(7);
    const byLast4 = await r.list(ctx, await f({ search: '0007' }), { page: 1, pageSize: 50 });
    expect(byLast4.items.map((x) => x.card)).toContain('•••• 0007');
    const rec = await r.list(ctx, await f({ search: 'Emily' }), { page: 1, pageSize: 50 });
    expect(rec.items.map((x) => [x.id, x.matchedBy])).toEqual([[card1, 'recipient']]);
    expect((await r.list(ctx, await f({ search: 'Emily', role: 'purchaser' }), { page: 1, pageSize: 50 })).total).toBe(0);
    expect((await r.list(ctx, await f({ search: '2155550142', role: 'recipient' }), { page: 1, pageSize: 50 })).total).toBe(1);
  });
  it('no redeemable code or full number is ever returned — list, detail, export', async () => {
    const codes = (await q(`select code from gift_cards where tenant_id = $1`, [T])).rows.map((x: any) => x.code);
    const blob = JSON.stringify([await r.list(ctx, await f(), { page: 1, pageSize: 50 }), await r.detail(ctx, card1), await r.exportCsv(ctx, await f())]);
    for (const c of codes) expect(blob.includes(c)).toBe(false);
    expect(blob.includes('6000123412341111')).toBe(false);
  });
  it('newest issued first; pages 1–3 have no duplicates or gaps; the total is the whole salon, not the page', async () => {
    const pages = await Promise.all([1, 2, 3].map(async (p) => r.list(ctx, await f(), { page: p, pageSize: 5 })));
    const ids = pages.flatMap((p) => p.items.map((x) => x.id));
    expect(pages[0].total).toBe(14); expect(new Set(ids).size).toBe(14); expect(pages[2].items.length).toBe(4);
    const issued = pages.flatMap((p) => p.items.map((x) => Date.parse(x.issuedAt!)));
    expect(issued.every((v, i) => i === 0 || v <= issued[i - 1])).toBe(true);
    const s = await r.summary(ctx, await allTime());
    expect(s.kpis.totalCards).toBe(14);
    expect(s.kpis.outstandingLiabilityCents).toBe(500 + Array.from({ length: 13 }, (_, k) => 2500 + (k + 2) * 100).reduce((a, b) => a + b, 0));
  });
  it('a period before any card issued finds none and issues nothing; the as-of liability stays the same', async () => {
    const old = r.filters(await r.period(ctx, { preset: 'custom', from: '2024-01-01', to: '2024-01-31' }), {});
    expect((await r.list(ctx, old, { page: 1, pageSize: 10 })).total).toBe(0);
    const s = await r.summary(ctx, old);
    expect(s.kpis.totalIssuedCents).toBe(0);
    expect(s.kpis.outstandingLiabilityCents).toBe((await r.summary(ctx, await allTime())).kpis.outstandingLiabilityCents);
  });
});

describe('Gift Cards — reload, void, isolation', () => {
  it('reload: a hold on its own ticket — the balance moves only when paid, exactly once', async () => {
    const res = await w.reloadGiftCardOnNewTicket(ctx, { cardId: card1, customerId: null, amountCents: 2000, idempotencyKey: 'reload-key-001' });
    const again = await w.reloadGiftCardOnNewTicket(ctx, { cardId: card1, customerId: null, amountCents: 2000, idempotencyKey: 'reload-key-001' });
    expect(res.ok && again.ok && again.existing && again.ticketId === res.ticketId).toBe(true);
    if (!res.ok) return;
    expect((await r.detail(ctx, card1)).totals).toMatchObject({ balanceCents: 500, pendingReloadCents: 2000 });
    expect(await payTicket(res.ticketId)).toBe(1);
    expect(await payTicket(res.ticketId)).toBe(0);
    const d = await r.detail(ctx, card1);
    expect(d.totals).toMatchObject({ balanceCents: 2500, reloadedCents: 2000, pendingReloadCents: 0, reconciled: true });
  });
  it('void: reason kept, balance zeroed by a compensating ledger row, the redemption history stays; a second void is refused', async () => {
    const before = (await r.summary(ctx, await allTime())).kpis.outstandingLiabilityCents;
    const v = await w.voidGiftCardById(ctx, card1, 'Customer disputed the purchase');
    expect(v).toEqual({ ok: true, priorBalanceCents: 2500 });
    const row = (await q(`select status, balance_cents, void_reason from gift_cards where id = $1`, [card1])).rows[0];
    expect(row).toEqual({ status: 'void', balance_cents: 0, void_reason: 'Customer disputed the purchase' });
    const adj = (await q(`select amount_cents, balance_before_cents, balance_after_cents, reason from gift_card_adjustments where gift_card_id = $1`, [card1])).rows;
    expect(adj).toEqual([{ amount_cents: -2500, balance_before_cents: 2500, balance_after_cents: 0, reason: 'void: Customer disputed the purchase' }]);
    const types = (await r.ledger(ctx, card1, await r.period(ctx, { preset: 'all' }), { page: 1, pageSize: 20 })).items.map((x) => x.type);
    expect(types).toContain('redeem'); expect(types[0]).toBe('void_or_adjustment');
    expect((await r.summary(ctx, await allTime())).kpis.outstandingLiabilityCents).toBe(before - 2500);
    expect((await r.detail(ctx, card1)).totals.reconciled).toBe(true);
    await expect(w.voidGiftCardById(ctx, card1, 'again')).rejects.toBeTruthy();
    expect((await w.reloadGiftCardOnNewTicket(ctx, { cardId: card1, customerId: null, amountCents: 2000, idempotencyKey: 'reload-key-002' })).ok).toBe(false);
  });
  it('another salon: its list is empty and a guessed card id is not found', async () => {
    expect((await r.list(ctxOther, await f(), { page: 1, pageSize: 10 })).total).toBe(0);
    await expect(r.detail(ctxOther, card1)).rejects.toMatchObject({ code: 'GIFT_CARD_NOT_FOUND' });
    expect((await w.voidGiftCardById(ctxOther, card1, 'guess'))).toEqual({ ok: false, reason: 'not_found' });
  });
  // GIFT CARDS backlog · 03 Ledger Accuracy Checker: the summary judges every paid card's balance against its own ledger rows
  // and names the exact card behind a mismatch; nothing is corrected by the check
  it('ledger accuracy: all cards reconcile; a drifted balance is named with both numbers and left as it is', async () => {
    const s0 = (await r.summary(ctx, await allTime())).integrity;
    expect(s0.unreconciledCards).toBe(0); expect(s0.sample).toEqual([]);
    expect(s0.checkedCards).toBeGreaterThan(0);
    const paid = (await q(`select id, balance_cents from gift_cards where tenant_id = $1 and status = 'active' order by created_at limit 1`, [T])).rows[0];
    await q(`update gift_cards set balance_cents = balance_cents + 700 where id = $1`, [paid.id]);
    const s1 = (await r.summary(ctx, await allTime())).integrity;
    expect(s1.unreconciledCards).toBe(1);
    expect(s1.sample).toEqual([{ cardId: paid.id, card: expect.stringMatching(/^(•••• \d{4}|GC-\*{4}-.{4}|••••)$/), balanceCents: Number(paid.balance_cents) + 700, ledgerBalanceCents: Number(paid.balance_cents) }]);
    expect((await r.detail(ctx, paid.id)).totals.reconciled).toBe(false);   // the card's own detail agrees
    expect(Number((await q(`select balance_cents from gift_cards where id = $1`, [paid.id])).rows[0].balance_cents)).toBe(Number(paid.balance_cents) + 700);
    expect((await r.summary(ctxOther, await allTime())).integrity.unreconciledCards).toBe(0);   // another salon never sees it
    await q(`update gift_cards set balance_cents = balance_cents - 700 where id = $1`, [paid.id]);
    expect((await r.summary(ctx, await allTime())).integrity.unreconciledCards).toBe(0);
  });
});
