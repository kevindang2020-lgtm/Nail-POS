// invoices-ledger.pgtest — Invoices mandate (Oct 29 2026), against the REAL schema.
//   • the two photo defects: dates leave the server as 'YYYY-MM-DD' (or null) — never a Date string the POS cannot parse —
//     and an invoice without a customer says "unlinked" (a manager can link it, audited; nothing is guessed from a name);
//   • New Invoice: a customer of THIS salon is required, the bill-to snapshot is kept, INV-#### numbering, due ≥ issue,
//     idempotent on the request key;
//   • search: exact invoice # first, a short digit fragment is an invoice number (never a phone match), formatted / bare /
//     country-code phones, email, partial names, never another salon; status / date-basis / amount filters, newest first;
//   • money: Record Payment is an immutable entry ≤ balance (partial → partially_paid → paid), idempotent; a draft cannot be
//     paid; KPIs: Outstanding is net of payments, Overdue is derived, Paid is cash collected; void needs a reason and is
//     refused once money was received; the legacy status toggle can no longer mark an invoice paid.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { InvoicesLedgerRepository } from './invoices-ledger.repository';
import { KyselyInvoicesRepository } from './invoices.kysely.repository';
import { InvoicesService } from './invoices.service';
import { renderInvoicePdf } from './invoice-pdf';
import { FinanceError, resolvePeriod, pageReq, addDaysYmd } from '../finance-screens/finance-scope';

const P = 'e1b2c3d4-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2');
const key = (n: number) => `e1b2c3d4-0000-4000-9000-${String(n).padStart(12, '0')}`;
const ctx = { tenantId: T, branchId: B, userId: id('ee1'), role: 'OWNER', permissions: [] as string[] };
const ctx2 = { ...ctx, tenantId: T2, branchId: B2 };
let pg: any; let db: any; let repo: InvoicesLedgerRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof FinanceError ? e.code : String((e as Error).message); } }
const audited: { action: string; resourceId: string | null | undefined }[] = [];
const auditor = { record: async (_c: any, i: any) => { audited.push({ action: i.action, resourceId: i.resourceId }); } };
const TZ = 'America/New_York';
const ALL = () => resolvePeriod({ preset: 'all' }, TZ, { allowAll: true });
const today = () => resolvePeriod({ preset: 'today' }, TZ).today;
const line = (description: string, quantity: number, unitPriceCents: number) => ({ description, quantity, unitPriceCents });
const ann = id('c01'), bob = id('c02'), cat = id('c03'), xena = id('c99');

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Lotus LLC','Lotus Nails','iv-lotus','IVL001','active'), ($2,'Other LLC','Other Nails','iv-other','IVL002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone, address, city, state, zip) values ($1,$2,'Main','active',$5,'12 Elm St','Cherry Hill','NJ','08002'), ($3,$4,'Other','active',$5,null,null,null,null)`, [B, T, B2, T2, TZ]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, email) values
    ($1,$5,$6,'Ann','Lee','Ann Lee','+18565551234','(856) 555-1234','ann@example.com'), ($2,$5,$6,'Bob','Smith','Bob Smith','+12155550002',null,'bob@example.com'),
    ($3,$5,$6,'Cat','Smith','Cat Smith','+12155550003',null,null), ($4,$7,$8,'Xena','Lee','Xena Lee','+18565551234',null,'ann@example.com')`, [ann, bob, cat, xena, T, B, T2, B2]);
  // the photo's legacy rows: INV-0001 void, INV-0002 sent — neither linked to a customer (the "—" defect)
  await q(`insert into invoices (id, tenant_id, branch_id, invoice_number, status, issue_date, due_date, subtotal_cents, total_cents, created_at) values
    ($1,$3,$4,'INV-0001','void','2026-10-01',null,2000,2000, now() - interval '20 days'), ($2,$3,$4,'INV-0002','sent','2026-10-02','2026-10-09',1000,1000, now() - interval '19 days')`, [id('901'), id('902'), T, B]);
  await q(`insert into invoices (id, tenant_id, branch_id, invoice_number, status, issue_date, subtotal_cents, total_cents, customer_id, bill_to_name) values ($1,$2,$3,'INV-0001','sent','2026-10-03',5555,5555,$4,'Xena Lee')`, [id('999'), T2, B2, xena]);
  db = kyselyFor(pg); repo = new InvoicesLedgerRepository(db, auditor);
}, 180_000);

