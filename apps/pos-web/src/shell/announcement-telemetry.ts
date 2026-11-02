// announcement-telemetry.ts — Platform Announcement mandate §116 (observability of fetch / realtime failure) for the POS bar.
//
// A failed snapshot used to be a console.warn only — invisible to operations. Each failure is now ALSO counted on the
// platform's existing, public, allow-listed intake (POST /client-telemetry/events → the Prometheus counter
// `aipowersalon_client_events_total{app="pos",event=…}`, shown on Super Admin → System Operations → Mobile apps):
//
//   platform_announcement_snapshot_failed   the startup / scheduled (nextChangeAt) / safety-sync snapshot failed
//   platform_announcement_realtime_failed   the refetch a realtime signal or a reconnect asked for failed
//   platform_announcement_receipt_failed    recording delivered / dismissed / "I understand" failed
//
// PRIVACY: the event NAME is the whole report — no props, no message text, no ids (the shared allowlist in
// @aipowersalon/api-contracts client-telemetry is applied here and again by the server). VOLUME: at most one report per
// kind per minute per POS tab (a dead API with a 15 s safety sync is 1/min, not 4/min). Fire-and-forget with keepalive;
// it never throws and never awaits — a reporter must not break the header it reports on (§114).
import { sanitizeAnalyticsEvent, type AnalyticsEventName } from '@aipowersalon/api-contracts';
import { apiUrl } from '../api/apiBase';

export type AnnouncementFailure = 'snapshot' | 'realtime' | 'receipt';
const EVENT: Record<AnnouncementFailure, AnalyticsEventName> = {
  snapshot: 'platform_announcement_snapshot_failed',
  realtime: 'platform_announcement_realtime_failed',
  receipt: 'platform_announcement_receipt_failed',
};
export const ANNOUNCEMENT_FAILURE_THROTTLE_MS = 60_000;

type Sender = (url: string, body: string) => void;
const defaultSend: Sender = (url, body) => {
  try { void fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true, credentials: 'omit' }).catch(() => undefined); }
  catch { /* never */ }
};
let send: Sender = defaultSend;
let now: () => number = () => Date.now();
const last = new Map<AnnouncementFailure, number>();

/** Count one failure (throttled). Returns true when a report was sent. Never throws. */
export function reportAnnouncementFailure(kind: AnnouncementFailure): boolean {
  try {
    const t = now(); const prev = last.get(kind);
    if (prev !== undefined && t - prev < ANNOUNCEMENT_FAILURE_THROTTLE_MS) return false;
    const e = sanitizeAnalyticsEvent(EVENT[kind], {});
    if (!e) return false;
    last.set(kind, t);
    const version = String((import.meta as unknown as { env?: { VITE_APP_VERSION?: string } }).env?.VITE_APP_VERSION || 'unknown').replace(/[^\w.+-]/g, '').slice(0, 32) || 'unknown';
    send(apiUrl('/client-telemetry/events'), JSON.stringify({ app: 'pos', version, platform: 'web', events: [e], perf: [] }));
    return true;
  } catch { return false; }
}

/** Tests only. */
export function setAnnouncementTelemetryForTests(o: { send?: Sender; now?: () => number } | null): void {
  send = o?.send ?? defaultSend; now = o?.now ?? (() => Date.now()); last.clear();
}
