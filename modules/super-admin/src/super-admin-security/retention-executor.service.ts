// retention-executor.service.ts — Constitution 1 §55–57: the CENTRAL retention executor. Before Phase 10 retention was a
// versioned rule + a dry-run count (retention.service.ts) and a handful of piecemeal sweeps; nothing applied the policy.
//
// For every table the policy file hands to it ('executor': 'central'):
//   cutoff  = now − days (the Super Admin rule for the table's data class, when one is active and asks for the same action)
//   eligible = rows whose timestamp column is at or before the cutoff (+ the entry's status filter / not-referenced guard)
//   held     = eligible rows protected by an ACTIVE legal hold — customer_legal_holds (tenant / branch / customer scope) for
//              every table with a tenant, audit_legal_holds (global / tenant / user / date range) for security tables
//   then deletes (or anonymises) the rest in batches of 1,000 rows, each batch its own transaction, at most 200 batches per
//   table per run (the next run continues), and records one data_retention_purge_runs row per table (counts only, never
//   row contents). A dry run computes the same numbers and WRITES NOTHING — not even the run row.
// Financial and audit classes are refused by the core whatever the file says. A table that does not exist (or lacks the
// named column) is reported and skipped. Identifiers come from the reviewed policy file AND are checked against the live
// catalog before use; values are always bound parameters.
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { utcDate } from '@aipowersalon/date-time';
import { DATA_CLASSES } from './retention-core';
import {
  applySuperAdminRule, cutoffFor, executableEntries, loadPolicyFile, policyFilePath, type ExecutableRule, type RetentionPolicyFile,
} from './retention-executor-core';

export interface RetentionTableResult {
  table: string; dataClass: string; action: 'delete' | 'anonymize'; retentionClass: string; days: number; cutoff: string; source: string;
  eligible: number; held: number; processed: number; batches: number; skipped?: string; error?: string; note?: string;
}
export interface RetentionRunResult { mode: 'dry_run' | 'executed'; startedAt: string; durationMs: number; results: RetentionTableResult[]; invalidEntries: { table: string; problems: string[] }[] }
export interface RetentionExecutorOptions { policy?: RetentionPolicyFile | null; policyPath?: string; batchSize?: number; maxBatches?: number; now?: () => number }

const SECURITY_CLASSES = new Set(['security']);
const REMOVED = '[removed]';
const n = (v: unknown) => Number(v) || 0;
// Anonymised value per column: NULL where allowed; otherwise '[removed]' for text and an empty array/object for json(b).
const TEXT = new Set(['text', 'varchar', 'bpchar', 'citext']);
const JSONT = new Set(['json', 'jsonb']);
type ColMeta = { nullable: boolean; udt: string };
const anonymizable = (m: ColMeta) => m.nullable || TEXT.has(m.udt) || JSONT.has(m.udt);
function anonValue(c: string, m: ColMeta): RawBuilder<unknown> {
  if (m.nullable) return sql`null`;
  if (JSONT.has(m.udt)) return sql`(case jsonb_typeof(${sql.ref(c)}::jsonb) when 'array' then '[]' else '{}' end)::${sql.raw(m.udt === 'json' ? 'json' : 'jsonb')}`;
  return sql`${REMOVED}`;
}
function anonPending(c: string, m: ColMeta): RawBuilder<unknown> {
  const col = sql.ref(`t.${c}`);
  if (m.nullable) return sql`${col} is not null`;
  if (JSONT.has(m.udt)) return sql`${col}::jsonb not in ('[]'::jsonb, '{}'::jsonb)`;
  return sql`${col} is distinct from ${REMOVED}`;
}
const errText = (e: any) => `${e?.code ? e.code + ' ' : ''}${String(e?.message ?? e).split('\n')[0]}`.slice(0, 300);