describe('Invoices — the photo defects', () => {
  it('dates are YYYY-MM-DD or null (never a Date string); unlinked invoices say so; overdue is derived', async () => {
    const l = await repo.list(ctx, repo.filters(ALL(), {}), pageReq({}));
    const i2 = l.items.find((x) => x.invoiceNumber === 'INV-0002')!;
    expect(i2.issueDate).toBe('2026-10-02'); expect(i2.dueDate).toBe('2026-10-09');
    expect(l.items.find((x) => x.invoiceNumber === 'INV-0001')!.dueDate).toBeNull();
    expect(i2.customer.state).toBe('unlinked'); expect(i2.customer.name).toBeNull();
    expect(i2.displayStatus).toBe('overdue'); expect(i2.status).toBe('sent');
    expect(l.items.find((x) => x.invoiceNumber === 'INV-0001')!.balanceCents).toBe(0);   // void: nothing collectible
  });
  it('link an unlinked invoice to a customer (audited); a second link is refused; another salon\'s customer is not found', async () => {
    expect(await code(repo.linkCustomer(ctx, id('902'), { customerId: xena }))).toBe('INVOICE_CUSTOMER_NOT_FOUND');
    const d = await repo.linkCustomer(ctx, id('902'), { customerId: ann });
    expect(d.invoice.customer.state).toBe('linked'); expect(d.invoice.customer.name).toBe('Ann Lee'); expect(d.invoice.customer.phone).toBe('(856) 555-1234');
    expect(await code(repo.linkCustomer(ctx, id('902'), { customerId: bob }))).toBe('INVOICE_ALREADY_LINKED');
    expect(audited.some((a) => a.action === 'invoice_customer_linked' && a.resourceId === id('902'))).toBe(true);
  });
});

describe('Invoices — New Invoice', () => {
  it('requires a customer of this salon, validates dates and amounts, numbers INV-0003, keeps the bill-to snapshot, is idempotent', async () => {
    expect(await code(repo.create(ctx, { idempotencyKey: key(1), customerId: xena, lines: [line('Mani', 1, 3000)] }))).toBe('INVOICE_CUSTOMER_NOT_FOUND');
    expect(await code(repo.create(ctx, { idempotencyKey: key(1), customerId: bob, lines: [] }))).toBe('INVOICE_LINES_REQUIRED');
    expect(await code(repo.create(ctx, { idempotencyKey: key(1), customerId: bob, lines: [line('Mani', 1, 3000)], issueDate: '2026-10-10', dueDate: '2026-10-01' }))).toBe('INVOICE_DATES_INVALID');
    expect(await code(repo.create(ctx, { idempotencyKey: key(1), customerId: bob, lines: [line('Mani', 1, 3000)], discountCents: 5000 }))).toBe('INVOICE_AMOUNT_INVALID');
    expect(await code(repo.create(ctx, { idempotencyKey: 'nope', customerId: bob, lines: [line('Mani', 1, 3000)] }))).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const a = await repo.create(ctx, { idempotencyKey: key(2), customerId: bob, lines: [line('Gel manicure', 2, 3500), line('Nail art', 1, 1000)], taxCents: 560, discountCents: 500, dueDate: addDaysYmd(today(), 14) });
    expect(a.invoice.invoiceNumber).toBe('INV-0003'); expect(a.invoice.status).toBe('draft');
    expect(a.invoice.subtotalCents).toBe(8000); expect(a.invoice.totalCents).toBe(8060); expect(a.invoice.issueDate).toBe(today());
    expect(a.invoice.customer.name).toBe('Bob Smith'); expect(a.invoice.customer.phone).toBe('(215) 555-0002');
    expect(a.lines.map((l) => l.lineTotalCents)).toEqual([7000, 1000]);
    const again = await repo.create(ctx, { idempotencyKey: key(2), customerId: bob, lines: [line('Gel manicure', 2, 3500)] });
    expect(again.duplicate).toBe(true); expect(again.invoice.id).toBe(a.invoice.id);
    // the snapshot does not follow a later profile change
    await q(`update customers set full_name = 'Robert Smith' where id = $1`, [bob]);
    const d = await repo.detail(ctx, a.invoice.id);
    expect(d?.invoice.customer.name).toBe('Bob Smith'); expect(d?.invoice.customer.profileName).toBe('Robert Smith');
    // send = issue; a second send is a no-op
    const s = await repo.send(ctx, a.invoice.id);
    expect(s.invoice.status).toBe('sent'); expect(s.sent).toBe(true);
    expect((await repo.send(ctx, a.invoice.id)).sent).toBe(false);
    // the next one numbers on
    const c = await repo.create(ctx, { idempotencyKey: key(3), customerId: cat, lines: [line('Pedicure', 1, 4500)], send: true });
    expect(c.invoice.invoiceNumber).toBe('INV-0004'); expect(c.invoice.status).toBe('sent');
  });
  it('edit only a draft', async () => {
    const d = await repo.create(ctx, { idempotencyKey: key(4), customerId: ann, lines: [line('Polish change', 1, 1500)] });
    const e = await repo.edit(ctx, d.invoice.id, { lines: [line('Polish change', 2, 1500)] });
    expect(e.invoice.totalCents).toBe(3000);
    const sent = (await repo.list(ctx, repo.filters(ALL(), { search: 'INV-0003' }), pageReq({}))).items[0];
    expect(await code(repo.edit(ctx, sent.id, { lines: [line('X', 1, 1)] }))).toBe('INVOICE_NOT_EDITABLE');
  });
});

