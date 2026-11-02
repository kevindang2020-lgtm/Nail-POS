#!/usr/bin/env node
/* Builds the full HTTP route table from every registered controller and detects TRUE collisions
 * (same METHOD + same normalized full path). Shared prefixes are fine in Nest; only exact
 * method+path duplicates actually shadow each other. */
const fs = require('fs');
const path = require('path');
// stripComments — INLINED. It used to be:
//
//     const { stripComments } = require('/home/claude/work/strip-comments');
//
// An ABSOLUTE path into the scratch directory of the session that wrote this file — on the line directly above
// a comment claiming the script is "path-independent so it runs in CI on any checkout". It has never run
// anywhere but that one machine, and it took BOTH route-collision checks down with it: `check:nav:deep` and
// `check:crosswire` import this file, and both have been throwing MODULE_NOT_FOUND instead of checking anything.
//
// A checker that cannot start is worse than no checker. It occupies the slot where one would have been.
//
// Block comments are stripped only when they OPEN at a line boundary. That is not fussiness: a route path can
// legitimately contain `/*` — `@Get('media/*')` is a real route in this codebase — and a naive block-comment
// stripper would treat it as the start of a comment and eat the rest of the file.
function stripComments(src) {
  return src
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '')          // banner + JSDoc blocks, at a line start only
    .split('\n')
    .map((l) => (/^\s*(\/\/|\*)/.test(l) ? '' : l))       // whole-line comments, same rule the other 5 checkers use
    .join('\n');
}
// Path-independent so it runs in CI on any checkout.
const SRC = require('path').resolve(__dirname, '../src');
// Constitution 13: domain modules (modules/*/src) register routes too — the ONE route table must include them, or
// crosswire/unreached/nav report a moved controller's routes as missing.
const MODULES = require('path').resolve(__dirname, '../../../modules');
const MODULE_SRC_ROOTS = fs.existsSync(MODULES) ? fs.readdirSync(MODULES).map((m) => require('path').join(MODULES, m, 'src')).filter((d) => fs.existsSync(d)) : [];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name === 'node_modules' || e.name === 'dist') continue; walk(p, out); }
    else if (p.endsWith('.ts') && !p.endsWith('.d.ts') && !/\.(spec|test|e2e-spec)\.ts$/.test(p)) out.push(p);
  }
  return out;
}

// `Sse` is a GET that streams (text/event-stream). It was missing until Constitution 5 Step 6, which left the 7 realtime
// streams out of every gate built on this table.
const METHODS = ['Get', 'Post', 'Put', 'Patch', 'Delete', 'All', 'Head', 'Options', 'Sse'];
// Only SHOUT when run directly. Imported as a library (by audit-crosswire and audit-sidebar-deep) it must be
// silent — a library that prints its own report into someone else's output is a library that corrupts it.
const IS_MAIN = require.main === module;
const log = (...a) => { if (IS_MAIN) console.log(...a); };


