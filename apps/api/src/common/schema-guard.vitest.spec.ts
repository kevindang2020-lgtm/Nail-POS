// schema-guard.vitest.spec.ts — raw SQL must reference tables that EXIST, and status values that CAN OCCUR.
//
// ── Why this test exists ─────────────────────────────────────────────────────────────────────────────────
// Two bugs of the same shape, found on the same day, neither caught by any existing test:
//
//   1. `owner-portfolio.repository.loadTotals()` selected from `queue_entries` — a table that does not exist.
//      Postgres threw, and `GET /owner/portfolio/summary` returned a 500. The entire All Salons dashboard was
//      dead in production.
//
//   2. `tenant-navigation.service.badges()` counted `ticket_service_lines WHERE status = 'sent_to_service_done'`.
//      Wrong table (that is a SERVING TICKET status) and wrong value (`sent_to_service_done` is domain
//      vocabulary that maps down to `tickets.status = 'service_done'` before it is written — the literal string
//      is stored NOWHERE). The predicate could not match a row under any circumstances, so the POS "Service
//      Done" badge read 0 forever.
//
// Neither was catchable by the existing suites, and (2) is the more dangerous kind. Every badge count is wrapped
// in `.catch(() => 0)` — correct in principle, so a missing count never breaks the sidebar — which means a wrong
// table or a wrong status FAILS SILENTLY and looks exactly like "there is nothing to show". No error. No red test.
// A dashboard confidently reporting zero is worse than one that admits it is broken.
//
// A unit test cannot catch this, because every repository test mocks the repository. Only the SCHEMA can. So
// this reads the migrations and checks the SQL against them.
import { codeRoots, sourcePath } from '../../test-support/code-roots';
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const API = resolve(process.cwd());                     // vitest cwd = apps/api
const MIGRATIONS = join(API, 'db/migrations');
const SRC = join(API, 'src');

// ── the real schema, parsed from the migration chain ───────────────────────────────────────────────────
function loadSchema() {
  const tables = new Map<string, Set<string>>();        // table -> columns
  const statuses = new Map<string, Set<string>>();      // table -> allowed status values (from CHECK)

  // The migration RUNNER creates one table itself — its schema_migrations ledger — so it is read from the runner's own
  // statement (scripts/migrate.mjs), not hand-listed here. Constitution 12's restore verifier reads that ledger.
  const runner = readFileSync(join(API, 'scripts/migrate.mjs'), 'utf8');
  const ledger = runner.match(/'CREATE TABLE IF NOT EXISTS (schema_migrations) \((.*?)\)'/);   // quote-delimited: the DDL contains now()
  if (ledger) tables.set(ledger[1], new Set(ledger[2].split(',').map((c) => c.trim().split(/\s+/)[0]).filter(Boolean)));

  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8');

    const create = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([a-z0-9_]+)\s*\(([\s\S]*?)\n\s*\);/gi;
    let m: RegExpExecArray | null;
    while ((m = create.exec(sql))) {
      const table = m[1].toLowerCase();
      const body = m[2];
      const cols = tables.get(table) ?? new Set<string>();
      for (const line of body.split('\n')) {
        const c = /^\s*([a-z0-9_]+)\s+[A-Za-z]/.exec(line);
        if (c && !['constraint', 'primary', 'unique', 'foreign', 'check'].includes(c[1].toLowerCase())) cols.add(c[1].toLowerCase());
      }
      tables.set(table, cols);

      // CHECK (status IN ('a','b',...)) — the set of values that can ever appear in that column.
      const chk = /CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)/i.exec(body);
      if (chk) {
        const vals = [...chk[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
        statuses.set(table, new Set(vals));
      }
    }

    const alter = /ALTER TABLE\s+([a-z0-9_]+)\s+ADD COLUMN(?:\s+IF NOT EXISTS)?\s+([a-z0-9_]+)/gi;
    while ((m = alter.exec(sql))) {
      const t = m[1].toLowerCase();
      if (!tables.has(t)) tables.set(t, new Set());
      tables.get(t)!.add(m[2].toLowerCase());
    }
  }
  return { tables, statuses };
}

const { tables, statuses } = loadSchema();

// ── the SQL the sidebar actually runs ──────────────────────────────────────────────────────────────────
const navSrc = readFileSync(sourcePath('tenant-navigation/tenant-navigation.service.ts'), 'utf8');   // API or owning module (Constitution 13)