describe('Invoices — search, filters, paging', () => {
  const s = async (search: string, extra: Record<string, unknown> = {}) => (await repo.list(ctx, repo.filters(ALL(), { search, ...extra }), pageReq({}))).items.map((x) => x.invoiceNumber);
  it('invoice number exact first; a digit fragment is an invoice number, never a phone', async () => {
    expect((await s('INV-0002'))[0]).toBe('INV-0002');
    expect(await s('0002')).toEqual(['INV-0002']);
    expect(await s('inv-0004')).toEqual(['INV-0004']);
    expect((await s('000')).length).toBeGreaterThanOrEqual(4);
  });
  it('phone formatted / bare / with country code, email, partial names — never another salon', async () => {
    expect(await s('(856) 555-1234')).toEqual(['INV-0005', 'INV-0002']);
    expect(await s('8565551234')).toEqual(['INV-0005', 'INV-0002']);
    expect(await s('+1 856 555 1234')).toEqual(['INV-0005', 'INV-0002']);
    expect(await s('ann@example.com')).toEqual(['INV-0005', 'INV-0002']);
    expect(await s('Smith')).toEqual(['INV-0004', 'INV-0003']);
    expect(await s('cat smith')).toEqual(['INV-0004']);
    expect(await s('Xena')).toEqual([]);
    expect((await repo.list(ctx2, repo.filters(ALL(), { search: 'Ann' }), pageReq({}))).total).toBe(0);
  });
  it('status / amount / date-basis filters; newest created first; paging', async () => {
    expect(await s('', { status: 'draft' })).toEqual(['INV-0005']);
    expect(await s('', { status: 'overdue' })).toEqual(['INV-0002']);
    expect(await s('', { status: 'sent' })).toEqual(['INV-0004', 'INV-0003']);
    expect(await s('', { amountMin: 4000, amountMax: 9000 })).toEqual(['INV-0004', 'INV-0003']);
    expect(await code(Promise.resolve().then(() => repo.filters(ALL(), { amountMin: 500, amountMax: 100 })))).toBe('AMOUNT_RANGE_INVALID');
    const oct = resolvePeriod({ preset: 'custom', from: '2026-10-01', to: '2026-10-02' }, TZ);
    expect((await repo.list(ctx, repo.filters(oct, {}), pageReq({}))).items.map((x) => x.invoiceNumber)).toEqual(['INV-0002', 'INV-0001']);
    expect((await repo.list(ctx, repo.filters(oct, { dateField: 'due' }), pageReq({}))).total).toBe(0);
    const p1 = await repo.list(ctx, repo.filters(ALL(), {}), { page: 1, pageSize: 2 });
    const p3 = await repo.list(ctx, repo.filters(ALL(), {}), { page: 3, pageSize: 2 });
    expect(p1.items[0].invoiceNumber).toBe('INV-0005'); expect(p1.pageCount).toBe(3); expect(p3.items.map((x) => x.invoiceNumber)).toEqual(['INV-0001']);
    expect((await repo.list(ctx, repo.filters(ALL(), { sort: 'amount_desc' }), pageReq({}))).items[0].invoiceNumber).toBe('INV-0003');
  });
});

