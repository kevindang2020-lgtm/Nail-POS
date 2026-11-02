// message-templates.pgtest — Message Templates & Automation Center guide (740) on the REAL schema, end to end:
//   P0  create → persist → retrieve → render the legacy [name] with the conversation's REAL customer → used by the existing
//       SMS Inbox reply path (one provider call, the usage row points at the notifications row) — guide §25 "HIGHEST PRIORITY"
//   validation (unknown / forbidden / category / subject / STOP), versions + optimistic conflict, duplicate, archive
//   preview never sends; Test Send is confirmed, idempotent, the salon's OWN sender only; opt-outs still apply
//   Automation Connection Center: only bindable workflows; Appointment Reminders reads its binding (Vietnamese and
//   missing-value fallbacks keep the built-in text); a bound template cannot be deactivated without a replacement
//   usage history search (phone digits / name / beyond page 1), the From/To calendar (inclusive salon-local end day),
//   tenant + branch isolation, permissions, the health check.
// Fakes only at the edges: the provider HTTP sender (records what would leave) and the readiness answer.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { MessageTemplatesCenter, TemplatesError, type TemplatesContext } from './message-templates';
import { renderTemplate, validateTemplate, fixtureValues } from './template-variables';
import { KyselyMessageTemplateStore } from '../../../tenants/src/settings/settings.templates.kysely';
import { InboxRepository, recordInboundSms, type InboxCtx } from '../inbox/inbox.repository';
import { InboxService } from '../inbox/inbox.service';
import { NotificationsService } from '../notifications/notifications.service';
import { KyselyNotificationsRepository } from '../notifications/notifications.kysely.repository';
import { KyselyOptOutRepository } from '../notifications/notifications.optout.kysely.repository';
import { RemindersService } from '../reminders/reminders.service';
import { KyselyRemindersRepository } from '../reminders/reminders.kysely.repository';
import { reminderTemplates } from '../reminders/reminders.module';
import { localDateTimeToEpochMs } from '../reminders/reminder-tz';

const P = 'd7400000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B1 = id('b1'), B2 = id('b2'), BX = id('b9');
const OWNER = id('e1'), DESK = id('e3'), OTHER = id('e4'), MANAGER2 = id('e5');
const JANE = id('c1'), MAI = id('c2'), OTHERC = id('c9'), TECH = id('f1');
const ALL = ['pos.communications.view', 'pos.communications.send', 'pos.communications.manage', 'pos.customers.view'];
const owner: TemplatesContext = { tenantId: T, branchId: null, userId: OWNER, role: 'OWNER', permissions: ALL };
const desk: TemplatesContext = { tenantId: T, branchId: B1, userId: DESK, role: 'RECEPTIONIST', permissions: ['pos.communications.view', 'pos.communications.send'] };
const branch2: TemplatesContext = { tenantId: T, branchId: B2, userId: MANAGER2, role: 'MANAGER', permissions: ALL };
const otherOwner: TemplatesContext = { tenantId: T2, branchId: null, userId: OTHER, role: 'OWNER', permissions: ALL };
const inboxOwner: InboxCtx = { tenantId: T, branchId: B1, userId: OWNER, role: 'OWNER', permissions: ALL, userName: 'Kim Owner', authz: { branchIds: null } };
let pg: any; let db: any; let center: MessageTemplatesCenter; let inbox: InboxService; let notifications: NotificationsService;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof TemplatesError ? e.code : (e as any)?.code ?? String((e as Error).message); } }

