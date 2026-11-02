// audit-engine.kysely.repository.ts — real Postgres driver for the Security Audit Engine.
// Locking reuses the platform's advisory-lock idiom (customer check-in / deals): pg_try_advisory_lock on a constant
// key serializes whole runs across every API instance — the "locking" requirement of the 1am architecture.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { CheckFinding } from './audit-engine-core';
import type { AuditEngineRepositoryPort, AuditRunRow, AuditFindingRow } from './audit-engine.repository';
import { canMoveToSql } from '@aipowersalon/database';
import { SECURITY_AUDIT_RUN, SECURITY_AUDIT_FINDING } from '../lifecycles';

const LOCK_KEY = 'security_audit_engine';

export class KyselyAuditEngineRepository implements AuditEngineRepositoryPort {
  constructor(private readonly db: AppDatabase) {}

  async withRunLock<T>(fn: () => Promise<T>): Promise<{ ran: boolean; result?: T }> {
    const got: any = await sql`select pg_try_advisory_lock(hashtextextended(${LOCK_KEY}, 0)) as ok`.execute(this.db as any).then((x: any) => x.rows[0]);
    if (!got?.ok) return { ran: false };                      // another instance is auditing right now
    try { return { ran: true, result: await fn() }; }
    finally { await sql`select pg_advisory_unlock(hashtextextended(${LOCK_KEY}, 0))`.execute(this.db as any).catch(() => {}); }
  }

  async startRun(trigger: 'scheduled' | 'manual', userId: string | null): Promise<string> {
    const r: any = await sql`insert into security_audit_runs (trigger, triggered_by_user_id) values (${trigger}, ${userId}) returning id`.execute(this.db as any).then((x: any) => x.rows[0]);
    return String(r.id);
  }

  async finishRun(id: string, p: { status: 'completed' | 'failed'; checksRun: number; findingsOpen: number; findingsResolved: number; error?: string | null }): Promise<void> {
    await sql`update security_audit_runs set status=${p.status}, finished_at=now(), checks_run=${p.checksRun}, findings_open=${p.findingsOpen}, findings_resolved=${p.findingsResolved}, error=${p.error ?? null} where id=${id} and ${canMoveToSql(SECURITY_AUDIT_RUN, p.status)}`.execute(this.db as any);
  }

  async lastCompletedAt(): Promise<string | null> {
    const r: any = await sql`select finished_at from security_audit_runs where status='completed' order by finished_at desc limit 1`.execute(this.db as any).then((x: any) => x.rows[0]).catch(() => undefined);
    return r?.finished_at ? new Date(r.finished_at).toISOString() : null;
  }

  async listRuns(limit: number): Promise<AuditRunRow[]> {
    const rows: any[] = await sql`select * from security_audit_runs order by started_at desc limit ${limit}`.execute(this.db as any).then((x: any) => x.rows).catch(() => []);
    return rows.map((r) => ({ id: String(r.id), trigger: r.trigger, status: r.status, startedAt: new Date(r.started_at).toISOString(), finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null, checksRun: Number(r.checks_run || 0), findingsOpen: Number(r.findings_open || 0), findingsResolved: Number(r.findings_resolved || 0), error: r.error ?? null }));
  }

  private mapFinding(r: any): AuditFindingRow {
    return { id: String(r.id), fingerprint: r.fingerprint, status: r.status, severity: r.severity, area: r.area, title: r.title, detail: r.detail ?? null, occurrences: Number(r.occurrences || 1), incidentId: r.incident_id ? String(r.incident_id) : null, openedAt: new Date(r.opened_at).toISOString(), resolvedAt: r.resolved_at ? new Date(r.resolved_at).toISOString() : null };
  }
  async allFindings(): Promise<AuditFindingRow[]> {
    const rows: any[] = await sql`select * from security_audit_findings`.execute(this.db as any).then((x: any) => x.rows).catch(() => []);
    return rows.map((r) => this.mapFinding(r));
  }
  async listFindings(status: string | null, limit: number): Promise<AuditFindingRow[]> {
    const rows: any[] = status
      ? await sql`select * from security_audit_findings where status=${status} order by opened_at desc limit ${limit}`.execute(this.db as any).then((x: any) => x.rows).catch(() => [])
      : await sql`select * from security_audit_findings order by opened_at desc limit ${limit}`.execute(this.db as any).then((x: any) => x.rows).catch(() => []);
    return rows.map((r) => this.mapFinding(r));
  }
  async insertFinding(runId: string, f: CheckFinding, incidentId: string | null): Promise<string> {
    const fp = `${f.area.trim().toLowerCase()}|${f.title.trim().toLowerCase()}`;
    const r: any = await sql`insert into security_audit_findings (fingerprint, area, title, detail, severity, first_seen_run, last_seen_run, incident_id)
      values (${fp}, ${f.area}, ${f.title}, ${f.detail}, ${f.severity}, ${runId}, ${runId}, ${incidentId}) returning id`.execute(this.db as any).then((x: any) => x.rows[0]);
    return String(r.id);
  }
  async bumpFinding(id: string, runId: string, f: CheckFinding): Promise<void> {
    await sql`update security_audit_findings set occurrences=occurrences+1, last_seen_run=${runId}, detail=${f.detail}, severity=${f.severity}, updated_at=now() where id=${id}`.execute(this.db as any);
  }
  async reopenFinding(id: string, runId: string, f: CheckFinding): Promise<void> {
    await sql`update security_audit_findings set status='reopened', occurrences=occurrences+1, last_seen_run=${runId}, detail=${f.detail}, severity=${f.severity}, resolved_at=null, resolved_run=null, updated_at=now() where id=${id} and ${canMoveToSql(SECURITY_AUDIT_FINDING, 'reopened')}`.execute(this.db as any);
  }
  async resolveFinding(id: string, runId: string): Promise<void> {
    await sql`update security_audit_findings set status='resolved', resolved_at=now(), resolved_run=${runId}, updated_at=now() where id=${id} and ${canMoveToSql(SECURITY_AUDIT_FINDING, 'resolved')}`.execute(this.db as any);
  }
}
