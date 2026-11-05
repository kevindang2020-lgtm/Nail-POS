import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CustomerDisplayState, DisplayState } from '@aipowersalon/api-contracts/customer';

// The App renders the backend-driven CustomerDisplayState machine and maps the customer's tip/method/pay taps to API calls.
// Mock useDisplay so we can drive each state and capture the action payloads — the tip mapping in particular is logic the
// kiosk owns (option → TipSubmission), so it's worth locking.
const h = vi.hoisted(() => ({ ret: null as any, ads: null as any }));
vi.mock('./useDisplay', async (orig) => ({ ...(await orig<typeof import('./useDisplay')>()), useDisplay: () => h.ret }));
// the advertising playlist is its own hook (useAdPlaylist.test.tsx): here the panel has no ads → the salon's branded panel
// (h.ads, when a test sets it: a saved playlist that is ready to play)
vi.mock('./useAdPlaylist', () => ({ useAdPlaylist: () => h.ads ?? ({ playlist: null, usable: false, panelAds: [], fullAds: [], fullScreenIdle: { enabled: false, afterSeconds: 60 }, onShown: () => undefined }) }));
// 23-inch spec §8–§12: which credential the display runs with is useCredentials' job (its own tests); here a paired
// display unless a test says it has none (h.cred). The heartbeat is a side effect with no screen.
const cred = vi.hoisted(() => ({ status: 'ready' as 'ready' | 'unpaired' | 'loading' }));
vi.mock('./useCredentials', () => ({ useCredentials: () => ({ status: cred.status, creds: cred.status === 'ready' ? { mode: 'device', deviceToken: 'd1' } : null, paired: vi.fn(), forget: vi.fn() }) }));
vi.mock('./useHeartbeat', () => ({ useHeartbeat: () => undefined }));
vi.mock('./usePairing', () => ({ usePairing: () => ({ code: '48291374', expiresAt: new Date(Date.now() + 600_000).toISOString(), pairedTo: null, problem: null }) }));
import { App } from './App';
import { SALON_STORE_KEY } from './salonMemory';

function makeState(over: Partial<CustomerDisplayState> = {}): CustomerDisplayState {
  return {
    state: 'ticket_review',
    salonName: 'Polished Nails',
    customer: { firstName: 'Dana' },
    ticket: { ticketNumber: 'A14', services: [{ serviceName: 'Gel Manicure', priceCents: 4500 }, { serviceName: 'Pedicure', priceCents: 5500 }] },
    tipOptions: [
      { label: '18%', tipType: 'percent', percent: 18, amountCents: 1800, selected: false },
      { label: '20%', tipType: 'percent', percent: 20, amountCents: 2000, selected: false },
      { label: '22%', tipType: 'percent', percent: 22, amountCents: 2200, selected: false },
      { label: 'No Tip', tipType: 'none', amountCents: 0, selected: false },
    ],
    selectedTipCents: 0,
    totals: { subtotalCents: 10000, tipCents: 0, taxCents: 660, surchargeCents: 0, giftCardChargeCents: 0, totalDueCents: 10660 },
    payButtonEnabled: false,
    ...over,
  };
}

function mountWith(partial: Partial<ReturnType<typeof baseHook>>) {
  h.ret = { ...baseHook(), ...partial };
  return h.ret;
}
function baseHook() {
  return {
    creds: { mode: 'device', deviceToken: 'd1' } as const,
    data: makeState() as CustomerDisplayState | null,
    phase: 'ready' as string, online: true,
    submitting: false,
    actionError: null as string | null,
    chooseTip: vi.fn(),
    chooseMethod: vi.fn(),
    pay: vi.fn(),
    rate: vi.fn(),
    rated: null as number | null,
    clearActionError: vi.fn(),
  };
}

beforeEach(() => { h.ret = null; h.ads = null; cred.status = 'ready'; localStorage.clear(); });

