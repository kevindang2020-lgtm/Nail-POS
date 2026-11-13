// POSEmailScreen.test.tsx — Communications → Email (Email Management & Delivery Center). The photographed settings keep
// their meaning (sender name + two toggles + Save), the email sender name is saved as emailSenderName (never into the SMS
// brand), other receipt channels are preserved, and Delivered reads N/A when no verified provider event exists.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const m = vi.hoisted(() => ({ getCat: vi.fn(), update: vi.fn(), settings: vi.fn(), summary: vi.fn(), health: vi.fn(), history: vi.fn(), quick: vi.fn(), rcheck: vi.fn(), compose: vi.fn(), testPreview: vi.fn(), test: vi.fn(), detail: vi.fn(), resend: vi.fn(), exportCsv: vi.fn() }));
vi.mock('../api/posSettingsApi', () => ({ posSettingsApi: { getCategory: m.getCat, updateCategory: m.update } }));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: { quickSearch: m.quick } }));
vi.mock('../api/posEmailCenterApi', () => ({ posEmailCenterApi: { settings: m.settings, summary: m.summary, health: m.health, history: m.history, check: vi.fn(), detail: m.detail, resend: m.resend, test: m.test, testPreview: m.testPreview, compose: m.compose, recipientCheck: m.rcheck } }));
vi.mock('../api/posCustomerNotificationsApi', () => ({ posCustomerNotificationsApi: { exportCsv: m.exportCsv } }));
vi.mock('../components/FitKit', async (orig) => ({ ...(await orig<typeof import('../components/FitKit')>()), downloadText: vi.fn() }));
import { POSEmailScreen } from './POSEmailScreen';

const W = { preset: 'month', from: '2026-10-01', to: '2026-10-31', tz: 'America/New_York', today: '2026-10-31' };
beforeEach(() => {
  try { sessionStorage.clear(); } catch { /* jsdom */ }
  Object.values(m).forEach((f) => f.mockReset());
  m.getCat.mockResolvedValue({ senderBrand: 'SMS Brand LLC', emailConfirmation: false, receiptDelivery: ['SMS'] });
  m.settings.mockResolvedValue({ senderName: 'Glow Bar', replyTo: null, bookingConfirmations: false, receipts: false, source: 'tenant', fromAddress: 'nailsalons@aipowersalon.com', savedAt: null, canEdit: true });
  m.summary.mockResolvedValue({ window: W, provider: 'unknown', accepted: 3, delivered: null, failed: 1, bounced: 0, blocked: 0, simulated: 0, bookingConfirmations: 1, receipts: 2, deliveryRate: null, deliveryRateDenominator: null });
  m.health.mockResolvedValue({ overall: 'unknown', layers: [{ key: 'provider_health', state: 'not_checked', detail: 'Never checked.', next: 'retry_health_check' }], fromAddress: 'nailsalons@aipowersalon.com', lastCheckedAt: null, lastSuccessAt: null });
  m.history.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 1, basis: 'created', window: W, masked: false });
  m.quick.mockResolvedValue({ items: [] });
  m.rcheck.mockResolvedValue({ outcome: 'preview', recipient: { addressMasked: 'a•••@x.com', validAddress: true, sharedAddressCustomers: 0, sameNameCustomers: 0, suppression: null, confidence: 'unique' } });
});
const mount = () => render(<MemoryRouter><POSEmailScreen /></MemoryRouter>);

