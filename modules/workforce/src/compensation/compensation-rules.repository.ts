/**
 * compensation-rules.repository.ts — persistence for AUTHORING compensation rules (spec §5/§7/§25). Backs the settings
 * surface: list/read policies, create a policy (with version 1), add a new version, and move a version through its
 * lifecycle (approve → activate). Activating a version SUPERSEDES the prior active version of the same policy by closing
 * its effective window and marking it 'replaced' — the old version is never deleted, so historical resolution is stable
 * (§25). This does NOT touch the resolver or any snapshot; it only maintains the rule store (migration 409).
 */
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { assertTransition, canMoveToSql, transitionStatus, InvalidStateTransitionError } from '@aipowersalon/database';
import { COMPENSATION_POLICY_VERSION } from '../workforce-lifecycles';

export interface RuleContext { tenantId: string; branchId?: string | null; userId?: string }

export interface PolicyScope {
  branchId?: string | null; technicianId?: string | null; serviceId?: string | null;
  serviceCategory?: string | null; ticketId?: string | null;
}
export interface VersionPayload {
  commissionType: 'percent' | 'fixed'; commissionValue: number;
  supplyMethod?: string; supplyValue?: number; discountFunding?: string;
  effectiveStart: string; effectiveEnd?: string | null;
}
export interface VersionRow {
  id: string; version: number; commissionType: string; commissionValue: number;
  supplyMethod: string; supplyValue: number; discountFunding: string;
  effectiveStart: string; effectiveEnd: string | null; status: string; approved: boolean; createdAt: string;
}
export interface PolicyRow { id: string; scope: PolicyScope; label: string | null; createdAt: string; versions: VersionRow[] }

export interface CompensationRulesRepo {
  listPolicies(ctx: RuleContext): Promise<PolicyRow[]>;
  getPolicy(ctx: RuleContext, policyId: string): Promise<PolicyRow | null>;
  createPolicy(ctx: RuleContext, scope: PolicyScope, label: string | null, v: VersionPayload): Promise<PolicyRow>;
  addVersion(ctx: RuleContext, policyId: string, v: VersionPayload): Promise<VersionRow | null>;
  setVersionStatus(ctx: RuleContext, versionId: string, status: string): Promise<VersionRow | null>;
  /** Activate a version and supersede the prior active version of the same policy (atomic). */
  activateVersion(ctx: RuleContext, versionId: string): Promise<VersionRow | null>;
}

const isoStr = (v: any): string => (v instanceof Date ? v.toISOString() : String(v));
const isoOrNull = (v: any): string | null => (v == null ? null : isoStr(v));

const mapVersion = (r: any): VersionRow => ({
  id: r.id, version: Number(r.version), commissionType: r.commission_type, commissionValue: Number(r.commission_value),
  supplyMethod: r.supply_method, supplyValue: Number(r.supply_value), discountFunding: r.discount_funding,
  effectiveStart: isoStr(r.effective_start), effectiveEnd: isoOrNull(r.effective_end), status: r.status,
  approved: !!r.approved, createdAt: isoStr(r.created_at),
});
const mapScope = (r: any): PolicyScope => ({
  branchId: r.branch_id ?? null, technicianId: r.technician_id ?? null, serviceId: r.service_id ?? null,
  serviceCategory: r.service_category ?? null, ticketId: r.ticket_id ?? null,
});

export class KyselyCompensationRulesRepo implements CompensationRulesRepo {
  constructor(private readonly db: Kysely<DB>) {}

  async listPolicies(ctx: RuleContext): Promise<PolicyRow[]> {
    const pols = await this.db.selectFrom('compensation_policies').selectAll().where('tenant_id', '=', ctx.tenantId).orderBy('created_at', 'desc').execute().catch(() => [] as any[]);
    if (!pols.length) return [];
    const vers = await this.db.selectFrom('compensation_policy_versions').selectAll().where('tenant_id', '=', ctx.tenantId).orderBy('version', 'desc').execute().catch(() => [] as any[]);
    const byPolicy = new Map<string, any[]>();
    for (const v of vers) { const a = byPolicy.get(v.policy_id) || []; a.push(v); byPolicy.set(v.policy_id, a); }
    return pols.map((p) => ({ id: p.id, scope: mapScope(p), label: p.label ?? null, createdAt: isoStr(p.created_at), versions: (byPolicy.get(p.id) || []).map(mapVersion) }));
  }

