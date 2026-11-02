// finance-core.vitest.spec.ts — the pure rules of the expense domain, using the mandate's own examples.
import { describe, it, expect } from 'vitest';
import { normalizeCategory, customCategoryKey, DEFAULT_EXPENSE_CATEGORIES, categoryLabel } from './expense-categories';
import { normalizeVendorName, matchVendor } from './vendor-normalize';
import { recommendCategory, learnFromCorrection, type CategoryRule } from './category-engine';
import { reconcileBreakdown, parseCents, allocate, rescaleAllocations, roundHalfUp, billStatusFor, billDueState } from './expense-money';
import { detectExpenseDuplicates, hashDistance } from './expense-duplicates';
import { EXPENSE, EXPENSE_BILL, EXPENSE_REIMBURSEMENT, EXPENSE_DUPLICATE } from './expense-lifecycles';
import { periodWindow, previousWindow, pctChange, detectRecurring, expenseInsights } from './expense-reports';
import { toExpenseCsv, toExpenseXlsx, dollars, safeCell, exportTotalCents, type ExportRow } from './expense-export';

describe('categories (§4–6)', () => {
  it('the ten defaults in Kevin\'s order and words', () => {
    expect(DEFAULT_EXPENSE_CATEGORIES.map((c) => c.label)).toEqual(['Rent / Landlord', 'Supplies', 'Equipment', 'Utilities / Bills', 'Marketing', 'Repairs / Maintenance', 'Insurance', 'Software / Subscriptions', 'Payroll', 'Other']);
  });
  it('every older spelling maps to one key; unknown words are not guessed', () => {
    expect(normalizeCategory('Supplies')).toBe('supplies');
    expect(normalizeCategory('supplies')).toBe('supplies');
    expect(normalizeCategory('inventory')).toBe('supplies');
    expect(normalizeCategory('maintenance')).toBe('repairs');
    expect(normalizeCategory('Repairs / Maintenance')).toBe('repairs');
    expect(normalizeCategory('Software / Subscriptions')).toBe('software');
    expect(normalizeCategory('Cleaning crew')).toBeNull();
    expect(normalizeCategory('')).toBeNull();
  });
  it('a salon\'s custom category is accepted by key or by its label', () => {
    const custom = new Set(['professional_services']);
    expect(customCategoryKey('Professional Services')).toBe('professional_services');
    expect(normalizeCategory('Professional Services', custom)).toBe('professional_services');
    expect(normalizeCategory('professional_services', custom)).toBe('professional_services');
    expect(normalizeCategory('Professional Services')).toBeNull();
    expect(categoryLabel('professional_services', [{ key: 'professional_services', label: 'Professional Services' }])).toBe('Professional Services');
  });
});

describe('vendor normalization (§44–46)', () => {
  it('HOME DEPOT #4102 / THE HOME DEPOT / Home Depot are one vendor', () => {
    expect(normalizeVendorName('HOME DEPOT #4102')).toBe('home depot');
    expect(normalizeVendorName('THE HOME DEPOT')).toBe('home depot');
    expect(normalizeVendorName('Home Depot')).toBe('home depot');
    expect(normalizeVendorName('ABC Nail Supply, LLC')).toBe('abc nail supply');
  });
  it('does not merge names that differ in a real word', () => {
    expect(normalizeVendorName('Home Goods')).not.toBe(normalizeVendorName('Home Depot'));
    const vendors = [{ id: 'v1', name: 'The Home Depot' }, { id: 'v2', name: 'HomeGoods' }];
    expect(matchVendor('HOME DEPOT #4102', vendors).vendor?.id).toBe('v1');
    expect(matchVendor('Home Depot Pro Supply', vendors).vendor).toBeNull();
  });
});

