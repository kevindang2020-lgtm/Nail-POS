import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
vi.mock('../api/techApi', () => ({ techApi: { ticketMembership: vi.fn() } }));
import { techApi } from '../api/techApi';
import { TechTicketMembership } from './TechTicketMembership';

describe('TechTicketMembership', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the ticket customer plan, status, and a benefit with remaining credits', async () => {
    (techApi.ticketMembership as any).mockResolvedValue({
      hasMembership: true,
      membership: { membershipId: 'm1', planName: 'VIP Nail Club', status: 'active', memberNumber: 'VIP-0001', nextBillingAt: null, startedAt: null },
      benefits: [{ benefitId: 'b1', label: '2 manicures / month', benefitType: 'service_credit', serviceId: 's1', serviceCreditsAvailable: 2, dollarCreditsAvailableCents: 0 }],
    });
    render(<TechTicketMembership ticketId="tk1" />);
    expect(await screen.findByText('VIP Nail Club')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('2 manicures / month')).toBeInTheDocument();
    expect(screen.getByText('2 left')).toBeInTheDocument();
  });

  it('renders nothing when the ticket customer is not a member', async () => {
    (techApi.ticketMembership as any).mockResolvedValue({ hasMembership: false, membership: null, benefits: [] });
    const { container } = render(<TechTicketMembership ticketId="tk2" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe('');
  });
});