describe('Invoices — payments, KPIs, void', () => {
  it('Record Payment: ≤ balance, partial → partially_paid → paid, idempotent, immutable; a draft cannot be paid', async () => {
    const inv = (await repo.list(ctx, repo.filters(ALL(), { search: 'INV-0003' }), pageReq({}))).items[0];   // 80.60 sent
    const draft = (await repo.list(ctx, repo.filters(ALL(), { search: 'INV-0005' }), pageReq({}))).items[0];
    expect(await code(repo.recordPayment(ctx, draft.id, { amountCents: 100, paidOn: today(), method: 'cash', idempotencyKey: key(10) }))).toBe('INVOICE_NOT_PAYABLE');
    expect(await code(repo.recordPayment(ctx, inv.id, { amountCents: 9000, paidOn: today(), method: 'cash', idempotencyKey: key(11) }))).toBe('INVOICE_PAYMENT_EXCEEDS_BALANCE');
    expect(await code(repo.recordPayment(ctx, inv.id, { amountCents: 0, paidOn: today(), method: 'cash', idempotencyKey: key(11) }))).toBe('INVOICE_PAYMENT_INVALID');
    expect(await code(repo.recordPayment(ctx, inv.id, { amountCents: 100, paidOn: addDaysYmd(today(), 3), method: 'cash', idempotencyKey: key(11) }))).toBe('INVOICE_PAYMENT_INVALID');
    expect(await code(repo.recordPayment(ctx, inv.id, { amountCents: 100, paidOn: today(), method: 'bitcoin', idempotencyKey: key(11) }))).toBe('VALIDATION_FAILED');
    const p1 = await repo.recordPayment(ctx, inv.id, { amountCents: 3060, paidOn: today(), method: 'card_external', reference: 'AUTH 123', idempotencyKey: key(12) });
    expect(p1.invoice.status).toBe('partially_paid'); expect(p1.invoice.balanceCents).toBe(5000); expect(p1.invoice.paidCents).toBe(3060);
    const dup = await repo.recordPayment(ctx, inv.id, { amountCents: 3060, paidOn: today(), method: 'card_external', idempotencyKey: key(12) });
    expect(dup.duplicate).toBe(true); expect(dup.invoice.paidCents).toBe(3060);
    const p2 = await repo.recordPayment(ctx, inv.id, { amountCents: 5000, paidOn: today(), method: 'cash', idempotencyKey: key(13) });
    expect(p2.invoice.status).toBe('paid'); expect(p2.invoice.balanceCents).toBe(0); expect(p2.payments.length).toBe(2);
    expect(await code(repo.recordPayment(ctx, inv.id, { amountCents: 1, paidOn: today(), method: 'cash', idempotencyKey: key(14) }))).toBe('INVOICE_NOT_PAYABLE');
    expect(await code(q(`update invoice_payments set amount_cents = 1 where invoice_id = $1`, [inv.id]))).toMatch(/immutable/);
    expect(await code(repo.recordPayment(ctx2, inv.id, { amountCents: 1, paidOn: today(), method: 'cash', idempotencyKey: key(15) }))).toBe('INVOICE_NOT_FOUND');
  });
  it('KPIs: Outstanding net of payments (issued, non-void), Overdue derived, Paid = cash collected, Drafts, Total incl. void', async () => {
    const s = await repo.summary(ctx, repo.filters(ALL(), {}));
    // outstanding: INV-0002 10.00 (overdue) + INV-0004 45.00; INV-0003 is paid; INV-0005 draft; INV-0001 void
    expect(s.kpis.outstandingCents).toBe(1000 + 4500); expect(s.kpis.outstandingInvoices).toBe(2);
    expect(s.kpis.overdueInvoices).toBe(1); expect(s.kpis.overdueCents).toBe(1000);
    expect(s.kpis.cashCollectedCents).toBe(8060); expect(s.kpis.paidInvoices).toBe(1);
    expect(s.kpis.drafts).toBe(1); expect(s.kpis.total).toBe(5); expect(s.kpis.voided).toBe(1);
    // Invoices guide audit (Nov 4 2026): a search narrows the Paid card to the payments of the matching invoices
    expect((await repo.summary(ctx, repo.filters(ALL(), { search: 'INV-0003' }))).kpis.cashCollectedCents).toBe(8060);
    expect((await repo.summary(ctx, repo.filters(ALL(), { search: 'INV-0004' }))).kpis.cashCollectedCents).toBe(0);
    // the status filter narrows the list, not the cards
    const s2 = await repo.summary(ctx, repo.filters(ALL(), { status: 'paid' }));
    expect(s2.kpis.total).toBe(5);
  });
  it('void: a reason is required, a paid invoice is refused (refund / credit instead), a draft voids and is final', async () => {
    const paid = (await repo.list(ctx, repo.filters(ALL(), { search: 'INV-0003' }), pageReq({}))).items[0];
    const draft = (await repo.list(ctx, repo.filters(ALL(), { search: 'INV-0005' }), pageReq({}))).items[0];
    expect(await code(repo.void(ctx, draft.id, ''))).toBe('INVOICE_VOID_REASON_REQUIRED');
    expect(await code(repo.void(ctx, paid.id, 'customer disputes'))).toBe('INVOICE_HAS_PAYMENTS');
    const v = await repo.void(ctx, draft.id, 'Created by mistake');
    expect(v.invoice.status).toBe('void'); expect(v.invoice.voidReason).toBe('Created by mistake'); expect(v.lines.length).toBe(1);   // history kept
    expect(await code(repo.send(ctx, draft.id))).toBe('INVOICE_STATE_INVALID');
    expect(audited.some((a) => a.action === 'invoice_voided' && a.resourceId === draft.id)).toBe(true);
  });
  it('the PDF carries the server figures (English) and the export totals every filtered row', async () => {
    const paid = (await repo.list(ctx, repo.filters(ALL(), { search: 'INV-0003' }), pageReq({}))).items[0];
    const d = (await repo.detail(ctx, paid.id))!;
    const pdf = renderInvoicePdf({ salon: await repo.salonIdentity(ctx), invoice: d.invoice, lines: d.lines, payments: d.payments, generatedAt: new Date().toISOString() });
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    for (const t of ['(INV-0003)', '(Lotus Nails)', '(Bob Smith)', '($80.60)', '(PAID)', '(Gel manicure)']) expect(text).toContain(t);
    const csv = await repo.exportCsv(ctx, repo.filters(ALL(), {}));
    expect(csv).toContain('Invoices,5'); expect(csv).toContain('Balance due,55.00');
  });
  it('customer lookup: this salon only, by name / phone / email', async () => {
    expect((await repo.customerLookup(ctx, 'Lee')).items.map((x) => x.name)).toEqual(['Ann Lee']);
    expect((await repo.customerLookup(ctx, '5551234')).items.map((x) => x.name)).toEqual(['Ann Lee']);
    expect((await repo.customerLookup(ctx2, 'ann@')).items.map((x) => x.name)).toEqual(['Xena Lee']);
  });
});

