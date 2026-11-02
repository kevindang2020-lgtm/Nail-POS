// POSCheckoutScreen.unknown-language.test — English + Vietnamese POS mandate §34, §35, §105, §108 (build plan WP-D2).
//   • an UNKNOWN card payment shows the §35 banner in the mandate's exact words, in both languages;
//   • Complete Checkout (and the Take Payment quick action) stay blocked while it is UNKNOWN, and a language switch
//     neither unblocks them nor sends a pay / verify request;
//   • banners are stored as keys: a note set in English re-reads in Vietnamese after the switch;
//   • the selected ticket is in the URL (?ticket=) — a reload comes back to the same ticket;
//   • every payment status label and every checkout / payment error code renders in English and in Vietnamese.
// The screen is mounted under a root that subscribes to the language, as POSRoutes does in the app (WP-B).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { ERROR_REGISTRY } from '@aipowersalon/api-contracts';
import { setLanguage, useLanguage, t } from '@aipowersalon/mobile-sdk/i18n';
import '../i18n';
import { POSCheckoutScreen } from './POSCheckoutScreen';
import { statusLabel } from '../i18n/status-label';
import { errorText } from '../i18n/error-text';
import { STATUS_EN } from '../i18n/ns/status.en';
import { STATUS_VI } from '../i18n/ns/status.vi';

const settings = { cardEnabled: true, cashEnabled: true, giftCardEnabled: true, splitPaymentEnabled: true, cardSurchargeEnabled: false, cardSurchargePercent: 0, taxRatePercent: 7, tipsEnabled: true, defaultTipPercents: [15, 18, 20], allowCustomTip: true, allowNoTip: true, customerDisplayMode: 'review_only', fiservStatus: 'not_configured' };
const kpis = { ticketsReadyForPayment: 2, subtotalCents: 0, tipsTodayCents: 0, cardSurchargeCollectedCents: 0, taxCollectedCents: 0, paidTicketsToday: 0, failedPaymentsToday: 0, customerDisplayActiveSessions: 0, receiptDeliveryRatePercent: 0, averageCheckoutSeconds: 0, giftCardLoyaltyRedemptionsCents: 0, upsellCapturePercent: 0 };
const row = (id: string, name: string, status = 'ready_for_payment') => ({ ticketId: id, ticketNumber: id.toUpperCase(), customerName: name, isVip: false, serviceCount: 1, totalDueCents: 12840, status, primaryTechnicianName: 'Samantha' });
const detail = (id: string, name: string) => ({
  ticketId: id, ticketNumber: id.toUpperCase(), customer: { fullName: name, isVip: false }, stationLabel: 'Station 1',
  completedServices: [{ serviceLineId: 'l1', serviceName: 'Gel Manicure', technicianName: 'Samantha', priceCents: 12000 }],
  totals: { subtotalCents: 12000, tipCents: 0, taxCents: 840, surchargeCents: 0, totalDueCents: 12840, paymentMethod: 'card' },
  status: 'ready_for_payment', receiptDeliveryOptions: { sms: false, email: false, app: false, print: false },
});

