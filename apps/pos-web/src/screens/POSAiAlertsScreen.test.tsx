// POSAiAlertsScreen — AI Business Alerts guide (Nov 3 2026): the New Alert row and rule table stay; Evaluate now is recorded with what
// changed; history with acknowledgement and explanation; Delete asks first; honest about no automatic evaluation / delivery.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { c, api } = vi.hoisted(() => {
  const c = { alertSummary: vi.fn(), rules: vi.fn(), history: vi.fn(), evaluate: vi.fn(), acknowledge: vi.fn(), explain: vi.fn(), anomaly: vi.fn(), alertCheck: vi.fn() };
  return { c, api: { center: c, alertCreate: vi.fn(), alertUpdate: vi.fn(), alertDelete: vi.fn() } };
});
vi.mock('../api/posAiBusinessApi', () => ({ posAiBusinessApi: api }));
import { POSAiAlertsScreen } from './POSAiAlertsScreen';
const RULE = { id: 'a1', title: 'test', metricId: 'average_ticket', operator: 'gt', threshold: 123500, preset: 'today', minSampleSize: 5, active: true, createdBy: 'Owner Kim',
  latest: { id: 'e1', triggered: true, sampleOk: true, value: 130000, stateChange: 'triggered', evaluatedAt: '2026-11-03T15:00:00Z', acknowledgedAt: null } };
const EV = { id: 'e1', alertId: 'a1', title: 'test', metricId: 'average_ticket', operator: 'gt', threshold: 123500, value: 130000, sampleSize: 8, minSampleSize: 5, sampleOk: true, triggered: true,
  stateChange: 'triggered', periodFrom: '2026-11-03', periodTo: '2026-11-03', evaluatedAt: '2026-11-03T15:00:00Z', acknowledgedAt: null };
const wrap = () => render(<MemoryRouter><POSAiAlertsScreen /></MemoryRouter>);
beforeEach(() => {
  vi.clearAllMocks();
  c.alertSummary.mockResolvedValue({ activeRules: 2, pausedRules: 0, triggeredUnacknowledged: 1, needsReview: 0, neverEvaluated: 1, lastEvaluatedAt: '2026-11-03T15:00:00Z', automaticEvaluation: false });
  c.rules.mockResolvedValue({ items: [RULE], total: 1, page: 1, pageSize: 25, totalPages: 1 });
  c.history.mockResolvedValue({ items: [EV], total: 1, page: 1, pageSize: 25, totalPages: 1, period: { today: '2026-11-03' } });
});

describe('POSAiAlertsScreen', () => {
  it('keeps the rule table and says rules are evaluated by hand; nothing is sent', async () => {
    wrap();
    const row = await screen.findByTestId('bzx-a-row');
    expect(row).toHaveTextContent('Average ticket rises above $1,235.00');
    expect(row).toHaveTextContent('minimum sample 5');
    expect(row).toHaveTextContent('Triggered');
    expect(screen.getByTestId('bzx-a-manual')).toHaveTextContent('Automatic evaluation and SMS / email delivery are not set up yet');
    expect(screen.getByTestId('bzx-a-triggered')).toHaveTextContent('1');
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
});
