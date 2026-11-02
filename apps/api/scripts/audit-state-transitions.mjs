#!/usr/bin/env node
// audit-state-transitions.mjs — BUILD_PLAN Phase 12 / Constitution 5 §74–§78 (API_DEFINITION_OF_DONE #27): explicit state
// transitions, ONE machine per lifecycle, every writer through it.
//
//   node apps/api/scripts/audit-state-transitions.mjs                 check:state-transitions (static, no database)
//   node apps/api/scripts/audit-state-transitions.mjs --json          the full inventory
//   node apps/api/scripts/audit-state-transitions.mjs --update        rewrite the unguarded-writer baseline (only after a review)
//   node apps/api/scripts/audit-state-transitions.mjs --write-vocab   regenerate db/state-vocabularies.generated.json from the
//                                                                     MIGRATED schema (every migration on PGlite)
//
// Inputs: the status vocabularies (every `status` / `*_status` / `state` column with a `= ANY (ARRAY[…])` CHECK — the Phase 10
// vocabularies and the older inline ones) from the committed, generated vocab file (the pgtest keeps it equal to the
// migrated schema); every defineStateMachine({ name, table, column, states, … }) in apps/api/src and modules; every write
// of a vocabulary column (Kysely updateTable(…).set({ status }), raw `UPDATE t SET status =`, `ON CONFLICT … DO UPDATE SET
// status =`). Inserts are a row's FIRST state, not a transition — counted, not gated.
// The gate:
//   M1  a machine's table.column has a vocabulary CHECK, and every machine state is in it;
//   M2  at most ONE machine per table.column;
//   W1  a status UPDATE in a file that does not run that lifecycle's machine (assertTransition / transitionStatus with
//       the machine) is a finding — unless it is in the baseline (tooling/ci/state-transitions.allowlist.json, per
//       file|table.column count, which only shrinks);
//   W2  a baseline entry larger than today's count must be shrunk (--update);
//   V1  a literal value written to a vocabulary column must be in its CHECK (it fails at run time — and most such writers
//       swallow the error, so the row silently keeps its old state).
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const API = resolve(new URL('..', import.meta.url).pathname);
const ROOT = resolve(API, '..', '..');
const VOCAB = join(API, 'db/state-vocabularies.generated.json');
const ALLOWLIST = join(ROOT, 'tooling/ci/state-transitions.allowlist.json');

export const STATUS_COLUMN = /^(status|state|[a-z_]+_status)$/;

