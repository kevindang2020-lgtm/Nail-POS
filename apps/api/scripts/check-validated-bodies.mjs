#!/usr/bin/env node
// check-validated-bodies.mjs — BUILD_PLAN Phase 12 (Constitution 5, #17 "input validation standardized").
//
// THE ONE MECHANISM: a mutating handler (POST / PUT / PATCH / DELETE) that reads a request body validates it with
//     @Body(ValidatedBody(SCHEMA)) b
// (packages/permissions: a JSON-Schema that strips unknown fields, refuses dangerous ones, and answers 400
// VALIDATION_FAILED with field paths). A handler that reads `req.body` directly validates it with validateBody(...).
//
// WHAT FAILS
//   • a mutating handler whose body is not validated — a bare @Body(), a per-field @Body('x'), or `req.body` read
//     without validateBody — and which is not in the allowlist;
//   • an allowlist entry that is now validated, no longer reads a body, or no longer exists — remove it (the list only
//     SHRINKS; `--write` regenerates it from the code so the diff is reviewable).
// The allowlist (validated-bodies.allowlist.json) names the module that owns each route: it is the honest debt record.
//
//   node scripts/check-validated-bodies.mjs           check (CI)          --coverage   print the numbers only
//   node scripts/check-validated-bodies.mjs --write   rewrite the allowlist from the code (review the diff)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API = resolve(HERE, '..');
const REPO = resolve(API, '../..');
const ALLOWLIST = join(HERE, 'validated-bodies.allowlist.json');
const require = createRequire(import.meta.url);
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function skipString(t, i) { const q = t[i]; for (i++; i < t.length; i++) { if (t[i] === '\\') { i++; continue; } if (t[i] === q) return i; } return i; }
function match(t, i, open, close) {
  let d = 0;
  for (; i < t.length; i++) {
    const c = t[i];
    if (c === "'" || c === '"' || c === '`') { i = skipString(t, i); continue; }
    if (c === '/' && t[i + 1] === '/') { const nl = t.indexOf('\n', i); i = nl < 0 ? t.length : nl; continue; }
    if (c === open) d++; else if (c === close && --d === 0) return i;
  }
  return -1;
}

/** The signature and body text of `handler` inside the class `controller` of a source file. */
export function handlerSource(src, controller, handler) {
  const cls = new RegExp(`class\\s+${controller}\\b`).exec(src);
  if (!cls) return null;
  const start = cls.index; const next = src.indexOf('@Controller', start + 1);
  const block = src.slice(start, next < 0 ? src.length : next);
  // a method definition: at line start (after indentation / decorators / async), name, then '('
  const re = new RegExp(`(^|\\n|\\)\\s|\\s)(?:async\\s+)?${handler}\\s*\\(`, 'g'); let m;
  while ((m = re.exec(block))) {
    const open = block.indexOf('(', m.index + m[0].length - 1);
    const close = match(block, open, '(', ')'); if (close < 0) continue;
    const after = block.slice(close + 1).match(/^\s*(?::\s*[^{;]+?)?\s*\{/);   // optional return type, then the body
    if (!after) continue;
    const bodyOpen = close + 1 + after[0].length - 1;
    const bodyClose = match(block, bodyOpen, '{', '}'); if (bodyClose < 0) continue;
    return { sig: block.slice(open + 1, close), body: block.slice(bodyOpen + 1, bodyClose) };
  }
  return null;
}

/** 'validated' | 'unvalidated' | 'none' (reads no body) | 'unknown' (handler not found) */
export function bodyStatus(h) {
  if (!h) return 'unknown';
  const bodies = [...h.sig.matchAll(/@Body\s*\(([^)]*\)?)/g)].map((m) => m[1]);
  const rawBody = /\b(req|request|r)\s*\.\s*body\b/.test(h.body) || /\b(req|request)\s*\??\.\s*body\b/.test(h.sig);
  if (!bodies.length && !rawBody) return 'none';
  const allValidated = bodies.every((a) => /^\s*ValidatedBody\s*\(/.test(a));
  const rawValidated = !rawBody || /\bvalidateBody\s*\(/.test(h.body);
  return allValidated && rawValidated ? 'validated' : 'unvalidated';
}

const moduleOf = (file) => (/^modules\/([^/]+)\//.exec(file)?.[1] ?? `api:${file.split('/')[0]}`);
const fileCache = new Map();
const readSrc = (file) => {
  if (!fileCache.has(file)) {
    const p = file.startsWith('modules/') ? join(REPO, file) : join(API, 'src', file);
    fileCache.set(file, existsSync(p) ? readFileSync(p, 'utf8') : '');
  }
  return fileCache.get(file);
};

export function analyse(rs, read = readSrc) {
  const out = [];
  for (const r of rs) {
    if (!MUTATING.has(r.method)) continue;
    const status = bodyStatus(handlerSource(read(r.file), r.controller, r.handler));
    out.push({ key: `${r.method} ${r.path}`, module: moduleOf(r.file), status, controller: r.controller, handler: r.handler });
  }
  return out;
}

export function coverage(rows) {
  const n = (s) => rows.filter((r) => r.status === s).length;
  const withBody = n('validated') + n('unvalidated') + n('unknown');
  return { mutating: rows.length, withBody, validated: n('validated'), unvalidated: n('unvalidated'), unknown: n('unknown'), noBody: n('none'), pct: withBody ? Math.round((n('validated') / withBody) * 1000) / 10 : 100 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { routes } = require('./audit-routes.js');
  const rows = analyse(routes);
  const c = coverage(rows);
  const debt = Object.fromEntries(rows.filter((r) => r.status !== 'validated' && r.status !== 'none').map((r) => [r.key, r.module]).sort(([a], [b]) => a.localeCompare(b)));
  const summary = `check:validated-bodies: ${c.validated} / ${c.withBody} mutating routes that read a body are validated (${c.pct}%) — ${c.mutating} mutating routes, ${c.noBody} read no body${c.unknown ? `, ${c.unknown} handler(s) not located` : ''}`;
  if (process.argv.includes('--coverage')) { console.log(summary); console.log(JSON.stringify(c)); process.exit(0); }
  if (process.argv.includes('--write')) {
    writeFileSync(ALLOWLIST, JSON.stringify({ _comment: 'BUILD_PLAN Phase 12 (#17): mutating routes whose body is not yet validated with @Body(ValidatedBody(schema)) — route → owning module. ONLY SHRINKS: validate a route, then remove its line (node apps/api/scripts/check-validated-bodies.mjs --write).', routes: debt }, null, 2) + '\n');
    console.log(summary); console.log(`allowlist: ${Object.keys(debt).length} entries written`); process.exit(0);
  }
  const allowed = existsSync(ALLOWLIST) ? JSON.parse(readFileSync(ALLOWLIST, 'utf8')).routes ?? {} : {};
  const fresh = Object.keys(debt).filter((k) => !(k in allowed));
  const stale = Object.keys(allowed).filter((k) => !(k in debt));
  console.log(summary + ` | allowlist ${Object.keys(allowed).length}`);
  const list = (title, xs) => { if (xs.length) { console.error(`\n${title} (${xs.length}):`); for (const x of xs.slice(0, 40)) console.error(`  ${x}`); } };
  list('NEW mutating routes whose body is not validated — use @Body(ValidatedBody(SCHEMA)) (the allowlist only shrinks)', fresh.map((k) => `${k}  [${debt[k]}]`));
  list('Allowlist entries that are now validated, read no body, or are gone — remove them (run with --write)', stale);
  process.exit(fresh.length + stale.length ? 1 : 0);
}
