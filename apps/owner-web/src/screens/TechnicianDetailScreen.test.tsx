// TechnicianDetailScreen (owner, Module 4 drill-in): per-technician metrics from /owner/staff/:id/performance. Verifies the
// hero sales + services/rating line, the money/stat grid, the dash for an unrated tech, and the distinct 404 / 403 / generic
// error messages.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const nav = vi.hoisted(() => ({ back: vi.fn() }));
vi.mock('../shell/nav', () => ({ useOwnerNav: () => nav }));
vi.mock('../api/ownerApi', () => ({ ownerStaffApi: { technician: vi.fn() } }));

import { ownerStaffApi } from '../api/ownerApi';
import { TechnicianDetailScreen } from './TechnicianDetailScreen';

const detail = (over: any = {}) => ({
  technicianId: 't1', fullName: 'Jane Nguyen', roleLabel: 'Senior Tech', status: 'active',
  servicesCompleted: 24, salesCents: 185000, tipsCents: 32000, commissionCents: 74000,
  averageTicketCents: 7700, rating: 4.8, reviewCount: 32, bookingCount: 30,
  busyMinutes: 1820, scheduledMinutes: 2400, utilizationPercent: 76, payrollEstimateCents: 106000, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  (ownerStaffApi.technician as any).mockResolvedValue(detail());
});

describe('TechnicianDetailScreen', () => {
  it('renders the hero sales and the money/stat grid', async () => {
    render(<TechnicianDetailScreen technicianId="t1" />);
    expect(await screen.findByText('Jane Nguyen')).toBeInTheDocument();    // header
    expect(screen.getByText('$1,850.00')).toBeInTheDocument();            // sales hero
    expect(screen.getByText(/24 services/)).toBeInTheDocument();
    expect(screen.getByText('$320.00')).toBeInTheDocument();              // tips
    expect(screen.getByText('$740.00')).toBeInTheDocument();              // commission
    expect(screen.getByText('$77.00')).toBeInTheDocument();               // average ticket
    expect(screen.getByText('76%')).toBeInTheDocument();                  // utilization
    expect(screen.getByText('$1,060.00')).toBeInTheDocument();            // payroll estimate
    expect(screen.getByText(/1820 busy min/)).toBeInTheDocument();
  });

  it('renders a dash for an unrated technician', async () => {
    (ownerStaffApi.technician as any).mockResolvedValue(detail({ rating: 0 }));
    const { container } = render(<TechnicianDetailScreen technicianId="t1" />);
    await screen.findByText('Jane Nguyen');
    expect(container.querySelector('.trend')?.textContent).toContain('★ —');   // rating 0 -> dash
  });

  it('shows a not-found message on 404', async () => {
    (ownerStaffApi.technician as any).mockRejectedValue({ status: 404 });
    render(<TechnicianDetailScreen technicianId="t1" />);
    expect(await screen.findByText('Technician not found.')).toBeInTheDocument();
  });

  it('shows an access message on 403', async () => {
    (ownerStaffApi.technician as any).mockRejectedValue({ status: 403 });
    render(<TechnicianDetailScreen technicianId="t1" />);
    expect(await screen.findByText('You do not have access to this.')).toBeInTheDocument();
  });

  it('shows the server message on a generic error', async () => {
    (ownerStaffApi.technician as any).mockRejectedValue({ message: 'Something went wrong.' });
    render(<TechnicianDetailScreen technicianId="t1" />);
    expect(await screen.findByText('Something went wrong.')).toBeInTheDocument();
  });
});
