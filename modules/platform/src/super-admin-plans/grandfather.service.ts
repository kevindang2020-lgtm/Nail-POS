// grandfather.service.ts — creates/lists grandfathered plan assignments (tenant locked to a plan version + price).
// Permission-gated + audited. Locked price defaults to the version's monthly price when not supplied.
import { Injectable, Inject } from '@nestjs/common';
import type { GrandfatherRepo, AuditActor } from './grandfather.repository';
import { normalizeGrandfatherCreate } from './plan-mutations-core';

export class GrandfatherForbiddenError extends Error {}
export class GrandfatherNotFoundError extends Error {}

export type GrandfatherActor = AuditActor & { permissions?: string[] };
const MANAGE_PERM = 'super_admin.subscriptions.manage';

@Injectable()
export class GrandfatherService {
  constructor(@Inject('GrandfatherRepo') private readonly repo: GrandfatherRepo) {}

  async list() { return this.repo.listAssignments(); }

  async create(actor: GrandfatherActor, input: unknown) {
    if (!(actor?.permissions ?? []).includes(MANAGE_PERM)) throw new GrandfatherForbiddenError(`missing permission: ${MANAGE_PERM}`);
    const n = normalizeGrandfatherCreate(input); // throws Error -> 400
    if (!(await this.repo.tenantExists(n.tenantId))) throw new GrandfatherNotFoundError(`tenant not found: ${n.tenantId}`);
    const version = await this.repo.getPlanVersionInfo(n.planVersionId);
    if (!version) throw new GrandfatherNotFoundError(`plan version not found: ${n.planVersionId}`);
    const lockedPriceCents = n.lockedMonthlyPriceCents ?? version.monthlyPriceCents;
    const id = await this.repo.upsertAssignment(n, lockedPriceCents, actor.userId ?? null);
    await this.repo.writeAudit(actor, 'super_admin_grandfathered_assignment_set', n.tenantId, {
      planCode: version.planCode, versionNumber: version.versionNumber, lockedPriceCents, migrationTargetPlanCode: n.migrationTargetPlanCode, reason: n.reason,
    });
    return { id, tenantId: n.tenantId, planCode: version.planCode, versionNumber: version.versionNumber, lockedMonthlyPriceCents: lockedPriceCents };
  }
}
