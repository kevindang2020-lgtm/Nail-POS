// gift-card-last4.pgtest — which gift card paid (Oct 6 2026; migration 515), on the real schema.
// The redemption's ledger row named neither the ticket nor the payment (the columns existed since 033; nothing wrote
// them), and the payment did not say which card — so the customer display and the refund screen could only say
// "Gift card". Now the ledger row names both, and the payment keeps the card's last four (its printed number's, or its
// code's for a digital card) — never more.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { hashCardNumber } from '@aipowersalon/gift-cards';
import { KyselyCheckoutRepository } from './checkout.kysely.repository';
import { CheckoutService } from './checkout.service';
import { giftCardLast4 } from './gift-card-last4';

const T = 'c9100000-0000-4000-8000-000000000001', B = 'c9100000-0000-4000-8000-000000000002';
const C = 'c9100000-0000-4000-8000-000000000004', U = 'c9100000-0000-4000-8000-000000000005';
const PERMS = ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.cash_payment', 'pos.checkout.gift_card_payment', 'pos.checkout.split_payment', 'pos.checkout.refund'];
const ctx: any = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: PERMS };
const NUMBER = '6011000099994321', DIGITAL = 'GC-7q2k-ab9z';
let pg: any; let svc: CheckoutService; let repo: KyselyCheckoutRepository; let n = 0;
const q = (s: string, p: unknown[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
async function ticket(cents = 5000): Promise<string> {
  n++;
  const id = (await q(`insert into tickets (tenant_id, branch_id, customer_id, status, ticket_number, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents) values ($1,$2,$3,'ready_checkout',$4,$5,0,0,$5,0) returning id`, [T, B, C, 'G' + n, cents]))[0].id;
  await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values ($1,$2,$3,'00000000-0000-0000-0000-000000000000','Gel Manicure',$4,45,$4)`, [T, B, id, cents]);
  return String(id);
}
async function card(code: string, cents: number, number?: string) {
  await q(`insert into gift_cards (tenant_id, branch_id, code, card_number_hash, card_number_last4, initial_balance_cents, balance_cents, status) values ($1,null,$2,$3,$4,$5,$5,'active')`,
    [T, code, number ? hashCardNumber(number) : null, number ? number.slice(-4) : null, cents]);
}
const payments = (ticketId: string) => q(`select id, method, amount_cents, gift_card_last4 from payments where tenant_id = $1 and ticket_id = $2 order by created_at, method`, [T, ticketId]);
const ledger = (code: string) => q(`select x.ticket_id, x.payment_id, x.amount_cents from gift_card_transactions x join gift_cards g on g.id = x.gift_card_id where g.tenant_id = $1 and g.code = $2 and x.type = 'redeem'`, [T, code]);

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Gift LLC','Gift','gift-salon','GIFT01','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'Main','active')`, [B, T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Gia','Card','Gia Card')`, [C, T, B]);
  repo = new KyselyCheckoutRepository(kyselyFor(pg) as never);
  svc = new CheckoutService(repo);
});

describe('which gift card paid', () => {
  it('a card with a printed number: the payment keeps its last four; the ledger row names the ticket and the payment', async () => {
    await card('PHYS-1', 10_000, NUMBER);
    const tk = await ticket();
    await svc.payGiftCard(ctx, tk, { giftCardCode: 'PHYS-1' });
    const [p] = await payments(tk);
    expect(p).toMatchObject({ method: 'gift_card', gift_card_last4: '4321' });
    expect(await ledger('PHYS-1')).toEqual([{ ticket_id: tk, payment_id: p.id, amount_cents: p.amount_cents }]);
  });

  it('a digital card (no number): the last four of its code, upper-cased — never the code', async () => {
    await card(DIGITAL, 10_000);
    const tk = await ticket();
    await svc.payGiftCard(ctx, tk, { giftCardCode: DIGITAL });
    expect((await payments(tk))[0].gift_card_last4).toBe('AB9Z');
  });

  it('part gift card, part cash: the customer display says which card paid, and nothing more of it', async () => {
    await card('PART-2', 2_000, '6011000099991234');
    const tk = await ticket();
    await svc.payGiftCard(ctx, tk, { giftCardCode: 'PART-2' });
    const shown: any = await repo.customerDisplayCheckout(ctx, tk);
    expect(shown.payments).toEqual([{ method: 'gift_card', label: 'Gift card ending 1234', amountCents: 2000 }]);
    expect(JSON.stringify(shown)).not.toMatch(/PART-2|60110000999/);
  });

  it('a split with a gift card: that payment keeps the card, and its ledger row names it', async () => {
    await card('SPLIT-3', 3_000, '6011000099995678');
    const tk = await ticket();
    const due = (await repo.totalsFor(ctx, tk, 'cash'))!.totalDueCents;   // the salon's tax applies; no card in this split
    await svc.paySplit(ctx, tk, { segments: [{ method: 'gift_card', amountCents: 3000, giftCardCode: 'SPLIT-3' }, { method: 'cash', amountCents: due - 3000 }] } as any);
    const rows = await payments(tk);
    const gift = rows.find((r) => r.method === 'gift_card'), cash = rows.find((r) => r.method === 'cash');
    expect(gift?.gift_card_last4).toBe('5678');
    expect(cash?.gift_card_last4).toBeNull();
    expect(await ledger('SPLIT-3')).toEqual([{ ticket_id: tk, payment_id: gift!.id, amount_cents: 3000 }]);
  });

  it('the refund screen says which card a refund goes back to', async () => {
    await card('REF-4', 10_000, '6011000099990042');
    const tk = await ticket();
    await svc.payGiftCard(ctx, tk, { giftCardCode: 'REF-4' });
    const pv: any = await svc.refundAllocationPreview(ctx, tk, 1000);
    expect(pv.allocations).toEqual([expect.objectContaining({ method: 'gift_card', giftCardLast4: '0042', amountToRefundCents: 1000 })]);
    expect(pv.tenders[0].giftCardLast4).toBe('0042');
  });

  it('migration 515: only a gift-card payment carries it, and only four letters or digits', async () => {
    const tk = await ticket();
    const ins = (method: string, l4: string) => q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, status, gift_card_last4) values ($1,$2,$3,$4,100,'approved',$5)`, [T, B, tk, method, l4]);
    await expect(ins('cash', '1234')).rejects.toThrow(/gift_card_last4/);
    await expect(ins('gift_card', '12345')).rejects.toThrow(/gift_card_last4/);
    await expect(ins('gift_card', 'ab9z')).rejects.toThrow(/gift_card_last4/);
    await expect(ins('gift_card', '1234')).resolves.toBeDefined();
  });

  it('giftCardLast4: the printed four, else four from the code, else nothing', () => {
    expect(giftCardLast4('4321', 'X')).toBe('4321');
    expect(giftCardLast4(null, 'gc-7q2k-ab9z')).toBe('AB9Z');
    expect(giftCardLast4('43a1', 'ZZZZ-1')).toBe('ZZZ1');
    expect(giftCardLast4(null, 'A-1')).toBeNull();
    expect(giftCardLast4(undefined)).toBeNull();
  });
});
