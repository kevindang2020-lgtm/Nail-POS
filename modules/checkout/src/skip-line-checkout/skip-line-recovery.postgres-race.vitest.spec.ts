// skip-line-recovery.postgres-race.vitest.spec.ts — B-80 (Oct 23 2026) on REAL PostgreSQL: (1) ten confirms of ONE intent
// at once reach the processor ONCE (charge_started_at is claimed by a conditional UPDATE); (2) a charged intent whose answer
// was lost, settled by the staff Verify, the customer's Check status and two sweepers at the same moment → ONE approved
// payment, the ticket paid, nobody charges again and nobody gets a raw error. Opt-in: PG_RACE_URL=postgres://… (migrated).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { SkipLineCheckoutRepository } from './skip-line-checkout.repository';
import { SkipLineCheckoutService } from './skip-line-checkout.service';
import { CheckoutLockService, LockHeldElsewhereError } from '../checkout-lock/checkout-lock.service';
import { KyselyCheckoutLockRepository } from '../checkout-lock/checkout-lock.repository';

const url = process.env.PG_RACE_URL;
const T = 'a6800000-0000-4000-8000-0000000000aa', B = 'b6800000-0000-4000-8000-0000000000bb', U = 'e6800000-0000-4000-8000-0000000000ee';
const C = 'c6800000-0000-4000-8000-0000000000cc', CAT = 'd6800000-0000-4000-8000-0000000000d1', SVC = 'd6800000-0000-4000-8000-0000000000d2';
let db: Kysely<any>; let pool: pg.Pool; let n = 0;
const ctx: any = { tenantId: T, branchId: B, userId: U, role: 'CUSTOMER', permissions: [] };
const staff: any = { tenantId: T, branchId: B, userId: U, role: 'FRONT_DESK', permissions: ['checkout.process_payment', 'pos.checkout.take_payment'] };

