// POSAiAlertsScreen — AI Business Alerts guide (Nov 3 2026): the New Alert row and rule table stay; Evaluate now is recorded with what
// changed; history with acknowledgement and explanation; Delete asks first; honest about no automatic evaluation / delivery.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { c, api } = vi.hoisted(() => {
  const c = { alertSummary: vi.fn(), rules: vi.fn(), history: vi.fn(), evaluate: vi.fn(), acknowledge: vi.fn(), explain: vi.fn(), anomaly: vi.fn(), alertCheck: vi.fn(),
    incidents: vi.fn(), incident: vi.fn(), incidentAction: vi.fn(), incidentNote: vi.fn(), alertDelivery: vi.fn(), alertSetDelivery: vi.fn() };
  return { c, api: { center: c, alertCreate: vi.fn(), alertUpdate: vi.fn(), alertDelete: vi.fn() } };
});
vi.mock('../api/posAiBusinessApi', () => ({ posAiBusinessApi: api }));
const reads = vi.hoisted(() => ({ markAlertsReadEverywhere: vi.fn() }));
vi.mock('../shell/alertReads', () => reads);
import { POSAiAlertsScreen } from './POSAiAlertsScreen';
const RULE = { id: 'a1', title: 'test', metricId: 'average_ticket', operator: 'gt', threshold: 123500, preset: 'today', minSampleSize: 5, active: true, createdBy: 'Owner Kim',
  latest: { id: 'e1', triggered: true, sampleOk: true, value: 130000, stateChange: 'triggered', evaluatedAt: '2026-11-03T15:00:00Z', acknowledgedAt: null } };
const EV = { id: 'e1', alertId: 'a1', title: 'test', metricId: 'average_ticket', operator: 'gt', threshold: 123500, value: 130000, sampleSize: 8, minSampleSize: 5, sampleOk: true, triggered: true,
  stateChange: 'triggered', periodFrom: '2026-11-03', periodTo: '2026-11-03', evaluatedAt: '2026-11-03T15:00:00Z', acknowledgedAt: null };
const wrap = () => render(<MemoryRouter><POSAiAlertsScreen /></MemoryRouter>);
beforeEach(() => {
  vi.clearAllMocks();
  try { sessionStorage.clear(); } catch { /* jsdom */ }
  c.alertSummary.mockResolvedValue({ activeRules: 2, pausedRules: 0, triggeredUnacknowledged: 1, needsReview: 0, neverEvaluated: 1, lastEvaluatedAt: '2026-11-03T15:00:00Z', automaticEvaluation: false });
  c.rules.mockResolvedValue({ items: [RULE], total: 1, page: 1, pageSize: 25, totalPages: 1 });
  c.history.mockResolvedValue({ items: [EV], total: 1, page: 1, pageSize: 25, totalPages: 1, period: { today: '2026-11-03' } });
  c.incidents.mockResolvedValue({ status: 'active', page: 1, limit: 25, total: 1, counts: { open: 1 }, items: [INC] });
  c.incident.mockResolvedValue(INC_D);
  c.alertDelivery.mockResolvedValue(DELIVERY);
});
const INC = { eventId: 'e1', title: 'test', severity: 'critical', incidentStatus: 'open', version: 1, evaluatedAt: '2026-11-03T15:00:00Z', snoozedUntil: null, assignee: null, display: { value: '$1,300.00', threshold: '$1,235.00' } };
const INC_D = { ...INC, alertId: 'a1', metricId: 'average_ticket', operator: 'gt', value: 130000, threshold: 123500, assignee: null, acknowledgedAt: null, resolvedAt: null, resolutionNote: null, escalatedAt: null,
  log: [{ kind: 'notify', body: 'Notified: 1 sent, 1 skipped, 0 failed.', at: '2026-11-03T15:00:00Z', by: 'System' }],
  deliveries: [{ channel: 'in_app', kind: 'trigger', status: 'sent', reason: null, to: null, at: '2026-11-03T15:00:00Z' }, { channel: 'sms', kind: 'trigger', status: 'skipped', reason: 'quiet_hours', to: 'Owner Kim', at: '2026-11-03T15:00:00Z' }] };
