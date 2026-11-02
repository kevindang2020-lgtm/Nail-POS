// ExpensesScreen (Owner App · Receipts & Expenses, finance mandate Oct 21 2026). Verifies: the KPIs + review inbox + "where
// the money went" render from the finance module; a new expense is saved in exact cents AND attached to the branch the owner
// is viewing (the earlier fix — a multi-branch owner's expense must not save as null-branch), the all-branches case (null
// branch), amount validation, a friendly 403, approve with the version seen, a possible duplicate asks why (never dropped),
// a draft is deleted (an approved one is only voided), a receipt goes to the Receipt AI pipeline, and vendor rules.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ branchId: 'branch-b' as string | undefined, branches: [] as any[] }));
const f = vi.hoisted(() => ({
  dashboard: vi.fn(), report: vi.fn(), list: vi.fn(), categories: vi.fn(), renameCategory: vi.fn(), rules: vi.fn(), addRule: vi.fn(), removeRule: vi.fn(), settings: vi.fn(), saveSettings: vi.fn(),
  create: vi.fn(), update: vi.fn(), approve: vi.fn(), reject: vi.fn(), returnToDraft: vi.fn(), voidExpense: vi.fn(), deleteDraft: vi.fn(), duplicateDecision: vi.fn(), billPayment: vi.fn(), exportFile: vi.fn(), uploadReceipt: vi.fn(), addReceiptPage: vi.fn(), readReceipt: vi.fn(), suggestedExpense: vi.fn(), linkReceipt: vi.fn(),
}));
vi.mock('../shell/nav', () => ({ useOwnerNav: () => ({ back: vi.fn() }) }));
vi.mock('../shell/OwnerBranchContext', () => ({ useOwnerBranch: () => ({ effectiveBranchId: h.branchId, branches: h.branches }) }));
vi.mock('../api/ownerApi', () => ({ ownerFinanceExpensesApi: f }));

import { webcrypto } from 'node:crypto';
import { ExpensesScreen } from './ExpensesScreen';

const expense = (over: Record<string, unknown> = {}) => ({ id: 'e1', branchId: 'branch-b', kind: 'expense', status: 'pending_review', category: 'supplies', categoryLabel: 'Supplies', amountCents: 25000, description: null,
  vendor: 'Sally Beauty', vendorDisplay: 'Sally Beauty', incurredOn: '2026-10-10', dueDate: null, openCents: 0, duplicateStatus: 'none', reimbursementStatus: 'not_required', vendorId: null, receiptDocumentId: null, version: 2, ...over });
const dash = { today: '2026-10-21', thisMonthCents: 25000, thisYearCents: 25000, todayCents: 0, todayCount: 0, receiptsUploadedToday: 0, needsReview: 1, drafts: 0, possibleDuplicates: 0, billsDue: 0, billsOverdue: 0, billsOpenCents: 0, reimbursementsOpen: 0 };
const report = { period: 'month', window: { from: '2026-10-01', to: '2026-10-31' }, totalCents: 25000, count: 1, byCategory: [{ key: 'supplies', label: 'Supplies', totalCents: 25000, count: 1 }], insights: [], reconciles: true };
const cats = { categories: [{ key: 'rent', label: 'Rent / Landlord', active: true }, { key: 'supplies', label: 'Supplies', active: true }] };

beforeEach(() => {
  vi.clearAllMocks();
  h.branchId = 'branch-b'; h.branches = [];
  f.list.mockResolvedValue({ items: [expense()], total: 1, page: 1, pageSize: 50 });
  f.dashboard.mockResolvedValue(dash); f.report.mockResolvedValue(report); f.categories.mockResolvedValue(cats);
  f.create.mockResolvedValue({ expense: expense(), duplicate: { status: 'none', matches: [] }, created: true });
  f.approve.mockResolvedValue({}); f.deleteDraft.mockResolvedValue({ id: 'e1', deleted: true });
  f.suggestedExpense.mockResolvedValue({ verdict: 'unmatched', expenseId: null, reason: null, candidates: [] });
});
const openForm = () => fireEvent.click(screen.getByLabelText('Add expense'));
const ready = () => screen.findByText('Where the money went');

