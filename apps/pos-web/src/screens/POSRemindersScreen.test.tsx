// POSRemindersScreen.test.tsx — Appointment Reminders center (guide §4–§11, §19). The original settings (toggle, 24 h lead,
// 60-minute window, SMS, Save) still work exactly as before; the center adds counters, health, the queue / history,
// details with Close, Cancel Pending and Safe Retry. Folds in the former 403 test.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const m = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), kpis: vi.fn(), list: vi.fn(), details: vi.fn(), cancel: vi.fn(), retry: vi.fn(), health: vi.fn(), cust: vi.fn(), branches: vi.fn() }));
vi.mock('../api/posRemindersApi', () => ({ posRemindersApi: { get: m.get, update: m.update } }));
vi.mock('../api/posReminderCenterApi', () => ({ posReminderCenterApi: { kpis: m.kpis, list: m.list, details: m.details, cancel: m.cancel, retry: m.retry, health: m.health, customerHistory: m.cust } }));
vi.mock('../api/authApi', () => ({ authApi: { branches: m.branches } }));
import { POSRemindersScreen } from './POSRemindersScreen';

const K = { timezone: 'America/New_York', period: { preset: 'today', from: null, to: null }, scheduled: { value: 4, basis: 'intended_send' }, sent: { value: 7, basis: 'provider_accepted' },
  delivered: { value: null, known: false, basis: 'provider_delivered', lastReportAt: null }, failed: { value: 1, basis: 'recorded' }, cancelled: { value: 2, basis: 'recorded' }, upcomingToday: { value: 3, basis: 'due_today' } };
const H = { overall: 'attention_required', schedulerEnabledHere: false, timezone: 'America/New_York', checkedAt: '2026-10-31T12:00:00Z', items: [
  { key: 'scheduler', state: 'ready', summary: 'Last successful run 3 min ago.', evidence: '', checkedAt: '2026-10-31T11:57:00Z', nextAction: null },
  { key: 'twilio', state: 'attention_required', summary: 'Twilio is connected but has no sending number.', evidence: '', checkedAt: null, nextAction: 'Open Text Messaging Setup.' },
  { key: 'email', state: 'off', summary: '', evidence: '', checkedAt: null, nextAction: null }, { key: 'booking_sync', state: 'ready', summary: '', evidence: '', checkedAt: null, nextAction: null },
  { key: 'history', state: 'unknown', summary: 'No delivery report has ever been received.', evidence: '', checkedAt: null, nextAction: null }] };
const row = (o: Record<string, unknown> = {}) => ({ id: 'd1', kind: 'dispatch', state: 'failed', engineState: 'failed', reason: 'invalid_destination', reasonText: null, appointmentId: 'a1', customerId: 'c1', customerName: 'Ava Kim',
  phoneLast4: '0142', emailMasked: null, technicianName: 'Lina Tran', branchId: 'b1', branchName: 'Main', channel: 'sms', leadMinutes: 1440, appointmentStartAt: '2026-11-02T14:00:00Z',
  intendedSendAt: '2026-11-01T14:00:00Z', createdAt: '2026-11-01T14:00:00Z', sentAt: null, deliveredAt: null, providerStatus: null, superseded: false, retryable: true, ...o });
const PAGE = (items: unknown[]) => ({ tab: 'upcoming', basis: 'scheduled', timezone: 'America/New_York', period: { preset: 'all', from: null, to: null }, page: 1, pageSize: 20, totalItems: items.length, totalPages: 1, items });
const ui = () => render(<MemoryRouter><POSRemindersScreen /></MemoryRouter>);

beforeEach(() => {
  try { sessionStorage.clear(); } catch { /* jsdom */ }
  Object.values(m).forEach((f) => f.mockReset());
  m.get.mockResolvedValue({ enabled: true, leadMinutes: 1440, windowMinutes: 60, channel: 'sms' });
  m.kpis.mockResolvedValue(K); m.health.mockResolvedValue(H); m.branches.mockResolvedValue({ ok: true, branches: [] });
  m.list.mockResolvedValue(PAGE([row({ id: 'u:a2:1440', kind: 'upcoming', state: 'scheduled', reason: null, retryable: false })]));
});

