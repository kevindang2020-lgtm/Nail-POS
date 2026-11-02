// bv-extra.mjs — Communications → Booking Phone Verification in the catalog harness (Booking Phone Verification Complete Build Guide,
// Oct 30 2026, migration 743). REAL controllers on the seeded TEST database:
//   BookingVerificationSettingsController → BookingVerificationSettingsService (the photographed controls, + the high-value line)
//   BookingVerificationCenterController → BookingVerificationCenter (KPIs, health, live monitor, history, detail, resend)
//   BookingVerificationOverrideController → BookingVerificationOverrideService (the existing "approve without code")
// Fakes, tooling only, never shipped: the credential resolver (a salon Twilio row → "configured"; no secret is decrypted) and the
// code sender for an authorized resend (bumps the session's resend count like the real send — no SMS leaves this machine). The
// platform sender is never touched.
// Controls (GET /__bv?…): seed=1 → the screenshot's settings (verification OFF, 24-hour trust, 10-minute hold, special rules on), a
// tested salon Twilio row, live codes + holds (one expiring in 90 s), every history state and 24 more rows for paging ·
// state=1 → DB truth · reset=1 → this section's rows removed.
import { BookingVerificationSettingsController } from '../../modules/booking/src/customer-booking/booking-verification-settings.controller.ts';
import { BookingVerificationSettingsService } from '../../modules/booking/src/customer-booking/booking-verification-settings.service.ts';
import { KyselyVerificationSettingsStore } from '../../modules/booking/src/customer-booking/booking-verification-settings.kysely.ts';
import { BookingVerificationCenterController } from '../../modules/booking/src/customer-booking/booking-verification-center.controller.ts';
import { BookingVerificationCenter } from '../../modules/booking/src/customer-booking/booking-verification-center.ts';
import { BookingVerificationOverrideController } from '../../modules/booking/src/customer-booking/booking-verification-override.controller.ts';
import { BookingVerificationOverrideService } from '../../modules/booking/src/customer-booking/booking-verification-override.service.ts';
import { KyselyOverrideStore } from '../../modules/booking/src/customer-booking/booking-verification-override.kysely.ts';
import { phoneKey, maskPhone } from '../../modules/customers/src/customer-activation-rules/customer-activation-core.ts';

const P = 'b7430000-0000-4000-8000-';
const pid = (n) => P + String(n).padStart(12, '0');
export const BV = { ava: pid(1), bo: pid(2), lan: pid(3), svcHi: pid(4), svcLo: pid(5), cat: pid(6), open: pid(10), verified: pid(11), locked: pid(12), provider: pid(13), expired: pid(14), holdSoon: pid(20), holdLive: pid(21) };
const AVA = '+16095550142', BO = '+16095550177';

/** routes the decorator parser cannot read (bare @Get() / @Patch() / @Post(), or the permission on the next line) — registered by hand */
function bare(verb, path, perm, instance, method, params) {
  const keys = []; const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  return { verb, re, keys, perm, method, params, fn: instance[method].bind(instance) };
}

