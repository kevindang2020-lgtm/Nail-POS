import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MembershipCoveragePanel } from './MembershipCoveragePanel';

const mockFetch = (data: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => data, headers: { get: () => null } } as any));
beforeEach(() => { vi.restoreAllMocks(); });

const covered = {
  membership: { membershipId: 'm1', planName: 'VIP Nail Club', status: 'active' },
  coveredLines: [{ serviceLineId: 'sl1', serviceName: 'Gel Manicure', coveredCents: 6000 }],
  coveredTotalCents: 6000, upgradeChargeCents: 0,
  memberDiscounts: [{ benefitId: 'b2', label: '15% off retail', kind: 'percent' }], dollarCreditAvailableCents: 0,
};

describe('MembershipCoveragePanel', () => {
  // Decision 15 (Oct 2): the checkout service takes the coverage off itself. The old button applied the SAME amount again
  // as a manual discount — a covered service came off twice. The panel now only shows it.
  it('shows covered services as already taken off — no button that would apply them a second time', async () => {
    globalThis.fetch = mockFetch(covered) as any;
    render(<MembershipCoveragePanel ticketId="tk1" />);
    await waitFor(() => expect(screen.getByText('Membership coverage')).toBeInTheDocument());
    expect(screen.getByText('Gel Manicure')).toBeInTheDocument();
    expect(screen.getByText('Already taken off the bill.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /covered-services discount/ })).toBeNull();
    expect(screen.getByText('15% off retail — applied automatically')).toBeInTheDocument();
  });

  it('renders nothing when there is no membership or coverage', async () => {
    globalThis.fetch = mockFetch({ membership: null, coveredLines: [], coveredTotalCents: 0, upgradeChargeCents: 0, memberDiscounts: [], dollarCreditAvailableCents: 0 }) as any;
    const { container } = render(<MembershipCoveragePanel ticketId="tk2" />);
    await waitFor(() => expect((globalThis.fetch as any)).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe('');
  });
});