export class RetentionExecutorService {
  private readonly batchSize: number; private readonly maxBatches: number; private readonly now: () => number;
  constructor(private readonly db: Kysely<any> | null, private readonly opts: RetentionExecutorOptions = {}) {
    this.batchSize = opts.batchSize ?? 1000; this.maxBatches = opts.maxBatches ?? 200; this.now = opts.now ?? Date.now;
  }

  policy(): RetentionPolicyFile | null {
    if (this.opts.policy !== undefined) return this.opts.policy;
    try { return loadPolicyFile(this.opts.policyPath ?? policyFilePath(MIGRATIONS_DIR)); } catch { return null; }
  }

  /** The effective rules (Super Admin overrides applied) — what a run would do, without counting anything. */
  async plan(): Promise<{ rules: (ExecutableRule & { note?: string })[]; invalidEntries: { table: string; problems: string[] }[] }> {
    const file = this.policy();
    if (!file) return { rules: [], invalidEntries: [{ table: '*', problems: ['retention policy file not found — the executor does nothing'] }] };
    const { rules, skipped } = executableEntries(file);
    const out: (ExecutableRule & { note?: string })[] = [];
    for (const r of rules) {
      const sa = (DATA_CLASSES as readonly string[]).includes(r.dataClass) ? await this.activeSuperAdminRule(r.dataClass) : null;
      const { rule, note } = applySuperAdminRule(r, sa);
      out.push(note ? { ...rule, note } : rule);
    }
    return { rules: out, invalidEntries: skipped };
  }

  async run(input: { dryRun: boolean; trigger: 'job' | 'manual'; actorUserId?: string | null; tables?: string[] }): Promise<RetentionRunResult> {
    const started = this.now();
    const { rules, invalidEntries } = await this.plan();
    const results: RetentionTableResult[] = [];
    if (!this.db) return { mode: input.dryRun ? 'dry_run' : 'executed', startedAt: new Date(started).toISOString(), durationMs: 0, results, invalidEntries };
    const only = input.tables?.length ? new Set(input.tables) : null;
    const auditHolds = await this.activeAuditHolds();
    for (const rule of rules) {
      if (only && !only.has(rule.table)) continue;
      const t0 = this.now();
      const r = await this.runTable(rule, input.dryRun, auditHolds).catch((e) => ({ ...this.blank(rule), error: errText(e) }));
      results.push(r);
      if (!input.dryRun && !r.skipped) await this.record(r, input, this.now() - t0);
    }
    return { mode: input.dryRun ? 'dry_run' : 'executed', startedAt: new Date(started).toISOString(), durationMs: this.now() - started, results, invalidEntries };
  }

  /** The UTC day of the last executed run the daily job made ('YYYY-MM-DD'), or null. */
  async lastJobRunDay(): Promise<string | null> {
    if (!this.db) return null;
    const r: any = await sql`select max(occurred_at) at from data_retention_purge_runs where triggered_by = 'job' and mode = 'executed'`.execute(this.db).then((x) => x.rows[0]);
    return r?.at ? utcDate(new Date(r.at)) : null;
  }

  async recentRuns(limit = 50): Promise<any[]> {
    if (!this.db) return [];
    const rows: any[] = await sql`select id, coalesce(table_name, data_class) as table_name, data_class, action, mode, cutoff, eligible_count, held_count, net_count, batches, duration_ms, triggered_by, actor_user_id, error, occurred_at
      from data_retention_purge_runs where table_name is not null order by occurred_at desc limit ${Math.max(1, Math.min(500, limit))}`.execute(this.db).then((x) => x.rows);
    return rows.map((r) => ({ id: String(r.id), table: r.table_name, dataClass: r.data_class, action: r.action, mode: r.mode, cutoff: r.cutoff ? new Date(r.cutoff).toISOString() : null,
      eligible: n(r.eligible_count), held: n(r.held_count), processed: n(r.net_count), batches: n(r.batches), durationMs: r.duration_ms == null ? null : n(r.duration_ms),
      trigger: r.triggered_by, actorUserId: r.actor_user_id ?? null, error: r.error ?? null, occurredAt: new Date(r.occurred_at).toISOString() }));
  }

