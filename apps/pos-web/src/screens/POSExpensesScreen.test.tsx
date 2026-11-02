import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

describe('POSExpensesScreen (Receipts & Expenses)', () => {
  it('shows the KPIs, the inbox, and where the money went (approved only)', async () => {
    renderIt();
    expect(await screen.findByRole('heading', { name: 'Receipts & Expenses' })).toBeInTheDocument();
    expect(screen.getAllByText('$450.00').length).toBe(2);          // this month KPI + the report total
    expect(screen.getByText('BeautyCo')).toBeInTheDocument();
    expect(screen.getByText('Acetone')).toBeInTheDocument();
    expect(screen.getAllByText('Rent / Landlord').length).toBeGreaterThan(0);
    expect(screen.getByText('$300.00')).toBeInTheDocument();
    expect(screen.queryByText('Other')).toBeNull();                     // $0 categories are not drawn
    expect(screen.getByText(/Only approved expenses are counted/)).toBeInTheDocument();
    expect(m.expenses).toHaveBeenCalledWith(expect.objectContaining({ tab: 'inbox' }));
  });
  it('switches tabs and asks the server for that tab', async () => {
    renderIt(); await screen.findByText('BeautyCo');
    fireEvent.click(screen.getByRole('tab', { name: /^Bills/ }));
    await waitFor(() => expect(m.expenses).toHaveBeenLastCalledWith(expect.objectContaining({ tab: 'bills' })));
  });
  it('approves with the version the screen saw', async () => {
    m.approve.mockResolvedValue({});
    renderIt(); await screen.findByText('BeautyCo');
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(m.approve).toHaveBeenCalledWith('e1', 3));
    expect(await screen.findByText('Expense approved.')).toBeInTheDocument();
  });
  it('a version conflict refreshes the list and says so', async () => {
    m.approve.mockRejectedValue(Object.assign(new Error('x'), { code: 'EXPENSE_VERSION_CONFLICT' }));
    renderIt(); await screen.findByText('BeautyCo');
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/Someone else changed this expense/)).toBeInTheDocument();
    expect(m.expenses.mock.calls.length).toBeGreaterThan(1);
  });
  it('validates before creating (no amount)', async () => {
    renderIt(); await screen.findByText('BeautyCo');
    fireEvent.click(screen.getByRole('button', { name: '+ Add Expense' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Expense' }));
    expect(await screen.findByText(/positive amount/i)).toBeInTheDocument();
    expect(m.createExpense).not.toHaveBeenCalled();
  });
  it('creates an expense in exact cents with an idempotency key, approving when allowed', async () => {
    m.createExpense.mockResolvedValue({ expense: exp({ status: 'approved' }), duplicate: { status: 'none', matches: [] }, created: true });
    renderIt(); await screen.findByText('BeautyCo');
    fireEvent.click(screen.getByRole('button', { name: '+ Add Expense' }));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '42.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Expense' }));
    await waitFor(() => expect(m.createExpense).toHaveBeenCalled());
    expect(m.createExpense.mock.calls[0][0]).toMatchObject({ amountCents: 4250, intent: 'approve', kind: 'expense' });
    expect(String(m.createExpense.mock.calls[0][0].idempotencyKey)).toMatch(/^pos-/);
  });
  it('a possible duplicate asks why before saving anyway — never silently drops it', async () => {
    m.createExpense.mockRejectedValueOnce(Object.assign(new Error('This looks similar to an expense already saved.'), { code: 'RECEIPT_POSSIBLE_DUPLICATE' }))
      .mockResolvedValueOnce({ expense: exp(), duplicate: { status: 'none', matches: [] }, created: true });
    renderIt(); await screen.findByText('BeautyCo');
    fireEvent.click(screen.getByRole('button', { name: '+ Add Expense' }));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '125' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Expense' }));
    expect(await screen.findByText('This looks like an expense already recorded.')).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save anyway' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/Two separate deliveries/), { target: { value: 'Two deliveries' } });
    fireEvent.click(save);
    await waitFor(() => expect(m.createExpense).toHaveBeenCalledTimes(2));
    expect(m.createExpense.mock.calls[1][0]).toMatchObject({ duplicateOverrideReason: 'Two deliveries' });
  });
  it('reject needs a reason', async () => {
    m.reject.mockResolvedValue({});
    renderIt(); await screen.findByText('BeautyCo');
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText(/Say why/)).toBeInTheDocument();
    expect(m.reject).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Personal purchase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(m.reject).toHaveBeenCalledWith('e1', 'Personal purchase', 3));
  });
  it('exports for the accountant', async () => {
    m.exportFile.mockResolvedValue({ filename: 'expenses.csv', contentType: 'text/csv', encoding: 'base64', content: 'YQ==', rowCount: 1, totalCents: 100 });
    renderIt(); await screen.findByText('BeautyCo');
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(m.save).toHaveBeenCalled());
    expect(m.exportFile).toHaveBeenCalledWith('csv', 'month');
  });
  it('uploads a receipt into the Receipt AI pipeline', async () => {
    m.upload.mockResolvedValue({ documentId: 'd1', pipelineState: 'review_required' });
    renderIt(); await screen.findByText('BeautyCo');
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'r.jpg', { type: 'image/jpeg' });
    if (!('arrayBuffer' in file)) Object.assign(file, { arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer });
    fireEvent.change(screen.getByLabelText('Receipt file'), { target: { files: [file] } });
    await waitFor(() => expect(m.upload).toHaveBeenCalled());
    expect(m.upload.mock.calls[0][0]).toMatchObject({ filename: 'r.jpg', mimeType: 'image/jpeg', sizeBytes: 4 });
    expect(await screen.findByText(/Receipt uploaded/)).toBeInTheDocument();
  });
});
