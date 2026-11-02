// booking-verification-center.postgres-race — Booking Phone Verification Complete Build Guide §8 / §18 "Hold/concurrency" and
// "OTP/session" on REAL Postgres with REAL concurrency (PGlite is one session, so it cannot show a race):
//   • 12 wrong codes at once over four sessions → exactly OTP_MAX_ATTEMPTS attempts counted, the session LOCKED once, its
//     hold handed back; a correct code afterwards is refused (too many attempts)
//   • 8 correct codes at once → ONE verified session (never locked — the bug this found), ONE verified-phone row
//   • 8 customers claim the same technician/time at once while a LAPSED (unswept) hold sits on it → exactly ONE live hold
// Fresh random salon per run (the CI race database is shared).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { hashPassword } from '@aipowersalon/auth';
import { normalizePhone, phoneKey, maskPhone, OTP_MAX_ATTEMPTS } from '@aipowersalon/customers';
import { BookingVerificationService } from './booking-verification.service';
import { KyselyVerificationStore } from './booking-verification.kysely';
import { BookingHoldService, KyselyHoldRepository } from './booking-hold.kysely';

const url = process.env.PG_RACE_URL;
const TAG = `bvr${process.pid}${Date.now().toString(36)}`.slice(0, 16);
const T = randomUUID(), B = randomUUID(), TECH = randomUUID();
const PHONE = '+1609' + String(Math.floor(1e6 + Math.random() * 8.9e6));

describe.skipIf(!url)('Booking phone verification on real Postgres: attempt budget, one verification, one hold', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }) });
  const dbs = url ? [mk(), mk(), mk(), mk()] : [];
  const svcs = dbs.map((d) => new BookingVerificationService({ resolve: async () => ({ status: 'missing' }) } as any, { twilio_verify: {} as any }, new KyselyVerificationStore(d)));
  const q = async (s: any) => (await s.execute(dbs[0])).rows as any[];
  const e164 = normalizePhone(PHONE)!;

  async function openSession(holdId: string | null = null) {
    const bs = randomUUID();
    await q(sql`insert into booking_verification_sessions (tenant_id, branch_id, booking_session_id, booking_hold_id, phone_hash, phone_mask, channel, provider, status, expires_at, last_sent_at, code_hash)
      values (${T}, ${B}, ${bs}, ${holdId}, ${phoneKey(e164)}, ${maskPhone(e164)}, 'online', 'internal_otp', 'sent', now() + interval '10 minutes', now(), ${await hashPassword('482913')})`);
    return bs;
  }
  const check = (i: number, bs: string, code: string) => svcs[i % svcs.length].check({ tenantId: T, branchId: B, channel: 'online', bookingSessionId: bs }, PHONE, code);

  beforeAll(async () => {
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, ${TAG}, ${TAG}, ${TAG}, ${TAG.slice(-10).toUpperCase()}, 'active')`);
    await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York')`);
  }, 60_000);
  afterAll(async () => { await Promise.all(dbs.map((d) => d.destroy())); });

  it(`12 wrong codes at once → exactly ${OTP_MAX_ATTEMPTS} attempts counted, locked once, the hold handed back; the right code is then refused`, async () => {
    const hold = String((await q(sql`insert into booking_holds (tenant_id, branch_id, technician_id, start_time, end_time, expires_at, status, booking_session_id, channel)
      values (${T}, ${B}, ${TECH}, '2027-01-05T15:00:00Z', '2027-01-05T16:00:00Z', now() + interval '10 minutes', 'held', ${randomUUID()}, 'online') returning id`))[0].id);
    const bs = await openSession(hold);
    const out = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => check(i, bs, String(100000 + i))));
    expect(out.filter((o) => o.status === 'rejected').map((o: any) => String(o.reason?.message ?? o.reason))).toEqual([]);
    const st = out.map((o: any) => o.value.status);
    expect(st.every((s) => s === 'incorrect_code' || s === 'too_many_attempts')).toBe(true);
    const row = (await q(sql`select status, attempt_count from booking_verification_sessions where booking_session_id = ${bs}`))[0];
    expect({ status: row.status, attempts: Number(row.attempt_count) }).toEqual({ status: 'locked', attempts: OTP_MAX_ATTEMPTS });
    expect((await q(sql`select status, release_reason from booking_holds where id = ${hold}`))[0]).toEqual({ status: 'released', release_reason: 'verification_failed' });
    expect((await check(0, bs, '482913')).status).toBe('too_many_attempts');
  });

  it('8 correct codes at once → ONE verified session and ONE verified-phone row', async () => {
    const bs = await openSession();
    const out = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => check(i, bs, '482913')));
    expect(out.filter((o) => o.status === 'rejected').map((o: any) => String(o.reason?.message ?? o.reason))).toEqual([]);
    // the invariant: a correct code never ends in a LOCKED session. Duplicates past the 5-attempt budget may answer
    // "too many attempts" if they read the row before the winner committed — never "incorrect", never a lockout.
    const st = out.map((o: any) => o.value.status);
    expect(st.filter((s) => s === 'phone_verified').length).toBeGreaterThanOrEqual(5);
    expect(st.every((s) => s === 'phone_verified' || s === 'too_many_attempts')).toBe(true);
    expect((await q(sql`select status from booking_verification_sessions where booking_session_id = ${bs}`)).map((r) => r.status)).toEqual(['verified']);
    expect(Number((await q(sql`select count(*)::int n from booking_verified_phones where tenant_id = ${T} and phone_hash = ${phoneKey(e164)}`))[0].n)).toBe(1);
  });

  it('8 customers claim the same technician/time at once over a LAPSED hold → exactly one live hold, the rest told it is taken', async () => {
    const start = Date.parse('2027-01-06T15:00:00Z'), end = start + 3600_000;
    await q(sql`insert into booking_holds (tenant_id, branch_id, technician_id, start_time, end_time, expires_at, status, booking_session_id, channel)
      values (${T}, ${B}, ${TECH}, to_timestamp(${start / 1000}), to_timestamp(${end / 1000}), now() - interval '30 seconds', 'held', ${randomUUID()}, 'online')`);
    const holds = dbs.map((d) => new BookingHoldService(new KyselyHoldRepository(d)));
    const out = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => holds[i % 4].acquire({ tenantId: T, branchId: B, technicianId: TECH, startsAt: start, endsAt: end, bookingSessionId: randomUUID(), channel: 'online' })));
    expect(out.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(out.filter((o) => o.status === 'rejected').map((o: any) => /taken|held/i.test(String(o.reason?.message)))).toEqual(Array(7).fill(true));
    const live = await q(sql`select count(*)::int n from booking_holds where tenant_id = ${T} and technician_id = ${TECH} and start_time = to_timestamp(${start / 1000})
      and released_at is null and converted_appointment_id is null`);
    expect(Number(live[0].n)).toBe(1);
  });
});
