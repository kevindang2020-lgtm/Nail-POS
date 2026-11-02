// reviews-public-denorm.ts — THE public technician rating denorm (Reviews & Reputation guide, Oct 30 2026).
// global_tech_profiles is the technician's PLATFORM profile: one person, every salon they work(ed) at. Its public rating is the
// verified (1–5, not hidden, not spam) AND public AND attributed reviews of that ONE profile — across salons by design, keyed by
// the profile id the caller already holds under its own tenant scope (a moderated review's own global_tech_profile_id, or the
// technician profile service's own profile). No id here comes from a request body. Spam is now excluded (it was not).
import { sql, type Kysely } from 'kysely';

export async function recomputeTechRatingDenorm(db: Kysely<any>, profileId: string): Promise<void> {
  const agg = (await sql<any>`select avg(r.rating) as avg, count(*)::int as cnt from reviews r where r.global_tech_profile_id = ${profileId} and r.technician_id is not null
      and r.rating between 1 and 5 and not coalesce(r.is_hidden_by_manager, false) and not coalesce(r.is_spam, false) and coalesce(r.is_public, false)`.execute(db)).rows[0];
  await sql`update global_tech_profiles set overall_rating = ${agg?.avg != null ? Math.round(Number(agg.avg) * 100) / 100 : 0}, rating_count = ${Number(agg?.cnt ?? 0) || 0}, updated_at = now() where id = ${profileId}`.execute(db);
}
