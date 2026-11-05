import { describe, it, expect } from 'vitest';
import { planTenantDeploy, planDeployment, summarizePlan, type TenantDeployFacts } from './deploy-core';

const facts = (o: Partial<TenantDeployFacts>): TenantDeployFacts => ({
  tenantId: 't', tenantName: 'T', alreadyDeployed: false, nameCollision: false, hasBranch: true, hasCategory: true, ...o,
});

describe('planTenantDeploy — the no-overwrite rule', () => {
  it('deploys a clean tenant', () => {
    expect(planTenantDeploy(facts({}), { allowOverwrite: false })).toMatchObject({ action: 'deploy', reason: 'ok' });
  });
  it('NEVER overwrites a name collision without explicit permission', () => {
    expect(planTenantDeploy(facts({ nameCollision: true }), { allowOverwrite: false })).toMatchObject({ action: 'skip', reason: 'name_conflict' });
  });
  it('overwrites only when explicitly allowed', () => {
    expect(planTenantDeploy(facts({ nameCollision: true }), { allowOverwrite: true })).toMatchObject({ action: 'overwrite', reason: 'ok' });
  });
  it('skips already-deployed, missing branch, missing category', () => {
    expect(planTenantDeploy(facts({ alreadyDeployed: true }), { allowOverwrite: true })).toMatchObject({ action: 'skip', reason: 'already_deployed' });
    expect(planTenantDeploy(facts({ hasBranch: false }), { allowOverwrite: true })).toMatchObject({ action: 'skip', reason: 'no_branch' });
    expect(planTenantDeploy(facts({ hasCategory: false }), { allowOverwrite: true })).toMatchObject({ action: 'skip', reason: 'no_category' });
  });
  it('branch/category gates take precedence over collision', () => {
    expect(planTenantDeploy(facts({ hasBranch: false, nameCollision: true }), { allowOverwrite: true })).toMatchObject({ action: 'skip', reason: 'no_branch' });
  });
});

describe('planDeployment + summarizePlan', () => {
  it('summarizes a mixed plan', () => {
    const plan = planDeployment([
      facts({ tenantId: 'a' }),
      facts({ tenantId: 'b', nameCollision: true }),
      facts({ tenantId: 'c', alreadyDeployed: true }),
      facts({ tenantId: 'd', nameCollision: true }),
    ], { allowOverwrite: false });
    expect(summarizePlan(plan)).toEqual({ deploy: 1, overwrite: 0, skipped: 3 });
    expect(summarizePlan(planDeployment([facts({ nameCollision: true })], { allowOverwrite: true }))).toEqual({ deploy: 0, overwrite: 1, skipped: 0 });
  });
});
