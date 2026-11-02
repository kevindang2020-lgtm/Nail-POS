/**
 * compensation-rules.service.ts — authoring logic over the rule store (spec §5/§7/§25). Validates payloads, then drives
 * the version lifecycle: create a policy (version 1, draft) → add a new version (draft) → approve (scheduled) → activate
 * (active, superseding the prior active version). The tenant%/salon% = 100% invariant (§5) is STRUCTURAL here: a rule
 * stores the technician share as one percent and the salon takes the remainder, so the two always sum to 100 by
 * construction (fixed rules carry a cents amount instead). No money moves; this only maintains the rule store.
 */
import type { CompensationRulesRepo, RuleContext, PolicyScope, VersionPayload, PolicyRow, VersionRow } from './compensation-rules.repository';
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { AuditService } from '@aipowersalon/audit';
import { CommissionSecurityService } from '../technicians/commission-security.service';
import { defaultCommissionForTenant } from './compensation-rule-loader';
import { PLATFORM_FALLBACK_COMMISSION_PERCENT } from './commission-basis';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export class CompensationRulesError extends Error {
  constructor(msg: string, public status = 400) { super(msg); this.name = 'CompensationRulesError'; }
}

/** PURE §142 (wave 2): another policy with the SAME exact scope that has an approved (scheduled / active) version whose
 *  effective window overlaps [start, end) — two such rules would make the resolver's choice ambiguous. */
export function findOverlappingRule(policies: PolicyRow[], policyId: string, window: { effectiveStart: string; effectiveEnd: string | null }): { policyId: string; versionId: string } | null {
  const target = policies.find((p) => p.id === policyId);
  if (!target) return null;
  const key = (sc: PolicyScope) => [sc.branchId ?? '', sc.technicianId ?? '', sc.serviceId ?? '', sc.serviceCategory ?? '', sc.ticketId ?? ''].join('|');
  const s = Date.parse(window.effectiveStart); const e = window.effectiveEnd ? Date.parse(window.effectiveEnd) : Number.POSITIVE_INFINITY;
  for (const p of policies) {
    if (p.id === policyId || key(p.scope) !== key(target.scope)) continue;
    for (const v of p.versions) {
      if (v.status !== 'active' && v.status !== 'scheduled') continue;
      const vs = Date.parse(v.effectiveStart); const ve = v.effectiveEnd ? Date.parse(v.effectiveEnd) : Number.POSITIVE_INFINITY;
      if (vs < e && s < ve) return { policyId: p.id, versionId: v.id };
    }
  }
  return null;
}

export interface CreatePolicyBody { scope?: PolicyScope; label?: string | null; version: VersionPayload }

export class CompensationRulesService {
  /** `db` + `audit` are optional (in-memory dev / unit tests): without a database the activation auth-code check and
   *  the tenant-default read are skipped (platform fallback), exactly like the POS commission edits without one. */
  constructor(private readonly repo: CompensationRulesRepo, private readonly db: Kysely<DB> | null = null, private readonly audit?: AuditService) {}

  private validatePayload(v: VersionPayload): void {
    if (!v || (v.commissionType !== 'percent' && v.commissionType !== 'fixed')) throw new CompensationRulesError('commissionType must be "percent" or "fixed"');
    if (!Number.isFinite(v.commissionValue) || v.commissionValue < 0) throw withCode(new CompensationRulesError('commissionValue must be a non-negative number'), 'COMMISSION_VALUE_INVALID');
    if (v.commissionType === 'percent' && v.commissionValue > 100) throw withCode(new CompensationRulesError('A percent commission must be between 0 and 100'), 'COMMISSION_PERCENT_INVALID');
    if (!v.effectiveStart || Number.isNaN(Date.parse(v.effectiveStart))) throw withCode(new CompensationRulesError('effectiveStart is a required date'), 'EFFECTIVE_DATES_INVALID');
    if (v.effectiveEnd && Number.isNaN(Date.parse(v.effectiveEnd))) throw withCode(new CompensationRulesError('effectiveEnd must be a valid date'), 'EFFECTIVE_DATES_INVALID');
    if (v.effectiveEnd && Date.parse(v.effectiveEnd) < Date.parse(v.effectiveStart)) throw withCode(new CompensationRulesError('effectiveEnd must be on or after effectiveStart'), 'EFFECTIVE_DATES_INVALID');
    if (v.supplyMethod && !['none', 'fixed', 'percent', 'tiered', 'recipe'].includes(v.supplyMethod)) throw new CompensationRulesError('invalid supplyMethod');
    if (v.discountFunding && !['proportional', 'salon_funded', 'technician_funded', 'noncommissionable'].includes(v.discountFunding)) throw new CompensationRulesError('invalid discountFunding');
  }

