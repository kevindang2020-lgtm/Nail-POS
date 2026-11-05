// scan-permission-keys.mjs — BUILD_PLAN Phase 9: where permission keys are USED in backend code, for check:perms and the
// docs generator. Two kinds:
//   ROUTE    @RequirePermission('<key>') on a handler (what the guard enforces)
//   SERVICE  a literal key handed to a permission helper inside a service / repository / guard:
//              hasPermission(ctx, '<key>')  need(ctx, '<key>')  this.need(ctx, '<key>')  this.has(ctx, '<key>')
//              can(role, '<key>')  requirePermission(…, '<key>')  requireCapability(…, '<key>')  assertPermission(…)
//              <x>.permissions.includes('<key>')  perms.includes('<key>')  permissions.indexOf('<key>')
//              { requiredPermission: '<key>' }  { approverPermission: '<key>' }
//              const SOMETHING_PERM = '<key>'  (names ending in PERM / PERMISSION)   (a key held in a named constant and passed on)
// Comments are ignored. Test files are not usage.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const NON_BACKEND_PACKAGES = new Set(['api-client', 'api-contracts', 'mobile-sdk', 'realtime-client', 'ui', 'testing', 'realtime-contracts']);

function walk(d, acc = []) {
  if (!existsSync(d)) return acc;
  for (const n of readdirSync(d)) {
    if (n === 'node_modules' || n === 'dist') continue;
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.endsWith('.ts') && !p.endsWith('.d.ts') && !/\.(spec|test)\.ts$/.test(p)) acc.push(p);
  }
  return acc;
}
export function backendFiles(root) {
  const roots = [join(root, 'apps/api/src')];
  const mods = join(root, 'modules');
  if (existsSync(mods)) for (const m of readdirSync(mods)) roots.push(join(mods, m, 'src'));
  const pk = join(root, 'packages');
  if (existsSync(pk)) for (const p of readdirSync(pk)) if (!NON_BACKEND_PACKAGES.has(p)) roots.push(join(pk, p, 'src'));
  return roots.flatMap((r) => walk(r));
}
export const stripComments = (s) => s.split('\n').map((l) => { const t = l.trim(); return (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) ? '' : l.replace(/\s\/\/\s.*$/, ''); }).join('\n');

const KEY = `'([a-z_]+(?:\\.[a-z_]+)+)'`;
const ARG = `[^,()'"\`]*(?:\\([^()]*\\)[^,()'"\`]*)*`;
export const SERVICE_PATTERNS = [
  // the first argument must be a principal (ctx / actor / role / user / session / req …) — `has(stored, 'a.b')` is an object lookup
  new RegExp(`\\b(?:hasPermission|requirePermission|requireCapability|assertPermission|hasPerm|need|has|can|needPerm|requirePerm|ensurePermission)\\s*\\(\\s*(?=[^,]*\\b(?:ctx|actor|principal|role|user|session|req|c|p|tc|v|me|viewer|caller)\\b)${ARG},\\s*${KEY}\\s*\\)`, 'g'),
  new RegExp(`\\b(?:this\\.)?(?:need|has|requirePermission|assertPermission|requirePerm)\\s*\\(\\s*${KEY}\\s*\\)`, 'g'),
  new RegExp(`\\b(?:permissions|perms|permissionKeys)\\s*\\??\\.?\\s*(?:\\|\\|\\s*\\[\\]\\s*\\)\\s*)?\\.?(?:includes|indexOf)(?:\\?\\.)?\\(\\s*${KEY}\\s*\\)`, 'g'),
  // a declared requirement: { requiredPermission: '<key>' } (AI tools, approval policies, nav items in the backend)
  new RegExp(`\\b(?:requiredPermission|approverPermission|requiredKey)\\s*:\\s*${KEY}`, 'g'),
  new RegExp(`\\bconst\\s+[A-Z][A-Z0-9_]*(?:PERM|PERMISSION)S?\\s*(?::\\s*[\\w<>\\[\\]]+)?\\s*=\\s*${KEY}`, 'g'),
];
// Strings that look like keys but are not (hostnames, file names, event names) — never checked.
const NOT_A_KEY = /\.(com|net|org|io|ts|js|json|svg|png)$|^(app|apps|www|api)\./;
// Technician-override vocabulary (technician_permissions rows, tech-permissions.ts) — its own closed list.
export const TECH_OVERRIDE_PREFIX = 'pos.tech.';

export function scanSourceForKeys(src) {
  const code = stripComments(src);
  const route = [...code.matchAll(/@RequirePermission\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
  const service = [];
  for (const re of SERVICE_PATTERNS) for (const m of code.matchAll(re)) {
    const k = m[1];
    if (NOT_A_KEY.test(k) || k.startsWith(TECH_OVERRIDE_PREFIX) || !k.includes('.')) continue;
    service.push(k);
  }
  return { route, service };
}

/** { route: Map<key, files[]>, service: Map<key, files[]> } over the backend tree. */
export function scanKeyUsages(root) {
  const route = new Map(), service = new Map();
  const add = (m, k, f) => { if (!m.has(k)) m.set(k, []); if (!m.get(k).includes(f)) m.get(k).push(f); };
  for (const f of backendFiles(root)) {
    const rel = relative(root, f);
    const r = scanSourceForKeys(readFileSync(f, 'utf8'));
    for (const k of r.route) add(route, k, rel);
    for (const k of r.service) add(service, k, rel);
  }
  return { route, service };
}

/** Every legacy `pos.<domain>.<action>` key used anywhere (route or service), sorted — the registry's alias list. */
export function posAliasKeys(usages) {
  const all = new Set([...usages.route.keys(), ...usages.service.keys()].filter((k) => k.startsWith('pos.') && !k.startsWith(TECH_OVERRIDE_PREFIX) && k.split('.').length >= 3));
  return [...all].sort();
}
