// tenant-offers.repository.ts — data port for assigning add-ons, trials, and promotions to a tenant (catalog -> tenant
// linkage). Reads resolve catalog rows by code; writes upsert/insert the linkage tables. Money in BIGINT cents.
export type AddOnCatalog = { id: string; code: string; name: string; unitPriceCents: number };
export type TrialCatalog = { id: string; code: string; name: string; durationDays: number };
export type PromoCatalog = { id: string; code: string; name: string; status: string; perTenantLimit: number; maxRedemptions: number | null };
export type AuditActor = { userId?: string | null; role?: string | null };

export type AddOnAssignment = { tenantId: string; addOnId: string; quantity: number; priceCents: number };
export type TrialStart = { tenantId: string; trialDefinitionId: string; durationDays: number };
export type PromoApply = { tenantId: string; promotionId: string };

export interface TenantOffersRepo {
  getAddOnByCode(code: string): Promise<AddOnCatalog | null>;
  getTrialByCode(code: string): Promise<TrialCatalog | null>;
  getPromoByCode(code: string): Promise<PromoCatalog | null>;
  upsertAddOn(a: AddOnAssignment): Promise<void>;
  cancelAddOn(tenantId: string, addOnId: string): Promise<number>;          // rows affected
  startTrial(t: TrialStart): Promise<string>;                                // new id
  countTenantPromoRedemptions(tenantId: string, promotionId: string): Promise<number>;
  countTotalPromoRedemptions(promotionId: string): Promise<number>;
  applyPromo(p: PromoApply): Promise<string>;                                // new id
  writeAudit(actor: AuditActor, action: string, entityId: string, meta: Record<string, unknown>): Promise<void>;
}

const NO_DB = () => { throw new Error('database not available'); };
export class InMemoryTenantOffersRepo implements TenantOffersRepo {
  async getAddOnByCode(): Promise<AddOnCatalog | null> { return null; }
  async getTrialByCode(): Promise<TrialCatalog | null> { return null; }
  async getPromoByCode(): Promise<PromoCatalog | null> { return null; }
  async upsertAddOn(): Promise<void> { return NO_DB(); }
  async cancelAddOn(): Promise<number> { return 0; }
  async startTrial(): Promise<string> { return NO_DB(); }
  async countTenantPromoRedemptions(): Promise<number> { return 0; }
  async countTotalPromoRedemptions(): Promise<number> { return 0; }
  async applyPromo(): Promise<string> { return NO_DB(); }
  async writeAudit(): Promise<void> { /* no-op */ }
}
