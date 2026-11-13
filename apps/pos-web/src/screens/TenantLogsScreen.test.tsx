import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { pageMock, exportMock, postMock } = vi.hoisted(() => ({ pageMock: vi.fn(), exportMock: vi.fn(), postMock: vi.fn() }));
vi.mock('../api/client', () => ({ api: { get: vi.fn().mockResolvedValue({}), post: postMock } }));
vi.mock('../api/posLogsApi', () => ({ posLogsApi: { page: pageMock, exportCsv: exportMock } }));
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
});
