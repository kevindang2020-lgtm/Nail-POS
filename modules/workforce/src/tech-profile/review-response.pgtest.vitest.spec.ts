// review-response.pgtest.vitest.spec.ts — Phase 3: a technician posts ONE public response to a review on their OWN
// global profile (ownership by global_tech_profile_id), can clear it, and can never touch another tech's review.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { TechProfileService } from './tech-profile.service';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return { async executeQuery(q: any) { const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]); return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) }; }, streamQuery() { throw new Error('no'); } } as any;
  }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}

const T = 'ce000000-0000-0000-0000-000000000001';
const GA = 'ce000000-0000-0000-0000-0000000000a1'; // profile A (owner)
const GB = 'ce000000-0000-0000-0000-0000000000a2'; // profile B (other tech)
const UA = 'ce000000-0000-0000-0000-0000000000f1';
const UB = 'ce000000-0000-0000-0000-0000000000f2';
const TA = 'ce000000-0000-0000-0000-0000000000d1';
const TB = 'ce000000-0000-0000-0000-0000000000d2';
const BR = 'ce000000-0000-0000-0000-0000000000b1';
const R1 = 'ce000000-0000-0000-0000-0000000000c1';
const ctxA: any = { tenantId: T, branchId: BR, userId: UA, role: 'TECH', permissions: [] };
const ctxB: any = { tenantId: T, branchId: BR, userId: UB, role: 'TECH', permissions: [] };

let svc: TechProfileService;
let pg: PGlite;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);

beforeAll(async () => {
  pg = new PGlite();
  const dir = MIGRATIONS_DIR;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    try { await pg.exec(readFileSync(join(dir, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '')); } catch { /* tolerated */ }
  }
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  svc = new TechProfileService(db as any, null as any);

  await q(`insert into global_tech_profiles (id, tech_code, public_slug, display_name, is_public) values ($1,'TA','tech-a','Tech A',true),($2,'TB','tech-b','Tech B',true)`, [GA, GB]);
  await q(`insert into technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, is_active, global_tech_profile_id) values ($1,$2,$3,$4,'Tech','A','Tech A',true,$5),($6,$2,$3,$7,'Tech','B','Tech B',true,$8)`, [TA, T, BR, UA, GA, TB, UB, GB]);
  await q(`insert into reviews (id, tenant_id, branch_id, technician_id, global_tech_profile_id, rating, comment, is_public, is_hidden_by_manager) values ($1,$2,$3,$4,$5,5,'Loved my nails!',true,false)`, [R1, T, BR, TA, GA]);
});

describe('technician review responses (Phase 3)', () => {
  it('the owning technician can post a public response, surfaced in their ratings', async () => {
    const res: any = await svc.respondToReview(ctxA, R1, '  Thank you so much! 💅  ');
    const mine = res.recent.find((r: any) => r.ratingId === R1);
    expect(mine.response).toBe('Thank you so much! 💅');
    expect(mine.respondedAt).toBeTruthy();
    expect(mine.comment).toBe('Loved my nails!'); // customer's own text untouched
  });

  it('a different technician cannot respond to a review on another profile', async () => {
    await expect(svc.respondToReview(ctxB, R1, 'not mine')).rejects.toMatchObject({ code: 'not_found' });
    const row: any = (await q(`select technician_response from reviews where id=$1`, [R1]))[0];
    expect(row.technician_response).toBe('Thank you so much! 💅'); // unchanged
  });

  it('an empty response clears it', async () => {
    const res: any = await svc.respondToReview(ctxA, R1, '   ');
    const mine = res.recent.find((r: any) => r.ratingId === R1);
    expect(mine.response).toBeNull();
    expect(mine.respondedAt).toBeNull();
  });

  it('public profile surfaces published public showcase posts attributed to the technician, excludes salon-only', async () => {
    const P1 = 'ce000000-0000-0000-0000-0000000000e1'; // public post
    const P2 = 'ce000000-0000-0000-0000-0000000000e2'; // salon-only (excluded)
    const CU = 'ce000000-0000-0000-0000-0000000000f9'; // author (a customer)
    await q(`insert into nail_showcase_posts (id, tenant_id, customer_id, technician_id, caption, status, visibility, like_count, comment_count) values
      ($1,$2,$3,$4,'Gel set','published','public_platform',7,2),
      ($5,$2,$3,$4,'Private one','published','salon_only',1,0)`, [P1, T, CU, TA, P2]);
    await q(`insert into nail_showcase_photos (id, post_id, customer_id, sort_order, image_url, thumbnail_url) values ('ce000000-0000-0000-0000-0000000000e3',$1,'ce000000-0000-0000-0000-0000000000f9',0,'https://img/e1.jpg','https://img/e1-t.jpg')`, [P1]);
    const custCtx: any = { tenantId: T, branchId: BR, userId: CU, role: 'CUSTOMER', permissions: [] };
    const card: any = await svc.customerPublicProfile(custCtx, 'tech-a');
    expect(card.posts.map((p: any) => p.postId)).toEqual([P1]);
    expect(card.posts[0]).toMatchObject({ likeCount: 7, commentCount: 2, thumbnailUrl: 'https://img/e1-t.jpg' });
  });
});
