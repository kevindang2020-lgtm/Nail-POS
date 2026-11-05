import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const m = vi.hoisted(() => ({ rules: vi.fn(), getSettings: vi.fn(), update: vi.fn() }));
vi.mock('../api/posAIMoneyProtectionApi', () => ({ posAIMoneyProtectionApi: { rules: m.rules, getSettings: m.getSettings, updateSetting: m.update, state: vi.fn(), alerts: vi.fn() } }));
import { POSAIMoneyProtectionSettingsScreen } from './POSAIMoneyProtectionSettingsScreen';
beforeEach(() => { m.rules.mockReset(); m.getSettings.mockReset(); m.update.mockReset(); });

const catalog = { rules: [
  { id: 'MP_DUP_CHARGE_EXACT', name: 'Exact duplicate charge', category: 'duplicate_charge', layer: 'deterministic', severity: 'CRITICAL', defaultThresholds: {}, enabled: true },
  { id: 'MP_FAILED_PAYMENT_RETRY_LOOP', name: 'Failed-payment retry loop', category: 'failed_payment', layer: 'deterministic', severity: 'MEDIUM', defaultThresholds: { minDeclines: 4, windowMinutes: 15 }, enabled: true },
] };

describe('POSAIMoneyProtectionSettingsScreen', () => {
  it('renders rules with editable enable/severity/thresholds and saves an override', async () => {
    m.rules.mockResolvedValue(catalog);
    m.getSettings.mockResolvedValue({});
    m.update.mockResolvedValue({ ruleId: 'MP_FAILED_PAYMENT_RETRY_LOOP' });
    render(<POSAIMoneyProtectionSettingsScreen />);

    expect(await screen.findByRole('heading', { name: /Settings/i })).toBeInTheDocument();
    expect(screen.getByText('Exact duplicate charge')).toBeInTheDocument();
    // change a threshold and save
    fireEvent.change(screen.getByLabelText(/Min Declines for Failed-payment retry loop/i), { target: { value: '6' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[1]);
    await waitFor(() => expect(m.update).toHaveBeenCalled());
    expect(m.update.mock.calls[0][0]).toBe('MP_FAILED_PAYMENT_RETRY_LOOP');
    expect(m.update.mock.calls[0][1].thresholds.minDeclines).toBe(6);
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('reflects an existing disabled override', async () => {
    m.rules.mockResolvedValue(catalog);
    m.getSettings.mockResolvedValue({ MP_DUP_CHARGE_EXACT: { ruleId: 'MP_DUP_CHARGE_EXACT', enabled: false, severityOverride: null, thresholds: {} } });
    render(<POSAIMoneyProtectionSettingsScreen />);
    const cb = await screen.findByLabelText('Enable Exact duplicate charge') as HTMLInputElement;
    expect(cb.checked).toBe(false);
  });
});
