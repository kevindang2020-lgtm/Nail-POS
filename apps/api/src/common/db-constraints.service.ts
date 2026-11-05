// db-constraints.service.ts — BUILD_PLAN Phase 10 (Constitution 1 §69–71, §111 "no dangerous migration remains
// unresolved"): retry the constraints a migration had to DEFER because the data did not satisfy them yet.
//
// Migrations 537–546 never fail a deploy over existing data. When a pre-flight finds blocking rows (duplicates before a
// unique index, orphans before a FK is validated, a row breaking a CHECK, a non-UUID value before a type change) the
// migration records a row in schema_deferred_constraints (534) with the exact statement to run later. This service is
// the ONE place that statement is run:
//   1. re-count the blocking rows NOW, from the catalogue (never from the row's free text);
//   2. zero → run retry_sql, mark resolved_at / resolved_by; still blocked → refresh the count and leave it open.
// Used by scripts/db-validate-constraints.mjs (operators, CI) and by the Super Admin Database page's "retry" action.
//
// retry_sql comes from a table, so it is run only when it has one of the four shapes the migrations write (VALIDATE
// CONSTRAINT, CREATE UNIQUE INDEX, ALTER COLUMN … TYPE uuid) with plain identifiers and no `;` — anything else is
// refused, whoever inserted it. Reasons hold counts only, never row contents.
import { CompiledQuery } from 'kysely';

export interface SqlRunner { query(text: string, params?: unknown[]): Promise<{ rows: any[] }> }
export interface DeferredConstraint {
  id: string; name: string; tableName: string; kind: string; migration: string; reason: string;
  blockingRows: number | null; retrySql: string | null; createdAt: string; resolvedAt: string | null; resolvedBy: string | null;
}
export type RetryOutcome =
  | { id: string; name: string; table: string; status: 'resolved'; blockingRows: 0 }
  | { id: string; name: string; table: string; status: 'still_blocked'; blockingRows: number }
  | { id: string; name: string; table: string; status: 'refused' | 'failed' | 'not_found' | 'already_resolved'; blockingRows: number | null; error?: string };

const IDENT = '[a-z_][a-z0-9_]{0,62}';
const SHAPES: RegExp[] = [
  new RegExp(`^ALTER TABLE (${IDENT}) VALIDATE CONSTRAINT (${IDENT})$`),
  new RegExp(`^CREATE UNIQUE INDEX IF NOT EXISTS (${IDENT}) ON (${IDENT}) \\(([^;()]*(?:\\([^;()]*\\)[^;()]*)*)\\)(?: WHERE ([^;]*))?$`),
  new RegExp(`^ALTER TABLE (${IDENT}) ALTER COLUMN (${IDENT}) TYPE uuid USING (${IDENT})::uuid$`),
];
/** The statement, when it is one of the shapes the Phase 10 migrations write — else null (refused). */
export function allowedRetrySql(sqlText: string | null | undefined): string | null {
  const s = String(sqlText ?? '').trim();
  if (!s || s.includes(';') || s.includes('--') || s.includes('/*')) return null;
  return SHAPES.some((re) => re.test(s)) ? s : null;
}

/** A pg Pool / PGlite / Kysely → the one `query(text, params)` this service needs. */
export function sqlRunner(db: any): SqlRunner {
  if (db && typeof db.executeQuery === 'function') return { query: async (text, params = []) => ({ rows: (await db.executeQuery(CompiledQuery.raw(text, params as unknown[]))).rows as any[] }) };
  if (db && typeof db.query === 'function') return { query: async (text, params = []) => { const r = await db.query(text, params); return { rows: r.rows ?? [] }; } };
  throw new Error('db-constraints: need a pg Pool, PGlite or Kysely');
}

const UUID_RE = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const qi = (s: string) => `"${s.replace(/"/g, '""')}"`;

export class DbConstraintsService {
  private readonly run: SqlRunner;
  constructor(db: any) { this.run = sqlRunner(db); }

  async list(opts: { includeResolved?: boolean } = {}): Promise<DeferredConstraint[]> {
    const r = await this.run.query(`select id::text, name, table_name, kind, migration, reason, blocking_rows, retry_sql, created_at, resolved_at, resolved_by
      from schema_deferred_constraints ${opts.includeResolved ? '' : 'where resolved_at is null'} order by created_at, name`);
    return r.rows.map((x) => ({ id: x.id, name: x.name, tableName: x.table_name, kind: x.kind, migration: x.migration, reason: x.reason,
      blockingRows: x.blocking_rows === null ? null : Number(x.blocking_rows), retrySql: x.retry_sql,
      createdAt: new Date(x.created_at).toISOString(), resolvedAt: x.resolved_at ? new Date(x.resolved_at).toISOString() : null, resolvedBy: x.resolved_by ?? null }));
  }