const sent: { to: string; body: string; from: string }[] = [];
let sidN = 0;
const tenantSender = { resolveSender: async (tenantId: string, branchId?: string | null) => {
  const r = await q(`select from_number from tenant_messaging_credentials where tenant_id = $1 and status = 'configured' and (branch_id is null or branch_id = $2) order by (branch_id is null) asc limit 1`, [tenantId, branchId ?? null]);
  const row = r.rows[0]; if (!row) return null;
  return { senderFrom: row.from_number, send: async (to: string, body: string) => { sent.push({ to, body, from: row.from_number }); return { sid: 'SM' + String(++sidN).padStart(32, '0'), segments: 1 }; } } as any;
} };
const platformCalls: string[] = [];
const platformSms = { send: async (to: string, body: string) => { platformCalls.push(to); sent.push({ to, body, from: 'PLATFORM' }); return { sid: 'SMplatform' + (++sidN) }; } } as any;
const emails: { to: string; subject: string }[] = [];
const email = { send: async (to: string, subject: string) => { emails.push({ to, subject }); return { id: 'EM' + (++sidN) }; } } as any;
const readiness = { readiness: async () => ({ source: 'tenant_default', outbound: { state: 'ready_to_attempt', reasonCode: null, blockers: [], warnings: [], deliveryTracking: true, fixLink: null } }) };
const realtime = { toTenant: () => undefined } as any;
const notifCount = async () => (await q(`select count(*)::int n from notifications where tenant_id = $1`, [T])).rows[0].n as number;

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status, business_phone) values ($1,'Lotus LLC','Lotus Nails','mt-lotus','MTL001','active','(215) 555-0100'), ($2,'Other LLC','Other Nails','mt-other','MTL002','active',null)`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone, phone) values ($1,$4,'Main','active','America/New_York','(215) 555-0111'), ($2,$4,'Cherry Hill','active','America/New_York',null), ($3,$5,'Other','active','America/New_York',null)`, [B1, B2, BX, T, T2]);
  await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$5,'Kim Owner','kim@mt.test','active','OWNER'), ($2,$5,'Rae Desk','rae@mt.test','active','RECEPTION'), ($3,$6,'Oz Other','oz@mt.test','active','OWNER'), ($4,$5,'Mo Manager','mo@mt.test','active','MANAGER')`, [OWNER, DESK, OTHER, MANAGER2, T, T2]);
  await q(`insert into customers (id, tenant_id, branch_id, full_name, first_name, last_name, normalized_phone, phone_display, email, status, preferred_language) values
    ($1,$4,$5,'Jane Lotus','Jane','Lotus','+12155550101','(215) 555-0101','jane@lotus.test','active','en'),
    ($2,$4,$5,'Mai Tran','Mai','Tran','+12155550102','(215) 555-0102',null,'active','vi'),
    ($3,$6,$7,'Jane Other','Jane','Other','+12155550101','(215) 555-0101','jane@other.test','active','en')`, [JANE, MAI, OTHERC, T, B1, T2, BX]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Lily','Pham','Lily Pham')`, [TECH, T, B1]);
  await q(`insert into tenant_messaging_credentials (tenant_id, branch_id, provider, account_sid, status, from_number) values ($1, null, 'twilio', 'AC' || repeat('a', 32), 'configured', '+18565550100')`, [T]);
  await q(`insert into tenant_messaging_numbers (tenant_id, branch_id, phone_number, channel, provider, status) values ($1, null, '+18565550100', 'sms', 'twilio', 'active')`, [T]);
  notifications = new NotificationsService(new KyselyNotificationsRepository(db), platformSms, email, undefined, new KyselyOptOutRepository(db), undefined, tenantSender as any);
  center = new MessageTemplatesCenter(db, notifications as any);
  inbox = new InboxService(new InboxRepository(db), notifications, readiness as any, realtime);
}, 180_000);