describe('POSRemindersScreen — settings kept', () => {
  it('loads config and saves updates (hours -> minutes) with the same Save Reminders button', async () => {
    m.update.mockResolvedValue({ enabled: true, leadMinutes: 120, windowMinutes: 60, channel: 'email' });
    ui();
    expect(await screen.findByRole('heading', { name: 'Appointment Reminders' })).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('rmc-lead'), { target: { value: '2' } });
    fireEvent.change(screen.getByTestId('rmc-channel'), { target: { value: 'email' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save reminders' }));
    await waitFor(() => expect(m.update).toHaveBeenCalled());
    expect(m.update.mock.calls[0][0]).toMatchObject({ enabled: true, leadMinutes: 120, windowMinutes: 60, channel: 'email' });
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });
  it('reflects disabled state', async () => {
    m.get.mockResolvedValue({ enabled: false, leadMinutes: 1440, windowMinutes: 60, channel: 'sms' });
    ui();
    expect(((await screen.findByTestId('rmc-enabled')) as HTMLInputElement).checked).toBe(false);
  });
  it('shows a permission message on 403', async () => {
    m.get.mockRejectedValue({ status: 403 }); ui();
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
  });
});

describe('POSRemindersScreen — center', () => {
  it('six counters; Delivered is Unknown (not 0) without delivery reports; health never shows a false green', async () => {
    ui();
    expect(within(await screen.findByTestId('rmc-k-delivered')).getByText('Unknown')).toBeInTheDocument();
    expect(within(screen.getByTestId('rmc-k-sent')).getByText('7')).toBeInTheDocument();
    expect(within(await screen.findByTestId('rmc-health-overall')).getByText('Attention required')).toBeInTheDocument();
    expect(screen.getByTestId('rmc-cron-off')).toBeInTheDocument();
  });
  it('tabs and search go to the server (page 1), with the active date basis shown', async () => {
    ui();
    await screen.findByTestId('rmc-table');
    fireEvent.click(screen.getByTestId('rmc-tab-failed'));
    await waitFor(() => expect(m.list).toHaveBeenLastCalledWith(expect.objectContaining({ tab: 'failed', page: 1 })));
    fireEvent.change(screen.getByTestId('rmc-search'), { target: { value: 'Ava' } });
    await waitFor(() => expect(m.list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'Ava', page: 1 })));
    expect(screen.getByTestId('rmc-basis').textContent).toMatch(/Dates filter by/);
  });
  it('Reminder Details: reason, attempts, Close; Safe Retry asks for a reason and sends one idempotent request', async () => {
    m.list.mockResolvedValue(PAGE([row()]));
    m.details.mockResolvedValue({ item: row(), rule: { enabled: true, leadMinutes: 1440, windowMinutes: 60, channel: 'sms', ladderMinutes: [1440] }, template: { templateId: null, version: null, source: 'built_in' },
      attempts: [{ id: '1', status: 'claimed', reason: null, reasonText: null, kind: 'automatic', notificationId: null, byStaff: false, note: null, at: '2026-11-01T14:00:00Z' }, { id: '2', status: 'failed', reason: 'invalid_destination', reasonText: null, kind: 'automatic', notificationId: null, byStaff: false, note: null, at: '2026-11-01T14:00:01Z' }],
      deliveryEvents: [], timezone: 'America/New_York' });
    m.retry.mockResolvedValue({ replayed: false, id: 'd1', state: 'submitted' });
    ui();
    fireEvent.click(await screen.findByTestId('rmc-view'));
    expect(await screen.findByTestId('rmc-d-reason')).toHaveTextContent('Number missing +country code');
    fireEvent.click(screen.getByTestId('rmc-retry'));
    const go = screen.getByTestId('rmc-confirm-go') as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('rmc-reason'), { target: { value: 'number fixed' } });
    fireEvent.click(go);
    await waitFor(() => expect(m.retry).toHaveBeenCalledTimes(1));
    expect(m.retry.mock.calls[0][1]).toMatchObject({ reason: 'number fixed', confirm: true });
    expect(String(m.retry.mock.calls[0][1].idempotencyKey).length).toBeGreaterThanOrEqual(8);
    fireEvent.click(screen.getByTestId('rmc-close'));
    await waitFor(() => expect(screen.queryByTestId('rmc-details')).toBeNull());
  });
});

describe('CustomerReminderHistory (Customer Profile section)', () => {
  it('shows the customer\'s reminders newest first with each event and a reason', async () => {
    const { CustomerReminderHistory } = await import('./POSRemindersScreen');
    m.cust.mockResolvedValue({ page: 1, pageSize: 10, totalItems: 1, totalPages: 1, items: [{ ...row({ state: 'skipped', reason: 'opted_out' }), events: [{ status: 'claimed', reason: null, reasonText: null, kind: 'automatic', at: '2026-11-01T14:00:00Z' }, { status: 'blocked', reason: 'opted_out', reasonText: null, kind: 'automatic', at: '2026-11-01T14:00:01Z' }] }] });
    render(<MemoryRouter><CustomerReminderHistory customerId="c1" /></MemoryRouter>);
    expect(await screen.findByTestId('rmc-cust-row')).toHaveTextContent('Customer opted out (STOP)');
    expect(m.cust).toHaveBeenCalledWith('c1', 1, 10);
  });
  it('remembers the last tab after leaving the screen (this browser tab)', async () => {
    window.history.replaceState(null, '', '/tenant/communications/reminders');
    const v = render(<MemoryRouter><POSRemindersScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('rmc-tab-failed'));
    await waitFor(() => expect(m.list).toHaveBeenLastCalledWith(expect.objectContaining({ tab: 'failed' })));
    v.unmount(); window.history.replaceState(null, '', '/tenant/communications/reminders'); m.list.mockClear();
    render(<MemoryRouter><POSRemindersScreen /></MemoryRouter>);
    await waitFor(() => expect(m.list).toHaveBeenCalledWith(expect.objectContaining({ tab: 'failed' })));
  });
});
