// allowed-origins.ts — ONE browser-origin allow-list, shared by CORS (main.ts) and the realtime gateway.
//
// Constitution 9 §196: CORS alone does not protect a credentialed SSE stream — the browser sends the request
// with cookies, the server opens the stream and starts writing, and only THEN does the browser decide whether
// the page may read it. "Do not accept arbitrary credentialed origin" means the SERVER must refuse before
// opening. Computing the list here, once, keeps the gateway's answer identical to CORS's answer.
//
// Absent Origin is allowed: native shells and non-browser clients (curl, server-side EventSource) send none,
// exactly as the existing CORS policy already treats them.
import { nativeOrigins } from '@aipowersalon/identity';

export function computeAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  // Oct 23 2026 merge of the developer tree: its hosting serves the web apps from app.aipowersalon.com (one port per app);
  // those exact origins join the default list. Its wildcard "any *.aipowersalon.com" was NOT taken — production origins
  // stay an explicit list (a subdomain takeover must not become a CORS-trusted origin).
  // Security Deep Scan C5/D3: the WordPress marketing site (aipowersalon.com / www) is NOT a credentialed origin any more —
  // it is the same site as api.aipowersalon.com, so its script could ride every staff session. It gets an uncredentialed
  // policy for the public intake routes only (marketingOrigins / isMarketingPath below).
  const DEFAULT_ORIGINS = ['https://app.aipowersalon.com',
    ...[8081, 8082, 8083, 8084, 8085, 8086, 8087, 3000].map((p) => `https://app.aipowersalon.com:${p}`)].join(',');
  const marketing = new Set(marketingOrigins(env));
  // even when WEB_CORS_ORIGINS still lists the marketing site, it never becomes a credentialed origin
  const corsOrigins = (env.WEB_CORS_ORIGINS || DEFAULT_ORIGINS)
    .split(',').map((s) => s.trim()).filter((o) => o && !marketing.has(o));
  const isDev = env.NODE_ENV === 'development';
  const devOrigins = isDev
    ? [5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180, 5181].flatMap((p) => [`http://localhost:${p}`, `http://127.0.0.1:${p}`])
    : [];
  return [...corsOrigins, ...devOrigins, ...nativeOrigins()];
}

/** The marketing site(s): MARKETING_ORIGINS, default the WordPress apex + www. Uncredentialed CORS on MARKETING_PATHS only. */
export function marketingOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.MARKETING_ORIGINS || 'https://aipowersalon.com,https://www.aipowersalon.com').split(',').map((s) => s.trim()).filter(Boolean);
}
/** The only routes the marketing site calls (the free-package application form, website leads, public pricing). */
export function isMarketingPath(path: string): boolean { return /^\/(api\/v1\/)?public\/website(\/|$)/.test(String(path || '').split('?')[0]); }

/** CORS per request: the app origins get credentialed CORS; the marketing site gets UNcredentialed CORS on its public
 *  intake routes and nothing elsewhere. */
export function corsDecision(origin: string | undefined, path: string, allowed: string[], marketing: string[] = marketingOrigins()): { origin: boolean; credentials: boolean } {
  if (origin && marketing.includes(origin)) return { origin: isMarketingPath(path), credentials: false };
  return { origin: isOriginAllowed(origin, allowed), credentials: true };
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** Security Deep Scan D3 (§90): cross-site request forgery guard for cookie-authenticated writes. A browser always sends
 *  Origin on a cross-origin unsafe request; when the request carries a session cookie, that Origin must be an allowed
 *  app origin (or absent with Sec-Fetch-Site same-origin/same-site/none — native shells and server callers send no
 *  Origin and no cookie-borne session from another site). Bearer / API-key callers are not cookie-borne and pass. */
export function csrfVerdict(req: { method: string; headers: Record<string, string | string[] | undefined> }, allowed: string[]): { ok: true } | { ok: false; reason: string } {
  if (!UNSAFE.has(String(req.method).toUpperCase())) return { ok: true };
  const cookie = String(req.headers.cookie ?? '');
  if (!/(^|;\s*)aps_[a-z_]*=/i.test(cookie)) return { ok: true };            // no cookie session → nothing to forge
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  if (origin && origin !== 'null') return isOriginAllowed(origin, allowed) ? { ok: true } : { ok: false, reason: 'origin_not_allowed' };
  const site = String(req.headers['sec-fetch-site'] ?? '');
  if (site === 'cross-site' || origin === 'null') return { ok: false, reason: 'cross_site_request' };
  return { ok: true };
}

/** True when the request may be served with credentials from this origin. Missing Origin ⇒ allowed (see above). */
export function isOriginAllowed(origin: string | undefined | null, list?: string[]): boolean {
  if (!origin) return true;                                   // same-origin / non-browser callers carry no Origin
  const allowed = list ?? computeAllowedOrigins();
  if (allowed.includes(origin)) return true;
  // Development only (the developer's Sep 2026 LAN testing, without hard-coded addresses): any port on localhost or a
  // private-network host (RFC 1918) — so a phone or iPad on the same Wi-Fi can reach the Vite dev servers. Production
  // origins stay the explicit WEB_CORS_ORIGINS list; a wildcard subdomain is deliberately NOT accepted here.
  if (process.env.NODE_ENV === 'development') {
    try {
      const u = new URL(origin);
      if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname))) return true;
    } catch { /* not a URL */ }
  }
  return false;
}

