import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { PolicyRepositoryPort, PolicyRow, PolicyActor } from './policy.repository';
import { canMoveToSql } from '@aipowersalon/database';
import { SECURITY_POLICY } from '../lifecycles';

const iso = (v: unknown) => { if (!v) return null; try { return new Date(v as any).toISOString(); } catch { return null; } };
const map = (r: any): PolicyRow => ({ id: String(r.id), kind: r.kind, version: Number(r.version) || 0, status: r.status, config: r.config || {}, compliant: r.compliant === true, activatedAt: iso(r.activated_at), createdAt: iso(r.created_at) });

export class KyselyPolicyRepository implements PolicyRepositoryPort {
  constructor(private readonly db: AppDatabase) {}
  async getActive(kind: string) { const r: any = await sql`select * from security_policies where kind = ${kind} and status = 'active' order by version desc limit 1`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined); return r ? map(r) : null; }
  async listVersions(kind: string) { const rows: any[] = await sql`select version from security_policies where kind = ${kind}`.execute(this.db as any).then((x) => x.rows).catch(() => []); return rows.map((r) => Number(r.version) || 0); }
  async insertActive(kind: string, version: number, config: Record<string, unknown>, compliant: boolean, actor: PolicyActor): Promise<PolicyRow> {
    return (this.db as any).transaction().execute(async (trx: AppDatabase) => {
      await sql`update security_policies set status = 'archived', updated_at = now() where kind = ${kind} and status = 'active' and ${canMoveToSql(SECURITY_POLICY, 'archived')}`.execute(trx as any);
      const r: any = await sql`insert into security_policies (kind, version, status, config, compliant, created_by, activated_at) values (${kind}, ${version}, 'active', ${JSON.stringify(config)}::jsonb, ${compliant}, ${actor.userId}, now()) returning *`.execute(trx as any).then((x: any) => x.rows[0]);
      await sql`insert into audit_events (occurred_at, actor_user_id, actor_role, actor_name, module, action, resource_type, resource_id, summary, status, severity, ip, metadata) values (now(), ${actor.userId}, ${actor.role}, ${actor.name}, 'security', ${`${kind}_policy_changed`}, 'security_policy', ${kind}, ${`${kind} policy v${version} activated`}, 'success', 'info', ${actor.ip}, ${JSON.stringify({ version, compliant })}::jsonb)`.execute(trx as any).catch(() => undefined);
      return map(r);
    });
  }
  async history(kind: string, limit: number) { const rows: any[] = await sql`select * from security_policies where kind = ${kind} order by version desc limit ${limit}`.execute(this.db as any).then((x) => x.rows).catch(() => []); return rows.map(map); }
  async activeCompliance() {
    const rows: any[] = await sql`select distinct on (kind) kind, compliant from security_policies where status = 'active' order by kind, version desc`.execute(this.db as any).then((x) => x.rows).catch(() => []);
    const m: Record<string, boolean> = {}; rows.forEach((r) => { m[r.kind] = r.compliant === true; });
    return { session: r(m, 'session'), password: r(m, 'password'), mfa: r(m, 'mfa') };
    function r(mm: Record<string, boolean>, k: string) { return Object.prototype.hasOwnProperty.call(mm, k) ? mm[k] : null; }
  }
}
