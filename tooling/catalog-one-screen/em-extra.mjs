// em-extra.mjs — Communications → Email in the catalog harness (Email Complete Build Guide, Oct 31 2026, migration 748). REAL
// EmailCenterController → EmailCenter → NotificationsService.sendEmail (the ONE email path: settings, claim-before-send,
// suppression, marketing compliance) + CustomerNotificationsCenter (the protected resend) on the seeded TEST database. The
// provider is the MockEmailSender: every send is recorded as "simulated" — nothing leaves the machine.
// Two harness-only stand-ins (the stand-in loader has no Kysely query builder, which their real repositories need):
//   GET/PATCH /pos/settings/notifications-reminders  stores the same tenant_settings JSON the real route stores, with the
//       same email-identity validation, and (like the real read) REPLACES senderBrand with the SMS brand on GET — so the
//       screen proves it reads the email sender name from the Email Center, not from senderBrand
//   GET /pos/customers/search                         name / phone / email over this salon's customers (the composer picker)
// Controls (GET /__em?…): seed=1 · state=1 (DB truth) · deliver=1 (a verified "delivered" event for the booking confirmation,
// through applyEmailEvents — the signature itself is proven by the pgtest) · bounce=1 · reset=1.
import { MockEmailSender, MockSmsSender } from '../../packages/notifications/src/index.ts';
import { NotificationsService } from '../../modules/communications/src/notifications/notifications.service.ts';
import { KyselyNotificationsRepository } from '../../modules/communications/src/notifications/notifications.kysely.repository.ts';
import { KyselyOptOutRepository } from '../../modules/communications/src/notifications/notifications.optout.kysely.repository.ts';
import { CustomerNotificationsCenter } from '../../modules/communications/src/notifications/customer-notifications.ts';
import { EmailCenterController } from '../../modules/communications/src/email/email-center.controller.ts';
import { EmailCenter } from '../../modules/communications/src/email/email-center.ts';
import { KyselyEmailPolicy } from '../../modules/communications/src/email/email-policy.ts';
import { applyEmailEvents } from '../../modules/communications/src/email/email-events.ts';

