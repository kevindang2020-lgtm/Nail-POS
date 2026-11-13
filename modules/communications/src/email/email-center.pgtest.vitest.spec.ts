// email-center.pgtest — the Email Management & Delivery Center on the REAL schema (through 748), Email Complete Build Guide.
// The ONE email path (NotificationsService.sendEmail) with the salon's settings, claim-before-send, suppression by purpose,
// marketing compliance and the branded HTML + text alternative; signed provider events (delivered / bounce / complaint /
// unsubscribe, duplicates, out of order); the center's honest KPIs, health, history search / date basis / paging, tenant
// isolation, controlled test sends, the customer-record composer, the protected resend, and the booking confirmation email.
import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { MockEmailSender, MockSmsSender, SendGridEmailSender, htmlToText } from '@aipowersalon/notifications';
import { NotificationsService } from '../notifications/notifications.service';
import { KyselyNotificationsRepository } from '../notifications/notifications.kysely.repository';
import { KyselyOptOutRepository } from '../notifications/notifications.optout.kysely.repository';
import { CustomerNotificationsCenter, type CnSender } from '../notifications/customer-notifications';
import { KyselyEmailPolicy, effectiveEmailSettings, signUnsubscribe, verifyUnsubscribe } from './email-policy';
import { applyEmailEvents, applyUnsubscribe, verifySendgridSignature, freshTimestamp } from './email-events';
import { EmailCenter, emailDisplayStatus, type EcContext } from './email-center';
import { BookingConfirmationEmailConsumer, bookingConfirmationEmail } from '../../../../apps/api/src/events/consumers/booking-confirmation-email.consumer';

const P = 'd7480000-0000-4000-8000-0000000';
const id = (s: string) => P + s.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2'), OWNER = id('e1'), DESK = id('e2'), OWNER2 = id('e3');
const C1 = id('c1'), C2 = id('c2'), CX = id('c9'), TECH = id('d1');
const PERMS = ['pos.communications.view', 'pos.communications.manage', 'settings.edit'];
const owner: EcContext = { tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: PERMS };
const viewer: EcContext = { tenantId: T, branchId: B, userId: DESK, role: 'FRONT_DESK', permissions: ['pos.communications.view'] };
const owner2: EcContext = { tenantId: T2, branchId: B2, userId: OWNER2, role: 'OWNER', permissions: PERMS };
const SECRET = 'a-test-unsubscribe-secret-0123456789';
const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const PUB = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const ENV: NodeJS.ProcessEnv = { NODE_ENV: 'test', EMAIL_UNSUBSCRIBE_SECRET: SECRET, PUBLIC_API_BASE_URL: 'https://api.example.test', SENDGRID_WEBHOOK_VERIFICATION_KEY: PUB, SENDGRID_FROM: 'mail@salon.example' };

