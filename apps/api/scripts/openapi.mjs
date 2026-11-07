// openapi.mjs — Constitution 5 §45 / G5: the API's machine-readable contract, generated statically.
//
//   node scripts/openapi.mjs                 write apps/api/openapi/openapi.json (gitignored, multi-MB)
//   node scripts/openapi.mjs --manifest      rewrite apps/api/openapi/manifest.txt (COMMITTED, one line per route)
//   node scripts/openapi.mjs --check         check:openapi — fail if the routes or their security drifted from the manifest
//
// Static, by the September decision: @nestjs/swagger would need the app booted in CI, and with ~940 `any` bodies it
// would emit the same empty schemas this does. Every fact is read from the code that ENFORCES it, never restated:
//   routes, decorators, params   scripts/audit-routes.js (the ONE route collector — crosswire/unreached/nav use it too)
//   realm                        @aipowersalon/permissions canAccessRoutePrefix (what RealmGuard runs)
//   public (no session)          the session middleware's .exclude() list in app.module.ts (what check:public reads)
//   /api/v1                      the rule in common/api-version.ts (every route except /platform and infrastructure)
//   error envelope + codes       @aipowersalon/api-contracts ERROR_REGISTRY (what PlatformExceptionFilter emits)
//
// The manifest is the review surface. A new route, a removed route, a changed permission, a route that became public,
// lost its step-up or its idempotency key — each changes a line, so `check:openapi` fails until the manifest is
// regenerated and the diff is in the commit for a reviewer to see. Request/response BODIES are not in it: they are
// untyped (`any`) on most handlers today and the spec says so honestly (`type: object`) rather than inventing shapes.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// BUILD_PLAN Phase 12 (#2): the business domain of every route — the ownership registry's vocabulary (route-domains.mjs)
import { domainOfRoute } from '../openapi/route-domains.mjs';
// Security Deep Scan §38: the reviewed location-bound / salon-wide classification of the record ids in a path
import { branchScopeOf } from './idor-routes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const API = resolve(HERE, '..');
const REPO = resolve(API, '../..');
const OUT_DIR = join(API, 'openapi');
const MANIFEST = join(OUT_DIR, 'manifest.txt');
const require = createRequire(import.meta.url);

const need = (p, what) => {
  if (!existsSync(p)) { console.error(`openapi: ${what} is not built (${p}). Build the package first — refusing to guess.`); process.exit(2); }
  return require(p);
};
const { routes } = require('./audit-routes.js');
const { canAccessRoutePrefix } = need(join(REPO, 'packages/permissions/dist/security-core.js'), '@aipowersalon/permissions');
const { ERROR_REGISTRY, CLIENT_ACTIONS } = need(join(REPO, 'packages/api-contracts/dist/errors.js'), '@aipowersalon/api-contracts');
// PlatformDomainGuard: a /super-admin route that declares no key gets a DERIVED one from its path domain; a path the
// map does not classify is denied to every platform identity. The manifest records the effective key, not just the
// declared one, so a change to PLATFORM_PATH_DOMAIN is a reviewed manifest diff too.
const { platformPathKey, platformDomainKeyFor } = need(join(REPO, 'packages/permissions/dist/platform-roles.js'), '@aipowersalon/permissions');
// Security Deep Scan §38: the boundary of the records each route touches (declared, else realm / path / permission)
const { routeResourceScope } = need(join(REPO, 'packages/permissions/dist/route-resource-scope.js'), '@aipowersalon/permissions');

// ── facts read from the enforcing code ──────────────────────────────────────────────────────────────────────────
const appModule = readFileSync(join(API, 'src/app.module.ts'), 'utf8');
const ex = /\.exclude\(([\s\S]*?)\)\s*\.forRoutes/.exec(appModule);
if (!ex) { console.error('openapi: cannot read the session .exclude() list from app.module.ts — refusing to label routes public.'); process.exit(2); }
// Nest/path-to-regexp patterns: ':name' one segment, '(.*)' anything. Method ALL matches every verb.
export const PUBLIC_RULES = [...ex[1].matchAll(/\{\s*path:\s*'([^']+)'\s*,\s*method:\s*RequestMethod\.([A-Z]+)\s*\}/g)].map(([, p, m]) => ({
  method: m,
  re: new RegExp('^' + p.replace(/^\//, '').split(/(\(\.\*\)|:[A-Za-z0-9_]+)/).map((part) =>
    part === '(.*)' ? '.*' : part.startsWith(':') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('') + '$'),
}));
if (!PUBLIC_RULES.length) { console.error('openapi: the .exclude() list parsed to zero rules — refusing.'); process.exit(2); }

