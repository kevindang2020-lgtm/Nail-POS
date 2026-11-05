/* verify-nail-showcase-social.ts — proves the NailShowcase Social Ranking backend over real Postgres (PGlite) by
 * instantiating the social + ranking services + the existing showcase service (with ranking injected) directly.
 * Covers the spec's backend matrix: scoring (like +2 / comment +3 / dislike -1, clamped ≥0), hidden post & removed
 * comment excluded, public vs private leaderboard membership, public↔private transitions, follow rules (self/private/
 * duplicate/unfollow), Top-N caps, dynamic rank movement, and private-profile non-exposure. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { DB } from '../../../packages/database/src/kysely.types';
import { KyselyNailShowcaseSocialRepository } from '../../../modules/workforce/src/nail-showcase/nail-showcase-social.kysely.repository';
import { NailShowcaseRankingService } from '../../../modules/workforce/src/nail-showcase/nail-showcase-ranking.service';
import { NailShowcaseSocialService } from '../../../modules/workforce/src/nail-showcase/nail-showcase-social.service';
import { KyselyNailShowcaseRepository } from '../../../modules/workforce/src/nail-showcase/nail-showcase.kysely.repository';
import { NailShowcaseService, NailShowcaseError, DEFAULT_POLICY } from '../../../modules/workforce/src/nail-showcase/nail-showcase.service';
import { NailShowcaseSocialError } from '../../../modules/workforce/src/nail-showcase/nail-showcase-social.dto';
import type { NailShowcaseContext } from '../../../modules/workforce/src/nail-showcase/nail-showcase.repository';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };
const throwsSoc = async (n: string, fn: () => Promise<any>, code: string) => {
  try { await fn(); ok(n, false, 'did not throw'); }
  catch (e: any) { ok(n, e instanceof NailShowcaseSocialError && e.code === code, e instanceof NailShowcaseSocialError ? e.code : (e?.message || 'non-social error')); }
};

(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { applyMigrationToPglite } = await import('../db/migration-sql.mjs');   // Phase 10: no-transaction / CONCURRENTLY rules
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const PORT = 5483;

  const T = '00000000-0000-0000-0000-0000000a0001';
  const B = '00000000-0000-0000-0000-0000000b0001';
  // named customers (users.id = social customer id)
  const ALICE = '00000000-0000-0000-0000-0000000d0a01', BOB = '00000000-0000-0000-0000-0000000d0b01', CARA = '00000000-0000-0000-0000-0000000d0c01';
  const DANA = '00000000-0000-0000-0000-0000000d0d01', EVE = '00000000-0000-0000-0000-0000000d0e01', FRED = '00000000-0000-0000-0000-0000000d0f01';
  const GINA = '00000000-0000-0000-0000-0000000d0a02', PAT = '00000000-0000-0000-0000-0000000d0b02', HANK = '00000000-0000-0000-0000-0000000d0c02';
  const MGR = '00000000-0000-0000-0000-0000000d00ff';
  // posts
  const PA = '00000000-0000-0000-0000-0000000fa001', PB = '00000000-0000-0000-0000-0000000fa002', PC = '00000000-0000-0000-0000-0000000fa003';
  const PD = '00000000-0000-0000-0000-0000000fa004', PH = '00000000-0000-0000-0000-0000000fa005', PZ = '00000000-0000-0000-0000-0000000fa006';
  const PG_ = '00000000-0000-0000-0000-0000000fa007';

  const db = await PGlite.create({ extensions: { pgcrypto } });
  const DIR = join(process.cwd(), 'db', 'migrations');
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(DIR, f), 'utf8'));

  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES ('${T}','Luxe','Luxe Nails','luxe','LUXE')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}','${T}','Cherry Hill','active')`);
  const mkUser = (id: string, fn: string, role = 'CUSTOMER') => `INSERT INTO users (id, tenant_id, branch_id, first_name, last_name, full_name, email, status, role) VALUES ('${id}','${T}','${B}','${fn}','Lee','${fn} Lee','${id.slice(-6)}@x.com','active','${role}')`;
  // customers row links to the user via customers.user_id; customer_notifications.customer_id is the customers PK, so the
  // notification-delivery checks below resolve user → customer → notification through this link.
  const mkCustomer = (uid: string, fn: string) => `INSERT INTO customers (tenant_id, branch_id, first_name, last_name, full_name, status, user_id) VALUES ('${T}','${B}','${fn}','Lee','${fn} Lee','active','${uid}')`;
  for (const [id, fn, role] of [[ALICE, 'Alice'], [BOB, 'Bob'], [CARA, 'Cara'], [DANA, 'Dana'], [EVE, 'Eve'], [FRED, 'Fred'], [GINA, 'Gina'], [PAT, 'Pat'], [HANK, 'Hank'], [MGR, 'Mona', 'OWNER']] as string[][]) {
    await db.exec(mkUser(id, fn, role || 'CUSTOMER'));
    await db.exec(mkCustomer(id, fn));
  }
  const mkPost = (id: string, author: string, opts: { vis?: string; status?: string; likes?: number; comments?: number; dislikes?: number } = {}) =>
    `INSERT INTO nail_showcase_posts (id, tenant_id, branch_id, customer_id, caption, visibility, post_type, status, like_count, comment_count, dislike_count) VALUES ('${id}','${T}','${B}','${author}','design','${opts.vis ?? 'public_platform'}','manual_upload','${opts.status ?? 'published'}',${opts.likes ?? 0},${opts.comments ?? 0},${opts.dislikes ?? 0})`;
  await db.exec(mkPost(PA, ALICE));
  await db.exec(mkPost(PB, BOB, { likes: 2 }));
  await db.exec(mkPost(PC, CARA, { likes: 1 }));
  await db.exec(mkPost(PD, DANA, { likes: 4 }));
  await db.exec(mkPost(PH, EVE));
  await db.exec(mkPost(PZ, FRED));
  await db.exec(mkPost(PG_, GINA));

  // 12 ranked customers (public profiles via SQL) with one high-engagement post each, so Top-N caps are real.
  const rUser = (i: number) => `00000000-0000-0000-0000-00000a10${i.toString(16).padStart(4, '0')}`;
  const rPost = (i: number) => `00000000-0000-0000-0000-00000a20${i.toString(16).padStart(4, '0')}`;
  for (let i = 1; i <= 12; i++) {
    await db.exec(mkUser(rUser(i), `R${i}`));
    await db.exec(mkCustomer(rUser(i), `R${i}`));
    await db.exec(`INSERT INTO customer_social_profiles (customer_id, tenant_id, is_public_profile, profile_visibility) VALUES ('${rUser(i)}','${T}',true,'public')`);
    await db.exec(mkPost(rPost(i), rUser(i), { likes: 100 + (12 - i) * 10 })); // R1 highest (210) … R12 lowest (100)
  }

  const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
  await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres', max: 1 });
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

  const socialRepo = new KyselyNailShowcaseSocialRepository(k);
  const ranking = new NailShowcaseRankingService(socialRepo);
  const social = new NailShowcaseSocialService(socialRepo, ranking);
  const showcase = new NailShowcaseService(new KyselyNailShowcaseRepository(k), undefined, ranking);

  const C = (userId: string, role = 'CUSTOMER'): NailShowcaseContext => ({ tenantId: T, branchId: B, userId, role, permissions: [] });
  const scoreOf = async (id: string) => (await socialRepo.getProfile(id))?.nail_showcase_score ?? null;
  const inBoard = async (limit: number, id: string) => (await ranking.leaderboard(null, { limit, period: 'all_time', scope: 'platform', tenantId: null })).entries.some((e) => e.customerId === id);

  try {
    // make named profiles public (recompute runs on the public switch)
    for (const id of [ALICE, BOB, CARA, EVE, FRED, GINA]) await social.updateMyProfile(C(id), { profileVisibility: 'public' });
    await social.getMyProfile(C(DANA)); // Dana stays private (default)
    await social.getMyProfile(C(PAT));  // Pat stays private

    // ---- scoring ----
    ok('public switch seeds score from existing posts (Alice = 0, no engagement yet)', (await scoreOf(ALICE)) === 0, `score=${await scoreOf(ALICE)}`);
    await showcase.setReaction(C(BOB), PA, 'like');
    ok('like increases score (+2)', (await scoreOf(ALICE)) === 2, `score=${await scoreOf(ALICE)}`);
    await showcase.addComment(C(BOB), PA, 'gorgeous!');
    ok('comment increases score (+3 → 5)', (await scoreOf(ALICE)) === 5, `score=${await scoreOf(ALICE)}`);
    await showcase.setReaction(C(CARA), PA, 'dislike');
    ok('dislike decreases score (-1 → 4)', (await scoreOf(ALICE)) === 4, `score=${await scoreOf(ALICE)}`);

    // score never below zero: Fred's post gets only dislikes
    await showcase.setReaction(C(BOB), PZ, 'dislike');
    await showcase.setReaction(C(CARA), PZ, 'dislike');
    await showcase.setReaction(C(HANK), PZ, 'dislike');
    ok('score cannot go below zero (3 dislikes, 0 likes → 0)', (await scoreOf(FRED)) === 0, `score=${await scoreOf(FRED)}`);

    // hidden post does not count
    await showcase.setReaction(C(HANK), PH, 'like');
    ok('Eve scores from her post before hide (=2)', (await scoreOf(EVE)) === 2, `score=${await scoreOf(EVE)}`);
    await showcase.hidePost(C(MGR, 'OWNER'), PH);
    ok('hidden post does not count toward score (→ 0)', (await scoreOf(EVE)) === 0, `score=${await scoreOf(EVE)}`);

    // removed comment does not count
    const gc = await showcase.addComment(C(HANK), PG_, 'love this');
    ok('Gina scores from the comment before removal (=3)', (await scoreOf(GINA)) === 3, `score=${await scoreOf(GINA)}`);
    await showcase.hideComment(C(MGR, 'OWNER'), gc.id);
    ok('removed/hidden comment does not count toward score (→ 0)', (await scoreOf(GINA)) === 0, `score=${await scoreOf(GINA)}`);

    // ---- leaderboard membership ----
    ok('public profile appears in leaderboard', await inBoard(500, ALICE));
    ok('private profile (Dana) does NOT appear in leaderboard', !(await inBoard(500, DANA)));
    ok('private profile (Pat, no posts) does NOT appear', !(await inBoard(500, PAT)));

    // private → public recalculates and enters the board
    await social.updateMyProfile(C(DANA), { profileVisibility: 'public' });
    ok('switching private → public adds the customer to the board', await inBoard(500, DANA));
    ok('newly-public customer has a recalculated score (Dana = 8)', (await scoreOf(DANA)) === 8, `score=${await scoreOf(DANA)}`);

    // ---- Top-N caps + dynamic rank ----
    const top10 = await ranking.leaderboard(null, { limit: 10, period: 'all_time', scope: 'platform', tenantId: null });
    ok('Top 10 returns at most 10 entries', top10.entries.length === 10, `len=${top10.entries.length}`);
    ok('Top 10 entries are strictly rank-ordered 1..10', top10.entries.every((e, i) => e.rank === i + 1));
    const top500 = await ranking.leaderboard(null, { limit: 500, period: 'all_time', scope: 'platform', tenantId: null });
    ok('Top 500 returns ≤ 500 and includes the full public field', top500.entries.length <= 500 && top500.entries.length >= 12, `len=${top500.entries.length}`);

    const r12Before = (await ranking.myRank(C(rUser(12)).userId, null)).rank;
    await db.exec(`UPDATE nail_showcase_posts SET like_count = 9999 WHERE id = '${rPost(12)}'`); // R12 suddenly surges
    const r12After = (await ranking.myRank(C(rUser(12)).userId, null)).rank;
    ok('rank changes when a customer gains score (R12 climbs to #1)', r12Before != null && r12After != null && r12Before > r12After && r12After === 1, `before=${r12Before} after=${r12After}`);

    // ---- follow system (Bob still public here) ----
    const f1 = await social.follow(C(ALICE), BOB);
    ok('follow a public profile works', f1.following === true && f1.followerCount === 1, JSON.stringify(f1));
    ok('isFollowing reflected on the target profile', (await social.getPublicProfile(C(ALICE), BOB)).isFollowing === true);
    const followNote: any = await db.query(`SELECT count(*)::int AS n FROM customer_notifications cn JOIN customers c ON c.id = cn.customer_id WHERE c.user_id = '${BOB}' AND cn.type = 'nail_showcase' AND cn.title LIKE '%started following%'`);
    ok('following a customer delivers a notification to the target', (followNote.rows[0]?.n ?? 0) >= 1, `notifications=${followNote.rows[0]?.n}`);
    await throwsSoc('duplicate follow rejected', () => social.follow(C(ALICE), BOB), 'conflict');
    await throwsSoc('cannot follow yourself', () => social.follow(C(ALICE), ALICE), 'invalid');
    await throwsSoc('cannot follow a private profile', () => social.follow(C(ALICE), PAT), 'forbidden');
    const uf = await social.unfollow(C(ALICE), BOB);
    ok('unfollow removes the relationship', uf.following === false && uf.followerCount === 0, JSON.stringify(uf));

    // ---- public → private removes from board ----
    await social.updateMyProfile(C(BOB), { profileVisibility: 'private' });
    ok('switching public → private removes the customer from the board', !(await inBoard(500, BOB)));

    // ---- private profile does not expose avatar/name/posts ----
    const patView = await social.getPublicProfile(C(ALICE), PAT);
    ok('private profile is not exposed to other customers', patView.isPrivate === true && patView.displayName === undefined && patView.avatarUrl === undefined && patView.score === undefined, JSON.stringify(patView));
    const alicePublic = await social.getPublicProfile(C(BOB), ALICE);
    ok('public profile exposes display name + rank + score to others', alicePublic.isPrivate === false && !!alicePublic.displayName && alicePublic.score !== undefined);

    // ---- scope: salon-only posts count in the This Salon board, not the platform board ----
    const SAL = '00000000-0000-0000-0000-0000000d0e03', PSAL = '00000000-0000-0000-0000-0000000fa00a';
    await db.exec(mkUser(SAL, 'Sal')); await db.exec(mkCustomer(SAL, 'Sal'));
    await db.exec(mkPost(PSAL, SAL, { vis: 'salon_only', likes: 50 }));
    await social.updateMyProfile(C(SAL), { profileVisibility: 'public' });
    ok('salon-only post is excluded from the platform (All AIPowerSalon) board', !(await inBoard(500, SAL)));
    const salonBoard = await ranking.leaderboard(null, { limit: 500, period: 'all_time', scope: 'salon', tenantId: T });
    ok('salon-only post counts in the This Salon board', salonBoard.entries.some((e) => e.customerId === SAL));

    // ---- period: a post older than 7 days drops out of This Week but stays in All Time ----
    const WK = '00000000-0000-0000-0000-0000000d0e04', PWK = '00000000-0000-0000-0000-0000000fa00b';
    await db.exec(mkUser(WK, 'Wken')); await db.exec(mkCustomer(WK, 'Wken'));
    await db.exec(mkPost(PWK, WK, { likes: 40 }));
    await db.exec(`UPDATE nail_showcase_posts SET created_at = now() - interval '60 days' WHERE id='${PWK}'`);
    await social.updateMyProfile(C(WK), { profileVisibility: 'public' });
    const allTimeHasWk = (await ranking.leaderboard(null, { limit: 500, period: 'all_time', scope: 'platform', tenantId: null })).entries.some((e) => e.customerId === WK);
    const weeklyHasWk = (await ranking.leaderboard(null, { limit: 500, period: 'weekly', scope: 'platform', tenantId: null })).entries.some((e) => e.customerId === WK);
    ok('a 60-day-old post still counts for All Time', allTimeHasWk);
    ok('a post older than 7 days is excluded from This Week', !weeklyHasWk);

    // ---- milestone notification: first recompute landing in the Top 10 notifies the customer ----
    const MILE = '00000000-0000-0000-0000-0000000d0e05', PMILE = '00000000-0000-0000-0000-0000000fa00c';
    await db.exec(mkUser(MILE, 'Mile')); await db.exec(mkCustomer(MILE, 'Mile'));
    await db.exec(mkPost(PMILE, MILE, { likes: 100000 })); // a runaway-popular post → lands at the very top
    await social.updateMyProfile(C(MILE), { profileVisibility: 'public' }); // recompute: prevRank null → Top 10 → milestone
    const mileRank = (await ranking.myRank(MILE, null)).rank;
    const mileNote: any = await db.query(`SELECT count(*)::int AS n FROM customer_notifications cn JOIN customers c ON c.id = cn.customer_id WHERE c.user_id = '${MILE}' AND cn.type = 'nail_showcase' AND cn.title LIKE '%Top 10%'`);
    ok('reaching the Top 10 delivers a milestone notification', mileRank != null && mileRank <= 10 && (mileNote.rows[0]?.n ?? 0) >= 1, `rank=${mileRank} notifications=${mileNote.rows[0]?.n}`);

    // ---- moderation: reporting a profile records a report; you can't report yourself ----
    await social.reportProfile(C(ALICE), CARA, 'inappropriate', 'spammy content');
    const repRow: any = await db.query(`SELECT count(*)::int AS n FROM nail_showcase_reports WHERE reported_customer_id='${CARA}' AND reason='inappropriate'`);
    ok('reporting a profile records a moderation report', (repRow.rows[0]?.n ?? 0) >= 1, `reports=${repRow.rows[0]?.n}`);
    await throwsSoc('cannot report your own profile', () => social.reportProfile(C(ALICE), ALICE, 'other'), 'invalid');

    // ---- suspension: a banned/suspended customer is removed from the rankings ----
    const SUS = rUser(5);
    ok('a public ranked customer is on the board before suspension', await inBoard(500, SUS));
    await db.exec(`UPDATE customer_social_profiles SET is_suspended = true WHERE customer_id='${SUS}'`);
    ok('a suspended customer is removed from the ranking', !(await inBoard(500, SUS)));

    // ---- rank-change notification: dropping out of a headline tier notifies the customer ----
    const DROP = '00000000-0000-0000-0000-0000000d0e06', PDH = '00000000-0000-0000-0000-0000000fa00d', PDL = '00000000-0000-0000-0000-0000000fa00e';
    await db.exec(mkUser(DROP, 'Drop')); await db.exec(mkCustomer(DROP, 'Drop'));
    await db.exec(mkPost(PDH, DROP, { likes: 600 })); // high-engagement post → lands in the Top 10
    await db.exec(mkPost(PDL, DROP, { likes: 1 }));    // low post → keeps a non-null rank after the high one is hidden
    await social.updateMyProfile(C(DROP), { profileVisibility: 'public' }); // recompute → Top 10 (prevRank recorded)
    const dropBefore = (await ranking.myRank(DROP, null)).rank;
    await showcase.hidePost(C(MGR, 'OWNER'), PDH); // recompute(DROP): score collapses → falls out of Top 10, still ranked
    const dropAfter = (await ranking.myRank(DROP, null)).rank;
    const dropNote: any = await db.query(`SELECT count(*)::int AS n FROM customer_notifications cn JOIN customers c ON c.id = cn.customer_id WHERE c.user_id='${DROP}' AND cn.type='nail_showcase' AND cn.title LIKE '%dropped out of the Top 10%'`);
    ok('dropping out of the Top 10 delivers a rank-change notification', dropBefore != null && dropBefore <= 10 && dropAfter != null && dropAfter > 10 && (dropNote.rows[0]?.n ?? 0) >= 1, `before=${dropBefore} after=${dropAfter} notifications=${dropNote.rows[0]?.n}`);

    // ---- spam guard: reactions under the limit are allowed; one account spamming across posts is throttled (429) ----
    const THR = '00000000-0000-0000-0000-0000000d0e07';
    await db.exec(mkUser(THR, 'Thr')); await db.exec(mkCustomer(THR, 'Thr'));
    const throttled = new NailShowcaseService(new KyselyNailShowcaseRepository(k), { ...DEFAULT_POLICY, reactionRateLimit: { max: 2, windowSeconds: 60 } }, ranking);
    let firstTwoOk = true;
    try { await throttled.setReaction(C(THR), rPost(1), 'like'); await throttled.setReaction(C(THR), rPost(2), 'like'); } catch { firstTwoOk = false; }
    let limited = false;
    try { await throttled.setReaction(C(THR), rPost(3), 'like'); } catch (e: any) { limited = e instanceof NailShowcaseError && e.code === 'rate_limited'; }
    ok('reactions under the limit pass, then a spamming customer is rate-limited', firstTwoOk && limited, `under_limit_ok=${firstTwoOk} limited=${limited}`);

    // ---- admin moderation path (super-admin service): suspend/unsuspend a creator + the reported-creators queue ----
    const adminCtx: NailShowcaseContext = { tenantId: T, branchId: B, userId: MGR, role: 'SUPER_ADMIN', permissions: [] };
    const ADM = rUser(6);
    ok('target creator is ranked before admin suspension', await inBoard(500, ADM));
    const sus = await social.suspendProfile(adminCtx, ADM, true);
    ok('admin suspend removes the creator from the board and clears their stored rank', !(await inBoard(500, ADM)) && sus.suspended === true && sus.rank === null, JSON.stringify(sus));
    const uns = await social.suspendProfile(adminCtx, ADM, false);
    ok('admin unsuspend restores the creator to the board', (await inBoard(500, ADM)) && uns.suspended === false, JSON.stringify(uns));
    await social.reportProfile(C(ALICE), GINA, 'spam', 'bot activity'); // GINA is public
    const reported = await social.listReportedProfiles(adminCtx);
    ok('reported-creators queue lists a reported profile with its report count', reported.some((x) => x.customerId === GINA && x.reportCount >= 1), `queue=${reported.length}`);

    // ---- nearby scope: rank creators at branches within range of the viewer's branch (haversine), not far-away ones ----
    const B2 = '00000000-0000-0000-0000-0000000b0002', B3 = '00000000-0000-0000-0000-0000000b0003';
    await db.exec(`UPDATE branches SET latitude=39.93, longitude=-75.02 WHERE id='${B}'`); // anchor (Cherry Hill, NJ)
    await db.exec(`INSERT INTO branches (id, tenant_id, name, status, latitude, longitude) VALUES ('${B2}','${T}','Near Branch','active',39.95,-75.05)`); // ~2 mi
    await db.exec(`INSERT INTO branches (id, tenant_id, name, status, latitude, longitude) VALUES ('${B3}','${T}','Far Branch','active',40.73,-73.99)`);  // ~77 mi (NYC)
    const NEAR = '00000000-0000-0000-0000-0000000d0e08', FAR = '00000000-0000-0000-0000-0000000d0e09';
    const PNEAR = '00000000-0000-0000-0000-0000000fa00f', PFAR = '00000000-0000-0000-0000-0000000fa010';
    await db.exec(mkUser(NEAR, 'Near')); await db.exec(mkCustomer(NEAR, 'Near'));
    await db.exec(mkUser(FAR, 'Farr')); await db.exec(mkCustomer(FAR, 'Farr'));
    const postAt = (id: string, author: string, branch: string, likes: number) => `INSERT INTO nail_showcase_posts (id, tenant_id, branch_id, customer_id, caption, visibility, post_type, status, like_count, comment_count, dislike_count) VALUES ('${id}','${T}','${branch}','${author}','design','public_platform','manual_upload','published',${likes},0,0)`;
    await db.exec(postAt(PNEAR, NEAR, B2, 30));
    await db.exec(postAt(PFAR, FAR, B3, 30));
    await social.updateMyProfile(C(NEAR), { profileVisibility: 'public' });
    await social.updateMyProfile(C(FAR), { profileVisibility: 'public' });
    const nearBoard = await ranking.leaderboard(null, { limit: 500, period: 'all_time', scope: 'nearby', tenantId: null, branchId: B });
    const hasNear = nearBoard.entries.some((e) => e.customerId === NEAR);
    const hasFar = nearBoard.entries.some((e) => e.customerId === FAR);
    ok('Nearby board includes a creator at a nearby branch but excludes a far-away one', hasNear && !hasFar, `near=${hasNear} far=${hasFar}`);

    // ---- blocking: removes the follow edge both ways, prevents re-follow, hides each party, and is reversible ----
    const BL_A = '00000000-0000-0000-0000-0000000d0e0b', BL_B = '00000000-0000-0000-0000-0000000d0e0c';
    await db.exec(mkUser(BL_A, 'Blair')); await db.exec(mkCustomer(BL_A, 'Blair'));
    await db.exec(mkUser(BL_B, 'Bobby')); await db.exec(mkCustomer(BL_B, 'Bobby'));
    await social.updateMyProfile(C(BL_A), { profileVisibility: 'public' });
    await social.updateMyProfile(C(BL_B), { profileVisibility: 'public' });
    await social.follow(C(BL_B), BL_A); // Bobby follows Blair
    const beforeFollowers = await social.followers(C(BL_A), BL_A);
    ok('pre-block: the follower appears in the blocker\'s followers list', beforeFollowers.entries.some((e) => e.customerId === BL_B));
    await social.block(C(BL_A), BL_B); // Blair blocks Bobby
    const afterFollowers = await social.followers(C(BL_A), BL_A);
    ok('block removes the follow edge both ways (ex-follower gone from followers)', !afterFollowers.entries.some((e) => e.customerId === BL_B));
    await throwsSoc('a blocked customer cannot re-follow the blocker', () => social.follow(C(BL_B), BL_A), 'forbidden');
    const bobbyViewsBlair = await social.getPublicProfile(C(BL_B), BL_A);
    ok('a blocked customer sees the blocker as unavailable', bobbyViewsBlair.isPrivate === true);
    const blairViewsBobby = await social.getPublicProfile(C(BL_A), BL_B);
    ok('the blocker sees isBlockedByMe on the blocked profile', blairViewsBobby.isBlockedByMe === true && blairViewsBobby.isPrivate === false);
    const blockedList = await social.listBlocked(C(BL_A));
    ok('the blocked list contains the blocked customer', blockedList.entries.some((e) => e.customerId === BL_B));
    await social.unblock(C(BL_A), BL_B);
    const reFollow = await social.follow(C(BL_B), BL_A);
    ok('unblock restores the ability to follow', reFollow.following === true);
    const bobbyViewsBlair2 = await social.getPublicProfile(C(BL_B), BL_A);
    ok('unblock restores profile visibility', bobbyViewsBlair2.isPrivate === false);
  } catch (e: any) {
    ok('harness completed without throwing', false, e?.stack || e?.message || String(e));
  } finally {
    await k.destroy().catch(() => {});
    await server.stop().catch(() => {});
    await db.close().catch(() => {});
  }

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