describe('category engine priority (§40–42, §164, §199)', () => {
  const rules: CategoryRule[] = [
    { vendorNorm: 'verizon business', keyword: null, categoryKey: 'utilities', kind: 'owner_lock' },
    { vendorNorm: 'vendor abc', keyword: null, categoryKey: 'supplies', kind: 'learned' },
    { vendorNorm: 'abc nail supply', keyword: 'chair', categoryKey: 'equipment', kind: 'learned' },
  ];
  it('1. owner lock beats everything, including AI', () => {
    const r = recommendCategory({ vendorRaw: 'Verizon Business', rules, ai: { key: 'software', confidence: 0.99 } });
    expect(r).toMatchObject({ key: 'utilities', source: 'owner_rule' });
  });
  it('2. a learned tenant vendor rule beats the system rule and AI', () => {
    expect(recommendCategory({ vendorRaw: 'Vendor ABC', rules, ai: { key: 'marketing', confidence: 0.9 } })).toMatchObject({ key: 'supplies', source: 'vendor_rule' });
  });
  it('3. vendor + line-item rule', () => {
    expect(recommendCategory({ vendorRaw: 'ABC Nail Supply', rules, lineDescriptions: ['Pedicure chair deluxe'] })).toMatchObject({ key: 'equipment', source: 'vendor_rule' });
  });
  it('4. system rules from the mandate\'s examples, refined by line items', () => {
    expect(recommendCategory({ vendorRaw: 'HOME DEPOT #4102', lineDescriptions: ['HVAC filter 20x25'] })).toMatchObject({ key: 'repairs', source: 'system_rule' });
    expect(recommendCategory({ vendorRaw: 'Home Depot', lineDescriptions: ['Pedicure chair'] })).toMatchObject({ key: 'equipment', source: 'system_rule' });
    expect(recommendCategory({ vendorRaw: 'Cosmoprof' }).key).toBe('supplies');
    expect(recommendCategory({ vendorRaw: 'PSE&G' }).key).toBe('utilities');
    expect(recommendCategory({ vendorRaw: 'Google Workspace' }).key).toBe('software');
    expect(recommendCategory({ vendorRaw: 'Meta Platforms' }).key).toBe('marketing');
    expect(recommendCategory({ vendorRaw: 'The Hartford' }).key).toBe('insurance');
  });
  it('5. AI only when no rule matched, and only a key the salon has', () => {
    expect(recommendCategory({ vendorRaw: 'Mystery Shop', ai: { key: 'marketing', confidence: 0.8 } })).toMatchObject({ key: 'marketing', source: 'ai' });
    expect(recommendCategory({ vendorRaw: 'Mystery Shop', ai: { key: 'made_up', confidence: 0.99 } })).toMatchObject({ key: 'other', source: 'fallback' });
  });
  it('6. Other is the fallback, with a reason', () => {
    const r = recommendCategory({ vendorRaw: 'Mystery Shop' });
    expect(r).toMatchObject({ key: 'other', source: 'fallback' });
    expect(r.reason).toMatch(/Other/);
  });
  it('§41: a correction becomes a rule only on the second time, never over an owner lock', () => {
    expect(learnFromCorrection({ vendorRaw: 'Vendor XYZ', from: 'other', to: 'supplies', priorCorrectionsToSameKey: 0 })).toBeNull();
    expect(learnFromCorrection({ vendorRaw: 'Vendor XYZ', from: 'other', to: 'supplies', priorCorrectionsToSameKey: 1 })).toMatchObject({ vendorNorm: 'vendor xyz', categoryKey: 'supplies', kind: 'learned' });
    expect(learnFromCorrection({ vendorRaw: 'Verizon Business', from: 'utilities', to: 'software', priorCorrectionsToSameKey: 5, existing: rules })).toBeNull();
  });
});

