// receiptAndDevice.test.tsx — 23-inch dual-screen spec §82, §85, §97–§98 on the display:
//   • the receipt choice comes before the 3-second screen, which waits for it; a customer who walks away gets the salon's
//     automatic choice when the time is up
//   • Refresh Display (from the POS) refetches everything and reopens the stream; a revoked display forgets its credential
//   • maintenance shows a maintenance screen; the heartbeat reports what is on screen
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, render, screen, fireEvent, act } from '@testing-library/react';
import type { CustomerDisplayState } from '@aipowersalon/api-contracts/customer';

const rt = vi.hoisted(() => ({ onEvent: [] as ((d: any) => void)[], created: 0 }));
vi.mock('@aipowersalon/realtime-client', () => ({
  createRealtimeClient: () => {
    rt.created++;
    return {
      onEvent: (fn: any) => { rt.onEvent.push(fn); return () => undefined; }, onReconcile: () => () => undefined,
      onStatus: () => () => undefined, status: () => 'CONNECTED', connect: () => undefined, disconnect: () => undefined,
    };
  },
  FallbackPoller: class { onStatus() { /* */ } stop() { /* */ } },
  startVisibleSafetySync: () => () => undefined,
  SYNC_POLICY: { operationalMs: 15_000 },
}));
const api = vi.hoisted(() => ({ fetchState: vi.fn(), submitReceipt: vi.fn(), releaseCompleted: vi.fn() }));
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  readCreds: () => ({ mode: 'device', deviceToken: 'd1' }),
  fetchState: (...a: any[]) => api.fetchState(...a), submitReceipt: (...a: any[]) => api.submitReceipt(...a), releaseCompleted: (...a: any[]) => api.releaseCompleted(...a),
  streamSource: () => undefined,
}));
import { DisplayApiError } from './api';
import { useDisplay, completedKey, receiptKey, COMPLETED_HOLD_MS } from './useDisplay';
import { CheckoutPanel, ReceiptCard, SuccessCard, receiptLine, rightPanelMode, type CheckoutActions } from './CheckoutPanel';
import { appMode, reportedMode } from './App';
import { Maintenance } from './DeviceScreens';

const totals = { subtotalCents: 5000, tipCents: 0, taxCents: 0, surchargeCents: 0, giftCardChargeCents: 0, totalDueCents: 5000 };
const paid = (over: Partial<CustomerDisplayState> = {}): CustomerDisplayState => ({
  state: 'payment_success', salonName: 'Luxury Nails', sessionId: 's1', version: 5, customer: { firstName: 'Sophia' }, tipOptions: [], selectedTipCents: 0, totals, payButtonEnabled: false,
  receipt: { status: 'choose', automatic: 'sms', decideWithinSeconds: 45, options: [{ channel: 'sms', destination: '(•••) •••-0142' }, { channel: 'email', destination: 's•••@gmail.com' }, { channel: 'none' }] },
  ...over,
});
const idle: CustomerDisplayState = { state: 'idle', salonName: 'Luxury Nails', tipOptions: [], selectedTipCents: 0, totals: { ...totals, subtotalCents: 0, totalDueCents: 0 }, payButtonEnabled: false };
const step = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const acts = (over: Partial<CheckoutActions> = {}): CheckoutActions => ({ submitting: false, actionError: null, rated: null, onTip: vi.fn(), onMethod: vi.fn(), onPay: vi.fn(), onRate: vi.fn(), onClearError: vi.fn(), onReceipt: vi.fn(), ...over });

