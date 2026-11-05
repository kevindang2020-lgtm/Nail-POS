#!/usr/bin/env node
// tenant-builder-check.mjs — check:tenant-builder. The raw-SQL tenant gate (check:tenant) scans sql`...` templates only;
// it never saw a Kysely BUILDER statement (db.selectFrom('customers')…). This gate covers that shape.
//
// A builder statement on a tenant-scoped table (a table with a tenant_id column, derived from the migrations) is
// "unscoped" when the statement — from .selectFrom / .updateTable / .deleteFrom to the end of its chain — names neither
// tenant_id / tenantId nor a scoping helper. Super-admin code (path or SuperAdminGuard, the same rule as check:tenant)
// is exempt: cross-tenant IS its job.
//
// IT IS A RATCHET, NOT A PROOF. At its introduction (Constitution 13 open-items close-out) ~700 statements were
// unscoped by this definition — most are scoped transitively (by a primary key read that the caller already checked, a
// join to a scoped row, a helper) and none could be reviewed one by one in that pass. They are frozen in
// tenant-builder-baseline.json, keyed by file + table + normalized statement, so:
//   * a NEW unscoped builder statement fails the gate (it must carry tenant_id, or be reviewed and baselined);
//   * the baseline can only SHRINK (--update refuses to add entries; use --accept <key> after a review).
// Postgres row-level security remains the real defence in depth, and is not in place (recorded, not solved, here).
//
//   node scripts/tenant-builder-check.mjs            gate (exit 1 on any new unscoped statement)
//   node scripts/tenant-builder-check.mjs --shrink   rewrite the baseline without entries that no longer exist
//   node scripts/tenant-builder-check.mjs --init     write the baseline from scratch (first introduction only)
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(API, '..', '..');
const SRC = join(API, 'src');
const MIG = join(API, 'db', 'migrations');
const BASELINE = join(API, 'scripts', 'tenant-builder-baseline.json');

// ── roots: the API, every domain module, the workspace packages the API depends on (same as check:tenant) ──────────
const MODULES = join(ROOT, 'modules');
const moduleRoots = existsSync(MODULES) ? readdirSync(MODULES).map((m) => join(MODULES, m, 'src')).filter((p) => existsSync(p)) : [];
const apiDeps = Object.keys(JSON.parse(readFileSync(join(API, 'package.json'), 'utf8')).dependencies ?? {});
const packageRoots = apiDeps.filter((d) => d.startsWith('@aipowersalon/')).map((d) => join(ROOT, 'packages', d.slice(14), 'src')).filter((p) => existsSync(p));
const roots = [SRC, ...moduleRoots, ...packageRoots];

const walk = (d, acc = []) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p, acc); else if (p.endsWith('.ts') && !/\.(spec|test|pgtest)\.ts$/.test(p) && !p.endsWith('.d.ts')) acc.push(p); } return acc; };
// the same stable key as check:tenant: API files relative to src; grouped-module files <dir>/<file>; flat-module
// files <module>/<file>; packages packages/<p>/<file>
const keyOf = (f) => {
  if (f.startsWith(SRC + '/')) return f.slice(SRC.length + 1);
  const m = /\/modules\/([^/]+)\/src\/(.+)$/.exec(f); if (m) return m[2].includes('/') ? m[2] : `${m[1]}/${m[2]}`;
  const p = /\/packages\/([^/]+)\/src\/(.+)$/.exec(f); return p ? `packages/${p[1]}/${p[2]}` : f;
};

