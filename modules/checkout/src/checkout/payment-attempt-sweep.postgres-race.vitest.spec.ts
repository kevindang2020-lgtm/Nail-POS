// payment-attempt-sweep.postgres-race.vitest.spec.ts — BUILD_PLAN Phase 11 (Constitution 4 §116): several workers may
// run the stranded-attempt sweep at once. Every write is conditional, so ten sweepers over one stranded attempt make ONE
// transition and raise ONE alert. TRUE concurrency needs real Postgres. Opt-in: PG_RACE_URL=postgres://… (migrated).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyPaymentAttemptSweepStore } from './payment-attempt-sweep.kysely';
import { PaymentAttemptSweep, type ProcessorAnswer } from './payment-attempt-sweep';
import { KyselyCheckoutRepository } from './checkout.kysely.repository';
import { PaymentAttemptSweepScheduler } from './payment-attempt-sweep.scheduler';

const url = process.env.PG_RACE_URL;
const T = 'a5490000-0000-4000-8000-0000000000aa';
const B = 'b5490000-0000-4000-8000-0000000000bb';
const C = 'c5490000-0000-4000-8000-0000000000cc';
const TK = 'f5490000-0000-4000-8000-0000000000ff';
const MIN = 60_000;

let db: Kysely<any>; let pool: pg.Pool;
const one = async <R,>(q: any) => (await q.execute(db)).rows[0] as R;
const count = async (q: any) => Number(((await q.execute(db)).rows[0] as any).n);

async function strandedAttempt(key: string, amount = 4200): Promise<string> {
  const r = await one<{ id: string }>(sql`insert into payment_attempts (tenant_id, branch_id, ticket_id, amount_cents, method, status, idempotency_key, created_at)
    values (${T}, ${B}, ${TK}, ${amount}, 'card', 'processing', ${key}, now() - interval '30 minutes') returning id`);
  return r.id;
}
/** Ten sweepers start together; a gate holds the row so every conditional UPDATE queues behind it, then opens. */
async function tenSweepersAt(attemptId: string, answer: ProcessorAnswer) {
  const gate = await pool.connect();
  await gate.query('begin'); await gate.query('select 1 from payment_attempts where id = $1 for update', [attemptId]);
  const proc = { async inquire() { return answer; }, async reconcileCard() { return 'none' as const; } };
  const runs = Promise.all(Array.from({ length: 10 }, () => new PaymentAttemptSweep(new KyselyPaymentAttemptSweepStore(db), proc, { strandedMs: 15 * MIN }).run()));
  await new Promise((r) => setTimeout(r, 400));
  await gate.query('commit'); gate.release();
  return runs;
}

