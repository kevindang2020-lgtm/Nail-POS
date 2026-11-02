// expense.pgtest — the finance module over the real migrated schema (PGlite, every migration through 672): mandate §§195–203.
// Tenant and branch isolation, version conflicts, idempotent create / approve / bill payment, duplicates (never auto-deleted,
// a person decides), the category priority with stored rules, approved-only reports that reconcile with the export, bills,
// reimbursements, the OCR receipt → expense post (idempotent per document), CSV import, and the outbox events.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { ExpenseService, type FinanceCtx, type BranchScopePort } from './expense.service';
import { ExpenseError } from './expense-errors';

const T = 'f9000000-0000-4000-8000-000000000001', T2 = 'f9000000-0000-4000-8000-000000000002';
const B1 = 'f9000000-0000-4000-8000-0000000000b1', B2 = 'f9000000-0000-4000-8000-0000000000b2', BX = 'f9000000-0000-4000-8000-0000000000b9';
const OWNER = 'f9000000-0000-4000-8000-0000000000e1', MGR = 'f9000000-0000-4000-8000-0000000000e2', RECEP = 'f9000000-0000-4000-8000-0000000000e3', O2 = 'f9000000-0000-4000-8000-0000000000e9';
const ALL = ['owner.expenses.view', 'owner.expenses.manage', 'owner.expenses.approve', 'owner.expenses.export', 'owner.expenses.categories.manage', 'owner.expenses.reimbursements.manage'];
const owner: FinanceCtx = { tenantId: T, userId: OWNER, role: 'OWNER', permissions: ALL };
const mgr: FinanceCtx = { tenantId: T, userId: MGR, role: 'MANAGER', permissions: ['owner.expenses.view', 'owner.expenses.manage', 'owner.expenses.approve', 'owner.expenses.export'] };
const recep: FinanceCtx = { tenantId: T, userId: RECEP, role: 'RECEPTIONIST', permissions: ['owner.expenses.view', 'owner.expenses.manage'] };
const other: FinanceCtx = { tenantId: T2, userId: O2, role: 'OWNER', permissions: ALL };

/** the Owner App's branch rule as the app binds it: a MANAGER is confined to B1; an owner sees the salon */
const scopes: BranchScopePort = {
  async resolve(ctx, requested) {
    if (ctx.role === 'MANAGER') { if (requested && requested !== B1) throw new ExpenseError('EXPENSE_ACCESS_DENIED'); return { branchId: B1, allowed: [B1], restricted: B1 }; }
    return { branchId: requested ?? null, allowed: null, restricted: null };
  },
};
let pg: { query: (s: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
let svc: ExpenseService;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows;
const today = new Date().toISOString().slice(0, 10);
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return (e as { code?: string }).code ?? String(e); } };

beforeAll(async () => {
  pg = await migratedPglite();
  svc = new ExpenseService(kyselyFor(pg) as never, scopes, new OutboxWriter());
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Fin Co','Fin Salon','fin-a','FINA'), ($2,'Other Co','Other Salon','fin-b','FINB')`, [T, T2]);
  await q(`insert into tenant_settings (id, tenant_id, branch_id, category, settings_json) values (gen_random_uuid(), $1, NULL, 'business-branch', '{"timezone":"UTC"}'::jsonb)`, [T]);
  await q(`insert into branches (id, tenant_id, name) values ($1,$3,'Downtown'), ($2,$3,'Uptown'), ($4,$5,'Elsewhere')`, [B1, B2, T, BX, T2]);
  await q(`insert into users (id, tenant_id, first_name, last_name, full_name, email, status, role) values
    ($1,$5,'O','O','O O','o@fin.test','active','OWNER'), ($2,$5,'M','M','M M','m@fin.test','active','MANAGER'), ($3,$5,'R','R','R R','r@fin.test','active','MANAGER'), ($4,$6,'X','X','X X','x@fin.test','active','OWNER')`, [OWNER, MGR, RECEP, O2, T, T2]);
  // §74 (Oct 27 2026): the receptionist in these cases records expenses — the owner's switch allows it (off by default)
  await q(`insert into expense_settings (tenant_id, receptionist_upload) values ($1, true)`, [T]);
}, 180000);

