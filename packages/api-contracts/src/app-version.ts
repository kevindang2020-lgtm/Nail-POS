// app-version.ts — Constitution 6 §52–57, §150, §219–220 (BUILD_PLAN Phase 13, B): the app-version and remote-config
// wire contract and the ONE copy of the version rules, shared by the API (UPDATE_REQUIRED gate, GET /app-config, the Super
// Admin version screen) and every mobile app's AppConfigGate (@aipowersalon/mobile-sdk config/).
//
// The hard rules (Kevin, Phase 13): UPDATE_REQUIRED never locks out the web apps, the customer display, the kiosk or any
// request that carries no client headers — ONLY a native (ios / android) build of a known mobile app, carrying its id and
// version, below a CONFIGURED minimum is refused. No row configured → nothing refused. Sign-in, refresh, health,
// /app-config and webhooks are always exempt. The headers are sent by the one mobile transport
// (@aipowersalon/mobile-sdk network/); they are informational, NOT a credential (a client can lie about its version — the
// worst it achieves is skipping its own upgrade prompt).

/** The request headers the mobile transport sends (agreed with Phase 13 A). */
export const CLIENT_HEADER = { type: 'X-Client-Type', version: 'X-Client-Version', platform: 'X-Client-Platform' } as const;
/** X-Client-Type values: the four store apps (the same ids as client telemetry's `app`). */
export const MOBILE_APP_IDS = ['customer', 'tech', 'owner', 'manager-pay'] as const;
export type MobileAppId = (typeof MOBILE_APP_IDS)[number];
/** X-Client-Platform values. Only the native two can ever be refused. */
export const CLIENT_PLATFORMS = ['ios', 'android', 'web'] as const;
export type ClientPlatform = (typeof CLIENT_PLATFORMS)[number];
export const NATIVE_PLATFORMS = ['ios', 'android'] as const;
export type NativePlatform = (typeof NATIVE_PLATFORMS)[number];

/** §55 */
export type AppVersionState = 'SUPPORTED' | 'UPDATE_RECOMMENDED' | 'UPDATE_REQUIRED';
export const UPDATE_REQUIRED_STATUS = 426;

const VERSION_RE = /^\d{1,5}(\.\d{1,5}){0,2}(\+[0-9A-Za-z.-]{1,32})?$/;
export function isAppVersion(v: unknown): v is string { return typeof v === 'string' && VERSION_RE.test(v); }