  /** Re-run the pre-flight count for one deferral, from the catalogue + the retry statement. null = cannot count (try it). */
  async blockingRows(d: Pick<DeferredConstraint, 'name' | 'tableName' | 'kind' | 'retrySql'>): Promise<number | null> {
    const stmt = allowedRetrySql(d.retrySql);
    if (!stmt) return null;
    let m: RegExpMatchArray | null;
    if ((m = stmt.match(SHAPES[0]))) {
      const [, table, con] = m;
      const c = (await this.run.query(`select contype, convalidated, pg_get_constraintdef(oid) as def, conkey, confrelid::regclass::text as ref, confkey
        from pg_constraint where conrelid = to_regclass($1) and conname = $2`, [table, con])).rows[0];
      if (!c) return null;
      if (c.convalidated) return 0;
      if (c.contype === 'c') {
        const expr = String(c.def).replace(/^CHECK\s*/i, '').replace(/\s+NOT VALID$/i, '');
        return Number((await this.run.query(`select count(*)::bigint as n from ${qi(table)} where not ${expr}`)).rows[0].n);
      }
      if (c.contype === 'f') {
        const cols = (await this.run.query(`select a.attname as col, (select attname from pg_attribute where attrelid = $3::regclass and attnum = $4) as refcol
          from pg_attribute a where a.attrelid = to_regclass($1) and a.attnum = $2`, [table, Number(c.conkey[0]), c.ref, Number(c.confkey[0])])).rows[0];
        if (!cols) return null;
        return Number((await this.run.query(`select count(*)::bigint as n from ${qi(table)} c where c.${qi(cols.col)} is not null
          and not exists (select 1 from ${c.ref.split('.').map(qi).join('.')} p where p.${qi(cols.refcol)} = c.${qi(cols.col)})`)).rows[0].n);
      }
      return null;
    }
    if ((m = stmt.match(SHAPES[1]))) {
      const [, , table, cols, where] = m;
      return Number((await this.run.query(`select count(*)::bigint as n from (select 1 from ${qi(table)} where ${where || 'true'} group by ${cols} having count(*) > 1) d`)).rows[0].n);
    }
    if ((m = stmt.match(SHAPES[2]))) {
      const [, table, col] = m;
      const t = (await this.run.query(`select data_type from information_schema.columns where table_schema = current_schema() and table_name = $1 and column_name = $2`, [table, col])).rows[0];
      if (!t) return null;
      if (t.data_type === 'uuid') return 0;
      return Number((await this.run.query(`select count(*)::bigint as n from ${qi(table)} where ${qi(col)} is not null and ${qi(col)}::text !~* '${UUID_RE}'`)).rows[0].n);
    }
    return null;
  }

  /** Retry one deferral by id. Never throws for a data problem — the outcome says what happened. */
  async retry(id: string, resolvedBy = 'db-validate-constraints'): Promise<RetryOutcome> {
    const d = (await this.list({ includeResolved: true })).find((x) => x.id === id);
    if (!d) return { id, name: '', table: '', status: 'not_found', blockingRows: null };
    const base = { id: d.id, name: d.name, table: d.tableName };
    if (d.resolvedAt) return { ...base, status: 'already_resolved', blockingRows: 0 };
    const stmt = allowedRetrySql(d.retrySql);
    if (!stmt) return { ...base, status: 'refused', blockingRows: d.blockingRows, error: 'retry_sql is not one of the statements a migration writes' };
    let n: number | null;
    try { n = await this.blockingRows(d); } catch (e) { return { ...base, status: 'failed', blockingRows: d.blockingRows, error: errText(e) }; }
    if (n !== null && n > 0) {
      await this.run.query(`update schema_deferred_constraints set blocking_rows = $2, reason = $3 where id = $1::uuid and resolved_at is null`,
        [d.id, Math.min(n, 2_147_483_647), `${n} blocking row(s) at the last retry`]);
      return { ...base, status: 'still_blocked', blockingRows: n };
    }
    try { await this.run.query(stmt); } catch (e) { return { ...base, status: 'failed', blockingRows: n, error: errText(e) }; }
    await this.run.query(`update schema_deferred_constraints set resolved_at = now(), resolved_by = $2, blocking_rows = 0 where id = $1::uuid`, [d.id, String(resolvedBy).slice(0, 100)]);
    return { ...base, status: 'resolved', blockingRows: 0 };
  }

  /** Retry every open deferral, oldest first. */
  async retryAll(resolvedBy = 'db-validate-constraints'): Promise<RetryOutcome[]> {
    const out: RetryOutcome[] = [];
    for (const d of await this.list()) out.push(await this.retry(d.id, resolvedBy));
    return out;
  }
}

/** The database's message (an SQLSTATE and its text), never parameters or row contents. */
function errText(e: unknown): string {
  const x = e as { code?: string; message?: string };
  return `${x?.code ? x.code + ' ' : ''}${String(x?.message ?? e).split('\n')[0].slice(0, 200)}`;
}
