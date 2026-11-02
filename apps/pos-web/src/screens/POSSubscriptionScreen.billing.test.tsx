// wave 4 UI sweep: the Subscription screen printed "Payment Method null · Exp null" and the renewal as a raw ISO
// timestamp — the API sends null for card details (the processor holds them) and an ISO instant for the renewal.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSSubscriptionScreen } from './POSSubscriptionScreen';

vi.mock('../api/posSettingsApi', () => ({ posSettingsApi: { getState: vi.fn().mockResolvedValue({ subscriptionPlan: { plan: 'Standard', tier: 'Standard', billingStatus: 'active', customerCount: 5, technicianCount: 4, smsThisMonth: 0 } }) } }));
vi.mock('../api/posAiApi', () => ({ posAiApi: { packages: vi.fn().mockResolvedValue({ packages: [] }) } }));
vi.mock('../api/posAccountApi', () => ({ posAccountApi: { overview: vi.fn().mockResolvedValue({ billing: { plan: 'Standard', renewal: '2026-11-12T18:19:01.409Z', renewalShort: 'Next: 2026-11-12', method: null, expires: null, fee: '$99.00', locations: '1', users: '5', features: [] } }) } }));

describe('POSSubscriptionScreen billing details', () => {
  it('never prints "null" for card details held by the processor, and shows the renewal as a date', async () => {
    render(<MemoryRouter><POSSubscriptionScreen /></MemoryRouter>);
    expect(await screen.findByText('Held by the card processor')).toBeInTheDocument();
    expect(screen.getByText('Nov 12, 2026')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bnull\b|T18:19/);
  });
});
