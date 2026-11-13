import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSCheckoutScreen } from './POSCheckoutScreen';
import { expectNoA11yViolations } from '@aipowersalon/testing/a11y';   // §220 (Oct 21 2026): axe over the rendered screen

const checkoutState = {
  kpisFull: { ticketsReadyForPayment: 0, subtotalCents: 0, tipsTodayCents: 0, cardSurchargeCollectedCents: 0, taxCollectedCents: 0, paidTicketsToday: 0, failedPaymentsToday: 0, customerDisplayActiveSessions: 0, receiptDeliveryRatePercent: 0, averageCheckoutSeconds: 0, giftCardLoyaltyRedemptionsCents: 0, upsellCapturePercent: 0 },
  tickets: { items: [], pagination: { totalItems: 0 } },
  paymentSettings: { cardEnabled: true, cashEnabled: true, giftCardEnabled: true, splitPaymentEnabled: true, cardSurchargeEnabled: false, cardSurchargePercent: 0, taxRatePercent: 7, tipsEnabled: true, defaultTipPercents: [15, 18, 20], allowCustomTip: true, allowNoTip: true, customerDisplayMode: 'review_only', fiservStatus: 'sandbox' },
  customerDisplay: { pairedDevices: [], activeSession: null },
};
const mockFetch = (state: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => state, headers: { get: () => null } } as any));

beforeEach(() => { vi.restoreAllMocks(); });

describe('POSCheckoutScreen', () => {

  it('mounts past loading and renders the checkout board + empty state', async () => {
    globalThis.fetch = mockFetch(checkoutState) as any;
    render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    expect(await screen.findByText('Checkout')).toBeInTheDocument();
    expect(screen.getByText('No guests ready for checkout.')).toBeInTheDocument();
    // T09 added modules
    expect(screen.getByText(/Transactions Needing Attention/)).toBeInTheDocument();
    expect(screen.getByText('Available Front Desk / Ready Technicians')).toBeInTheDocument();
    expect(screen.getByText(/Revenue Trend/)).toBeInTheDocument();
    expect(screen.getByText(/Payment Mix/)).toBeInTheDocument();
    expect(screen.getByText('Potential Revenue in Queue')).toBeInTheDocument();
    expect(screen.getByText('New Checkout')).toBeInTheDocument();
    expect(screen.getByText('Checkout Queue')).toBeInTheDocument();
    expect(screen.getByText('Checkout Workspace')).toBeInTheDocument();
  });

  it('§220: the checkout board has no accessibility violations (axe)', async () => {
    globalThis.fetch = mockFetch(checkoutState) as any;
    const { container } = render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    await screen.findByText('No guests ready for checkout.');
    await expectNoA11yViolations(container);
  });

  it('renders reference KPIs (real revenue/tips) + AI Checkout Insights', async () => {
    const withData = {
      kpisFull: { ticketsReadyForPayment: 4, subtotalCents: 528730, tipsTodayCents: 124800, cardSurchargeCollectedCents: 2200, taxCollectedCents: 36000, paidTicketsToday: 27, failedPaymentsToday: 2, customerDisplayActiveSessions: 1, receiptDeliveryRatePercent: 88, averageCheckoutSeconds: 138, giftCardLoyaltyRedemptionsCents: 15500, upsellCapturePercent: 41 },
      tickets: { items: [
        { ticketId: 't1', ticketNumber: 'A1', customerName: 'Jessica Miller', isVip: true, serviceCount: 2, totalDueCents: 13422, status: 'ready', primaryTechnicianName: 'Samantha' },
      ], pagination: { totalItems: 1 } },
      attention: [{ type: 'Failed Receipt', guest: 'Jessica Miller', issue: 'Receipt not delivered by sms', time: '10:12 AM', ticketId: 't1', severity: 'warn' }],
      paymentSettings: checkoutState.paymentSettings,
      customerDisplay: { pairedDevices: [], activeSession: null },
    };
    globalThis.fetch = mockFetch(withData) as any;
    render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    expect(await screen.findByText('Checkout')).toBeInTheDocument();
    expect(screen.getByText("Today's Revenue")).toBeInTheDocument();
    expect(screen.getAllByText('$5,287.30').length).toBeGreaterThan(0);
    expect(screen.getByText('Tips Captured')).toBeInTheDocument();
    expect(screen.getByText('AI Checkout Insights')).toBeInTheDocument();
    // Checkout One-Screen mandate §54 (Oct 28 2026): the receipt insight now counts the real failed receipt sends (attention
    // rows) — it used to word failedPaymentsToday (failed PAYMENTS) as failed receipts
    expect(screen.getByText(/Receipts that failed to send: 1/)).toBeInTheDocument();
    expect(screen.getByText('Receipt Delivery Rate')).toBeInTheDocument();
    expect(screen.getByText('88%')).toBeInTheDocument();
    expect(screen.getByText('Avg Checkout Time')).toBeInTheDocument();
    expect(screen.getByText('2m 18s')).toBeInTheDocument();
    expect(screen.getByText('Gift Card / Loyalty Redemptions')).toBeInTheDocument();
    expect(screen.getByText('$155.00')).toBeInTheDocument();
    expect(screen.getByText('Upsell at Checkout')).toBeInTheDocument();
    expect(screen.getByText('41%')).toBeInTheDocument();
  });
});

