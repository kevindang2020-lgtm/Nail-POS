// ticket-status.postgres-race.vitest.spec.ts — Round 2 C (Oct 12 2026): reopen on one API replica racing a payment on
// another, on REAL Postgres (PGlite is single-session). The ticket's checkout status lives on the row (migration 572), so
// the outcome is decided by the database: the payment always lands; the reopen either committed BEFORE it (and the board
// still shows the ticket paid) or is refused — a reopen is never written over a paid ticket.
// Opt-in: PG_RACE_URL=postgres://... (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyCheckoutRepository } from './checkout.kysely.repository';
import { CheckoutService } from './checkout.service';

const url = process.env.PG_RACE_URL;
const T = 'a3100000-0000-4000-8000-0000000000aa';
const B = 'b3100000-0000-4000-8000-0000000000bb';
const C = 'd3100000-0000-4000-8000-0000000000dd';
const ctx = { tenantId: T, branchId: B, userId: 'e3100000-0000-4000-8000-0000000000ee', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.reopen_service', 'checkout.reopen_service'] } as any;
const N = 30;

let poolA: pg.Pool; let poolB: pg.Pool; let dbA: Kysely<any>; let dbB: Kysely<any>;
let repoA: KyselyCheckoutRepository; let repoB: KyselyCheckoutRepository; let svcB: CheckoutService;
const visits: string[] = [];

describe.skipIf(!url)('real-Postgres: reopen on replica B vs payment on replica A', () => {
  beforeAll(async () => {
    poolA = new pg.Pool({ connectionString: url, max: 16 }); poolB = new pg.Pool({ connectionString: url, max: 16 });
    dbA = new Kysely<any>({ dialect: new PostgresDialect({ pool: poolA }) }); dbB = new Kysely<any>({ dialect: new PostgresDialect({ pool: poolB }) });
    const outbox: any = { write: async (_x: unknown, e: any) => { if (e.eventType === 'visit.completed') visits.push(String(e.aggregateId)); } };
    repoA = new KyselyCheckoutRepository(dbA as any, outbox); repoB = new KyselyCheckoutRepository(dbB as any, outbox);
    svcB = new CheckoutService(repoB);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Race Replica', 'Race Replica', 'race-replica-c', 'RACERC', 'active') on conflict (id) do nothing`.execute(dbA);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(dbA);
    await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values (${C}, ${T}, ${B}, 'Ana', 'Le', 'Ana Le') on conflict (id) do nothing`.execute(dbA);
    // the witness: any write of a board status onto a row that is ALREADY paid (the stale-replica bug) is recorded here
    await sql`create table if not exists race_r2c_overwrites (ticket_id uuid not null)`.execute(dbA);
    await sql.raw(`create or replace function race_r2c_witness() returns trigger language plpgsql as $$ begin
      if old.status = 'paid' and new.checkout_status is distinct from old.checkout_status then insert into race_r2c_overwrites values (new.id); end if;
      return new; end $$`).execute(dbA);
    await sql.raw(`drop trigger if exists race_r2c_witness on tickets; create trigger race_r2c_witness before update on tickets for each row
      when (new.tenant_id = '${T}') execute function race_r2c_witness()`).execute(dbA);
  });
  afterAll(async () => {
    await sql.raw(`drop trigger if exists race_r2c_witness on tickets; drop function if exists race_r2c_witness(); drop table if exists race_r2c_overwrites`).execute(dbA).catch(() => undefined);
    await sql`delete from ticket_service_lines where tenant_id = ${T}`.execute(dbA).catch(() => undefined);
    await sql`delete from tickets where tenant_id = ${T}`.execute(dbA).catch(() => undefined);
    await dbA?.destroy(); await dbB?.destroy();
  });

  it(`${N} tickets: every payment lands; each reopen either committed first or was refused — never written over paid`, async () => {
    const ids: string[] = [];
    for (let i = 0; i < N; i++) {
      const r = await sql<{ id: string }>`insert into tickets (tenant_id, branch_id, customer_id, status, ticket_number, subtotal_cents, total_cents) values (${T}, ${B}, ${C}, 'ready_checkout', ${'RC' + i}, 5000, 5000) returning id`.execute(dbA);
      ids.push(r.rows[0].id);
      await sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values (${T}, ${B}, ${r.rows[0].id}, '00000000-0000-0000-0000-000000000000', 'Pedicure', 5000, 45, 5000)`.execute(dbA);
    }
    // widen the window between B's read and B's write (a busy replica), and stagger A's payment across it, so every
    // interleaving happens: B's read before A's payment and B's write after it is the one the row must refuse
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const read = repoB.ticket.bind(repoB);
    (repoB as any).ticket = async (c: any, id: string) => { const t = await read(c, id); await sleep(Math.random() * 30); return t; };
    const results = await Promise.all(ids.map(async (id) => {
      const [reopen, pay] = await Promise.allSettled([svcB.reopen(ctx, id, { reason: 'race' } as any), sleep(Math.random() * 30).then(() => repoA.setStatus(ctx, id, 'paid'))]);
      return { id, reopen, pay };
    }));
    let reopened = 0, refused = 0;
    for (const r of results) {
      expect(r.pay).toEqual({ status: 'fulfilled', value: true });
      const row = (await sql<{ status: string; checkout_status: string | null }>`select status, checkout_status from tickets where id = ${r.id}`.execute(dbA)).rows[0];
      expect(row.status).toBe('paid');
      expect(await repoA.ticket(ctx, r.id).then((t) => t?.status)).toBe('paid');
      expect(await repoB.ticket(ctx, r.id).then((t) => t?.status)).toBe('paid');
      if (r.reopen.status === 'fulfilled') { reopened++; expect(row.checkout_status).toBe('reopened'); }
      else {
        refused++;
        expect(String((r.reopen.reason as any)?.code ?? (r.reopen.reason as Error).message)).toMatch(/CHECKOUT_ALREADY_IN_PROGRESS|ALREADY_PAID/);
        expect(row.checkout_status).toBeNull();   // the refused reopen wrote nothing
      }
    }
    expect(reopened + refused).toBe(N);
    expect((await sql<{ n: number }>`select count(*)::int as n from race_r2c_overwrites`.execute(dbA)).rows[0].n).toBe(0);
    if (process.env.RACE_VERBOSE) console.log(`reopened first ${reopened}, refused ${refused}`);
    expect(new Set(visits.filter((v) => ids.includes(v))).size).toBe(N);
    expect(visits.filter((v) => ids.includes(v))).toHaveLength(N);   // one visit per ticket
  });
});
