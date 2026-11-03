// customer-notifications.pgtest — Customer Notifications Complete Build Guide §05–§12, §15 on the REAL schema (every migration,
// 741 included). The send path is the real NotificationsService over the real ledger; the "provider" is a fake that answers
// like Twilio (accepts, or refuses with Twilio's error code) — nothing leaves the process.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { SmsProviderError, MockEmailSender } from '@aipowersalon/notifications';
import { systemContext } from '@aipowersalon/tenant-context';
import { NotificationsService } from './notifications.service';
import { KyselyNotificationsRepository } from './notifications.kysely.repository';
import { KyselyOptOutRepository } from './notifications.optout.kysely.repository';
import { CustomerNotificationsCenter, evaluateMessagingIncidents, type CnContext, type CnReadiness, type CnReadinessView, type CnSender } from './customer-notifications';

const P = 'd7410000-0000-4000-8000-0000000';
const id = (s: string) => P + s.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2'), OWNER = id('e1'), DESK = id('e2');
const C1 = id('c1'), C2 = id('c2'), C3 = id('c3'), CX = id('c9');
const owner: CnContext = { tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ['pos.communications.view', 'pos.communications.manage', 'owner.alerts.resolve'] };
const desk: CnContext = { tenantId: T, branchId: B, userId: DESK, role: 'FRONT_DESK', permissions: ['pos.communications.view'] };
// the request clock = the database clock (rows the real send path writes are stamped now()); fixtures are relative to it
const NOW = Date.now();
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

class FakeTwilio {
  calls: string[] = []; mode: 'ok' | 'auth' | 'net' = 'ok'; n = 0;
  async send(to: string, _body: string) {
    this.calls.push(to);
    if (this.mode === 'auth') throw new SmsProviderError('sms_failed:Authentication failed, auth token is not valid for account AC0123456789abcdef0123456789abcdef', '20003', 401);
    if (this.mode === 'net') throw new Error('fetch failed: ETIMEDOUT');
    this.n++;
    return { sid: 'SM' + String(this.n).padStart(32, 'a'), segments: 1, senderFrom: '+15550001111' };
  }
}
let readinessState: CnReadinessView = { account: { state: 'invalid', lastCheckedAt: '2026-10-30T10:00:00Z' }, sender: { state: 'assigned' }, outbound: { state: 'blocked' } };
const readiness: CnReadiness = { readiness: async () => readinessState, healthCheck: async () => readinessState };

let db: any; let twilio: FakeTwilio; let svc: NotificationsService; let center: CustomerNotificationsCenter;
const q = async (s: any) => (await s.execute(db)).rows as any[];
async function ledger(row: { channel?: string; to: string; status: string; reason?: string | null; code?: string | null; customer?: string | null; at: string; purpose?: string | null; provider?: string | null; delivered?: string | null; tenant?: string; branch?: string | null; subject?: string | null; body?: string; source?: [string, string] | null }) {
  return String((await q(sql`insert into notifications (tenant_id, channel, to_address, subject, body, customer_id, status, provider_id, failure_reason, provider_error_code, created_at, delivered_at, purpose, branch_id, source_type, source_id)
    values (${row.tenant ?? T}, ${row.channel ?? 'sms'}, ${row.to}, ${row.subject ?? null}, ${row.body ?? 'Hello from the salon'}, ${row.customer ?? null}, ${row.status}, ${row.provider ?? null}, ${row.reason ?? null}, ${row.code ?? null},
      ${row.at}::timestamptz, ${row.delivered ?? null}::timestamptz, ${row.purpose ?? null}, ${row.branch === undefined ? B : row.branch}, ${row.source?.[0] ?? null}, ${row.source?.[1] ?? null}) returning id`))[0].id);
}
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e: any) { return e?.code ?? e?.apiCode ?? e?.name ?? String(e); } }

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'N', 'Notify Salon', 'cn-a', 'CNA001', 'active'), (${T2}, 'O', 'Other Salon', 'cn-b', 'CNB001', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York'), (${B2}, ${T2}, 'Other', 'America/New_York')`);
  await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${OWNER}, ${T}, 'Olive Owner', 'olive@cn.test', 'active', 'OWNER'), (${DESK}, ${T}, 'Dee Desk', 'dee@cn.test', 'active', 'FRONT_DESK')`);
  await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, status) values
    (${C1}, ${T}, ${B}, 'Vishaal', 'Kumar', 'Vishaal Kumar', '+917876299624', 'vishaal@example.com', 'active'),
    (${C2}, ${T}, ${B}, 'Maya', 'Lee', 'Maya Lee', '+15551230001', 'maya@example.com', 'active'),
    (${C3}, ${T}, ${B}, 'Ravi', 'Kumar', 'Ravi Kumar', '+917876299624', null, 'active'),
    (${CX}, ${T2}, ${B2}, 'Other', 'Person', 'Other Person', '+15559990000', null, 'active')`);
  twilio = new FakeTwilio();
  svc = new NotificationsService(new KyselyNotificationsRepository(db), twilio as any, new MockEmailSender() as any, undefined, new KyselyOptOutRepository(db), undefined, undefined);
  center = new CustomerNotificationsCenter(db, svc as unknown as CnSender, readiness, { SENDGRID_API_KEY: '' }, () => NOW);
}, 240_000);

