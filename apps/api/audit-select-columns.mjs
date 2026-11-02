/* audit-select-columns.mjs — the half of check:sql that was never written.
 *
 * == THE GAP ==============================================================================================
 *
 * `check:sql` validates the column lists you WRITE:
 *
 *     insert into X (a, b, c)      ← checked
 *     update X set a = …           ← checked
 *     select a, b from X           ← NOT CHECKED. Never was.
 *
 * So this sailed straight through it:
 *
 *     select m.status, m.start_date, m.current_period_end from customer_memberships m
 *
 * `customer_memberships` has no `start_date`. The column is `started_at`. That is a guaranteed 500 the moment
 * anybody opens a customer with a membership — and it was invisible to everything:
 *
 *   • `tsc` cannot see it. The query is a string inside a template literal.
 *   • the unit tests cannot see it. The repository is mocked.
 *   • `check:sql` did not look.
 *
 * A pgtest caught it, by accident, because a pgtest is the only thing in this codebase that actually asks
 * Postgres. This closes the gap so the next one does not need luck.
 *
 * == WHAT IT CHECKS =======================================================================================
 *
 * Every `alias.column` reference inside a raw `sql`` ` template that contains a SELECT, resolved against the
 * schema built from the migrations. `from customer_memberships m` binds `m`; `m.start_date` is then either a
 * real column or a 500 waiting to happen.
 *
 * It does NOT check unaliased bare columns (`select status from x`) — those are ambiguous under a join and the
 * false-positive risk is not worth it. Aliased references are where the mistakes live anyway, because that is
 * how every multi-table query in this codebase is written.
 *
 * == AND THE PARSER HAD THREE BUGS BEFORE IT HAD NONE =====================================================
 *
 * On its first run it reported 79 findings. Every single one was wrong:
 *
 *   1. MULTI-COLUMN LINES. `category_id UUID, brand_id UUID, preferred_vendor_id UUID,` — the parser took only
 *      the first column per line, so `inventory_products` "lost" most of its schema and every read of it looked
 *      broken.  79 → 12.
 *   2. MULTI-COLUMN ALTERS. `ALTER TABLE chargebacks ADD COLUMN a…, ADD COLUMN b…;` — one ALTER, twelve ADDs,
 *      and the regex caught only the first.  12 → 1.
 *   3. DIGITS IN COLUMN NAMES. The name pattern was `[a-z_]+`. `account_last4` never parsed. Neither did any
 *      other column with a number in it, in any table.  1 → 0.
 *
 * The codebase had zero. The checker had three. That is the normal ratio, and it is why the sanity assertions
 * below run on every invocation: a checker that cries wolf will not be believed on the day it is right.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const TYPES = '(?:UUID|TEXT|BIGINT|INTEGER|INT|BOOLEAN|BOOL|TIMESTAMPTZ|TIMESTAMP|DATE|JSONB|JSON|NUMERIC|SERIAL|SMALLINT|DECIMAL|REAL|BYTEA|INET|CHAR|VARCHAR|TIME|CITEXT)';
const NAME = '([a-z_][a-z0-9_]*)';          // digits. account_last4, funds_recovered_cents, sha256_hash.
const SKIP = new Set(['primary', 'unique', 'foreign', 'check', 'constraint', 'exclude', 'like']);
const KEYWORDS = new Set(['on', 'where', 'set', 'as', 'using', 'left', 'inner', 'join', 'group', 'order', 'limit', 'and', 'or', 'select', 'cross', 'full', 'right', 'outer']);

// ── schema, from the migrations ───────────────────────────────────────────────────────────────────────────
const cols = new Map();
const add = (t, c) => { if (!cols.has(t)) cols.set(t, new Set()); cols.get(t).add(c); };

const migDir = join(ROOT, 'db/migrations');
for (const f of readdirSync(migDir).sort()) {
  const t = readFileSync(join(migDir, f), 'utf8');

  for (const m of t.matchAll(new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${NAME}\\s*\\(([\\s\\S]*?)\\n\\s*\\);`, 'gi'))) {
    const table = m[1].toLowerCase();
    const body = m[2].replace(/--[^\n]*/g, '');
    // split on TOP-LEVEL commas: a CHECK (x in ('a','b')) is one column, not three
    let depth = 0, part = '';
    const parts = [];
    for (const ch of body) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { parts.push(part); part = ''; } else part += ch;
    }
    parts.push(part);
    for (const p of parts) {
      const c = new RegExp(`^\\s*${NAME}\\s+${TYPES}`, 'i').exec(p);
      if (c && !SKIP.has(c[1].toLowerCase())) add(table, c[1].toLowerCase());
    }
  }

  // ONE ALTER, MANY ADD COLUMNs — up to the semicolon
  for (const m of t.matchAll(new RegExp(`ALTER TABLE\\s+${NAME}([\\s\\S]*?);`, 'gi'))) {
    const table = m[1].toLowerCase();
    for (const a of m[2].matchAll(new RegExp(`ADD COLUMN (?:IF NOT EXISTS )?${NAME}`, 'gi'))) {
      add(table, a[1].toLowerCase());
    }
  }
}