let db: any; let mail: MockEmailSender; let svc: NotificationsService; let center: EmailCenter; let cn: CustomerNotificationsCenter;
const q = async (s: any) => (await s.execute(db)).rows as any[];
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e: any) { return e?.code ?? e?.apiCode ?? e?.response?.code ?? e?.name ?? String(e); } }
async function setSettings(json: Record<string, unknown>, tenant = T) {
  await q(sql`delete from tenant_settings where tenant_id = ${tenant} and category = 'notifications'`);
  await q(sql`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values (${tenant}, null, 'notifications', ${JSON.stringify(json)}::jsonb)`);
}
const lastSent = () => mail.sent[mail.sent.length - 1];
let ev = 0;
const event = (sid: string, event: string, extra: Record<string, unknown> = {}) => ({ sg_message_id: `${sid}.filterdrecv-1`, event, sg_event_id: `e${++ev}`, timestamp: Math.floor(Date.now() / 1000), ...extra });

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Glow LLC', 'Glow Bar', 'em-a', 'EMA001', 'active'), (${T2}, 'Other LLC', 'Other Salon', 'em-b', 'EMB001', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name, timezone, address, city, state, zip) values (${B}, ${T}, 'Main', 'America/New_York', '12 Elm St', 'Princeton', 'NJ', '08540'), (${B2}, ${T2}, 'Other', 'America/New_York', null, null, null, null)`);
  await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${OWNER}, ${T}, 'Olive Owner', 'olive@glow.test', 'active', 'OWNER'), (${DESK}, ${T}, 'Dee Desk', 'dee@glow.test', 'active', 'FRONT_DESK'), (${OWNER2}, ${T2}, 'Oz Other', 'oz@other.test', 'active', 'OWNER')`);
  await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, status, marketing_email_opt_in) values
    (${C1}, ${T}, ${B}, 'Ava', 'Kim', 'Ava Kim', '+16095550142', 'ava@example.com', 'active', true),
    (${C2}, ${T}, ${B}, 'Ben', 'Lo', 'Ben Lo', '+16095550143', null, 'active', false),
    (${CX}, ${T2}, ${B2}, 'Ava', 'Kim', 'Ava Kim', '+16095550142', 'ava@example.com', 'active', true)`);
  await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active) values (${TECH}, ${T}, ${B}, 'Tina', 'Tech', 'Tina Tech', true)`);
  mail = new MockEmailSender();
  const policy = new KyselyEmailPolicy(db, ENV);
  svc = new NotificationsService(new KyselyNotificationsRepository(db), new MockSmsSender() as any, mail as any, undefined, new KyselyOptOutRepository(db), undefined, undefined, policy);
  cn = new CustomerNotificationsCenter(db, svc as unknown as CnSender, null, ENV, () => Date.now());
  center = new EmailCenter(db, cn, svc, mail, policy, ENV);
}, 240_000);

describe('the ONE email path — settings, identity, HTML, claim-before-send (guide §05, §06, §09)', () => {
  it('the SendGrid payload: HTML as text/html WITH a plain-text alternative, the salon display name, reply-to; never a smuggled header', () => {
    const p: any = SendGridEmailSender.payload('mail@salon.example', 'a@b.co', 'Hi\r\nBcc: x@y.z', '<!doctype html><html><body><p>Thanks &amp; see you</p></body></html>', { fromName: 'Glow <Bar>\nX', replyTo: 'desk@glow.test' });
    expect(p.content.map((c: any) => c.type)).toEqual(['text/plain', 'text/html']);
    expect(p.content[0].value).toBe('Thanks & see you');
    expect(p.from).toEqual({ email: 'mail@salon.example', name: 'Glow Bar X' });
    expect(p.reply_to).toEqual({ email: 'desk@glow.test' }); expect(p.subject).not.toMatch(/\n/);
    expect(htmlToText('<p>a</p><p>b</p>')).toBe('a\n\nb');
  });
  it('settings: the email sender name is never the SMS brand; defaults keep both photographed toggles ON', () => {
    expect(effectiveEmailSettings(null, null, 'Glow Bar')).toMatchObject({ bookingConfirmations: true, receipts: true, senderName: 'AIPowerSalon', source: 'default' });
    expect(effectiveEmailSettings({ senderBrand: 'Glow Bar', emailSenderName: 'Glow Bar Nails', receiptDelivery: ['SMS'] }, null, 'x')).toMatchObject({ senderName: 'Glow Bar Nails', receipts: false });
    expect(effectiveEmailSettings({ emailReplyTo: 'not-an-email' }, null, 'x').replyTo).toBeNull();
  });
  it('receipts switched off → blocked receipt_email_disabled, nothing reaches the provider; switched on → sent with the salon name + reply-to', async () => {
    await setSettings({ emailSenderName: 'Glow Bar Nails', emailReplyTo: 'desk@glow.test', emailConfirmation: true, receiptDelivery: ['SMS'] });
    const n0 = mail.sent.length;
    const off = await svc.sendEmail({ tenantId: T, branchId: B, to: 'ava@example.com', subject: 'Your receipt', body: 'Total $50.00', purpose: 'receipt', category: 'receipt', customerId: C1, source: { type: 'ticket', id: id('f1') } });
    expect(off).toMatchObject({ sent: false, status: 'blocked', reason: 'receipt_email_disabled' }); expect(mail.sent.length).toBe(n0);
    await setSettings({ emailSenderName: 'Glow Bar Nails', emailReplyTo: 'desk@glow.test', emailConfirmation: true, receiptDelivery: ['SMS', 'Email'] });
    const on = await svc.sendEmail({ tenantId: T, branchId: B, to: 'AVA@example.com', subject: 'Your receipt', body: 'Total $50.00', purpose: 'receipt', category: 'receipt', customerId: C1, source: { type: 'ticket', id: id('f1') } });
    expect(on.sent).toBe(true);
    expect(lastSent().opts).toMatchObject({ fromName: 'Glow Bar Nails', replyTo: 'desk@glow.test', text: 'Total $50.00' });
    expect(lastSent().body).toMatch(/^<!doctype html>/i); expect(lastSent().to).toBe('ava@example.com');
    const row = (await q(sql`select status, purpose, source_type, branch_id from notifications where id = ${on.notificationId}`))[0];
    expect(row).toEqual({ status: 'simulated', purpose: 'receipt', source_type: 'ticket', branch_id: B });
  });
  it('one idempotency key → one provider call; the replay answers with the first attempt and sends nothing', async () => {
    const n0 = mail.sent.length;
    const a = await svc.sendEmail({ tenantId: T, to: 'ava@example.com', subject: 'S', body: 'B', purpose: 'notification', category: 'test', idempotencyKey: 'em-key-0001' });
    const b = await svc.sendEmail({ tenantId: T, to: 'ava@example.com', subject: 'S', body: 'B', purpose: 'notification', category: 'test', idempotencyKey: 'em-key-0001' });
    expect(mail.sent.length).toBe(n0 + 1); expect(b).toMatchObject({ duplicate: true, notificationId: a.notificationId, sent: true });
  });
  it('an invalid address never reaches the provider (blocked invalid_destination, recorded)', async () => {
    const n0 = mail.sent.length;
    const r = await svc.sendEmail({ tenantId: T, to: 'not-an-email', subject: 'S', body: 'B', purpose: 'notification' });
    expect(r).toMatchObject({ sent: false, reason: 'invalid_destination' }); expect(mail.sent.length).toBe(n0);
  });
});

describe('marketing compliance + suppression by purpose (guide §08, §13)', () => {
  it('marketing email carries the salon address + one-click unsubscribe (link + List-Unsubscribe headers); a salon with no address is refused', async () => {
    const r = await svc.sendEmail({ tenantId: T, branchId: B, to: 'ava@example.com', subject: 'Fall offer', body: '20% off this week', purpose: 'marketing', category: 'marketing', customerId: C1 });
    expect(r.sent).toBe(true);
    const m = lastSent(); expect(m.opts?.text).toMatch(/12 Elm St, Princeton, NJ, 08540/); expect(m.opts?.text).toMatch(/Unsubscribe: https:\/\/api\.example\.test\/public\/email\/unsubscribe\?token=/);
    expect(m.opts?.headers).toMatchObject({ 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }); expect(m.opts?.headers?.['List-Unsubscribe']).toMatch(/^<https:/);
    const none = await svc.sendEmail({ tenantId: T2, branchId: B2, to: 'ava@example.com', subject: 'x', body: 'y', purpose: 'marketing', category: 'marketing' });
    expect(none).toMatchObject({ sent: false, reason: 'no_physical_address' });
  });
  it('unsubscribe tokens are signed: round trip ok, a tampered token or another secret changes nothing', () => {
    const tok = signUnsubscribe(T, 'Ava@Example.com', SECRET);
    expect(verifyUnsubscribe(tok, SECRET)).toEqual({ tenantId: T, address: 'ava@example.com' });
    expect(verifyUnsubscribe(tok.slice(0, -2) + 'xx', SECRET)).toBeNull(); expect(verifyUnsubscribe(tok, 'another-secret-0123456789')).toBeNull();
  });
  it('a marketing unsubscribe blocks marketing ONLY — the receipt still goes; the customer record’s marketing consent follows', async () => {
    await applyUnsubscribe(db, T, 'ava@example.com');
    expect((await svc.sendEmail({ tenantId: T, branchId: B, to: 'ava@example.com', subject: 'x', body: 'y', purpose: 'marketing', category: 'marketing' })).reason).toBe('opted_out');
    expect((await svc.sendEmail({ tenantId: T, branchId: B, to: 'ava@example.com', subject: 'Receipt', body: 'Total', purpose: 'receipt', category: 'receipt' })).sent).toBe(true);
    expect((await q(sql`select marketing_email_opt_in from customers where id = ${C1}`))[0].marketing_email_opt_in).toBe(false);
    expect((await q(sql`select marketing_email_opt_in from customers where id = ${CX}`))[0].marketing_email_opt_in).toBe(true);   // another salon's customer untouched
    expect((await q(sql`select source, purpose from notification_consent_events where tenant_id = ${T} and address = 'ava@example.com' order by created_at desc limit 1`))[0]).toEqual({ source: 'email_unsubscribe', purpose: 'marketing' });
  });
});

describe('signed provider events (guide §05, §12)', () => {
  it('signature: valid ECDSA over timestamp + raw body; tampered body / wrong key / stale timestamp refused', () => {
    const ts = String(Math.floor(Date.now() / 1000)); const body = Buffer.from('[{"event":"delivered"}]');
    const sig = cryptoSign('sha256', Buffer.concat([Buffer.from(ts), body]), keys.privateKey).toString('base64');
    expect(verifySendgridSignature(PUB, sig, ts, body)).toBe(true);
    expect(verifySendgridSignature(PUB, sig, ts, Buffer.from('[{"event":"bounce"}]'))).toBe(false);
    expect(verifySendgridSignature(generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64'), sig, ts, body)).toBe(false);
    expect(freshTimestamp(String(Math.floor(Date.now() / 1000) - 3600))).toBe(false);
  });
  it('delivered moves Accepted → Delivered once; a duplicate is kept out; a LATER bounce never regresses it; processed is evidence only', async () => {
    const r = await svc.sendEmail({ tenantId: T, to: 'zed@example.com', subject: 'S', body: 'B', purpose: 'notification' });
    // the mock sender is "simulated"; a real provider row is "sent" — model the provider's acceptance
    await q(sql`update notifications set status = 'sent', provider_id = 'SGmsg001' where id = ${r.notificationId}`);
    const s1 = await applyEmailEvents(db, [event('SGmsg001', 'processed'), event('SGmsg001', 'delivered'), event('SGmsg001', 'delivered'), event('SGmsg001', 'bounce', { type: 'bounce', reason: '550 no such user' }), event('SGunknown', 'delivered')]);
    expect(s1).toMatchObject({ received: 5, applied: 1, duplicates: 1, unknownMessage: 1 });
    expect((await q(sql`select status, delivered_at is not null as d from notifications where id = ${r.notificationId}`))[0]).toEqual({ status: 'delivered', d: true });
    expect((await q(sql`select provider_status, applied from notification_delivery_events where notification_id = ${r.notificationId} order by received_at, provider_status`)).map((e: any) => `${e.provider_status}:${e.applied}`).sort()).toEqual(['bounce:false', 'delivered:true', 'processed:false']);
  });
  it('a hard bounce fails the row (Bounced) and suppresses the address for ALL email; a spam complaint suppresses all too', async () => {
    const r = await svc.sendEmail({ tenantId: T, to: 'gone@example.com', subject: 'S', body: 'B', purpose: 'notification' });
    await q(sql`update notifications set status = 'sent', provider_id = 'SGmsg002' where id = ${r.notificationId}`);
    await applyEmailEvents(db, [event('SGmsg002', 'bounce', { type: 'bounce', reason: '550 5.1.1 user unknown' })]);
    const row = (await q(sql`select status, failure_reason from notifications where id = ${r.notificationId}`))[0];
    expect(row.status).toBe('failed'); expect(emailDisplayStatus(row)).toBe('bounced');
    expect((await svc.sendEmail({ tenantId: T, to: 'gone@example.com', subject: 'Receipt', body: 'x', purpose: 'receipt', category: 'receipt' })).reason).toBe('opted_out');
    const r2 = await svc.sendEmail({ tenantId: T, to: 'spam@example.com', subject: 'S', body: 'B', purpose: 'notification' });
    await q(sql`update notifications set status = 'sent', provider_id = 'SGmsg003' where id = ${r2.notificationId}`);
    await applyEmailEvents(db, [event('SGmsg003', 'spamreport')]);
    expect((await q(sql`select scope from notification_opt_outs where tenant_id = ${T} and address = 'spam@example.com'`))[0].scope).toBe('all');
  });
});

describe('the center — honest KPIs, health, history, isolation (guide §07, §08, §12, §13)', () => {
  it('KPIs: Delivered is a number only because verified events exist; definitions name the bases', async () => {
    const s = await center.summary(owner, { preset: 'today' });
    expect(s.delivered).toBe(1); expect(s.accepted).toBeGreaterThanOrEqual(1); expect(s.bounced).toBe(1);
    // Nov 3 audit: a bounced email is in the delivery-rate denominator (was dropped: 1 delivered + 1 bounced read as a higher rate)
    const withEvents = Number((await q(sql`select count(*)::int as n from notifications n where n.tenant_id = ${T} and n.channel = 'email' and exists (select 1 from notification_delivery_events e where e.notification_id = n.id)`))[0].n);
    expect(s.deliveryRate).toBe(Math.round((1 / withEvents) * 1000) / 10);
    const bouncedRow = (await q(sql`select id from notifications where tenant_id = ${T} and channel = 'email' and status = 'failed' and failure_reason ~ '^(bounced|blocked)' limit 1`))[0];
    expect((await center.detail(owner, bouncedRow.id)).canResend).toBe(false);
    const noEvents = await new EmailCenter(db, cn, svc, mail, new KyselyEmailPolicy(db, ENV), { ...ENV, SENDGRID_WEBHOOK_VERIFICATION_KEY: '' }).summary(owner, { preset: 'today' });
    expect(noEvents.delivered).toBeNull(); expect(noEvents.deliveryRate).toBeNull();
  });
  it('Email 11 latency + Email 05 hygiene: measured only from verified delivered events; suppression split by why, another salon never counted', async () => {
    const del = (await q(sql`select id from notifications where tenant_id = ${T} and provider_id = 'SGmsg001'`))[0];
    await q(sql`update notifications set created_at = now() - interval '10 minutes', delivered_at = now() - interval '10 minutes' + interval '90 seconds' where id = ${del.id}`);
    const s: any = await center.summary(owner, { preset: 'today' });
    expect(s.latency).toMatchObject({ measured: 1, medianSeconds: 90, p90Seconds: 90, slowestSeconds: 90 });
    const noEvents: any = await new EmailCenter(db, cn, svc, mail, new KyselyEmailPolicy(db, ENV), { ...ENV, SENDGRID_WEBHOOK_VERIFICATION_KEY: '' }).summary(owner, { preset: 'today' });
    expect(noEvents.latency).toBeNull();   // no verified event source → not measured, never 0
    const b = Object.fromEntries(s.suppression.buckets.map((x: any) => [x.key, x]));
    const hard = Number((await q(sql`select count(*)::int as n from notification_opt_outs where tenant_id = ${T} and channel = 'email' and reason = 'provider_bounce'`))[0].n);
    expect(hard).toBeGreaterThanOrEqual(1);   // gone@example.com (+ zed@ from the late bounce: kept as suppression evidence)
    expect(b.hard_bounce).toMatchObject({ addresses: hard, scope: 'all', next: 'correct_address' });
    expect(b.complaint).toMatchObject({ addresses: 1, scope: 'all', next: 'do_not_resend' });              // spam@example.com
    expect(b.unsubscribe).toMatchObject({ addresses: 1, scope: 'marketing', next: 'customer_opt_in_only' }); // ava@example.com
    expect(s.suppression.total).toBe(b.hard_bounce.addresses + b.complaint.addresses + b.unsubscribe.addresses + b.other.addresses);
    await q(sql`insert into notification_opt_outs (tenant_id, channel, address, reason, scope) values (${T2}, 'email', 'x@other.test', 'provider_bounce', 'all')`);
    const again: any = await center.summary(owner, { preset: 'today' });
    expect(again.suppression.buckets.find((x: any) => x.key === 'hard_bounce').addresses).toBe(hard);
    const other: any = await center.summary(owner2, { preset: 'today' });
    expect(other.suppression.buckets.find((x: any) => x.key === 'hard_bounce').addresses).toBe(1);
    expect(other.latency?.measured ?? 0).toBe(0);
    await q(sql`delete from notification_opt_outs where tenant_id = ${T2}`);
  });
  it('health: never checked → Unknown (never green); the provider check is recorded, rate-limited, and with signed events receiving it reads Ready', async () => {
    const h0 = await center.health(owner);
    expect(h0.overall).toBe('unknown'); expect(h0.layers.find((l) => l.key === 'provider_health')?.state).toBe('not_checked');
    mail.verifyResult = { status: 'auth_failed', detail: 'The provider rejected the API key.' };
    const bad = await center.checkHealth(owner);
    expect(bad.layers.find((l) => l.key === 'provider_health')).toMatchObject({ state: 'down', next: 'correct_credentials' }); expect(bad.overall).toBe('attention_required');
    expect(await code(center.checkHealth(owner))).toBe('EMAIL_HEALTH_RATE_LIMITED');
    const c2 = new EmailCenter(db, cn, svc, mail, new KyselyEmailPolicy(db, ENV), ENV, () => Date.now());
    mail.verifyResult = { status: 'healthy', detail: 'ok' };
    await q(sql`insert into email_health_checks (tenant_id, trigger_type, configuration, sender_identity, provider_health, callbacks, overall, detail) values (${T}, 'scheduled', 'ready_to_check', 'unknown', 'healthy', 'unknown', 'ready', 'ok')`);
    const good = await c2.health(owner);
    expect(good.layers.find((l) => l.key === 'callbacks')?.state).toBe('receiving'); expect(good.layers.find((l) => l.key === 'provider_health')?.state).toBe('healthy');
    expect(['ready', 'attention_required']).toContain(good.overall);   // 'attention_required' only while recent failures are degraded
    expect(await code(center.checkHealth(viewer))).toBe('PERMISSION_DENIED');
    expect(await code(q(sql`delete from email_health_checks where tenant_id = ${T}`))).not.toBe('ok');   // append-only
  });
  it('C2 audit: the check reads SPF / DKIM / DMARC from DNS for the sending domain (verified only when all three pass)', async () => {
    const domain = String(ENV.EMAIL_FROM ?? ENV.SENDGRID_FROM ?? 'nailsalons@aipowersalon.com').split('@').pop()!.replace(/>.*$/, '').toLowerCase();
    const dns = { resolveTxt: async (n: string) => { if (n === domain) return [['v=spf1 include:sendgrid.net ~all']]; if (n === `_dmarc.${domain}`) return [['v=DMARC1; p=reject']]; throw Object.assign(new Error('nf'), { code: 'ENOTFOUND' }); },
      resolveCname: async (n: string) => { if (n === `s1._domainkey.${domain}`) return ['s1.domainkey.u1.wl.sendgrid.net']; throw Object.assign(new Error('nf'), { code: 'ENOTFOUND' }); } };
    const c3 = new EmailCenter(db, cn, svc, mail, new KyselyEmailPolicy(db, ENV), ENV, () => Date.now(), dns);
    const h = await c3.checkHealth(owner2);   // the other salon: no check in the last minute
    expect(h.layers.find((l: any) => l.key === 'sender_identity')).toMatchObject({ state: 'verified', records: { spf: 'pass', dkim: 'pass', dmarc: 'pass', dmarcPolicy: 'reject' } });
  });
  it('history: search by name / phone / subject / provider id; beyond page 1; newest first; viewers see masked addresses', async () => {
    for (let i = 0; i < 25; i++) await svc.sendEmail({ tenantId: T, branchId: B, to: 'ava@example.com', subject: `Paging subject ${String(i).padStart(2, '0')}`, body: 'b', purpose: 'notification', customerId: C1 });
    const p1 = await center.history(owner, { q: 'Paging subject', pageSize: 10, preset: 'today' });
    expect(p1.total).toBe(25); expect(p1.totalPages).toBe(3); expect(p1.items[0].subject).toBe('Paging subject 24');
    const p3 = await center.history(owner, { q: 'Paging subject', pageSize: 10, page: 3, preset: 'today' }); expect(p3.items.length).toBe(5);
    expect((await center.history(owner, { q: 'Ava Kim', preset: 'today' })).total).toBeGreaterThanOrEqual(25);
    expect((await center.history(owner, { q: '609-555-0142', preset: 'today' })).total).toBeGreaterThanOrEqual(25);
    expect((await center.history(owner, { q: 'SGmsg001', preset: 'all' })).total).toBe(1);
    const v = await center.history(viewer, { q: 'Paging subject', pageSize: 10, preset: 'today' }); expect(v.masked).toBe(true); expect(v.items[0].to).toBe('a•••@example.com');
    // Nov 3 audit: a masked viewer cannot find messages by the address they are not allowed to see; the owner can
    expect((await center.history(owner, { q: 'ava@example', preset: 'today' })).total).toBeGreaterThanOrEqual(25);
    expect((await center.history(viewer, { q: 'ava@example', preset: 'today' })).total).toBe(0);
    expect((await center.history(owner, { status: 'bounced', preset: 'all' })).total).toBe(1);
  });
  it('date bounds are salon-local and inclusive: 23:30 on the To date is in, 00:10 the next day is out', async () => {
    const r1 = await svc.sendEmail({ tenantId: T, to: 'late@example.com', subject: 'Late night', body: 'b', purpose: 'notification' });
    const r2 = await svc.sendEmail({ tenantId: T, to: 'late@example.com', subject: 'Late night', body: 'b', purpose: 'notification' });
    await q(sql`update notifications set created_at = ('2026-03-07 23:30'::timestamp at time zone 'America/New_York') where id = ${r1.notificationId}`);
    await q(sql`update notifications set created_at = ('2026-03-08 00:10'::timestamp at time zone 'America/New_York') where id = ${r2.notificationId}`);
    const r = await center.history(owner, { q: 'Late night', preset: 'custom', from: '2026-03-01', to: '2026-03-07' });
    expect(r.items.map((x) => x.id)).toEqual([r1.notificationId]);
    expect(await code(center.history(owner, { preset: 'custom', from: '2026-03-08', to: '2026-03-01' }))).toBe('DATE_RANGE_INVALID');
  });
  it('tenant isolation: the other salon finds none of these (same customer name, same email) and cannot open, resend or compose to them', async () => {
    const mine = (await center.history(owner, { q: 'Paging subject', pageSize: 10, preset: 'today' })).items[0].id;
    expect((await center.history(owner2, { q: 'Paging subject', preset: 'all' })).total).toBe(0);
    // the other salon's OWN attempt to the same address (its blocked marketing email) is theirs — never one of ours
    const theirs = (await center.history(owner2, { q: 'ava@example.com', preset: 'all', pageSize: 50 })).items.map((x) => x.id);
    const ours = (await center.history(owner, { q: 'ava@example.com', preset: 'all', pageSize: 50 })).items.map((x) => x.id);
    expect(theirs.filter((x) => ours.includes(x))).toEqual([]); expect(theirs.length).toBe(1);
    expect(await code(center.detail(owner2, mine))).toBe('EMAIL_NOT_FOUND');
    expect(await code(center.resend(owner2, mine, { idempotencyKey: 'em-x-000001', confirm: true }))).toBe('EMAIL_NOT_FOUND');
    expect(await code(center.compose(owner2, { customerId: C1, subject: 's', body: 'b', idempotencyKey: 'em-x-000002', confirm: true }))).toBe('CUSTOMER_NOT_FOUND');
  });
});

describe('actions — controlled test, composer, protected resend (guide §06, §08, 4.3)', () => {
  it('test email: staff of THIS salon only, confirmation required, one key → one send', async () => {
    expect(await code(center.test(owner, { to: 'ava@example.com', idempotencyKey: 'em-test-0001', confirm: true }))).toBe('EMAIL_TEST_RECIPIENT_NOT_STAFF');
    expect(await code(center.test(owner, { to: 'oz@other.test', idempotencyKey: 'em-test-0001', confirm: true }))).toBe('EMAIL_TEST_RECIPIENT_NOT_STAFF');
    expect(await code(center.test(owner, { to: 'dee@glow.test', idempotencyKey: 'em-test-0001' }))).toBe('EMAIL_CONFIRM_REQUIRED');
    const n0 = mail.sent.length;
    const a = await center.test(owner, { to: 'dee@glow.test', idempotencyKey: 'em-test-0002', confirm: true });
    const b = await center.test(owner, { to: 'dee@glow.test', idempotencyKey: 'em-test-0002', confirm: true });
    expect(a.outcome).toBe('simulated'); expect(b.replayed).toBe(true); expect(mail.sent.length).toBe(n0 + 1);
  });
  it('composer: the address comes from the customer record; a customer without email is refused', async () => {
    const r = await center.compose(owner, { customerId: C1, subject: 'Your nails', body: 'See you soon', idempotencyKey: 'em-comp-0001', confirm: true });
    expect(r.outcome).toBe('simulated'); expect(lastSent().to).toBe('ava@example.com');
    expect(await code(center.compose(owner, { customerId: C2, subject: 's', body: 'b', idempotencyKey: 'em-comp-0002', confirm: true }))).toBe('EMAIL_RECIPIENT_INVALID');
    expect(await code(center.compose(viewer, { customerId: C1, subject: 's', body: 'b', idempotencyKey: 'em-comp-0003', confirm: true }))).toBe('PERMISSION_DENIED');
  });
  it('Email 10 identity confidence: preview = true checks the recipient BEFORE sending — counts only, nothing sent or recorded', async () => {
    const n0 = mail.sent.length; const rows0 = Number((await q(sql`select count(*)::int as n from notifications where tenant_id = ${T}`))[0].n);
    const one: any = await center.compose(owner, { customerId: C1, preview: true });
    expect(one.outcome).toBe('preview');
    expect(one.recipient).toMatchObject({ addressMasked: 'a•••@example.com', validAddress: true, sharedAddressCustomers: 0, sameNameCustomers: 0, confidence: 'unique' });
    expect(one.recipient.suppression).toBe('marketing');   // ava@ unsubscribed from marketing earlier — receipts still go
    // the other salon's Ava Kim (same name + same address) is never counted; a second Ava in THIS salon is
    const C3 = id('c3'), C4 = id('c4');
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, email, status) values
      (${C3}, ${T}, ${B}, 'Ava', 'Kim', 'Ava Kim', 'other.ava@example.com', 'active'), (${C4}, ${T}, ${B}, 'Al', 'Bo', 'Al Bo', 'AVA@example.com ', 'active')`);
    const two: any = await center.compose(owner, { customerId: C1, preview: true });
    expect(two.recipient).toMatchObject({ sharedAddressCustomers: 1, sameNameCustomers: 1, confidence: 'shared_address' });
    expect(JSON.stringify(two)).not.toMatch(/Al Bo|other\.ava/);
    const nameOnly: any = await center.compose(owner, { customerId: C3, preview: true });
    expect(nameOnly.recipient.confidence).toBe('similar_name');
    expect((await center.compose(owner, { customerId: C2, preview: true }) as any).recipient).toMatchObject({ validAddress: false, confidence: 'no_address', addressMasked: null });
    expect(await code(center.compose(owner2, { customerId: C1, preview: true }))).toBe('CUSTOMER_NOT_FOUND');
    expect(await code(center.compose(viewer, { customerId: C1, preview: true }))).toBe('PERMISSION_DENIED');
    expect(mail.sent.length).toBe(n0);
    expect(Number((await q(sql`select count(*)::int as n from notifications where tenant_id = ${T}`))[0].n)).toBe(rows0);
    await q(sql`update customers set status = 'archived' where id in (${C3}, ${C4})`);
  });
  it('protected resend: a failed email is resent once as a NEW linked attempt (original kept); a second resend is refused', async () => {
    const f = (await q(sql`insert into notifications (tenant_id, channel, to_address, subject, body, customer_id, status, failure_reason, purpose, branch_id, created_at)
        values (${T}, 'email', 'ava@example.com', 'Your receipt', 'Total $20', ${C1}, 'failed', 'email_failed:503', 'receipt', ${B}, now()) returning id`))[0].id;
    const r1 = await center.resend(owner, f, { idempotencyKey: 'em-resend-0001', confirm: true });
    expect(['sent', 'simulated']).toContain(r1.outcome);
    const r2 = await center.resend(owner, f, { idempotencyKey: 'em-resend-0002', confirm: true });
    expect(r2.outcome).toBe('refused'); expect(r2.refusalCode).toBe('NOTIFICATION_RETRY_ALREADY_RESENT');
    const d = await center.detail(owner, String(r1.newNotificationId));
    expect(d.attempts.map((a) => a.status)).toEqual(['failed', 'simulated']);
    expect((await q(sql`select status from notifications where id = ${f}`))[0].status).toBe('failed');
  });
});

