// review-request-sender.pgtest — G8 (Nov 6 2026; migration 823) on the REAL schema: the job that finally SENDS the
// post-visit review requests checkout schedules. Fake messenger (records what would reach Twilio / SendGrid).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ReviewRequestService } from './ai-review-reputation-requests.service';
import { KyselyRequestStore, KyselyConsent, KyselyReviewRequestProfile } from './ai-review-reputation.kysely';
import { MessengerDispatchAdapter, googleReviewLink, type ReviewMessenger } from './ai-review-reputation.integrations';
import { ReviewRequestSenderJob, type ReviewSenderAccess } from './ai-review-reputation-sender.job';
import { inQuietHours } from './ai-review-reputation-requests';

const P = 'c8230000-0000-4000-8000-';
const id = (n: number) => P + String(n).padStart(12, '0');
const T = id(1), B = id(2), T2 = id(3), B2 = id(4), B3 = id(5);
const EN = id(10), VI = id(11), OUT = id(12), NOPHONE = id(13), OTHER = id(14), EM = id(15);
let db: any;
const q = async (s: any) => (await s.execute(db)).rows as any[];
const NOON = new Date('2026-11-06T17:00:00Z');          // 12:00 in New York (EST)
const LATE = new Date('2026-11-07T03:00:00Z');          // 22:00 in New York — quiet hours 21–9
const H = 3_600_000;

let sent: any[] = [];
let mode: 'ok' | 'blocked' = 'ok';
const messenger: ReviewMessenger = {
  async sendSms(req) { if (mode === 'blocked') return { sent: false, status: 'blocked', reason: 'opted_out' }; sent.push({ kind: 'sms', ...req }); return { sent: true, status: 'sent', notificationId: 'n' + sent.length }; },
  async sendEmail(req) { sent.push({ kind: 'email', ...req }); return { sent: true, status: 'sent', notificationId: 'e' + sent.length }; },
};
let access: { allowed: boolean; enforce: boolean } = { allowed: true, enforce: false };
const accessFn: ReviewSenderAccess = async () => ({ ...access, reason: access.allowed ? 'ok' : 'not_subscribed' });
let job: ReviewRequestSenderJob;

