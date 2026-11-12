// POSAIMoneyProtectionSettingsScreen — rule settings (guides of Nov 3 2026): edit through the center with the version it saw; turning a
// rule off needs a reason (the server refuses without one and the screen shows why); every change is in the history, before → after.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { mc, api } = vi.hoisted(() => {
  const mc = { summary: vi.fn(), alerts: vi.fn(), alert: vi.fn(), alertAction: vi.fn(), investigations: vi.fn(), timeline: vi.fn(), rules: vi.fn(), saveRule: vi.fn(), previewRule: vi.fn(), history: vi.fn(), runs: vi.fn(), runDetection: vi.fn(), check: vi.fn() };
  return { mc, api: { center: mc, explainAlert: vi.fn(), createInvestigation: vi.fn(), addNote: vi.fn(), assignInvestigation: vi.fn(), setInvestigationStatus: vi.fn(), resolveInvestigation: vi.fn() } };
});
vi.mock('../api/posAIMoneyProtectionApi', () => ({ posAIMoneyProtectionApi: api }));
const page = (items: any[], o: any = {}) => ({ items, total: items.length, page: 1, pageSize: 25, totalPages: 1, period: { today: '2026-11-03' }, ...o });
const wrap = (el: any) => render(<MemoryRouter>{el}</MemoryRouter>);

import { POSAIMoneyProtectionSettingsScreen } from './POSAIMoneyProtectionSettingsScreen';
const rule = { id: 'MP_DUP_CHARGE_LIKELY', name: 'Likely duplicate charge', category: 'duplicate_charge', layer: 'deterministic', description: 'd', defaultSeverity: 'HIGH', severity: 'HIGH', severityOverridden: false,
  defaultThresholds: { windowSeconds: 120 }, thresholds: { windowSeconds: 120 }, enabled: true, layerOn: true, effective: true, updatedAt: '2026-11-01T10:00:00.000Z', alerts30d: 0, open: 0, dismissed90d: 0, lastAlertAt: null };
beforeEach(() => { vi.clearAllMocks(); mc.rules.mockResolvedValue({ rules: [rule], canEdit: true });
  mc.history.mockResolvedValue(page([{ id: 'h1', ruleId: 'MP_DUP_CHARGE_LIKELY', rule: 'Likely duplicate charge', reason: 'Split tenders', actor: 'Owner Kim', at: '2026-11-02T10:00:00Z',
    before: { enabled: true, severity: 'HIGH' }, after: { enabled: false, severity: 'HIGH' }, weaker: true }])); });

describe('POSAIMoneyProtectionSettingsScreen', () => {
  it('edits a rule with the version it saw; a refused weaker change shows the reason requirement', async () => {
    mc.saveRule.mockRejectedValueOnce({ status: 400, code: 'MC_REASON_REQUIRED' }).mockResolvedValueOnce({});
    wrap(<POSAIMoneyProtectionSettingsScreen />);
    fireEvent.click(await screen.findByTestId('mpx-rule-edit'));
    fireEvent.click(screen.getByTestId('mpx-rule-enabled'));
    fireEvent.change(screen.getByLabelText('windowSeconds'), { target: { value: '90' } });
    fireEvent.click(screen.getByTestId('mpx-rule-save'));
    expect(await screen.findByTestId('mpx-rule-msg')).toHaveTextContent('at least 5 characters');
    fireEvent.change(screen.getByTestId('mpx-rule-reason'), { target: { value: 'Split tenders trigger it' } });
    fireEvent.click(screen.getByTestId('mpx-rule-save'));
    await waitFor(() => expect(mc.saveRule).toHaveBeenLastCalledWith({ ruleId: 'MP_DUP_CHARGE_LIKELY', enabled: false, severityOverride: null, thresholds: { windowSeconds: 90 },
      reason: 'Split tenders trigger it', expectedUpdatedAt: '2026-11-01T10:00:00.000Z' }));
  });
  it('shows the change history before → after, flagged weaker, with who and why', async () => {
    wrap(<POSAIMoneyProtectionSettingsScreen />);
    const h = await screen.findByTestId('mpx-hist-row');
    expect(h).toHaveTextContent('On · High → Off · High'); expect(h).toHaveTextContent('Weaker'); expect(h).toHaveTextContent('Owner Kim'); expect(h).toHaveTextContent('Split tenders');
  });
  it('SUNMI: the status row counts the rules below — running, not running, overridden — and invents no Pending card', async () => {
    mc.rules.mockResolvedValue({ rules: [rule, { ...rule, id: 'MP_DUP_CHARGE_EXACT', thresholds: { windowSeconds: 300 } }, { ...rule, id: 'MP_CASH_DRAWER_VARIANCE', severityOverridden: true, severity: 'LOW', layerOn: false, effective: false },
      { ...rule, id: 'MP_REVERSAL_RATE_OUTLIER', enabled: false, effective: false }], canEdit: true });
    wrap(<POSAIMoneyProtectionSettingsScreen />);
    await screen.findAllByTestId('mpx-set-row');
    expect(screen.getByTestId('mpx-set-kpis').children).toHaveLength(5);
    expect(screen.getByTestId('mpx-sk-total')).toHaveTextContent('4'); expect(screen.getByTestId('mpx-sk-enabled')).toHaveTextContent('3');
    expect(screen.getByTestId('mpx-sk-running')).toHaveTextContent('2'); expect(screen.getByTestId('mpx-sk-errors')).toHaveTextContent('1');
    expect(screen.getByTestId('mpx-sk-overrides')).toHaveTextContent('2');
    expect(screen.queryByText(/pending/i)).toBeNull();
  });
});