describe('ExpensesScreen', () => {
  it('renders the KPIs, the review inbox and where the money went', async () => {
    render(<ExpensesScreen />);
    await ready();
    expect(screen.getAllByText('$250.00').length).toBeGreaterThan(1);           // KPI + row + report
    expect(screen.getByText('Sally Beauty')).toBeInTheDocument();
    expect(f.list).toHaveBeenCalledWith('needs_review', undefined, 'branch-b');
    expect(screen.getByText(/Approved expenses only/)).toBeInTheDocument();
  });

  it('saves a new expense with cents and the viewed branch id (fix)', async () => {
    render(<ExpensesScreen />);
    await ready();
    openForm();
    fireEvent.change(screen.getByPlaceholderText(/Amount/), { target: { value: '250.00' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(f.create).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 25000, branchId: 'branch-b', intent: 'approve', kind: 'expense' })));
    expect(String(f.create.mock.calls[0][0].idempotencyKey)).toMatch(/^owner-/);
  });

  it('attaches a null branch in all-branches mode', async () => {
    h.branchId = undefined;
    render(<ExpensesScreen />);
    await ready();
    openForm();
    fireEvent.change(screen.getByPlaceholderText(/Amount/), { target: { value: '100' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(f.create).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 10000, branchId: null })));
  });

  it('rejects an invalid amount without calling the API', async () => {
    render(<ExpensesScreen />);
    await ready();
    openForm();
    fireEvent.change(screen.getByPlaceholderText(/Amount/), { target: { value: 'abc' } });
    fireEvent.click(screen.getByText('Save'));
    expect(await screen.findByText('Enter a valid amount.')).toBeInTheDocument();
    expect(f.create).not.toHaveBeenCalled();
  });

  it('shows a friendly message on a 403', async () => {
    f.list.mockRejectedValue({ status: 403 }); f.dashboard.mockRejectedValue({ status: 403 });
    render(<ExpensesScreen />);
    expect(await screen.findByText('You do not have access to expenses.')).toBeInTheDocument();
  });

  it('approves with the version it saw', async () => {
    render(<ExpensesScreen />);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(f.approve).toHaveBeenCalledWith('e1', 2));
  });

  it('a possible duplicate asks why before saving anyway', async () => {
    f.create.mockRejectedValueOnce(Object.assign(new Error('This looks similar to an expense already saved.'), { code: 'RECEIPT_POSSIBLE_DUPLICATE', status: 409 }));
    render(<ExpensesScreen />);
    await ready();
    openForm();
    fireEvent.change(screen.getByPlaceholderText(/Amount/), { target: { value: '250' } });
    fireEvent.click(screen.getByText('Save'));
    expect(await screen.findByText('This looks like an expense already recorded.')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Why is it not a duplicate?'), { target: { value: 'Second delivery' } });
    fireEvent.click(screen.getByText('Save anyway'));
    await waitFor(() => expect(f.create).toHaveBeenLastCalledWith(expect.objectContaining({ duplicateOverrideReason: 'Second delivery' })));
  });

  it('deletes a draft (an approved expense is voided, never deleted)', async () => {
    f.list.mockResolvedValue({ items: [expense({ status: 'draft' }), expense({ id: 'e2', status: 'approved', vendorDisplay: 'Landlord LLC' })], total: 2, page: 1, pageSize: 50 });
    render(<ExpensesScreen />);
    await ready();
    expect(screen.getAllByLabelText('Delete draft')).toHaveLength(1);
    fireEvent.click(screen.getByLabelText('Delete draft'));
    await waitFor(() => expect(f.deleteDraft).toHaveBeenCalledWith('e1'));
    expect(screen.getByRole('button', { name: 'Void' })).toBeInTheDocument();
  });

  it('sends a receipt photo to the Receipt AI pipeline', async () => {
    f.uploadReceipt.mockResolvedValue({ documentId: 'd1', pipelineState: 'review_required' });
    render(<ExpensesScreen />);
    await ready();
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'bill.pdf', { type: 'application/pdf' });
    if (!('arrayBuffer' in file)) Object.assign(file, { arrayBuffer: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer });
    fireEvent.change(screen.getByLabelText('Choose a receipt photo or PDF'), { target: { files: [file] } });
    await waitFor(() => expect(f.uploadReceipt).toHaveBeenCalledWith(expect.objectContaining({ filename: 'bill.pdf', mimeType: 'application/pdf', sizeBytes: 4 })));
  });

  // Receipt / Expense / OCR close-out (Oct 27 2026)
  const photo = (name: string) => { const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]); const file = new File([bytes], name, { type: 'image/png' }); Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer.slice(0) }); return file; };
  const okUpload = { documentId: 'd1', pipelineState: 'extracting', quality: { flags: [], difficult: false }, thumbnailKey: null, pageCount: 1 };
  it('§18: three photos ask "one receipt or several?" — Combine uploads page 1 deferred, appends pages 2–3 under the SAME document, then reads it once', async () => {
    f.uploadReceipt.mockResolvedValue(okUpload); f.addReceiptPage.mockResolvedValue({ documentId: 'd1', pageCount: 2, pipelineState: 'extracting', quality: { flags: [], difficult: false } }); f.readReceipt.mockResolvedValue({ pipelineState: 'review_required', providerKey: 'x', unavailable: false });
    render(<ExpensesScreen />); await ready();
    fireEvent.change(screen.getByLabelText('Choose a receipt photo or PDF'), { target: { files: [photo('p1.png'), photo('p2.png'), photo('p3.png')] } });
    expect(await screen.findByText('3 photos — one receipt or several?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Combine into one receipt (3 pages)' }));
    await waitFor(() => expect(f.readReceipt).toHaveBeenCalledWith('d1'));
    expect(f.uploadReceipt).toHaveBeenCalledTimes(1);
    expect(f.uploadReceipt.mock.calls[0][0]).toMatchObject({ filename: 'p1.png', source: 'owner_app_upload', deferExtraction: true });
    expect(f.addReceiptPage.mock.calls.map((c) => [c[0], c[1].filename])).toEqual([['d1', 'p2.png'], ['d1', 'p3.png']]);
    expect(await screen.findByText(/Receipt uploaded \(3 pages\)/)).toBeInTheDocument();
  });
  it('§142 (Oct 27 2026): a receipt that matches an expense already recorded offers "Link to that expense" — it links as that expense\'s receipt, never a second expense', async () => {
    f.uploadReceipt.mockResolvedValue({ ...okUpload, documentId: 'd9' });
    f.suggestedExpense.mockResolvedValue({ verdict: 'matched', expenseId: 'e1', reason: 'same_total,same_vendor,same_date', candidates: [] });
    f.linkReceipt.mockResolvedValue({ expenseId: 'e1', documentId: 'd9' });
    render(<ExpensesScreen />); await ready();
    fireEvent.change(screen.getByLabelText('Choose a receipt photo or PDF'), { target: { files: [photo('dup.png')] } });
    expect(await screen.findByText(/This receipt matches an expense already recorded/)).toBeInTheDocument();
    expect(f.suggestedExpense).toHaveBeenCalledWith('d9');
    fireEvent.click(screen.getByRole('button', { name: 'Link to that expense' }));
    await waitFor(() => expect(f.linkReceipt).toHaveBeenCalledWith('e1', 'd9'));
    expect(await screen.findByText('Receipt linked to that expense.')).toBeInTheDocument();
    expect(f.create).not.toHaveBeenCalled();
  });
  it('§142: no match (or the suggestion call failing) shows nothing extra and never fails the upload', async () => {
    f.uploadReceipt.mockResolvedValue(okUpload); f.suggestedExpense.mockRejectedValue(new Error('finance away'));
    render(<ExpensesScreen />); await ready();
    fireEvent.change(screen.getByLabelText('Choose a receipt photo or PDF'), { target: { files: [photo('ok.png')] } });
    expect(await screen.findByText(/Receipt uploaded\. It is being read now/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Link to that expense' })).toBeNull();
  });
  it('§26: a receipt the server found hard to read shows the guidance with Retake / Process anyway — it was accepted either way; the camera names its channel', async () => {
    f.uploadReceipt.mockResolvedValue({ ...okUpload, quality: { flags: ['too_dark'], difficult: true } });
    render(<ExpensesScreen />); await ready();
    fireEvent.change(screen.getByLabelText('Take a photo of a receipt'), { target: { files: [photo('dark.png')] } });
    expect(await screen.findByText('This receipt may be difficult to read.')).toBeInTheDocument();
    expect(screen.getByText('too dark')).toBeInTheDocument();
    expect(f.uploadReceipt.mock.calls[0][0]).toMatchObject({ source: 'mobile_camera' });
    expect(screen.getByRole('button', { name: 'Retake photo' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Process anyway' }));
    await waitFor(() => expect(screen.queryByText('This receipt may be difficult to read.')).toBeNull());
    expect(f.readReceipt).not.toHaveBeenCalled();   // a single photo was already being read
  });
  it('§155–§157: offline, the photo is held on this phone (encrypted) and nothing is recorded; back online it uploads by itself', async () => {
    if (!(globalThis as any).crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
    f.uploadReceipt.mockResolvedValue(okUpload);
    render(<ExpensesScreen />); await ready();
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    fireEvent.change(screen.getByLabelText('Choose a receipt photo or PDF'), { target: { files: [photo('held.png')] } });
    expect(await screen.findByText(/No connection — 1 receipt saved on this phone, encrypted/)).toBeInTheDocument();
    expect(f.uploadReceipt).not.toHaveBeenCalled();
    expect(await screen.findByText('1 receipt waiting to upload from this phone.')).toBeInTheDocument();
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(f.uploadReceipt).toHaveBeenCalledTimes(1));
    expect(f.uploadReceipt.mock.calls[0][0]).toMatchObject({ filename: 'held.png', source: 'owner_app_upload' });
    await waitFor(() => expect(screen.queryByText('1 receipt waiting to upload from this phone.')).toBeNull());
  });
  it('§177 / §83: the notification switches and the auto-approval rules save through the settings (vendor + amount in cents)', async () => {
    const settings = { requireApproval: true, duplicateDetection: true, learnFromCorrections: true, version: 4, notifyNeedsReview: true, notifyBillDue: true, notifyDuplicate: true, notifyWeeklySummary: true, notifyMonthlySummary: false, autoApprovalRules: [{ vendorNorm: 'pse and g', maxCents: 50000, categoryKey: null, enabled: true }], sharedCostPolicy: 'NONE', sharedCostShares: [] };
    f.rules.mockResolvedValue({ rules: [] }); f.settings.mockResolvedValue(settings); f.saveSettings.mockResolvedValue({ ...settings, version: 5 });
    render(<ExpensesScreen />); await ready();
    fireEvent.click(screen.getByText('Categories & rules'));
    await screen.findByText('Tell me about');
    expect(screen.getByLabelText('A monthly expense summary')).not.toBeChecked();
    fireEvent.click(screen.getByLabelText('A monthly expense summary'));
    await waitFor(() => expect(f.saveSettings).toHaveBeenCalledWith({ notifyMonthlySummary: true, version: 4 }));
    expect(screen.getByText('pse and g · up to $500.00')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Trusted vendor'), { target: { value: 'Google Workspace' } });
    fireEvent.change(screen.getByLabelText('Approve up to'), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    await waitFor(() => expect(f.saveSettings).toHaveBeenCalledWith({ autoApprovalRules: [{ vendor: 'pse and g', maxCents: 50000, categoryKey: null }, { vendor: 'Google Workspace', maxCents: 12000 }], version: 5 }));   // the version the previous save answered
    fireEvent.click(screen.getByRole('button', { name: 'Remove auto-approval for pse and g' }));
    await waitFor(() => expect(f.saveSettings).toHaveBeenCalledWith({ autoApprovalRules: [], version: 5 }));
  });

  it('adds a vendor rule', async () => {
    f.rules.mockResolvedValue({ rules: [] }); f.settings.mockResolvedValue({ requireApproval: true, duplicateDetection: true, learnFromCorrections: true, version: 1 });
    f.addRule.mockResolvedValue({ id: 'r1' });
    render(<ExpensesScreen />);
    await ready();
    fireEvent.click(screen.getByText('Categories & rules'));
    await screen.findByText('Vendor rules');
    fireEvent.change(screen.getByPlaceholderText('Vendor'), { target: { value: 'PSE&G' } });
    fireEvent.change(screen.getByLabelText('Rule category'), { target: { value: 'rent' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(f.addRule).toHaveBeenCalledWith('PSE&G', 'rent'));
  });
});

describe('ExpensesScreen — the rest of the finance surface', () => {
  it('approves every clean expense waiting for review in one tap', async () => {
    f.list.mockResolvedValue({ items: [expense(), expense({ id: 'e2', vendorDisplay: 'Other Co' })], total: 2, page: 1, pageSize: 50 });
    (f as Record<string, ReturnType<typeof vi.fn>>).batchApprove = vi.fn().mockResolvedValue({ approved: ['e1'], exceptions: [{ id: 'e2', reason: 'possible duplicate' }] });
    render(<ExpensesScreen />);
    await ready();
    fireEvent.click(screen.getByText('Approve all clean'));
    expect(await screen.findByText('1 approved · 1 need a look.')).toBeInTheDocument();
  });
  it('warns before saving when the amount looks already recorded', async () => {
    (f as Record<string, ReturnType<typeof vi.fn>>).checkDuplicates = vi.fn().mockResolvedValue({ status: 'possible', matches: [{ id: 'e1', status: 'possible', reason: 'same vendor, amount, date' }] });
    render(<ExpensesScreen />);
    await ready();
    openForm();
    const amount = screen.getByPlaceholderText(/Amount/);
    fireEvent.change(amount, { target: { value: '250' } });
    fireEvent.blur(amount);
    expect(await screen.findByText(/may already be recorded/)).toBeInTheDocument();
  });
  it('parses a CSV with quoted cells', async () => {
    const { parseExpenseCsv } = await import('./ExpensesScreen');
    expect(parseExpenseCsv('date,vendor,amount,category\n2026-10-01,"Sally, Inc",12.50,Supplies\n')).toEqual([{ date: '2026-10-01', vendor: 'Sally, Inc', amount: '12.50', category: 'Supplies', branch: null, description: null }]);
  });

  it('P2-3: a branch report shows its share of salon-wide costs and the total with them (the direct total is unchanged)', async () => {
    f.report.mockResolvedValue({ ...report, sharedCosts: { policy: 'MANUAL_PERCENTAGE', salonWideCents: 100001, salonWideCount: 1, branch: { branchId: 'branch-b', label: 'Uptown', allocatedCents: 50001, expenseCount: 1, byOwnSplitCents: 0, byPolicyCents: 50001 }, reconciles: true, basis: '' } });
    render(<ExpensesScreen />);
    await ready();
    expect(screen.getByTestId('shared-cost-share').textContent).toContain('$500.01');
    expect(screen.getByText('With salon-wide costs').parentElement!.textContent).toContain('$750.01');   // 250.00 own + 500.01 share
  });
  it('P2-3: the owner sets 50 / 50 branch shares and saves them with the version seen', async () => {
    h.branches = [{ branchId: 'branch-a', branchName: 'Downtown' }, { branchId: 'branch-b', branchName: 'Uptown' }];
    f.rules.mockResolvedValue({ rules: [] });
    f.settings.mockResolvedValue({ requireApproval: true, duplicateDetection: true, learnFromCorrections: true, sharedCostPolicy: 'NONE', sharedCostShares: [], version: 4 });
    f.saveSettings.mockResolvedValue({ requireApproval: true, duplicateDetection: true, learnFromCorrections: true, sharedCostPolicy: 'MANUAL_PERCENTAGE', sharedCostShares: [], version: 5 });
    render(<ExpensesScreen />);
    await ready();
    fireEvent.click(screen.getByText('Categories & rules'));
    fireEvent.click(await screen.findByText('Split them by my percentages'));
    fireEvent.change(screen.getByLabelText('Downtown share percent'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Uptown share percent'), { target: { value: '50' } });
    expect(screen.getByText(/Total 100%/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Save shares'));
    await waitFor(() => expect(f.saveSettings).toHaveBeenCalledWith({ sharedCostPolicy: 'MANUAL_PERCENTAGE', sharedCostShares: expect.arrayContaining([{ branchId: 'branch-a', basisPoints: 5000 }, { branchId: 'branch-b', basisPoints: 5000 }]), version: 4 }));
  });
});