describe('App phase gating', () => {
  it('a display with no credential shows its pairing code — never a salon login (§8–§12)', () => {
    cred.status = 'unpaired';
    mountWith({ data: null });
    render(<App />);
    expect(screen.getByTestId('pairing')).toBeInTheDocument();
    expect(screen.getByTestId('pairing-code').textContent).toBe('4829 1374');
    expect(screen.getByText(/Devices → Customer Displays/)).toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it('shows the expired screen when forbidden', () => {
    mountWith({ phase: 'forbidden', data: null });
    render(<App />);
    expect(screen.getByText('Session expired')).toBeInTheDocument();
  });

  it('shows Connecting when ready but no data yet', () => {
    mountWith({ phase: 'connecting', data: null });
    render(<App />);
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
  });
});

describe('§72 a 23-inch display that starts while the server cannot be reached', () => {
  const remembered = { salonName: 'Polished Nails', branding: { salonName: 'Polished Nails', logoUrl: '/media/salon-logos/t1/logo-0123456789abcdef01234567.png', tagline: 'Nails · Spa', branchName: 'Downtown', idleMessage: 'Welcome in!' } };
  const saved = { playlist: null, usable: true, fullAds: [], fullScreenIdle: { enabled: false, afterSeconds: 60 }, onShown: () => undefined,
    panelAds: [{ id: 'a1', version: 1, durationSeconds: 8, image: { url: 'blob:a1', width: 720, height: 1080 }, fit: 'cover', focalX: 0.5, focalY: 0.5, headline: 'Fall pedicure', subheadline: null, description: null, ctaText: null, qr: null }] };

  it('shows the salon it remembers and the advertising it saved — not a spinner for the whole outage', () => {
    localStorage.setItem(SALON_STORE_KEY, JSON.stringify(remembered));
    h.ads = saved;
    mountWith({ phase: 'error', data: null });
    render(<App />);
    const screen23 = screen.getByTestId('display-23');
    expect(screen23).toHaveAttribute('data-offline', 'true');
    expect(screen.getAllByText('Polished Nails').length).toBeGreaterThan(0);
    expect(screen.getByText('Nails · Spa · Downtown')).toBeInTheDocument();
    expect(screen.getByText('We’re temporarily offline. Please see the receptionist.')).toBeInTheDocument();
    expect(screen.getByTestId('right-panel')).toHaveAttribute('data-mode', 'ads');
    expect(screen.getByTestId('right-panel').querySelector('img[src="blob:a1"]')).not.toBeNull();
    expect(screen.queryByRole('group', { name: 'Phone number keypad' })).toBeNull();   // no check-in without the server
    expect(screen.queryByText('Connecting…')).toBeNull();
  });

  it('remembers nothing and saved nothing (never online yet): Connecting…', () => {
    mountWith({ phase: 'error', data: null });
    render(<App />);
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
  });

  it('while the first answer is simply on its way: Connecting… (the offline screen is for a failure)', () => {
    localStorage.setItem(SALON_STORE_KEY, JSON.stringify(remembered));
    h.ads = saved;
    mountWith({ phase: 'connecting', data: null });
    render(<App />);
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
  });

  it('a one-off checkout link (not a paired display) never shows the salon\'s saved screen', () => {
    localStorage.setItem(SALON_STORE_KEY, JSON.stringify(remembered));
    h.ads = saved;
    mountWith({ phase: 'error', data: null, creds: { mode: 'session', sessionId: 's', token: 't' } as any });
    render(<App />);
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
  });
});

describe('Dual-Screen mandate §118–§119: the salon\'s languages', () => {
  it('English only: no language switch', () => {
    mountWith({ data: makeState({ state: 'payment_processing' }) });
    render(<App />);
    expect(screen.queryByRole('group', { name: 'Language' })).toBeNull();
  });
  it('Vietnamese offered: the guest switches for their checkout; the screen and the page language follow', () => {
    mountWith({ data: makeState({ state: 'payment_processing', languages: ['en', 'vi'] }) });
    render(<App />);
    expect(screen.getAllByText('Processing payment').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Tiếng Việt' }));
    expect(screen.getAllByText('Đang xử lý thanh toán').length).toBeGreaterThan(0);
    expect(document.documentElement.lang).toBe('vi');
    expect(screen.getByRole('button', { name: 'Tiếng Việt' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('the salon\'s default is its FIRST language; the next guest starts in it again (the screen at rest resets the choice)', () => {
    const ret = mountWith({ data: makeState({ state: 'payment_processing', languages: ['vi', 'en'] }) });
    const { rerender } = render(<App />);
    expect(screen.getAllByText('Đang xử lý thanh toán').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getAllByText('Processing payment').length).toBeGreaterThan(0);
    h.ret = { ...ret, data: makeState({ state: 'idle', languages: ['vi', 'en'] }) };   // checkout over: the screen rests
    rerender(<App />);
    h.ret = { ...ret, data: makeState({ state: 'payment_processing', languages: ['vi', 'en'] }) };   // the next customer
    rerender(<App />);
    expect(screen.getAllByText('Đang xử lý thanh toán').length).toBeGreaterThan(0);
  });
});

describe('Dual-Screen mandate §81: the server unreachable with nobody at checkout', () => {
  it('the 23-inch check-in says "please see the receptionist" — no keypad — and the ads stay on the right', () => {
    mountWith({ online: false, data: makeState({ state: 'idle', checkIn: true }) });
    render(<App />);
    expect(screen.getByText(/temporarily offline\. Please see the receptionist/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '5' })).toBeNull();
    expect(screen.getByTestId('right-panel')).toHaveAttribute('data-mode', 'ads');
  });
  it('a checkout already on screen stays (§79) — the network does not take the customer away', () => {
    mountWith({ online: false, data: makeState({ state: 'payment_processing' }) });
    render(<App />);
    expect(screen.getAllByText('Processing payment').length).toBeGreaterThan(0);
    expect(screen.queryByText(/temporarily offline/)).toBeNull();
  });
});

describe('App state machine', () => {
  const cases: Array<[DisplayState, string]> = [
    ['idle', 'Welcome'],
    ['disconnected', 'Welcome'],
    ['payment_processing', 'Processing payment'],   // §40 "PROCESSING PAYMENT — Please wait…"
    ['payment_failed', 'Payment didn’t go through'],
    ['expired', 'Session expired'],
  ];
  it.each(cases)('renders the right screen for state=%s', (state, text) => {
    mountWith({ data: makeState({ state }) });
    render(<App />);
    expect(screen.getAllByText(text).length).toBeGreaterThan(0);   // idle: the welcome card and the salon's branded panel
  });

  it('greets by name and shows paid total on success', () => {
    mountWith({ data: makeState({ state: 'payment_success', customer: { firstName: 'Dana' }, totals: { subtotalCents: 10000, tipCents: 2000, taxCents: 660, surchargeCents: 0, giftCardChargeCents: 0, totalDueCents: 12660 } }) });
    render(<App />);
    // 23-inch layout: the welcome card and the checkout panel both thank the customer.
    expect(screen.getAllByText('Thank you, Dana!').length).toBeGreaterThan(0);
    // §44: "✓ PAYMENT COMPLETE · Thank you, Sophia! · Total Paid $142.40"
    expect(screen.getByText('Payment complete')).toBeInTheDocument();
    expect(screen.getByText('Total paid')).toBeInTheDocument();
    expect(screen.getByText('$126.60')).toBeInTheDocument();
  });

  it('§44: the completed screen shows what was PAID (from the checkout) and the points earned', () => {
    const checkout = { ticketNumber: '#12', date: '2026-10-06T15:00:00.000Z', lines: [], adjustments: [], itemsSubtotalCents: 12700, discountCents: 1500, taxCents: 868,
      customerFeeCents: 0, tipCents: 2172, giftCardSaleCents: 0, totalCents: 14240, paidCents: 14240, balanceDueCents: 0, payments: [{ method: 'cash', label: 'Cash', amountCents: 14240 }],
      paymentStatus: 'paid', paymentMethod: 'cash', loyaltyPointsEarned: 120 } as any;
    mountWith({ data: makeState({ state: 'payment_success', customer: { firstName: 'Sophia' }, checkout }) });
    render(<App />);
    // 23-inch layout: the welcome card and the checkout panel both thank the customer.
    expect(screen.getAllByText('Thank you, Sophia!').length).toBeGreaterThan(0);
    expect(screen.getByText('$142.40')).toBeInTheDocument();
    expect(screen.getByText('You earned 120 points.')).toBeInTheDocument();
  });
});

describe('Review rendering', () => {
  it('shows the order, service lines, and totals', () => {
    mountWith({ data: makeState() });
    render(<App />);
    expect(screen.getByText('Hi Dana 👋')).toBeInTheDocument();
    expect(screen.getByText('Order A14')).toBeInTheDocument();
    expect(screen.getByText('Gel Manicure')).toBeInTheDocument();
    expect(screen.getByText('Pedicure')).toBeInTheDocument();
    // tax row present, total reflects backend figure
    expect(screen.getByText('Tax')).toBeInTheDocument();
    expect(screen.getByText('$106.60')).toBeInTheDocument();
  });

  it('shows a Gift Card row when the ticket includes a gift-card sale', () => {
    mountWith({ data: makeState({ totals: { subtotalCents: 10000, tipCents: 0, taxCents: 660, surchargeCents: 0, giftCardChargeCents: 5000, totalDueCents: 15660 } }) });
    render(<App />);
    expect(screen.getByText('Gift Card')).toBeInTheDocument();
    expect(screen.getByText('$50.00')).toBeInTheDocument();
    expect(screen.getByText('$156.60')).toBeInTheDocument();
  });

  it('hides the tip and surcharge rows when those are zero', () => {
    mountWith({ data: makeState() });
    render(<App />);
    expect(screen.queryByText('Tip')).not.toBeInTheDocument();
    expect(screen.queryByText('Card Surcharge')).not.toBeInTheDocument();
  });
});

describe('tip / method / pay wiring', () => {
  it('maps a percent tip tap to { tipType: percent, percent }', () => {
    const hook = mountWith({ data: makeState() });
    render(<App />);
    fireEvent.click(screen.getByText('20%'));
    expect(hook.chooseTip).toHaveBeenCalledWith({ tipType: 'percent', percent: 20 });
  });

  it('maps the No Tip tap to { tipType: none }', () => {
    const hook = mountWith({ data: makeState() });
    render(<App />);
    fireEvent.click(screen.getByText('No Tip'));
    expect(hook.chooseTip).toHaveBeenCalledWith({ tipType: 'none' });
  });

  it('shows the pay UI only when payButtonEnabled and wires method + pay', () => {
    const hook = mountWith({ data: makeState({ payButtonEnabled: true, totals: { subtotalCents: 10000, tipCents: 0, taxCents: 660, surchargeCents: 300, giftCardChargeCents: 0, totalDueCents: 10960 } }) });
    render(<App />);
    // method buttons + surcharge note appear
    expect(screen.getByText('Card')).toBeInTheDocument();
    expect(screen.getByText('Cash')).toBeInTheDocument();
    expect(screen.getByText(/\$3\.00 surcharge/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Card'));
    expect(hook.chooseMethod).toHaveBeenCalledWith('card');
    fireEvent.click(screen.getByRole('button', { name: /^Pay \$/ }));
    expect(hook.pay).toHaveBeenCalled();
  });

  it('does not show the pay button when payButtonEnabled is false', () => {
    mountWith({ data: makeState({ payButtonEnabled: false }) });
    render(<App />);
    expect(screen.queryByRole('button', { name: /^Pay \$/ })).not.toBeInTheDocument();
  });

  it('shows the satisfaction prompt after payment and submits a star tap', () => {
    const hook = mountWith({ data: makeState({ state: 'payment_success' }), rated: null });
    render(<App />);
    expect(screen.getByText('How was your visit?')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('5 stars'));
    expect(hook.rate).toHaveBeenCalledWith(5);
    fireEvent.click(screen.getByLabelText('1 star'));
    expect(hook.rate).toHaveBeenCalledWith(1);
  });

  it('shows a thank-you confirmation once a rating has been submitted', () => {
    mountWith({ data: makeState({ state: 'payment_success' }), rated: 4 });
    render(<App />);
    expect(screen.getByText('Thanks for your feedback!')).toBeInTheDocument();
    expect(screen.queryByText('How was your visit?')).not.toBeInTheDocument();
  });
});

describe('BUILD_PLAN Phase 3: the phone-change code on the display', () => {
  beforeEach(() => { cred.status = 'ready'; });
  it('a pending phone verification takes the whole screen, showing only the masked number', () => {
    mountWith({ data: makeState({ phoneVerification: { maskedPhone: '••••0199' } }) });
    render(<App />);
    expect(screen.getByTestId('phone-code-pad')).toBeTruthy();
    expect(screen.getByText('••••0199')).toBeTruthy();
  });
  it('Not now returns to the checkout', () => {
    mountWith({ data: makeState({ phoneVerification: { maskedPhone: '••••0199' } }) });
    render(<App />);
    fireEvent.click(screen.getByText('Not now'));
    expect(screen.queryByTestId('phone-code-pad')).toBeNull();
  });
  it('no prompt, no pad', () => {
    mountWith({ data: makeState() });
    render(<App />);
    expect(screen.queryByTestId('phone-code-pad')).toBeNull();
  });
});
