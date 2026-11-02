import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
const { stateMock } = vi.hoisted(() => ({ stateMock: vi.fn() }));
vi.mock('../api/posAIMoneyProtectionApi', () => ({ posAIMoneyProtectionApi: { state: stateMock, alerts: vi.fn(), explainAlert: vi.fn() } }));
import { POSAIMoneyProtectionScreen } from './POSAIMoneyProtectionScreen';
beforeEach(() => stateMock.mockReset());

describe('POSAIMoneyProtectionScreen (Command Center)', () => {
  it('renders KPIs, the under-review framing, and by-type breakdown', async () => {
    stateMock.mockResolvedValue({
      newAlerts: 4, highSeverityAlerts: 2, criticalAlerts: 1, openInvestigations: 1, alertsAwaitingReview: 5,
      byType: [{ type: 'duplicate_charge_exact', count: 3 }, { type: 'refund_exceeds_capture', count: 1 }],
      valueUnderReviewCents: 12500, resolvedFalsePositives: 2, dataFreshness: 'realtime', generatedAt: '2026-07-07T00:00:00Z',
    });
    render(<POSAIMoneyProtectionScreen />);
    expect(await screen.findByRole('heading', { name: 'AI Money Protection' })).toBeInTheDocument();
    expect(screen.getByText('Value Under Review')).toBeInTheDocument();
    expect(screen.getByText('$125.00')).toBeInTheDocument();
    expect(screen.getByText(/under review — not confirmed loss/i)).toBeInTheDocument();
    expect(screen.getByText('Duplicate charge (exact)')).toBeInTheDocument();
  });

  it('shows an empty state when there are no open alerts', async () => {
    stateMock.mockResolvedValue({ newAlerts: 0, highSeverityAlerts: 0, criticalAlerts: 0, openInvestigations: 0, alertsAwaitingReview: 0, byType: [], valueUnderReviewCents: 0, resolvedFalsePositives: 0, dataFreshness: 'realtime', generatedAt: '2026-07-07T00:00:00Z' });
    render(<POSAIMoneyProtectionScreen />);
    expect(await screen.findByText(/Nothing needs review right now/i)).toBeInTheDocument();
  });
});
