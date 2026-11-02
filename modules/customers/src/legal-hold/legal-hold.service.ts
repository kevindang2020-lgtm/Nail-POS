// Legal Hold service. Apply requires matter ref + reason + scope (+ customer for customer scope); release requires
// a reason; both are audited per hold. assertDeletable() is the guard the permanent-deletion / destructive-merge
// flows MUST call — it blocks when any active hold covers the customer. Tenant-scoped throughout.

import { validateApplyHold, validateReleaseHold, deletionBlockedByHold, type LegalHoldScope } from './legal-hold-lifecycle';
import type { LegalHoldRepo, LegalHold } from './legal-hold.repository';

export interface HoldActor { userId?: string; ip?: string }
export interface ApplyHoldArgs { tenantId?: string; customerId?: string | null; branchId?: string | null; matterRef?: string; reason?: string; scope?: string; reviewAt?: string | null; internalNotes?: string | null; approvedByUserId?: string | null }
export interface HoldResult { ok: boolean; errors?: string[]; hold?: LegalHold }

export class LegalHoldService {
  constructor(private readonly repo: LegalHoldRepo) {}

  async applyHold(args: ApplyHoldArgs, actor: HoldActor = {}): Promise<HoldResult> {
    const v = validateApplyHold(args);
    if (!v.ok) return { ok: false, errors: v.errors };
    const hold = await this.repo.applyHold({
      tenantId: args.tenantId!, customerId: args.customerId ?? null, branchId: args.branchId ?? null,
      matterRef: args.matterRef!.trim(), reason: args.reason!.trim(), scope: (args.scope || 'customer') as LegalHoldScope,
      reviewAt: args.reviewAt ?? null, internalNotes: args.internalNotes ?? null,
      appliedByUserId: actor.userId ?? null, approvedByUserId: args.approvedByUserId ?? null,
    });
    await this.repo.writeAudit({ actionType: 'customer_legal_hold_applied', holdId: hold.id, tenantId: hold.tenantId, customerId: hold.customerId, reason: hold.reason, actorUserId: actor.userId, ip: actor.ip });
    return { ok: true, hold };
  }

  async releaseHold(id: string, reason: string | undefined, actor: HoldActor = {}): Promise<HoldResult> {
    const hold = await this.repo.getHold(id);
    if (!hold) return { ok: false, errors: ['Hold not found.'] };
    const v = validateReleaseHold(hold.status, { reason });
    if (!v.ok) return { ok: false, errors: v.errors };
    const ok = await this.repo.releaseHold(id, { reason: reason!.trim(), byUserId: actor.userId });
    if (!ok) return { ok: false, errors: ['Hold could not be released.'] };
    await this.repo.writeAudit({ actionType: 'customer_legal_hold_released', holdId: id, tenantId: hold.tenantId, customerId: hold.customerId, reason: reason!.trim(), actorUserId: actor.userId, ip: actor.ip });
    return { ok: true, hold: { ...hold, status: 'released', releaseReason: reason!.trim() } };
  }

  listHolds(scope: { tenantId?: string; status?: string }) { return this.repo.listHolds(scope); }
  counts(scope: { tenantId?: string }) { return this.repo.counts(scope); }

  /** Deletion-block guard: throws-style result that the deletion/merge flows consult. */
  async assertDeletable(tenantId: string, customerId: string): Promise<{ deletable: boolean; blockingHolds: LegalHold[] }> {
    const holds = await this.repo.activeHoldsForCustomer(tenantId, customerId);
    const blocked = deletionBlockedByHold(holds, { tenantId, customerId });
    return { deletable: !blocked, blockingHolds: blocked ? holds : [] };
  }
}