const DELIVERY = { alertId: 'a1', severity: 'warning', channels: ['in_app'], recipientUserIds: [], quietHoursStart: 21, quietHoursEnd: 8, cooldownMinutes: 60,
  staff: [{ userId: 'u1', name: 'Owner Kim', role: 'OWNER', hasEmail: true, hasPhone: true }, { userId: 'u2', name: 'Manager Lee', role: 'MANAGER', hasEmail: true, hasPhone: false }] };

describe('POSAiAlertsScreen', () => {
  it('keeps the rule table; when the server has automatic evaluation switched off the page says rules are evaluated by hand', async () => {
    wrap();
    const row = await screen.findByTestId('bzx-a-row');
    expect(row).toHaveTextContent('Average ticket rises above $1,235.00');
    expect(row).toHaveTextContent('minimum sample 5');
    expect(row).toHaveTextContent('Triggered');
    expect(screen.getByTestId('bzx-a-manual')).toHaveTextContent('Automatic evaluation is switched off for this server');
    expect(screen.getByTestId('bzx-a-triggered')).toHaveTextContent('1');
  });
  it('extras (Nov 11 2026): warns when an active rule already watches the same metric, comparison and period', async () => {
    wrap();
    await screen.findByTestId('bzx-a-row');
    expect(screen.queryByTestId('bzx-a-collision')).toBeNull();   // net_sales / lt / today: no such active rule
    fireEvent.change(screen.getByTestId('bzx-a-metric'), { target: { value: 'average_ticket' } });
    fireEvent.change(screen.getByTestId('bzx-a-op'), { target: { value: 'gt' } });
    expect(await screen.findByTestId('bzx-a-collision')).toHaveTextContent('“test”');
    expect(screen.getByTestId('bzx-a-create')).not.toBeDisabled();
  });
  it('creates an alert with the dollar amount in cents and the minimum sample', async () => {
    api.alertCreate.mockResolvedValue({});
    wrap();
    fireEvent.change(screen.getByTestId('bzx-a-title'), { target: { value: 'Slow day' } });
    fireEvent.change(screen.getByTestId('bzx-a-amount'), { target: { value: '800' } });
    fireEvent.change(screen.getByTestId('bzx-a-min'), { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('bzx-a-create'));
    expect(await screen.findByText('Alert created.')).toBeInTheDocument();
    expect(api.alertCreate).toHaveBeenCalledWith({ title: 'Slow day', metricId: 'net_sales', operator: 'lt', threshold: 80000, preset: 'today', minSampleSize: 3 });
  });
  it('Evaluate now shows what changed, the sample and the exact day', async () => {
    c.evaluate.mockResolvedValue({ metricId: 'average_ticket', value: 120000, threshold: 123500, sampleSize: 9, stateChange: 'recovered', period: { from: '2026-11-03', to: '2026-11-03' } });
    wrap();
    fireEvent.click(await screen.findByTestId('bzx-a-eval'));
    expect(await screen.findByTestId('bzx-a-result')).toHaveTextContent('Recovered');
    expect(screen.getByTestId('bzx-a-result')).toHaveTextContent('$1,200.00 vs $1,235.00');
    expect(screen.getByTestId('bzx-a-result')).toHaveTextContent('sample 9');
  });
  it('Delete asks first; an error is shown, not swallowed', async () => {
    api.alertDelete.mockRejectedValue({ status: 500, message: 'boom' });
    wrap();
    fireEvent.click(await screen.findByTestId('bzx-a-del'));
    expect(screen.getByTestId('bzx-a-confirm')).toHaveTextContent('cannot be undone');
    fireEvent.click(screen.getByTestId('bzx-a-del-yes'));
    expect(await screen.findByTestId('bzx-a-msg')).toBeInTheDocument();
  });
  it('history: acknowledge with a note; explain shows the measured bridge, not a cause', async () => {
    c.acknowledge.mockResolvedValue({ id: 'e1' });
    c.explain.mockResolvedValue({ metricId: 'average_ticket', operator: 'gt', threshold: 123500, value: 130000, period: { from: '2026-11-03', to: '2026-11-03' }, kind: 'revenue_bridge', sourceRoute: '/tenant/reports/sales',
      explanation: { currentNetCents: 500000, previousNetCents: 400000, changeCents: 100000, changePercent: 25, contributors: [{ factor: 'Ticket volume', deltaCents: 60000, note: 'more tickets' }], caveats: [] } });
    wrap();
    fireEvent.click(await screen.findByTestId('bzx-h-ack'));
    fireEvent.change(screen.getByTestId('bzx-ack-note'), { target: { value: 'Holiday weekend' } });
    fireEvent.click(screen.getByTestId('bzx-ack-yes'));
    await vi.waitFor(() => expect(c.acknowledge).toHaveBeenCalledWith('e1', 'Holiday weekend'));
    fireEvent.click(screen.getByTestId('bzx-h-why'));
    expect(await screen.findByTestId('bzx-bridge')).toHaveTextContent('Ticket volume');
    expect(screen.getByTestId('bzx-explain')).toHaveTextContent('not proof of cause');
  });
  it('history filters go to the server', async () => {
    wrap();
    await screen.findByTestId('bzx-h-row');
    fireEvent.change(screen.getByTestId('bzx-h-state'), { target: { value: 'unacknowledged' } });
    fireEvent.click(screen.getAllByTestId('bzx-preset-month')[0]);
    expect(c.history).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'unacknowledged', preset: 'month', page: 1 }));
  });
  it('the anomaly check says when history is too short', async () => {
    c.anomaly.mockResolvedValue({ weekday: 'Monday', items: [{ metric: 'netSalesCents', actual: 50000, baseline: null, status: 'insufficient_history', comparableDays: 2 }] });
    wrap();
    fireEvent.click(screen.getByTestId('bzx-an-run'));
    expect(await screen.findByTestId('bzx-an-netSalesCents')).toHaveTextContent('Not enough history: 2 comparable days');
  });
  it('Edit saves name, amount (cents), period and minimum sample; Duplicate creates a paused copy; History filters to one alert', async () => {
    api.alertUpdate.mockResolvedValue({}); api.alertCreate.mockResolvedValue({ id: 'a2' });
    wrap();
    fireEvent.click(await screen.findByTestId('bzx-a-edit'));
    fireEvent.change(screen.getByTestId('bzx-edit-amount'), { target: { value: '1500' } });
    fireEvent.change(screen.getByTestId('bzx-edit-preset'), { target: { value: 'quarter' } });
    fireEvent.click(screen.getByTestId('bzx-edit-save'));
    // extras #07: Save shows Current → Proposed first; nothing is sent until Confirm
    const diffs = await screen.findAllByTestId('bzx-edit-diff');
    expect(diffs.map((d) => d.getAttribute('data-changed'))).toEqual(['no', 'yes', 'yes', 'no']);
    expect(diffs[1]).toHaveTextContent('$1,235.00'); expect(diffs[1]).toHaveTextContent('$1,500.00');
    expect(api.alertUpdate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('bzx-edit-confirm'));
    expect(await screen.findByText('Alert “test” saved.')).toBeInTheDocument();
    expect(api.alertUpdate).toHaveBeenCalledWith('a1', { title: 'test', threshold: 150000, preset: 'quarter', minSampleSize: 5 });
    fireEvent.click(screen.getByTestId('bzx-a-dup'));
    expect(await screen.findByText(/Copy of “test” created/)).toBeInTheDocument();
    expect(api.alertCreate).toHaveBeenCalledWith({ title: 'Copy of test', metricId: 'average_ticket', operator: 'gt', threshold: 123500, preset: 'today', minSampleSize: 5 });
    expect(api.alertUpdate).toHaveBeenCalledWith('a2', { active: false });
    fireEvent.click(screen.getByTestId('bzx-a-hist'));
    expect(await screen.findByTestId('bzx-h-one')).toHaveTextContent('Showing only “test”');
    expect(c.history).toHaveBeenLastCalledWith(expect.objectContaining({ alertId: 'a1' }));
  });
  it('a failed evaluation shows its reason, never a value', async () => {
    c.history.mockResolvedValue({ items: [{ ...EV, id: 'e9', stateChange: 'failed', value: null, sampleOk: false, triggered: false, reason: 'Could not read the numbers: reports unavailable' }], total: 1, page: 1, pageSize: 25, totalPages: 1, period: { today: '2026-11-03' } });
    wrap();
    expect(await screen.findByText('Could not read the numbers: reports unavailable')).toBeInTheDocument();
  });

  it('incidents: the list opens an incident; Resolve needs a note and sends the version; the delivery log says why a text was held', async () => {
    c.incidentAction.mockResolvedValue({ eventId: 'e1', incidentStatus: 'resolved', version: 2 });
    wrap();
    fireEvent.click(await screen.findByTestId('bzx-i-open'));
    const dlg = await screen.findByTestId('bzx-incident');
    expect(dlg).toHaveTextContent('Quiet hours');
    expect(dlg).toHaveTextContent('Notified: 1 sent, 1 skipped, 0 failed.');
    expect(screen.getByTestId('bzx-i-resolve')).toBeDisabled();
    await screen.findByRole('option', { name: 'Manager Lee' });
    fireEvent.change(screen.getByTestId('bzx-i-assignee'), { target: { value: 'u2' } });
    fireEvent.click(screen.getByTestId('bzx-i-assign'));
    await vi.waitFor(() => expect(c.incidentAction).toHaveBeenCalledWith('e1', expect.objectContaining({ action: 'assign', assigneeUserId: 'u2' })));
    await vi.waitFor(() => expect(c.incident).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(screen.getByTestId('bzx-i-assign')).toBeDisabled());
    fireEvent.change(screen.getByTestId('bzx-i-note'), { target: { value: 'busy day, fine' } });
    await vi.waitFor(() => expect(screen.getByTestId('bzx-i-resolve')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('bzx-i-resolve'));
    await vi.waitFor(() => expect(c.incidentAction).toHaveBeenCalledWith('e1', expect.objectContaining({ action: 'resolve', expectedVersion: 1, note: 'busy day, fine' })));
  });
  it('extras AI BUSINESS ALERTS 05: an incident unread for me is marked; opening it marks only MY read (no incident action)', async () => {
    reads.markAlertsReadEverywhere.mockResolvedValue({ marked: 1, unread: 0, lifecycleChanged: false });
    c.incidents.mockResolvedValueOnce({ status: 'active', page: 1, limit: 25, total: 1, counts: { open: 1 }, items: [{ ...INC, readState: { unread: true, unreadAlertIds: ['oa1'] } }] })
      .mockResolvedValue({ status: 'active', page: 1, limit: 25, total: 1, counts: { open: 1 }, items: [{ ...INC, readState: { unread: false, unreadAlertIds: [] } }] });
    wrap();
    expect(await screen.findByTestId('bzx-i-unread')).toHaveTextContent('Unread');
    fireEvent.click(screen.getByTestId('bzx-i-open'));
    await screen.findByTestId('bzx-incident');
    expect(reads.markAlertsReadEverywhere).toHaveBeenCalledWith(['oa1']);
    await waitFor(() => expect(screen.queryByTestId('bzx-i-unread')).toBeNull());
    expect(c.incidentAction).not.toHaveBeenCalled();                    // reading is not acknowledging
    expect(screen.getByTestId('bzx-incident')).toBeInTheDocument();
  });
  it('an incident already read (or with no in-app alert) sends no read', async () => {
    wrap();
    fireEvent.click(await screen.findByTestId('bzx-i-open'));
    await screen.findByTestId('bzx-incident');
    expect(screen.queryByTestId('bzx-i-unread')).toBeNull();
    expect(reads.markAlertsReadEverywhere).not.toHaveBeenCalled();
  });
  it('Notifications: channels, recipients, quiet hours and cooldown are saved for the rule; no channel is refused', async () => {
    c.alertSetDelivery.mockResolvedValue({});
    wrap();
    fireEvent.click(await screen.findByTestId('bzx-a-notify'));
    await screen.findByTestId('bzx-delivery');
    fireEvent.click(await screen.findByTestId('bzx-d-ch-sms'));
    fireEvent.change(screen.getByTestId('bzx-d-severity'), { target: { value: 'critical' } });
    fireEvent.click(screen.getAllByTestId('bzx-d-rcpt')[0]);
    expect(screen.getByTestId('bzx-delivery')).toHaveTextContent('no mobile number');
    fireEvent.click(screen.getByTestId('bzx-d-save'));
    await vi.waitFor(() => expect(c.alertSetDelivery).toHaveBeenCalledWith('a1', { severity: 'critical', channels: ['in_app', 'sms'], recipientUserIds: ['u1'], quietHoursStart: 21, quietHoursEnd: 8, cooldownMinutes: 60 }));
  });
  it('extras 08 — SMS budget: the server plan for the saved settings (recipients, segments, cost, sender, limits, loop guards, warnings); a change says save to update; read-only', async () => {
    const plan = { recipients: 2, recipientsWithPhone: 1, recipientsWithoutPhone: 1, segmentsPerMessage: 1, encoding: 'GSM-7', segmentsPerTrigger: 1, costBasis: 'salon_provider_average_30d', perSegmentMicros: 7900,
      estimatedCostCentsPerTrigger: 1, senderConfigured: true, senderValidatedAt: '2026-11-03T14:00:00Z', limits: { dailyLimit: 50, monthlySms: null, enforcement: 'hard', active: true },
      loopGuards: { cooldownMinutes: 0, escalateOnceAfterMinutes: 30, quietHours: true, sentByRuleLast24h: 4, alertSmsSentLast24h: 9 }, warnings: ['no_cooldown'] };
    c.alertDelivery.mockResolvedValue({ ...DELIVERY, channels: ['in_app', 'sms'], cooldownMinutes: 0, smsPlan: plan });
    wrap();
    fireEvent.click(await screen.findByTestId('bzx-a-notify'));
    const p = await screen.findByTestId('bzx-sms-plan');
    expect(screen.getByTestId('bzx-sp-recipients')).toHaveTextContent('Texts per trigger: 1 of 2 recipients have a mobile number');
    expect(screen.getByTestId('bzx-sp-segments')).toHaveTextContent('1 segment(s) per text · 1 segment(s) per trigger');
    expect(screen.getByTestId('bzx-sp-cost')).toHaveTextContent('Estimated cost per trigger: $0.01');
    expect(screen.getByTestId('bzx-sp-sender')).toHaveTextContent('SMS sender: set up (last checked');
    expect(screen.getByTestId('bzx-sp-limits')).toHaveTextContent('Salon text limits: 50 per day · no limit per month · blocks extra texts');
    expect(screen.getByTestId('bzx-sp-guards')).toHaveTextContent('Loop guards: No cooldown · one escalation after 30 min · quiet hours on');
    expect(screen.getByTestId('bzx-sp-sent')).toHaveTextContent('SMS sent by this alert in the last 24 hours: 4 (all alerts: 9)');
    expect(screen.getByTestId('bzx-sp-w-no_cooldown')).toHaveTextContent('every time this alert triggers it texts again');
    expect(screen.queryByTestId('bzx-sp-dirty')).toBeNull();
    fireEvent.change(screen.getByTestId('bzx-d-cooldown'), { target: { value: '60' } });
    expect(await screen.findByTestId('bzx-sp-dirty')).toHaveTextContent('save to update this estimate');
    expect(p).toBeInTheDocument();
    expect(c.alertSetDelivery).not.toHaveBeenCalled();
  });
  it('extras 08 — SMS budget: no reported provider cost reads "—", a missing sender is said plainly; SMS off and not saved → no panel', async () => {
    const plan = { recipients: 1, recipientsWithPhone: 0, recipientsWithoutPhone: 1, segmentsPerMessage: 2, encoding: 'UCS-2', segmentsPerTrigger: 0, perSegmentMicros: null, estimatedCostCentsPerTrigger: null,
      senderConfigured: false, senderValidatedAt: null, limits: null, loopGuards: { cooldownMinutes: 60, escalateOnceAfterMinutes: 30, quietHours: false, sentByRuleLast24h: 0, alertSmsSentLast24h: 0 }, warnings: ['no_phone_recipients', 'sender_not_configured'] };
    c.alertDelivery.mockResolvedValue({ ...DELIVERY, smsPlan: plan });
    wrap();
    fireEvent.click(await screen.findByTestId('bzx-a-notify'));
    await screen.findByTestId('bzx-delivery');
    expect(screen.queryByTestId('bzx-sms-plan')).toBeNull();
    fireEvent.click(screen.getByTestId('bzx-d-ch-sms'));
    await screen.findByTestId('bzx-sms-plan');
    expect(screen.getByTestId('bzx-sp-cost')).toHaveTextContent('Estimated cost per trigger: — (your provider has not reported a cost in the last 30 days)');
    expect(screen.getByTestId('bzx-sp-sender')).toHaveTextContent('SMS sender: not set up');
    expect(screen.getByTestId('bzx-sp-limits')).toHaveTextContent('Salon text limits: none set');
    expect(screen.getByTestId('bzx-sp-w-no_phone_recipients')).toBeInTheDocument();
    expect(screen.getByTestId('bzx-sp-w-sender_not_configured')).toBeInTheDocument();
    expect(screen.getByTestId('bzx-sp-dirty')).toBeInTheDocument();
  });
  it('Saved workspace: the rules search comes back after leaving and returning (same tab)', async () => {
    const v = wrap();
    fireEvent.change(await screen.findByTestId('bzx-a-search'), { target: { value: 'ticket' } });
    fireEvent.submit(screen.getByTestId('bzx-a-search').closest('form')!);
    await waitFor(() => expect(c.rules).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'ticket' })));
    v.unmount(); c.rules.mockClear();
    wrap();
    expect((await screen.findByTestId('bzx-a-search') as HTMLInputElement).value).toBe('ticket');
    await waitFor(() => expect(c.rules).toHaveBeenCalledWith(expect.objectContaining({ q: 'ticket' })));
  });
});

describe('AI Business Alerts — rule change comparison (extras #07)', () => {
  it('no change → Confirm stays off and says nothing changed; editing a field again returns to the form', async () => {
    wrap();
    fireEvent.click(await screen.findByTestId('bzx-a-edit'));
    fireEvent.click(screen.getByTestId('bzx-edit-save'));
    expect(await screen.findByTestId('bzx-edit-compare')).toHaveTextContent('Nothing changed');
    expect(screen.getByTestId('bzx-edit-confirm')).toBeDisabled();
    fireEvent.change(screen.getByTestId('bzx-edit-min'), { target: { value: '9' } });
    expect(screen.queryByTestId('bzx-edit-compare')).toBeNull();
    expect(screen.getByTestId('bzx-edit-save')).toBeInTheDocument();
    expect(api.alertUpdate).not.toHaveBeenCalled();
  });
});