/** Every `FROM <table> ... status = 'x'` / `status IN ('x','y')` pair in a source file. */
function statusPredicates(src: string): { table: string; value: string }[] {
  const out: { table: string; value: string }[] = [];
  // scan each sql`...` template independently so a table from one query is not paired with a status from another
  for (const m of src.matchAll(/sql`([\s\S]*?)`/g)) {
    const q = m[1].replace(/--[^\n]*/g, ' ');
    const t = /\bFROM\s+([a-z_][a-z0-9_]*)/i.exec(q);
    if (!t) continue;
    const table = t[1].toLowerCase();
    for (const s of q.matchAll(/\bstatus\s*(?:=|IN\s*\()\s*((?:'[^']*'\s*,?\s*)+)/gi)) {
      for (const v of s[1].matchAll(/'([^']+)'/g)) out.push({ table, value: v[1] });
    }
  }
  return out;
}

describe('schema guard — the sidebar badge queries', () => {
  it('parses a plausible schema (guards against the parser silently finding nothing)', () => {
    expect(tables.size).toBeGreaterThan(300);
    expect(tables.has('tickets')).toBe(true);
    expect(tables.has('pos_queue_items')).toBe(true);
  });

  it('every table the sidebar queries EXISTS', () => {
    // Scanned INSIDE the sql`` templates only. Scanning the raw file matches ordinary prose and TypeScript
    // ("...from session", "...from existing") and buries the one line that matters.
    const referenced: string[] = [];
    for (const m of navSrc.matchAll(/sql`([\s\S]*?)`/g)) {
      const q = m[1].replace(/--[^\n]*/g, ' ');
      for (const t of q.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gi)) referenced.push(t[1].toLowerCase());
    }
    const missing = [...new Set(referenced)].filter((t) => !tables.has(t));
    expect(missing, 'sidebar SQL references tables that do not exist').toEqual([]);
  });

  it('every status value the sidebar filters on CAN ACTUALLY OCCUR', () => {
    // This catches a status literal that a CHECK constraint forbids.
    //
    // HONEST LIMIT, and it matters: it only works where a CHECK EXISTS. `ticket_service_lines.status` has none,
    // so there is no allowed-value set to compare against — and this test therefore did NOT catch the original
    // Service Done bug. Only the explicit pin below did. The guard refuses to guess at a column's vocabulary
    // rather than invent a rule and produce confident nonsense, which is the same failure it exists to prevent.
    //
    // The durable fix is a CHECK on `ticket_service_lines.status`; until then, this test's coverage of that
    // table is zero and should not be mistaken for protection.
    const bad: string[] = [];
    for (const { table, value } of statusPredicates(navSrc)) {
      const allowed = statuses.get(table);
      if (!allowed) continue;                            // no CHECK constraint → cannot verify, do not guess
      if (!allowed.has(value)) bad.push(`${table}.status = '${value}' — allowed: ${[...allowed].join(', ')}`);
    }
    expect(bad, 'sidebar SQL filters on status values that can never occur').toEqual([]);
  });

  it('the Service Done badge counts the table that actually holds that state', () => {
    // Pinned explicitly: serving.kysely.repository writes `tickets.status = 'service_done'`, and the
    // service-done module reads `tickets.status in ('service_done','ready_checkout')`. The badge must agree
    // with the screen it links to, or it sends people to an empty page — or worse, hides a full one.
    const sqlOnly = [...navSrc.matchAll(/sql`([\s\S]*?)`/g)].map((m) => m[1]).join('\n');
    expect(sqlOnly).toContain("status = 'service_done'");
    // The literal is allowed to appear in the COMMENT that explains the bug — but never again in a query.
    expect(sqlOnly).not.toContain('sent_to_service_done');
  });
});

describe('schema guard — no raw SQL anywhere references a table that does not exist', () => {
  function walk(dir: string, acc: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, acc);
      else if (p.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(p)) acc.push(p);
    }
    return acc;
  }

  // Keywords and constructs that look like a table to a regex but are not one.
  const NOT_TABLES = new Set([
    'set', 'lateral', 'false', 'true', 'select', 'values', 'unnest', 'generate_series', 'skip',
    'jsonb_array_elements_text', 'jsonb_array_elements',   // set-returning functions (like unnest) — Phase 8 community repositories
    'information_schema', 'now', ...'abcdefghijklmnopqrstuvwxyz'.split(''),
    'excluded',   // ON CONFLICT's pseudo-table (`IS DISTINCT FROM EXCLUDED.col`, finance expense-settings summary stamps, Oct 27 2026)
  ]);

  it('holds across the whole API', () => {
    const bad: string[] = [];
    for (const file of codeRoots().flatMap((r) => walk(r))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/sql(?:<[^>]*>)?`([\s\S]*?)`/g)) {
        const q = m[1]
          .replace(/--[^\n]*/g, ' ')
          .replace(/\/\*[\s\S]*?\*\//g, ' ')
          // extract(hour FROM created_at) is not a table reference
          .replace(/\b(?:extract|substring|trim|overlay|position)\s*\([^()]*(?:\([^()]*\))?[^()]*\)/gi, ' ')
          .replace(/\bskip\s+locked\b/gi, ' ')
          // a row-locking clause names ALIASES of tables already in the FROM list (`FOR UPDATE OF d`), never a table —
          // without this, "UPDATE OF" read as an UPDATE of a table called "of" (customer-display heartbeat, Oct 2026)
          .replace(/\bfor\s+(?:no\s+key\s+update|update|share|key\s+share)\s+of\s+[a-z_][a-z0-9_]*(?:\s*,\s*[a-z_][a-z0-9_]*)*/gi, ' ');

        const ctes = new Set([...q.matchAll(/(?:\bwith\b|,)\s*([a-z_][a-z0-9_]*)\s+as\s*\(/gis)].map((c) => c[1].toLowerCase()));

        for (const t of q.matchAll(/\b(?:from|join|into|update)\s+([a-z_][a-z0-9_]*)/gi)) {
          const table = t[1].toLowerCase();
          if (NOT_TABLES.has(table) || ctes.has(table) || table.startsWith('pg_') || tables.has(table)) continue;
          bad.push(`${table}  [${file.replace(SRC + '/', '')}]`);
        }
      }
    }
    expect([...new Set(bad)], 'raw SQL references tables that do not exist').toEqual([]);
  });
});
