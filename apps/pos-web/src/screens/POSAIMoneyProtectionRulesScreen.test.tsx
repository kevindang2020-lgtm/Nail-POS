// POSAIMoneyProtectionRulesScreen — the 15 rules (guides of Nov 3 2026): what each checks, its thresholds, whether it is on for this salon
// (and whether its layer is on on the server), 30-day alerts, last alert, and a link to its alerts.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { mc, api } = vi.hoisted(() => {
  const mc = { summary: vi.fn(), alerts: vi.fn(), alert: vi.fn(), alertAction: vi.fn(), investigations: vi.fn(), timeline: vi.fn(), rules: vi.fn(), saveRule: vi.fn(), history: vi.fn(), runs: vi.fn(), runDetection: vi.fn(), check: vi.fn() };
  return { mc, api: { center: mc, explainAlert: vi.fn(), createInvestigation: vi.fn(), addNote: vi.fn(), assignInvestigation: vi.fn(), setInvestigationStatus: vi.fn(), resolveInvestigation: vi.fn() } };
});
vi.mock('../api/posAIMoneyProtectionApi', () => ({ posAIMoneyProtectionApi: api }));
const wrap = (el: any) => render(<MemoryRouter>{el}</MemoryRouter>);

import { POSAIMoneyProtectionRulesScreen } from './POSAIMoneyProtectionRulesScreen';
const rule = (o: any = {}) => ({ id: 'MP_DUP_CHARGE_LIKELY', name: 'Likely duplicate charge', category: 'duplicate_charge', layer: 'deterministic', mode: 'realtime', description: 'Same ticket, amount and method captured more than once.', humanReview: true,
  defaultSeverity: 'HIGH', severity: 'HIGH', severityOverridden: false, defaultThresholds: { windowSeconds: 120 }, thresholds: { windowSeconds: 120 }, enabled: true, layerOn: true, effective: true,
  updatedAt: null, alerts30d: 3, open: 1, dismissed90d: 2, lastAlertAt: '2026-11-02T15:00:00Z', ...o });
beforeEach(() => { vi.clearAllMocks(); });

describe('POSAIMoneyProtectionRulesScreen', () => {
  it('renders each rule with how it checks, thresholds, state, counts and a link to its alerts', async () => {
    mc.rules.mockResolvedValue({ rules: [rule(), rule({ id: 'MP_CASH_DRAWER_VARIANCE', layer: 'reconciliation', layerOn: false, thresholds: {} })], canEdit: false });
    wrap(<POSAIMoneyProtectionRulesScreen />);
    const rows = await screen.findAllByTestId('mpx-rule-row');
    expect(rows[0]).toHaveTextContent('Likely duplicate charge'); expect(rows[0]).toHaveTextContent('windowSeconds 120'); expect(rows[0]).toHaveTextContent('On');
    expect(rows[0]).toHaveTextContent('2 dismissed in 90 days');
    expect(rows[1]).toHaveTextContent('Off on this server');
    expect(screen.getAllByText('See its alerts')[0].closest('a')).toHaveAttribute('href', '/tenant/ai/money-protection/alerts?rule=MP_DUP_CHARGE_LIKELY');
    fireEvent.click(screen.getAllByTestId('mpx-rule-view')[0]);
    expect(await screen.findByTestId('mpx-rule')).toHaveTextContent('Same ticket, amount and method');
  });
});