// ── Decorator and parameter facts (Constitution 5 Step 6 / G5: the OpenAPI manifest reads them from HERE, so the
// route table stays ONE collector). Additive fields only: { decorators, classDecorators, params }.
// A decorator is `@Name` or `@Name(args)` with balanced parentheses; strings are skipped so a ')' inside a quoted
// path does not end the argument list.
function skipString(t, i) { const q = t[i]; for (i++; i < t.length; i++) { if (t[i] === '\\') { i++; continue; } if (t[i] === q) return i; } return i; }
function matchParenForward(t, i) { let d = 0; for (; i < t.length; i++) { const c = t[i]; if (c === "'" || c === '"' || c === '`') { i = skipString(t, i); continue; } if (c === '(') d++; else if (c === ')' && --d === 0) return i; } return -1; }
// Index of a trailing `//` comment in t[ls..le), skipping strings (so 'https://…' in a quoted path is not one), or -1.
function lineCommentAt(t, ls, le) { for (let i = ls; i < le; i++) { const c = t[i]; if (c === "'" || c === '"' || c === '`') { i = skipString(t, i); continue; } if (c === '/' && t[i + 1] === '/') return i; } return -1; }
function readDecoratorsForward(t, i) {
  const out = [];
  for (;;) {
    for (;;) {   // whitespace and trailing `// …` comments (stripComments removes only WHOLE-line comments)
      while (i < t.length && /\s/.test(t[i])) i++;
      if (t[i] === '/' && t[i + 1] === '/') { const nl = t.indexOf('\n', i); i = nl < 0 ? t.length : nl; continue; }
      break;
    }
    const m = /^@([A-Za-z0-9_]+)/.exec(t.slice(i, i + 80));
    if (!m) return { list: out, end: i };
    let j = i + m[0].length; let k = j; while (k < t.length && /\s/.test(t[k])) k++;
    let args = '';
    if (t[k] === '(') { const e = matchParenForward(t, k); if (e < 0) return { list: out, end: i }; args = t.slice(k + 1, e).trim(); j = e + 1; }
    out.push({ name: m[1], args }); i = j;
  }
}
// The decorators stacked ABOVE index i (read backwards, then returned top-down).
function readDecoratorsBackward(t, i) {
  const out = [];
  for (;;) {
    let e = i - 1; while (e >= 0 && /\s/.test(t[e])) e--;
    if (e < 0) break;
    // `@RequireStepUp()   // Constitution 7 §8 …` — step back over a trailing comment before reading the decorator
    for (;;) { const ls = t.lastIndexOf('\n', e) + 1; const c = lineCommentAt(t, ls, e + 1); if (c < 0) break; e = c - 1; while (e >= 0 && /\s/.test(t[e])) e--; if (e < 0) break; }
    if (e < 0) break;
    let args = ''; let nameEnd = e + 1;
    if (t[e] === ')') {
      let d = 0, s = e; for (; s >= 0; s--) { if (t[s] === ')') d++; else if (t[s] === '(' && --d === 0) break; }
      if (s < 0) break; args = t.slice(s + 1, e).trim(); nameEnd = s; while (nameEnd > 0 && /\s/.test(t[nameEnd - 1])) nameEnd--;
    }
    let ns = nameEnd; while (ns > 0 && /[A-Za-z0-9_]/.test(t[ns - 1])) ns--;
    if (ns === nameEnd || t[ns - 1] !== '@') break;
    out.unshift({ name: t.slice(ns, nameEnd), args }); i = ns - 1;
  }
  return out;
}
// Handler parameters: @Param('x') / @Query('x') / @Query() / @Body() / @Headers('x') …, in signature order.
function readParams(t, openParen) {
  const close = matchParenForward(t, openParen); if (close < 0) return [];
  const sig = t.slice(openParen + 1, close); const out = [];
  const re = /@(Param|Query|Body|Headers|Req|Res|UploadedFile|UploadedFiles)\s*\(\s*(?:['"`]([^'"`]*)['"`])?/g; let m;
  while ((m = re.exec(sig))) out.push({ in: m[1], name: m[2] || null });
  return out;
}

const routes = [];

// The routes declared in ONE source file — exported so the controller/decorator parsing is unit-tested on fixtures
// (src/api/openapi-manifest.vitest.spec.ts) instead of only being trusted because the totals look plausible.
function routesInSource(rawText, f) {
  const routes = [];
  const text = stripComments(rawText);
  if (!text.includes('@Controller')) return routes;

  // split file into controller class blocks
  // tolerate ANY intervening decorators between @Controller(...) and `class` (e.g. @UseGuards)
  // Whitespace between the decorators may hold a trailing `// …` comment: `@UseGuards(VoiceAuthGuard)  // §58` made the
  // whole controller invisible (11 voice routes absent from every gate) until Constitution 5 Step 6.
  const ctlRe = /@Controller\s*\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)(?:\s|\/\/[^\n]*)*(?:@[A-Za-z0-9_]+\s*(?:\([^)]*\))?(?:\s|\/\/[^\n]*)*)*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_]+)/g;
  const marks = [];
  let m;
  while ((m = ctlRe.exec(text))) {
    const ctlOpen = m.index + m[0].indexOf('(');
    const afterCtl = readDecoratorsForward(text, matchParenForward(text, ctlOpen) + 1).list;
    marks.push({ prefix: m[1] || '', cls: m[2], start: m.index, classDecorators: [...readDecoratorsBackward(text, m.index), ...afterCtl] });
  }
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].start;
    const end = i + 1 < marks.length ? marks[i + 1].start : text.length;
    const block = text.slice(start, end);
    for (const meth of METHODS) {
      const re = new RegExp('@' + meth + "\\s*\\(\\s*(?:['\"`]([^'\"`]*)['\"`])?\\s*\\)", 'g');
      let mm;
      while ((mm = re.exec(block))) {
        const sub = mm[1] || '';
        // find handler name
        const after = block.slice(mm.index + mm[0].length, mm.index + mm[0].length + 400);
        const hn = /(?:async\s+)?([A-Za-z0-9_]+)\s*\(/.exec(after.replace(/@[A-Za-z]+\([^)]*\)\s*/g, ''));
        const full = ('/' + [marks[i].prefix, sub].filter(Boolean).join('/')).replace(/\/+/g, '/');
        const fwd = readDecoratorsForward(block, mm.index + mm[0].length);
        const decorators = [...readDecoratorsBackward(block, mm.index), ...fwd.list].filter((d) => !METHODS.includes(d.name));
        const sigOpen = (() => { const r = /(?:async\s+)?[A-Za-z0-9_]+\s*\(/.exec(block.slice(fwd.end)); return r ? fwd.end + r.index + r[0].length - 1 : -1; })();
        const params = sigOpen >= 0 ? readParams(block, sigOpen) : [];
        routes.push({
          method: meth === 'Sse' ? 'GET' : meth.toUpperCase(),
          ...(meth === 'Sse' ? { stream: true } : {}),
          path: full,
          // normalize :params so /a/:id and /a/:ticketId collide-check the same
          norm: full.replace(/:[A-Za-z0-9_]+/g, ':p'),
          controller: marks[i].cls,
          handler: hn ? hn[1] : '?',
          file: f.startsWith(SRC) ? f.replace(SRC + '/', '') : f.replace(require('path').resolve(__dirname, '../../..') + '/', ''),
          decorators, classDecorators: marks[i].classDecorators, params,
        });
      }
    }
  }
  return routes;
}
for (const f of [SRC, ...MODULE_SRC_ROOTS].flatMap((r) => walk(r))) routes.push(...routesInSource(fs.readFileSync(f, 'utf8'), f));

