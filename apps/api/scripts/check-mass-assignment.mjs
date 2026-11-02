// check-mass-assignment.mjs — Constitution 5 G4 / §140: a client object never reaches an INSERT or UPDATE whole.
//
// THE FAILURE MODE
//     async update(id, body) { await db.updateTable('users').set({ ...body, updated_at: now }) … }
// A request that adds `"role": "OWNER"` or `"tenant_id": "<other salon>"` writes those columns. The type says
// `UpdateUserRequest`, but types are erased: at runtime the body carries whatever the client sent. The global
// ValidationPipe strips unknown fields only for CLASS-typed bodies, and on Oct 4 2026 every one of the 1,016 request
// bodies was an interface or `any` (measured from design:paramtypes) — so the pipe protects none of them yet.
//
// WHAT IT CHECKS — every Kysely `insertInto(…)…values(X)` / `updateTable(…)…set(X)` where X, or a `...spread` inside
// X, is a whole object rather than named fields. For each such object it finds how the object was built:
//   explicit        const set = { name: …, status: … } / set.x = … per field      → passes (that IS the allow-list)
//   SPREAD-OF-INPUT const set = { ...body } / Object.assign({}, input)               → FAILS
//   ALIAS           const patch = body / = req.body                                   → FAILS
//   DYNAMIC-KEYS    for (k of Object.keys(input)) set[k] = input[k]  (no allow-list)  → FAILS
//   PARAM-DIRECT    the object arrives as a function parameter (built by the caller)  → FAILS unless REVIEWED
// A direct `req.body` / `request.body` anywhere in a write fails regardless.
//
// REVIEWED (mass-assignment.reviewed.json): parameter-passed objects whose every caller was traced to an explicit
// allow-list, each with the reason. Keys are file + enclosing method + variable — not line numbers, which drift.
// An entry whose site disappears is reported so the list only shrinks with the code.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const REVIEWED_FILE = join(HERE, 'mass-assignment.reviewed.json');

function walk(d, acc = []) {
  for (const n of readdirSync(d)) {
    if (n === 'node_modules' || n === 'dist') continue;
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.endsWith('.ts') && !p.endsWith('.d.ts') && !/\.(spec|test)\.ts$/.test(p)) acc.push(p);
  }
  return acc;
}
const roots = () => [join(REPO, 'apps/api/src'), ...['modules', 'packages'].flatMap((top) => {
  const d = join(REPO, top); return existsSync(d) ? readdirSync(d).map((m) => join(d, m, 'src')).filter((p) => existsSync(p)) : [];
})];

