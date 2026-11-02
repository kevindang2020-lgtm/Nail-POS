import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/customerApi', () => ({ customerApi: { queue: vi.fn() } }));
vi.mock('../api/customerQueueApi', () => ({ customerQueueApi: { acceptAlternate: vi.fn() } }));
vi.mock('../api/useCustomerStream', () => ({ useCustomerStream: () => {} }));
import { customerApi } from '../api/customerApi';
import { customerQueueApi } from '../api/customerQueueApi';
import { LiveQueueScreen } from './LiveQueueScreen';

describe('LiveQueueScreen', () => {
  beforeEach(() => vi.clearAllMocks());
  it('renders the real position, total waiting, and ETA range', async () => {
    (customerApi.queue as any).mockResolvedValue({ inQueue: true, queueItemId: 'q3', position: 3, totalWaiting: 4, estimatedWaitMinMinutes: 24, estimatedWaitMaxMinutes: 36, status: 'waiting' });
    render(<MemoryRouter><LiveQueueScreen /></MemoryRouter>);
    expect(await screen.findByText('#3')).toBeInTheDocument();
    expect(screen.getByText(/in line of 4 waiting/)).toBeInTheDocument();
    expect(screen.getByText('24–36 mins')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
  });
  it('shows an honest not-in-line state', async () => {
    (customerApi.queue as any).mockResolvedValue({ inQueue: false });
    render(<MemoryRouter><LiveQueueScreen /></MemoryRouter>);
    expect(await screen.findByText('You’re not in line right now')).toBeInTheDocument();
  });

  // ---- BUILD_PLAN Phase 6 (ai_queue_assignment): estimated wait + "accept another technician" ----
  const busy = (over: any = {}) => ({ inQueue: true, queueItemId: 'q3', position: 2, totalWaiting: 4, estimatedWaitMinMinutes: 30, estimatedWaitMaxMinutes: 40, status: 'waiting',
    requestedTechnician: { technicianId: 'tA', name: 'Mai', busy: true, availableInMinutes: 35 },
    alternates: [{ technicianId: 'tB', name: 'Kim', availableInMinutes: 5 }, { technicianId: 'tC', name: 'Ana', availableInMinutes: 0 }], ...over });

  it('when the requested technician is busy, offers the alternates with their time; accepting one calls accept-alternate', async () => {
    (customerApi.queue as any).mockResolvedValueOnce(busy()).mockResolvedValue(busy({ requestedTechnician: { technicianId: 'tB', name: 'Kim', busy: false }, alternates: [] }));
    (customerQueueApi.acceptAlternate as any).mockResolvedValue({ ok: true, queueItemId: 'q3', requestedTechnicianId: 'tB', requestedTechnicianName: 'Kim', technicianName: 'Kim', version: 4 });
    render(<MemoryRouter><LiveQueueScreen /></MemoryRouter>);
    const offer = await screen.findByTestId('alternate-offer');
    expect(offer).toHaveTextContent('Mai is with another guest (about 35 min)');
    expect(within(offer).getByText('See Ana — free now')).toBeInTheDocument();
    fireEvent.click(within(offer).getByText('See Kim — about 5 min'));
    await waitFor(() => expect(customerQueueApi.acceptAlternate).toHaveBeenCalledWith('q3', 'tB'));
    expect(await screen.findByRole('status')).toHaveTextContent('You’re now waiting for Kim.');
    await waitFor(() => expect(screen.queryByTestId('alternate-offer')).toBeNull());   // reloaded: no longer busy
    expect(customerApi.queue).toHaveBeenCalledTimes(2);
  });

  it('no offer when the requested technician is free, or when the server sends no alternates (never guessed)', async () => {
    (customerApi.queue as any).mockResolvedValue(busy({ requestedTechnician: { technicianId: 'tA', name: 'Mai', busy: false } }));
    const { unmount } = render(<MemoryRouter><LiveQueueScreen /></MemoryRouter>);
    expect(await screen.findByText('30–40 mins')).toBeInTheDocument();
    expect(screen.queryByTestId('alternate-offer')).toBeNull();
    unmount();
    (customerApi.queue as any).mockResolvedValue(busy({ alternates: [] }));
    render(<MemoryRouter><LiveQueueScreen /></MemoryRouter>);
    expect(await screen.findByText('30–40 mins')).toBeInTheDocument();
    expect(screen.queryByTestId('alternate-offer')).toBeNull();
  });

  it('"Keep waiting" hides the offer without calling the server', async () => {
    (customerApi.queue as any).mockResolvedValue(busy());
    render(<MemoryRouter><LiveQueueScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Keep waiting for Mai'));
    expect(screen.queryByTestId('alternate-offer')).toBeNull();
    expect(customerQueueApi.acceptAlternate).not.toHaveBeenCalled();
  });

  it('a technician who was just taken (409) is said plainly and the queue reloads', async () => {
    (customerApi.queue as any).mockResolvedValue(busy());
    (customerQueueApi.acceptAlternate as any).mockRejectedValue(Object.assign(new Error('That technician was just taken — please choose another, or keep waiting.'), { status: 409 }));
    render(<MemoryRouter><LiveQueueScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('See Kim — about 5 min'));
    expect(await screen.findByRole('status')).toHaveTextContent('That technician was just taken — please choose another, or keep waiting.');
    await waitFor(() => expect(customerApi.queue).toHaveBeenCalledTimes(2));
  });

  it('a missing wait estimate says "Being estimated" instead of "undefined–undefined"', async () => {
    (customerApi.queue as any).mockResolvedValue({ inQueue: true, queueItemId: 'q3', position: 2, totalWaiting: 2, status: 'waiting' });
    render(<MemoryRouter><LiveQueueScreen /></MemoryRouter>);
    expect(await screen.findByText('Being estimated')).toBeInTheDocument();
  });
});
