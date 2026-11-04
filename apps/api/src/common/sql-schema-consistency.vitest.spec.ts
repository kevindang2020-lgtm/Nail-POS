// sql-schema-consistency.vitest.spec.ts — every column a write touches must actually exist.
//
// WHY THIS EXISTS. Repositories across this codebase swallow write errors on purpose (an audit failure must not
// block a login; a DB blip must not sign everyone out). That is the right call — but it means a broken write
// CANNOT TELL YOU IT FAILED. It just silently does nothing, forever.
//
// That is not theoretical. `KyselyLoginAttemptSink` looked correct, was unit-tested green, and silently lost every
// record in production because `login_attempts.ip_address` is INET and Express hands you a proxy chain. The
// Super Admin Security dashboard would have gone right on reporting zero failed logins.
//
// 60 files in this codebase perform INSERT/UPDATE/DELETE inside an error-swallowing helper. Only a handful have a
// test that runs their real SQL against the real schema. Writing 54 more integration tests is not realistic —
// so this does the next best thing STATICALLY: it reads the migrations, learns every table's real columns, then
// checks every `insert into X (...)` and `update X set col = ...` in the source against them.
//
// It cannot catch a TYPE mismatch (that is what the PGlite tests are for). It CAN catch a column that does not
// exist — a renamed field, a typo, a table that drifted — which is the same silent-no-op class.
import { codeRoots } from '../../test-support/code-roots';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');
const MIGRATIONS = MIGRATIONS_DIR;

// ── learn the real schema from the migrations ──
function loadSchema(): Map<string, Set<string>> {
  const schema = new Map<string, Set<string>>();
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();

  for (const f of files) {
    // strip SQL comments first: a "-- Rollback: ALTER TABLE t DROP COLUMN c." note was read as a real DROP (false positive)
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8').replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

    // CREATE TABLE ... ( col type, col type, ... )
    for (const m of sql.matchAll(/create table (?:if not exists )?([a-z_0-9]+)\s*\(([\s\S]*?)\n\s*\);/gi)) {
      const table = m[1].toLowerCase();
      const cols = schema.get(table) ?? new Set<string>();
      // Columns may be declared SEVERAL PER LINE ("tenant_id UUID NOT NULL, branch_id UUID NOT NULL, ...").
      // Reading only the first per line produced false positives — and a guard that cries wolf is worse than no
      // guard, because it teaches everyone to ignore it. Split on commas at paren-depth 0 instead.
      // Strip inline SQL comments FIRST. They contain commas and parentheses ("-- |realized - point|, filled…",
      // "-- (from authoritative actuals)") which corrupted the comma-splitting and produced false positives.
      // A guard that cries wolf trains people to ignore it — the same way a dashboard of zeros taught everyone to
      // trust it. So the parser has to be right, or it should not ship.
      const body = m[2].replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const parts: string[] = [];
      let depth = 0, cur = '';
      for (const ch of body) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
      }
      parts.push(cur);
      for (const part of parts) {
        const c = part.trim().match(/^([a-z_0-9]+)\s+[a-z]/i);
        if (c && !/^(primary|unique|foreign|constraint|check|exclude|like)$/i.test(c[1])) cols.add(c[1].toLowerCase());
      }
      schema.set(table, cols);
    }

    // ALTER TABLE may add SEVERAL columns in one statement:
    //   ALTER TABLE t ADD COLUMN IF NOT EXISTS a TEXT, ADD COLUMN IF NOT EXISTS b TIMESTAMPTZ;
    // Matching only the first `add column` after `alter table` missed the rest — false positive #3. Capture the
    // whole statement (to the semicolon), then scan every add/drop/rename inside it.
    for (const stmt of sql.matchAll(/alter table\s+([a-z_0-9]+)([\s\S]*?);/gi)) {
      const table = stmt[1].toLowerCase();
      const body = stmt[2].replace(/--[^\n]*/g, '');
      const cols = schema.get(table) ?? new Set<string>();
      for (const a of body.matchAll(/add column\s+(?:if not exists\s+)?([a-z_0-9]+)/gi)) cols.add(a[1].toLowerCase());
      for (const d of body.matchAll(/drop column\s+(?:if exists\s+)?([a-z_0-9]+)/gi)) cols.delete(d[1].toLowerCase());
      for (const r of body.matchAll(/rename column\s+([a-z_0-9]+)\s+to\s+([a-z_0-9]+)/gi)) {
        cols.delete(r[1].toLowerCase()); cols.add(r[2].toLowerCase());
      }
      schema.set(table, cols);
    }
    // 543 adds actor stamps in a DO loop (EXECUTE format(...)) the regexes cannot read: updated_by on every tenant table
    // that has updated_at, deleted_by beside every deleted_at — mirror it for the tables that exist at that point
    if (/^543_actor_stamp_columns\.sql$/.test(f)) {
      for (const cols of schema.values()) {
        if (cols.has('updated_at') && cols.has('tenant_id')) cols.add('updated_by');
        if (cols.has('deleted_at')) cols.add('deleted_by');
      }
    }
  }
  return schema;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== 'node_modules') walk(p, out); }
    // exclude test files — including *.pgtest.ts helpers, which create their OWN local tables (false positive #4)
    else if (/\.ts$/.test(e) && !/\.(spec|test|pgtest)\.ts$/.test(e)) out.push(p);
  }
  return out;
}