// Invoices guide audit (Nov 4 2026): the legacy POST /pos/invoices took another salon's customerId and the read showed that
// customer's name. The service refuses it, the database refuses it (793), and the read joins customers on the salon.
describe('the legacy invoice route stays inside the salon', () => {
  it("another salon's customer is refused by the service and by the database; this salon's is accepted", async () => {
    const legacy = new InvoicesService(new KyselyInvoicesRepository(db));
    await expect(legacy.create(ctx as any, { customerId: xena, lines: [line('Gel set', 1, 4500)] } as any)).rejects.toMatchObject({ apiCode: 'INVOICE_CUSTOMER_NOT_FOUND' });
    await expect(q(`insert into invoices (tenant_id, branch_id, invoice_number, status, customer_id) values ($1,$2,'INV-X-1','draft',$3)`, [T, B, xena])).rejects.toThrow();
    const ok = await legacy.create(ctx as any, { customerId: ann, lines: [line('Gel set', 1, 4500)] } as any);
    expect(ok.customerName).toBe('Ann Lee');
    expect((await legacy.get(ctx as any, ok.id)).customerName).toBe('Ann Lee');
  });
});


// Invoices guide (Nov 4 2026) §13: an issued invoice is corrected with an immutable credit note; the part of a credit beyond
// the balance is money the customer already paid, refunded (method required) in the same entry; nothing is zeroed or erased
describe('Invoices — credit notes and refunds', () => {
  it('credit up to the balance lowers it; beyond it refunds the overpaid part; credited in full → credited; idempotent, immutable, audited', async () => {
    const before = await repo.summary(ctx, repo.filters(ALL(), {}));
    const made = await repo.create(ctx, { customerId: bob, lines: [line('Gel set', 1, 10000)], send: true, idempotencyKey: key(800) });
    const inv = made.invoice.id;
    expect(made.invoice.actions.credit).toBe(true);
    expect(await code(repo.issueCredit(ctx, inv, { amountCents: 2000, reason: 'x', idempotencyKey: key(801) }))).toBe('INVOICE_CREDIT_REASON_REQUIRED');
    expect(await code(repo.issueCredit(ctx, inv, { amountCents: 0, reason: 'goodwill', idempotencyKey: key(801) }))).toBe('INVOICE_CREDIT_INVALID');
    const c1 = await repo.issueCredit(ctx, inv, { amountCents: 2000, reason: 'Late start goodwill', idempotencyKey: key(801) });
    expect(c1.creditNumber).toMatch(/^CN-\d{4}$/);
    expect(c1.invoice).toMatchObject({ status: 'sent', balanceCents: 8000, creditedCents: 2000, refundedCents: 0 });
    expect(c1.credits).toEqual([expect.objectContaining({ creditCents: 2000, refundCents: 0, reason: 'Late start goodwill' })]);
    const p = await repo.recordPayment(ctx, inv, { amountCents: 5000, paidOn: today(), method: 'cash', idempotencyKey: key(802) });
    expect(p.invoice).toMatchObject({ status: 'partially_paid', balanceCents: 3000 });
    expect(await code(repo.recordPayment(ctx, inv, { amountCents: 3001, paidOn: today(), method: 'cash', idempotencyKey: key(803) }))).toBe('INVOICE_PAYMENT_EXCEEDS_BALANCE');   // the credit lowered what is owed
    expect(await code(repo.issueCredit(ctx, inv, { amountCents: 4000, reason: 'Service redone', idempotencyKey: key(804) }))).toBe('INVOICE_REFUND_METHOD_REQUIRED');
    const c2 = await repo.issueCredit(ctx, inv, { amountCents: 4000, reason: 'Service redone', refundMethod: 'cash', idempotencyKey: key(804) });
    expect(c2.invoice).toMatchObject({ status: 'paid', balanceCents: 0, creditedCents: 6000, refundedCents: 1000 });
    expect(c2.credits[1]).toMatchObject({ creditCents: 4000, refundCents: 1000, refundMethod: 'cash' });
    const dup = await repo.issueCredit(ctx, inv, { amountCents: 4000, reason: 'Service redone', refundMethod: 'cash', idempotencyKey: key(804) });
    expect(dup.duplicate).toBe(true); expect(dup.credits.length).toBe(2);
    expect(await code(repo.issueCredit(ctx, inv, { amountCents: 4001, reason: 'too much', refundMethod: 'cash', idempotencyKey: key(805) }))).toBe('INVOICE_CREDIT_EXCEEDS_TOTAL');
    expect(await code(repo.issueCredit(ctx2, inv, { amountCents: 100, reason: 'other salon', refundMethod: 'cash', idempotencyKey: key(806) }))).toBe('INVOICE_NOT_FOUND');
    const c3 = await repo.issueCredit(ctx, inv, { amountCents: 4000, reason: 'Full refund agreed', refundMethod: 'card_external', refundReference: 'RF-9', idempotencyKey: key(807) });
    expect(c3.invoice).toMatchObject({ status: 'credited', displayStatus: 'credited', balanceCents: 0, creditedCents: 10000, refundedCents: 5000 });
    expect(c3.invoice.actions).toMatchObject({ credit: false, recordPayment: false, void: false });
    expect(await code(repo.issueCredit(ctx, inv, { amountCents: 1, reason: 'again', refundMethod: 'cash', idempotencyKey: key(808) }))).toBe('INVOICE_NOT_CREDITABLE');
    expect(await code(repo.void(ctx, inv, 'want it gone'))).toBe('INVOICE_HAS_PAYMENTS');
    expect(c3.payments.length).toBe(1); expect(c3.lines.length).toBe(1);   // history kept
    expect(await code(q(`update invoice_credits set credit_cents = 1 where invoice_id = $1`, [inv]))).toMatch(/immutable/);
    expect(await code(q(`delete from invoice_credits where invoice_id = $1`, [inv]))).toMatch(/immutable/);
    expect(audited.filter((a) => a.action === 'invoice_credit_issued' && a.resourceId === inv).length).toBe(3);
    const after = await repo.summary(ctx, repo.filters(ALL(), {}));
    expect(after.kpis.refundedCents - before.kpis.refundedCents).toBe(5000);
    expect(after.kpis.creditedCents - before.kpis.creditedCents).toBe(10000);
    expect(after.kpis.cashCollectedCents - before.kpis.cashCollectedCents).toBe(0);   // 50.00 in, 50.00 handed back
    expect(after.kpis.creditedInvoices - before.kpis.creditedInvoices).toBe(1);
    expect((await repo.list(ctx, repo.filters(ALL(), { status: 'credited' }), pageReq({}))).items.map((x) => x.id)).toContain(inv);
  });
  it('a draft is not credited; an unpaid invoice with a credit note is not voided (credit the rest)', async () => {
    const draft = await repo.create(ctx, { customerId: cat, lines: [line('Polish', 1, 2500)], idempotencyKey: key(820) });
    expect(await code(repo.issueCredit(ctx, draft.invoice.id, { amountCents: 100, reason: 'draft credit', idempotencyKey: key(821) }))).toBe('INVOICE_NOT_CREDITABLE');
    const sent = await repo.create(ctx, { customerId: cat, lines: [line('Pedicure', 1, 4000)], send: true, idempotencyKey: key(822) });
    await repo.issueCredit(ctx, sent.invoice.id, { amountCents: 1000, reason: 'promo applied late', idempotencyKey: key(823) });
    expect(await code(repo.void(ctx, sent.invoice.id, 'start over'))).toBe('INVOICE_HAS_CREDITS');
    const rest = await repo.issueCredit(ctx, sent.invoice.id, { amountCents: 3000, reason: 'cancelled service', idempotencyKey: key(824) });
    expect(rest.invoice).toMatchObject({ status: 'credited', balanceCents: 0, refundedCents: 0 });   // nothing was paid → no refund
  });
});

