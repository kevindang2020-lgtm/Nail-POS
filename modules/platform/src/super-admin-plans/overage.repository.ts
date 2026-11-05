import type { OverageRuleDetail } from '@aipowersalon/api-contracts/platform';
export type { OverageRuleDetail };   // owned by packages/api-contracts (Constitution 13 §13)
// overage.repository.ts — data port for overage metering writes (the charge ledger) + the tenant/rule inputs.
export type OverageRuleRow = { metric: string; unitPriceCents: number };
export type OverageRuleUpsert = { metric: string; unitPriceCents: number; graceAmount?: number; warningThresholdPct?: number };
export type ChargeWrite = { tenantId: string; metric: string; period: string; includedQty: number; usedQty: number; overageQty: number; unitPriceCents: number; amountCents: number };
export type AuditActor = { userId?: string | null; role?: string | null };

export interface OverageRepo {
  getActiveTenantIds(): Promise<string[]>;
  getDefaultOverageRules(): Promise<OverageRuleRow[]>;
  getRulesDetailed(): Promise<OverageRuleDetail[]>;
  upsertRule(r: OverageRuleUpsert): Promise<void>;
  upsertCharge(c: ChargeWrite): Promise<void>;
  clearCharge(tenantId: string, metric: string, period: string): Promise<void>;
  writeAudit(actor: AuditActor, action: string, entityId: string, meta: Record<string, unknown>): Promise<void>;
}

const NO_DB = () => { throw new Error('database not available'); };

export class InMemoryOverageRepo implements OverageRepo {
  async getActiveTenantIds(): Promise<string[]> { return []; }
  async getDefaultOverageRules(): Promise<OverageRuleRow[]> { return []; }
  async getRulesDetailed(): Promise<OverageRuleDetail[]> { return []; }
  async upsertRule(): Promise<void> { return NO_DB(); }
  async upsertCharge(): Promise<void> { return NO_DB(); }
  async clearCharge(): Promise<void> { /* no-op */ }
  async writeAudit(): Promise<void> { /* no-op */ }
}