describe('POSEmailScreen', () => {
  it('shows the EMAIL sender name (not the SMS brand) and the saved toggles', async () => {
    mount();
    expect(await screen.findByDisplayValue('Glow Bar')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('SMS Brand LLC')).toBeNull();
    expect((screen.getByTestId('emc-booking') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId('emc-receipts') as HTMLInputElement).checked).toBe(false);
  });
  it('Delivered is N/A — never 0 — without verified provider events', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('emc-kpi-delivered').textContent).toMatch(/N\/A/));
  });
  it('saves emailSenderName + toggles, preserving the SMS receipt channel; Save is disabled until something changes', async () => {
    m.update.mockResolvedValue({});
    mount();
    await screen.findByDisplayValue('Glow Bar');
    expect((screen.getByTestId('emc-save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('emc-booking')); fireEvent.click(screen.getByTestId('emc-receipts'));
    expect(screen.getByTestId('emc-save-state').textContent).toMatch(/Unsaved/);
    fireEvent.click(screen.getByTestId('emc-save'));
    await waitFor(() => expect(m.update).toHaveBeenCalled());
    const [cat, body] = m.update.mock.calls[0];
    expect(cat).toBe('notifications-reminders');
    expect(body).toMatchObject({ emailSenderName: 'Glow Bar', emailConfirmation: true });
    expect(body.senderBrand).toBeUndefined();
    expect(body.receiptDelivery).toEqual(['SMS', 'Email']);
  });
  it('Draft autosave: subject and message survive closing and reopening the composer; the recipient is not kept', async () => {
    render(<MemoryRouter><POSEmailScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('emc-compose'));
    fireEvent.change(screen.getByTestId('emc-c-subject'), { target: { value: 'Holiday hours' } });
    expect(screen.queryByTestId('emc-c-restored')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('emc-composer')).toBeNull());
    fireEvent.click(screen.getByTestId('emc-compose'));
    expect((screen.getByTestId('emc-c-subject') as HTMLInputElement).value).toBe('Holiday hours');
    expect(screen.getByTestId('emc-c-restored')).toBeInTheDocument();
    expect(sessionStorage.getItem('aps.emc.draft')).not.toMatch(/customer|@/);
  });
  it('Email 11 + 05: delivery speed is N/A without verified events; the suppression list is split by reason with the approved next step', async () => {
    m.summary.mockResolvedValue({ window: W, provider: 'ready', accepted: 3, delivered: 2, failed: 0, bounced: 1, blocked: 0, simulated: 0, bookingConfirmations: 1, receipts: 2, deliveryRate: 66.7, deliveryRateDenominator: 'x',
      latency: { measured: 2, medianSeconds: 45, p90Seconds: 600, slowestSeconds: 900, basis: 'b' },
      suppression: { total: 3, basis: 'b', buckets: [{ key: 'hard_bounce', addresses: 2, latestAt: '2026-10-30T15:00:00Z', scope: 'all', next: 'correct_address' }, { key: 'complaint', addresses: 0, latestAt: null, scope: 'all', next: 'do_not_resend' }, { key: 'unsubscribe', addresses: 1, latestAt: null, scope: 'marketing', next: 'customer_opt_in_only' }, { key: 'other', addresses: 0, latestAt: null, scope: 'mixed', next: 'review_reason' }] } });
    mount();
    expect((await screen.findByTestId('emc-lat-median')).textContent).toBe('45 s');
    expect(screen.getByTestId('emc-lat').textContent).toMatch(/10 min/);
    expect(screen.getByTestId('emc-hy-total').textContent).toMatch(/3/);
    expect(screen.getByTestId('emc-hy-hard_bounce').textContent).toMatch(/corrected address/);
    expect(screen.getByTestId('emc-hy-complaint').textContent).not.toMatch(/Do not email/);   // 0 addresses → no action shown
    expect(screen.getByTestId('emc-hy-unsubscribe').textContent).toMatch(/receipts and booking emails still go/);
  });
  it('Email 11: latency null → Not measured (never 0)', async () => {
    m.summary.mockResolvedValue({ window: W, provider: 'unknown', accepted: 3, delivered: null, failed: 1, bounced: 0, blocked: 0, simulated: 0, bookingConfirmations: 1, receipts: 2, deliveryRate: null, deliveryRateDenominator: null, latency: null, suppression: { total: 0, basis: 'b', buckets: [] } });
    mount();
    expect((await screen.findByTestId('emc-lat-na')).textContent).toMatch(/Not measured/);
  });
  it('Email 10: a shared address must be acknowledged before Send; the check never sends', async () => {
    m.quick.mockResolvedValue({ items: [{ id: 'c1', displayName: 'Ava Kim', email: 'ava@x.com' }] });
    m.rcheck.mockResolvedValue({ outcome: 'preview', recipient: { addressMasked: 'a•••@x.com', validAddress: true, sharedAddressCustomers: 2, sameNameCustomers: 0, suppression: null, confidence: 'shared_address' } });
    mount();
    fireEvent.click(await screen.findByTestId('emc-compose'));
    fireEvent.change(screen.getByTestId('emc-c-search'), { target: { value: 'Ava' } });
    fireEvent.click(await screen.findByTestId('emc-c-hit'));
    fireEvent.change(screen.getByTestId('emc-c-subject'), { target: { value: 'Hi' } });
    fireEvent.change(screen.getByTestId('emc-c-body'), { target: { value: 'See you' } });
    fireEvent.click(screen.getByTestId('emc-c-confirm'));
    expect((await screen.findByTestId('emc-c-identity')).textContent).toMatch(/2 other customer\(s\).*a•••@x\.com/);
    expect(m.rcheck).toHaveBeenCalledWith('c1');
    expect((screen.getByTestId('emc-c-send') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('emc-c-identity-ack'));
    expect((screen.getByTestId('emc-c-send') as HTMLButtonElement).disabled).toBe(false);
    expect(m.compose).not.toHaveBeenCalled();   // the check never sends
  });
  it('Email 12: usage counts what was handed to the provider; cost only when the provider reported it for every email; managers only', async () => {
    const base = { window: W, provider: 'ready', accepted: 3, delivered: null, failed: 0, bounced: 0, blocked: 0, simulated: 0, bookingConfirmations: 0, receipts: 3, deliveryRate: null, deliveryRateDenominator: null, latency: null };
    m.summary.mockResolvedValue({ ...base, usage: { handedToProvider: 3, withProviderCost: 3, costCents: 125, state: 'known', basis: 'b' } });
    const v = mount();
    expect((await screen.findByTestId('emc-use-sent')).textContent).toBe('3 emails handed to the provider');
    expect(screen.getByTestId('emc-use-cost').textContent).toBe('$1.25');
    v.unmount();
    m.summary.mockResolvedValue({ ...base, usage: { handedToProvider: 3, withProviderCost: 1, costCents: null, state: 'cost_unknown', basis: 'b' } });
    const v2 = mount();
    expect((await screen.findByTestId('emc-use-cost')).textContent).toBe('Not known — the provider reported the cost of 1 of 3 emails');
    v2.unmount();
    m.summary.mockResolvedValue({ ...base, usage: { handedToProvider: 3, withProviderCost: null, costCents: null, state: 'not_authorized', basis: 'b' } });
    mount();
    expect((await screen.findByTestId('emc-use-cost')).textContent).toBe('Shown to managers only');
  });
  // extras round 10 (agent 5): Email 03 / 06 / 08 / 13 / 15
  it('Email 03: the provider evidence timeline lists the latest provider events and the last accepted / delivered send; none → says so', async () => {
    m.health.mockResolvedValue({ overall: 'attention_required', layers: [], fromAddress: 'x@y.z', lastCheckedAt: null, lastSuccessAt: null,
      evidence: { lastAcceptedAt: '2026-10-30T15:00:00Z', lastDeliveredAt: '2026-10-30T15:01:00Z', events: [{ status: 'delivered', verified: true, applied: true, at: '2026-10-30T15:01:00Z', emailId: 'e1' }, { status: 'processed', verified: true, applied: false, at: '2026-10-30T15:00:30Z', emailId: 'e1' }] } });
    mount();
    const ev = await screen.findByTestId('emc-evidence');
    expect(screen.getAllByTestId('emc-ev')).toHaveLength(2);
    expect(ev.textContent).toMatch(/evidence only/);
    expect(ev.textContent).toMatch(/Oct 30, 2026/);
  });
  it('Email 06: Send stays off until a preview confirms a staff recipient; the preview shows the exact email and the test history', async () => {
    m.testPreview.mockImplementation(async (to: string) => ({ outcome: 'preview', subject: 'Test email from your salon', body: 'No customer received this message.',
      recipient: { address: to.toLowerCase(), validAddress: true, staff: to.toLowerCase() === 'dee@glow.test' },
      history: [{ id: 'h1', at: '2026-10-29T15:00:00Z', to: 'dee@glow.test', status: 'simulated', reason: null, deliveredAt: null, resendOf: null }] }));
    m.test.mockResolvedValue({ outcome: 'simulated', reason: null, notificationId: 'n1', providerReference: null, replayed: false });
    mount();
    await screen.findByDisplayValue('Glow Bar');
    fireEvent.change(screen.getByTestId('emc-test-to'), { target: { value: 'ava@example.com' } });
    fireEvent.click(screen.getByTestId('emc-test-preview'));
    expect((await screen.findByTestId('emc-test-staff')).textContent).toMatch(/not an active staff member/);
    expect((screen.getByTestId('emc-test-confirm') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('emc-test-send') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('emc-test-to'), { target: { value: 'dee@glow.test' } });
    fireEvent.click(screen.getByTestId('emc-test-preview'));
    await waitFor(() => expect(screen.getByTestId('emc-test-staff').textContent).toMatch(/is a staff member/));
    expect(screen.getByTestId('emc-test-pv').textContent).toMatch(/Test email from your salon/);
    expect(screen.getByTestId('emc-test-history').textContent).toMatch(/dee@glow.test/);
    expect(m.test).not.toHaveBeenCalled();                                    // previewing never sends
    fireEvent.click(screen.getByTestId('emc-test-confirm'));
    fireEvent.click(screen.getByTestId('emc-test-send'));
    await waitFor(() => expect(m.test).toHaveBeenCalledTimes(1));
    expect(m.test.mock.calls[0][0]).toBe('dee@glow.test');
  });
  it('Email 13 + 08: rows and details say the next step in words; Resend sends one request at a time', async () => {
    m.history.mockResolvedValue({ items: [{ id: 'e1', createdAt: '2026-10-30T15:00:00Z', to: 'ava@example.com', customer: null, subject: 'Receipt', category: 'receipt', status: 'bounced', reason: 'bounced:550', deliveredAt: null, resendOf: null, nextAction: 'fix_address' }],
      total: 1, page: 1, pageSize: 20, totalPages: 1, basis: 'created', window: W, masked: false });
    m.detail.mockResolvedValue({ id: 'e2', createdAt: '2026-10-30T15:00:00Z', status: 'failed', rawStatus: 'failed', reason: 'email_failed:503', category: 'receipt', consent: 'transactional', from: { address: 'x@y.z', name: null }, replyTo: null, to: 'ava@example.com', subject: 'R', body: 'b',
      customer: null, branch: null, links: { appointmentId: null, ticketId: null, receipts: [] }, providerReference: null, deliveredAt: null, events: [], attempts: [{ id: 'e2', at: '2026-10-30T15:00:00Z', status: 'failed', reason: null, isThis: true }], canResend: true, nextAction: 'resend' });
    let release: (v: unknown) => void = () => {};
    m.resend.mockImplementation(() => new Promise((r) => { release = r; }));
    mount();
    expect((await screen.findByTestId('emc-row-next')).textContent).toMatch(/correct the customer's email/);
    fireEvent.click(screen.getByTestId('emc-row-view'));
    expect((await screen.findByTestId('emc-d-next')).textContent).toMatch(/Resend it from Email Details/);
    fireEvent.click(screen.getByTestId('emc-d-resend-confirm'));
    fireEvent.click(screen.getByTestId('emc-d-resend'));
    fireEvent.click(screen.getByTestId('emc-d-resend'));
    await waitFor(() => expect((screen.getByTestId('emc-d-resend') as HTMLButtonElement).disabled).toBe(true));
    expect(m.resend).toHaveBeenCalledTimes(1);
    release({ outcome: 'simulated', refusalCode: null, newNotificationId: 'e3', replayed: false });
    await waitFor(() => expect(screen.getByTestId('emc-d-msg')).toBeInTheDocument());
  });
  it('Email 15: Export calls the authorized notification-records export narrowed to email with this period and search', async () => {
    m.exportCsv.mockResolvedValue('Generated at,x\n');
    mount();
    await screen.findByDisplayValue('Glow Bar');
    fireEvent.change(screen.getByTestId('emc-search'), { target: { value: 'ava' } });
    await new Promise((r) => setTimeout(r, 350));
    fireEvent.click(screen.getByTestId('emc-export'));
    await waitFor(() => expect(m.exportCsv).toHaveBeenCalledTimes(1));
    expect(m.exportCsv.mock.calls[0][0]).toMatchObject({ channel: 'email', preset: 'month', q: 'ava' });
    expect((await screen.findByTestId('emc-export-msg')).textContent).toMatch(/recorded with your name/);
  });
});