  async getPolicy(ctx: RuleContext, policyId: string): Promise<PolicyRow | null> {
    const p = await this.db.selectFrom('compensation_policies').selectAll().where('tenant_id', '=', ctx.tenantId).where('id', '=', policyId).executeTakeFirst().catch(() => undefined);
    if (!p) return null;
    const vers = await this.db.selectFrom('compensation_policy_versions').selectAll().where('tenant_id', '=', ctx.tenantId).where('policy_id', '=', policyId).orderBy('version', 'desc').execute().catch(() => [] as any[]);
    return { id: p.id, scope: mapScope(p), label: p.label ?? null, createdAt: isoStr(p.created_at), versions: vers.map(mapVersion) };
  }

  async createPolicy(ctx: RuleContext, scope: PolicyScope, label: string | null, v: VersionPayload): Promise<PolicyRow> {
    const ins: any = await this.db.insertInto('compensation_policies').values({
      tenant_id: ctx.tenantId, branch_id: scope.branchId ?? null, technician_id: scope.technicianId ?? null,
      service_id: scope.serviceId ?? null, service_category: scope.serviceCategory ?? null, ticket_id: scope.ticketId ?? null,
      label, created_by: ctx.userId ?? null,
    }).returning(['id']).executeTakeFirstOrThrow();
    await this.insertVersion(ctx, ins.id, 1, v);
    return (await this.getPolicy(ctx, ins.id))!;
  }

  private async insertVersion(ctx: RuleContext, policyId: string, version: number, v: VersionPayload) {
    await this.db.insertInto('compensation_policy_versions').values({
      policy_id: policyId, tenant_id: ctx.tenantId, version,
      commission_type: v.commissionType, commission_value: Math.round(v.commissionValue),
      supply_method: v.supplyMethod ?? 'none', supply_value: Math.round(v.supplyValue ?? 0),
      discount_funding: v.discountFunding ?? 'proportional',
      effective_start: v.effectiveStart, effective_end: v.effectiveEnd ?? null, status: 'draft', approved: false,
      created_by: ctx.userId ?? null,
    }).execute();
  }

  async addVersion(ctx: RuleContext, policyId: string, v: VersionPayload): Promise<VersionRow | null> {
    const p = await this.getPolicy(ctx, policyId);
    if (!p) return null;
    const next = (p.versions.reduce((m, x) => Math.max(m, x.version), 0)) + 1;
    await this.insertVersion(ctx, policyId, next, v);
    const created = (await this.getPolicy(ctx, policyId))!.versions.find((x) => x.version === next);
    return created ?? null;
  }

  async setVersionStatus(ctx: RuleContext, versionId: string, status: string): Promise<VersionRow | null> {
    const approved = status === 'scheduled' || status === 'active';
    // Phase 12 (#27): through the version machine — a canceled / replaced version is never approved again, and a move that
    // raced another writer is a 409, not a silent overwrite (this used to update with no status condition at all)
    const moved = await transitionStatus(this.db, COMPENSATION_POLICY_VERSION, {
      where: { tenant_id: ctx.tenantId, id: versionId }, to: status,
      set: approved ? { approved: true, approved_by: ctx.userId ?? null, approved_at: new Date() } : {},
    }).catch((e) => { if (e instanceof InvalidStateTransitionError) throw e; return undefined; });
    if (!moved) return null;
    const row = await this.db.selectFrom('compensation_policy_versions').selectAll().where('tenant_id', '=', ctx.tenantId).where('id', '=', versionId).executeTakeFirst().catch(() => undefined);
    return row ? mapVersion(row) : null;
  }

  async activateVersion(ctx: RuleContext, versionId: string): Promise<VersionRow | null> {
    return this.db.transaction().execute(async (trx): Promise<VersionRow | null> => {
      const target: any = await trx.selectFrom('compensation_policy_versions').selectAll().where('tenant_id', '=', ctx.tenantId).where('id', '=', versionId).executeTakeFirst();
      if (!target) return null;
      // supersede the prior active version(s) of the same policy: close their window at this version's start
      await trx.updateTable('compensation_policy_versions')
        .set({ status: 'replaced', effective_end: target.effective_start })
        .where('tenant_id', '=', ctx.tenantId).where('policy_id', '=', target.policy_id).where('status', '=', 'active').where('id', '<>', versionId)
        .where(canMoveToSql(COMPENSATION_POLICY_VERSION, 'replaced') as any)
        .execute();
      // the version itself: only from a state the machine allows (a canceled / replaced version is not activated again)
      assertTransition(COMPENSATION_POLICY_VERSION, target.status, 'active');
      const res = await trx.updateTable('compensation_policy_versions')
        .set({ status: 'active', approved: true, approved_by: ctx.userId ?? null, approved_at: new Date() })
        .where('id', '=', versionId).where('tenant_id', '=', ctx.tenantId).where('status', '=', target.status).executeTakeFirst();
      if (!Number((res as any)?.numUpdatedRows ?? 0)) throw new InvalidStateTransitionError(COMPENSATION_POLICY_VERSION, null, 'active', 'concurrent');
      const row: any = await trx.selectFrom('compensation_policy_versions').selectAll().where('tenant_id', '=', ctx.tenantId).where('id', '=', versionId).executeTakeFirst();
      return row ? mapVersion(row) : null;
    }).catch((e) => { if (e instanceof InvalidStateTransitionError) throw e; return null; });
  }
}

