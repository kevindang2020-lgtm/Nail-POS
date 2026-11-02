// booking-verification-webhook-dedupe.pgtest — BUILD_PLAN Phase 14 (Constitution 12 "webhook dedupe verified per
// provider") on the real migrated schema: Twilio's booking-verification status callback
// (POST /webhooks/twilio/booking-verification/status). The same signed callback delivered twice — in sequence and racing —
// enqueues ONE job (the (type, idempotency key) unique on the queue), and the job run twice (the queue is at-least-once)
// fails the session once: one booking.phone_verification_failed event. A forged signature enqueues nothing.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor, testProviderSecrets } from '@aipowersalon/testing';
import { computeTwilioSignature } from '@aipowersalon/notifications';
import { BookingVerificationWebhookController, applyVerificationStatus } from './booking-verification-webhook.controller';

const T = 'e2400000-0000-4000-8000-00000000000a', B = 'e2410000-0000-4000-8000-00000000000a';
const TOKEN = 'p14-booking-twilio-fixture';   // test fixture, not a credential
const PATH = '/webhooks/twilio/booking-verification/status';
const URL = `https://api.example.test${PATH}`;
const req = { headers: { host: 'api.example.test', 'x-forwarded-proto': 'https' }, originalUrl: PATH, ip: '203.0.113.9' };
let pg: any; let db: any; let ctl: BookingVerificationWebhookController;
const count = async (q: string, p: unknown[] = []) => Number((await pg.query(q, p)).rows[0].c);

async function session(sid: string): Promise<string> {
  return (await pg.query(`INSERT INTO booking_verification_sessions (tenant_id, branch_id, booking_session_id, phone_hash, phone_mask, channel, provider, status, expires_at, provider_verification_sid)
    VALUES ($1, $2, gen_random_uuid(), 'h', '***0140', 'online', 'twilio_verify', 'sent', now() + interval '10 minutes', $3) RETURNING id`, [T, B, sid])).rows[0].id;
}

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'BV', 'BV', 'bv-p14', 'BVP14', 'active');
    INSERT INTO branches (id, tenant_id, name) VALUES ('${B}', '${T}', 'Main');`);
  await pg.query(`INSERT INTO tenant_messaging_credentials (tenant_id, provider, auth_token_enc, status) VALUES ($1, 'twilio', $2, 'configured')`, [T, testProviderSecrets.encrypt(TOKEN)]);
  ctl = new BookingVerificationWebhookController(db, testProviderSecrets);
}, 120_000);

describe('booking-verification status callback: a retried "failed" is applied once', () => {
  it('delivered twice in sequence + twice concurrently → one queued job; the job run twice → one failure event', async () => {
    const SID = 'VEp14dedupe000001';
    const sessionId = await session(SID);
    const body = { VerificationSid: SID, VerificationStatus: 'failed', ErrorCode: '60202' };
    const sig = computeTwilioSignature(TOKEN, URL, body);
    await ctl.status(req, body, sig);
    await ctl.status(req, body, sig);
    await Promise.all([ctl.status(req, body, sig), ctl.status(req, body, sig)]);
    const jobs = (await pg.query(`SELECT payload FROM jobs WHERE job_type = 'booking_verification.webhook' AND tenant_id = $1`, [T])).rows;
    expect(jobs.length).toBe(1);
    // the queue delivers at least once: run the job twice
    const p = typeof jobs[0].payload === 'string' ? JSON.parse(jobs[0].payload) : jobs[0].payload;
    await applyVerificationStatus(db, p); await applyVerificationStatus(db, p);
    expect((await pg.query(`SELECT status FROM booking_verification_sessions WHERE id = $1`, [sessionId])).rows[0].status).toBe('failed');
    expect(await count(`SELECT count(*)::int c FROM outbox_events WHERE event_type = 'booking.phone_verification_failed' AND tenant_id = $1`, [T])).toBe(1);
  });

  it('a "delivered" callback twice stamps delivered_at once (the first time is kept)', async () => {
    const SID = 'SMp14dedupe000002';
    const sessionId = await session(SID);
    const job = { tenantId: T, sessionId, sid: SID, status: 'delivered' };
    await applyVerificationStatus(db, job);
    const first = (await pg.query(`SELECT delivered_at FROM booking_verification_sessions WHERE id = $1`, [sessionId])).rows[0].delivered_at;
    await pg.query(`SELECT pg_sleep(0.01)`);
    await applyVerificationStatus(db, job);
    expect((await pg.query(`SELECT delivered_at FROM booking_verification_sessions WHERE id = $1`, [sessionId])).rows[0].delivered_at).toEqual(first);
  });

  it('a forged signature enqueues nothing and moves nothing', async () => {
    const SID = 'VEp14dedupe000003';
    const sessionId = await session(SID);
    const body = { VerificationSid: SID, VerificationStatus: 'failed' };
    await ctl.status(req, body, computeTwilioSignature('not-the-token', URL, body));
    expect(await count(`SELECT count(*)::int c FROM jobs WHERE job_type = 'booking_verification.webhook' AND payload->>'sid' = $1`, [SID])).toBe(0);
    expect((await pg.query(`SELECT status FROM booking_verification_sessions WHERE id = $1`, [sessionId])).rows[0].status).toBe('sent');
  });
});
