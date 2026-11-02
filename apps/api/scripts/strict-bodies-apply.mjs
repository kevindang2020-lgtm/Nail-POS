#!/usr/bin/env node
// strict-bodies-apply.mjs — Security Deep Scan §40 (S-A14): turn on strict body validation (refuse unknown fields) for the
// routes the strict-bodies report proves safe, by rewriting `ValidatedBody(SCHEMA)` → `ValidatedBody(SCHEMA, { strict: true })`
// in each handler's signature. Input: apps/api/security/strict-bodies.report.json (STRICT_BODIES_REPORT=1 npx vitest run
// src/common/strict-bodies.vitest.spec.ts). Selection:
//   • verdict "safe"      — every first-party caller's body was read and every field it sends is declared;
//   • verdict "no-caller" — only on the realms whose only clients are this repository's apps (--no-caller-prefixes,
//                           default pos,super-admin,owner,tenant,auth); never public / device / integration / webhook routes.
// --skip-dirty (default on): files with uncommitted changes are left alone (another session may be editing them).
// --only=<path prefix,…> limits to source files under those prefixes. --dry lists without writing.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const DRY = process.argv.includes('--dry');
const SKIP_DIRTY = !process.argv.includes('--include-dirty');
const NO_CALLER = new Set(arg('no-caller-prefixes', 'pos,super-admin,owner,tenant,auth').split(',').filter(Boolean));
const ONLY = arg('only', '').split(',').filter(Boolean);
const EXCLUDE = arg('exclude', '').split(',').filter(Boolean);

const report = JSON.parse(readFileSync(join(HERE, '../security/strict-bodies.report.json'), 'utf8'));
const dirtyAll = SKIP_DIRTY ? execFileSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean).map((l) => l.slice(3).trim()) : [];
/** A file whose only uncommitted change is an earlier run's `, { strict: true }` insertions is not someone else's work. */
const onlyStrict = (f) => {
  try {
    const d = execFileSync('git', ['diff', '-U0', '--', f], { cwd: REPO, encoding: 'utf8' }).split('\n');
    const minus = d.filter((l) => l.startsWith('-') && !l.startsWith('---')).map((l) => l.slice(1));
    const plus = d.filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));
    return plus.length > 0 && plus.length === minus.length && plus.every((l, i) => l.replaceAll(', { strict: true }', '') === minus[i].replaceAll(', { strict: true }', ''));
  } catch { return false; }
};
const dirty = new Set(dirtyAll.filter((f) => !onlyStrict(f)));

function close(t, i) { let d = 0; for (; i < t.length; i++) { const c = t[i]; if (c === "'" || c === '"' || c === '`') { const q = c; for (i++; i < t.length && t[i] !== q; i++) if (t[i] === '\\') i++; continue; } if (c === '(') d++; else if (c === ')' && --d === 0) return i; } return -1; }
function topLevelComma(t) { let d = 0; for (let i = 0; i < t.length; i++) { const c = t[i]; if ('([{'.includes(c)) d++; else if (')]}'.includes(c)) d--; else if (c === ',' && d === 0) return true; } return false; }

/** Rewrite the ValidatedBody call in `handler`'s parameter list inside class `controller`. Returns the new source or null. */
export function strictify(src, controller, handler) {
  const cls = new RegExp(`class\\s+${controller}\\b`).exec(src); if (!cls) return null;
  const end = (() => { const n = src.slice(cls.index + 1).search(/\n(?:export\s+)?(?:@\w+\([^)]*\)\s*)*(?:export\s+)?class\s+\w+/); return n < 0 ? src.length : cls.index + 1 + n; })();
  const re = new RegExp(`(^|[\\s)])(?:async\\s+)?${handler}\\s*\\(`, 'g'); re.lastIndex = cls.index;
  for (let m = re.exec(src); m && m.index < end; m = re.exec(src)) {
    const open = m.index + m[0].length - 1; const c = close(src, open); if (c < 0) continue;
    const after = src.slice(c + 1, c + 400);
    if (!/^\s*(:[^{;=]*)?\{/.test(after)) continue;   // a call, not the definition
    const params = src.slice(open, c + 1);
    const vb = params.indexOf('ValidatedBody('); if (vb < 0) return null;
    const vbOpen = open + vb + 'ValidatedBody'.length; const vbClose = close(src, vbOpen); if (vbClose < 0) return null;
    const inner = src.slice(vbOpen + 1, vbClose);
    if (topLevelComma(inner)) return null;   // already has options — reviewed by hand
    return src.slice(0, vbClose) + ', { strict: true }' + src.slice(vbClose);
  }
  return null;
}

const picked = report.nonStrict.filter((r) => r.verdict === 'safe' || (r.verdict === 'no-caller' && NO_CALLER.has(r.key.split(' ')[1].split('/')[1])))
  .filter((r) => (!ONLY.length || ONLY.some((p) => r.file.startsWith(p))) && !EXCLUDE.some((p) => r.file.startsWith(p)));
const byFile = new Map();
for (const r of picked) { if (!byFile.has(r.file)) byFile.set(r.file, []); byFile.get(r.file).push(r); }
let changed = 0, skippedDirty = 0; const manual = [];
for (const [file, rs] of byFile) {
  if (dirty.has(file)) { skippedDirty += rs.length; continue; }
  const abs = join(REPO, file); let src = readFileSync(abs, 'utf8'); const seen = new Set();
  for (const r of rs) {
    const [controller, handler] = r.handler.split('.'); const k = `${controller}.${handler}`; if (seen.has(k)) continue; seen.add(k);
    const next = strictify(src, controller, handler);
    if (next) { src = next; changed++; } else manual.push(`${r.key}  (${file} ${k})`);
  }
  if (!DRY) writeFileSync(abs, src);
}
console.log(`strict-bodies-apply: ${picked.length} routes selected · ${changed} handlers made strict · ${skippedDirty} skipped (file has uncommitted changes) · ${manual.length} need a hand edit`);
for (const m of manual) console.log('  manual: ' + m);