describe('booking confirmation email (guide §09)', () => {
  it('one confirmation from the real appointment row (date, time, services, technician, address); a replay sends nothing; cancelled / toggled off send nothing', async () => {
    await setSettings({ emailSenderName: 'Glow Bar Nails', emailConfirmation: true, receiptDelivery: ['SMS', 'Email'] });
    const appt = (await q(sql`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, duration_minutes, status, services, source)
        values (${T}, ${B}, ${TECH}, ${C1}, 'Ava Kim', '2026-11-05', '14:30', '15:30', 60, 'booked', ${JSON.stringify([{ name: 'Gel manicure' }])}::jsonb, 'online') returning id`))[0].id;
    const consumer = new BookingConfirmationEmailConsumer(svc);
    const e: any = { tenantId: T, aggregateId: appt, payload: { appointmentId: appt } };
    const n0 = mail.sent.length;
    await consumer.handle(e, db); await consumer.handle(e, db);
    expect(mail.sent.length).toBe(n0 + 1);
    const m = lastSent();
    expect(m.subject).toBe('Your appointment at Glow Bar — Thursday, November 5, 2026, 2:30 PM');
    expect(m.opts?.text).toMatch(/Services: Gel manicure/); expect(m.opts?.text).toMatch(/With: Tina Tech/); expect(m.opts?.text).toMatch(/12 Elm St, Princeton, NJ, 08540/);
    expect((await q(sql`select count(*)::int as n from notifications where tenant_id = ${T} and source_type = 'appointment' and source_id = ${String(appt)}`))[0].n).toBe(1);
    await expect(consumer.handle({ tenantId: T2, aggregateId: appt, payload: { appointmentId: appt } } as any, db)).rejects.toThrow(/another tenant/);
    await setSettings({ emailConfirmation: false, receiptDelivery: ['SMS', 'Email'] });
    const appt2 = (await q(sql`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, duration_minutes, status, source)
        values (${T}, ${B}, ${TECH}, ${C1}, 'Ava Kim', '2026-11-06', '10:00', '11:00', 60, 'booked', 'online') returning id`))[0].id;
    await consumer.handle({ tenantId: T, aggregateId: appt2, payload: { appointmentId: appt2 } } as any, db);
    expect(mail.sent.length).toBe(n0 + 1);
    expect((await q(sql`select status, failure_reason from notifications where source_id = ${String(appt2)}`))[0]).toEqual({ status: 'blocked', failure_reason: 'booking_email_disabled' });
    expect(bookingConfirmationEmail({ salon: 'S', branch: null, address: null, date: '2026-12-31', start: '09:05', services: [], technician: null, customerFirst: null, reference: 'AB12' }).body).toMatch(/^Hi there,/);
  });
  it('Email 12 usage + cost: counts what was handed to the provider; cost only when the provider reported every one, only for managers; never another salon', async () => {
    const handed = async (tenant: string) => Number((await q(sql`select count(*)::int as n from notifications where tenant_id = ${tenant} and channel = 'email' and provider_id is not null
      and created_at >= (date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York')`))[0].n);
    await q(sql`insert into notifications (tenant_id, channel, to_address, subject, body, status, purpose, branch_id, provider_id, provider_cost_micros) values
      (${T2}, 'email', 'a@other.test', 'S', 'B', 'sent', 'receipt', ${B2}, 'SGcost1', 1000000), (${T2}, 'email', 'b@other.test', 'S', 'B', 'delivered', 'receipt', ${B2}, 'SGcost2', null),
      (${T2}, 'email', 'c@other.test', 'S', 'B', 'blocked', 'receipt', ${B2}, null, null), (${T2}, 'sms', '+16095550100', null, 'B', 'sent', 'receipt', ${B2}, 'SMcost3', 9990000)`);
    const n2 = await handed(T2);
    expect(n2).toBeGreaterThanOrEqual(2);
    const s1: any = await center.summary(owner2, { preset: 'today' });
    expect(s1.usage).toMatchObject({ handedToProvider: n2, state: 'cost_unknown', costCents: null });     // SGcost2 has no provider cost: not known, never estimated
    await q(sql`update notifications set provider_cost_micros = 250000 where tenant_id = ${T2} and channel = 'email' and provider_id is not null and provider_cost_micros is null`);
    const micros = Number((await q(sql`select coalesce(sum(provider_cost_micros), 0)::bigint as m from notifications where tenant_id = ${T2} and channel = 'email' and provider_id is not null
      and created_at >= (date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York')`))[0].m);
    const s2: any = await center.summary(owner2, { preset: 'today' });
    expect(s2.usage).toMatchObject({ handedToProvider: n2, withProviderCost: n2, state: 'known', costCents: Math.round(micros / 10_000) });
    expect(s2.usage.costCents).toBeGreaterThanOrEqual(125);                                               // $1.00 + $0.25 at least; the SMS row never counts
    const viewer2: EcContext = { ...owner2, role: 'FRONT_DESK', permissions: ['pos.communications.view'] };
    expect((await center.summary(viewer2, { preset: 'today' })).usage).toMatchObject({ handedToProvider: n2, withProviderCost: null, costCents: null, state: 'not_authorized' });
    const mine: any = await center.summary(owner, { preset: 'today' });
    expect(mine.usage.handedToProvider).toBe(await handed(T));
  });
});

