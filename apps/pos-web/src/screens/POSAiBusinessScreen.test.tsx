import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { askMock, savedListMock, savedCreateMock, savedDeleteMock, savedUseMock } = vi.hoisted(() => ({
  askMock: vi.fn(), savedListMock: vi.fn(), savedCreateMock: vi.fn(), savedDeleteMock: vi.fn(), savedUseMock: vi.fn(),
}));
const { revMock, apptMock, center } = vi.hoisted(() => ({ revMock: vi.fn(), apptMock: vi.fn(), center: { assistantHistory: vi.fn(), assistantHistoryDelete: vi.fn(), assistantCheck: vi.fn() } }));
vi.mock('../api/posAiBusinessApi', () => ({ posAiBusinessApi: { ask: askMock, savedList: savedListMock, savedCreate: savedCreateMock, savedDelete: savedDeleteMock, savedUse: savedUseMock, revenueSummary: revMock, appointmentMetrics: apptMock, center } }));
import { POSAiBusinessScreen } from './POSAiBusinessScreen';

beforeEach(() => {
  try { sessionStorage.clear(); } catch { /* jsdom */ }
  askMock.mockReset();
  savedListMock.mockReset().mockResolvedValue([]);
  revMock.mockReset().mockResolvedValue({ netSalesCents: 120000, ticketsCount: 30 });
  apptMock.mockReset().mockResolvedValue({ funnel: { completed: 28 } });
  savedCreateMock.mockReset().mockResolvedValue({});
  savedDeleteMock.mockReset().mockResolvedValue({ deleted: true });
  savedUseMock.mockReset().mockResolvedValue({});
  center.assistantHistory.mockReset().mockResolvedValue({ page: 1, limit: 10, total: 1, totalPages: 1, retentionDays: 365,
    items: [{ id: 'h1', question: 'How can we grow?', intent: 'growth_advice', preset: 'month', period: { from: '2026-11-01', to: '2026-11-06' }, answer: 'Try reminders.', answeredBy: 'ai', at: '2026-11-06T15:00:00Z' }] });
  center.assistantHistoryDelete.mockReset().mockResolvedValue({ ok: true });
});
const renderScreen = () => render(<MemoryRouter><POSAiBusinessScreen /></MemoryRouter>);

