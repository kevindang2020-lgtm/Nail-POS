// pos-social.service.ts — social content planner: view the calendar, draft/schedule posts, move a post
// through its status (draft -> scheduled -> posted -> archived). No platform publishing happens here.
import {
  buildSocialKpis, validateCreateSocialPost, canTransition, SOCIAL_STATUSES,
  type SocialContext, type SocialState, type SocialPost, type CreateSocialPostInput, type SocialStatus,
} from './pos-social.dto';
import type { SocialRepositoryPort } from './pos-social.repository';
import { InvalidStateTransitionError } from '@aipowersalon/database';
import { SOCIAL_POST } from './pos-social.dto';

export class SocialForbiddenError extends Error {}
export class SocialValidationError extends Error {}

export class SocialService {
  constructor(private readonly repo: SocialRepositoryPort) {}

  private auth(ctx: SocialContext) { if (!ctx?.userId || !ctx?.tenantId) throw new SocialForbiddenError('Not authenticated'); }

  async getState(ctx: SocialContext): Promise<SocialState> {
    this.auth(ctx);
    const posts = await this.repo.list(ctx);
    return { kpis: buildSocialKpis(posts), posts };
  }

  async create(ctx: SocialContext, input: CreateSocialPostInput): Promise<SocialPost> {
    this.auth(ctx);
    const v = validateCreateSocialPost(input);
    if (!v.ok) throw new SocialValidationError(v.error || 'Invalid post');
    return this.repo.create(ctx, { platform: input.platform, caption: String(input.caption).trim(), scheduledAt: input.scheduledAt ?? null });
  }

  async setStatus(ctx: SocialContext, id: string, status: string): Promise<SocialPost> {
    this.auth(ctx);
    if (!SOCIAL_STATUSES.includes(status as SocialStatus)) throw new SocialValidationError('Invalid status');
    const current = await this.repo.find(ctx, id);
    if (!current) throw new SocialValidationError('Post not found');
    if (!canTransition(current.status, status as SocialStatus)) throw new SocialValidationError(`Cannot move a ${current.status} post to ${status}`);
    // Phase 12 (#27): conditional on the state read above — a post another device moved meanwhile is a 409, not overwritten
    const row = await this.repo.setStatus(ctx, id, status as SocialStatus, current.status);
    if (!row) throw new InvalidStateTransitionError(SOCIAL_POST, (await this.repo.find(ctx, id))?.status ?? null, status, 'concurrent');
    return row;
  }
}
