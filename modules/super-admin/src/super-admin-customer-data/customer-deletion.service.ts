// Customer permanent-deletion service. The destructive path is gated by: (1) a request, (2) a SECOND distinct
// approver, (3) at execution — an exact typed customer-ID confirmation, a retention check, and the legal-hold
// guard (assertDeletable). Only when all pass is the customer actually deleted. Every step is audited.

import { validateRequest, canApprove, validateExecute, type DeletionStatus } from './deletion-workflow';
import type { DeletionRepo, DeletionRequest } from './customer-deletion.repository';
import type { LegalHoldService } from '@aipowersalon/customers';

export interface DeletionActor { userId?: string; ip?: string }
export interface RequestArgs { tenantId?: string; customerId?: string; reason?: string }
export interface DeletionResult { ok: boolean; errors?: string[]; request?: DeletionRequest }

export class CustomerDeletionService {
  constructor(private readonly repo: DeletionRepo, private readonly legalHolds?: LegalHoldService) {}

  async requestDeletion(args: RequestArgs, actor: DeletionActor = {}): Promise<DeletionResult> {
    const v = validateRequest(args);
    if (!v.ok) return { ok: false, errors: v.errors };
    const req = await this.repo.create({ tenantId: args.tenantId!, customerId: args.customerId!, reason: args.reason!.trim(), requestedByUserId: actor.userId ?? null });
    await this.repo.writeAudit({ actionType: 'customer_deletion_requested', requestId: req.id, tenantId: req.tenantId, customerId: req.customerId, detail: { reason: req.reason }, actorUserId: actor.userId, ip: actor.ip });
    return { ok: true, request: req };
  }

  async approveDeletion(id: string, actor: DeletionActor = {}): Promise<DeletionResult> {
    const req = await this.repo.get(id);
    if (!req) return { ok: false, errors: ['Deletion request not found.'] };
    const gate = canApprove(req.status, req.requestedByUserId, actor.userId ?? null);
    if (!gate.ok) return { ok: false, errors: gate.errors };
    await this.repo.setStatus(id, 'approved', { approvedByUserId: actor.userId ?? null, approvedAt: new Date().toISOString() });
    await this.repo.writeAudit({ actionType: 'customer_deletion_approved', requestId: id, tenantId: req.tenantId, customerId: req.customerId, detail: {}, actorUserId: actor.userId, ip: actor.ip });
    return { ok: true, request: (await this.repo.get(id))! };
  }

  async rejectDeletion(id: string, reason: string | undefined, actor: DeletionActor = {}): Promise<DeletionResult> {
    const req = await this.repo.get(id);
    if (!req) return { ok: false, errors: ['Deletion request not found.'] };
    if (req.status !== 'requested' && req.status !== 'approved') return { ok: false, errors: ['Only an open deletion request can be rejected.'] };
    if (!reason || !reason.trim()) return { ok: false, errors: ['A rejection reason is required.'] };
    await this.repo.setStatus(id, 'rejected', { rejectReason: reason.trim() });
    await this.repo.writeAudit({ actionType: 'customer_deletion_rejected', requestId: id, tenantId: req.tenantId, customerId: req.customerId, detail: { reason: reason.trim() }, actorUserId: actor.userId, ip: actor.ip });
    return { ok: true, request: (await this.repo.get(id))! };
  }

  async executeDeletion(id: string, typedConfirmation: string | undefined, actor: DeletionActor = {}): Promise<DeletionResult> {
    const req = await this.repo.get(id);
    if (!req) return { ok: false, errors: ['Deletion request not found.'] };
    const retention = await this.repo.retentionAllows(req.tenantId, req.customerId);
    const hold = this.legalHolds ? await this.legalHolds.assertDeletable(req.tenantId, req.customerId) : { deletable: true };
    const legalHoldBlocked = !hold.deletable;
    const gate = validateExecute({ status: req.status, customerId: req.customerId, typedConfirmation: typedConfirmation ?? '', retentionOk: retention.ok, legalHoldBlocked });
    if (!gate.ok) {
      // snapshot the block reason for the trail even when execution is refused
      await this.repo.setStatus(id, req.status, { retentionChecked: true, retentionNote: retention.note, legalHoldBlocked });
      await this.repo.writeAudit({ actionType: 'customer_deletion_blocked', requestId: id, tenantId: req.tenantId, customerId: req.customerId, detail: { errors: gate.errors, legalHoldBlocked }, actorUserId: actor.userId, ip: actor.ip });
      return { ok: false, errors: gate.errors };
    }
    const deleted = await this.repo.hardDeleteCustomer(req.tenantId, req.customerId);
    if (!deleted) return { ok: false, errors: ['The customer record could not be deleted.'] };
    await this.repo.setStatus(id, 'executed', { executedByUserId: actor.userId ?? null, executedAt: new Date().toISOString(), retentionChecked: true, retentionNote: retention.note, legalHoldBlocked: false });
    await this.repo.writeAudit({ actionType: 'customer_deletion_executed', requestId: id, tenantId: req.tenantId, customerId: req.customerId, detail: { reason: req.reason }, actorUserId: actor.userId, ip: actor.ip });
    return { ok: true, request: (await this.repo.get(id))! };
  }

  list(scope: { tenantId?: string; status?: string }) { return this.repo.list(scope); }
}
