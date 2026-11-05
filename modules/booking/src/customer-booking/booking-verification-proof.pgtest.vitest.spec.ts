// booking-verification-proof.pgtest — BUILD_PLAN Phase 4 on the real schema: the verification lifecycle and the proof.
//   • a held, pending verification is opened by the refusal; the send moves it to 'sent'; the check to 'verified'
//   • a proof is claimed by ONE booking (atomically) and labels the appointment; a failed booking gives it back
//   • running out of attempts LOCKS the session and gives the slot back; so does the expiry sweep
//   • every step is a booking.phone_* fact on the outbox — with a masked number, never a number or a code
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
// Phase 9: the override is decided by the session's permissions, so contexts carry the role's real grants
import { permissionsFor } from '@aipowersalon/permissions';
import { phoneKey, maskPhone } from '@aipowersalon/customers';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyVerificationStore, KyselyBookingVerificationConfig } from './booking-verification.kysely';
import { KyselyHoldRepository, BookingHoldService } from './booking-hold.kysely';
import { BookingVerificationService } from './booking-verification.service';
import { KyselyOverrideStore } from './booking-verification-override.kysely';
import { BookingVerificationOverrideService } from './booking-verification-override.service';
import type { TenantCredentialResolver, VerificationProvider } from './booking-verification-provider';

const T = 'aaaa0000-1111-4111-8111-111111111111';
const B = 'bbbb0000-2222-4222-8222-222222222222';
const TECH = 'cccc0000-3333-4333-8333-333333333333';
const PHONE = '+18565550142';
let db: any; let store: KyselyVerificationStore; let holds: BookingHoldService; let holdRepo: KyselyHoldRepository;

const verify: VerificationProvider = {
  kind: 'twilio_verify',
  async send() { return { ok: true, providerVerificationSid: 'VE' + randomUUID().replace(/-/g, '').slice(0, 32) }; },
  async check(_c, _to, code) { return code === '424242' ? { ok: true } : { ok: false, reason: 'incorrect' }; },
};
const creds: TenantCredentialResolver = { async resolve() { return { status: 'configured', kind: 'twilio_verify', credentials: { accountSid: 'AC1', authToken: 't', verifyServiceSid: 'VA1' } }; } };
const svc = () => new BookingVerificationService(creds, { twilio_verify: verify }, store);
const ctx = (bookingSessionId: string) => ({ tenantId: T, branchId: B, channel: 'online' as const, bookingSessionId, customerId: null, deviceId: 'dev-1', requestIp: '10.0.0.9' });

