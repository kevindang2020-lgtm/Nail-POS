// POSAICustomerSettingsScreen — Customer AI Settings guide (Nov 1 2026). Title, description, Assistant state, Disable for this
// salon and the five threshold labels stay; values come from the server with their source (never hard-coded 3/3/3/90/180);
// the strip keeps the salon switch apart from the subscription decision; Disable asks for confirmation and sends the
// version; a stale version reloads; edits are validated, previewed (read-only) and saved with the version; History opens
// a change with before / after; the health check renders localized text; a view-only role cannot change anything.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { api, perms } = vi.hoisted(() => ({ api: { state: vi.fn(), setAssistant: vi.fn(), setThresholds: vi.fn(), preview: vi.fn(), history: vi.fn(), event: vi.fn(), check: vi.fn() }, perms: { deny: [] as string[] } }));
vi.mock('../api/posCustomerAiSettingsApi', () => ({ posCustomerAiSettingsApi: api }));
vi.mock('../components/usePermissions', () => ({ useCan: () => (p: string) => !perms.deny.includes(p) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: { role: 'OWNER' } }) }));
import { POSAICustomerSettingsScreen } from './POSAICustomerSettingsScreen';

const TH = (o: Record<string, any> = {}) => [
  { key: 'minVisitsForServicePref', value: 3, unit: 'visits', default: 3, source: 'default', ignoredAt: [], bounds: { min: 1, max: 20 } },
  { key: 'minVisitsForTechPref', value: 3, unit: 'visits', default: 3, source: 'default', ignoredAt: [], bounds: { min: 1, max: 20 } },
  { key: 'minVisitsForCadence', value: 3, unit: 'visits', default: 3, source: 'default', ignoredAt: [], bounds: { min: 2, max: 20 } },
  { key: 'inactiveDays', value: 60, unit: 'days', default: 90, source: 'tenant', ignoredAt: [], bounds: { min: 14, max: 730 }, ...o },
  { key: 'longTermInactiveDays', value: 180, unit: 'days', default: 180, source: 'default', ignoredAt: [], bounds: { min: 30, max: 1095 } }];
const STATE = (o: Record<string, any> = {}) => ({ assistant: { effectiveEnabled: true, disabledAtLevel: null, salon: 'inherited', branchOverride: 'none', userOverride: 'none', operational: 'operational' },
  entitlement: { allowed: false, reason: 'trial_expired', subscriptionStatus: 'trialing', enforcement: 'observe' }, thresholds: TH(), salonRow: { version: 4, updatedAt: '2026-11-02T14:00:00Z', exists: true },
  lastChange: { at: '2026-11-02T14:00:00Z', by: 'Owner' }, propagation: { customerIntelligence: { state: 'pending', lastEvaluatedAt: null }, serviceRecommendations: { state: 'applied', lastEvaluatedAt: null } }, ...o });
beforeEach(() => { for (const f of Object.values(api)) f.mockReset(); perms.deny = []; api.state.mockResolvedValue(STATE()); });

