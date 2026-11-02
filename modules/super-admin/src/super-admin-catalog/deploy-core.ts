// deploy-core.ts — pure planning for deploying a master template to tenants. The critical rule lives here: a Super
// Admin template must NEVER overwrite a tenant's custom service without explicit permission. No I/O.

export type TenantDeployFacts = {
  tenantId: string; tenantName: string;
  alreadyDeployed: boolean;   // this template already copied to this tenant
  nameCollision: boolean;     // tenant already has a (custom) service with the same name
  hasBranch: boolean;         // tenant has at least one branch (services.branch_id NOT NULL)
  hasCategory: boolean;       // tenant has at least one service category (services.category_id NOT NULL)
};
export type DeployOptions = { allowOverwrite: boolean };
export type DeployAction = 'deploy' | 'overwrite' | 'skip';
export type DeployReason = 'ok' | 'already_deployed' | 'name_conflict' | 'no_branch' | 'no_category';
export type DeployPlanItem = { tenantId: string; tenantName: string; action: DeployAction; reason: DeployReason };

// Decides, per tenant, whether to deploy, overwrite (only with explicit permission), or skip — and why.
export function planTenantDeploy(f: TenantDeployFacts, opts: DeployOptions): DeployPlanItem {
  const base = { tenantId: f.tenantId, tenantName: f.tenantName };
  if (!f.hasBranch) return { ...base, action: 'skip', reason: 'no_branch' };
  if (!f.hasCategory) return { ...base, action: 'skip', reason: 'no_category' };
  if (f.alreadyDeployed) return { ...base, action: 'skip', reason: 'already_deployed' };
  if (f.nameCollision) {
    // NEVER overwrite a tenant's custom service unless the operator explicitly opts in.
    return opts.allowOverwrite ? { ...base, action: 'overwrite', reason: 'ok' } : { ...base, action: 'skip', reason: 'name_conflict' };
  }
  return { ...base, action: 'deploy', reason: 'ok' };
}

export function planDeployment(facts: TenantDeployFacts[], opts: DeployOptions): DeployPlanItem[] {
  return facts.map((f) => planTenantDeploy(f, opts));
}

export function summarizePlan(plan: DeployPlanItem[]): { deploy: number; overwrite: number; skipped: number } {
  return {
    deploy: plan.filter((p) => p.action === 'deploy').length,
    overwrite: plan.filter((p) => p.action === 'overwrite').length,
    skipped: plan.filter((p) => p.action === 'skip').length,
  };
}