// ── the checker must not lie about the schema it built ────────────────────────────────────────────────────
const has = (t, c) => cols.get(t)?.has(c) ?? false;
const SANITY = [
  ['merchant_funding_profiles', 'account_last4', true],   // digits in the name  (bug 3)
  ['chargebacks', 'closed_at', true],                     // multi-column ALTER  (bug 2)
  ['inventory_products', 'barcode', true],                // multi-column line   (bug 1)
  ['customer_memberships', 'started_at', true],
  ['customer_memberships', 'start_date', false],          // the bug this file exists for
];
const broken = SANITY.filter(([t, c, want]) => has(t, c) !== want);
if (broken.length) {
  console.error('THE SCHEMA PARSER IS WRONG — refusing to report findings from a schema it cannot read.\n');
  for (const [t, c, want] of broken) console.error(`   ${t}.${c}: expected ${want ? 'PRESENT' : 'ABSENT'}, got ${has(t, c) ? 'PRESENT' : 'ABSENT'}`);
  process.exit(1);
}

// ── every aliased column reference inside a SELECT ────────────────────────────────────────────────────────
function walk(d, out = []) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(p)) out.push(p);
  }
  return out;
}

const findings = [];
for (const file of walk(join(ROOT, 'src'))) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/sql(?:<[^>]*>)?`([\s\S]*?)`/g)) {
    const q = m[1];
    if (!/\bselect\b/i.test(q)) continue;

    const alias = new Map();
    for (const f of q.matchAll(new RegExp(`\\b(?:from|join)\\s+${NAME}(?:\\s+as)?\\s+([a-z][a-z0-9_]*)\\b`, 'gi'))) {
      const t = f[1].toLowerCase(), a = f[2].toLowerCase();
      if (!KEYWORDS.has(a) && cols.has(t)) alias.set(a, t);
    }
    for (const c of q.matchAll(/\b([a-z][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/g)) {
      const a = c[1].toLowerCase(), col = c[2].toLowerCase();
      const t = alias.get(a);
      if (t && !has(t, col)) findings.push({ file: file.slice(ROOT.length + 5), ref: `${a}.${col}`, table: t, col });
    }
  }
}

const seen = new Set();
const uniq = findings.filter((f) => { const k = `${f.file}|${f.ref}|${f.table}`; return seen.has(k) ? false : seen.add(k); });

console.log('=== SELECT COLUMNS vs THE REAL SCHEMA ===\n');
console.log(`tables in schema:        ${cols.size}`);
console.log(`columns that do not exist on the table they are read from: ${uniq.length}\n`);

if (uniq.length) {
  console.log('These are 500s. `tsc` cannot see them (the query is a string), the unit tests cannot see them');
  console.log('(the repository is mocked), and check:sql never looked at SELECT columns.\n');
  for (const f of uniq) console.log(`   ${f.file}\n      ${f.ref}   →  '${f.table}' has no column '${f.col}'`);
  console.log('');
  process.exit(1);
}

console.log('OK — every aliased SELECT column resolves against the real schema.');
console.log('   (Bare unaliased columns are not checked: ambiguous under a join, and not worth the false alarms.)');