describe('finance — isolation', () => {
  it('deep-scan: an owner with EXPLICIT branch grants opens, approves and reports the salon-wide expense she filed (it was a 404 forever); a branch-confined manager still never sees it', async () => {
    const granted = new ExpenseService(kyselyFor(pg as never) as never, { async resolve(ctx, requested) {
      if (ctx.role === 'MANAGER') return { branchId: B1, allowed: [B1], restricted: B1 };
      return { branchId: requested ?? null, allowed: [B1, B2], restricted: null };   // the Owner App with user_branch_access rows
    } }, new OutboxWriter());
    const { expense } = await granted.create(owner, { amountCents: 9900, incurredOn: today, vendor: 'Salon Rent LLC', category: 'rent', intent: 'submit', idempotencyKey: 'salon-wide-1' });
    expect(expense.branchId).toBeNull();                                                  // filed to the whole salon
    expect((await granted.detail(owner, expense.id)).expense.id).toBe(expense.id);
    expect((await granted.approve(owner, expense.id, expense.version)).expense.status).toBe('approved');
    expect((await granted.list(owner, { tab: 'all' } as never)).items.some((x: { id: string }) => x.id === expense.id)).toBe(true);
    expect(await code(granted.detail(mgr, expense.id))).toBe('EXPENSE_NOT_FOUND');
    // the Owner App's "All branches" (ALL_BRANCHES) report carries the salon-wide cost even when her session picked a
    // branch at sign-in; with no filter the read follows that session branch (the POS's own view)
    const session = { ...owner, selectedBranchId: B1 };
    expect(JSON.stringify(await granted.report(session, { period: 'month', branchId: 'all' }))).toContain('9900');
    expect((await granted.list(session, { tab: 'all' } as never)).items.some((x: { id: string }) => x.id === expense.id)).toBe(false);
    expect((await granted.list(session, { tab: 'all', branchId: 'all' } as never)).items.some((x: { id: string }) => x.id === expense.id)).toBe(true);
  });

  it('a salon never sees another salon\'s expense (list, detail, approve)', async () => {
    const { expense } = await svc.create(owner, { amountCents: 12345, incurredOn: today, vendor: 'Sally Beauty', category: 'supplies', idempotencyKey: 'iso-1' });
    expect(await code(svc.detail(other, expense.id))).toBe('EXPENSE_NOT_FOUND');
    expect(await code(svc.approve(other, expense.id))).toBe('EXPENSE_NOT_FOUND');
    expect((await svc.list(other, { tab: 'all' })).items.some((x) => x.id === expense.id)).toBe(false);
  });
  it('a manager confined to B1 cannot write to B2 and never lists a B2 expense', async () => {
    const b2 = await svc.create(owner, { amountCents: 5000, incurredOn: today, vendor: 'B2 Vendor', category: 'other', branchId: B2, idempotencyKey: 'iso-b2' });
    expect(await code(svc.create(mgr, { amountCents: 100, incurredOn: today, branchId: B2, category: 'other' }))).toBe('EXPENSE_ACCESS_DENIED');
    expect((await svc.list(mgr, { tab: 'all' })).items.some((x) => x.id === b2.expense.id)).toBe(false);
    expect(await code(svc.detail(mgr, b2.expense.id))).not.toBe('ok');
  });
  it('a branch from another salon is refused', async () => {
    expect(await code(svc.create(owner, { amountCents: 100, incurredOn: today, branchId: BX, category: 'other' }))).not.toBe('ok');
  });
});

