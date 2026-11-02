import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../api/techApi', async (orig) => ({ ...(await orig<typeof import('../api/techApi')>()), techApi: { qualifiedForLine: vi.fn(), requestHelp: vi.fn() } }));
import { techApi } from '../api/techApi';
import { RequestHelpModal } from './RequestHelpModal';

const lines = [{ id: 'L1', name: 'Acrylic Full Set' }, { id: 'L2', name: 'Nail Art' }];

describe('RequestHelpModal (primary requests help)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads qualified technicians for the first line and submits a request', async () => {
    (techApi.qualifiedForLine as any).mockResolvedValue([{ technicianId: 'h1', displayName: 'Bea', workingStatus: 'available', shiftStatus: 'on_shift', status: 'active' }]);
    (techApi.requestHelp as any).mockResolvedValue({ id: 'help_1' });
    const onDone = vi.fn(); const onClose = vi.fn();
    render(<RequestHelpModal ticketId="TK1" lines={lines} onClose={onClose} onDone={onDone} />);
    await waitFor(() => expect(techApi.qualifiedForLine).toHaveBeenCalledWith('TK1', 'L1'));
    expect(await screen.findByText('Bea')).toBeTruthy();
    fireEvent.click(screen.getByText('Send request'));
    await waitFor(() => expect(techApi.requestHelp).toHaveBeenCalled());
    const arg = (techApi.requestHelp as any).mock.calls[0][0];
    expect(arg).toMatchObject({ ticketId: 'TK1', serviceLineId: 'L1', helperTechnicianId: 'h1' });
    expect(arg.reason).toBeTruthy();
    expect(onDone).toHaveBeenCalled();
  });

  it('shows a no-qualified message and disables submit when none are available', async () => {
    (techApi.qualifiedForLine as any).mockResolvedValue([]);
    render(<RequestHelpModal ticketId="TK1" lines={lines} onClose={() => {}} />);
    expect(await screen.findByText(/No qualified technician/)).toBeTruthy();
    expect((screen.getByText('Send request') as HTMLButtonElement).disabled).toBe(true);
  });
});
