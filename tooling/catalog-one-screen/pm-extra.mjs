// pm-extra.mjs — Customers → Phone Number Management in the catalog harness (Phone Number Management Complete Build Guide, Oct 30 2026,
// migration 742). REAL controllers on the seeded TEST database:
//   PhoneCenterController → PhoneCenter (the new read model) · CustomerPhoneController → CustomerPhoneUpdateService → KyselyPhoneStore
//   (the existing state machine and atomic activation) · CustomerPhoneSettingsController → CustomerPhoneSettingsService (the seven controls).
// Fakes, tooling only, never shipped: the six-digit provider (accepts 123456 for the number it "texted"; writes the challenge row a real
// send writes — booking_verification_sessions — so tries / resend timers are real reads), the salon messenger (records the old-number
// notice on the notifications ledger with source 'phone_change'; nothing leaves the machine), and the outbox writer (raw SQL — the
// unit stand-in has no query builder; the real OutboxWriter is used everywhere else). The platform sender is never touched.
// Controls (GET /__pm?…): seed=1 → the screenshot's settings plus requests in every queue state, a shared family pair, a manual exception,
// a failed sync whose job gave up, and 26 history rows for paging · state=1 → DB truth · reset=1 → this section's rows removed.
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { PhoneCenterController } from '../../modules/booking/src/customer-phone/phone-center.controller.ts';
import { PhoneCenter } from '../../modules/booking/src/customer-phone/phone-center.ts';
import { CustomerPhoneController } from '../../modules/booking/src/customer-phone/customer-phone.controller.ts';
import { CustomerPhoneUpdateService } from '../../modules/booking/src/customer-phone/customer-phone-update.service.ts';
import { KyselyPhoneStore, KyselySyncPort, PHONE_JOB } from '../../modules/booking/src/customer-phone/customer-phone.kysely.ts';
import { KyselyPhoneNotifier } from '../../modules/booking/src/customer-phone/customer-phone-notify.ts';
import { CustomerPhoneSettingsController } from '../../modules/booking/src/customer-phone/customer-phone-settings.controller.ts';
import { CustomerPhoneSettingsService } from '../../modules/booking/src/customer-phone/customer-phone-settings.service.ts';
import { KyselyPhoneSettingsStore } from '../../modules/booking/src/customer-phone/customer-phone-settings.kysely.ts';
import { OutboxWriter } from '../../packages/events/src/outbox-writer.ts';
import { phoneKey, maskPhone } from '../../modules/customers/src/customer-activation-rules/customer-activation-core.ts';

const P = 'c7420000-0000-4000-8000-';
const pid = (n) => P + String(n).padStart(12, '0');
export const PM = { vishaal: pid(1), lan: pid(2), mai: pid(3), code: pid(4), expired: pid(5), retry: pid(6), review: pid(7), manual: pid(8), sync: pid(9), done: pid(10) };
const num = (n) => '+1856555' + String(7000 + n).slice(-4);

/** the stand-in has no query builder: the same outbox row the real writer inserts, as raw SQL (tooling only) */
class RawOutbox extends OutboxWriter {
  async write(trx, e) {
    await sql`insert into outbox_events (id, event_type, event_version, tenant_id, branch_id, aggregate_type, aggregate_id, aggregate_version, actor_id, actor_type, request_id, correlation_id, causation_id, payload_json, occurred_at)
      values (${e.eventId}, ${e.eventType}, ${e.eventVersion}, ${e.tenantId ?? null}, ${e.branchId ?? null}, ${e.aggregateType}, ${e.aggregateId}, ${e.aggregateVersion ?? null}, ${e.actorId ?? null}, ${e.actorType ?? null},
              ${e.requestId ?? null}, ${e.correlationId}, ${e.causationId ?? null}, ${JSON.stringify(e.payload)}::jsonb, ${e.occurredAt})`.execute(trx);
  }
}