export function bvExtra(db, pg) {
  const q = (s, p = []) => pg.query(s, p);
  const audit = { record: async () => undefined };
  const creds = { resolve: async (t) => ((await q(`select 1 from tenant_messaging_credentials where tenant_id = $1 and provider = 'twilio' and status = 'configured'`, [t])).rows.length ? { status: 'configured', credentials: {} } : { status: 'missing' }) };
  const settings = new BookingVerificationSettingsService(new KyselyVerificationSettingsStore(db), creds, audit);
  const send = async (c) => {
    await q(`update booking_verification_sessions set resend_count = resend_count + 1, last_sent_at = now(), updated_at = now() where tenant_id = $1 and booking_session_id = $2`, [c.tenantId, c.bookingSessionId]);
    return { status: 'code_sent', message: 'A new code was sent (harness: no SMS leaves this machine).' };
  };
  const center = new BookingVerificationCenter(db, audit, send);

  async function session(T, B, o) {
    const ph = o.phone ?? AVA;
    await q(`insert into booking_verification_sessions (id, tenant_id, branch_id, booking_session_id, booking_hold_id, customer_id, phone_hash, phone_mask, channel, provider, status, expires_at, created_at, updated_at, last_sent_at, verified_at, policy_reason, failure_reason, attempt_count, policy_version, tenant_config_version)
      values (coalesce($1::uuid, gen_random_uuid()), $2, $3, gen_random_uuid(), $4, $5, $6, $7, $8, 'internal_otp', $9, now() + make_interval(mins => $10), now() - make_interval(mins => $11), now() - make_interval(mins => $11), now() - make_interval(mins => $11),
        case when $9 = 'verified' then now() - make_interval(mins => $11) end, $12, $13, $14, 'bpv-1', 3)`,
      [o.id ?? null, T, B, o.hold ?? null, o.customer === undefined ? BV.ava : o.customer, phoneKey(ph), maskPhone(ph), o.channel ?? 'online', o.status ?? 'sent', o.minutesLeft ?? 6, o.ago ?? 0, o.reason ?? null, o.failure ?? null, o.attempts ?? 0]);
  }
  async function hold(T, B, id, startIso, secondsLeft, svc) {
    await q(`insert into booking_holds (id, tenant_id, branch_id, technician_id, start_time, end_time, expires_at, status, booking_session_id, channel, service_ids_json)
      values ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz + interval '1 hour', now() + make_interval(secs => $6), 'held', gen_random_uuid(), 'online', $7::jsonb)`, [id, T, B, BV.lan, startIso, secondsLeft, JSON.stringify([svc])]);
  }

  return {
    routes: (routesOf) => {
      const sc = new BookingVerificationSettingsController(settings, db);
      const oc = new BookingVerificationOverrideController(new BookingVerificationOverrideService(new KyselyOverrideStore(db), audit));
      return [
        ...routesOf('modules/booking/src/customer-booking/booking-verification-settings.controller.ts', '/pos/settings/booking-phone-verification', sc),
        bare('GET', '/pos/settings/booking-phone-verification', 'settings.view', sc, 'get', ['req', 'query:branchId']),
        bare('PATCH', '/pos/settings/booking-phone-verification', 'settings.edit', sc, 'patch', ['req', 'body']),
        ...routesOf('modules/booking/src/customer-booking/booking-verification-center.controller.ts', '/pos/booking-verification-center', new BookingVerificationCenterController(center, settings)),
        bare('GET', '/pos/booking/verification-override/pending', 'pos.booking.verification_pending', oc, 'pending', ['req']),
        bare('POST', '/pos/booking/verification-override', 'pos.booking.override_verification', oc, 'override', ['req', 'body']),
      ];
    },
    async control(sp, T, B) {
      if (sp.get('reset')) {
        await q(`delete from booking_verification_sessions where tenant_id = $1`, [T]);
        await q(`delete from booking_holds where tenant_id = $1 and id::text like 'b7430000%'`, [T]);
        await q(`delete from booking_verification_settings where tenant_id = $1`, [T]);
        await q(`delete from tenant_messaging_credentials where tenant_id = $1 and account_sid = 'AChARNESS0000'`, [T]);
        await q(`delete from services where tenant_id = $1 and id::text like 'b7430000%'`, [T]);
        await q(`delete from service_categories where tenant_id = $1 and id::text like 'b7430000%'`, [T]);
        await q(`delete from technicians where tenant_id = $1 and id::text like 'b7430000%'`, [T]);
        await q(`delete from customers where tenant_id = $1 and id::text like 'b7430000%'`, [T]);
        return { reset: true };
      }
      if (sp.get('seed')) {
        await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values ($1, $3, $4, 'Ava', 'Kim', 'Ava Kim', $5, 'active'), ($2, $3, $4, 'Bo', 'Tran', 'Bo Tran', $6, 'active') on conflict (id) do nothing`, [BV.ava, BV.bo, T, B, AVA, BO]);
        await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1, $2, $3, 'Lan', 'Pham', 'Lan Pham') on conflict (id) do nothing`, [BV.lan, T, B]);
        await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1, $2, $3, 'BV Nails') on conflict (id) do nothing`, [BV.cat, T, B]);
        await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1, $3, $4, $5, 'Full Set Deluxe', 90, 18000), ($2, $3, $4, $5, 'Polish', 30, 2500) on conflict (id) do nothing`, [BV.svcHi, BV.svcLo, T, B, BV.cat]);
        // the salon's own Twilio row: other sections may already have seeded one (one default row per salon) — reuse it; else a tested one
        const cred = (await q(`select 1 from tenant_messaging_credentials where tenant_id = $1 and provider = 'twilio' and branch_id is null`, [T])).rows[0];
        if (!cred) await q(`insert into tenant_messaging_credentials (tenant_id, provider, account_sid, auth_token_enc, from_number, status, last_validated_at) values ($1, 'twilio', 'AChARNESS0000', 'enc', '+16095550100', 'configured', now() - interval '2 hours')`, [T]);
        else await q(`update tenant_messaging_credentials set last_validated_at = coalesce(last_validated_at, now() - interval '2 hours') where tenant_id = $1 and provider = 'twilio' and branch_id is null`, [T]);   // the enable rule needs a TESTED account (TEST database)
        // the screenshot: verification OFF, 24-hour trust, three special rules on, 10-minute hold
        await q(`insert into booking_verification_settings (tenant_id, branch_id, enabled, channel_online, channel_customer_app, channel_ai_receptionist, verify_every_booking, reverify_after_seconds,
            reverify_on_group_booking, reverify_on_deposit, reverify_on_high_value, hold_seconds, version) values ($1, null, false, true, true, true, false, 86400, true, true, true, 600, 1)`, [T]);
        await hold(T, B, BV.holdSoon, new Date(Date.now() + 86400_000).toISOString(), 90, BV.svcHi);
        await hold(T, B, BV.holdLive, new Date(Date.now() + 2 * 86400_000).toISOString(), 540, BV.svcLo);
        await session(T, B, { id: BV.open, hold: BV.holdSoon, minutesLeft: 8, reason: 'risk_high_value', attempts: 1 });
        await session(T, B, { hold: BV.holdLive, customer: BV.bo, phone: BO, channel: 'customer_app', minutesLeft: 9, reason: 'reverify_window_elapsed' });
        await session(T, B, { id: BV.verified, status: 'verified', customer: BV.bo, phone: BO, channel: 'customer_app', ago: 30 });
        await session(T, B, { id: BV.locked, status: 'locked', failure: 'too_many_attempts', minutesLeft: -2, ago: 50, attempts: 5 });
        await session(T, B, { id: BV.provider, status: 'failed', failure: 'provider_error:30007', customer: null, phone: '+16095550199', ago: 70, channel: 'ai_receptionist' });
        await session(T, B, { id: BV.expired, status: 'expired', minutesLeft: -60 * 24 * 40, ago: 60 * 24 * 40 });
        for (let i = 0; i < 24; i++) await session(T, B, { status: 'verified', customer: BV.bo, phone: BO, ago: 90 + i, channel: i % 3 === 0 ? 'online' : 'customer_app' });
        return { seeded: true, ids: BV };
      }
      if (sp.get('state')) {
        const s = (await q(`select enabled, reverify_after_seconds, hold_seconds, reverify_on_group_booking, reverify_on_deposit, reverify_on_high_value, high_value_threshold_cents, version from booking_verification_settings where tenant_id = $1 and branch_id is null`, [T])).rows[0] ?? null;
        const counts = (await q(`select count(*) filter (where status in ('pending','sent') and expires_at > now())::int as pending, count(*)::int as total,
            count(*) filter (where status = 'verified' and verified_at >= ((now() at time zone 'America/New_York')::date)::timestamp at time zone 'America/New_York')::int as verified_today
          from booking_verification_sessions where tenant_id = $1`, [T])).rows[0];
        const resends = (await q(`select resend_count from booking_verification_sessions where id = $1`, [BV.open])).rows[0]?.resend_count ?? null;
        const tw = (await q(`select status, last_validated_at is not null as validated, last_validation_error is not null as has_error from tenant_messaging_credentials where tenant_id = $1 and provider = 'twilio' and branch_id is null`, [T])).rows[0] ?? null;
        return { settings: s, ...counts, openResends: resends, twilio: tw };
      }
      return { ok: true };
    },
  };
}
