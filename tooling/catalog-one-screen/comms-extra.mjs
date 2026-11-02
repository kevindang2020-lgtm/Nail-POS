// comms-extra.mjs — the Phone & Messaging part of the catalog harness (Oct 30 2026): Phone & Messaging Center
// (/tenant/communications/phone) and Text Messaging Setup (/tenant/communications/messaging-setup) on the REAL
// TenantMessagingSelfController + credentials / readiness / number services + SQL, with a FAKE Twilio (an injected http —
// nothing leaves the machine: no SMS is sent, no number is bought, no account is called). Fixtures only.
//   Pilot: its own Twilio saved through the real save path (validated by the fake → a "save" check), a 10DLC sender, the
//   brand approved and the campaign in review (so Carrier Registration is Pending and texting Blocked), booking
//   verification on. Empty salon: nothing configured. Other salon: its own Twilio (never visible to Pilot).
//   Round 2 (Oct 30 2026): the fake also answers the READ-ONLY registration APIs (messaging.twilio.com: brand approved,
//   campaign in review, number not yet in the Messaging Service) and the seed runs one provider sync, so Carrier
//   Registration is Pending AS TWILIO CONFIRMED IT (PM-03); any POST there is refused (the app never submits).
import { TenantMessagingSelfController } from '../../modules/communications/src/tenant-messaging/tenant-messaging.tenant.controller.ts';
import { TenantMessagingCredentialsService } from '../../modules/communications/src/tenant-messaging/tenant-messaging-credentials.service.ts';
import { TenantMessagingReadinessService } from '../../modules/communications/src/tenant-messaging/tenant-messaging-readiness.service.ts';
import { TenantNumberService } from '../../modules/communications/src/tenant-messaging/tenant-number.service.ts';
import { TenantRegistrationSyncService } from '../../modules/communications/src/tenant-messaging/registration-sync.service.ts';
import { MessagingSetupController } from '../../modules/communications/src/tenant-messaging/messaging-setup-center.controller.ts';
import { testProviderSecrets } from '../../packages/testing/src/provider-secrets.ts';
import { PILOT, OTHER, OWNER_USER } from './seed.mjs';

export const COMMS = { acPilot: 'AC' + 'a1'.repeat(16), acOther: 'AC' + 'b2'.repeat(16), number: '+18565550123', va: 'VA' + 'c3'.repeat(16), buy: '+18565550188' };
process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL || 'https://api.pilot.test';
process.env.TWILIO_STATUS_CALLBACK_URL = process.env.TWILIO_STATUS_CALLBACK_URL || 'https://api.pilot.test/webhooks/twilio/sms/status';

