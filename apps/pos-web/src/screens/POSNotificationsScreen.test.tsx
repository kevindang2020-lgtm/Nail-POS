// POSNotificationsScreen.test — Customer Notifications Complete Build Guide (741). The rebuilt page keeps the original cards'
// meaning (legacy line), shows Sent ≠ Delivered with Pending / Unknown, opens the details overlay with the sanitized diagnosis,
// asks for confirmation before the one-time Resend, keeps a customer's STOP customer-only, and shows the permission notice on a
// 403 (the old .403 test is folded in here). Needs CI (React types / vitest).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const m = vi.hoisted(() => ({ summary: vi.fn(), list: vi.fn(), detail: vi.fn(), retry: vi.fn(), failures: vi.fn(), optOuts: vi.fn(), timeline: vi.fn(), health: vi.fn(), checkHealth: vi.fn(), incidents: vi.fn(),
  acknowledgeIncident: vi.fn(), resolveIncident: vi.fn(), alertSettings: vi.fn(), saveAlertSettings: vi.fn() }));
const n = vi.hoisted(() => ({ optIn: vi.fn() }));
vi.mock('../api/posCustomerNotificationsApi', () => ({ posCustomerNotificationsApi: m, newCnKey: () => 'key-12345678' }));
vi.mock('../api/posNotificationsApi', () => ({ posNotificationsApi: n }));
vi.mock('../realtime/useRealtime', () => ({ useRealtime: () => undefined }));
import { POSNotificationsScreen } from './POSNotificationsScreen';

const window = { preset: 'month', from: '2026-10-01', to: '2026-10-31', tz: 'America/New_York', today: '2026-10-31', basis: 'created', branchId: null };
const summary = { kpis: { sent: 6, delivered: 2, failed: 3, blocked: 3, pending: 1, unknown: 3, simulated: 0, total: 12, optOutsCurrent: 0, optOutsNew: 0, deliveryRate: null },
  legacy: { sentRecent: 6, blockedFailedRecent: 6 }, window, canManage: true, provenance: { computedAt: '2026-10-31T12:00:00Z', lastCallbackAt: null, unknownAfterHours: 24, definitions: { sent: 'Accepted by the provider.' } } };
const failedRow = { id: '11111111-1111-4111-8111-111111111111', createdAt: '2026-10-22T10:16:00Z', channel: 'sms', type: 'reminder', status: 'failed', state: 'failed', customer: { id: 'c1', name: 'Vishaal Kumar' },
  recipient: '•••9622', recipientMasked: '•••9622', recipientValid: true, detail: 'Authentication failed, auth token is not valid for account AC…cdef', providerErrorCode: '20003', deliveredAt: null, branchId: null,
  failure: { category: 'transient', retry: 'allowed', action: 'retry', rootCause: null }, retryOf: null, resent: false, source: null };
const page = (items: unknown[]) => ({ items, page: 1, pageSize: 20, totalItems: items.length, totalPages: 1, window: { ...window, tab: 'all', sort: 'newest' }, recipientsMasked: true });
const health = { twilio: { state: 'attention' }, sender: { state: 'ready' }, registration: { state: 'pending' }, webhooks: { state: 'unknown' }, outbound: { state: 'ready', blockers: [], warnings: [] },
  email: { state: 'attention', lastAcceptedAt: null, deliveryEvents: 'not_connected' }, callbacks: { lastReceivedAt: null, awaiting: 1, unknown: 3, oldestAwaitingAt: null, state: 'unknown' },
  worker: { state: 'not_applicable', detail: '' }, failedLast24h: 0, readinessAvailable: true, generatedAt: null, checkedNowAt: null, overall: 'attention' };
const ui = (path = '/tenant/communications/notifications') => render(<MemoryRouter initialEntries={[path]}><POSNotificationsScreen /></MemoryRouter>);

beforeEach(() => {
  for (const f of [...Object.values(m), ...Object.values(n)]) f.mockReset();
  m.summary.mockResolvedValue(summary); m.list.mockResolvedValue(page([failedRow])); m.health.mockResolvedValue(health);
  m.incidents.mockResolvedValue({ items: [], page: 1, pageSize: 10, totalItems: 0, totalPages: 1, canResolve: true, evaluatedAt: null });
});

