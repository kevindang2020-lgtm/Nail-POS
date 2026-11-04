// POSExpensesScreen.test — the Expenses guide (Nov 4 2026) rebuild: four KPIs from the server over the whole filtered set, the
// period bar (presets + Custom Range), server-side search / category / method / sort, numbered pages (newest added first),
// Add Expense (one key per form, Page 1 + highlight, "saved but hidden"), View expense with every workflow action, export.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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

const openForm = async () => { fireEvent.click(await screen.findByTestId('add-expense')); return screen.findByTestId('dlg-expense'); };
const openView = async () => { fireEvent.click(await screen.findByTestId('row-view')); return screen.findByTestId('dlg-view'); };

describe('POSExpensesScreen (Expenses guide)', () => {
  it('four KPIs from the server aggregate (Top Category by amount), the period it resolved, and the records', async () => {
    renderIt();
    expect(await screen.findByRole('heading', { name: 'Expenses' })).toBeInTheDocument();
    expect(await screen.findByTestId('kpi-total')).toHaveTextContent('$450.00');
    expect(screen.getByTestId('kpi-entries')).toHaveTextContent('3');
    expect(screen.getByTestId('kpi-top')).toHaveTextContent('Rent / Landlord');
    expect(screen.getByTestId('kpi-top')).toHaveTextContent('$300.00');
    expect(screen.getByTestId('kpi-cats')).toHaveTextContent('2');
    expect(screen.getByTestId('active-period')).toHaveTextContent(/Oct 1, 2026/);
    const row = await screen.findByTestId('expense-row');
    expect(row).toHaveTextContent('Acetone'); expect(row).toHaveTextContent('BeautyCo'); expect(row).toHaveTextContent('$125.00');
    expect(m.expenses).toHaveBeenCalledWith(expect.objectContaining({ tab: 'all', period: 'month', sort: 'created', page: 1 }));
    expect(m.kpis).toHaveBeenCalledWith(expect.objectContaining({ period: 'month' }));
  });
  it('the Top Category card opens every category of the period (approved only; $0 categories are not drawn)', async () => {
    renderIt(); fireEvent.click(await screen.findByTestId('kpi-top'));
    const d = await screen.findByTestId('dlg-categories');
    expect(await within(d).findByText('$300.00')).toBeInTheDocument();
    expect(within(d).queryByText('Other')).toBeNull();
    expect(within(d).getByText(/Only approved expenses are counted/)).toBeInTheDocument();
  });
  it('a tab, the search, the category, the method and the sort go to the server and return to Page 1', async () => {
    // the first answer lands the screen on page 3; after that the server answers the page it is asked for (a mock that always
    // said "page 3" made the screen's page-sync follow it back to 3 — the assertion then raced the sync)
    m.expenses.mockImplementation(async (q: { page: number }) => page([exp()], { total: 40, page: q.page }));
    m.expenses.mockResolvedValueOnce(page([exp()], { total: 40, page: 3 }));
    renderIt(); await screen.findByTestId('expense-row');
    fireEvent.click(screen.getByTestId('tab-bills'));
    await waitFor(() => expect(m.expenses).toHaveBeenLastCalledWith(expect.objectContaining({ tab: 'bills', page: 1 })));
    fireEvent.change(screen.getByTestId('category'), { target: { value: 'rent' } });
    fireEvent.change(screen.getByTestId('method'), { target: { value: 'cash' } });
    fireEvent.change(screen.getByTestId('sort'), { target: { value: 'amount' } });
    await waitFor(() => expect(m.expenses).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'rent', paymentMethod: 'cash', sort: 'amount', page: 1 })));
    await waitFor(() => expect(m.kpis).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'rent', paymentMethod: 'cash' })));
    fireEvent.change(screen.getByTestId('search'), { target: { value: 'acet' } });
    await waitFor(() => expect(m.expenses).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'acet', page: 1 })), { timeout: 2000 });
  });
  it('numbered pages: Page 2 asks the server for page 2', async () => {
    m.expenses.mockImplementation(async (q: { page: number }) => page([exp({ id: 'p' + q.page })], { total: 30, page: q.page, pageSize: 10 }));
    renderIt(); await screen.findByTestId('expense-row');
    fireEvent.click(screen.getByRole('button', { name: /Page 2/ }));
    await waitFor(() => expect(m.expenses).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
  });
  it('Custom Range: the calendar applies From / To and the KPIs and list follow', async () => {
    renderIt(); await screen.findByTestId('expense-row');
    fireEvent.click(screen.getByTestId('preset-custom'));
    const cal = await screen.findByTestId('range-calendar');
    const days = Array.from(within(cal).getByTestId('cal-left').querySelectorAll<HTMLElement>('[data-ymd]'));
    fireEvent.click(days[0]); fireEvent.click(days[4]);
    fireEvent.click(within(cal).getByTestId('range-apply'));
    await waitFor(() => expect(m.expenses).toHaveBeenLastCalledWith(expect.objectContaining({ period: 'custom', from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), page: 1 })));
    expect(m.kpis).toHaveBeenLastCalledWith(expect.objectContaining({ period: 'custom' }));
  });
  it('approves from View expense with the version the screen saw', async () => {
    m.approve.mockResolvedValue({});
    renderIt(); const v = await openView();
    fireEvent.click(await within(v).findByTestId('act-approve'));
    await waitFor(() => expect(m.approve).toHaveBeenCalledWith('e1', 3));
    expect(await screen.findByText('Expense approved.')).toBeInTheDocument();
  });
  it('a version conflict refreshes and says so', async () => {
    m.approve.mockRejectedValue(Object.assign(new Error('x'), { code: 'EXPENSE_VERSION_CONFLICT' }));
    renderIt(); const v = await openView();
    fireEvent.click(await within(v).findByTestId('act-approve'));
    expect(await within(v).findByText(/Someone else changed this expense/)).toBeInTheDocument();
    expect(m.detail.mock.calls.length).toBeGreaterThan(1);
  });
  it('validates before creating (no amount)', async () => {
    renderIt(); const f = await openForm();
    fireEvent.click(within(f).getByTestId('form-save'));
    expect(await within(f).findByText(/positive amount/i)).toBeInTheDocument();
    expect(m.createExpense).not.toHaveBeenCalled();
  });
  it('creates in exact cents with ONE idempotency key per form; the new row is first on Page 1 and highlighted', async () => {
    m.createExpense.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ expense: exp({ id: 'new1', status: 'approved' }), duplicate: { status: 'none', matches: [] }, created: true });
    renderIt(); const f = await openForm();
    fireEvent.change(within(f).getByTestId('f-amount'), { target: { value: '42.50' } });
    fireEvent.click(within(f).getByTestId('form-save'));
    await within(f).findByRole('alert');
    m.expenses.mockResolvedValue(page([exp({ id: 'new1', description: 'Gloves', amountCents: 4250 }), exp()]));
    fireEvent.click(within(f).getByTestId('form-save'));
    await waitFor(() => expect(m.createExpense).toHaveBeenCalledTimes(2));
    expect(m.createExpense.mock.calls[0][0]).toMatchObject({ amountCents: 4250, intent: 'approve', kind: 'expense' });
    expect(m.createExpense.mock.calls[1][0].idempotencyKey).toBe(m.createExpense.mock.calls[0][0].idempotencyKey);   // a retry is the same request
    expect(await screen.findByText(/first on Page 1/)).toBeInTheDocument();
    expect(screen.getAllByTestId('expense-row')[0]).toHaveClass('ex-new');
  });
  it('a saved expense the filters hide is said so, with View expense', async () => {
    m.createExpense.mockResolvedValue({ expense: exp({ id: 'old9', incurredOn: '2026-09-02' }), duplicate: { status: 'none', matches: [] }, created: true });
    renderIt(); const f = await openForm();
    fireEvent.change(within(f).getByTestId('f-amount'), { target: { value: '10' } });
    fireEvent.click(within(f).getByTestId('form-save'));
    expect(await screen.findByText(/outside the current period or filters/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View expense' }));
    await waitFor(() => expect(m.detail).toHaveBeenCalledWith('old9'));
  });
  it('a possible duplicate asks why before saving anyway — never silently drops it', async () => {
    m.createExpense.mockRejectedValueOnce(Object.assign(new Error('This looks similar to an expense already saved.'), { code: 'RECEIPT_POSSIBLE_DUPLICATE' }))
      .mockResolvedValueOnce({ expense: exp(), duplicate: { status: 'none', matches: [] }, created: true });
    renderIt(); const f = await openForm();
    fireEvent.change(within(f).getByTestId('f-amount'), { target: { value: '125' } });
    fireEvent.click(within(f).getByTestId('form-save'));
    expect(await within(f).findByText('This looks like an expense already recorded.')).toBeInTheDocument();
    const save = within(f).getByRole('button', { name: 'Save anyway' });
    expect(save).toBeDisabled();
    fireEvent.change(within(f).getByPlaceholderText(/Two separate deliveries/), { target: { value: 'Two deliveries' } });
    fireEvent.click(save);
    await waitFor(() => expect(m.createExpense).toHaveBeenCalledTimes(2));
    expect(m.createExpense.mock.calls[1][0]).toMatchObject({ duplicateOverrideReason: 'Two deliveries' });
  });
  it('Edit sends the change with its version; an approved expense needs a correction reason', async () => {
    m.expenses.mockResolvedValue(page([exp({ status: 'approved' })]));
    m.update.mockResolvedValue({ expense: exp({ status: 'approved', amountCents: 13000 }) });
    renderIt(); fireEvent.click(await screen.findByTestId('row-edit'));
    const f = await screen.findByTestId('dlg-expense');
    expect(within(f).getByTestId('f-amount')).toHaveValue('125.00');
    fireEvent.change(within(f).getByTestId('f-amount'), { target: { value: '130' } });
    fireEvent.click(within(f).getByTestId('form-save'));
    expect(await within(f).findByRole('alert')).toHaveTextContent(/corrected/);
    fireEvent.change(within(f).getByTestId('f-reason'), { target: { value: 'Typo on the receipt total' } });
    fireEvent.click(within(f).getByTestId('form-save'));
    await waitFor(() => expect(m.update).toHaveBeenCalledWith('e1', expect.objectContaining({ amountCents: 13000, version: 3, reason: 'Typo on the receipt total' })));
  });
  it('reject needs a reason', async () => {
    m.reject.mockResolvedValue({});
    renderIt(); const v = await openView();
    fireEvent.click(await within(v).findByRole('button', { name: 'Reject' }));
    const a = await screen.findByTestId('dlg-ask');
    fireEvent.click(within(a).getByTestId('ask-confirm'));
    expect(await within(a).findByText(/Say why/)).toBeInTheDocument();
    expect(m.reject).not.toHaveBeenCalled();
    fireEvent.change(within(a).getByTestId('ask-input'), { target: { value: 'Personal purchase' } });
    fireEvent.click(within(a).getByTestId('ask-confirm'));
    await waitFor(() => expect(m.reject).toHaveBeenCalledWith('e1', 'Personal purchase', 3));
  });
  it('exports the period with the active filters', async () => {
    m.exportFile.mockResolvedValue({ filename: 'expenses.csv', contentType: 'text/csv', encoding: 'base64', content: 'YQ==', rowCount: 1, totalCents: 100 });
    renderIt(); await screen.findByTestId('expense-row');
    fireEvent.change(screen.getByTestId('category'), { target: { value: 'rent' } });
    fireEvent.click(screen.getByTestId('export-csv'));
    await waitFor(() => expect(m.save).toHaveBeenCalled());
    expect(m.exportFile).toHaveBeenCalledWith('csv', 'month', expect.objectContaining({ category: 'rent' }));
  });
  it('uploads a receipt into the Receipt AI pipeline', async () => {
    m.upload.mockResolvedValue({ documentId: 'd1', pipelineState: 'review_required' });
    renderIt(); await screen.findByTestId('expense-row');
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'r.jpg', { type: 'image/jpeg' });
    if (!('arrayBuffer' in file)) Object.assign(file, { arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer });
    fireEvent.change(screen.getByLabelText('Receipt file'), { target: { files: [file] } });
    await waitFor(() => expect(m.upload).toHaveBeenCalled());
    expect(m.upload.mock.calls[0][0]).toMatchObject({ filename: 'r.jpg', mimeType: 'image/jpeg', sizeBytes: 4 });
    expect(await screen.findByText(/Receipt uploaded/)).toBeInTheDocument();
  });
  it('an empty period is a real $0.00 with Add Expense and Try another date — no fake rows', async () => {
    m.expenses.mockResolvedValue(page([]));
    m.kpis.mockResolvedValue({ ...kpis, totalCents: 0, entries: 0, categoriesUsed: 0, topCategory: null });
    renderIt();
    expect(await screen.findByText('No expenses found for this period.')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-total')).toHaveTextContent('$0.00');
    expect(screen.getByTestId('kpi-top')).toHaveTextContent('—');
    expect(screen.getByRole('button', { name: 'Try another date' })).toBeInTheDocument();
  });
});
