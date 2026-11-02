// list-handlers.mjs — BUILD_PLAN Phase 12 (Constitution 5 §47–§52): the static view of every list / query endpoint, shared
// by check:list-queries (scripts/check-list-queries.mjs) and its spec.
//
// A "list handler" is a registered GET handler that reads query parameters — `@Query()`, `@Query('x')`, or `req.query`
// through its `@Req()` argument. (A GET with no query parameters cannot be filtered, sorted or ranged; it is either one
// resource or a fixed list.) For each one this reads, with the TypeScript AST:
//   - the query parameter names the handler reads — directly, through destructuring, and through the helper functions
//     and injected services it hands the query object to (same file, relative imports and `this.<svc>.<method>(q)` with
//     the service's constructor type resolved through its import) — or `opaque` when the object escapes analysis;
//   - the ListQuerySpec it declares — `@ListQuery({...})` on the method or `@ListQueries(MAP)` on the class — evaluated
//     statically (object / array literals, same-file and relatively-imported consts, spreads, `as const` / `satisfies`).
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const HERE = dirname(fileURLToPath(import.meta.url));
export const API = resolve(HERE, '..', '..');
export const REPO = resolve(API, '..', '..');

const sfCache = new Map();
export function sourceFile(file) {
  const abs = file.startsWith('/') ? file : join(REPO, file);
  if (!sfCache.has(abs)) sfCache.set(abs, existsSync(abs) ? ts.createSourceFile(abs, readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true) : null);
  return sfCache.get(abs);
}

function resolveModule(fromFile, spec) {
  if (spec.startsWith('.')) {
    const base = resolve(dirname(fromFile), spec);
    for (const c of [base + '.ts', join(base, 'index.ts'), base]) if (existsSync(c) && c.endsWith('.ts')) return c;
    return null;
  }
  const m = /^@aipowersalon\/([a-z-]+)$/.exec(spec);
  if (m) for (const root of ['modules', 'packages']) { const c = join(REPO, root, m[1], 'src', 'index.ts'); if (existsSync(c)) return c; }
  return null;
}

/** Find a top-level declaration (function / const / class) by name in a file, following `export … from` re-exports. */
function findDecl(file, name, seen = new Set()) {
  const key = file + '#' + name;
  if (seen.has(key)) return null; seen.add(key);
  const sf = sourceFile(file); if (!sf) return null;
  for (const st of sf.statements) {
    if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name?.text === name) return { file, node: st };
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === name) return { file, node: d };
  }
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && st.importClause?.namedBindings && ts.isNamedImports(st.importClause.namedBindings)) {
      for (const el of st.importClause.namedBindings.elements) if (el.name.text === name) {
        const tgt = resolveModule(file, st.moduleSpecifier.text); if (tgt) return findDecl(tgt, (el.propertyName ?? el.name).text, seen);
      }
    }
    if (ts.isExportDeclaration(st) && st.moduleSpecifier) {
      const tgt = resolveModule(file, st.moduleSpecifier.text); if (!tgt) continue;
      if (!st.exportClause) { const r = findDecl(tgt, name, seen); if (r) return r; }
      else if (ts.isNamedExports(st.exportClause)) for (const el of st.exportClause.elements) if (el.name.text === name) return findDecl(tgt, (el.propertyName ?? el.name).text, seen);
    }
  }
  return null;
}

function findClass(file, name) {
  const sf = sourceFile(file); if (!sf) return null;
  let out = null;
  const visit = (n) => { if (out) return; if (ts.isClassDeclaration(n) && n.name?.text === name) out = n; else ts.forEachChild(n, visit); };
  visit(sf); return out;
}
const methodOf = (cls, name) => cls?.members.find((m) => (ts.isMethodDeclaration(m) || ts.isPropertyDeclaration(m)) && m.name && ts.isIdentifier(m.name) && m.name.text === name);
const decoratorsOf = (node) => (ts.canHaveDecorators?.(node) ? ts.getDecorators(node) ?? [] : node.decorators ?? []);
const decoName = (d) => { const e = d.expression; return ts.isCallExpression(e) ? e.expression.getText() : e.getText(); };