describe('exact money (§14, §33–34, §68–69, §200)', () => {
  it('parses typed money into integer cents, never a float', () => {
    expect(parseCents('$1,234.56')).toBe(123456);
    expect(parseCents('12.5')).toBe(1250);
    expect(parseCents('0.1')).toBe(10);
    expect(parseCents('1.234')).toBeNull();
    expect(parseCents('abc')).toBeNull();
  });
  it('§200: subtotal $100, tax $6.625 → $106.63 reconciles; a hallucinated total does not', () => {
    const tax = roundHalfUp(662.5);
    expect(tax).toBe(663);
    expect(reconcileBreakdown({ subtotalCents: 10000, taxCents: tax, totalCents: 10663 })).toMatchObject({ reconciles: true, checked: true });
    expect(reconcileBreakdown({ subtotalCents: 20000, taxCents: 1325, totalCents: 34291 })).toMatchObject({ reconciles: false, differenceCents: 12966 });
    expect(reconcileBreakdown({ totalCents: 5000 })).toMatchObject({ reconciles: true, checked: false });
    expect(reconcileBreakdown({ subtotalCents: 10000, taxCents: 600, tipCents: 1500, feeCents: 100, discountCents: 1000, totalCents: 11200 }).reconciles).toBe(true);
  });
  it('§68: $300 at 50/30/20 → 150/90/60, and odd cents never lost', () => {
    const r = allocate(30000, [{ branchId: 'ch', basisPoints: 5000 }, { branchId: 'ma', basisPoints: 3000 }, { branchId: 'de', basisPoints: 2000 }]);
    expect(r.ok && r.allocations.map((a) => a.amountCents)).toEqual([15000, 9000, 6000]);
    const odd = allocate(100, [{ branchId: 'a', basisPoints: 3333 }, { branchId: 'b', basisPoints: 3333 }, { branchId: 'c', basisPoints: 3334 }]);
    expect(odd.ok && odd.allocations.reduce((s, a) => s + a.amountCents, 0)).toBe(100);
  });
  it('§69: allocations that do not sum to the total are refused', () => {
    expect(allocate(30000, [{ branchId: 'a', amountCents: 10000 }, { branchId: 'b', amountCents: 10000 }])).toMatchObject({ ok: false });
    expect(allocate(30000, [{ branchId: 'a', basisPoints: 5000 }, { branchId: 'b', basisPoints: 4000 }])).toMatchObject({ ok: false });
    expect(allocate(30000, [{ branchId: 'a', amountCents: 15000 }, { branchId: 'a', amountCents: 15000 }])).toMatchObject({ ok: false });
  });
  it('bill status and due window (§55–56)', () => {
    expect(billStatusFor(10000, 0)).toBe('open');
    expect(billStatusFor(10000, 4000)).toBe('partially_paid');
    expect(billStatusFor(10000, 10000)).toBe('paid');
    expect(billDueState('2026-10-20', '2026-10-21', 'open')).toBe('overdue');
    expect(billDueState('2026-10-21', '2026-10-21', 'open')).toBe('due_today');
    expect(billDueState('2026-10-22', '2026-10-21', 'open')).toBe('due_soon');
    expect(billDueState('2026-11-30', '2026-10-21', 'open')).toBe('scheduled');
    expect(billDueState('2026-10-01', '2026-10-21', 'paid')).toBe('paid');
  });
});

describe('duplicates (§47–50, §198)', () => {
  const saved = [
    { id: 'e1', vendorRaw: 'THE HOME DEPOT', incurredOn: '2026-10-21', totalCents: 21325, fileHash: 'abc', perceptualHash: 'ffff0000ffff0000' },
    { id: 'e2', vendorRaw: 'ABC Nail Supply', incurredOn: '2026-10-01', totalCents: 50000, invoiceNumber: 'INV-1001' },
  ];
  it('same file → exact', () => {
    expect(detectExpenseDuplicates({ vendorRaw: 'x', incurredOn: '2026-10-21', totalCents: 1, fileHash: 'abc' }, saved).status).toBe('exact');
  });
  it('same vendor + invoice number → exact (formatting ignored)', () => {
    expect(detectExpenseDuplicates({ vendorRaw: 'ABC NAIL SUPPLY LLC', incurredOn: '2026-10-05', totalCents: 1, invoiceNumber: 'inv 1001' }, saved).status).toBe('exact');
  });
  it('same receipt re-photographed (vendor/date/total) → possible', () => {
    const r = detectExpenseDuplicates({ vendorRaw: 'HOME DEPOT #4102', incurredOn: '2026-10-21', totalCents: 21325, fileHash: 'different' }, saved);
    expect(r.status).toBe('possible'); expect(r.matches[0].id).toBe('e1');
  });
  it('same image cropped (near perceptual hash) → possible', () => {
    expect(hashDistance('ffff0000ffff0000', 'ffff0000ffff0001')).toBe(1);
    expect(detectExpenseDuplicates({ vendorRaw: 'unreadable', incurredOn: '2026-10-21', totalCents: 21325, perceptualHash: 'ffff0000ffff0001' }, saved).status).toBe('possible');
  });
  it('same amount and date from a different vendor → not a duplicate', () => {
    expect(detectExpenseDuplicates({ vendorRaw: 'Cosmoprof', incurredOn: '2026-10-21', totalCents: 21325 }, saved).status).toBe('none');
  });
  it('a voided expense is not a duplicate target, and an expense is not its own duplicate', () => {
    expect(detectExpenseDuplicates({ vendorRaw: 'THE HOME DEPOT', incurredOn: '2026-10-21', totalCents: 21325 }, [{ ...saved[0], status: 'voided' }]).status).toBe('none');
    expect(detectExpenseDuplicates({ id: 'e1', vendorRaw: 'THE HOME DEPOT', incurredOn: '2026-10-21', totalCents: 21325 }, saved).status).toBe('none');
  });
});

