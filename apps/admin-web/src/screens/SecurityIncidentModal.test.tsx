import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const { mockList, mockCreate, mockTxn } = vi.hoisted(() => ({ mockList: vi.fn(), mockCreate: vi.fn(), mockTxn: vi.fn() }));
vi.mock('../api/superAdminApi', () => ({ superAdminApi: {
  securityIncidents: () => mockList(),
  securityIncidentCreate: (b: any) => mockCreate(b),
  securityIncidentTransition: (id: string, b: any) => mockTxn(id, b),
} }));
import { SecurityIncidentModal } from './SecurityIncidentModal';

beforeEach(() => {
  mockList.mockReset(); mockCreate.mockReset(); mockTxn.mockReset();
  mockList.mockResolvedValue([{ id: 'inc1', incidentRef: 'INC-2026-001', severity: 'high', status: 'investigating' }]);
  mockCreate.mockResolvedValue({ id: 'inc2', incidentRef: 'INC-2026-002', status: 'detected' });
  mockTxn.mockResolvedValue({ id: 'inc1', status: 'contained' });
});

describe('SecurityIncidentModal', () => {
  it('lists incidents and creates a new one', async () => {
    render(<SecurityIncidentModal onClose={() => {}} />);
    expect(await screen.findByText('INC-2026-001')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('short description'), { target: { value: 'Suspicious logins' } });
    fireEvent.click(screen.getByRole('button', { name: /Open incident/ }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ title: 'Suspicious logins' })));
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it('offers only valid next statuses and applies a transition', async () => {
    render(<SecurityIncidentModal onClose={() => {}} />);
    await screen.findByText('INC-2026-001');
    fireEvent.click(screen.getByRole('button', { name: 'Advance' }));
    // investigating → contained | closed
    const select = screen.getAllByRole('combobox').find((s) => within(s).queryByText('Contained'))!;
    const opts = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(opts).toEqual(['Contained', 'Closed']);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(mockTxn).toHaveBeenCalledWith('inc1', expect.objectContaining({ toStatus: 'contained' })));
  });

  it('requires a reason to close, keeping Apply disabled until provided', async () => {
    mockList.mockResolvedValue([{ id: 'inc1', incidentRef: 'INC-2026-001', severity: 'high', status: 'remediating' }]);
    render(<SecurityIncidentModal onClose={() => {}} />);
    await screen.findByText('INC-2026-001');
    fireEvent.click(screen.getByRole('button', { name: 'Advance' }));
    const select = screen.getAllByRole('combobox').find((s) => within(s).queryByText('Closed'))!;
    fireEvent.change(select, { target: { value: 'closed' } });
    const apply = screen.getByRole('button', { name: 'Apply' });
    expect(apply).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('reason (required)'), { target: { value: 'remediated + verified' } });
    expect(screen.getByRole('button', { name: 'Apply' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(mockTxn).toHaveBeenCalledWith('inc1', { toStatus: 'closed', reason: 'remediated + verified' }));
  });
});
