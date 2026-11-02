// tenant-offers.service.ts — assigns add-ons, trials, and promotions to a tenant (catalog -> tenant linkage). All
// mutations are permission-gated and audited. Promotions enforce per-tenant and global redemption limits. Money cents.
import { Injectable, Inject } from '@nestjs/common';
import type { TenantOffersRepo, AuditActor } from './tenant-offers.repository';

export class OffersForbiddenError extends Error {}
export class OffersNotFoundError extends Error {}
export class OffersConflictError extends Error {}
export class OffersValidationError extends Error {}

export type OffersActor = AuditActor & { permissions?: string[] };
const MANAGE_PERM = 'super_admin.subscriptions.manage';

@Injectable()
export class TenantOffersService {
  constructor(@Inject('TenantOffersRepo') private readonly repo: TenantOffersRepo) {}

  private requireManage(actor: OffersActor) {
    if (!(actor?.permissions ?? []).includes(MANAGE_PERM)) throw new OffersForbiddenError(`missing permission: ${MANAGE_PERM}`);
  }

  async assignAddOn(actor: OffersActor, tenantId: string, addOnCode: string, quantity = 1, priceCentsOverride?: number | null) {
    this.requireManage(actor);
    const qty = Math.max(1, Math.trunc(Number(quantity) || 1));
    const addOn = await this.repo.getAddOnByCode(addOnCode);
    if (!addOn) throw new OffersNotFoundError(`add-on not found: ${addOnCode}`);
    const priceCents = priceCentsOverride != null && priceCentsOverride >= 0 ? Math.trunc(priceCentsOverride) : addOn.unitPriceCents * qty;
    await this.repo.upsertAddOn({ tenantId, addOnId: addOn.id, quantity: qty, priceCents });
    await this.repo.writeAudit(actor, 'super_admin_addon_assigned', tenantId, { addOn: addOn.code, quantity: qty, priceCents });
    return { tenantId, addOn: { code: addOn.code, name: addOn.name }, quantity: qty, priceCents };
  }

  async cancelAddOn(actor: OffersActor, tenantId: string, addOnCode: string) {
    this.requireManage(actor);
    const addOn = await this.repo.getAddOnByCode(addOnCode);
    if (!addOn) throw new OffersNotFoundError(`add-on not found: ${addOnCode}`);
    const affected = await this.repo.cancelAddOn(tenantId, addOn.id);
    if (affected === 0) throw new OffersNotFoundError(`no active ${addOnCode} assignment for tenant`);
    await this.repo.writeAudit(actor, 'super_admin_addon_cancelled', tenantId, { addOn: addOn.code });
    return { tenantId, addOn: addOn.code, cancelled: true };
  }

  async startTrial(actor: OffersActor, tenantId: string, trialCode: string) {
    this.requireManage(actor);
    const trial = await this.repo.getTrialByCode(trialCode);
    if (!trial) throw new OffersNotFoundError(`trial not found: ${trialCode}`);
    const id = await this.repo.startTrial({ tenantId, trialDefinitionId: trial.id, durationDays: trial.durationDays });
    await this.repo.writeAudit(actor, 'super_admin_trial_started', tenantId, { trial: trial.code, durationDays: trial.durationDays });
    return { id, tenantId, trial: { code: trial.code, name: trial.name }, durationDays: trial.durationDays };
  }

  async applyPromotion(actor: OffersActor, tenantId: string, promoCode: string) {
    this.requireManage(actor);
    const promo = await this.repo.getPromoByCode(promoCode);
    if (!promo) throw new OffersNotFoundError(`promotion not found: ${promoCode}`);
    if (promo.status !== 'active') throw new OffersValidationError(`promotion is not active: ${promoCode}`);
    const perTenant = await this.repo.countTenantPromoRedemptions(tenantId, promo.id);
    if (perTenant >= promo.perTenantLimit) throw new OffersConflictError(`per-tenant redemption limit reached for ${promoCode}`);
    if (promo.maxRedemptions != null) {
      const total = await this.repo.countTotalPromoRedemptions(promo.id);
      if (total >= promo.maxRedemptions) throw new OffersConflictError(`promotion fully redeemed: ${promoCode}`);
    }
    const id = await this.repo.applyPromo({ tenantId, promotionId: promo.id });
    await this.repo.writeAudit(actor, 'super_admin_promotion_applied', tenantId, { promotion: promo.code });
    return { id, tenantId, promotion: { code: promo.code, name: promo.name } };
  }
}
