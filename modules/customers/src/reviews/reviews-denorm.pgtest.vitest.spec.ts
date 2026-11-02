// reviews-denorm.pgtest — merge Oct 12 2026 (other-chat TECHNICIAN_AUDIT P1 #23), real schema (PGlite, all migrations).
// Hide / Unhide recomputes the technician's stored overall_rating / rating_count — the public page no longer advertises an
// average that includes a review the salon just hid. Tenant-scoped: another salon cannot flip this review (the denorm is
// untouched). Oct 31 2026 (Reviews & Reputation guide): the retired POST /pos/reviews/:id/visibility is replaced by the audited
// ReviewsCenter.moderate (reason-coded, version-checked); the same scenario is proven through it.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { recomputeTechRatingDenorm } from './reviews.kysely.repository';
import { ReviewsCenter } from './reviews-center';

const T = 'ae100000-0000-4000-8000-000000000001', B = 'ae100000-0000-4000-8000-000000000002';
const G = 'ae100000-0000-4000-8000-0000000000a1', TECH = 'ae100000-0000-4000-8000-0000000000d1', CUST = 'ae100000-0000-4000-8000-0000000000c1';
const ctx: any = { tenantId: T, branchId: B, userId: 'ae100000-0000-4000-8000-0000000000f1', role: 'OWNER', permissions: ['pos.marketing.manage', 'pos.reviews.manage'] };
let pg: any; let db: any; let rc: ReviewsCenter;
const audit = async () => undefined;
const ver = async (id: string) => Number((await q(`select moderation_version from reviews where id = $1`, [id])).rows[0].moderation_version);
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
const denorm = async () => { const r = (await q(`select overall_rating, rating_count from global_tech_profiles where id = $1`, [G])).rows[0]; return { avg: Number(r.overall_rating), n: Number(r.rating_count) }; };

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  rc = new ReviewsCenter(db);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Denorm A','Salon A','denorm-a','DENA','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'Main','active')`, [B, T]);
  await q(`insert into global_tech_profiles (id, tech_code, public_slug, display_name, is_public, status) values ($1,'DN1','denorm-tech','Dn Tech',true,'active')`, [G]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active, global_tech_profile_id) values ($1,$2,$3,'Dn','Tech','Dn Tech',true,$4)`, [TECH, T, B, G]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Cu','St','Cu St')`, [CUST, T, B]);
  // 30 five-star reviews, then 10 one-star ones → 4.00 / 40
  for (let i = 0; i < 30; i++) await q(`insert into reviews (tenant_id, branch_id, technician_id, global_tech_profile_id, customer_id, rating, is_public, is_hidden_by_manager) values ($1,$2,$3,$4,$5,5,true,false)`, [T, B, TECH, G, CUST]);
  for (let i = 0; i < 10; i++) await q(`insert into reviews (tenant_id, branch_id, technician_id, global_tech_profile_id, customer_id, rating, is_public, is_hidden_by_manager) values ($1,$2,$3,$4,$5,1,true,false)`, [T, B, TECH, G, CUST]);
  await recomputeTechRatingDenorm(db, G);
});

describe('Hide / Unhide (ReviewsCenter.moderate) recomputes the stored denorm', () => {
  it('starts at 4.00 / 40; hiding the ten 1-star reviews lifts it to 5.00 / 30; unhiding restores 4.00 / 40', async () => {
    expect(await denorm()).toEqual({ avg: 4, n: 40 });
    const ones: any[] = (await q(`select id from reviews where global_tech_profile_id = $1 and rating = 1`, [G])).rows;
    for (const r of ones) await rc.moderate(ctx, r.id, { action: 'hide', reasonCode: 'spam', reasonText: 'spam burst', expectedVersion: await ver(r.id), idempotencyKey: 'dn-h-' + r.id }, audit);
    expect(await denorm()).toEqual({ avg: 5, n: 30 });
    for (const r of ones) await rc.moderate(ctx, r.id, { action: 'unhide', expectedVersion: await ver(r.id), idempotencyKey: 'dn-u-' + r.id }, audit);
    expect(await denorm()).toEqual({ avg: 4, n: 40 });
  });
  it('is tenant-scoped: another salon cannot flip this review and the denorm is untouched', async () => {
    const [r]: any = (await q(`select id from reviews where global_tech_profile_id = $1 and rating = 1 limit 1`, [G])).rows;
    await expect(rc.moderate({ ...ctx, tenantId: 'ae100000-0000-4000-8000-000000000099', branchId: '' }, r.id, { action: 'hide', reasonCode: 'spam', expectedVersion: 0, idempotencyKey: 'dn-x' }, audit)).rejects.toThrow(/not found/i);
    expect(await denorm()).toEqual({ avg: 4, n: 40 });
  });
});
