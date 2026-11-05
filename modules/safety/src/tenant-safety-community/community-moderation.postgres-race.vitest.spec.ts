// community-moderation.postgres-race.vitest.spec — BUILD_PLAN Phase 8 (agent B, RACEP8B): two moderators act on ONE post at
// the same moment → exactly one action lands (one case, one action row, one version row, one ADVISORY_PUBLISHED outbox
// event, one fanout) and the other gets 409 version_conflict. Real Postgres (opt-in: PG_RACE_URL=postgres://… a migrated
// database). DETERMINISTIC: a gate connection holds the post row FOR UPDATE, so both callers are blocked on their own
// `select … for update` when the gate opens; the second to get the lock re-reads version N+1 ≠ expected N.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { OutboxWriter } from '@aipowersalon/events';
import { CommunityModerationRepo } from './community-moderation.repository';
import { CommunityModerationService } from './community-moderation.service';
import { OutboxCommunityEvents } from './community-events';

const url = process.env.PG_RACE_URL;
const id = (n: number) => `8d8d8d8d-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), MOD_A = id(2), MOD_B = id(3), AUTHOR = id(4), POST = id(5);
let pool: pg.Pool; let db: Kysely<any>;

async function cleanup() {
  await sql`delete from outbox_events where tenant_id = ${T}`.execute(db);
  await sql`delete from community_moderation_actions where target_tenant_id = ${T}`.execute(db);
  await sql`delete from community_moderation_cases where target_tenant_id = ${T}`.execute(db);
  await sql`delete from community_post_versions where post_id = ${POST}`.execute(db);
  await sql`delete from community_posts where origin_tenant_id = ${T}`.execute(db);
}

describe.skipIf(!url)('real-Postgres moderation race (RACEP8B)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 8 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Race P8B', 'Race P8B', 'race-p8b', 'RACEP8B', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into users (id, tenant_id, role, email, status) values (${MOD_A}, null, 'SUPER_ADMIN', 'race-p8b-a@x.test', 'active'), (${MOD_B}, null, 'SUPER_ADMIN', 'race-p8b-b@x.test', 'active'),
              (${AUTHOR}, ${T}, 'OWNER', 'race-p8b-o@x.test', 'active') on conflict (id) do nothing`.execute(db);
    await cleanup();
  });
  afterAll(async () => {
    if (db) {
      await cleanup().catch(() => undefined);
      // the RACEP8B tenant + users stay (fixed ids, re-used next run; audit_logs is append-only and references them)
      await db.destroy();
    }
  });

  it('two concurrent publishes → one wins, one 409; one case, one action, one event, one fanout', async () => {
    await sql`insert into community_posts (id, origin_tenant_id, status, visibility, category, severity, title, redacted_body, created_by_user_id, version)
              values (${POST}, ${T}, 'moderation_review', 'draft', 'phone_scam', 'high', 'Race post', 'A caller asked for gift cards.', ${AUTHOR}, 1)`.execute(db);
    const published: string[] = [];
    const svc = new CommunityModerationService(new CommunityModerationRepo(db), new OutboxCommunityEvents(db, new OutboxWriter()),
      { async advisoryPublished(p) { published.push(p.id); }, async advisoryChanged() { /* none */ } });

    const gate = await pool.connect();
    await gate.query('begin');
    await gate.query('select id from community_posts where id = $1 for update', [POST]);
    const pending = Promise.allSettled([
      svc.postAction({ userId: MOD_A }, POST, { action: 'publish', reason: 'moderator A approves', expectedVersion: 1 }),
      svc.postAction({ userId: MOD_B }, POST, { action: 'publish', reason: 'moderator B approves', expectedVersion: 1 }),
    ]);
    await new Promise((r) => setTimeout(r, 600));          // both are blocked on the row lock
    await gate.query('commit'); gate.release();
    const results = await pending;

    const won = results.filter((r) => r.status === 'fulfilled');
    expect(won).toHaveLength(1);
    const lost = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(lost.map((l) => `${l.reason?.status}:${l.reason?.code}`)).toEqual(['409:version_conflict']);
    const row = (await sql<any>`select version, visibility from community_posts where id = ${POST}`.execute(db)).rows[0];
    expect(row.version).toBe(2);
    expect((await sql<any>`select count(*)::int as n from community_moderation_cases where post_id = ${POST}`.execute(db)).rows[0].n).toBe(1);
    expect((await sql<any>`select count(*)::int as n from community_moderation_actions where post_id = ${POST}`.execute(db)).rows[0].n).toBe(1);
    expect((await sql<any>`select count(*)::int as n from community_post_versions where post_id = ${POST}`.execute(db)).rows[0].n).toBe(1);
    const evs = (await sql<any>`select event_type from outbox_events where tenant_id = ${T} and event_type like 'community.advisory_%'`.execute(db)).rows;
    expect(evs).toHaveLength(1);
    expect(row.visibility).toBe('community_published');
    expect(published).toEqual([POST]);
  });
});