describe('P0 — the send path (guide §08)', () => {
  it('a national number with no +country code never reaches the provider: blocked invalid_destination, ledger row written', async () => {
    twilio.calls = [];
    const r = await svc.sendSms({ tenantId: T, branchId: B, to: '7876299624', body: 'Your receipt', purpose: 'receipt', customerId: C1 });
    expect(r).toMatchObject({ sent: false, status: 'blocked', reason: 'invalid_destination' });
    expect(twilio.calls).toEqual([]);
    const row = (await q(sql`select status, failure_reason, branch_id from notifications where id = ${r.notificationId}`))[0];
    expect(row).toEqual({ status: 'blocked', failure_reason: 'invalid_destination', branch_id: B });
  });
  it('a Twilio refusal keeps the provider code (20003) and only SANITIZED text — no account SID in the ledger', async () => {
    twilio.mode = 'auth';
    const r = await svc.sendSms({ tenantId: T, branchId: B, to: '+917876299622', body: 'Reminder', purpose: 'reminder', customerId: null, source: { type: 'appointment', id: id('f1') } });
    twilio.mode = 'ok';
    const row = (await q(sql`select status, failure_reason, provider_error_code, source_type, source_id from notifications where id = ${r.notificationId}`))[0];
    expect(row.status).toBe('failed'); expect(row.provider_error_code).toBe('20003');
    expect(row.failure_reason).not.toMatch(/AC0123456789abcdef/); expect(row.failure_reason).toMatch(/Authentication failed/);
    expect([row.source_type, row.source_id]).toEqual(['appointment', id('f1')]);
  });
});

