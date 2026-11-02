import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { GrantRepositoryPort, GrantRow, GrantActor, GrantFields } from './grant.repository';
import { canMoveToSql, InvalidStateTransitionError } from '@aipowersalon/database';
import { PRIVILEGED_ACCESS_GRANT } from '../lifecycles';

const n = (v: unknown) => Number(v) || 0;
const iso = (v: unknown) => { if (!v) return null; try { return new Date(v as any).toISOString(); } catch { return null; } };
const map = (r: any): GrantRow => ({ id: String(r.id), grantRef: r.grant_ref, userId: String(r.user_id), privilege: r.privilege, scope: r.scope, target: r.target ?? null, reason: r.reason, status: r.status, requestedBy: r.requested_by ? String(r.requested_by) : null, approvedBy: r.approved_by ? String(r.approved_by) : null, grantedAt: iso(r.granted_at), expiresAt: iso(r.expires_at), revokedAt: iso(r.revoked_at), createdAt: iso(r.created_at) });
const audit = (db: any, actor: GrantActor, action: string, ref: string, meta: any) => sql`insert into audit_events (occurred_at, actor_user_id, actor_role, actor_name, module, action, resource_type, resource_id, summary, status, severity, ip, metadata) values (now(), ${actor.userId}, ${actor.role}, ${actor.name}, 'security', ${action}, 'privileged_access_grant', ${ref}, ${`${action} ${ref}`}, 'success', 'warning', ${actor.ip}, ${JSON.stringify(meta)}::jsonb)`.execute(db).catch(() => undefined);

export class KyselyGrantRepository implements GrantRepositoryPort {
  constructor(private readonly db: AppDatabase) {}
  async insert(i: { userId: string; privilege: string; scope: string; target: string | null; reason: string; expiresAt: string }, actor: GrantActor): Promise<GrantRow> {
    return (this.db as any).transaction().execute(async (trx: AppDatabase) => {
      const seqRow: any = await sql`select count(*)::int c from privileged_access_grants where extract(year from created_at) = extract(year from now())`.execute(trx as any).then((x: any) => x.rows[0]);
      const ref = `PAG-${new Date().getUTCFullYear()}-${String(n(seqRow?.c) + 1).padStart(3, '0')}`;
      const r: any = await sql`insert into privileged_access_grants (grant_ref, user_id, privilege, scope, target, reason, status, requested_by, expires_at) values (${ref}, ${i.userId}, ${i.privilege}, ${i.scope}, ${i.target}, ${i.reason}, 'pending', ${actor.userId}, ${i.expiresAt}) returning *`.execute(trx as any).then((x: any) => x.rows[0]);
      await sql`insert into privileged_access_grant_events (grant_id, from_status, to_status, actor_user_id, note) values (${r.id}, null, 'pending', ${actor.userId}, ${i.reason})`.execute(trx as any);
      await audit(trx, actor, 'privileged_access_requested', ref, { privilege: i.privilege, scope: i.scope, expiresAt: i.expiresAt });
      return map(r);
    });
  }
  async get(id: string) { const r: any = await sql`select * from privileged_access_grants where id = ${id} limit 1`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined); return r ? map(r) : null; }
  async transition(id: string, toStatus: string, note: string | null, fields: GrantFields, actor: GrantActor): Promise<GrantRow | null> {
    return (this.db as any).transaction().execute(async (trx: AppDatabase) => {
      const cur: any = await sql`select status, grant_ref from privileged_access_grants where id = ${id} limit 1`.execute(trx as any).then((x: any) => x.rows[0]);
      if (!cur) return null;
      const setApp = fields.approvedBy !== undefined ? sql`, approved_by = ${fields.approvedBy}` : sql``;
      const setGr = fields.grantedAt !== undefined ? sql`, granted_at = now()` : sql``;
      const setRev = toStatus === 'revoked' ? sql`, revoked_at = now()` : sql``;
      const r: any = await sql`update privileged_access_grants set status = ${toStatus}, updated_at = now()${setApp}${setGr}${setRev} where id = ${id} and status = ${cur.status} and ${canMoveToSql(PRIVILEGED_ACCESS_GRANT, toStatus)} returning *`.execute(trx as any).then((x: any) => x.rows[0]);
      if (!r) throw new InvalidStateTransitionError(PRIVILEGED_ACCESS_GRANT, cur.status, toStatus, 'concurrent');   // Phase 12 (#27)
      await sql`insert into privileged_access_grant_events (grant_id, from_status, to_status, actor_user_id, note) values (${id}, ${cur.status}, ${toStatus}, ${actor.userId}, ${note})`.execute(trx as any);
      await audit(trx, actor, `privileged_access_${toStatus}`, cur.grant_ref, { from: cur.status, note });
      return map(r);
    });
  }
  async list(limit: number) { const rows: any[] = await sql`select * from privileged_access_grants order by created_at desc limit ${limit}`.execute(this.db as any).then((x) => x.rows).catch(() => []); return rows.map(map); }
  async listActive() { const rows: any[] = await sql`select * from privileged_access_grants where status = 'active' and expires_at > now() order by expires_at`.execute(this.db as any).then((x) => x.rows).catch(() => []); return rows.map(map); }
  async expireOverdue(actor: GrantActor): Promise<number> {
    return (this.db as any).transaction().execute(async (trx: AppDatabase) => {
      const rows: any[] = await sql`update privileged_access_grants set status = 'expired', updated_at = now() where status = 'active' and ${canMoveToSql(PRIVILEGED_ACCESS_GRANT, 'expired')} and expires_at <= now() returning id, grant_ref`.execute(trx as any).then((x: any) => x.rows);
      for (const r of rows) { await sql`insert into privileged_access_grant_events (grant_id, from_status, to_status, actor_user_id, note) values (${r.id}, 'active', 'expired', ${actor.userId}, 'auto-expired')`.execute(trx as any); }
      return rows.length;
    });
  }
  async countActive() { const r: any = await sql`select count(*)::int c from privileged_access_grants where status = 'active' and expires_at > now()`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined); return n(r?.c); }
}
