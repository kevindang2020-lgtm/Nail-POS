// resolve hook: extensionless relative imports → .ts; @aipowersalon/<pkg>[/sub] → packages/<pkg>/src[/sub](/index).ts;
// anything listed in STUBS → a stub module; 'vitest' → the mini shim.
import { existsSync, statSync, readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
const ROOT = process.env.REPO_ROOT;
const HERE = dirname(fileURLToPath(import.meta.url));
const STUBS = JSON.parse(process.env.STUBS || '{}');
const tryTs = (p) => { for (const c of [p, p + '.ts', p + '/index.ts']) if (existsSync(c) && statSync(c).isFile()) return c; return null; };
/** blank out decorators (@Capitalized, with balanced (...) args) so Node's parser can check the rest of the file */
function undecorate(src) {
  let out = '', i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '@' && /[A-Z]/.test(src[i + 1] ?? '') && /[\s(,]/.test(src[i - 1] ?? '\n')) {
      let j = i + 1; while (/[\w.]/.test(src[j] ?? '')) j++;
      if (src[j] === '(') { let d = 0; do { if (src[j] === '(') d++; else if (src[j] === ')') d--; j++; } while (d > 0 && j < src.length); }
      out += src.slice(i, j).replace(/[^\n]/g, ' '); i = j; continue;
    }
    out += c; i++;
  }
  return out;
}

function namesWanted(spec, parentURL) {
    const src = readFileSync(fileURLToPath(parentURL), 'utf8'); const names = new Set(); let dflt = false;
    const esc = spec.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    for (const m of src.matchAll(new RegExp(`import\\s+(type\\s+)?([\\w$]+\\s*,\\s*)?(\\{[^}]*\\}|\\*\\s+as\\s+\\w+|[\\w$]+)\\s*from\\s*['"]${esc}['"]`, 'g'))) {
      if (m[1]) continue; if (m[2]) dflt = true;
      if (m[3].startsWith('{')) for (const part of m[3].slice(1, -1).split(',')) { const t = part.trim(); if (!t || t.startsWith('type ')) continue; names.add(t.split(/\s+as\s+/)[0].trim()); }
      else if (!m[3].startsWith('*')) dflt = true;
    }
    for (const m of src.matchAll(new RegExp(`export\\s*\\{([^}]*)\\}\\s*from\\s*['"]${esc}['"]`, 'g'))) for (const part of m[1].split(',')) { const t = part.trim(); if (t && !t.startsWith('type ')) names.add(t.split(/\s+as\s+/)[0].trim()); }
    return { names, dflt };
}
export async function resolve(spec, ctx, next) {
  if (spec === 'vitest') return { url: pathToFileURL(join(HERE, 'vitest-shim.mjs')).href, shortCircuit: true };
  const FIXED = { '@nestjs/common': 'nest-common.mjs', '@nestjs/core': 'nest-core.mjs', 'reflect-metadata': 'reflect-metadata.mjs', rxjs: 'rxjs.mjs', 'rxjs/operators': 'rxjs.mjs', pg: 'pg.mjs' };
  if (spec === 'kysely') FIXED.kysely = 'kysely.mjs';
  if (spec === '@electric-sql/pglite') return { url: pathToFileURL(join(HERE, '..', 'pg-standin', 'pglite.mjs')).href, shortCircuit: true };
  if (spec.startsWith('@electric-sql/pglite/')) return { url: pathToFileURL(join(HERE, '..', 'pg-standin', 'contrib.mjs')).href, shortCircuit: true };
  if (FIXED[spec]) {
    const stubUrl = pathToFileURL(join(HERE, 'stubs', FIXED[spec])).href;
    if (!ctx.parentURL?.startsWith('file:')) return { url: stubUrl, shortCircuit: true };
    const have = new Set(Object.keys(await import(stubUrl)));
    const { names } = namesWanted(spec, ctx.parentURL); const extra = [...names].filter((n) => !have.has(n));
    if (!extra.length) return { url: stubUrl, shortCircuit: true };
    const body = `export * from ${JSON.stringify(stubUrl)};\nconst A = new Proxy(function(){}, { get: (t, k) => k === 'then' ? undefined : A, apply: () => A, construct: () => A });\n` + extra.map((n) => `export const ${n} = A;`).join('\n');
    return { url: 'data:text/javascript,' + encodeURIComponent(body), shortCircuit: true };
  }
  if (STUBS[spec] !== undefined) return { url: 'data:text/javascript,' + encodeURIComponent(STUBS[spec]), shortCircuit: true };
  if (spec.startsWith('@aipowersalon/')) {
    const [, pkg, ...rest] = spec.split('/');
    const f = tryTs(join(ROOT, 'packages', pkg, 'src', ...rest)) ?? tryTs(join(ROOT, 'modules', pkg, 'src', ...rest));
    if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
  }
  if ((spec.startsWith('./') || spec.startsWith('../')) && ctx.parentURL?.startsWith('file:')) {
    const f = tryTs(join(dirname(fileURLToPath(ctx.parentURL)), spec));
    if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
  }
  try { return await next(spec, ctx); }
  catch (e) {
    if (e?.code !== 'ERR_MODULE_NOT_FOUND' || spec.startsWith('.') || spec.startsWith('/') || !ctx.parentURL?.startsWith('file:')) throw e;
    // AUTO-STUB an absent package: export exactly the names the importer asks for, each an inert recursive proxy
    const { names, dflt } = namesWanted(spec, ctx.parentURL);
    const body = `const A = new Proxy(function(){}, { get: (t, k) => k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : A, apply: () => A, construct: () => A });\n`
      + [...names].map((n) => `export const ${n} = A;`).join('\n') + (dflt ? '\nexport default A;' : '');
    (globalThis.__autoStubbed ??= new Set()).add(spec);
    return { url: 'data:text/javascript,' + encodeURIComponent(body + `\n// ${spec} ${Math.random()}`), shortCircuit: true };
  }
}
/** Is `name` only a TYPE in the module at `file` (following `export *` / `export { } from` barrels)? TypeScript elides such
 *  imports; Node's stripper keeps them, and ESM then fails on a name the module does not export. */
