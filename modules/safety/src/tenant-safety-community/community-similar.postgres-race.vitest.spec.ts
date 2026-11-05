// community-similar.postgres-race.vitest.spec — BUILD_PLAN Phase 8 (agent C, RACEP8C): two people at ONE salon press
// "this happened to us too" on the same advisory at the same moment → exactly ONE row and similar_count = 1. Real Postgres
// (opt-in: PG_RACE_URL=postgres://… a migrated database). DETERMINISTIC: a gate connection holds the post row FOR UPDATE,
// so the first caller's row is inserted and its counter UPDATE waits on the gate while the second caller's INSERT waits on
// the first's unique-index entry (uq_cse_once). When the gate opens the first commits; the second's ON CONFLICT DO NOTHING
// sees the committed row and the counter is never bumped twice.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyInteractionsRepo } from './community-interactions.repository';
import { CommunityInteractionsService } from './community-interactions.service';
import { InMemoryCommunityEvents } from './community-events';
import { InMemoryCommunityAuditSink } from './community-audit';
import type { CommunityCorePort } from './community.ports';

const url = process.env.PG_RACE_URL;
const id = (n: number) => `e8c8c8c8-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AUTHOR = id(1), SALON = id(2), U1 = id(3), U2 = id(4), POST = id(5);
let pool: pg.Pool; let db: Kysely<any>;

const core = (): CommunityCorePort => ({
  viewer: async (ctx) => ({ ctx, role: 'owner', capabilities: new Set(['view_community']) as any, settings: {} as any, communityEnabled: true, restrictions: { suspended: false, postingRestricted: false, commentingRestricted: false } }),
  requireCapability: async (ctx) => core().viewer(ctx),
  visiblePost: async () => ({ id: POST, originTenantId: AUTHOR, originBranchId: null, classification: 'community_advisory', visibility: 'community_published', status: 'published_unverified', category: 'phone_scam', severity: 'high', region: null, title: 't', redactedBody: 'b', privacyScanFlags: [], moderationRequired: false, verificationLabel: 'unverified', version: 1, createdByUserId: U1, createdAt: '' } as any),
  postView: async () => { throw new Error('unused'); },
  authorLabelFor: async () => 'A salon',
});

describe.skipIf(!url)('real-Postgres "similar experience" race (RACEP8C)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 8 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    for (const [t, code] of [[AUTHOR, 'RACEP8CA'], [SALON, 'RACEP8C']]) {
      await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${t}, ${code}, ${code}, ${code.toLowerCase()}, ${code}, 'active') on conflict (id) do nothing`.execute(db);
    }
    await sql`delete from community_posts where id = ${POST}`.execute(db);
    await sql`insert into community_posts (id, origin_tenant_id, visibility, status, category, severity, title, redacted_body, created_by_user_id, published_at)
              values (${POST}, ${AUTHOR}, 'community_published', 'published_unverified', 'phone_scam', 'high', 'Race post', 'body', ${U1}, now())`.execute(db);
  });
  afterAll(async () => {
    await sql`delete from community_posts where id = ${POST}`.execute(db).catch(() => undefined);   // cascades the similar rows
    await sql`delete from tenants where id in (${AUTHOR}, ${SALON})`.execute(db).catch(() => undefined);
    await db?.destroy();
  });

  it('two concurrent presses from one salon → one row, similar_count 1, both callers told { similarCount: 1, mine: true }', async () => {
    const svc = new CommunityInteractionsService(core(), new KyselyInteractionsRepo(db), new InMemoryCommunityEvents(), new InMemoryCommunityAuditSink(),
      { connected: false } as any, { scan: async () => ({ status: 'unscanned' }) } as any);
    const gate = await pool.connect();
    await gate.query('begin');
    await gate.query('select id from community_posts where id = $1 for update', [POST]);
    const pending = Promise.allSettled([
      svc.markSimilar({ tenantId: SALON, branchId: null, userId: U1, role: 'OWNER' }, POST, {}),
      svc.markSimilar({ tenantId: SALON, branchId: null, userId: U2, role: 'RECEPTION' }, POST, { note: 'us too' }),
    ]);
    await new Promise((r) => setTimeout(r, 600));        // both are blocked: one on the gate's row lock, one on the unique index
    await gate.query('commit'); gate.release();
    const results = await pending;
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    for (const r of results) expect((r as PromiseFulfilledResult<any>).value).toEqual({ similarCount: 1, mine: true });
    expect((await sql<any>`select count(*)::int as n from community_similar_experiences where post_id = ${POST}`.execute(db)).rows[0].n).toBe(1);
    expect((await sql<any>`select similar_count from community_posts where id = ${POST}`.execute(db)).rows[0].similar_count).toBe(1);
  });
});
