// booking-verification.postgres-race.vitest.spec.ts — BUILD_PLAN Phase 4 on real PostgreSQL, under real concurrency:
//   • one verified session presented by several booking requests at once → exactly ONE claims the proof;
//   • the same right code submitted several times at once → verified once, ONE booking.phone_verified fact;
//   • two booking sessions asking for the same slot at once → one hold, the other a clean "held for another booking"
//     (never a raw database error);
//   • the wrong code raced past the attempt limit → the session ends LOCKED with its hold released, never verified.
// Opt-in: PG_RACE_URL=postgres://… (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { phoneKey, maskPhone } from '@aipowersalon/customers';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyVerificationStore } from './booking-verification.kysely';
import { KyselyHoldRepository, BookingHoldService, HoldSlotTakenError } from './booking-hold.kysely';
import { BookingVerificationService } from './booking-verification.service';
import type { TenantCredentialResolver, VerificationProvider } from './booking-verification-provider';

const url = process.env.PG_RACE_URL;
const T = 'a4400000-0000-4000-8000-0000000000aa';
const B = 'b4400000-0000-4000-8000-0000000000bb';
const TECH = 'c4400000-0000-4000-8000-0000000000cc';
const PHONE = '+18565550177';
let db: Kysely<any>; let pool: pg.Pool;
let store: KyselyVerificationStore; let holds: BookingHoldService;

let compares = 0;   // how many codes reached the provider — the budget the attempt limit protects
const verify: VerificationProvider = {
  kind: 'twilio_verify',
  async send() { return { ok: true, providerVerificationSid: 'VE' + randomUUID().replace(/-/g, '').slice(0, 32) }; },
  async check(_c, _to, code) { compares++; await new Promise((r) => setTimeout(r, 30)); return code === '424242' ? { ok: true } : { ok: false, reason: 'incorrect' }; },
};
const creds: TenantCredentialResolver = { async resolve() { return { status: 'configured', kind: 'twilio_verify', credentials: { accountSid: 'AC1', authToken: 't', verifyServiceSid: 'VA1' } }; } };
const svc = () => new BookingVerificationService(creds, { twilio_verify: verify }, store);
const ctx = (bookingSessionId: string) => ({ tenantId: T, branchId: B, channel: 'online' as const, bookingSessionId, customerId: null, deviceId: 'dev-r', requestIp: '10.0.0.77' });
let hour = 6;
async function opened() {
  const sid = randomUUID();
  const start = Date.UTC(2027, 1, 3, hour++, 0);
  const h = await holds.acquire({ tenantId: T, branchId: B, technicianId: TECH, startsAt: start, endsAt: start + 3_600_000, bookingSessionId: sid, channel: 'online', holdSeconds: 600 });
  await store.openPending({ tenantId: T, branchId: B, bookingSessionId: sid, customerId: null, channel: 'online', phoneHash: phoneKey(PHONE), phoneMask: maskPhone(PHONE), holdId: h.holdId, expiresAt: h.expiresAt, deviceId: 'dev-r' });
  return { sid, holdId: h.holdId, start };
}
const cleanup = async () => {
  await sql`delete from outbox_events where tenant_id = ${T}`.execute(db).catch(() => undefined);
  await sql`delete from booking_verification_sessions where tenant_id = ${T}`.execute(db).catch(() => undefined);
  await sql`delete from booking_holds where tenant_id = ${T}`.execute(db).catch(() => undefined);
};

