// customer-display-telemetry.ts — Dual-Screen mandate §107–§108 (Oct 12 2026): what the customer displays are doing, as
// metrics (scraped at /metrics, one process-wide registry). Active / offline displays per branch are already in the
// branch-health snapshots (displays_total / displays_online, apps/api/src/observability/branch-health.ts); these are the
// event rates the mandate lists:
//
//   check_in / check_in_failed   a guest checked in on a display (or the display refused / failed it)
//   session_started              a checkout was sent to a display (a display session began)
//   display_busy                 Send to Display found the display showing another customer (DISPLAY_BUSY)
//   reconnect                    a display (re)opened its realtime stream
//   ad_impression                ads a display reports it SHOWED (never "viewed" — §109)
//   playlist_failed              a display asked for its playlist and the server failed to answer
//
// and how long the server took to build the state a display fetched (the server half of "checkout display latency"),
// by coarse mode. No tenant / branch / device label: per-tenant cardinality belongs in the log lines (§107), which
// carry them through the request context. Never throws into a display request.
import { BUCKETS, registry } from './metrics';
import { log } from './logger';

export const CUSTOMER_DISPLAY_EVENTS = ['check_in', 'check_in_failed', 'session_started', 'display_busy', 'reconnect', 'ad_impression', 'playlist_failed'] as const;
export type CustomerDisplayEvent = (typeof CUSTOMER_DISPLAY_EVENTS)[number];
export const customerDisplayEvents = registry.counter('aipowersalon_customer_display_events_total',
  'Customer display events: check-ins, failures, display sessions, DISPLAY_BUSY, stream reconnects, ad impressions, playlist failures', ['event']);

export const CUSTOMER_DISPLAY_STATE_MODES = ['idle', 'checkout', 'payment', 'complete'] as const;
export type CustomerDisplayStateMode = (typeof CUSTOMER_DISPLAY_STATE_MODES)[number];
export const customerDisplayStateSeconds = registry.histogram('aipowersalon_customer_display_state_seconds',
  'Server time to build the state a customer display fetched, by coarse mode', ['mode'], BUCKETS.api);

const isEvent = (e: unknown): e is CustomerDisplayEvent => (CUSTOMER_DISPLAY_EVENTS as readonly unknown[]).includes(e);

export function recordDisplayEvent(event: CustomerDisplayEvent, by = 1): void {
  try { if (isEvent(event) && Number.isFinite(by) && by > 0) customerDisplayEvents.inc({ event }, by); } catch { /* best-effort */ }
}

export function observeDisplayState(mode: CustomerDisplayStateMode, seconds: number): void {
  try { if ((CUSTOMER_DISPLAY_STATE_MODES as readonly string[]).includes(mode)) customerDisplayStateSeconds.observe(seconds, { mode }); } catch { /* best-effort */ }
}

/** The coarse mode of a display state (its `state` field). */
export function displayStateMode(state: string | null | undefined): CustomerDisplayStateMode {
  switch (state) {
    case 'ticket_review': case 'tip_selected': case 'expired': return 'checkout';
    case 'payment_processing': case 'payment_verifying': case 'payment_failed': return 'payment';
    case 'payment_success': return 'complete';
    default: return 'idle';
  }
}

/**
 * §107: one line per display operation — device id, mode, operation, duration, outcome. The request context adds the
 * request / correlation ids and the tenant and branch (enriched when the device credential resolved). No customer
 * data, no token: the fields are fixed here.
 */
export function logDisplayOperation(f: { deviceId: string | null; operation: string; mode?: string | null; durationMs: number; status: 'ok' | 'refused' | 'error' }): void {
  try { log.info('customer_display.operation', { deviceId: f.deviceId, operation: f.operation, mode: f.mode ?? null, durationMs: Math.round(f.durationMs), status: f.status }); } catch { /* best-effort */ }
}
