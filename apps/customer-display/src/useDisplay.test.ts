import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { CustomerDisplayState } from '@aipowersalon/api-contracts/customer';

// useDisplay — 23-inch dual-screen spec §43–§46, §96, §101, §107. The api module is mocked: the hook loads server
// states, and the tests drive time. (The old "honors a tenant-configured timeout" and "5 s default" tests pinned a
// premise the spec retired: the completed screen is a fixed 3000 ms, and the display now RELEASES the session.)
const fetchState = vi.fn();
const releaseCompleted = vi.fn();
const submitRating = vi.fn();
vi.mock('./api', () => ({
  readCreds: () => ({ mode: 'device', deviceToken: 'd1' }),
  fetchState: (...a: any[]) => fetchState(...a),
  releaseCompleted: (...a: any[]) => releaseCompleted(...a),
  streamUrl: () => 'http://localhost/stream',
  streamSource: () => undefined, submitReceipt: vi.fn(),
  submitTip: vi.fn(), submitMethod: vi.fn(), requestPayment: vi.fn(), submitRating: (...a: any[]) => submitRating(...a), 
  DisplayApiError: class extends Error { status = 0; },
}));

import { useDisplay, COMPLETED_HOLD_MS, idleShell } from './useDisplay';
import { SALON_STORE_KEY } from './salonMemory';

