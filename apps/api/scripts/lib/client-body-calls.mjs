// client-body-calls.mjs — Security Deep Scan §40 (S-A14): what every first-party client SENDS in a request body, read
// statically, so a route can refuse unknown fields (strict mode) without breaking a caller.
//
// Clients scanned: the SPAs (apps/*/src), the shared packages (packages/*/src), the single-file apps (apps/*/index.html,
// apps/*/public/*.html, apps/*/*.js), the pilot / proof scripts (apps/api/scripts, tooling/e2e, tooling/ci). Two call shapes:
//     <x>.post|put|patch[<T>](PATH, BODY, …)          the api clients, the pilot's per-role clients
//     <fn>('POST'|'PUT'|'PATCH', PATH, BODY, …)        the pilot's call(method, path, body) helpers
// PATH: a string or template literal (a `${CONST}` prefix is resolved from a same-file `const CONST = '…'` / arrow returning a
// template); `/api/v1` is dropped; `${…}` segments become wildcards; a query string is dropped.
// BODY: an object literal → its keys (shorthand, quoted, methods; nested object literals recursively); `undefined`, `{}`, no
// argument → no keys; anything else (a variable, a spread, a call) → UNVERIFIABLE (the route cannot be proven safe).
// A call whose PATH cannot be resolved is UNRESOLVED; its literal path fragments are kept so a route they could reach is
// treated as unverifiable too (never silently "no caller").
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const SKIP_DIR = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', 'ios', 'android', 'www', 'public-dist', 'dist-frontends']);
function walk(d, out = []) {
  if (!existsSync(d)) return out;
  for (const f of readdirSync(d)) {
    if (SKIP_DIR.has(f)) continue;
    const p = join(d, f); const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js|html)$/.test(f) && !/\.(test|spec)\.|vitest\.spec|pgtest|\.d\.ts$|\.min\.js$/.test(f)) out.push(p);
  }
  return out;
}

/** The client source files under the repository root. */
export function clientFiles(repo) {
  const apps = readdirSync(join(repo, 'apps')).filter((a) => a !== 'api');
  const files = [];
  for (const a of apps) {
    walk(join(repo, 'apps', a, 'src'), files);
    for (const f of existsSync(join(repo, 'apps', a)) ? readdirSync(join(repo, 'apps', a)) : []) if (/\.(html|js|mjs)$/.test(f) && !/config|\.min\./.test(f)) files.push(join(repo, 'apps', a, f));
    walk(join(repo, 'apps', a, 'public'), files);
  }
  for (const p of readdirSync(join(repo, 'packages'))) walk(join(repo, 'packages', p, 'src'), files);
  walk(join(repo, 'apps/api/scripts'), files);
  walk(join(repo, 'tooling/e2e'), files); walk(join(repo, 'tooling/ci'), files);
  return [...new Set(files)].filter((f) => !/client-body-(calls|typeproof)\.mjs$/.test(f));
}

function skipString(t, i) { const q = t[i]; for (i++; i < t.length; i++) { if (t[i] === '\\') { i++; continue; } if (q === '`' && t[i] === '$' && t[i + 1] === '{') { i = matchClose(t, i + 1, '{', '}'); continue; } if (t[i] === q) return i; } return i; }
/** index of the bracket closing the one at i (strings / templates / comments skipped), or -1 */
export function matchClose(t, i, open, close) {
  let d = 0;
  for (; i < t.length; i++) {
    const c = t[i];
    if (c === "'" || c === '"' || c === '`') { i = skipString(t, i); continue; }
    if (c === '/' && t[i + 1] === '/') { const nl = t.indexOf('\n', i); i = nl < 0 ? t.length : nl; continue; }
    if (c === '/' && t[i + 1] === '*') { const e = t.indexOf('*/', i + 2); i = e < 0 ? t.length : e + 1; continue; }
    if (c === open) d++; else if (c === close && --d === 0) return i;
  }
  return -1;
}
/** Split the text of an argument list (without its parens) at top-level commas. */
export function splitArgs(t) {
  const out = []; let d = 0, s = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === "'" || c === '"' || c === '`') { i = skipString(t, i); continue; }
    if (c === '/' && t[i + 1] === '/') { const nl = t.indexOf('\n', i); i = nl < 0 ? t.length : nl; continue; }
    if ('([{'.includes(c)) d++; else if (')]}'.includes(c)) d--;
    else if (c === ',' && d === 0) { out.push(t.slice(s, i).trim()); s = i + 1; }
  }
  const last = t.slice(s).trim(); if (last) out.push(last);
  return out;
}

