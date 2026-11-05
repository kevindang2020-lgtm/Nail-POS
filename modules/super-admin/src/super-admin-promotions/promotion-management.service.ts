// Super Admin promotion lifecycle management — approve / reject / disable / transition on the real promotions table.
// Every change is validated by promotion-lifecycle-core before any write; disabling preserves the record and history.
import { applyApproval, canDisable, validateTransition, requireReason } from './promotion-lifecycle-core';
import type { PromotionManagementRepositoryPort } from './promotion-management.repository';

export class PromotionManagementError extends Error { constructor(public code: 'invalid' | 'not_found' | 'conflict', message: string) { super(message); } }

export class PromotionManagementService {
  constructor(private readonly repo: PromotionManagementRepositoryPort) {}

  private async load(id: string) {
    const row = await this.repo.getPromotion(String(id || ''));
    if (!row) throw new PromotionManagementError('not_found', 'Promotion not found');
    return row;
  }

  async approve(id: string) {
    const row = await this.load(id);
    const d = applyApproval(row.status, 'approve');
    if (!d.ok) throw new PromotionManagementError('conflict', d.reason);
    return this.repo.setApproval(row.id, d.approvalStatus, d.status, null);
  }

  async reject(id: string, reason: unknown) {
    const r = requireReason(reason);
    if (!r.ok) throw new PromotionManagementError('invalid', r.error);
    const row = await this.load(id);
    const d = applyApproval(row.status, 'reject');
    if (!d.ok) throw new PromotionManagementError('conflict', d.reason);
    return this.repo.setApproval(row.id, d.approvalStatus, d.status, r.reason);
  }

  async disable(id: string, reason: unknown) {
    const r = requireReason(reason);
    if (!r.ok) throw new PromotionManagementError('invalid', r.error);
    const row = await this.load(id);
    const c = canDisable(row.status);
    if (!c.ok) throw new PromotionManagementError('conflict', c.reason);
    return this.repo.disable(row.id, r.reason);
  }

  async transition(id: string, to: string) {
    const row = await this.load(id);
    const t = validateTransition(row.status, to);
    if (!t.ok) throw new PromotionManagementError('conflict', t.reason);
    return this.repo.setStatus(row.id, t.status);
  }
}
