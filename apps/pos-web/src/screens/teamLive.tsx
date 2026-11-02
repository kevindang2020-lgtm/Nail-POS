// teamLive.tsx — Team Management round 2A (TM-05, Four-Module Completion Guide §9.2, 30 Oct 2026): live updates on the
// EXISTING realtime stream (useRealtime → the shared SSE client; no new transport, no new event names).
//   • events that change a team dataset → ONE coalesced refresh of the screen's loads (dashboard, directory, alert count):
//       technician_profile_updated / membership (employee created · edited)  → 'technicians'
//       authorization_changed (role / access change)                         → 'team-permissions'
//       technician_clock_updated / time_clock_updated (clock-in / out)       → 'technicians' · 'time-clock'
//       technician_status_updated (break start / end, availability)          → 'technicians' · 'live-schedule'
//       technician_schedule_updated (one-date shift override, weekly change) → 'technicians' · 'tech-schedule'
//       service_started / service_done (service started / completed)        → 'serving'
//       approval_updated (approvals)                                         → 'approvals'
//   • the refresh only bumps a counter in the loads' deps: filters, sort, page, the search box and an open overlay are
//     untouched (they live in the URL / component state, never in the refreshed data)
//   • stale guards: the shared client drops a duplicate eventId and a strictly older resourceVersion; an event never carries
//     data the screen paints (it refetches what the user may see), and `useNewest` never lets an answer whose `asOf` is older
//     than the one on screen replace it (a slow response overtaken by a newer one)
//   • reconnect: the client reconciles (immediate refresh) after a real gap; fallback polling every 30 s while the stream is
//     not connected (60 s safety sync while it is); the indicator says Live / Reconnecting / Polling — never "Live" unless the
//     stream is actually CONNECTED.
import { useEffect, useRef, useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { REALTIME_STATUS, realtimeStatus } from '../realtime/realtime-client';
import type { RealtimeStatus } from '../realtime/realtime-core';
import { useRealtime } from '../realtime/useRealtime';
import { whenTime } from './technicianScreenParts';
import { liveModeOf, isStale, type LiveMode } from './teamLiveCore';
export { liveModeOf, isStale, type LiveMode } from './teamLiveCore';

export const TEAM_LIVE_SCREENS = ['technicians', 'team-permissions', 'time-clock', 'live-schedule', 'tech-schedule', 'serving', 'approvals'];
export const TEAM_POLL_FALLBACK_MS = 30_000;
export const TEAM_POLL_CONNECTED_MS = 60_000;

/** keep the newest answer (by asOf) of one dataset; a reset key (filters) starts over */
export function useNewest<T extends { asOf?: string | null }>(data: T | null, resetKey: string): T | null {
  const ref = useRef<{ key: string; v: T | null }>({ key: resetKey, v: null });
  if (ref.current.key !== resetKey) ref.current = { key: resetKey, v: null };
  if (data && !isStale(data, ref.current.v)) ref.current.v = data;
  return ref.current.v ?? data;
}

/** subscribe Team Management to the stream; returns the refresh counter to put in the loads' deps + the indicator state */
export function useTeamLive(): { tick: number; mode: LiveMode; lastAt: number | null; refreshNow: () => void } {
  const [status, setStatus] = useState<RealtimeStatus>(() => realtimeStatus());
  const [polled, setPolled] = useState(false);
  const [tick, setTick] = useState(0); const [lastAt, setLastAt] = useState<number | null>(null);
  useEffect(() => {
    const h = (e: Event) => { const s = (e as CustomEvent<{ status: RealtimeStatus }>).detail?.status; if (s) { setStatus(s); if (s === 'CONNECTED') setPolled(false); } };
    window.addEventListener(REALTIME_STATUS, h);
    setStatus(realtimeStatus());
    return () => window.removeEventListener(REALTIME_STATUS, h);
  }, []);
  const connected = status === 'CONNECTED';
  const refresh = () => { setTick((n) => n + 1); setLastAt(Date.now()); };
  useRealtime(TEAM_LIVE_SCREENS, (reason) => {
    if (reason === 'interval' && realtimeStatus() !== 'CONNECTED') setPolled(true);
    refresh();
  }, { intervalMs: connected ? TEAM_POLL_CONNECTED_MS : TEAM_POLL_FALLBACK_MS, hiddenMs: 60_000 });
  return { tick, mode: liveModeOf(status, polled), lastAt, refreshNow: refresh };
}

export function TeamLiveBadge({ mode, lastAt }: { mode: LiveMode; lastAt: number | null }) {
  return (
    <span className={'tm2-live ' + mode} role="status" aria-live="polite" data-testid="live-indicator" data-mode={mode}
      title={tx('tm2.live.' + mode, { s: String(TEAM_POLL_FALLBACK_MS / 1000) }) + ' · ' + (lastAt ? tx('tm2.live.updated', { at: whenTime(new Date(lastAt).toISOString()) }) : tx('tm2.live.rule'))}>
      <span className="tm2-live-dot" aria-hidden /><span className="tm2-live-t">{tx('tm2.live.' + mode, { s: String(TEAM_POLL_FALLBACK_MS / 1000) })}</span>
    </span>
  );
}