const owned = new Set([COMMS.number, '+18565550456']);
let seq = 0;
const json = (b, status = 200) => new Response(JSON.stringify(b), { status });
/** the fake Twilio: the token "wrong-token" is refused; every other call answers like the real API would */
export const fakeTwilio = async (url, init = {}) => {
  const u = String(url);
  const pass = Buffer.from(String(init.headers?.Authorization ?? '').replace(/^Basic /, ''), 'base64').toString().split(':')[1];
  if (pass === 'wrong-token') return json({ message: 'Authenticate', code: 20003 }, 401);
  if (u.startsWith('https://messaging.twilio.com/')) {
    if (init.method === 'POST') return json({ message: 'the app never submits registration' }, 400);
    if (u.includes('/a2p/BrandRegistrations/')) return json({ sid: 'BN' + 'd4'.repeat(16), status: 'APPROVED', date_created: '2026-10-20T12:00:00Z' });
    if (u.endsWith('/Compliance/Usa2p')) return json({ compliance: [{ sid: 'QE' + 'e5'.repeat(16), campaign_status: 'IN_PROGRESS', date_created: '2026-10-28T12:00:00Z' }] });
    if (u.includes('/PhoneNumbers?')) return json({ phone_numbers: [] });
    if (/\/v1\/Services\/MG[0-9a-f]{32}$/.test(u)) return json({ sid: 'MG' + 'f6'.repeat(16), us_app_to_person_registered: false });
    if (u.includes('/Tollfree/Verifications?')) return json({ verifications: [] });
    return json({ message: 'not in the fake' }, 404);
  }
  if (u.startsWith('https://pricing.twilio.com/')) return json({ price_unit: 'usd', phone_number_prices: [{ number_type: 'local', base_price: '1.15', current_price: '1.15' }] });
  if (u.startsWith('https://verify.twilio.com/')) return json({ sid: COMMS.va, friendly_name: 'Pilot Nail Salon' });
  if (u.includes('/AvailablePhoneNumbers/')) return json({ available_phone_numbers: [
    { phone_number: COMMS.buy, friendly_name: '(856) 555-0188', locality: 'Cherry Hill', region: 'NJ', capabilities: { voice: true, SMS: true, MMS: true } },
    { phone_number: '+18565550189', friendly_name: '(856) 555-0189', locality: 'Voorhees', region: 'NJ', capabilities: { voice: true, SMS: true, MMS: false } }] });
  if (u.endsWith('/Messages.json') && init.method === 'POST') return json({ sid: 'SM' + String(++seq).padStart(32, '0'), status: 'queued' }, 201);
  if (u.endsWith('/IncomingPhoneNumbers.json') && init.method === 'POST') { const n = new URLSearchParams(String(init.body)).get('PhoneNumber'); owned.add(n); return json({ sid: 'PN' + String(++seq).padStart(32, '0'), phone_number: n }, 201); }
  if (u.includes('IncomingPhoneNumbers.json?PhoneNumber=')) {
    const n = decodeURIComponent(u.split('PhoneNumber=')[1]);
    return json({ incoming_phone_numbers: owned.has(n) ? [{ sid: 'PN' + 'a7'.repeat(16), phone_number: n, capabilities: { sms: true, voice: true, mms: true }, sms_url: `${process.env.PUBLIC_API_BASE_URL}/webhooks/twilio/sms/inbound` }] : [] });
  }
  if (u.includes('IncomingPhoneNumbers.json')) return json({ incoming_phone_numbers: [] });
  const m = u.match(/\/Accounts\/(AC[0-9a-f]{32})\.json$/);
  if (m) return json({ sid: m[1], status: 'active', type: 'Full' });
  return json({ message: 'not in the fake' }, 404);
};
const audit = { record: async () => ({}) };
const services = (db) => {
  const creds = new TenantMessagingCredentialsService(db, audit, testProviderSecrets); creds.http = fakeTwilio;
  const readiness = new TenantMessagingReadinessService(db, audit, testProviderSecrets); readiness.http = fakeTwilio; readiness.minIntervalMs = 2000;
  const numbers = new TenantNumberService(db, audit, testProviderSecrets); numbers.http = fakeTwilio;
  const sync = new TenantRegistrationSyncService(db, audit, testProviderSecrets); sync.http = fakeTwilio; sync.minIntervalMs = 2000;
  return { creds, readiness, numbers, sync };
};