  // ---- internals ----
  private blank(rule: ExecutableRule): RetentionTableResult {
    return { table: rule.table, dataClass: rule.dataClass, action: rule.action, retentionClass: rule.retentionClass, days: rule.days, cutoff: cutoffFor(this.now(), rule.days), source: rule.source, eligible: 0, held: 0, processed: 0, batches: 0, ...((rule as any).note ? { note: (rule as any).note } : {}) };
  }

  private async activeSuperAdminRule(dataClass: string): Promise<{ retentionDays: number; action: string } | null> {
    const r: any = await sql`select retention_days, action from data_retention_rules where data_class = ${dataClass} and status = 'active' order by version desc limit 1`
      .execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined);
    return r ? { retentionDays: n(r.retention_days), action: String(r.action) } : null;
  }

  private async activeAuditHolds(): Promise<{ scope_type: string; scope_value: string | null }[]> {
    // expiration_date is a calendar date set by a Super Admin (platform scope): compared with today's UTC day, passed in
    return sql`select scope_type, scope_value from audit_legal_holds where status = 'active' and (expiration_date is null or expiration_date >= ${utcDate(new Date(this.now()))}::date)`
      .execute(this.db as any).then((x: any) => x.rows).catch(() => []);
  }

  private async columns(table: string): Promise<Map<string, { nullable: boolean; udt: string }>> {
    const rows: any[] = await sql`select column_name, is_nullable, udt_name from information_schema.columns where table_schema = 'public' and table_name = ${table}`
      .execute(this.db as any).then((x) => x.rows);
    return new Map(rows.map((r) => [String(r.column_name), { nullable: r.is_nullable === 'YES', udt: String(r.udt_name) }]));
  }

  private async runTable(rule: ExecutableRule, dryRun: boolean, auditHolds: { scope_type: string; scope_value: string | null }[]): Promise<RetentionTableResult> {
    const res = this.blank(rule);
    const cols = await this.columns(rule.table);
    if (!cols.size) return { ...res, skipped: 'table does not exist' };
    const missing = [rule.timestampColumn, rule.where?.column, ...rule.anonymizeColumns].filter((c): c is string => !!c && !cols.has(c));
    if (missing.length) return { ...res, skipped: `column(s) not found: ${missing.join(', ')}` };
    for (const ref of rule.notReferencedBy) {
      const rc = await this.columns(ref.table);
      if (!rc.has(ref.column)) return { ...res, skipped: `not_referenced_by ${ref.table}.${ref.column} not found` };
    }
    const T = sql.table(rule.table);
    const ts = sql.ref(`t.${rule.timestampColumn}`);
    const parts: RawBuilder<unknown>[] = [sql`${ts} is not null and ${ts} <= ${res.cutoff}::timestamptz`];
    if (rule.where?.in?.length) parts.push(sql`${sql.ref(`t.${rule.where.column}`)} in (${sql.join(rule.where.in)})`);
    if (rule.where?.not_in?.length) parts.push(sql`${sql.ref(`t.${rule.where.column}`)} not in (${sql.join(rule.where.not_in)})`);
    for (const ref of rule.notReferencedBy) parts.push(sql`not exists (select 1 from ${sql.table(ref.table)} r where ${sql.ref(`r.${ref.column}`)} = t.id)`);
    if (rule.action === 'anonymize') {
      const bad = rule.anonymizeColumns.filter((c) => !anonymizable(cols.get(c)!));
      if (bad.length) return { ...res, skipped: `cannot anonymise column type: ${bad.join(', ')}` };
      parts.push(sql`(${sql.join(rule.anonymizeColumns.map((c) => anonPending(c, cols.get(c)!)), sql` or `)})`);
    }
    const base = sql.join(parts, sql` and `);

    // legal holds
    const holds: RawBuilder<unknown>[] = [];
    if (cols.has('tenant_id')) {
      const branch = cols.has('branch_id') ? sql`t.branch_id = h.branch_id` : sql`true`;          // no branch column: a branch hold protects the tenant's rows
      const customer = cols.has('customer_id') ? sql`t.customer_id = h.customer_id` : sql`false`;
      holds.push(sql`not exists (select 1 from customer_legal_holds h where h.status = 'active' and h.effective_at <= now() and h.tenant_id = t.tenant_id
        and (h.scope = 'tenant' or (h.scope = 'branch' and ${branch}) or (h.scope = 'customer' and ${customer})))`);
    }
    if (SECURITY_CLASSES.has(rule.retentionClass) && auditHolds.length) {
      if (auditHolds.some((h) => h.scope_type === 'global')) holds.push(sql`false`);
      const tenants = auditHolds.filter((h) => h.scope_type === 'tenant' && h.scope_value).map((h) => String(h.scope_value));
      if (tenants.length && cols.has('tenant_id')) holds.push(sql`(t.tenant_id is null or t.tenant_id::text not in (${sql.join(tenants)}))`);
      const users = auditHolds.filter((h) => h.scope_type === 'user' && h.scope_value).map((h) => String(h.scope_value));
      if (users.length && cols.has('user_id')) holds.push(sql`(t.user_id is null or t.user_id::text not in (${sql.join(users)}))`);
      for (const h of auditHolds.filter((x) => x.scope_type === 'date_range' && x.scope_value)) {
        const [a, b] = String(h.scope_value).split('|').map((s) => Date.parse(s));
        if (Number.isFinite(a) && Number.isFinite(b)) holds.push(sql`not (${ts} between ${new Date(a).toISOString()}::timestamptz and ${new Date(b).toISOString()}::timestamptz)`);
        else holds.push(sql`false`);   // an unreadable range: hold everything rather than guess
      }
    }
    const net = holds.length ? sql`${base} and ${sql.join(holds, sql` and `)}` : base;

    const count = async (pred: RawBuilder<unknown>) => n(((await sql`select count(*)::int c from ${T} t where ${pred}`.execute(this.db as any)).rows[0] as any)?.c);
    res.eligible = await count(base);
    const netCount = holds.length ? await count(net) : res.eligible;
    res.held = Math.max(0, res.eligible - netCount);
    if (dryRun || netCount === 0) return { ...res, processed: dryRun ? netCount : 0 };

    for (let i = 0; i < this.maxBatches; i++) {
      const affected = await (this.db as any).transaction().execute(async (trx: any) => {
        const q = rule.action === 'delete'
          ? sql`delete from ${T} where ctid in (select t.ctid from ${T} t where ${net} limit ${this.batchSize})`
          : sql`update ${T} set ${sql.join(rule.anonymizeColumns.map((c) => sql`${sql.ref(c)} = ${anonValue(c, cols.get(c)!)}`))}
                 where ctid in (select t.ctid from ${T} t where ${net} limit ${this.batchSize})`;
        const r: any = await q.execute(trx);
        return n(r.numAffectedRows ?? r.numUpdatedOrDeletedRows ?? 0);
      });
      res.batches++; res.processed += affected;
      if (affected < this.batchSize) break;
    }
    return res;
  }

  private async record(r: RetentionTableResult, input: { trigger: 'job' | 'manual'; actorUserId?: string | null }, durationMs: number): Promise<void> {
    await sql`insert into data_retention_purge_runs (data_class, mode, cutoff, eligible_count, net_count, actor_user_id, table_name, action, held_count, batches, duration_ms, triggered_by, error)
      values (${r.dataClass}, 'executed', ${r.cutoff}::timestamptz, ${r.eligible}, ${r.processed}, ${input.actorUserId ?? null}, ${r.table}, ${r.action}, ${r.held}, ${r.batches}, ${Math.round(durationMs)}, ${input.trigger}, ${r.error ?? null})`
      .execute(this.db as any);
  }
}
