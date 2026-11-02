// api-version.ts — BUILD_PLAN Phase 12 (Constitution 5 §11–13, DoD #57): every frontend calls the API at /api/v1/<path>.
//
// The server serves every route at both spellings (apps/api/src/common/api-version.ts — /api/v1/<path> is rewritten to
// <path> before Nest sees it) and stamps `Deprecation` / `Sunset` / `Link` on the legacy spelling, with a counter, so the
// day the counter reads zero the legacy spelling can go. Apps already installed in the field keep calling legacy paths
// and keep working; every build from here on calls /api/v1.
//
// Paths that stay where they are — keep this list in step with NEVER_DEPRECATED in apps/api/src/common/api-version.ts:
//   /auth/refresh   the refresh cookie is `Path=/auth/refresh`; a browser sends it to that path and nowhere else
//   /health /readyz /livez /metrics  probes;  /webhooks /integrations/inbound /oauth  URLs registered with third parties
//   /media          picture URLs stored in rows and printed into ads;  /api/…  already-versioned APIs (voice, booking)
//   /platform       /api/v1/platform/* is the Super Admin alias (platform-alias.ts) — /platform/branding stays put
//   /.well-known    protocol files
export const API_V1_PREFIX = '/api/v1';

const UNVERSIONED = /^\/(health|readyz|livez|metrics|webhooks?|media|oauth|integrations\/inbound|\.well-known|api|platform|auth\/refresh)(\/|$|\?)/;

/** An absolute URL (https:, blob:, data:) is not an API path — a presigned upload, a CDN picture. */
const isAbsolute = (p: string) => /^[a-z][a-z0-9+.-]*:/i.test(p) || p.startsWith('//');

export function isUnversionedPath(path: string): boolean {
  const p = path.startsWith('/') ? path : '/' + path;
  return UNVERSIONED.test(p);
}

/** The canonical spelling of an API path: /pos/x → /api/v1/pos/x. Idempotent; absolute URLs and the paths above untouched. */
export function apiV1Path(path: string): string {
  if (isAbsolute(path)) return path;
  const p = path.startsWith('/') ? path : '/' + path;
  if (UNVERSIONED.test(p)) return p;
  return API_V1_PREFIX + p;
}

/** buildUrl for an API call: base (same-origin "" or the API origin, with or without /api/v1) + the /api/v1 path + query. */
export function buildApiUrl(base: string, path: string, query?: Record<string, unknown>): string {
  const b = String(base || '').replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  if (isAbsolute(path)) return appendQuery(path, query);
  return appendQuery(b + apiV1Path(path), query);
}

function appendQuery(url: string, query?: Record<string, unknown>): string {
  if (!query) return url;
  const parts: string[] = [];
  for (const k of Object.keys(query)) {
    const v = query[k];
    if (v === undefined || v === null || v === '') continue;
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
  }
  return parts.length ? url + (url.includes('?') ? '&' : '?') + parts.join('&') : url;
}
