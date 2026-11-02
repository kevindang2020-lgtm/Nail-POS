#!/usr/bin/env node
// check-role-checks.mjs — BUILD_PLAN Phase 9 (Constitution 2 §148 "legacy role checks audited"; §153 "no unsafe legacy
// role checks"). Authorization is decided by PERMISSIONS (packages/permissions: hasPermission / the decision object /
// the typed policies) — never by comparing a role NAME. A `role === 'OWNER'` in a service is an OWNER shortcut: it
// bypasses every template, custom role, DENY override and branch scope the salon set up, and it silently stops matching
// the day a role is renamed (booking.controller compared lowercase 'owner' — it never matched anything).
//
// What it finds, in non-test BACKEND code (apps/api/src, modules/*/src, the backend packages):
//   1. EQUALITY   `<…role…> === 'OWNER'` / `!==` / `==` / `!=` (either order) against a role name, any case
//   2. MEMBERSHIP `<LIST>.includes(<…role…>)` / `<SET>.has(<…role…>)`, and `['OWNER', …].includes(…)` literals
//   3. SWITCH     `case 'OWNER':` inside a `switch (<…role…>)`
// The legitimate ones — realm routing (customer / staff / platform planes), the SUPER_ADMIN plane split, the role →
// template mapping itself, labels — are listed in apps/api/security/role-checks.allowlist.json WITH a reason. The
// allowlist is the baseline: any occurrence it does not cover fails; an entry covering more occurrences than its `count`
// fails (match '*' covers a whole file — for a file another owner is still editing — capped by its count). Entries that no longer match are reported (--strict fails on them) so the debt record stays true.
//
//   node apps/api/scripts/check-role-checks.mjs            gate
//   node apps/api/scripts/check-role-checks.mjs --list     every occurrence, allowlisted or not
//   node apps/api/scripts/check-role-checks.mjs --strict   also fail on stale allowlist entries
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const ALLOWLIST = join(HERE, '../security/role-checks.allowlist.json');

// Frontend / contract-only packages are not backend authorization code.
const NON_BACKEND_PACKAGES = new Set(['api-client', 'api-contracts', 'mobile-sdk', 'realtime-client', 'ui', 'testing', 'realtime-contracts']);

export const ROLE_NAMES = new Set([
  'owner', 'manager', 'front_desk', 'reception', 'receptionist', 'technician', 'super_admin', 'customer', 'admin',
  'tenant_admin', 'tenant_owner', 'branch_manager', 'customer_display', 'platform_support', 'moderator',
]);
const isRoleLit = (s) => ROLE_NAMES.has(String(s).toLowerCase());
const ROLE_IDENT_RE = /\b[\w$]*role\w*\b/gi;   // ctx.role, actor.role, baseRole, viewer.role …
// A call transcript's speakerRole ('customer' | 'agent') is data about a recording, not about the principal.
const NOT_A_PRINCIPAL = /^(speaker|prev|next|agent|caller)role$/i;
const ROLE_IDENT = { test: (s) => [...String(s).matchAll(ROLE_IDENT_RE)].some((m) => !NOT_A_PRINCIPAL.test(m[0])) };

/** Strip // and block comments (keeps line structure) and the CONTENT of template literals' text parts is kept. */
export function stripComments(src) {
  let out = ''; let i = 0; let mode = null;   // null | 'line' | 'block' | quote char
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (mode === 'line') { if (c === '\n') { mode = null; out += c; } i++; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = null; i += 2; continue; } out += c === '\n' ? '\n' : ''; i++; continue; }
    if (mode) { out += c; if (c === '\\') { out += n ?? ''; i += 2; continue; } if (c === mode) mode = null; i++; continue; }
    if (c === '/' && n === '/') { mode = 'line'; i += 2; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') mode = c;
    out += c; i++;
  }
  return out;
}

