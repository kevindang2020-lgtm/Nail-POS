// switch-preserves-state.test.tsx — Vietnamese POS mandate §6/§7/§81/§104–§108/§115/§116 (WP-B). The REAL app (App.tsx →
// Gate → POSRoutes → POSLayout shell → the real screen) is rendered with a mocked API, then the language is switched with
// the real topbar selector, EN → VI → EN. Each test proves, for its screen:
//   • nothing remounted — the same DOM nodes are still connected (a remount builds new ones) and nothing reloaded;
//   • the operator's state is unchanged — selection, date, search text, open drawer with a half-typed reason, scroll;
//   • the text did change language (so the pass is not vacuous);
//   • no fetch storm — the only request a switch makes is PUT /pos/me/language;
//   • Checkout with an UNKNOWN card payment: no charge / retry / verify request, the "status unknown" banner and the
//     Verify button stay;
//   • realtime: no new SSE connection and no extra event listeners across 10 switches.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage, getLanguage, t } from '@aipowersalon/mobile-sdk/i18n';
import { REALTIME_EVENT, REALTIME_RECONCILE } from '../realtime/realtime-client';

const PERMS = vi.hoisted(() => ['dashboard.view', 'booking.view', 'customers.edit', 'customers.view', 'queue.view', 'checkout.view', 'serving.view', 'checkin.view', 'queue.manage']);
const AUTH = { principal: { userId: 'u1', tenantId: 'tn1', branchId: 'b1', role: 'OWNER', permissions: PERMS }, loading: false, offline: false, setPrincipal: () => {}, logout: async () => {} };
vi.mock('../auth/AuthContext', () => ({ AuthProvider: ({ children }: { children: unknown }) => children, useAuth: () => AUTH }));
const rt = vi.hoisted(() => ({ connects: 0 }));
vi.mock('../realtime/realtime-client', async (orig) => {
  const actual = await orig<typeof import('../realtime/realtime-client')>();
  return { ...actual, ensureRealtimeConnected: () => { rt.connects++; return actual.ensureRealtimeConnected(); } };
});
import { App } from '../App';
import { resetPosLanguageForTests } from './pos-language';

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const TECHS = Array.from({ length: 12 }, (_, i) => ({ technicianId: `t${i}`, name: `Tech ${String.fromCharCode(65 + i)}` }));
const grid = (date: string) => ({
  date, openTime: '09:00', closeTime: '18:00', slotIntervalMinutes: 15, bufferMinutes: 0, defaultServiceDurationMinutes: 30, totalOpenSlots: 0,
  columns: TECHS.map((x) => ({ ...x, available: true, skills: [], avatarUrl: null, windows: [{ start: 540, end: 1080 }], blocked: [], openRanges: [], openMinutes: 0, openSlotCount: 0 })),
  appointments: [appt()],
});
function appt() {
  return { appointmentId: 'apX', customerName: 'Nguyễn Thị Hương', customerPhone: '', isVip: false, technicianId: 't0', technicianName: 'Tech A',
    services: [{ serviceName: 'Mani' }], source: 'manual', startTime: '10:00', endTime: '10:30', durationMinutes: 30, status: 'booked',
    depositStatus: 'not_required', conflictStatus: 'none', createdAt: '', updatedAt: '', version: 7 };
}
const bookingState = {
  kpis: { totalBookingsToday: 1, confirmedBookings: 0, checkedInBookings: 0, waitingBookings: 0, inServiceBookings: 0, completedBookings: 0, cancelledBookings: 0, noShowBookings: 0, onlineBookings: 0, walkInsToday: 0, conflictCount: 0 },
  dateRange: { from: '2026-06-07', to: '2026-06-07', timezone: 'America/New_York' },
  bookings: { items: [appt()], pagination: { totalItems: 1 } },
  filters: { statuses: [], sources: [], technicians: TECHS, services: [], serviceCategories: [], branches: [] },
  integrationStatus: { googleReserveConnected: false, aiPhoneEnabled: false, onlineBookingEnabled: false },
};
const qItem = { queueItemId: 'q1', customerId: 'c1', customerName: 'Trần Mỹ Linh', source: 'walk_in', requestedServices: [{ serviceName: 'Gel Manicure' }], serviceCount: 1, priority: 'normal', status: 'waiting', checkedInAt: new Date().toISOString() };
const queueState = {
  kpis: { waitingGuests: 1, averageWaitMinutes: 10, longestWaitMinutes: 20, vipWaiting: 0, appointmentsWaiting: 0, walkInsWaiting: 1, readyForTech: 0, assignedTechnicians: 1, delayedQueueItems: 0, returnRatePercent: 0 },
  queue: { items: [qItem], pagination: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 } },
  filters: { statuses: ['waiting', 'assigned'], sources: ['walk_in', 'appointment'], technicians: ['Mia'], serviceCategories: ['Manicure', 'Pedicure'], priorityLevels: ['normal', 'high'], stations: [] },
};
const ticket = { ticketId: 't1', ticketNumber: 'A1', customerName: 'Jessica Miller', isVip: false, serviceCount: 2, totalDueCents: 12840, status: 'ready_for_payment', primaryTechnicianName: 'Samantha' };
const checkoutState = {
  kpisFull: { ticketsReadyForPayment: 1, subtotalCents: 40000, tipsTodayCents: 5000, cardSurchargeCollectedCents: 0, taxCollectedCents: 2800, paidTicketsToday: 10, failedPaymentsToday: 0, customerDisplayActiveSessions: 0, receiptDeliveryRatePercent: 90, averageCheckoutSeconds: 120, giftCardLoyaltyRedemptionsCents: 0, upsellCapturePercent: 0 },
  tickets: { items: [ticket], pagination: { totalItems: 1 } },
  paymentSettings: { cardEnabled: true, cashEnabled: true, giftCardEnabled: true, splitPaymentEnabled: true, cardSurchargeEnabled: false, cardSurchargePercent: 0, taxRatePercent: 7, tipsEnabled: true, defaultTipPercents: [15, 18, 20], allowCustomTip: true, allowNoTip: true, customerDisplayMode: 'review_only', fiservStatus: 'not_configured' },
  customerDisplay: { pairedDevices: [], activeSession: null },
};
const ticketDetail = {
  ticketId: 't1', ticketNumber: 'A1', customer: { fullName: 'Jessica Miller', isVip: false }, stationLabel: 'Station 1',
  completedServices: [{ serviceLineId: 'l1', serviceName: 'Gel Manicure', technicianName: 'Samantha', priceCents: 6500 }],
  totals: { subtotalCents: 12000, tipCents: 0, taxCents: 840, surchargeCents: 0, totalDueCents: 12840, paymentMethod: 'card' },
  status: 'ready_for_payment', receiptDeliveryOptions: { sms: false, email: false, app: false, print: false },
};

