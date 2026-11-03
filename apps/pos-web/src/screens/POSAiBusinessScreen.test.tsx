import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { askMock, savedListMock, savedCreateMock, savedDeleteMock, savedUseMock } = vi.hoisted(() => ({
  askMock: vi.fn(), savedListMock: vi.fn(), savedCreateMock: vi.fn(), savedDeleteMock: vi.fn(), savedUseMock: vi.fn(),
}));
vi.mock('../api/posAiBusinessApi', () => ({ posAiBusinessApi: { ask: askMock, savedList: savedListMock, savedCreate: savedCreateMock, savedDelete: savedDeleteMock, savedUse: savedUseMock } }));
import { POSAiBusinessScreen } from './POSAiBusinessScreen';

beforeEach(() => {
  askMock.mockReset();
  savedListMock.mockReset().mockResolvedValue([]);
  savedCreateMock.mockReset().mockResolvedValue({});
  savedDeleteMock.mockReset().mockResolvedValue({ deleted: true });
  savedUseMock.mockReset().mockResolvedValue({});
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
});
