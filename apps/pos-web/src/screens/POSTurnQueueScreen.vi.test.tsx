// POSTurnQueueScreen.vi.test — English + Vietnamese POS mandate (WP-C1): the Turn Queue reads in Vietnamese — the board
// (statuses from their codes, the assignment / fairness mode, durations), a manager action's prompt and its confirmation
// (kept as a key, so it re-reads on a switch), the fairness indicator (from its code + gap), and the settings options.
// Names the salon typed and the server's own "why this place" prose stay as they are.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { setLanguage, useLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { leftoverEnglish } from './viScan.testkit';

vi.mock('../components/usePermissions', () => ({ useCan: () => () => true }));
vi.mock('../realtime/useRealtime', () => ({ useRealtime: () => {} }));
const api = vi.hoisted(() => ({
  board: vi.fn(), health: vi.fn(), history: vi.fn(), fairness: vi.fn(), teamReport: vi.fn(), technicianSummary: vi.fn(), hold: vi.fn(), release: vi.fn(), reorder: vi.fn(),
  adjust: vi.fn(), join: vi.fn(), customerDeclined: vi.fn(), closeDay: vi.fn(), settings: vi.fn(), previewSettings: vi.fn(), saveSettings: vi.fn(), rules: vi.fn(), saveRule: vi.fn(), retireRule: vi.fn(), simulate: vi.fn(),
}));
vi.mock('../api/posTurnQueueApi', () => ({ posTurnQueueApi: api, ApiError: class extends Error {} }));
import { POSTurnQueueScreen } from './POSTurnQueueScreen';

const BASIS = 'Lowest turns: 2 turn units today';
const tech = (o: any = {}) => ({ technicianId: 't1', name: 'Trần Mỹ Linh', avatarUrl: null, rank: 1, status: 'NEXT_UP', column: 'NEXT_READY', inRotation: true, holdReason: null, turnUnitsToday: 200, inProgressUnits: 0, fullTurns: 2, partialTurns: 0,
  walkInsToday: 2, appointmentsToday: 0, nextAppointmentAt: null, nextAppointmentInMinutes: null, currentService: null, readySince: '2026-03-02T15:00:00Z', readyMinutes: 80, clockedMinutes: 240, onBreakSince: null, skipsToday: 0,
  basis: BASIS, money: null, ...o });
const board = { businessDate: '2026-03-02', timeZone: 'UTC', mode: 'lowest_turn_units', modeLabel: 'Lowest turn units', rotationPolicy: 'lowest_turn_units', assignmentMode: 'RECOMMEND_AND_CONFIRM', policyVersion: '3',
  nextUpTechnicianId: 't1', moneyVisible: false, serverTime: '2026-03-02T15:20:00Z',
  technicians: [tech(), tech({ technicianId: 't2', name: 'Lan Vo', rank: null, status: 'HOLD', column: 'BREAK_HOLD', basis: null }), tech({ technicianId: 't3', name: 'Mai Pham', rank: null, status: 'CLOCKED_IN', column: 'OFF_SHIFT', inRotation: false, basis: null })] };
const health = { businessDate: '2026-03-02', waitingCustomers: 1, readyTechnicians: 1, longestCustomerWaitMinutes: 4, longestTechnicianReadyMinutes: 80, techniciansServing: 0, techniciansOnBreak: 0, upcomingAppointmentsNextHour: 0, exceptions: [] };
const settings = { effective: { assignmentMode: 'RECOMMEND_AND_CONFIRM', fairnessMode: 'lowest_turn_units', turnPolicy: { breakPositionPolicy: 'PRESERVE_POSITION', languageMatch: 'SOFT', appointmentProtectionBufferMinutes: 10 }, policyVersion: '3' },
  recommended: { assignmentMode: 'RECOMMEND_AND_CONFIRM', fairnessMode: 'traditional_weighted_rotation', turnPolicy: {} },
  vocabulary: { assignmentModes: ['AUTOMATIC', 'RECOMMEND_AND_CONFIRM', 'MANUAL'], fairnessModes: [{ value: 'traditional_weighted_rotation', label: 'Traditional' }, { value: 'lowest_turn_units', label: 'Lowest' }], overrideReasons: [], declineReasons: [], skipReasons: [] }, canManage: true };
const NAMES = ['Trần Mỹ Linh', 'Lan Vo', 'Mai Pham', BASIS];

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.board.mockResolvedValue(board); api.health.mockResolvedValue(health);
  api.settings.mockResolvedValue(settings); api.rules.mockResolvedValue({ defaultTurnUnits: 100, rules: [] });
});
afterEach(async () => { await act(async () => { await setLanguage('en'); }); });

