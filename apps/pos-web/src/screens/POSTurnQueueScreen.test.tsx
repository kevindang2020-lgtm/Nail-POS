// POSTurnQueueScreen — Fair Turn Engine (wave 2). The board columns + why lines, manager actions with an inline reason,
// money only when the server says so, the close-day exception action, the fairness wording (never "unfair"), the team
// report drill-down, the settings Current → New preview before save, and the simulator.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const perms = vi.hoisted(() => ({ deny: new Set<string>() }));
vi.mock('../components/usePermissions', () => ({ useCan: () => (p: string) => !perms.deny.has(p) }));
vi.mock('../realtime/useRealtime', () => ({ useRealtime: () => {} }));
const api = vi.hoisted(() => ({
  board: vi.fn(), health: vi.fn(), history: vi.fn(), fairness: vi.fn(), teamReport: vi.fn(), technicianSummary: vi.fn(), hold: vi.fn(), release: vi.fn(), reorder: vi.fn(),
  adjust: vi.fn(), join: vi.fn(), customerDeclined: vi.fn(), closeDay: vi.fn(), settings: vi.fn(), previewSettings: vi.fn(), saveSettings: vi.fn(), rules: vi.fn(), saveRule: vi.fn(), retireRule: vi.fn(), simulate: vi.fn(),
}));
vi.mock('../api/posTurnQueueApi', () => ({ posTurnQueueApi: api, ApiError: class extends Error {} }));
import { POSTurnQueueScreen } from './POSTurnQueueScreen';

const tech = (o: any = {}) => ({ technicianId: 't1', name: 'Lisa', avatarUrl: null, rank: 1, status: 'NEXT_UP', column: 'NEXT_READY', inRotation: true, holdReason: null, turnUnitsToday: 200, inProgressUnits: 0, fullTurns: 2, partialTurns: 0,
  walkInsToday: 2, appointmentsToday: 0, nextAppointmentAt: null, nextAppointmentInMinutes: null, currentService: null, readySince: '2026-03-02T15:00:00Z', readyMinutes: 20, clockedMinutes: 240, onBreakSince: null, skipsToday: 1,
  basis: 'Lowest turns among ready technicians', money: null, ...o });
const board = (o: any = {}) => ({ businessDate: '2026-03-02', timeZone: 'UTC', mode: 'traditional_weighted_rotation', modeLabel: 'Traditional weighted rotation', rotationPolicy: 'traditional_weighted_rotation', assignmentMode: 'RECOMMEND_AND_CONFIRM', policyVersion: '3',
  nextUpTechnicianId: 't1', moneyVisible: false, serverTime: '2026-03-02T15:20:00Z',
  technicians: [tech(), tech({ technicianId: 't2', name: 'Mary', rank: null, status: 'SERVING', column: 'SERVING', basis: null, skipsToday: 0, money: { serviceSalesCents: 5000, commissionCents: 2000, tipsCents: 800, retailCommissionCents: 0, estimatedEarningsCents: 2800 } })], ...o });
const health = (o: any = {}) => ({ businessDate: '2026-03-02', waitingCustomers: 1, readyTechnicians: 1, longestCustomerWaitMinutes: 4, longestTechnicianReadyMinutes: 20, techniciansServing: 1, techniciansOnBreak: 0, upcomingAppointmentsNextHour: 0, exceptions: [], ...o });
const settings = { effective: { assignmentMode: 'RECOMMEND_AND_CONFIRM', fairnessMode: 'traditional_weighted_rotation', turnPolicy: { breakPositionPolicy: 'PRESERVE_POSITION', appointmentProtectionBufferMinutes: 10 }, policyVersion: '3' },
  recommended: { assignmentMode: 'RECOMMEND_AND_CONFIRM', fairnessMode: 'traditional_weighted_rotation', turnPolicy: {} },
  vocabulary: { assignmentModes: ['AUTOMATIC', 'RECOMMEND_AND_CONFIRM', 'MANUAL'], fairnessModes: [{ value: 'traditional_weighted_rotation', label: 'Traditional' }, { value: 'lowest_turn_units', label: 'Lowest' }], overrideReasons: [], declineReasons: [], skipReasons: [] }, canManage: true };

beforeEach(() => {
  perms.deny = new Set();
  Object.values(api).forEach((f) => f.mockReset());
  api.board.mockResolvedValue(board()); api.health.mockResolvedValue(health());
});
const openTab = async (name: string) => { render(<POSTurnQueueScreen />); fireEvent.click(await screen.findByRole('tab', { name })); };

