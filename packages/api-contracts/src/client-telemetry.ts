// client-telemetry.ts — Constitution 6 §116–119 (BUILD_PLAN Phase 13, E): the analytics + performance wire contract and
// the ONE copy of its privacy rules, used by the mobile apps' track() (@aipowersalon/mobile-sdk telemetry/) BEFORE
// anything leaves the device and again by the API's POST /client-telemetry/events — a client that skips the first pass
// still cannot land a field the server would not have accepted.
//
// PRIVACY BY ALLOWLIST (Kevin's Phase 13 rule): an event is kept only when its NAME is listed; a prop only when its KEY is
// listed for that event AND its VALUE is enum-shaped (lower-case token, a route template, a small number, a boolean).
// Anything else — a name, an email, a phone, a card, a uuid, a note, free text — is dropped silently. Analytics are not
// business truth (§117): `booking_completed_ui` says a screen showed a confirmation, never that an appointment exists.
import { CLIENT_PLATFORMS } from './app-version';

/** Every app that may post telemetry (the error reporter's list). */
export const TELEMETRY_APPS = ['pos', 'admin', 'owner', 'tech', 'customer', 'manager-pay', 'customer-display', 'kiosk'] as const;
export type TelemetryApp = (typeof TELEMETRY_APPS)[number];

// Every prop VALUE comes from a closed set, is a route template ('route'), a boolean or a small count — never a free
// string, so nothing a person typed (or is called) can ride along under an allowed key.
const SOURCE = ['home', 'deals', 'deal', 'search', 'salon', 'tech_profile', 'rebook', 'notification', 'deep_link', 'ai', 'other'] as const;
const VALUES = {
  coldStart: 'boolean', fromBackground: 'boolean', offline: 'boolean', services: 'count',
  screen: 'route',
  source: SOURCE,
  method: ['password', 'faceid', 'passkey', 'otp', 'pin', 'card', 'cash', 'tap_to_pay', 'other'],
  category: ['appointment', 'queue', 'checkout', 'approval', 'alert', 'deal', 'message', 'payment', 'system', 'other'],
  decision: ['approve', 'reject'],
  language: ['en', 'vi'],
  state: ['update_required', 'update_recommended', 'maintenance'],
  timeoutClass: ['fast', 'normal', 'upload', 'long'],
  outcome: ['ok', 'error', 'timeout', 'offline', 'aborted'],
  reason: ['network', 'resume', 'error', 'ticket', 'other'],
} as const satisfies Record<string, 'boolean' | 'count' | 'route' | readonly string[]>;
type PropKey = keyof typeof VALUES;

/** §116: the product events and, for each, the props it may carry. */
export const ANALYTICS_EVENTS = {
  app_opened: ['coldStart'],
  screen_viewed: ['screen'],
  login_succeeded: ['method'],
  booking_started: ['source'],
  booking_completed_ui: ['source', 'services'],
  deal_opened: ['source'],
  notification_opened: ['category', 'fromBackground'],
  service_started_ui: ['offline'],
  service_completed_ui: ['offline'],
  approval_decided_ui: ['decision'],
  checkout_started_ui: ['method'],
  language_changed: ['language'],
  update_prompt_shown: ['state'],
  // Platform Announcement mandate §116 (Oct 27 2026): the POS top-bar announcement's failures — counted, never console-only.
  // No props: the name is the whole report (no message text, no ids).
  platform_announcement_snapshot_failed: [],
  platform_announcement_realtime_failed: [],
  platform_announcement_receipt_failed: [],
} as const satisfies Record<string, readonly PropKey[]>;
export type AnalyticsEventName = keyof typeof ANALYTICS_EVENTS;
export type AnalyticsProps = Record<string, string | number | boolean>;

/** §119: performance metrics and their allow-listed labels (each label's values are closed sets or a route template). */
export const PERF_METRICS = {
  launch_to_first_screen: ['screen'],
  screen_render: ['screen'],
  api_latency: ['timeoutClass', 'outcome'],
  realtime_reconnect: ['reason'],
} as const satisfies Record<string, readonly PropKey[]>;
export type PerfMetric = keyof typeof PERF_METRICS;

export const TELEMETRY_LIMITS = { eventsPerBatch: 50, perfPerBatch: 50, maxMs: 600_000, maxNumber: 9_999, version: 32 } as const;

export interface AnalyticsEvent { name: AnalyticsEventName; props: AnalyticsProps; at?: number }
export interface PerfMark { metric: PerfMetric; ms: number; labels?: Record<string, string> }
export interface ClientTelemetryBatch {
  app: TelemetryApp; version: string; platform: (typeof CLIENT_PLATFORMS)[number] | 'unknown';
  events: AnalyticsEvent[]; perf: PerfMark[];
}

