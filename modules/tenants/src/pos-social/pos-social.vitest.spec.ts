import { describe, it, expect } from 'vitest';
import { buildSocialKpis, validateCreateSocialPost, canTransition, type SocialPost, type SocialContext } from './pos-social.dto';
import { InMemorySocialRepository } from './pos-social.repository';
import { SocialService, SocialForbiddenError, SocialValidationError } from './pos-social.service';

const ctx = (o: Partial<SocialContext> = {}): SocialContext => ({ tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.marketing.manage'], ...o });
const post = (o: Partial<SocialPost> = {}): SocialPost => ({ id: 's1', platform: 'instagram', caption: 'Spring looks', scheduledAt: null, status: 'draft', postedAt: null, createdAt: '2026-07-01T00:00:00.000Z', ...o });

describe('social — KPIs (pure)', () => {
  it('counts by status; archived excluded from total', () => {
    const k = buildSocialKpis([post(), post({ id: 's2', status: 'scheduled' }), post({ id: 's3', status: 'posted' }), post({ id: 's4', status: 'archived' })]);
    expect(k).toEqual({ drafts: 1, scheduled: 1, posted: 1, total: 3 });
  });
});

describe('social — validation + transitions (pure)', () => {
  it('requires caption + valid platform', () => {
    expect(validateCreateSocialPost({ platform: 'instagram', caption: '' }).ok).toBe(false);
    expect(validateCreateSocialPost({ platform: 'nope' as any, caption: 'hi' }).ok).toBe(false);
    expect(validateCreateSocialPost({ platform: 'instagram', caption: 'hi' }).ok).toBe(true);
  });
  it('allows sensible transitions only', () => {
    expect(canTransition('draft', 'scheduled')).toBe(true);
    expect(canTransition('scheduled', 'posted')).toBe(true);
    expect(canTransition('posted', 'archived')).toBe(true);
    expect(canTransition('posted', 'draft')).toBe(false);
    expect(canTransition('draft', 'archived')).toBe(true);
  });
});

describe('social — service', () => {
  it('rejects unauthenticated', async () => {
    const svc = new SocialService(new InMemorySocialRepository());
    await expect(svc.getState({ ...ctx(), userId: '' } as any)).rejects.toBeInstanceOf(SocialForbiddenError);
  });
  it('creates a draft (no schedule) or scheduled (with schedule) and rolls up KPIs', async () => {
    const svc = new SocialService(new InMemorySocialRepository());
    const d = await svc.create(ctx(), { platform: 'instagram', caption: 'Draft one' });
    expect(d.status).toBe('draft');
    const s = await svc.create(ctx(), { platform: 'facebook', caption: 'Scheduled one', scheduledAt: '2026-08-01T10:00:00.000Z' });
    expect(s.status).toBe('scheduled');
    const state = await svc.getState(ctx());
    expect(state.kpis.total).toBe(2);
    expect(state.kpis.drafts).toBe(1);
    expect(state.kpis.scheduled).toBe(1);
  });
  it('moves a post to posted (stamps postedAt) and blocks illegal transitions', async () => {
    const svc = new SocialService(new InMemorySocialRepository());
    const d = await svc.create(ctx(), { platform: 'instagram', caption: 'Hello' });
    const posted = await svc.setStatus(ctx(), d.id, 'posted');
    expect(posted.status).toBe('posted');
    expect(posted.postedAt).not.toBeNull();
    await expect(svc.setStatus(ctx(), d.id, 'draft')).rejects.toBeInstanceOf(SocialValidationError);
  });
  it('rejects an invalid caption on create', async () => {
    const svc = new SocialService(new InMemorySocialRepository());
    await expect(svc.create(ctx(), { platform: 'instagram', caption: '   ' })).rejects.toBeInstanceOf(SocialValidationError);
  });
});