async function opened(slotHour = 10) {
  const sid = randomUUID();
  const start = Date.UTC(2026, 9, 20, slotHour, 0);
  const h = await holds.acquire({ tenantId: T, branchId: B, technicianId: TECH, startsAt: start, endsAt: start + 3_600_000, bookingSessionId: sid, channel: 'online', holdSeconds: 600 });
  await store.openPending({ tenantId: T, branchId: B, bookingSessionId: sid, customerId: null, channel: 'online', phoneHash: phoneKey(PHONE), phoneMask: maskPhone(PHONE), holdId: h.holdId, expiresAt: h.expiresAt, deviceId: 'dev-1' });
  return { sid, holdId: h.holdId };
}
const sessionOf = async (sid: string) => (await sql`select * from booking_verification_sessions where booking_session_id = ${sid}`.execute(db)).rows[0] as any;
const holdOf = async (id: string) => (await sql`select * from booking_holds where id = ${id}`.execute(db)).rows[0] as any;
const events = async (sessionId: string) => (await sql`select event_type, payload_json::text as p from outbox_events where aggregate_id = ${sessionId} order by occurred_at, event_type`.execute(db)).rows as any[];

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values (${T}, 'Proof LLC', 'Proof', 'proof-salon', 'PRF001')`.execute(db);
  await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active')`.execute(db);
  await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) values (${TECH}, ${T}, ${B}, 'Pia', 'Proof', 'Pia Proof', 'active')`.execute(db);
  store = new KyselyVerificationStore(db, new OutboxWriter());
  holdRepo = new KyselyHoldRepository(db);
  holds = new BookingHoldService(holdRepo);
}, 180_000);

describe('the lifecycle', () => {
  it('pending (held) → sent → verified, each a booking.phone_* fact with only a masked number', async () => {
    const { sid } = await opened(9);
    expect((await sessionOf(sid)).status).toBe('pending');
    expect((await svc().send(ctx(sid), PHONE)).status).toBe('code_sent');
    const s1 = await sessionOf(sid);
    expect(s1.status).toBe('sent');
    expect(s1.provider_verification_sid).toMatch(/^VE/);
    expect((await svc().check(ctx(sid), PHONE, '424242')).status).toBe('phone_verified');
    expect((await sessionOf(sid)).status).toBe('verified');
    const ev = await events(s1.id);
    expect(ev.map((e) => e.event_type)).toEqual(expect.arrayContaining(['booking.phone_verification_requested', 'booking.phone_verification_sent', 'booking.phone_verified']));
    for (const e of ev) { expect(e.p).not.toContain('8565550142'); expect(e.p).not.toContain('424242'); }
  });
  it('the send happens AFTER the session exists — a refused send leaves the session open, not "sent"', async () => {
    const { sid } = await opened(8);
    const failing: VerificationProvider = { ...verify, async send() { return { ok: false, reason: 'provider_error' }; } };
    const out = await new BookingVerificationService(creds, { twilio_verify: failing }, store).send(ctx(sid), PHONE);
    expect(out.status).toBe('code_send_failed');
    const s = await sessionOf(sid);
    expect(s.status).toBe('pending');
    expect(s.failure_reason).toBe('provider_error');
  });
});

describe('the proof', () => {
  it('is claimed by ONE booking — concurrently, only one wins; it labels the appointment it produced', async () => {
    const { sid } = await opened(11);
    await svc().send(ctx(sid), PHONE);
    await svc().check(ctx(sid), PHONE, '424242');
    const claims = await Promise.all([1, 2, 3].map(() => store.claimProof(T, sid, phoneKey(PHONE), 30 * 60_000)));
    expect(claims.filter(Boolean)).toHaveLength(1);
    const appt = randomUUID();
    await sql`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_name, appt_date, start_time, end_time, status) values (${appt}, ${T}, ${B}, ${TECH}, 'Proof', '2026-10-20', '11:00', '12:00', 'booked')`.execute(db);
    await store.attachProof(T, claims.find(Boolean)!.sessionId, appt, 'verified');
    expect(await sql`select phone_verification, phone_verification_session_id from pos_tech_appointments where id = ${appt}`.execute(db).then((r: any) => r.rows[0])).toMatchObject({ phone_verification: 'verified', phone_verification_session_id: claims.find(Boolean)!.sessionId });
    expect((await sessionOf(sid)).consumed_appointment_id).toBe(appt);
    await store.releaseProof(claims.find(Boolean)!.sessionId);   // an attached proof is never handed back
    expect(await store.claimProof(T, sid, phoneKey(PHONE), 30 * 60_000)).toBeNull();
  });
  it('another number, or an unproven session, claims nothing; a released claim can be claimed again', async () => {
    const { sid } = await opened(12);
    expect(await store.claimProof(T, sid, phoneKey(PHONE), 30 * 60_000)).toBeNull();              // not verified yet
    await svc().send(ctx(sid), PHONE);
    await svc().check(ctx(sid), PHONE, '424242');
    expect(await store.claimProof(T, sid, phoneKey('+18565550199'), 30 * 60_000)).toBeNull();     // another number
    const c = await store.claimProof(T, sid, phoneKey(PHONE), 30 * 60_000);
    await store.releaseProof(c!.sessionId);                                                        // the booking failed
    expect(await store.claimProof(T, sid, phoneKey(PHONE), 30 * 60_000)).not.toBeNull();
  });
  it('a proof older than its window claims nothing', async () => {
    const { sid } = await opened(13);
    await svc().send(ctx(sid), PHONE);
    await svc().check(ctx(sid), PHONE, '424242');
    await sql`update booking_verification_sessions set verified_at = now() - interval '2 hours' where booking_session_id = ${sid}`.execute(db);
    expect(await store.claimProof(T, sid, phoneKey(PHONE), 30 * 60_000)).toBeNull();
  });
  it('device-bound trust: the SMS proof from this device is found; from another device it is not', async () => {
    const cfg = new KyselyBookingVerificationConfig(db, creds);
    expect(await cfg.lastVerifiedOnDevice(T, phoneKey(PHONE), 'dev-1')).not.toBeNull();
    expect(await cfg.lastVerifiedOnDevice(T, phoneKey(PHONE), 'dev-2')).toBeNull();
  });
});

describe('the slot is given back', () => {
  it('when the attempts run out the session is LOCKED and its hold released', async () => {
    const { sid, holdId } = await opened(14);
    await svc().send(ctx(sid), PHONE);
    const outs = [];
    for (let i = 0; i < 5; i++) outs.push((await svc().check(ctx(sid), PHONE, '000000')).status);
    expect(outs.at(-1)).toBe('too_many_attempts');
    expect((await sessionOf(sid)).status).toBe('locked');
    expect((await holdOf(holdId)).released_at).not.toBeNull();
    expect((await svc().check(ctx(sid), PHONE, '424242')).status).toBe('too_many_attempts');   // locked stays locked
    expect((await svc().send(ctx(sid), PHONE)).status).toBe('too_many_attempts');
  });
  it('the expiry sweep closes an unproven session past its deadline and releases its hold', async () => {
    const { sid, holdId } = await opened(15);
    await sql`update booking_verification_sessions set expires_at = now() - interval '1 minute' where booking_session_id = ${sid}`.execute(db);
    expect(await store.expireStale()).toBeGreaterThanOrEqual(1);
    const s = await sessionOf(sid);
    expect(s.status).toBe('expired');
    expect((await holdOf(holdId)).released_at).not.toBeNull();
    expect((await events(s.id)).map((e) => e.event_type)).toContain('booking.phone_verification_expired');
  });
});

describe('the internal fallback (no Verify Service)', () => {
  it('texts a code from the salon’s own number, keeps only its HASH, and the right code verifies', async () => {
    const texts: { to: string; body: string; from: string }[] = [];
    const internalCreds: TenantCredentialResolver = { async resolve() { return { status: 'configured', kind: 'internal_otp', credentials: { accountSid: 'AC1', authToken: 't', fromNumber: '+18565550000' } }; } };
    const s = new BookingVerificationService(internalCreds, { twilio_verify: verify }, store, async (c, to, body) => { texts.push({ to, body, from: String(c.fromNumber) }); return { sid: 'SM1' }; });
    const { sid } = await opened(16);
    expect((await s.send({ ...ctx(sid), deviceId: 'dev-internal', requestIp: '10.0.0.10' }, PHONE)).status).toBe('code_sent');
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatchObject({ to: PHONE, from: '+18565550000' });
    const code = /\b(\d{6})\b/.exec(texts[0].body)![1];
    const row = await sessionOf(sid);
    expect(row.code_hash).toBeTruthy();
    expect(row.code_hash).not.toContain(code);
    expect((await s.check(ctx(sid), PHONE, code === '111111' ? '222222' : '111111')).status).toBe('incorrect_code');
    expect((await s.check(ctx(sid), PHONE, code)).status).toBe('phone_verified');
  });
});

describe('the hard caps (per device, per IP, across every salon)', () => {
  it('a device that has had 5 codes this hour gets no 6th; another device on another network still does', async () => {
    const dev = { deviceId: 'dev-cap', requestIp: '10.9.9.' + Math.floor(Math.random() * 200) };
    const outs: string[] = [];
    for (let i = 0; i < 6; i++) { const { sid } = await opened(i); outs.push((await svc().send({ ...ctx(sid), ...dev }, PHONE)).status); }
    expect(outs.slice(0, 5)).toEqual(['code_sent', 'code_sent', 'code_sent', 'code_sent', 'code_sent']);
    expect(outs[5]).toBe('rate_limited');
    const { sid } = await opened(23);
    expect((await svc().send({ ...ctx(sid), deviceId: 'dev-other', requestIp: '10.8.8.8' }, PHONE)).status).toBe('code_sent');
  });
});

describe('the manager override (real store)', () => {
  const M = 'dddd0000-4444-4444-8444-444444444444';
  it('marks ONE waiting verification (explicit columns, an event), the retry claims it as staff_override, and NO phone trust is written', async () => {
    const { sid } = await opened(17);
    const row = await sessionOf(sid);
    const { AuditService, KyselyAuditRepository, auditSinkFor } = await import('@aipowersalon/audit');
    const ov = new BookingVerificationOverrideService(new KyselyOverrideStore(db, new OutboxWriter()), auditSinkFor(new AuditService(new KyselyAuditRepository(db))));
    const pending = await ov.pending({ tenantId: T, branchId: B, userId: M, role: 'MANAGER', permissions: permissionsFor('MANAGER' as any) });
    expect(pending.find((p) => p.id === row.id)).toMatchObject({ maskedPhone: maskPhone(PHONE), status: 'pending', technicianId: TECH });
    expect(JSON.stringify(pending)).not.toContain('8565550142');
    await ov.authorize({ tenantId: T, branchId: B, userId: M, role: 'MANAGER', permissions: permissionsFor('MANAGER' as any) }, { verificationId: row.id, reason: 'Customer is at the front desk with ID', contactMethod: 'in_person' });
    const after = await sessionOf(sid);
    expect(after).toMatchObject({ status: 'verified', override_reason: 'Customer is at the front desk with ID', override_contact_method: 'in_person', override_by_user_id: M, failure_reason: null });
    expect(after.verified_at).toBeNull();
    // audit bug 4: the record is really written (the production sink over the real store), with the reason, never a number
    const aud = (await sql`select metadata::text as m from audit_events where tenant_id = ${T} and action = 'verification_manually_bypassed' order by created_at desc limit 1`.execute(db)).rows[0] as any;
    expect(aud?.m).toContain('Customer is at the front desk with ID');
    expect(aud?.m).not.toContain('8565550142');
    expect((await events(row.id)).map((e) => e.event_type)).toContain('booking.phone_verification_overridden');
    const claim = await store.claimProof(T, sid, phoneKey(PHONE), 30 * 60_000);
    expect(claim).toMatchObject({ sessionId: row.id, method: 'staff_override' });
    const vp = (await sql`select count(*)::int as n from booking_verified_phones where tenant_id = ${T} and phone_hash = ${phoneKey(PHONE)} and verified_at > now() - interval '1 minute' and channel = 'staff_override'`.execute(db)).rows[0] as any;
    expect(vp.n).toBe(0);
    // overriding it again, or an already-consumed one → not found
    await expect(ov.authorize({ tenantId: T, branchId: B, userId: M, role: 'MANAGER', permissions: permissionsFor('MANAGER' as any) }, { verificationId: row.id, reason: 'Customer is at the front desk with ID', contactMethod: 'in_person' })).rejects.toMatchObject({ code: 'not_found' });
  });
  it('another branch manager cannot override it; the platform bypass switch forbids it', async () => {
    const { sid } = await opened(18);
    const row = await sessionOf(sid);
    const ov = new BookingVerificationOverrideService(new KyselyOverrideStore(db, new OutboxWriter()));
    await expect(ov.authorize({ tenantId: T, branchId: 'eeee0000-5555-4555-8555-555555555555', userId: M, role: 'MANAGER', permissions: permissionsFor('MANAGER' as any) }, { verificationId: row.id, reason: 'Customer is at the front desk with ID', contactMethod: 'in_person' })).rejects.toMatchObject({ code: 'not_found' });
    await sql`insert into booking_verification_platform_policy (tenant_id, bypass_blocked) values (${T}, true) on conflict (tenant_id) where tenant_id is not null do update set bypass_blocked = true`.execute(db);
    await expect(ov.authorize({ tenantId: T, branchId: B, userId: M, role: 'OWNER', permissions: permissionsFor('OWNER' as any) }, { verificationId: row.id, reason: 'Customer is at the front desk with ID', contactMethod: 'in_person' })).rejects.toThrow(/platform policy/);
    await sql`update booking_verification_platform_policy set bypass_blocked = false where tenant_id = ${T}`.execute(db);
    expect((await sessionOf(sid)).status).toBe('pending');
    // a verification that is no longer waiting (expired) cannot be approved — the slot it held is gone
    await sql`update booking_verification_sessions set status = 'expired' where id = ${row.id}`.execute(db);
    await expect(ov.authorize({ tenantId: T, branchId: B, userId: M, role: 'OWNER', permissions: permissionsFor('OWNER' as any) }, { verificationId: row.id, reason: 'Customer is at the front desk with ID', contactMethod: 'in_person' })).rejects.toMatchObject({ code: 'not_found' });
  });
});


describe('Twilio status callbacks (signed → the job queue, once per SID + status)', () => {
  it('a delivered callback stamps delivered_at; a retry enqueues nothing new; a failure fails a WAITING session and frees its slot — never a proven one', async () => {
    const { BookingVerificationWebhookController, applyVerificationStatus } = await import('./booking-verification-webhook.controller');
    const { computeTwilioSignature } = await import('@aipowersalon/notifications');
    const TOKEN = 'tenant-auth-token-xyz';
    await sql`insert into tenant_messaging_credentials (tenant_id, provider, account_sid, auth_token_enc, auth_token_last4, verify_service_sid, status) values (${T}, 'twilio', 'AC0123456789abcdef0123456789abcdef', ${'enc:' + TOKEN}, 'xyz0', 'VA0123456789abcdef0123456789abcdef', 'configured') on conflict do nothing`.execute(db);
    const ctrl = new BookingVerificationWebhookController(db, { decrypt: (v: string) => v.replace(/^enc:/, '') } as any);
    const post = async (sid: string, status: string, signWith = TOKEN) => {
      const params = { VerificationSid: sid, VerificationStatus: status };
      const req = { headers: { host: 'api.test', 'x-forwarded-proto': 'https' }, originalUrl: '/webhooks/twilio/booking-verification/status' };
      await ctrl.status(req, params, computeTwilioSignature(signWith, 'https://api.test/webhooks/twilio/booking-verification/status', params));
    };
    const jobs = async (sid: string) => (await sql`select job_type, idempotency_key, payload::text as p from jobs where idempotency_key like ${sid + ':%'}`.execute(db)).rows as any[];

    const a = await opened(6);
    await svc().send({ ...ctx(a.sid), deviceId: 'dev-wh', requestIp: '10.7.7.7' }, PHONE);
    const sidA = (await sessionOf(a.sid)).provider_verification_sid;
    await post(sidA, 'delivered'); await post(sidA, 'delivered');
    await post(sidA, 'failed', 'someone-elses-token');                      // forged → nothing
    const ja = await jobs(sidA);
    expect(ja).toHaveLength(1);
    expect(ja[0]).toMatchObject({ job_type: 'booking_verification.webhook', idempotency_key: `${sidA}:delivered` });
    expect(ja[0].p).not.toContain('8565550142');
    await applyVerificationStatus(db, JSON.parse(ja[0].p));
    expect((await sessionOf(a.sid))).toMatchObject({ status: 'sent' });
    expect((await sessionOf(a.sid)).delivered_at).not.toBeNull();

    await post(sidA, 'undelivered');
    const fail = (await jobs(sidA)).find((j) => j.idempotency_key.endsWith(':undelivered'));
    await applyVerificationStatus(db, JSON.parse(fail.p));
    expect((await sessionOf(a.sid)).status).toBe('failed');
    expect((await holdOf(a.holdId)).released_at).not.toBeNull();

    const b = await opened(7);
    await svc().send({ ...ctx(b.sid), deviceId: 'dev-wh2', requestIp: '10.7.7.8' }, PHONE);
    await svc().check(ctx(b.sid), PHONE, '424242');
    const rowB = await sessionOf(b.sid);
    await applyVerificationStatus(db, { tenantId: T, sessionId: rowB.id, sid: rowB.provider_verification_sid, status: 'undelivered' });
    expect((await sessionOf(b.sid)).status).toBe('verified');                // a late failure never undoes a proof
    await sql`delete from tenant_messaging_credentials where tenant_id = ${T}`.execute(db);
  });
});

describe('the usage panel (counts and recent failures, masked numbers only)', () => {
  it('reflects what happened above: requested, sent, verified, overridden, locked, expired, failed — and never a full number', async () => {
    const { bookingVerificationUsage } = await import('./booking-verification-usage');
    const u = await bookingVerificationUsage(db, T, null, 30);
    expect(u.totals.requested).toBeGreaterThan(5);
    expect(u.totals.codesSent).toBeGreaterThan(3);
    for (const k of ['verified', 'overridden', 'locked', 'expired', 'failed', 'delivered'] as const) expect(u.totals[k], k).toBeGreaterThan(0);
    expect(u.verifyRate).toBeGreaterThan(0);
    expect(u.byChannel.find((c) => c.channel === 'online')).toBeTruthy();
    expect(u.recentFailures.some((f) => f.status === 'locked')).toBe(true);
    expect(JSON.stringify(u)).not.toContain('8565550142');
    expect((await bookingVerificationUsage(db, T, 'eeee0000-5555-4555-8555-555555555555', 30)).totals.requested).toBe(0);
  });
});

describe('owner alerts (once per kind per window, masked numbers only)', () => {
  const alerts = async (kind: string) => (await sql`select severity, audience, title, body from owner_alerts where tenant_id = ${T} and category = 'booking_verification' and metadata->>'kind' like ${kind}`.execute(db)).rows as any[];
  it('every override tells the owner; the lock spike above (2 locked sessions) is not yet a pattern', async () => {
    const ov = await alerts('override:%');
    expect(ov.length).toBeGreaterThanOrEqual(1);
    expect(ov[0]).toMatchObject({ severity: 'info', audience: 'owner', title: 'A booking was approved without a phone code' });
    expect(ov[0].body).toContain(maskPhone(PHONE));
    expect(ov[0].body).not.toContain('8565550142');
  });
  it('three locks in an hour → ONE warning; three send failures → ONE high alert to the owner', async () => {
    const failing: VerificationProvider = { ...verify, async send() { return { ok: false, reason: 'provider_error' }; } };
    const bad = new BookingVerificationService(creds, { twilio_verify: failing }, store);
    for (const h of [1, 2, 3, 4]) {
      const { sid } = await opened(24 + h);   // tomorrow's hours: no clash with the slots above
      await bad.send({ ...ctx(sid), deviceId: 'dev-sf' + h, requestIp: '10.6.6.' + h }, PHONE);
    }
    const pf = await alerts('provider_failures');
    expect(pf).toHaveLength(1);
    expect(pf[0]).toMatchObject({ severity: 'high', audience: 'owner' });
    for (const h of [5, 6, 7]) {
      const { sid } = await opened(24 + h);
      await svc().send({ ...ctx(sid), deviceId: 'dev-lk' + h, requestIp: '10.5.5.' + h }, PHONE);
      for (let i = 0; i < 5; i++) await svc().check(ctx(sid), PHONE, '000000');
    }
    const ls = await alerts('lock_spike');
    expect(ls).toHaveLength(1);
    expect(ls[0].severity).toBe('warning');
  });
});

describe('Super Admin oversight (real store)', () => {
  it('module off → the salon cannot enable; a tenant row change that does not mention the override switch keeps it', async () => {
    const { BookingVerificationOversightService } = await import('./booking-verification-oversight.service');
    const { KyselyVerificationSettingsStore } = await import('./booking-verification-settings.kysely');
    const over = new BookingVerificationOversightService(db);
    await expect(over.setModuleEnabled(undefined, false, 'short')).rejects.toMatchObject({ code: 'invalid' });
    expect((await over.setModuleEnabled(undefined, false, 'Twilio incident INC-42')).moduleEnabled).toBe(false);
    expect((await new KyselyVerificationSettingsStore(db).platformPolicy(T)).moduleEnabled).toBe(false);
    await over.setModuleEnabled(undefined, true, 'Incident INC-42 resolved');
    await over.setTenantPolicy(undefined, T, { required: false, blocked: false, bypassBlocked: true, reason: 'Staff targeted by callers' });
    await over.setTenantPolicy(undefined, T, { required: true, blocked: false, reason: 'Fake bookings arriving here' });
    const row = (await over.tenants(500)).find((t) => t.tenantId === T)!;
    expect(row).toMatchObject({ requiredByPlatform: true, bypassBlocked: true });
    await over.setTenantPolicy(undefined, T, { required: false, blocked: false, bypassBlocked: false, reason: '' });
    const h = await over.health(24);
    expect(h.requested).toBeGreaterThan(0);
    expect(h.overridden).toBeGreaterThan(0);
    expect(h.locked).toBeGreaterThan(0);
  });
});

describe('the row explains itself (audit: versions and last booking never written)', () => {
  it('a verification records the policy and configuration versions that asked for it; a proven booking stamps the number’s last booking', async () => {
    const sid = randomUUID();
    await store.openPending({ tenantId: T, branchId: B, bookingSessionId: sid, customerId: null, channel: 'customer_app', phoneHash: phoneKey(PHONE), phoneMask: maskPhone(PHONE), holdId: null, expiresAt: Date.now() + 600_000,
      versions: { policy: 'bpv-1', platform: 3, tenant: 7, branch: 2, provider: null } });
    expect(await sessionOf(sid)).toMatchObject({ policy_version: 'bpv-1', tenant_config_version: 7, branch_config_version: 2, provider_config_version: null });
    await svc().send({ ...ctx(sid), channel: 'customer_app' as any, deviceId: 'dev-v', requestIp: '10.4.4.4' }, PHONE);
    await svc().check({ ...ctx(sid), channel: 'customer_app' as any }, PHONE, '424242');
    const c = await store.claimProof(T, sid, phoneKey(PHONE), 30 * 60_000);
    const appt = randomUUID();
    await sql`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_name, appt_date, start_time, end_time, status) values (${appt}, ${T}, ${B}, ${TECH}, 'Proof', '2026-10-21', '11:00', '12:00', 'booked')`.execute(db);
    await store.attachProof(T, c!.sessionId, appt, 'verified');
    const vp = (await sql`select last_booking_at from booking_verified_phones where tenant_id = ${T} and phone_hash = ${phoneKey(PHONE)}`.execute(db)).rows[0] as any;
    expect(vp?.last_booking_at).toBeTruthy();
  });
});