/** The service class a `this.<prop>` refers to: the constructor parameter's declared type, resolved through imports. */
function memberClass(file, cls, prop) {
  const ctor = cls.members.find((m) => ts.isConstructorDeclaration(m));
  let typeName = null;
  for (const p of ctor?.parameters ?? []) if (ts.isIdentifier(p.name) && p.name.text === prop && p.type && ts.isTypeReferenceNode(p.type)) typeName = p.type.typeName.getText();
  if (!typeName) for (const m of cls.members) if (ts.isPropertyDeclaration(m) && m.name?.getText() === prop && m.type && ts.isTypeReferenceNode(m.type)) typeName = m.type.typeName.getText();
  if (!typeName) return null;
  const d = findDecl(file, typeName);
  return d && ts.isClassDeclaration(d.node) ? d : null;
}

function paramNamesFromBinding(b, out) {
  for (const el of b.elements) {
    if (el.dotDotDotToken) return false;
    const key = el.propertyName ? el.propertyName.getText().replace(/^['"]|['"]$/g, '') : el.name.getText();
    out.add(key);
  }
  return true;
}

/**
 * The property names read from identifier `id` inside `body` (a function-like node). Follows calls that pass `id`
 * along. Returns { names:Set, opaque:boolean }.
 */
function readsOf(ctx, fnNode, id, depth) {
  const names = new Set(); let opaque = false;
  const body = fnNode.body; if (!body) return { names, opaque: true };
  const aliases = new Set([id]);
  const visit = (n) => {
    // q.x / q?.x
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && aliases.has(n.expression.text)) { names.add(n.name.text); return; }
    if (ts.isElementAccessExpression(n) && ts.isIdentifier(n.expression) && aliases.has(n.expression.text)) {
      if (ts.isStringLiteralLike(n.argumentExpression)) names.add(n.argumentExpression.text); else opaque = true;
      return;
    }
    // const { a, b } = q   /   const q2 = q
    if (ts.isVariableDeclaration(n) && n.initializer && ts.isIdentifier(skipCasts(n.initializer)) && aliases.has(skipCasts(n.initializer).text)) {
      if (ts.isObjectBindingPattern(n.name)) { if (!paramNamesFromBinding(n.name, names)) opaque = true; return; }
      if (ts.isIdentifier(n.name)) { aliases.add(n.name.text); return; }
    }
    if (ts.isIdentifier(n) && aliases.has(n.text)) {
      const p = n.parent;
      if (ts.isCallExpression(p) && p.arguments.includes(n)) { follow(p, p.arguments.indexOf(n)); return; }
      if (ts.isSpreadAssignment(p) || ts.isSpreadElement(p)) { opaque = true; return; }
      if (ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) return;
      if (ts.isParameter(p) || ts.isVariableDeclaration(p) && p.name === n) return;
      // `q || {}` / `q ?? {}` is the same object handed on
      if (ts.isBinaryExpression(p) && p.left === n && (p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || p.operatorToken.kind === ts.SyntaxKind.BarBarToken)) { visitParentUse(p); return; }
      if (ts.isBinaryExpression(p) && (p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || p.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken || p.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken)) return;
      if (ts.isTypeOfExpression(p) || ts.isPrefixUnaryExpression(p) || ts.isIfStatement(p) || ts.isConditionalExpression(p)) return;
      if (ts.isShorthandPropertyAssignment(p) || ts.isPropertyAssignment(p) || ts.isReturnStatement(p) || ts.isArrowFunction(p)) { opaque = true; return; }
      if (ts.isAsExpression(p) || ts.isParenthesizedExpression(p) || ts.isNonNullExpression(p)) { visitParentUse(p); return; }
      opaque = true; return;
    }
    ts.forEachChild(n, visit);
  };
  const visitParentUse = (p) => {
    const pp = p.parent;
    if (ts.isCallExpression(pp) && pp.arguments.includes(p)) { follow(pp, pp.arguments.indexOf(p)); return; }
    if (ts.isPropertyAccessExpression(pp)) { names.add(pp.name.text); return; }
    if (ts.isAsExpression(pp) || ts.isParenthesizedExpression(pp) || ts.isNonNullExpression(pp)) { visitParentUse(pp); return; }
    if (ts.isVariableDeclaration(pp) && ts.isIdentifier(pp.name)) { if (!aliases.has(pp.name.text)) { aliases.add(pp.name.text); ts.forEachChild(fnNode.body, visit); } return; }
    if (ts.isVariableDeclaration(pp) && ts.isObjectBindingPattern(pp.name)) { if (!paramNamesFromBinding(pp.name, names)) opaque = true; return; }
    opaque = true;
  };
  const follow = (call, idx) => {
    if (depth >= 4) { opaque = true; return; }
    const r = resolveCallee(ctx, call);
    if (!r) { opaque = true; return; }
    const p = r.fn.parameters[idx];
    if (!p) return;
    if (ts.isObjectBindingPattern(p.name)) { if (!paramNamesFromBinding(p.name, names)) opaque = true; return; }
    if (!ts.isIdentifier(p.name)) { opaque = true; return; }
    const sub = readsOf({ file: r.file, cls: r.cls }, r.fn, p.name.text, depth + 1);
    sub.names.forEach((x) => names.add(x)); if (sub.opaque) opaque = true;
  };
  ts.forEachChild(body, visit);
  return { names, opaque };
}
const skipCasts = (e) => { while (e && (ts.isAsExpression(e) || ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(e)))) e = e.expression; return e; };