  private normalizeScope(s?: PolicyScope): PolicyScope {
    const x = s || {};
    return { branchId: x.branchId ?? null, technicianId: x.technicianId ?? null, serviceId: x.serviceId ?? null, serviceCategory: x.serviceCategory ?? null, ticketId: x.ticketId ?? null };
  }

  async list(ctx: RuleContext): Promise<PolicyRow[]> { return this.repo.listPolicies(ctx); }

  async get(ctx: RuleContext, policyId: string): Promise<PolicyRow> {
    const p = await this.repo.getPolicy(ctx, policyId);
    if (!p) throw withCode(new CompensationRulesError('Policy not found', 404), 'POLICY_NOT_FOUND');
    return p;
  }

  async createPolicy(ctx: RuleContext, body: CreatePolicyBody): Promise<PolicyRow> {
    this.validatePayload(body.version);
    return this.repo.createPolicy(ctx, this.normalizeScope(body.scope), body.label ?? null, body.version);
  }

  /** §25 copy → new version at a future effective date (draft). */
  async addVersion(ctx: RuleContext, policyId: string, version: VersionPayload): Promise<VersionRow> {
    this.validatePayload(version);
    const v = await this.repo.addVersion(ctx, policyId, version);
    if (!v) throw withCode(new CompensationRulesError('Policy not found', 404), 'POLICY_NOT_FOUND');
    return v;
  }

  /** Approve a draft/pending version → scheduled (approved, not yet live). */
  /** §142: refuse an approval / activation that would overlap another policy of the same exact scope. */
  private async assertNoOverlap(ctx: RuleContext, versionId: string): Promise<void> {
    const policies = await this.repo.listPolicies(ctx);
    const owner = policies.find((p) => p.versions.some((v) => v.id === versionId));
    const ver = owner?.versions.find((v) => v.id === versionId);
    if (!owner || !ver) return;
    const hit = findOverlappingRule(policies, owner.id, { effectiveStart: ver.effectiveStart, effectiveEnd: ver.effectiveEnd });
    if (hit) { const e = new CompensationRulesError('Another rule already covers the same technician, service and dates. End it first.', 409); (e as any).code = 'COMMISSION_RULE_CONFLICT'; (e as any).conflict = hit; throw e; }
  }

  async approve(ctx: RuleContext, versionId: string): Promise<VersionRow> {
    await this.assertNoOverlap(ctx, versionId);
    const v = await this.repo.setVersionStatus(ctx, versionId, 'scheduled');
    if (!v) throw withCode(new CompensationRulesError('Version not found', 404), 'VERSION_NOT_FOUND');
    return v;
  }