async function setPolicy(tenant: string, rr: Record<string, unknown> | null, enabled: boolean | null = true) {
  await q(sql`delete from tenant_ai_reputation_settings where tenant_id = ${tenant}`);
  await q(sql`insert into tenant_ai_reputation_settings (tenant_id, level, enabled, config) values (${tenant}, 'tenant', ${enabled}, ${JSON.stringify(rr ? { reviewRequest: rr } : {})}::jsonb)`);
}
async function req(customer: string, scheduledFor: Date, o: { tenant?: string; branch?: string | null; channel?: string; status?: string; sentAt?: Date } = {}) {
  const r = await q(sql`insert into review_requests (tenant_id, branch_id, customer_id, channel, status, idempotency_key, scheduled_for, sent_at)
    values (${o.tenant ?? T}, ${o.branch === undefined ? B : o.branch}, ${customer}, ${o.channel ?? 'sms'}, ${o.status ?? 'scheduled'}, ${'k' + Math.random()}, ${scheduledFor}, ${o.sentAt ?? null}) returning id`);
  return String(r[0].id);
}
const status = async (rid: string) => (await q(sql`select status, sent_at, reminder_sent_at from review_requests where id = ${rid}`))[0];
const events = async (rid: string) => (await q(sql`select event from review_request_events where request_id = ${rid} order by created_at`)).map((r) => r.event);

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Lux LLC', 'Lux Nails', 'g8-823', 'G8823', 'active'), (${T2}, 'O', 'Other Salon', 'g8-823b', 'G8823B', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name, timezone, google_place_id) values (${B}, ${T}, 'Main', 'America/New_York', 'PLACE-MAIN'), (${B3}, ${T}, 'Annex', 'America/New_York', null), (${B2}, ${T2}, 'Other', 'America/New_York', 'PLACE-OTHER')`);
  const cust = (cid: string, t: string, b: string, phone: string | null, extra: { lang?: string; optIn?: boolean; email?: string } = {}) =>
    q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, preferred_language, marketing_sms_opt_in, marketing_email_opt_in)
      values (${cid}, ${t}, ${b}, 'A', 'B', 'A B', ${phone}, ${extra.email ?? null}, ${extra.lang ?? null}, ${extra.optIn ?? true}, ${extra.optIn ?? true})`);
  await cust(EN, T, B, '+16095550101'); await cust(VI, T, B, '+16095550102', { lang: 'vi' }); await cust(OUT, T, B, '+16095550103', { optIn: false });
  await cust(NOPHONE, T, B, null); await cust(OTHER, T2, B2, '+16095550104'); await cust(EM, T, B, '+16095550105', { email: 'em@g8.test' });
  const svc = new ReviewRequestService(new KyselyRequestStore(db), new KyselyConsent(db), new MessengerDispatchAdapter(messenger, new KyselyReviewRequestProfile(db)));
  job = new ReviewRequestSenderJob(svc, db, accessFn);
});
beforeEach(async () => {
  sent = []; mode = 'ok'; access = { allowed: true, enforce: false };
  await q(sql`delete from review_request_events`); await q(sql`delete from review_requests`); await q(sql`delete from reviews where tenant_id = ${T}`);
  await setPolicy(T, { enabled: true, oneReminder: false }); await setPolicy(T2, { enabled: true });
});

describe('G8 review-request sender — what is sent', () => {
  it('RS-01 a due request is sent once through the salon messenger: salon name + its Google review link, status sent', async () => {
    const r = await req(EN, new Date(NOON.getTime() - 10 * 60_000));
    const out = await job.sweep(NOON);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'sms', tenantId: T, branchId: B, to: '+16095550101', purpose: 'followup', customerId: EN, source: { type: 'follow_up', id: r } });
    expect(sent[0].body).toContain('Lux Nails');
    expect(sent[0].body).toContain(googleReviewLink('PLACE-MAIN')!);
    expect((await status(r)).status).toBe('sent');
    expect(await events(r)).toEqual(['sent']);
    expect(out.find((s) => s.tenantId === T)).toMatchObject({ outcome: 'sent', sent: 1 });
    await job.sweep(new Date(NOON.getTime() + 5 * 60_000));
    expect(sent).toHaveLength(1);                                        // never twice
  });
  it('RS-02 a future request waits; customer messages are English (language mandate: only the POS is bilingual) even for a vi preference; email goes by email', async () => {
    const later = await req(EN, new Date(NOON.getTime() + H));
    await req(VI, new Date(NOON.getTime() - 60_000));
    await req(EM, new Date(NOON.getTime() - 60_000), { channel: 'email' });
    await job.sweep(NOON);
    expect((await status(later)).status).toBe('scheduled');
    const vi = sent.find((m) => m.customerId === VI);
    expect(vi.body).toMatch(/^Thanks for visiting Lux Nails!/);
    const em = sent.find((m) => m.customerId === EM);
    expect(em).toMatchObject({ kind: 'email', to: 'em@g8.test', subject: 'How was your visit?' });
    expect(em.idempotencyKey).toMatch(/^review-request:/);
  });
  it('RS-03 a customer who withdrew consent after scheduling is never messaged (opted_out); no contact → failed, not sent', async () => {
    const o = await req(OUT, new Date(NOON.getTime() - 60_000));
    const n = await req(NOPHONE, new Date(NOON.getTime() - 60_000));
    await job.sweep(NOON);
    expect(sent).toHaveLength(0);
    expect((await status(o)).status).toBe('opted_out');
    expect(['opted_out', 'failed']).toContain((await status(n)).status);   // KyselyConsent treats "no number" as do-not-message
  });
  it('RS-04 the messenger refusing the text marks the request failed — never sent', async () => {
    mode = 'blocked';
    const r = await req(EN, new Date(NOON.getTime() - 60_000));
    const out = await job.sweep(NOON);
    expect((await status(r)).status).toBe('failed');
    expect((await status(r)).sent_at).toBeNull();
    expect(out.find((s) => s.tenantId === T)).toMatchObject({ sent: 0, failed: 1 });
  });
  it('RS-05 a branch without a Google listing sends no link (the "reply to us" wording), never another branch\'s link', async () => {
    await req(EN, new Date(NOON.getTime() - 60_000), { branch: B3 });
    await job.sweep(NOON);
    expect(sent[0].body).not.toContain('placeid=');
    expect(sent[0].body).toMatch(/Reply to let us know/);
  });
});

describe('G8 review-request sender — what stops it', () => {
  it('RS-10 review requests off (the default) or the assistant off → nothing is sent; the rows wait', async () => {
    await setPolicy(T, null);                                          // nothing set: platform default is OFF
    const r = await req(EN, new Date(NOON.getTime() - 60_000));
    let out = await job.sweep(NOON);
    expect(sent).toHaveLength(0); expect((await status(r)).status).toBe('scheduled');
    expect(out.find((s) => s.tenantId === T)?.outcome).toBe('disabled');
    await setPolicy(T, { enabled: true }, false);                      // assistant switched off
    out = await job.sweep(NOON);
    expect(sent).toHaveLength(0); expect(out.find((s) => s.tenantId === T)?.outcome).toBe('disabled');
  });
  it('RS-11 a request that waited more than 48 h is expired, not sent late (also: every row from before the sender existed)', async () => {
    const old = await req(EN, new Date(NOON.getTime() - 49 * H));
    const fresh = await req(VI, new Date(NOON.getTime() - 47 * H));
    await job.sweep(NOON);
    expect((await status(old)).status).toBe('expired');
    expect(await events(old)).toEqual(['expired']);
    expect((await status(fresh)).status).toBe('sent');
    expect(sent.map((m) => m.customerId)).toEqual([VI]);
  });
  it('RS-12 quiet hours are checked again at send time, in the salon\'s zone', async () => {
    const r = await req(EN, new Date(LATE.getTime() - 60_000));
    const out = await job.sweep(LATE);
    expect(sent).toHaveLength(0); expect((await status(r)).status).toBe('scheduled');
    expect(out.find((s) => s.tenantId === T)?.outcome).toBe('quiet_hours');
    expect(inQuietHours(LATE, { quietHoursStart: 21, quietHoursEnd: 9 }, 'America/New_York')).toBe(true);
    expect(inQuietHours(NOON, { quietHoursStart: 21, quietHoursEnd: 9 }, 'America/New_York')).toBe(false);
    expect(inQuietHours(NOON, { quietHoursStart: 9, quietHoursEnd: 9 }, 'America/New_York')).toBe(false);   // no window
  });
  it('RS-13 AI package: not entitled + platform enforcing → nothing; observe mode → sent as before', async () => {
    await req(EN, new Date(NOON.getTime() - 60_000));
    access = { allowed: false, enforce: true };
    let out = await job.sweep(NOON);
    expect(sent).toHaveLength(0); expect(out.find((s) => s.tenantId === T)?.outcome).toBe('not_entitled');
    access = { allowed: false, enforce: false };
    out = await job.sweep(NOON);
    expect(sent).toHaveLength(1);
  });
  it('RS-14 each salon and branch on its own: one salon switched off does not stop another', async () => {
    await setPolicy(T, { enabled: false });
    await req(EN, new Date(NOON.getTime() - 60_000));
    await req(OTHER, new Date(NOON.getTime() - 60_000), { tenant: T2, branch: B2 });
    await job.sweep(NOON);
    expect(sent.map((m) => [m.tenantId, m.customerId])).toEqual([[T2, OTHER]]);
    expect(sent[0].body).toContain('Other Salon');
    expect(sent[0].body).toContain('PLACE-OTHER');
  });
});

describe('G8 review-request sender — the one reminder', () => {
  it('RS-20 only when "one reminder" is on: 72 h after the first send, once', async () => {
    const r = await req(EN, new Date(NOON.getTime() - 80 * H), { status: 'sent', sentAt: new Date(NOON.getTime() - 73 * H) });
    await job.sweep(NOON);
    expect(sent).toHaveLength(0);                                      // policy off → no reminder
    await setPolicy(T, { enabled: true, oneReminder: true });
    await job.sweep(NOON);
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatch(/If you have a minute/);
    expect((await status(r)).reminder_sent_at).not.toBeNull();
    expect(await events(r)).toEqual(['reminder_sent']);
    await job.sweep(new Date(NOON.getTime() + 10 * 60_000));
    expect(sent).toHaveLength(1);                                      // at most one
  });
  it('RS-21 no reminder before 72 h, after a week, to an opted-out customer, or after the customer left a review', async () => {
    await setPolicy(T, { enabled: true, oneReminder: true });
    await req(EN, NOON, { status: 'sent', sentAt: new Date(NOON.getTime() - 10 * H) });          // too soon
    await req(VI, NOON, { status: 'sent', sentAt: new Date(NOON.getTime() - 8 * 24 * H) });      // too old
    await req(OUT, NOON, { status: 'sent', sentAt: new Date(NOON.getTime() - 73 * H) });         // opted out since
    await req(EM, NOON, { status: 'sent', sentAt: new Date(NOON.getTime() - 73 * H) });
    await q(sql`insert into reviews (tenant_id, branch_id, customer_id, rating, comment, source, created_at) values (${T}, ${B}, ${EM}, 5, 'lovely', 'google', ${new Date(NOON.getTime() - 20 * H)})`);
    await job.sweep(NOON);
    expect(sent).toHaveLength(0);
  });
});