const NOOP_CALLEES = /^(String|Number|Boolean|JSON\.stringify|console\.\w+|Object\.freeze)$/;
function resolveCallee(ctx, call) {
  const e = call.expression;
  const fnLike = (node) => {
    if (!node) return null;
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return node;
    if (ts.isVariableDeclaration(node) && node.initializer) return fnLike(skipCasts(node.initializer));
    if (ts.isPropertyDeclaration(node) && node.initializer) return fnLike(skipCasts(node.initializer));
    return null;
  };
  if (ts.isIdentifier(e)) {
    const d = findDecl(ctx.file, e.text); const fn = fnLike(d?.node);
    return fn ? { file: d.file, cls: null, fn } : null;
  }
  if (ts.isPropertyAccessExpression(e)) {
    // this.method(q)
    if (e.expression.kind === ts.SyntaxKind.ThisKeyword && ctx.cls) { const m = fnLike(methodOf(ctx.cls, e.name.text)); return m ? { file: ctx.file, cls: ctx.cls, fn: m } : null; }
    // this.svc.method(q)
    if (ts.isPropertyAccessExpression(e.expression) && e.expression.expression.kind === ts.SyntaxKind.ThisKeyword && ctx.cls) {
      const c = memberClass(ctx.file, ctx.cls, e.expression.name.text);
      if (!c) return null;
      const m = fnLike(methodOf(c.node, e.name.text));
      return m ? { file: c.file, cls: c.node, fn: m } : null;
    }
  }
  return null;
}

/** The route collector names module files from the repository root and API files from apps/api/src. */
export const routeFile = (route) => (route.file.startsWith('modules/') ? join(REPO, route.file) : join(API, 'src', route.file));