// ── 2026-07-03 wiring-lock coverage: the two header filters (previously a dead no-op + a disconnected status
// select) now drive a real server refetch; plus the money-path workspace (tip, discount, cash change, card
// configured:false, split sum-validation). Payment-processor isolation is preserved (no fake capture).
import { fireEvent, within, waitFor } from '@testing-library/react';

const ticket = (over: any = {}) => ({ ticketId: 't1', ticketNumber: 'A1', customerName: 'Jessica Miller', isVip: false, serviceCount: 2, totalDueCents: 13422, status: 'ready_for_payment', primaryTechnicianName: 'Samantha', ...over });
const richState = {
  kpisFull: { ticketsReadyForPayment: 3, subtotalCents: 40000, tipsTodayCents: 5000, cardSurchargeCollectedCents: 0, taxCollectedCents: 2800, paidTicketsToday: 10, failedPaymentsToday: 0, customerDisplayActiveSessions: 0, receiptDeliveryRatePercent: 90, averageCheckoutSeconds: 120, giftCardLoyaltyRedemptionsCents: 0, upsellCapturePercent: 0 },
  tickets: { items: [ticket()], pagination: { totalItems: 1 } },
  paymentSettings: { cardEnabled: true, cashEnabled: true, giftCardEnabled: true, splitPaymentEnabled: true, cardSurchargeEnabled: false, cardSurchargePercent: 0, taxRatePercent: 7, tipsEnabled: true, defaultTipPercents: [15, 18, 20], allowCustomTip: true, allowNoTip: true, customerDisplayMode: 'review_only', fiservStatus: 'not_configured' },
  customerDisplay: { pairedDevices: [], activeSession: null },
};
const detail = (over: any = {}) => ({
  ticketId: 't1', ticketNumber: 'A1', customer: { fullName: 'Jessica Miller', isVip: false },
  stationLabel: 'Station 1',
  completedServices: [{ serviceLineId: 'l1', serviceName: 'Gel Manicure', technicianName: 'Samantha', priceCents: 6500 }],
  totals: { subtotalCents: 12000, tipCents: 0, taxCents: 840, surchargeCents: 0, totalDueCents: 12840, paymentMethod: 'card' },
  status: 'ready_for_payment', receiptDeliveryOptions: { sms: false, email: false, app: false, print: false },
  ...over,
});