/** A route path with ids removed and no query / hash — the same rule as the error reporter's route. */
export function normaliseClientRoute(r: unknown): string {
  if (typeof r !== 'string') return 'unknown';
  return (r.split('?')[0].split('#')[0]
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:id')
    .replace(/\/[^/]*\d{3,}[^/]*(?=\/|$)/g, (seg) => (/^\/\d+$/.test(seg) ? '/:n' : '/:id'))
    .replace(/\/[^/]*@[^/]*(?=\/|$)/g, '/:id')
    .slice(0, 120)) || '/';
}

const ROUTE = /^\/[a-z0-9_:/.-]{0,119}$/i;          // a route template after normaliseClientRoute
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function safeValue(key: string, v: unknown): string | number | boolean | undefined {
  const rule = (VALUES as Record<string, 'boolean' | 'count' | 'route' | readonly string[]>)[key];
  if (rule === 'boolean') return typeof v === 'boolean' ? v : undefined;
  if (rule === 'count') return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= TELEMETRY_LIMITS.maxNumber ? v : undefined;
  if (typeof v !== 'string') return undefined;
  if (rule === 'route') { const r = normaliseClientRoute(v.startsWith('/') ? v : '/' + v); return ROUTE.test(r) ? r : undefined; }
  return Array.isArray(rule) && rule.includes(v) ? v : undefined;   // a closed set: anything typed or personal is not in it
}

/** The event when its name is listed, with only listed, enum-shaped props; null when the name is not listed. */
export function sanitizeAnalyticsEvent(name: unknown, props?: unknown): AnalyticsEvent | null {
  if (typeof name !== 'string' || !own(ANALYTICS_EVENTS, name)) return null;
  const allowed = ANALYTICS_EVENTS[name as AnalyticsEventName] as readonly string[];
  const out: AnalyticsProps = {};
  if (props && typeof props === 'object') {
    for (const k of allowed) {
      if (!own(props, k)) continue;
      const v = safeValue(k, (props as Record<string, unknown>)[k]);
      if (v !== undefined) out[k] = v;
    }
  }
  return { name: name as AnalyticsEventName, props: out };
}

/** A perf mark with a known metric, a bounded non-negative duration and only listed labels; null otherwise. */
export function sanitizePerfMark(m: unknown): PerfMark | null {
  if (!m || typeof m !== 'object') return null;
  const { metric, ms, labels } = m as { metric?: unknown; ms?: unknown; labels?: unknown };
  if (typeof metric !== 'string' || !own(PERF_METRICS, metric)) return null;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0 || ms > TELEMETRY_LIMITS.maxMs) return null;
  const out: PerfMark = { metric: metric as PerfMetric, ms: Math.round(ms) };
  if (labels && typeof labels === 'object') {
    const l: Record<string, string> = {};
    for (const k of PERF_METRICS[metric as PerfMetric] as readonly string[]) {
      if (!own(labels, k)) continue;
      const v = safeValue(k, (labels as Record<string, unknown>)[k]);
      if (typeof v === 'string') l[k] = v;
    }
    if (Object.keys(l).length) out.labels = l;
  }
  return out;
}

/** A whole batch: app allow-listed (else null), version / platform cleaned, events and marks sanitized and capped. */
export function sanitizeTelemetryBatch(b: unknown): ClientTelemetryBatch | null {
  if (!b || typeof b !== 'object') return null;
  const x = b as Record<string, unknown>;
  if (typeof x.app !== 'string' || !(TELEMETRY_APPS as readonly string[]).includes(x.app)) return null;
  const version = typeof x.version === 'string' && /^[\w.+-]{1,32}$/.test(x.version) ? x.version : 'unknown';
  const platform = typeof x.platform === 'string' && (CLIENT_PLATFORMS as readonly string[]).includes(x.platform)
    ? (x.platform as ClientTelemetryBatch['platform']) : 'unknown';
  const events: AnalyticsEvent[] = [];
  for (const e of Array.isArray(x.events) ? x.events : []) {
    if (events.length >= TELEMETRY_LIMITS.eventsPerBatch) break;
    const s = sanitizeAnalyticsEvent((e as any)?.name, (e as any)?.props);
    if (s) events.push(s);
  }
  const perf: PerfMark[] = [];
  for (const m of Array.isArray(x.perf) ? x.perf : []) {
    if (perf.length >= TELEMETRY_LIMITS.perfPerBatch) break;
    const s = sanitizePerfMark(m);
    if (s) perf.push(s);
  }
  return { app: x.app as TelemetryApp, version, platform, events, perf };
}

/** GET /super-admin/system/mobile-telemetry — the System Operations "Mobile apps" count view (this API instance's counters). */
export interface MobileTelemetryRow {
  app: string; platform: string;
  events: Record<string, number>;
  errors: number;
  perf: Record<string, { count: number; p50Ms: number | null; p95Ms: number | null }>;
}
export interface MobileTelemetryView { scope: 'instance'; generatedAt: string; apps: MobileTelemetryRow[] }
