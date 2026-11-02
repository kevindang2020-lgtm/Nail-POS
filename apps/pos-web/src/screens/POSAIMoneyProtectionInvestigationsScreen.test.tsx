import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const m = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), addNote: vi.fn(), setStatus: vi.fn(), resolve: vi.fn() }));
vi.mock('../api/posAIMoneyProtectionApi', () => ({ posAIMoneyProtectionApi: {
  listInvestigations: m.list, getInvestigation: m.get, addNote: m.addNote, setInvestigationStatus: m.setStatus,
  resolveInvestigation: m.resolve, assignInvestigation: vi.fn(), createInvestigation: vi.fn(),
} }));
import { POSAIMoneyProtectionInvestigationsScreen } from './POSAIMoneyProtectionInvestigationsScreen';
beforeEach(() => { Object.values(m).forEach((f) => f.mockReset()); });

const inv = {
  id: 'inv_1', title: 'Duplicate Charge Exact — review', category: 'general', severity: 'CRITICAL', status: 'OPEN',
  assignedUserId: null, valueUnderReviewCents: 5000, recoveryAmountCents: 0, resolution: null,
  related: { userIds: ['emp7'], alertIds: ['mpa_1'] }, createdAt: '2026-07-07T00:00:00Z', updatedAt: '2026-07-07T00:00:00Z', closedAt: null,
};

describe('POSAIMoneyProtectionInvestigationsScreen', () => {
  it('lists investigations, opens detail with notes, and adds an append-only note', async () => {
    m.list.mockResolvedValue([inv]);
    m.get.mockResolvedValueOnce({ investigation: inv, notes: [] })
         .mockResolvedValueOnce({ investigation: inv, notes: [{ id: 'n1', authorUserId: 'u1', body: 'Checked both txns', createdAt: '2026-07-07T01:00:00Z' }] });
    m.addNote.mockResolvedValue({ id: 'n1' });
    render(<POSAIMoneyProtectionInvestigationsScreen />);

    expect(await screen.findByText('Duplicate Charge Exact — review')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('dialog', { name: 'Investigation detail' })).toBeInTheDocument();
    expect(screen.getByText(/Notes \(append-only\)/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Add a note'), { target: { value: 'Checked both txns' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() => expect(m.addNote).toHaveBeenCalledWith('inv_1', 'Checked both txns'));
    expect(await screen.findByText(/Checked both txns/)).toBeInTheDocument();
  });

  it('records a resolution', async () => {
    m.list.mockResolvedValue([inv]);
    m.get.mockResolvedValue({ investigation: inv, notes: [] });
    m.resolve.mockResolvedValue({ ...inv, status: 'RESOLVED', resolution: 'FALSE_POSITIVE' });
    render(<POSAIMoneyProtectionInvestigationsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    await screen.findByRole('dialog', { name: 'Investigation detail' });
    fireEvent.click(screen.getByRole('button', { name: 'Record resolution' }));
    await waitFor(() => expect(m.resolve).toHaveBeenCalled());
    expect(m.resolve.mock.calls[0][0]).toBe('inv_1');
    expect(typeof m.resolve.mock.calls[0][1]).toBe('string'); // a resolution value from the dropdown
  });

  it('shows empty state', async () => {
    m.list.mockResolvedValue([]);
    render(<POSAIMoneyProtectionInvestigationsScreen />);
    expect(await screen.findByText(/No investigations yet/i)).toBeInTheDocument();
  });
});