function closeParen(t, i) {
  let d = 0;
  for (let j = i; j < t.length; j++) {
    const c = t[j];
    if (c === "'" || c === '"' || c === '`') { const q = c; j++; while (j < t.length && t[j] !== q) j += t[j] === '\\' ? 2 : 1; continue; }
    if ('([{'.includes(c)) d++; else if (')]}'.includes(c) && --d === 0) return j;
  }
  return -1;
}
const enclosingMethod = (t, pos) => {
  const re = /^[ \t]*(?:(?:private|public|protected|static|async|override)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^;]*?\)\s*(?::[^={;]*)?\{/gm;
  let m, last = '(top)'; while ((m = re.exec(t)) && m.index < pos) if (!['if', 'for', 'while', 'switch', 'catch', 'function'].includes(m[1])) last = m[1];
  return last;
};

/** Whole-object Kysely writes in one source text. */
export function writesIn(t) {
  const out = [];
  for (const m of t.matchAll(/\b(insertInto|updateTable)\s*\(/g)) {
    const semi = t.indexOf(';', m.index); const chain = t.slice(m.index, semi > 0 ? semi : m.index + 1500);
    for (const c of chain.matchAll(/\.(values|set)\(/g)) {
      // A chain call follows `)` (…insertInto('t').values(…)); `this.values(e)` INSIDE an argument is a mapper call, not a write.
      if (!/\)\s*$/.test(chain.slice(0, c.index))) continue;
      const a = m.index + c.index + c[0].length - 1; const b = closeParen(t, a); if (b < 0) continue;
      const arg = t.slice(a + 1, b);
      const names = [...arg.matchAll(/\.\.\.\s*([A-Za-z_$][\w$.]*)/g)].map((x) => x[1]);
      const bare = /^\s*([A-Za-z_$][\w$.]*)\s*(?:as\s+\w+\s*)?$/.exec(arg); if (bare) names.push(bare[1]);
      for (const name of names) out.push({ op: c[1], name, pos: a, line: t.slice(0, a).split('\n').length, direct: /\b(?:req|request)\.body\b/.test(arg) });
    }
  }
  return out;
}

const INPUTISH = /\.\.\.\s*(?:input|body|dto|patch|data|payload|req|request|changes|update|params|args|b|p|i|d)\b(?!\s*\.)|\.\.\.\s*(?:req|request)\.body\b/;
/** How the written object was built. */
export function classify(t, w) {
  if (w.direct) return 'REQUEST-BODY';
  const root = w.name.split('.')[0];
  if (root === 'this' || /^[A-Z]/.test(root)) return 'explicit';            // a mapper method / static helper
  const before = t.slice(Math.max(0, w.pos - 6000), w.pos);
  const decls = [...before.matchAll(new RegExp(String.raw`\b(?:const|let|var)\s+${root.replace(/\$/g, '\\$')}\b[^=;]*=\s*([\s\S]*?);`, 'g'))];
  if (!decls.length) return 'PARAM-DIRECT';   // a parameter (or an outer binding): its callers decide — review required
  const d = decls[decls.length - 1]; const rhs = d[1].trim(); const after = before.slice(d.index);
  if (/^Object\.assign\s*\(/.test(rhs) || INPUTISH.test(rhs)) return 'SPREAD-OF-INPUT';
  if (/^(?:req|request)\.body\b/.test(rhs) || /^[A-Za-z_$][\w$.]*(\s+as\s+\w+)?$/.test(rhs)) return 'ALIAS';
  if (new RegExp(String.raw`${root}\s*\[\s*[A-Za-z_$][\w$]*\s*\]\s*=`).test(after)
      && !/\b(ALLOW\w*|PATCHABLE\w*|EDITABLE\w*|WRITABLE\w*|[A-Z_]*FIELDS|[A-Z_]*COLUMNS|allowed\w*|fieldMap|FIELD_MAP)\b/.test(after)) return 'DYNAMIC-KEYS';
  return 'explicit';
}

export function scan(files = roots().flatMap((r) => walk(r))) {
  const sites = [];
  for (const f of files) {
    const t = readFileSync(f, 'utf8'); if (!/insertInto|updateTable/.test(t)) continue;
    for (const w of writesIn(t)) sites.push({ file: relative(REPO, f), method: enclosingMethod(t, w.pos), name: w.name, op: w.op, line: w.line, kind: classify(t, w) });
  }
  return sites;
}
export const siteKey = (s) => `${s.file}|${s.method}|${s.name}`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const reviewed = existsSync(REVIEWED_FILE) ? JSON.parse(readFileSync(REVIEWED_FILE, 'utf8')) : [];
  const ok = new Map(reviewed.map((r) => [r.key, r]));
  const sites = scan();
  const counts = sites.reduce((a, s) => ((a[s.kind] = (a[s.kind] || 0) + 1), a), {});
  const failing = sites.filter((s) => s.kind !== 'explicit' && !(s.kind === 'PARAM-DIRECT' && ok.has(siteKey(s))));
  const stale = reviewed.filter((r) => !sites.some((s) => siteKey(s) === r.key));
  console.log(`check:mass-assignment: ${sites.length} whole-object writes — ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}; reviewed ${reviewed.length}`);
  if (stale.length) { console.error(`\nReviewed entries whose write no longer exists — remove them from ${relative(REPO, REVIEWED_FILE)}:`); for (const r of stale) console.error(`  ${r.key}`); }
  if (failing.length) {
    console.error('\nA client object may reach an INSERT/UPDATE whole. Build the row field by field (that is the allow-list),');
    console.error('or — for an object built by its callers — trace every caller and add a reviewed entry with the reason.\n');
    for (const s of failing) console.error(`  ${s.kind.padEnd(16)} ${s.file}:${s.line}  ${s.method}() .${s.op}(${s.name})   key: ${siteKey(s)}`);
  }
  process.exit(failing.length || stale.length ? 1 : 0);
}