  /**
   * Activate a version → active, superseding the prior active version of the same policy (§25). Activation MOVES MONEY
   * (every future line prices on it), so — exactly like the POS commission edits — it requires the Super Admin commission
   * authorization code (one-time, tenant-scoped, hash-compared; a platform principal is exempt). The change is recorded
   * in commission_change_audit_logs (target 'rule_version') and in the tenant audit log (Payroll mandate §72/§122).
   */
  async activate(ctx: RuleContext & { role?: string; userName?: string }, versionId: string, adminAuthCode?: string | null): Promise<VersionRow> {
    await this.assertNoOverlap(ctx, versionId);
    let authorized: { authorizedByUserId: string | null; authorizedByName: string | null; codeUsed: string | null } | null = null;
    if (this.db) {
      try { authorized = await CommissionSecurityService.verifyAuthorization(this.db, ctx.tenantId, ctx.role || 'OWNER', adminAuthCode); }
      catch (e: any) { throw new CompensationRulesError(e?.message || 'Admin Authorization Code is required to activate a commission rule.', typeof e?.getStatus === 'function' ? e.getStatus() : 403); }
    }
    const v = await this.repo.activateVersion(ctx, versionId);
    if (!v) throw withCode(new CompensationRulesError('Version not found', 404), 'VERSION_NOT_FOUND');
    if (this.db && authorized) {
      await CommissionSecurityService.recordChange(this.db, {
        tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, targetType: 'rule_version',
        oldCommissionPercent: 0, newCommissionPercent: v.commissionType === 'percent' ? Number(v.commissionValue) : 0,
        requestedByUserId: ctx.userId || 'unknown', requestedByName: ctx.userName || ctx.userId || 'unknown', requestedByRole: ctx.role || 'OWNER',
        authorizedByUserId: authorized.authorizedByUserId, authorizedByName: authorized.authorizedByName, authCodeUsed: authorized.codeUsed,
      }).catch(() => undefined);
    }
    await this.audit?.record(
      { tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, userId: ctx.userId, role: ctx.role || 'OWNER' },
      { module: 'compensation', action: 'rule_version.activated', resourceType: 'compensation_policy_version', resourceId: versionId, severity: 'high',
        metadata: { version: v.version, commissionType: v.commissionType, commissionValue: v.commissionValue, authorizedBy: authorized?.authorizedByName ?? null } },
    );
    return v;
  }

  async cancel(ctx: RuleContext, versionId: string): Promise<VersionRow> {
    const v = await this.repo.setVersionStatus(ctx, versionId, 'canceled');
    if (!v) throw withCode(new CompensationRulesError('Version not found', 404), 'VERSION_NOT_FOUND');
    return v;
  }

  /**
   * §3 opt-in default: create AND activate a salon-default rule at the salon's own default technician share
   * (tenants.default_commission_percent; platform fallback 50 — never a hardcoded 60). Only runs on explicit owner
   * action (never silent). Idempotent: if a salon-default rule is already active, it is returned unchanged rather than
   * creating a duplicate or re-activating. An explicit technicianPercent still wins.
   */
  async seedDefaultTemplate(ctx: RuleContext, opts?: { technicianPercent?: number }): Promise<PolicyRow> {
    const pct = opts?.technicianPercent ?? (this.db ? (await defaultCommissionForTenant(this.db, ctx.tenantId)).commissionValue : PLATFORM_FALLBACK_COMMISSION_PERCENT);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw withCode(new CompensationRulesError('technicianPercent must be between 0 and 100'), 'COMMISSION_PERCENT_INVALID');
    const isSalonDefault = (p: PolicyRow) => !p.scope.branchId && !p.scope.technicianId && !p.scope.serviceId && !p.scope.serviceCategory && !p.scope.ticketId;
    const active = (await this.repo.listPolicies(ctx)).find((p) => isSalonDefault(p) && p.versions.some((v) => v.status === 'active'));
    if (active) return active; // already set up — no-op
    const created = await this.repo.createPolicy(ctx, {}, `Standard ${pct}/${100 - pct} split`, { commissionType: 'percent', commissionValue: pct, effectiveStart: new Date().toISOString() });
    await this.repo.activateVersion(ctx, created.versions[0].id);
    return (await this.repo.getPolicy(ctx, created.id)) ?? created;
  }
}
