// booking-verification.service.vitest.spec.ts
//
// This service is the one that HANDLES A SECRET. So the tests are mostly about what must never happen to it:
//
//   • the plaintext code is never stored, never returned, never logged
//   • Twilio Verify never gives us the code at all — and we must not invent a path where we hold one
//   • a code is bound to the PHONE it was sent to, so changing the number and presenting the code fails
//   • a tenant with no Twilio of their own FAILS CLOSED — it must never quietly send from the platform's account
import { describe, it, expect } from 'vitest';
import { BookingVerificationService, type VerificationStore, type VerificationCtx } from './booking-verification.service';
import type { TenantCredentialResolver, VerificationProvider, TenantTwilioCredentials } from './booking-verification-provider';
import { phoneKey, normalizePhone, OTP_TTL_SECONDS, OTP_MAX_ATTEMPTS } from '@aipowersalon/customers';

const NOW = 1_700_000_000_000;
const PHONE = '+15551234567';
const OTHER = '+15559998888';
const HASH = phoneKey(normalizePhone(PHONE)!);

const CTX: VerificationCtx = { tenantId: 't1', branchId: '22222222-2222-2222-2222-222222222222', channel: 'online', bookingSessionId: 'bs-1', customerId: 'c1' };

const CREDS: TenantTwilioCredentials = { accountSid: 'ACtenant', authToken: 'tok', verifyServiceSid: 'VAtenant', fromNumber: '+15550000000' };

function store() {
  const rows: any = { session: null as any, verifiedPhones: [] as any[], created: [] as any[], sendFailed: [] as string[], locked: 0 };
  const s: VerificationStore = {
    async findSession() { return rows.session; },
    // Phase 4: the session is created BEFORE the provider is called (pending), and marked sent after.
    async createSession(input) { rows.created.push(input); rows.session = { id: 'vs1', ...input, attempts: 0, consumed: false, resendCount: 0, lastSentAt: null, status: 'pending' }; return { id: 'vs1' }; },
    async markSent(_id, at, sid, codeHash) { if (rows.session) { rows.session.lastSentAt = at; rows.session.status = 'sent'; rows.session.providerVerificationSid = sid; if (codeHash !== undefined) rows.session.codeHash = codeHash; } },
    async markSendFailed(_id, reason) { rows.sendFailed.push(reason); },
    async lock() { rows.locked++; if (rows.session) rows.session.status = 'locked'; },
    async reserveAttempt(_id, max) { if (!rows.session || rows.session.attempts >= max || !['pending', 'sent', undefined].includes(rows.session.status)) return null; return ++rows.session.attempts; },
    async refundAttempt() { if (rows.session) rows.session.attempts = Math.max(0, rows.session.attempts - 1); },
    async markVerified() { if (rows.session) rows.session.consumed = true; },
    async markFailed() { /* */ },
    async recordVerifiedPhone(v) { rows.verifiedPhones.push(v); },
  };
  return { s, rows };
}

const resolver = (status: 'configured' | 'not_configured' = 'configured', kind: any = 'twilio_verify'): TenantCredentialResolver => ({
  async resolve() { return status === 'configured' ? { status, credentials: CREDS, kind } : { status: 'not_configured' as const }; },
});

const verifyProvider = (sendOk = true, checkOk = true): VerificationProvider => ({
  kind: 'twilio_verify',
  async send() { return sendOk ? { ok: true, providerVerificationSid: 'VE123' } : { ok: false, reason: 'provider_error', error: 'Twilio says: account ACxxxx is suspended' }; },
  async check() { return checkOk ? { ok: true } : { ok: false, reason: 'incorrect', error: 'That code is incorrect.' }; },
});

describe('a code is sent only FOR a location (Phase 1, Oct 6 2026)', () => {
  it('no branch on the request → refused BEFORE the provider is called (no billed, uncheckable SMS)', async () => {
    const { s, rows } = store();
    let sends = 0;
    const provider: VerificationProvider = { ...verifyProvider(), async send() { sends++; return { ok: true, providerVerificationSid: 'VE1' }; } };
    const svc = new BookingVerificationService(resolver(), { twilio_verify: provider } as any, s);
    for (const branchId of ['', 'b1', undefined as any]) {
      const r = await svc.send({ ...CTX, branchId }, '+14155550123', NOW);
      expect(r.status).toBe('code_send_failed');
    }
    expect(sends).toBe(0);
    expect(rows.created).toHaveLength(0);
  });
});