describe('P0 — the screen\'s empty state is real, and a template is created, saved, retrieved, rendered and USED', () => {
  let tplId: string;
  it('zero templates is verified from the database for THIS salon (another salon\'s rows never count)', async () => {
    await new KyselyMessageTemplateStore(db).upsert({ tenantId: T2, branchId: BX, userId: OTHER, role: 'OWNER', permissions: [] } as any, { channel: 'sms', name: 'Other salon hello', body: 'Hi [name]' });
    const l = await center.list(owner, {});
    expect(l.totalItems).toBe(0); expect(l.items).toEqual([]);
    expect((await center.summary(owner)).kpis).toMatchObject({ total: 0, active: 0, archived: 0 });
    const h = await center.healthCheck(owner, {});
    expect(h.findings.find((f) => f.key === 'templates_none')?.message).toMatch(/zero rows for this salon/);
  });
  it('the ORIGINAL form (legacy route: name, SMS, "[name]" body, Create) saves a real active template, version 1', async () => {
    const created = await new KyselyMessageTemplateStore(db).upsert({ tenantId: T, branchId: B1, userId: OWNER, role: 'OWNER', permissions: [] } as any, { channel: 'sms', name: 'Appointment confirmation', body: 'Hi [name], this is a reminder about your appointment at Lotus Nails.' });
    tplId = created!.id;
    expect(tplId).toMatch(/^tpl_/);
    const l = await center.list(owner, {});
    expect(l.totalItems).toBe(1); expect(l.items[0]).toMatchObject({ id: tplId, status: 'active', version: 1, channel: 'sms', legacyPlaceholders: true, createdByName: 'Kim Owner' });
    const d = await center.detail(owner, tplId);
    expect(d.versions.map((v) => v.version)).toEqual([1]);
    expect(d.validation.errors).toEqual([]);   // [name] is the documented alias of {customer_first_name}
  });
  it('the SMS Inbox composer gets it rendered for the conversation\'s REAL customer, and the reply records the exact version', async () => {
    const th = await recordInboundSms(db, { tenantId: T, from: '+12155550101', to: '+18565550100', body: 'Hi, can I come at 3?', messageSid: 'SM' + 'p'.repeat(32), numMedia: 0 });
    await q(`update communication_threads set customer_id = $1 where id = $2`, [JANE, th.threadId]);
    expect((await inbox.templates(inboxOwner)).items.map((x: any) => x.id)).toContain(tplId);
    const r = await center.renderForConversation(owner, th.threadId, tplId);
    expect(r.text).toBe('Hi Jane, this is a reminder about your appointment at Lotus Nails.');
    expect(r).toMatchObject({ version: 1, scope: 'salon', missing: [], unknown: [] });
    const before = sent.length;
    const rep = await inbox.reply(inboxOwner, th.threadId, r.text, 'key-mt-reply-01', tplId);
    expect(sent.length - before).toBe(1); expect(sent.at(-1)).toMatchObject({ to: '+12155550101', from: '+18565550100', body: r.text });
    expect(platformCalls).toEqual([]);
    const u = (await q(`select template_version, workflow, customer_id, thread_id, message_id, notification_id, send_outcome, rendered_body from pos_message_template_usage where tenant_id = $1 and template_id = $2`, [T, tplId])).rows;
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({ template_version: 1, workflow: 'sms_inbox', customer_id: JANE, thread_id: th.threadId, message_id: rep.message?.id, send_outcome: 'submitted', rendered_body: r.text });
    const n = (await q(`select status, purpose, body from notifications where id = $1`, [u[0].notification_id])).rows[0];
    expect(n).toMatchObject({ purpose: 'conversation', status: 'sent', body: r.text });
    const usage = await center.usage(owner, { templateId: tplId });
    expect(usage.items[0]).toMatchObject({ customerName: 'Jane Lotus', delivery: 'sent', version: 1, workflow: 'sms_inbox' });   // sent, NOT delivered: no provider event yet
    await q(`update notifications set status = 'delivered', delivered_at = now() where id = $1`, [u[0].notification_id]);
    expect((await center.usage(owner, { templateId: tplId })).items[0].delivery).toBe('delivered');
    expect((await center.summary(owner)).kpis.usedThisMonthMessages).toBe(1);
  });
});

