import { sql, type Kysely } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { IpBlockRepositoryPort, IpBlockRow, InsertBlockInput, BlockActor } from './ip-block.repository';
import { canMoveToSql } from '@aipowersalon/database';
import { IP_BLOCK_RULE } from '../lifecycles';

const n = (v: unknown) => Number(v) || 0;
const iso = (v: unknown) => { if (!v) return null; try { return new Date(v as any).toISOString(); } catch { return null; } };
const map = (r: any): IpBlockRow => ({ id: String(r.id), target: r.target, blockKind: r.block_kind, ipVersion: n(r.ip_version), isAllowlist: r.is_allowlist === true, threatType: r.threat_type ?? null, source: r.source ?? null, reason: r.reason ?? null, country: r.country ?? null, status: r.status, blockedAt: iso(r.blocked_at), expiresAt: iso(r.expires_at) });
const audit = (db: any, actor: BlockActor, action: string, target: string, meta: any) => sql`insert into audit_events (occurred_at, actor_user_id, actor_role, actor_name, module, action, resource_type, resource_id, summary, status, severity, ip, metadata) values (now(), ${actor.userId}, ${actor.role}, ${actor.name}, 'security', ${action}, 'ip_block', ${target}, ${`${action} ${target}`}, 'success', 'warning', ${actor.ip}, ${JSON.stringify(meta)}::jsonb)`.execute(db).catch(() => undefined);

export class KyselyIpBlockRepository implements IpBlockRepositoryPort {
  constructor(private readonly db: AppDatabase) {}
  async findActiveBlock(target: string) { const r: any = await sql`select * from ip_block_rules where target = ${target} and is_allowlist = false and status = 'blocked' limit 1`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined); return r ? map(r) : null; }
  async insertBlock(i: InsertBlockInput, actor: BlockActor): Promise<IpBlockRow> {
    const existing = await this.findActiveBlock(i.target); if (existing) return existing;
    const r: any = await sql`insert into ip_block_rules (target, block_kind, ip_version, is_allowlist, threat_type, source, reason, country, tenant_id, status, expires_at, created_by) values (${i.target}, ${i.blockKind}, ${i.ipVersion}, false, ${i.threatType}, ${i.source}, ${i.reason}, ${i.country}, ${i.tenantId}, 'blocked', ${i.expiresAt}, ${actor.userId}) returning *`.execute(this.db as any).then((x) => x.rows[0]);
    await audit(this.db, actor, 'ip_blocked', i.target, { threatType: i.threatType, source: i.source, expiresAt: i.expiresAt }); return map(r);
  }
  async listBlocks(limit: number) { const rows: any[] = await sql`select * from ip_block_rules where is_allowlist = false order by blocked_at desc limit ${limit}`.execute(this.db as any).then((x) => x.rows).catch(() => []); return rows.map(map); }
  async getBlock(id: string) { const r: any = await sql`select * from ip_block_rules where id = ${id} limit 1`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined); return r ? map(r) : null; }
  async setStatus(id: string, status: string, actor: BlockActor) { const r: any = await sql`update ip_block_rules set status = ${status}, updated_at = now() where id = ${id} and ${canMoveToSql(IP_BLOCK_RULE, status)} returning *`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined); if (r) await audit(this.db as any, actor, 'ip_unblocked', r.target, { status }); return r ? map(r) : null; }
  async countActiveBlocks() { const r: any = await sql`select count(*)::int c from ip_block_rules where is_allowlist = false and status = 'blocked'`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined); return n(r?.c); }
  async blockedToday() { const r: any = await sql`select count(*)::int c from ip_block_rules where is_allowlist = false and blocked_at::date = current_date`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined); return n(r?.c); }
  async allowlistExact() { const rows: any[] = await sql`select target from ip_block_rules where is_allowlist = true and block_kind = 'exact'`.execute(this.db as any).then((x) => x.rows).catch(() => []); return rows.map((r) => r.target); }
  async allowlistCidrs() { const rows: any[] = await sql`select target from ip_block_rules where is_allowlist = true and block_kind = 'cidr'`.execute(this.db as any).then((x) => x.rows).catch(() => []); return rows.map((r) => r.target); }
  async addAllowlist(target: string, kind: string, reason: string | null, actor: BlockActor): Promise<IpBlockRow> {
    const r: any = await sql`insert into ip_block_rules (target, block_kind, ip_version, is_allowlist, source, reason, status, created_by) values (${target}, ${kind}, ${target.includes(':') ? 6 : 4}, true, 'allowlist', ${reason}, 'whitelisted', ${actor.userId}) returning *`.execute(this.db as any).then((x) => x.rows[0]);
    await audit(this.db, actor, 'allowlist_changed', target, { reason }); return map(r);
  }
  // §136: read by the platform network policy (network-policy.ts) — errors PROPAGATE so the policy keeps its last good rules.
  async networkRules() {
    const rows: Array<{ target: string; is_allowlist: boolean; expires_at: unknown }> = await sql<{ target: string; is_allowlist: boolean; expires_at: unknown }>`select target, is_allowlist, expires_at from ip_block_rules where (is_allowlist = false and status = 'blocked' and (expires_at is null or expires_at > now())) or (is_allowlist = true and status = 'whitelisted') limit 5000`.execute(this.db as unknown as Kysely<Record<string, never>>).then((x) => x.rows);
    return { blocks: rows.filter((r) => r.is_allowlist !== true).map((r) => ({ target: String(r.target), expiresAt: iso(r.expires_at) })), allowlist: rows.filter((r) => r.is_allowlist === true).map((r) => String(r.target)) };
  }
}
