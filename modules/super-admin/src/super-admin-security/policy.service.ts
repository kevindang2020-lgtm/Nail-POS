// Security-policy engine — validated, versioned, compliance-evaluated, audited. Stores configuration only. Each update
// creates a new active version (prior archived). Compliance is an internal baseline score, not external certification.
import { validatePolicy, evaluateCompliance, nextPolicyVersion } from './policy-core';
import type { PolicyRepositoryPort, PolicyActor } from './policy.repository';

export class PolicyError extends Error { constructor(public code: 'invalid', message: string) { super(message); } }

export class PolicyService {
  constructor(private readonly repo: PolicyRepositoryPort) {}

  async get(kind: string) {
    const active = await this.repo.getActive(kind);
    if (!active) return { kind, available: false as const, note: 'No active policy configured' };
    const comp = evaluateCompliance(kind, active.config);
    return { kind, available: true as const, version: active.version, config: active.config, compliant: active.compliant, complianceFailing: comp.failing };
  }

  async update(kind: string, config: Record<string, unknown>, actor: PolicyActor) {
    const v = validatePolicy(kind, config || {});
    if (!v.ok) throw new PolicyError('invalid', v.errors.join('; '));
    const comp = evaluateCompliance(kind, config);
    const version = nextPolicyVersion(await this.repo.listVersions(kind));
    const row = await this.repo.insertActive(kind, version, config, comp.compliant, actor);
    return { kind, version: row.version, compliant: comp.compliant, complianceFailing: comp.failing };
  }

  async history(kind: string) { return this.repo.history(kind, 10); }
}