/** What one handler reads from the query string. */
export function handlerQueryReads(route) {
  const file = routeFile(route);
  const cls = findClass(file, route.controller);
  const m = methodOf(cls, route.handler);
  if (!m || !ts.isMethodDeclaration(m)) return { found: false, names: new Set(), opaque: true, readsQuery: false };
  const names = new Set(); let opaque = false; let readsQuery = false;
  for (const p of m.parameters) {
    const ds = decoratorsOf(p);
    for (const d of ds) {
      const nm = decoName(d);
      const args = ts.isCallExpression(d.expression) ? d.expression.arguments : [];
      if (nm === 'Query') {
        readsQuery = true;
        if (args[0] && ts.isStringLiteralLike(args[0])) { names.add(args[0].text); continue; }
        if (ts.isObjectBindingPattern(p.name)) { if (!paramNamesFromBinding(p.name, names)) opaque = true; continue; }
        if (!ts.isIdentifier(p.name)) { opaque = true; continue; }
        const r = readsOf({ file, cls }, m, p.name.text, 0);
        r.names.forEach((x) => names.add(x)); if (r.opaque) opaque = true;
      }
      if ((nm === 'Req' || nm === 'Request') && ts.isIdentifier(p.name)) {
        // req.query.x / req.query passed along
        const rid = p.name.text;
        const visit = (n) => {
          if (ts.isPropertyAccessExpression(n) && n.name.text === 'query' && ts.isIdentifier(n.expression) && n.expression.text === rid) {
            readsQuery = true;
            const par = n.parent;
            if (ts.isPropertyAccessExpression(par) && par.expression === n) names.add(par.name.text);
            else if (ts.isElementAccessExpression(par) && ts.isStringLiteralLike(par.argumentExpression)) names.add(par.argumentExpression.text);
            else if (ts.isCallExpression(par) && par.arguments.includes(n)) {
              const r = resolveCallee({ file, cls }, par); const pp = r?.fn.parameters[par.arguments.indexOf(n)];
              if (pp && ts.isIdentifier(pp.name)) { const s = readsOf({ file: r.file, cls: r.cls }, r.fn, pp.name.text, 1); s.names.forEach((x) => names.add(x)); if (s.opaque) opaque = true; }
              else if (pp && ts.isObjectBindingPattern(pp.name)) { if (!paramNamesFromBinding(pp.name, names)) opaque = true; }
              else opaque = true;
            } else if (ts.isVariableDeclaration(par) && ts.isObjectBindingPattern(par.name)) { if (!paramNamesFromBinding(par.name, names)) opaque = true; }
            else opaque = true;
            return;
          }
          ts.forEachChild(n, visit);
        };
        if (m.body) visit(m.body);
      }
    }
  }
  return { found: true, names, opaque, readsQuery };
}