describe('Turn Queue in Vietnamese (WP-C1)', () => {
  it('the board: statuses from codes, the modes, durations, an action note — no English left', async () => {
    await setLanguage('vi');
    api.reorder.mockResolvedValue({});
    const { container } = render(<POSTurnQueueScreen />);
    await screen.findByText(/Trần Mỹ Linh/);
    expect(screen.getByText('Gợi ý & xác nhận')).toBeInTheDocument();
    expect(screen.getByText(/Ít lượt nhất/)).toBeInTheDocument();
    expect(screen.getByText('Tạm dừng hàng chờ')).toBeInTheDocument();
    expect(screen.getAllByText(/1 giờ 20 phút/).length).toBeGreaterThan(0);
    for (const en of ['Recommend & confirm', 'Lowest turn units', 'On hold', 'Clocked in — not in rotation', '1h 20m']) expect(screen.queryByText(new RegExp(en)), en).toBeNull();
    expect(leftoverEnglish(container, NAMES).join(' | ')).toBe('');
    // a manager action: the prompt and the confirmation are Vietnamese
    const card = screen.getByLabelText(/Trần Mỹ Linh/, { selector: 'div[aria-label]' });
    fireEvent.click(within(card).getAllByRole('button')[0]);
    fireEvent.click(within(card).getAllByRole('button')[1]);
    expect(await screen.findByText('Cho Trần Mỹ Linh làm người kế tiếp? Lý do?')).toBeInTheDocument();
    expect(leftoverEnglish(container, NAMES).join(' | ')).toBe('');
  });

  it('fairness indicator from its code, settings options labelled — and a switch back re-labels in place', async () => {
    await setLanguage('vi');
    api.fairness.mockResolvedValue({ from: '2026-03-02', to: '2026-03-02', timeZone: 'UTC', methodology: '', operationalDiagnosticNotPayroll: true,
      team: { opportunities: 4, opportunityUnits: 400, automaticRecommendations: 4, automaticAssignments: 2, confirmedRecommendations: 1, manualAssignments: 1, overrides: 1, overrideRate: 25, skipsByReason: { ON_BREAK: 1 } },
      rows: [{ technicianId: 't1', name: 'Trần Mỹ Linh', readyMinutes: 60, eligibleWorkingMinutes: 240, eligibleHours: 4, actualUnits: 100, expectedUnits: 200, gapUnits: -100, indicator: 'BELOW_EXPECTED_OPPORTUNITY', indicatorLabel: '1.0 below expected opportunity',
        creditedUnits: 100, adjustmentUnits: 0, walkIns: 1, requestedWalkIns: 0, firstAvailableWalkIns: 1, appointments: 0, automaticAssignments: 1, manualAssignments: 0, overrides: 0, skips: 1, skipsByReason: { ON_BREAK: 1 }, voluntaryDeclines: 0, averageReadyWaitMinutes: 12, opportunityRatePerReadyHour: 1 }] });
    function Live() { useLanguage(); return <POSTurnQueueScreen />; }
    const { container } = render(<Live />);
    const tabs = await screen.findAllByRole('tab');
    fireEvent.click(tabs[2]);
    expect(await screen.findByText('Thấp hơn cơ hội dự kiến 1.0 lượt')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('tab')[4]);
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'Giữ vị trí' }).length).toBeGreaterThan(0));
    expect(screen.getAllByRole('option', { name: 'Ưu tiên' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('option', { name: /preserve position/i })).toBeNull();
    expect(leftoverEnglish(container, NAMES).join(' | ')).toBe('');
    await act(async () => { await setLanguage('en'); });
    expect(screen.getAllByRole('option', { name: 'Keep the position' }).length).toBeGreaterThan(0);
  });
});

