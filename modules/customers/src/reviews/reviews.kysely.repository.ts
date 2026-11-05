// reviews.kysely.repository.ts — Kysely adapter. Scoping is server-derived from ctx. LEFT JOINs
// technicians for the display name; review_tags (jsonb) is normalized to a string array.
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { ReviewsContext, Review } from './reviews.dto';
import type { ReviewsRepositoryPort } from './reviews.repository';

function parseTags(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p.map((x) => String(x)) : []; } catch { return []; } }
  return [];
}
function toDomain(r: any): Review {
  return {
    id: String(r.id), rating: Number(r.rating) || 0, comment: r.comment ?? null,
    technicianId: r.technician_id ? String(r.technician_id) : null,
    technicianName: r.technician_name ? String(r.technician_name) : null,
    tags: parseTags(r.review_tags), isPublic: !!r.is_public, isHidden: !!r.is_hidden_by_manager,
    hiddenReason: r.hidden_reason ?? null, customerId: r.customer_id ? String(r.customer_id) : null,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
  };
}

export class KyselyReviewsRepository implements ReviewsRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}
  private scoped(qb: any, ctx: ReviewsContext, col = 'reviews.tenant_id'): any {
    let q = qb.where(col, '=', ctx.tenantId);
    if (ctx.branchId) q = q.where((eb: any) => eb.or([eb('reviews.branch_id', '=', ctx.branchId), eb('reviews.branch_id', 'is', null)]));
    return q;
  }

  async list(ctx: ReviewsContext): Promise<Review[]> {
    const rows = await this.scoped(
      this.db.selectFrom('reviews').leftJoin('technicians', 'technicians.id', 'reviews.technician_id'), ctx,
    )
      .select([
        'reviews.id as id', 'reviews.rating as rating', 'reviews.comment as comment', 'reviews.technician_id as technician_id',
        'technicians.full_name as technician_name', 'reviews.review_tags as review_tags', 'reviews.is_public as is_public',
        'reviews.is_hidden_by_manager as is_hidden_by_manager', 'reviews.hidden_reason as hidden_reason',
        'reviews.customer_id as customer_id', 'reviews.created_at as created_at',
      ])
      .orderBy('reviews.created_at', 'desc').limit(1000).execute().catch(() => [] as any[]);
    return (rows as any[]).map(toDomain);
  }

  async setHidden(ctx: ReviewsContext, id: string, hidden: boolean, reason: string | null): Promise<Review | null> {
    const updated: any = await this.scoped(this.db.updateTable('reviews'), ctx, 'tenant_id')
      .set({ is_hidden_by_manager: hidden, hidden_reason: hidden ? reason : null, updated_at: new Date() } as any)
      .where('id', '=', id).returning(['id', 'global_tech_profile_id']).executeTakeFirst().catch(() => undefined);
    if (!updated) return null;
    // Merge Oct 12 2026 (TECHNICIAN_AUDIT P1 #23): hiding / unhiding changes what the public sees → the stored denorm on the
    // technician's global profile must follow, or the public page keeps advertising an average that includes a review the
    // salon just hid. Best-effort after the visibility write (the denorm is a projection, never load-bearing).
    if (updated.global_tech_profile_id) await recomputeTechRatingDenorm(this.db, String(updated.global_tech_profile_id)).catch(() => undefined);
    const rows = await this.list(ctx);
    return rows.find((r) => r.id === id) ?? null;
  }
}

/**
 * THE rating denorm: public + not manager-hidden + attributed reviews → global_tech_profiles.overall_rating / rating_count.
 * The same definition the technician profile service applies after a new rating (one formula, every writer).
 */
export async function recomputeTechRatingDenorm(db: Kysely<DB>, profileId: string): Promise<void> {
  const d: any = db;
  const agg: any = await d.selectFrom('reviews')
    .where('global_tech_profile_id', '=', profileId).where('technician_id', 'is not', null)
    .where('is_public', '=', true).where('is_hidden_by_manager', '=', false)
    .select([d.fn.avg('rating').as('avg'), d.fn.count('id').as('cnt')]).executeTakeFirst();
  await d.updateTable('global_tech_profiles').set({
    overall_rating: agg?.avg != null ? Math.round(Number(agg.avg) * 100) / 100 : 0,
    rating_count: Number(agg?.cnt ?? 0), updated_at: new Date() as any,
  } as any).where('id', '=', profileId).execute();
}