describe('KPIs, search, calendar, pages (§05–§06)', () => {
  beforeAll(async () => {
    await ledger({ to: '+15551230001', status: 'delivered', customer: C2, at: ago(120), delivered: ago(119), provider: 'SMde11000000000000000000000000001', purpose: 'reminder' });
    await ledger({ to: '+15551230001', status: 'sent', customer: C2, at: ago(60), provider: 'SMbeef000000000000000000000000001', purpose: 'reminder' });                  // pending (<24 h)
    await ledger({ to: '+15551230001', status: 'sent', customer: C2, at: ago(48 * 60), provider: 'SMc01d000000000000000000000000001', purpose: 'receipt' });                   // unknown (>24 h)
    await ledger({ to: '+15559990000', status: 'delivered', at: ago(120), tenant: T2, branch: B2, delivered: ago(119) });                                      // another salon
    await ledger({ to: '+15551230001', status: 'simulated', customer: C2, at: ago(90) });
    await ledger({ channel: 'email', to: 'maya@example.com', status: 'failed', customer: C2, at: ago(180), reason: '550 mailbox unavailable (hard bounce)', subject: 'Your receipt' });
  });
  it('counts are distinct rows, salon-scoped, with Sent ≠ Delivered, Pending vs Unknown, and the legacy cards kept', async () => {
    const s = await center.summary(owner, { preset: 'all' });
    expect(s.kpis).toMatchObject({ delivered: 1, pending: 1, unknown: 1, simulated: 1, blocked: 1 });
    expect(s.kpis.failed).toBe(2);   // the auth refusal + the email bounce
    expect(s.kpis.sent).toBe(3);     // accepted by the provider: delivered + 2 still-sent rows (a refused send was never accepted)
    expect(s.kpis.deliveryRate).toBeNull();   // pending / unknown rows → no success rate, never a guess
    expect(s.legacy).toEqual({ sentRecent: 3, blockedFailedRecent: 3 });
    expect(s.window).toMatchObject({ preset: 'all', from: null, to: null, tz: 'America/New_York' });
    const m = await center.summary(owner, { preset: 'month' });
    expect(m.window.from!.endsWith('-01')).toBe(true); expect(m.window.to).toBe(m.window.today);
  });
  it('search: partial name, phone digits, email, notification id, provider SID prefix — salon-scoped', async () => {
    const ids = async (qq: string) => (await center.list(owner, { q: qq, preset: 'all' })).items.map((x: any) => x.id);
    expect((await ids('maya')).length).toBe(5);
    expect((await ids('230001')).length).toBe(4);
    expect((await ids('maya@example')).length).toBe(1);
    const one = (await center.list(owner, { q: 'SMbeef00', preset: 'all' })).items;
    expect(one.length).toBe(1); expect(one[0].state).toBe('pending');
    expect(await ids(one[0].id)).toEqual([one[0].id]);
    expect(await ids('5559990000')).toEqual([]);   // the other salon's recipient is invisible
  });
  it('salon-local inclusive days: Oct 9 23:30 New York is NOT in Oct 10; Oct 10 23:59 is; DST end day Nov 1 includes its last hour', async () => {
    const before = await ledger({ to: '+15551230001', status: 'delivered', at: '2026-10-10T03:30:00Z', delivered: '2026-10-10T03:31:00Z' });
    const late = await ledger({ to: '+15551230001', status: 'delivered', at: '2026-10-11T03:59:00Z', delivered: '2026-10-11T03:59:30Z' });
    const dst = await ledger({ to: '+15551230001', status: 'delivered', at: '2026-11-02T04:30:00Z', delivered: '2026-11-02T04:30:30Z' });   // Nov 1 23:30 EST
    const got = (await center.list(owner, { preset: 'custom', from: '2026-10-10', to: '2026-10-10' })).items.map((x: any) => x.id);
    expect(got).toContain(late); expect(got).not.toContain(before);
    const nov1 = (await center.list(owner, { preset: 'custom', from: '2026-11-01', to: '2026-11-01' })).items.map((x: any) => x.id);   // other fixtures are relative to now() and may also fall on Nov 1
    expect(nov1).toContain(dst); expect(nov1).not.toContain(late);
    expect(await code(center.list(owner, { preset: 'custom', from: '2026-10-12', to: '2026-10-10' }))).toBe('DATE_RANGE_INVALID');
    // date basis: delivered_at
    expect((await center.list(owner, { preset: 'custom', from: '2026-10-10', to: '2026-10-10', basis: 'delivered' })).window.basis).toBe('delivered');
  });
  it('pages: 10 / 20 / 50, exact totals, newest first, matches beyond page 1', async () => {
    for (let i = 0; i < 23; i++) await ledger({ to: '+15551239999', status: 'blocked', reason: 'opted_out', at: new Date(Date.parse('2026-10-20T12:00:00Z') + i * 60_000).toISOString() });
    const p1 = await center.list(owner, { q: '5551239999', preset: 'all', pageSize: 10, page: 1 });
    const p3 = await center.list(owner, { q: '5551239999', preset: 'all', pageSize: 10, page: 3 });
    expect([p1.totalItems, p1.totalPages, p1.items.length, p3.items.length]).toEqual([23, 3, 10, 3]);
    expect(Date.parse(p1.items[0].createdAt!)).toBeGreaterThan(Date.parse(p1.items[9].createdAt!));
    expect((await center.list(owner, { tab: 'blocked', preset: 'all', pageSize: 50 })).items.every((x: any) => x.status === 'blocked')).toBe(true);
  });
  it('a front-desk viewer sees masked recipients and no message body; the owner sees both (and the view is audited)', async () => {
    const id1 = (await center.list(owner, { q: 'SMbeef00', preset: 'all' })).items[0].id;
    const d = await center.detail(desk, id1);
    expect(d.recipient).toBe('•••0001'); expect(d.message.body).toBeNull(); expect(d.message.bodyHidden).toBe(true);
    const o = await center.detail(owner, id1);
    expect(o.recipient).toBe('+15551230001'); expect(o.message.body).toBe('Hello from the salon');
    expect((await q(sql`select count(*)::int n from audit_events where tenant_id = ${T} and action = 'notification.viewed'`))[0].n).toBeGreaterThanOrEqual(1);
  });
  it('another salon\'s notification id answers not found', async () => {
    const other = (await q(sql`select id from notifications where tenant_id = ${T2} limit 1`))[0].id;
    expect(await code(center.detail(owner, String(other)))).toBe('NOTIFICATION_NOT_FOUND');
  });
});