beforeEach(() => { rt.onEvent.length = 0; rt.created = 0; api.fetchState.mockReset(); api.submitReceipt.mockReset(); api.releaseCompleted.mockReset(); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

describe('the receipt choice before the 3-second screen (§97–§98)', () => {
  it('pure: the 3-second key waits while a receipt is being chosen; the question has its own key', () => {
    expect(completedKey(paid())).toBeNull();
    expect(receiptKey(paid())).toBe('s1');
    expect(completedKey(paid({ receipt: { status: 'sent', channel: 'sms', destination: '(•••) •••-0142' } }))).toBe('s1');
    expect(receiptKey(paid({ receipt: { status: 'sending', channel: 'sms' } }))).toBeNull();
    expect(completedKey(paid({ receipt: undefined, ...({ signatureRequired: true } as object) }))).toBe('s1');   // no signature step (Oct 6 2026)
    expect(rightPanelMode(paid())).toBe('receipt');
    expect(rightPanelMode(paid({ ...({ signatureRequired: true } as object) }))).toBe('receipt');
    expect(rightPanelMode(paid({ receipt: undefined }))).toBe('completed');
  });

  it('the screen stays while the customer chooses; their choice is sent; THEN the 3 seconds, then the customer is gone', async () => {
    api.fetchState.mockResolvedValue(paid());
    api.submitReceipt.mockResolvedValue(paid({ version: 6, receipt: { status: 'sent', channel: 'email', destination: 's•••@gmail.com' } }));
    api.releaseCompleted.mockResolvedValue(idle);
    const { result } = renderHook(() => useDisplay());
    await step(20);
    await step(COMPLETED_HOLD_MS * 3);
    expect(result.current.data?.customer?.firstName).toBe('Sophia');   // never cleared while the question is open
    expect(api.releaseCompleted).not.toHaveBeenCalled();
    await act(async () => { await result.current.chooseReceipt('email'); });
    expect(api.submitReceipt).toHaveBeenCalledWith({ mode: 'device', deviceToken: 'd1' }, 'email');
    expect(result.current.data?.receipt).toMatchObject({ status: 'sent' });
    await step(COMPLETED_HOLD_MS + 50);
    expect(result.current.data?.state).toBe('idle');
    expect(JSON.stringify(result.current.data)).not.toContain('Sophia');
    expect(api.releaseCompleted).toHaveBeenCalledWith({ mode: 'device', deviceToken: 'd1' }, 's1');
  });

  it('a customer who walks away: when the time is up the salon\'s automatic choice is made', async () => {
    api.fetchState.mockResolvedValue(paid());
    api.submitReceipt.mockResolvedValue(paid({ receipt: { status: 'sent', channel: 'sms' } }));
    renderHook(() => useDisplay());
    await step(20);
    await step(44_000);
    expect(api.submitReceipt).not.toHaveBeenCalled();
    await step(1_100);
    expect(api.submitReceipt).toHaveBeenCalledWith({ mode: 'device', deviceToken: 'd1' }, 'auto');
  });

  it('the card: masked destinations, the automatic choice spelled out, and the outcome line afterwards', () => {
    const a = acts();
    render(<ReceiptCard s={paid()} a={a} />);
    expect(screen.getByText('Text my receipt to (•••) •••-0142')).toBeInTheDocument();
    expect(screen.getByText('Email my receipt to s•••@gmail.com')).toBeInTheDocument();
    expect(screen.getByText(/If you don’t choose, we’ll text it to \(•••\) •••-0142/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('No receipt'));
    expect(a.onReceipt).toHaveBeenCalledWith('none');
    expect(receiptLine({ status: 'sent', channel: 'sms', destination: '(•••) •••-0142' })).toBe('Receipt texted to (•••) •••-0142');
    expect(receiptLine({ status: 'failed', channel: 'email' })).toMatch(/couldn’t send/);
    expect(receiptLine({ status: 'skipped', channel: 'none' })).toMatch(/No receipt/);
    render(<SuccessCard s={paid({ receipt: { status: 'sent', channel: 'email', destination: 's•••@gmail.com' } })} a={acts()} />);
    expect(screen.getByTestId('receipt-result').textContent).toBe('Receipt emailed to s•••@gmail.com');
  });

  it('on the 23-inch panel the question replaces the summary until it is answered', () => {
    render(<CheckoutPanel s={paid()} a={acts()} />);
    expect(screen.getByTestId('checkout-panel').getAttribute('data-mode')).toBe('receipt');
    expect(screen.getByTestId('receipt-choice')).toBeInTheDocument();
  });
});

describe('the display as a device (§82, §85)', () => {
  it('Refresh Display: the state and the advertising are fetched again and the stream is reopened', async () => {
    api.fetchState.mockResolvedValue(idle);
    const { result } = renderHook(() => useDisplay());
    await step(20);
    const createdBefore = rt.created; const fetchesBefore = api.fetchState.mock.calls.length;
    await act(async () => { rt.onEvent[rt.onEvent.length - 1]!({ event: 'customer_display_refresh_requested', screens: [] }); await vi.advanceTimersByTimeAsync(20); });
    expect(api.fetchState.mock.calls.length).toBe(fetchesBefore + 1);
    expect(result.current.adsNudge).toBe(1);
    expect(rt.created).toBe(createdBefore + 1);
  });

  it('a revoked display (its credential refused) forgets it — back to pairing', async () => {
    api.fetchState.mockRejectedValue(new DisplayApiError(403, 'Invalid or missing device token.'));
    const onRevoked = vi.fn();
    renderHook(() => useDisplay({ mode: 'device', deviceToken: 'd1' }, { onRevoked }));
    await step(20);
    expect(onRevoked).toHaveBeenCalledTimes(1);
  });

  it('a one-off session display whose session is refused is NOT treated as revoked', async () => {
    api.fetchState.mockRejectedValue(new DisplayApiError(403, 'Invalid'));
    const onRevoked = vi.fn();
    const { result } = renderHook(() => useDisplay({ mode: 'session', sessionId: 's', token: 't' }, { onRevoked }));
    await step(20);
    expect(onRevoked).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('forbidden');
  });

  it('the heartbeat\'s maintenance answer fetches the state that shows it (when no checkout is on screen)', async () => {
    api.fetchState.mockResolvedValue(idle);
    const { result } = renderHook(() => useDisplay());
    await step(20);
    const n = api.fetchState.mock.calls.length;
    await act(async () => { result.current.onHeartbeatAck({ maintenance: true }); await vi.advanceTimersByTimeAsync(20); });
    expect(api.fetchState.mock.calls.length).toBe(n + 1);
    await act(async () => { result.current.onHeartbeatAck({ maintenance: false }); await vi.advanceTimersByTimeAsync(20); });
    expect(api.fetchState.mock.calls.length).toBe(n + 1);   // nothing changed: no refetch
  });

  it('reported mode: a checkout outranks everything, a customer checking in is CHECK_IN, playing ads is ADVERTISEMENT', () => {
    const ads = { panelAds: [{}] as any[] };
    // Mandate §11: the App reports the ONE display model's mode (appMode), in the device table's vocabulary
    const m = (d: CustomerDisplayState | null, checkInStep: 'none' | 'walk_in') => appMode(d, { checkInStep, online: true, padDone: null });
    expect(reportedMode(m(null, 'none'), ads)).toBeNull();
    expect(reportedMode(m(paid(), 'walk_in'), ads)).toBe('checkout');
    expect(reportedMode(m(idle, 'walk_in'), ads)).toBe('check_in');
    expect(reportedMode(m(idle, 'none'), ads)).toBe('advertisement');
    expect(reportedMode(m(idle, 'none'), { panelAds: [] })).toBe('idle');
    expect(reportedMode(m({ ...idle, maintenance: true }, 'walk_in'), ads)).toBe('idle');
  });

  it('maintenance: a calm screen with the salon\'s name — no check-in, no customer data', () => {
    render(<Maintenance s={{ ...idle, maintenance: true }} />);
    expect(screen.getByText('This display is being serviced')).toBeInTheDocument();
    expect(screen.getByText('Luxury Nails')).toBeInTheDocument();
    expect(document.querySelector('input')).toBeNull();
  });
});

describe('no signature on the display (Kevin, Oct 6 2026: the cardholder signs once, on the Clover card terminal)', () => {
  it('a paid card checkout shows the receipt question, then the thank-you — never a signature pad', () => {
    const { container, unmount } = render(<CheckoutPanel s={paid({ ...({ signatureRequired: true } as object) })} a={acts()} />);
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.textContent).not.toMatch(/sign/i);
    unmount();
    const done = render(<CheckoutPanel s={paid({ receipt: undefined })} a={acts()} />);
    expect(done.container.querySelector('canvas')).toBeNull();
    expect(done.container.textContent).not.toMatch(/please sign/i);
  });
});