describe('Money Protection Settings — Saved vs Effective (extras #02)', () => {
  it('each row shows what detection is actually doing next to the saved state: running, saved-on-but-not-running (with why), off', async () => {
    mc.rules.mockResolvedValue({ canEdit: true, rules: [rule,
      { ...rule, id: 'MP_B', name: 'B', layerOn: false, effective: false },
      { ...rule, id: 'MP_C', name: 'C', enabled: false, effective: false }] });
    wrap(<POSAIMoneyProtectionSettingsScreen />);
    await screen.findAllByTestId('mpx-set-row');
    const chips = screen.getAllByTestId('mpx-set-effective');
    expect(chips.map((c) => c.getAttribute('data-state'))).toEqual(['running', 'drift', 'off']);
    expect(chips[0]).toHaveTextContent('Effective: running');
    expect(chips[1]).toHaveTextContent('Saved on · not running');
    expect(chips[1].getAttribute('title')).toMatch(/detection layer is off/);
    expect(chips[2]).toHaveTextContent('Effective: off');
  });
});

describe('Money Protection Settings — safe recovery after a failed Save (extras #05)', () => {
  it('a stale save offers Reload / Compare / Retry; Compare shows mine vs saved now; Retry asks first and sends the newer version only after Compare', async () => {
    const newer = { ...rule, thresholds: { windowSeconds: 200 }, updatedAt: '2026-11-02T09:00:00.000Z' };
    mc.saveRule.mockRejectedValueOnce({ status: 409, code: 'MC_STALE' }).mockResolvedValueOnce({});
    wrap(<POSAIMoneyProtectionSettingsScreen />);
    fireEvent.click(await screen.findByTestId('mpx-rule-edit'));
    fireEvent.change(screen.getByLabelText('windowSeconds'), { target: { value: '90' } });
    fireEvent.click(screen.getByTestId('mpx-rule-save'));
    await screen.findByTestId('mpx-rec');
    expect(mc.saveRule).toHaveBeenCalledTimes(1);
    // Compare: fetch what is saved now; nothing is saved
    mc.rules.mockResolvedValue({ rules: [newer], canEdit: true });
    fireEvent.click(screen.getByTestId('mpx-rec-compare'));
    const rows = await screen.findAllByTestId('mpx-rec-diff-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('windowSeconds'); expect(rows[0]).toHaveTextContent('90'); expect(rows[0]).toHaveTextContent('200');
    expect(mc.saveRule).toHaveBeenCalledTimes(1);
    // Retry needs an explicit yes; cancelling sends nothing
    fireEvent.click(screen.getByTestId('mpx-rec-retry'));
    expect(screen.getByTestId('mpx-rec-confirm')).toHaveTextContent('over what is saved now');
    fireEvent.click(screen.getByTestId('mpx-rec-no'));
    expect(mc.saveRule).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('mpx-rec-retry'));
    fireEvent.click(screen.getByTestId('mpx-rec-yes'));
    await waitFor(() => expect(mc.saveRule).toHaveBeenCalledTimes(2));
    expect(mc.saveRule.mock.calls[1][0]).toMatchObject({ thresholds: { windowSeconds: 90 }, expectedUpdatedAt: '2026-11-02T09:00:00.000Z' });
  });
  it('a lost connection: Retry (confirmed) resends with the version first seen; Reload Current replaces my edits with the saved values', async () => {
    mc.saveRule.mockRejectedValue(new Error('Failed to fetch'));
    wrap(<POSAIMoneyProtectionSettingsScreen />);
    fireEvent.click(await screen.findByTestId('mpx-rule-edit'));
    fireEvent.change(screen.getByLabelText('windowSeconds'), { target: { value: '90' } });
    fireEvent.click(screen.getByTestId('mpx-rule-save'));
    await screen.findByTestId('mpx-rec');
    fireEvent.click(screen.getByTestId('mpx-rec-retry'));
    expect(screen.getByTestId('mpx-rec-confirm')).toHaveTextContent('Send this change again?');
    fireEvent.click(screen.getByTestId('mpx-rec-yes'));
    await waitFor(() => expect(mc.saveRule).toHaveBeenCalledTimes(2));
    expect(mc.saveRule.mock.calls[1][0].expectedUpdatedAt).toBe('2026-11-01T10:00:00.000Z');
    await screen.findByTestId('mpx-rec');
    mc.rules.mockResolvedValue({ rules: [{ ...rule, thresholds: { windowSeconds: 150 }, updatedAt: '2026-11-02T09:00:00.000Z' }], canEdit: true });
    fireEvent.click(screen.getByTestId('mpx-rec-reload'));
    await waitFor(() => expect((screen.getByLabelText('windowSeconds') as HTMLInputElement).value).toBe('150'));
    expect(screen.queryByTestId('mpx-rec')).toBeNull();
    expect(mc.saveRule).toHaveBeenCalledTimes(2);
  });
});

