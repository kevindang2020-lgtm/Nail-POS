#!/usr/bin/env node
// check-pos-i18n.mjs — Oct 21 2026 (Kevin: "Build Vietnamese for the POS"): the POS app never shows English a Vietnamese
// screen cannot translate. Every JSX text node and read attribute (title / placeholder / aria-label / alt) and the tier-2/3
// code contexts must be behind t('key') — the same scanner the codemod used (tooling/i18n/pos-strings.mjs). These must be 0.
//
// Vietnamese POS mandate (Oct 26 2026, build plan WP-K, §24 / §99 / §123) adds:
//   • TIER 4 — label maps, tuple arrays, rendered helper-call arguments, setX('text') state, `.replace(/_/g, ' ')` enum
//     renderers, raw status codes in JSX, and import-time (module-level) t() calls. RATCHETED per file against
//     tooling/i18n/pos-i18n-baseline.json: a file above its baseline FAILS; a new file starts at 0. The baseline may only
//     go DOWN: `--update` lowers each file to its current count and drops files that reached 0 — it never raises a count
//     or adds a file (a real need to raise one is a reviewed hand edit of the JSON with the reason in the commit).
//   • a report (warn, never fails) of namespace keys nothing references — literal keys and the dynamic prefixes the code
//     builds keys from (t(`status.${d}.${c}`) → 'status.') — and of duplicate English values inside one namespace.
// New keys go into apps/pos-web/src/i18n/ns/<ns>.{en,vi}.ts — the generated catalog.en.ts is frozen (the codemod refuses
// --write). Run: node tooling/ci/check-pos-i18n.mjs [--update] [--verbose]
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { scanAll, scanTier4All, allFiles } from '../i18n/pos-strings.mjs';

const REPO = new URL('../../', import.meta.url).pathname;
// POS_I18N_TREE (optional): read the POS sources from another checkout — `--update` against the COMMITTED tree (git archive
// HEAD) so a baseline never records another agent's uncommitted work
const ROOT = process.env.POS_I18N_TREE ? process.env.POS_I18N_TREE.replace(/\/?$/, '/') : REPO;
const BASELINE = join(REPO, 'tooling/i18n/pos-i18n-baseline.json');
const VERBOSE = process.argv.includes('--verbose');
let failed = false;

// ── tiers 1–3: must be zero ──────────────────────────────────────────────────────────────────────────────────────
const found = scanAll();
if (found.length) {
  failed = true;
  console.error(`❌ pos-i18n — ${found.length} English string(s) in the POS app are not behind t():`);
  for (const s of found.slice(0, 25)) console.error(`   ${s.file}:${s.line} [${s.kind}${s.attr ? ':' + s.attr : ''}] ${s.text.slice(0, 80)}`);
  if (found.length > 25) console.error(`   … and ${found.length - 25} more`);
  console.error('   fix: put the text behind t(\'<ns>.<area>.<item>\') with the key in apps/pos-web/src/i18n/ns/<ns>.en.ts + .vi.ts (catalog.en.ts is frozen)');
}

// ── tier 4: ratchet ─────────────────────────────────────────────────────────────────────────────────────────────
const t4 = scanTier4All();
const counts = {};
for (const s of t4) counts[s.file] = (counts[s.file] ?? 0) + 1;
const total = t4.length;
const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { files: {} };
const baseFiles = base.files ?? {};
const baseTotal = Object.values(baseFiles).reduce((a, b) => a + b, 0);

// ── the generated catalogue is frozen: its key count may only go down (no codemod / hand edit adds keys) ─────────────
const catalogKeys = (readFileSync(join(ROOT, 'apps/pos-web/src/i18n/catalog.en.ts'), 'utf8').match(/^\s*'(?:\\.|[^'\\])*':/gm) ?? []).length;
const frozenKeys = base.frozenCatalogKeys ?? catalogKeys;
if (catalogKeys > frozenKeys) {
  failed = true;
  console.error(`❌ pos-i18n — apps/pos-web/src/i18n/catalog.en.ts has ${catalogKeys} keys, above the frozen ${frozenKeys}: the generated catalogue takes no new keys — add them to apps/pos-web/src/i18n/ns/<ns>.{en,vi}.ts`);
}

const INIT = process.argv.includes('--init');
if (INIT && existsSync(BASELINE)) { console.error('pos-i18n: --init only creates a missing baseline; it exists — use --update (lowers only)'); process.exit(1); }
if (process.argv.includes('--update') || INIT) {
  const next = {};
  if (INIT) Object.assign(next, counts);
  else for (const [f, n] of Object.entries(baseFiles)) { const now = Math.min(n, counts[f] ?? 0); if (now > 0) next[f] = now; }
  const nextTotal = Object.values(next).reduce((a, b) => a + b, 0);
  writeFileSync(BASELINE, JSON.stringify({ note: 'tier-4 POS i18n ratchet (tooling/ci/check-pos-i18n.mjs): per-file count of label-map / tuple / helper / enum / status / module findings. May only go DOWN; --update lowers, never raises. frozenCatalogKeys: the generated catalog.en.ts key count (frozen; only goes down).', frozenCatalogKeys: Math.min(frozenKeys, catalogKeys), total: nextTotal, files: Object.fromEntries(Object.entries(next).sort()) }, null, 1) + '\n');
  console.log(`pos-i18n: baseline ${INIT ? 'created' : `lowered ${baseTotal} →`} ${nextTotal} (${Object.keys(next).length} files)`);
  const still = Object.entries(counts).filter(([f, n]) => n > (next[f] ?? 0));
  if (still.length) { console.error(`   ${still.length} file(s) are still above the baseline (not raised): ${still.map(([f]) => f).join(', ')}`); process.exit(1); }
  process.exit(0);
}