/** -1 / 0 / 1. Numeric per segment; a missing segment is 0; build metadata (+512) is ignored. */
export function compareAppVersions(a: string, b: string): number {
  const seg = (v: string) => v.split('+')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const pa = seg(a), pb = seg(b);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export interface VersionThresholds { minSupported: string | null; recommended: string | null; latest: string | null }

/** §55: below minSupported → UPDATE_REQUIRED; below recommended → UPDATE_RECOMMENDED; otherwise (or no policy, or an
 *  unparseable version) SUPPORTED. Fails open: a missing or malformed value is never a refusal. */
export function appVersionState(version: string | null | undefined, p: VersionThresholds | null | undefined): AppVersionState {
  if (!p || !isAppVersion(version)) return 'SUPPORTED';
  if (isAppVersion(p.minSupported) && compareAppVersions(version, p.minSupported) < 0) return 'UPDATE_REQUIRED';
  if (isAppVersion(p.recommended) && compareAppVersions(version, p.recommended) < 0) return 'UPDATE_RECOMMENDED';
  return 'SUPPORTED';
}

export interface ClientHeaders { app: MobileAppId | null; version: string | null; platform: ClientPlatform | null }
const header = (h: Record<string, unknown> | undefined, name: string): string | null => {
  if (!h) return null;
  const v = h[name.toLowerCase()] ?? h[name];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' ? s.trim() : null;
};
/** The three client headers, each kept only when it is a known value (anything else → null). */
export function parseClientHeaders(h: Record<string, unknown> | undefined): ClientHeaders {
  const app = header(h, CLIENT_HEADER.type);
  const version = header(h, CLIENT_HEADER.version);
  const platform = header(h, CLIENT_HEADER.platform)?.toLowerCase() ?? null;
  return {
    app: (MOBILE_APP_IDS as readonly string[]).includes(app ?? '') ? (app as MobileAppId) : null,
    version: isAppVersion(version) ? version : null,
    platform: (CLIENT_PLATFORMS as readonly string[]).includes(platform ?? '') ? (platform as ClientPlatform) : null,
  };
}

/** Paths the gate never refuses (after the /api/v1 prefix is removed): every way in and out of a session, health, the
 *  config endpoint the app needs to SHOW the update screen, provider callbacks, metrics and crash reports. */
const EXEMPT = /^\/(auth|customer\/auth|oauth|health|readyz|livez|app-config|webhooks?|metrics|client-telemetry|\.well-known)(\/|$)/;
export function isUpdateGateExempt(path: string, method: string): boolean {
  if (String(method || '').toUpperCase() === 'OPTIONS') return true;
  const p = String(path || '/').split('?')[0].replace(/^\/api\/v1(?=\/|$)/, '') || '/';
  return EXEMPT.test(p);
}

/** One configured row (mobile_app_versions). */
export interface AppVersionPolicy extends VersionThresholds { app: MobileAppId; platform: NativePlatform; storeUrl: string | null; message: string | null }

export interface UpdateRequiredBody {
  statusCode: 426; code: 'UPDATE_REQUIRED'; error: 'Upgrade Required'; message: string;
  storeUrl: string | null; minimumVersion: string; app: MobileAppId; platform: NativePlatform; currentVersion: string;
}
export const DEFAULT_UPDATE_MESSAGE = 'A newer version of this app is required. Please update to continue.';

/** The gate's decision: the 426 body, or null (proceed). `lookup` returns the configured row or null. */
export function updateRequiredFor(
  req: { headers?: Record<string, unknown>; path?: string; url?: string; method?: string },
  lookup: (app: MobileAppId, platform: NativePlatform) => AppVersionPolicy | null | undefined,
): UpdateRequiredBody | null {
  const path = String(req.path ?? req.url ?? '/');
  if (isUpdateGateExempt(path, String(req.method ?? 'GET'))) return null;
  const c = parseClientHeaders(req.headers);
  if (!c.app || !c.version || (c.platform !== 'ios' && c.platform !== 'android')) return null;
  const p = lookup(c.app, c.platform);
  if (!p || appVersionState(c.version, p) !== 'UPDATE_REQUIRED') return null;
  return { statusCode: 426, code: 'UPDATE_REQUIRED', error: 'Upgrade Required', message: p.message || DEFAULT_UPDATE_MESSAGE,
    storeUrl: p.storeUrl, minimumVersion: String(p.minSupported), app: c.app, platform: c.platform, currentVersion: c.version };
}

export class VersionPolicyError extends Error { constructor(m: string) { super(m); this.name = 'VersionPolicyError'; } }
/** Validates a Super Admin edit. Throws VersionPolicyError with a message a person can act on. */
export function normaliseVersionPolicy(input: Record<string, unknown>): AppVersionPolicy {
  const app = String(input.app ?? '');
  if (!(MOBILE_APP_IDS as readonly string[]).includes(app)) throw new VersionPolicyError(`app must be one of ${MOBILE_APP_IDS.join(', ')}.`);
  const platform = String(input.platform ?? '');
  if (!(NATIVE_PLATFORMS as readonly string[]).includes(platform)) throw new VersionPolicyError('platform must be ios or android (web builds are never version-gated).');
  const ver = (k: 'minSupported' | 'recommended' | 'latest'): string | null => {
    const v = input[k];
    if (v == null || v === '') return null;
    if (!isAppVersion(String(v).trim())) throw new VersionPolicyError(`${k} must look like 1.4.0.`);
    return String(v).trim();
  };
  const minSupported = ver('minSupported'), recommended = ver('recommended'), latest = ver('latest');
  if (minSupported && recommended && compareAppVersions(minSupported, recommended) > 0) throw new VersionPolicyError('recommended must be at least minSupported.');
  if (recommended && latest && compareAppVersions(recommended, latest) > 0) throw new VersionPolicyError('latest must be at least recommended.');
  if (minSupported && latest && compareAppVersions(minSupported, latest) > 0) throw new VersionPolicyError('latest must be at least minSupported.');
  const rawUrl = input.storeUrl == null ? '' : String(input.storeUrl).trim();
  if (rawUrl && (!/^https:\/\/[^\s"'<>]{4,500}$/.test(rawUrl))) throw new VersionPolicyError('storeUrl must be an https:// store link.');
  const storeUrl = rawUrl || null;
  if (minSupported && !storeUrl) throw new VersionPolicyError('storeUrl is required when a minimum is set — the update screen must send people somewhere.');
  const msg = input.message == null ? '' : String(input.message).trim();
  if (msg.length > 300) throw new VersionPolicyError('message is at most 300 characters.');
  return { app: app as MobileAppId, platform: platform as NativePlatform, minSupported, recommended, latest, storeUrl, message: msg || null };
}

// ── GET /app-config (public) ────────────────────────────────────────────────────────────────────────────────────────
/** §52 / §219: a flag the app reads with useRemoteFlag(key). Values only — never scripting (§219). */
export type RemoteFlags = Record<string, boolean>;
/** §54 / §220: a module that is unavailable right now (kill switch) — the rest of the app keeps working. */
export interface ModuleNotice { module: 'ai' | 'payments' | 'deals' | 'booking_verification' | 'sms'; available: false; message: string }
export interface AppConfigResponse {
  app: MobileAppId; platform: ClientPlatform; version: string | null;
  update: { state: AppVersionState; minimumVersion: string | null; recommendedVersion: string | null; latestVersion: string | null; storeUrl: string | null; message: string | null };
  flags: RemoteFlags;
  modules: ModuleNotice[];
  /** Platform maintenance (Super Admin) — a banner, or a read-only / full notice. */
  maintenance: { active: boolean; mode: 'read_only' | 'full' | null; message: string | null; banner: string | null };
  /** MAINTENANCE_BREAK_GLASS on the host (no database). */
  breakGlass: { mode: 'off' | 'read_only' | 'full'; message: string | null };
  /** Seconds the app may cache this before asking again. */
  refreshAfterSeconds: number;
  serverTime: string;
}

// ── Super Admin ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** PUT /super-admin/mobile-versions/:app/:platform body. */
export interface MobileVersionPolicyInput { minSupported?: string | null; recommended?: string | null; latest?: string | null; storeUrl?: string | null; message?: string | null; reason?: string | null; expectedVersion?: number | null }
export interface MobileVersionRow extends AppVersionPolicy { version: number; updatedAt: string | null; updatedBy: string | null }
export interface VersionDistributionRow { app: MobileAppId; platform: ClientPlatform; version: string; installs: number; state: AppVersionState }
export interface MobileVersionsOverview {
  rows: MobileVersionRow[];
  /** Installs (distinct device ids) seen in the last `windowDays` days, by app / platform / version. */
  distribution: VersionDistributionRow[];
  windowDays: number;
  totals: { installs: number; unsupported: number; recommendedUpdate: number };
}
