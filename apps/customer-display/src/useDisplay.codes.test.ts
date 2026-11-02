import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { CustomerDisplayState } from '@aipowersalon/api-contracts/customer';

// Dual-Screen mandate §104: the display reacts to the standard CODE, never to the words. A checkout the POS already
// ended (DISPLAY_SESSION_NOT_FOUND / DISPLAY_SESSION_EXPIRED) is not an error to show the customer — the display reloads
// its state (which takes the dead checkout off the screen); any other refusal is shown.
const fetchState = vi.fn();
const submitTip = vi.fn();
const { FakeApiError } = vi.hoisted(() => ({ FakeApiError: class extends Error { constructor(public status: number, message: string, public code?: string) { super(message); } } }));
const sync = vi.hoisted(() => ({ fn: null as null | (() => unknown) }));
vi.mock('@aipowersalon/realtime-client', () => ({
  createRealtimeClient: () => ({ onEvent: () => () => undefined, onReconcile: () => () => undefined, onStatus: () => () => undefined, status: () => 'CONNECTED', connect: () => undefined, disconnect: () => undefined }),
  FallbackPoller: class { onStatus() { /* */ } stop() { /* */ } },
  startVisibleSafetySync: (fn: () => unknown) => { sync.fn = fn; return () => undefined; },
  SYNC_POLICY: { operationalMs: 15_000 },
}));
vi.mock('./api', () => ({
  readCreds: () => ({ mode: 'device', deviceToken: 'd1' }),
  fetchState: (...a: any[]) => fetchState(...a),
  releaseCompleted: vi.fn(), streamUrl: () => 'http://localhost/stream', streamSource: () => undefined, submitReceipt: vi.fn(),
  submitTip: (...a: any[]) => submitTip(...a), submitMethod: vi.fn(), requestPayment: vi.fn(), submitRating: vi.fn(),
  DisplayApiError: FakeApiError,
}));
import { useDisplay } from './useDisplay';

const checkout = (): CustomerDisplayState => ({
  state: 'ticket_review', salonName: 'Polished Nails', sessionId: 's1', version: 3, customer: { firstName: 'Dana' }, tipOptions: [], selectedTipCents: 0,
  totals: { subtotalCents: 5000, tipCents: 0, taxCents: 0, surchargeCents: 0, giftCardChargeCents: 0, totalDueCents: 5000 }, payButtonEnabled: false,
});
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(20); });
beforeEach(() => { fetchState.mockReset(); submitTip.mockReset(); (globalThis as any).EventSource = undefined; vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

describe('§104 codes on the display', () => {
  it.each(['DISPLAY_SESSION_NOT_FOUND', 'DISPLAY_SESSION_EXPIRED'])('%s: no error for the customer — the state is reloaded', async (code) => {
    fetchState.mockResolvedValue(checkout());
    submitTip.mockRejectedValue(new FakeApiError(code === 'DISPLAY_SESSION_EXPIRED' ? 410 : 404, 'There is no checkout on this display.', code));
    const { result } = renderHook(() => useDisplay());
    await flush();
    const before = fetchState.mock.calls.length;
    await act(async () => { result.current.chooseTip({ tipType: 'none' }); await vi.advanceTimersByTimeAsync(20); });
    expect(result.current.actionError).toBeNull();
    expect(fetchState.mock.calls.length).toBeGreaterThan(before);
  });
  it('any other refusal is shown', async () => {
    fetchState.mockResolvedValue(checkout());
    submitTip.mockRejectedValue(new FakeApiError(400, 'The tip can no longer be changed.'));
    const { result } = renderHook(() => useDisplay());
    await flush();
    await act(async () => { result.current.chooseTip({ tipType: 'none' }); await vi.advanceTimersByTimeAsync(20); });
    expect(result.current.actionError).toBe('The tip can no longer be changed.');
  });
});

describe('§78–§81 online: the server answering decides OFFLINE — never a refusal, never a blank', () => {
  it('a failed fetch marks the display offline but keeps the last screen; the next answer brings it back', async () => {
    fetchState.mockResolvedValueOnce(checkout());
    const { result } = renderHook(() => useDisplay());
    await flush();
    expect(result.current.online).toBe(true);
    fetchState.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await act(async () => { sync.fn?.(); await vi.advanceTimersByTimeAsync(20); });   // the safety sync asks again
    expect(result.current.online).toBe(false);
    expect(result.current.data?.customer?.firstName).toBe('Dana');          // §79: the checkout stays on screen
    fetchState.mockResolvedValueOnce(checkout());
    await act(async () => { sync.fn?.(); await vi.advanceTimersByTimeAsync(20); });
    expect(result.current.online).toBe(true);
    fetchState.mockRejectedValueOnce(new FakeApiError(503, 'Service unavailable'));   // a failing server is offline too
    await act(async () => { sync.fn?.(); await vi.advanceTimersByTimeAsync(20); });
    expect(result.current.online).toBe(false);
    fetchState.mockResolvedValue(checkout());
    await act(async () => { sync.fn?.(); await vi.advanceTimersByTimeAsync(20); });
    expect(result.current.online).toBe(true);
  });
  it('a refusal (400) is an answer: still online', async () => {
    fetchState.mockResolvedValueOnce(checkout());
    const { result } = renderHook(() => useDisplay());
    await flush();
    fetchState.mockRejectedValueOnce(new FakeApiError(400, 'nope'));
    await act(async () => { sync.fn?.(); await vi.advanceTimersByTimeAsync(20); });
    expect(result.current.online).toBe(true);
  });
});