describe('POSAiBusinessScreen', () => {
  it('runs an intent chip and renders the answer, key numbers, freshness and drilldown', async () => {
    askMock.mockResolvedValue({
      ok: true, needsClarification: false, intent: 'revenue_summary', toolUsed: 'get_revenue_summary',
      answer: 'Net sales are $842.00 for today.',
      structured: { netSalesCents: 84200, averageTicketCents: 2100, ticketsCount: 40, freshnessClass: 'near_realtime', evidence: { drilldownRoute: '/tenant/reports/sales' }, notes: ['Figures cover an incomplete current day and are partial.'] },
      access: { allowed: true, reason: 'ok', label: 'OK' },
    });
    renderScreen();
    fireEvent.click(screen.getByText('Revenue summary'));
    expect(await screen.findByText('Net sales are $842.00 for today.')).toBeInTheDocument();
    expect(screen.getByText('$842.00')).toBeInTheDocument();      // net sales key number
    expect(screen.getByText(/near realtime/i)).toBeInTheDocument(); // freshness label
    expect(screen.getByText(/View the supporting report/)).toBeInTheDocument();
    expect(askMock).toHaveBeenCalledWith({ intent: 'revenue_summary', preset: 'today' });
  });

  it('a revenue comparison states the periods compared, the calculation basis and that revenue is not profit', async () => {
    askMock.mockResolvedValue({
      ok: true, needsClarification: false, intent: 'explain_revenue', toolUsed: 'explain_revenue_change', answer: 'Up 10%.',
      structured: { currentNetCents: 110000, previousNetCents: 100000, changeCents: 10000, changePercent: 10, contributors: [], caveats: [], evidence: { metricId: 'net_sales', definition: 'x', preset: 'week', compareWindow: 'previous', partialCurrentPeriod: false } },
      access: { allowed: true, reason: 'ok', label: 'OK' },
    });
    renderScreen();
    fireEvent.click(screen.getByText('Why did revenue change?'));
    const basis = await screen.findByTestId('aib-compare-basis');
    expect(screen.getByTestId('aib-compare-periods').textContent).toMatch(/This week vs the period before This week/i);
    expect(screen.getByTestId('aib-compare-def').textContent).toMatch(/discounts, refunds and voids/);
    expect(basis.textContent).toMatch(/not profit/);
  });
  it('extras row 04: after an answer, related read-only questions are offered (never the one just asked); tapping one asks that intent for the same period', async () => {
    askMock.mockResolvedValueOnce({ ok: true, needsClarification: false, intent: 'revenue_summary', toolUsed: 'get_revenue_summary', answer: 'Net sales steady.', structured: null, access: { allowed: true } })
      .mockResolvedValueOnce({ ok: true, needsClarification: false, intent: 'profit_expenses', toolUsed: 'profit', answer: 'Profit view.', structured: null, access: { allowed: true } });
    renderScreen();
    expect(screen.queryByTestId('aib-related')).toBeNull();
    fireEvent.click(screen.getByText('Revenue summary'));
    const box = await screen.findByTestId('aib-related');
    expect(box.querySelectorAll('button')).toHaveLength(3);
    expect(screen.queryByTestId('aib-related-revenue_summary')).toBeNull();
    expect(screen.getByTestId('aib-related-explain_revenue')).toHaveTextContent('Why did revenue change?');
    expect(box.textContent).toMatch(/never sends messages, charges or changes anything/);
    fireEvent.click(screen.getByTestId('aib-related-profit_expenses'));
    await screen.findByText('Profit view.');
    expect(askMock).toHaveBeenLastCalledWith({ intent: 'profit_expenses', preset: 'today' });
    expect(screen.getByTestId('aib-related-revenue_summary')).toBeInTheDocument();   // the new answer's own related set
  });
  it('extras row 08: Summary first shows the first two sentences with Show full answer; the full answer comes back and nothing else is hidden', async () => {
    sessionStorage.removeItem('aps.bza.brief');
    const long = 'Net sales are $842.00 today. That is 12% above last Friday. Gel services led the gain. Two technicians were off, so walk-ins waited longer.';
    askMock.mockResolvedValue({ ok: true, needsClarification: false, intent: 'revenue_summary', toolUsed: 'get_revenue_summary', answer: long, structured: { netSalesCents: 84200 }, access: { allowed: true } });
    renderScreen();
    fireEvent.click(screen.getByText('Revenue summary'));
    expect(await screen.findByTestId('aib-answer-text')).toHaveTextContent(long);   // off by default: the whole answer
    fireEvent.click(screen.getByTestId('aib-brief'));
    expect(screen.getByTestId('aib-answer-text').textContent).toBe('Net sales are $842.00 today. That is 12% above last Friday.');
    expect(screen.getByText('$842.00')).toBeInTheDocument();                         // the key numbers stay
    fireEvent.click(screen.getByTestId('aib-expand'));
    expect(screen.getByTestId('aib-answer-text').textContent).toBe(long);
    fireEvent.click(screen.getByTestId('aib-collapse'));
    expect(screen.getByTestId('aib-expand')).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem('aps.bza.brief') ?? 'false')).toBe(true);   // kept for this tab
    sessionStorage.removeItem('aps.bza.brief');
  });
  it('extras row 08: a short answer has nothing to expand in Summary first', async () => {
    sessionStorage.setItem('aps.bza.brief', 'true');
    askMock.mockResolvedValue({ ok: true, needsClarification: false, intent: 'revenue_summary', toolUsed: 't', answer: 'Steady day.', structured: null, access: { allowed: true } });
    renderScreen();
    fireEvent.click(screen.getByText('Revenue summary'));
    expect(await screen.findByTestId('aib-answer-text')).toHaveTextContent('Steady day.');
    expect(screen.queryByTestId('aib-expand')).toBeNull();
    sessionStorage.removeItem('aps.bza.brief');
  });
  it('a summary without a comparison shows no comparison basis', async () => {
    askMock.mockResolvedValue({ ok: true, needsClarification: false, intent: 'revenue_summary', toolUsed: 't', answer: 'ok', structured: { netSalesCents: 1, evidence: { metricId: 'net_sales', preset: 'today' } }, access: null });
    renderScreen();
    fireEvent.click(screen.getByText('Revenue summary'));
    await screen.findByText('ok');
    expect(screen.queryByTestId('aib-compare-basis')).toBeNull();
  });
  it('degrades to metrics-only when the AI package is unavailable', async () => {
    askMock.mockResolvedValue({
      ok: false, needsClarification: false, intent: 'revenue_summary', toolUsed: 'get_revenue_summary',
      answer: null, structured: { netSalesCents: 5000, freshnessClass: 'near_realtime' },
      access: { allowed: false, reason: 'not_subscribed', label: 'Not subscribed' },
    });
    renderScreen();
    fireEvent.click(screen.getByText('Revenue summary'));
    expect(await screen.findByText(/AI explanation is unavailable/)).toBeInTheDocument();
    expect(screen.getByText('$50.00')).toBeInTheDocument(); // numbers still shown
  });

  it('shows clarification suggestions when the question is ambiguous', async () => {
    askMock.mockResolvedValue({ ok: true, needsClarification: true, intent: null, toolUsed: null, answer: null, structured: null, access: null, suggestions: ['Summarize today', 'Why did revenue change?'] });
    renderScreen();
    const input = screen.getByPlaceholderText('Ask a business question…');
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.click(screen.getByText('Ask'));
    expect(await screen.findByText('Which would you like?')).toBeInTheDocument();
    // The label also exists as a chip above, so both the chip and the suggestion button are present.
    expect(screen.getAllByText('Why did revenue change?').length).toBeGreaterThanOrEqual(2);
  });

  it('shows an error state when the request fails', async () => {
    askMock.mockImplementationOnce(() => Promise.reject({ status: 403 }));
    renderScreen();
    fireEvent.click(screen.getByText('Summarize today'));
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
  });

  it('renders saved questions and runs one via its stored intent', async () => {
    savedListMock.mockResolvedValue([
      { id: 'sq1', title: 'Morning brief', intent: 'daily_summary', preset: 'today', comparePreset: null, question: null, sharingScope: 'private', ownedByMe: true, createdAt: '2026-07-01T00:00:00Z', lastUsedAt: null },
    ]);
    askMock.mockResolvedValue({ ok: true, needsClarification: false, intent: 'daily_summary', toolUsed: 'get_daily_operations_summary', answer: 'Today looks steady.', structured: { revenue: { available: true, netSalesCents: 1000 } }, access: { allowed: true, reason: 'ok', label: 'OK' } });
    renderScreen();
    const chip = await screen.findByText('Morning brief');
    fireEvent.click(chip);
    await waitFor(() => expect(askMock).toHaveBeenCalledWith({ intent: 'daily_summary', question: undefined, preset: 'today', comparePreset: undefined }));
    expect(await screen.findByText('Today looks steady.')).toBeInTheDocument();
    await waitFor(() => expect(savedUseMock).toHaveBeenCalledWith('sq1'));
  });
  it('Nov 3 audit: a saved question replays with ITS saved period, not the selected tab', async () => {
    savedListMock.mockResolvedValue([
      { id: 'sq2', title: 'Monthly revenue', intent: 'revenue_summary', preset: 'month', comparePreset: null, question: null, sharingScope: 'private', ownedByMe: true, createdAt: '2026-07-01T00:00:00Z', lastUsedAt: null },
    ]);
    askMock.mockResolvedValue({ ok: true, needsClarification: false, intent: 'revenue_summary', toolUsed: 'get_revenue_summary', answer: 'Month so far.', structured: null, access: { allowed: true, reason: 'ok', label: 'OK' } });
    renderScreen();
    fireEvent.click(await screen.findByText('Monthly revenue'));
    await waitFor(() => expect(askMock).toHaveBeenCalledWith({ intent: 'revenue_summary', question: undefined, preset: 'month', comparePreset: undefined }));
  });
  it('guide: the period snapshot shows before any question; Shift+Enter is a new line, Enter asks; a failure offers Try again', async () => {
    renderScreen();
    const snap = await screen.findByTestId('aib-snapshot');
    await waitFor(() => expect(snap).toHaveTextContent('$1,200.00'));
    expect(snap).toHaveTextContent('$40.00');                                    // net ÷ tickets
    fireEvent.click(screen.getByTestId('aib-preset-quarter'));
    await waitFor(() => expect(revMock).toHaveBeenLastCalledWith('quarter'));
    askMock.mockRejectedValueOnce({ status: 500 }).mockResolvedValueOnce({ ok: true, needsClarification: false, intent: 'revenue_summary', answer: 'Steady quarter.', structured: null, access: { allowed: true } });
    const box = screen.getByTestId('aib-composer');
    fireEvent.change(box, { target: { value: 'How is the quarter?' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(askMock).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.click(await screen.findByTestId('aib-retry'));
    expect(await screen.findByText('Steady quarter.')).toBeInTheDocument();
    expect(askMock).toHaveBeenLastCalledWith({ question: 'How is the quarter?', preset: 'quarter' });
  });

  it('A4: the stored history lists past questions (only yours), Ask again replays them; record search shows links and says nothing goes to the AI', async () => {
    askMock.mockResolvedValue({ ok: true, needsClarification: false, intent: 'find_record', toolUsed: 'find_record', answer: null, access: null, records: { customers: 1, tickets: 0 },
      structured: { query: { kind: 'name', term: 'Lan' }, hidden: [], tickets: [], customers: [{ id: 'c1', name: 'Lan Nguyễn', route: '/customers?q=Lan&customerId=c1' }] } });
    renderScreen();
    const hist = await screen.findByTestId('aib-history');
    expect(hist).toHaveTextContent('How can we grow?');
    expect(hist).toHaveTextContent('Only you see your history. Questions are kept for 365 days.');
    fireEvent.change(screen.getByTestId('aib-composer'), { target: { value: 'find Lan' } });
    fireEvent.keyDown(screen.getByTestId('aib-composer'), { key: 'Enter' });
    const rec = await screen.findByTestId('aib-records');
    expect(rec).toHaveTextContent('Lan Nguyễn');
    expect(rec).toHaveTextContent('never sent to the AI');
    fireEvent.click(screen.getAllByTestId('aib-h-replay')[0]);
    await waitFor(() => expect(askMock).toHaveBeenLastCalledWith({ intent: 'growth_advice', question: 'How can we grow?', preset: 'month' }));
  });
  it('Session-safe workspace: the typed question comes back after browsing away (same tab)', async () => {
    const v = renderScreen();
    fireEvent.change(await screen.findByTestId('aib-composer'), { target: { value: 'Why were Tuesdays slow?' } });
    v.unmount();
    renderScreen();
    expect((await screen.findByTestId('aib-composer') as HTMLTextAreaElement).value).toBe('Why were Tuesdays slow?');
  });
});
