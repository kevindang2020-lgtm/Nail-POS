// display-reservation.postgres-race.vitest.spec.ts — Check-In & Display spec §85–§86, §180: one customer display, two
// POS stations, two different customers' tickets at the same instant → ONE checkout on the display, the other station
// told DISPLAY_BUSY. Before step 3, createSession inserted a new session regardless; the display shows the NEWEST, so
// the second station silently replaced the first customer's ticket — even mid-payment.
// Deterministic gate: a share lock on customer_display_sessions blocks every insert until all callers have read.
// Opt-in: PG_RACE_URL (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyCheckoutRepository } from './checkout.kysely.repository';

const url = process.env.PG_RACE_URL;
const T = 'a3100000-0000-4000-8000-0000000000aa', B = 'b3100000-0000-4000-8000-0000000000bb';
const C1 = 'c3100000-0000-4000-8000-0000000000c1', C2 = 'c3100000-0000-4000-8000-0000000000c2';
const TK1 = 'f3100000-0000-4000-8000-0000000000f1', TK2 = 'f3100000-0000-4000-8000-0000000000f2';
const DEV = 'd3100000-0000-4000-8000-0000000000dd';
const ctx = { tenantId: T, branchId: B, userId: 'e3100000-0000-4000-8000-0000000000ee', role: 'FRONT_DESK', permissions: [] } as any;
let db: Kysely<any>; let pool: pg.Pool; let repo: KyselyCheckoutRepository;
const active = async () => (await sql<any>`select ticket_id, state from customer_display_sessions where display_device_id = ${DEV} and closed_at is null and state not in ('closed','disconnected') order by created_at`.execute(db)).rows;

async function raceWithGate<R>(runs: (() => Promise<R>)[]) {
  const gate = await pool.connect();
  await gate.query('begin'); await gate.query('lock table customer_display_sessions in share mode');
  const pending = Promise.allSettled(runs.map((f) => f()));
  await new Promise((r) => setTimeout(r, 400));
  await gate.query('commit'); gate.release();
  return pending;
}

describe.skipIf(!url)('real-Postgres customer display reservation', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 8 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    repo = new KyselyCheckoutRepository(db as any);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Display Race', 'Display Race', 'display-race', 'DRACE', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(db);
    for (const [c, n] of [[C1, 'Ann'], [C2, 'Bea']]) await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values (${c}, ${T}, ${B}, ${n}, 'Race', ${n + ' Race'}) on conflict (id) do nothing`.execute(db);
    await sql`insert into tickets (id, tenant_id, branch_id, customer_id) values (${TK1}, ${T}, ${B}, ${C1}), (${TK2}, ${T}, ${B}, ${C2}) on conflict (id) do nothing`.execute(db);
    await sql`insert into customer_display_devices (id, tenant_id, branch_id, device_name, device_type, pairing_status) values (${DEV}, ${T}, ${B}, 'Shared display', 'android', 'paired') on conflict (id) do nothing`.execute(db);
  });
  afterAll(async () => {
    await sql`delete from customer_display_sessions where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await db?.destroy();
  });

  it('two stations, two customers, one display, same instant → one checkout shown, the other DISPLAY_BUSY', async () => {
    await sql`delete from customer_display_sessions where tenant_id = ${T}`.execute(db);
    const results = await raceWithGate([() => repo.createSession(ctx, TK1, DEV), () => repo.createSession(ctx, TK2, DEV)]);
    const ok = results.filter((r) => r.status === 'fulfilled' && (r as any).value);
    const busy = results.filter((r) => r.status === 'rejected' && /DISPLAY_BUSY/.test(String((r as any).reason?.code ?? (r as any).reason?.message)));
    expect(ok).toHaveLength(1);
    expect(busy).toHaveLength(1);
    expect(await active()).toHaveLength(1);
  });

  it('a display already showing customer A refuses customer B — A is never displaced, even mid-payment', async () => {
    await sql`delete from customer_display_sessions where tenant_id = ${T}`.execute(db);
    const a = await repo.createSession(ctx, TK1, DEV);
    await sql`update customer_display_sessions set state = 'payment_processing' where id = ${a!.sessionId}`.execute(db);
    await expect(repo.createSession(ctx, TK2, DEV)).rejects.toMatchObject({ code: 'DISPLAY_BUSY' });
    expect((await active()).map((r: any) => [r.ticket_id, r.state])).toEqual([[TK1, 'payment_processing']]);
  });

  it('re-sending the SAME customer refreshes their session (one active, new token); an expired session frees the display', async () => {
    await sql`delete from customer_display_sessions where tenant_id = ${T}`.execute(db);
    const first = await repo.createSession(ctx, TK1, DEV);
    const again = await repo.createSession(ctx, TK1, DEV);
    expect(again!.sessionId).not.toBe(first!.sessionId);
    expect((await active()).map((r: any) => r.ticket_id)).toEqual([TK1]);
    await sql`update customer_display_sessions set expires_at = now() - interval '1 minute' where display_device_id = ${DEV} and closed_at is null`.execute(db);
    const b = await repo.createSession(ctx, TK2, DEV);   // the abandoned session no longer holds the display
    expect(b).not.toBeNull();
    expect((await active()).map((r: any) => r.ticket_id)).toEqual([TK2]);
  });
});
