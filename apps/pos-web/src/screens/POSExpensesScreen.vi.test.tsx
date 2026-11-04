// POSExpensesScreen.vi.test — English + Vietnamese POS: the rebuilt Expenses screen (guide Nov 4 2026) reads in Vietnamese
// (KPIs, period bar, tabs, filters, table, statuses); category / vendor names are the salon's data.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { leftoverEnglish } from './viScan.testkit';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const m = vi.hoisted(() => ({
  expenses: vi.fn(), kpis: vi.fn(), report: vi.fn(), reportRange: vi.fn(), categories: vi.fn(), recommend: vi.fn(), createExpense: vi.fn(), update: vi.fn(), detail: vi.fn(),
  approve: vi.fn(), submit: vi.fn(), reject: vi.fn(), voidExpense: vi.fn(), duplicateDecision: vi.fn(), archive: vi.fn(), restore: vi.fn(), deleteDraft: vi.fn(), billPayment: vi.fn(), exportFile: vi.fn(),
  paymentMatch: vi.fn(), paymentLink: vi.fn(), upload: vi.fn(), save: vi.fn(),
}));
vi.mock('../api/posExpensesApi', () => ({ posExpensesApi: m, saveExportFile: m.save }));
vi.mock('../api/posAiOcrReceiptApi', () => ({ posAiOcrReceiptApi: { upload: m.upload, detail: vi.fn(), previewUrl: vi.fn() } }));
import { POSExpensesScreen } from './POSExpensesScreen';

const exp = (o: Record<string, unknown> = {}) => ({ id: 'e1', branchId: null, kind: 'expense', status: 'pending_review', category: 'supplies', categoryLabel: 'Supplies', categorySource: 'system_rule',
  amountCents: 12500, taxCents: null, vendor: 'BeautyCo', vendorDisplay: 'BeautyCo', description: 'Acetone', incurredOn: '2026-10-05', paymentMethod: 'cash', dueDate: null, billStatus: null, billDue: null, openCents: 0,
  duplicateStatus: 'none', reimbursementStatus: 'not_required', receiptDocumentId: null, source: 'manual', archivedAt: null, version: 3, reviewFlags: [], extractionConfidence: null, createdAt: '2026-10-05T15:00:00Z', ...o });
const kpis = { period: { preset: 'month', from: '2026-10-01', to: '2026-10-31', tz: 'America/New_York', today: '2026-10-21' }, totalCents: 45000, entries: 3, categoriesUsed: 2, topCategory: { key: 'rent', label: 'Rent / Landlord', totalCents: 30000 } };
const report = { period: 'month', window: { from: '2026-10-01', to: '2026-10-31' }, totalCents: 45000, count: 3, previousTotalCents: 40000, changePct: 12.5,
  byCategory: [{ key: 'rent', label: 'Rent / Landlord', totalCents: 30000, count: 1, changePct: 0 }, { key: 'supplies', label: 'Supplies', totalCents: 15000, count: 2, changePct: 50 }, { key: 'other', label: 'Other', totalCents: 0, count: 0, changePct: null }],
  byVendor: [], insights: [], reconciles: true, basis: 'Approved expenses' };
const cats = { categories: [{ key: 'rent', label: 'Rent / Landlord', isDefault: true, active: true, accountingCode: null }, { key: 'supplies', label: 'Supplies', isDefault: true, active: true, accountingCode: null }] };
const page = (items: unknown[], o: Record<string, unknown> = {}) => ({ items, total: items.length, page: 1, pageSize: 10, ...o });

const renderIt = () => render(<MemoryRouter><POSExpensesScreen /></MemoryRouter>);
beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.expenses.mockResolvedValue(page([exp()]));
  m.kpis.mockResolvedValue(kpis); m.report.mockResolvedValue(report); m.categories.mockResolvedValue(cats);
  m.detail.mockImplementation(async () => ({ expense: exp(), lineItems: [], allocations: [], documents: [], billPayments: [], history: [], duplicates: { status: 'none', matches: [] } }));
});

afterEach(async () => { await setLanguage('en'); });
// data the salon / server holds: vendor, description, category labels; the zone id
const DATA = ['BeautyCo', 'Acetone', 'Supplies', 'Rent / Landlord', 'America/New_York', 'ACH'];

describe('POSExpensesScreen in Vietnamese', () => {
  it('the KPIs, the toolbar and the records read in Vietnamese', async () => {
    await setLanguage('vi');
    const { container } = renderIt();
    await waitFor(() => expect(screen.getAllByText('BeautyCo').length).toBeGreaterThan(0));
    await screen.findByText('Chi phí');
    expect(leftoverEnglish(container, DATA).join(' | ')).toBe('');
  });
});
