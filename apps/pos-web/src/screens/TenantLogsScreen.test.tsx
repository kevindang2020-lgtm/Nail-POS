import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { pageMock, exportMock, postMock, alertsMock, resolveMock, retriesMock } = vi.hoisted(() => ({ pageMock: vi.fn(), exportMock: vi.fn(), postMock: vi.fn(), alertsMock: vi.fn(), resolveMock: vi.fn(), retriesMock: vi.fn() }));
vi.mock('../api/client', () => ({ api: { get: vi.fn().mockResolvedValue({}), post: postMock } }));
vi.mock('../api/posLogsApi', () => ({ posLogsApi: { page: pageMock, exportCsv: exportMock, alerts: alertsMock, resolveAlert: resolveMock, retries: retriesMock } }));
import { TenantLogsScreen } from './TenantLogsScreen';

const logs = [
  { id: 'l1', category: 'integration', severity: 'info', source: 'webhook', message: 'Test delivery to hooks.example.com succeeded', correlationId: null, relatedId: 'wh1', status: 'delivered', metadata: { status: 200 }, createdIso: '2026-05-06T14:00:00Z' },
  { id: 'l2', category: 'integration', severity: 'error', source: 'webhook', message: 'Delivery failed for CRM', correlationId: null, relatedId: 'wh2', status: 'failed', metadata: { status: 500 }, createdIso: '2026-05-06T13:00:00Z' },
];
beforeEach(() => { pageMock.mockReset(); pageMock.mockResolvedValue({ logs, total: 2, page: 1, pageSize: 25, totalPages: 1, summary: { events: 2, warnings: 0, errors: 1, device: 0, integration: 2 } }); });

