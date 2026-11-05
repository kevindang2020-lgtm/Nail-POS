// BUILD_PLAN Phase 12 (#27): SOCIAL_POST is exactly canTransition (pos-social.dto), and the service's write is
// conditional on the status it read — a post another device moved meanwhile is a 409, not overwritten.
import { describe, it, expect } from 'vitest';
import { InvalidStateTransitionError } from '@aipowersalon/database';
import { SOCIAL_POST, canTransition, SOCIAL_STATUSES } from './pos-social.dto';
import { SocialService as PosSocialService } from './pos-social.service';

describe('social_posts.status machine', () => {
  it('is exactly canTransition for every pair of states', () => {
    for (const f of SOCIAL_STATUSES) for (const t of SOCIAL_STATUSES) expect(SOCIAL_POST.can(f, t), `${f} → ${t}`).toBe(canTransition(f, t));
  });
  it('a post that changed after it was read is refused with 409 (the conditional write lost)', async () => {
    const post = { id: 'p1', platform: 'instagram', caption: 'x', scheduledAt: null, status: 'draft', postedAt: null, createdAt: '' } as any;
    const repo: any = { find: async () => post, setStatus: async (_c: any, _id: string, _s: string, from?: string) => (from === 'draft' ? null : post) };
    const svc = new PosSocialService(repo);
    const ctx = { tenantId: 't', branchId: 'b', userId: 'u', role: 'OWNER', permissions: ['pos.marketing.manage'] } as any;
    await expect(svc.setStatus(ctx, 'p1', 'posted')).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });
});
