// route-contract-types.mjs — BUILD_PLAN Phase 12 (Constitution 5 #30 / #52): which routes carry a WIRE TYPE from
// @aipowersalon/api-contracts (the package every frontend imports its request / response types from — the architecture
// test forbids re-declaring them), and which are still untyped.
//
// A route is TYPED when its handler's signature (parameters and return type) names an identifier the controller file
// imports from '@aipowersalon/api-contracts' (any subpath: /tenant, /customer, /platform). Static, from the source the
// route collector already reads (scripts/audit-routes.js) — no app boot.
//
// check:api-contract uses it as a ratchet: every route is typed OR listed in openapi/route-types.baseline.txt (frozen at
// Phase 12; ONLY SHRINKS). A new untyped route fails; a listed route that gained a type fails until its line is removed
// (`node apps/api/scripts/check-api-contract.mjs --write-types-baseline`), so the record stays true.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_SRC = resolve(HERE, '../src');
const REPO = resolve(HERE, '../../..');
export const TYPES_BASELINE = join(HERE, '../openapi/route-types.baseline.txt');

/** Names a source file imports from @aipowersalon/api-contracts (type or value imports, aliases resolved to the local name). */
export function contractImports(src) {
  const names = new Set();
  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]@aipowersalon\/api-contracts(?:\/[a-z-]+)?['"]/g)) {
    for (const part of m[1].split(',')) {
      const p = part.trim().replace(/^type\s+/, ''); if (!p) continue;
      const local = p.split(/\s+as\s+/).pop().trim(); if (local) names.add(local);
    }
  }
  return names;
}

/** The signature text of method `handler` in `src` (from its name to the `{` that opens its body), or null. A CALL of the
 *  same name (`this.svc.health(`) is skipped: a definition is followed by `)`, an optional `: Type`, then `{`. */
export function signatureOf(src, handler) {
  const re = new RegExp(`(?<![.\\w$])(?:async\\s+)?${handler.replace(/[$]/g, '\\$')}\\s*\\(`, 'g');
  // a service and its controller often share a file AND a method name: prefer the definition under a route decorator
  const defs = [];
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let i = m.index + m[0].length - 1, depth = 0;
    for (; i < src.length; i++) { const c = src[i]; if (c === '(') depth++; else if (c === ')' && --depth === 0) break; }
    const rest = src.slice(i + 1, i + 1 + 400);
    const head = /^\s*(:[^{;=]*)?\{/.exec(rest);
    if (head) defs.push({ text: src.slice(m.index, i + 1) + (head[1] || ''), routed: /@(Get|Post|Put|Patch|Delete|Sse|All|Head|Options)\(/.test(src.slice(Math.max(0, m.index - 400), m.index)) });
  }
  return (defs.find((d) => d.routed) ?? defs[0])?.text ?? null;
}

const fileCache = new Map();
function read(file) {
  if (fileCache.has(file)) return fileCache.get(file);
  const abs = file.startsWith('modules/') ? join(REPO, file) : join(API_SRC, file);
  const s = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
  fileCache.set(file, s); return s;
}

/** For each route: { key, typed, types } — types = the api-contracts names its handler signature uses. */
export function routeTypes(rs, openapiPath) {
  return rs.map((r) => {
    const src = read(r.file);
    const imported = contractImports(src);
    const sig = imported.size ? signatureOf(src, r.handler) : null;
    const types = sig ? [...imported].filter((n) => new RegExp(`\\b${n}\\b`).test(sig)) : [];
    return { key: `${r.method} ${openapiPath(r.path)}`, typed: types.length > 0, types };
  });
}
