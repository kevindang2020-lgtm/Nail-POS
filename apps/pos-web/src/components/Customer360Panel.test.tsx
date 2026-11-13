// Customer360Panel — Customer Intelligence 30: the 360-degree view renders identity (masked note), lifetime spend, newest-first
// history, preferences, loyalty / membership and the review suggestions with their evidence labelled — no action buttons.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
const { api } = vi.hoisted(() => ({ api: { customer360: vi.fn() } }));
vi.mock('../api/posCustomerIntelligenceApi', () => ({ posCustomerIntelligenceApi: api }));
import { Customer360Panel } from './Customer360Panel';

const V = {
  customerId: 'c1',
  identity: { name: 'Lapsed Lee', phone: '(•••) •••-0202', email: null, contact: 'masked', phoneVerified: false, state: 'unverified', createdAt: '2025-10-01T00:00:00Z', preferredLanguage: null },
  classification: { status: 'inactive', completedVisits: 3, lastVisitAt: '2026-09-24T15:00:00Z', typicalIntervalDays: 30, nextAppointmentDate: null, computedAt: '2026-11-13T10:00:00Z' },
  visits: [{ ticketId: 't1', date: '2026-09-24T15:00:00Z', services: ['Gel Manicure'], technician: 'Lan Nguyễn', totalCents: 4500, branch: 'Main' }],
  visitsTotal: 3, lifetimeSpendCents: 13500,
  preferences: { preferredTechnician: 'Lan Nguyễn', style: 'Short almond', products: [], colors: ['nude'] },
  loyalty: { points: 120, tier: 'Silver', membership: { plan: 'VIP Monthly', status: 'active' } },
  suggestions: [{ code: 'rebook_review', evidence: ['usual_interval_days:30', 'days_since_last:50', 'no_future_booking'] }, { code: 'verify_phone', evidence: ['phone_on_file', 'not_verified'] }],
};
beforeEach(() => { vi.clearAllMocks(); api.customer360.mockResolvedValue(V); });

describe('Customer360Panel', () => {
  it('shows identity, spend, history, preferences, loyalty and evidence-backed suggestions; no action buttons', async () => {
    render(<Customer360Panel customerId="c1" />);
    const p = await screen.findByTestId('cix-360');
    expect(api.customer360).toHaveBeenCalledWith('c1');
    expect(within(p).getByTestId('cix-360-identity')).toHaveTextContent('Phone not verified');
    expect(within(p).getByTestId('cix-360-identity')).toHaveTextContent('masked');
    expect(within(p).getByTestId('cix-360-spend')).toHaveTextContent('$135.00 across 3 visit(s)');
    expect(within(p).getByTestId('cix-360-visit')).toHaveTextContent('Gel Manicure');
    expect(within(p).getByTestId('cix-360-prefs')).toHaveTextContent('Short almond · nude');
    expect(within(p).getByTestId('cix-360-identity')).toHaveTextContent('VIP Monthly · Active');
    const rb = within(p).getByTestId('cix-360-sug-rebook_review');
    expect(rb).toHaveTextContent('Review a rebooking'); expect(rb).toHaveTextContent('Usual interval (days): 30'); expect(rb).toHaveTextContent('No future booking');
    expect(within(p).getByTestId('cix-360-sug-verify_phone')).toHaveTextContent('Phone on file · Not verified');
    expect(within(p).queryAllByRole('button')).toHaveLength(0);
  });
  it('a failed read says so', async () => {
    api.customer360.mockRejectedValue({ status: 404, message: 'Customer not found.' });
    render(<Customer360Panel customerId="c9" />);
    expect(await screen.findByTestId('cix-360-error')).toHaveTextContent('Customer not found.');
  });
});