describe('POSAICustomerSettingsScreen', () => {
  it('keeps the title, description, Assistant, Disable button and the five labels; values and sources come from the server', async () => {
    render(<POSAICustomerSettingsScreen />);
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText('Effective AI Customer Profile settings for this salon')).toBeInTheDocument();
    expect(await screen.findByTestId('casx-toggle')).toHaveTextContent('Disable for this salon');
    for (const l of ['Min. visits for a service preference', 'Min. visits for a technician preference', 'Min. visits to establish a return cadence', 'Inactive after (no personal cadence)', 'Long-term inactive after'])
      expect(screen.getByText(l)).toBeInTheDocument();
    expect(screen.getByTestId('val-inactiveDays')).toHaveTextContent('60 days');
    expect(screen.getByTestId('src-inactiveDays')).toHaveTextContent('This salon');
    expect(screen.getByTestId('src-longTermInactiveDays')).toHaveTextContent('Default');
  });

  it('Config Drift Alert lists exactly the server-reported drifted values and stays hidden without drift', async () => {
    api.state.mockResolvedValue(STATE({ propagation: {
      customerIntelligence: { state: 'pending', lastEvaluatedAt: null, drift: { drifted: true, ruleVersion: { evaluated: 'ci-1', current: 'ci-2', changed: true },
        keys: [{ key: 'longTermInactiveDays', evaluatedValue: 240, currentValue: 250, onScreen: true }, { key: 'dueMultiplier', evaluatedValue: 1.2, currentValue: 1, onScreen: false }] } },
      serviceRecommendations: { state: 'applied', lastEvaluatedAt: null, drift: { drifted: false, keys: [], ruleVersion: { evaluated: 'sr-1', current: 'sr-1', changed: false } } } } }));
    render(<POSAICustomerSettingsScreen />);
    const box = await screen.findByTestId('casx-drift');
    expect(screen.getByTestId('casx-drift-ci-longTermInactiveDays')).toHaveTextContent('Long-term inactive after: evaluated with 240 days — now 250 days');
    expect(box).toHaveTextContent('1 built-in value(s) changed since it ran');
    expect(box).toHaveTextContent('older rule version (ci-1)');
    expect(screen.queryByTestId('casx-drift-sr')).toBeNull();
    expect(box).toHaveTextContent('Detection only');
  });
  it('no drift → no alert', async () => {
    render(<POSAICustomerSettingsScreen />);
    await screen.findByTestId('casx-strip');
    expect(screen.queryByTestId('casx-drift')).toBeNull();
  });

  it('the strip keeps the salon switch, the subscription decision and propagation apart', async () => {
    render(<POSAICustomerSettingsScreen />);
    expect(await screen.findByTestId('casx-salon-state')).toHaveTextContent('Enabled');
    expect(screen.getByTestId('casx-package')).toHaveTextContent('Trial ended');
    expect(screen.getByTestId('casx-package')).toHaveTextContent('Not enforced yet');
    expect(screen.getByTestId('casx-effective')).toHaveTextContent('Running');
    expect(screen.getByTestId('casx-propagation')).toHaveTextContent('Pending');
  });

  it('Disable asks for confirmation, sends the version and reason; a stale version reloads', async () => {
    api.setAssistant.mockResolvedValueOnce({ version: 5, state: STATE({ assistant: { effectiveEnabled: false, disabledAtLevel: 'tenant', salon: 'disabled', branchOverride: 'none', userOverride: 'none', operational: 'disabled' } }) });
    render(<POSAICustomerSettingsScreen />);
    fireEvent.click(await screen.findByTestId('casx-toggle'));
    expect(screen.getByTestId('casx-confirm-text')).toHaveTextContent('Turn the AI Customer Profile assistant OFF for this salon');
    fireEvent.change(screen.getByTestId('casx-reason'), { target: { value: 'renovation' } });
    fireEvent.click(screen.getByTestId('casx-confirm-go'));
    await waitFor(() => expect(api.setAssistant).toHaveBeenCalledWith({ enabled: false, expectedVersion: 4, reason: 'renovation' }));
    expect(await screen.findByTestId('casx-notice')).toHaveTextContent('Version 5');
    expect(screen.getByTestId('casx-salon-state')).toHaveTextContent('Disabled');
    expect(screen.getByTestId('casx-toggle')).toHaveTextContent('Enable for this salon');
    api.setAssistant.mockRejectedValueOnce({ status: 409, body: { code: 'CAS_STALE_VERSION' } });
    fireEvent.click(screen.getByTestId('casx-toggle'));
    fireEvent.click(screen.getByTestId('casx-confirm-go'));
    await waitFor(() => expect(api.state).toHaveBeenCalledTimes(2));
  });

  it('edits are validated, previewed read-only and saved with only the changed values', async () => {
    api.preview.mockResolvedValue({ items: [{ key: 'minVisitsForCadence', current: 3, proposed: 4, affected: 12, valid: true }], estimated: true });
    api.setThresholds.mockResolvedValue({ version: 5, state: STATE() });
    render(<POSAICustomerSettingsScreen />);
    fireEvent.click(await screen.findByTestId('casx-edit'));
    fireEvent.change(screen.getByTestId('in-inactiveDays'), { target: { value: '5' } });
    expect(screen.getByTestId('pv-inactiveDays')).toHaveTextContent('outside 14–730');
    expect(screen.getByTestId('casx-save')).toBeDisabled();
    fireEvent.change(screen.getByTestId('in-inactiveDays'), { target: { value: '60' } });
    fireEvent.change(screen.getByTestId('in-minVisitsForCadence'), { target: { value: '4' } });
    fireEvent.click(screen.getByTestId('casx-preview'));
    expect(await screen.findByTestId('pv-minVisitsForCadence')).toHaveTextContent('about 12 customers cross this line');
    expect(api.preview).toHaveBeenCalledWith({ minVisitsForCadence: 4 });
    fireEvent.click(screen.getByTestId('casx-save'));
    await waitFor(() => expect(api.setThresholds).toHaveBeenCalledWith({ values: { minVisitsForCadence: 4 }, expectedVersion: 4, reason: undefined }));
  });

  it('History lists changes and opens before / after with propagation', async () => {
    api.history.mockResolvedValue({ items: [{ id: 'e1', type: 'thresholds_changed', changedKeys: ['inactiveDays'], actor: 'Owner', role: 'OWNER', version: 4, at: '2026-11-02T14:00:00Z' }], total: 1, page: 1, pageSize: 25, totalPages: 1, period: { today: '2026-11-02' } });
    api.event.mockResolvedValue({ id: 'e1', type: 'thresholds_changed', before: { enabled: null, tunables: {} }, after: { enabled: null, tunables: { inactiveDays: 60 } }, version: 4, actor: 'Owner', role: 'OWNER', reason: 'shorter cycle', at: '2026-11-02T14:00:00Z',
      propagation: { customerIntelligence: { state: 'pending', at: null }, serviceRecommendations: { state: 'applied', at: '2026-11-02T15:00:00Z' } } });
    render(<POSAICustomerSettingsScreen />);
    fireEvent.click(await screen.findByTestId('tab-history'));
    fireEvent.click(await screen.findByTestId('casx-hist-row'));
    expect(await screen.findByTestId('casx-after')).toHaveTextContent('Inactive after (no personal cadence): 60');
    expect(screen.getByTestId('casx-event-propagation')).toHaveTextContent('pending — not refreshed since');
  });

  it('the health check is localized; a view-only role cannot change anything', async () => {
    perms.deny = ['pos.ai_customer_profile.churn'];
    api.check.mockResolvedValue({ overall: 'WARNING', checkedAt: '2026-11-02T15:00:00Z', reused: false, checks: [{ key: 'intelligence_applied', state: 'WARNING' }, { key: 'settings_source', state: 'PASSED' }] });
    render(<POSAICustomerSettingsScreen />);
    expect(await screen.findByText('Your role can view these settings but not change them.')).toBeInTheDocument();
    expect(screen.queryByTestId('casx-toggle')).toBeNull();
    expect(screen.queryByTestId('casx-edit')).toBeNull();
    fireEvent.click(screen.getByTestId('tab-health'));
    fireEvent.click(screen.getByTestId('casx-check'));
    expect(await screen.findByTestId('chk-intelligence_applied')).toHaveTextContent('Press Refresh on Customer Intelligence');
  });
});
