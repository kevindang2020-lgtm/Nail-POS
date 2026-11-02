// throw-sites.mjs — Vietnamese POS §2 / §21 / §58 (V-5, Oct 27 2026): find every `throw` of a user-visible SENTENCE in the
// API's product code, with the TypeScript parser (a regex cannot tell `new TechError('not_found', 'Ticket not found')`'s
// kind token from its sentence). Shared by the error-text gate (check-error-text.mjs) and the V-5 conversion tooling.
//
// A site is one `throw new X(…)` (or `throw withCode(new X(…), …)`). For each it reports:
//   message   the sentence (template parts as {name} placeholders), or null when the text is not literal (a variable)
//   coded     true when the sentence travels with a registry code: wrapped in withCode(…), an UPPER_CASE registry-style code
//             argument (ValidationError('…', 'TICKET_ALREADY_PAID')), or an object body with `code: '…'`
//   kind      a lower-case kind token the class carries (TechError('not_found', …)) — mapped to a status, never shown
import ts from 'typescript';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

export const ROOT = new URL('../../../../', import.meta.url).pathname.replace(/\/$/, '');
const SKIP = new Set(['node_modules', 'dist', '.git', 'coverage', 'build']);
const IS_TEST = /\.(spec|test)\.ts$|vitest|\.pgtest\.|\.postgres-race\.|test-support|testkit|\/testing\/|\.d\.ts$/;

export function productFiles(roots = ['apps/api/src', 'modules']) {
  const out = [];
  const walk = (d) => { for (const n of readdirSync(d)) { if (SKIP.has(n)) continue; const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.ts$/.test(n) && !IS_TEST.test(p)) out.push(p); } };
  for (const r of roots) if (existsSync(join(ROOT, r))) walk(join(ROOT, r));
  return out.sort();
}

const CODE_TOKEN = /^[a-z][a-z0-9_.-]*$|^[A-Z][A-Z0-9_]*$/;
/** the text of a string-ish expression: 'a' / `a ${b}` / 'a' + b → { text, parts } — null when nothing literal */
function textOf(node, sf) {
  if (!node) return null;
  if (ts.isParenthesizedExpression(node)) return textOf(node.expression, sf);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { text: node.text, exprs: [] };
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text; const exprs = [];
    for (const s of node.templateSpans) { exprs.push(s.expression.getText(sf)); text += `{${exprs.length - 1}}` + s.literal.text; }
    return { text, exprs };
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = textOf(node.left, sf) ?? { text: '', exprs: [], dyn: node.left.getText(sf) };
    const r = textOf(node.right, sf) ?? { text: '', exprs: [], dyn: node.right.getText(sf) };
    if (!l.text && !r.text) return null;
    const exprs = [...l.exprs]; let text = l.dyn ? `{${exprs.push(l.dyn) - 1}}` : l.text;
    if (r.dyn) text += `{${exprs.push(r.dyn) - 1}}`; else { text += r.text.replace(/\{(\d+)\}/g, (_, i) => `{${Number(i) + l.exprs.length + (l.dyn ? 1 : 0)}}`); exprs.push(...r.exprs); }
    return { text, exprs };
  }
  return null;
}

/** every throw site of one file */
export function scanFile(file, text) {
  const src = text ?? readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const sites = [];
  const visit = (node) => {
    if (ts.isThrowStatement(node) && node.expression) {
      let expr = node.expression; let coded = false;
      if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === 'withCode' && expr.arguments[0]) { coded = true; expr = expr.arguments[0]; }
      if (ts.isNewExpression(expr) && ts.isIdentifier(expr.expression)) {
        const cls = expr.expression.text; const args = expr.arguments ?? [];
        let message = null; let exprs = []; let kind = null;
        for (const a of args) {
          if (ts.isObjectLiteralExpression(a)) {
            for (const p of a.properties) {
              if (!ts.isPropertyAssignment(p) || !p.name) continue;
              const key = p.name.getText(sf);
              if (key === 'code' && (ts.isStringLiteral(p.initializer) || ts.isNoSubstitutionTemplateLiteral(p.initializer))) coded = true;
              if (key === 'message' && message === null) { const t = textOf(p.initializer, sf); if (t) { message = t.text; exprs = t.exprs; } }
            }
            continue;
          }
          const t = textOf(a, sf);
          if (!t) continue;
          if (CODE_TOKEN.test(t.text) && !t.exprs.length) {
            // an UPPER_CASE token is an API code the class sends (ExpenseError('EXPENSE_INVALID', '…'), V-5's
            // ValidationError('…', 'TICKET_ALREADY_PAID')); a lower-case one is the class's own kind (TechError('not_found', …))
            if (/^[A-Z][A-Z0-9_]{2,}$/.test(t.text)) coded = true;
            else if (message === null) kind = kind ?? t.text;
            continue;
          }
          if (message === null) { message = t.text; exprs = t.exprs; }
        }
        // a sentence that is only a kind token is a kind (CommunityError('already_reported')): the class maps it
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        sites.push({ file: relative(ROOT, file), line: line + 1, cls, message, exprs, kind, coded, start: expr.getStart(sf), end: expr.getEnd(), throwStart: node.expression.getStart(sf), throwEnd: node.expression.getEnd() });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

/** the 500 path: these never reach a screen with their text (the platform filter answers INTERNAL_ERROR, localized) */
export const INTERNAL_CLASSES = new Set(['Error', 'RangeError', 'TypeError', 'SyntaxError', 'InternalServerErrorException', 'NotImplementedException', 'AssertionError']);
/** 403: the screen shows PERMISSION_DENIED in the user's language (the status's registry code) — the sentence adds nothing */
export const isForbiddenClass = (cls) => /Forbidden/.test(cls);
/** a user-visible free-text sentence: literal, not coded, not the 500 path, not a 403 */
export const isFreeText = (s) => s.message !== null && /[A-Za-z]{2}/.test(s.message) && !s.coded && !INTERNAL_CLASSES.has(s.cls) && !isForbiddenClass(s.cls);