/** In-memory double — models the same lifecycle, including activate-supersedes-prior. */
export class InMemoryCompensationRulesRepo implements CompensationRulesRepo {
  private policies: any[] = [];
  private versions: any[] = [];
  private seq = 0;
  private id(pfx: string) { return pfx + '_' + (++this.seq); }

  async listPolicies(ctx: RuleContext): Promise<PolicyRow[]> {
    return this.policies.filter((p) => p.tenant_id === ctx.tenantId).map((p) => this.shape(p));
  }
  async getPolicy(ctx: RuleContext, policyId: string): Promise<PolicyRow | null> {
    const p = this.policies.find((x) => x.id === policyId && x.tenant_id === ctx.tenantId);
    return p ? this.shape(p) : null;
  }
  private shape(p: any): PolicyRow {
    const vers = this.versions.filter((v) => v.policy_id === p.id).sort((a, b) => b.version - a.version).map(mapVersion);
    return { id: p.id, scope: mapScope(p), label: p.label ?? null, createdAt: isoStr(p.created_at), versions: vers };
  }
  async createPolicy(ctx: RuleContext, scope: PolicyScope, label: string | null, v: VersionPayload): Promise<PolicyRow> {
    const p = { id: this.id('pol'), tenant_id: ctx.tenantId, branch_id: scope.branchId ?? null, technician_id: scope.technicianId ?? null, service_id: scope.serviceId ?? null, service_category: scope.serviceCategory ?? null, ticket_id: scope.ticketId ?? null, label, created_at: new Date().toISOString() };
    this.policies.push(p);
    this.pushVersion(ctx, p.id, 1, v);
    return this.shape(p);
  }
  private pushVersion(ctx: RuleContext, policyId: string, version: number, v: VersionPayload) {
    this.versions.push({ id: this.id('ver'), policy_id: policyId, tenant_id: ctx.tenantId, version, commission_type: v.commissionType, commission_value: Math.round(v.commissionValue), supply_method: v.supplyMethod ?? 'none', supply_value: Math.round(v.supplyValue ?? 0), discount_funding: v.discountFunding ?? 'proportional', effective_start: v.effectiveStart, effective_end: v.effectiveEnd ?? null, status: 'draft', approved: false, created_at: new Date().toISOString() });
  }
  async addVersion(ctx: RuleContext, policyId: string, v: VersionPayload): Promise<VersionRow | null> {
    const p = this.policies.find((x) => x.id === policyId && x.tenant_id === ctx.tenantId);
    if (!p) return null;
    const next = this.versions.filter((x) => x.policy_id === policyId).reduce((m, x) => Math.max(m, x.version), 0) + 1;
    this.pushVersion(ctx, policyId, next, v);
    return mapVersion(this.versions.find((x) => x.policy_id === policyId && x.version === next));
  }
  async setVersionStatus(ctx: RuleContext, versionId: string, status: string): Promise<VersionRow | null> {
    const v = this.versions.find((x) => x.id === versionId && x.tenant_id === ctx.tenantId);
    if (!v) return null;
    v.status = status;
    if (status === 'scheduled' || status === 'active') v.approved = true;
    return mapVersion(v);
  }
  async activateVersion(ctx: RuleContext, versionId: string): Promise<VersionRow | null> {
    const v = this.versions.find((x) => x.id === versionId && x.tenant_id === ctx.tenantId);
    if (!v) return null;
    for (const o of this.versions) if (o.policy_id === v.policy_id && o.status === 'active' && o.id !== versionId) { o.status = 'replaced'; o.effective_end = v.effective_start; }
    v.status = 'active'; v.approved = true;
    return mapVersion(v);
  }
}