describe('delivery lifecycle (§09): callbacks are evidence, never regress, dedupe', () => {
  it('delivered then a late "sent" never moves it back; duplicates are kept once; non-terminal callbacks are freshness evidence', async () => {
    const r = await svc.sendSms({ tenantId: T, branchId: B, to: '+15551230001', body: 'Your appointment', purpose: 'reminder', customerId: C2 });
    expect(r.status).toBe('sent');
    const sid = String(r.providerId);
    await svc.recordDeliveryStatus(sid, 'queued', {}, { tenantId: T });
    await svc.recordDeliveryStatus(sid, 'delivered', {}, { tenantId: T });
    await svc.recordDeliveryStatus(sid, 'delivered', {}, { tenantId: T });
    await svc.recordDeliveryStatus(sid, 'sent', {}, { tenantId: T });
    const row = (await q(sql`select status, delivered_at from notifications where id = ${r.notificationId}`))[0];
    expect(row.status).toBe('delivered'); expect(row.delivered_at).not.toBeNull();
    const ev = await q(sql`select provider_status, applied from notification_delivery_events where tenant_id = ${T} and provider_message_sid = ${sid} order by received_at, provider_status`);
    expect(ev.map((e: any) => [e.provider_status, e.applied]).sort()).toEqual([['delivered', true], ['queued', false], ['sent', false]]);
    const d = await center.detail(owner, String(r.notificationId));
    expect(d.state).toBe('delivered'); expect(d.diagnostics.events.length).toBe(3); expect(d.timing.lastCallbackAt).not.toBeNull();
    expect(await code(sql`delete from notification_delivery_events where provider_message_sid = ${sid}`.execute(db))).not.toBe('ok');   // append-only
  });
});

