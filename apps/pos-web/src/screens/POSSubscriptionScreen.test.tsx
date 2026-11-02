import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSSubscriptionScreen } from './POSSubscriptionScreen';

vi.mock('../api/posSettingsApi', () => ({ posSettingsApi: { getState: vi.fn().mockResolvedValue({ subscriptionPlan: { plan: 'Gold', tier: 'Premium', billingStatus: 'active', aiPackageIncluded: true, aiPackage: 'Growth', aiFeatures: {}, customerCount: 120, technicianCount: 8, smsThisMonth: 340 } }) } }));
vi.mock('../api/posAiApi', () => ({ posAiApi: { packages: vi.fn().mockResolvedValue({ packages: [
  { code: 'ai_booking_assistant', name: 'AI Booking Assistant', description: 'Books appointments', usageUnit: 'messages', category: 'front_desk', posArea: 'Booking / appointment creation', monthlyPriceCents: 4900, includedUsageLimit: 1000, subscription: { status: 'active', usageLimit: 1000 }, used: 340, remainingUsage: 660, accessible: true, lockReason: null, lockLabel: null, trialAvailable: false },
  { code: 'ai_marketing_assistant', name: 'AI Marketing Assistant', description: 'Creates campaigns and promotions', usageUnit: 'generations', category: 'growth', posArea: 'Marketing', monthlyPriceCents: 5900, includedUsageLimit: 500, subscription: null, used: 0, remainingUsage: 0, accessible: false, lockReason: 'no_subscription', lockLabel: 'Locked', trialAvailable: true },
] }) } }));

describe('POSSubscriptionScreen', () => {
  it('renders the real plan, usage, and AI add-ons with live pricing/status', async () => {
    render(<MemoryRouter><POSSubscriptionScreen /></MemoryRouter>);
    expect(screen.getByText('Subscription')).toBeInTheDocument();
    // current plan from subscriptionPlan
    expect(await screen.findByText('Premium Plan')).toBeInTheDocument();
    // active add-on with price + usage
    expect(screen.getByText('AI Booking Assistant')).toBeInTheDocument();
    expect(screen.getByText(/340 \/ 1,000 used/)).toBeInTheDocument();
    // available add-on with its real monthly price
    expect(screen.getByText('AI Marketing Assistant')).toBeInTheDocument();
    expect(screen.getByText('$59/mo')).toBeInTheDocument();
    // usage counts from subscriptionPlan
    expect(screen.getByText('120')).toBeInTheDocument();
  });
});
