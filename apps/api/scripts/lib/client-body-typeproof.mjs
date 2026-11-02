// client-body-typeproof.mjs — Security Deep Scan §40 (S-A14): ONE project's half of the type-aware strict-bodies proof
// (driver: ../strict-bodies-typeproof.mjs). Usage: node client-body-typeproof.mjs <project> <schemas.json> <out.json>
//   project: an app with a tsconfig (admin-web, customer-display, customer-web, manager-pay-web, owner-web, tech-web, pos-web —
//            each with the shared packages it imports), `packages`, or `js` (the pilot / proof / e2e scripts and the single-file
//            apps' inline <script>s, read as JavaScript).
// For every body-carrying call (x.post|put|patch(path, body), x.upload(path, formData), fn('POST', path, body),
// fetch(url, { method, body: JSON.stringify(b) }), a dispatcher whose path / body are its parameters) it resolves the path
// (literals, consts, templates, URL builders, prefix helpers) to the route and the body to the fields it can carry:
//   - the body's TYPE (TypeScript checker; unions merged, nested objects and array items included);
//   - a parameter -> every caller's argument (the object really passed, wider than the parameter type if it is);
//   - spreads, helper returns (body(x), clean(x) = a subset of x, builders returning literals), JSON.stringify(x),
//     FormData text fields (file parts go to req.files), computed keys of a literal-union type;
//   - `any`, an index signature, a computed `string` key -> OPAQUE (not provable: the route needs a reviewed reason).
// Output: { routes: { "<METHOD> <path>": [{ at, via, keys, undeclared[], opaque[] }] }, unmatched: [...] }.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const ts = createRequire(join(REPO, 'package.json'))('typescript');
const lib = await import('./client-body-calls.mjs');
const [PROJECT, SCHEMAS, OUT] = process.argv.slice(2);
if (!PROJECT || !SCHEMAS || !OUT) { console.error('usage: client-body-typeproof.mjs <project> <schemas.json> <out.json>'); process.exit(2); }
const schemas = JSON.parse(readFileSync(SCHEMAS, 'utf8'));
const routes = Object.entries(schemas).map(([key, schema]) => ({ key, method: key.split(' ')[0], path: key.split(' ')[1], schema }));
const ONLY = [PROJECT];

const clientFiles = lib.clientFiles(REPO);
const APPS_TS = ['admin-web', 'customer-display', 'customer-web', 'manager-pay-web', 'owner-web', 'tech-web', 'pos-web'];

