import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { LockdownRepositoryPort, LockdownRow, LockdownActor, TransitionFields } from './lockdown.repository';
import { canMoveToSql, InvalidStateTransitionError } from '@aipowersalon/database';
import { EMERGENCY_LOCKDOWN } from '../lifecycles';

const n = (v: unknown) => Number(v) || 0;
const iso = (v: unknown) => { if (!v) return null; try { return new Date(v as any).toISOString(); } catch { return null; } };
const map = (r: any): LockdownRow => ({ id: String(r.id), lockdownRef: r.lockdown_ref, scope: r.scope, target: r.target ?? null, reason: r.reason, status: r.status, stepUpVerified: r.step_up_verified === true, affectedSessions: r.affected_sessions == null ? null : n(r.affected_sessions), initiatedBy: r.initiated_by ? String(r.initiated_by) : null, confirmedBy: r.confirmed_by ? String(r.confirmed_by) : null, activatedAt: iso(r.activated_at), liftedAt: iso(r.lifted_at), createdAt: iso(r.created_at) });
const audit = (db: any, actor: LockdownActor, action: string, ref: string, meta: any) => sql`insert into audit_events (occurred_at, actor_user_id, actor_role, actor_name, module, action, resource_type, resource_id, summary, status, severity, ip, metadata) values (now(), ${actor.userId}, ${actor.role}, ${actor.name}, 'security', ${action}, 'emergency_lockdown', ${ref}, ${`${action} ${ref}`}, 'success', 'critical', ${actor.ip}, ${JSON.stringify(meta)}::jsonb)`.execute(db).catch(() => undefined);

export class KyselyLockdownRepository implements LockdownRepositoryPort {
  constructor(private readonly db: AppDatabase) {}
  async insert(scope: string, target: string | null, reason: string, actor: LockdownActor): Promise<LockdownRow> {
    return (this.db as any).transaction().execute(async (trx: AppDatabase) => {
      const seqRow: any = await sql`select count(*)::int c from emergency_lockdowns where extract(year from created_at) = extract(year from now())`.execute(trx as any).then((x: any) => x.rows[0]);
      const ref = `LKD-${new Date().getUTCFullYear()}-${String(n(seqRow?.c) + 1).padStart(3, '0')}`;
      const r: any = await sql`insert into emergency_lockdowns (lockdown_ref, scope, target, reason, status, initiated_by) values (${ref}, ${scope}, ${target}, ${reason}, 'proposed', ${actor.userId}) returning *`.execute(trx as any).then((x: any) => x.rows[0]);
      await sql`insert into emergency_lockdown_events (lockdown_id, from_status, to_status, actor_user_id, note) values (${r.id}, null, 'proposed', ${actor.userId}, ${reason})`.execute(trx as any);
      await audit(trx as any, actor, 'lockdown_proposed', ref, { scope, target });
      return map(r);
    });
  }
  async get(id: string) { const r: any = await sql`select * from emergency_lockdowns where id = ${id} limit 1`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined); return r ? map(r) : null; }
  async transition(id: string, toStatus: string, note: string | null, fields: TransitionFields, actor: LockdownActor): Promise<LockdownRow | null> {
    return (this.db as any).transaction().execute(async (trx: AppDatabase) => {
      const cur: any = await sql`select status, lockdown_ref from emergency_lockdowns where id = ${id} limit 1`.execute(trx as any).then((x: any) => x.rows[0]);
      if (!cur) return null;
      const setStep = fields.stepUpVerified !== undefined ? sql`, step_up_verified = ${fields.stepUpVerified}` : sql``;
      const setConf = fields.confirmedBy !== undefined ? sql`, confirmed_by = ${fields.confirmedBy}` : sql``;
      const setAff = fields.affectedSessions !== undefined ? sql`, affected_sessions = ${fields.affectedSessions}` : sql``;
      const setActive = toStatus === 'active' ? sql`, activated_at = now()` : sql``;
      const setLifted = toStatus === 'lifted' ? sql`, lifted_at = now()` : sql``;
      const r: any = await sql`update emergency_lockdowns set status = ${toStatus}, updated_at = now()${setStep}${setConf}${setAff}${setActive}${setLifted} where id = ${id} and status = ${cur.status} and ${canMoveToSql(EMERGENCY_LOCKDOWN, toStatus)} returning *`.execute(trx as any).then((x: any) => x.rows[0]);
      if (!r) throw new InvalidStateTransitionError(EMERGENCY_LOCKDOWN, cur.status, toStatus, 'concurrent');   // Phase 12 (#27): two people cannot both activate / lift
      await sql`insert into emergency_lockdown_events (lockdown_id, from_status, to_status, actor_user_id, note) values (${id}, ${cur.status}, ${toStatus}, ${actor.userId}, ${note})`.execute(trx as any);
      await audit(trx as any, actor, `lockdown_${toStatus}`, cur.lockdown_ref, { from: cur.status, note });
      return map(r);
    });
  }
  async list(limit: number) { const rows: any[] = await sql`select * from emergency_lockdowns order by created_at desc limit ${limit}`.execute(this.db as any).then((x) => x.rows).catch(() => []); return rows.map(map); }
  async countActive() { const r: any = await sql`select count(*)::int c from emergency_lockdowns where status = 'active'`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined); return n(r?.c); }
}