type Call = { method: string; url: string; body?: unknown };
function server() {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url); const method = (init?.method as string) || 'GET';
    let body: unknown; try { body = init?.body ? JSON.parse(String(init.body)) : undefined; } catch { /* */ }
    calls.push({ method, url: u, body });
    const ok = (j: unknown) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => j, text: async () => JSON.stringify(j) }) as unknown as Response;
    if (u.includes('/tenant/navigation') && !u.includes('badges')) return ok({ role: 'OWNER', permissions: PERMS, features: [], aiPackages: [], subscriptionStatus: 'active', salonName: 'Tiệm Nail Hương' });
    if (u.includes('/pos/me/locale')) return ok({ language: 'en', salonDefault: null, timeZone: 'America/New_York' });
    if (u.includes('/pos/me/language')) return ok({ language: (body as { language?: string })?.language });
    // checkout — the card charge's answer is lost: the outcome is UNKNOWN
    // merged Nov 7 2026: Card goes to the Clover Compact (…/pay/terminal); the terminal's answer is UNKNOWN
    if (/\/pos\/checkout\/terminals$/.test(u)) return ok([{ id: 'term1', label: 'Front desk Compact', stationId: null, disabled: false, lastSeenAt: null, hsnConfigured: true }]);
    if (u.includes('/pos/checkout/tickets/') && /\/pay\/terminal$/.test(u)) return ok({ status: 'unknown', next: 'verify', message: '' });
    if (u.includes('/pos/checkout/tickets/') && /\/verify/.test(u)) return ok({ status: 'pending', retryAfterSeconds: 60 });
    if (/\/pos\/checkout\/tickets\/[^/?]+$/.test(u)) return ok(ticketDetail);
    if (u.includes('/pos/checkout/state')) return ok(checkoutState);
    // queue
    if (u.includes('/pos/technicians/state')) return ok({ rows: { items: [{ technicianId: 't1', displayName: 'Mia Johnson' }] } });
    if (/\/pos\/queue\/items\/[^/?]+$/.test(u) && method === 'GET') return ok({ queueItemId: 'q1', customerName: 'Trần Mỹ Linh' });
    if (u.includes('/pos/queue/state')) return ok(queueState);
    // booking
    if (u.includes('/changes')) return ok({ appointments: [], cursor: 'v1.x', serverTime: new Date().toISOString() });
    if (u.includes('/day-grid')) return ok(grid(new URL(u, 'http://x').searchParams.get('date') || '2026-06-07'));
    if (u.includes('/pos/booking') && !u.includes('/appointments/')) return ok(bookingState);
    return ok({});
  });
  return { calls, fetch };
}