const typeCache = new Map();
function typeOnly(file, name, depth = 0) {
  const key = file + '#' + name; if (typeCache.has(key)) return typeCache.get(key);
  let src; try { src = readFileSync(file, 'utf8'); } catch { return false; }
  const n = name.replace(/[$]/g, '\\$');
  let r = null;
  if (new RegExp(`export\\s+(declare\\s+)?(const|let|var|function|async\\s+function|class|abstract\\s+class|enum|const\\s+enum)\\s+${n}\\b`).test(src)) r = false;
  else if (new RegExp(`export\\s+(declare\\s+)?(interface|type)\\s+${n}\\b`).test(src)) r = true;
  if (r === null) for (const m of src.matchAll(/export\s*(type\s*)?\{([^}]*)\}\s*(?:from\s*['"]([^'"]+)['"])?/g)) {
    for (const part of m[2].split(',')) { const t = part.trim(); const [orig, alias] = t.replace(/^type\s+/, '').split(/\s+as\s+/).map((x) => x.trim()); if ((alias ?? orig) !== name) continue;
      if (m[1] || t.startsWith('type ')) { r = true; break; }
      if (m[3] && (m[3].startsWith('.')) && depth < 8) { const f = tryTs(join(dirname(file), m[3])); r = f ? typeOnly(f, orig, depth + 1) : false; } else r = false; break; }
    if (r !== null) break;
  }
  if (r === null && depth < 8) for (const m of src.matchAll(/export\s*\*\s*from\s*['"](\.[^'"]+)['"]/g)) { const f = tryTs(join(dirname(file), m[1])); if (f && typeOnly(f, name, depth + 1)) { r = true; break; } }
  typeCache.set(key, r ?? false); return r ?? false;
}
function dropTypeImports(src, file) {
  return src.replace(/(import|export)\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\3/g, (all, kw, list, q, spec) => {
    let target = null;
    if (spec.startsWith('.')) target = tryTs(join(dirname(file), spec));
    else if (spec.startsWith('@aipowersalon/')) { const [, pkg, ...rest] = spec.split('/'); target = tryTs(join(ROOT, 'packages', pkg, 'src', ...rest)) ?? tryTs(join(ROOT, 'modules', pkg, 'src', ...rest)); }
    if (!target) return all;
    const kept = list.split(',').map((x) => x.trim()).filter(Boolean).filter((t) => t.startsWith('type ') || !typeOnly(target, t.split(/\s+as\s+/)[0].trim()));
    return `${kw} { ${kept.join(', ')} } from ${q}${spec}${q}`;
  });
}
export async function load(url, ctx, next) {
  if (url.endsWith('.ts')) {
    const file = fileURLToPath(url);
    const src = dropTypeImports(undecorate(readFileSync(file, 'utf8')), file);
    let js = stripTypeScriptTypes(src, { mode: 'transform', sourceMap: false });
    if (/\brequire\(|__dirname|__filename/.test(js) && !/\b(const|let|var)\s+(require|__dirname)\b/.test(js))
      js = `import { createRequire as __cr } from 'node:module'; import { dirname as __dn } from 'node:path'; const require = __cr(${JSON.stringify(url)}); const __filename = ${JSON.stringify(file)}; const __dirname = __dn(__filename);\n` + js;
    return { format: 'module', source: js, shortCircuit: true };
  }
  return next(url, ctx);
}
