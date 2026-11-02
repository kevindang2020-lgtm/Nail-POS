import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { IncidentRepositoryPort, IncidentRow, IncidentDetail, InsertIncidentInput, TransitionRecord, IncidentActor } from './incident.repository';
import { canMoveToSql, InvalidStateTransitionError } from '@aipowersalon/database';
import { SECURITY_INCIDENT } from '../lifecycles';

const n = (v: unknown) => Number(v) || 0;
const iso = (v: unknown) => { if (!v) return null; try { return new Date(v as any).toISOString(); } catch { return null; } };
const row = (r: any): IncidentRow => ({ id: String(r.id), incidentRef: r.incident_ref, title: r.title, category: r.category, severity: r.severity, status: r.status, tenant: r.tenant_id ? String(r.tenant_id) : null, branch: r.branch_id ? String(r.branch_id) : null, assignedTo: r.assigned_to_user_id ? String(r.assigned_to_user_id) : null, detectedAt: iso(r.detected_at), updatedAt: iso(r.updated_at) });
const audit = (db: any, actor: IncidentActor, action: string, ref: string, meta: any) => sql`insert into audit_events (occurred_at, actor_user_id, actor_role, actor_name, module, action, resource_type, resource_id, summary, status, severity, ip, metadata) values (now(), ${actor.userId}, ${actor.role}, ${actor.name}, 'security', ${action}, 'security_incident', ${ref}, ${`${action} ${ref}`}, 'success', 'warning', ${actor.ip}, ${JSON.stringify(meta)}::jsonb)`.execute(db).catch(() => undefined);

export class KyselyIncidentRepository implements IncidentRepositoryPort {
  constructor(private readonly db: AppDatabase) {}

  async insert(i: InsertIncidentInput, actor: IncidentActor): Promise<IncidentRow> {
    return (this.db as any).transaction().execute(async (trx: AppDatabase) => {
      const seqRow: any = await sql`select count(*)::int c from security_incidents where extract(year from created_at) = extract(year from now())`.execute(trx as any).then((x: any) => x.rows[0]);
      const ref = `INC-${new Date().getUTCFullYear()}-${String(n(seqRow?.c) + 1).padStart(3, '0')}`;
      const r: any = await sql`insert into security_incidents (incident_ref, title, description, category, severity, status, detection_source, tenant_id, branch_id, assigned_to_user_id, correlation_id, created_by) values (${ref}, ${i.title}, ${i.description}, ${i.category}, ${i.severity}, 'detected', ${i.detectionSource}, ${i.tenantId}, ${i.branchId}, ${i.assignedTo}, ${i.correlationId}, ${actor.userId}) returning *`.execute(trx as any).then((x: any) => x.rows[0]);
      await sql`insert into security_incident_events (incident_id, from_status, to_status, actor_user_id, reason, correlation_id) values (${r.id}, null, 'detected', ${actor.userId}, 'created', ${i.correlationId})`.execute(trx as any);
      await audit(trx, actor, 'security_incident_opened', ref, { severity: i.severity, category: i.category });
      return row(r);
    });
  }

  async get(id: string): Promise<IncidentDetail | null> {
    const r: any = await sql`select * from security_incidents where id = ${id} limit 1`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined);
    if (!r) return null;
    const ev: any[] = await sql`select from_status, to_status, actor_user_id, reason, occurred_at from security_incident_events where incident_id = ${id} order by occurred_at`.execute(this.db as any).then((x) => x.rows).catch(() => []);
    return { ...row(r), description: r.description ?? null, detectionSource: r.detection_source ?? null, correlationId: r.correlation_id ?? null, containedAt: iso(r.contained_at), resolvedAt: iso(r.resolved_at), events: ev.map((e) => ({ fromStatus: e.from_status ?? null, toStatus: e.to_status, actor: e.actor_user_id ? String(e.actor_user_id) : null, reason: e.reason ?? null, occurredAt: iso(e.occurred_at) })) };
  }

  async list(limit: number): Promise<IncidentRow[]> { const rows: any[] = await sql`select * from security_incidents order by detected_at desc limit ${limit}`.execute(this.db as any).then((x) => x.rows).catch(() => []); return rows.map(row); }

  async applyTransition(id: string, record: TransitionRecord, actor: IncidentActor): Promise<IncidentRow | null> {
    return (this.db as any).transaction().execute(async (trx: AppDatabase) => {
      const setTs = record.toStatus === 'contained' ? sql`, contained_at = now()` : record.toStatus === 'closed' ? sql`, resolved_at = now()` : sql``;
      const r: any = await sql`update security_incidents set status = ${record.toStatus}, updated_at = now()${setTs} where id = ${id} and status = ${record.fromStatus} and ${canMoveToSql(SECURITY_INCIDENT, record.toStatus)} returning *`.execute(trx as any).then((x: any) => x.rows[0]);
      if (!r) throw new InvalidStateTransitionError(SECURITY_INCIDENT, record.fromStatus, record.toStatus, 'concurrent');   // Phase 12 (#27)
      if (!r) return null;
      await sql`insert into security_incident_events (incident_id, from_status, to_status, actor_user_id, reason, correlation_id) values (${id}, ${record.fromStatus}, ${record.toStatus}, ${actor.userId}, ${record.reason}, ${record.correlationId})`.execute(trx as any);
      await audit(trx, actor, 'incident_status_changed', r.incident_ref, { from: record.fromStatus, to: record.toStatus, reason: record.reason });
      return row(r);
    });
  }

  async countByStatus(): Promise<Record<string, number>> { const rows: any[] = await sql`select status, count(*)::int c from security_incidents group by status`.execute(this.db as any).then((x) => x.rows).catch(() => []); const m: Record<string, number> = {}; rows.forEach((r) => { m[r.status] = n(r.c); }); return m; }
  async openCount(): Promise<number> { const r: any = await sql`select count(*)::int c from security_incidents where status <> 'closed'`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined); return n(r?.c); }
  async openedToday(): Promise<number> { const r: any = await sql`select count(*)::int c from security_incidents where detected_at::date = current_date`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined); return n(r?.c); }
}
