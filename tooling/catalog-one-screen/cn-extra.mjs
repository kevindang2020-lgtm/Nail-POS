// cn-extra.mjs — Communications → Customer Notifications in the catalog harness (Customer Notifications Complete Build Guide,
// Oct 30 2026, migration 741): the REAL CustomerNotificationsController → CustomerNotificationsCenter → SQL on the seeded TEST
// database, the REAL NotificationsService whose salon sender talks to the FAKE Twilio (comms-extra fakeTwilio — nothing leaves
// the machine; the platform's shared sender throws if anything reaches it), and the REAL TenantMessagingReadinessService.
// Tooling only — never shipped. The legacy opt-in route (POST /pos/notifications/opt-in) is served by the REAL
// NotificationsController too.
// Controls (GET /__cn?…): seed=1 → the reference screenshot's situation (3 sent to the same customer, an auth refusal, a
// "region not enabled" refusal to a number without +country code, an invalid number, an opted-out block) plus a delivered
// reminder, an unconfirmed text, a transient failure (the resend demo), an email bounce, a customer STOP, a staff email opt-out
// and 30 older reminders for paging · state=1 → DB truth · burst=1 → 3 auth refusals in the last minutes (an incident) ·
// reset=1 → this section's rows removed (test database only).
import { CustomerNotificationsController } from '../../modules/communications/src/notifications/customer-notifications.controller.ts';
import { CustomerNotificationsCenter, evaluateMessagingIncidents } from '../../modules/communications/src/notifications/customer-notifications.ts';
import { NotificationsController } from '../../modules/communications/src/notifications/notifications.controller.ts';
import { NotificationsService } from '../../modules/communications/src/notifications/notifications.service.ts';
import { KyselyNotificationsRepository } from '../../modules/communications/src/notifications/notifications.kysely.repository.ts';
import { KyselyOptOutRepository } from '../../modules/communications/src/notifications/notifications.optout.kysely.repository.ts';
import { KyselyTenantSmsSenderResolver } from '../../modules/communications/src/notifications/notifications.tenant-sender.ts';
import { TenantMessagingReadinessService } from '../../modules/communications/src/tenant-messaging/tenant-messaging-readiness.service.ts';
import { testProviderSecrets } from '../../packages/testing/src/provider-secrets.ts';
import { systemContext } from '../../packages/tenant-context/src/context.ts';
import { fakeTwilio } from './comms-extra.mjs';

export const CN_CUSTOMER = 'c7410000-0000-4000-8000-0000000000c1';
export const CN_OTHER = 'c7410000-0000-4000-8000-0000000000c2';
export const CN_PHONE = '+917876299624';

