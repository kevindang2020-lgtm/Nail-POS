// subscription-change.repository.ts — data port for the tenant plan-change workflow.
export type CurrentSubscription = {
  planText: string | null; planCode: string | null; monthlyPriceCents: number | null;
  periodStartMs: number | null; periodEndMs: number | null; status: string | null;
};
export type CatalogPlan = { code: string; name: string; monthlyPriceCents: number; billingInterval: string };
export type ApplyImmediate = {
  tenantId: string; toPlan: CatalogPlan; fromPlanCode: string | null; changeType: string;
  creditCents: number; chargeCents: number; netCents: number; reason: string | null; createdBy: string | null;
};
export type RecordScheduled = {
  tenantId: string; toPlanCode: string; fromPlanCode: string | null; changeType: string;
  effectiveAtMs: number; reason: string | null; createdBy: string | null;
};
export type ChangeRow = {
  id: string; fromPlanCode: string | null; toPlanCode: string; changeType: string; strategy: string;
  status: string; effectiveAt: string; netCents: number; creditCents: number; chargeCents: number; reason: string | null; createdAt: string;
};
export type AuditActor = { userId?: string | null; role?: string | null };

export interface SubscriptionChangeRepo {
  getSubscription(tenantId: string): Promise<CurrentSubscription | null>;
  getPlanByCode(code: string): Promise<CatalogPlan | null>;
  applyImmediateChange(p: ApplyImmediate): Promise<string>;
  recordScheduledChange(p: RecordScheduled): Promise<string>;
  getDueScheduledChanges(nowIso: string): Promise<{ id: string; tenantId: string; toPlanCode: string }[]>;
  applyScheduledChange(changeId: string, tenantId: string, toPlan: CatalogPlan): Promise<void>;
  listChanges(tenantId: string): Promise<ChangeRow[]>;
  writeAudit(actor: AuditActor, action: string, entityId: string, meta: Record<string, unknown>): Promise<void>;
}

const NO_DB = () => { throw new Error('database not available'); };
export class InMemorySubscriptionChangeRepo implements SubscriptionChangeRepo {
  async getSubscription(): Promise<CurrentSubscription | null> { return null; }
  async getPlanByCode(): Promise<CatalogPlan | null> { return null; }
  async applyImmediateChange(): Promise<string> { return NO_DB(); }
  async recordScheduledChange(): Promise<string> { return NO_DB(); }
  async getDueScheduledChanges(): Promise<{ id: string; tenantId: string; toPlanCode: string }[]> { return []; }
  async applyScheduledChange(): Promise<void> { return NO_DB(); }
  async listChanges(): Promise<ChangeRow[]> { return []; }
  async writeAudit(): Promise<void> { /* no-op */ }
}
