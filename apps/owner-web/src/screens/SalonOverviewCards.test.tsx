// SalonOverviewCards.test.tsx — the "All My Salons" picker strip renders each salon's today snapshot (revenue +
// appointments + open/closed) and tapping a card asks to switch to that salon.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { SalonOverviewCards } from './SalonOverviewCards';
import type { OwnerSalonOverview } from '../api/ownerApi';

const salon = (over: Partial<OwnerSalonOverview> = {}): OwnerSalonOverview => ({
  branchId: 'b1', salonName: 'Cherry Hill', city: 'Cherry Hill', state: 'NJ', status: 'active',
  todayRevenueCents: 846200, todayBookings: 48, activeTechs: 10, waitingGuests: 14, ...over,
});

describe('SalonOverviewCards', () => {
  it('renders a today snapshot per salon and fires onPick with the salon id', () => {
    const onPick = vi.fn();
    render(<SalonOverviewCards salons={[salon(), salon({ branchId: 'b2', salonName: 'Pennsauken', todayRevenueCents: 512000, todayBookings: 31, status: 'inactive' })]} onPick={onPick} />);

    // Both salons present with their revenue + appointment counts.
    expect(screen.getByText('Cherry Hill')).toBeInTheDocument();
    expect(screen.getByText('$8,462')).toBeInTheDocument();
    expect(screen.getByText('48')).toBeInTheDocument();
    const cherryCard = screen.getByText('Cherry Hill').closest('.owner-saloncard') as HTMLElement;
    expect(within(cherryCard).getByText('10')).toBeInTheDocument(); // active techs
    expect(within(cherryCard).getByText('14')).toBeInTheDocument(); // waiting guests
    expect(screen.getByText('Pennsauken')).toBeInTheDocument();
    expect(screen.getByText('$5,120')).toBeInTheDocument();
    // Status reflects each salon.
    const pennCard = screen.getByText('Pennsauken').closest('.owner-saloncard') as HTMLElement;
    expect(within(pennCard).getByText('Closed')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Open Pennsauken'));
    expect(onPick).toHaveBeenCalledWith('b2');
  });

  it('renders nothing when there are no salons', () => {
    const { container } = render(<SalonOverviewCards salons={[]} onPick={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