describe('POSTurnQueueScreen — board', () => {
  it('shows the columns, the next-up technician with her why line and position-kept skips, and hides money when not allowed', async () => {
    render(<POSTurnQueueScreen />);
    const next = await screen.findByRole('region', { name: 'Next / Ready' });
    expect(within(next).getByText('#1 Lisa')).toBeInTheDocument();
    expect(within(next).getByText(/Why this place: Lowest turns among ready technicians · skipped 1× today \(position kept\)/)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Serving' })).getByText('Mary')).toBeInTheDocument();
    expect(screen.queryByText(/Est\. \$/)).toBeNull();   // moneyVisible false
  });
  it('shows money only when the server marks it visible', async () => {
    api.board.mockResolvedValue(board({ moneyVisible: true }));
    render(<POSTurnQueueScreen />);
    expect(await screen.findByText(/Sales \$50\.00 · Comm\. \$20\.00 · Tips \$8\.00 · Est\. \$28\.00/)).toBeInTheDocument();
  });
  it('a manager action asks for a reason inline and sends it', async () => {
    api.reorder.mockResolvedValue({ businessDate: '2026-03-02', technicianIds: ['t1'], events: ['REORDER'] });
    render(<POSTurnQueueScreen />);
    const card = await screen.findByLabelText('Lisa turn card');
    fireEvent.click(within(card).getByRole('button', { name: 'Actions' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Move to back' }));
    fireEvent.change(await screen.findByLabelText('Reason'), { target: { value: 'asked to wait' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(api.reorder).toHaveBeenCalledWith('t1', { toBack: true, reason: 'asked to wait' }));
  });
  it('hides manager actions without the permissions', async () => {
    perms.deny = new Set(['turn_queue.reorder', 'turn_queue.hold', 'turn_queue.adjust', 'turn_queue.join']);
    render(<POSTurnQueueScreen />);
    const card = await screen.findByLabelText('Lisa turn card');
    expect(within(card).queryByRole('button', { name: 'Actions' })).toBeNull();
  });
  it('offers to close a past turn day that is still open', async () => {
    api.health.mockResolvedValue(health({ exceptions: [{ code: 'TURN_DAY_NOT_CLOSED', severity: 'info', text: 'The turn day 2026-03-01 is still open.', businessDate: '2026-03-01' }] }));
    api.closeDay.mockResolvedValue({ closed: 3 });
    render(<POSTurnQueueScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Close 2026-03-01' }));
    await waitFor(() => expect(api.closeDay).toHaveBeenCalledWith('2026-03-01'));
  });
  it('shows an honest error with a retry when the board cannot load', async () => {
    api.board.mockRejectedValue(new Error('Turn board unavailable'));
    render(<POSTurnQueueScreen />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Turn board unavailable');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('POSTurnQueueScreen — fairness, reports, settings, simulate', () => {
  it('fairness uses the neutral wording and the methodology', async () => {
    api.fairness.mockResolvedValue({ from: '2026-03-02', to: '2026-03-02', timeZone: 'UTC', methodology: 'Expected share of eligible ready time.', operationalDiagnosticNotPayroll: true,
      team: { opportunities: 4, opportunityUnits: 400, automaticRecommendations: 4, automaticAssignments: 2, confirmedRecommendations: 1, manualAssignments: 1, overrides: 1, overrideRate: 25, skipsByReason: { ON_BREAK: 1 } },
      rows: [{ technicianId: 't1', name: 'Lisa', readyMinutes: 60, eligibleWorkingMinutes: 240, eligibleHours: 4, actualUnits: 100, expectedUnits: 200, gapUnits: -100, indicator: 'BELOW_EXPECTED_OPPORTUNITY', indicatorLabel: 'Below expected opportunity',
        creditedUnits: 100, adjustmentUnits: 0, walkIns: 1, requestedWalkIns: 0, firstAvailableWalkIns: 1, appointments: 0, automaticAssignments: 1, manualAssignments: 0, overrides: 0, skips: 1, skipsByReason: { ON_BREAK: 1 }, voluntaryDeclines: 0, averageReadyWaitMinutes: 12, opportunityRatePerReadyHour: 1 }] });
    await openTab('Turn fairness');
    expect(await screen.findByText('1.0 below expected opportunity')).toBeInTheDocument();   // from the indicator code + gap (WP-C1)
    expect(screen.getByText(/An operational diagnostic — not payroll/)).toBeInTheDocument();
    expect(screen.queryByText(/unfair/i)).toBeNull();
  });
  it('team report lists technicians and drills into one summary', async () => {
    const row = { technicianId: 't1', name: 'Lisa', period: 'day', from: '2026-03-02', to: '2026-03-02', branches: [], fairnessGapUnits: 0, fairnessIndicator: 'Within fair range', turnUnitsPerEligibleHour: 0.5,
      time: { clockedMinutes: 240, paidBreakMinutes: 10, unpaidBreakMinutes: 30, interruptedBreaks: 0, eligibleWorkedMinutes: 210, serviceMinutes: 120, readyMinutes: 60, holdMinutes: 0, idleMinutes: 30, utilization: 0.57 },
      walkIns: { assigned: 2, completed: 2, requested: 1, firstAvailable: 1 }, appointments: { scheduled: 1, completed: 1, canceled: 0, noShow: 0, rescheduled: 0, requestedTechnician: 1, anyTechnician: 0 },
      turns: { turnUnits: 200, fullTurns: 2, partialTurns: 0, automaticAssignments: 1, manualAssignments: 1, eligibleSkips: 0, voluntaryDeclines: 0, managerOverrides: 0, averageReadyWaitMinutes: 9, queueOpportunityRate: null }, money: null };
    api.teamReport.mockResolvedValue({ period: 'day', from: '2026-03-02', to: '2026-03-02', timeZone: 'UTC', moneyVisible: false, rows: [row], totals: { techniciansWorked: 1 }, methodology: { utilization: 'Service ÷ eligible time.', money: '' } });
    api.technicianSummary.mockResolvedValue({ ...row, previous: { ...row, turns: { ...row.turns, turnUnits: 300 } } });
    await openTab('Team report');
    fireEvent.click(await screen.findByRole('button', { name: 'Lisa' }));
    await waitFor(() => expect(api.technicianSummary).toHaveBeenCalledWith('t1', { period: 'day', date: undefined }));
    expect(await screen.findByText(/Previous period: turns 3/)).toBeInTheDocument();
  });
  it('settings must be previewed before saving, and the save carries a reason', async () => {
    api.settings.mockResolvedValue(settings); api.rules.mockResolvedValue({ defaultTurnUnits: 100, rules: [] });
    api.previewSettings.mockResolvedValue({ changes: [{ key: 'assignmentMode', current: 'RECOMMEND_AND_CONFIRM', next: 'AUTOMATIC', outcome: 'The system assigns without a confirm step.' }] });
    api.saveSettings.mockResolvedValue({});
    await openTab('Settings & turn rules');
    fireEvent.change(await screen.findByLabelText('Assignment mode'), { target: { value: 'AUTOMATIC' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Preview the change' }));
    expect(await screen.findByText(/The system assigns without a confirm step/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.change(await screen.findByLabelText('Reason'), { target: { value: 'busy saturdays' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ scope: 'branch', reason: 'busy saturdays', patch: { assignmentMode: 'AUTOMATIC' } }));
  });
  it('settings are read-only without settings.manage', async () => {
    perms.deny = new Set(['turn_queue.settings.manage']);
    api.settings.mockResolvedValue(settings); api.rules.mockResolvedValue({ defaultTurnUnits: 100, rules: [] });
    await openTab('Settings & turn rules');
    expect(await screen.findByLabelText('Assignment mode')).toBeDisabled();
    expect(screen.getByText(/Only the owner changes/)).toBeInTheDocument();
  });
  it('the simulator shows the recommendation and why, and says nothing on the floor changes', async () => {
    api.simulate.mockResolvedValue({ mode: 'lowest_turn_units', recommended: 'Mary', why: ['Mary has the fewest turn units (1.5).'], skipped: [], ranking: [], productionStateChanged: false });
    await openTab('Simulate');
    expect(screen.getByText(/nothing on the floor changes/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }));
    expect(await screen.findByText('Recommended: Mary')).toBeInTheDocument();
    expect(api.simulate).toHaveBeenCalledWith(expect.objectContaining({ mode: 'lowest_turn_units', technicians: [expect.objectContaining({ name: 'Lisa', turns: 2, position: 1 }), expect.objectContaining({ name: 'Mary', turns: 1.5, position: 2 })] }));
  });
  it('LIVE TECHNICIAN SCHEDULE 14: the simulator says when a guest request changed the rotation order', async () => {
    api.simulate.mockResolvedValue({ mode: 'lowest_turn_units', recommended: 'Mary', why: [], skipped: [], ranking: [], productionStateChanged: false,
      orderChange: { rotationPickId: 'sim-01', rotationPickName: 'Lisa', changedBy: 'customer_request', text: 'x', textCoded: { code: 'FAIR_ORDER.CUSTOMER_REQUEST', vars: { name: 'Mary', rotation: 'Lisa' } } } });
    await openTab('Simulate');
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }));
    expect((await screen.findByTestId('tq-sim-fairness')).textContent).toBe('Mary is ahead of Lisa (next in rotation) because the guest asked for Mary. Lisa keeps the turn position.');
  });
});
