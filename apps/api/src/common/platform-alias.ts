// platform-alias.ts — Constitution 7 §5 / §111: the Platform API is reachable under /api/v1/platform/*.
//
// Decision D1 (CONTROL_PLANE_AUDIT.md): ~1,006 platform routes, seven frontends, the realm guard, the route-inventory
// gates and every test key on /super-admin/*, so /api/v1/platform/* is an ALIAS, not a move — both spellings reach the
// same controller, guards and audit. A bare /platform/* alias is NOT offered: GET /platform/branding already exists
// (the public platform brand), and an alias must never shadow a live route.
//
// The rewrite runs on our own Express instance BEFORE Nest registers any middleware, and rewrites originalUrl too:
// Nest matches module middleware (and its .exclude() list) against originalUrl while routing uses url, so rewriting
// only one of them leaves the session middleware and the router disagreeing about the path.
export const PLATFORM_ALIAS_PREFIX = '/api/v1/platform';

export function rewritePlatformAlias(url: string): string | null {
  if (url !== PLATFORM_ALIAS_PREFIX && !url.startsWith(PLATFORM_ALIAS_PREFIX + '/') && !url.startsWith(PLATFORM_ALIAS_PREFIX + '?')) return null;
  return '/super-admin' + url.slice(PLATFORM_ALIAS_PREFIX.length);
}

export function platformAliasMiddleware(req: any, _res: any, next: () => void): void {
  const to = rewritePlatformAlias(String(req.url ?? ''));
  if (to !== null) { req.url = to; req.originalUrl = to; req.platformAlias = true; }
  next();
}
