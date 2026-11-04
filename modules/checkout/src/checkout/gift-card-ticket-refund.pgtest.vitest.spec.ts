// gift-card-ticket-refund.pgtest — Gift Cards guide (Nov 4 2026), against the REAL schema: the value a ticket put on gift
// cards (a card SOLD on it, a RELOAD it credited), taken back by a refund — never below zero, once per refund payment, the
// ledger and the adjustment record in one transaction; a fully reversed sale card ends REFUNDED. A card with an unpaid
// reload is reported (a void would strand it), and a paid reload that cannot be credited is no longer dropped in silence.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyCheckoutRepository } from './checkout.kysely.repository';

const P = 'f8a2b3c5-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2'), BX = id('b9'), U = id('e1');
const perms = ['pos.checkout.view', 'pos.customers.view', 'pos.checkout.gift_card_issue', 'pos.checkout.void'];
const ctx = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: perms } as any;
const ctxB2 = { ...ctx, branchId: B2 };
const ctxOther = { ...ctx, tenantId: T2, branchId: BX };
const TZ = 'America/New_York';
let pg: any; let db: any; let w: KyselyCheckoutRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
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

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Lotus LLC','Lotus','gcr-lotus','GCR001','active'), ($2,'Other LLC','Other','gcr-other','GCR002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Cherry Hill','active',$6), ($3,$2,'Marlton','active',$6), ($4,$5,'Elsewhere','active',$6)`, [B, T, B2, BX, T2, TZ]);
  await q(`insert into users (id, tenant_id, email, full_name, role, status) values ($1,$2,'o@x.test','Olive Owner','OWNER','active')`, [U, T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display) values ($1,$2,$3,'John','Smith','John Smith','+18565551234','(856) 555-1234')`, [id('c1'), T, B]);
  db = kyselyFor(pg); w = new KyselyCheckoutRepository(db as never);
}, 180_000);
const balance = async (cardId: string) => (await q(`select balance_cents, status from gift_cards where id = $1`, [cardId])).rows[0];
let sale = { cardId: '', ticketId: '' };

describe("a refund takes a ticket's gift-card value back", () => {
  it('a sold $100 card: the value on the ticket, then $40 back, then the rest — the card ends refunded', async () => {
    const a = await w.issueGiftCardOnNewTicket(ctx, { idempotencyKey: 'gcr-issue-1', customerId: id('c1'), amountCents: 10000, code: 'GC-GCRTEST001', reference: 'GC-****-0001', cardNumber: '6000123412340001', physical: false });
    if (!a.ok) throw new Error('issue failed');
    sale = { cardId: a.cardId, ticketId: a.ticketId };
    expect(await w.giftCardValueOnTicket(ctx, a.ticketId)).toEqual([]);   // unpaid: nothing was put on the card yet
    await payTicket(a.ticketId);
    expect(await w.giftCardValueOnTicket(ctx, a.ticketId)).toEqual([expect.objectContaining({ giftCardId: a.cardId, kind: 'sale', creditedCents: 10000, reversedCents: 0, balanceCents: 10000, status: 'active' })]);
    expect(await w.reverseGiftCardValueForRefund(ctx, a.ticketId, 4000, id('f1'), 'partial')).toEqual({ reversedCents: 4000, shortCents: 0 });
    expect(await w.reverseGiftCardValueForRefund(ctx, a.ticketId, 4000, id('f1'), 'partial')).toEqual({ reversedCents: 0, shortCents: 0 });   // the same refund again: nothing twice
    expect(await balance(a.cardId)).toEqual({ balance_cents: 6000, status: 'active' });
    expect(await w.reverseGiftCardValueForRefund(ctx, a.ticketId, 9000, id('f2'), 'the rest')).toEqual({ reversedCents: 6000, shortCents: 0 });   // capped at what the ticket put on it
    expect(await balance(a.cardId)).toEqual({ balance_cents: 0, status: 'refunded' });
    const led = (await q(`select type, amount_cents, balance_after_cents from gift_card_transactions where gift_card_id = $1 and type = 'cancel' order by created_at, amount_cents`, [a.cardId])).rows;
    expect(led.map((x: any) => x.amount_cents).sort()).toEqual([-4000, -6000].sort());
    const adj = (await q(`select amount_cents, balance_before_cents, balance_after_cents, reason, ledger_entry_id is not null as linked from gift_card_adjustments where gift_card_id = $1 order by balance_before_cents desc`, [a.cardId])).rows;
    expect(adj).toEqual([{ amount_cents: -4000, balance_before_cents: 10000, balance_after_cents: 6000, reason: 'ticket refund: partial', linked: true }, { amount_cents: -6000, balance_before_cents: 6000, balance_after_cents: 0, reason: 'ticket refund: the rest', linked: true }]);
    expect((await w.giftCardValueOnTicket(ctx, a.ticketId))[0]).toMatchObject({ reversedCents: 10000 });
  });

  it('never below zero: what was spent is reported short', async () => {
    const a = await w.issueGiftCardOnNewTicket(ctx, { idempotencyKey: 'gcr-issue-2', customerId: id('c1'), amountCents: 5000, code: 'GC-GCRTEST002', reference: 'GC-****-0002', cardNumber: '6000123412340002', physical: false });
    if (!a.ok) throw new Error('issue failed');
    await payTicket(a.ticketId);
    await q(`update gift_cards set balance_cents = 1500, status = 'partially_redeemed' where id = $1`, [a.cardId]);   // $35 spent
    expect(await w.reverseGiftCardValueForRefund(ctx, a.ticketId, 5000, id('f3'), 'spent')).toEqual({ reversedCents: 1500, shortCents: 3500 });
    expect(await balance(a.cardId)).toEqual({ balance_cents: 0, status: 'partially_redeemed' });   // value is still owed back: not "refunded"
  });

  it('a reload credited by a ticket comes back off; a voided card is skipped', async () => {
    const card = (await w.issueGiftCardOnNewTicket(ctx, { idempotencyKey: 'gcr-issue-3', customerId: id('c1'), amountCents: 3000, code: 'GC-GCRTEST003', reference: 'GC-****-0003', cardNumber: '6000123412340003', physical: false }));
    if (!card.ok) throw new Error('issue failed');
    await payTicket(card.ticketId);
    const rl = await w.reloadGiftCardOnNewTicket(ctx, { cardId: card.cardId, customerId: null, amountCents: 2000, idempotencyKey: 'gcr-reload-1' });
    if (!rl.ok) throw new Error('reload failed');
    expect(await w.pendingGiftCardReloadTicket(ctx, card.cardId)).toBe(rl.ticketId);   // unpaid reload: a void must wait
    await q(`update tickets set status = 'paid' where id = $1`, [rl.ticketId]);
    await payTicket(rl.ticketId);
    expect(await w.pendingGiftCardReloadTicket(ctx, card.cardId)).toBeNull();
    expect(await w.giftCardValueOnTicket(ctx, rl.ticketId)).toEqual([expect.objectContaining({ kind: 'reload', creditedCents: 2000, balanceCents: 5000 })]);
    expect(await w.reverseGiftCardValueForRefund(ctx, rl.ticketId, 2000, id('f4'), 'reload refund')).toEqual({ reversedCents: 2000, shortCents: 0 });
    expect(await balance(card.cardId)).toEqual({ balance_cents: 3000, status: 'active' });   // the sale's own $30 stays
    await w.voidGiftCardById(ctx, card.cardId, 'customer request');
    expect(await w.reverseGiftCardValueForRefund(ctx, card.ticketId, 3000, id('f5'), 'after void')).toEqual({ reversedCents: 0, shortCents: 0 });
  });

  it('another salon sees none of it', async () => {
    expect(await w.giftCardValueOnTicket(ctxOther, sale.ticketId)).toEqual([]);
    expect(await w.reverseGiftCardValueForRefund(ctxOther, sale.ticketId, 100, id('f6'), 'x')).toEqual({ reversedCents: 0, shortCents: 0 });
  });
});

describe('a received card is linked to the recipient when they are already this salon\'s customer', () => {
  it('one customer with that phone → linked; an unknown phone → not linked (never guessed by name)', async () => {
    const a = await w.issueGiftCardOnNewTicket(ctx, { idempotencyKey: 'gcr-issue-rcpt1', customerId: id('c1'), amountCents: 2500, code: 'GC-GCRTEST010', reference: 'GC-****-0010', cardNumber: '6000123412340010', physical: false,
      recipient: { name: 'Someone Else', phone: '856-555-1234' } });
    const b = await w.issueGiftCardOnNewTicket(ctx, { idempotencyKey: 'gcr-issue-rcpt2', customerId: id('c1'), amountCents: 2500, code: 'GC-GCRTEST011', reference: 'GC-****-0011', cardNumber: '6000123412340011', physical: false,
      recipient: { name: 'John Smith', phone: '609-555-0000' } });
    if (!a.ok || !b.ok) throw new Error('issue failed');
    const link = async (cardId: string) => (await q(`select customer_id from gift_card_recipients where gift_card_id = $1`, [cardId])).rows[0].customer_id;
    expect(await link(a.cardId)).toBe(id('c1'));
    expect(await link(b.cardId)).toBeNull();
  });
});

describe('Adjust balance (a manager decision with a reason)', () => {
  it('down and up with before/after records; never below zero; an empty card reads redeemed; a closed card is refused', async () => {
    const a = await w.issueGiftCardOnNewTicket(ctx, { idempotencyKey: 'gcr-issue-adj', customerId: id('c1'), amountCents: 3000, code: 'GC-GCRTEST020', reference: 'GC-****-0020', cardNumber: '6000123412340020', physical: false });
    if (!a.ok) throw new Error('issue failed');
    expect(await w.adjustGiftCardById(ctx, a.cardId, -500, 'x')).toEqual({ ok: false, reason: 'not_adjustable' });   // unpaid: nothing to adjust yet
    await payTicket(a.ticketId);
    expect(await w.adjustGiftCardById(ctx, a.cardId, -3500, 'too much')).toEqual({ ok: false, reason: 'below_zero' });
    expect(await w.adjustGiftCardById(ctx, a.cardId, -3000, 'charged on the wrong card')).toEqual({ ok: true, beforeCents: 3000, afterCents: 0, status: 'redeemed' });
    expect(await w.adjustGiftCardById(ctx, a.cardId, 1000, 'goodwill credit')).toEqual({ ok: true, beforeCents: 0, afterCents: 1000, status: 'active' });
    const adj = (await q(`select amount_cents, balance_before_cents, balance_after_cents, reason from gift_card_adjustments where gift_card_id = $1 order by created_at, balance_before_cents desc`, [a.cardId])).rows;
    expect(adj).toEqual([{ amount_cents: -3000, balance_before_cents: 3000, balance_after_cents: 0, reason: 'charged on the wrong card' }, { amount_cents: 1000, balance_before_cents: 0, balance_after_cents: 1000, reason: 'goodwill credit' }]);
    expect(await w.adjustGiftCardById(ctxOther, a.cardId, 100, 'other salon')).toEqual({ ok: false, reason: 'not_found' });
    await w.voidGiftCardById(ctx, a.cardId, 'closing it');
    expect(await w.adjustGiftCardById(ctx, a.cardId, 100, 'after void')).toEqual({ ok: false, reason: 'not_adjustable' });
  });
});
