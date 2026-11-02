// react.ts — the React surface of the shared client: one hook per concern, each tearing down on unmount (§173).
import { useEffect, useRef, useState } from 'react';
import type { RealtimeClient, RealtimeDetail, ChannelName } from './client';
import { RefetchCoalescer, type RealtimeStatus } from './core';

/**
 * Refetch `screen` when a realtime event names it or a reconcile fires. Bursts coalesce to ONE refetch (§99/§103);
 * the handler updates/invalidates the app's server-state cache — never a second store (§180).
 */
export function useRealtimeRefetch(client: RealtimeClient, screen: string, refetch: () => void, coalesceMs = 250): void {
  const ref = useRef(refetch); ref.current = refetch;
  useEffect(() => {
    const co = new RefetchCoalescer(() => ref.current(), coalesceMs);
    const offEvent = client.onEvent((d: RealtimeDetail) => { if (d.screens.includes(screen)) co.request(screen); });
    const offReconcile = client.onReconcile(() => co.request(screen));
    return () => { offEvent(); offReconcile(); co.cancelAll(); };
  }, [client, screen, coalesceMs]);
}

/** §175: subscribe by channel. */
export function useRealtimeChannel(client: RealtimeClient, channel: ChannelName, onEvent: (d: RealtimeDetail) => void): void {
  const ref = useRef(onEvent); ref.current = onEvent;
  useEffect(() => client.subscribe({ channel, onEvent: (d) => ref.current(d) }), [client, channel]);
}

/** §192: the status pill's input. */
export function useRealtimeStatus(client: RealtimeClient): RealtimeStatus {
  const [s, setS] = useState<RealtimeStatus>(client.status());
  useEffect(() => client.onStatus(setS), [client]);
  return s;
}