// ---------- projects ----------
function makeLS(rootNames, options, overlay = new Map()) {
  const host = {
    getScriptFileNames: () => rootNames,
    getScriptVersion: (f) => '1',
    getScriptSnapshot: (f) => { const t = overlay.has(f) ? overlay.get(f) : (existsSync(f) ? readFileSync(f, 'utf8') : undefined); return t === undefined ? undefined : ts.ScriptSnapshot.fromString(t); },
    getCurrentDirectory: () => REPO,
    getCompilationSettings: () => options,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: (f) => overlay.has(f) || ts.sys.fileExists(f),
    readFile: (f) => overlay.get(f) ?? ts.sys.readFile(f),
    readDirectory: ts.sys.readDirectory, directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories,
  };
  return ts.createLanguageService(host, ts.createDocumentRegistry());
}
const projects = [];
for (const a of APPS_TS) {
  if (ONLY && !ONLY.includes(a)) continue;
  const cfgPath = join(REPO, 'apps', a, 'tsconfig.json');
  const cfg = ts.getParsedCommandLineOfConfigFile(cfgPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
  projects.push({ name: a, ls: makeLS(cfg.fileNames, { ...cfg.options, noEmit: true }), owns: (f) => f.startsWith(join(REPO, 'apps', a, 'src') + '/') || f.startsWith(REPO + '/packages/') });
}
const pkgFiles = clientFiles.filter((f) => f.startsWith(REPO + '/packages/') && /\.(ts|tsx)$/.test(f));
if (!ONLY || ONLY.includes('packages')) projects.push({ name: 'packages', ls: makeLS(pkgFiles, { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, strict: true, skipLibCheck: true, noEmit: true, allowJs: true, allowImportingTsExtensions: true, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'] }), owns: (f) => f.startsWith(REPO + '/packages/') });
// JS: scripts, single-file apps (inline <script> extracted into a sibling virtual .js at the same line numbers)
const overlay = new Map(); const jsRoots = []; const virt = new Map();
for (const f of clientFiles) {
  if (f.startsWith(REPO + '/packages/')) continue;
  if (APPS_TS.some((a) => f.startsWith(join(REPO, 'apps', a, 'src') + '/'))) continue;
  if (/\.html$/.test(f)) {
    const src = readFileSync(f, 'utf8'); let out = src.replace(/[^\n]/g, ' ');
    for (const m of src.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
      const start = m.index + m[0].indexOf('>') + 1; out = out.slice(0, start) + m[1] + out.slice(start + m[1].length);
    }
    const v = f + '.__inline.js'; overlay.set(v, out); jsRoots.push(v); virt.set(v, f);
  } else jsRoots.push(f);
}
if (!ONLY || ONLY.includes('js')) projects.push({ name: 'js', ls: makeLS(jsRoots, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true, checkJs: false, noEmit: true, skipLibCheck: true, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'] }, overlay), owns: (f) => jsRoots.includes(f) });

// ---------- path evaluation ----------
const U = '\u0000';
function evalPath(node, ck, env, depth = 0) {
  if (!node || depth > 8) return [U];
  node = unwrap(node);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node)) {
    let acc = [node.head.text];
    for (const sp of node.templateSpans) {
      const parts = evalPath(sp.expression, ck, env, depth + 1);
      const next = []; for (const a of acc) for (const p of parts) next.push(a + p + sp.literal.text);
      acc = next.slice(0, 16);
    }
    return acc;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = evalPath(node.left, ck, env, depth + 1), r = evalPath(node.right, ck, env, depth + 1);
    const out = []; for (const a of l) for (const b of r) out.push(a + b); return out.slice(0, 16);
  }
  if (ts.isConditionalExpression(node)) return [...evalPath(node.whenTrue, ck, env, depth + 1), ...evalPath(node.whenFalse, ck, env, depth + 1)].slice(0, 16);
  if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.BarBarToken || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) return [...evalPath(node.left, ck, env, depth + 1), ...evalPath(node.right, ck, env, depth + 1)];
  if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
    if (ts.isIdentifier(node) && env && env.has(node.text)) { const e = env.get(node.text); return e ? evalPath(e.node, ck, e.env, depth + 1) : [U]; }
    const sym = symOf(node, ck); const d = sym?.valueDeclaration ?? sym?.declarations?.[0];
    if (d && (ts.isVariableDeclaration(d) || ts.isPropertyAssignment(d) || ts.isPropertyDeclaration(d)) && d.initializer && (ts.isVariableDeclaration(d) ? (d.parent.flags & ts.NodeFlags.Const) : true)) return evalPath(d.initializer, ck, null, depth + 1);
    const t = ck.getTypeAtLocation(node); if (t.isStringLiteral()) return [t.value];
    return [U];
  }
  if (ts.isCallExpression(node)) {
    const fn = fnDecl(node.expression, ck);
    if (fn) {
      const ret = returnedExpr(fn);
      if (ret) {
        const e2 = new Map(); fn.parameters.forEach((p, i) => { if (ts.isIdentifier(p.name)) e2.set(p.name.text, node.arguments[i] ? { node: node.arguments[i], env } : null); });
        const r = evalPath(ret, ck, e2, depth + 1);
        if (r.some((x) => x.replace(/\u0000/g, '').includes('/'))) return r;
      }
    }
    // a URL builder (apiUrl('/x'), buildApiUrl(base, '/x')): its literal path argument behind an unknown base
    for (const a of node.arguments) { const v = evalPath(a, ck, env, depth + 1); if (v.length && v.every((x) => x.startsWith('/'))) return v.map((x) => U + x); }
    // encodeURIComponent(x), String(x) → one segment
    return [U];
  }
  return [U];
}
function unwrap(n) { while (n && (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isTypeAssertionExpression?.(n) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(n)))) n = n.expression; return n; }
function symOf(node, ck) { let s = node.parent && ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node ? ck.getShorthandAssignmentValueSymbol(node.parent) : ck.getSymbolAtLocation(node); if (s && s.flags & ts.SymbolFlags.Alias) { try { s = ck.getAliasedSymbol(s); } catch {} } return s; }
function fnDecl(expr, ck) {
  const s = symOf(unwrap(expr), ck); const d = s?.valueDeclaration ?? s?.declarations?.[0]; if (!d) return null;
  if (ts.isFunctionDeclaration(d) || ts.isMethodDeclaration(d) || ts.isFunctionExpression(d) || ts.isArrowFunction(d)) return d;
  if ((ts.isVariableDeclaration(d) || ts.isPropertyAssignment(d) || ts.isPropertyDeclaration(d)) && d.initializer && (ts.isArrowFunction(unwrap(d.initializer)) || ts.isFunctionExpression(unwrap(d.initializer)))) return unwrap(d.initializer);
  return null;
}
function returnedExpr(fn) {
  if (!fn.body) return null;
  if (!ts.isBlock(fn.body)) return fn.body;
  const rets = []; const v = (n) => { if (ts.isReturnStatement(n) && n.expression) rets.push(n.expression); if (!ts.isFunctionLike(n)) ts.forEachChild(n, v); }; ts.forEachChild(fn.body, v);
  return rets.length === 1 ? rets[0] : null;
}
function normalize(raw) {
  let r = raw.split('?')[0].replace(/^https?:\/\/[^/]+/, '');
  if (r.startsWith(U)) r = r.replace(/^\u0000+/, '');
  if (!r.startsWith('/')) return null;
  r = r.replace(/^\/api\/v\d+(?=\/)/, '');
  if (/^\/api\/v\d+$/.test(r)) return null;
  const segs = r.split('/').slice(1).map((s) => (s.includes(U) ? '*' : s));
  while (segs.length && segs[segs.length - 1] === '') segs.pop();
  return '/' + segs.join('/');
}

// ---------- body shapes ----------
const PRIM = { prim: true };
const STR = { prim: true, str: true };
function shapeOfType(t, ck, at, depth = 0, seen = new Set()) {
  if (!t) return { open: true, why: 'no type' };
  if (t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return { open: true, why: ck.typeToString(t) };
  if (t.flags & ts.TypeFlags.StringLike) return STR;
  if (t.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.BigIntLike | ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void | ts.TypeFlags.EnumLike | ts.TypeFlags.Never | ts.TypeFlags.ESSymbolLike)) return PRIM;
  if (t.flags & ts.TypeFlags.TypeParameter) { const c = ck.getBaseConstraintOfType(t); return c && c !== t ? shapeOfType(c, ck, at, depth, seen) : { open: true, why: 'generic ' + ck.typeToString(t) }; }
  if (t.isUnion()) {
    const parts = t.types.map((x) => shapeOfType(x, ck, at, depth, seen)).filter((x) => !x.prim);
    if (!parts.length) return PRIM;
    return merge(parts);
  }
  if (depth > 7 || seen.has(t)) return { keys: {}, open: false, cyc: true };
  const name = t.symbol?.name;
  if (name === 'Date' || name === 'Blob' || name === 'File' || name === 'FormData' || name === 'URLSearchParams') return PRIM;
  if (ck.isArrayType(t) || ck.isTupleType(t)) {
    const args = ck.getTypeArguments(t); return { array: args.length ? merge(args.map((x) => shapeOfType(x, ck, at, depth + 1, seen))) : { open: true, why: 'array' } };
  }
  if (t.getCallSignatures().length && !ck.getPropertiesOfType(t).length) return PRIM;   // function: dropped by JSON
  const s2 = new Set(seen); s2.add(t);
  const idx = ck.getIndexInfosOfType(t);
  const shape = { keys: {}, open: false };
  if (idx.length) { shape.open = true; shape.why = 'index signature ' + ck.typeToString(t).slice(0, 80); shape.indexValue = shapeOfType(idx[0].type, ck, at, depth + 1, s2); }
  for (const p of ck.getPropertiesOfType(t)) {
    const pt = ck.getTypeOfSymbolAtLocation(p, at);
    if (pt.getCallSignatures().length && !(pt.flags & ts.TypeFlags.Union)) continue;
    shape.keys[p.name] = shapeOfType(pt, ck, at, depth + 1, s2);
  }
  return shape;
}
function merge(parts) {
  if (parts.length === 1) return parts[0];
  const out = { keys: {}, open: false };
  const arrays = parts.filter((p) => p.array); const objs = parts.filter((p) => p.keys || p.open && !p.array);
  for (const p of objs) { if (p.open) { out.open = true; out.why = p.why; } for (const [k, v] of Object.entries(p.keys ?? {})) out.keys[k] = out.keys[k] ? merge([out.keys[k], v].filter((x) => !x.prim).length ? [out.keys[k], v].filter((x) => !x.prim) : [PRIM]) : v; }
  if (arrays.length && !objs.length) return { array: merge(arrays.map((a) => a.array)) };
  return out;
}

// body expression → list of {shape, via}
function shapesOfExpr(expr, proj, depth = 0, via = []) {
  if (!expr) return [{ shape: { keys: {}, open: false }, via }];
  const ck = proj.ls.getProgram().getTypeChecker();
  expr = unwrap(expr);
  if (ts.isCallExpression(expr) && /JSON\.stringify$/.test(expr.expression.getText())) return shapesOfExpr(expr.arguments[0], proj, depth, via);
  if (ts.isIdentifier(expr) && expr.text === 'undefined') return [{ shape: { keys: {}, open: false }, via }];
  // body: '{}' — a literal JSON string
  if (ts.isStringLiteralLike(expr)) { try { const v = JSON.parse(expr.text); if (v && typeof v === 'object' && !Array.isArray(v)) return [{ shape: { keys: Object.fromEntries(Object.keys(v).map((k) => [k, PRIM])), open: false }, via }]; } catch { /* not JSON */ } }
  if (ts.isIdentifier(expr)) { const s0 = symOf(expr, ck); const d0 = s0?.valueDeclaration; if (d0 && ts.isVariableDeclaration(d0) && d0.initializer && ts.isCallExpression(unwrap(d0.initializer)) && /JSON\.stringify$/.test(unwrap(d0.initializer).expression.getText())) return shapesOfExpr(d0.initializer, proj, depth + 1, via); }
  const t0 = ck.getTypeAtLocation(expr);
  if (t0.symbol?.name === 'FormData') return formDataShapes(expr, proj, depth, via);
  const shape = shapeOfType(t0, ck, expr);
  if (depth > 6) return [{ shape, via }];
  // conditional: both branches
  if (ts.isConditionalExpression(expr)) return [...shapesOfExpr(expr.whenTrue, proj, depth + 1, via), ...shapesOfExpr(expr.whenFalse, proj, depth + 1, via)];
  // an object literal with a spread (or a value) the type system cannot see through: build it syntactically
  if (ts.isObjectLiteralExpression(expr) && shapeHasOpen(shape)) {
    let alts = [{ shape: { keys: {}, open: false }, via }];
    for (const p of expr.properties) {
      if (ts.isSpreadAssignment(p)) {
        const inner = shapesOfExpr(p.expression, proj, depth + 1, []);
        const next = [];
        for (const a of alts) for (const i of inner) {
          if (i.noCaller) continue;
          const s = i.shape.prim ? { keys: {}, open: false } : i.shape;
          next.push({ shape: { keys: { ...a.shape.keys, ...(s.keys ?? {}) }, open: a.shape.open || !!s.open || !!s.array, why: s.open ? s.why : a.shape.why }, via: [...a.via, ...i.via] });
        }
        alts = next.slice(0, 40);
        if (!alts.length) alts = [{ shape: { keys: {}, open: false }, via }];
      } else if (p.name) {
        const k = ts.isComputedPropertyName(p.name) ? null : p.name.getText().replace(/^['"]|['"]$/g, '');
        if (k === null) {
          const kt = ck.getTypeAtLocation(p.name.expression);
          const lits = kt.isUnion() ? kt.types : [kt];
          if (lits.every((x) => x.isStringLiteral())) { for (const a of alts) for (const x of lits) a.shape.keys[x.value] = a.shape.keys[x.value] ?? PRIM; continue; }
          for (const a of alts) { a.shape.open = true; a.shape.why = 'computed key ' + ck.typeToString(kt).slice(0, 60); } continue;
        }
        let vs;
        if (ts.isPropertyAssignment(p)) vs = shapesOfExpr(p.initializer, proj, depth + 1, []);
        else if (ts.isShorthandPropertyAssignment(p)) vs = shapesOfExpr(p.name, proj, depth + 1, []);
        else vs = [{ shape: PRIM, via: [] }];
        const live = vs.filter((x) => !x.noCaller).map((x) => x.shape);
        const v = live.length ? (live.every((x) => x.prim) ? PRIM : merge(live.filter((x) => !x.prim))) : PRIM;
        for (const a of alts) a.shape.keys[k] = v;
      }
    }
    return alts;
  }
  // a call through a helper: `body(x)` returning its parameter, or a builder returning object literals
  if (ts.isCallExpression(expr) && (shapeHasOpen(shape) || shape.str)) {
    const fn = fnDecl(expr.expression, ck);
    if (fn) {
      const rets = []; if (fn.body && !ts.isBlock(fn.body)) rets.push(fn.body); else if (fn.body) { const v = (n) => { if (ts.isReturnStatement(n) && n.expression) rets.push(n.expression); if (!ts.isFunctionLike(n)) ts.forEachChild(n, v); }; ts.forEachChild(fn.body, v); }
      const out = [];
      for (let r of rets) {
        r = unwrap(r);
        // json(b) = JSON.stringify(b ?? {}) — the serialised argument
        if (ts.isCallExpression(r) && /JSON\.stringify$/.test(r.expression.getText()) && r.arguments[0]) r = unwrap(r.arguments[0]);
        if (ts.isBinaryExpression(r) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(r.operatorToken.kind)) r = unwrap(r.left);
        const pi = ts.isIdentifier(r) ? fn.parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === r.text) : -1;
        if (pi >= 0) out.push(...shapesOfExpr(expr.arguments[pi], proj, depth + 1, [...via, 'through ' + fnName(fn)]));
        else if (ts.isCallExpression(r) && /Object\.fromEntries$/.test(r.expression.getText()) && (() => { const s = r.arguments[0]?.getText() ?? ''; const m = /^Object\.entries\(\s*([A-Za-z_$][\w$]*)/.exec(s); return m && fn.parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === m[1]) >= 0; })()) {
          const nm = /^Object\.entries\(\s*([A-Za-z_$][\w$]*)/.exec(r.arguments[0].getText())[1]; const j = fn.parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === nm);
          out.push(...shapesOfExpr(expr.arguments[j], proj, depth + 1, [...via, 'subset of the argument via ' + fnName(fn)]));
        }
        else if (ts.isObjectLiteralExpression(r) && r.properties.length === 1 && ts.isSpreadAssignment(r.properties[0]) && ts.isIdentifier(unwrap(r.properties[0].expression))) {
          const nm = unwrap(r.properties[0].expression).text; const j = fn.parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === nm);
          if (j >= 0) out.push(...shapesOfExpr(expr.arguments[j], proj, depth + 1, [...via, 'through ' + fnName(fn)])); else out.push(...shapesOfExpr(r, proj, depth + 1, [...via, 'returned by ' + fnName(fn)]));
        }
        else out.push(...shapesOfExpr(r, proj, depth + 1, [...via, 'returned by ' + fnName(fn)]));
      }
      if (out.length) return out;
    }
  }
  // a parameter: follow the callers (the runtime objects), up to 4 levels
  if (ts.isIdentifier(expr) && depth < 4) {
    const s = symOf(expr, ck); const d = s?.valueDeclaration;
    if (d && ts.isParameter(d) && ts.isIdentifier(d.name)) {
      const fn = d.parent; const idx = fn.parameters.indexOf(d);
      const callers = callSitesOf(fn, proj);
      if (callers && callers.length) {
        const out = [];
        for (const c of callers) {
          const arg = c.call.arguments[idx];
          if (d.dotDotDotToken) { out.push({ shape: { open: true, why: 'rest param' }, via: [...via, loc(c.call)] }); continue; }
          out.push(...shapesOfExpr(arg, c.proj, depth + 1, [...via, loc(c.call)]));
        }
        return out;
      }
      if (callers && callers.length === 0) return [{ shape, via: [...via, 'no callers of ' + fnName(fn)], noCaller: true }];
      if (!shape.open) return [{ shape, via: [...via, 'declared type (callers not traceable: ' + fnName(fn) + ')'] }];
      return [{ shape, via: [...via, 'callers not traceable: ' + fnName(fn)] }];
    }
    if (d && ts.isVariableDeclaration(d) && d.initializer && shape.open) return shapesOfExpr(d.initializer, proj, depth + 1, via);
  }
  return [{ shape, via }];
}
// multipart: the text fields a FormData carries (file parts go to req.files, never into the validated body)
function formDataShapes(expr, proj, depth, via) {
  const ck = proj.ls.getProgram().getTypeChecker();
  if (ts.isCallExpression(expr)) {   // form(f, names) building and returning a FormData
    const fn = fnDecl(expr.expression, ck); const ret = fn && returnedExpr(fn);
    if (ret && ts.isIdentifier(unwrap(ret))) return formDataShapes(unwrap(ret), proj, depth + 1, [...via, 'built by ' + fnName(fn)]);
  }
  const s = ts.isIdentifier(expr) ? symOf(expr, ck) : null; const d = s?.valueDeclaration;
  if (!d) return [{ shape: { keys: {}, open: true, why: 'FormData not traceable' }, via }];
  if (ts.isParameter(d)) return [{ shape: { keys: {}, open: true, why: 'FormData parameter' }, via }];
  let scope = d; while (scope && !ts.isFunctionLike(scope) && !ts.isSourceFile(scope)) scope = scope.parent;
  let alts = [{ shape: { keys: {}, open: false }, via: [...via, 'FormData fields'] }];
  const visit = (n) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ['append', 'set'].includes(n.expression.name.text) && symOf(n.expression.expression, ck) === s && n.arguments.length >= 2) {
      const k = unwrap(n.arguments[0]); const vt = ck.getTypeAtLocation(n.arguments[1]); const vn = vt.symbol?.name;
      const isFile = vn === 'File' || vn === 'Blob' || (vt.isUnion() && vt.types.some((x) => ['File', 'Blob'].includes(x.symbol?.name)));
      const blobCtor = ts.isNewExpression(unwrap(n.arguments[1])) && /^(Blob|File)$/.test(unwrap(n.arguments[1]).expression.getText());
      if (isFile || blobCtor || n.arguments.length >= 3) { /* a file part (a third argument is a file name): req.files, not the body */ }
      else if (ts.isStringLiteralLike(k)) { for (const a of alts) a.shape.keys[k.text] = STR; }
      else {
        // Object.entries(meta).forEach(([k, v]) => f.append(k, …)) → meta's keys
        let up = n.parent; let src = null;
        while (up && up !== scope) { if (ts.isCallExpression(up) && ts.isPropertyAccessExpression(up.expression) && ts.isCallExpression(up.expression.expression) && /Object\.entries$/.test(up.expression.expression.expression.getText())) { src = up.expression.expression.arguments[0]; break; } up = up.parent; }
        if (!src) { for (const a of alts) { a.shape.open = true; a.shape.why = 'computed FormData key'; } }
        else { const inner = shapesOfExpr(src, proj, depth + 1, []); const next = []; for (const a of alts) for (const i of inner) { if (i.noCaller) continue; next.push({ shape: { keys: { ...a.shape.keys, ...(i.shape.keys ?? {}) }, open: a.shape.open || !!i.shape.open, why: i.shape.why }, via: [...a.via, ...i.via] }); } alts = next.length ? next.slice(0, 40) : alts; }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(scope);
  return alts;
}
function shapeHasOpen(s, d = 0) { if (!s || d > 6) return false; if (s.open) return true; if (s.array) return shapeHasOpen(s.array, d + 1); return Object.values(s.keys ?? {}).some((v) => shapeHasOpen(v, d + 1)); }
function fnName(fn) { const n = fn.name ?? (fn.parent && (ts.isVariableDeclaration(fn.parent) || ts.isPropertyAssignment(fn.parent) || ts.isPropertyDeclaration(fn.parent)) ? fn.parent.name : null); return n ? n.getText() : '<anon>@' + loc(fn); }
function loc(n) { const sf = n.getSourceFile(); const f = virt.get(sf.fileName) ?? sf.fileName; return relative(REPO, f) + ':' + (sf.getLineAndCharacterOfPosition(n.getStart()).line + 1); }
// all call sites (in any project) of a function declaration; null when it escapes as a value
function callSitesOf(fn, proj) {
  let nameNode = fn.name;
  if (!nameNode && fn.parent && (ts.isVariableDeclaration(fn.parent) || ts.isPropertyAssignment(fn.parent) || ts.isPropertyDeclaration(fn.parent))) nameNode = fn.parent.name;
  if (!nameNode) {
    // inline callback: `xs.map((x) => api.post(p, x))`, `onSave={(b) => …}` — not traceable
    return null;
  }
  const out = []; let escaped = false;
  const sf = nameNode.getSourceFile();
  const refsPerProj = [];
  for (const p of projects) {
    const prog = p.ls.getProgram();
    if (!prog.getSourceFile(sf.fileName)) continue;
    let refs; try { refs = p.ls.getReferencesAtPosition(sf.fileName, nameNode.getStart()); } catch { refs = null; }
    for (const r of refs ?? []) {
      const rsf = prog.getSourceFile(r.fileName); if (!rsf) continue;
      if (/\.(test|spec)\.|vitest|__tests__/.test(r.fileName)) continue;
      const node = findNode(rsf, r.textSpan.start);
      if (!node) continue;
      if (node === nameNode || (node.parent === nameNode.parent && node.pos === nameNode.pos)) continue;
      let up = node.parent;
      if (up && ts.isPropertyAccessExpression(up) && up.name === node) { const call = up.parent; if (call && ts.isCallExpression(call) && call.expression === up) { out.push({ call, proj: p }); continue; } }
      if (up && ts.isCallExpression(up) && up.expression === node) { out.push({ call: up, proj: p }); continue; }
      if (up && (ts.isImportSpecifier(up) || ts.isExportSpecifier(up) || ts.isImportClause(up) || ts.isShorthandPropertyAssignment(up) && false)) continue;
      if (up && ts.isShorthandPropertyAssignment(up)) continue; // re-export via object literal: references continue through the property
      if (up && ts.isPropertyAssignment(up) && up.name === node) continue;
      if (up && ts.isVariableDeclaration(up) && up.name === node) continue;
      if (up && ts.isTypeQueryNode?.(up)) continue;
      if (up && ts.isQualifiedName(up)) continue;
      if (/\.d\.ts$/.test(r.fileName)) continue;
      escaped = true; refsPerProj.push(loc(node));
    }
  }
  // dedupe same call seen from several projects
  const seen = new Set(); const uniq = out.filter((c) => { const k = loc(c.call) + c.call.getStart(); if (seen.has(k)) return false; seen.add(k); return true; });
  if (escaped) { uniq.escaped = refsPerProj; }
  return escaped && !uniq.length ? null : uniq;
}
function findNode(sf, pos) { let found = null; const v = (n) => { if (pos >= n.getStart(sf) && pos < n.getEnd()) { if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n) || ts.isStringLiteral(n)) found = n; ts.forEachChild(n, v); } }; v(sf); return found; }

// ---------- call detection ----------
const BODY_METHODS = new Set(['post', 'put', 'patch']);
function detect(sf, proj, out) {
  const ck = proj.ls.getProgram().getTypeChecker();
  const v = (n) => {
    if (ts.isCallExpression(n)) {
      const a = n.arguments; let method = null, pathE = null, bodyE, kind = '';
      const callee = n.expression;
      const nm = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : '';
      if (nm === 'upload' && a.length >= 2 && ts.isPropertyAccessExpression(callee)) { method = 'POST'; pathE = a[0]; bodyE = a[1]; kind = 'u'; }
      else if (BODY_METHODS.has(nm) && a.length >= 1 && ts.isPropertyAccessExpression(callee)) { method = nm.toUpperCase(); pathE = a[0]; bodyE = a[1]; kind = 'm'; }
      else if (/^(api|http|request|req|json|send|fetch)?(Post|Put|Patch)(Json)?$|^(post|put|patch)(Json|JSON|Api)$/.test(nm) && a.length >= 1) { method = /post/i.test(nm) ? 'POST' : /put/i.test(nm) ? 'PUT' : 'PATCH'; pathE = a[0]; bodyE = a[1]; kind = 'n'; }
      else if (a.length >= 2 && ts.isStringLiteralLike(unwrap(a[0])) && /^(POST|PUT|PATCH)$/.test(unwrap(a[0]).text)) { method = unwrap(a[0]).text; pathE = a[1]; bodyE = a[2]; kind = 'f'; }
      else {
        // fetch(url, { method: 'POST', body }) / x({ method, url, data })
        for (let i = 0; i < a.length; i++) {
          const o = unwrap(a[i]); if (!ts.isObjectLiteralExpression(o)) continue;
          const prop = (k) => o.properties.find((p) => p.name && p.name.getText().replace(/['"]/g, '') === k) ?? spreadProp(o, k);
          const m = prop('method'); if (!m) continue;
          let mv = null;
          if (ts.isPropertyAssignment(m)) { const ev = evalPath(m.initializer, ck, null); mv = ev.find((x) => /^(POST|PUT|PATCH)$/i.test(x)); }
          if (!mv) continue;
          method = mv.toUpperCase();
          const bp = prop('body') ?? prop('data') ?? prop('json');
          bodyE = bp ? (ts.isPropertyAssignment(bp) ? bp.initializer : ts.isShorthandPropertyAssignment(bp) ? bp.name : null) : undefined;
          const up = prop('url') ?? prop('path');
          pathE = up && ts.isPropertyAssignment(up) ? up.initializer : (i > 0 ? a[0] : null); kind = 'o';
          break;
        }
      }
      if (method && pathE && bodyE && kind === 'm' && /request$/.test(callee.expression.getText())) { const o = unwrap(bodyE); if (ts.isObjectLiteralExpression(o)) { const dp = o.properties.find((p) => p.name && p.name.getText() === 'data'); bodyE = dp ? (ts.isPropertyAssignment(dp) ? dp.initializer : dp.name) : undefined; } }
      else if (method && pathE && bodyE) bodyE = unwrapInit(bodyE);
      if (method && pathE) {
        const paths = [...new Set(evalPath(pathE, ck, null).map(normalize))];
        out.push({ node: n, proj, method, paths, pathText: pathE.getText().slice(0, 100), pathNode: pathE, bodyE, kind, at: loc(n) });
      }
    }
    ts.forEachChild(n, v);
  };
  v(sf);
}

// `...(cond ? { body: x } : {})` inside an init object
function spreadProp(o, k) {
  for (const p of o.properties) {
    if (!ts.isSpreadAssignment(p)) continue;
    const e = unwrap(p.expression);
    const alts = ts.isConditionalExpression(e) ? [unwrap(e.whenTrue), unwrap(e.whenFalse)] : ts.isBinaryExpression(e) ? [unwrap(e.right)] : [e];
    for (const a of alts) if (ts.isObjectLiteralExpression(a)) { const f = a.properties.find((q) => q.name && q.name.getText().replace(/['"]/g, '') === k); if (f) return f; }
  }
  return undefined;
}
const INIT_KEYS = new Set(['body', 'data', 'json', 'headers', 'query', 'params', 'signal', 'timeout', 'idempotencyKey', 'credentials', 'failOnStatusCode', 'maxRedirects', 'retry', 'cache', 'keepalive', 'mode']);
function unwrapInit(b) {
  const o = unwrap(b); if (!ts.isObjectLiteralExpression(o)) return b;
  const names = o.properties.map((p) => (p.name ? p.name.getText().replace(/['"]/g, '') : null));
  if (names.some((n) => n === null || !INIT_KEYS.has(n))) return b;
  const bp = o.properties.find((p) => ['body', 'data', 'json'].includes(p.name.getText().replace(/['"]/g, '')));
  if (!bp || !names.some((n) => ['headers', 'query', 'params', 'signal', 'timeout', 'failOnStatusCode', 'idempotencyKey', 'credentials'].includes(n))) return b;
  return ts.isPropertyAssignment(bp) ? bp.initializer : bp.name;
}
const calls = [];
for (const p of projects) {
  const prog = p.ls.getProgram();
  for (const sf of prog.getSourceFiles()) {
    const f = sf.fileName; const real = virt.get(f) ?? f;
    if (!p.owns(f) || !clientFiles.includes(real)) continue;
    detect(sf, p, calls);
  }
  process.stderr.write(`${p.name}: ${calls.length} calls\n`);
}

// ---------- route matching + comparison ----------
function schemaProps(s) {
  if (!s || typeof s !== 'object') return null;
  if (s.anyOf && !s.properties) { const ps = s.anyOf.filter((x) => x && (x.properties || x.additionalProperties !== undefined)); if (!ps.length) return null; return { properties: Object.assign({}, ...ps.map((x) => x.properties ?? {})), additionalProperties: ps.some((x) => x.additionalProperties === true) ? true : ps.find((x) => typeof x.additionalProperties === 'object')?.additionalProperties, items: undefined }; }
  return s;
}
function compare(schema, shape, path, out) {
  if (!shape || shape.prim || !schema) return;
  if (schema['x-strict'] === false) return;
  if (shape.array) {
    const s = schemaProps(schema); const items = s?.items ?? schema.items ?? (schema.anyOf ?? []).find((x) => x && x.items)?.items;
    if (items) compare(items, shape.array, path + '[]', out);
    return;
  }
  const s = schemaProps(schema);
  if (!s) return;
  const isObj = s.properties || s.additionalProperties !== undefined || s.type === 'object' || (Array.isArray(s.type) && s.type.includes('object'));
  if (!isObj) return;
  if (s.additionalProperties === true) return;
  const props = s.properties ?? {};
  if (shape.open && typeof s.additionalProperties === 'object' && shape.indexValue) compare(s.additionalProperties, shape.indexValue, (path || '') + '[*]', out);
  else if (shape.open && typeof s.additionalProperties === 'object') { /* every extra key is validated by additionalProperties, never refused as unknown */ }
  else if (shape.open) out.opaque.push((path || '(body)') + ' — ' + (shape.why ?? 'open'));
  for (const [k, v] of Object.entries(shape.keys ?? {})) {
    if (Object.prototype.hasOwnProperty.call(props, k)) compare(props[k], v, path ? path + '.' + k : k, out);
    else if (typeof s.additionalProperties === 'object') compare(s.additionalProperties, v, path ? path + '.' + k : k, out);
    else out.undeclared.push(path ? path + '.' + k : k);
  }
}

// a call whose path is a parameter of its enclosing function (a generic dispatcher): evaluate per caller of that function
function enclosingFn(n) { for (let p = n.parent; p; p = p.parent) if (ts.isFunctionLike(p) && p.parameters) return p; return null; }
function substitute(expr, fn, call) {
  // returns the caller-side node for `param` or `param.prop`, or null
  let e = unwrap(expr);
  if (ts.isCallExpression(e) && /JSON\.stringify$/.test(e.expression.getText()) && e.arguments[0]) e = unwrap(e.arguments[0]);
  const idx = (name) => fn.parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === name);
  if (ts.isIdentifier(e)) { const i = idx(e.text); if (i >= 0) return call.arguments[i] ?? null; for (const [pi, p] of fn.parameters.entries()) if (ts.isObjectBindingPattern(p.name)) for (const el of p.name.elements) if (el.name.getText() === e.text) { const a = call.arguments[pi] && unwrap(call.arguments[pi]); if (a && ts.isObjectLiteralExpression(a)) { const pr = a.properties.find((q) => q.name && q.name.getText() === (el.propertyName ?? el.name).getText()); if (pr) return ts.isPropertyAssignment(pr) ? pr.initializer : pr.name; } return null; } return undefined; }
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) {
    const i = idx(e.expression.text); if (i < 0) return undefined;
    const a = call.arguments[i] && unwrap(call.arguments[i]);
    if (a && ts.isObjectLiteralExpression(a)) { const pr = a.properties.find((q) => q.name && q.name.getText() === e.name.text); if (pr) return ts.isPropertyAssignment(pr) ? pr.initializer : pr.name; return null; }
    return null;
  }
  return undefined;
}
const extra = [];
function refsParam(node, fn) { const names = new Set(fn.parameters.filter((p) => ts.isIdentifier(p.name)).map((p) => p.name.text)); let hit = false; const v = (n) => { if (ts.isIdentifier(n) && names.has(n.text)) hit = true; ts.forEachChild(n, v); }; v(node); return hit; }
for (const c of calls) {
  const fn = enclosingFn(c.node); if (!fn) continue;
  if (c.paths.some(Boolean) && !(c.pathNode && refsParam(c.pathNode, fn) && !c.paths.some((p) => p && routes.some((r) => r.method === c.method && lib.pathMatches(p, r.path))))) continue;
  const fname = fnName(fn);
  if (/^(post|put|patch|del|get|request|send|raw|call)$/i.test(fname.split('.').pop())) continue;   // transport methods: their callers are detected directly
  const callers = callSitesOf(fn, c.proj);
  if (!callers) { c.untraced = 'callers not traceable: ' + fname; continue; }
  for (const k of callers) {
    const ck = k.proj.ls.getProgram().getTypeChecker();
    const pe = c.pathNode;
    if (!pe) continue;
    const env = new Map(); fn.parameters.forEach((p, i) => { if (ts.isIdentifier(p.name)) env.set(p.name.text, k.call.arguments[i] ? { node: k.call.arguments[i], env: null } : null); });
    const pnode = substitute(pe, fn, k.call);
    const paths = [...new Set((pnode ? evalPath(pnode, ck, null) : evalPath(pe, ck, env)).map(normalize))];
    if (!paths.some(Boolean)) continue;
    let bodyNode = c.bodyE, bodyProj = c.proj;
    if (c.bodyE) { const b = substitute(c.bodyE, fn, k.call); if (b !== undefined) { bodyNode = b; bodyProj = k.proj; } }
    extra.push({ node: k.call, proj: bodyProj, method: c.method, paths, pathText: (pnode ?? pe).getText().slice(0, 100), bodyE: bodyNode ?? undefined, kind: 'd', at: loc(k.call) + ' via ' + c.at });
  }
}
calls.push(...extra);
process.stderr.write(`dispatcher-derived calls: ${extra.length}\n`);

const byRoute = new Map();
const unmatched = [];
for (const c of calls) {
  const targets = new Set();
  for (const p of c.paths) {
    if (!p) continue;
    const cands = routes.filter((r) => r.method === c.method && lib.pathMatches(p, r.path));
    if (!cands.length) continue;
    const best = Math.max(...cands.map((r) => lib.matchScore(p, r.path)));
    for (const r of cands) if (lib.matchScore(p, r.path) === best) targets.add(r);
  }
  if (!targets.size) {
    // a helper that prefixes a base: '/session/*/x' inside a file that names '/go-check-in' → '/go-check-in/session/:id/x'
    const text = c.node.getSourceFile().text;
    for (const p of c.paths) {
      if (!p || p.split('/').filter((s) => s && s !== '*').length < 1) continue;
      const tail = p.split('/').slice(1);
      for (const r of routes) {
        if (r.method !== c.method) continue;
        const rs = r.path.split('/').slice(1); if (rs.length <= tail.length) continue;
        const rt = rs.slice(rs.length - tail.length);
        if (!lib.pathMatches('/' + tail.join('/'), '/' + rt.join('/'))) continue;
        if (tail.some((s, i) => s !== '*' && rt[i].startsWith(':'))) continue;   // a suffix match pairs literal with literal
        const prefix = '/' + rs.slice(0, rs.length - tail.length).join('/');
        if (prefix.includes(':')) { const lit = prefix.split('/:')[0]; if (lit.length > 3 && text.includes(lit + '/')) targets.add(r); }
        else if (text.includes(prefix + "'") || text.includes(prefix + '`') || text.includes(prefix + '"') || text.includes(prefix + '/') || text.includes(prefix + '${')) targets.add(r);
      }
    }
    // several prefixes in the file: keep the one the calling helper's own source names (devDisplay → '/customer-display/device')
    if (targets.size > 1) {
      const fn = fnDecl(c.node.expression, c.proj.ls.getProgram().getTypeChecker()); const ftext = fn ? fn.getText() : '';
      const named = [...targets].filter((r) => { const tail = c.paths.find(Boolean)?.split('/').length - 1 || 0; const rs = r.path.split('/').slice(1); const pre = '/' + rs.slice(0, rs.length - tail).join('/'); const lit = pre.split('/:')[0]; return lit.length > 3 && ftext.includes(lit); });
      if (named.length) { targets.clear(); for (const r of named) targets.add(r); }
    }
    if (targets.size) c.suffix = true;
  }
  if (!targets.size) { unmatched.push(c); continue; }
  const shapes = shapesOfExpr(c.bodyE, c.proj);
  for (const r of targets) {
    if (!byRoute.has(r.key)) byRoute.set(r.key, []);
    for (const sh of shapes) {
      const res = { undeclared: [], opaque: [] };
      if (sh.noCaller) { byRoute.get(r.key).push({ at: c.at, via: sh.via, noCaller: true, undeclared: [], opaque: [] }); continue; }
      if (sh.shape.str) res.opaque.push('(body) — a pre-serialized string');
      compare(r.schema, sh.shape, '', res);
      byRoute.get(r.key).push({ at: c.at + (c.suffix ? ' (suffix match)' : ''), via: sh.via, keys: sh.shape.keys ? Object.keys(sh.shape.keys) : sh.shape.array ? '[array]' : sh.shape.prim ? '(primitive)' : '?', ...res });
    }
  }
}
const result = {};
for (const [k, v] of byRoute) result[k] = v;
writeFileSync(OUT, JSON.stringify({ routes: result, unmatched: unmatched.map((c) => ({ at: c.at, method: c.method, paths: c.paths, pathText: c.pathText })) }, null, 1));
process.stderr.write(`calls ${calls.length}, routes reached ${byRoute.size}, unmatched ${unmatched.length}\n`);
