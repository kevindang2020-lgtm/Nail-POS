// reviews.dto.ts — tenant reviews / reputation (read + manager visibility control). Reuses the existing
// `reviews` table (in kysely.types as ReviewsTable). Ratings are NUMERIC(2,1); no money here.

export interface ReviewsContext {
  tenantId: string;
  branchId?: string;
  userId: string;
  role: string;
  permissions: string[];
}

export interface Review {
  id: string;
  rating: number;
  comment: string | null;
  technicianId: string | null;
  technicianName: string | null;
  tags: string[];
  isPublic: boolean;
  isHidden: boolean;
  hiddenReason: string | null;
  customerId: string | null;
  createdAt: string;
}

export interface RatingBucket { star: number; count: number; }

export interface ReviewsSummary {
  totalReviews: number;
  averageRating: number;          // 1 decimal
  ratingDistribution: RatingBucket[]; // stars 5..1
  publicCount: number;
  hiddenCount: number;
  withCommentCount: number;
  fiveStarPercent: number;        // share of reviews rated >= 4.5
}

export interface ReviewsState { kpis: ReviewsSummary; reviews: Review[]; }

// Pure summary — average, 5..1 star distribution (by rounded star), and counts. No DB, unit-testable.
export function buildReviewsSummary(reviews: Review[]): ReviewsSummary {
  const total = reviews.length;
  let sum = 0, publicCount = 0, hiddenCount = 0, withCommentCount = 0, topRated = 0;
  const buckets = new Map<number, number>([[5, 0], [4, 0], [3, 0], [2, 0], [1, 0]]);
  for (const r of reviews) {
    const rating = Math.max(0, Number(r.rating) || 0);
    sum += rating;
    if (r.isPublic) publicCount++;
    if (r.isHidden) hiddenCount++;
    if (r.comment && r.comment.trim()) withCommentCount++;
    if (rating >= 4.5) topRated++;
    const star = Math.min(5, Math.max(1, Math.round(rating)));
    buckets.set(star, (buckets.get(star) || 0) + 1);
  }
  const averageRating = total ? Math.round((sum / total) * 10) / 10 : 0;
  const ratingDistribution: RatingBucket[] = [5, 4, 3, 2, 1].map((star) => ({ star, count: buckets.get(star) || 0 }));
  const fiveStarPercent = total ? Math.round((topRated / total) * 1000) / 10 : 0;
  return { totalReviews: total, averageRating, ratingDistribution, publicCount, hiddenCount, withCommentCount, fiveStarPercent };
}
