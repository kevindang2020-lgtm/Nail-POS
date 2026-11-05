#!/usr/bin/env node
// role-matrix.mjs — BUILD_PLAN Phase 9 (Constitution 2 §153 "role-matrix tests"): the per-role ALLOW / DENY matrix.
//
// For EVERY session route (the route manifest the OpenAPI gate reads) × EVERY principal (each tenant role with its real
// grant, each platform role with its real grant), the decision the guards make, computed with the guards' own functions:
//   R  refused by the realm (the session layer accepts the token only on its own realm — realmForPath — and RealmGuard
//      only lets a role family into its prefixes — canAccessRoutePrefix; SuperAdminGuard admits only the platform,
//      TenantAuthGuard / TechnicianAuthGuard only salon staff, CustomerAuthGuard only customers, StaffSessionGuard no customer)
//   A  allowed: the handler's key (or the platform domain key PlatformDomainGuard derives) is held — hasPermission
//   D  denied: the key is not held
//   U  allowed with NO key (an unkeyed route: the realm is the only gate) — X when TENANT_DEFAULT_DENY is on
// The committed snapshot (apps/api/security/role-matrix.snapshot.json) is the referee for "behaviour preservation": a
// change in who may call what fails role-matrix.vitest.spec.ts until the snapshot is regenerated ON PURPOSE:
//
//   node apps/api/scripts/role-matrix.mjs --write     regenerate the snapshot (review the diff: who gained / lost what)
//   node apps/api/scripts/role-matrix.mjs --diff      print the changes against the snapshot, exit 1 if any
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
export const SNAPSHOT = join(HERE, '../security/role-matrix.snapshot.json');
const require = createRequire(import.meta.url);
const P = join(REPO, 'packages/permissions/dist/');
const { hasPermission, canAccessRoutePrefix, isTenantRole } = require(P + 'security-core.js');
const { ROLE_PERMISSIONS, platformPermissionsFor } = require(P + 'rbac.js');
const { PLATFORM_ROLES } = require(P + 'platform-roles.js');
let TENANT_DEFAULT_DENY = false;
try { TENANT_DEFAULT_DENY = !!require(P + 'guards/role-permission.guard.js').TENANT_DEFAULT_DENY; } catch { /* older build: off */ }
const { realmForPath } = require(join(REPO, 'modules/identity/dist/auth/session-from-request.js'));
const gen = await import('./openapi.mjs');
const { routes } = require('./audit-routes.js');

const SESSION_REALM = (role) => (role === 'SUPER_ADMIN' ? 'platform' : role === 'CUSTOMER' ? 'customer' : 'tenant');
const sessionAccepted = (role, path) => { const r = realmForPath(path); return r === 'any' || r === SESSION_REALM(role); };
const STAFF = /^\/(pos|owner|tenant|tech)(\/|$)/;

export const PRINCIPALS = [
  ...Object.keys(ROLE_PERMISSIONS).filter((r) => r !== 'SUPER_ADMIN').map((role) => ({ role, label: role, permissions: [...ROLE_PERMISSIONS[role]] })),
  ...PLATFORM_ROLES.map((pr) => ({ role: 'SUPER_ADMIN', label: pr, permissions: platformPermissionsFor(pr) })),
];

/** One cell: what the guards decide for this principal on this route. */
export function cell(p, f, path) {
  if (!sessionAccepted(p.role, path) || !canAccessRoutePrefix(p.role, path)) return 'R';
  if (f.guards.some((g) => /^SuperAdminGuard$/.test(g)) && p.role !== 'SUPER_ADMIN') return 'R';
  if (f.guards.some((g) => /^(CustomerAuthGuard|CustomerSecurityGuard|RequireCustomerGuard)$/.test(g)) && p.role !== 'CUSTOMER') return 'R';
  if (f.guards.some((g) => /^(TenantAuthGuard|TechnicianAuthGuard)$/.test(g)) && !isTenantRole(p.role)) return 'R';
  if (f.guards.some((g) => /^StaffSessionGuard$/.test(g)) && p.role === 'CUSTOMER') return 'R';
  const keys = f.perms.length ? f.perms : f.derived && f.derived !== 'UNCLASSIFIED' ? [f.derived] : [];
  if (f.derived === 'UNCLASSIFIED') return 'D';
  if (!keys.length) return TENANT_DEFAULT_DENY && STAFF.test(path) && p.role !== 'SUPER_ADMIN' && p.role !== 'CUSTOMER' ? 'X' : 'U';
  return keys.every((k) => hasPermission(p, k)) ? 'A' : 'D';
}

export function computeMatrix(rs = routes, principals = PRINCIPALS) {
  const out = {};
  for (const r of rs) {
    const f = gen.factsOf(r);
    if (f.auth !== 'session') continue;
    out[f.key] = principals.map((p) => cell(p, f, r.path)).join('');
  }
  return { principals: principals.map((p) => p.label), defaultDeny: TENANT_DEFAULT_DENY, routes: Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b))) };
}

export function loadSnapshot(path = SNAPSHOT) { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null; }

/** Every cell that changed, as "ROUTE  PRINCIPAL  old→new", plus routes added / removed. */
export function diffMatrix(snap, now) {
  const changes = [];
  if (!snap) return ['no snapshot committed'];
  if (JSON.stringify(snap.principals) !== JSON.stringify(now.principals)) changes.push(`principals changed: ${snap.principals.join(',')} → ${now.principals.join(',')}`);
  const idx = (label) => now.principals.indexOf(label);
  for (const [route, row] of Object.entries(now.routes)) {
    const old = snap.routes[route];
    if (old === undefined) { changes.push(`+ ${route}  ${row}`); continue; }
    if (old === row) continue;
    for (const label of now.principals) { const i = idx(label), j = snap.principals.indexOf(label); const a = j >= 0 ? old[j] : '?', b = row[i]; if (a !== b) changes.push(`~ ${route}  ${label}  ${a}→${b}`); }
  }
  for (const route of Object.keys(snap.routes)) if (!(route in now.routes)) changes.push(`- ${route}`);
  return changes;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const now = computeMatrix();
  if (process.argv.includes('--write')) {
    writeFileSync(SNAPSHOT, JSON.stringify({ _doc: 'Per-role ALLOW / DENY matrix (BUILD_PLAN Phase 9). One letter per principal in `principals` order: A allowed (key held), D denied (key not held), R refused by the realm, U allowed with no key (unkeyed), X unkeyed under TENANT_DEFAULT_DENY. Regenerate ON PURPOSE: node apps/api/scripts/role-matrix.mjs --write', ...now }, null, 1) + '\n');
    const n = Object.keys(now.routes).length;
    console.log(`role matrix: wrote ${n} routes × ${now.principals.length} principals`);
    process.exit(0);
  }
  const changes = diffMatrix(loadSnapshot(), now);
  console.log(`role matrix: ${Object.keys(now.routes).length} routes × ${now.principals.length} principals; ${changes.length} change(s) against the snapshot`);
  for (const c of changes.slice(0, 200)) console.log('  ' + c);
  process.exit(changes.length && process.argv.includes('--diff') ? 1 : 0);
}