// ── static evaluation of the declared specs ─────────────────────────────────────────────────────────────────────
const UNRESOLVED = Symbol('unresolved');
export function evalLiteral(file, node, depth = 0) {
  node = skipCasts(node);
  if (!node || depth > 12) return UNRESOLVED;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return -Number(node.operand.text);
  if (ts.isArrayLiteralExpression(node)) {
    const out = [];
    for (const el of node.elements) {
      if (ts.isSpreadElement(el)) { const v = evalLiteral(file, el.expression, depth + 1); if (!Array.isArray(v)) return UNRESOLVED; out.push(...v); }
      else { const v = evalLiteral(file, el, depth + 1); if (v === UNRESOLVED) return UNRESOLVED; out.push(v); }
    }
    return out;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const out = {};
    for (const pr of node.properties) {
      if (ts.isSpreadAssignment(pr)) { const v = evalLiteral(file, pr.expression, depth + 1); if (!v || typeof v !== 'object' || v === UNRESOLVED) return UNRESOLVED; Object.assign(out, v); continue; }
      if (ts.isPropertyAssignment(pr)) { const k = pr.name.getText().replace(/^['"]|['"]$/g, ''); const v = evalLiteral(file, pr.initializer, depth + 1); if (v === UNRESOLVED) return UNRESOLVED; out[k] = v; continue; }
      if (ts.isShorthandPropertyAssignment(pr)) { const v = evalLiteral(file, pr.name, depth + 1); if (v === UNRESOLVED) return UNRESOLVED; out[pr.name.text] = v; continue; }
      return UNRESOLVED;
    }
    return out;
  }
  if (ts.isIdentifier(node)) {
    if (node.text === 'undefined') return undefined;
    const d = findDecl(file, node.text);
    if (d && ts.isVariableDeclaration(d.node) && d.node.initializer) return evalLiteral(d.file, d.node.initializer, depth + 1);
    return UNRESOLVED;
  }
  if (ts.isPropertyAccessExpression(node)) {
    const base = evalLiteral(file, node.expression, depth + 1);
    if (base && typeof base === 'object' && base !== UNRESOLVED && node.name.text in base) return base[node.name.text];
    return UNRESOLVED;
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^(defineListQueries|defineListQuery|listQueries)$/.test(node.expression.text) && node.arguments[0]) return evalLiteral(file, node.arguments[0], depth + 1);
  return UNRESOLVED;
}

/** The spec a handler declares: { declared: boolean, spec: object|null, how: 'method'|'class'|null, unresolved?: true }. */
export function declaredSpec(route) {
  const file = routeFile(route);
  const cls = findClass(file, route.controller);
  const m = methodOf(cls, route.handler);
  if (m) for (const d of decoratorsOf(m)) if (decoName(d) === 'ListQuery') {
    const a = d.expression.arguments?.[0]; const v = a ? evalLiteral(file, a) : UNRESOLVED;
    return v === UNRESOLVED ? { declared: true, spec: null, how: 'method', unresolved: true } : { declared: true, spec: v, how: 'method' };
  }
  if (cls) for (const d of decoratorsOf(cls)) if (decoName(d) === 'ListQueries') {
    const a = d.expression.arguments?.[0]; const v = a ? evalLiteral(file, a) : UNRESOLVED;
    if (v === UNRESOLVED) return { declared: false, spec: null, how: 'class', unresolved: true };
    if (Object.prototype.hasOwnProperty.call(v, route.handler)) return { declared: true, spec: v[route.handler], how: 'class' };
  }
  return { declared: false, spec: null, how: null };
}

/** Every query parameter name a spec accepts (canonical + legacy). */
export function acceptedNames(spec) {
  const s = new Set(['q', 'filter', 'sort', 'cursor', 'limit', 'from', 'to']);
  if (!spec || typeof spec !== 'object') return s;
  for (const [k, f] of Object.entries(spec.filters ?? {})) for (const a of (f && f.aliases) || [k]) s.add(a);
  for (const a of spec.sortParams ?? ['sort', 'sortBy', 'orderBy']) s.add(a);
  for (const a of spec.dirParams ?? ['dir', 'direction', 'sortDir', 'sortDirection', 'order']) s.add(a);
  if (spec.search && typeof spec.search === 'object') for (const a of spec.search.params ?? []) s.add(a);
  for (const a of spec.limitParams ?? ['limit', 'pageSize']) s.add(a);
  if (spec.dateRange) for (const a of [...(spec.dateRange.from ?? []), ...(spec.dateRange.to ?? []), ...(spec.dateRange.days ?? [])]) s.add(a);
  if (spec.legacySort) { s.add(spec.legacySort.by); if (spec.legacySort.dir) s.add(spec.legacySort.dir); }
  for (const a of spec.params ?? []) s.add(a);
  return s;
}

/** The registered GET routes, from the ONE route collector (scripts/audit-routes.js). */
export function getRoutes() {
  const { routes } = require(join(API, 'scripts', 'audit-routes.js'));
  return routes.filter((r) => r.method === 'GET');
}

/** Every list handler with what it reads and what it declares. */
export function listHandlers() {
  const out = [];
  for (const r of getRoutes()) {
    const reads = handlerQueryReads(r);
    if (!reads.readsQuery) continue;
    out.push({ ...r, abs: routeFile(r), key: `${r.file}#${r.controller}.${r.handler}`, reads, decl: declaredSpec(r) });
  }
  return out;
}