describe('lifecycles (§51–55, §65, §85)', () => {
  it('an approved expense can only be voided — never edited back to draft or deleted', () => {
    expect(EXPENSE.can('approved', 'draft')).toBe(false);
    expect(EXPENSE.can('approved', 'voided')).toBe(true);
    expect(EXPENSE.can('pending_review', 'approved')).toBe(true);
    expect(EXPENSE.can('voided', 'approved')).toBe(false);
  });
  it('bill, reimbursement and duplicate machines', () => {
    expect(EXPENSE_BILL.can('open', 'partially_paid')).toBe(true);
    expect(EXPENSE_BILL.can('paid', 'open')).toBe(false);
    expect(EXPENSE_REIMBURSEMENT.can('approved', 'paid')).toBe(true);
    expect(EXPENSE_REIMBURSEMENT.can('paid', 'pending')).toBe(false);
    expect(EXPENSE_DUPLICATE.can('possible', 'overridden')).toBe(true);
  });
});

describe('report windows, recurring and insights (§87–95, §57–59)', () => {
  it('windows are salon-calendar dates', () => {
    expect(periodWindow('today', '2026-10-21')).toEqual({ from: '2026-10-21', to: '2026-10-21' });
    expect(periodWindow('week', '2026-10-21')).toEqual({ from: '2026-10-19', to: '2026-10-25' });
    expect(periodWindow('month', '2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodWindow('year', '2026-10-21')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(periodWindow('last_month', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(previousWindow('month', periodWindow('month', '2026-10-21'))).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(previousWindow('week', { from: '2026-10-19', to: '2026-10-25' })).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(() => periodWindow('custom', '2026-10-21', { from: '2026-10-22', to: '2026-10-01' })).toThrow();
  });
  it('pctChange never divides by zero', () => { expect(pctChange(100, 0)).toBeNull(); expect(pctChange(118, 100)).toBe(18); });
  it('a monthly vendor at a steady amount is suggested as recurring; a one-off is not', () => {
    const rows = ['2026-06-03', '2026-07-03', '2026-08-04', '2026-09-03'].map((d) => ({ vendorKey: 'comcast', vendorLabel: 'Comcast', incurredOn: d, amountCents: 12999, categoryKey: 'utilities' }));
    rows.push({ vendorKey: 'home depot', vendorLabel: 'Home Depot', incurredOn: '2026-09-10', amountCents: 5000, categoryKey: 'repairs' });
    const s = detectRecurring(rows);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ vendorKey: 'comcast', typicalAmountCents: 12999, occurrences: 4, annualizedCents: 155988 });
  });
  it('insights are advisory sentences', () => {
    const lines = expenseInsights({ categoryNow: { supplies: 11800 }, categoryBefore: { supplies: 10000 }, labels: { supplies: 'Supplies' }, possibleDuplicates: 3, needsReview: 0, overdueBills: 1, newVendorsThisPeriod: 0 });
    expect(lines[0]).toBe('Supplies spending increased 18% compared with the previous period.');
    expect(lines).toContain('3 possible duplicate receipts need review.');
    expect(lines).toContain('1 bill is overdue.');
  });
});

describe('export (§97–100, §202)', () => {
  const rows: ExportRow[] = [
    { date: '2026-10-21', vendor: 'Home Depot', category: 'Repairs / Maintenance', branch: 'Cherry Hill', description: 'Filters', subtotalCents: 20000, taxCents: 1325, totalCents: 21325, paymentMethod: 'business_card', receiptNumber: 'R1', invoiceNumber: '', receiptAttached: true, status: 'approved' },
    { date: '2026-10-22', vendor: '=HYPERLINK("x")', category: 'Supplies', branch: 'Marlton', description: 'Polish, "gel"', subtotalCents: null, taxCents: null, totalCents: 1, paymentMethod: '', receiptNumber: '', invoiceNumber: '', receiptAttached: false, status: 'approved' },
  ];
  it('dollars are exact from cents', () => { expect(dollars(21325)).toBe('213.25'); expect(dollars(1)).toBe('0.01'); expect(dollars(null)).toBe(''); });
  it('CSV: headers, quoting, injection-safe cells and a TOTAL equal to the row sum', () => {
    const csv = toExpenseCsv(rows);
    expect(csv.split('\r\n')[0]).toBe('Date,Vendor,Category,Accounting Code,Branch,Description,Subtotal,Tax,Total,Payment Method,Receipt Number,Invoice Number,Receipt Attached?,Status');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"Polish, ""gel"""');
    expect(csv).toContain('TOTAL,,,213.26');
    expect(exportTotalCents(rows)).toBe(21326);
    expect(safeCell('+1')).toBe("'+1");
  });
  it('XLSX is a real workbook (zip) whose total equals the CSV total', async () => {
    const bytes = await toExpenseXlsx(rows, { title: 'Expenses', period: 'Oct 2026' });
    expect(bytes[0]).toBe(0x50); expect(bytes[1]).toBe(0x4b);   // "PK"
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(bytes) as any);
    const ws = wb.getWorksheet('Expenses')!;
    const last = ws.getRow(ws.rowCount);
    expect(last.getCell(6).value).toBe('TOTAL');
    expect(String(ws.getRow(3).getCell(1).value)).toMatch(/not tax or accounting advice/);   // §162 (Oct 28)
    expect(Math.round(Number(last.getCell(9).value) * 100)).toBe(21326);
  });
});

