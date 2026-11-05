import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MobilePaymentsCard } from './MobilePaymentsCard';

vi.mock('../api/posMobilePaymentsApi', () => ({ posMobilePaymentsApi: { phones: vi.fn(), claims: vi.fn(), sendToPhone: vi.fn() } }));
vi.mock('../realtime/useRealtime', () => ({ useRealtime: () => {} }));
import { posMobilePaymentsApi } from '../api/posMobilePaymentsApi';

const phone = { deviceId: 'dev-1', label: "Kevin's iPhone", userName: 'Kevin', online: true, status: 'active', tapToPayCapable: true, lastSeenAt: null };

describe('POS MobilePaymentsCard (TTP §45, §149–§151)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (posMobilePaymentsApi.phones as any).mockResolvedValue([phone, { ...phone, deviceId: 'dev-2', label: 'Back iPhone', userName: 'Mia', online: false, tapToPayCapable: false }]);
    (posMobilePaymentsApi.claims as any).mockResolvedValue([]);
  });

  it('shows each phone online / offline and sends the open checkout to one', async () => {
    (posMobilePaymentsApi.sendToPhone as any).mockResolvedValue({ sent: true });
    render(<MobilePaymentsCard ticketId="tk1" ticketPaid={false} />);
    expect(await screen.findByText("Kevin's iPhone")).toBeInTheDocument();
    expect(screen.getByText(/Kevin · Online · Tap to Pay/)).toBeInTheDocument();
    expect(screen.getByText(/Mia · Offline/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByText('Send to phone')[0]);
    await waitFor(() => expect(posMobilePaymentsApi.sendToPhone).toHaveBeenCalledWith('tk1', 'dev-1'));
    expect(await screen.findByText(/Sent to Kevin's iPhone/)).toBeInTheDocument();
  });

  it('a phone holding the open ticket shows "Payment in progress" and reports the claim; no Send buttons', async () => {
    (posMobilePaymentsApi.claims as any).mockResolvedValue([{ ticketId: 'tk1', userId: 'u1', userName: 'Kevin', deviceId: 'dev-1', deviceLabel: "Kevin's iPhone", expiresAt: '2026-10-13T12:00:00Z' }]);
    const onClaim = vi.fn();
    render(<MobilePaymentsCard ticketId="tk1" ticketPaid={false} onClaimChange={onClaim} />);
    expect(await screen.findByText(/Payment in progress on Kevin's iPhone · Kevin/)).toBeInTheDocument();
    expect(screen.queryByText('Send to phone')).not.toBeInTheDocument();
    await waitFor(() => expect(onClaim).toHaveBeenLastCalledWith(expect.objectContaining({ ticketId: 'tk1', deviceLabel: "Kevin's iPhone" })));
  });

  it('a claim on ANOTHER ticket does not block this one', async () => {
    (posMobilePaymentsApi.claims as any).mockResolvedValue([{ ticketId: 'tk-other', userId: 'u1', userName: 'Kevin', deviceId: 'dev-1', deviceLabel: "Kevin's iPhone", expiresAt: '' }]);
    const onClaim = vi.fn();
    render(<MobilePaymentsCard ticketId="tk1" ticketPaid={false} onClaimChange={onClaim} />);
    await screen.findByText("Kevin's iPhone");
    expect(screen.queryByText(/Payment in progress/)).not.toBeInTheDocument();
    expect(onClaim).toHaveBeenLastCalledWith(null);
  });

  it('no permission (403) → no card; no phones → an honest line', async () => {
    (posMobilePaymentsApi.phones as any).mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
    const { container } = render(<MobilePaymentsCard ticketId="tk1" ticketPaid={false} />);
    await waitFor(() => expect(posMobilePaymentsApi.phones).toHaveBeenCalled());
    expect(container.textContent).toBe('');
    (posMobilePaymentsApi.phones as any).mockResolvedValue([]);
    render(<MobilePaymentsCard ticketId="tk1" ticketPaid={false} />);
    expect(await screen.findByText('No approved payment phones in this location.')).toBeInTheDocument();
  });
});