describe('validation, versions, conflicts, duplicate, archive', () => {
  let a: string; let rv: number;
  it('unknown, forbidden and wrong-category variables; email subject; marketing STOP line', async () => {
    expect(await code(center.create(owner, { name: 'Bad', channel: 'sms', category: 'general', body: 'Hi {customer_nickname}' }))).toBe('TEMPLATE_INVALID');
    const draft = await center.create(owner, { name: 'Draft with typo', channel: 'sms', category: 'general', body: 'Hi {customer_nickname}', activate: false });
    expect(draft.template.status).toBe('draft'); expect(draft.validation.errors[0].code).toBe('TEMPLATE_VARIABLE_UNKNOWN');
    expect(await code(center.create(owner, { name: 'Code', channel: 'sms', body: 'Your code is {otp}', activate: false }))).toBe('TEMPLATE_VARIABLE_FORBIDDEN');
    expect(await code(center.create(owner, { name: 'Bday', channel: 'sms', category: 'birthday', body: 'Happy birthday {customer_first_name}! See you at {appointment_time}. Reply STOP to opt out.' }))).toBe('TEMPLATE_INVALID');
    expect(await code(center.create(owner, { name: 'Promo', channel: 'sms', category: 'promotions', body: '20% off this week at {salon_name}!' }))).toBe('TEMPLATE_INVALID');
    expect(await code(center.create(owner, { name: 'Mail', channel: 'email', category: 'receipt', body: 'Thanks {customer_first_name}' }))).toBe('TEMPLATE_INVALID');
    const ok = await center.create(owner, { name: 'Promo ok', channel: 'sms', category: 'promotions', body: '20% off this week at {salon_name}! Reply STOP to opt out.' });
    expect(ok.template.status).toBe('active');
  });
  it('an edit is a new version; a stale edit is a 409 with the current row, never an overwrite', async () => {
    const c = await center.create(owner, { name: 'Follow up', channel: 'sms', category: 'customer_follow_up', body: 'Hi {customer_first_name}, thanks for visiting {salon_name}!' });
    a = c.template.id; rv = c.template.recordVersion;
    const e1 = await center.update(owner, a, { recordVersion: rv, body: 'Hi {customer_first_name}, thank you for visiting {salon_name}! How was your {service_name}?' });
    expect(e1.template.version).toBe(2); expect(e1.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(e1.versions[1].body).toBe('Hi {customer_first_name}, thanks for visiting {salon_name}!');   // history is not rewritten
    const stale = await code(center.update(owner, a, { recordVersion: rv, name: 'Someone else\'s edit' }));
    expect(stale).toBe('TEMPLATE_VERSION_CONFLICT');
    expect((await center.detail(owner, a)).template.name).toBe('Follow up');
    rv = e1.template.recordVersion;
    expect(await code(center.update(owner, a, { recordVersion: rv, body: 'Hi {otp}' }))).toBe('TEMPLATE_VARIABLE_FORBIDDEN');
    expect(await code(center.update(owner, a, { recordVersion: rv, body: 'Hi {customer_nick}' }))).toBe('TEMPLATE_INVALID');   // active must stay valid
  });
  it('duplicate is a new draft; the source is untouched; archive keeps versions + usage and leaves the Inbox list', async () => {
    const d = await center.duplicate(owner, a);
    expect(d.template).toMatchObject({ status: 'draft', version: 1, name: 'Follow up (copy)' });
    expect((await center.detail(owner, a)).template.version).toBe(2);
    const cur = (await center.detail(owner, a)).template;
    const ar = await center.setStatus(owner, a, { to: 'archived', recordVersion: cur.recordVersion });
    expect(ar.template.status).toBe('archived'); expect(ar.versions).toHaveLength(2);
    expect((await inbox.templates(inboxOwner)).items.map((x: any) => x.id)).not.toContain(a);
    expect((await center.list(owner, {})).items.map((x) => x.id)).not.toContain(a);
    expect((await center.list(owner, { status: 'archived' })).items.map((x) => x.id)).toEqual([a]);
    expect(await code(center.update(owner, a, { recordVersion: ar.template.recordVersion, name: 'x' }))).toBe('TEMPLATE_ARCHIVED');
    expect(await code(center.setStatus(owner, a, { to: 'active', recordVersion: ar.template.recordVersion }))).toBe('TEMPLATE_STATUS_INVALID');
    const rs = await center.setStatus(owner, a, { to: 'inactive', recordVersion: ar.template.recordVersion });   // restore → inactive
    expect(rs.template.status).toBe('inactive');
  });
});

describe('preview never sends; Test Send is separate, confirmed, idempotent and the salon\'s own sender', () => {
  let t: string;
  it('preview with sample data, then with a real customer (customer access + audit), sends nothing', async () => {
    const c = await center.create(owner, { name: 'Reminder', channel: 'sms', category: 'appointment_reminder', body: 'Hi {customer_first_name}, see you {appointment_date} at {appointment_time} for {service_name} with {technician_name} 💅' });
    t = c.template.id;
    const n0 = await notifCount(), s0 = sent.length;
    const p = await center.preview(owner, { templateId: t });
    expect(p).toMatchObject({ source: 'sample', sent: false, version: 1 });
    expect(p.rendered.text).toBe('Hi Ava, see you Tue, Nov 3 at 2:30 PM for Gel Manicure with Lily 💅');
    expect(p.rendered.sms).toMatchObject({ encoding: 'UCS-2', segments: 1, perSegment: 70 });   // the emoji makes it Unicode: 70 per single part (not 160)
    expect(renderTemplate({ channel: 'sms', body: 'x'.repeat(70) + '💅' }, {}).sms).toMatchObject({ encoding: 'UCS-2', segments: 2, perSegment: 67 });
    await q(`insert into pos_tech_appointments (id, tenant_id, branch_id, customer_id, technician_id, customer_name, customer_phone, is_vip, source, services, appt_date, start_time, end_time, duration_minutes, status)
      values ($1,$2,$3,$4,$5,'Jane Lotus','+12155550101',false,'online','[{"serviceName":"Pedicure"}]','2026-11-12','15:00','16:00',60,'booked')`, [id('d1'), T, B1, JANE, TECH]);
    const real = await center.preview(owner, { templateId: t, customerId: JANE, appointmentId: id('d1') });
    expect(real.source).toBe('customer');
    expect(real.rendered.text).toBe('Hi Jane, see you Thu, Nov 12 at 3:00 PM for Pedicure with Lily 💅');
    expect(await code(center.preview(desk, { templateId: t, customerId: JANE }))).toBe('PERMISSION_DENIED');
    expect(await code(center.preview(owner, { templateId: t, customerId: OTHERC }))).toBe('CUSTOMER_NOT_FOUND');   // another salon's customer
    expect(await notifCount()).toBe(n0); expect(sent.length).toBe(s0);
    expect((await q(`select count(*)::int n from audit_events where tenant_id = $1 and action = 'message_template.preview_customer'`, [T])).rows[0].n).toBe(1);
    const gsm = renderTemplate({ channel: 'sms', body: 'Hi {customer_first_name}' }, fixtureValues());
    expect(gsm.sms).toMatchObject({ encoding: 'GSM-7', segments: 1 });
    const html = renderTemplate({ channel: 'email', subject: 'Hi {customer_first_name}', body: 'Hello {customer_full_name} <b>bold</b>' }, { customer_full_name: '<script>alert(1)</script>', customer_first_name: 'A' });
    expect(html.html).not.toContain('<script>'); expect(html.html).toContain('&lt;script&gt;'); expect(html.html).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });
  it('Test Send needs confirmation; one key = one message; never the platform sender; opt-outs apply', async () => {
    expect(await code(center.testSend(owner, t, { to: '(609) 555-0199' }, 'key-mt-test-0001'))).toBe('CONFIRMATION_REQUIRED');
    expect(await code(center.testSend(desk, t, { to: '(609) 555-0199', confirm: true }, 'key-mt-test-0001'))).toBe('PERMISSION_DENIED');
    const s0 = sent.length;
    const r1 = await center.testSend(owner, t, { to: '(609) 555-0199', confirm: true }, 'key-mt-test-0001');
    const r2 = await center.testSend(owner, t, { to: '(609) 555-0199', confirm: true }, 'key-mt-test-0001');
    expect(sent.length - s0).toBe(1); expect(sent.at(-1)).toMatchObject({ to: '+16095550199', from: '+18565550100' });
    expect(sent.at(-1)!.body).toContain('Hi Ava');   // SAMPLE data — never a real customer in a test
    expect(r1).toMatchObject({ status: 'submitted', target: '••• 0199', duplicate: false }); expect(r2).toMatchObject({ duplicate: true, testId: r1.testId });
    expect(platformCalls).toEqual([]);
    await notifications.recordOptOut({ tenantId: T, userId: OWNER, role: 'OWNER' } as any, 'sms', '+16095550177');
    const blocked = await center.testSend(owner, t, { to: '+16095550177', confirm: true }, 'key-mt-test-0002');
    expect(blocked.status).toBe('blocked'); expect(sent.length - s0).toBe(1);
    const noTwilio = await center.testSend({ ...otherOwner }, (await center.create(otherOwner, { name: 'X', channel: 'sms', body: 'Hello from {salon_name}' })).template.id, { to: '+16095550100', confirm: true }, 'key-mt-test-0003');
    expect(noTwilio).toMatchObject({ status: 'blocked', errorCode: 'not_configured' });   // no salon Twilio → refused, never the platform's
    expect(platformCalls).toEqual([]);
    const d = await center.detail(owner, t);
    expect(d.tests.map((x) => x.status).sort()).toEqual(['blocked', 'submitted']);
  });
});

describe('Automation Connection Center + Appointment Reminders read the binding', () => {
  let rem: string;
  it('only bindable workflows; the template must be active, same channel, right category', async () => {
    rem = (await center.create(owner, { name: 'Reminder (library)', channel: 'sms', category: 'appointment_reminder', body: 'Hi {customer_first_name}! {salon_name} reminder: {appointment_date} at {appointment_time} with {technician_name}.' })).template.id;
    expect(await code(center.bind(owner, { workflow: 'reschedule_cancellation', channel: 'sms', templateId: rem }))).toBe('WORKFLOW_NOT_BINDABLE');
    const promo = (await center.list(owner, { q: 'Promo ok' })).items[0].id;
    expect(await code(center.bind(owner, { workflow: 'appointment_reminder', channel: 'sms', templateId: promo }))).toBe('TEMPLATE_CATEGORY_MISMATCH');
    expect(await code(center.bind(desk, { workflow: 'appointment_reminder', channel: 'sms', templateId: rem }))).toBe('PERMISSION_DENIED');
    const s0 = sent.length;
    const b = await center.bind(owner, { workflow: 'appointment_reminder', channel: 'sms', templateId: rem });
    expect(b.sent).toBe(false); expect(sent.length).toBe(s0);   // assigning a template never sends anything
    const wf = b.workflows.find((w) => w.key === 'appointment_reminder')!;
    expect(wf.bindings).toHaveLength(1); expect(wf.bindings[0]).toMatchObject({ templateId: rem, version: 1, strategy: 'latest', healthy: true });
  });
  it('the reminder sender uses the bound template (with the STOP line) for every customer — customer messages are English only', async () => {
    const repo = new KyselyRemindersRepository(db);
    await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Hoa','Le','Hoa Le')`, [id('f2'), T, B1]);
    await repo.upsertConfig(T, { enabled: true, leadMinutes: 1440, windowMinutes: 60, channel: 'sms' });
    await q(`insert into pos_tech_appointments (id, tenant_id, branch_id, customer_id, technician_id, customer_name, customer_phone, is_vip, source, services, appt_date, start_time, end_time, duration_minutes, status) values
      ($1,$3,$4,$5,$7,'Jane Lotus','+12155550101',false,'online','[{"serviceName":"Gel"}]','2026-11-20','14:30','15:30',60,'booked'),
      ($2,$3,$4,$6,$8,'Mai Tran','+12155550102',false,'online','[{"serviceName":"Gel"}]','2026-11-20','14:30','15:30',60,'booked')`, [id('d2'), id('d3'), T, B1, JANE, MAI, TECH, id('f2')]);
    const svc = new RemindersService(repo, notifications as any, undefined, reminderTemplates(db));
    const start = localDateTimeToEpochMs('2026-11-20', '14:30', 'America/New_York');
    const s0 = sent.length;
    const run = await svc.runDueReminders(start - 1440 * 60_000 - 60_000);
    expect(run.fromTemplate).toBe(2);
    const out = sent.slice(s0);
    expect(out.find((m) => m.to === '+12155550101')?.body).toBe('Hi Jane! Lotus Nails reminder: Fri, Nov 20 at 2:30 PM with Lily. Reply STOP to opt out.');
    expect(out.find((m) => m.to === '+12155550102')?.body).toBe('Hi Mai! Lotus Nails reminder: Fri, Nov 20 at 2:30 PM with Hoa. Reply STOP to opt out.');   // preferred_language vi: still English (POS language mandate)
    const u = (await q(`select workflow, appointment_id, template_version, notification_id from pos_message_template_usage where tenant_id = $1 and template_id = $2`, [T, rem])).rows;
    expect(u.map((x: any) => x.appointment_id).sort()).toEqual([id('d2'), id('d3')].sort()); expect(u[0]).toMatchObject({ workflow: 'appointment_reminder', template_version: 1 });
    expect(u[0].notification_id).toBeTruthy();
  });
  it('a missing value keeps the built-in text (a broken template never reaches a customer)', async () => {
    const tid = (await center.create(owner, { name: 'Reminder w/ ref', channel: 'sms', category: 'appointment_reminder', body: 'Hi {customer_full_name}, ref {booking_reference}' })).template.id;
    await center.bind(owner, { workflow: 'appointment_reminder', channel: 'sms', templateId: tid });
    await q(`insert into pos_tech_appointments (id, tenant_id, branch_id, customer_id, technician_id, customer_name, customer_phone, is_vip, source, services, appt_date, start_time, end_time, duration_minutes, status) values
      ($1,$2,$3,null,$4,'','+12155550133',false,'online','[]','2026-11-21','10:00','11:00',60,'booked')`, [id('d4'), T, B1, TECH]);
    const svc = new RemindersService(new KyselyRemindersRepository(db), notifications as any, undefined, reminderTemplates(db));
    const s0 = sent.length;
    await svc.runDueReminders(localDateTimeToEpochMs('2026-11-21', '10:00', 'America/New_York') - 1440 * 60_000 - 60_000);
    expect(sent.slice(s0).find((m) => m.to === '+12155550133')?.body).toMatch(/^This is a reminder of your appointment|^this is a reminder|reminder of your appointment/i);
  });
  it('a bound template cannot be deactivated or archived without an explicit, valid replacement', async () => {
    const bound = (await center.connections(owner, null)).workflows.find((w) => w.key === 'appointment_reminder')!.bindings[0];
    const cur = (await center.detail(owner, bound.templateId)).template;
    expect(await code(center.setStatus(owner, bound.templateId, { to: 'inactive', recordVersion: cur.recordVersion }))).toBe('TEMPLATE_IN_USE');
    expect(await code(center.setStatus(owner, bound.templateId, { to: 'archived', recordVersion: cur.recordVersion, replacementTemplateId: rem }))).toBe('CONFIRMATION_REQUIRED');
    const promo = (await center.list(owner, { q: 'Promo ok' })).items[0].id;
    expect(await code(center.setStatus(owner, bound.templateId, { to: 'archived', recordVersion: cur.recordVersion, replacementTemplateId: promo, confirm: true }))).toBe('TEMPLATE_REPLACEMENT_INVALID');
    const r = await center.setStatus(owner, bound.templateId, { to: 'archived', recordVersion: cur.recordVersion, replacementTemplateId: rem, confirm: true });
    expect(r.movedBindings).toBe(1); expect(r.template.status).toBe('archived');
    expect((await center.connections(owner, null)).workflows.find((w) => w.key === 'appointment_reminder')!.bindings[0].templateId).toBe(rem);
  });
});

describe('library search, calendar, pages; usage search; isolation; health', () => {
  it('server-side search + filters + numbered pages; newest created first; a new template lands on page 1', async () => {
    for (let i = 1; i <= 12; i++) await center.create(owner, { name: `Bulk ${String(i).padStart(2, '0')}`, channel: i % 2 ? 'sms' : 'email', category: 'general', subject: i % 2 ? null : 'Hello', body: `Note ${i} from {salon_name}`, activate: i % 3 !== 0 });
    const p1 = await center.list(owner, { pageSize: 10 });
    expect(p1.items[0].name).toBe('Bulk 12'); expect(p1.totalPages).toBeGreaterThan(1);
    const p2 = await center.list(owner, { pageSize: 10, page: 2 });
    expect(new Set([...p1.items, ...p2.items].map((x) => x.id)).size).toBe(p1.items.length + p2.items.length);
    expect((await center.list(owner, { q: 'bulk 07' })).items.map((x) => x.name)).toEqual(['Bulk 07']);
    expect((await center.list(owner, { q: 'Note 11' })).items.map((x) => x.name)).toEqual(['Bulk 11']);   // a keyword inside the message
    expect((await center.list(owner, { channel: 'email', status: 'draft' })).items.map((x) => x.name)).toEqual(['Bulk 12', 'Bulk 06']);
    expect((await center.list(owner, { q: 'kim owner' })).totalItems).toBeGreaterThan(0);   // creator
    const fresh = await center.create(owner, { name: 'Zz newest', channel: 'sms', body: 'Hi {customer_first_name}' });
    expect((await center.list(owner, {})).items[0].id).toBe(fresh.template.id);
  });
  it('From/To: salon-local inclusive end day; reversed range refused', async () => {
    const tid = (await center.create(owner, { name: 'Late night', channel: 'sms', body: 'Hi' })).template.id;
    await q(`update pos_message_templates set created_at = '2026-03-08 23:30:00-04' where id = $1`, [tid]);   // 11:30 PM the day DST begins (New York)
    expect((await center.list(owner, { preset: 'custom', from: '2026-03-08', to: '2026-03-08' })).items.map((x) => x.id)).toEqual([tid]);
    expect((await center.list(owner, { preset: 'custom', from: '2026-03-09', to: '2026-03-09' })).items).toEqual([]);
    expect(await code(center.list(owner, { preset: 'custom', from: '2026-03-09', to: '2026-03-01' }))).toBe('DATE_RANGE_INVALID');
  });
  it('usage history: phone digits, name, template — beyond page 1; never another salon\'s', async () => {
    const tid = (await center.list(owner, { q: 'Appointment confirmation' })).items[0].id;
    for (let i = 0; i < 12; i++) await q(`insert into pos_message_template_usage (tenant_id, template_id, template_version, workflow, channel, customer_id, rendered_body, send_outcome, created_at)
      values ($1,$2,1,'sms_inbox','sms',$3,'Hi Jane','submitted', now() - ($4 || ' minutes')::interval)`, [T, tid, JANE, String(i + 5)]);
    const byPhone = await center.usage(owner, { q: '215-555-0101', templateId: tid, pageSize: 10 });
    expect(byPhone.totalItems).toBe(13); expect(byPhone.totalPages).toBe(2);
    expect((await center.usage(owner, { q: '215-555-0101', templateId: tid, pageSize: 10, page: 2 })).items).toHaveLength(3);
    expect((await center.usage(owner, { q: 'jane lotus', templateId: tid })).totalItems).toBe(13);
    expect((await center.usage(owner, { q: 'jane lotus' })).totalItems).toBe(14);   // + Jane's reminder the bound template produced
    expect((await center.usage(owner, { q: '215-555-0101', templateId: tid, status: 'delivered' })).totalItems).toBe(1);
    expect((await center.usage(owner, { q: '215-555-0101', templateId: tid, status: 'unknown' })).totalItems).toBe(12);   // no ledger row → Unknown, never Delivered
    expect((await center.usage(otherOwner, { q: '215-555-0101' })).totalItems).toBe(0);   // the other salon's Jane shares the number
    expect(await code(center.detail(otherOwner, tid))).toBe('TEMPLATE_NOT_FOUND');
    expect(await code(center.usage(otherOwner, { templateId: tid }))).toBe('TEMPLATE_NOT_FOUND');
  });
  it('branch scope + permissions: a branch template is invisible to another branch; read-only staff cannot write', async () => {
    const b1 = await center.create(owner, { name: 'Main only', channel: 'sms', body: 'Hi from Main', branchId: B1 });
    expect((await center.list(branch2, { q: 'Main only' })).totalItems).toBe(0);
    expect(await code(center.detail(branch2, b1.template.id))).toBe('TEMPLATE_NOT_FOUND');
    expect((await center.list(desk, { q: 'Main only' })).totalItems).toBe(1);
    expect(await code(center.create(desk, { name: 'x', channel: 'sms', body: 'y' }))).toBe('PERMISSION_DENIED');
    expect(await code(center.create(branch2, { name: 'x', channel: 'sms', body: 'y', branchId: B1 }))).toBe('PERMISSION_DENIED');
  });
  it('health check: an invalid active row, broken binding, sender facts — never a false green; nothing sent', async () => {
    await q(`update pos_message_templates set body = 'Hi {unknown_thing}' where tenant_id = $1 and name = 'Bulk 01'`, [T]);
    const s0 = sent.length;
    const h = await center.healthCheck(owner, {});
    expect(h.sent).toBe(false); expect(sent.length).toBe(s0);
    expect(h.findings.some((f) => f.key === 'template_invalid' && /Bulk 01/.test(f.message))).toBe(true);
    expect(h.findings.find((f) => f.key === 'sms_sender')?.status).toBe('attention');   // configured but never validated
    expect(h.findings.find((f) => f.key === 'email_sender')?.status).toBe('attention');
    expect(h.findings.some((f) => f.key === 'binding_ok')).toBe(true);
    expect(validateTemplate({ channel: 'sms', body: 'Hi [name]' }).warnings[0].code).toBe('TEMPLATE_LEGACY_PLACEHOLDER');
  });
});
