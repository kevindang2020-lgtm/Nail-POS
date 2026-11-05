import { describe, it, expect, beforeEach } from 'vitest';
import { PromotionManagementService, PromotionManagementError } from './promotion-management.service';
import { InMemoryPromotionManagementRepository } from './promotion-management.repository';

let repo: InMemoryPromotionManagementRepository; let svc: PromotionManagementService;
beforeEach(() => {
  repo = new InMemoryPromotionManagementRepository();
  repo.rows.set('p1', { id: 'p1', status: 'pending_approval', approvalStatus: 'pending', tenantId: 't1', name: 'High Value' });
  repo.rows.set('p2', { id: 'p2', status: 'active', approvalStatus: 'approved', tenantId: 't1', name: 'Live' });
  repo.rows.set('p3', { id: 'p3', status: 'draft', approvalStatus: 'not_required', tenantId: 't1', name: 'Draft' });
  svc = new PromotionManagementService(repo);
});

describe('PromotionManagementService', () => {
  it('approves a pending promotion (approval_status + status become approved)', async () => {
    const r = await svc.approve('p1');
    expect(r).toMatchObject({ status: 'approved', approvalStatus: 'approved' });
  });

  it('rejects a pending promotion, requires a reason, and persists it', async () => {
    await expect(svc.reject('p1', '')).rejects.toMatchObject({ code: 'invalid' });
    const r = await svc.reject('p1', 'discount exceeds policy');
    expect(r).toMatchObject({ status: 'rejected', approvalStatus: 'rejected' });
    expect((repo.rows.get('p1') as any).decisionReason).toBe('discount exceeds policy');
  });

  it('cannot approve an already-active promotion (conflict)', async () => {
    await expect(svc.approve('p2')).rejects.toMatchObject({ code: 'conflict' });
  });

  it('disables an active promotion with a reason and preserves the record', async () => {
    const r = await svc.disable('p2', 'policy violation');
    expect(r!.status).toBe('disabled');
    expect(repo.rows.has('p2')).toBe(true); // preserved, not deleted
    expect((repo.rows.get('p2') as any).disabledReason).toBe('policy violation');
  });

  it('refuses to disable a draft and refuses an invalid transition', async () => {
    await expect(svc.disable('p3', 'because')).rejects.toMatchObject({ code: 'conflict' });
    await expect(svc.transition('p2', 'draft')).rejects.toMatchObject({ code: 'conflict' });
    const t = await svc.transition('p2', 'paused');
    expect(t!.status).toBe('paused');
  });

  it('404s an unknown promotion', async () => {
    await expect(svc.approve('ghost')).rejects.toBeInstanceOf(PromotionManagementError);
    await expect(svc.approve('ghost')).rejects.toMatchObject({ code: 'not_found' });
  });
});