const byKey = new Map();
for (const r of routes) {
  const k = r.method + ' ' + r.norm;
  if (!byKey.has(k)) byKey.set(k, []);
  byKey.get(k).push(r);
}
const collisions = [...byKey.entries()].filter(([, v]) => v.length > 1);

log(`=== API ROUTE TABLE ===`);
log(`total routes: ${routes.length}`);
log(`unique method+path: ${byKey.size}`);
log('');
log(`## TRUE COLLISIONS (same METHOD + same normalized path — one shadows the other): ${collisions.length}`);
for (const [k, v] of collisions) {
  log(`   ${k}`);
  for (const r of v) log(`      -> ${r.controller}.${r.handler}()  [${r.file}]  raw=${r.path}`);
}

// route count by top-level namespace
const ns = new Map();
for (const r of routes) {
  const seg = r.path.split('/').filter(Boolean)[0] || '(root)';
  ns.set(seg, (ns.get(seg) || 0) + 1);
}
log('');
log('## ROUTES BY NAMESPACE');
for (const [k, v] of [...ns.entries()].sort((a, b) => b[1] - a[1])) log(`   ${String(v).padStart(4)}  /${k}`);


// ONE source of truth for the route table.
//
// `audit-crosswire` used to build its own — and it found 2,191 routes where this finds 2,218, producing 24 FAKE
// orphans. Two collectors always drift, and the drift shows up as a checker crying wolf on correct code, which is
// how a checker gets ignored and the real findings get through with it.
module.exports = { routes, routesInSource };
