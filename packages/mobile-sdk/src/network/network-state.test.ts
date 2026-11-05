// network-state.test — Constitution 6 §16: online / offline / degraded, from the browser's own signal + request outcomes.
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { networkState, resetNetworkState, DEGRADED_AFTER } from './network-state';
import { useNetworkState } from './react';

const setOnline = (v: boolean) => { Object.defineProperty(window.navigator, 'onLine', { value: v, configurable: true }); window.dispatchEvent(new Event(v ? 'online' : 'offline')); };

describe('NetworkState', () => {
  beforeEach(() => { setOnline(true); resetNetworkState(); });

  it('starts online; the browser going offline makes it offline, back online makes it online', () => {
    expect(networkState.get().status).toBe('online');
    setOnline(false);
    expect(networkState.get().status).toBe('offline');
    setOnline(true);
    expect(networkState.get().status).toBe('online');
  });

  it(`${DEGRADED_AFTER} consecutive transport failures while "online" → degraded; one success clears it`, () => {
    for (let i = 0; i < DEGRADED_AFTER - 1; i++) networkState.recordFailure();
    expect(networkState.get().status).toBe('online');
    networkState.recordFailure();
    expect(networkState.get().status).toBe('degraded');
    networkState.recordSuccess();
    expect(networkState.get().status).toBe('online');
  });

  it('offline wins over degraded', () => {
    for (let i = 0; i < DEGRADED_AFTER; i++) networkState.recordFailure();
    setOnline(false);
    expect(networkState.get().status).toBe('offline');
  });

  it('useNetworkState re-renders on change', () => {
    const { result } = renderHook(() => useNetworkState());
    expect(result.current.status).toBe('online');
    act(() => setOnline(false));
    expect(result.current.status).toBe('offline');
    expect(typeof result.current.since).toBe('number');
  });
});
