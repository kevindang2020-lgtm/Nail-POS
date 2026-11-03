// POSAIFraudProtectionAssistantScreen — AI Fraud & Money Protection add-on (Nov 3 2026): honest header; cards from the Money Protection
// center; when detection never ran the empty list says so (never "nothing needs review"); the check uses the localized checks.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { mc, pkg } = vi.hoisted(() => ({ mc: { summary: vi.fn(), alerts: vi.fn(), check: vi.fn() }, pkg: { detail: vi.fn(), startTrial: vi.fn(), cancel: vi.fn() } }));
vi.mock('../api/posAIMoneyProtectionApi', () => ({ posAIMoneyProtectionApi: { center: mc } }));
vi.mock('../api/posAiUsageApi', () => ({ posAiUsageScreenApi: pkg }));
import { POSAIFraudProtectionAssistantScreen } from './POSAIFraudProtectionAssistantScreen';
const CARD = { package: { code: 'ai_fraud_money_protection', name: 'AI Fraud & Money Protection', description: 'Flags possible money problems.', category: 'Finance', posArea: 'Checkout / Payments', state: 'active', storedStatus: 'active',
  disabledReason: null, price: { cents: 4900, period: 'monthly', source: 'subscription' }, usage: { used: 0, limit: 0, unit: 'checks', percent: null, level: 'ok', periodStart: null, periodEnd: null, remaining: null },
  trial: { days: 14, endsAt: null, daysLeft: null, eligible: false }, actions: ['cancel'] } };
const page = (items: any[]) => ({ items, total: items.length, page: 1, pageSize: 25, totalPages: 1, period: { today: '2026-11-03' } });
beforeEach(() => { vi.clearAllMocks(); pkg.detail.mockResolvedValue(CARD); });

describe('AI Fraud & Money Protection add-on page', () => {
  it('FP-01 never checked: the empty list says detection never ran; the monitoring card warns', async () => {
    mc.summary.mockResolvedValue({ cards: { newAlerts: 0, critical: 0, valueUnderReviewCents: 0, openInvestigations: 0, dismissed30d: 0 }, monitoring: 'never_checked', lastSuccessAt: null, lastRun: null });
    mc.alerts.mockResolvedValue(page([]));
    render(<MemoryRouter><POSAIFraudProtectionAssistantScreen /></MemoryRouter>);
    expect(await screen.findByText(/Detection has never run for this salon/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('as-kpi-monitoring')).toHaveTextContent('Warning'));
    expect(screen.getByTestId('as-open')).toHaveAttribute('href', '/tenant/ai/money-protection');
  });
  it('FP-02 an alert row, filters reach the center; the check renders localized text', async () => {
    mc.summary.mockResolvedValue({ cards: { newAlerts: 1, critical: 1, valueUnderReviewCents: 5000, openInvestigations: 0, dismissed30d: 0 }, monitoring: 'current', lastSuccessAt: '2026-11-03T05:00:00Z' });
    mc.alerts.mockResolvedValue(page([{ id: 'a1', ruleId: 'MP_DUP_CHARGE_EXACT', rule: 'Exact duplicate charge', category: 'duplicate_charge', severity: 'CRITICAL', status: 'NEW', amountCents: 5000, firstSeenAt: '2026-11-03T05:00:00Z' }]));
    mc.check.mockResolvedValue({ overall: 'WARNING', checkedAt: '2026-11-03T05:00:00Z', checks: [{ key: 'detection_scheduled', component: 'detection', state: 'WARNING' }] });
    render(<MemoryRouter><POSAIFraudProtectionAssistantScreen /></MemoryRouter>);
    expect(await screen.findByTestId('as-row')).toHaveTextContent('Exact duplicate charge');
    fireEvent.change(screen.getByTestId('as-f-severity'), { target: { value: 'CRITICAL' } });
    await waitFor(() => expect(mc.alerts).toHaveBeenLastCalledWith(expect.objectContaining({ severity: 'CRITICAL', status: 'open', page: 1 })));
    fireEvent.click(screen.getByTestId('as-check'));
    const k = await screen.findByTestId('as-chk-detection_scheduled');
    expect(k).toHaveTextContent('Detection scheduled'); expect(k).toHaveTextContent('Part: Detection');
  });
});