const P = 'e7480000-0000-4000-8000-';
const pid = (n) => P + String(n).padStart(12, '0');
export const EM_AVA = pid(101), EM_BEN = pid(102), EM_STAFF_EMAIL = 'em-desk@pilot.test';
const ENV = { NODE_ENV: 'test', SENDGRID_FROM: 'nailsalons@aipowersalon.com', SENDGRID_WEBHOOK_VERIFICATION_KEY: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE' + 'A'.repeat(60) };

export function emExtra(db, pg) {
  const q = (s, p = []) => pg.query(s, p);
  const mail = new MockEmailSender();
  const policy = new KyselyEmailPolicy(db, ENV);
  const svc = new NotificationsService(new KyselyNotificationsRepository(db), new MockSmsSender(), mail, undefined, new KyselyOptOutRepository(db), undefined, undefined, policy);
  const cn = new CustomerNotificationsCenter(db, svc, null, ENV);
  const center = new EmailCenter(db, cn, svc, mail, policy, ENV);
  const DEFAULTS = { smsConfirmation: true, emailConfirmation: true, pushConfirmation: true, reminderHours: [24, 2], noShowFollowUp: true, receiptDelivery: ['SMS', 'Email'], senderBrand: 'AIPowerSalon', a2pStatus: 'registered', marketingOptInRequired: true };
  const stored = async (T) => { const r = (await q(`select settings_json from tenant_settings where tenant_id = $1 and branch_id is null and category = 'notifications'`, [T])).rows[0]; return r ? (typeof r.settings_json === 'string' ? JSON.parse(r.settings_json) : r.settings_json) : {}; };
  const settingsGet = async (req) => ({ ...DEFAULTS, ...(await stored(req.ctx.tenantId)), senderBrand: 'SMS Brand Co' });   // the real read swaps in the A2P brand
  const settingsPatch = async (body, req) => {
    const after = { ...(await stored(req.ctx.tenantId)), ...body };
    if (after.emailSenderName !== undefined && (!String(after.emailSenderName).trim() || /[\r\n<>"@]/.test(String(after.emailSenderName)))) { const e = new Error('Sender name must be 1–80 characters, without < > " @ or line breaks'); e.code = 'SETTING_VALUE_INVALID'; e.status = 400; throw e; }
    if (after.emailReplyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(after.emailReplyTo))) { const e = new Error('Reply-to must be a valid email address'); e.code = 'SETTING_VALUE_INVALID'; e.status = 400; throw e; }
    await q(`delete from tenant_settings where tenant_id = $1 and branch_id is null and category = 'notifications'`, [req.ctx.tenantId]);
    await q(`insert into tenant_settings (tenant_id, branch_id, category, settings_json, updated_at) values ($1, null, 'notifications', $2::jsonb, now())`, [req.ctx.tenantId, JSON.stringify(after)]);
    return { ...DEFAULTS, ...after, senderBrand: 'SMS Brand Co' };
  };
  const custSearch = async (req, query) => {
    const s = `%${String(query?.search ?? query?.q ?? '').trim()}%`;
    const rows = (await q(`select id, first_name, last_name, full_name, email, normalized_phone from customers where tenant_id = $1 and (full_name ilike $2 or coalesce(email,'') ilike $2 or coalesce(normalized_phone,'') ilike $2) order by full_name limit 8`, [req.ctx.tenantId, s])).rows;
    return { items: rows.map((r) => ({ customerId: r.id, displayName: r.full_name, firstName: r.first_name, lastName: r.last_name, email: r.email ?? '', phone: r.normalized_phone ?? '' })) };
  };
  return {
    routes: (routesOf) => [
      ...routesOf('modules/communications/src/email/email-center.controller.ts', '/pos/email-center', new EmailCenterController(center)),
      { verb: 'GET', re: /^\/pos\/settings\/notifications-reminders$/, keys: [], perm: 'settings.view', method: 'gNotif', params: ['req'], fn: settingsGet },
      { verb: 'PATCH', re: /^\/pos\/settings\/notifications-reminders$/, keys: [], perm: 'settings.edit', method: 'pNotif', params: ['body', 'req'], fn: settingsPatch },
      { verb: 'GET', re: /^\/pos\/customers\/search$/, keys: [], perm: 'customers.view', method: 'search', params: ['req', 'query'], fn: custSearch },
    ],
    async control(sp, T, B) {
      if (sp.get('reset')) {
        await q(`delete from notification_retry_requests where tenant_id = $1`, [T]);
        await q(`update notifications set retry_of_notification_id = null where tenant_id = $1 and channel = 'email'`, [T]);
        await q(`delete from email_send_keys where tenant_id = $1`, [T]);
        await q(`delete from notifications where tenant_id = $1 and channel = 'email'`, [T]);
        await q(`delete from notification_opt_outs where tenant_id = $1 and channel = 'email'`, [T]);
        await q(`delete from tenant_settings where tenant_id = $1 and category = 'notifications'`, [T]);
        mail.sent.length = 0; mail.verifyResult = { status: 'healthy', detail: 'Test sender (no provider).' };
        return { reset: true };   // append-only evidence (health checks, delivery / consent events) stays
      }
      if (sp.get('seed')) {
        await q(`update branches set address = coalesce(nullif(address, ''), '12 Elm St'), city = coalesce(city, 'Princeton'), state = coalesce(state, 'NJ'), zip = coalesce(zip, '08540') where id = $1`, [B]);
        await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1, $2, 'Dee Desk', $3, 'active', 'FRONT_DESK') on conflict (id) do nothing`, [pid(901), T, EM_STAFF_EMAIL]);
        await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, status) values ($1, $2, $3, 'Ava', 'Mailer', 'Ava Mailer', '+16095557101', 'ava.mailer@example.com', 'active'), ($4, $2, $3, 'Ben', 'Noemail', 'Ben Noemail', '+16095557102', null, 'active') on conflict (id) do nothing`, [EM_AVA, T, B, EM_BEN]);
        await settingsPatch({ emailSenderName: 'Pilot Nail Salon', emailConfirmation: true, receiptDelivery: ['SMS', 'Email'] }, { ctx: { tenantId: T } });
        // through the ONE email path — a booking confirmation, a receipt, a failed receipt (provider down), 24 history rows
        const conf = await svc.sendEmail({ tenantId: T, branchId: B, customerId: EM_AVA, to: 'ava.mailer@example.com', subject: 'Your appointment at Pilot Nail Salon — Thursday, November 5, 2026, 2:30 PM', body: 'Your appointment is confirmed.', purpose: 'notification', category: 'booking_confirmation', source: { type: 'appointment', id: pid(501) }, idempotencyKey: `booking_confirmation:${pid(501)}` });
        await q(`update notifications set status = 'sent', provider_id = 'SGemharness001' where id = $1`, [conf.notificationId]);   // as a real provider would accept it
        await svc.sendEmail({ tenantId: T, branchId: B, customerId: EM_AVA, to: 'ava.mailer@example.com', subject: 'Your receipt', body: 'Thanks for visiting! Total $55.00. Reference R-1001.', purpose: 'receipt', category: 'receipt', source: { type: 'ticket', id: pid(601) }, idempotencyKey: 'receipt:em-harness-R-1001' });
        const failed = await svc.sendEmail({ tenantId: T, branchId: B, customerId: EM_AVA, to: 'ava.mailer@example.com', subject: 'Your receipt', body: 'Thanks for visiting! Total $42.00. Reference R-1002.', purpose: 'receipt', category: 'receipt', source: { type: 'ticket', id: pid(602) } });
        await q(`update notifications set status = 'failed', failure_reason = 'email_failed:503', provider_id = null where id = $1`, [failed.notificationId]);
        for (let i = 1; i <= 24; i++) await svc.sendEmail({ tenantId: T, branchId: B, customerId: EM_AVA, to: 'ava.mailer@example.com', subject: `Aftercare tips #${String(i).padStart(2, '0')}`, body: 'Keep your nails moisturised.', purpose: 'notification', category: 'manual' });
        return { seeded: true, confirmation: conf.notificationId, failed: failed.notificationId };
      }
      // a receipt email attempt through the real path (what Checkout's email receipt now calls) — proves the toggle is honoured
      if (sp.get('receipt')) { const r = await svc.sendEmail({ tenantId: T, branchId: B, customerId: EM_AVA, to: 'ava.mailer@example.com', subject: 'Your receipt', body: 'Probe receipt', purpose: 'receipt', category: 'receipt', source: { type: 'ticket', id: pid(699) } }); return { sent: r.sent, status: r.status, reason: r.reason ?? null }; }
      if (sp.get('deliver')) return applyEmailEvents(db, [{ sg_message_id: 'SGemharness001.filter1', event: 'processed' }, { sg_message_id: 'SGemharness001.filter1', event: 'delivered', timestamp: Math.floor(Date.now() / 1000) }]);
      if (sp.get('verify')) { mail.verifyResult = sp.get('verify') === 'bad' ? { status: 'auth_failed', detail: 'The provider rejected the API key.' } : { status: 'healthy', detail: 'The provider accepted the API key.' }; return { verify: mail.verifyResult.status }; }
      if (sp.get('state')) {
        const rows = (await q(`select status, count(*)::int as n from notifications where tenant_id = $1 and channel = 'email' group by status order by status`, [T])).rows;
        const settings = await stored(T);
        const resends = (await q(`select count(*)::int as n from notifications where tenant_id = $1 and channel = 'email' and retry_of_notification_id is not null`, [T])).rows[0].n;
        const checks = (await q(`select count(*)::int as n from email_health_checks where tenant_id = $1`, [T])).rows[0].n;
        return { rows, settings, resends, checks, providerCalls: mail.sent.length, lastTo: mail.sent[mail.sent.length - 1]?.to ?? null };
      }
      return { ok: true };
    },
  };
}
