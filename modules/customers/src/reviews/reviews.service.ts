// reviews.service.ts — tenant reviews / reputation: read overview + manager hide/unhide.
import { buildReviewsSummary, type ReviewsContext, type ReviewsState, type Review } from './reviews.dto';
import type { ReviewsRepositoryPort } from './reviews.repository';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export class ReviewsForbiddenError extends Error {}
export class ReviewsValidationError extends Error {}

export class ReviewsService {
  constructor(private readonly repo: ReviewsRepositoryPort) {}
  private auth(ctx: ReviewsContext) { if (!ctx?.userId || !ctx?.tenantId) throw new ReviewsForbiddenError('Not authenticated'); }

  async getState(ctx: ReviewsContext): Promise<ReviewsState> {
    this.auth(ctx);
    const reviews = await this.repo.list(ctx);
    return { kpis: buildReviewsSummary(reviews), reviews };
  }

  async setVisibility(ctx: ReviewsContext, id: string, hidden: boolean, reason: string | null): Promise<Review> {
    this.auth(ctx);
    if (hidden && (!reason || !reason.trim())) throw withCode(new ReviewsValidationError('A reason is required to hide a review'), 'HIDE_REVIEW_REASON_REQUIRED');
    const row = await this.repo.setHidden(ctx, id, hidden, reason && reason.trim() ? reason.trim() : null);
    if (!row) throw withCode(new ReviewsValidationError('Review not found'), 'REVIEW_NOT_FOUND');
    return row;
  }
}
