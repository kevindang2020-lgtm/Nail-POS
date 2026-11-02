import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MembershipRedeemPanel } from './MembershipRedeemPanel';

// Mock fetch by URL: the panel reads customer memberships, then that membership's benefits.
const mockByUrl = (member: boolean) => vi.fn(async (url: any) => {
  const u = String(url);
  let data: any = {};
  if (u.includes('/memberships/customers/')) data = { memberships: member ? [{ membershipId: 'm1', planName: 'VIP Nail Club', status: 'active' }] : [] };
  else if (u.includes('/members/') && u.includes('/benefits')) data = { benefits: [{ benefitId: 'b1', label: 'Gel manicure', benefitType: 'service_credit', serviceId: 's1', serviceCreditsAvailable: 1, dollarCreditsAvailableCents: 0 }] };
  return { ok: true, status: 200, json: async () => data, headers: { get: () => null } } as any;
});

const services = [{ serviceLineId: 'sl1', serviceName: 'Gel Manicure', priceCents: 6000 }];
beforeEach(() => { vi.restoreAllMocks(); });

describe('MembershipRedeemPanel', () => {
  it('shows the member plan and an apply control for an included-service credit', async () => {
    globalThis.fetch = mockByUrl(true) as any;
    render(<MembershipRedeemPanel customerId="c1" ticketId="tk1" technicianId="t1" services={services} onRedeemed={() => {}} />);
    await waitFor(() => expect(screen.getByText('Membership')).toBeInTheDocument());
    expect(screen.getByText('Gel manicure')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
  });

  it('renders nothing for a non-member', async () => {
    globalThis.fetch = mockByUrl(false) as any;
    const { container } = render(<MembershipRedeemPanel customerId="c1" ticketId="tk1" technicianId="t1" services={services} onRedeemed={() => {}} />);
    await waitFor(() => expect((globalThis.fetch as any)).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector('button')).toBeNull();
  });
});
