// useDisplay.ads.test.ts — 23-inch spec §73–§74, §102: one realtime connection serves both halves of the screen. The
// salon's advertising changed (customer_display_ads_updated on this device's channel) → the playlist is asked again
// and the checkout state is NOT refetched; any checkout event → the state is refetched; a reconnect → both.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const rt = vi.hoisted(() => ({ onEvent: [] as ((d: any) => void)[], onReconcile: [] as ((r: string) => void)[] }));
vi.mock('@aipowersalon/realtime-client', () => ({
  createRealtimeClient: () => ({
    onEvent: (fn: any) => { rt.onEvent.push(fn); return () => undefined; },
    onReconcile: (fn: any) => { rt.onReconcile.push(fn); return () => undefined; },
    onStatus: () => () => undefined, status: () => 'CONNECTED', connect: () => undefined, disconnect: () => undefined,
  }),
  FallbackPoller: class { onStatus() { /* */ } stop() { /* */ } },
  startVisibleSafetySync: () => () => undefined,
  SYNC_POLICY: { operationalMs: 15_000 },
}));
const fetchState = vi.fn();
vi.mock('./api', () => ({
  readCreds: () => ({ mode: 'device', deviceToken: 'd1' }),
  fetchState: (...a: any[]) => fetchState(...a),
  releaseCompleted: vi.fn(), streamUrl: () => 'http://localhost/stream', streamSource: () => undefined, submitReceipt: vi.fn(),
  submitTip: vi.fn(), submitMethod: vi.fn(), requestPayment: vi.fn(), submitRating: vi.fn(), 
  DisplayApiError: class extends Error { status = 0; },
}));

import { useDisplay } from './useDisplay';

const idle = { state: 'idle', salonName: 'Luxury Nails', tipOptions: [], selectedTipCents: 0, totals: { subtotalCents: 0, tipCents: 0, taxCents: 0, surchargeCents: 0, giftCardChargeCents: 0, totalDueCents: 0 }, payButtonEnabled: false };
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(20); });

beforeEach(() => { rt.onEvent.length = 0; rt.onReconcile.length = 0; fetchState.mockReset(); fetchState.mockResolvedValue(idle); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

describe('one realtime channel, two halves of the screen', () => {
  it('an advertising change nudges the playlist only; a checkout event refetches the state; a reconnect does both', async () => {
    const { result } = renderHook(() => useDisplay());
    await flush();
    expect(fetchState).toHaveBeenCalledTimes(1);
    expect(result.current.adsNudge).toBe(0);
    const emit = rt.onEvent[rt.onEvent.length - 1]!;

    await act(async () => { emit({ event: 'customer_display_ads_updated', screens: ['display-ads'], payload: { reason: 'published' } }); await vi.advanceTimersByTimeAsync(20); });
    expect(result.current.adsNudge).toBe(1);
    expect(fetchState).toHaveBeenCalledTimes(1);   // the checkout state is untouched by an ad change

    await act(async () => { emit({ event: 'customer_display_session_started', screens: ['checkout'] }); await vi.advanceTimersByTimeAsync(20); });
    expect(fetchState).toHaveBeenCalledTimes(2);
    expect(result.current.adsNudge).toBe(1);

    await act(async () => { rt.onReconcile[rt.onReconcile.length - 1]!('reconnect'); await vi.advanceTimersByTimeAsync(20); });
    expect(fetchState).toHaveBeenCalledTimes(3);
    expect(result.current.adsNudge).toBe(2);
  });
});
