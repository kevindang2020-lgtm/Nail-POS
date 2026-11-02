#!/usr/bin/env node
// pos-strings.mjs — Oct 21 2026 (Kevin: "Build Vietnamese for the POS"): finds the English a POS screen shows that is
// NOT yet behind t(): JSX text nodes with letters, and the attributes a person reads (title, placeholder, aria-label,
// alt). Used two ways:
//   node tooling/i18n/pos-strings.mjs            → a per-file count (the check:pos-i18n ratchet reads this)
//   node tooling/i18n/pos-strings.mjs --list     → every string with file:line (for the translation pass)
//   node tooling/i18n/pos-strings.mjs --json     → machine-readable for the codemod
// It deliberately IGNORES: test files, strings with no letters (icons, "—", numbers), template placeholders inside
// expressions, and anything already inside a t(...) call.
//
// Tier 2 (Oct 21 2026, later the same day): the English a screen builds in CODE rather than in JSX — nav labels, KPI
// titles, table headers, quick-action buttons, toasts, thrown messages. Found by CONTEXT, never by looks alone:
//   • object properties named like text (label, l, title, t, text, sub, hint, msg, message, cta, section, k …);
//   • the same names as string props on a custom (capitalised) component (<Kpi label="…">);
//   • string elements of an array that is mapped straight to render ([...].map(h => <th>{h}</th>));
//   • the first string argument of the calls that show a message (setNote, setErr, setMsg, toast, reportError, act,
//     kvRow, headRow, …ErrorText, new Error);
//   • sentences (a string with a space) in a ternary / `||` branch, a `return`, or a const.
// A string that the same file also COMPARES against (=== 'x', case 'x':) is never translated — it is a value, whatever
// it looks like — and so is a single lower-case word anywhere outside JSX (an enum, a key).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

// POS_I18N_TREE: scan another checkout of the repo (e.g. `git archive HEAD` unpacked) — paths stay repo-relative
const ROOT = process.env.POS_I18N_TREE ? process.env.POS_I18N_TREE.replace(/\/?$/, '/') : new URL('../../', import.meta.url).pathname;
const SRC = join(ROOT, 'apps/pos-web/src');
export const READ_ATTRS = new Set(['title', 'placeholder', 'aria-label', 'alt', 'aria-description']);