function startRoute(c) {
  const keys = []; const re = new RegExp('^' + '/pos/customers/:customerId/phone'.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  return { verb: 'POST', re, keys, perm: 'pos.customers.edit', method: 'start', params: ['req', 'param:customerId', 'body'], fn: c.start.bind(c) };
}
function settingsRoutes(c) {
  const base = '/pos/settings/customer-phone';
  const r = (verb, sub, perm, method, params) => {
    const full = base + (sub ? '/' + sub : ''); const keys = [];
    const re = new RegExp('^' + full.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    return { verb, re, keys, perm, method, params, fn: c[method].bind(c) };
  };
  return [
    r('GET', '', 'settings.view', 'get', ['req', 'query:branchId']),
    r('PATCH', '', 'pos.customers.phone.settings', 'patch', ['req', 'body']),
    r('GET', 'branches/:branchId', 'settings.view', 'getBranch', ['req', 'param:branchId']),
    r('PATCH', 'branches/:branchId', 'pos.customers.phone.settings', 'patchBranch', ['req', 'param:branchId', 'body']),
    r('DELETE', 'branches/:branchId', 'pos.customers.phone.settings', 'clearBranch', ['req', 'param:branchId']),
  ];
}

export function pmExtra(db, pg) {
  const q = (s, p = []) => pg.query(s, p);
  // the six-digit provider fake: records the challenge like the real booking-verification send (hashed number, attempts, expiry)
  const sent = new Map();
  const otp = {
    async send(ctx, phone) {
      sent.set(ctx.bookingSessionId, phone);
      const ex = (await q(`select id from booking_verification_sessions where tenant_id = $1 and booking_session_id = $2`, [ctx.tenantId, ctx.bookingSessionId])).rows[0];
      if (ex) await q(`update booking_verification_sessions set status = 'sent', resend_count = resend_count + 1, last_sent_at = now(), expires_at = now() + interval '10 minutes', updated_at = now() where id = $1`, [ex.id]);
      else await q(`insert into booking_verification_sessions (tenant_id, branch_id, booking_session_id, customer_id, phone_hash, phone_mask, channel, provider, status, expires_at, last_sent_at)
        values ($1, $2, $3, $4, $5, $6, 'front_desk', 'internal_otp', 'sent', now() + interval '10 minutes', now())`, [ctx.tenantId, ctx.branchId, ctx.bookingSessionId, ctx.customerId, phoneKey(phone), maskPhone(phone)]);
      return { status: 'code_sent', message: 'A 6-digit code was sent (harness: no SMS leaves this machine).' };
    },
    async check(ctx, phone, code) {
      await q(`update booking_verification_sessions set attempt_count = attempt_count + 1, updated_at = now() where tenant_id = $1 and booking_session_id = $2`, [ctx.tenantId, ctx.bookingSessionId]);
      const ok = sent.get(ctx.bookingSessionId) === phone && code === '123456';
      if (ok) await q(`update booking_verification_sessions set status = 'verified', verified_at = now() where tenant_id = $1 and booking_session_id = $2`, [ctx.tenantId, ctx.bookingSessionId]);
      return ok ? { status: 'phone_verified', message: 'Verified.' } : { status: 'code_invalid', message: 'That code is not correct.' };
    },
  };
  const messenger = {
    async sendSms(m) {
      await q(`insert into notifications (tenant_id, channel, to_address, body, customer_id, status, provider_id, purpose, source_type, source_id) values ($1, 'sms', $2, $3, $4, 'sent', 'harness-fake', $5, $6, $7)`,
        [m.tenantId, m.to, m.body, m.customerId ?? null, m.purpose ?? null, m.source?.type ?? null, m.source?.id ?? null]);
      return { sent: true, simulated: true };
    },
  };
  const audit = { record: async () => undefined };
  const svc = new CustomerPhoneUpdateService(new KyselyPhoneStore(db, new RawOutbox()), otp, new KyselySyncPort(db), audit, new KyselyPhoneNotifier(db, messenger));
  const settings = new CustomerPhoneSettingsService(new KyselyPhoneSettingsStore(db), audit);
  const phoneCtl = new CustomerPhoneController(svc);

  async function customer(T, B, id, name, phone) {
    const [first, ...rest] = name.split(' ');
    await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, phone_verified_at, status) values ($1, $2, $3, $4, $5, $6, $7, $7, now() - interval '200 days', 'active')
      on conflict (id) do nothing`, [id, T, B, first, rest.join(' ') || 'Guest', name, phone]);
  }
  async function trusted(T, customerId, phone, provider = 'twilio_verify') {
    await q(`insert into customer_phones (tenant_id, customer_id, normalized_phone, phone_mask, phone_hash, status, verification_provider, verified_at, update_source, effective_from)
      values ($1, $2, $3, $4, $5, 'active_verified', $6, now() - interval '200 days', 'import', now() - interval '200 days')`, [T, customerId, phone, maskPhone(phone), phoneKey(phone), provider]);
  }
  /** a request exactly as the service leaves it (phone-center.pgtest uses the same shape) */
  async function request(T, B, customerId, newPhone, o = {}) {
    const state = o.state ?? 'pending_phone_saved';
    const proven = ['phone_verified', 'phone_activated', 'synchronization_failed', 'customer_records_synchronized'].includes(state);
    const old = (await q(`select id from customer_phones where tenant_id = $1 and customer_id = $2 and status in ('active_verified', 'active_unverified')`, [T, customerId])).rows[0];
    if (proven && old) await q(`update customer_phones set status = 'replaced' where id = $1`, [old.id]);
    const np = (await q(`insert into customer_phones (tenant_id, customer_id, normalized_phone, phone_mask, phone_hash, status, verification_provider, verified_at, update_source, effective_from)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() - make_interval(mins => $10)) returning id`,
      [T, customerId, newPhone, maskPhone(newPhone), phoneKey(newPhone), proven ? (o.provider === 'staff_override' ? 'active_unverified' : 'active_verified') : 'pending_verification',
        proven ? (o.provider ?? 'twilio_verify') : null, proven && o.provider !== 'staff_override' ? new Date(Date.now() - (o.ago ?? 0) * 60000).toISOString() : null, o.source ?? 'staff_pos', o.ago ?? 0])).rows[0].id;
    if (proven) await q(`update customers set normalized_phone = $1, phone_display = $1 where id = $2`, [newPhone, customerId]);
    const done = ['customer_records_synchronized', 'update_canceled'].includes(state);
    const id = o.id ?? randomUUID();
    await q(`insert into customer_phone_update_sessions (id, tenant_id, branch_id, customer_id, proposed_phone, proposed_phone_hash, proposed_phone_mask, previous_phone_id, new_phone_id, state, update_source,
        requested_by_user_id, requested_by_role, expires_at, created_at, updated_at, completed_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'RECEPTION', now() + make_interval(mins => $13), now() - make_interval(mins => $14), now() - make_interval(mins => $14), $15)`,
      [id, T, B, customerId, newPhone, phoneKey(newPhone), maskPhone(newPhone), old?.id ?? null, np, state, o.source ?? 'staff_pos', o.by ?? null, o.expiresIn ?? 30, o.ago ?? 0, done ? new Date().toISOString() : null]);
    return id;
  }

  return {
    routes: (routesOf) => [
      ...routesOf('modules/booking/src/customer-phone/phone-center.controller.ts', '/pos/customer-phone-center', new PhoneCenterController(new PhoneCenter(db))),
      ...routesOf('modules/booking/src/customer-phone/customer-phone.controller.ts', '/pos/customers/:customerId/phone', phoneCtl),
      startRoute(phoneCtl),   // bare @Post() — not read by the parser
      // the settings controller uses bare @Get() / @Patch() and shares its file with the Super Admin oversight controller, which the
      // harness parser does not read — its five routes are registered here with the same shape routesOf produces (same methods, same perms)
      ...settingsRoutes(new CustomerPhoneSettingsController(settings)),
    ],
    async control(sp, T, B, users) {
      if (sp.get('reset')) {
        await q(`delete from booking_verification_sessions where tenant_id = $1 and booking_session_id in (select id from customer_phone_update_sessions where tenant_id = $1 and customer_id::text like 'c7420000%')`, [T]);
        await q(`delete from jobs where tenant_id = $1 and job_type = $2`, [T, PHONE_JOB.sync]);
        await q(`delete from notifications where tenant_id = $1 and source_type = 'phone_change'`, [T]);
        await q(`delete from customer_phone_update_sessions where tenant_id = $1 and customer_id::text like 'c7420000%'`, [T]);
        await q(`delete from customer_phones where tenant_id = $1 and customer_id::text like 'c7420000%'`, [T]);
        await q(`delete from customers where tenant_id = $1 and id::text like 'c7420000%'`, [T]);
        await q(`delete from tenant_customer_phone_settings where tenant_id = $1`, [T]);
        return { reset: true };
      }
      if (sp.get('seed')) {
        // the screenshot's saved policy: the seven controls exactly as shown (manager approval / re-auth at their defaults)
        await q(`insert into tenant_customer_phone_settings (tenant_id, allow_receptionist_updates, customer_app_self_service, require_sms_verification, allow_pending_unverified, allow_manual_confirmation, allow_shared_family_phones, notify_old_number)
          values ($1, true, true, true, true, false, true, true) on conflict do nothing`, [T]);
        // a code sender for this test salon (TEST database only; the fake provider above is what actually "sends")
        const cred = (await q(`select 1 from tenant_messaging_credentials where tenant_id = $1 and provider = 'twilio' and branch_id is null`, [T])).rows[0];
        if (!cred) await q(`insert into tenant_messaging_credentials (tenant_id, provider, account_sid, auth_token_enc, from_number, status, last_validated_at) values ($1, 'twilio', 'AC_HARNESS', 'enc:harness', '+18565550000', 'configured', now())`, [T]);
        const C = (n, name, phone) => customer(T, B, pid(100 + n), name, phone).then(() => trusted(T, pid(100 + n), phone)).then(() => pid(100 + n));
        const by = users.DESK_USER;
        const v = await C(1, 'Vishaal Kumar', num(1));
        const lan = await C(2, 'Lan Tran', '+18565559900'); const mai = await C(3, 'Mai Tran', '+18565559900');   // a shared family number — two people
        PM.code = await request(T, B, await C(4, 'Hoa Nguyen', num(4)), num(54), { state: 'verification_sent', expiresIn: 8, ago: 2, by });
        PM.expired = await request(T, B, await C(5, 'Daisy Park', num(5)), num(55), { state: 'verification_sent', expiresIn: -5, ago: 40, by });
        PM.retry = await request(T, B, await C(6, 'Rosa Diaz', num(6)), num(56), { state: 'verification_failed', expiresIn: 20, ago: 10, by, source: 'customer_app' });
        PM.review = await request(T, B, await C(7, 'Kim Le', num(7)), num(57), { state: 'manager_review_required', expiresIn: 25, ago: 5, by });
        PM.manual = await request(T, B, await C(8, 'Grace Ho', num(8)), num(58), { state: 'customer_records_synchronized', provider: 'staff_override', ago: 300, by });
        PM.sync = await request(T, B, await C(9, 'Ivy Chen', num(9)), num(59), { state: 'synchronization_failed', ago: 90, by });
        await q(`insert into jobs (job_class, job_type, tenant_id, payload, idempotency_key, status, attempts, max_attempts, last_error) values ('standard', $1, $2, '{}'::jsonb, $3, 'dead', 8, 8, 'identity service unavailable (harness)')`, [PHONE_JOB.sync, T, 'sync:' + PM.sync]);
        PM.done = await request(T, B, await C(10, 'Marisol Ortega', num(10)), num(60), { state: 'customer_records_synchronized', ago: 30, by });
        await q(`insert into notifications (tenant_id, channel, to_address, body, status, provider_id, purpose, source_type, source_id, delivered_at) values ($1, 'sms', $2, 'notice', 'delivered', 'harness-fake', 'account', 'phone_change', $3, now())`, [T, num(10), PM.done]);
        for (let i = 0; i < 26; i++) await request(T, B, await C(20 + i, `History Guest${String(i).padStart(2, '0')}`, num(20 + i)), num(80 + i), { state: i % 3 === 0 ? 'update_canceled' : 'customer_records_synchronized', ago: 60 * 24 * (3 + i), by });
        Object.assign(PM, { vishaal: v, lan, mai });
        return { ...PM };
      }
      if (sp.get('state')) {
        const one = async (s, p) => (await q(s, p)).rows[0];
        const cid = sp.get('customer');
        return {
          ...(await one(`select
            (select count(distinct customer_id)::int from customer_phones where tenant_id = $1 and status = 'active_verified') as verified,
            (select count(*)::int from customer_phone_update_sessions where tenant_id = $1 and completed_at is null and state in ('phone_update_started','phone_validated','duplicate_check_completed','pending_phone_saved','verification_sent','verification_pending','verification_failed','verification_send_failed','twilio_not_configured','verification_expired','manager_review_required','duplicate_conflict') and (expires_at is null or expires_at > now())) as pending,
            (select count(*)::int from (select normalized_phone from customers where tenant_id = $1 and normalized_phone is not null and coalesce(status, 'active') <> 'archived' group by normalized_phone having count(*) > 1) x) as shared,
            (select count(*)::int from customer_phone_update_sessions where tenant_id = $1) as requests`, [T])),
          customer: cid ? await one(`select normalized_phone, (select string_agg(status, ',' order by status) from customer_phones where customer_id = $1) as phones from customers where id = $1`, [cid]) : null,
          settings: await one(`select allow_receptionist_updates, customer_app_self_service, require_sms_verification, allow_pending_unverified, allow_manual_confirmation, allow_shared_family_phones, notify_old_number from tenant_customer_phone_settings where tenant_id = $1 and branch_id is null`, [T]),
        };
      }
      return { ok: true };
    },
  };
}