describe('finance — versions and idempotency', () => {
  it('a stale version is a conflict, never a silent overwrite', async () => {
    const { expense } = await svc.create(owner, { amountCents: 2000, incurredOn: today, vendor: 'Versioned', category: 'other', intent: 'draft', idempotencyKey: 'ver-1' });
    await svc.update(owner, expense.id, { amountCents: 2100, version: expense.version });
    expect(await code(svc.update(owner, expense.id, { amountCents: 2200, version: expense.version }))).toBe('EXPENSE_VERSION_CONFLICT');
    expect((await svc.detail(owner, expense.id)).expense.amountCents).toBe(2100);
  });
  it('the same idempotency key creates ONE expense', async () => {
    const a = await svc.create(owner, { amountCents: 3300, incurredOn: today, vendor: 'Once', category: 'other', idempotencyKey: 'idem-1' });
    const b = await svc.create(owner, { amountCents: 3300, incurredOn: today, vendor: 'Once', category: 'other', idempotencyKey: 'idem-1' });
    expect(b.created).toBe(false); expect(b.expense.id).toBe(a.expense.id);
    expect((await q(`select count(*)::int c from expenses where tenant_id = $1 and idempotency_key = 'idem-1'`, [T]))[0].c).toBe(1);
  });
  it('approve is idempotent (a second approve changes nothing and writes no second history row)', async () => {
    const { expense } = await svc.create(recep, { amountCents: 4400, incurredOn: today, vendor: 'Approve Twice', category: 'other', idempotencyKey: 'appr-1' });
    expect(expense.status).toBe('pending_review');                               // a receptionist cannot approve: it waits
    await svc.approve(owner, expense.id);
    await svc.approve(owner, expense.id);
    const h = await q(`select action from expense_history where tenant_id = $1 and expense_id = $2 and action ilike '%approv%'`, [T, expense.id]);
    expect(h).toHaveLength(1);
  });
  it('an approved expense changes only by a correction with a reason', async () => {
    const { expense } = await svc.create(owner, { amountCents: 5500, incurredOn: today, vendor: 'Correct Me', category: 'other', idempotencyKey: 'corr-1' });
    expect(expense.status).toBe('approved');
    expect(await code(svc.update(owner, expense.id, { amountCents: 5600, version: expense.version }))).not.toBe('ok');
    const r = await svc.update(owner, expense.id, { amountCents: 5600, version: expense.version, reason: 'Typo on the total' });
    expect(r.expense.amountCents).toBe(5600);
  });
});

describe('finance — duplicates (§75–§82: flagged, a person decides, never deleted)', () => {
  it('a second identical expense is refused until someone says why — then kept and marked overridden', async () => {
    await svc.create(owner, { amountCents: 7777, incurredOn: today, vendor: 'Dup Supply Co', category: 'supplies', invoiceNumber: 'INV-77', idempotencyKey: 'dup-a' });
    expect(await code(svc.create(owner, { amountCents: 7777, incurredOn: today, vendor: 'Dup Supply Co', category: 'supplies', invoiceNumber: 'INV-77', idempotencyKey: 'dup-b' }))).toMatch(/RECEIPT_(POSSIBLE_)?DUPLICATE/);
    const kept = await svc.create(owner, { amountCents: 7777, incurredOn: today, vendor: 'Dup Supply Co', category: 'supplies', invoiceNumber: 'INV-77', duplicateOverrideReason: 'Two separate deliveries', idempotencyKey: 'dup-c' });
    expect(kept.expense.duplicateStatus).toBe('overridden');
    expect((await q(`select count(*)::int c from expenses where tenant_id = $1 and vendor = 'Dup Supply Co'`, [T]))[0].c).toBe(2);   // nothing deleted
  });
});

describe('finance — categories', () => {
  it('owner rule beats the system rule; the system rule beats Other', async () => {
    const sys = await svc.recommend(owner, { vendor: 'PSE&G' });
    expect(sys.key).toBe('utilities'); expect(sys.source).toBe('system_rule');
    await svc.createRule(owner, { vendor: 'PSE&G', categoryKey: 'rent' });
    const mine = await svc.recommend(owner, { vendor: 'PSE&G #4471' });
    expect(mine.key).toBe('rent');
    expect((await svc.recommend(owner, { vendor: 'Zzyzx Unknown LLC' })).key).toBe('other');
  });
  it('the salon\'s rule does not leak to another salon', async () => {
    expect((await svc.recommend(other, { vendor: 'PSE&G' })).key).toBe('utilities');
  });
});