interface Offence { file: string; table: string; column: string; kind: 'insert' | 'update' }

/** Find `insert into <table> (a, b, c)` and `update <table> set a = ..., b = ...` in the source. */
function scanWrites(src: string, file: string, schema: Map<string, Set<string>>): Offence[] {
  const out: Offence[] = [];

  for (const m of src.matchAll(/insert\s+into\s+([a-z_0-9]+)\s*\(([^)]*)\)/gi)) {
    const table = m[1].toLowerCase();
    const cols = schema.get(table);
    if (!cols) continue;                                  // unknown table (view/temp) — not our business
    for (const raw of m[2].split(',')) {
      const col = raw.trim().toLowerCase();
      if (!col || !/^[a-z_0-9]+$/.test(col)) continue;     // skip expressions
      if (!cols.has(col)) out.push({ file, table, column: col, kind: 'insert' });
    }
  }

  for (const m of src.matchAll(/update\s+([a-z_0-9]+)\s+set\s+([\s\S]{0,400}?)(?:\bwhere\b|`)/gi)) {
    const table = m[1].toLowerCase();
    const cols = schema.get(table);
    if (!cols) continue;
    for (const assign of m[2].split(',')) {
      const col = assign.trim().split(/\s*=/)[0].trim().toLowerCase();
      if (!col || !/^[a-z_0-9]+$/.test(col)) continue;
      if (col === 'sql') continue;                        // dynamically built SET clause
      if (!cols.has(col)) out.push({ file, table, column: col, kind: 'update' });
    }
  }
  return out;
}

describe('every column a write touches actually exists in the schema', () => {
  const schema = loadSchema();

  it('the migrations parsed into a real schema', () => {
    expect(schema.size).toBeGreaterThan(50);
    expect(schema.get('users')).toBeTruthy();
    expect(schema.get('login_attempts')?.has('ip_address')).toBe(true);
  });

  it('no INSERT or UPDATE references a column that does not exist', () => {
    const offences: Offence[] = [];
    for (const f of codeRoots().flatMap((r) => walk(r))) {
      // whole-line // comments are prose ("then ONE insert into promotion_eligibility_checks (738)"), not SQL
      const src = readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '');
      if (!/insert\s+into|update\s+[a-z_0-9]+\s+set/i.test(src)) continue;
      offences.push(...scanWrites(src, f.replace(SRC, 'src'), schema));
    }

    const lines = offences.map((o) => `${o.file}: ${o.kind.toUpperCase()} ${o.table}.${o.column} — no such column`);
    expect(
      lines,
      'These writes reference columns that do not exist in any migration.\n' +
      'Repositories here SWALLOW write errors on purpose, so these would fail SILENTLY and forever — the write ' +
      'simply never happens and nothing reports an error. (Exactly how the login-audit sink lost every record.)\n\n' +
      lines.join('\n'),
    ).toEqual([]);
  });
});
