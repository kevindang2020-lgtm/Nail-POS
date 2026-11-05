// check-api-contract.mjs — Constitution 5 Phase 3/19: the realm × permission contract, over the route manifest facts.
//
// For every route that needs a session:
//   1. REACHABLE   its effective permission — the declared @RequirePermission key, or for a /super-admin route without
//                  one the key PlatformDomainGuard derives from the path — is held by at least one role whose session the
//                  path accepts (realmForPath) AND that RealmGuard lets in. Otherwise the route is built, wired and tested, and nobody can open it.
//   2. CLASSIFIED  no /super-admin path is missing from PLATFORM_PATH_DOMAIN. An unclassified path is denied to every
//                  platform identity by design (Constitution 7 §7) — which is how GET /super-admin/stream, the admin
//                  app's live stream, answered 403 to every Super Admin until Oct 4 2026.
//   4. EFFECTIVE   no @RequirePermission sits on a controller CLASS — the guards read 'perm' from the handler only, so it
//                  would look like protection and enforce nothing.
//   3. KEYED       a staff route (/pos, /owner, /tenant, /tech) declares a permission, or is in the frozen baseline of
//                  routes that authorise inside their service (api-contract.unkeyed.baseline.txt). The baseline only
//                  shrinks: a new unkeyed staff route fails, and an entry whose route gained a key or disappeared fails
//                  until it is removed (so the debt record stays true).
// Roles and grants are read from @aipowersalon/permissions (ROLE_PERMISSIONS, platform role grants, hasPermission,
// canAccessRoutePrefix) — the functions the guards run — never restated here.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const BASELINE = join(HERE, '../openapi/api-contract.unkeyed.baseline.txt');
const require = createRequire(import.meta.url);
const P = join(REPO, 'packages/permissions/dist/');
const { hasPermission, canAccessRoutePrefix } = require(P + 'security-core.js');
const { ROLE_PERMISSIONS, platformPermissionsFor } = require(P + 'rbac.js');
const { PLATFORM_ROLES } = require(P + 'platform-roles.js');
// BUILD_PLAN Phase 12 (#13): 5. GATED — every route of a plan-gated feature (PLAN_FEATURE_ROUTES) carries
// @RequireFeature(<that key>), so a new route in a plan-gated module cannot ship ungated (manifest shows feature=<key>).
const { planFeatureForPath } = require(P + 'feature-entitlement.js');
// The session layer runs BEFORE the guards: a token is accepted only on paths of its own realm (realmForPath), so a
// Super Admin token is "No session" on /pos even though RealmGuard alone would let SUPER_ADMIN through.
const { realmForPath } = require(join(REPO, 'modules/identity/dist/auth/session-from-request.js'));
const SESSION_REALM = (role) => (role === 'SUPER_ADMIN' ? 'platform' : role === 'CUSTOMER' ? 'customer' : 'tenant');
const sessionAccepted = (role, path) => { const r = realmForPath(path); return r === 'any' || r === SESSION_REALM(role); };
const gen = await import('./openapi.mjs');
// BUILD_PLAN Phase 12: 6. DOMAIN — every route has a business domain (#2); 7. TYPED — every route carries an
// api-contracts wire type or is in the frozen route-types baseline (only shrinks) (#30 / #52)
const { routeTypes, TYPES_BASELINE } = await import('./route-contract-types.mjs');
const { routes } = require('./audit-routes.js');

const TENANT_ROLES = Object.keys(ROLE_PERMISSIONS).filter((r) => r !== 'SUPER_ADMIN');
export const PRINCIPALS = [
  ...TENANT_ROLES.map((role) => ({ role, label: role, permissions: ROLE_PERMISSIONS[role] })),
  ...PLATFORM_ROLES.map((pr) => ({ role: 'SUPER_ADMIN', label: pr, permissions: platformPermissionsFor(pr) })),
];
const STAFF = /^\/(pos|owner|tenant|tech)(\/|$)/;

/** Who can call a route with an effective key: principals allowed into its realm that hold the key. */
export const holders = (path, key, principals = PRINCIPALS) => principals
  .filter((p) => sessionAccepted(p.role, path) && canAccessRoutePrefix(p.role, path) && hasPermission(p, key)).map((p) => p.label);

export function evaluate(rs = routes, principals = PRINCIPALS) {
  const unreachable = [], unclassified = [], unkeyedStaff = [], ineffective = [], ungated = [];
  for (const r of rs) {
    const want = planFeatureForPath(r.path);
    if (want && gen.factsOf(r).feature !== want) ungated.push(`${r.method} ${gen.openapiPath(r.path)}  needs @RequireFeature('${want}')  (${r.controller})`);
    // the guards read 'perm' from the HANDLER: a class-level @RequirePermission protects nothing
    if (r.classDecorators.some((d) => d.name === 'RequirePermission')) ineffective.push(`${r.method} ${gen.openapiPath(r.path)}  (${r.controller})`);
    const f = gen.factsOf(r);
    if (f.auth !== 'session') continue;
    if (f.derived === 'UNCLASSIFIED') { unclassified.push(f.key); continue; }
    const keys = f.perms.length ? f.perms : f.derived ? [f.derived] : [];
    if (!keys.length) { if (STAFF.test(r.path)) unkeyedStaff.push(f.key); continue; }
    for (const k of keys) if (!holders(r.path, k, principals).length) unreachable.push(`${f.key}  ${f.perms.length ? 'perm' : 'derived'}=${k}`);
  }
  return { unreachable, unclassified, unkeyedStaff: [...new Set(unkeyedStaff)].sort(), ineffective, ungated };
}

