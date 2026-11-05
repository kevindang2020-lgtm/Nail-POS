// telemetry.ts — Constitution 6 §116–119 (BUILD_PLAN Phase 13, E): the mobile apps' analytics + performance marks.
//
// Crash vendor decision (Phase 13 default): NONE. Errors go to the platform's own redacted POST /client-telemetry/errors
// (@aipowersalon/ui error-reporting, now labelled with app + version + platform + route); product events and perf marks
// go, batched, to POST /client-telemetry/events. Both are public intake routes on the API — no third party sees a byte.
//
// PRIVACY: track() runs every event through the shared allowlist (@aipowersalon/api-contracts client-telemetry) BEFORE it
// is queued — an unknown event, an unknown prop, or a value outside its closed set never leaves the device. The server
// applies the same sanitizer again. Analytics are not business truth (§117).
//
// DELIVERY: batched (50 per request or every 15 s, and on page hide), queue capped at 200 (oldest dropped), fire-and-
// forget with keepalive, never throws and never awaits — telemetry must not slow or break a screen.
import { buildApiUrl } from '@aipowersalon/api-client';
import {
  sanitizeAnalyticsEvent, sanitizePerfMark,
  type AnalyticsEvent, type AnalyticsEventName, type AnalyticsProps, type PerfMark, type PerfMetric, type TelemetryApp,
} from '@aipowersalon/api-contracts';
import { clientPlatform } from '../network/transport';

export interface TelemetryConfig {
  app: TelemetryApp;
  version: string;
  platform: 'ios' | 'android' | 'web';
  /** Read at send time (native bases are set at runtime). */
  apiBase: () => string;
  /** Injectable for tests; default is fetch with keepalive. */
  send?: (url: string, body: string) => void;
  /** 0 disables the timer (tests); default 15 000 ms. */
  autoFlushMs?: number;
  /** Events per request (default 50, the server's cap). */
  maxBatch?: number;
}

const MAX_QUEUE = 200;
let cfg: TelemetryConfig | null = null;
let events: AnalyticsEvent[] = [];
let perf: PerfMark[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let firstScreenDone = false;

function defaultSend(url: string, body: string): void {
  try {
    void fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true, credentials: 'omit' }).catch(() => undefined);
  } catch { /* never */ }
}

function trim(): void {
  if (events.length > MAX_QUEUE) events = events.slice(events.length - MAX_QUEUE);
  if (perf.length > MAX_QUEUE) perf = perf.slice(perf.length - MAX_QUEUE);
}

function maybeFlush(): void {
  if (!cfg) return;
  const max = Math.min(cfg.maxBatch ?? 50, 50);
  if (events.length >= max || perf.length >= max) flushTelemetry();
  trim();
}

/** Call once at app start. Re-configuring replaces the previous config (and its timer). */
export function configureTelemetry(c: TelemetryConfig): void {
  try {
    cfg = c;
    if (timer) { clearInterval(timer); timer = null; }
    const every = c.autoFlushMs ?? 15_000;
    if (every > 0) timer = setInterval(flushTelemetry, every);
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('pagehide', flushTelemetry);
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushTelemetry(); });
    }
  } catch { /* never block app start */ }
}

/** §116: a product event. Dropped silently unless it (and each prop) is on the allowlist. */
export function track<E extends AnalyticsEventName>(name: E, props?: AnalyticsProps): void {
  try {
    if (!cfg) return;
    const e = sanitizeAnalyticsEvent(name, props);
    if (!e) return;
    events.push(e);
    maybeFlush();
  } catch { /* never */ }
}

/** §119: a performance mark (ms), labels allow-listed per metric. */
export function recordPerf(metric: PerfMetric, ms: number, labels?: Record<string, string>): void {
  try {
    if (!cfg) return;
    const m = sanitizePerfMark({ metric, ms, labels });
    if (!m) return;
    perf.push(m);
    maybeFlush();
  } catch { /* never */ }
}

/** The transport's per-request timing (A's `onTiming` hook): latency by TIMEOUT CLASS and outcome — never a URL. */
export function recordApiLatency(t: { timeoutClass: string; ms: number; outcome: string }): void {
  recordPerf('api_latency', t.ms, { timeoutClass: String(t.timeoutClass).toLowerCase(), outcome: t.outcome });
}

/** Launch → first meaningful screen, once per launch. `ms` defaults to the time since the page's time origin. */
export function markFirstScreen(screen: string, ms?: number): void {
  if (firstScreenDone) return;
  firstScreenDone = true;
  let v = ms;
  if (v === undefined) { try { v = typeof performance !== 'undefined' ? performance.now() : undefined; } catch { v = undefined; } }
  if (v !== undefined) recordPerf('launch_to_first_screen', v, { screen });
}

/** Sends what is queued, now. Fire-and-forget. */
export function flushTelemetry(): void {
  try {
    if (!cfg || (events.length === 0 && perf.length === 0)) return;
    const max = Math.min(cfg.maxBatch ?? 50, 50);
    const e = events.splice(0, max);
    const p = perf.splice(0, max);
    const body = JSON.stringify({ app: cfg.app, version: cfg.version, platform: cfg.platform, events: e, perf: p });
    const url = buildApiUrl(cfg.apiBase(), '/client-telemetry/events');
    try { (cfg.send ?? defaultSend)(url, body); } catch { /* a failed send drops the batch: telemetry is best-effort */ }
  } catch { /* never */ }
}

export function pendingTelemetry(): number { return events.length + perf.length; }

export function resetTelemetryForTests(): void {
  if (timer) clearInterval(timer);
  timer = null; cfg = null; events = []; perf = []; firstScreenDone = false;
}

/** A screen became visible: `screen_viewed` + (the first time) launch → first screen. Routers call this on navigation. */
export function trackScreen(screen: string): void {
  track('screen_viewed', { screen });
  markFirstScreen(screen);
}

/**
 * One call in each app's main.tsx: configure (app, the build's VITE_APP_VERSION, ios / android / web from the shell) and
 * record `app_opened`. The transport reports API latency through `onTiming: recordApiLatency` (each app's client.ts).
 */
export function initMobileTelemetry(o: { app: TelemetryApp; apiBase: () => string; version?: string | null }): void {
  try {
    configureTelemetry({ app: o.app, version: o.version || 'unknown', platform: clientPlatform(), apiBase: o.apiBase });
    track('app_opened', { coldStart: true });
  } catch { /* never block app start */ }
}
