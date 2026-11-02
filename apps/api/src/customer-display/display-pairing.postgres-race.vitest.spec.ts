// display-pairing.postgres-race.vitest.spec.ts — 23-inch dual-screen spec §8–§12 under REAL concurrency (Postgres, real
// connections; PGlite is one session and cannot show a race). Two owners typing the same code at once bind ONE display,
// never two; a display polling twice at the same moment collects its credential ONCE; two taps on a receipt choice send
// ONE receipt. Opt-in: PG_RACE_URL (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { createHash } from 'node:crypto';
import { KyselyDisplayPairingRepository } from './display-pairing.repository';
import { KyselyDisplayRepository } from './customer-display.repository';

const url = process.env.PG_RACE_URL;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const T = 'a7600000-0000-4000-8000-0000000000a1', T2 = 'a7600000-0000-4000-8000-0000000000a2';
const B = 'b7600000-0000-4000-8000-0000000000b1', B2 = 'b7600000-0000-4000-8000-0000000000b2';
let db: Kysely<any>; let pool: pg.Pool;
let pairing: KyselyDisplayPairingRepository;

/** Hold an exclusive lock on the pairings table so N callers pile up behind it, then release them together. */
async function together<T>(n: number, fn: (i: number) => Promise<T>): Promise<T[]> {
  const holder = await pool.connect();
  await holder.query('begin');
  await holder.query('lock table customer_display_pairings in access exclusive mode');
  const runs = Array.from({ length: n }, (_, i) => fn(i));
  await new Promise((r) => setTimeout(r, 300));
  await holder.query('commit');
  holder.release();
  return Promise.all(runs);
}

describe.skipIf(!url)('display pairing on real Postgres', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 12 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    pairing = new KyselyDisplayPairingRepository(db as any);
    for (const [t, b, slug] of [[T, B, 'race-pair-a'], [T2, B2, 'race-pair-b']]) {
      await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${t}, 'RP', 'RP', ${slug}, ${slug.slice(-6).toUpperCase()}, 'active') on conflict (id) do nothing`.execute(db);
      await sql`insert into branches (id, tenant_id, name) values (${b}, ${t}, 'Main') on conflict (id) do nothing`.execute(db);
    }
  });
  afterAll(async () => {
    await sql`delete from customer_display_pairings where tenant_id in (${T}, ${T2}) or code_hash like 'race%'`.execute(db).catch(() => undefined);
    await sql`delete from customer_display_sessions where tenant_id in (${T}, ${T2})`.execute(db).catch(() => undefined);
    await sql`delete from customer_display_devices where tenant_id in (${T}, ${T2})`.execute(db).catch(() => undefined);
    await db?.destroy();
  });

  it('eight owners (two salons) claim the same code at once: ONE display is created, for ONE salon', async () => {
    const code = sha('race-code-1');
    const p = await pairing.create({ codeHash: code, pollSecretHash: sha('s1'), ttlSeconds: 600, platform: 'web' });
    expect(p).not.toBe('code_taken');
    const results = await together(8, (i) => pairing.claim(code, { tenantId: i % 2 ? T2 : T, branchId: i % 2 ? B2 : B, name: `Claim ${i}`, stationId: null },
      { tenantId: i % 2 ? T2 : T, branchId: i % 2 ? B2 : B, userId: null, role: 'OWNER' }).catch(() => 'error' as const));
    const winners = results.filter((r) => r && r !== 'error');
    expect(winners).toHaveLength(1);
    expect(results.filter((r) => r === 'error')).toEqual([]);
    const devs = (await sql`select tenant_id from customer_display_devices where id = ${(winners[0] as any).deviceId}`.execute(db)).rows as any[];
    expect(devs).toHaveLength(1);
    const all = (await sql`select count(*)::int n from customer_display_devices where tenant_id in (${T}, ${T2}) and device_name like 'Claim %'`.execute(db)).rows as any[];
    expect(all[0].n).toBe(1);   // every losing transaction rolled back its display row
  });

  it('a display polling twice at the same moment collects its credential ONCE', async () => {
    const code = sha('race-code-2');
    const p: any = await pairing.create({ codeHash: code, pollSecretHash: sha('s2'), ttlSeconds: 600, platform: null });
    await pairing.claim(code, { tenantId: T, branchId: B, name: 'Twice', stationId: null }, { tenantId: T, branchId: B, userId: null, role: 'OWNER' });
    const got = await together(6, (i) => pairing.pickUp(p.id, sha(`token-${i}`)));
    const handed = got.filter(Boolean);
    expect(handed).toHaveLength(1);
    const dev = (await sql`select device_token_hash from customer_display_devices where tenant_id = ${T} and device_name = 'Twice'`.execute(db)).rows as any[];
    expect(dev).toHaveLength(1);
    expect(Array.from({ length: 6 }, (_, i) => sha(`token-${i}`))).toContain(dev[0].device_token_hash);
  });

  it('two taps on a receipt choice at the same moment: ONE choice is recorded (one receipt goes out)', async () => {
    const display = new KyselyDisplayRepository(db as any);
    const dev: any = (await sql`insert into customer_display_devices (tenant_id, branch_id, device_name, pairing_status) values (${T}, ${B}, 'Receipt Race', 'paired') returning id`.execute(db)).rows[0];
    const s: any = (await sql`insert into customer_display_sessions (tenant_id, branch_id, display_device_id, state, public_token_hash, expires_at) values (${T}, ${B}, ${dev.id}, 'paid', ${'h' + Date.now()}, now() + interval '10 minutes') returning id`.execute(db)).rows[0];
    const holder = await pool.connect();
    await holder.query('begin');
    await holder.query('lock table customer_display_sessions in access exclusive mode');
    const runs = ['sms', 'email', 'sms', 'none', 'email'].map((c) => display.claimReceiptChoice(T, String(s.id), c as any, c === 'none' ? 'skipped' : 'sending'));
    await new Promise((r) => setTimeout(r, 300));
    await holder.query('commit'); holder.release();
    const won = (await Promise.all(runs)).filter(Boolean);
    expect(won).toHaveLength(1);
  });
});