describe.skipIf(!url)('stranded-attempt sweep on real Postgres (Constitution 4 §116)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 30 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Sweep Salon', 'Sweep Salon', 'sweep-salon-549', 'SWP549', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values (${C}, ${T}, ${B}, 'Lan', 'Ho', 'Lan Ho') on conflict (id) do nothing`.execute(db);
    await sql`insert into tickets (id, tenant_id, branch_id, customer_id) values (${TK}, ${T}, ${B}, ${C}) on conflict (id) do nothing`.execute(db);
  });
  beforeEach(async () => {
    await sql`delete from payment_attempts where tenant_id = ${T}`.execute(db);
    await sql`delete from payments where tenant_id = ${T}`.execute(db);
    await sql`delete from owner_alerts where tenant_id = ${T}`.execute(db);
    await sql`delete from alerts where tenant_id = ${T}`.execute(db);
  });
  afterAll(async () => {
    await sql`delete from payment_attempts where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from payments where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from owner_alerts where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from alerts where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await db?.destroy();
  });

  it('charged-but-unrecorded: ten sweepers → ONE needs_review, ONE owner alert, ONE Super Admin alert; the key still blocks a re-charge', async () => {
    const id = await strandedAttempt('split-key-1');
    const reports = await tenSweepersAt(id, { kind: 'answer', processor: 'cardpointe', transactions: [{ retref: 'R549', approved: true, declined: false, amountCents: 4200 }] });
    expect(reports.reduce((n, r) => n + r.splitsNeedReview, 0)).toBe(1);
    const row = await one<any>(sql`select status, resolution, stranded_at, resolved_at, idempotency_key from payment_attempts where id = ${id}`);
    expect(row).toMatchObject({ status: 'needs_review', resolution: 'provider_approved_unrecorded', idempotency_key: 'split-key-1' });
    expect(row.stranded_at).not.toBeNull();
    expect(await count(sql`select count(*)::int n from owner_alerts where tenant_id = ${T} and category = 'payment_review'`)).toBe(1);
    expect(await count(sql`select count(*)::int n from alerts where dedupe_key = ${'payment_review:' + id} and type = 'payment'`)).toBe(1);
    const meta = await one<any>(sql`select metadata from owner_alerts where tenant_id = ${T}`);
    expect(meta.metadata).toMatchObject({ kind: 'split_attempt', id, processorReference: 'R549', resolution: 'provider_approved_unrecorded' });
    // the cashier's re-run of the same split is still refused (no double charge)
    const repo = new KyselyCheckoutRepository(db as any);
    const ctx = { tenantId: T, branchId: B, userId: 'e5490000-0000-4000-8000-0000000000ee', role: 'FRONT_DESK', permissions: [] } as any;
    expect((await repo.claimPaymentAttempt(ctx, { ticketId: TK, method: 'card', amountCents: 4200, idempotencyKey: 'split-key-1' })).claimed).toBe(false);
  });

  it('declined: ten sweepers → ONE release, no alert, and the freed key lets the split be run again', async () => {
    const id = await strandedAttempt('split-key-2');
    const reports = await tenSweepersAt(id, { kind: 'answer', processor: 'cardpointe', transactions: [{ retref: 'D549', approved: false, declined: true, amountCents: 4200 }] });
    expect(reports.reduce((n, r) => n + r.splitsReleased, 0)).toBe(1);
    const row = await one<any>(sql`select status, resolution, idempotency_key from payment_attempts where id = ${id}`);
    expect(row).toMatchObject({ status: 'failed', resolution: 'provider_declined', idempotency_key: `split-key-2#released:${id}` });
    expect(await count(sql`select count(*)::int n from owner_alerts where tenant_id = ${T}`)).toBe(0);
    const repo = new KyselyCheckoutRepository(db as any);
    const ctx = { tenantId: T, branchId: B, userId: 'e5490000-0000-4000-8000-0000000000ee', role: 'FRONT_DESK', permissions: [] } as any;
    expect((await repo.claimPaymentAttempt(ctx, { ticketId: TK, method: 'card', amountCents: 4200, idempotencyKey: 'split-key-2' })).claimed).toBe(true);
  });

  it('a live attempt (younger than the threshold) and tap-to-pay attempts are never touched', async () => {
    await sql`insert into payment_attempts (tenant_id, branch_id, ticket_id, amount_cents, method, status, idempotency_key, created_at)
      values (${T}, ${B}, ${TK}, 4200, 'card', 'processing', 'live-1', now() - interval '2 minutes'),
             (${T}, ${B}, ${TK}, 4200, 'tap_to_pay', 'processing', 'ttp-1', now() - interval '2 hours')`.execute(db);
    let asked = 0;
    const r = await new PaymentAttemptSweep(new KyselyPaymentAttemptSweepStore(db), { async inquire() { asked++; return { kind: 'answer', processor: 'x', transactions: [] }; }, async reconcileCard() { return 'none' as const; } }, { strandedMs: 15 * MIN }).run();
    expect(asked).toBe(0); expect(r.splitsChecked).toBe(0);
    expect(await count(sql`select count(*)::int n from payment_attempts where tenant_id = ${T} and status = 'processing'`)).toBe(2);
  });

  it('an unverifiable card payment: ten sweepers mark it ONCE and raise ONE alert; the row stays processing', async () => {
    const p = await one<{ id: string }>(sql`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, status, idempotency_key, created_at)
      values (${T}, ${B}, ${TK}, 'card', 5000, 'processing', 'card-key-1', now() - interval '40 minutes') returning id`);
    const gate = await pool.connect();
    await gate.query('begin'); await gate.query('select 1 from payments where id = $1 for update', [p.id]);
    const proc = { async inquire(): Promise<ProcessorAnswer> { return { kind: 'not_connected' }; }, async reconcileCard() { return 'unknown' as const; } };
    const runs = Promise.all(Array.from({ length: 10 }, () => new PaymentAttemptSweep(new KyselyPaymentAttemptSweepStore(db), proc, { strandedMs: 15 * MIN }).run()));
    await new Promise((r) => setTimeout(r, 400));
    await gate.query('commit'); gate.release();
    await runs;
    const row = await one<any>(sql`select status, stranded_at from payments where id = ${p.id}`);
    expect(row.status).toBe('processing'); expect(row.stranded_at).not.toBeNull();
    expect(await count(sql`select count(*)::int n from owner_alerts where tenant_id = ${T} and category = 'payment_review'`)).toBe(1);
    expect(await count(sql`select count(*)::int n from alerts where dedupe_key = ${'payment_review:' + p.id}`)).toBe(1);
  });

  it('two workers tick at once: ONE owns the tick (single-owner lock), the other skips; the processor is asked once', async () => {
    await strandedAttempt('split-key-3');
    let asked = 0;
    const checkout: any = {
      async inquireProcessor() { asked++; await new Promise((r) => setTimeout(r, 300)); return { kind: 'answer', processor: 'x', transactions: [] }; },
      async reconcileStrandedCard() { return { status: 'none' }; },
    };
    const [a, b] = await Promise.all([new PaymentAttemptSweepScheduler(checkout, db as any).tick(), new PaymentAttemptSweepScheduler(checkout, db as any).tick()]);
    expect([a, b].filter((r) => r === null)).toHaveLength(1);
    expect(asked).toBe(1);
    expect([a, b].find((r) => r)!.splitsReleased).toBe(1);
  });
});
