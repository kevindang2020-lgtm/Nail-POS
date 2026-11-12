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
  it('Reliable Rule Freshness: each active rule says when a pass last checked it, or that it is not checked yet (never a false green)', async () => {
    const recent = new Date(Date.now() - 3600_000).toISOString();
    mc.rules.mockResolvedValue({ rules: [rule({ lastCheckedAt: recent }), rule({ id: 'MP_REFUND_EXCEEDS_CAPTURE', lastCheckedAt: null }), rule({ id: 'MP_OFF', enabled: false, effective: false })], canEdit: false });
    wrap(<POSAIMoneyProtectionRulesScreen />);
    const rows = await screen.findAllByTestId('mpx-rule-row');
    expect(rows[0].querySelector('[data-testid="mpx-rule-checked"]')).toHaveTextContent(/^Checked /);
    expect(rows[0].querySelector('[data-testid="mpx-rule-checked"]')!.className).not.toContain('warn');
    expect(rows[1].querySelector('[data-testid="mpx-rule-checked"]')).toHaveTextContent('Not checked since it was turned on or changed');
    expect(rows[1].querySelector('[data-testid="mpx-rule-checked"]')!.className).toContain('warn');
    expect(rows[2].querySelector('[data-testid="mpx-rule-checked"]')).toBeNull();
  });
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
  it('SUNMI: seven even tiles counted from the rules; the eight named columns (incl. Mode and Human review) are in the table', async () => {
    mc.rules.mockResolvedValue({ rules: [rule(), rule({ id: 'MP_CASH_DRAWER_VARIANCE', layer: 'reconciliation', mode: 'batch', humanReview: false, layerOn: false, effective: false, thresholds: {} }),
      rule({ id: 'MP_REVERSAL_RATE_OUTLIER', layer: 'baseline', enabled: false, effective: false })], canEdit: false });
    wrap(<POSAIMoneyProtectionRulesScreen />);
    await screen.findAllByTestId('mpx-rule-row');
    expect(screen.getByTestId('mpx-rule-kpis').children).toHaveLength(7);
    expect(screen.getByTestId('mpx-rk-total')).toHaveTextContent('3'); expect(screen.getByTestId('mpx-rk-enabled')).toHaveTextContent('2');
    expect(screen.getByTestId('mpx-rk-disabled')).toHaveTextContent('1'); expect(screen.getByTestId('mpx-rk-baseline')).toHaveTextContent('1');
    expect(screen.getByTestId('mpx-rk-errors')).toHaveTextContent(/Not running.*1/);   // on, but its layer is off (a disabled rule is not an error)
    const head = Array.from(document.querySelectorAll('section[data-testid="mpx-rules"] th')).map((th) => th.textContent);
    expect(head.slice(0, 8)).toEqual(['Rule', 'Category', 'How it checks', 'Severity', 'Mode', 'Thresholds', 'Human review', 'State']);
    const rows = screen.getAllByTestId('mpx-rule-row');
    expect(rows[1]).toHaveTextContent('Scheduled batch'); expect(rows[1]).toHaveTextContent('Not required'); expect(rows[0]).toHaveTextContent('Required');
  });
  it('Money Protection Rules 07: batch readiness lists the three ledgers, warns on an unreadable ledger / no schedule, says (never warns) no recent records', async () => {
    mc.rules.mockResolvedValue({ rules: [rule()], canEdit: false, batchReadiness: { scheduled: false, lastReconciliationAt: null, warnings: 2, sources: [
      { source: 'membership', rules: ['MP_MEMBERSHIP_DUP_CHARGE'], rulesOn: 1, layerOn: true, state: 'no_recent_records', warning: false, records30d: 0, lastRecordAt: null },
      { source: 'gift_cards', rules: ['A', 'B'], rulesOn: 2, layerOn: true, state: 'ready', warning: false, records30d: 14, lastRecordAt: '2026-11-10T15:00:00Z' },
      { source: 'cash_close', rules: ['MP_CASH_DRAWER_VARIANCE'], rulesOn: 1, layerOn: true, state: 'ledger_unavailable', warning: true, records30d: null, lastRecordAt: null }] } });
    wrap(<POSAIMoneyProtectionRulesScreen />);
    const rows = await screen.findAllByTestId('mpx-batch-row');
    expect(rows.map((r) => r.getAttribute('data-state'))).toEqual(['no_recent_records', 'ready', 'ledger_unavailable']);
    expect(rows[0]).toHaveTextContent('Membership charges'); expect(rows[0]).toHaveTextContent('No records in 30 days');
    expect(rows[1]).toHaveTextContent('14'); expect(rows[1]).toHaveTextContent('2 of 2');
    expect(rows[2]).toHaveTextContent('Cannot be read'); expect(rows[2]).toHaveTextContent('—');
    expect(rows[2].querySelector('.chip')!.className).toContain('bad'); expect(rows[0].querySelector('.chip')!.className).not.toContain('bad');
    expect(screen.getByTestId('mpx-batch-warn')).toHaveTextContent('2 problem(s) found');
    expect(screen.getByTestId('mpx-batch-schedule')).toHaveTextContent('Detection is not scheduled');
    expect(screen.getByTestId('mpx-batch-schedule')).toHaveTextContent('no successful pass yet');
    expect(mc.saveRule).not.toHaveBeenCalled();
  });
  it('Money Protection Rules 07: an older server without batchReadiness shows no section', async () => {
    mc.rules.mockResolvedValue({ rules: [rule()], canEdit: false });
    wrap(<POSAIMoneyProtectionRulesScreen />);
    await screen.findAllByTestId('mpx-rule-row');
    expect(screen.queryByTestId('mpx-batch')).toBeNull();
  });
  it('MONEY PROTECTION ALERTS 11: false-positive insights show reviewed / dismissed / reopened and repeated reasons; nothing is saved', async () => {
    mc.rules.mockResolvedValue({ rules: [rule()], canEdit: true, falsePositivePolicy: 'insight_only_rules_never_auto_disabled',
      falsePositiveInsights: [{ ruleId: 'MP_DUP_CHARGE_LIKELY', name: 'Likely duplicate charge', reviewed90d: 4, dismissed90d: 3, reopened90d: 1, dismissRatePct: 75, repeatedReasons: [{ reason: 'split tender', count: 2 }] }] });
    const v = wrap(<POSAIMoneyProtectionRulesScreen />);
    const row = await screen.findByTestId('mpx-fp-row');
    expect(row).toHaveTextContent('4'); expect(row).toHaveTextContent('75% of reviewed'); expect(row).toHaveTextContent('“split tender” × 2');
    expect(screen.getByTestId('mpx-fp-policy')).toHaveTextContent('never switched off or relaxed automatically');
    expect(mc.saveRule).not.toHaveBeenCalled();
    v.unmount();
    mc.rules.mockResolvedValue({ rules: [rule()], canEdit: true, falsePositiveInsights: [] });
    const v2 = wrap(<POSAIMoneyProtectionRulesScreen />);
    expect(await screen.findByTestId('mpx-fp-none')).toBeInTheDocument();
    v2.unmount();
    mc.rules.mockResolvedValue({ rules: [rule()], canEdit: true });   // older server: no panel
    wrap(<POSAIMoneyProtectionRulesScreen />);
    await screen.findAllByTestId('mpx-rule-row');
    expect(screen.queryByTestId('mpx-fp')).toBeNull();
  });
});


