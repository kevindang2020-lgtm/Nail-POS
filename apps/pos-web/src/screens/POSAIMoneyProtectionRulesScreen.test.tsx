import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
const { rulesMock } = vi.hoisted(() => ({ rulesMock: vi.fn() }));
vi.mock('../api/posAIMoneyProtectionApi', () => ({ posAIMoneyProtectionApi: { rules: rulesMock, state: vi.fn(), alerts: vi.fn() } }));
import { POSAIMoneyProtectionRulesScreen } from './POSAIMoneyProtectionRulesScreen';
beforeEach(() => rulesMock.mockReset());

describe('POSAIMoneyProtectionRulesScreen', () => {
  it('renders the detection catalog with severity, thresholds, human-review, and enabled status', async () => {
    rulesMock.mockResolvedValue({
      flags: { enabled: true, deterministicRules: true, baselines: false, reconciliation: true, aiSummaries: true, autoExactDuplicatePrevention: false },
      rules: [
        { id: 'MP_DUP_CHARGE_EXACT', alertType: 'duplicate_charge_exact', name: 'Exact duplicate charge', category: 'duplicate_charge', layer: 'deterministic', severity: 'CRITICAL', evaluationMode: 'realtime', humanReview: true, description: 'Two captured payments share a processor transaction id.', defaultThresholds: {}, enabled: true },
        { id: 'MP_REVERSAL_RATE_OUTLIER', alertType: 'reversal_rate_outlier', name: 'Reversal-rate outlier', category: 'employee', layer: 'baseline', severity: 'LOW', evaluationMode: 'near_realtime', humanReview: true, description: 'Peer-relative outlier, advisory.', defaultThresholds: { minSampleSize: 20 }, enabled: false },
      ],
    });
    render(<POSAIMoneyProtectionRulesScreen />);
    expect(await screen.findByRole('heading', { name: /Rules & Detection/i })).toBeInTheDocument();
    expect(screen.getByText('Exact duplicate charge')).toBeInTheDocument();
    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(screen.getByText(/Min sample size: 20/i)).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument(); // baseline disabled
    expect(screen.getByText(/off \(default\)/i)).toBeInTheDocument(); // auto-prevention off
  });
});
