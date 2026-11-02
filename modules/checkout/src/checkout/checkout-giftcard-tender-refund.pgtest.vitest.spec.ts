// checkout-giftcard-tender-refund.pgtest — Oct 19 audit item, rebuilt Oct 21 2026: a refund of a payment that was made WITH a
// gift card recorded the refund row and reversed loyalty / commission / stock — but the card itself never got the money
// back. The guest left with a smaller balance than before the visit and no ledger line said why. Now the refund credits
// the card it was paid from (balance + 'refund' ledger row + the refund payment row + the reservation settle, ONE
// transaction, idempotent by refund id); a card that cannot take the credit (voided) refuses the refund up front so no
// money leaves the books; a card at another salon (shared program) is refused for now — the cashier refunds by cash.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyCheckoutRepository } from './checkout.kysely.repository';
import { CheckoutService, ValidationError } from './checkout.service';

const T = '11111111-1111-4111-8111-1111111111c9', B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac9', C = 'dddddddd-dddd-4ddd-8ddd-ddddddddddc9';
const CAT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeec1', SVC = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeec2';
const ctx: any = { tenantId: T, branchId: B, userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc9', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.gift_card_payment', 'pos.checkout.gift_card_issue', 'pos.checkout.refund', 'pos.checkout.approve_refund'] };
let db: any; let svc: CheckoutService;

async function ticket(total = 5000): Promise<string> {
  const tk: any = (await sql`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents) values (${T}, ${B}, ${C}, 'ready_checkout', ${total}, 0, 0, ${total}) returning id`.execute(db)).rows[0];
  await sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values (${T}, ${B}, ${tk.id}, ${SVC}, 'Gel Manicure', ${total}, 45, ${total})`.execute(db);
  return String(tk.id);
}
const card = async (code: string) => (await sql`select balance_cents::int as balance, status from gift_cards where tenant_id = ${T} and code = ${code}`.execute(db)).rows[0] as any;
const ledger = async (code: string) => (await sql`select t.type, t.amount_cents::int as amount, t.balance_after_cents::int as after, t.payment_id from gift_card_transactions t join gift_cards g on g.id = t.gift_card_id where g.code = ${code} order by t.created_at, t.type`.execute(db)).rows as any[];

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'H', 'H Salon', 'h-gcr', 'HGCR9', 'active')`.execute(db);
  await sql`insert into branches (id, tenant_id, name) values (${B}, ${T}, 'Main')`.execute(db);
  await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, status) values (${C}, ${T}, ${B}, 'Ana', 'Lee', 'Ana Lee', 'active')`.execute(db);
  await sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${B}, 'Nails')`.execute(db);
  await sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values (${SVC}, ${T}, ${B}, ${CAT}, 'Gel Manicure', 45, 5000)`.execute(db);
  svc = new CheckoutService(new KyselyCheckoutRepository(db, new OutboxWriter()));
}, 120_000);

describe('a refund of a gift-card payment puts the money back on the card', () => {
  it('full refund: balance restored, a "refund" ledger row names the refund payment, the card is active again', async () => {
    await svc.issueGiftCard(ctx, { code: 'GC-REF-1', amountCents: 5000 } as any);
    const id = await ticket(5000);
    const paid = await svc.payGiftCard(ctx, id, { giftCardCode: 'GC-REF-1' });
    expect(await card('GC-REF-1')).toEqual({ balance: 0, status: 'redeemed' });
    const r: any = await svc.refund(ctx, paid.payment.paymentId, { reason: 'guest changed her mind' });
    expect(r).toMatchObject({ status: 'refunded' });
    expect(await card('GC-REF-1')).toEqual({ balance: 5000, status: 'active' });
    const led = await ledger('GC-REF-1');
    expect(led.map((l) => l.type)).toEqual(['issue', 'redeem', 'refund']);
    expect(led[2]).toMatchObject({ amount: 5000, after: 5000, payment_id: r.refundId });
  });
  it('partial refund: only that amount goes back; a second partial refund credits again; the cap still holds', async () => {
    await svc.issueGiftCard(ctx, { code: 'GC-REF-2', amountCents: 8000 } as any);
    const id = await ticket(6000);
    const paid = await svc.payGiftCard(ctx, id, { giftCardCode: 'GC-REF-2' });
    const used = paid.payment.amountCents;   // the ticket's due incl. the salon's tax — whatever the card actually paid
    expect((await card('GC-REF-2')).balance).toBe(8000 - used);
    await svc.refund(ctx, paid.payment.paymentId, { reason: 'one service redone', amountCents: 1500 });
    expect((await card('GC-REF-2')).balance).toBe(8000 - used + 1500);
    await svc.refund(ctx, paid.payment.paymentId, { reason: 'and the other', amountCents: used - 1500 });
    expect((await card('GC-REF-2')).balance).toBe(8000);
    await expect(svc.refund(ctx, paid.payment.paymentId, { reason: 'too much', amountCents: 1 })).rejects.toBeInstanceOf(ValidationError);
    expect((await card('GC-REF-2')).balance).toBe(8000);
  });
  it('a voided card cannot take the credit: the refund is refused BEFORE anything is written (no refund row, no reservation)', async () => {
    await svc.issueGiftCard(ctx, { code: 'GC-REF-3', amountCents: 5000 } as any);
    const id = await ticket(5000);
    const paid = await svc.payGiftCard(ctx, id, { giftCardCode: 'GC-REF-3' });
    await sql`update gift_cards set status = 'void' where tenant_id = ${T} and code = 'GC-REF-3'`.execute(db);
    await expect(svc.refund(ctx, paid.payment.paymentId, { reason: 'x' })).rejects.toThrow(/gift card/i);
    expect((await sql`select count(*)::int as n from payments where ticket_id = ${id} and status = 'refunded'`.execute(db)).rows[0]).toEqual({ n: 0 });
    expect((await sql`select count(*)::int as n from payment_refunds where tenant_id = ${T} and payment_id = ${paid.payment.paymentId} and status <> 'released'`.execute(db)).rows[0]).toEqual({ n: 0 });
    expect(await card('GC-REF-3')).toEqual({ balance: 0, status: 'void' });
  });
});

describe('the credit and the refund row are one unit', () => {
  it('a card voided between the check and the write rolls the WHOLE refund back: no refund row, reservation released, balance untouched', async () => {
    await svc.issueGiftCard(ctx, { code: 'GC-REF-4', amountCents: 5000 } as any);
    const id = await ticket(5000);
    const paid = await svc.payGiftCard(ctx, id, { giftCardCode: 'GC-REF-4' });
    const repo: any = (svc as any).repo;
    const real = repo.giftCardForPayment.bind(repo);
    repo.giftCardForPayment = async (...a: any[]) => { const r = await real(...a); await sql`update gift_cards set status = 'void' where tenant_id = ${T} and code = 'GC-REF-4'`.execute(db); return r; };
    try { await expect(svc.refund(ctx, paid.payment.paymentId, { reason: 'x' })).rejects.toThrow(/gift card/i); } finally { repo.giftCardForPayment = real; }
    expect((await sql`select count(*)::int as n from payments where ticket_id = ${id} and status = 'refunded'`.execute(db)).rows[0]).toEqual({ n: 0 });
    expect((await sql`select status from payment_refunds where tenant_id = ${T} and payment_id = ${paid.payment.paymentId}`.execute(db)).rows).toEqual([]);   // released = gone, nothing reserved
    expect(await card('GC-REF-4')).toEqual({ balance: 0, status: 'void' });
  });
});