describe('smart failed-notification recovery (§10)', () => {
  it('failures are grouped by root cause with the next action; the screenshot\'s region refusal on a national number is invalid_destination', async () => {
    await ledger({ to: '7876299624', status: 'failed', customer: C1, at: ago(240), reason: "sms_failed:Permission to send an SMS has not been enabled for the region indicated by the 'To' number: 7876299624", purpose: 'reminder' });
    const f = await center.failures(owner, { preset: 'all' });
    const g = f.groups.find((x: any) => x.category === 'invalid_destination' && x.channel === 'sms')!;
    expect(g.count).toBe(2); expect(g.rootCauses.missing_country_code).toBe(2);   // the P0 blocked row + the screenshot refusal expect(g.retry).toBe('never'); expect(g.fixLink).toBe('/tenant/customers/phone-management');
    expect(f.groups.find((x: any) => x.category === 'auth')!.retry).toBe('after_fix');
    expect(g.example).not.toMatch(/7876299624/);
  });
  it('transient failure → one confirmed, idempotent resend: a NEW ledger row linked to the original; a second click never texts twice', async () => {
    twilio.mode = 'net';
    const f = await svc.sendSms({ tenantId: T, branchId: B, to: '+15551230001', body: 'Your receipt', purpose: 'receipt', customerId: C2 });
    twilio.mode = 'ok';
    const orig = String(f.notificationId);
    expect(await code(center.retry(owner, orig, { idempotencyKey: 'retry-key-0001', confirm: false }))).toBe('NOTIFICATION_RETRY_CONFIRM_REQUIRED');
    expect(await code(center.retry(desk, orig, { idempotencyKey: 'retry-key-0001', confirm: true }))).toBe('PERMISSION_DENIED');
    const r1 = await center.retry(owner, orig, { idempotencyKey: 'retry-key-0001', confirm: true });
    expect(r1).toMatchObject({ outcome: 'sent', replayed: false, category: 'transient' });
    const again = await center.retry(owner, orig, { idempotencyKey: 'retry-key-0001', confirm: true });
    expect(again).toMatchObject({ outcome: 'sent', replayed: true, newNotificationId: r1.newNotificationId });
    const other = await center.retry(owner, orig, { idempotencyKey: 'retry-key-0002', confirm: true });
    expect(other).toMatchObject({ outcome: 'refused', refusalCode: 'NOTIFICATION_RETRY_ALREADY_RESENT' });
    const rows = await q(sql`select id, status, retry_of_notification_id, source_type from notifications where id in (${orig}, ${r1.newNotificationId})`);
    expect(rows.find((x: any) => x.id === orig).status).toBe('failed');   // the original failure stays as it was
    expect(rows.find((x: any) => x.id === r1.newNotificationId)).toMatchObject({ status: 'sent', retry_of_notification_id: orig, source_type: 'retry' });
    const d = await center.detail(owner, orig);
    expect(d.attempts.map((a: any) => a.status)).toEqual(['failed', 'sent']); expect(d.retry).toMatchObject({ eligible: false, code: 'NOTIFICATION_RETRY_ALREADY_RESENT' });
  });
  it('blocked retries: opted-out, invalid number, marketing, setup not re-checked, contact changed — each refused with its reason and audited', async () => {
    const mk = async (o: Partial<Parameters<typeof ledger>[0]>) => ledger({ to: '+15551230001', status: 'failed', customer: C2, at: ago(30), reason: 'fetch failed: ETIMEDOUT', ...o });
    expect((await center.retry(owner, await mk({ purpose: 'marketing' }), { idempotencyKey: 'retry-mkt-001', confirm: true })).refusalCode).toBe('NOTIFICATION_RETRY_MARKETING');
    expect((await center.retry(owner, await mk({ to: '7876299624', customer: null }), { idempotencyKey: 'retry-bad-001', confirm: true })).refusalCode).toBe('NOTIFICATION_RETRY_INVALID_RECIPIENT');
    const auth = await mk({ reason: 'sms_failed:Authentication failed, auth token is not valid', code: '20003', at: ago(60) });
    expect((await center.retry(owner, auth, { idempotencyKey: 'retry-auth-01', confirm: true })).refusalCode).toBe('NOTIFICATION_RETRY_SETUP_NOT_FIXED');
    readinessState = { account: { state: 'connected', lastCheckedAt: ago(15) }, sender: { state: 'assigned' }, outbound: { state: 'ready_to_attempt' } };
    expect((await center.retry(owner, auth, { idempotencyKey: 'retry-auth-02', confirm: true })).outcome).toBe('sent');   // re-checked after the failure → allowed
    expect((await center.retry(owner, await mk({ to: '+15550000077' }), { idempotencyKey: 'retry-chg-001', confirm: true })).refusalCode).toBe('NOTIFICATION_RETRY_CONTACT_CHANGED');
    // Nov 3 audit: an email sender failure (after_fix) also needs evidence — it used to be resendable straight away
    const sender = await ledger({ channel: 'email', to: 'maya@example.com', status: 'failed', customer: C2, at: ago(20), reason: 'The from address does not match a verified sender identity', subject: 'Receipt' });
    expect((await center.retry(owner, sender, { idempotencyKey: 'retry-esnd-01', confirm: true })).refusalCode).toBe('NOTIFICATION_RETRY_SETUP_NOT_FIXED');
    await q(sql`insert into email_health_checks (tenant_id, trigger_type, configuration, sender_identity, provider_health, callbacks, overall, detail) values (${T}, 'manual', 'ready_to_check', 'unknown', 'healthy', 'unknown', 'ready', 'ok')`);
    expect((await center.retry(owner, sender, { idempotencyKey: 'retry-esnd-02', confirm: true })).refusalCode ?? null).not.toBe('NOTIFICATION_RETRY_SETUP_NOT_FIXED');
    await svc.recordOptOut(systemContext({ tenantId: T, actor: 'twilio-inbound' }) as any, 'sms', '+15551230001', 'inbound_stop');
    expect((await center.retry(owner, await mk({}), { idempotencyKey: 'retry-opt-001', confirm: true })).refusalCode).toBe('NOTIFICATION_RETRY_OPTED_OUT');
    expect((await q(sql`select count(*)::int n from audit_events where tenant_id = ${T} and action = 'notification.retry_refused'`))[0].n).toBeGreaterThanOrEqual(4);
  });
});