const EQ_LEFT = /([\w$.?()[\]'"]*role\w*[\w$.?()'"]*)\s*(===|!==|==|!=)\s*(['"])([A-Za-z_]+)\3/gi;
const EQ_RIGHT = /(['"])([A-Za-z_]+)\1\s*(===|!==|==|!=)\s*([\w$.?()[\]]*role\w*)/gi;
const MEMBER = /\.(includes|has|indexOf)\(\s*([^()'"`]*(?:\([^()]*\)[^()'"`]*)*)\)/g;
const LIT_ARRAY = /\[\s*((?:['"][A-Za-z_]+['"]\s*,\s*)*['"][A-Za-z_]+['"]\s*)\]\s*(?:as\s+const\s*)?\)?\s*\.(includes|has)\(/g;

/** Every role-name check in one source file: [{ line, kind, text }]. */
export function scanSource(src, file = '') {
  const code = stripComments(src);
  const lines = code.split('\n');
  const found = [];
  const add = (idx, kind) => found.push({ file, line: idx + 1, kind, text: src.split('\n')[idx]?.trim() ?? '' });
  let switchOnRoleUntil = -1;
  lines.forEach((l, idx) => {
    let hit = false;
    for (const m of l.matchAll(EQ_LEFT)) if (isRoleLit(m[4]) && ROLE_IDENT.test(m[1])) { hit = true; break; }
    if (!hit) for (const m of l.matchAll(EQ_RIGHT)) if (isRoleLit(m[2]) && ROLE_IDENT.test(m[4])) { hit = true; break; }
    if (hit) { add(idx, 'equality'); return; }
    for (const m of l.matchAll(LIT_ARRAY)) {
      const names = [...m[1].matchAll(/['"]([A-Za-z_]+)['"]/g)].map((x) => x[1]);
      const arg = l.slice(m.index + m[0].length).split(')')[0];
      if (names.some(isRoleLit) && ROLE_IDENT.test(arg)) { add(idx, 'membership'); return; }
    }
    for (const m of l.matchAll(MEMBER)) {
      const arg = m[2] ?? '';
      if (ROLE_IDENT.test(arg) && !/^\s*['"`]/.test(arg)) {
        const receiver = l.slice(0, m.index);
        // `ctx.permissions.includes(role…)` would be a permission check; only list / set receivers named for roles,
        // or any receiver when the argument is the role itself.
        if (/permissions\s*\??\s*$/i.test(receiver.replace(/\)\s*$/, ''))) continue;
        add(idx, 'membership'); return;
      }
    }
    if (/\bswitch\s*\(([^)]*)\)/.test(l) && ROLE_IDENT.test(/\bswitch\s*\(([^)]*)\)/.exec(l)[1])) switchOnRoleUntil = idx + 40;
    if (idx <= switchOnRoleUntil) {
      const cs = [...l.matchAll(/\bcase\s+(['"])([A-Za-z_]+)\1\s*:/g)];
      if (cs.some((c) => isRoleLit(c[2]))) { add(idx, 'switch'); return; }
    }
  });
  return found;
}

function walk(d, acc = []) {
  if (!existsSync(d)) return acc;
  for (const n of readdirSync(d)) {
    if (n === 'node_modules' || n === 'dist') continue;
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.ts$/.test(p) && !/\.d\.ts$/.test(p) && !/\.(spec|test)\.ts$/.test(p) && !/[\\/](__tests__|test|tests)[\\/]/.test(p)) acc.push(p);
  }
  return acc;
}

export function backendFiles(root = REPO) {
  const roots = [join(root, 'apps/api/src')];
  const mods = join(root, 'modules');
  if (existsSync(mods)) for (const m of readdirSync(mods)) roots.push(join(mods, m, 'src'));
  const pk = join(root, 'packages');
  if (existsSync(pk)) for (const p of readdirSync(pk)) if (!NON_BACKEND_PACKAGES.has(p)) roots.push(join(pk, p, 'src'));
  return roots.flatMap((r) => walk(r));
}

export function scanTree(root = REPO) {
  return backendFiles(root).flatMap((f) => scanSource(readFileSync(f, 'utf8'), relative(root, f)));
}

export function loadAllowlist(path = ALLOWLIST) {
  if (!existsSync(path)) return [];
  const j = JSON.parse(readFileSync(path, 'utf8'));
  return Array.isArray(j) ? j : j.entries ?? [];
}

/** Classify occurrences against the allowlist. */
export function evaluate(occurrences, allowlist) {
  const used = new Map();   // entry index -> count
  const unlisted = [];
  const malformed = allowlist.filter((e) => !e || !e.file || !e.match || !String(e.reason ?? '').trim()).map((e) => JSON.stringify(e));
  for (const o of occurrences) {
    const i = allowlist.findIndex((e) => e.file === o.file && (e.match === '*' || o.text.includes(e.match)));   // '*' = the whole file, capped by count
    if (i < 0) { unlisted.push(o); continue; }
    used.set(i, (used.get(i) ?? 0) + 1);
  }
  const over = [...used.entries()].filter(([i, n]) => n > (allowlist[i].count ?? 1)).map(([i, n]) => ({ entry: allowlist[i], found: n }));
  const stale = allowlist.filter((_, i) => !used.has(i));
  const under = [...used.entries()].filter(([i, n]) => n < (allowlist[i].count ?? 1)).map(([i, n]) => ({ entry: allowlist[i], found: n }));
  return { unlisted, over, stale, under, malformed };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const occ = scanTree();
  const allow = loadAllowlist();
  if (process.argv.includes('--list')) {
    for (const o of occ) console.log(`${o.file}:${o.line}  [${o.kind}]  ${o.text.slice(0, 160)}`);
    console.log(`\n${occ.length} role-name checks in ${new Set(occ.map((o) => o.file)).size} files`);
    process.exit(0);
  }
  const r = evaluate(occ, allow);
  const strict = process.argv.includes('--strict');
  console.log(`check:role-checks: ${occ.length} role-name checks; allowlist ${allow.length} entries (${allow.reduce((s, e) => s + (e.count ?? 1), 0)} occurrences)`);
  if (r.malformed.length) { console.error('\nMALFORMED allowlist entries (file, match and a reason are required):'); for (const m of r.malformed) console.error('  ' + m); }
  if (r.unlisted.length) {
    console.error(`\nNEW ROLE-NAME CHECKS (${r.unlisted.length}) — decide by permission (hasPermission / a typed policy), not by role name:`);
    for (const o of r.unlisted) console.error(`  ${o.file}:${o.line}  ${o.text.slice(0, 150)}`);
    console.error('  A legitimate one (realm routing, the SUPER_ADMIN plane split, the role→template mapping) goes in\n  apps/api/security/role-checks.allowlist.json with its reason.');
  }
  if (r.over.length) { console.error('\nALLOWLIST ENTRIES NOW COVERING MORE CHECKS THAN RECORDED:'); for (const o of r.over) console.error(`  ${o.entry.file}  "${o.entry.match}"  count ${o.entry.count ?? 1}, found ${o.found}`); }
  if (r.stale.length || r.under.length) {
    console.log(`\n${strict ? 'STALE' : 'note — stale'} allowlist entries (${r.stale.length + r.under.length}); remove / lower them:`);
    for (const e of r.stale) console.log(`  ${e.file}  "${e.match}"`);
    for (const o of r.under) console.log(`  ${o.entry.file}  "${o.entry.match}"  count ${o.entry.count ?? 1}, found ${o.found}`);
  }
  const fail = r.malformed.length + r.unlisted.length + r.over.length + (strict ? r.stale.length + r.under.length : 0);
  if (!fail) console.log('OK — every role-name check is allowlisted with a reason.');
  process.exit(fail ? 1 : 0);
}