describe('P2-3 (Oct 23 2026): salon-wide cost shares across branches', async () => {
  const { branchShareOfSalonWide, validSharedCostShares } = await import('./expense-money');
  const A = 'br-a', B = 'br-b', C = 'br-c';
  const shares = [{ branchId: A, basisPoints: 5000 }, { branchId: B, basisPoints: 3000 }, { branchId: C, basisPoints: 2000 }];
  it('50 / 30 / 20 is valid; any other total is refused with the actual sum; a branch twice is refused', () => {
    expect(validSharedCostShares(shares)).toEqual({ ok: true });
    expect(validSharedCostShares([{ branchId: A, basisPoints: 5000 }, { branchId: B, basisPoints: 3000 }, { branchId: C, basisPoints: 1000 }])).toMatchObject({ ok: false, error: expect.stringMatching(/90%/) });
    expect(validSharedCostShares([{ branchId: A, basisPoints: 5000 }, { branchId: A, basisPoints: 5000 }])).toMatchObject({ ok: false });
    expect(validSharedCostShares([])).toMatchObject({ ok: false });
  });
  it('a $1,000.01 rent split 50 / 30 / 20: the three shares sum EXACTLY to the rent (no lost or extra cent)', () => {
    const ex = [{ id: 'rent', amountCents: 100001 }];
    const got = [A, B, C].map((b) => branchShareOfSalonWide(ex, new Map(), 'MANUAL_PERCENTAGE', shares, b).allocatedCents);
    expect(got.reduce((t, x) => t + x, 0)).toBe(100001);
    expect(got).toEqual([50001, 30000, 20000]);
  });
  it('NONE (the default) shares nothing; a branch outside the shares carries nothing', () => {
    const ex = [{ id: 'rent', amountCents: 100000 }];
    expect(branchShareOfSalonWide(ex, new Map(), 'NONE', shares, A).allocatedCents).toBe(0);
    expect(branchShareOfSalonWide(ex, new Map(), 'MANUAL_PERCENTAGE', shares, 'br-z').allocatedCents).toBe(0);
  });
  it('an expense split by hand keeps ITS split; the policy applies to the rest', () => {
    const ex = [{ id: 'software', amountCents: 9000 }, { id: 'rent', amountCents: 100000 }];
    const own = new Map([['software', [{ branchId: A, amountCents: 1000 }, { branchId: B, amountCents: 8000 }]]]);
    const a = branchShareOfSalonWide(ex, own, 'MANUAL_PERCENTAGE', shares, A);
    expect(a).toMatchObject({ byOwnSplitCents: 1000, byPolicyCents: 50000, allocatedCents: 51000, expenseCount: 2 });
    expect(branchShareOfSalonWide(ex, own, 'MANUAL_PERCENTAGE', shares, C)).toMatchObject({ byOwnSplitCents: 0, byPolicyCents: 20000 });
  });
});

describe('rescaleAllocations (§65, Oct 27 2026): an edited total keeps the hand split\'s proportions, to the cent', () => {
  it('scales by the old amounts, largest remainder, sums exactly; refuses an empty / zero split', () => {
    const r = rescaleAllocations([{ branchId: 'a', amountCents: 3000 }, { branchId: 'b', amountCents: 6000 }], 10001);
    expect(r.ok && r.allocations.map((x) => x.amountCents)).toEqual([3334, 6667]);
    const three = rescaleAllocations([{ branchId: 'a', amountCents: 1 }, { branchId: 'b', amountCents: 1 }, { branchId: 'c', amountCents: 1 }], 100);
    expect(three.ok && three.allocations.reduce((t, x) => t + x.amountCents, 0)).toBe(100);
    expect(rescaleAllocations([], 100).ok).toBe(false);
    expect(rescaleAllocations([{ branchId: 'a', amountCents: 0 }], 100).ok).toBe(false);
    expect(rescaleAllocations([{ branchId: 'a', amountCents: 10 }], -1).ok).toBe(false);
  });
});
