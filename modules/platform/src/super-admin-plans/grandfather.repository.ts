// grandfather.repository.ts — data port for grandfathered plan assignments (a tenant locked to a specific plan
// version + price). One assignment per tenant (upsert on tenant_id). Money in BIGINT cents.
import type { GrandfatherRow } from '@aipowersalon/api-contracts/platform';
export type { GrandfatherRow };   // owned by packages/api-contracts (Constitution 13 §13)
import type { NormalizedGrandfather } from './plan-mutations-core';

export type PlanVersionInfo = { id: string; planCode: string; versionNumber: number; monthlyPriceCents: number };
export type AuditActor = { userId?: string | null; role?: string | null };

export interface GrandfatherRepo {
  tenantExists(tenantId: string): Promise<boolean>;
  getPlanVersionInfo(planVersionId: string): Promise<PlanVersionInfo | null>;
  upsertAssignment(n: NormalizedGrandfather, lockedPriceCents: number, createdBy: string | null): Promise<string>;
  listAssignments(): Promise<GrandfatherRow[]>;
  writeAudit(actor: AuditActor, action: string, entityId: string, meta: Record<string, unknown>): Promise<void>;
}

const NO_DB = () => { throw new Error('database not available'); };
export class InMemoryGrandfatherRepo implements GrandfatherRepo {
  async tenantExists(): Promise<boolean> { return false; }
  async getPlanVersionInfo(): Promise<PlanVersionInfo | null> { return null; }
  async upsertAssignment(): Promise<string> { return NO_DB(); }
  async listAssignments(): Promise<GrandfatherRow[]> { return []; }
  async writeAudit(): Promise<void> { /* no-op */ }
}
