#!/usr/bin/env node
// check-inert-controls.mjs — SCAN (Oct 12 2026): a control that looks live but does nothing is a "descriptive lie" (the
// screen audits found them by hand three times). This AST pass over every frontend's .tsx fails on:
//   INERT-BUTTON        a <button> with no onClick that is not a submit, not inside a <form>, not spread-props, and not disabled
//   NOOP-HANDLER        on<Event>={() => {}} / () => undefined / () => null
//   DEAD-LINK           <a href="#"> with no onClick
//   POINTER-NO-HANDLER  a div/span/tr/td/li/img with cursor:'pointer', no click handler and no enclosing <label>
//   CONTROLLED-NO-ONCHANGE  <input|select|textarea value=…> with no onChange / readOnly / disabled
//   FROZEN-DATE         a calendar date typed into the UI (JSX text or a value / defaultValue / label literal) — a mockup's
//                       "Today, May 06" or "Apr 06, 2026 – May 06, 2026" shown as if it were the current filter
// A disabled control with a reason (title) is honest and passes. Findings that pre-date the gate live in
// inert-controls.baseline.json keyed by file + kind + label (no line numbers) — the baseline only shrinks.
// Run: node tooling/ci/check-inert-controls.mjs [--write-baseline] [--app <dir>]
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ts = createRequire(join(ROOT, 'package.json'))('typescript');
const APPS = ['admin-web', 'pos-web', 'owner-web', 'tech-web', 'customer-web', 'customer-display', 'manager-pay-web'];
const BASELINE = join(ROOT, 'tooling', 'ci', 'inert-controls.baseline.json');

const FROZEN = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}(, \d{2,4})?\b(?! *(AM|PM))/;

export function scanSource(file, src) {
  const out = [];
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const line = (n) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const attrs = (el) => { const m = {}; let spread = false; for (const a of el.attributes.properties) { if (ts.isJsxSpreadAttribute(a)) spread = true; else if (a.name) m[a.name.getText()] = a.initializer ? a.initializer.getText() : 'true'; } return { m, spread }; };
  const label = (el) => { const p = el.parent; const t = ts.isJsxElement(p) ? p.children.map((c) => c.getText()).join('') : ''; return (t.replace(/<[^>]*>|\{[^}]*\}/g, ' ').replace(/\s+/g, ' ').trim() || '').slice(0, 40); };
  const inLabel = (n) => { for (let p = n.parent; p; p = p.parent) if (ts.isJsxElement(p) && p.openingElement.tagName.getText() === 'label') return true; return false; };
  const inForm = (n) => { for (let p = n.parent; p; p = p.parent) if (ts.isJsxElement(p) && p.openingElement.tagName.getText() === 'form') return true; return false; };
  const push = (kind, n, extra = '') => out.push({ file, line: line(n), kind, label: extra });
  const visit = (n) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = n.tagName.getText(); const { m: a, spread } = attrs(n);
      if (tag === 'button' && !spread && !a.onClick && !a.onPointerDown && !a.onMouseDown) {
        const submit = /submit/.test(a.type ?? '') || (inForm(n) && !a.type);
        const disabled = a.disabled !== undefined && a.disabled !== '{false}';
        if (!submit && !disabled) push('INERT-BUTTON', n, label(n));
      }
      if (/^(div|span|tr|td|li|img|p|section|article)$/.test(tag) && /cursor:\s*['"]pointer/.test(a.style ?? '') && !a.onClick && !a.onMouseDown && !a.onPointerDown && !spread && !inLabel(n)) push('POINTER-NO-HANDLER', n, label(n));
      for (const [k, v] of Object.entries(a)) if (/^on[A-Z]/.test(k) && /^\{\s*\(\s*\w*\s*\)\s*=>\s*(\{\s*\}|undefined|null|void 0)\s*\}$/.test(v)) push('NOOP-HANDLER', n, `${tag} ${k}`);
      if (/^(input|select|textarea)$/.test(tag) && a.value && !a.onChange && !a.readOnly && !a.disabled && !spread) push('CONTROLLED-NO-ONCHANGE', n, tag);
      if (tag === 'a' && /^["']#["']$/.test(a.href ?? '') && !a.onClick) push('DEAD-LINK', n, label(n));
    }
    if (ts.isJsxText(n) && FROZEN.test(n.getText())) push('FROZEN-DATE', n, n.getText().replace(/\s+/g, ' ').trim().slice(0, 40));
    if (ts.isJsxAttribute(n) && /^(value|defaultValue|label|title|aria-label)$/.test(n.name.getText()) && n.initializer && ts.isStringLiteral(n.initializer) && FROZEN.test(n.initializer.text)) push('FROZEN-DATE', n, n.initializer.text.slice(0, 40));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

export function scanApp(app) {
  const dir = join(ROOT, 'apps', app, 'src'); if (!existsSync(dir)) return [];
  const files = []; (function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx$/.test(f) && !/\.test\.tsx$/.test(f)) files.push(p); } })(dir);
  return files.flatMap((f) => scanSource(relative(ROOT, f), readFileSync(f, 'utf8')));
}
const key = (x) => `${x.file} | ${x.kind} | ${x.label}`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const only = process.argv.includes('--app') ? [process.argv[process.argv.indexOf('--app') + 1]] : APPS;
  const found = only.flatMap(scanApp);
  if (process.argv.includes('--write-baseline')) { writeFileSync(BASELINE, JSON.stringify([...new Set(found.map(key))].sort(), null, 1) + '\n'); console.log(`baseline: ${found.length} finding(s) written`); process.exit(0); }
  const base = new Set(existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : []);
  const fresh = found.filter((x) => !base.has(key(x)));
  const stale = [...base].filter((k) => !found.some((x) => key(x) === k));
  console.log(`inert controls: ${found.length} found, ${found.length - fresh.length} on the baseline, ${fresh.length} NEW, ${stale.length} baseline entr${stale.length === 1 ? 'y' : 'ies'} now fixed`);
  for (const x of fresh) console.log(`  NEW  ${x.file}:${x.line}  ${x.kind}  ${x.label}`);
  for (const k of stale) console.log(`  FIXED — remove from the baseline (--write-baseline):  ${k}`);
  process.exit(fresh.length ? 1 : 0);   // a fixed baseline entry is reported, not fatal: another lane's fix must not break the gate
}
