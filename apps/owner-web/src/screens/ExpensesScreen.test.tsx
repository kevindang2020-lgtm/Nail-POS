// ExpensesScreen (owner money screen): record/list/delete operating costs. Verifies the summary + rows render, a new
// expense is saved with dollars converted to cents AND attached to the branch the owner is viewing (the fix — otherwise
// a multi-branch owner's expense saves as null-branch and vanishes from the single-branch view), amount validation, the
// all-branches case (null branch), a friendly 403, and delete.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ branchId: 'branch-b' as string | undefined }));
vi.mock('../shell/nav', () => ({ useOwnerNav: () => ({ back: vi.fn() }) }));
vi.mock('../shell/OwnerBranchContext', () => ({ useOwnerBranch: () => ({ effectiveBranchId: h.branchId }) }));
vi.mock('../api/ownerApi', () => ({
  ownerExpensesApi: { list: vi.fn(), summary: vi.fn(), create: vi.fn(), remove: vi.fn() },
  EXPENSE_CATEGORIES: ['rent', 'supplies', 'utilities', 'payroll', 'marketing', 'equipment', 'maintenance', 'insurance', 'software', 'other'],
}));

import { ownerExpensesApi } from '../api/ownerApi';
import { ExpensesScreen } from './ExpensesScreen';

const expense = (over: any = {}) => ({ id: 'e1', branchId: 'branch-b', category: 'supplies', amountCents: 25000, description: null, vendor: 'Sally Beauty', incurredOn: '2026-06-10', createdAt: '2026-06-10T00:00:00Z', ...over });
const summary = (over: any = {}) => ({ period: { from: '2026-06-01', to: '2026-06-30' }, totalCents: 25000, count: 1, byCategory: [{ category: 'supplies', amountCents: 25000, count: 1 }], ...over });

beforeEach(() => {
  vi.clearAllMocks();
  h.branchId = 'branch-b';
  (ownerExpensesApi.list as any).mockResolvedValue([expense()]);
  (ownerExpensesApi.summary as any).mockResolvedValue(summary());
  (ownerExpensesApi.create as any).mockResolvedValue(expense());
  (ownerExpensesApi.remove as any).mockResolvedValue({ id: 'e1', deleted: true });
});

const openForm = () => fireEvent.click(screen.getByRole('button', { name: /Add manual/i }));

describe('ExpensesScreen', () => {
  it('renders the total and expense rows', async () => {
    render(<ExpensesScreen />);
    expect(await screen.findByText('Total')).toBeInTheDocument();
    expect(screen.getAllByText('$250.00').length).toBeGreaterThan(0);         // money() formatting (total + row)
    expect(screen.getByText(/Sally Beauty/)).toBeInTheDocument();             // row detail
  });

  it('saves a new expense with cents and the viewed branch id (fix)', async () => {
    render(<ExpensesScreen />);
    await screen.findByText('Total');
    openForm();
    fireEvent.change(screen.getByPlaceholderText(/Amount/), { target: { value: '250.00' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(ownerExpensesApi.create).toHaveBeenCalledWith(expect.objectContaining({
      category: 'supplies', amountCents: 25000, branchId: 'branch-b',
    })));
  });

  it('attaches a null branch in all-branches mode', async () => {
    h.branchId = undefined;
    render(<ExpensesScreen />);
    await screen.findByText('Total');
    openForm();
    fireEvent.change(screen.getByPlaceholderText(/Amount/), { target: { value: '100' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(ownerExpensesApi.create).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 10000, branchId: null })));
  });

  it('rejects an invalid amount without calling the API', async () => {
    render(<ExpensesScreen />);
    await screen.findByText('Total');
    openForm();
    fireEvent.change(screen.getByPlaceholderText(/Amount/), { target: { value: 'abc' } });
    fireEvent.click(screen.getByText('Save'));
    expect(await screen.findByText('Enter a valid amount.')).toBeInTheDocument();
    expect(ownerExpensesApi.create).not.toHaveBeenCalled();
  });

  it('shows a friendly message on a 403', async () => {
    (ownerExpensesApi.list as any).mockRejectedValue({ status: 403 });
    (ownerExpensesApi.summary as any).mockRejectedValue({ status: 403 });
    render(<ExpensesScreen />);
    expect(await screen.findByText('You do not have access to expenses.')).toBeInTheDocument();
  });

  it('deletes an expense', async () => {
    render(<ExpensesScreen />);
    await screen.findByText('Total');
    fireEvent.click(screen.getByLabelText('Delete'));
    await waitFor(() => expect(ownerExpensesApi.remove).toHaveBeenCalledWith('e1'));
  });

  it('renders the card view with icon and add button when there are no expenses', async () => {
    (ownerExpensesApi.list as any).mockResolvedValue([]);
    (ownerExpensesApi.summary as any).mockResolvedValue({ period: { from: '2026-06-01', to: '2026-06-30' }, totalCents: 0, count: 0, byCategory: [] });
    render(<ExpensesScreen />);
    expect(await screen.findByText('No expenses')).toBeInTheDocument();
    expect(screen.getByText('Tap + to record one.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add manual/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add Expense/i })).toBeInTheDocument();
  });

  it('loads expenses with custom date range when selected from the calendar modal', async () => {
    render(<ExpensesScreen />);
    await screen.findByText('Total');
    fireEvent.click(screen.getByLabelText('Select Date Range'));
    expect(screen.getByText('Select Date')).toBeInTheDocument();
    fireEvent.click(screen.getByText('This Quarter'));
    await waitFor(() => expect(ownerExpensesApi.list).toHaveBeenCalledWith(
      'month',
      'branch-b',
      expect.objectContaining({ startDate: expect.any(String), endDate: expect.any(String) }),
    ));
  });
});