describe('Invoices — catalog lookup for New Invoice lines', () => {
  it("this salon's active services and retail products only, by name or SKU; archived / inactive / other salon never", async () => {
    await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails'), ($4,$5,$6,'Other')`, [id('d01'), T, B, id('d02'), T2, B2]);
    await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status, archived_at) values
      ($1,$5,$6,$7,'Gel Manicure',45,4500,'active',null), ($2,$5,$6,$7,'Old Gel',45,3000,'active',now()), ($3,$5,$6,$7,'Gel Paused',45,3000,'inactive',null), ($4,$8,$9,$10,'Gel Elsewhere',45,1,'active',null)`,
      [id('d11'), id('d12'), id('d13'), id('d14'), T, B, id('d01'), T2, B2, id('d02')]);
    await q(`insert into inventory_products (id, tenant_id, name, sku, is_retail, retail_price_cents, active) values
      ($1,$4,'Gel Top Coat','GTC-1',true,1800,true), ($2,$4,'Gel Remover (back bar)','GR-1',false,900,true), ($3,$5,'Gel Elsewhere Oil','X-1',true,100,true)`, [id('d21'), id('d22'), id('d23'), T, T2]);
    const r = await repo.catalogLookup(ctx, 'gel');
    expect(r.items.map((i) => [i.kind, i.name, i.unitPriceCents])).toEqual([['service', 'Gel Manicure', 4500], ['product', 'Gel Top Coat', 1800]]);
    expect((await repo.catalogLookup(ctx, 'GTC')).items.map((i) => i.name)).toEqual(['Gel Top Coat']);
    expect((await repo.catalogLookup(ctx2, 'gel')).items.map((i) => i.name)).toEqual(['Gel Elsewhere', 'Gel Elsewhere Oil']);
  });
});

// Invoices guide (Nov 4 2026) §14: email / text through the salon's sender — destination is the bill-to snapshot, a draft is
// not sent, one key = one attempt, "submitted" is not "delivered" (the notifications ledger decides), not connected says so
describe('Invoices — delivery to the customer', () => {
  it('emails / texts an issued invoice once per key, records the attempt, and reports delivered only from the ledger', async () => {
    const sent: any[] = [];
    const messenger = {
      sendSms: async (r: any) => { sent.push({ ch: 'sms', ...r }); return { sent: true, status: 'sent' as const, providerId: 'SM1' }; },
      sendEmail: async (r: any) => { sent.push({ ch: 'email', ...r }); const n = (await q(`insert into notifications (tenant_id, channel, to_address, body, status, provider_id) values ($1,'email',$2,'invoice','sent','EM1') returning id`, [T, r.to])).rows[0]; return { sent: true, status: 'sent' as const, providerId: 'EM1', notificationId: n.id }; },
    };
    const r2 = new InvoicesLedgerRepository(db, auditor, messenger as any);
    const draft = await r2.create(ctx, { customerId: ann, lines: [line('Gel', 1, 4500)], idempotencyKey: key(900) });
    expect(draft.delivery).toMatchObject({ email: 'available', sms: 'available', canSend: { email: false, sms: false } });
    expect(await code(r2.deliver(ctx, draft.invoice.id, { channel: 'email', idempotencyKey: key(901) }))).toBe('INVOICE_NOT_DELIVERABLE');
    const inv = await r2.create(ctx, { customerId: ann, lines: [line('Gel', 1, 4500)], send: true, idempotencyKey: key(902) });
    expect(inv.delivery.canSend).toEqual({ email: true, sms: true });
    const e1 = await r2.deliver(ctx, inv.invoice.id, { channel: 'email', idempotencyKey: key(903) });
    expect(e1.attempt).toMatchObject({ channel: 'email', status: 'submitted' });
    expect(sent[0]).toMatchObject({ ch: 'email', to: 'ann@example.com', tenantId: T });
    expect(sent[0].subject).toContain(inv.invoice.invoiceNumber); expect(sent[0].body).toContain('balance due $45.00');
    const again = await r2.deliver(ctx, inv.invoice.id, { channel: 'email', idempotencyKey: key(903) });
    expect(again.duplicate).toBe(true); expect(sent.length).toBe(1);   // a retry with the same key sends nothing
    expect(again.delivery.attempts[0]).toMatchObject({ channel: 'email', status: 'submitted', destination: 'an***@example.com' });
    await q(`update notifications set status = 'delivered', delivered_at = now() where provider_id = 'EM1'`);
    expect((await r2.detail(ctx, inv.invoice.id))!.delivery.attempts[0].status).toBe('delivered');
    const s1 = await r2.deliver(ctx, inv.invoice.id, { channel: 'sms', idempotencyKey: key(904) });
    expect(sent[1]).toMatchObject({ ch: 'sms', to: '+18565551234', purpose: 'notification' });
    expect(s1.delivery.attempts[0]).toMatchObject({ channel: 'sms', status: 'submitted', destination: '•••-1234' });
    expect(audited.filter((a) => a.action === 'invoice_delivery_attempted' && a.resourceId === inv.invoice.id).length).toBe(2);
    expect(await code(r2.deliver(ctx2, inv.invoice.id, { channel: 'sms', idempotencyKey: key(905) }))).toBe('INVOICE_NOT_FOUND');
  });
  it('a blocked send (opt-out) is recorded as blocked; no email on file is refused; no sender says not connected', async () => {
    const r2 = new InvoicesLedgerRepository(db, auditor, { sendSms: async () => ({ sent: false, status: 'blocked' as const, reason: 'opted_out' }) } as any);
    const inv = await r2.create(ctx, { customerId: cat, lines: [line('Polish', 1, 2000)], send: true, idempotencyKey: key(910) });   // Cat has no email
    expect(inv.delivery).toMatchObject({ email: 'not_connected', sms: 'available' });
    expect(await code(r2.deliver(ctx, inv.invoice.id, { channel: 'email', idempotencyKey: key(911) }))).toBe('INVOICE_DELIVERY_NOT_CONNECTED');
    const b = await r2.deliver(ctx, inv.invoice.id, { channel: 'sms', idempotencyKey: key(912) });
    expect(b.attempt).toMatchObject({ status: 'blocked', reason: 'opted_out' });
    const r3 = new InvoicesLedgerRepository(db, auditor, { sendSms: async () => ({ sent: true, status: 'sent' as const }), sendEmail: async () => ({ sent: true, status: 'sent' as const }) } as any);
    expect(await code(r3.deliver(ctx, inv.invoice.id, { channel: 'email', idempotencyKey: key(913) }))).toBe('INVOICE_DELIVERY_NO_DESTINATION');
    expect((await repo.detail(ctx, inv.invoice.id))!.delivery).toMatchObject({ email: 'not_connected', sms: 'not_connected' });   // no messenger at all
    expect(await code(repo.deliver(ctx, inv.invoice.id, { channel: 'sms', idempotencyKey: key(914) }))).toBe('INVOICE_DELIVERY_NOT_CONNECTED');
  });
});