// Records every request; serves state, ticket detail, and payment endpoints. payResult lets a test control pay/*.
const coFetch = (opts: { payResult?: any; detailOver?: any } = {}) => {
  const calls: { url: string; method: string; body?: any }[] = [];
  const fn = vi.fn(async (url: any, init?: any) => {
    const u = String(url); const method = init?.method || 'GET';
    let body: any; try { body = init?.body ? JSON.parse(init.body) : undefined; } catch { /* */ }
    calls.push({ url: u, method, body });
    const ok = (j: any) => ({ ok: true, status: 200, json: async () => j, headers: { get: () => null } } as any);
    if (u.includes('/pos/checkout/terminals')) return ok([{ id: 'term_1', label: 'Front Compact', stationId: null, disabled: false, lastSeenAt: null, hsnConfigured: true }]);
    if (u.includes('/pos/checkout/tickets/') && /\/pay\//.test(u)) return ok(opts.payResult ?? { status: 'submitted' });
    if (u.includes('/pos/checkout/tickets/') && /\/(apply-tip|apply-discount|recalculate|receipt)/.test(u)) return ok({ ok: true });
    if (u.match(/\/pos\/checkout\/tickets\/[^/?]+$/)) return ok(detail(opts.detailOver));
    if (u.includes('/pos/checkout/state')) return ok(richState);
    return ok({});
  });
  (fn as any).calls = calls;
  return fn;
};

beforeEach(() => { vi.restoreAllMocks(); });

describe('POSCheckoutScreen — header filters drive a real server refetch', () => {
  // SCAN (Oct 12): the header carried a frozen mockup button "Today, May 06" with no handler. It is now a plain label
  // with the real date (asserted shape-only — no test may depend on today's date).
  it('the date chip is a label of the current day, not a dead button with a frozen mockup date', async () => {
    const f = coFetch(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    await screen.findByText('Checkout');
    expect(screen.queryByRole('button', { name: /^Today,/ })).toBeNull();
    expect(screen.getByLabelText('Checkout date').textContent).toMatch(/^Today, \S+ \d{2}$/);
  });
  it('the payment-type filter is a real control and refetches with paymentMethod=', async () => {
    const f = coFetch(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    await screen.findByText('Checkout');
    const sel = screen.getByLabelText('Payment type filter') as HTMLSelectElement;
    expect(sel.tagName).toBe('SELECT');
    fireEvent.change(sel, { target: { value: 'gift_card' } });
    await waitFor(() => {
      expect((f as any).calls.some((c: any) => c.url.includes('/pos/checkout/state') && c.url.includes('paymentMethod=gift_card'))).toBe(true);
    });
  });
  it('the status filter refetches with status=', async () => {
    const f = coFetch(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    await screen.findByText('Checkout');
    // the status select is the one whose default option is "Active Checkout"
    const statusSel = Array.from(document.querySelectorAll('select')).find((el) => within(el).queryByText('Active Checkout')) as HTMLSelectElement;
    fireEvent.change(statusSel, { target: { value: 'paid' } });
    await waitFor(() => {
      expect((f as any).calls.some((c: any) => c.url.includes('/pos/checkout/state') && c.url.includes('status=paid'))).toBe(true);
    });
  });
});

describe('POSCheckoutScreen — money-path workspace (auto-selected ticket)', () => {
  it('shows a Gift card line in the totals when the ticket sells a gift card', async () => {
    const f = coFetch({ detailOver: { totals: { subtotalCents: 12000, tipCents: 0, taxCents: 840, surchargeCents: 0, giftCardChargeCents: 5000, totalDueCents: 17840, paymentMethod: 'card' } } }); globalThis.fetch = f as any;
    render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    await screen.findByText('Checkout');
    await waitFor(() => expect((f as any).calls.some((c: any) => c.url.match(/\/pos\/checkout\/tickets\/t1$/))).toBe(true));
    expect(await screen.findByText('Gift card')).toBeInTheDocument();
    expect(screen.getByText('$178.40')).toBeInTheDocument();
  });

  it('wave 4 PILOT: an unpaid ticket\'s totals add up on screen — the card surcharge has its own line, and the bottom line says Total Due (not "Total Paid")', async () => {
    const f = coFetch({ detailOver: { totals: { subtotalCents: 7000, tipCents: 0, taxCents: 464, surchargeCents: 224, totalDueCents: 7688, paymentMethod: 'card' } } }); globalThis.fetch = f as any;
    render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    await screen.findByText('Checkout');
    expect(await screen.findByText('Card surcharge')).toBeInTheDocument();
    expect(screen.getByText('$2.24')).toBeInTheDocument();
    expect(screen.getByText('Total Due')).toBeInTheDocument();
    expect(screen.queryByText('Total Paid')).toBeNull();
  });

  it('applies a tip percent through the real endpoint', async () => {
    const f = coFetch(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    // the first ready ticket auto-selects → detail loads
    await screen.findByText('Checkout');
    await waitFor(() => expect((f as any).calls.some((c: any) => c.url.match(/\/pos\/checkout\/tickets\/t1$/))).toBe(true));
    // tip buttons render the default percents; click 20%
    const tipBtn = await screen.findByText('20%');
    fireEvent.click(tipBtn);
    await waitFor(() => {
      const call = (f as any).calls.find((c: any) => c.url.includes('/tickets/t1/apply-tip') && c.method === 'POST');
      expect(call).toBeTruthy();
      expect(call.body).toMatchObject({ tipType: 'percent', tipPercent: 20, source: 'front_desk' });
    });
  });

  // Sep 2026 redesign: the developer REMOVED the unwired follow-up toggles (rebook / save card on file / thank-you) rather
  // than showing them disabled. The rule this test guards is unchanged: no control may pretend to do something the system
  // doesn't — so no enabled 'save card', 'rebook next visit' or 'thank-you' toggle may appear.
  it('offers no fake follow-up toggles (the unwired ones are gone, not shown as working)', async () => {
    const f = coFetch(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    await screen.findByText('Checkout');
    await waitFor(() => expect((f as any).calls.some((c: any) => c.url.match(/\/pos\/checkout\/tickets\/t1$/))).toBe(true));
    for (const name of [/save card on file/i, /rebook next visit/i, /thank-you|thank you message/i]) {
      const controls = [...screen.queryAllByRole('checkbox', { name }), ...screen.queryAllByRole('switch', { name })];
      expect(controls.filter((c) => !(c as HTMLInputElement).disabled), String(name)).toHaveLength(0);
    }
  });

  it('Functional Decision 22: a card charge whose answer was lost shows "Verify Payment" (never "pay again"), and shows the processor\'s answer', async () => {
    const f = coFetch({ payResult: { status: 'unknown', next: 'verify', message: 'the terminal did not answer' } }); globalThis.fetch = f as any;
    const base = f.getMockImplementation()!;
    f.mockImplementation(async (url: any, init?: any) => {
      if (String(url).includes('/pay/card/verify')) {
        (f as any).calls.push({ url: String(url), method: init?.method || 'GET' });
        return { ok: true, status: 200, json: async () => ({ status: 'approved', paymentId: 'p1', ticketId: 't1', processorTransactionId: 'RET-9', approvedAmountCents: 12840 }), headers: { get: () => null } } as any;
      }
      return base(url, init);
    });
    render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    await screen.findByText('Checkout');
    await waitFor(() => expect((f as any).calls.some((c: any) => c.url.match(/\/tickets\/t1$/))).toBe(true));
    fireEvent.click(await screen.findByText('Complete Checkout'));
    expect(await screen.findByText(/UNKNOWN — VERIFY/)).toBeInTheDocument();
    const verify = await screen.findByText('Verify Payment');
    const charges = (f as any).calls.filter((c: any) => /\/pay\/(card|terminal)$/.test(c.url)).length;
    fireEvent.click(verify);
    expect(await screen.findByText(/confirms the payment was APPROVED/)).toBeInTheDocument();
    expect((f as any).calls.filter((c: any) => /\/pay\/(card|terminal)$/.test(c.url)).length).toBe(charges);   // verifying never charged again
    await waitFor(() => expect(screen.queryByText('Verify Payment')).toBeNull());
  });

  it('card payment surfaces an unconfigured processor honestly (no fake capture)', async () => {
    const f = coFetch({ payResult: { status: 'unavailable', next: 'retry', message: 'Card processor is not configured yet.' } });
    globalThis.fetch = f as any;
    render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    await screen.findByText('Checkout');
    await waitFor(() => expect((f as any).calls.some((c: any) => c.url.match(/\/tickets\/t1$/))).toBe(true));
    const pay = await screen.findByText('Complete Checkout');
    fireEvent.click(pay);
    await waitFor(() => {
      expect((f as any).calls.some((c: any) => c.url.includes('/tickets/t1/pay/terminal') && c.method === 'POST')).toBe(true);
    });
    expect(await screen.findByText(/not configured yet/)).toBeInTheDocument();
  });
});

// ── 2026-07-03 wire the previously-dead capabilities that had endpoints but no UI trigger: the primary Payment
// Method selector (card/cash/gift) with cash-amount + gift-code inputs, the No-Tip button, the manual discount
// input, and the customer-display send/clear controls.
const coFetch2 = () => {
  const calls: { url: string; method: string; body?: any; idemKey?: string | null }[] = [];
  const fn = vi.fn(async (url: any, init?: any) => {
    const u = String(url); const method = init?.method || 'GET';
    let body: any; try { body = init?.body ? JSON.parse(init.body) : undefined; } catch { /* */ }
    calls.push({ url: u, method, body, idemKey: new Headers(init?.headers).get('Idempotency-Key') });
    const ok = (j: any) => ({ ok: true, status: 200, json: async () => j, headers: { get: () => null } } as any);
    if (u.includes('/pos/checkout/tickets/') && /\/pay\//.test(u)) return ok({ status: 'submitted', changeDueCents: 158, remainingDueCents: 0, giftRemainingCents: 2000 });
    if (u.includes('/pos/checkout/tickets/') && /\/(apply-tip|apply-discount|recalculate|receipt|customer-display)/.test(u)) return ok({ ok: true });
    if (u.includes('/customer-display/sessions/')) return ok({ ok: true });
    // 23-inch spec §81: the branch's customer displays — one online, shared display (the card and To Display use it)
    if (u.includes('/pos/customer-displays')) return ok({ branchId: 'b1', canManage: false, stations: [], devices: [{ deviceId: 'disp1', name: 'Front Display #1', branchId: 'b1', branchName: 'Main', pairing: 'shared', stationId: null, stationName: null, state: 'ADVERTISEMENT', online: true, maintenance: false, lastSeenAt: new Date().toISOString(), mode: 'advertisement', appVersion: '0.1.0', screen: null, profile: null, session: null, pairedAt: null, awaitingPickup: false }] });
    if (u.match(/\/pos\/checkout\/tickets\/[^/?]+$/)) return ok(detail());
    if (u.includes('/pos/checkout/state')) return ok(richState);
    return ok({});
  });
  (fn as any).calls = calls;
  return fn;
};

describe('POSCheckoutScreen — payment method selector + inputs (were unreachable)', () => {
  it('choosing Cash reveals the cash-received input and pays cash', async () => {
    const f = coFetch2(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    await screen.findByText('Checkout');
    await waitFor(() => expect((f as any).calls.some((c: any) => c.url.match(/\/tickets\/t1$/))).toBe(true));
    // Payment Method selector renders card/cash/gift as buttons; pick Cash (a button, not the filter <option>)
    const cashBtn = (await screen.findAllByText('Cash')).find((el) => el.tagName === 'BUTTON')!;
    fireEvent.click(cashBtn);
    const cashInput = await screen.findByLabelText('Cash received');
    fireEvent.change(cashInput, { target: { value: '150.00' } });
    fireEvent.click(screen.getByText('Complete Checkout'));
    await waitFor(() => expect((f as any).calls.some((c: any) => c.url.includes('/tickets/t1/pay/cash') && c.method === 'POST')).toBe(true));
    // Constitution 5 §61–66: the payment carries an Idempotency-Key the server accepts (8–200 of [A-Za-z0-9_-:.])
    const pay = (f as any).calls.find((c: any) => c.url.includes('/tickets/t1/pay/cash') && c.method === 'POST');
    expect(pay.idemKey).toMatch(/^[A-Za-z0-9_\-:.]{8,200}$/);
  });

  it('split tender preview: allocation by tender and what is still due, before any payment is taken', async () => {
    const f = coFetch2(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    await screen.findByText('Checkout');
    await waitFor(() => expect((f as any).calls.some((c: any) => c.url.match(/\/tickets\/t1$/))).toBe(true));
    fireEvent.click(await screen.findByText('Enable split payment'));
    const box = await screen.findByTestId('split-preview');
    expect(screen.getByTestId('split-prev-remaining').textContent).toMatch(/Matches the amount due/);   // one card segment = the full due
    fireEvent.click(screen.getByText('+ Add tender'));
    expect(screen.getByTestId('split-prev-invalid').textContent).toMatch(/1 tender amounts/);
    expect(box.textContent).toMatch(/nothing is charged/);
    expect((f as any).calls.some((c: any) => c.url.includes('/pay/') && c.method === 'POST')).toBe(false);   // a preview never pays
  });
  it('choosing Gift Card reveals the code input and pays by gift card', async () => {
    const f = coFetch2(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    await screen.findByText('Checkout');
    await waitFor(() => expect((f as any).calls.some((c: any) => c.url.match(/\/tickets\/t1$/))).toBe(true));
    fireEvent.click((await screen.findAllByText('Gift Card')).find((el) => el.tagName === 'BUTTON')!);
    const code = await screen.findByLabelText('Gift card code');
    expect(code).toHaveAttribute('autocomplete', 'off');   // GIFT CARDS · 06: no redeemable secret in browser autocomplete
    expect(screen.getByLabelText('Gift card PIN')).toHaveAttribute('type', 'password');
    expect(screen.getByTestId('gift-readiness')).toBeInTheDocument();   // Gift Cards · 03: the readiness check sits with the code
    // extras GIFT CARDS 04 (round 10): the customer-card finder opens over the sale and closes back to it (the code typed so far stays)
    fireEvent.change(code, { target: { value: 'GC-1' } });
    fireEvent.click(screen.getByTestId('gc-finder-open'));
    expect(await screen.findByTestId('gc-finder')).toBeInTheDocument();
    fireEvent.click(screen.getAllByText('Close').slice(-1)[0]);
    await waitFor(() => expect(screen.queryByTestId('gc-finder')).toBeNull());
    expect(screen.getByLabelText('Gift card code')).toHaveValue('GC-1');
    fireEvent.change(code, { target: { value: 'GC-123' } });
    fireEvent.click(screen.getByText('Complete Checkout'));
    await waitFor(() => {
      const call = (f as any).calls.find((c: any) => c.url.includes('/tickets/t1/pay/gift-card') && c.method === 'POST');
      expect(call).toBeTruthy();
      expect(call.body).toMatchObject({ giftCardCode: 'GC-123' });
    });
  });

  it('No tip posts tipType:none', async () => {
    const f = coFetch2(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    await screen.findByText('Checkout');
    await waitFor(() => expect((f as any).calls.some((c: any) => c.url.match(/\/tickets\/t1$/))).toBe(true));
    fireEvent.click(await screen.findByText('No tip'));
    await waitFor(() => {
      const call = (f as any).calls.find((c: any) => c.url.includes('/tickets/t1/apply-tip') && c.method === 'POST');
      expect(call).toBeTruthy();
      expect(call.body).toMatchObject({ tipType: 'none' });
    });
  });

  it('manual discount input applies through the real endpoint', async () => {
    const f = coFetch2(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    await screen.findByText('Checkout');
    await waitFor(() => expect((f as any).calls.some((c: any) => c.url.match(/\/tickets\/t1$/))).toBe(true));
    fireEvent.change(await screen.findByLabelText('Discount amount'), { target: { value: '5.00' } });
    fireEvent.click(screen.getByText('Apply'));
    await waitFor(() => {
      const call = (f as any).calls.find((c: any) => c.url.includes('/tickets/t1/apply-discount') && c.method === 'POST');
      expect(call).toBeTruthy();
      expect(call.body).toMatchObject({ discountCents: 500 });
    });
  });

  it('To Display sends the ticket to the customer display', async () => {
    const f = coFetch2(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    await screen.findByText('Checkout');
    await waitFor(() => expect((f as any).calls.some((c: any) => c.url.match(/\/tickets\/t1$/))).toBe(true));
    await screen.findByTestId('customer-display-card');
    fireEvent.click(await screen.findByText('To Display'));
    await waitFor(() => expect((f as any).calls.some((c: any) => /send-to-customer-display/.test(c.url) && c.method === 'POST' && c.body?.stationId === null)).toBe(true));
  });

  it('no customer display connected: To Display is disabled and the card says to continue on the POS (§83)', async () => {
    const base = coFetch2();
    const f: any = vi.fn(async (url: any, init?: any) => (/\/pos\/customer-displays/.test(String(url))
      ? { ok: true, status: 200, json: async () => ({ branchId: 'b1', canManage: false, stations: [], devices: [] }), headers: { get: () => null } }
      : (base as any)(url, init)));
    globalThis.fetch = f;
    render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    expect(await screen.findByTestId('customer-display-detail')).toHaveTextContent('Checkout continues on the POS');
    expect((await screen.findByText('To Display')).closest('button')).toBeDisabled();
    expect(screen.getByText('Complete Checkout').closest('button')).not.toBeDisabled();
  });

  it('a busy customer display (409 DISPLAY_BUSY) shows the reason and never blocks the checkout (Check-In & Display spec §85, §164–§165)', async () => {
    const base = coFetch2();
    const f: any = vi.fn(async (url: any, init?: any) => {
      if (/send-to-customer-display/.test(String(url)) && (init?.method || 'GET') === 'POST') {
        const body = { message: "The customer display is showing another customer's checkout. Continue on the POS, or close that display session first.", code: 'DISPLAY_BUSY',
          error: { code: 'DISPLAY_BUSY', message: "The customer display is showing another customer's checkout. Continue on the POS, or close that display session first.", details: {}, action: 'NONE' } };
        return { ok: false, status: 409, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } } as any;
      }
      return (base as any)(url, init);
    });
    globalThis.fetch = f;
    render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    await screen.findByText('Checkout');
    await screen.findByTestId('customer-display-card');
    await waitFor(() => expect(screen.getByText('To Display').closest('button')).not.toBeDisabled());
    fireEvent.click(screen.getByText('To Display'));
    expect(await screen.findByText(/showing another customer's checkout/)).toBeInTheDocument();
    expect(screen.getByText('Complete Checkout').closest('button')).not.toBeDisabled();   // checkout continues on the POS
  });
});


// ---- Custom Tip keypad (Jul 26, 2026): the spec flow — tap Custom → touch keypad (NO window.prompt) → 1 7 . 5 0
// → Apply → the EXACT cents reach apply-tip. Pins the ASUS-touch replacement for the old prompt() dialog. ----
describe('custom tip keypad', () => {
  it('Custom opens the shared keypad and Apply sends exact cents (17.50 → 1750) to apply-tip', async () => {
    const promptSpy = vi.spyOn(window, 'prompt');
    const f = coFetch(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    await screen.findByText('Checkout');
    await waitFor(() => expect((f as any).calls.some((c: any) => c.url.match(/\/pos\/checkout\/tickets\/t1$/))).toBe(true));
    fireEvent.click(await screen.findByText('Custom'));
    const dialog = await screen.findByRole('dialog', { name: 'Custom Tip' });
    expect(promptSpy).not.toHaveBeenCalled();
    const key = (k: string) => fireEvent.click(within(dialog).getByRole('button', { name: k }));
    key('1'); key('7'); key('.'); key('5'); key('0');
    expect(within(dialog).getByLabelText('tip amount').textContent).toBe('$17.50');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply Tip' }));
    await waitFor(() => {
      const call = (f as any).calls.find((c: any) => c.url.includes('/tickets/t1/apply-tip') && c.method === 'POST');
      expect(call).toBeTruthy();
      expect(call.body).toMatchObject({ tipType: 'custom', tipAmountCents: 1750, source: 'front_desk' });
    });
    promptSpy.mockRestore();
  });

  it('Cancel closes the keypad without any apply-tip request', async () => {
    const f = coFetch(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    await screen.findByText('Checkout');
    await waitFor(() => expect((f as any).calls.some((c: any) => c.url.match(/\/pos\/checkout\/tickets\/t1$/))).toBe(true));
    fireEvent.click(await screen.findByText('Custom'));
    const dialog = await screen.findByRole('dialog', { name: 'Custom Tip' });
    fireEvent.click(within(dialog).getByRole('button', { name: '5' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Custom Tip' })).toBeNull();
    expect((f as any).calls.some((c: any) => c.url.includes('/apply-tip'))).toBe(false);
  });
});

// Kevin, Oct 6 2026: the cardholder signs once, on the Clover card terminal — the viewer says where a signature was taken.
describe('POSCheckoutScreen — View Signature says where the card was signed', () => {
  it.each([['terminal', 'Signed on the card terminal at payment.'], ['customer_display', 'Signed on the customer display at payment.']])('%s → %s', async (capturedOn, words) => {
    const base = coFetch();
    globalThis.fetch = vi.fn(async (url: any, init?: any) => {
      if (String(url).includes('/pos/checkout/tickets/t1/signature')) return { ok: true, status: 200, json: async () => ({ signaturePng: 'data:image/bmp;base64,Qk0=', capturedOn }), headers: { get: () => null } } as any;
      return base(url, init);
    }) as any;
    render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    await screen.findByText('Checkout');
    await waitFor(() => expect((base as any).calls.some((c: any) => c.url.match(/\/pos\/checkout\/tickets\/t1$/))).toBe(true));
    fireEvent.click(await screen.findByText('View Signature'));
    expect(await screen.findByText(words)).toBeInTheDocument();
    expect((screen.getByAltText('Cardholder signature') as HTMLImageElement).src).toContain('data:image/bmp');
  });
});

// Oct 6 2026: Hold Ticket and Move to Front Desk used to show a message and do nothing.
describe('POSCheckoutScreen — Hold Ticket / Resume / Move to Front Desk do something', () => {
  const withRoutes = (over: { status?: string } = {}) => {
    const base = coFetch();
    const state = { ...richState, tickets: { items: [ticket({ status: over.status ?? 'ready_for_payment', station: 'Back Register' })], pagination: { totalItems: 1 } } };
    const fn = vi.fn(async (url: any, init?: any) => {
      const u = String(url); const ok = (j: any) => ({ ok: true, status: 200, json: async () => j, headers: { get: () => null } } as any);
      if (u.includes('/pos/checkout/tickets/t1/hold')) { (fn as any).calls.push({ url: u, method: init?.method }); return ok({ ticketId: 't1', status: 'on_hold' }); }
      if (u.includes('/pos/checkout/tickets/t1/resume')) { (fn as any).calls.push({ url: u, method: init?.method }); return ok({ ticketId: 't1', status: 'ready_for_payment' }); }
      if (u.includes('/pos/checkout/tickets/t1/move')) { (fn as any).calls.push({ url: u, method: init?.method, body: JSON.parse(init.body) }); return ok({ ticketId: 't1', registerId: 'reg-front', station: 'Front Desk' }); }
      if (u.includes('/pos/customer-displays')) return ok({ branchId: 'b1', devices: [], stations: [{ id: 'reg-front', name: 'Front Desk', branchId: 'b1' }, { id: 'reg-back', name: 'Back Register', branchId: 'b1' }], canManage: false });
      if (u.includes('/pos/checkout/state')) return ok(state);
      return base(url, init);
    });
    (fn as any).calls = [];
    globalThis.fetch = fn as any;
    return fn as any;
  };
  const ready = async () => { render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>); await screen.findByText('Checkout'); await screen.findByText('Hold Ticket').catch(() => screen.findByText('Resume Ticket')); };

  it('Hold Ticket puts the ticket on hold on the server', async () => {
    const f = withRoutes(); await ready();
    fireEvent.click(await screen.findByText('Hold Ticket'));
    await waitFor(() => expect(f.calls.some((c: any) => c.url.includes('/tickets/t1/hold') && c.method === 'POST')).toBe(true));
    expect(await screen.findByText(/Ticket on hold/)).toBeInTheDocument();
  });

  it('a held ticket shows On Hold and offers Resume Ticket, which resumes it on the server', async () => {
    const f = withRoutes({ status: 'on_hold' }); await ready();
    expect((await screen.findAllByText('On Hold')).length).toBeGreaterThan(0);
    fireEvent.click(await screen.findByText('Resume Ticket'));
    await waitFor(() => expect(f.calls.some((c: any) => c.url.includes('/tickets/t1/resume'))).toBe(true));
  });

  it('Move to Front Desk lists this location\'s registers and moves the ticket to the one chosen', async () => {
    const f = withRoutes(); await ready();
    fireEvent.click(await screen.findByText('Move to Front Desk'));
    const group = await screen.findByRole('group', { name: 'Move to register' });
    fireEvent.click(within(group).getByText('Front Desk'));
    await waitFor(() => expect(f.calls.find((c: any) => c.url.includes('/tickets/t1/move'))?.body).toEqual({ registerId: 'reg-front' }));
    expect(await screen.findByText('Moved to Front Desk.')).toBeInTheDocument();
  });
});

// wave 4 PILOT (Oct 13 2026): "Send Receipt" said "Receipt sent via sms, email." for every response — the send-all
// endpoint answers { results: [ per channel ] } and the screen only looked for a top-level `configured`. With no texting
// provider the SMS receipt is SIMULATED (nothing leaves the building) and a channel the guest has no address for is
// refused; the note must say so per channel, never claim a send that did not happen.
describe('POSCheckoutScreen — receipt note is honest per channel', () => {
  it('a simulated SMS and a refused e-mail are reported as not sent; only a real send says "sent"', async () => {
    const base = coFetch({ detailOver: { receiptDeliveryOptions: { sms: true, email: true, app: false, print: false } } });
    const fn = vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      if (/\/receipt\/send-all/.test(u)) return { ok: true, status: 200, json: async () => ({ results: [
        { channel: 'sms', configured: true, delivery: 'simulated', receiptNumber: 'R-1' },
        { channel: 'email', configured: false, disabledReason: 'A valid email is required for an email receipt' },
      ] }), headers: { get: () => null } } as any;
      return (base as any)(url, init);
    });
    globalThis.fetch = fn as any;
    render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    await screen.findByText('Checkout');
    await waitFor(() => expect(screen.getAllByText('Send Receipt').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('Send Receipt').filter((el) => el.tagName === 'BUTTON')[0]);
    await waitFor(() => expect(screen.getByText(/SMS: not sent/i)).toBeInTheDocument());
    expect(screen.getByText(/e-?mail: A valid email is required/i)).toBeInTheDocument();
    expect(screen.queryByText(/Receipt sent via/)).toBeNull();
  });
});

// Vietnamese POS mandate §40 / §41 (Oct 27 2026): the checkout board's search box is IME-safe (no filtering mid-composition)
// and accent-insensitive ("nguyen" finds "Nguyễn Thị Hương", "TRAN MY" finds her technician "Trần Mỹ Linh")
describe('POSCheckoutScreen — Vietnamese search', () => {
  it('the checkout search is accent-insensitive and IME-safe', async () => {
    const st = { ...checkoutState, tickets: { items: [
      { ticketId: 't1', ticketNumber: 'A1', customerName: 'Nguyễn Thị Hương', serviceCount: 1, totalDueCents: 5000, status: 'ready', primaryTechnicianName: 'Trần Mỹ Linh' },
      { ticketId: 't2', ticketNumber: 'A2', customerName: 'Jessica Miller', serviceCount: 1, totalDueCents: 6000, status: 'ready', primaryTechnicianName: 'Samantha' },
    ], pagination: { totalItems: 2 } } };
    // the board only (a ticket's detail answers 404, so the workspace stays on its empty state)
    globalThis.fetch = vi.fn(async (url: any): Promise<any> => (String(url).includes('/tickets/') ? { ok: false, status: 404, json: async () => ({ code: 'NOT_FOUND' }), text: async () => '{}', headers: { get: (): null => null } } : { ok: true, status: 200, json: async () => st, headers: { get: (): null => null } })) as any;
    render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    await screen.findAllByText('Jessica Miller');
    const box = screen.getByLabelText('Search checkout');
    fireEvent.compositionStart(box); fireEvent.change(box, { target: { value: 'nguyê' } });   // mid-composition: no filter yet
    expect(screen.getAllByText('Jessica Miller').length).toBeGreaterThan(0);
    fireEvent.change(box, { target: { value: 'nguyen' } }); fireEvent.compositionEnd(box, { data: 'nguyen' });
    expect(screen.getAllByText('Nguyễn Thị Hương').length).toBeGreaterThan(0);
    expect(screen.queryByText('Jessica Miller')).toBeNull();
    fireEvent.change(box, { target: { value: 'TRAN MY' } });                                     // the technician, no accents
    expect(screen.getAllByText('Nguyễn Thị Hương').length).toBeGreaterThan(0);
    expect(screen.queryByText('Jessica Miller')).toBeNull();
  });
});

// Vietnamese POS mandate §21 (Oct 27 2026): the payout preview's role and a missing technician name come as codes
// (roleCode / nameCode) and read in the cashier's language; the older English fields stay for older clients
describe('POSCheckoutScreen — payout preview in Vietnamese', () => {
  it('roleCode / nameCode render "Thợ chính" / "Thợ phụ" / "Thợ" in Vietnamese and the English words in English', async () => {
    const { setLanguage } = await import('@aipowersalon/mobile-sdk/i18n');
    const commission = { rows: [
      { name: 'Mia Tran', nameCode: null, role: 'Primary Tech', roleCode: 'primary', percent: 70 },
      { name: 'Technician', nameCode: 'technician', role: 'Assist Tech', roleCode: 'assist', percent: 30 },
    ], estimatedPayoutCents: 1600 };
    globalThis.fetch = coFetch({ detailOver: { commission } }) as any;
    const { unmount } = render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    expect((await screen.findAllByText('Primary Tech')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Assist Tech').length).toBeGreaterThan(0);
    unmount();
    await setLanguage('vi');
    try {
      globalThis.fetch = coFetch({ detailOver: { commission } }) as any;
      render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
      expect((await screen.findAllByText('Thợ chính')).length).toBeGreaterThan(0);
      expect(screen.getAllByText('Thợ phụ').length).toBeGreaterThan(0);
      expect(screen.queryByText('Assist Tech')).toBeNull();
      expect(screen.queryByText('Technician')).toBeNull();
    } finally { await setLanguage('en'); }
  });
});