describe('Twilio Verify — the preferred path, because we never hold the code', () => {
  it('sends and stores NO CODE at all', async () => {
    const { s, rows } = store();
    const svc = new BookingVerificationService(resolver(), { twilio_verify: verifyProvider() }, s);
    const r = await svc.send(CTX, PHONE, NOW);
    expect(r.status).toBe('code_sent');

    // The whole security argument for Verify: a code we never possess cannot be logged, leaked in an APM span,
    // accidentally persisted, or exposed in a stack trace.
    expect(rows.created[0].codeHash).toBeNull();
    expect(JSON.stringify(rows.created[0])).not.toMatch(/\b\d{6}\b/);
    expect(rows.session.providerVerificationSid).toBe('VE123');   // recorded when the send succeeded
    expect(rows.session.codeHash ?? null).toBeNull();
  });

  it('never returns the code to the caller', async () => {
    const { s } = store();
    const svc = new BookingVerificationService(resolver(), { twilio_verify: verifyProvider() }, s);
    const r: any = await svc.send(CTX, PHONE, NOW);
    expect(r.plaintextCode).toBeUndefined();
    expect(JSON.stringify(r)).not.toMatch(/\b\d{6}\b/);
  });

  it('stores a HASH of the phone, and a MASK — never the raw number', async () => {
    const { s, rows } = store();
    const svc = new BookingVerificationService(resolver(), { twilio_verify: verifyProvider() }, s);
    await svc.send(CTX, PHONE, NOW);
    expect(rows.created[0].phoneHash).toBe(HASH);
    expect(JSON.stringify(rows.created[0])).not.toContain(PHONE);
    expect(JSON.stringify(rows.created[0])).not.toContain('5551234');
  });

  it("does not leak Twilio's own error text to the customer", async () => {
    const { s } = store();
    const svc = new BookingVerificationService(resolver(), { twilio_verify: verifyProvider(false) }, s);
    const r = await svc.send(CTX, PHONE, NOW);
    expect(r.status).toBe('code_send_failed');
    expect(r.message).not.toMatch(/AC|twilio|suspended/i);
  });
});

describe('a tenant with no Twilio of their own FAILS CLOSED', () => {
  it('never silently sends from a shared platform account', async () => {
    // The platform's own number resolver falls back to a shared account. Copying that here would bill the
    // platform for the tenant's verification traffic, send the code from a number the customer has never seen
    // from that salon, and make an unconfigured tenant look like a working one.
    const { s, rows } = store();
    const svc = new BookingVerificationService(resolver('not_configured'), { twilio_verify: verifyProvider() }, s);
    const r = await svc.send(CTX, PHONE, NOW);
    expect(r.status).toBe('twilio_not_configured');
    expect(rows.created).toHaveLength(0);          // nothing sent, nothing recorded
  });
});

describe('check() — and the loop it closes', () => {
  async function sent() {
    const { s, rows } = store();
    const svc = new BookingVerificationService(resolver(), { twilio_verify: verifyProvider() }, s);
    await svc.send(CTX, PHONE, NOW);
    return { svc, rows, s };
  }

  it('records the phone as PROVEN on success — the row the policy resolver reads', async () => {
    const { svc, rows } = await sent();
    const r = await svc.check(CTX, PHONE, '123456', NOW + 1000);
    expect(r.status).toBe('phone_verified');

    // This write is the ONLY thing that turns `mustVerify` off for the next booking attempt.
    expect(rows.verifiedPhones).toHaveLength(1);
    expect(rows.verifiedPhones[0]).toMatchObject({ tenantId: 't1', phoneHash: HASH, provider: 'twilio_verify' });
    // Tenant-scoped by construction: the row carries a tenant and the table's unique key is (tenant, phone).
    expect(rows.verifiedPhones[0].tenantId).toBe('t1');
  });

  it('records NOTHING when the code is wrong', async () => {
    const { s, rows } = store();
    const svc = new BookingVerificationService(resolver(), { twilio_verify: verifyProvider(true, false) }, s);
    await svc.send(CTX, PHONE, NOW);
    const r = await svc.check(CTX, PHONE, '000000', NOW + 1000);
    expect(r.status).toBe('incorrect_code');
    expect(rows.verifiedPhones).toHaveLength(0);
  });

  it('CHANGING THE PHONE invalidates the verification', async () => {
    // Otherwise: request a code to your own phone, then present it against somebody else's number. That verifies
    // a number that was never texted — the exact fraud the module exists to stop.
    const { svc, rows } = await sent();
    const r = await svc.check(CTX, OTHER, '123456', NOW + 1000);
    expect(r.status).toBe('code_expired');
    expect(rows.verifiedPhones).toHaveLength(0);
  });

  it('rejects a malformed code WITHOUT calling the provider or spending an attempt', async () => {
    let called = false;
    const { s } = store();
    const prov: VerificationProvider = { kind: 'twilio_verify', async send() { return { ok: true, providerVerificationSid: 'VE1' }; }, async check() { called = true; return { ok: true }; } };
    const svc = new BookingVerificationService(resolver(), { twilio_verify: prov }, s);
    await svc.send(CTX, PHONE, NOW);
    for (const bad of ['', '12', 'abcdef', '1234567']) {
      const r = await svc.check(CTX, PHONE, bad, NOW + 1000);
      expect(r.status).toBe('incorrect_code');
    }
    // It cannot possibly be right, so it must not cost a Twilio call — nor one of the customer's limited attempts.
    expect(called).toBe(false);
  });

  it('an expired session cannot be verified, and reports the SAME text as an unused one', async () => {
    const { s, rows } = store();
    const svc = new BookingVerificationService(resolver(), { twilio_verify: verifyProvider() }, s);
    await svc.send(CTX, PHONE, NOW);
    const r = await svc.check(CTX, PHONE, '123456', NOW + (OTP_TTL_SECONDS + 1) * 1000);
    expect(r.status).toBe('code_expired');
    expect(rows.verifiedPhones).toHaveLength(0);
  });

  it('a consumed code cannot be replayed', async () => {
    const { svc, rows } = await sent();
    expect((await svc.check(CTX, PHONE, '123456', NOW + 1000)).status).toBe('phone_verified');
    const again = await svc.check(CTX, PHONE, '123456', NOW + 2000);
    // Same message as "expired" — telling a caller "that code was already used" confirms a valid code existed.
    expect(again.status).toBe('code_expired');
    expect(rows.verifiedPhones).toHaveLength(1);      // and it did NOT record a second verification
  });

  it('locks out after the attempt limit', async () => {
    const { s } = store();
    const svc = new BookingVerificationService(resolver(), { twilio_verify: verifyProvider(true, false) }, s);
    await svc.send(CTX, PHONE, NOW);
    let last: any;
    for (let i = 0; i <= OTP_MAX_ATTEMPTS; i++) last = await svc.check(CTX, PHONE, '000000', NOW + 1000);
    expect(last.status).toBe('too_many_attempts');
  });
});

