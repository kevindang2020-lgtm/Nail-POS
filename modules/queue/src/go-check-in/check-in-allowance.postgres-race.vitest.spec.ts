// check-in-allowance.postgres-race.vitest.spec.ts — Oct 6 2026 (migration 516): a check-in session's lookup allowance is
// counted on its row. Twelve lookups of one session arriving at once (as from several API instances) must take twelve
// distinct counts — so exactly 8 are allowed and 4 refused, never more allowed because two read the same count.
// TRUE concurrency needs real Postgres. Opt-in: PG_RACE_URL=postgres://... (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyGoCheckInRepository } from './go-check-in.kysely.repository';
import { MAX_LOOKUPS_PER_SESSION } from './go-check-in.dto';

const url = process.env.PG_RACE_URL;
const T = 'a5160000-0000-4000-8000-0000000000aa', B = 'b5160000-0000-4000-8000-0000000000bb', K = 'c5160000-0000-4000-8000-0000000000cc';
let db: Kysely<any>; let pool: pg.Pool; let repo: KyselyGoCheckInRepository;

describe.skipIf(!url)('real-Postgres check-in allowance race (migration 516)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 16 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    repo = new KyselyGoCheckInRepository(db as any);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Race Allow', 'Race Allow', 'race-allow', 'RACEAL', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into go_checkin_devices (id, tenant_id, branch_id, device_name, checkin_slug) values (${K}, ${T}, ${B}, 'Race kiosk', 'race-allow-kiosk') on conflict (id) do nothing`.execute(db);
  });
  afterAll(async () => { await sql`delete from go_checkin_sessions where tenant_id = ${T}`.execute(db).catch(() => undefined); await db?.destroy(); });

  it('twelve lookups of one session at once → counts 1…12: exactly 8 allowed, 4 refused', async () => {
    const s = await repo.createSession({ tenantId: T, branchId: B, deviceId: K, sessionTokenHash: 'race-allow-' + Date.now() });
    // DETERMINISTIC race: hold the session row so every caller queues on it, then release them together
    const gate = await pool.connect();
    await gate.query('begin'); await gate.query('select 1 from go_checkin_sessions where id = $1 for update', [s.id]);
    const pending = Promise.all(Array.from({ length: 12 }, () => repo.bumpSessionCounter(T, s.id, 'lookups')));
    await new Promise((r) => setTimeout(r, 300));
    await gate.query('commit'); gate.release();
    const counts = (await pending).sort((a, b) => a - b);
    expect(counts).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(counts.filter((c) => c <= MAX_LOOKUPS_PER_SESSION)).toHaveLength(8);
  });
});