describe('opt-outs (§07): history, STOP only undone by START, staff re-opt-in needs a note', () => {
  it('STOP is recorded as inbound_stop; staff cannot undo it; the customer START can', async () => {
    const ownerSvc = { tenantId: T, userId: OWNER, role: 'OWNER' } as any;   // POST /pos/notifications/opt-in (guard: communications.manage)
    expect(await code(svc.recordOptIn(ownerSvc, 'sms', '+15551230001', 'asked at the desk'))).toBe('NOTIFICATION_OPTIN_CUSTOMER_STOP');
    const cur = (await center.optOuts(owner, { q: '230001' })).items[0];
    expect(cur).toMatchObject({ source: 'inbound_stop', reOptIn: 'customer_only', matchingCustomers: 1 });
    await svc.recordOptIn(systemContext({ tenantId: T, actor: 'twilio-inbound' }) as any, 'sms', '+15551230001');
    expect((await center.optOuts(owner, { q: '230001' })).items).toEqual([]);
    const hist = (await center.optOuts(owner, { view: 'history', q: '230001' })).items.map((x: any) => [x.action, x.source]);
    expect(hist).toEqual([['opt_in', 'inbound_start'], ['opt_out', 'inbound_stop']]);
  });
  it('a staff-recorded email opt-out can be reversed only with a consent note; a viewer sees masked history', async () => {
    await svc.recordOptOut({ tenantId: T, userId: OWNER, role: 'OWNER' } as any, 'email', 'maya@example.com', 'asked to stop');
    const ownerSvc = { tenantId: T, userId: OWNER, role: 'OWNER' } as any;
    expect(await code(svc.recordOptIn(ownerSvc, 'email', 'maya@example.com', ''))).toBe('NOTIFICATION_OPTIN_NOTE_REQUIRED');
    await svc.recordOptIn(ownerSvc, 'email', 'maya@example.com', 'Signed the consent form at the desk');
    const h = (await center.optOuts(desk, { view: 'history', channel: 'email' })).items;
    expect(h[0]).toMatchObject({ action: 'opt_in', source: 'staff', recipient: 'm•••@example.com', consentNote: '•••', byName: 'Olive Owner' });
    expect((await center.optOuts(owner, { view: 'history', channel: 'email' })).items[0].consentNote).toBe('Signed the consent form at the desk');
  });
});

