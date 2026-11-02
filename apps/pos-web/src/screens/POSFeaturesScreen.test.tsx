import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
const { stateMock } = vi.hoisted(() => ({ stateMock: vi.fn() }));
vi.mock('../api/posUsageLimitsApi', () => ({ posUsageLimitsApi: { state: stateMock } }));
import { POSFeaturesScreen } from './POSFeaturesScreen';
beforeEach(() => stateMock.mockReset());

const state = {
  plan: { name: 'Pro', text: 'pro' },
  features: [
    { featureKey: 'ai_reports', planState: 'enabled', override: null, enabled: true, source: 'plan', blocked: false },
    { featureKey: 'sms_marketing', planState: 'disabled', override: null, enabled: false, source: 'plan', blocked: false },
    { featureKey: 'api_access', planState: 'disabled', override: 'enabled', enabled: true, source: 'override', blocked: false },
  ],
};

describe('POSFeaturesScreen', () => {
  it('lists features with On/Off and source, plus the plan + enabled count', async () => {
    stateMock.mockResolvedValue(state);
    render(<POSFeaturesScreen />);
    expect(await screen.findByRole('heading', { name: 'Features' })).toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByText('AI Reports')).toBeInTheDocument();
    expect(screen.getByText('API Access')).toBeInTheDocument();          // label humanized
    expect(screen.getByText('Enabled for your account')).toBeInTheDocument(); // override source
    expect(screen.getAllByText('On').length).toBe(2);                    // ai_reports + api_access
    expect(screen.getByText('Off')).toBeInTheDocument();
  });
  it('shows an empty state when no features are configured', async () => {
    stateMock.mockResolvedValue({ plan: { name: 'Free' }, features: [] });
    render(<POSFeaturesScreen />);
    expect(await screen.findByText(/No plan features are configured/)).toBeInTheDocument();
  });
});