// counts window/document listeners of the realtime and sync event types (added − removed)
function listenerCounter() {
  const live: Record<string, number> = {};
  const types = new Set([REALTIME_EVENT, REALTIME_RECONCILE, 'visibilitychange']);
  for (const target of [window, document] as EventTarget[]) {
    const add = target.addEventListener.bind(target), rem = target.removeEventListener.bind(target);
    vi.spyOn(target, 'addEventListener').mockImplementation((type: string, l: any, o?: any) => { if (types.has(type)) live[type] = (live[type] ?? 0) + 1; return add(type, l, o); });
    vi.spyOn(target, 'removeEventListener').mockImplementation((type: string, l: any, o?: any) => { if (types.has(type)) live[type] = (live[type] ?? 0) - 1; return rem(type, l, o); });
  }
  return () => ({ ...live });
}

let eventSources = 0;
class FakeEventSource { onopen: unknown = null; onmessage: unknown = null; onerror: unknown = null; readyState = 0; url: string; constructor(url: string) { this.url = url; eventSources++; } addEventListener() {} removeEventListener() {} close() { this.readyState = 2; } }

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 120)); });
async function switchTo(l: 'en' | 'vi') {
  fireEvent.click(screen.getByTestId('language-switch'));
  fireEvent.click(screen.getByTestId(`language-option-${l}`));
  await waitFor(() => expect(getLanguage()).toBe(l));
  await settle();
}
// the switch's own save, and the idle-lock's "a person is using this register" ping (any tap sends it) are expected
const nonLanguageCalls = (calls: Call[], from: number) => calls.slice(from).filter((c) => !c.url.includes('/pos/me/language') && !c.url.includes('/auth/session-activity'));
/** wait until the screen's own debounced / follow-up requests are done (no new request for 500 ms) */
async function quiet(calls: Call[]) {
  for (let i = 0; i < 20; i++) { const n = calls.length; await act(async () => { await new Promise((r) => setTimeout(r, 500)); }); if (calls.length === n) return; }
}
function renderAt(path: string) { return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>); }

// Why this file used to HANG (no output until killed): React 18's dev-mode invokeGuardedCallback saves and restores
// `window.event` by ASSIGNING it, and under vitest's jsdom global that assignment sticks — after the first fireEvent the
// global `window.event` stays a stale Event for every later test. React reads window.event to pick an update's priority,
// so the next test's effect-driven updates were mis-prioritised into an endless fetch→setState microtask loop inside act
// that starved every timer (even the test timeout). Clear it around each test, as a real browser has none between events.
const clearStaleWindowEvent = () => { (window as any).event = undefined; };
beforeEach(async () => {
  clearStaleWindowEvent();
  vi.restoreAllMocks();
  resetPosLanguageForTests();
  await setLanguage('en');
  rt.connects = 0; eventSources = 0;
  (globalThis as any).EventSource = FakeEventSource;
});
afterEach(async () => { await setLanguage('en'); clearStaleWindowEvent(); });

