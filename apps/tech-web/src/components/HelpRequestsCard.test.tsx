import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../lib/useTechStream', () => ({ useTechStream: () => {} }));
vi.mock('../api/techApi', async (orig) => ({ ...(await orig<typeof import('../api/techApi')>()), techApi: { helpRequests: vi.fn(), acceptHelp: vi.fn(), declineHelp: vi.fn() } }));
import { techApi } from '../api/techApi';
import { HelpRequestsCard } from './HelpRequestsCard';

const req = (over: Record<string, unknown> = {}) => ({
  id: 'help_1', ticketId: 'TK1', serviceLineId: 'L1', serviceId: 'svc', primaryTechnicianId: 'primary', helperTechnicianId: 'me',
  reason: 'Nail art specialist needed', note: null, status: 'pending', respondedAt: null, declineReason: null, createdAt: '2026-07-16T10:00:00Z', ...over,
});

describe('HelpRequestsCard (helper incoming requests)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a pending request with its reason and accept/decline actions', async () => {
    (techApi.helpRequests as any).mockResolvedValue([req()]);
    render(<HelpRequestsCard />);
    expect(await screen.findByText('Nail art specialist needed')).toBeTruthy();
    expect(screen.getByText('Accept')).toBeTruthy();
    expect(screen.getByText('Decline')).toBeTruthy();
  });

  it('accept calls acceptHelp and confirms the assignment', async () => {
    (techApi.helpRequests as any).mockResolvedValueOnce([req()]).mockResolvedValueOnce([]);
    (techApi.acceptHelp as any).mockResolvedValue(req({ status: 'accepted' }));
    render(<HelpRequestsCard />);
    fireEvent.click(await screen.findByText('Accept'));
    expect(await screen.findByText(/assigned to you/)).toBeTruthy();
    expect(techApi.acceptHelp).toHaveBeenCalledWith('help_1');
  });

  it('decline calls declineHelp and notes the primary was notified', async () => {
    (techApi.helpRequests as any).mockResolvedValueOnce([req()]).mockResolvedValueOnce([]);
    (techApi.declineHelp as any).mockResolvedValue(req({ status: 'declined' }));
    render(<HelpRequestsCard />);
    fireEvent.click(await screen.findByText('Decline'));
    expect(await screen.findByText(/notified/)).toBeTruthy();
    expect(techApi.declineHelp).toHaveBeenCalledWith('help_1');
  });

  it('renders nothing when there are no pending requests', async () => {
    (techApi.helpRequests as any).mockResolvedValue([]);
    const { container } = render(<HelpRequestsCard />);
    await waitFor(() => expect(techApi.helpRequests).toHaveBeenCalled());
    expect(container.querySelector('section[aria-label="Help requests"]')).toBeNull();
  });
});
