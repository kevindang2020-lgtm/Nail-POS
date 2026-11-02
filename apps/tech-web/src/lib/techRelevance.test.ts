// M4 (Oct 24 2026): the Technician App's realtime refetch filter. One salon visit (booked → checked in → assigned →
// served → paid on the customer display) puts ~25 frames on the BRANCH room; at 200 technicians each frame used to cost
// 3 GETs per phone. These tests pin what each card still refetches on, and that nothing the technician must see live
// is dropped (own-room frames, reconcile, her own appointment / service / status / earnings changes).
import { describe, it, expect } from 'vitest';
import { screensToRefetch } from '@aipowersalon/realtime-contracts';
import { TODAY_FILTER, TIME_CLOCK_FILTER, HELP_FILTER, QUEUE_FILTER, OWN_ROOM_SLOT, techFrameFilter, BranchFrameThrottle, BRANCH_REFETCH_MIN_MS } from './techRelevance';

/** The branch-room frames of one visit with a customer-display card payment (event names from realtime-contracts). */
export const VISIT_BRANCH_EVENTS = [
  'appointment_created', 'customer_checked_in', 'queue_updated', 'ticket_assigned', 'technician_status_updated',
  'service_started', 'service_done', 'technician_status_updated', 'ticket_ready_checkout', 'checkout_total_recalculated',
  'customer_display_session_started', 'customer_display_checkout_updated', 'customer_display_tip_selected',
  'customer_display_payment_requested', 'customer_display_method_selected', 'payment_processing_started',
  'payment_approved', 'ticket_paid', 'receipt_created', 'receipt_sent', 'ticket_closed', 'technician_earnings_updated',
  'loyalty_points_added', 'customer_display_completed', 'queue_updated',
] as const;
const frame = (event: string, stream = 'r0') => ({ event, screens: screensToRefetch(event), stream });
const count = (f: (d: any) => boolean) => VISIT_BRANCH_EVENTS.filter((e) => f(frame(e))).length;

describe('Tech App refetch filter (M4 200-technician scale)', () => {
  it('every visit event is a known event with screens (the filter reads the ONE event → screen map)', () => {
    for (const e of VISIT_BRANCH_EVENTS) expect(screensToRefetch(e).length, e).toBeGreaterThan(0);
  });

  it('home dashboard: refetches on the visit\'s appointment / queue / service / status / paid frames, not on the display and payment chatter', () => {
    expect(count(TODAY_FILTER)).toBe(12);
    for (const e of ['appointment_created', 'customer_checked_in', 'ticket_assigned', 'service_started', 'service_done', 'technician_status_updated', 'ticket_paid', 'technician_earnings_updated', 'ticket_closed'])
      expect(TODAY_FILTER(frame(e)), e).toBe(true);
    for (const e of ['customer_display_checkout_updated', 'customer_display_tip_selected', 'payment_processing_started', 'payment_approved', 'receipt_sent', 'loyalty_points_added', 'checkout_total_recalculated'])
      expect(TODAY_FILTER(frame(e)), e).toBe(false);
  });

  it('time clock and help cards: only their own events', () => {
    expect(count(TIME_CLOCK_FILTER)).toBe(2);           // the two status changes of the visit
    expect(count(HELP_FILTER)).toBe(0);
    expect(TIME_CLOCK_FILTER(frame('technician_clock_updated'))).toBe(true);
    expect(TIME_CLOCK_FILTER(frame('time_clock_updated'))).toBe(true);
    expect(HELP_FILTER(frame('technician_help_requested'))).toBe(true);
  });

  it('per visit and phone: 75 dashboard refetches before (3 cards × 25 frames), 14 after', () => {
    expect(VISIT_BRANCH_EVENTS.length * 3).toBe(75);
    expect(count(TODAY_FILTER) + count(TIME_CLOCK_FILTER) + count(HELP_FILTER)).toBe(14);
  });

  it('own-room frames and reconcile always pass, whatever the event', () => {
    for (const f of [TODAY_FILTER, TIME_CLOCK_FILTER, HELP_FILTER, QUEUE_FILTER]) {
      expect(f(frame('customer_display_tip_selected', OWN_ROOM_SLOT))).toBe(true);
      expect(f({ event: 'reconcile', screens: [] })).toBe(true);
      expect(f({ event: 'poll', screens: [] })).toBe(true);
    }
  });

  it('a frame without server screens falls back to the shared map; an unknown event touches no card', () => {
    const f = techFrameFilter(['serving']);
    expect(f({ event: 'service_started', screens: [] })).toBe(true);
    expect(f({ event: 'no_such_event', screens: [] })).toBe(false);
  });

  it('queue tab: the shared branch queue still refetches on every queue / serving change', () => {
    for (const e of ['customer_checked_in', 'queue_updated', 'ticket_assigned', 'service_started', 'service_done', 'technician_status_updated'])
      expect(QUEUE_FILTER(frame(e)), e).toBe(true);
    expect(QUEUE_FILTER(frame('customer_display_tip_selected'))).toBe(false);
  });
});

describe('BranchFrameThrottle — a relevant branch frame refetches at most once per 5 s; own-room frames never wait', () => {
  function rig() {
    let now = 0; const fired: [number, string][] = []; const timers: { at: number; fn: () => void }[] = [];
    const setT = ((fn: () => void, ms: number) => { const t = { at: now + ms, fn }; timers.push(t); return t; }) as any;
    const clearT = ((t: any) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); }) as any;
    const th = new BranchFrameThrottle((ev) => fired.push([now, ev]), BRANCH_REFETCH_MIN_MS, () => now, setT, clearT);
    const advance = (ms: number) => { const end = now + ms; for (;;) { timers.sort((a, b) => a.at - b.at); const t = timers[0]; if (!t || t.at > end) break; timers.shift(); now = t.at; t.fn(); } now = end; };
    return { th, fired, advance, at: (ms: number) => { now = ms; }, timers };
  }
  it('leading refetch, then ONE trailing refetch for a burst inside the window', () => {
    const r = rig();
    r.th.branch('service_started');                       // t=0 → at once
    r.at(1_000); r.th.branch('service_done');
    r.at(2_000); r.th.branch('ticket_paid');               // folded into the trailing refetch
    r.advance(10_000);
    expect(r.fired).toEqual([[0, 'service_started'], [5_000, 'ticket_paid']]);
  });
  it('a steady 48 relevant frames a minute (200-technician peak) → 12 refetches a minute, not 48', () => {
    const r = rig();
    for (let i = 0; i < 48; i++) { r.th.branch('queue_updated'); r.advance(1_250); }
    expect(r.fired.length).toBeLessThanOrEqual(13);
    expect(r.fired.length).toBeGreaterThanOrEqual(12);
  });
  it('an own-room frame (or reconcile) refetches at once and absorbs a waiting branch refetch', () => {
    const r = rig();
    r.th.branch('appointment_created');
    r.at(1_000); r.th.branch('appointment_updated');       // trailing armed for t=5,000
    r.at(2_000); r.th.immediate('queue_updated');          // own room: now, and the trailing one is no longer needed
    r.advance(10_000);
    expect(r.fired).toEqual([[0, 'appointment_created'], [2_000, 'queue_updated']]);
    expect(r.timers.length).toBe(0);
  });
  it('cancel() (unmount) leaves no timer behind', () => {
    const r = rig();
    r.th.branch('a'); r.at(100); r.th.branch('b');
    r.th.cancel();
    expect(r.timers.length).toBe(0);
  });
});
