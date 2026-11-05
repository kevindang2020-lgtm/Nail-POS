// TicketsListScreen.test.tsx — the Tickets tab loads /tech/tickets and lists each assigned ticket (tappable into its
// detail), with loading / empty / error states. Wrapped in TechNavProvider because rows call nav.openTicket.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TechNavProvider } from '../shell/nav';

vi.mock('../api/techApi', async (orig) => ({
  ...(await orig<typeof import('../api/techApi')>()),
  techApi: { tickets: vi.fn() },
}));
import { techApi } from '../api/techApi';
import { TicketsListScreen } from './TicketsListScreen';

const renderScreen = () => render(<TechNavProvider><TicketsListScreen /></TechNavProvider>);
const ticket = (over: Record<string, unknown> = {}) => ({
  ticketId: 'k1', ticketNumber: 'T-1001', customerName: 'Dana Lee', serviceSummary: 'Gel Manicure',
  status: 'in_service', startedAt: null, ...over,
});

describe('TicketsListScreen', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists assigned tickets with their number and customer', async () => {
    (techApi.tickets as any).mockResolvedValue([
      ticket(),
      ticket({ ticketId: 'k2', ticketNumber: 'T-1002', customerName: 'Sam Ortiz' }),
    ]);
    renderScreen();
    expect(screen.getByText(/Loading your tickets/)).toBeInTheDocument();
    expect(await screen.findByText(/T-1001/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Dana Lee/)).toBeInTheDocument();
    expect(screen.getByText(/T-1002/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Sam Ortiz/)).toBeInTheDocument();
  });

  it('shows an empty state when there are no tickets', async () => {
    (techApi.tickets as any).mockResolvedValue([]);
    renderScreen();
    expect(await screen.findByText('No tickets assigned to you yet.')).toBeInTheDocument();
  });

  it('shows an error state when tickets fail to load', async () => {
    (techApi.tickets as any).mockRejectedValue(new Error('boom'));
    renderScreen();
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });
});
