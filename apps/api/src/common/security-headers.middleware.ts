// security-headers.middleware.ts — Constitution 12 §68, §251–252 (audit finding H2): the API's response headers.
//
// SCOPE, corrected from the Phase 1 audit: the API does NOT serve the web apps' dist/ — each app is its own static
// site (DEPLOY_RAILWAY.md). So these headers protect the API's own responses; the apps' page headers (their CSP,
// frame-ancestors) are generated separately (scripts/generate-app-headers.mjs) and set where the static files are
// served. The two are kept consistent by tests, not by hope.
//
// What each header buys on an API:
//   Strict-Transport-Security   browsers refuse plain-HTTP for the API host after the first visit (production only —
//                               setting it on localhost:3000 would poison a developer's browser for the whole host).
//   X-Content-Type-Options      a JSON response is never sniffed into HTML/JS.
//   Content-Security-Policy     an API response has no page; default-src 'none' + frame-ancestors 'none' means that if
//                               one were ever rendered (an error page, a redirect), it could load nothing and be framed
//                               by nothing. Public HTML surfaces (booking pages, kiosk) opt into their own policy.
//   Referrer-Policy             an API URL (which may carry a token or a tenant slug) is not leaked to third parties.
//   Cache-Control: no-store     on authenticated responses — a shared or proxied cache must never serve one salon's
//                               data to another. Public read-only routes may set their own caching.
//   Permissions-Policy          the API grants no device capabilities.
//   X-Frame-Options             the legacy spelling of frame-ancestors, for old browsers.
// No X-XSS-Protection: retired by browsers, and its "1; mode=block" caused vulnerabilities of its own.
import { Injectable, NestMiddleware } from '@nestjs/common';

export interface HeaderOptions { production: boolean; hstsMaxAgeSeconds?: number }

/**
 * Smooth Refresh spec §90 — authenticated reads that may be REVALIDATED instead of refetched in full: rarely-changing,
 * low-sensitivity GETs. They get `private, no-cache` instead of `no-store`:
 *   • private  → only the user's own browser may keep a copy; no proxy or shared cache ever can (the no-store rule's
 *                purpose — never serve one salon's data to another — is kept);
 *   • no-cache → that copy must be revalidated with the server on EVERY use, so the server re-checks the session and
 *                recomputes the response for THIS user; Express's ETag then answers 304 only when this user's response
 *                is byte-identical to the copy the browser already holds — nothing can cross between users on a shared
 *                POS device.
 * Deliberately short: no payments, security, roles, integrations, audit logs, customers or anything per-person.
 */
export const REVALIDATABLE_GETS: readonly RegExp[] = [
  /^\/pos\/services\/?$/,                          // the services catalog
  /^\/pos\/services\/categories\/?$/,
  /^\/pos\/settings\/booking-appointments\/?$/,   // booking settings (slot interval, buffer, double-booking policy)
  /^\/pos\/settings\/business-branch\/?$/,        // salon + branch names, currency, timezone
];
export function isRevalidatableGet(req: { method?: string; path?: string; url?: string }): boolean {
  if (String(req.method ?? 'GET').toUpperCase() !== 'GET') return false;
  const path = String(req.path ?? req.url ?? '').split('?')[0];
  return REVALIDATABLE_GETS.some((re) => re.test(path));
}

export function securityHeadersFor(opts: HeaderOptions, req: { path?: string; url?: string; ctx?: unknown; method?: string }): Record<string, string> {
  const h: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    'Cross-Origin-Resource-Policy': 'same-site',
  };
  if (opts.production) h['Strict-Transport-Security'] = `max-age=${opts.hstsMaxAgeSeconds ?? 63072000}; includeSubDomains`;
  if (req.ctx) h['Cache-Control'] = isRevalidatableGet(req) ? 'private, no-cache' : 'no-store';   // authenticated: never cacheable by anything in between; a few stable reads revalidate (§90)
  return h;
}

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  private readonly opts: HeaderOptions = { production: process.env.NODE_ENV === 'production' };
  use(req: any, res: any, next: () => void): void {
    // Set at response time, so `req.ctx` (attached by TenantContextMiddleware, which runs later) is known.
    const apply = () => { for (const [k, v] of Object.entries(securityHeadersFor(this.opts, req))) if (!res.getHeader(k)) res.setHeader(k, v); };
    const origWriteHead = res.writeHead;
    res.writeHead = function (...args: any[]) { apply(); return origWriteHead.apply(this, args); };
    next();
  }
}
