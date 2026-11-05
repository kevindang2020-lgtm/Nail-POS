// overage.service.ts — recomputes materialized overage charges from real usage vs the effective SOFT limit. Reuses the
// entitlement engine for effective-limit + authoritative usage; charges are integer-cents exact (computeOverage).
// Idempotent: a tenant/metric with no current overage has its row cleared. Permission-gated + audited.
import { Injectable, Inject } from '@nestjs/common';
import type { OverageRepo, AuditActor } from './overage.repository';
import { EntitlementsService } from './entitlements.service';
import { computeOverage, normalizeOverageRulesUpdate } from './overage-core';

export class OverageForbiddenError extends Error {}
export type OverageActor = AuditActor & { permissions?: string[] };
const MANAGE_PERM = 'super_admin.subscriptions.manage';

@Injectable()
export class OverageService {
  constructor(
    @Inject('OverageRepo') private readonly repo: OverageRepo,
    private readonly entitlements: EntitlementsService,
  ) {}

  private period(): string { return new Date().toISOString().slice(0, 7); } // YYYY-MM

  async getRules() {
    return this.repo.getRulesDetailed();
  }

  async updateRules(actor: OverageActor, input: unknown) {
    if (!(actor?.permissions ?? []).includes(MANAGE_PERM)) throw new OverageForbiddenError(`missing permission: ${MANAGE_PERM}`);
    const { reason, changes } = normalizeOverageRulesUpdate(input); // throws Error -> 400
    for (const c of changes) await this.repo.upsertRule(c);
    await this.repo.writeAudit(actor, 'super_admin_overage_rules_updated', 'platform', { reason, changes });
    return this.repo.getRulesDetailed();
  }

  async recompute(actor: OverageActor): Promise<{ period: string; tenantsProcessed: number; chargesWritten: number; totalRevenueCents: number }> {
    if (!(actor?.permissions ?? []).includes(MANAGE_PERM)) throw new OverageForbiddenError(`missing permission: ${MANAGE_PERM}`);
    const period = this.period();
    const [tenants, rules] = await Promise.all([this.repo.getActiveTenantIds(), this.repo.getDefaultOverageRules()]);
    let chargesWritten = 0; let totalRevenueCents = 0;

    for (const tenantId of tenants) {
      for (const rule of rules) {
        const c = await this.entitlements.checkLimit(tenantId, rule.metric);
        // Overage only applies to a known, finite, SOFT effective limit (hard limits block instead of charging).
        if (!c.usedKnown || c.effectiveValue === null || c.enforcement !== 'soft') {
          await this.repo.clearCharge(tenantId, rule.metric, period);
          continue;
        }
        const line = computeOverage(c.used ?? 0, c.effectiveValue, { unitPriceCents: rule.unitPriceCents });
        if (line.overageQty > 0) {
          await this.repo.upsertCharge({ tenantId, metric: rule.metric, period, includedQty: line.includedQty, usedQty: line.usedQty, overageQty: line.overageQty, unitPriceCents: line.unitPriceCents, amountCents: line.amountCents });
          chargesWritten++; totalRevenueCents += line.amountCents;
        } else {
          await this.repo.clearCharge(tenantId, rule.metric, period);
        }
      }
    }
    await this.repo.writeAudit(actor, 'super_admin_overage_recompute', period, { tenantsProcessed: tenants.length, rules: rules.length, chargesWritten, totalRevenueCents });
    return { period, tenantsProcessed: tenants.length, chargesWritten, totalRevenueCents };
  }
}