export function cnExtra(db, pg, { OWNER_USER }) {
  const platformNever = { send: async () => { throw new Error('harness: the platform sender is never used by Customer Notifications'); } };
  const notifications = new NotificationsService(new KyselyNotificationsRepository(db), platformNever, { send: async () => ({ id: 'EM-harness' }) }, undefined,
    new KyselyOptOutRepository(db), undefined, new KyselyTenantSmsSenderResolver(db, testProviderSecrets, fakeTwilio));
  const readiness = new TenantMessagingReadinessService(db, { record: async () => ({}) }, testProviderSecrets); readiness.http = fakeTwilio; readiness.minIntervalMs = 2000;
  const center = new CustomerNotificationsCenter(db, notifications, readiness, { SENDGRID_API_KEY: '' });
  const q = (s, p = []) => pg.query(s, p);
  const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
  async function ledger(T, B, r) {
    return (await q(`insert into notifications (tenant_id, channel, to_address, subject, body, customer_id, status, provider_id, failure_reason, provider_error_code, created_at, delivered_at, purpose, branch_id, source_type, source_id)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) returning id`,
      [T, r.channel ?? 'sms', r.to, r.subject ?? null, r.body ?? 'Hi Vishaal, this is a reminder of your appointment at Pilot Nail Salon. Reply STOP to opt out.', r.customer ?? null, r.status, r.provider ?? null,
        r.reason ?? null, r.code ?? null, r.at, r.delivered ?? null, r.purpose ?? null, B, r.source?.[0] ?? null, r.source?.[1] ?? null])).rows[0].id;
  }
  const sid = (n) => 'SM' + String(n).padStart(32, 'a1');
  return {
    routes: (routesOf) => [
      ...routesOf('modules/communications/src/notifications/customer-notifications.controller.ts', '/pos/customer-notifications', new CustomerNotificationsController(center)),
      ...routesOf('modules/communications/src/notifications/notifications.controller.ts', '/pos/notifications', new NotificationsController(notifications)),
    ],
    async control(sp, T, B) {
      if (sp.get('reset')) {
        await q(`delete from notification_retry_requests where tenant_id = $1`, [T]);
        await q(`update notifications set retry_of_notification_id = null where tenant_id = $1`, [T]);
        await q(`delete from notifications where tenant_id = $1`, [T]);
        await q(`delete from notification_opt_outs where tenant_id = $1`, [T]);
        await q(`delete from owner_alerts where tenant_id = $1 and category = 'messaging_failure'`, [T]);
        await q(`delete from tenant_settings where tenant_id = $1 and category = 'notification_alerts'`, [T]);
        return { reset: true };   // append-only evidence (delivery / consent events) stays — that is the point of it
      }
      if (sp.get('seed')) {
        await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, status) values ($1, $2, $3, 'Vishaal', 'Kumar', 'Vishaal Kumar', $4, 'vishaal@example.com', 'active') on conflict (id) do nothing`, [CN_CUSTOMER, T, B, CN_PHONE]);
        await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, status) values ($1, $2, $3, 'Maya', 'Lee', 'Maya Lee', '+15551230001', 'maya@example.com', 'active') on conflict (id) do nothing`, [CN_OTHER, T, B]);
        for (let i = 0; i < 30; i++) await ledger(T, B, { to: '+15551230001', customer: CN_OTHER, status: 'delivered', provider: sid(100 + i), at: ago(60 * 24 * 3 + i * 30), delivered: ago(60 * 24 * 3 + i * 30 - 1), purpose: 'reminder' });
        const ids = {};
        ids.sent1 = await ledger(T, B, { to: CN_PHONE, customer: CN_CUSTOMER, status: 'delivered', provider: sid(1), at: ago(300), delivered: ago(299), purpose: 'reminder' });
        ids.sent2 = await ledger(T, B, { to: CN_PHONE, customer: CN_CUSTOMER, status: 'sent', provider: sid(2), at: ago(30), purpose: 'receipt', body: 'Thanks for visiting Pilot Nail Salon. Receipt R-1001.' });
        ids.sent3 = await ledger(T, B, { to: CN_PHONE, customer: CN_CUSTOMER, status: 'sent', provider: sid(3), at: ago(60 * 30), purpose: 'reminder' });
        ids.auth = await ledger(T, B, { to: '+917876299622', status: 'failed', at: ago(240), purpose: 'reminder', code: '20003', reason: 'sms_failed:Authentication failed, auth token is not valid for account AC' + '0123456789abcdef0123456789abcdef' });
        ids.region = await ledger(T, B, { to: '7876299624', customer: CN_CUSTOMER, status: 'failed', at: ago(250), purpose: 'reminder', reason: "sms_failed:Permission to send an SMS has not been enabled for the region indicated by the 'To' number: 7876299624" });
        ids.invalid = await ledger(T, B, { to: '+18000000003', status: 'failed', at: ago(260), purpose: 'notification', reason: "sms_failed:The 'To' number +18000000003 is not a valid phone number." });
        ids.transient = await ledger(T, B, { to: CN_PHONE, customer: CN_CUSTOMER, status: 'failed', at: ago(20), purpose: 'receipt', reason: 'fetch failed: ETIMEDOUT', body: 'Your Pilot Nail Salon receipt R-1002.' });
        ids.email = await ledger(T, B, { channel: 'email', to: 'maya@example.com', customer: CN_OTHER, status: 'failed', at: ago(90), purpose: 'receipt', subject: 'Your receipt', reason: '550 mailbox unavailable (hard bounce)' });
        await notifications.recordOptOut(systemContext({ tenantId: T, actor: 'twilio-inbound' }), 'sms', '+15559871234', 'inbound_stop');
        ids.blocked = await ledger(T, B, { to: '+15559871234', status: 'blocked', at: ago(15), purpose: 'reminder', reason: 'opted_out' });
        await notifications.recordOptOut({ tenantId: T, userId: OWNER_USER, role: 'OWNER' }, 'email', 'maya@example.com', 'asked at the desk');
        await q(`insert into notification_delivery_events (tenant_id, notification_id, provider_message_sid, provider_status, applied, signature_verified, received_at) values ($1, $2, $3, 'delivered', true, true, $4) on conflict do nothing`, [T, ids.sent1, sid(1), ago(299)]);
        return ids;
      }
      if (sp.get('evaluate')) return evaluateMessagingIncidents(db, T, { readiness }).then((r) => ({ opened: r.opened, updated: r.updated, rules: r.detections.map((d) => d.rule + ':' + (d.category ?? '')) }));
      if (sp.get('burst')) {
        for (const m of [6, 4, 2]) await ledger(T, B, { to: '+917876299622', status: 'failed', at: ago(m), purpose: 'reminder', code: '20003', reason: 'sms_failed:Authentication failed' });
        return { burst: 3 };
      }
      if (sp.get('state')) {
        return (await q(`select
            (select count(*)::int from notifications where tenant_id = $1) as rows,
            (select count(*)::int from notifications where tenant_id = $1 and (status in ('sent','delivered') or (status = 'failed' and provider_id is not null))) as accepted,
            (select count(*)::int from notifications where tenant_id = $1 and status = 'delivered') as delivered,
            (select count(*)::int from notifications where tenant_id = $1 and status = 'failed') as failed,
            (select count(*)::int from notifications where tenant_id = $1 and status = 'blocked') as blocked,
            (select count(*)::int from notifications where tenant_id = $1 and retry_of_notification_id is not null) as resends,
            (select count(*)::int from notification_retry_requests where tenant_id = $1) as retry_requests,
            (select count(*)::int from notification_opt_outs where tenant_id = $1) as opt_outs,
            (select count(*)::int from notification_consent_events where tenant_id = $1 and action = 'opt_in' and source = 'staff') as staff_opt_ins,
            (select count(*)::int from owner_alerts where tenant_id = $1 and category = 'messaging_failure' and status in ('new','acknowledged','in_progress')) as open_incidents,
            (select count(*)::int from audit_events where tenant_id = $1 and action like 'notification.%') as audits`, [T])).rows[0];
      }
      return { ok: true };
    },
  };
}