export async function commsSeed(pg, db) {
  const { creds, sync } = services(db);
  const q = (s, p = []) => pg.query(s, p);
  await creds.set(OWNER_USER, PILOT, { accountSid: COMMS.acPilot, authToken: 'fixture-pilot-token', fromNumber: COMMS.number, verifyServiceSid: COMMS.va });
  await creds.set(OWNER_USER, OTHER, { accountSid: COMMS.acOther, authToken: 'fixture-other-token', fromNumber: '+18565550456' });
  await q(`insert into tenant_a2p_registrations (tenant_id, brand_sid, brand_status, campaign_sid, campaign_status, messaging_service_sid, status, updated_at)
    values ($1, 'BN' || repeat('d4', 16), 'APPROVED', 'QE' || repeat('e5', 16), 'IN_PROGRESS', 'MG' || repeat('f6', 16), 'campaign_submitted', now() - interval '2 days')`, [PILOT]);
  await q(`insert into booking_verification_settings (tenant_id, branch_id, enabled) values ($1, null, true)`, [PILOT]);
  await sync.refresh(PILOT, { trigger: 'scheduled', idempotencyKey: 'harness-seed-0001' });   // PM-03: what Twilio confirms
  // Text Messaging Setup guide §14–§16: 14 earlier test texts over 20 days (newest first: the oldest, •••6060, is beyond page 1)
  for (let i = 0; i < 14; i++) await q(`insert into sms_test_events (tenant_id, idempotency_key, destination_masked, destination_hash, sender, status, provider_message_sid, created_at, status_updated_at, delivered_at, config_source, account_sid_last4)
    values ($1, $2, $3, $4, $5, $6, $7, now() - make_interval(days => $8), now() - make_interval(days => $8), $9, 'tenant_default', right($10, 4))`,
    [PILOT, 'harness-hist-' + String(i).padStart(4, '0'), i === 13 ? '•••6060' : '•••' + String(8100 + i), 'hh' + i, COMMS.number, i % 3 === 0 ? 'delivered' : i % 5 === 0 ? 'undelivered' : 'accepted',
     'SM' + String(5000 + i).padStart(32, 'e'), 1 + i, i % 3 === 0 ? new Date(Date.now() - (1 + i) * 86400000 + 60000).toISOString() : null, COMMS.acPilot]);
  return { commsPilot: COMMS.number };
}

export function commsRoutes(db, routesOf) {
  const { creds, readiness, numbers, sync } = services(db);
  return [...routesOf('modules/communications/src/tenant-messaging/tenant-messaging.tenant.controller.ts', '/tenant/messaging', new TenantMessagingSelfController(creds, numbers, readiness, sync)),
    // Text Messaging Setup guide §11–§16: the six-part readiness, wizard, branch senders and setup history (read-only)
    ...routesOf('modules/communications/src/tenant-messaging/messaging-setup-center.controller.ts', '/tenant/messaging/setup', new MessagingSetupController(db, readiness))];
}

export const commsSql = (T) => ({
  checks: [`select trigger_kind, account_state, account_reason_code, sender_state from tenant_messaging_health_checks where tenant_id = $1 order by checked_at desc limit 10`, [T]],
  creds: [`select account_sid, md5(auth_token_enc) as token_hash, from_number, api_key_sid, config_version from tenant_messaging_credentials where tenant_id = $1 and branch_id is null`, [T]],
  smsTests: [`select status, destination_masked, provider_message_sid is not null as has_sid, idempotency_key, branch_id::text as branch_id, config_source, account_sid_last4 from sms_test_events where tenant_id = $1 order by created_at desc limit 10`, [T]],
  regSnaps: [`select item_kind, normalized_state, verified, source, error_class from tenant_messaging_registration_snapshots where tenant_id = $1 order by checked_at desc limit 20`, [T]],
  regRuns: [`select trigger_kind, outcome from tenant_messaging_registration_sync_runs where tenant_id = $1 order by started_at desc limit 10`, [T]],
  sidAudit: [`select count(*)::int as n from audit_events where tenant_id = $1 and action = 'tenant_credentials.sid_revealed'`, [T]],
  setupAlerts: [`select metadata->>'dedupeKey' as k, status from owner_alerts where tenant_id = $1 and metadata->>'rule' = 'sms_setup'`, [T]],
  quotes: [`select phone_number, consumed_at is not null as used, result_status, price_amount from tenant_number_purchase_quotes where tenant_id = $1 order by created_at desc limit 10`, [T]],
  numbers: [`select phone_number, status from tenant_messaging_numbers where tenant_id = $1 order by created_at`, [T]],
});