describe('Money Protection Rules — consistent empty states (extras #08)', () => {
  it('permission denied and an API outage read differently', async () => {
    mc.rules.mockRejectedValueOnce({ status: 403 });
    const a = wrap(<POSAIMoneyProtectionRulesScreen />);
    expect(await screen.findByTestId('mpx-rules-state')).toHaveAttribute('data-kind', 'forbidden');
    expect(screen.getByTestId('mpx-rules-state')).toHaveTextContent('Your role cannot do this');
    a.unmount();
    mc.rules.mockRejectedValueOnce(new Error('Failed to fetch'));
    wrap(<POSAIMoneyProtectionRulesScreen />);
    expect(await screen.findByTestId('mpx-rules-state')).toHaveAttribute('data-kind', 'outage');
    expect(screen.queryByTestId('mpx-rule-row')).toBeNull();
  });
  it('no rules at all, and rules on with no recorded evaluation, are their own states', async () => {
    mc.rules.mockResolvedValueOnce({ rules: [], canEdit: false });
    const a = wrap(<POSAIMoneyProtectionRulesScreen />);
    expect(await screen.findByTestId('mpx-rules-state')).toHaveAttribute('data-kind', 'none');
    a.unmount();
    mc.rules.mockResolvedValueOnce({ rules: [rule({ lastCheckedAt: null })], canEdit: false });
    wrap(<POSAIMoneyProtectionRulesScreen />);
    expect(await screen.findByTestId('mpx-rules-state')).toHaveAttribute('data-kind', 'unevaluated');
    expect(screen.getAllByTestId('mpx-rule-row')).toHaveLength(1);
  });
  it('a failed refresh keeps the rules shown, marked stale', async () => {
    mc.rules.mockResolvedValueOnce({ rules: [rule({ lastCheckedAt: new Date().toISOString() })], canEdit: false });
    mc.runDetection.mockResolvedValue({ created: 0, updated: 0 });
    wrap(<POSAIMoneyProtectionRulesScreen />);
    await screen.findAllByTestId('mpx-rule-row');
    expect(screen.queryByTestId('mpx-rules-state')).toBeNull();
    mc.rules.mockRejectedValueOnce(new Error('Failed to fetch'));
    fireEvent.click(screen.getByTestId('mpx-run'));
    expect(await screen.findByTestId('mpx-rules-state')).toHaveAttribute('data-kind', 'stale');
    expect(screen.getAllByTestId('mpx-rule-row')).toHaveLength(1);
  });
});
