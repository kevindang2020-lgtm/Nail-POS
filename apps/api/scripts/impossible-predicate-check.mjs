// impossible-predicate-check.mjs — SQL that RUNS but can never BE TRUE.
//
// ══ THE BUG CLASS ═════════════════════════════════════════════════════════════════════════════════════════
//
// The POS "Service Done" badge counted:
//
//     select count(*) from ticket_service_lines where status = 'sent_to_service_done'
//
// That query is valid SQL. The table exists. The column exists. `check:sql` passes it. And it could **never match
// a row** — `sent_to_service_done` is a SERVING-TICKET status, mapped down to `tickets.status = 'service_done'`
// before it is ever written. The literal string is stored NOWHERE.
//
// So the badge read **0 forever**, and — because every badge count is wrapped in `.catch(() => 0)` — it failed
// **silently** and looked exactly like "there is nothing to show".
//
//     "The query runs" and "the query can be true" are different claims, and only the second one is worth
//     anything.
//
// `check:sql` cannot see this: it PREPAREs the statement, and the statement is fine. Only comparing the literal
// against the column's CHECK constraint can.
//
// ══ WHAT THIS CHECKS ══════════════════════════════════════════════════════════════════════════════════════
//
// Every `<col> = 'literal'` and `<col> IN ('a','b')` in raw SQL, against the CHECK constraint on that column.
// Where a column has no CHECK, it says so rather than guessing — a checker that invents a rule produces confident
// nonsense, which is the failure it exists to prevent.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const API = resolve(new URL('..', import.meta.url).pathname);
const MIG = join(API, 'db/migrations');
const SRC = join(API, 'src');

// ── the allowed values for every CHECK-constrained column ───────────────────────────────────────────────
// key: "table.column" -> Set(values)
const allowed = new Map();

for (const f of readdirSync(MIG).filter((x) => x.endsWith('.sql')).sort()) {
  const sql = readFileSync(join(MIG, f), 'utf8');

  // CHECK (col IN ('a','b',...)) — inside a CREATE TABLE, so we need the table it belongs to.
  const tables = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([a-z0-9_]+)\s*\(([\s\S]*?)\n\s*\);/gi;
  let t;
  while ((t = tables.exec(sql))) {
    const table = t[1].toLowerCase();
    const body = t[2];
    const checks = /CHECK\s*\(\s*([a-z0-9_]+)\s+IN\s*\(([^)]*)\)/gi;
    let c;
    while ((c = checks.exec(body))) {
      const col = c[1].toLowerCase();
      const vals = [...c[2].matchAll(/'([^']+)'/g)].map((m) => m[1]);
      if (vals.length) allowed.set(`${table}.${col}`, new Set(vals));
    }
  }

  // ALTER TABLE ... ADD CONSTRAINT ... CHECK (col IN (...))
  //
  // A CHECK constraint is not only declared at CREATE TABLE. Migration 375 REPLACES three of them, and a checker
  // that only read the original definitions would keep flagging code that the schema now permits — crying wolf on
  // correct code, which is how a checker gets ignored and the real findings get through with it.
  //
  // Two things the original pattern got wrong, both of which made it mis-attribute a table to ANOTHER statement's
  // values (and then flag correct code):
  //   1. `ADD CONSTRAINT` with a single literal space missed the migrations that write `ADD  CONSTRAINT` (two
  //      spaces) — so those redefinitions were never captured. → tolerate `ADD\s+CONSTRAINT`.
  //   2. an unbounded `[\s\S]*?` gap let the ALTER anchor of one table pair with a LATER `ADD CONSTRAINT` that
  //      belongs to a DIFFERENT table (e.g. a `DROP CONSTRAINT` line borrowing the next table's CHECK values). →
  //      a tempered gap that refuses to cross into another `ALTER TABLE` keeps each table on its own statement.
  const alters = /ALTER TABLE\s+([a-z0-9_]+)(?:(?!ALTER\s+TABLE)[\s\S])*?ADD\s+CONSTRAINT\s+[a-z0-9_]+\s*CHECK\s*\(\s*([a-z0-9_]+)\s+IN\s*\(([^)]*)\)/gi;
  let a;
  while ((a = alters.exec(sql))) {
    const table = a[1].toLowerCase();
    const col = a[2].toLowerCase();
    const vals = [...a[3].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    // REPLACES, not merges — an ALTER that drops and re-adds the constraint defines the new truth.
    if (vals.length) allowed.set(`${table}.${col}`, new Set(vals));
  }
}

// ── every literal comparison in raw SQL ─────────────────────────────────────────────────────────────────
function walk(d, acc = []) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(p)) acc.push(p);
  }
  return acc;
}

const codeLines = (s) =>
  s.split('\n').filter((l) => {
    const x = l.trim();
    return !(x.startsWith('//') || x.startsWith('*') || x.startsWith('/*') || x.startsWith('--'));
  }).join('\n');