/** Routes with no business domain (route-domains.mjs could not place them). */
export const undomained = (rs = routes) => rs.filter((r) => !gen.factsOf(r).domain).map((r) => `${r.method} ${gen.openapiPath(r.path)}  (${r.file})`);
/** The api-contracts typing ratchet: untyped routes not in the baseline, and baseline lines that are typed or gone. */
export function typesRatchet(rs = routes, baseline = existsSync(TYPES_BASELINE) ? readFileSync(TYPES_BASELINE, 'utf8').split('\n').filter((l) => l && !l.startsWith('#')) : []) {
  const t = routeTypes(rs, gen.openapiPath);
  const untyped = [...new Set(t.filter((x) => !x.typed).map((x) => x.key))].sort();
  const set = new Set(baseline);
  return { typed: t.filter((x) => x.typed).length, total: t.length, untyped, newUntyped: untyped.filter((k) => !set.has(k)), stale: baseline.filter((k) => !untyped.includes(k)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--write-types-baseline') {
    const { untyped, typed, total } = typesRatchet(routes, []);
    writeFileSync(TYPES_BASELINE, '# Routes whose handler names no @aipowersalon/api-contracts wire type (request or response). Frozen at BUILD_PLAN Phase 12\n' +
      '# (Oct 8 2026); ONLY SHRINKS. Type a route (import its type from api-contracts into the controller signature), then\n' +
      '# regenerate to REMOVE its line: node apps/api/scripts/check-api-contract.mjs --write-types-baseline\n' + untyped.join('\n') + '\n');
    console.log(`types baseline: ${untyped.length} untyped routes (${typed} of ${total} typed)`); process.exit(0);
  }
  const { unreachable, unclassified, unkeyedStaff, ineffective, ungated } = evaluate();
  const noDomain = undomained();
  const types = typesRatchet();
  if (process.argv[2] === '--write-baseline') {
    writeFileSync(BASELINE, '# Staff routes with no route-level permission (authorised inside their service). Frozen Oct 4 2026; ONLY SHRINKS.\n' +
      '# Regenerate only to REMOVE entries: node apps/api/scripts/check-api-contract.mjs --write-baseline\n' + unkeyedStaff.join('\n') + '\n');
    console.log(`baseline: ${unkeyedStaff.length} unkeyed staff routes`); process.exit(0);
  }
  const base = existsSync(BASELINE) ? readFileSync(BASELINE, 'utf8').split('\n').filter((l) => l && !l.startsWith('#')) : [];
  const newUnkeyed = unkeyedStaff.filter((k) => !base.includes(k));
  const paid = base.filter((k) => !unkeyedStaff.includes(k));
  const fail = unreachable.length + unclassified.length + newUnkeyed.length + paid.length + ineffective.length + ungated.length
    + noDomain.length + types.newUntyped.length + types.stale.length;
  console.log(`check:api-contract: reachable ✓ ${unreachable.length ? '✗' : ''}| unclassified platform paths ${unclassified.length} | unkeyed staff routes ${unkeyedStaff.length} (baseline ${base.length}) | domains ${routes.length - noDomain.length}/${routes.length} | api-contracts types ${types.typed}/${types.total} (untyped baseline ${types.untyped.length - types.newUntyped.length})`);
  const list = (title, xs) => { if (xs.length) { console.error(`\n${title} (${xs.length}):`); for (const x of xs.slice(0, 40)) console.error(`  ${x}`); } };
  list('INEFFECTIVE — @RequirePermission on a CLASS is never enforced (the guards read the handler); move it onto each handler', ineffective);
  list('UNREACHABLE — no role allowed into the realm holds the key', unreachable);
  list('UNGATED — a route of a plan-gated feature without its @RequireFeature (PLAN_FEATURE_ROUTES)', ungated);
  list('NO DOMAIN — place the route in apps/api/openapi/route-domains.mjs (SOURCE_DOMAINS or PATH_RULES) or add @Domain()', noDomain);
  list('NEW untyped routes — name an @aipowersalon/api-contracts request/response type in the handler signature (the types baseline only shrinks)', types.newUntyped);
  list('Types-baseline entries that are now typed or gone — remove them (run with --write-types-baseline)', types.stale);
  list('UNCLASSIFIED /super-admin paths — denied to every platform identity; add them to PLATFORM_PATH_DOMAIN', unclassified);
  list('NEW staff routes without @RequirePermission — declare one (the baseline only shrinks)', newUnkeyed);
  list('Baseline entries that are now keyed or gone — remove them (run with --write-baseline)', paid);
  process.exit(fail ? 1 : 0);
}
