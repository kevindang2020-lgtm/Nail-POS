// expense-close.pgtest — Receipt / Expense mandate close-out (Oct 27 2026) on the real migrated schema (PGlite through 700):
//   §177–§179 notification preferences are saved / read; the weekly + monthly summaries are published ONCE per completed
//             period per salon (a second sweep, a restart, a second replica write nothing), and not at all when switched off;
//   §83       an owner's auto-approval rule approves a receipt-backed expense at or under its threshold — never one over it,
//             never a suspected duplicate, never one whose money does not add up; the history says "auto_approved" by the rule;
//   §142      a receipt that arrives later is MATCHED to the existing expense (vendor + date + total) or only POSSIBLE_MATCH
//             (same total, different vendor); an unrelated receipt is UNMATCHED; nothing is linked by the suggestion itself;
//   §62/§63   with no transaction feed the payment match is honestly UNMATCHED (and says why); with a feed a single
//             amount + date + last4 hit is MATCHED, amount + date alone POSSIBLE_MATCH; a person confirms / clears a link.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter, DOMAIN_EVENTS } from '@aipowersalon/events';
import { ExpenseService, type FinanceCtx, type BranchScopePort } from './expense.service';

const T = 'f9100000-0000-4000-8000-000000000001', T2 = 'f9100000-0000-4000-8000-000000000002';
const B1 = 'f9100000-0000-4000-8000-0000000000b1', BX = 'f9100000-0000-4000-8000-0000000000b9';
const OWNER = 'f9100000-0000-4000-8000-0000000000e1', RECEP = 'f9100000-0000-4000-8000-0000000000e3', O2 = 'f9100000-0000-4000-8000-0000000000e9';
const ALL = ['owner.expenses.view', 'owner.expenses.manage', 'owner.expenses.approve', 'owner.expenses.export', 'owner.expenses.categories.manage', 'owner.expenses.reimbursements.manage'];
const owner: FinanceCtx = { tenantId: T, userId: OWNER, role: 'OWNER', permissions: ALL };
const recep: FinanceCtx = { tenantId: T, userId: RECEP, role: 'RECEPTIONIST', permissions: ['owner.expenses.view', 'owner.expenses.manage'] };
const other: FinanceCtx = { tenantId: T2, userId: O2, role: 'OWNER', permissions: ALL };
const scopes: BranchScopePort = { async resolve(_ctx, requested) { return { branchId: requested ?? null, allowed: null, restricted: null }; } };

