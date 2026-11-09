import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
    render(<MemoryRouter><POSFeaturesScreen /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Features' })).toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByText('AI Reports')).toBeInTheDocument();
    expect(screen.getByText('API Access')).toBeInTheDocument();          // label humanized
    expect(screen.getByText('Enabled for your account')).toBeInTheDocument(); // override source
    const states = screen.getAllByTestId('ftx-row').map((r) => r.querySelector('[data-state]')!.getAttribute('data-state'));
    expect(states.filter((x) => x === 'enabled')).toHaveLength(2);       // ai_reports + api_access
    expect(states).toContain('not_in_plan');
    expect(screen.getByTestId('ftx-kpi-enabled').textContent).toContain('2');
    expect(screen.getByTestId('ftx-kpi-attention').textContent).toContain('0');
    // search + status filter + details overlay
    fireEvent.change(screen.getByTestId('ftx-search'), { target: { value: 'sms' } });
    fireEvent.submit(screen.getByTestId('ftx-search').closest('form')!);
    expect(screen.getAllByTestId('ftx-row')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('ftx-view'));
    expect(await screen.findByTestId('ftx-detail')).toBeInTheDocument();
  });
  it('shows an empty state when no features are configured', async () => {
    stateMock.mockResolvedValue({ plan: { name: 'Free' }, features: [] });
    render(<MemoryRouter><POSFeaturesScreen /></MemoryRouter>);
    expect(await screen.findByText(/No plan features are configured/)).toBeInTheDocument();
    expect(screen.getByTestId('ftx-why').textContent).toMatch(/no features configured/i);
  });
  it('explains WHY the list is empty when the plan text is not linked to the catalogue (pilot screenshot)', async () => {
    stateMock.mockResolvedValue({ plan: { text: 'Standard', mapped: false, code: null, name: null }, features: [] });
    render(<MemoryRouter><POSFeaturesScreen /></MemoryRouter>);
    expect((await screen.findByTestId('ftx-why')).textContent).toContain('"Standard" is not linked');
    expect(screen.getByTestId('ftx-kpi-plan').textContent).toContain('Standard');
  });
});