const worse = Object.entries(counts).filter(([f, n]) => n > (baseFiles[f] ?? 0));
if (worse.length) {
  failed = true;
  console.error(`❌ pos-i18n ratchet — ${worse.length} file(s) show more untranslated label maps / tuples / helper text / raw codes / import-time t() than their baseline:`);
  for (const [f, n] of worse) {
    console.error(`   ${f}: ${n} (baseline ${baseFiles[f] ?? 0})`);
    for (const s of t4.filter((x) => x.file === f).slice(0, 12)) console.error(`      :${s.line} [${s.kind}${s.attr ? ':' + s.attr : ''}] ${s.text.slice(0, 80)}`);
  }
  console.error('   fix: label → t(\'<ns>.<area>.<item>\') read at render (a getter / function, never at import); code → statusLabel(domain, code)');
}
const lower = Object.entries(baseFiles).filter(([f, n]) => (counts[f] ?? 0) < n).length;

// ── report: unused namespace keys, duplicate English values (warn only) ───────────────────────────────────────────
const NS_DIR = join(ROOT, 'apps/pos-web/src/i18n/ns');
const nsKeys = {};
for (const f of readdirSync(NS_DIR).filter((x) => x.endsWith('.en.ts'))) {
  const src = readFileSync(join(NS_DIR, f), 'utf8');
  const ns = f.slice(0, -'.en.ts'.length);
  nsKeys[ns] = {};
  const re = /^\s*'([^']+)':\s*(['"`])((?:\\.|(?!\2).)*)\2/gm; let m;
  while ((m = re.exec(src))) nsKeys[ns][m[1]] = m[3];
}
const used = new Set(); const prefixes = new Set(['status.', 'errors.']);
const KEYISH = /^[a-z][a-zA-Z0-9]*\.[A-Za-z0-9_.-]+$/;
const sources = [...allFiles(), ...readdirSync(join(ROOT, 'apps/pos-web/src/i18n')).filter((x) => /\.tsx?$/.test(x) && !/\.test\./.test(x)).map((x) => join(ROOT, 'apps/pos-web/src/i18n', x))];
for (const f of sources) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/(['"])([a-z][a-zA-Z0-9]*\.[A-Za-z0-9_.-]+)\1/g)) if (KEYISH.test(m[2])) used.add(m[2]);
  for (const m of src.matchAll(/`([a-z][a-zA-Z0-9]*\.[A-Za-z0-9_.-]*)\$\{/g)) prefixes.add(m[1]);
  for (const m of src.matchAll(/(['"])([a-z][a-zA-Z0-9]*\.(?:[A-Za-z0-9_.-]*\.)?)\1\s*\+/g)) prefixes.add(m[2]);
  // codeLabel('admin.audit.module', code) — the first argument is a key prefix for codes that arrive at run time
  for (const m of src.matchAll(/\bcodeLabel\(\s*(['"])([a-z][a-zA-Z0-9]*\.[A-Za-z0-9_.-]+)\1\s*,/g)) prefixes.add(m[2] + '.');
}
const unused = [], dups = [];
for (const [ns, keys] of Object.entries(nsKeys)) {
  for (const k of Object.keys(keys)) if (!used.has(k) && ![...prefixes].some((p) => k.startsWith(p))) unused.push(k);
  const byVal = new Map(); for (const [k, v] of Object.entries(keys)) { if (!byVal.has(v)) byVal.set(v, []); byVal.get(v).push(k); }
  for (const [v, ks] of byVal) if (ks.length > 1) dups.push(`${ns}: "${v.slice(0, 50)}" × ${ks.length} (${ks.slice(0, 3).join(', ')}${ks.length > 3 ? ' …' : ''})`);
}
if (unused.length) { console.log(`ℹ️  pos-i18n — ${unused.length} namespace key(s) not referenced by any POS file (literal or known dynamic prefix)${VERBOSE ? ':' : ' (--verbose lists them)'}`); if (VERBOSE) for (const k of unused) console.log(`   ${k}`); }
if (dups.length) { console.log(`ℹ️  pos-i18n — ${dups.length} duplicate English value(s) inside a namespace (consider one key)${VERBOSE ? ':' : ' (--verbose lists them)'}`); if (VERBOSE) for (const d of dups) console.log(`   ${d}`); }

if (failed) process.exit(1);
console.log(`✅ pos-i18n — every POS JSX text, read attribute and tier-2/3 text is behind t(); tier-4 ratchet ${total} (baseline ${baseTotal}, no file above it${lower ? `; ${lower} file(s) below — run --update to lower the baseline` : ''})`);
