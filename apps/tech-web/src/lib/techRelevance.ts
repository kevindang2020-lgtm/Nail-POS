// techRelevance.ts — which realtime frames make a Technician App card refetch (M4 200-technician scale, Oct 24 2026).
//
// The tech stream carries the BRANCH room (every event of the salon) and the technician's OWN room. Before this every
// card refetched on every frame: one checkout on the customer display (~10 display / payment events) made each of a
// 200-technician salon's phones re-read its dashboard, time clock and help requests — 3 GETs × 200 phones per frame,
// for data that is all the technician's own. Now a card refetches on:
//   • any frame from the technician's OWN room (assignments, status, earnings, help, turn — routed there by the server);
//   • a branch frame whose screens (realtime-contracts screensToRefetch, the ONE event → screen map) touch the card, or
//     whose event the card names;
//   • 'reconcile' / 'poll' (the 15 s safety sync, a sequence gap, a reconnect) — always.
// A frame that is dropped here is never a missed update for long: the always-on safety sync re-reads every 15 s.
import type { RealtimeDetail } from '@aipowersalon/realtime-client';
import { screensToRefetch } from '@aipowersalon/realtime-contracts';

export type TechFrameFilter = (d: Pick<RealtimeDetail, 'event' | 'screens' | 'stream'>) => boolean;

/** The technician's OWN room is the stream's second slot (tech-realtime.controller: [branch room, technician room]). */
export const OWN_ROOM_SLOT = 'r1';

export function techFrameFilter(screens: readonly string[], events: readonly string[] = []): TechFrameFilter {
  const s = new Set(screens), e = new Set(events);
  return (d) => {
    if (d.event === 'reconcile' || d.event === 'poll') return true;
    if (d.stream === OWN_ROOM_SLOT) return true;
    if (e.has(d.event)) return true;
    const list = d.screens && d.screens.length ? d.screens : screensToRefetch(d.event);
    return list.some((x) => s.has(x));
  };
}

/** Home dashboard (GET /tech): the technician's own appointments, current service, status, earnings, turn. */
export const TODAY_FILTER = techFrameFilter(['tech-appointments', 'tech-queue', 'serving', 'technicians', 'turn-queue', 'tech-turn-queue', 'tech-schedule', 'live-schedule', 'time-clock']);
/** Time clock card: punches and status. */
export const TIME_CLOCK_FILTER = techFrameFilter(['time-clock', 'live-schedule'], ['time_clock_updated', 'technician_status_updated', 'technician_clock_updated']);
/** Help requests card: the three help events (they also reach the own room). */
export const HELP_FILTER = techFrameFilter([], ['technician_help_requested', 'technician_help_accepted', 'technician_help_declined']);
/** Queue tab + turn rotation: the branch queue is genuinely shared, so every queue / serving / turn change counts. */
export const QUEUE_FILTER = techFrameFilter(['tech-queue', 'queue', 'turn-queue', 'tech-turn-queue', 'serving', 'check-in']);

/** A relevant BRANCH frame refetches a card at most once per this window (leading + one trailing refetch); the
 *  technician's own-room frames and reconcile are never delayed. At a 200-technician salon's peak (~4 visits a minute,
 *  ~48 dashboard-relevant branch frames a minute) this bounds each phone's realtime re-reads per card to 12 a minute,
 *  however busy the salon gets; a branch change shows on the phone within 5 s (the safety sync's 15 s is the backstop). */
export const BRANCH_REFETCH_MIN_MS = 5_000;

/** Leading + trailing throttle for branch frames. Timer functions are called unbound (see sync-policy.ts). */
export class BranchFrameThrottle {
  private last = -Infinity;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: string | null = null;
  constructor(
    private readonly fire: (event: string) => void,
    private readonly minMs: number = BRANCH_REFETCH_MIN_MS,
    private readonly now: () => number = Date.now,
    private readonly setT: typeof setTimeout = setTimeout,
    private readonly clearT: typeof clearTimeout = clearTimeout,
  ) {}
  /** Own-room frame / reconcile: refetch now; it also satisfies any branch refetch that was waiting. */
  immediate(event: string): void {
    this.cancel();
    this.last = this.now();
    this.fire(event);
  }
  branch(event: string): void {
    const t = this.now();
    if (this.timer) { this.pending = event; return; }
    if (t - this.last >= this.minMs) { this.last = t; this.fire(event); return; }
    this.pending = event;
    const st = this.setT;
    this.timer = st(() => { this.timer = null; const ev = this.pending ?? event; this.pending = null; this.last = this.now(); this.fire(ev); }, Math.max(0, this.last + this.minMs - t));
  }
  cancel(): void {
    if (this.timer) { const ct = this.clearT; ct(this.timer); }
    this.timer = null; this.pending = null;
  }
}
