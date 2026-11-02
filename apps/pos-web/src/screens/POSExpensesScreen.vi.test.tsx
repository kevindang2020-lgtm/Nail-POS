// POSExpensesScreen.vi.test — English + Vietnamese POS mandate (WP-C2): Receipts & Expenses reads in Vietnamese (KPIs, inbox,
// statuses, notices); category / vendor names are the salon's data. Same mocked API as POSExpensesScreen.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { leftoverEnglish } from './viScan.testkit';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const m = vi.hoisted(() => ({
  expenses: vi.fn(), dashboard: vi.fn(), report: vi.fn(), categories: vi.fn(), recommend: vi.fn(), createExpense: vi.fn(),
  approve: vi.fn(), submit: vi.fn(), reject: vi.fn(), voidExpense: vi.fn(), duplicateDecision: vi.fn(), archive: vi.fn(), restore: vi.fn(), deleteDraft: vi.fn(), billPayment: vi.fn(), exportFile: vi.fn(),
  upload: vi.fn(), save: vi.fn(),
}));
vi.mock('../api/posExpensesApi', () => ({ posExpensesApi: m, saveExportFile: m.save }));
vi.mock('../api/posAiOcrReceiptApi', () => ({ posAiOcrReceiptApi: { upload: m.upload } }));
import { POSExpensesScreen } from './POSExpensesScreen';

const exp = (o: Record<string, unknown> = {}) => ({ id: 'e1', branchId: null, kind: 'expense', status: 'pending_review', category: 'supplies', categoryLabel: 'Supplies', categorySource: 'system_rule',
  amountCents: 12500, taxCents: null, vendor: 'BeautyCo', vendorDisplay: 'BeautyCo', description: 'Acetone', incurredOn: '2026-10-05', paymentMethod: null, dueDate: null, billStatus: null, billDue: null, openCents: 0,
  duplicateStatus: 'none', reimbursementStatus: 'not_required', receiptDocumentId: null, source: 'manual', archivedAt: null, version: 3, reviewFlags: [], extractionConfidence: null, ...o });
const dash = { today: '2026-10-21', thisMonthCents: 45000, thisYearCents: 900000, todayCents: 12500, todayCount: 1, receiptsUploadedToday: 2, needsReview: 1, drafts: 0, possibleDuplicates: 0, billsDue: 1, billsOverdue: 1, billsOpenCents: 30000, reimbursementsOpen: 0 };
const report = { period: 'month', window: { from: '2026-10-01', to: '2026-10-31' }, totalCents: 45000, count: 3, previousTotalCents: 40000, changePct: 12.5,
  byCategory: [{ key: 'rent', label: 'Rent / Landlord', totalCents: 30000, count: 1, changePct: 0 }, { key: 'supplies', label: 'Supplies', totalCents: 15000, count: 2, changePct: 50 }, { key: 'other', label: 'Other', totalCents: 0, count: 0, changePct: null }],
  byVendor: [], insights: ['Supplies is up 50% from last period.'], reconciles: true, basis: 'Approved expenses' };
const cats = { categories: [{ key: 'rent', label: 'Rent / Landlord', isDefault: true, active: true, accountingCode: null }, { key: 'supplies', label: 'Supplies', isDefault: true, active: true, accountingCode: null }] };

const renderIt = () => render(<MemoryRouter><POSExpensesScreen /></MemoryRouter>);
beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.expenses.mockResolvedValue({ items: [exp()], total: 1, page: 1, pageSize: 50 });
  m.dashboard.mockResolvedValue(dash); m.report.mockResolvedValue(report); m.categories.mockResolvedValue(cats);
});

afterEach(async () => { await setLanguage('en'); });
// data the salon / server holds: vendor, description, category labels, the server's insight sentence and basis
// the period tabs come from reportsCommon.tsx (a report file, WP-C4) — reported to the lead, not this screen's strings
const SHARED = ['Today', 'This Week', 'This Month', 'This Year'];
const DATA = ['BeautyCo', 'Acetone', 'Supplies', 'Rent / Landlord', 'Other', 'Supplies is up 50% from last period.', 'Approved expenses'];

describe('POSExpensesScreen in Vietnamese', () => {
  it('the KPIs, the inbox and where the money went read in Vietnamese', async () => {
    await setLanguage('vi');
    const { container } = renderIt();
    await waitFor(() => expect(screen.getAllByText('BeautyCo').length).toBeGreaterThan(0));
    expect(leftoverEnglish(container, [...DATA, ...SHARED]).join(' | ')).toBe('');
  });
});