/** An object literal's shape: { keys: {name: nested shape | null}, open: true when a spread / computed key makes it unprovable }. */
export function objectShape(text) {
  const t = text.trim();
  if (!t.startsWith('{')) return null;
  const end = matchClose(t, 0, '{', '}'); if (end < 0) return null;
  const body = t.slice(1, end);
  const shape = { keys: {}, open: false };
  for (const part of splitArgs(body)) {
    if (!part) continue;
    if (part.startsWith('...')) { const inner = bodyShapeOf(part.slice(3)); if (inner && !inner.open) Object.assign(shape.keys, inner.keys); else shape.open = true; continue; }
    if (part.startsWith('[')) { shape.open = true; continue; }
    const m = /^(?:async\s+)?(?:(['"])((?:\\.|(?!\1).)*)\1|([A-Za-z_$][\w$]*))\s*(:|\(|$)/.exec(part);
    if (!m) { shape.open = true; continue; }
    const key = m[2] ?? m[3];
    if (m[4] === ':') {
      const value = part.slice(m[0].length).trim();
      shape.keys[key] = value.startsWith('{') ? objectShape(value) : { value };
    } else shape.keys[key] = { value: key };
  }
  return shape;
}

/** Same-file string constants and template-returning arrows, for `${BASE}/x` paths. */
function fileConsts(src) {
  const c = new Map();
  for (const m of src.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])((?:\\.|(?!\2)[^\\])*)\2\s*[;\n,]/g)) c.set(m[1], { kind: 'str', v: m[3] });
  for (const m of src.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*\(([^)]*)\)\s*(?::\s*string\s*)?=>\s*(['"`])((?:\\.|(?!\3)[^\\])*)\3/g)) c.set(m[1], { kind: 'fn', v: m[4] });
  return c;
}
/** A client path expression → a normalized template ('/pos/tickets/*' style, `*` = any one segment), or null. */
export function normalizePath(expr, consts = new Map(), depth = 0) {
  let e = String(expr ?? '').trim();
  const wrap = /^(?:apiUrl|url|v1|path)\((.*)\)$/s.exec(e); if (wrap) e = wrap[1].trim();
  const concat = /^[A-Za-z_$][\w$.]*(?:\(\))?\s*\+\s*((['"`])\/[\s\S]*\2)$/.exec(e); if (concat) e = concat[1];   // BASE + '/auth/login'
  let raw;
  if (/^'[^']*'$|^"[^"]*"$/.test(e)) raw = e.slice(1, -1);
  else if (/^`[\s\S]*`$/.test(e)) raw = e.slice(1, -1);
  else if (/^[A-Za-z_$][\w$]*$/.test(e) && consts.get(e)?.kind === 'str') raw = consts.get(e).v;
  else return null;
  // ${CONST} / ${fn(…)} prefixes from same-file constants
  raw = raw.replace(/\$\{\s*([A-Za-z_$][\w$]*)\s*(\([^}]*\))?\s*\}/g, (all, name, call) => {
    const c = consts.get(name); if (!c || depth > 3) return all;
    if ((c.kind === 'str' && !call) || (c.kind === 'fn' && call)) return c.v;
    return all;
  });
  raw = raw.split('?')[0].replace(/^https?:\/\/[^/]+/, '').replace(/^\$\{[^}]*\}(?=\/)/, '');
  if (!raw.startsWith('/')) return null;
  raw = raw.replace(/^\/api\/v\d+(?=\/)/, '');
  const segs = raw.split('/').slice(1).map((s) => (/\$\{/.test(s) ? '*' : s));
  if (segs.some((s) => s === '')) { while (segs.length && segs[segs.length - 1] === '') segs.pop(); }
  return '/' + segs.join('/');
}


/** `body as unknown as T` → `body` */
export function stripCast(e) { return String(e ?? '').trim().replace(/\s+as\s+[\s\S]*$/, '').replace(/^\(([\s\S]*)\)$/, '$1').trim(); }
/** A body expression's shape: object literal, `cond ? {…} : {…}` (union), empty / undefined; null when not provable. */
export function bodyShapeOf(expr) {
  if (expr === undefined) return { keys: {}, open: false };
  const e = stripCast(expr);
  if (/^(undefined|null|\{\s*\})$/.test(e)) return { keys: {}, open: false };
  if (e.startsWith('{')) return objectShape(e);
  // a top-level ternary between two literals
  let d = 0, q = -1, col = -1;
  for (let i = 0; i < e.length; i++) {
    const c = e[i];
    if (c === "'" || c === '"' || c === '`') { i = skipString(e, i); continue; }
    if ('([{'.includes(c)) d++; else if (')]}'.includes(c)) d--;
    else if (d === 0 && c === '?' && e[i + 1] !== '.' && e[i + 1] !== '?' && q < 0) q = i;
    else if (d === 0 && c === ':' && q >= 0 && col < 0) col = i;
  }
  if (q > 0 && col > q) {
    const a = bodyShapeOf(e.slice(q + 1, col)), b = bodyShapeOf(e.slice(col + 1));
    if (a && b) return { keys: { ...a.keys, ...b.keys }, open: a.open || b.open };
  }
  return null;
}
/** The client method a body parameter comes from: `obj = { fn: (a, body) => api.post(PATH, body) }` → { obj, fn, idx }. */
function enclosingWrapper(src, at, param) {
  const before = src.slice(Math.max(0, at - 600), at);
  const re = /([A-Za-z_$][\w$]*)\s*(?::|=)\s*(?:async\s*)?\(([^()]*)\)\s*(?::\s*[^=;]*?)?=>|(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*(?::\s*[^{;]*)?\{/g;
  let last = null;
  for (const m of before.matchAll(re)) last = m;
  if (!last) return null;
  const fn = last[1] ?? last[3]; const params = splitArgs(last[2] ?? last[4] ?? '').map((x) => x.replace(/^\.\.\./, '').split(/[?:=]/)[0].trim());
  const idx = params.indexOf(param); if (idx < 0 || ['if', 'for', 'while', 'switch', 'catch', 'function'].includes(fn)) return null;
  const head = src.slice(0, at - before.length + (last.index ?? 0));
  const objs = [...head.matchAll(/(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*\{/g)];
  const obj = objs.length ? objs[objs.length - 1][1] : null;
  return obj ? { obj, fn, idx } : null;
}

const METHOD_CALL = /\.(post|put|patch)\s*(?:<(?:[^<>]|<[^<>]*>)*>)?\s*\(/g;
const FN_CALL = /\b[A-Za-z_$][\w$.]*\s*\(\s*['"](POST|PUT|PATCH)['"]\s*,/g;

/** Every body-carrying call in one file: { file, line, method, path | null, pathExpr, shape | null, bodyExpr } */
export function callsIn(file, src, repo = '') {
  const out = []; const consts = fileConsts(src);
  const lineOf = (i) => src.slice(0, i).split('\n').length;
  const take = (method, argsStart, pathIdx) => {
    const close = matchClose(src, argsStart, '(', ')'); if (close < 0) return;
    const args = splitArgs(src.slice(argsStart + 1, close));
    const pathExpr = args[pathIdx]; if (pathExpr === undefined) return;
    const bodyExpr = args[pathIdx + 1];
    const path = normalizePath(pathExpr, consts);
    if (!path && !/['"`]\//.test(pathExpr) && !/^[A-Za-z_$]/.test(pathExpr)) return;   // not an HTTP call (cache.put(key, …))
    let shape = bodyShapeOf(bodyExpr);
    let wrapper = null;
    if (!shape && bodyExpr && /^[A-Za-z_$][\w$]*$/.test(stripCast(bodyExpr))) wrapper = enclosingWrapper(src, argsStart, stripCast(bodyExpr));
    // Playwright APIRequestContext: request.post(url, { data: BODY, headers }) — the body is `data`
    if (shape && !shape.open && shape.keys.data && Object.keys(shape.keys).every((k) => ['data', 'headers', 'params', 'timeout', 'failOnStatusCode', 'maxRedirects'].includes(k)) && /request\s*$|\bctx\.request|page\.request/.test(src.slice(Math.max(0, argsStart - 40), argsStart))) {
      const d = shape.keys.data; shape = d && d.keys ? d : (d && /^(undefined|null|\{\s*\})$/.test(d.value ?? '') ? { keys: {}, open: false } : null);
    }
    out.push({ file: repo ? relative(repo, file) : file, line: lineOf(argsStart), method: method.toUpperCase(), path, pathExpr, shape, bodyExpr: bodyExpr ?? null, wrapper });
  };
  for (const m of src.matchAll(METHOD_CALL)) take(m[1], m.index + m[0].length - 1, 0);
  for (const m of src.matchAll(FN_CALL)) { const open = src.indexOf('(', m.index); take(m[1], open, 1); }
  return out;
}

/** Does a normalized client path reach a route template ('/pos/tickets/:id/refund')? */
/** How specific a match is (literal segments that matched); the most specific route wins (/photos/order over /photos/:id). */
export function matchScore(clientPath, routePath) { return routePath.split('/').slice(1).filter((s, i) => !s.startsWith(':') && clientPath.split('/')[i + 1] === s).length; }
export function pathMatches(clientPath, routePath) {
  const a = clientPath.split('/').slice(1), b = routePath.split('/').slice(1);
  if (a.length !== b.length) return false;
  return b.every((seg, i) => seg.startsWith(':') || a[i] === seg || (a[i] === '*' && seg.startsWith(':')));
}

/** All calls in the repository's client files. */
export function allClientCalls(repo) {
  const calls = []; const sources = new Map();
  for (const f of clientFiles(repo)) {
    const src = readFileSync(f, 'utf8'); sources.set(f, src);
    if (!/\.(post|put|patch)\s*[(<]|['"](POST|PUT|PATCH)['"]/.test(src)) continue;
    calls.push(...callsIn(f, src, repo));
  }
  // one level of client wrappers: `xApi.fn(a, { … })` → the body the wrapper forwards
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i]; if (!c.wrapper) continue;
    const derived = [];
    const re = new RegExp(`\\b${c.wrapper.obj}\\s*\\.\\s*${c.wrapper.fn}\\s*\\(`, 'g');
    let opaque = false;
    const appRoot = /^apps\/[^/]+\//.exec(c.file)?.[0] ?? null;   // an app's wrapper is called inside that app; a package's from anywhere
    for (const [f, src] of sources) {
      if (appRoot && !relative(repo, f).startsWith(appRoot)) continue;
      for (const m of src.matchAll(re)) {
        const open = m.index + m[0].length - 1; const close = matchClose(src, open, '(', ')'); if (close < 0) continue;
        const args = splitArgs(src.slice(open + 1, close));
        derived.push({ ...c, file: relative(repo, f), line: src.slice(0, open).split('\n').length, shape: bodyShapeOf(args[c.wrapper.idx]), bodyExpr: args[c.wrapper.idx] ?? null, via: `${c.wrapper.obj}.${c.wrapper.fn}`, wrapper: null });
      }
      if (new RegExp(`\\b${c.wrapper.obj}\\s*\\.\\s*${c.wrapper.fn}\\b(?!\\s*\\()`).test(src) && !/\.(test|spec)\./.test(f)) opaque = true;   // passed around as a value
    }
    if (opaque) continue;   // keep the original (unverifiable) call
    calls.splice(i, 1, ...derived);
  }
  return calls;
}

/** The literal path fragments of an unresolved call ('/pos/checkout/' from `${base}/pos/checkout/${id}`), for conservatism. */
export function fragmentsOf(pathExpr) {
  return [...String(pathExpr).matchAll(/\/[A-Za-z][\w-]*(?:\/[A-Za-z][\w-]*)*/g)].map((m) => m[0]).filter((f) => f.length > 3);
}

/** Keys a call sends that the schema does not declare (top level and nested object literals), or 'unverifiable'. */
export function undeclaredKeys(schema, shape, path = '') {
  if (!shape) return 'unverifiable';
  if (!schema || typeof schema !== 'object') return [];
  if (Array.isArray(schema.anyOf) && !schema.properties) { const alt = schema.anyOf.find((a) => a && a.properties); if (alt) schema = { ...alt, 'x-strict': schema['x-strict'] ?? alt['x-strict'] }; }
  const objectSchema = schema.properties || schema.additionalProperties !== undefined;
  if (!objectSchema) return [];
  if (schema.additionalProperties) return [];
  if (shape.open) return 'unverifiable';
  const props = schema.properties ?? {}; const bad = [];
  for (const [k, v] of Object.entries(shape.keys)) {
    if (!Object.prototype.hasOwnProperty.call(props, k)) { bad.push(path + k); continue; }
    const ps = props[k];
    const nestedObject = ps && (ps.properties || ps.additionalProperties === false) && !ps.additionalProperties && ps['x-strict'] !== false;
    if (!nestedObject) continue;
    if (v && v.keys) { const r = undeclaredKeys(ps, v, path + k + '.'); if (r === 'unverifiable') return r; bad.push(...r); }
    else if (v && 'value' in v && !/^(null|undefined)$/.test(v.value)) return 'unverifiable';
  }
  // arrays of objects declared with properties: a client literal array we do not parse → unverifiable when present
  for (const [k, v] of Object.entries(shape.keys)) {
    const ps = props[k];
    if (ps && ps.items && (ps.items.properties) && !ps.items.additionalProperties && v && 'value' in v && !/^(null|undefined|\[\s*\])$/.test(v.value)) return 'unverifiable';
  }
  return bad;
}

/** A body schema whose top level keeps every field (S.freeObject / webhookEnvelope): strict mode means nothing there. */
export function openSchema(schema) { return !!schema && (schema.additionalProperties === true || (!schema.properties && Array.isArray(schema.anyOf) && schema.anyOf.some((a) => a && a.additionalProperties === true))); }
