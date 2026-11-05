import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/customerMembershipApi', () => ({ customerMembershipApi: { membership: vi.fn() } }));
import { customerMembershipApi } from '../api/customerMembershipApi';
import { MembershipScreen } from './MembershipScreen';

describe('MembershipScreen', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the member plan, status, and a benefit with remaining credits', async () => {
    (customerMembershipApi.membership as any).mockResolvedValue({
      hasMembership: true,
      membership: { membershipId: 'm1', planName: 'VIP Nail Club', status: 'active', memberNumber: 'VIP-0001', nextBillingAt: '2026-07-27T00:00:00Z', startedAt: null },
      benefits: [{ benefitId: 'b1', label: '2 manicures / month', benefitType: 'service_credit', serviceId: 's1', serviceCreditsAvailable: 2, dollarCreditsAvailableCents: 0 }],
    });
    render(<MemoryRouter><MembershipScreen /></MemoryRouter>);
    expect(await screen.findByText('VIP Nail Club')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('2 manicures / month')).toBeInTheDocument();
    expect(screen.getByText('2 left')).toBeInTheDocument();
  });

  it('shows an honest empty state when the customer is not a member and no plans exist', async () => {
    (customerMembershipApi.membership as any).mockResolvedValue({ hasMembership: false, membership: null, benefits: [], availablePlans: [] });
    render(<MemoryRouter><MembershipScreen /></MemoryRouter>);
    expect(await screen.findByText("You're not a member yet")).toBeInTheDocument();
  });

  it('shows available plans directly without empty state when plans exist', async () => {
    (customerMembershipApi.membership as any).mockResolvedValue({
      hasMembership: false,
      membership: null,
      benefits: [],
      availablePlans: [
        {
          planId: 'p1',
          planVersionId: 'pv1',
          name: 'VIP Nail Club',
          priceCents: 5000,
          billingInterval: 'month',
          intervalCount: 1,
          enrollmentFeeCents: 1000,
          description: 'One product per month',
          benefits: [{ benefitId: 'b1', label: 'One gel manicure', creditsPerCycle: 1, valueCents: 0, benefitType: 'product_discount' }],
        },
      ],
    });
    render(<MemoryRouter><MembershipScreen /></MemoryRouter>);
    expect(await screen.findByText('VIP Nail Club')).toBeInTheDocument();
    expect(screen.getByText('Join VIP Nail Club')).toBeInTheDocument();
    expect(screen.queryByText("You're not a member yet")).not.toBeInTheDocument();
  });
});
