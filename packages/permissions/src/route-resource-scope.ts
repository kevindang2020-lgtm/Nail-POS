// route-resource-scope.ts — Security Deep Scan §38 (Nov 5 2026): every route carries the boundary of the records it
// touches, beside its realm, permission and step-up in the route manifest. PURE (no Nest) — the manifest generator and
// the route audit read it from dist.
//
//   PLATFORM     the platform's own records (Super Admin realm)
//   TENANT       one salon's salon-wide records (settings, catalog, roles) — every location sees the same thing
//   BRANCH       one salon's location-bound records — the caller's location access (user_branch_access) narrows them
//   OWN          only the caller's own records (customer app, technician app, /me, /auth, own devices)
//   ASSIGNED     records assigned to the caller (a ticket's technicians)
//   PUBLIC       no session — trust comes from a signed link / token / the record being public
//   INTEGRATION  an integration key (voice) — the key's own salon
//
// Where it comes from (most specific first), recorded in the manifest so a reviewer sees which:
//   declared     @ResourceScope(...) on the handler, else on its controller
//   realm/path   public · api key · super-admin realm · customer realm · /tech · /me · /auth
//   records      the record ids in the path, by the IDOR table's reviewed per-table classification (every table with a
//                branch_id is marked location-bound or salon-wide WITH a reason — the live sweep attacks exactly that)
//   permission   the route's permission(s) in the permission registry: BRANCH if any may be granted per location,
//                (one or selected locations), else TENANT (salon-wide only), else OWN / ASSIGNED / PLATFORM
// A session route none of these decides is UNSCOPED — the route audit refuses it (declare one).
// Enforcement stays where it is (decision.ts scopes, services' tenant / branch predicates, the live IDOR sweep); this is
// the declared contract those checks are reviewed against.
import { catalogKeyFor, definitionOf } from './permission-registry';

export const ROUTE_RESOURCE_SCOPES = ['PLATFORM', 'TENANT', 'BRANCH', 'OWN', 'ASSIGNED', 'PUBLIC', 'INTEGRATION'] as const;
export type RouteResourceScope = typeof ROUTE_RESOURCE_SCOPES[number];
export type RouteScopeSource = 'declared' | 'realm' | 'path' | 'records' | 'permission';
export const RESOURCE_SCOPE_META = 'resourceScope';
export const isRouteResourceScope = (v: unknown): v is RouteResourceScope => typeof v === 'string' && (ROUTE_RESOURCE_SCOPES as readonly string[]).includes(v);

export interface RouteScopeInput {
  path: string; auth: 'public' | 'session' | 'api_key'; realm: string; perms: readonly string[]; declared?: string | null;
  /** the reviewed classification of the record ids in the path (apps/api/scripts/idor-routes.mjs BRANCH_TABLES) */
  records?: 'branch' | 'salon-wide' | null;
}
export interface RouteScopeOutput { scope: RouteResourceScope | 'UNSCOPED' | 'INVALID'; source: RouteScopeSource | null }

const OWN_PATHS = /^\/(tech|me|auth)(\/|$)/;

export function routeResourceScope(r: RouteScopeInput): RouteScopeOutput {
  if (r.declared != null) return isRouteResourceScope(r.declared) ? { scope: r.declared, source: 'declared' } : { scope: 'INVALID', source: 'declared' };
  if (r.auth === 'public') return { scope: 'PUBLIC', source: 'realm' };
  if (r.auth === 'api_key') return { scope: 'INTEGRATION', source: 'realm' };
  if (r.realm === 'super_admin') return { scope: 'PLATFORM', source: 'realm' };
  if (r.realm === 'customer') return { scope: 'OWN', source: 'realm' };
  if (OWN_PATHS.test(r.path)) return { scope: 'OWN', source: 'path' };
  if (r.records === 'branch') return { scope: 'BRANCH', source: 'records' };
  if (r.records === 'salon-wide') return { scope: 'TENANT', source: 'records' };
  const scopes = new Set(r.perms.flatMap((k) => definitionOf(catalogKeyFor(k) ?? k)?.scopes ?? []));
  if (scopes.has('PLATFORM')) return { scope: 'PLATFORM', source: 'permission' };
  // granted per location (one branch, or selected branches) → the records are location-bound
  if (scopes.has('BRANCH') || scopes.has('SELECTED_BRANCHES')) return { scope: 'BRANCH', source: 'permission' };
  if (scopes.has('TENANT')) return { scope: 'TENANT', source: 'permission' };
  if (scopes.has('OWN')) return { scope: 'OWN', source: 'permission' };
  if (scopes.has('ASSIGNED')) return { scope: 'ASSIGNED', source: 'permission' };
  return { scope: 'UNSCOPED', source: null };
}