describe('Customer Notifications', () => {
  it('six honest KPIs + the original cards\' meaning kept as the legacy line; Sent is not Delivered', async () => {
    ui();
    expect(await screen.findByTestId('cn-kpi-sent')).toHaveTextContent('6');
    expect(screen.getByTestId('cn-kpi-delivered')).toHaveTextContent('2');
    expect(screen.getByTestId('cn-kpi-pending')).toHaveTextContent('3 unknown');
    expect(await screen.findByTestId('cn-legacy')).toHaveTextContent('Sent (Recent) 6');
    expect(screen.getByText(/Delivery rate unavailable/)).toBeInTheDocument();
  });
  it('the activity table keeps When / Channel / Recipient / Status / Detail, masked for the viewer, with the failure family by code', async () => {
    ui();
    expect(await screen.findByTestId('cn-table')).toBeInTheDocument();
    expect(screen.getByTestId('cn-recipient')).toHaveTextContent('•••9622');
    expect(screen.getByTestId('cn-masked')).toBeInTheDocument();
    expect(screen.getByText('Temporary provider / network problem')).toBeInTheDocument();
  });
  it('the search is sent to the server, never into the URL', async () => {
    ui();
    fireEvent.change(await screen.findByTestId('cn-q'), { target: { value: '7876299624' } });
    await waitFor(() => expect(m.list).toHaveBeenLastCalledWith(expect.objectContaining({ q: '7876299624', page: 1 })));
  });
  it('details overlay: sanitized diagnosis; Resend asks for confirmation and sends one idempotent request', async () => {
    m.detail.mockResolvedValue({ ...failedRow, header: { category: 'reminder', state: 'failed' }, identity: { customer: failedRow.customer, recipient: '•••9622', branch: null, sender: { route: 'tenant_account', from: null } },
      message: { subject: null, body: null, bodyHidden: true, segments: null }, timing: { createdAt: failedRow.createdAt, providerAcceptedAt: null, deliveredAt: null, failedAt: failedRow.createdAt, lastCallbackAt: null, unknownSince: null },
      diagnostics: { category: 'transient', rootCause: null, providerErrorCode: '20003', providerStatus: null, message: failedRow.detail, providerReference: null, events: [] },
      attempts: [], retryRequests: [], consent: { optedOut: false }, retry: { eligible: true, code: null, category: 'transient' }, links: { customer: '/customers?customerId=c1', booking: '/booking/new?customerId=c1&from=notifications' } });
    m.retry.mockResolvedValue({ requestId: 'r1', outcome: 'sent', refusalCode: null, newNotificationId: 'n2', category: 'transient', replayed: false });
    ui(`/tenant/communications/notifications?record=${failedRow.id}`);
    expect(await screen.findByTestId('cn-d-message')).toHaveTextContent('AC…cdef');
    expect(screen.getByTestId('cn-d-bodyhidden')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('cn-d-retry'));
    expect(m.retry).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByTestId('cn-d-retry-yes'));
    await waitFor(() => expect(m.retry).toHaveBeenCalledWith(failedRow.id, 'key-12345678'));
    expect(m.retry).toHaveBeenCalledTimes(1);
  });
  it('opt-outs: a customer\'s STOP is customer-only; re-subscribing anything else needs a consent note', async () => {
    m.list.mockResolvedValue({ ...page([]), recipientsMasked: false });
    m.optOuts.mockResolvedValue({ view: 'current', items: [
      { channel: 'sms', recipient: '+15551230001', recipientKey: '+15551230001', reason: 'inbound_stop', source: 'inbound_stop', since: '2026-10-30T10:00:00Z', matchingCustomers: 1, reOptIn: 'customer_only' },
      { channel: 'email', recipient: 'maya@example.com', recipientKey: 'maya@example.com', reason: 'asked', source: 'staff', since: '2026-10-30T10:00:00Z', matchingCustomers: 1, reOptIn: 'staff_with_note' }],
      page: 1, pageSize: 20, totalItems: 2, totalPages: 1 });
    n.optIn.mockResolvedValue({ ok: true });
    ui('/tenant/communications/notifications?tab=optouts');
    expect(await screen.findByTestId('cn-o-customeronly')).toHaveTextContent('Customer must text START');
    fireEvent.click(screen.getByTestId('cn-o-reoptin'));
    const go = await screen.findByTestId('cn-reoptin-go');
    expect(go).toBeDisabled();
    fireEvent.change(screen.getByTestId('cn-reoptin-note'), { target: { value: 'Signed the consent form' } });
    fireEvent.click(go);
    await waitFor(() => expect(n.optIn).toHaveBeenCalledWith('email', 'maya@example.com', 'Signed the consent form'));
  });
  it('shows a permission message on 403', async () => {
    m.summary.mockRejectedValue({ status: 403 });
    ui();
    expect(await screen.findByTestId('cn-forbidden')).toHaveTextContent(/do not have permission/i);
  });
  it('extras CN-05: each row shows the server\'s priority; the priority filter goes to the server and Clear removes it', async () => {
    m.list.mockResolvedValue(page([{ ...failedRow, type: 'account', priority: 'urgent' }, { ...failedRow, id: '22222222-2222-4222-8222-222222222222', type: 'marketing', priority: 'marketing' }]));
    ui();
    expect(await screen.findByTestId('cn-prio-urgent')).toHaveTextContent('Urgent · security');
    expect(screen.getByTestId('cn-prio-marketing')).toHaveTextContent('Marketing');
    fireEvent.change(screen.getByTestId('cn-priority'), { target: { value: 'urgent' } });
    await waitFor(() => expect(m.list).toHaveBeenLastCalledWith(expect.objectContaining({ priority: 'urgent' })));
    fireEvent.click(await screen.findByTestId('cn-clear'));
    await waitFor(() => expect(m.list.mock.calls.at(-1)?.[0]).not.toHaveProperty('priority'));
  });
  it('extras CN-07: seeing an incident changes nothing; Acknowledge and Resolve are separate, explicit actions', async () => {
    m.incidents.mockResolvedValue({ items: [{ id: 'al1', severity: 'critical', status: 'new', title: 'Repeated failures', body: '3 failed', rule: 'repeated', channel: 'sms', category: 'auth', count: 3,
      firstEventAt: null, lastEventAt: null, detections: 1, openedAt: null, updatedAt: null, resolvedAt: null, resolvedBy: null }], page: 1, pageSize: 10, totalItems: 1, totalPages: 1, canResolve: true, evaluatedAt: null });
    m.acknowledgeIncident.mockResolvedValue({});
    ui();
    expect(await screen.findByTestId('cn-incident')).toHaveTextContent('Repeated failures');
    expect(m.acknowledgeIncident).not.toHaveBeenCalled();
    expect(m.resolveIncident).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('cn-incident-ack'));
    await waitFor(() => expect(m.acknowledgeIncident).toHaveBeenCalledWith('al1'));
    expect(m.resolveIncident).not.toHaveBeenCalled();
  });
  it('extras CN-06: a deep link (?record=) is re-checked by the server on open — another salon\'s or a gone record shows the error, never data', async () => {
    m.detail.mockRejectedValue(Object.assign(new Error('Notification not found.'), { status: 404, code: 'NOTIFICATION_NOT_FOUND' }));
    ui('/tenant/communications/notifications?record=33333333-3333-4333-8333-333333333333');
    await waitFor(() => expect(m.detail).toHaveBeenCalledWith('33333333-3333-4333-8333-333333333333'));
    const dlg = await screen.findByTestId('cn-detail');
    await waitFor(() => expect(dlg.querySelector('.cn-detail-body')).toBeNull());
    expect(screen.queryByTestId('cn-d-message')).toBeNull();
    expect(screen.queryByTestId('cn-d-retry')).toBeNull();
  });
});