type Call = { method: string; url: string };
function server(opts: { tickets?: ReturnType<typeof row>[]; verify?: unknown } = {}) {
  const calls: Call[] = [];
  const names: Record<string, string> = { t1: 'Jessica Miller', t2: 'Nguyễn Thị Hương' };
  const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url); const method = (init?.method as string) || 'GET';
    calls.push({ method, url: u });
    const ok = (j: unknown) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => j, text: async () => JSON.stringify(j) }) as unknown as Response;
    if (/\/pay\/card\/verify/.test(u)) return ok(opts.verify ?? { status: 'pending', retryAfterSeconds: 45 });
    if (/\/pay\/card$/.test(u)) return ok({ status: 'processing' });             // the answer was lost: UNKNOWN
    const m = /\/pos\/checkout\/tickets\/([^/?]+)$/.exec(u);
    if (m) return ok(detail(m[1], names[m[1]] ?? m[1]));
    if (u.includes('/pos/checkout/state')) return ok({ kpisFull: kpis, tickets: { items: opts.tickets ?? [row('t1', 'Jessica Miller'), row('t2', 'Nguyễn Thị Hương')], pagination: { totalItems: 2 } }, paymentSettings: settings, customerDisplay: { pairedDevices: [], activeSession: null } });
    return ok({});
  });
  return { calls, fetch };
}
const charges = (calls: Call[]) => calls.filter((c) => c.method === 'POST' && /\/pay\//.test(c.url) && !/\/verify/.test(c.url));
const verifies = (calls: Call[]) => calls.filter((c) => /\/verify/.test(c.url));

function Probe() { const l = useLocation(); return <output data-testid="loc">{l.search}</output>; }
// like POSRoutes: the route elements are re-created on a language switch, so the mounted screen UPDATES (keeps its state)
function Root() { useLanguage(); return <Routes><Route path="/checkout" element={<><POSCheckoutScreen /><Probe /></>} /></Routes>; }
const mount = (path = '/checkout') => render(<MemoryRouter initialEntries={[path]}><Root /></MemoryRouter>);
const switchTo = async (l: 'en' | 'vi') => { await act(async () => { await setLanguage(l); }); };

beforeEach(async () => { vi.restoreAllMocks(); await setLanguage('en'); });
afterEach(async () => { await setLanguage('en'); });

async function makeUnknown(calls: Call[]) {
  await waitFor(() => expect(calls.some((c) => /\/tickets\/t1$/.test(c.url))).toBe(true));
  fireEvent.click(await screen.findByText('Complete Checkout'));
  await screen.findByTestId('payment-unknown-banner');
}

describe('UNKNOWN card payment (§35, §108)', () => {
  it('the banner carries the mandate wording in English and Vietnamese; Complete Checkout stays blocked across switches; nothing is charged or verified', async () => {
    const { calls, fetch } = server(); globalThis.fetch = fetch as any;
    mount();
    await makeUnknown(calls);
    const banner = screen.getByTestId('payment-unknown-banner');
    expect(banner.textContent).toContain('Payment status is uncertain.');
    expect(banner.textContent).toContain('Do not pay again.');
    expect(banner.textContent).toContain('Verify the transaction first.');
    expect(screen.getByRole('button', { name: 'Verify Payment' })).toBeTruthy();
    const complete = screen.getByText('Complete Checkout').closest('button') as HTMLButtonElement;
    expect(complete.disabled).toBe(true);
    expect(complete.title).toBe('Verify the payment before completing checkout.');
    const charged = charges(calls).length;
    expect(charged).toBe(1);

    // the Take Payment quick action is refused too (no request), with the reason
    fireEvent.click(screen.getByText('Take Payment'));
    expect(screen.getByTestId('checkout-note').textContent).toBe('Verify the payment before completing checkout.');
    expect(charges(calls)).toHaveLength(charged);

    await switchTo('vi');
    expect(screen.getByTestId('payment-unknown-banner')).toBe(banner);
    expect(banner.textContent).toContain('Trạng thái thanh toán chưa xác định.');
    expect(banner.textContent).toContain('Không thanh toán lại.');
    expect(banner.textContent).toContain('Hãy kiểm tra giao dịch trước.');
    expect(screen.getByRole('button', { name: 'Kiểm tra thanh toán' })).toBeTruthy();
    expect(complete.isConnected).toBe(true);
    expect(complete.disabled).toBe(true);
    expect(complete.title).toBe('Hãy kiểm tra thanh toán trước khi hoàn tất thanh toán.');
    // the note that was set in English is a key — it reads Vietnamese now (§105)
    expect(screen.getByTestId('checkout-note').textContent).toBe('Hãy kiểm tra thanh toán trước khi hoàn tất thanh toán.');
    fireEvent.click(screen.getByText(t('pos.take_payment')));
    fireEvent.click(complete);

    await switchTo('en'); await switchTo('vi'); await switchTo('en');
    expect(complete.disabled).toBe(true);
    expect(banner.textContent).toContain('Payment status is uncertain.');
    expect(screen.getAllByText('$128.40').length).toBeGreaterThan(0);                // the amount is unchanged
    expect(screen.getAllByText('Jessica Miller').length).toBeGreaterThan(0);        // the same ticket
    expect(charges(calls)).toHaveLength(charged);                                    // no pay / retry
    expect(verifies(calls)).toHaveLength(0);                                         // and no verify
  });

  it('Verify Payment asks once; a "pending" answer keeps the banner and blocking, and its note follows the language', async () => {
    const { calls, fetch } = server({ verify: { status: 'pending', retryAfterSeconds: 45 } }); globalThis.fetch = fetch as any;
    mount();
    await makeUnknown(calls);
    fireEvent.click(screen.getByRole('button', { name: 'Verify Payment' }));
    await waitFor(() => expect(screen.getByTestId('checkout-note').textContent).toBe('The processor has no record yet. Verify again in about 45 seconds — do not charge again.'));
    expect(verifies(calls)).toHaveLength(1);
    expect(screen.getByTestId('payment-unknown-banner')).toBeTruthy();
    expect((screen.getByText('Complete Checkout').closest('button') as HTMLButtonElement).disabled).toBe(true);
    await switchTo('vi');
    expect(screen.getByTestId('checkout-note').textContent).toBe('Đơn vị xử lý chưa có ghi nhận. Kiểm tra lại sau khoảng 45 giây — không thu tiền lại.');
    expect(verifies(calls)).toHaveLength(1);
    expect(charges(calls)).toHaveLength(1);
  });

  it('an APPROVED verification clears the UNKNOWN state and re-enables Complete Checkout', async () => {
    const { calls, fetch } = server({ verify: { status: 'approved' } }); globalThis.fetch = fetch as any;
    mount();
    await makeUnknown(calls);
    fireEvent.click(screen.getByRole('button', { name: 'Verify Payment' }));
    await waitFor(() => expect(screen.queryByTestId('payment-unknown-banner')).toBeNull());
    expect(screen.getByTestId('checkout-note').textContent).toMatch(/confirms the payment was APPROVED/);
    expect((screen.getByText('Complete Checkout').closest('button') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('the selected ticket survives a reload (§105: ?ticket= in the URL)', () => {
  it('selecting a ticket writes ?ticket= and a reload at that URL opens the same ticket, not the first one', async () => {
    const a = server(); globalThis.fetch = a.fetch as any;
    const first = mount();
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('?ticket=t1'));   // the auto-selected first ticket
    fireEvent.click(screen.getAllByText('Nguyễn Thị Hương')[0]);
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('?ticket=t2'));
    first.unmount();

    const b = server(); globalThis.fetch = b.fetch as any;                          // "reload"
    mount('/checkout?ticket=t2');
    await waitFor(() => expect(b.calls.some((c) => /\/tickets\/t2$/.test(c.url))).toBe(true));
    await screen.findByText('Checkout Workspace');
    expect(b.calls.some((c) => /\/tickets\/t1$/.test(c.url))).toBe(false);           // it did not jump to the first ticket
    expect(screen.getByTestId('loc').textContent).toBe('?ticket=t2');
  });
});

describe('every payment status and payment error renders in both languages (§34, §62, §22)', () => {
  const PAYMENT_DOMAINS = ['payment', 'paymentAttempt', 'paymentIntent', 'paymentMethod', 'refund', 'terminal', 'gateway', 'checkoutTicket', 'drawer'];
  const keys = Object.keys(STATUS_EN).filter((k) => PAYMENT_DOMAINS.includes(k.split('.')[1]));

  it('each payment status label has English and Vietnamese, and statusLabel shows the one for the language', async () => {
    expect(keys.length).toBeGreaterThan(100);
    for (const k of keys) { const [, d, c] = k.split('.'); expect(statusLabel(d, c), k).toBe((STATUS_EN as Record<string, string>)[k]); }
    await setLanguage('vi');
    for (const k of keys) { const [, d, c] = k.split('.'); expect(statusLabel(d, c), k).toBe((STATUS_VI as Record<string, string>)[k]); }
  });

  it('each checkout / payment error code has English and Vietnamese text', async () => {
    const codes = Object.entries(ERROR_REGISTRY).filter(([, d]) => d.domain === 'checkout' || d.domain === 'payments').map(([c]) => c);
    expect(codes.length).toBeGreaterThan(20);
    for (const c of codes) expect(errorText(c), c).toBe((ERROR_REGISTRY as Record<string, { message: string }>)[c].message);
    await setLanguage('vi');
    for (const c of codes) { const v = errorText(c, null, 'FALLBACK'); expect(v, c).not.toBe('FALLBACK'); expect(v, c).not.toBe((ERROR_REGISTRY as Record<string, { message: string }>)[c].message); }
  });

  it('the checkout board chips show every board status in the cashier\'s language', async () => {
    const codes = ['ready_for_payment', 'waiting_payment', 'payment_in_progress', 'split', 'failed', 'reopened', 'on_hold'];
    const { fetch } = server({ tickets: codes.map((c, i) => row(`t${i + 1}`, `Guest ${i + 1}`, c)) }); globalThis.fetch = fetch as any;
    mount();
    await screen.findByText('Guest 7');
    for (const c of codes) expect(screen.getAllByText(statusLabel('checkoutTicket', c)).length, c).toBeGreaterThan(0);
    await switchTo('vi');
    for (const c of codes) {
      const vi = (STATUS_VI as Record<string, string>)[`status.checkoutTicket.${c}`];
      expect(screen.getAllByText(vi).length, c).toBeGreaterThan(0);
    }
  });
});