async function ticket(): Promise<string> {
  const id = `f6800000-0000-4000-8000-0000000001${String(++n).padStart(2, '0')}`;
  await sql`insert into tickets (id, tenant_id, branch_id, customer_id, status, tip_cents, tax_cents, discount_cents) values (${id}, ${T}, ${B}, ${C}, 'ready_checkout', 0, 0, 0)`.execute(db);
  await sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values (${T}, ${B}, ${id}, ${SVC}, 'Gel Manicure', 4500, 45, 4500)`.execute(db);
  return id;
}
function proc(answer: 'throw' | 'approve') {
  const charges: any[] = [];
  return { charges, p: {
    name: 'cardpointe',
    async authorizeAndCapture(i: any) { charges.push(i); await new Promise((r) => setTimeout(r, 80)); if (answer === 'throw') throw new Error('socket hang up'); return { approved: true, declined: false, retref: 'RT-LIVE', respstat: 'A' }; },
    async inquireByOrderId() { return { transactions: [{ retref: 'RT-INQ', approved: true, declined: false, amountCents: 4500 }] }; },
  } };
}
const svc = (p: any) => new SkipLineCheckoutService(new SkipLineCheckoutRepository(db as any), undefined, { resolve: async () => ({ processor: p }) });

describe.skipIf(!url)('Skip-the-Line app charge recovery on real Postgres (B-80)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 30 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`delete from payments where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from payment_intents where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from ticket_service_lines where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from receipts where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from tickets where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'SLR Salon', 'SLR Salon', 'slr-salon-680', 'SLR680', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role) values (${U}, ${T}, ${B}, 'Kim', 'Le', 'Kim Le', 'kim@slr680.test', 'x', 'active', 'CUSTOMER') on conflict (id) do nothing`.execute(db);
    await sql`insert into customers (id, tenant_id, branch_id, user_id, first_name, last_name, full_name) values (${C}, ${T}, ${B}, ${U}, 'Kim', 'Le', 'Kim Le') on conflict (id) do nothing`.execute(db);
    await sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${B}, 'Manicure') on conflict (id) do nothing`.execute(db);
    await sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status, commission_type, commission_value) values (${SVC}, ${T}, ${B}, ${CAT}, 'Gel Manicure', 45, 4500, 'active', 'percent', 50) on conflict (id) do nothing`.execute(db);
  });
  afterAll(async () => { await db?.destroy(); });

  it('B-81: the POS holding the ticket (taking cash) → the guest\'s card is refused before the processor; the guest\'s card in flight → the POS cannot take the ticket', async () => {
    const locks = new CheckoutLockService(new KyselyCheckoutLockRepository(db as any));
    const tk = await ticket(); const live = proc('approve');
    const st = await svc(live.p).startAppPayment(ctx, tk, { method: 'card' });
    await locks.acquire({ tenantId: T, branchId: B, ticketId: tk, userId: U, sessionId: 'pos-pay:1', source: 'pos' });
    await expect(svc(live.p).useLocks(locks).confirmAppPayment(ctx, tk, { intentId: st.intentId, method: 'card', token: '9418594164541111', expiry: '1230' })).rejects.toMatchObject({ code: 'checkout_in_progress', httpStatus: 409 });
    expect(live.charges).toHaveLength(0);
    await locks.release(T, tk, 'pos-pay:1', 'payment_done');
    // the guest's charge holds the lock for its whole processor call: a POS tender started meanwhile is refused
    const charging = svc(live.p).useLocks(locks).confirmAppPayment(ctx, tk, { intentId: st.intentId, method: 'card', token: '9418594164541111', expiry: '1230' });
    await new Promise((r) => setTimeout(r, 30));
    await expect(locks.acquire({ tenantId: T, branchId: B, ticketId: tk, userId: U, sessionId: 'pos-pay:2', source: 'pos' })).rejects.toBeInstanceOf(LockHeldElsewhereError);
    expect(await charging).toMatchObject({ paid: true });
    expect(live.charges).toHaveLength(1);
    // released afterwards
    await locks.acquire({ tenantId: T, branchId: B, ticketId: tk, userId: U, sessionId: 'pos-pay:3', source: 'pos' });
    await locks.release(T, tk, 'pos-pay:3', 'done');
  });

  it('ten confirms of ONE intent at once → ONE processor call', async () => {
    const tk = await ticket(); const live = proc('approve');
    const st = await svc(live.p).startAppPayment(ctx, tk, { method: 'card' });
    const rs = await Promise.allSettled(Array.from({ length: 10 }, () => svc(live.p).confirmAppPayment(ctx, tk, { intentId: st.intentId, method: 'card', token: '9418594164541111', expiry: '1230' })));
    expect(live.charges).toHaveLength(1);
    expect(rs.filter((r) => r.status === 'fulfilled' && (r.value as any).paid).length).toBe(1);
    for (const r of rs) if (r.status === 'rejected') expect((r.reason as any).code).toMatch(/payment_status_unknown|already_paid/);
    expect(Number(((await sql<any>`select count(*)::int n from payments where tenant_id = ${T} and ticket_id = ${tk} and status = 'approved'`.execute(db)).rows[0] as any).n)).toBe(1);
  });

  it('a lost answer settled by staff Verify + customer Check status + two sweepers at once → ONE approved payment, no error, no second charge', async () => {
    const tk = await ticket(); const live = proc('throw');
    const st = await svc(live.p).startAppPayment(ctx, tk, { method: 'card' });
    await svc(live.p).confirmAppPayment(ctx, tk, { intentId: st.intentId, method: 'card', token: '9418594164541111', expiry: '1230' }).catch(() => undefined);
    await sql`update payment_intents set charge_started_at = now() - interval '30 minutes' where id = ${st.intentId}`.execute(db);
    const gate = await pool.connect();
    await gate.query('begin'); await gate.query('select 1 from payment_intents where id = $1 for update', [st.intentId]);
    const rec = proc('approve');
    const runs = Promise.allSettled([svc(rec.p).posVerifyAppPayment(staff, tk), svc(rec.p).customerVerifyPayment(ctx, st.intentId), svc(rec.p).sweepStranded(), svc(rec.p).sweepStranded()]);
    await new Promise((r) => setTimeout(r, 400));
    await gate.query('commit'); gate.release();
    const out = await runs;
    for (const o of out) expect(o.status, String((o as any).reason?.message)).toBe('fulfilled');
    for (const o of out.slice(2)) expect(((o as any).value).errors, JSON.stringify((o as any).value)).toBe(0);
    expect(rec.charges).toHaveLength(0);
    expect(Number(((await sql<any>`select count(*)::int n from payments where tenant_id = ${T} and ticket_id = ${tk} and status = 'approved'`.execute(db)).rows[0] as any).n)).toBe(1);
    expect(((await sql<any>`select status from tickets where id = ${tk}`.execute(db)).rows[0] as any).status).toBe('paid');
    expect(((await sql<any>`select status, processor_ref from payment_intents where id = ${st.intentId}`.execute(db)).rows[0] as any)).toMatchObject({ status: 'succeeded', processor_ref: 'RT-INQ' });
  });
});