describe('language switch keeps the operator\'s work (§6/§7/§116)', () => {
  it('Booking: selected date, search text, scroll and the shell survive EN → VI → EN; only PUT /pos/me/language is sent', async () => {
    const { calls, fetch } = server(); globalThis.fetch = fetch as any;
    const { container } = renderAt('/booking');
    await screen.findAllByText('Nguyễn Thị Hương');
    fireEvent.click(screen.getByRole('button', { name: /next day/i }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('date=2026-06-08'))).toBe(true));
    const search = screen.getByPlaceholderText('Search customer, phone, tech…') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'nguy' } });
    const scroller = container.querySelector('.overflow-auto.rounded-\\[10px\\]') as HTMLElement;
    scroller.scrollTop = 420; scroller.scrollLeft = 900;
    const shell = container.querySelector('.shell') as HTMLElement;
    await quiet(calls);
    const before = calls.length;

    await switchTo('vi');
    expect(document.documentElement.lang).toBe('vi');
    expect(screen.getByTestId('language-current').textContent).toBe('Tiếng Việt');
    expect(screen.queryByPlaceholderText('Search customer, phone, tech…')).toBeNull();      // the text really changed
    // same nodes (no remount), same values
    expect(search.isConnected).toBe(true);
    expect(container.querySelector('.shell')).toBe(shell);
    expect(search.value).toBe('nguy');
    expect(scroller.isConnected && scroller.scrollTop).toBe(420);
    expect(scroller.scrollLeft).toBe(900);
    expect(screen.getAllByText('Nguyễn Thị Hương').length).toBeGreaterThan(0);              // Vietnamese user data untouched

    await switchTo('en');
    expect(screen.getByPlaceholderText('Search customer, phone, tech…')).toBe(search);
    expect(search.value).toBe('nguy');
    expect(document.documentElement.lang).toBe('en');
    expect(calls.slice(before).filter((c) => c.url.includes('/pos/me/language')).map((c) => [c.method, (c.body as any)?.language])).toEqual([['PUT', 'vi'], ['PUT', 'en']]);
    expect(nonLanguageCalls(calls, before)).toEqual([]);                                       // no refetch storm
    // the board is still on the 8th: the next background refresh asks for the 8th, not "today"
    await act(async () => { window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { event: 'appointment_updated', screens: ['booking'] } })); await new Promise((r) => setTimeout(r, 300)); });
    const after = calls.slice(before).filter((c) => c.url.includes('/pos/booking'));
    expect(after.length).toBeGreaterThan(0);
    expect(after.some((c) => c.url.includes('date=2026-06-08'))).toBe(true);
  });

  it('Customer Queue: the open Manage drawer with a half-typed reason and the search survive two switches', async () => {
    const { calls, fetch } = server(); globalThis.fetch = fetch as any;
    renderAt('/queue');
    await screen.findAllByText('Trần Mỹ Linh');
    const search = screen.getByLabelText('Search queue') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'Linh' } });
    await waitFor(() => expect(calls.some((c) => c.url.includes('/pos/queue/state') && c.url.includes('search=Linh'))).toBe(true));
    fireEvent.click(await screen.findByText('Manage'));
    const reason = screen.getByPlaceholderText(/Reason \(required to cancel\)/) as HTMLInputElement;
    fireEvent.change(reason, { target: { value: 'khách về sớm' } });
    await quiet(calls);
    const before = calls.length;

    await switchTo('vi');
    expect(screen.queryByText('Cancel from Queue')).toBeNull();                                // drawer text is Vietnamese now
    expect(screen.getByText(t('pos.cancel_from_queue'))).toBeTruthy();                          // …and the drawer is still open
    expect(reason.isConnected).toBe(true);
    expect(reason.value).toBe('khách về sớm');
    expect(search.isConnected && search.value).toBe('Linh');
    await switchTo('en');
    expect(screen.getByText('Cancel from Queue')).toBeTruthy();
    expect(reason.value).toBe('khách về sớm');
    expect(nonLanguageCalls(calls, before)).toEqual([]);
  });

  it('Checkout with an UNKNOWN card payment: the ticket stays selected, the §35 banner and Verify stay, Complete stays off, and NO charge / retry / verify is sent', async () => {
    const { calls, fetch } = server(); globalThis.fetch = fetch as any;
    renderAt('/checkout');
    await waitFor(() => expect(calls.some((c) => /\/pos\/checkout\/tickets\/t1$/.test(c.url))).toBe(true));
    fireEvent.click(await screen.findByText('Complete Checkout'));
    await screen.findByText('Verify Payment');
    const banner = screen.getByTestId('payment-unknown-banner');
    expect(banner.textContent).toContain('Payment status is uncertain. Do not pay again. Verify the transaction first.');   // §35, exact
    const complete = screen.getByText('Complete Checkout').closest('button') as HTMLButtonElement;
    expect(complete.disabled).toBe(true);                                                      // new tender blocked (§108)
    await quiet(calls);
    const before = calls.length;
    const charges = () => calls.filter((c) => c.method === 'POST' && /\/pay\//.test(c.url)).length;
    const chargesBefore = charges();
    expect(chargesBefore).toBe(1);

    await switchTo('vi');
    expect(screen.queryByText('Verify Payment')).toBeNull();
    expect(screen.getByText(t('payment.unknown.verifyPayment'))).toBeTruthy();                  // Verify is still offered
    expect(screen.getByTestId('payment-unknown-banner')).toBe(banner);                           // same banner node, not rebuilt
    expect(banner.textContent).toContain('Trạng thái thanh toán chưa xác định. Không thanh toán lại. Hãy kiểm tra giao dịch trước.');
    expect(complete.isConnected && complete.disabled).toBe(true);                                // still blocked, same button
    expect(screen.getByTestId('checkout-note').textContent).toBe(t('payment.terminal.unknown', { reason: '' })); // the Compact's UNKNOWN note re-reads in VI
    fireEvent.click(complete);                                                                   // a disabled button sends nothing
    await switchTo('en');
    await switchTo('vi');
    await switchTo('en');
    expect(screen.getByText('Verify Payment')).toBeTruthy();
    expect(banner.textContent).toContain('Payment status is uncertain.');
    expect(complete.disabled).toBe(true);
    expect(screen.getAllByText('Jessica Miller').length).toBeGreaterThan(0);                    // still the selected ticket
    expect(screen.getAllByText('$128.40').length).toBeGreaterThan(0);                           // same amount
    expect(charges()).toBe(chargesBefore);                                                      // no new payment intent / retry
    expect(calls.slice(before).filter((c) => /\/verify|\/pay\//.test(c.url))).toEqual([]);     // no verify either
    expect(nonLanguageCalls(calls, before)).toEqual([]);
  });

  it('§115: 10 switches open no new realtime connection and leave the listener count unchanged', async () => {
    const live = listenerCounter();
    const { calls, fetch } = server(); globalThis.fetch = fetch as any;
    renderAt('/booking');
    await screen.findAllByText('Nguyễn Thị Hương');
    await quiet(calls);
    const listeners = live(), connects = rt.connects, sources = eventSources, before = calls.length;
    expect(connects).toBeGreaterThan(0);                                                        // the screen did subscribe
    for (let i = 0; i < 10; i++) await switchTo(i % 2 === 0 ? 'vi' : 'en');
    expect(getLanguage()).toBe('en');
    expect(live()).toEqual(listeners);
    expect(rt.connects).toBe(connects);
    expect(eventSources).toBe(sources);
    expect(nonLanguageCalls(calls, before)).toEqual([]);
    expect(calls.slice(before).filter((c) => c.url.includes('/pos/me/language'))).toHaveLength(10);
  });

  it('the sidebar follows the switch in place: labels from the import-time table read Vietnamese, an open group stays open', async () => {
    const { fetch } = server(); globalThis.fetch = fetch as any;
    const { container } = renderAt('/booking');
    await screen.findAllByText('Nguyễn Thị Hương');
    const nav = container.querySelector('nav.nav') as HTMLElement;
    await waitFor(() => expect(within(nav).getByText('Booking')).toBeTruthy());
    const group = within(nav).getByRole('button', { name: /CUSTOMERS/ });
    fireEvent.click(group);
    expect(group.getAttribute('aria-expanded')).toBe('true');
    const bookingLink = within(nav).getByText('Booking');
    await switchTo('vi');
    expect(within(nav).queryByText('Booking')).toBeNull();
    expect(within(nav).getByText(t('pos.booking'))).toBe(bookingLink);                          // same node, new words
    expect(within(nav).getByText(t('pos.customer_queue'))).toBeTruthy();
    expect(within(nav).getByText('HÔM NAY')).toBeTruthy();                                       // section titles too
    expect(group.isConnected && group.getAttribute('aria-expanded')).toBe('true');               // still open (stable id)
    expect(screen.getByText('Tiệm Nail Hương')).toBeTruthy();
    await switchTo('en');
    expect(within(nav).getByText('Booking')).toBe(bookingLink);
    expect(within(nav).getByText('TODAY')).toBeTruthy();
  });
});
