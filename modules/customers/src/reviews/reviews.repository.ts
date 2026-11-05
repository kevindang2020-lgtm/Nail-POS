// reviews.repository.ts — repository port + in-memory adapter (dev/offline/tests default).
import type { ReviewsContext, Review } from './reviews.dto';

export interface ReviewsRepositoryPort {
  list(ctx: ReviewsContext): Promise<Review[]>;
  setHidden(ctx: ReviewsContext, id: string, hidden: boolean, reason: string | null): Promise<Review | null>;
}

export class InMemoryReviewsRepository implements ReviewsRepositoryPort {
  private rows: Review[];
  constructor(seed: Review[] = []) { this.rows = seed.slice(); }
  async list(_ctx: ReviewsContext): Promise<Review[]> { return this.rows.slice(); }
  async setHidden(_ctx: ReviewsContext, id: string, hidden: boolean, reason: string | null): Promise<Review | null> {
    const r = this.rows.find((x) => x.id === id); if (!r) return null;
    r.isHidden = hidden; r.hiddenReason = hidden ? reason : null; return r;
  }
}