describe('Money Protection 5 · 07 — Safe Rule Preview', () => {
  it('previews the edited thresholds read-only (never saves); editing a value clears the old estimate', async () => {
    mc.previewRule.mockResolvedValue({ dryRun: true, saved: false, preview: { thresholdsUsed: true, current: 2, proposed: 5, added: 3, removed: 0, windowDays: 30 } });
    wrap(<POSAIMoneyProtectionSettingsScreen />);
    fireEvent.click(await screen.findByTestId('mpx-rule-edit'));
    fireEvent.change(screen.getByLabelText('windowSeconds'), { target: { value: '900' } });
    fireEvent.click(screen.getByTestId('mpx-rule-preview-run'));
    const res = await screen.findByTestId('mpx-rule-preview-result');
    expect(mc.previewRule).toHaveBeenCalledWith({ ruleId: 'MP_DUP_CHARGE_LIKELY', thresholds: { windowSeconds: 900 } });
    expect(res).toHaveTextContent('Last 30 days: 2 matches with the values in force now, 5 with these values.');
    expect(res).toHaveTextContent('3 would be new · 0 would no longer match.');
    expect(screen.getByTestId('mpx-rule-preview')).toHaveTextContent('Nothing is saved');
    expect(mc.saveRule).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('windowSeconds'), { target: { value: '600' } });
    expect(screen.queryByTestId('mpx-rule-preview-result')).toBeNull();
  });
  it('a rule whose matches do not depend on its values says so; a refused preview shows the reason', async () => {
    mc.previewRule.mockResolvedValueOnce({ preview: { thresholdsUsed: false, current: 1, proposed: 1, added: 0, removed: 0, windowDays: 30 } })
      .mockRejectedValueOnce({ status: 403 });
    wrap(<POSAIMoneyProtectionSettingsScreen />);
    fireEvent.click(await screen.findByTestId('mpx-rule-edit'));
    fireEvent.click(screen.getByTestId('mpx-rule-preview-run'));
    expect(await screen.findByTestId('mpx-rule-preview-unused')).toHaveTextContent('does not use these values');
    fireEvent.click(screen.getByTestId('mpx-rule-preview-run'));
    expect(await screen.findByTestId('mpx-rule-preview-err')).toHaveTextContent('Your role cannot do this');
    expect(mc.saveRule).not.toHaveBeenCalled();
  });
});