describe.skipIf(!url)('booking phone verification under real concurrency', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 10 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await cleanup();
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Race Verify', 'Race Verify', 'race-verify', 'RVF01', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status, timezone) values (${B}, ${T}, 'Main', 'active', 'America/New_York') on conflict (id) do nothing`.execute(db);
    await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active) values (${TECH}, ${T}, ${B}, 'Rae', 'Verify', 'Rae Verify', true) on conflict (id) do nothing`.execute(db);
    store = new KyselyVerificationStore(db as any, new OutboxWriter());
    holds = new BookingHoldService(new KyselyHoldRepository(db as any));
  });
  afterAll(async () => {
    await cleanup();
    await sql`delete from technicians where id = ${TECH}`.execute(db).catch(() => undefined);
    await sql`delete from branches where id = ${B}`.execute(db).catch(() => undefined);
    await sql`delete from tenants where id = ${T}`.execute(db).catch(() => undefined);
    await db?.destroy();
  });

  it('one proof, eight booking requests at once: exactly one claims it', async () => {
    const { sid } = await opened();
    await svc().send(ctx(sid), PHONE);
    expect((await svc().check(ctx(sid), PHONE, '424242')).status).toBe('phone_verified');
    const claims = await Promise.all(Array.from({ length: 8 }, () => store.claimProof(T, sid, phoneKey(PHONE), 30 * 60_000)));
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it('deterministic interleaving: a claim INSIDE an open transaction, a second claim meanwhile → still exactly one proof spent', async () => {
    const { sid } = await opened();
    await svc().send(ctx(sid), PHONE);
    await svc().check(ctx(sid), PHONE, '424242');
    let second: Promise<any> | null = null;
    const first = await db.transaction().execute(async (trx) => {
      const a = await new KyselyVerificationStore(trx as any).claimProof(T, sid, phoneKey(PHONE), 30 * 60_000);
      second = store.claimProof(T, sid, phoneKey(PHONE), 30 * 60_000);   // while the first is uncommitted
      await new Promise((r) => setTimeout(r, 300));
      return a;
    });
    const b = await second!;
    expect([first, b].filter(Boolean)).toHaveLength(1);
  });

  it('the right code submitted five times at once: verified once, one booking.phone_verified fact', async () => {
    const { sid } = await opened();
    await svc().send(ctx(sid), PHONE);
    const out = await Promise.allSettled(Array.from({ length: 5 }, () => svc().check(ctx(sid), PHONE, '424242')));
    for (const o of out) expect(o.status).toBe('fulfilled');
    const row = (await sql`select id, status from booking_verification_sessions where booking_session_id = ${sid}`.execute(db)).rows[0] as any;
    expect(row.status).toBe('verified');
    const facts = (await sql`select count(*)::int as n from outbox_events where aggregate_id = ${row.id} and event_type = 'booking.phone_verified'`.execute(db)).rows[0] as any;
    expect(facts.n).toBe(1);
  });

  it('two booking sessions grab the same slot at once: one hold, one clean refusal, no raw database error', async () => {
    const start = Date.UTC(2027, 1, 4, 15, 0);
    const req = (s: string) => holds.acquire({ tenantId: T, branchId: B, technicianId: TECH, startsAt: start, endsAt: start + 3_600_000, bookingSessionId: s, channel: 'online', holdSeconds: 600 });
    const out = await Promise.allSettled([req(randomUUID()), req(randomUUID()), req(randomUUID()), req(randomUUID())]);
    const won = out.filter((o) => o.status === 'fulfilled');
    expect(won).toHaveLength(1);
    for (const o of out) if (o.status === 'rejected') expect(o.reason).toBeInstanceOf(HoldSlotTakenError);
    const live = (await sql`select count(*)::int as n from booking_holds where tenant_id = ${T} and start_time = to_timestamp(${start} / 1000.0) and released_at is null`.execute(db)).rows[0] as any;
    expect(live.n).toBe(1);
  });

  it('wrong codes raced past the limit: LOCKED, hold released, and the right code afterwards does not verify', async () => {
    const { sid, holdId } = await opened();
    await svc().send(ctx(sid), PHONE);
    compares = 0;
    await Promise.allSettled(Array.from({ length: 9 }, () => svc().check(ctx(sid), PHONE, '000000')));
    // the brute-force property itself: nine simultaneous guesses, at most FIVE ever compared
    expect(compares).toBeLessThanOrEqual(5);
    const row = (await sql`select status, attempt_count from booking_verification_sessions where booking_session_id = ${sid}`.execute(db)).rows[0] as any;
    expect(row.status).toBe('locked');
    expect((await sql`select released_at from booking_holds where id = ${holdId}`.execute(db)).rows[0]).toMatchObject({ released_at: expect.any(Date) });
    expect((await svc().check(ctx(sid), PHONE, '424242')).status).toBe('too_many_attempts');
    expect(await store.claimProof(T, sid, phoneKey(PHONE), 30 * 60_000)).toBeNull();
  });
});