const impossible = [];
const uncheckable = new Set();
let compared = 0;

// Constitution 13: the repositories (and their SQL) now live mostly in modules/*/src — walk those too, or this gate reads
// only what is left in the API.
const MODULES_DIR = join(API, '..', '..', 'modules');
const SQL_ROOTS = [SRC, ...(existsSync(MODULES_DIR) ? readdirSync(MODULES_DIR).map((m) => join(MODULES_DIR, m, 'src')).filter((d) => existsSync(d)) : [])];
for (const file of SQL_ROOTS.flatMap((r) => walk(r))) {
  const src = codeLines(readFileSync(file, 'utf8'));

  for (const m of src.matchAll(/sql(?:<[^>]*>)?`([\s\S]*?)`/g)) {
    const q = m[1].replace(/--[^\n]*/g, ' ');

    // Resolve ALIASES, not just the first table.
    //
    // My first version took the first FROM and assumed every column belonged to it. It then flagged
    // `c.status = 'configured'` as impossible because the FROM was `tenants` — when `c` was
    // `tenant_messaging_credentials`, where 'configured' is perfectly valid.
    //
    // That is a checker crying wolf on correct code, and a checker people learn to ignore is worse than no
    // checker: it is how the REAL ones get through.
    const aliases = new Map();          // alias -> table
    let defaultTable = null;
    for (const a of q.matchAll(/\b(?:from|join|update|into)\s+([a-z_][a-z0-9_]*)(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?/gi)) {
      const tbl = a[1].toLowerCase();
      const al = a[2]?.toLowerCase();
      if (['on', 'where', 'set', 'lateral', 'select', 'group', 'order', 'left', 'inner', 'join'].includes(tbl)) continue;
      if (!defaultTable) defaultTable = tbl;
      aliases.set(tbl, tbl);
      if (al && !['on', 'where', 'set', 'using', 'group', 'order', 'left', 'inner', 'join'].includes(al)) aliases.set(al, tbl);
    }
    if (!defaultTable) continue;

    // col = 'literal'   and   col IN ('a','b')
    //
    // THE RULE, and it is the whole difference between signal and noise:
    //
    //   `= 'x'`              -> dead if x cannot occur.
    //   `IN ('a','b')`       -> dead ONLY IF **NONE** of them can occur.
    //
    // A defensive `IN ('failed','error','undelivered')` where only 'failed' exists is FINE — the filter matches
    // the rows it means to, and the extras are harmless belt-and-braces against a schema that might grow. Flagging
    // those would bury the real ones, and a checker people learn to ignore is worse than no checker.
    //
    // `IN ('suppressed','blocked')` where NEITHER exists is a different thing entirely: that count is 0 forever.
    // Capture an optional `alias.` qualifier so the column is attributed to the RIGHT table.
    for (const p of q.matchAll(/\b(?:([a-z_][a-z0-9_]*)\.)?([a-z_][a-z0-9_]*)\s*(=|IN\s*\()\s*((?:'[^']*'\s*,?\s*)+)/gi)) {
      const qualifier = p[1]?.toLowerCase();
      const col = p[2].toLowerCase();
      // A qualified column belongs to whatever that alias resolves to. An unqualified one belongs to the first
      // table — which is only safe to assume when there is exactly ONE table in play.
      const table = qualifier ? aliases.get(qualifier) : (aliases.size <= 1 ? defaultTable : null);
      if (!table) continue;             // ambiguous in a join, and guessing is how a checker invents nonsense
      const key = `${table}.${col}`;
      const set = allowed.get(key);
      if (!set) { uncheckable.add(key); continue; }

      const values = [...p[4].matchAll(/'([^']+)'/g)].map((v) => v[1]);
      if (!values.length) continue;
      compared++;

      const anyPossible = values.some((v) => set.has(v));
      if (!anyPossible) {
        impossible.push({
          file: file.replace(SRC + '/', ''),
          key,
          value: values.join("', '"),
          allowed: [...set].join(', '),
        });
      }
    }
  }
}

console.log(`CHECK-constrained columns known: ${allowed.size}`);
console.log(`literal comparisons checked:     ${compared}`);
console.log(`columns with no CHECK (cannot verify — not guessed): ${uncheckable.size}`);

if (impossible.length) {
  console.log(`\n${'='.repeat(96)}`);
  console.log(`IMPOSSIBLE PREDICATES: ${impossible.length}  — these queries RUN, and can NEVER be true`);
  console.log('='.repeat(96));
  for (const i of impossible) {
    console.log(`\n  ${i.file}`);
    console.log(`     ${i.key} = '${i.value}'   ← not an allowed value`);
    console.log(`     allowed: ${i.allowed}`);
  }
  console.log('\nA query that cannot be true returns 0 / [] forever, and a .catch(() => 0) makes it silent.');
  process.exit(1);
}

console.log('\nOK — every literal compared against a CHECK-constrained column is a value that can actually occur.');
process.exit(0);
