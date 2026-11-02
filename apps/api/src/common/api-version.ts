// api-version.ts — Constitution 5 §11–13 (re-applied Oct 4 2026): every route is also reachable under /api/v1/*.
//
// An ALIAS, not a move (◆ Sep 12 ruling, as Constitution 7 did for /api/v1/platform): seven apps, the realm guard, the
// route gates and every test key on today's paths, so /api/v1/<path> reaches the SAME controller, guards and audit as
// /<path>. Nothing lives under /api/v1 today (the voice APIs are /api/ai-booking/v1 and /api/ai-receptionist/v1), so
// the alias shadows no live route. /api/v1/platform/* keeps its own mapping to /super-admin/* (platform-alias.ts).
// Mounted on our own Express instance before Nest registers middleware, rewriting url AND originalUrl (Nest matches
// middleware and its .exclude() list on originalUrl, routing on url — the Sep trap).
//
// Legacy (un-versioned) responses carry `Deprecation: true`, a `Link: </api/v1/…>; rel="successor-version"` header and
// `Sunset` (BUILD_PLAN Phase 12, Oct 8 2026: every app build now calls /api/v1 — @aipowersalon/api-client apiV1Path — so
// the legacy spelling gets a date, 90 days out by default; API_LEGACY_SUNSET=<date> moves it, API_LEGACY_SUNSET=off drops
// the header). The legacy paths keep WORKING after that date — Sunset is the announcement; removing them is a separate
// decision taken when `aipowersalon_api_legacy_path_requests_total` (below, on /metrics) has read zero long enough for
// the mobile apps and kiosks in the field. Never on: health probes, metrics, provider webhooks and inbound integrations
// (that URL lives in a third party's dashboard), media, OAuth protocol endpoints (registered in partner configs), the
// already-versioned /api/* voice APIs, /auth/refresh (the refresh cookie is Path=/auth/refresh — a browser sends it
// nowhere else, so it is canonical there) and /platform/branding (/api/v1/platform/* is the Super Admin alias).
// Keep NEVER_DEPRECATED in step with packages/api-client/src/api-version.ts (check:v1-clients compares them).
import { registry } from '@aipowersalon/observability';

export const API_V1_PREFIX = '/api/v1';
export const DEFAULT_LEGACY_SUNSET = '2027-01-06';
export function rewriteApiV1(url: string): string | null {
  if (!url.startsWith(API_V1_PREFIX + '/') && !url.startsWith(API_V1_PREFIX + '?') && url !== API_V1_PREFIX) return null;
  if (url.startsWith(API_V1_PREFIX + '/platform')) return null;   // platform-alias.ts owns that mapping
  const rest = url.slice(API_V1_PREFIX.length);
  return rest === '' || rest.startsWith('?') ? '/' + rest : rest;
}
const NEVER_DEPRECATED = /^\/(health|readyz|livez|metrics|webhooks?|media|oauth|integrations\/inbound|\.well-known|api|platform|auth\/refresh)(\/|$|\?)/;
export function legacyDeprecationHeaders(url: string, env: NodeJS.ProcessEnv = process.env): Record<string, string> | null {
  const path = String(url || '/');
  if (NEVER_DEPRECATED.test(path)) return null;
  const h: Record<string, string> = { Deprecation: 'true', Link: `<${API_V1_PREFIX}${path.split('?')[0]}>; rel="successor-version"` };
  const raw = String(env.API_LEGACY_SUNSET ?? '').trim();
  if (raw.toLowerCase() === 'off') return h;
  const sunset = raw && !Number.isNaN(Date.parse(raw)) ? raw : DEFAULT_LEGACY_SUNSET;
  h.Sunset = new Date(sunset).toUTCString();
  return h;
}

/** Legacy-path hits by first path segment — the number that says when the old spelling is unused (Kevin's signal). */
export const legacyPathHits = registry.counter('aipowersalon_api_legacy_path_requests_total',
  'Requests on a legacy (non-/api/v1) API path, by first path segment', ['prefix']);
const KNOWN_PREFIXES = new Set(['pos', 'owner', 'tech', 'tenant', 'customer', 'super-admin', 'auth', 'community', 'mobile-checkout',
  'customer-display', 'go-check-in', 'realtime', 'ai', 'public', 'me', 'technician', 'promotions', 'voice', 'voice-transcription',
  'push', 'jobs', 'internal', 'client-telemetry']);
/** The label for a path — a known API segment, else 'other' (never the raw path: bounded cardinality). */
export function legacyPrefixOf(url: string): string {
  const seg = String(url || '/').split('?')[0].split('/')[1] ?? '';
  return KNOWN_PREFIXES.has(seg) ? seg : 'other';
}
export function apiVersionMiddleware(req: any, res: any, next: () => void): void {
  const url = String(req.url ?? '');
  const to = rewriteApiV1(url);
  if (to !== null) { req.url = to; req.originalUrl = to; req.apiVersion = 'v1'; return next(); }
  if (!req.platformAlias) {
    const h = legacyDeprecationHeaders(url);
    if (h) { for (const [k, v] of Object.entries(h)) res.setHeader(k, v); legacyPathHits.inc({ prefix: legacyPrefixOf(url) }); }
  }
  next();
}