// ── tenant-scoped tables, from the migrations ───────────────────────────────────────────────────────────────────────
const scoped = new Set();
for (const f of readdirSync(MIG).filter((x) => x.endsWith('.sql')).sort()) {
  const sql = readFileSync(join(MIG, f), 'utf8'); let m;
  const re = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([a-z0-9_]+)\s*\(([\s\S]*?)\n\s*\);/gi;
  while ((m = re.exec(sql))) if (/^\s*tenant_id\s/im.test(m[2])) scoped.add(m[1].toLowerCase());
  const alt = /ALTER TABLE\s+([a-z0-9_]+)\s+ADD COLUMN(?:\s+IF NOT EXISTS)?\s+tenant_id/gi;
  while ((m = alt.exec(sql))) scoped.add(m[1].toLowerCase());
}

// ── scan ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const SCOPING = /tenant_id|tenantId|\btenantScope|\bscoped\(|\bandTenant\(|\btenantPred\(|\bforTenant\(/;
const START = /\.(selectFrom|updateTable|deleteFrom)\(\s*['"`]([a-z0-9_]+)(?:\s+as\s+[a-z0-9_]+)?['"`]/g;
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (x) => x.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/[^\n]*/g, (x, p) => p + ' '.repeat(x.length - p.length));
/** Does this file define a query-builder scoped(qb, ...) helper that applies the tenant? (Its first statement must be a
 *  .where on a tenant column — 'tenant_id', 'x.tenant_id', col('tenant_id') or a tenantCol parameter — equal to .tenantId.) */
const helperScopes = (src, name = 'scoped') => {
  // the helper's definition in THIS file: name[<generics>](qb: ..., ...) { ... } — its opening statements must apply the
  // tenant: a .where(<column>, '=', <x>.tenantId) whose column is (or is built from) tenant_id
  // a method `name(qb: ...) {` or a local arrow `const name = <T ...>(q: T): T => {` — the first parameter may be any name
  const def = new RegExp(`\\b${name}\\s*(?:=\\s*)?(?:<[^()]*(?:\\([^()]*\\)[^()]*)*>)?\\s*\\(\\s*\\w+\\s*:([^)]*)\\)[^{]*\\{([\\s\\S]{0,320})`).exec(src);
  if (!def) return false;
  const body = def[1] + ' ' + def[2];   // parameters too: reviews' helper takes col = 'reviews.tenant_id' as a default
  return /tenant_id/.test(body) && /\.where\(\s*[\w.'"()]+(?:\s+as\s+any)?\s*,\s*'='\s*,\s*(?:\w+\.)?tenantId(?:\s+as\s+any)?\s*\)/.test(body);   // ctx.tenantId, or a tenantId the enclosing method holds
};
const found = [];
for (const f of roots.flatMap((r) => walk(r))) {
  const raw = readFileSync(f, 'utf8');
  const key = keyOf(f);
  if (/super-admin|super_admin/i.test(key) || /SuperAdminGuard/.test(raw)) continue;   // cross-tenant IS the job
  const s = stripComments(raw);
  let m;
  START.lastIndex = 0;
  while ((m = START.exec(s))) {
    const table = m[2].toLowerCase();
    if (!scoped.has(table)) continue;
    // the statement runs to the first ';' at bracket depth 0 (or the end of the enclosing call) — generous by design
    let i = m.index, depth = 0;
    for (; i < s.length; i++) { const c = s[i]; if (c === '(' || c === '{' || c === '[') depth++; else if (c === ')' || c === '}' || c === ']') { if (depth === 0) break; depth--; } else if (c === ';' && depth === 0) break; }
    let stmt = s.slice(m.index, i);
    // `(this.db.selectFrom('x') as any).where('tenant_id', ...)`: the cast's closing paren ended the scan early — carry on
    // through the chain that follows it (checkout's day-total reads were this shape and ARE scoped)
    if (/\(\s*(?:\(\s*)?(?:this\.)?[\w.]*$/.test(s.slice(Math.max(0, m.index - 40), m.index)) && /^\s*as\s+any\s*$/.test(stmt.replace(/^\.(selectFrom|updateTable|deleteFrom)\([^)]*\)/, '')) && s[i] === ')') {
      let k = i + 1, d = 0;
      for (; k < s.length; k++) { const c = s[k]; if (c === '(' || c === '{' || c === '[') d++; else if (c === ')' || c === '}' || c === ']') { if (d === 0) break; d--; } else if (c === ';' && d === 0) break; }
      stmt = s.slice(m.index, k);
    }
    if (SCOPING.test(stmt)) continue;
    // WRAPPED BY A VERIFIED HELPER: `this.scoped(this.db.deleteFrom('x'), ctx)`. The builder is the helper's first argument,
    // so the helper name sits just BEFORE the statement's start and the chain above never names tenant_id. Accept it only
    // when THIS file defines scoped(qb, ...) and that definition's first act is .where(<tenant column>, '=', <x>.tenantId)
    // — 168 baselined statements were this shape, all behind helpers that do exactly that.
    { const w = /\b(scoped|scope|byTenant|byTenantBranch|tenantWhere)\s*(?:<[^>(]*>)?\(\s*(?:\(\s*[\w.]+(?:\s+as\s+[\w<>]+)*\s*\)|(?:this\.)?[\w.]*)$/.exec(s.slice(Math.max(0, m.index - 80), m.index));
      if (w && helperScopes(s, w[1])) continue; }   // a helper is trusted only when ITS BODY in this file applies the tenant
    const norm = stmt.replace(/\s+/g, ' ').slice(0, 120);
    found.push({ key: `${key} :: ${table} :: ${norm}`, file: key, table, line: s.slice(0, m.index).split('\n').length });
  }
}

const keys = [...new Set(found.map((x) => x.key))].sort();
const mode = process.argv[2];
if (mode === '--list') {   // every still-unscoped statement WITH its location (for the review pass), writes first
  const order = (x) => (/:: \.(updateTable|deleteFrom)/.test(x.key) ? 0 : 1);
  for (const x of [...found].sort((a, b) => order(a) - order(b) || a.file.localeCompare(b.file) || a.line - b.line)) console.log(`${x.file}:${x.line}  ${x.table}  ${x.key.split(' :: ')[2].slice(0, 90)}`);
  process.exit(0);
}
if (mode === '--init') {
  if (existsSync(BASELINE)) { console.error('refusing --init: the baseline exists (the ratchet only shrinks — use --shrink)'); process.exit(1); }
  writeFileSync(BASELINE, JSON.stringify({ note: 'Frozen unscoped Kysely builder statements on tenant tables (see tenant-builder-check.mjs). May only SHRINK.', entries: keys }, null, 2) + '\n');
  console.log(`baseline written: ${keys.length} statements`); process.exit(0);
}
const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')).entries : [];
const baseSet = new Set(base);
const fresh = keys.filter((k) => !baseSet.has(k));
const gone = base.filter((k) => !keys.includes(k));
if (mode === '--shrink') {
  const kept = base.filter((k) => keys.includes(k));
  writeFileSync(BASELINE, JSON.stringify({ note: JSON.parse(readFileSync(BASELINE, 'utf8')).note, entries: kept }, null, 2) + '\n');
  console.log(`baseline shrunk: ${base.length} -> ${kept.length}`); process.exit(0);
}
console.log(`builder statements on tenant tables without tenant scoping: ${keys.length} (baseline ${base.length}; ${gone.length} baselined statement(s) no longer exist — run --shrink)`);
if (fresh.length) {
  console.log(`\nNEW UNSCOPED BUILDER STATEMENTS: ${fresh.length} — each could read or write ANOTHER SALON's rows:`);
  for (const k of fresh) { const x = found.find((y) => y.key === k); console.log(`  ${x.file}:${x.line}  (${x.table})\n     ${k.split(' :: ')[2]}`); }
  console.log('\nAdd a tenant_id condition, or — if it is genuinely scoped another way — review it and add it to the baseline by hand with a note.');
  process.exit(1);
}
console.log('OK — no NEW unscoped builder statements.');