let pg: { query: (s: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
let db: any; let svc: ExpenseService;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows;
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
const FIXED = new Date('2026-10-27T15:00:00Z');   // a Tuesday: last completed week = Mon Oct 19 – Sun Oct 25; last completed month = September
/** a receipt document the way the OCR pipeline leaves one at review_required (vendor / date / total read) */
const receipt = async (tenantId: string, x: { vendor: string; date: string; totalCents: number; number?: string | null }) =>
  String((await q(`insert into ocr_documents (tenant_id, branch_id, vendor, document_date, total_cents, document_number, pipeline_status, document_type) values ($1, null, $2, $3, $4, $5, 'review_required', 'receipt') returning id`, [tenantId, x.vendor, x.date, x.totalCents, x.number ?? null]))[0].id);

beforeAll(async () => {
  pg = await migratedPglite();
  db = kyselyFor(pg);
  svc = new ExpenseService(db as never, scopes, new OutboxWriter(), () => FIXED);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Close Co','Close Salon','close-a','CLSA'), ($2,'Other Co','Other Salon','close-b','CLSB')`, [T, T2]);
  await q(`insert into tenant_settings (id, tenant_id, branch_id, category, settings_json) values (gen_random_uuid(), $1, NULL, 'business-branch', '{"timezone":"UTC"}'::jsonb), (gen_random_uuid(), $2, NULL, 'business-branch', '{"timezone":"UTC"}'::jsonb)`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name) values ($1,$2,'Downtown'), ($3,$4,'Elsewhere')`, [B1, T, BX, T2]);
  await q(`insert into users (id, tenant_id, first_name, last_name, full_name, email, status, role) values
    ($1,$4,'O','O','O O','o@close.test','active','OWNER'), ($2,$4,'R','R','R R','r@close.test','active','MANAGER'), ($3,$5,'X','X','X X','x@close.test','active','OWNER')`, [OWNER, RECEP, O2, T, T2]);
  await q(`insert into expense_settings (tenant_id, receptionist_upload) values ($1, true)`, [T]);   // §74: the receptionist may record here (the §74/§75 case switches it off and on itself)
}, 180000);

describe('§177 notification preferences and §83 auto-approval rules — settings', () => {
  it('defaults to everything on and no rules; saves and reads the five switches and the rules (vendor normalised, threshold in cents)', async () => {
    const d = await svc.settings(owner);
    expect([d.notifyNeedsReview, d.notifyBillDue, d.notifyDuplicate, d.notifyWeeklySummary, d.notifyMonthlySummary]).toEqual([true, true, true, true, true]);
    expect(d.autoApprovalRules).toEqual([]);
    const s = await svc.saveSettings(owner, { notifyDuplicate: false, notifyMonthlySummary: false, autoApprovalRules: [{ vendor: 'PSE&G Electric #4102', maxCents: 50000, categoryKey: 'utilities' }, { vendor: 'Google Workspace', maxCents: 20000 }] });
    expect([s.notifyNeedsReview, s.notifyDuplicate, s.notifyWeeklySummary, s.notifyMonthlySummary]).toEqual([true, false, true, false]);
    expect(s.autoApprovalRules).toEqual([{ vendorNorm: 'pse and g electric', maxCents: 50000, categoryKey: 'utilities', enabled: true }, { vendorNorm: 'google workspace', maxCents: 20000, categoryKey: null, enabled: true }]);
    expect(await code(svc.saveSettings(owner, { version: s.version, autoApprovalRules: [{ vendor: 'X', maxCents: 0 }] }))).toBe('EXPENSE_INVALID');
    expect(await code(svc.saveSettings(owner, { version: s.version, autoApprovalRules: [{ vendor: 'X', maxCents: 100, categoryKey: 'not-a-category' }] }))).toBe('EXPENSE_CATEGORY_NOT_FOUND');
    expect(await code(svc.saveSettings(recep, { notifyDuplicate: true }))).toBe('EXPENSE_ACCESS_DENIED');
    expect((await svc.settings(other)).autoApprovalRules).toEqual([]);   // tenant-scoped
  });
});

describe('§74/§75 the owner\'s front-desk and technician switches', () => {
  it('a front-desk entry is refused until receptionist_upload is on; a technician records only a reimbursement receipt, and only when technician_upload is on', async () => {
    const front: FinanceCtx = { tenantId: T, userId: RECEP, role: 'FRONT_DESK', permissions: ['owner.expenses.view', 'owner.expenses.manage'] };
    const tech: FinanceCtx = { tenantId: T, userId: RECEP, role: 'TECHNICIAN', permissions: ['owner.expenses.view', 'owner.expenses.manage'] };
    const cur = await svc.saveSettings(owner, { receptionistUpload: false, technicianUpload: false });
    expect(await code(svc.create(front, { amountCents: 500, incurredOn: '2026-10-20', vendor: 'Staples', category: 'supplies', idempotencyKey: 'fd-1' }))).toBe('EXPENSE_ACCESS_DENIED');
    expect(await code(svc.create(tech, { amountCents: 500, incurredOn: '2026-10-20', vendor: 'Staples', category: 'supplies', paymentMethod: 'personal_card', idempotencyKey: 'tech-1' }))).toBe('EXPENSE_ACCESS_DENIED');
    const on = await svc.saveSettings(owner, { receptionistUpload: true, technicianUpload: true, version: cur.version });
    expect((await svc.create(front, { amountCents: 500, incurredOn: '2026-10-20', vendor: 'Staples', category: 'supplies', idempotencyKey: 'fd-2' })).expense.status).toBe('pending_review');   // never approved by the front desk
    expect(await code(svc.create(tech, { amountCents: 500, incurredOn: '2026-10-20', vendor: 'Staples', category: 'supplies', idempotencyKey: 'tech-2' }))).toBe('EXPENSE_ACCESS_DENIED');   // a salon expense is not a technician's to record
    const re = await svc.create(tech, { amountCents: 700, incurredOn: '2026-10-21', vendor: 'Uber', category: 'other', paymentMethod: 'personal_card', idempotencyKey: 'tech-3' });
    expect([re.expense.status, re.expense.reimbursementStatus]).toEqual(['pending_review', 'pending']);
    await svc.saveSettings(owner, { receptionistUpload: true, technicianUpload: false, version: on.version });   // back to the suite's default
  });
});

describe('§83 owner auto-approval rule on a receipt-backed expense', () => {
  it('a receptionist\'s receipt-backed entry for the trusted vendor at or under the threshold lands APPROVED by the rule (history: auto_approved); over the threshold, a duplicate or unreconciled money waits for a person', async () => {
    const doc1 = await receipt(T, { vendor: 'PSE&G ELECTRIC #4102', date: '2026-10-20', totalCents: 32000 });
    const r1 = await svc.create(recep, { amountCents: 32000, incurredOn: '2026-10-20', vendor: 'PSE&G ELECTRIC #4102', category: 'utilities', receiptDocumentId: doc1, idempotencyKey: 'auto-1' });
    expect(r1.expense.status).toBe('approved');
    expect(r1.expense.approvedBy).toBeNull();                                                   // approved by the OWNER's rule, not by the receptionist
    const h = (await svc.detail(owner, r1.expense.id)).history.map((x) => x.action);
    expect(h).toContain('auto_approved');
    expect((await svc.detail(owner, r1.expense.id)).history.find((x) => x.action === 'auto_approved')?.reason).toContain('pse and g electric');
    // over the threshold → pending_review
    const doc2 = await receipt(T, { vendor: 'PSE&G Electric', date: '2026-10-21', totalCents: 50001 });
    expect((await svc.create(recep, { amountCents: 50001, incurredOn: '2026-10-21', vendor: 'PSE&G Electric', category: 'utilities', receiptDocumentId: doc2, idempotencyKey: 'auto-2' })).expense.status).toBe('pending_review');
    // the rule names utilities — the same vendor filed under another category is not the rule's
    const doc3 = await receipt(T, { vendor: 'PSE&G Electric', date: '2026-10-22', totalCents: 1000 });
    expect((await svc.create(recep, { amountCents: 1000, incurredOn: '2026-10-22', vendor: 'PSE&G Electric', category: 'other', receiptDocumentId: doc3, idempotencyKey: 'auto-3' })).expense.status).toBe('pending_review');
    // money that does not add up never auto-approves (§33)
    const doc4 = await receipt(T, { vendor: 'Google Workspace', date: '2026-10-22', totalCents: 1500 });
    expect((await svc.create(recep, { amountCents: 1500, subtotalCents: 1000, taxCents: 100, incurredOn: '2026-10-22', vendor: 'Google Workspace', category: 'software', receiptDocumentId: doc4, idempotencyKey: 'auto-4' })).expense.status).toBe('pending_review');
    // no receipt evidence → the rule does not apply (a typed entry waits for a person)
    expect((await svc.create(recep, { amountCents: 1600, incurredOn: '2026-10-23', vendor: 'Google Workspace', category: 'software', idempotencyKey: 'auto-5' })).expense.status).toBe('pending_review');
    // a suspected duplicate of the first one (same vendor / total / date) is saved and flagged, never auto-approved (§49)
    const doc6 = await receipt(T, { vendor: 'PSE&G ELECTRIC #4102', date: '2026-10-20', totalCents: 32000 });
    const r6 = await svc.create(recep, { amountCents: 32000, incurredOn: '2026-10-20', vendor: 'PSE&G ELECTRIC #4102', category: 'utilities', receiptDocumentId: doc6, idempotencyKey: 'auto-6', duplicateOverrideReason: null }, { source: 'ocr' });
    expect(r6.expense.status).toBe('pending_review');
    expect(['possible', 'exact']).toContain(r6.expense.duplicateStatus);
  });
});

describe('§142 receipt → existing expense suggestion', () => {
  it('MATCHED for vendor + date + total, POSSIBLE_MATCH for the same total under another vendor, UNMATCHED otherwise; the suggestion links nothing; tenant-scoped', async () => {
    const e = await svc.create(owner, { amountCents: 8899, incurredOn: '2026-10-10', vendor: 'ABC Nail Supply', category: 'supplies', intent: 'approve', idempotencyKey: 'match-1' });
    expect(e.expense.receiptDocumentId).toBeNull();
    const later = await receipt(T, { vendor: 'ABC NAIL SUPPLY INC', date: '2026-10-11', totalCents: 8899 });
    const m = await svc.suggestExpenseForReceipt(owner, later);
    expect(m.verdict).toBe('matched'); expect(m.expenseId).toBe(e.expense.id); expect(m.reason).toContain('same_vendor');
    expect((await svc.detail(owner, e.expense.id)).expense.receiptDocumentId).toBeNull();      // suggested, not linked
    const vague = await receipt(T, { vendor: 'Some Other Store', date: '2026-10-10', totalCents: 8899 });
    expect((await svc.suggestExpenseForReceipt(owner, vague)).verdict).toBe('possible_match');
    const none = await receipt(T, { vendor: 'ABC Nail Supply', date: '2026-10-10', totalCents: 8898 });
    expect((await svc.suggestExpenseForReceipt(owner, none))).toEqual({ verdict: 'unmatched', expenseId: null, reason: null, candidates: [] });
    // a reference number alone + the total matches even when the vendor was read badly
    const e2 = await svc.create(owner, { amountCents: 25000, incurredOn: '2026-09-30', vendor: 'Landlord LLC', category: 'rent', invoiceNumber: 'INV-2026-0930', intent: 'submit', idempotencyKey: 'match-2' });
    const byRef = await receipt(T, { vendor: 'L4NDL0RD', date: '2026-10-02', totalCents: 25000, number: 'inv 2026 0930' });
    const m2 = await svc.suggestExpenseForReceipt(owner, byRef);
    expect([m2.verdict, m2.expenseId]).toEqual(['matched', e2.expense.id]);
    // the person links it — the normal attach, now with the suggestion's id
    await svc.attachDocument(owner, e2.expense.id, byRef, 'receipt');
    expect((await svc.detail(owner, e2.expense.id)).expense.receiptDocumentId).toBe(byRef);
    expect((await svc.suggestExpenseForReceipt(owner, byRef)).reason).toBe('already_linked');
    // another salon's receipt never matches this salon's expense
    const foreign = await receipt(T2, { vendor: 'ABC Nail Supply', date: '2026-10-10', totalCents: 8899 });
    expect((await svc.suggestExpenseForReceipt(other, foreign)).verdict).toBe('unmatched');
    expect(await code(svc.suggestExpenseForReceipt(owner, foreign))).toBe('RECEIPT_NOT_FOUND');
  });
});

describe('§62/§63 expense ↔ payment / bank transaction', () => {
  it('no feed → UNMATCHED with the reason; with a feed a single amount + date + last4 hit is MATCHED, amount + date alone POSSIBLE_MATCH; a person confirms or clears; recorded in history', async () => {
    const e = await svc.create(owner, { amountCents: 6400, incurredOn: '2026-10-15', vendor: 'Home Depot #4102', category: 'repairs', cardLast4: '4242', paymentMethod: 'business_card', intent: 'approve', idempotencyKey: 'pay-1' });
    const none = await svc.matchPayment(owner, e.expense.id);
    expect(none).toMatchObject({ verdict: 'unmatched', paymentId: null, reason: 'no transaction feed connected', candidates: 0 });
    expect((await svc.detail(owner, e.expense.id)).expense.paymentMatchStatus).toBe('unmatched');
    svc.paymentFeed = { async candidates(_ctx, x) { return [{ id: 'txn-1', amountCents: x.amountCents, occurredOn: '2026-10-16', last4: '4242', counterparty: 'THE HOME DEPOT' }, { id: 'txn-2', amountCents: x.amountCents, occurredOn: '2026-10-15', last4: '1111' }]; } };
    const m = await svc.matchPayment(owner, e.expense.id);
    expect([m.verdict, m.paymentId]).toEqual(['matched', 'txn-1']);
    expect((await svc.detail(owner, e.expense.id)).expense.matchedPaymentRef).toBe('txn-1');
    svc.paymentFeed = { async candidates(_ctx, x) { return [{ id: 'txn-3', amountCents: x.amountCents, occurredOn: '2026-10-15' }]; } };
    expect((await svc.matchPayment(owner, e.expense.id)).verdict).toBe('possible_match');
    svc.paymentFeed = null;
    const cur = (await svc.detail(owner, e.expense.id)).expense;
    expect(await code(svc.setPaymentMatch(owner, e.expense.id, { decision: 'confirm', paymentRef: null }))).toBe('EXPENSE_INVALID');
    const linked = await svc.setPaymentMatch(owner, e.expense.id, { decision: 'confirm', paymentRef: 'stmt 10/16 ••4242', version: cur.version });
    expect([linked.expense.paymentMatchStatus, linked.expense.matchedPaymentRef]).toEqual(['matched', 'stmt 10/16 ••4242']);
    expect(await code(svc.setPaymentMatch(owner, e.expense.id, { decision: 'clear', version: cur.version }))).toBe('EXPENSE_VERSION_CONFLICT');
    const cleared = await svc.setPaymentMatch(owner, e.expense.id, { decision: 'clear' });
    expect([cleared.expense.paymentMatchStatus, cleared.expense.matchedPaymentRef]).toEqual(['unmatched', null]);
    const actions = (await svc.detail(owner, e.expense.id)).history.map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(['payment_match_checked', 'payment_linked', 'payment_unlinked']));
    expect(await code(svc.matchPayment(other, e.expense.id))).toBe('EXPENSE_NOT_FOUND');
  });
});

describe('§178/§179 weekly and monthly owner summaries', () => {
  it('publishes one weekly and one monthly summary per salon per completed period with the real figures; a second sweep writes nothing; a switched-off summary is not sent; the facts are tenant-scoped', async () => {
    // T: last completed week (Oct 19–25) and last completed month (September) get some approved expenses
    await svc.create(owner, { amountCents: 100000, incurredOn: '2026-10-20', vendor: 'ABC Nail Supply', category: 'supplies', intent: 'approve', idempotencyKey: 'dig-1' });
    await svc.create(owner, { amountCents: 20000, incurredOn: '2026-10-24', vendor: 'Meta Ads', category: 'marketing', intent: 'approve', idempotencyKey: 'dig-2' });
    await svc.create(owner, { amountCents: 300000, incurredOn: '2026-09-05', vendor: 'Landlord LLC', category: 'rent', intent: 'approve', idempotencyKey: 'dig-3' });
    await svc.create(owner, { amountCents: 50000, incurredOn: '2026-09-18', vendor: 'ABC Nail Supply', category: 'supplies', intent: 'approve', idempotencyKey: 'dig-4' });
    await svc.create(owner, { amountCents: 250000, incurredOn: '2026-08-05', vendor: 'Landlord LLC', category: 'rent', intent: 'approve', idempotencyKey: 'dig-5' });
    // T2 has expenses too, but its owner turned the monthly summary off
    await svc.create(other, { amountCents: 777, incurredOn: '2026-10-21', vendor: 'Other Vendor', category: 'other', intent: 'approve', idempotencyKey: 'dig-6' });
    await svc.saveSettings(other, { notifyMonthlySummary: false });
    await svc.saveSettings(owner, { notifyMonthlySummary: true });   // the first test switched it off for T
    const events = async (tenantId: string) => (await q(`select payload_json from outbox_events where tenant_id = $1 and event_type = $2 order by created_at`, [tenantId, DOMAIN_EVENTS.EXPENSE_SUMMARY_READY])).map((r) => (typeof r.payload_json === 'string' ? JSON.parse(r.payload_json) : r.payload_json) as Record<string, unknown>);
    const first = await svc.sweepDigests(FIXED);
    expect(first).toEqual({ weekly: 2, monthly: 1 });
    const mine = await events(T);
    expect(mine).toHaveLength(2);
    const week = mine.find((p) => p.period === 'week')!, month = mine.find((p) => p.period === 'month')!;
    expect([week.from, week.to, week.totalCents]).toEqual(['2026-10-19', '2026-10-25', 152000]);   // 1,200 here + the 320.00 PSE&G bill the §83 rule approved on Oct 20
    expect(String(week.body)).toContain('$1,520.00');
    expect([month.from, month.to, month.totalCents, month.previousTotalCents]).toEqual(['2026-09-01', '2026-09-30', 350000, 250000]);
    expect(String(month.title)).toBe('September 2026 expense summary');
    expect(String(month.body)).toContain('Up 40.0% from August');
    expect(String(month.body)).toContain('Largest category Rent');
    expect(String(month.body)).toContain('Largest vendor Landlord LLC');
    const theirs = await events(T2);
    expect(theirs).toHaveLength(1); expect(theirs[0].period).toBe('week'); expect(theirs[0].totalCents).toBe(777);
    // once per completed period: the same hour, the next hour, a second replica — nothing more
    expect(await svc.sweepDigests(FIXED)).toEqual({ weekly: 0, monthly: 0 });
    expect(await svc.sweepDigests(new Date('2026-10-29T03:00:00Z'))).toEqual({ weekly: 0, monthly: 0 });
    expect(await events(T)).toHaveLength(2);
    const s = await svc.settings(owner);
    expect([s.weeklySummarySentFor, s.monthlySummarySentFor]).toEqual(['2026-10-19', '2026-09']);
    // the following Monday a new week is due (and nothing for the month until November)
    expect(await svc.sweepDigests(new Date('2026-11-02T13:00:00Z'))).toEqual({ weekly: 2, monthly: 1 });   // Nov 2: week of Oct 26 + October (T2's monthly stays off)
    expect((await events(T)).filter((p) => p.period === 'month').map((p) => p.from)).toEqual(['2026-09-01', '2026-10-01']);
    expect((await events(T2)).filter((p) => p.period === 'month')).toHaveLength(0);
  });
  // Receipt mandate §96 (Oct 28 2026): the same vendor charged again the same day is flagged "review recommended"
  it('a second charge from the same vendor on the same day (any amount, accents / case ignored) carries same_vendor_same_day; another day does not', async () => {
    const first = await svc.create(owner, { amountCents: 1200, incurredOn: '2026-10-21', vendor: 'Nhà Cung Cấp Đẹp', category: 'supplies', intent: 'submit', idempotencyKey: 'svsd-1' });
    expect(first.expense.reviewFlags).not.toContain('same_vendor_same_day');
    const second = await svc.create(owner, { amountCents: 3400, incurredOn: '2026-10-21', vendor: 'nha cung cap dep', category: 'supplies', intent: 'submit', idempotencyKey: 'svsd-2' });
    expect(second.expense.reviewFlags).toContain('same_vendor_same_day');
    const other = await svc.create(owner, { amountCents: 3400, incurredOn: '2026-10-22', vendor: 'Nhà Cung Cấp Đẹp', category: 'supplies', intent: 'submit', idempotencyKey: 'svsd-3' });
    expect(other.expense.reviewFlags).not.toContain('same_vendor_same_day');
  });
});