// Vietnamese POS leftover (Oct 27 2026): the server-written words — "why this place", turn health, the history line, the
// fairness methodology, the simulator's why / skipped — arrive as code + vars (CodedText) and read in Vietnamese; the
// English sentence the server still sends is the fallback for a code the POS does not know.
describe('Turn Queue — server-written text as code + vars', () => {
  const coded = {
    board: { ...board, technicians: [tech({ basisText: { code: 'TURN_BASIS.LOWEST_TURNS_BOOST', vars: { turns: '2.0', boost: '0.5' } } })] },
    health: { ...health, exceptions: [
      { code: 'CUSTOMER_WAITING_TECHNICIAN_IDLE', severity: 'warning', text: 'A guest has waited 35 min while 2 technician(s) are ready.', vars: { minutes: 35, ready: 2 } },
      { code: 'SOMETHING_NEW', severity: 'info', text: 'An English line the POS has no words for.' },
    ] },
  };
  it('board, health, history, methodology and simulator read in Vietnamese; an unknown code falls back to the English text', async () => {
    await setLanguage('vi');
    api.board.mockResolvedValue(coded.board); api.health.mockResolvedValue(coded.health);
    api.history.mockResolvedValue({ from: '2026-03-02', to: '2026-03-02', events: [
      { id: 'e1', businessDate: '2026-03-02', sequenceNumber: 1, technicianId: 't1', technicianName: 'Trần Mỹ Linh', eventType: 'SKIP', statusBefore: null, statusAfter: null, queueItemId: null, appointmentId: null, serviceId: null, turnUnits: 0, turnUnitsDelta: 0, turnRuleId: null, turnRuleVersion: null,
        reasonCode: 'ON_BREAK', reasonText: null, assignmentSource: null, assignmentKind: null, recommendedTechnicianId: null, positionBefore: null, positionAfter: null, policyVersion: null, actorType: 'system', actorId: null, occurredAt: '2026-03-02T15:00:00Z', orderBefore: null, orderAfter: null,
        text: 'Trần Mỹ Linh skipped — on break; position preserved', textCoded: { code: 'TURN_EVENT.SKIP', vars: { name: 'Trần Mỹ Linh', reason: '@status.turnReason.ON_BREAK' } } },
      { id: 'e2', businessDate: '2026-03-02', sequenceNumber: 2, technicianId: 't1', technicianName: 'Trần Mỹ Linh', eventType: 'ASSIGN', statusBefore: null, statusAfter: null, queueItemId: null, appointmentId: null, serviceId: null, turnUnits: 100, turnUnitsDelta: 0, turnRuleId: null, turnRuleVersion: null,
        reasonCode: null, reasonText: null, assignmentSource: null, assignmentKind: 'walk_in_shared', recommendedTechnicianId: null, positionBefore: null, positionAfter: null, policyVersion: null, actorType: 'system', actorId: null, occurredAt: '2026-03-02T15:05:00Z', orderBefore: null, orderAfter: null,
        text: 'Trần Mỹ Linh assigned (1.00 turn, walk in shared)', textCoded: { code: 'TURN_EVENT.ASSIGN_KIND', vars: { name: 'Trần Mỹ Linh', units: '1.00', kind: '@srv.TURN_KIND.walk_in_shared' } } },
    ] });
    api.fairness.mockResolvedValue({ from: '2026-03-02', to: '2026-03-02', timeZone: 'UTC', methodology: 'Expected opportunity = … (English)', methodologyCode: 'EXPECTED_OPPORTUNITY_V1', operationalDiagnosticNotPayroll: true,
      team: { opportunities: 0, opportunityUnits: 0, automaticRecommendations: 0, automaticAssignments: 0, confirmedRecommendations: 0, manualAssignments: 0, overrides: 0, overrideRate: null, skipsByReason: {} }, rows: [] });
    api.simulate.mockResolvedValue({ mode: 'lowest_turn_units', recommended: 'Trần Mỹ Linh', productionStateChanged: false, ranking: [],
      why: ['Trần Mỹ Linh selected because Trần Mỹ Linh is next among the technicians who can take this guest.', 'Rule: Rotation position'],
      whyCoded: [{ code: 'FAIR_WHY.NEXT', vars: { name: 'Trần Mỹ Linh' } }, { code: 'FAIR_WHY.RULE', vars: { rule: '@srv.TURN_BASIS.ROTATION' } }],
      skipped: [{ name: 'Lan Vo', reason: 'ON_BREAK', text: 'Lan Vo remained ahead in rotation, but was skipped (on break). Her turn position was preserved.', textCoded: { code: 'FAIR_SKIP.OTHER', vars: { name: 'Lan Vo', reason: '@srv.SKIP_REASON.ON_BREAK' } } }] });
    function Live() { useLanguage(); return <POSTurnQueueScreen />; }
    render(<Live />);
    expect(await screen.findByText(/Ít lượt nhất: hôm nay 2\.0 lượt, ưu tiên vì chờ lâu −0\.5/)).toBeInTheDocument();
    expect(await screen.findByText(/Có khách đã chờ 35 phút trong khi 2 thợ đang sẵn sàng\./)).toBeInTheDocument();
    expect(screen.getByText(/An English line the POS has no words for\./)).toBeInTheDocument();   // unknown code → the server's text
    fireEvent.click(screen.getAllByRole('tab')[1]);
    expect(await screen.findByText('Trần Mỹ Linh bị bỏ qua — Đang nghỉ; giữ nguyên vị trí')).toBeInTheDocument();
    expect(screen.getByText('Trần Mỹ Linh được chỉ định (1.00 lượt, khách vãng lai chia lượt)')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('tab')[2]);
    expect(await screen.findByText(/Cơ hội dự kiến = số lượt của mỗi khách vãng lai/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('tab')[5]);
    fireEvent.click(await screen.findByRole('button', { name: 'Chạy mô phỏng' }));
    expect(await screen.findByText('Chọn Trần Mỹ Linh vì Trần Mỹ Linh đến lượt trong số các thợ nhận được khách này.')).toBeInTheDocument();
    expect(screen.getByText('Quy tắc: Vị trí trong vòng lượt')).toBeInTheDocument();
    expect(screen.getByText('Lan Vo vẫn đứng trước trong vòng lượt nhưng bị bỏ qua (đang nghỉ). Vị trí lượt được giữ nguyên.')).toBeInTheDocument();
    // a switch back to English re-words the same data in place — the server's English
    await act(async () => { await setLanguage('en'); });
    expect(screen.getByText('Lan Vo remained ahead in rotation, but was skipped (on break). Her turn position was preserved.')).toBeInTheDocument();
    expect(screen.getByText('Rule: Rotation position')).toBeInTheDocument();
  });
});