describe('finance — reports reconcile with the export (approved only)', () => {
  it('drafts, pending and voided expenses are not counted; category, vendor and branch sums equal the total; CSV total = report', async () => {
    const draft = await svc.create(owner, { amountCents: 99999, incurredOn: today, vendor: 'Draft Only', category: 'other', intent: 'draft', idempotencyKey: 'rep-d' });
    const gone = await svc.create(owner, { amountCents: 88888, incurredOn: today, vendor: 'Voided Vendor', category: 'other', idempotencyKey: 'rep-v' });
    await svc.void(owner, gone.expense.id, 'Entered by mistake');
    const r = await svc.report(owner, { period: 'month' });
    expect(r.reconciles).toBe(true);
    const approved = (await q(`select coalesce(sum(amount_cents),0)::int s from expenses where tenant_id = $1 and status = 'approved' and incurred_on between $2 and $3`, [T, r.window.from, r.window.to]))[0].s;
    expect(r.totalCents).toBe(approved);
    expect(r.byCategory.length).toBeGreaterThanOrEqual(10);                     // all ten defaults, even at $0
    const f = await svc.exportFile(owner, { format: 'csv', period: 'month' });
    expect(f.totalCents).toBe(r.totalCents);
    const csv = new TextDecoder().decode(f.bytes);
    expect(csv).not.toContain('Draft Only'); expect(csv).not.toContain('Voided Vendor');
    expect(draft.expense.status).toBe('draft');
  });
  it('a CSV cell that looks like a formula is neutralised', async () => {
    await svc.create(owner, { amountCents: 1000, incurredOn: today, vendor: '=HYPERLINK("x")', category: 'other', idempotencyKey: 'csv-inj' });
    const csv = new TextDecoder().decode((await svc.exportFile(owner, { format: 'csv', period: 'month' })).bytes);
    expect(csv).not.toMatch(/(^|,)"?=HYPERLINK/m);
  });
});

describe('finance — bills and reimbursements', () => {
  it('a bill is paid in parts, cannot be overpaid, and a repeated payment key records once', async () => {
    const { expense } = await svc.create(owner, { kind: 'bill', amountCents: 10000, incurredOn: today, dueDate: today, vendor: 'Landlord LLC', category: 'rent', invoiceNumber: 'R-1', idempotencyKey: 'bill-1' });
    await svc.recordBillPayment(owner, expense.id, { amountCents: 4000, idempotencyKey: 'pay-1' });
    await svc.recordBillPayment(owner, expense.id, { amountCents: 4000, idempotencyKey: 'pay-1' });
    let d = await svc.detail(owner, expense.id);
    expect(d.expense.paidCents).toBe(4000); expect(d.expense.billStatus).toBe('partially_paid');
    expect(await code(svc.recordBillPayment(owner, expense.id, { amountCents: 7000, idempotencyKey: 'pay-2' }))).not.toBe('ok');
    await svc.recordBillPayment(owner, expense.id, { amountCents: 6000, idempotencyKey: 'pay-3' });
    d = await svc.detail(owner, expense.id);
    expect(d.expense.billStatus).toBe('paid'); expect(d.expense.openCents).toBe(0);
  });
  it('a personal-card purchase is reimbursed: requested → approved → paid', async () => {
    const { expense } = await svc.create(owner, { amountCents: 2500, incurredOn: today, vendor: 'Staples', category: 'supplies', paymentMethod: 'personal_card', reimburse: true, idempotencyKey: 'reimb-1' });
    if (expense.reimbursementStatus === 'not_required') await svc.reimbursement(owner, expense.id, 'request');
    await svc.reimbursement(owner, expense.id, 'approve');
    const r = await svc.reimbursement(owner, expense.id, 'pay');
    expect(r.expense.reimbursementStatus).toBe('paid');
  });
});

describe('finance — OCR receipt → expense, import, events', () => {
  it('an approved receipt posts ONE expense per document (a retry returns the same one)', async () => {
    const doc = (await q(`insert into ocr_documents (tenant_id, branch_id, document_type, vendor, document_number, document_date, total_cents, tax_cents, pipeline_status)
      values ($1, $2, 'receipt', 'Nail Supply Warehouse', 'R-555', $3::date, 4321, 321, 'approved') returning id`, [T, B1, today]))[0].id as string;
    const a = await svc.postFromReceipt({ ...recep, permissions: ['pos.ai_ocr_receipt.post'] }, doc, { idempotencyKey: `ocr:${doc}:expense:1` });
    const b = await svc.postFromReceipt({ ...recep, permissions: ['pos.ai_ocr_receipt.post'] }, doc, { idempotencyKey: `ocr:${doc}:expense:1` });
    expect(b.expense.id).toBe(a.expense.id);
    expect(a.expense.receiptDocumentId).toBe(doc); expect(a.expense.source).toBe('ocr'); expect(a.expense.amountCents).toBe(4321);
    expect((await q(`select count(*)::int c from expenses where tenant_id = $1 and receipt_document_id = $2`, [T, doc]))[0].c).toBe(1);
  });
  it('a receipt from another salon cannot be posted', async () => {
    const doc = (await q(`insert into ocr_documents (tenant_id, document_type, total_cents, document_date, pipeline_status) values ($1,'receipt',100,$2::date,'approved') returning id`, [T2, today]))[0].id as string;
    expect(await code(svc.postFromReceipt(owner, doc, { idempotencyKey: `ocr:${doc}:expense:1` }))).toBe('RECEIPT_NOT_FOUND');
  });
  it('a CSV import checks every row first (dry run writes nothing) and rejects bad rows by number', async () => {
    const rows = [{ date: today, vendor: 'Imported A', amount: '12.34', category: 'Supplies' }, { date: 'not a date', vendor: 'Bad', amount: '1' }, { date: today, vendor: 'Imported B', amount: 56.78, category: 'rent' }];
    const dry = await svc.importRows(owner, rows, { dryRun: true });
    expect(dry.dryRun).toBe(true); expect(dry.accepted).toBe(2);
    expect((await q(`select count(*)::int c from expenses where tenant_id = $1 and vendor like 'Imported %'`, [T]))[0].c).toBe(0);
    const real = await svc.importRows(owner, rows, {});
    expect(real.accepted).toBe(2);
    expect((await q(`select sum(amount_cents)::int s from expenses where tenant_id = $1 and vendor like 'Imported %'`, [T]))[0].s).toBe(1234 + 5678);
    // Oct 28 2026 (mandate audit F4): the same file again, REORDERED, creates nothing (content keys, not row numbers)
    const again = await svc.importRows(owner, [rows[2], rows[1], rows[0]], {});
    expect(again.created).toBe(0);
    expect((await q(`select count(*)::int c from expenses where tenant_id = $1 and vendor like 'Imported %'`, [T]))[0].c).toBe(2);
    // a row that duplicates an expense ALREADY recorded another way (typed in / from a receipt) is saved for review,
    // flagged — never "overridden" and approved (it used to be: counted twice, nobody asked)
    await svc.create(owner, { category: 'supplies', amountCents: 4321, incurredOn: today, vendor: 'Recorded Twice Supply', intent: 'approve', idempotencyKey: 'f4-manual' });
    const dupRow = await svc.importRows(owner, [{ date: today, vendor: 'Recorded Twice Supply', amount: '43.21', category: 'Supplies' }], {});
    expect(dupRow.created).toBe(1);
    const dup = (await q(`select status, duplicate_status from expenses where tenant_id = $1 and vendor = 'Recorded Twice Supply' order by created_at desc limit 1`, [T]))[0];
    expect(dup.status).toBe('pending_review');
    expect(['possible', 'exact']).toContain(dup.duplicate_status);
  });
  it('every change is on the outbox (expense.created / approved / voided / bill.payment_recorded)', async () => {
    const types = (await q(`select distinct event_type from outbox_events where tenant_id = $1`, [T])).map((r) => r.event_type);
    for (const t of ['expense.created', 'expense.approved', 'expense.voided', 'bill.payment_recorded']) expect(types).toContain(t);
  });
});

describe('§163 run 3 (Oct 27 2026): an expense rule naming an unknown vendor', () => {
  it('is refused as EXPENSE_INVALID (400 through financeRun) before the insert — it was a 500 from the tenant-consistency trigger', async () => {
    const { financeRun } = await import('./expense.controller');
    const unknownVendor = 'f9000000-0000-4000-8000-00000000dead';
    expect(await code(svc.createRule(owner, { vendor: 'Ghost Supply', categoryKey: 'rent', vendorId: unknownVendor }))).toBe('EXPENSE_INVALID');
    let status = 0; try { await financeRun(() => svc.createRule(owner, { vendor: 'Ghost Supply', categoryKey: 'rent', vendorId: unknownVendor })); } catch (e) { status = (e as { getStatus: () => number }).getStatus(); }
    expect(status).toBe(400);
    expect(await q(`select 1 from expense_category_rules where tenant_id = $1 and vendor_id = $2`, [T, unknownVendor])).toHaveLength(0);
  });
});