describe('TenantLogsScreen', () => {
  it('renders log entries and the five verified cards (newest first, page 1 of 25)', async () => {
    render(<MemoryRouter><TenantLogsScreen /></MemoryRouter>);
    expect(await screen.findByText('Device & Integration Logs')).toBeInTheDocument();
    expect(await screen.findByText('Test delivery to hooks.example.com succeeded')).toBeInTheDocument();
    expect(screen.getByText('Delivery failed for CRM')).toBeInTheDocument();
    expect(screen.getByTestId('lgx-kpi-errors').textContent).toContain('1');
    expect(pageMock).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 25 }));
  });
  it('filters by severity on the server (the original All severities control)', async () => {
    render(<MemoryRouter><TenantLogsScreen /></MemoryRouter>);
    await screen.findByText('Delivery failed for CRM');
    fireEvent.change(screen.getByDisplayValue('All severities'), { target: { value: 'error' } });
    await waitFor(() => expect(pageMock).toHaveBeenLastCalledWith(expect.objectContaining({ severity: 'error', page: 1 })));
  });
  it('Device Integration Logs · 03: a device event opens that device\'s own timeline on the server; the chip clears it; an integration event has no such button', async () => {
    pageMock.mockResolvedValue({ logs: [{ id: 'd1', category: 'device', severity: 'warning', source: 'customer_display', message: 'customer display offline', correlationId: null, relatedId: 'disp-1', status: null, metadata: null, createdIso: '2026-05-06T14:00:00Z' }, logs[1]], total: 2, page: 1, pageSize: 25, totalPages: 1, summary: { events: 2, warnings: 1, errors: 1, device: 1, integration: 1 } });
    render(<MemoryRouter><TenantLogsScreen /></MemoryRouter>);
    fireEvent.click((await screen.findAllByTestId('lgx-view'))[1]);
    await screen.findByTestId('lgx-detail');
    expect(screen.queryByTestId('lgx-device-history')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('lgx-detail')).toBeNull());
    fireEvent.click(screen.getAllByTestId('lgx-view')[0]);
    fireEvent.click(await screen.findByTestId('lgx-device-history'));
    await waitFor(() => expect(pageMock).toHaveBeenLastCalledWith(expect.objectContaining({ relatedId: 'disp-1', category: 'device', severity: 'all', page: 1 })));
    expect(screen.queryByTestId('lgx-detail')).toBeNull();
    fireEvent.click(await screen.findByTestId('lgx-device-chip'));
    await waitFor(() => expect(pageMock.mock.calls.slice(-1)[0]![0].relatedId).toBeUndefined());
  });
  it('Device Integration Logs · 02: an event with a correlation id opens that request\'s trace on the server (every category); the chip clears it; no id → no button', async () => {
    pageMock.mockResolvedValue({ logs: [{ id: 't1', category: 'integration', severity: 'warning', source: 'payment_terminal', message: 'provider response timeout', correlationId: 'trm-req.7f3a', relatedId: null, status: null, metadata: null, createdIso: '2026-05-06T14:00:00Z' },
      { id: 't2', category: 'device', severity: 'info', source: 'kiosk', message: 'guest checked in', correlationId: null, relatedId: null, status: null, metadata: null, createdIso: '2026-05-06T13:00:00Z' }], total: 2, page: 1, pageSize: 25, totalPages: 1, summary: { events: 2, warnings: 1, errors: 0, device: 1, integration: 1 } });
    render(<MemoryRouter><TenantLogsScreen /></MemoryRouter>);
    fireEvent.click((await screen.findAllByTestId('lgx-view'))[1]);
    await screen.findByTestId('lgx-detail');
    expect(screen.queryByTestId('lgx-trace')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('lgx-detail')).toBeNull());
    fireEvent.click(screen.getAllByTestId('lgx-view')[0]);
    fireEvent.click(await screen.findByTestId('lgx-trace'));
    await waitFor(() => expect(pageMock).toHaveBeenLastCalledWith(expect.objectContaining({ correlationId: 'trm-req.7f3a', category: 'all', severity: 'all', page: 1 })));
    expect(pageMock.mock.calls.slice(-1)[0]![0].relatedId).toBeUndefined();
    fireEvent.click(await screen.findByTestId('lgx-trace-chip'));
    await waitFor(() => expect(pageMock.mock.calls.slice(-1)[0]![0].correlationId).toBeUndefined());
  });
  it('an event opens its details', async () => {
    render(<MemoryRouter><TenantLogsScreen /></MemoryRouter>);
    fireEvent.click((await screen.findAllByTestId('lgx-view'))[1]);
    expect(await screen.findByTestId('lgx-detail')).toBeInTheDocument();
  });
  it('Customer-impact context: a device event says what that device is for; an integration event does not', async () => {
    pageMock.mockResolvedValue({ logs: [{ id: 'd1', category: 'device', severity: 'warning', source: 'payment_terminal', message: 'terminal offline', correlationId: null, relatedId: 't1', status: null, metadata: null, createdIso: '2026-05-06T14:00:00Z' }, logs[1]], total: 2, page: 1, pageSize: 25, totalPages: 1, summary: { events: 2, warnings: 1, errors: 1, device: 1, integration: 1 } });
    render(<MemoryRouter><TenantLogsScreen /></MemoryRouter>);
    fireEvent.click((await screen.findAllByTestId('lgx-view'))[0]);
    expect(await screen.findByTestId('lgx-impact')).toHaveTextContent(/card payments/i);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('lgx-detail')).toBeNull());
    fireEvent.click(screen.getAllByTestId('lgx-view')[1]);
    await screen.findByTestId('lgx-detail');
    expect(screen.queryByTestId('lgx-impact')).toBeNull();
  });
  it('Device Integration Logs 06: says whether payment events are sandbox / UAT or production, and whether a production validation is recorded', async () => {
    const base = { logs, total: 2, page: 1, pageSize: 25, totalPages: 1, summary: { events: 2, warnings: 0, errors: 1, device: 0, integration: 2 } };
    pageMock.mockResolvedValue({ ...base, paymentEnvironment: { environment: 'sandbox', source: 'salon', processor: 'cardpointe', certification: null } });
    const v = render(<MemoryRouter><TenantLogsScreen /></MemoryRouter>);
    const env = await screen.findByTestId('lgx-env');
    expect(env).toHaveAttribute('data-env', 'sandbox');
    expect(env).toHaveTextContent('Payments: Sandbox / UAT');
    expect(env).toHaveTextContent('test traffic on CardPointe — not production and not certification evidence');
    expect(env).toHaveTextContent("the salon's default merchant");
    expect(screen.getByTestId('lgx-env-cert')).toHaveTextContent('No production validation recorded');
    v.unmount();
    pageMock.mockResolvedValue({ ...base, paymentEnvironment: { environment: 'production', source: 'branch', processor: 'clover', certification: 'approved' } });
    const v2 = render(<MemoryRouter><TenantLogsScreen /></MemoryRouter>);
    expect(await screen.findByTestId('lgx-env')).toHaveTextContent('Payments: Production');
    expect(screen.getByTestId('lgx-env-cert')).toHaveTextContent('Production validation: approved');
    v2.unmount();
    pageMock.mockResolvedValue(base);   // an older server: no label, nothing guessed
    render(<MemoryRouter><TenantLogsScreen /></MemoryRouter>);
    await screen.findByText('Delivery failed for CRM');
    expect(screen.queryByTestId('lgx-env')).toBeNull();
  });
  it('Device Integration Logs 08: Export sends the page\'s range + filters to the server export and says it was recorded; a refusal shows the server\'s words', async () => {
    exportMock.mockReset(); exportMock.mockResolvedValue('Time,Category\r\n');
    const createObjectURL = vi.fn(() => 'blob:x'); const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<MemoryRouter><TenantLogsScreen /></MemoryRouter>);
    await screen.findByText('Delivery failed for CRM');
    fireEvent.change(screen.getByDisplayValue('All severities'), { target: { value: 'error' } });
    fireEvent.click(screen.getByTestId('lgx-export'));
    await waitFor(() => expect(exportMock).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', category: 'all' })));
    expect(await screen.findByTestId('lgx-export-note')).toHaveTextContent('Sanitized logs exported. The export was recorded.');
    expect(createObjectURL).toHaveBeenCalled(); expect(click).toHaveBeenCalledTimes(1);
    exportMock.mockRejectedValueOnce(Object.assign(new Error('Pick a start and an end date (start on or before end) to export.'), { status: 400 }));
    fireEvent.click(screen.getByTestId('lgx-export'));
    await waitFor(() => expect(screen.getByTestId('lgx-export-note')).toHaveTextContent('Pick a start and an end date'));
    click.mockRestore();
  });

  it('Device Integration Logs · 04: an event becomes ONE support issue in the support engine — ids and codes only, never its metadata', async () => {
    postMock.mockReset();
    postMock.mockResolvedValue({ ok: true, ticket: { id: 'tk1', ticketNumber: 'SUP-7Q2', subject: 'x', status: 'submitted', priority: 'high' } });
    render(<MemoryRouter><TenantLogsScreen /></MemoryRouter>);
    fireEvent.click((await screen.findAllByTestId('lgx-view'))[1]);   // l2: error, webhook, related wh2, metadata { status: 500 }
    expect((screen.getByTestId('lgx-issue-priority') as HTMLSelectElement).value).toBe('high');   // error → high (critical → urgent)
    fireEvent.change(screen.getByTestId('lgx-issue-note'), { target: { value: 'CRM sync stopped at noon' } });
    fireEvent.click(screen.getByTestId('lgx-issue-submit'));
    expect(await screen.findByTestId('lgx-issue-done')).toHaveTextContent('Support issue SUP-7Q2');
    expect(postMock).toHaveBeenCalledTimes(1);
    const [url, body] = postMock.mock.calls[0];
    expect(url).toBe('/tenant/help/tickets');
    expect(body).toMatchObject({ category: 'integration', affectedModule: 'device_logs', priority: 'high', idempotencyKey: 'log-event:l2' });
    expect(body.subject).toContain('Delivery failed for CRM');
    expect(body.description).toContain('l2');
    expect(body.description).toContain('wh2');
    expect(body.description).toContain('CRM sync stopped at noon');
    expect(body.description).not.toContain('500');   // the event's metadata is never copied into the issue
  });

  it('Device Integration Logs · 04: a refused create ({ ok: false }) is shown as failed — never as a created issue', async () => {
    postMock.mockReset();
    postMock.mockResolvedValue({ ok: false, error: 'unavailable' });
    render(<MemoryRouter><TenantLogsScreen /></MemoryRouter>);
    fireEvent.click((await screen.findAllByTestId('lgx-view'))[0]);
    fireEvent.click(screen.getByTestId('lgx-issue-submit'));
    expect(await screen.findByTestId('lgx-issue-err')).toBeInTheDocument();
    expect(screen.queryByTestId('lgx-issue-done')).toBeNull();
  });
  it('Device Integration Logs 05: routed alerts list the server\'s deduplicated alerts with the action to take; Resolve only when the server allows; "Show these events" filters the page', async () => {
    const item = (o: Record<string, unknown>) => ({ id: 'a1', rule: 'device_offline', severity: 'warning', status: 'new', dedupeKey: 'device_offline:display', deviceClass: 'display', source: null, count: 2, names: ['Display A', 'Display B'], action: 'check_power_network',
      firstEventAt: null, lastEventAt: null, detections: 3, openedAt: '2026-11-12T10:00:00Z', updatedAt: '2026-11-12T10:20:00Z', resolvedAt: null, resolvedBy: null, ...o });
    alertsMock.mockReset(); resolveMock.mockReset().mockResolvedValue({});
    alertsMock.mockResolvedValue({ items: [item({}), item({ id: 'a2', rule: 'provider_critical', severity: 'critical', dedupeKey: 'provider_critical:payment_gateway', deviceClass: null, source: 'payment_gateway', count: 1, names: [], action: 'contact_support' })],
      page: 1, pageSize: 10, totalItems: 2, totalPages: 1, evaluatedAt: '2026-11-12T10:20:00Z', cooldownMinutes: 30, canResolve: true });
    render(<MemoryRouter><TenantLogsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('lgx-alerts-open'));
    const rows = await screen.findAllByTestId('lgx-alert');
    expect(rows).toHaveLength(2);
    expect(alertsMock).toHaveBeenCalledWith({ status: 'open', page: 1, pageSize: 10 });
    expect(screen.getAllByTestId('lgx-alert-title')[0].textContent).toBe('Customer displays offline: 2');
    expect(screen.getAllByTestId('lgx-alert-names')[0].textContent).toBe('Display A, Display B');
    expect(screen.getAllByTestId('lgx-alert-action')[0].textContent).toContain('check power and Wi-Fi');
    expect(screen.getByTestId('lgx-alerts').textContent).toContain('30 min');
    fireEvent.click(screen.getAllByTestId('lgx-alert-resolve')[0]);
    await waitFor(() => expect(resolveMock).toHaveBeenCalledWith('a1'));
    expect(await screen.findByTestId('lgx-alerts-note')).toHaveTextContent('Alert resolved.');
    fireEvent.click(screen.getByTestId('lgx-alerts-f-closed'));
    await waitFor(() => expect(alertsMock).toHaveBeenLastCalledWith({ status: 'closed', page: 1, pageSize: 10 }));
    alertsMock.mockResolvedValue({ items: [item({ id: 'a2', rule: 'provider_critical', severity: 'critical', source: 'payment_gateway', names: [], action: 'contact_support' })], page: 1, pageSize: 10, totalItems: 1, totalPages: 1, evaluatedAt: null, cooldownMinutes: 30, canResolve: false });
    fireEvent.click(screen.getByTestId('lgx-alerts-f-open'));
    await waitFor(() => expect(screen.getAllByTestId('lgx-alert')).toHaveLength(1));
    expect(screen.queryByTestId('lgx-alert-resolve')).toBeNull();   // the viewer may not resolve → no button
    fireEvent.click(screen.getByTestId('lgx-alert-logs'));
    await waitFor(() => expect(pageMock).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'integration', severity: 'critical', page: 1 })));
    expect(screen.queryByTestId('lgx-alerts')).toBeNull();
  });
  it('Device Integration Logs 09: the retry queue shows each store\'s counts and lag, attempt n of max and the redacted error — read-only (no retry button)', async () => {
    retriesMock.mockReset().mockResolvedValue({ checkedAt: '2026-11-12T10:00:00Z', deadWindowDays: 7,
      jobs: { waiting: 1, retrying: 1, running: 0, dead: 1, oldestDueLagSeconds: 125 }, webhooks: { waiting: 0, retrying: 1, running: 0, dead: 0, oldestDueLagSeconds: 30 },
      items: [{ id: 'j1', store: 'job', type: 'receipt.send', state: 'dead', attempt: 5, maxAttempts: 5, nextAttemptAt: null, lagSeconds: null, lastError: 'gave up', correlationId: null, createdAt: null, updatedAt: null },
        { id: 'w1', store: 'webhook', type: 'appointment.created', state: 'retrying', attempt: 3, maxAttempts: 8, nextAttemptAt: '2026-11-12T09:59:30Z', lagSeconds: 30, lastError: 'HTTP 500', correlationId: null, createdAt: null, updatedAt: null }],
      total: 4, page: 1, pageSize: 10, totalPages: 1 });
    render(<MemoryRouter><TenantLogsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('lgx-retry-open'));
    const rows = await screen.findAllByTestId('lgx-retry-row');
    expect(rows.map((r) => r.getAttribute('data-state'))).toEqual(['dead', 'retrying']);
    expect(screen.getAllByTestId('lgx-retry-attempt').map((c) => c.textContent)).toEqual(['5 of 5', '3 of 8']);
    expect(screen.getAllByTestId('lgx-retry-lag').map((c) => c.textContent)).toEqual(['—', '30 s']);
    expect(screen.getByTestId('lgx-retry-jobs').textContent).toContain('Waiting 1 · Retrying 1 · Running 0 · Dead 1');
    expect(screen.getByTestId('lgx-retry-jobs-lag').textContent).toBe('Oldest overdue: 2 min');
    expect(screen.getByTestId('lgx-retry').textContent).not.toMatch(/Retry now/i);
    fireEvent.click(screen.getByTestId('lgx-retry-refresh'));
    await waitFor(() => expect(retriesMock).toHaveBeenCalledTimes(2));
  });
});
