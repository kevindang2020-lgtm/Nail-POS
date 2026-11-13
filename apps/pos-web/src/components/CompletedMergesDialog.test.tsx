// CompletedMergesDialog — extras Customer 08: completed merges with a safe undo. Check undo shows the server's coded reason (and
// disables Undo when refused); Undo needs a reason and sends it; a refusal shows its text; without the merge permission there
// are no undo controls.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
const { api, m } = vi.hoisted(() => ({ api: { merges: vi.fn(), unmergeCheck: vi.fn(), unmerge: vi.fn() }, m: { perms: ['pos.customers.view', 'pos.customers.merge'] as string[] } }));
vi.mock('../api/posDuplicateReviewApi', () => ({ posDuplicateReviewApi: api }));
vi.mock('./usePermissions', () => ({ useCan: () => (p: string) => m.perms.includes(p) }));
import { CompletedMergesDialog } from './CompletedMergesDialog';

const rec = (id: string, over: Record<string, unknown> = {}) => ({ id, groupId: 'g' + id, mergedAt: '2026-11-12T15:00:00Z', mergedBy: 'Owner Kim', survivor: { id: 'p' + id, name: 'Maria Lopez' },
  sources: [{ id: 's' + id, name: 'Mary Lopez' }], status: 'active', undoneAt: null, undoneBy: null, undoReason: null, ...over });
const PAGE = { items: [rec('1'), rec('2'), rec('3', { status: 'undone', undoneAt: '2026-11-13T10:00:00Z', undoneBy: 'Owner Kim', undoReason: 'two people' })], total: 3, page: 1, pageSize: 10, totalPages: 1 };
beforeEach(() => { vi.clearAllMocks(); m.perms = ['pos.customers.view', 'pos.customers.merge']; api.merges.mockResolvedValue(PAGE); });

describe('CompletedMergesDialog', () => {
  it('lists merges; an undone one shows who / why and has no undo', async () => {
    render(<CompletedMergesDialog onClose={() => {}} />);
    const row3 = await screen.findByTestId('dup-um-3');
    expect(within(row3).getByTestId('dup-um-undone')).toHaveTextContent('two people');
    expect(within(row3).queryByTestId('dup-um-undo-btn')).toBeNull();
    expect(within(screen.getByTestId('dup-um-1')).getByText('Mary Lopez')).toBeInTheDocument();
  });
  it('Check undo shows the coded refusal and disables Undo', async () => {
    api.unmergeCheck.mockResolvedValue({ ok: false, code: 'CUSTOMER_UNMERGE_ROWS_CHANGED', message: 'x', details: { changed: { tickets: 1 } } });
    render(<CompletedMergesDialog onClose={() => {}} />);
    const row = await screen.findByTestId('dup-um-2');
    fireEvent.click(within(row).getByTestId('dup-um-check-btn'));
    expect(await within(row).findByTestId('dup-um-check')).toHaveTextContent('records from this merge were changed since');
    expect(within(row).getByTestId('dup-um-undo-btn')).toBeDisabled();
  });
  it('Undo needs a reason, sends it, and reports what came back; a refusal shows its text', async () => {
    api.unmerge.mockResolvedValueOnce({ snapshotId: '1', survivorId: 'p1', restoredCustomerIds: ['s1'], restored: { tickets: 2 }, pointsRestored: 40 });
    const changed = vi.fn();
    render(<CompletedMergesDialog onClose={() => {}} onChanged={changed} />);
    fireEvent.click(within(await screen.findByTestId('dup-um-1')).getByTestId('dup-um-undo-btn'));
    expect(screen.getByTestId('dup-um-go')).toBeDisabled();
    fireEvent.change(screen.getByTestId('dup-um-reason'), { target: { value: 'Two different people' } });
    fireEvent.click(screen.getByTestId('dup-um-go'));
    await waitFor(() => expect(api.unmerge).toHaveBeenCalledWith('1', 'Two different people'));
    expect(await screen.findByTestId('dup-um-notice')).toHaveTextContent('1 profile(s) restored, 40 points moved back');
    expect(changed).toHaveBeenCalled();
    api.unmerge.mockRejectedValueOnce({ status: 409, body: { code: 'CUSTOMER_UNMERGE_LOYALTY_CHANGED' } });
    fireEvent.click(within(screen.getByTestId('dup-um-2')).getByTestId('dup-um-undo-btn'));
    fireEvent.change(screen.getByTestId('dup-um-reason'), { target: { value: 'wrong merge' } });
    fireEvent.click(screen.getByTestId('dup-um-go'));
    expect(await screen.findByTestId('dup-um-error')).toHaveTextContent('Loyalty points changed after this merge');
  });
  it('without the merge permission: read-only', async () => {
    m.perms = ['pos.customers.view'];
    render(<CompletedMergesDialog onClose={() => {}} />);
    await screen.findByTestId('dup-um-1');
    expect(screen.queryByTestId('dup-um-undo-btn')).toBeNull();
    expect(screen.getByTestId('dup-um-readonly')).toBeInTheDocument();
  });
});