describe('unified customer timeline (§11)', () => {
  it('SMS + inbound reply + booking + reminder attempt + follow-up + receipt, one customer only (shared phone not merged), other salon 404', async () => {
    const th = (await q(sql`insert into communication_threads (tenant_id, branch_id, customer_id, customer_contact, channel, status, awaiting_reply_since) values (${T}, ${B}, ${C1}, '+917876299624', 'sms', 'open', now()) returning id`))[0].id;
    await q(sql`insert into communication_messages (tenant_id, thread_id, direction, channel, body, status) values (${T}, ${th}, 'inbound', 'sms', 'Can I come at 3?', 'delivered')`);
    await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${id('99')}, ${T}, ${B}, 'Tina', 'Tech', 'Tina Tech')`);
    const ap = (await q(sql`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, status) values (${T}, ${B}, ${id('99')}, ${C1}, 'Vishaal Kumar', '2026-10-31', '15:00', '16:00', 'booked') returning id`))[0].id;
    await q(sql`insert into appointment_reminder_attempts (tenant_id, appointment_id, channel, status, error) values (${T}, ${ap}, 'sms', 'failed', 'invalid_destination')`);
    await q(sql`insert into service_follow_up_tasks (tenant_id, branch_id, business_date, customer_id, technician_id, ticket_id, ticket_service_line_id, status, service_name_snapshot) values (${T}, ${B}, '2026-10-29', ${C1}, ${id('99')}, ${id('98')}, ${id('97')}, 'pending', 'Gel manicure')`);
    const tk = (await q(sql`insert into tickets (tenant_id, branch_id, customer_id, status) values (${T}, ${B}, ${C1}, 'paid') returning id`))[0].id;
    await q(sql`insert into receipts (tenant_id, branch_id, ticket_id, receipt_number) values (${T}, ${B}, ${tk}, 'R-1001')`);
    await q(sql`insert into receipt_delivery_logs (tenant_id, branch_id, ticket_id, channel, destination, status) values (${T}, ${B}, ${tk}, 'sms', '+917876299624', 'sent')`);
    await ledger({ to: '+917876299624', status: 'sent', customer: C3, at: ago(50) });   // Ravi shares the number — not Vishaal's
    const tl = await center.timeline(owner, C1, { pageSize: 50 });
    const kinds = new Set(tl.items.map((x: any) => x.kind));
    for (const k of ['notification', 'inbound_message', 'appointment', 'reminder_attempt', 'follow_up', 'receipt']) expect(kinds.has(k)).toBe(true);
    expect(tl.items.filter((x: any) => x.kind === 'notification').length).toBe(2);   // P0 blocked + the region refusal; not Ravi's
    expect(tl.items.find((x: any) => x.kind === 'inbound_message')).toMatchObject({ unresolved: true, link: `/tenant/communications/sms?thread=${th}` });
    expect((await center.timeline(owner, C1, { channel: 'receipt' })).items.map((x: any) => x.summary)).toEqual(['Receipt R-1001']);
    expect(await code(center.timeline(owner, CX))).toBe('CUSTOMER_NOT_FOUND');
    const masked = await center.timeline(desk, C1, { channel: 'sms' });
    expect(masked.items.find((x: any) => x.kind === 'inbound_message').summary).toBeNull();
  });
});

describe('automatic messaging failure alerts (§12)', () => {
  it('3 auth failures in 15 min → ONE critical incident; repeated evaluation updates it; ratio rule; resolved incidents cool down', async () => {
    const at = ago;
    for (const m of [10, 8, 6]) await ledger({ to: '+15551230002', status: 'failed', reason: 'sms_failed:Authentication failed', code: '20003', at: at(m) });
    await ledger({ to: '+15551230003', status: 'sent', provider: 'SMa1100000000000000000000000000001', at: at(5) });
    await ledger({ to: '+15551230004', status: 'sent', provider: 'SMa1200000000000000000000000000002', at: at(4) });
    const e1 = await evaluateMessagingIncidents(db, T, { now: NOW, readiness: null });
    const e2 = await evaluateMessagingIncidents(db, T, { now: NOW, readiness: null });
    expect(e1.opened).toBeGreaterThanOrEqual(2); expect(e2.opened).toBe(0);
    const open = (await center.incidents(owner, {})).items;
    const auth = open.find((x: any) => x.rule === 'repeated_failures' && x.category === 'auth')!;
    expect(auth).toMatchObject({ severity: 'critical', status: 'new', channel: 'sms' }); expect(auth.detections).toBeGreaterThanOrEqual(2);
    expect(open.filter((x: any) => x.rule === 'repeated_failures' && x.category === 'auth').length).toBe(1);
    expect(open.some((x: any) => x.rule === 'failure_ratio')).toBe(true);
    // resolve the ratio incident (as the existing owner-alert lifecycle would), then re-detect inside the cooldown: no new one
    const ratio = open.find((x: any) => x.rule === 'failure_ratio')!;
    await q(sql`update owner_alerts set status = 'resolved', resolved_at = ${new Date(NOW - 5 * 60_000).toISOString()}::timestamptz where id = ${ratio.id}`);
    await evaluateMessagingIncidents(db, T, { now: NOW, readiness: null });
    expect((await center.incidents(owner, {})).items.filter((x: any) => x.rule === 'failure_ratio')).toEqual([]);
    // invalid credentials from the readiness record → critical credential incident (no provider call)
    readinessState = { account: { state: 'invalid', lastCheckedAt: at(1) } };
    await evaluateMessagingIncidents(db, T, { now: NOW, readiness });
    expect((await center.incidents(owner, {})).items.some((x: any) => x.rule === 'credential_invalid' && x.severity === 'critical')).toBe(true);
    expect((await center.incidents(owner, { status: 'closed' })).items.map((x: any) => x.rule)).toEqual(['failure_ratio']);
  });
  it('alert thresholds are the salon\'s, clamped, saved with an audit row; disabled → nothing detected', async () => {
    const s = await center.saveAlertSettings(owner, { repeatedFailures: { count: 1, windowMinutes: 15 }, enabled: false });
    expect(s.settings.repeatedFailures.count).toBe(2); expect(s.settings.enabled).toBe(false);
    expect((await evaluateMessagingIncidents(db, T, { now: NOW, readiness: null })).detections).toEqual([]);
    expect(await code(center.saveAlertSettings(desk, { enabled: true }))).toBe('PERMISSION_DENIED');
    await center.saveAlertSettings(owner, { enabled: true });
  });
});

describe('health (§04, §12)', () => {
  it('distinct Twilio / sender / registration / webhooks / email / callbacks states; email not configured is Attention, never green', async () => {
    readinessState = { account: { state: 'connected', lastCheckedAt: ago(15) }, sender: { state: 'assigned' }, a2p: { state: 'pending', applicable: true }, outbound: { state: 'ready_to_attempt' }, inbound: { statusCallback: { state: 'untested' } } };
    const h = await center.health(owner);
    expect([h.twilio.state, h.sender.state, h.registration.state, h.webhooks.state, h.email.state]).toEqual(['ready', 'ready', 'pending', 'pending', 'attention']);
    expect(h.email.deliveryEvents).toBe('not_connected'); expect(h.callbacks.lastReceivedAt).not.toBeNull(); expect(h.overall).toBe('pending');
    expect(await code(center.checkHealth(desk))).toBe('PERMISSION_DENIED');
  });
});