describe('resend cooldown', () => {
  it('refuses a resend inside the cooldown — this is what stops SMS pumping', async () => {
    const { s } = store();
    const svc = new BookingVerificationService(resolver(), { twilio_verify: verifyProvider() }, s);
    await svc.send(CTX, PHONE, NOW);
    const r = await svc.send(CTX, PHONE, NOW + 5_000);
    expect(r.status).toBe('rate_limited');
    expect((r as any).retryAfterSeconds).toBeGreaterThan(0);
  });

  it('allows a resend once the cooldown has passed', async () => {
    const { s } = store();
    const svc = new BookingVerificationService(resolver(), { twilio_verify: verifyProvider() }, s);
    await svc.send(CTX, PHONE, NOW);
    const r = await svc.send(CTX, PHONE, NOW + 120_000);
    expect(r.status).toBe('code_sent');
  });
});

describe('invalid input', () => {
  it('refuses an unparseable number rather than sending to it', async () => {
    const { s } = store();
    const svc = new BookingVerificationService(resolver(), { twilio_verify: verifyProvider() }, s);
    for (const bad of ['', 'abc', '123', 'not-a-phone']) {
      expect((await svc.send(CTX, bad, NOW)).status).toBe('invalid_phone_number');
    }
  });
});

describe('the send response is enumeration-safe', () => {
  it('does not reveal whether the number is already a customer', async () => {
    const { s } = store();
    const svc = new BookingVerificationService(resolver(), { twilio_verify: verifyProvider() }, s);
    const r: any = await svc.send(CTX, PHONE, NOW);
    expect(r.message).toMatch(/if this phone number is eligible/i);   // the platform's existing generic response
  });
});

describe('Sep 2026 merge — no master code, no fake send', () => {
  it("'123456' is NOT a universal code: when Twilio says the code is wrong, it is wrong", async () => {
    const { s, rows } = store();
    const svc = new BookingVerificationService(resolver(), { twilio_verify: verifyProvider(true, false) }, s);
    await svc.send(CTX, PHONE, NOW);
    const r = await svc.check(CTX, PHONE, '123456', NOW + 1000);   // the developer's master code
    expect(r.status).toBe('incorrect_code');
    expect(rows.verifiedPhones).toHaveLength(0);
  });
  it("a failed Twilio send is reported as failed, never 'sent'", async () => {
    const { s, rows } = store();
    const svc = new BookingVerificationService(resolver(), { twilio_verify: verifyProvider(false) }, s);
    const r = await svc.send(CTX, PHONE, NOW);
    expect(r.status).toBe('code_send_failed');
    // Phase 4 (audit bug 11): the session existed before the provider was called — and it is NOT 'sent'.
    expect(rows.session.status).toBe('pending');
    expect(rows.sendFailed).toEqual(['provider_error']);
  });
});
