import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { RetentionRepositoryPort, RetentionRow, RetentionActor } from './retention.repository';
import { canMoveToSql } from '@aipowersalon/database';
import { DATA_RETENTION_RULE } from '../lifecycles';

const n = (v: unknown) => Number(v) || 0;
const iso = (v: unknown) => { if (!v) return null; try { return new Date(v as any).toISOString(); } catch { return null; } };
const map = (r: any): RetentionRow => ({ id: String(r.id), dataClass: r.data_class, version: n(r.version), status: r.status, retentionDays: n(r.retention_days), action: r.action, scope: r.scope, target: r.target ?? null, createdAt: iso(r.created_at) });

// Allowlist of safely-countable data classes → (table, timestamp column). Only these support a dry-run count.
const COUNTABLE: Record<string, { table: string; col: string }> = {
  audit_events: { table: 'audit_events', col: 'occurred_at' },
  login_attempts: { table: 'login_attempts', col: 'created_at' },
  report_exports: { table: 'report_exports', col: 'created_at' },
};

export class KyselyRetentionRepository implements RetentionRepositoryPort {
  constructor(private readonly db: AppDatabase) {}
  async getActive(dataClass: string) { const r: any = await sql`select * from data_retention_rules where data_class = ${dataClass} and status = 'active' order by version desc limit 1`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined); return r ? map(r) : null; }
  async listVersions(dataClass: string) { const rows: any[] = await sql`select version from data_retention_rules where data_class = ${dataClass}`.execute(this.db as any).then((x) => x.rows).catch(() => []); return rows.map((r) => n(r.version)); }
  async insertActive(dataClass: string, version: number, retentionDays: number, action: string, actor: RetentionActor): Promise<RetentionRow> {
    return (this.db as any).transaction().execute(async (trx: AppDatabase) => {
      await sql`update data_retention_rules set status = 'archived', updated_at = now() where data_class = ${dataClass} and status = 'active' and ${canMoveToSql(DATA_RETENTION_RULE, 'archived')}`.execute(trx as any);
      const r: any = await sql`insert into data_retention_rules (data_class, version, status, retention_days, action, created_by) values (${dataClass}, ${version}, 'active', ${retentionDays}, ${action}, ${actor.userId}) returning *`.execute(trx as any).then((x: any) => x.rows[0]);
      // A platform rule's audit row goes to audit_logs (tenant_id nullable). It used to go to audit_events, whose tenant_id is
      // NOT NULL: the insert failed, `.catch` hid it, but PostgreSQL had aborted the transaction — COMMIT became ROLLBACK and
      // the rule was never stored (Phase 10, found by live-phase10-database). A savepoint keeps an audit failure from ever
      // taking the rule down with it again.
      await sql`savepoint retention_rule_audit`.execute(trx as any);
      try {
        await sql`insert into audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, ip_address, metadata_json) values (null, ${actor.userId}, ${actor.role}, 'security.retention_rule_changed', 'data_retention_rule', ${dataClass}, ${actor.ip}::inet, ${JSON.stringify({ version, retentionDays, action, summary: `${dataClass} retention v${version}: ${retentionDays}d ${action}`, actorName: actor.name ?? null })}::jsonb)`.execute(trx as any);
        await sql`release savepoint retention_rule_audit`.execute(trx as any);
      } catch { await sql`rollback to savepoint retention_rule_audit`.execute(trx as any); }
      return map(r);
    });
  }
  async list(limit: number) { const rows: any[] = await sql`select * from data_retention_rules order by data_class, version desc limit ${limit}`.execute(this.db as any).then((x) => x.rows).catch(() => []); return rows.map(map); }
  async previewCount(dataClass: string, cutoff: string): Promise<{ supported: boolean; count: number }> {
    const m = COUNTABLE[dataClass]; if (!m) return { supported: false, count: 0 };
    const q = sql`select count(*)::int c from ${sql.ref(m.table)} where ${sql.ref(m.col)} <= ${cutoff}`;
    const r: any = await q.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined);
    return { supported: true, count: n(r?.c) };
  }
  async recordPurgeRun(dataClass: string, mode: string, cutoff: string, eligible: number, net: number, actor: RetentionActor) {
    await sql`insert into data_retention_purge_runs (data_class, mode, cutoff, eligible_count, net_count, actor_user_id) values (${dataClass}, ${mode}, ${cutoff}, ${eligible}, ${net}, ${actor.userId})`.execute(this.db as any).catch(() => undefined);
    await sql`insert into audit_events (occurred_at, actor_user_id, actor_role, actor_name, module, action, resource_type, resource_id, summary, status, severity, ip, metadata) values (now(), ${actor.userId}, ${actor.role}, ${actor.name}, 'security', 'retention_purge_preview', 'data_retention_rule', ${dataClass}, ${`${dataClass} purge ${mode}: ${net} eligible`}, 'success', 'info', ${actor.ip}, ${JSON.stringify({ mode, net })}::jsonb)`.execute(this.db as any).catch(() => undefined);
  }
}