const versionSrc = readFileSync(join(API, 'src/common/api-version.ts'), 'utf8');
const nd = /const NEVER_DEPRECATED = (\/.*\/);/.exec(versionSrc);
if (!nd) { console.error('openapi: cannot read NEVER_DEPRECATED from common/api-version.ts — refusing.'); process.exit(2); }
const NOT_VERSIONED = eval(nd[1]); // a regex literal from our own source

// ── per-route facts ─────────────────────────────────────────────────────────────────────────────────────────────
const strArgs = (args) => [...String(args || '').matchAll(/['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
const decos = (r) => [...r.classDecorators, ...r.decorators];
const has = (r, name) => decos(r).some((d) => d.name === name);
const handlerPerms = (r) => r.decorators.filter((d) => d.name === 'RequirePermission').flatMap((d) => strArgs(d.args).length ? strArgs(d.args) : [d.args || '*']);
const argsOf = (r, name) => decos(r).filter((d) => d.name === name).flatMap((d) => strArgs(d.args).length ? strArgs(d.args) : [d.args || '*']);

export function realmOf(path) {
  const c = canAccessRoutePrefix('CUSTOMER', path), o = canAccessRoutePrefix('OWNER', path), s = canAccessRoutePrefix('SUPER_ADMIN', path);
  if (c && !o && !s) return 'customer';
  if (!c && !o && s) return 'super_admin';
  if (!c && o && s) return 'staff';
  return 'shared';   // /auth, /me, /public … — authorised per route
}
export const isPublic = (method, path) => PUBLIC_RULES.some((r) => (r.method === 'ALL' || r.method === method) && r.re.test(path.replace(/^\//, '')));
export const openapiPath = (p) => p.replace(/:([A-Za-z0-9_]+)/g, '{$1}').replace(/\/\*$/, '/{path}');
const servedUnderV1 = (p) => !NOT_VERSIONED.test(p) && !/^\/platform(\/|$)/.test(p);

function recordsScope(r, pub) {
  const path = openapiPath(r.path);
  if (pub || !path.includes('{')) return null;
  const b = branchScopeOf({ path, auth: 'session' });
  return b.scope === 'branch' || b.scope === 'salon-wide' ? b.scope : null;
}

export function factsOf(r) {
  const guards = decos(r).filter((d) => d.name === 'UseGuards').flatMap((d) => d.args.split(',').map((s) => s.trim()).filter(Boolean));
  const pub = isPublic(r.method, r.path);
  return {
    key: `${r.method} ${openapiPath(r.path)}`,
    realm: realmOf(r.path),
    domain: domainOfRoute(r),
    // a route that authenticates ITSELF with the voice integration key is api_key even though the session middleware skips it
    auth: guards.some((g) => /VoiceAuthGuard/.test(g)) ? 'api_key' : pub ? 'public' : 'session',
    // HANDLER-level only: RolePermissionGuard and PlatformDomainGuard read the 'perm' metadata from the handler, so a
    // class-level @RequirePermission is never enforced (check:api-contract rejects one).
    perms: [...new Set(handlerPerms(r))].sort(),
    derived: !pub && !handlerPerms(r).length && platformPathKey(r.path) !== null
      ? (platformDomainKeyFor(r.path, r.method) || 'UNCLASSIFIED') : null,
    integration: [...new Set([...argsOf(r, 'RequireIntegrationPermission'), ...argsOf(r, 'RequireEventPermission')])].sort(),
    stepUp: has(r, 'RequireStepUp'),
    idempotent: has(r, 'Idempotent') ? (/required\s*:\s*true/.test(decos(r).find((d) => d.name === 'Idempotent').args) ? 'required' : 'optional') : null,
    guards: [...new Set(guards)].sort(),
    // BUILD_PLAN Phase 12 (#13): the plan feature (@RequireFeature) — the handler's own wins over its controller's
    feature: (strArgs(r.decorators.find((d) => d.name === 'RequireFeature')?.args)[0] ?? strArgs(r.classDecorators.find((d) => d.name === 'RequireFeature')?.args)[0]) || null,
    v1: servedUnderV1(r.path),
    // Security Deep Scan §38: resource scope — the handler's @ResourceScope wins over its controller's, else derived
    resource: routeResourceScope({
      path: r.path, realm: realmOf(r.path), perms: handlerPerms(r),
      auth: guards.some((g) => /VoiceAuthGuard/.test(g)) ? 'api_key' : pub ? 'public' : 'session',
      declared: (strArgs(r.decorators.find((d) => d.name === 'ResourceScope')?.args)[0] ?? strArgs(r.classDecorators.find((d) => d.name === 'ResourceScope')?.args)[0]) ?? null,
      records: recordsScope(r, pub),
    }),
    // BUILD_PLAN Phase 12 (Constitution 5 §32–33): the export's kind when the route is on the async operation contract
    asyncExport: /kind\s*:\s*['"`]([^'"`]+)['"`]/.exec(r.decorators.find((d) => d.name === 'AsyncExport')?.args ?? '')?.[1] ?? null,
  };
}

export function manifestLine(f) {
  const parts = [f.key, `realm=${f.realm}`, `auth=${f.auth}`, `domain=${f.domain ?? 'NONE'}`];
  if (f.perms.length) parts.push(`perm=${f.perms.join('|')}`);
  if (f.derived) parts.push(`derived=${f.derived}`);
  if (f.integration.length) parts.push(`scope=${f.integration.join('|')}`);
  if (f.resource) parts.push(`resource=${f.resource.scope}${f.resource.source ? `/${f.resource.source}` : ''}`);
  if (f.stepUp) parts.push('step-up');
  if (f.idempotent) parts.push(`idempotency=${f.idempotent}`);
  if (f.feature) parts.push(`feature=${f.feature}`);
  if (f.asyncExport) parts.push(`async=${f.asyncExport}`);
  if (f.guards.length) parts.push(`guards=${f.guards.join(',')}`);
  if (!f.v1) parts.push('unversioned');
  return parts.join('  ');
}

export function buildManifest(rs = routes) {
  const lines = rs.map((r) => manifestLine(factsOf(r)));
  // Compared with parameter NAMES erased: GET /x/:a and GET /x/:b are one route to Nest (the second never runs).
  const keys = lines.map((l) => l.split('  ')[0].replace(/\{[^}]+\}/g, '{}'));
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
  return { lines: [...lines].sort(), duplicates: [...new Set(dup)] };
}

// ── the OpenAPI document ────────────────────────────────────────────────────────────────────────────────────────
export function buildSpec(rs = routes) {
  const pkg = JSON.parse(readFileSync(join(API, 'package.json'), 'utf8'));
  const paths = {}; const usedIds = new Set();
  for (const r of rs) {
    const f = factsOf(r); const p = openapiPath(r.path); const method = r.method.toLowerCase();
    if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)) continue;   // @All is not an operation
    const item = (paths[p] ||= {});
    if (!f.v1) item.servers = [{ url: '/', description: 'infrastructure route — not served under /api/v1' }];
    let id = `${r.controller}_${r.handler}`; for (let n = 2; usedIds.has(id); n++) id = `${r.controller}_${r.handler}_${n}`; usedIds.add(id);
    const pathParams = [...p.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]);
    const params = [
      ...pathParams.map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } })),
      ...[...new Set(r.params.filter((x) => x.in === 'Query' && x.name).map((x) => x.name))].map((name) => ({ name, in: 'query', required: false, schema: { type: 'string' } })),
    ];
    if (r.method === 'GET' && !r.stream) params.push({ $ref: '#/components/parameters/Cursor' });
    if (f.idempotent) params.push({ ...structuredClone(IDEMPOTENCY_HEADER), required: f.idempotent === 'required' });
    const op = {
      operationId: id,
      tags: [r.path.split('/').filter(Boolean)[0] || 'root'],
      ...(params.length ? { parameters: params } : {}),
      security: f.auth === 'public' ? [] : f.auth === 'api_key' ? [{ apiKey: [] }] : [{ session: [] }],
      'x-realm': f.realm,
      'x-domain': f.domain,
      ...(f.perms.length ? { 'x-permissions': f.perms } : f.derived ? { 'x-permissions': [f.derived], 'x-permission-derived': true } : {}),
      ...(f.integration.length ? { 'x-integration-scopes': f.integration } : {}),
      ...(f.resource ? { 'x-resource-scope': f.resource.scope } : {}),   // Security Deep Scan §38
      ...(f.stepUp ? { 'x-step-up': true } : {}),
      ...(f.feature ? { 'x-feature': f.feature } : {}),
      'x-source': `${r.file}#${r.controller}.${r.handler}`,
      responses: {
        '200': r.stream
          ? { description: 'Server-sent event stream', content: { 'text/event-stream': { schema: { type: 'string' } } } }
          : { description: 'Success (body shape not yet typed on this handler)', content: { 'application/json': { schema: {} } } },
        ...(f.auth !== 'public' ? { '401': { $ref: '#/components/responses/Error' } } : {}),
        ...(f.perms.length || f.realm !== 'shared' ? { '403': { $ref: '#/components/responses/Error' } } : {}),
        default: { $ref: '#/components/responses/Error' },
      },
    };
    if (r.params.some((x) => x.in === 'Body')) op.requestBody = { required: true, content: { 'application/json': { schema: { type: 'object' } } } };
    if (r.params.some((x) => x.in === 'UploadedFile' || x.in === 'UploadedFiles')) op.requestBody = { required: true, content: { 'multipart/form-data': { schema: { type: 'object' } } } };
    item[method] = op;
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'AIPowerSalon API', version: pkg.version,
      description: 'Generated from the controllers by apps/api/scripts/openapi.mjs. Every route is also served at its legacy path ' +
        '(with Deprecation + Link headers). Errors use the standard envelope. List endpoints accept ?cursor= and return nextCursor.',
    },
    servers: [{ url: '/api/v1' }],
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
    components: {
      securitySchemes: {
        session: { type: 'http', scheme: 'bearer', description: 'Access token from /auth/login (realm in x-realm); browsers also send the session cookie.' },
        apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key', description: 'Tenant API key (integration principal).' },
      },
      parameters: {
        Cursor: { name: 'cursor', in: 'query', required: false, schema: { type: 'string' }, description: 'Opaque nextCursor from the previous page (paged lists only).' },
      },
      responses: { Error: { description: 'Standard error envelope', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } } },
      schemas: {
        ErrorEnvelope: {
          type: 'object', required: ['error'],
          properties: {
            error: {
              type: 'object', required: ['code', 'message'],
              properties: {
                code: { type: 'string', enum: Object.keys(ERROR_REGISTRY) },
                message: { type: 'string' }, details: { type: 'object' },
                action: { type: 'string', enum: [...CLIENT_ACTIONS] },
              },
            },
            requestId: { type: 'string' }, reference: { type: 'string' },
          },
        },
      },
    },
  };
}
const IDEMPOTENCY_HEADER = { name: 'Idempotency-Key', in: 'header', schema: { type: 'string', maxLength: 255 }, description: 'One key per user action; a retry with the same key replays the first result.' };

/** Structural self-checks a consumer (SDK generator, docs) would trip over. Returns problems, [] if clean. */
export function validateSpec(spec) {
  const problems = []; const ids = new Set();
  for (const [p, item] of Object.entries(spec.paths)) {
    const tpl = [...p.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]).sort().join(',');
    for (const [m, op] of Object.entries(item)) {
      if (m === 'servers') continue;
      const declared = (op.parameters || []).filter((x) => x.in === 'path').map((x) => x.name).sort().join(',');
      if (declared !== tpl) problems.push(`${m.toUpperCase()} ${p}: path template {${tpl}} but declares {${declared}}`);
      if (ids.has(op.operationId)) problems.push(`duplicate operationId ${op.operationId}`); ids.add(op.operationId);
      const seen = new Set();
      for (const x of op.parameters || []) { if (x.$ref) continue; const k = x.in + ':' + x.name; if (seen.has(k)) problems.push(`${m.toUpperCase()} ${p}: duplicate parameter ${k}`); seen.add(k); }
    }
  }
  return problems;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] || '--spec';
  const { lines, duplicates } = buildManifest();
  if (duplicates.length) { console.error(`openapi: two handlers claim the same METHOD + path:\n  ${duplicates.join('\n  ')}`); process.exit(1); }
  // F5 §11 / Security §38 (Nov 6 2026): the route audit REFUSES a session route whose resource scope nothing decides
  // (UNSCOPED) or whose @ResourceScope names an unknown scope (INVALID) — declare one on the handler or its controller.
  const unscoped = lines.filter((l) => /\bresource=(UNSCOPED|INVALID)\b/.test(l));
  if (unscoped.length) { console.error(`openapi: ${unscoped.length} route(s) have no resource scope — add @ResourceScope(...):\n  ${unscoped.slice(0, 20).join('\n  ')}`); process.exit(1); }
  const header = '# OpenAPI route manifest — generated by `node apps/api/scripts/openapi.mjs --manifest`. Do not edit by hand.\n' +
    '# One line per route: METHOD path  realm  auth  domain  [perm] [derived] [scope] resource=SCOPE/source [step-up] [idempotency] [feature] [guards] [unversioned]\n';
  if (mode === '--manifest') {
    mkdirSync(OUT_DIR, { recursive: true }); writeFileSync(MANIFEST, header + lines.join('\n') + '\n');
    console.log(`manifest: ${lines.length} routes → ${MANIFEST.replace(REPO + '/', '')}`);
  } else if (mode === '--check') {
    if (!existsSync(MANIFEST)) { console.error('check:openapi: no manifest — run `node apps/api/scripts/openapi.mjs --manifest` and commit it.'); process.exit(1); }
    const committed = readFileSync(MANIFEST, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
    const byKey = (ls) => new Map(ls.map((l) => [l.split('  ')[0], l]));
    const was = byKey(committed), now = byKey(lines);
    const added = [...now.keys()].filter((k) => !was.has(k)), removed = [...was.keys()].filter((k) => !now.has(k));
    const changed = [...now.keys()].filter((k) => was.has(k) && was.get(k) !== now.get(k));
    const problems = validateSpec(buildSpec());
    if (problems.length) { console.error(`check:openapi: the generated spec is invalid (${problems.length}):\n  ${problems.slice(0, 20).join('\n  ')}`); process.exit(1); }
    if (!added.length && !removed.length && !changed.length) { console.log(`check:openapi: ${lines.length} routes match the manifest; spec valid.`); process.exit(0); }
    console.error('check:openapi: the API surface drifted from apps/api/openapi/manifest.txt.');
    for (const k of added) console.error(`  + ${now.get(k)}`);
    for (const k of removed) console.error(`  - ${was.get(k)}`);
    for (const k of changed) console.error(`  ~ ${was.get(k)}\n    → ${now.get(k)}`);
    console.error('If intended, run `node apps/api/scripts/openapi.mjs --manifest` and commit the diff — it is the review record.');
    process.exit(1);
  } else {
    const spec = buildSpec(); const problems = validateSpec(spec);
    if (problems.length) { console.error(problems.slice(0, 20).join('\n')); process.exit(1); }
    mkdirSync(OUT_DIR, { recursive: true }); writeFileSync(join(OUT_DIR, 'openapi.json'), JSON.stringify(spec, null, 1));
    const ops = Object.values(spec.paths).reduce((a, i) => a + Object.keys(i).filter((k) => k !== 'servers').length, 0);
    console.log(`openapi.json: ${Object.keys(spec.paths).length} paths, ${ops} operations`);
  }
}
