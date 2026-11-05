import { describe, it, expect } from 'vitest';
import { buildReviewsSummary, type Review, type ReviewsContext } from './reviews.dto';
import { InMemoryReviewsRepository } from './reviews.repository';
import { ReviewsService, ReviewsForbiddenError, ReviewsValidationError } from './reviews.service';

const rv = (o: Partial<Review> = {}): Review => ({
  id: 'r1', rating: 5, comment: 'Great!', technicianId: 't1', technicianName: 'Ana', tags: ['friendly'],
  isPublic: true, isHidden: false, hiddenReason: null, customerId: 'c1', createdAt: '2026-07-01T00:00:00.000Z', ...o,
});
const ctx = (o: Partial<ReviewsContext> = {}): ReviewsContext => ({ tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.marketing.manage'], ...o });

describe('reviews — summary (pure)', () => {
  it('computes average, star distribution, and counts', () => {
    const s = buildReviewsSummary([
      rv({ rating: 5 }), rv({ id: 'r2', rating: 4.5 }), rv({ id: 'r3', rating: 3, comment: null }),
      rv({ id: 'r4', rating: 1, isPublic: false, isHidden: true, hiddenReason: 'abusive' }),
    ]);
    expect(s.totalReviews).toBe(4);
    expect(s.averageRating).toBe(3.4); // (5+4.5+3+1)/4 = 3.375 -> 3.4
    expect(s.ratingDistribution).toEqual([{ star: 5, count: 2 }, { star: 4, count: 0 }, { star: 3, count: 1 }, { star: 2, count: 0 }, { star: 1, count: 1 }]);
    expect(s.publicCount).toBe(3);
    expect(s.hiddenCount).toBe(1);
    expect(s.withCommentCount).toBe(3);
    expect(s.fiveStarPercent).toBe(50); // 2 of 4 rated >= 4.5
  });
  it('handles no reviews', () => {
    const s = buildReviewsSummary([]);
    expect(s.totalReviews).toBe(0); expect(s.averageRating).toBe(0); expect(s.fiveStarPercent).toBe(0);
  });
});

describe('reviews — service', () => {
  it('returns kpis + reviews', async () => {
    const svc = new ReviewsService(new InMemoryReviewsRepository([rv()]));
    const st = await svc.getState(ctx());
    expect(st.kpis.totalReviews).toBe(1); expect(st.reviews).toHaveLength(1);
  });
  it('hides a review (reason required) and unhides', async () => {
    const repo = new InMemoryReviewsRepository([rv()]);
    const svc = new ReviewsService(repo);
    await expect(svc.setVisibility(ctx(), 'r1', true, '')).rejects.toBeInstanceOf(ReviewsValidationError);
    const hidden = await svc.setVisibility(ctx(), 'r1', true, 'off-topic');
    expect(hidden.isHidden).toBe(true); expect(hidden.hiddenReason).toBe('off-topic');
    const shown = await svc.setVisibility(ctx(), 'r1', false, null);
    expect(shown.isHidden).toBe(false); expect(shown.hiddenReason).toBeNull();
  });
  it('rejects unauthenticated', async () => {
    const svc = new ReviewsService(new InMemoryReviewsRepository());
    await expect(svc.getState({ tenantId: '', userId: '', role: '', permissions: [] } as any)).rejects.toBeInstanceOf(ReviewsForbiddenError);
  });
});