// extras round 10 (agent 5): Email 03 evidence timeline · 06 test-send wizard preview + history · 13 next action
describe('extras Email Delivery Center round 10', () => {
  it('Email 06: the test wizard preview shows the exact subject / body, whether the address is staff of THIS salon, and the test history — nothing sent, recorded or audited', async () => {
    const n0 = mail.sent.length;
    const tally = async () => Number((await q(sql`select (select count(*) from notifications where tenant_id = ${T}) + (select count(*) from audit_logs where tenant_id = ${T}) as n`))[0].n);
    const before = await tally();
    const p: any = await center.test(owner, { to: 'DEE@glow.test', preview: true });
    expect(p).toMatchObject({ outcome: 'preview', subject: 'Test email from your salon', recipient: { address: 'dee@glow.test', validAddress: true, staff: true } });
    expect(p.body).toMatch(/No customer received this message/);
    // the earlier test send (em-test-0002) is in the history, newest first, with its outcome
    expect(p.history.length).toBeGreaterThanOrEqual(1);
    expect(p.history[0]).toMatchObject({ to: 'dee@glow.test', status: 'simulated' });
    expect(((await center.test(owner, { to: 'ava@example.com', preview: true })) as any).recipient.staff).toBe(false);   // a customer
    expect(((await center.test(owner, { to: 'oz@other.test', preview: true })) as any).recipient.staff).toBe(false);     // another salon's staff
    expect(((await center.test(owner, { preview: true })) as any).recipient).toBeNull();
    expect(((await center.test(owner2, { preview: true })) as any).history).toEqual([]);                                   // never another salon's tests
    expect(await code(center.test(viewer, { to: 'dee@glow.test', preview: true }))).toBe('PERMISSION_DENIED');
    expect(mail.sent.length).toBe(n0);
    expect(await tally()).toBe(before);
  });
  it('Email 13: every row and the detail carry the next step (resend / fix address / opted out / await delivery / check delivery events)', async () => {
    const ins = async (status: string, why: string | null, ago: string) => String((await q(sql`insert into notifications (tenant_id, channel, to_address, subject, body, customer_id, status, failure_reason, purpose, branch_id, created_at)
        values (${T}, 'email', 'ava@example.com', ${'NA ' + status}, 'x', ${C1}, ${status}, ${why}, 'receipt', ${B}, now() - ${ago}::interval) returning id`))[0].id);
    const failed = await ins('failed', 'email_failed:503', '1 minute'), bounced = await ins('failed', 'bounced:550', '1 minute'), opted = await ins('blocked', 'opted_out', '1 minute');
    const fresh = await ins('sent', null, '1 hour'), old = await ins('sent', null, '3 days');
    expect((await center.detail(owner, failed)).nextAction).toBe('resend');
    expect((await center.detail(viewer, failed)).nextAction).toBe('review_reason');   // a viewer cannot resend
    expect((await center.detail(owner, bounced)).nextAction).toBe('fix_address');
    expect((await center.detail(owner, opted)).nextAction).toBe('customer_opted_out');
    expect((await center.detail(owner, fresh)).nextAction).toBe('await_delivery');
    expect((await center.detail(owner, old)).nextAction).toBe('check_delivery_events');
    const h = await center.history(owner, { q: 'NA ', preset: 'all', pageSize: 50 });
    const byId = new Map(h.items.map((r: any) => [r.id, r.nextAction]));
    expect([byId.get(failed), byId.get(bounced), byId.get(opted), byId.get(fresh), byId.get(old)]).toEqual(['resend', 'fix_address', 'customer_opted_out', 'await_delivery', 'check_delivery_events']);
  });
  it('Email 03: health carries the provider evidence timeline — latest provider events (verified / applied) and the last real accepted / delivered send; another salon sees none of it', async () => {
    const h: any = await center.health(owner);
    expect(h.evidence.events.length).toBeGreaterThan(0);                       // the signed events applied earlier in this file
    expect(h.evidence.events.length).toBeLessThanOrEqual(10);
    const ats = h.evidence.events.map((e: any) => e.at);
    expect([...ats].sort().reverse()).toEqual(ats);                            // newest first
    expect(h.evidence.events.some((e: any) => e.verified && e.applied)).toBe(true);
    expect(h.evidence.lastAcceptedAt).not.toBeNull();
    const h2: any = await center.health(owner2);
    expect(h2.evidence.events).toEqual([]);                                     // the other salon has no email events of its own and never sees these
  });
});