function* files(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e); const st = statSync(p);
    if (st.isDirectory()) { if (e !== 'node_modules' && e !== 'test') yield* files(p); }
    // test support (a fixture kit that imports vitest, e.g. screens/access/accessTestKit.ts) is not screen text
    else if (/\.tsx?$/.test(e) && !/\.(test|spec)\.tsx?$/.test(e) && !/\.d\.ts$/.test(e) && !/(^|\/)i18n\//.test(p) && !/test-?kit\.tsx?$/i.test(e) && !/^import [^;]*from 'vitest';/m.test(readFileSync(p, 'utf8'))) yield p;
  }
}
const hasLetters = (s) => /[A-Za-z]{2,}/.test(s);
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', hellip: '…', mdash: '—', ndash: '–', middot: '·', copy: '©', rarr: '→', larr: '←', bull: '•', times: '×', deg: '°' };
/** JSX text keeps its entities raw in node.text; the screen shows the decoded character, so the catalogue holds that */
export const decodeEntities = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e] ?? m));
/** text we never translate: machine-looking tokens, URLs, pure codes */
const skipText = (s) => !hasLetters(s) || /^https?:\/\//.test(s) || /^[A-Z0-9_]{2,}$/.test(s) && !/[a-z]/.test(s) && s.length <= 4;
export const TEXT_PROPS = new Set(['label', 'l', 'title', 't', 'text', 'sub', 'subtitle', 'hint', 'help', 'msg', 'message', 'cta', 'confirmLabel', 'closeLabel', 'note', 'body', 'what', 'placeholder', 'ph', 'empty', 'emptyText', 'heading', 'header', 'caption', 'tooltip', 'section', 'k', 'desc', 'description', 'd', 'detail', 'details', 'summary', 'warning', 'info', 'tip', 'explain', 'explanation', 'subtitle2', 'helper', 'helperText', 'errorText', 'successText', 'emptyLabel', 'actionLabel', 'buttonLabel', 'ariaLabel']);
export const MESSAGE_CALLS = /^(setNote|setErr|setError|setMsg|setMessage|setToast|toast|notify|reportError|act|kvRow|headRow|ckbx|\w*ErrorText|errText|Error)$/;
/** code-looking values that a text-named property can still hold: an SVG path, a CSS value, a route, an identifier, an email */
const looksLikeCode = (s) => /^[A-Z0-9]+(_[A-Z0-9]+)+$/.test(s) || /^[Mm]\s*-?\d/.test(s) || /^(\/|#|\.|@)/.test(s) || /^[\w.-]+@[\w.-]+$/.test(s) || /^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/.test(s) || /^(\d+(\.\d+)?(px|em|rem|%|s|ms|fr)\b|rgba?\(|var\(|hsla?\(|linear-gradient|repeat\(|solid\b|\d+px)/.test(s) || /^[a-z]+(-[a-z]+)*$/.test(s) || /^[a-z0-9]+(_[a-z0-9]+)+$/.test(s) || (/\d(px|s|ms|%|em|rem|fr|deg|vh|vw)\b/.test(s) && s.split(' ').length <= 4) || /\b(ease|ease-in|ease-out|ease-in-out|linear|infinite|forwards|cubic-bezier)\b/.test(s) || /^[a-z][A-Za-z0-9]*$/.test(s) || /^[a-z]+:\/\//.test(s) || /#[0-9a-f]{3,8}\b/i.test(s) || /^-?[\d.]+( -?[\d.]+(px|%|em|rem|fr)?)+( auto)?$/.test(s) || /^\d{1,2}:\d{2} ?(AM|PM)?$/i.test(s) || /^(btn|pill|grid|flex|card|row|col|text|bg|icon|chip|badge|tag)( [a-z0-9:-]+)+$/.test(s) || /^(color-mix|calc|clamp|min|max)\(/.test(s) || /^"[^"]+", ?(serif|sans-serif|monospace)$/.test(s);
const isSentence = (s) => /\s/.test(s.trim());

export function scanFile(file) {
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const insideT = (node) => { for (let p = node.parent; p; p = p.parent) { if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && /^(t|tx|i18nText)$/.test(p.expression.text)) return true; } return false; };
  const TIER2 = new Set(['prop', 'cattr', 'array', 'call', 'expr', 'tpl']);
  const push = (node, text, kind, attr, extra) => {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean || skipText(clean)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    // JSX text is whitespace-collapsed by the browser, so its catalogue value is the collapsed text; a string literal in
    // code keeps its exact spacing (' · this device' is glued to a name) — its catalogue value is the literal itself
    if (TIER2.has(kind) && /[\n\r\t]/.test(text)) return;   // a multi-line template (a CSV sample, a script) is data, not screen text
    out.push({ file: relative(ROOT, file), line: line + 1, kind, attr, text: TIER2.has(kind) ? text : clean, pos: node.getStart(sf), end: node.getEnd(), raw: text, ...(extra ?? {}) });
  };
  // values the file compares against are VALUES, never text to translate
  const compared = new Set();
  const collect = (n) => {
    if (ts.isBinaryExpression(n) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(n.operatorToken.kind)) { for (const side of [n.left, n.right]) if (ts.isStringLiteral(side)) compared.add(side.text); }
    if (ts.isCaseClause(n) && ts.isStringLiteral(n.expression)) compared.add(n.expression.text);
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && /^(includes|has|indexOf|startsWith|endsWith|get|set|delete)$/.test(n.expression.name.text)) { for (const a of n.arguments) if (ts.isStringLiteral(a)) compared.add(a.text); }
    ts.forEachChild(n, collect);
  };
  collect(sf);
  const tier2 = (node, text, kind, attr) => {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean || skipText(clean) || looksLikeCode(clean) || compared.has(clean) || compared.has(text)) return;
    push(node, text, kind, attr);
  };
  const inJsxAttrOfCustom = (lit) => { const p = lit.parent; const a = ts.isJsxExpression(p) ? p.parent : p; if (!a || !ts.isJsxAttribute(a)) return null; const el = a.parent?.parent; const tag = el && (ts.isJsxOpeningElement(el) || ts.isJsxSelfClosingElement(el)) ? el.tagName.getText(sf) : ''; return /^[A-Z]/.test(tag) ? a.name.getText(sf) : null; };
  // Tier 3 (Oct 21 2026): a sentence built with ${…} — `${name} is connected.` → t('key', { name: String(name) }) with the
  // catalogue text '{name} is connected.' — in the same reading contexts as tier 2 plus a JSX child and a read attribute.
  const tplContext = (node) => {
    const p = node.parent;
    if (ts.isJsxExpression(p)) { const g = p.parent; if (g && (ts.isJsxElement(g) || ts.isJsxFragment(g))) return 'jsx'; if (g && ts.isJsxAttribute(g)) { const n = g.name.getText(sf); if (READ_ATTRS.has(n)) return n; const c = inJsxAttrOfCustom(node); return c && TEXT_PROPS.has(c) ? c : null; } return null; }
    if (ts.isPropertyAssignment(p) && p.initializer === node && ts.isIdentifier(p.name) && TEXT_PROPS.has(p.name.text)) return p.name.text;
    if (ts.isCallExpression(p) && p.arguments[0] === node && (ts.isIdentifier(p.expression) ? MESSAGE_CALLS.test(p.expression.text) : ts.isPropertyAccessExpression(p.expression) && MESSAGE_CALLS.test(p.expression.name.text))) return 'call';
    if (ts.isNewExpression(p) && p.arguments?.[0] === node && ts.isIdentifier(p.expression) && p.expression.text === 'Error') return 'call';
    if ((ts.isConditionalExpression(p) && (p.whenTrue === node || p.whenFalse === node)) || (ts.isBinaryExpression(p) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(p.operatorToken.kind)) || ts.isReturnStatement(p) || ts.isVariableDeclaration(p) || ts.isParenthesizedExpression(p) || ts.isArrowFunction(p)) return 'expr';
    return null;
  };
  const tplIsCode = (st) => /[;{}=<>\\]|\w\(|\b\d*(px|rem|em|vh|vw|ms|deg|fr)\b|^\s*(\/|#|\.|\?|&)|:\/\/|\/api\/|^[\w.-]*$/.test(st);
  // an English plural suffix (`n === 1 ? '' : 's'`) is named plural… — Vietnamese has no plural ending, so its translation
  // may leave it out (check-i18n and merge-vi accept a missing plural… placeholder, never any other)
  const isPluralSuffix = (e) => { while (ts.isParenthesizedExpression(e)) e = e.expression; return ts.isConditionalExpression(e) && [e.whenTrue, e.whenFalse].every((b) => (ts.isStringLiteral(b) || ts.isNoSubstitutionTemplateLiteral(b)) && /^(|s|es|ies|y)$/.test(b.text)); };
  const nameOf = (e) => { if (isPluralSuffix(e)) return 'plural'; while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e)) e = e.expression; if (ts.isIdentifier(e)) return e.text; if (ts.isPropertyAccessExpression(e)) return e.name.text; if (ts.isCallExpression(e) && e.arguments.length === 1) { const a = nameOf(e.arguments[0]); if (a) return a; } return null; };
  const visitTpl = (node) => {
    if (!ts.isTemplateExpression(node) || ts.isTaggedTemplateExpression(node.parent) || insideT(node)) return;
    const ctx = tplContext(node); if (!ctx) return;
    // never inside a JSX attribute that is not read by a person (className={({ isActive }) => `navlink${…}`}, style, key …)
    for (let a = node.parent; a && !ts.isSourceFile(a); a = a.parent) { if (ts.isJsxAttribute(a)) { const n = a.name.getText(sf); if (!READ_ATTRS.has(n) && !TEXT_PROPS.has(n)) return; break; } if (ts.isJsxElement(a) || ts.isJsxSelfClosingElement(a)) break; }
    const parts = [node.head.text, ...node.templateSpans.map((sp) => sp.literal.text)];
    const statics = parts.join(' ');
    const bare = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (!/[A-Za-z]{2,}/.test(statics) || !/[A-Za-z]{2,}[\s,.:!?]|\s[A-Za-z]{2,}/.test(statics) || tplIsCode(statics) || looksLikeCode(bare) || parts.some((x) => /^[\w.-]+[:.]$/.test(x)) || parts.some((x) => looksLikeCode(x.trim()) && /^(btn|pill|grid|flex|card|row|col|text|bg|icon|chip|badge|tag)\b/.test(x.trim())) || /[\n\r\t]/.test(statics)) return;
    const used = new Set(); const vars = [];
    node.templateSpans.forEach((sp, i) => { let n = nameOf(sp.expression) || `v${i}`; n = n.replace(/\W/g, '') || `v${i}`; let k = n, j = 2; while (used.has(k)) k = `${n}${j++}`; used.add(k); vars.push({ name: k, start: sp.expression.getStart(sf), end: sp.expression.getEnd() }); });
    let text = node.head.text; node.templateSpans.forEach((sp, i) => { text += `{${vars[i].name}}` + sp.literal.text; });
    push(node, text, 'tpl', ctx, { vars });
  };
  // an English plural ending rendered next to translated text ({n === 1 ? '' : 's'}) must go through enPlural() —
  // except where it is already a {plural} placeholder value (inside a t() call) or a template span
  const visitPlural = (node) => {
    if (!isPluralSuffix(node) || ts.isParenthesizedExpression(node)) return;
    for (let a = node.parent; a && !ts.isSourceFile(a); a = a.parent) {
      if (ts.isCallExpression(a) && ts.isIdentifier(a.expression) && /^(t|tx|i18nText|enPlural|String)$/.test(a.expression.text)) return;
      if (ts.isTemplateSpan(a)) return;
      if (ts.isJsxAttribute(a) || ts.isBlock(a)) break;
    }
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    out.push({ file: relative(ROOT, file), line: line + 1, kind: 'plural', text: '', pos: node.getStart(sf), end: node.getEnd(), raw: node.getText(sf) });
  };
  const visit = (node) => {
    if (process.env.POS_I18N_TIER2 !== '0') visitPlural(node);
    if (process.env.POS_I18N_TIER2 !== '0' && process.env.POS_I18N_TPL !== '0') visitTpl(node);
    if (process.env.POS_I18N_TIER2 !== '0' && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !insideT(node) && !ts.isImportDeclaration(node.parent) && !ts.isExportDeclaration(node.parent)) {
      const p = node.parent; const text = node.text;
      if (ts.isPropertyAssignment(p) && p.initializer === node && ts.isIdentifier(p.name) && TEXT_PROPS.has(p.name.text)) tier2(node, text, 'prop', p.name.text);
      else if (ts.isJsxAttribute(p) || (ts.isJsxExpression(p) && p.parent && ts.isJsxAttribute(p.parent))) { const name = inJsxAttrOfCustom(node); if (name && TEXT_PROPS.has(name) && !READ_ATTRS.has(name)) tier2(node, text, 'cattr', name); }
      else if (ts.isArrayLiteralExpression(p) && p.parent && ts.isPropertyAccessExpression(p.parent) && p.parent.name.text === 'map' && ts.isCallExpression(p.parent.parent)) tier2(node, text, 'array');
      else if (ts.isCallExpression(p) && p.arguments[0] === node && (ts.isIdentifier(p.expression) ? MESSAGE_CALLS.test(p.expression.text) : ts.isPropertyAccessExpression(p.expression) && MESSAGE_CALLS.test(p.expression.name.text))) tier2(node, text, 'call', ts.isIdentifier(p.expression) ? p.expression.text : p.expression.name.text);
      else if (ts.isNewExpression(p) && p.arguments?.[0] === node && ts.isIdentifier(p.expression) && p.expression.text === 'Error') tier2(node, text, 'call', 'Error');
      else if (ts.isCallExpression(p) && p.arguments[2] === node && ts.isIdentifier(p.expression) && p.expression.text === 'ckbx') tier2(node, text, 'call', 'ckbx');
      // a ternary / `||` rendered straight into JSX ({busy ? 'Thinking…' : cta}) shows even a single capitalised word
      else if ((ts.isConditionalExpression(p) && (p.whenTrue === node || p.whenFalse === node) || ts.isBinaryExpression(p) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(p.operatorToken.kind) && p.right === node) && p.parent && ts.isJsxExpression(p.parent) && p.parent.parent && (ts.isJsxElement(p.parent.parent) || ts.isJsxFragment(p.parent.parent)) && /^[A-Z]/.test(text.trim()) && !isSentence(text)) tier2(node, text, 'expr');
      else if ((ts.isConditionalExpression(p) && (p.whenTrue === node || p.whenFalse === node)) || (ts.isBinaryExpression(p) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(p.operatorToken.kind)) || ts.isReturnStatement(p) || ts.isVariableDeclaration(p) || ts.isParenthesizedExpression(p)) { if (isSentence(text)) tier2(node, text, 'expr'); }
    }
    if (ts.isJsxText(node)) { if (!node.containsOnlyTriviaWhiteSpaces && !insideT(node)) push(node, decodeEntities(node.text), 'text'); }
    else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const name = node.name.getText(sf);
      if (READ_ATTRS.has(name)) push(node.initializer, decodeEntities(node.initializer.text), 'attr', name);
    } else if (ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression && ts.isStringLiteral(node.initializer.expression)) {
      const name = node.name.getText(sf);
      if (READ_ATTRS.has(name)) push(node.initializer.expression, decodeEntities(node.initializer.expression.text), 'attr', name);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

// Tier 4 (Vietnamese POS mandate, build plan WP-K, Oct 26 2026): the English the tiers above cannot see, because it reaches
// the screen through DATA rather than a text-named property — and the code that translates too early or not at all.
//   • map     — a string value of a label map: an object literal whose values are all strings (≥ 2), any key name
//               ({ READY_FOR_CHECKOUT: 'Ready for checkout', void: 'Voided' }), incl. Record<string, string> tables;
//   • tuple   — a display string inside an array literal (the Overview Quick Actions tuples
//               [['/checkout', 'Take Payment', Icon], …], header lists ['Name', 'Phone'], option lists);
//   • helper  — the first string argument of a helper whose result is rendered: a call written straight into JSX
//               ({chip('VIP', tone)}) or of a function declared in this file that returns JSX (line('Tax', …)), and
//               setX('Saved') state setters (translated text kept in state goes stale on an instant switch);
//   • enum    — an enum code printed by `.replace(/_/g, ' ')` / `.replaceAll('_', ' ')` instead of statusLabel();
//   • status  — a raw status / type / reason code rendered straight into JSX ({row.status});
//   • branch  — a display word in a ?: / || / ?? branch whose other side is translated (cond ? 'Enabled' : t('…')) or
//               that is a value / label / fallback (`v: on ? 'Enabled' : 'Disabled'`, `role || 'Owner'`);
//   • concat  — English glued with + (n + ' days ago', 'Plan: ' + name) — word order differs in Vietnamese;
//   • module  — a t() call that runs at IMPORT time (outside every function): it is frozen in the language of the first
//               import and never follows a switch — use a getter / function.
// These are ratcheted (tooling/i18n/pos-i18n-baseline.json, per file, may only go down) by tooling/ci/check-pos-i18n.mjs.
export const TIER4_KINDS = ['map', 'tuple', 'helper', 'enum', 'status', 'branch', 'concat', 'module'];
const T_CALLS = /^(t|tx|i18nText)$/;
const NOT_HELPERS = /^(t|tx|i18nText|statusLabel|statusLabels|statusLabelOrNull|errorText|apiErrorMessage|String|Number|Boolean|Symbol|BigInt|Date|RegExp|require|fetch|encodeURIComponent|decodeURIComponent|parseInt|parseFloat|isNaN|alert|confirm|prompt|structuredClone|clsx|cx|cn|classNames|styled|css|keyframes|lazy|import|describe|it|test|expect|vi|navigate|nav|go|track|trackEvent|log|emit|send|setTimeout|setInterval|setSearchParams|setParams|setTheme|setLanguage|setTab|setView|setMode|setFilter|setSort|setStatus|setStep|setKind|setType|setRange|setPeriod|setPreset|setSection|setActive|setSelected|setPane|setPanel|setScope|setGroup|setCategory|setMethod|setChannel|setLang|setLocale|setRole|setTier|setSource)$/;
const STATUS_PROPS = /^(status|state|kind|type|reasonCode|reason_code|method|tier|role|source|channel|stage|severity|level|priority|action|eventType|event_type|paymentStatus|payment_status|ticketStatus)$/;
/** text a person reads — capitalised word(s) or a sentence; never a code, a key, a route, a CSS value, an identifier */
const displayish = (s) => {
  const c = s.replace(/\s+/g, ' ').trim();
  if (!c || skipText(c) || looksLikeCode(c)) return false;
  if (/^[A-Z][A-Za-z0-9]*$/.test(c) && /[a-z][A-Z]/.test(c)) return false;          // PascalCase identifier
  if (/^(Content|Accept|Cache|Idempotency|If|Last|User|Set|Retry|X)(-[A-Z][a-z]+)+$/.test(c)) return false;   // an HTTP header name (Content-Type)
  if (/^[A-Z0-9_]+$/.test(c)) return false;                                             // an upper-case code
  if (/^(English|Tiếng Việt)$/.test(c)) return false;                                   // a language's own name (the picker standard)
  if (/^[\w-]+\.(png|jpe?g|svg|webp|gif|csv|pdf|json|txt|mp3|wav|mp4)$/i.test(c)) return false;
  if (/^(application|text|image|audio|video)\/[\w.+-]+/.test(c)) return false;         // a MIME type
  if (/^[A-Z][a-z]+\/[A-Z][a-z_]+$/.test(c)) return false;                              // an IANA zone (America/New_York)
  if (/^(Bearer|Basic|GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/.test(c) && !/\s\w+\s/.test(c)) return false;
  return /^[A-Z]/.test(c) || /^\W*[A-Za-z]/.test(c) && /\s/.test(c) && /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(c);
};

export function scanTier4File(file) {
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const push = (node, kind, text, extra) => { const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf)); out.push({ file: relative(ROOT, file), line: line + 1, kind, text: String(text).replace(/\s+/g, ' ').trim().slice(0, 120), tier: 4, ...(extra ?? {}) }); };
  const compared = new Set();
  const collect = (n) => {
    if (ts.isBinaryExpression(n) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(n.operatorToken.kind)) { for (const side of [n.left, n.right]) if (ts.isStringLiteral(side)) compared.add(side.text); }
    if (ts.isCaseClause(n) && ts.isStringLiteral(n.expression)) compared.add(n.expression.text);
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && /^(includes|has|indexOf|startsWith|endsWith|get|set|delete)$/.test(n.expression.name.text)) { for (const a of n.arguments) if (ts.isStringLiteral(a)) compared.add(a.text); }
    // a union-type member is a value ('Cash' | 'Card'), never text
    if (ts.isLiteralTypeNode(n) && ts.isStringLiteral(n.literal)) compared.add(n.literal.text);
    ts.forEachChild(n, collect);
  };
  collect(sf);
  const isFnLike = (n) => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n) || ts.isConstructorDeclaration(n);
  const insideT = (node) => { for (let p = node.parent; p; p = p.parent) { if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && T_CALLS.test(p.expression.text)) return true; } return false; };
  const strOf = (n) => (n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))) ? n.text : null;
  // value contexts: a string that is an argument of a value-set (new Set([...]), [...].includes(x)), a JSX attribute that is not read
  const inValueContext = (node) => {
    for (let a = node.parent; a && !ts.isSourceFile(a); a = a.parent) {
      if (ts.isNewExpression(a) && ts.isIdentifier(a.expression) && a.expression.text === 'Set') return true;
      if (ts.isPropertyAccessExpression(a.parent ?? {}) && a.parent.expression === a && /^(includes|indexOf|has)$/.test(a.parent.name.text)) return true;
      if (ts.isJsxAttribute(a)) { const n = a.name.getText(sf); return n === 'style' || n === 'className' || n === 'key' || n === 'to' || n === 'href' || n === 'type' || n === 'name' || n === 'id' || n === 'value' || /^data-/.test(n); }
      if (ts.isTypeNode(a)) return true;
      if (ts.isCallExpression(a) && ts.isPropertyAccessExpression(a.expression) && /^(get|post|put|patch|delete|request|setItem|getItem|append|querySelector|querySelectorAll|addEventListener|removeEventListener|setAttribute)$/.test(a.expression.name.text)) return true;
      if (isFnLike(a) || ts.isBlock(a)) return false;
    }
    return false;
  };
  // functions declared in this file whose body renders JSX (local render helpers)
  const jsxHelpers = new Set();
  const hasJsx = (n) => { let f = false; const w = (x) => { if (f) return; if (ts.isJsxElement(x) || ts.isJsxSelfClosingElement(x) || ts.isJsxFragment(x)) { f = true; return; } ts.forEachChild(x, w); }; w(n); return f; };
  const findHelpers = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name && n.body && hasJsx(n.body) && /^[a-z]/.test(n.name.text)) jsxHelpers.add(n.name.text);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)) && /^[a-z]/.test(n.name.text) && hasJsx(n.initializer.body)) jsxHelpers.add(n.name.text);
    ts.forEachChild(n, findHelpers);
  };
  findHelpers(sf);
  const jsxChild = (n) => { let e = n; while (e.parent && (ts.isParenthesizedExpression(e.parent) || ts.isNonNullExpression(e.parent) || ts.isAsExpression(e.parent))) e = e.parent; const p = e.parent; return p && ts.isJsxExpression(p) && p.parent && (ts.isJsxElement(p.parent) || ts.isJsxFragment(p.parent)); };
  const visit = (node) => {
    // module: a t() call that runs at import time
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && T_CALLS.test(node.expression.text)) {
      let inFn = false; for (let a = node.parent; a && !ts.isSourceFile(a); a = a.parent) { if (isFnLike(a) || ts.isClassDeclaration(a) || ts.isClassExpression(a)) { inFn = true; break; } }
      if (!inFn) push(node, 'module', node.getText(sf));
    }
    // enum: code.replace(/_/g, ' ') / code.replaceAll('_', ' ')
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && /^(replace|replaceAll)$/.test(node.expression.name.text) && node.arguments.length === 2) {
      const [a0, a1] = node.arguments; const rep = strOf(a1);
      const pat = ts.isRegularExpressionLiteral(a0) ? a0.text : strOf(a0);
      if (rep != null && /^\s$/.test(rep) && pat != null && /^\/?\[?_[-\]]*\]?\+?\/?[gi]*$|^\/\[_-\]\+?\/g$|^\/\[-_\]\+?\/g$/.test(pat)) push(node, 'enum', node.getText(sf));
    }
    // status: {row.status} rendered raw
    if (ts.isPropertyAccessExpression(node) && STATUS_PROPS.test(node.name.text) && jsxChild(node)) push(node, 'status', node.getText(sf));
    if (ts.isCallExpression(node) && !insideT(node)) {
      const callee = ts.isIdentifier(node.expression) ? node.expression.text : null;
      const a0 = node.arguments[0]; const s = strOf(a0);
      if (callee && s != null && !NOT_HELPERS.test(callee) && !MESSAGE_CALLS.test(callee) && !/^use[A-Z]/.test(callee) && displayish(s) && !compared.has(s)) {
        const setter = /^set[A-Z]/.test(callee);
        // builders whose first argument is a title shown on another surface (the iPad full view) — Oct 27 2026
        if (jsxChild(node) || jsxHelpers.has(callee) || /^(reportRequest)$/.test(callee) || (setter && /\s/.test(s.trim()))) push(a0, 'helper', s, { attr: callee });
      }
    }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !insideT(node) && !compared.has(node.text) && displayish(node.text)) {
      const p = node.parent;
      // map: { anyKey: 'Display', … } with only string values (≥ 2); text-named keys are tier 2 already
      if (ts.isPropertyAssignment(p) && p.initializer === node && ts.isObjectLiteralExpression(p.parent)) {
        const name = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : '';
        const props = p.parent.properties;
        const allStrings = props.length >= 2 && props.every((q) => ts.isPropertyAssignment(q) && strOf(q.initializer) != null);
        if (allStrings && !(ts.isIdentifier(p.name) && TEXT_PROPS.has(name)) && !inValueContext(node)) push(node, 'map', node.text, { attr: name });
      }
      // branch: a display word in a conditional / fallback whose other side is translated, or that is a value / label
      else if ((ts.isConditionalExpression(p) && (p.whenTrue === node || p.whenFalse === node)) || (ts.isBinaryExpression(p) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(p.operatorToken.kind) && p.right === node)) {
        const other = ts.isConditionalExpression(p) ? (p.whenTrue === node ? p.whenFalse : p.whenTrue) : p.left;
        const hasT = (n) => { let f = false; const w = (x) => { if (f) return; if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && T_CALLS.test(x.expression.text)) { f = true; return; } ts.forEachChild(x, w); }; w(n); return f; };
        let top = p; while (top.parent && (ts.isConditionalExpression(top.parent) || ts.isParenthesizedExpression(top.parent) || ts.isBinaryExpression(top.parent) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(top.parent.operatorToken.kind))) top = top.parent;
        const tp = top.parent;
        const valueSlot = tp && ((ts.isPropertyAssignment(tp) && tp.initializer === top && ts.isIdentifier(tp.name) && /^(v|value|label|l|title|sub|text|name|caption|status|badge|pill|tag|chip)$/.test(tp.name.text)) || (ts.isJsxExpression(tp)) || (ts.isCallExpression(tp) && tp.arguments.includes(top) && !(ts.isPropertyAccessExpression(tp.expression) && /^(get|post|put|patch|delete|setItem|getItem|includes|has|indexOf|startsWith|endsWith|split|join|replace|test|match)$/.test(tp.expression.name.text))) || ts.isReturnStatement(tp) || ts.isArrowFunction(tp));
        if ((hasT(other) || valueSlot) && !inValueContext(node)) push(node, 'branch', node.text);
      }
      // concat: English glued with + — word order differs in Vietnamese
      else if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.PlusToken && /[A-Za-z]{2,}\s+[A-Za-z]{2,}|^\s+[A-Za-z]{3,}|[A-Za-z]{3,}\s+$|^[A-Z][a-z]+:\s*$/.test(node.text) && !/[\/?=&#<>{};]|https?:/.test(node.text) && !inValueContext(node)) push(node, 'concat', node.text);
      // tuple: a display string inside an array literal (not the inline [...].map(h => <th>{h}</th>) — tier 2 'array')
      else if (ts.isArrayLiteralExpression(p) && !(p.parent && ts.isPropertyAccessExpression(p.parent) && p.parent.name.text === 'map' && ts.isCallExpression(p.parent.parent)) && !inValueContext(node)) push(node, 'tuple', node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export function allFiles() { return [...files(SRC)]; }
/** tiers 1–3 (what the codemod could put behind keys); `{ tier4: true }` adds the tier-4 ratchet kinds */
export function scanAll(opts = {}) { const all = []; for (const f of files(SRC)) { all.push(...scanFile(f)); if (opts.tier4) all.push(...scanTier4File(f)); } return all; }
export function scanTier4All() { const all = []; for (const f of files(SRC)) all.push(...scanTier4File(f)); return all; }

if (import.meta.url === `file://${process.argv[1]}`) {
  const all = process.argv.includes('--tier4') ? scanTier4All() : scanAll({ tier4: process.argv.includes('--all') });
  if (process.argv.includes('--json')) { console.log(JSON.stringify(all)); process.exit(0); }
  if (process.argv.includes('--list')) { for (const s of all) console.log(`${s.file}:${s.line} [${s.kind}${s.attr ? ':' + s.attr : ''}] ${s.text}`); process.exit(0); }
  const byFile = new Map(); for (const s of all) byFile.set(s.file, (byFile.get(s.file) ?? 0) + 1);
  for (const [f, n] of [...byFile].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(5)}  ${f}`);
  console.log(`\n${all.length} untranslated strings in ${byFile.size} files`);
}
