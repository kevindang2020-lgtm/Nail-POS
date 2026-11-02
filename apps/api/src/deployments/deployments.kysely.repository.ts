// deployments.kysely.repository.ts — production adapter over tenant_deployments. Tenant + branch-or-null scoped.
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { DeploymentsContext } from './deployments.dto';
import type { DeploymentsRepositoryPort, StoredDeployment, NewDeployment } from './deployments.repository';
import type { DeployStatus } from './deployments-core';

const toMs = (v: unknown): number | null => { if (v == null) return null; if (v instanceof Date) return v.getTime(); const n = Date.parse(String(v)); return Number.isNaN(n) ? null : n; };
const reqMs = (v: unknown): number => toMs(v) ?? Date.now();

export class KyselyDeploymentsRepository implements DeploymentsRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}
  private map = (r: any): StoredDeployment => ({ id: r.id, component: r.component, componentKind: r.component_kind, installedVersion: r.installed_version ?? null, latestVersion: r.latest_version ?? null, targetCount: r.target_count ?? 0, status: r.status as DeployStatus, scheduledMs: toMs(r.scheduled_at), branchId: r.branch_id ?? null, createdMs: reqMs(r.created_at) });

  async list(ctx: DeploymentsContext): Promise<StoredDeployment[]> {
    let q = this.db.selectFrom('tenant_deployments').selectAll().where('tenant_id', '=', ctx.tenantId);
    if (ctx.branchId) q = q.where((eb) => eb.or([eb('branch_id', '=', ctx.branchId), eb('branch_id', 'is', null)]));
    const rows = await q.orderBy('component').execute().catch(() => []);
    return rows.map(this.map);
  }
  async insert(ctx: DeploymentsContext, d: NewDeployment): Promise<StoredDeployment> {
    const r = await this.db.insertInto('tenant_deployments').values({ tenant_id: ctx.tenantId, branch_id: d.branchId, component: d.component, component_kind: d.componentKind, installed_version: d.installedVersion, latest_version: d.latestVersion, target_count: d.targetCount, status: d.status, created_by_user_id: d.createdByUserId } as any).returningAll().executeTakeFirstOrThrow();
    return this.map(r);
  }
  async get(ctx: DeploymentsContext, id: string): Promise<StoredDeployment | null> {
    const r = await this.db.selectFrom('tenant_deployments').selectAll().where('tenant_id', '=', ctx.tenantId).where('id', '=', id).executeTakeFirst().catch(() => undefined);
    return r ? this.map(r) : null;
  }
  async updateStatus(ctx: DeploymentsContext, id: string, status: DeployStatus, scheduledMs: number | null): Promise<StoredDeployment | null> {
    const set: any = { status, updated_at: new Date() }; if (scheduledMs != null) set.scheduled_at = new Date(scheduledMs);
    const r = await this.db.updateTable('tenant_deployments').set(set).where('tenant_id', '=', ctx.tenantId).where('id', '=', id).returningAll().executeTakeFirst().catch(() => undefined);
    return r ? this.map(r) : null;
  }
}