const totals = (cents: number) => ({ subtotalCents: cents, tipCents: 0, taxCents: 0, surchargeCents: 0, giftCardChargeCents: 0, totalDueCents: cents });
const state = (over: Partial<CustomerDisplayState> = {}): CustomerDisplayState => ({
  state: 'payment_success', salonName: 'Polished Nails', sessionId: 'sess-1', version: 10, customer: { firstName: 'Dana' },
  ticket: { ticketNumber: 'A1', services: [{ serviceName: 'Gel Manicure', priceCents: 4500 }] }, tipOptions: [], selectedTipCents: 0,
  totals: totals(14240), payButtonEnabled: false, ...over,
});
const idle = (over: Partial<CustomerDisplayState> = {}): CustomerDisplayState => ({ ...idleShell({ salonName: 'Polished Nails', payButtonEnabled: false }), ...over });
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(20); });
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => { fetchState.mockReset(); releaseCompleted.mockReset(); submitRating.mockReset(); (globalThis as any).EventSource = undefined; vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

describe('the 3-second completed screen (§43)', () => {
  it('holds exactly 3000 ms, then the customer is destroyed and the session released', async () => {
    fetchState.mockResolvedValue(state());
    // the server's answer is held back: the customer must be gone from the UI state at 3000 ms by the display's OWN
    // doing, not because a clean idle state happened to arrive from the server (that would only cover the gap)
    let answer: (v: CustomerDisplayState) => void = () => {};
    releaseCompleted.mockImplementation(() => new Promise((res) => { answer = res; }));
    const { result } = renderHook(() => useDisplay());
    await flush();
    expect(result.current.data?.state).toBe('payment_success');
    await wait(COMPLETED_HOLD_MS - 50);
    expect(result.current.data?.customer?.firstName).toBe('Dana');          // still the customer's moment
    await wait(60);
    const d = result.current.data!;
    expect(d.state).toBe('idle');
    // §45: every customer field is gone from the UI state — built from scratch, not hidden
    expect(d.customer).toBeUndefined();
    expect(d.ticket).toBeUndefined();
    expect(d.sessionId).toBeUndefined();
    expect(d.totals.totalDueCents).toBe(0);
    expect(JSON.stringify(d)).not.toContain('Dana');
    expect(JSON.stringify(d)).not.toContain('Gel Manicure');
    expect(JSON.stringify(d)).not.toContain('14240');
    expect(releaseCompleted).toHaveBeenCalledWith({ mode: 'device', deviceToken: 'd1' }, 'sess-1');
    await act(async () => { answer(idle()); await vi.advanceTimersByTimeAsync(5); });
    expect(result.current.data?.state).toBe('idle');
  });

  it("a tenant's old checkoutCompleteTimeoutSeconds no longer changes it — the spec fixes 3000 ms", async () => {
    for (const secs of [2, 10]) {
      fetchState.mockReset(); releaseCompleted.mockReset();
      fetchState.mockResolvedValue(state({ checkoutCompleteTimeoutSeconds: secs }));
      releaseCompleted.mockResolvedValue(idle());
      const { result, unmount } = renderHook(() => useDisplay());
      await flush();
      await wait(2_500);
      expect(result.current.data?.state).toBe('payment_success');
      await wait(600);
      expect(result.current.data?.state).toBe('idle');
      unmount();
    }
  });

  it('never starts while the payment is processing or verifying (§96)', async () => {
    for (const s of ['payment_processing', 'payment_verifying', 'tip_selected'] as const) {
      fetchState.mockReset(); releaseCompleted.mockReset();
      fetchState.mockResolvedValue(state({ state: s }));
      const { result, unmount } = renderHook(() => useDisplay());
      await flush();
      await wait(COMPLETED_HOLD_MS * 3);
      expect(result.current.data?.state).toBe(s);
      expect(releaseCompleted).not.toHaveBeenCalled();
      unmount();
    }
  });

  it('a paid card checkout starts its 3 seconds at once — no signature step (the Clover terminal takes it), even if an older server still says one is owed', async () => {
    fetchState.mockResolvedValue(state({ ...({ signatureRequired: true } as object) }));
    releaseCompleted.mockResolvedValue(idle());
    const { result } = renderHook(() => useDisplay());
    await flush();
    await wait(COMPLETED_HOLD_MS + 50);
    expect(result.current.data?.state).toBe('idle');
    expect(releaseCompleted).toHaveBeenCalledWith(expect.anything(), 'sess-1');
  });
});

describe('a released customer never comes back (§107)', () => {
  it('a later fetch that still returns the released session renders idle and retries the release', async () => {
    fetchState.mockResolvedValue(state());
    releaseCompleted.mockRejectedValueOnce(new Error('network')).mockResolvedValue(idle());
    const { result } = renderHook(() => useDisplay());
    await flush();
    await wait(COMPLETED_HOLD_MS + 50);
    expect(result.current.data?.state).toBe('idle');
    await wait(17_100);                                                         // safety sync: the server still returns sess-1
    expect(result.current.data?.state).toBe('idle');
    expect(result.current.data?.customer).toBeUndefined();
    expect(releaseCompleted.mock.calls.length).toBeGreaterThanOrEqual(2);       // retried
  });

  it('the NEXT customer is shown at once', async () => {
    fetchState.mockResolvedValue(state());
    releaseCompleted.mockResolvedValue(idle());
    const { result } = renderHook(() => useDisplay());
    await flush();
    await wait(COMPLETED_HOLD_MS + 50);
    fetchState.mockResolvedValue(state({ state: 'ticket_review', sessionId: 'sess-2', version: 1, customer: { firstName: 'Mia' } }));
    await wait(17_100);
    expect(result.current.data?.sessionId).toBe('sess-2');
    expect(result.current.data?.customer?.firstName).toBe('Mia');
  });
});

describe('an older response never rolls the ticket back (§101)', () => {
  it('drops a response with a lower version for the same session', async () => {
    fetchState.mockResolvedValue(state({ state: 'ticket_review', version: 20, totals: totals(5000) }));
    const { result } = renderHook(() => useDisplay());
    await flush();
    fetchState.mockResolvedValue(state({ state: 'ticket_review', version: 19, totals: totals(4000) }));
    await wait(17_100);
    expect(result.current.data?.totals.totalDueCents).toBe(5000);
    fetchState.mockResolvedValue(state({ state: 'ticket_review', version: 21, totals: totals(6000) }));
    await wait(17_100);
    expect(result.current.data?.totals.totalDueCents).toBe(6000);
  });
});

describe('between customers', () => {
  it("one customer's rating never shows as already given for the next", async () => {
    fetchState.mockResolvedValue(state());
    submitRating.mockResolvedValue(state());
    releaseCompleted.mockResolvedValue(idle());
    const { result } = renderHook(() => useDisplay());
    await flush();
    await act(async () => { await result.current.rate(5); });
    expect(result.current.rated).toBe(5);
    await wait(COMPLETED_HOLD_MS + 50);
    fetchState.mockResolvedValue(state({ state: 'ticket_review', sessionId: 'sess-2', version: 1 }));
    await wait(17_100);
    expect(result.current.data?.sessionId).toBe('sess-2');
    expect(result.current.rated).toBeNull();
  });

  it('carries the remembered Go Check-In slug into the cleared idle state', async () => {
    fetchState.mockResolvedValueOnce(idle({ goCheckInSlug: 'branch-slug' })).mockResolvedValue(state());
    releaseCompleted.mockResolvedValue(null);
    const { result } = renderHook(() => useDisplay());
    await flush();                                                              // idle load → remembers the slug
    await wait(17_100);                                                         // a sync brings the completed checkout
    expect(result.current.data?.state).toBe('payment_success');
    await wait(COMPLETED_HOLD_MS + 50);
    expect(result.current.data?.state).toBe('idle');
    expect(result.current.data?.goCheckInSlug).toBe('branch-slug');
  });

  it('Unit 7: the display\'s own check-in stays on through the cleared idle state (the server\'s latest word, not a kiosk slug)', async () => {
    fetchState.mockResolvedValueOnce(idle({ checkIn: true })).mockResolvedValue(state({ checkIn: true }));
    releaseCompleted.mockResolvedValue(null);
    const { result } = renderHook(() => useDisplay());
    await flush();
    await wait(17_100);                                                         // a sync brings the completed checkout
    expect(result.current.data?.state).toBe('payment_success');
    await wait(COMPLETED_HOLD_MS + 50);
    expect(result.current.data?.state).toBe('idle');
    expect(result.current.data?.checkIn).toBe(true);
    expect(result.current.data?.customer).toBeUndefined();
  });

  it('…and off when the server last said off (switched off during the checkout)', async () => {
    fetchState.mockResolvedValueOnce(idle({ checkIn: true })).mockResolvedValue(state());
    releaseCompleted.mockResolvedValue(null);
    const { result } = renderHook(() => useDisplay());
    await flush();
    await wait(17_100);
    await wait(COMPLETED_HOLD_MS + 50);
    expect(result.current.data?.state).toBe('idle');
    expect(result.current.data?.checkIn).toBeUndefined();
  });

  it('§72 a paired display remembers its SALON for a restart without network — never the customer on screen', async () => {
    localStorage.clear();
    const branding = { salonName: 'Polished Nails', logoUrl: null, tagline: 'Nails · Spa', branchName: null, idleMessage: null };
    fetchState.mockResolvedValue(state({ branding }));
    renderHook(() => useDisplay());
    await flush();
    const raw = localStorage.getItem(SALON_STORE_KEY)!;
    expect(JSON.parse(raw)).toEqual({ salonName: 'Polished Nails', branding });
    for (const leak of ['Dana', 'sess-1', 'Gel Manicure', '14240']) expect(raw).not.toContain(leak);
  });

  it("keeps the salon's branding (§13) — and only the salon's — in the cleared idle state", async () => {
    const branding = { salonName: 'Polished Nails', logoUrl: '/media/salon-logos/t1/logo-0123456789abcdef01234567.png', tagline: 'Nails · Spa', branchName: 'Downtown', idleMessage: 'Welcome!' };
    fetchState.mockResolvedValue(state({ branding: { ...branding, extra: 'Dana' } as any }));
    releaseCompleted.mockImplementation(() => new Promise(() => undefined));     // the server has not answered yet
    const { result } = renderHook(() => useDisplay());
    await flush();
    await wait(COMPLETED_HOLD_MS + 50);
    const d = result.current.data!;
    expect(d.state).toBe('idle');
    expect(d.branding).toEqual(branding);                                       // copied field by field: nothing else rides along
    expect(JSON.stringify(d)).not.toContain('Dana');
  });
});
