// customer-phone.postgres-race.vitest.spec.ts — BUILD_PLAN Phase 3 on real PostgreSQL, under real concurrency:
//   • two terminals start a change for the same customer at once → one open change, no 500, no second pending number;
//   • the same code submitted twice at once → activated exactly once, one active number;
//   • a profile edit lands while the code is being checked → the change refuses to overwrite it (stale_record), and
//     the verification is kept for a retry.
// Opt-in: PG_RACE_URL=postgres://… (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { OutboxWriter } from '@aipowersalon/events';
import { CustomerPhoneUpdateService, type VerificationPort } from './customer-phone-update.service';
import { KyselyPhoneStore, KyselySyncPort } from './customer-phone.kysely';

const url = process.env.PG_RACE_URL;
const T = 'a3900000-0000-4000-8000-0000000000aa';
const B = 'b3900000-0000-4000-8000-0000000000bb';
const U = 'c3900000-0000-4000-8000-0000000000cc';
const ctx = { tenantId: T, branchId: B, userId: U, role: 'RECEPTION' as const, source: 'staff_pos' as const };

let db: Kysely<any>; let pool: pg.Pool;
function otp(delayMs = 0): VerificationPort {
  const sent = new Set<string>();
  return {
    async send(_c, phone) { sent.add(phone); return { status: 'code_sent', message: 'sent' }; },
    async check(_c, phone, code) { await new Promise((r) => setTimeout(r, delayMs)); return sent.has(phone) && code === '123456' ? { status: 'phone_verified', message: 'ok' } : { status: 'code_invalid', message: 'wrong' }; },
  };
}
const service = (v = otp()) => new CustomerPhoneUpdateService(new KyselyPhoneStore(db as any, new OutboxWriter()), v, new KyselySyncPort(db as any));
let n = 0;
async function customer(phone: string): Promise<string> {
  return String((await sql<{ id: string }>`insert into customers (tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display)
    values (${T}, ${B}, 'Race', ${'P' + ++n}, ${'Race P' + n}, ${phone}, ${phone}) returning id`.execute(db)).rows[0].id);
}
const cleanup = async () => {
  for (const t of ['customer_phone_update_sessions', 'customer_phones', 'booking_verified_phones', 'notification_opt_outs', 'owner_alerts', 'outbox_events']) await sql`delete from ${sql.table(t)} where tenant_id = ${T}`.execute(db).catch(() => undefined);
  await sql`delete from jobs where tenant_id = ${T}`.execute(db).catch(() => undefined);
  await sql`delete from customers where tenant_id = ${T}`.execute(db).catch(() => undefined);
};

describe.skipIf(!url)('customer phone change under real concurrency', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 8 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await cleanup();
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Race Phone', 'Race Phone', 'race-phone', 'RPH01', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status, timezone) values (${B}, ${T}, 'Main', 'active', 'America/New_York') on conflict (id) do nothing`.execute(db);
  });
  afterAll(async () => { await cleanup(); await sql`delete from branches where id = ${B}`.execute(db).catch(() => undefined); await sql`delete from tenants where id = ${T}`.execute(db).catch(() => undefined); await db?.destroy(); });

  it('two terminals start a change at once: one open change, one pending number, no server error', async () => {
    const C = await customer('+18565560101');
    const svc = service();
    const out = await Promise.allSettled([
      svc.start(ctx, { customerId: C, newPhone: '+18565560102' }),
      svc.start(ctx, { customerId: C, newPhone: '+18565560103' }),
      svc.start(ctx, { customerId: C, newPhone: '+18565560102' }),
    ]);
    for (const o of out) if (o.status === 'rejected') expect(String((o.reason as any)?.code ?? '')).not.toBe('');   // a domain refusal, never a raw DB error
    const open = (await sql`select count(*)::int as n from customer_phone_update_sessions where tenant_id = ${T} and customer_id = ${C} and completed_at is null`.execute(db)).rows[0] as any;
    const pending = (await sql`select count(*)::int as n from customer_phones where tenant_id = ${T} and customer_id = ${C} and status = 'pending_verification'`.execute(db)).rows[0] as any;
    expect(open.n).toBe(1);
    expect(pending.n).toBe(1);
  });

  it('the same code submitted twice at once activates exactly once', async () => {
    const C = await customer('+18565560111');
    const svc = service(otp(50));
    const s = await svc.start(ctx, { customerId: C, newPhone: '+18565560112' });
    await svc.sendCode(ctx, s.sessionId, '+18565560112', C);
    const out = await Promise.allSettled([1, 2, 3].map(() => svc.verify(ctx, s.sessionId, '+18565560112', '123456', C)));
    const activated = out.filter((o) => o.status === 'fulfilled' && (o.value as any).activated).length;
    expect(activated).toBe(1);
    const rows: any[] = (await sql`select status from customer_phones where tenant_id = ${T} and customer_id = ${C}`.execute(db)).rows;
    expect(rows.filter((r) => r.status.startsWith('active'))).toHaveLength(1);
    expect((await sql`select normalized_phone, record_version from customers where id = ${C}`.execute(db)).rows[0]).toMatchObject({ normalized_phone: '+18565560112' });
  });

  it('a profile edit landing during verification is never overwritten; the proof is kept for a retry', async () => {
    const C = await customer('+18565560121');
    const svc = service(otp(150));
    const s = await svc.start(ctx, { customerId: C, newPhone: '+18565560122' });
    await svc.sendCode(ctx, s.sessionId, '+18565560122', C);
    const verifying = svc.verify(ctx, s.sessionId, '+18565560122', '123456', C);
    await sql`update customers set normalized_phone = '+18565560129', phone_display = '+18565560129', record_version = record_version + 1 where id = ${C}`.execute(db);
    await expect(verifying).rejects.toMatchObject({ code: 'stale_record' });
    expect((await sql`select normalized_phone from customers where id = ${C}`.execute(db)).rows[0]).toMatchObject({ normalized_phone: '+18565560129' });
    expect((await sql`select state from customer_phone_update_sessions where id = ${s.sessionId}`.execute(db)).rows[0]).toMatchObject({ state: 'phone_verified' });
  });
});