/** Vocabularies from CHECK definitions (pg_get_constraintdef text). */
export function vocabFromChecks(rows) {
  const out = {};
  for (const x of rows) for (const m of String(x.d).matchAll(/\(\(?([a-z_][a-z0-9_]*)\)?(?:::text)? = ANY \(\(?ARRAY\[([^\]]*)\]/g)) {
    if (!STATUS_COLUMN.test(m[1])) continue;
    const key = `${x.t}.${m[1]}`;
    out[key] = [...new Set([...(out[key] ?? []), ...[...m[2].matchAll(/'([^']*)'/g)].map((v) => v[1])])].sort();
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

export async function liveVocab() {
  const { migratedPglite } = await import(join(ROOT, 'packages/testing/src/pgtest-schema.mjs'));
  const pg = await migratedPglite();
  const r = await pg.query(`select c.conrelid::regclass::text t, pg_get_constraintdef(c.oid) d from pg_constraint c join pg_namespace s on s.oid = c.connamespace
                             where s.nspname = 'public' and c.contype = 'c' order by 1, c.conname`);
  return vocabFromChecks(r.rows);
}

function* walk(d) {
  for (const n of readdirSync(d)) {
    if (n === 'node_modules' || n === 'dist' || n.startsWith('.')) continue;
    const p = join(d, n); const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (p.endsWith('.ts') && !/\.(spec|test)\.ts$|vitest|pgtest|\.d\.ts$/.test(p)) yield p;
  }
}
const lineOf = (src, i) => src.slice(0, i).split('\n').length;
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));

/** defineStateMachine({ … }) definitions in one source: const name, machine name, table, column, states. */
export function machinesIn(src, file = '') {
  const out = [];
  for (const m of src.matchAll(/(?:export\s+)?const\s+(\w+)\s*=\s*defineStateMachine(?:<[^>]*>)?\(\s*\{/g)) {
    const body = src.slice(m.index + m[0].length, m.index + m[0].length + 4000);
    const get = (k) => new RegExp(`\\b${k}\\s*:\\s*'([^']+)'`).exec(body)?.[1];
    const states = /\bstates\s*:\s*\[([^\]]*)\]/.exec(body)?.[1];
    out.push({ file, constName: m[1], name: get('name'), table: get('table'), column: get('column') ?? 'status', states: states ? [...states.matchAll(/'([^']+)'/g)].map((x) => x[1]) : null, line: lineOf(src, m.index), at: m.index });
  }
  return out;
}

/** Status writes in one source for the vocabulary tables: { table, column, kind, line }. */
export function writesIn(src, vocabCols) {
  const out = [];
  const colsOf = (t) => vocabCols.get(t) ?? [];
  // Kysely: updateTable('t' [as a]) … .set({ … status … }) / .set('status', …) up to the statement end
  for (const m of src.matchAll(/updateTable\(\s*'([a-z_][a-z0-9_]*)(?:\s+as\s+\w+)?'\s*\)/g)) {
    const t = m[1]; const cols = colsOf(t); if (!cols.length) continue;
    const rest = src.slice(m.index, m.index + 1500);
    const stop = rest.slice(1).search(/updateTable\(|insertInto\(|selectFrom\(|deleteFrom\(|;\s*\n/);
    const chain = stop < 0 ? rest : rest.slice(0, stop + 1);
    for (const c of cols) if (new RegExp(`\\.set\\(\\s*(?:\\{[^]*?\\b${c}\\s*[:,}]|'${c}')`).test(chain)) out.push({ table: t, column: c, kind: 'update', line: lineOf(src, m.index), at: m.index });
    // .set(patch) — a variable: a write of the column when the file builds that variable with it
    const v = /\.set\(\s*([A-Za-z_$][\w$]*)\s*(?:as\s+\w+\s*)?\)/.exec(chain)?.[1];
    if (v) for (const c of cols) if (new RegExp(`\\b(?:const|let|var)\\s+${v}\\b[^;]*?\\{[^;]*?\\b${c}\\s*[:,}]|\\b${v}\\.${c}\\s*=(?!=)|\\b${v}\\[['"]${c}['"]\\]\\s*=(?!=)`).test(src)) out.push({ table: t, column: c, kind: 'update', line: lineOf(src, m.index), at: m.index });
  }
  // Kysely upsert: insertInto('t') … onConflict(…doUpdateSet({ … status … }))
  for (const m of src.matchAll(/insertInto\(\s*'([a-z_][a-z0-9_]*)'\s*\)/g)) {
    const t = m[1]; const cols = colsOf(t); if (!cols.length) continue;
    const rest = src.slice(m.index, m.index + 2500);
    const stop = rest.slice(1).search(/updateTable\(|insertInto\(|selectFrom\(|deleteFrom\(|;\s*\n/);
    const chain = stop < 0 ? rest : rest.slice(0, stop + 1);
    const ds = /doUpdateSet\(\s*(\{[\s\S]*?\})(?:\s+as\s+\w+)?\s*\)/.exec(chain)?.[1] ?? '';
    for (const c of cols) if (new RegExp(`\\b${c}\\s*:`).test(ds)) out.push({ table: t, column: c, kind: 'upsert', line: lineOf(src, m.index), at: m.index });
  }
  // raw SQL: UPDATE t [AS a] SET … col = … (the SET list up to WHERE / FROM / RETURNING / the template end)
  for (const m of src.matchAll(/\bupdate\s+([a-z_][a-z0-9_]*)(?:\s+(?:as\s+)?([a-z_]\w*))?\s+set\s+([\s\S]{1,1500}?)(?=\bwhere\b|\bfrom\b|\breturning\b|`|$)/gi)) {
    const t = m[1].toLowerCase(); const cols = colsOf(t); if (!cols.length) continue;
    const setList = m[3].replace(/'[^']*'/g, "''");
    for (const c of cols) if (new RegExp(`(^|[\\s,(])(?:\\w+\\.)?${c}\\s*=(?!=)`, 'i').test(setList)) out.push({ table: t, column: c, kind: 'update', line: lineOf(src, m.index), at: m.index });
  }
  // INSERT … ON CONFLICT … DO UPDATE SET col = (an upsert that moves an existing row)
  for (const m of src.matchAll(/\binsert\s+into\s+([a-z_][a-z0-9_]*)\b([\s\S]{0,2500}?)\bdo\s+update\s+set\s+([\s\S]{1,1200}?)(?=\bwhere\b|\breturning\b|`|;)/gi)) {
    const t = m[1].toLowerCase(); const cols = colsOf(t); if (!cols.length) continue;
    if (/\binsert\s+into\b/i.test(m[2])) continue;
    for (const c of cols) if (new RegExp(`(^|[\\s,(])${c}\\s*=`, 'i').test(m[3])) out.push({ table: t, column: c, kind: 'upsert', line: lineOf(src, m.index), at: m.index });
  }
  const seen = new Set();
  return out.filter((w) => { const k = `${w.table}.${w.column}:${w.line}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Literal values written to a vocabulary column (`status: 'x'` in a Kysely set / values, `status = 'x'` in raw SQL) — a
 *  value outside the CHECK fails at run time, and most of these writers swallow the error (`.catch(() => undefined)`). */
export function literalValuesIn(src, vocabCols) {
  const out = [];
  for (const m of src.matchAll(/(?:updateTable|insertInto)\(\s*'([a-z_][a-z0-9_]*)(?:\s+as\s+\w+)?'\s*\)/g)) {
    const t = m[1]; const cols = vocabCols.get(t) ?? []; if (!cols.length) continue;
    const rest = src.slice(m.index, m.index + 1500);
    const stop = rest.slice(1).search(/updateTable\(|insertInto\(|selectFrom\(|deleteFrom\(|;\s*\n/);
    const chain = stop < 0 ? rest : rest.slice(0, stop + 1);
    const body = [...chain.matchAll(/\.(?:set|values)\(\s*\{([^}]*)\}/g)].map((x) => x[1]).join(' ');
    for (const c of cols) for (const v of body.matchAll(new RegExp(`\\b${c}\\s*:\\s*'([^']+)'`, 'g'))) out.push({ table: t, column: c, value: v[1], line: lineOf(src, m.index), at: m.index });
  }
  for (const m of src.matchAll(/\bupdate\s+([a-z_][a-z0-9_]*)(?:\s+(?:as\s+)?[a-z_]\w*)?\s+set\s+([\s\S]{1,1500}?)(?=\bwhere\b|\bfrom\b|\breturning\b|`|$)/gi)) {
    const t = m[1].toLowerCase(); const cols = vocabCols.get(t) ?? []; if (!cols.length) continue;
    for (const c of cols) for (const v of m[2].matchAll(new RegExp(`(?:^|[\\s,(])${c}\\s*=\\s*'([^']+)'`, 'gi'))) out.push({ table: t, column: c, value: v[1], line: lineOf(src, m.index), at: m.index });
  }
  return out;
}

/** The statement a write sits in: from the match to its `.execute(` (sql templates and Kysely chains both end there). */
const statementAt = (src, at) => { const e = src.indexOf('.execute(', at); return src.slice(at, e < 0 ? at + 3000 : Math.min(e, at + 4000)); };
/** Is THIS write through machine `constName`: its own statement carries canMoveToSql(machine), or the code just before it
 *  (the same function, ~60 lines) asserts / transitions with the machine. */
const writeRunsMachine = (src, at, constName) =>
  new RegExp(`\\bcanMoveToSql\\s*\\(\\s*${constName}\\b`).test(statementAt(src, at))
  || new RegExp(`\\b(assertTransition|transitionStatus)\\s*\\(\\s*(?:[\\w.]+(?:\\s+as\\s+\\w+)?\\s*,\\s*)?${constName}\\b`).test(src.slice(Math.max(0, at - 4000), at));

export function inventory(vocab = JSON.parse(readFileSync(VOCAB, 'utf8')).vocabularies) {
  const vocabCols = new Map();
  for (const k of Object.keys(vocab)) { const [t, c] = k.split('.'); vocabCols.set(t, [...(vocabCols.get(t) ?? []), c]); }
  const machines = [], writes = [], badValues = [], srcOf = new Map();
  // shared platform machines (a table more than one module writes, e.g. api_idempotency) live in packages/*/src — their
  // DEFINITIONS are read; packages' own writes are not part of this audit (BUILD_PLAN Phase 12)
  for (const f of walk(join(ROOT, 'packages'))) {
    if (!/\/src\//.test(f) || /\.(test|spec)\.ts$/.test(f) || /\/dist\//.test(f)) continue;
    machines.push(...machinesIn(strip(readFileSync(f, 'utf8')), f.replace(ROOT + '/', '')));
  }
  for (const root of [join(ROOT, 'apps/api/src'), join(ROOT, 'modules')]) for (const f of walk(root)) {
    const rel = f.replace(ROOT + '/', ''); const src = strip(readFileSync(f, 'utf8'));
    srcOf.set(rel, src);
    machines.push(...machinesIn(src, rel));
    for (const w of writesIn(src, vocabCols)) writes.push({ file: rel, ...w });
    for (const v of literalValuesIn(src, vocabCols)) if (!(vocab[`${v.table}.${v.column}`] ?? []).includes(v.value)) badValues.push({ file: rel, ...v });
  }
  const byKey = new Map();
  for (const m of machines) if (m.table) byKey.set(`${m.table}.${m.column}`, [...(byKey.get(`${m.table}.${m.column}`) ?? []), m]);
  // transitionStatus(db, MACHINE, …) IS a status write — through its machine by construction
  const byConst = new Map(machines.map((m) => [m.constName, m]));
  for (const [file, src] of srcOf) for (const c of src.matchAll(/\btransitionStatus\s*\(\s*[^,()]+(?:\([^()]*\))?\s*,\s*(\w+)/g)) {
    const m = byConst.get(c[1]); if (!m) continue;
    writes.push({ file, table: m.table, column: m.column, kind: 'machine', line: lineOf(src, c.index) });
  }
  for (const w of writes) {
    if (w.kind === 'machine') { w.machine = byKey.get(`${w.table}.${w.column}`)?.[0]?.name ?? null; w.guarded = true; continue; }
    const ms = byKey.get(`${w.table}.${w.column}`) ?? [];
    w.machine = ms[0]?.name ?? null;
    w.guarded = ms.some((m) => writeRunsMachine(srcOf.get(w.file) ?? '', w.at, m.constName));
  }
  return { vocab, machines, writes, byKey, badValues };
}

export function check(inv = inventory(), allow = existsSync(ALLOWLIST) ? JSON.parse(readFileSync(ALLOWLIST, 'utf8')) : { unguarded: {} }) {
  const findings = [];
  for (const m of inv.machines) {
    const key = `${m.table}.${m.column}`;
    const v = inv.vocab[key];
    if (!m.table || !m.name) findings.push(`M1  ${m.file}:${m.line}  ${m.constName}: name and table must be string literals`);
    else if (!v) findings.push(`M1  ${m.file}:${m.line}  machine '${m.name}' governs ${key}, which has no vocabulary CHECK`);
    else if (!m.states) findings.push(`M1  ${m.file}:${m.line}  machine '${m.name}': states must be a literal array`);
    else for (const s of m.states) if (!v.includes(s)) findings.push(`M1  ${m.file}:${m.line}  machine '${m.name}' state '${s}' is not in ${key}'s CHECK (${v.join(', ')})`);
  }
  for (const b of inv.badValues ?? []) findings.push(`V1  ${b.file}:${b.line}  writes '${b.value}' to ${b.table}.${b.column} — not in its CHECK (${(inv.vocab[`${b.table}.${b.column}`] ?? []).join(', ')}); the write fails at run time`);
  for (const [key, ms] of inv.byKey) if (ms.length > 1) findings.push(`M2  ${key} has ${ms.length} machines (${ms.map((m) => `${m.name} @ ${m.file}`).join('; ')}) — ONE transition table per lifecycle`);
  const unguarded = {};
  for (const w of inv.writes) if (w.kind !== 'insert' && !w.guarded) { const k = `${w.file}|${w.table}.${w.column}`; unguarded[k] = (unguarded[k] ?? 0) + 1; }
  const base = allow.unguarded ?? {};
  for (const [k, n] of Object.entries(unguarded)) if (n > (base[k] ?? 0)) {
    const [file, col] = k.split('|');
    const lines = inv.writes.filter((w) => w.file === file && `${w.table}.${w.column}` === col && !w.guarded).map((w) => w.line).join(',');
    const m = inv.byKey.get(col)?.[0];
    findings.push(`W1  ${file}:${lines}  ${n} status write(s) to ${col} outside ${m ? `its machine '${m.name}' (run assertTransition / transitionStatus)` : 'any state machine (declare one in its module)'} — baseline ${base[k] ?? 0}`);
  }
  for (const [k, n] of Object.entries(base)) if ((unguarded[k] ?? 0) < n) findings.push(`W2  ${k}  baseline ${n} → ${unguarded[k] ?? 0}: run node apps/api/scripts/audit-state-transitions.mjs --update`);
  return { findings, unguarded };
}

export function summary(inv) {
  const written = new Set(inv.writes.filter((w) => w.kind !== 'insert').map((w) => `${w.table}.${w.column}`));
  const adopted = new Set(inv.machines.filter((m) => m.table).map((m) => `${m.table}.${m.column}`));
  const guarded = inv.writes.filter((w) => w.guarded).length;
  return { vocabularies: Object.keys(inv.vocab).length, lifecycles: written.size, machines: adopted.size, machinesOnWrittenLifecycles: [...adopted].filter((k) => written.has(k)).length, writes: inv.writes.length, guarded };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  if (process.argv.includes('--write-vocab')) {
    const v = await liveVocab();
    writeFileSync(VOCAB, JSON.stringify({ $comment: 'GENERATED by apps/api/scripts/audit-state-transitions.mjs --write-vocab from the MIGRATED schema (every status / *_status / state column with a `= ANY (ARRAY[...])` CHECK). Do not hand-edit; the pgtest fails when it drifts.', vocabularies: v }, null, 1) + '\n');
    console.log(`state-transitions: ${Object.keys(v).length} vocabularies written`); process.exit(0);
  }
  const inv = inventory();
  const r = check(inv);
  const s = summary(inv);
  if (process.argv.includes('--json')) { console.log(JSON.stringify({ summary: s, machines: inv.machines, writes: inv.writes, unguarded: r.unguarded, findings: r.findings }, null, 2)); await new Promise((r) => process.stdout.write('', r)); process.exit(0); }
  if (process.argv.includes('--update')) {
    const allow = existsSync(ALLOWLIST) ? JSON.parse(readFileSync(ALLOWLIST, 'utf8')) : {};
    const sorted = Object.fromEntries(Object.entries(r.unguarded).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(ALLOWLIST, JSON.stringify({ $comment: allow.$comment ?? 'check:state-transitions baseline — status writes not yet moved onto their lifecycle\'s state machine, per file|table.column. Only shrinks.', unguarded: sorted }, null, 2) + '\n');
    console.log(`state-transitions: baseline written (${Object.values(sorted).reduce((a, b) => a + b, 0)} unguarded writes in ${Object.keys(sorted).length} file|column pairs)`); process.exit(0);
  }
  for (const f of r.findings) console.log(f);
  console.log(`state-transitions: ${s.vocabularies} status vocabularies; ${s.lifecycles} written by an UPDATE (lifecycles); ${s.machines} machines (${s.machinesOnWrittenLifecycles} on written lifecycles); ${s.writes} status writes, ${s.guarded} through their machine; ${r.findings.length} findings`);
  process.exit(r.findings.length ? 1 : 0);
}
