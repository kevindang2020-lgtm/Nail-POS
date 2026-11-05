// Repository for customer legal holds. Tenant-scoped throughout; holds are append-with-status (release is a
// status change, never a hard delete) so the legal trail is preserved.

import type { LegalHold } from '@aipowersalon/api-contracts/platform';
export type { LegalHold };   // owned by packages/api-contracts (Constitution 13 §13)
import type { LegalHoldStatus, LegalHoldScope } from './legal-hold-lifecycle';

export interface ApplyHoldRecord { tenantId: string; customerId: string | null; branchId: string | null; matterRef: string; reason: string; scope: LegalHoldScope; reviewAt: string | null; internalNotes: string | null; appliedByUserId: string | null; approvedByUserId: string | null }
export interface LegalHoldAudit { actionType: string; holdId: string; tenantId: string; customerId: string | null; reason: string; actorUserId?: string; ip?: string }

export interface LegalHoldRepo {
  applyHold(input: ApplyHoldRecord): Promise<LegalHold>;
  getHold(id: string): Promise<LegalHold | null>;
  releaseHold(id: string, opts: { reason: string; byUserId?: string }): Promise<boolean>;
  listHolds(scope: { tenantId?: string; status?: string }): Promise<LegalHold[]>;
  activeHoldsForCustomer(tenantId: string, customerId: string): Promise<LegalHold[]>;
  counts(scope: { tenantId?: string }): Promise<{ total: number; tenantCount: number }>;
  writeAudit(entry: LegalHoldAudit): Promise<void>;
}

export class InMemoryLegalHoldRepo implements LegalHoldRepo {
  private holds: LegalHold[] = [];
  private audit: LegalHoldAudit[] = [];
  private seq = 0;

  async applyHold(input: ApplyHoldRecord): Promise<LegalHold> {
    const now = new Date().toISOString();
    const hold: LegalHold = {
      id: `lh_${++this.seq}`, tenantId: input.tenantId, customerId: input.customerId, branchId: input.branchId,
      matterRef: input.matterRef, reason: input.reason, scope: input.scope, status: 'active',
      appliedByUserId: input.appliedByUserId, approvedByUserId: input.approvedByUserId,
      appliedAt: now, effectiveAt: now, reviewAt: input.reviewAt, releasedByUserId: null, releasedAt: null,
      releaseReason: null, internalNotes: input.internalNotes,
    };
    this.holds.push(hold);
    return { ...hold };
  }
  async getHold(id: string): Promise<LegalHold | null> { const h = this.holds.find((x) => x.id === id); return h ? { ...h } : null; }
  async releaseHold(id: string, opts: { reason: string; byUserId?: string }): Promise<boolean> {
    const h = this.holds.find((x) => x.id === id); if (!h || h.status !== 'active') return false;
    h.status = 'released'; h.releasedAt = new Date().toISOString(); h.releaseReason = opts.reason; h.releasedByUserId = opts.byUserId ?? null; return true;
  }
  async listHolds(scope: { tenantId?: string; status?: string }): Promise<LegalHold[]> {
    return this.holds.filter((h) => (!scope.tenantId || h.tenantId === scope.tenantId) && (!scope.status || h.status === scope.status)).map((h) => ({ ...h }));
  }
  async activeHoldsForCustomer(tenantId: string, customerId: string): Promise<LegalHold[]> {
    return this.holds.filter((h) => h.status === 'active' && h.tenantId === tenantId && (h.customerId === customerId || h.scope === 'tenant' || h.scope === 'branch')).map((h) => ({ ...h }));
  }
  async counts(scope: { tenantId?: string }): Promise<{ total: number; tenantCount: number }> {
    const active = this.holds.filter((h) => h.status === 'active' && (!scope.tenantId || h.tenantId === scope.tenantId));
    return { total: active.length, tenantCount: new Set(active.map((h) => h.tenantId)).size };
  }
  async writeAudit(entry: LegalHoldAudit): Promise<void> { this.audit.push({ ...entry }); }
  getAudit(): LegalHoldAudit[] { return [...this.audit]; }
}
