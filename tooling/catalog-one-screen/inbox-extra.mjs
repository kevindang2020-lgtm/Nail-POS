// inbox-extra.mjs — the Communications / SMS Inbox part of the catalog harness (Oct 30 2026, Communications guide + Addendum):
// /tenant/communications/sms on the REAL InboxController + InboxService + InboxRepository + SQL, the REAL NotificationsService
// (one SMS path, ledger, opt-outs) whose tenant sender talks to the FAKE Twilio (comms-extra fakeTwilio — nothing leaves the
// machine), the REAL TenantMessagingReadinessService, and the REAL signed Twilio webhook (TwilioInboundService) for inbound
// texts and delivery callbacks. Fixtures only — no real customer, phone or message.
//   Pilot: 30 conversations (linked customers, an Unknown contact waiting 2 days, a shared-number "possible match", a failed
//   reply, a closed one, an email and a missed call, one assigned to the front desk) and one customer (Mai Le) with a full
//   timeline: texts, a delivered reply, a reminder, a review request, an AI call with its summary and an appointment.
//   Empty salon: nothing. Other salon: a conversation with Mai Le's number (must never show for Pilot).
// Harness-only controls (said so on purpose): /__inbox?inbound=+1…&body=… (a SIGNED inbound text through the real webhook) ·
// /__inbox?status=SM…&s=delivered|failed|undelivered (a SIGNED status callback) · /__inbox?ready=1|0 (readiness override:
// Pilot's carrier campaign is really "in review" in these fixtures, so sending is truthfully BLOCKED unless this switch says
// otherwise — the send itself still goes through the real messenger to the fake Twilio).
import { InboxController } from '../../modules/communications/src/inbox/inbox.controller.ts';
import { InboxService } from '../../modules/communications/src/inbox/inbox.service.ts';
import { InboxRepository } from '../../modules/communications/src/inbox/inbox.repository.ts';
import { CommunicationsActivityService } from '../../modules/communications/src/communications/communications-activity.service.ts';
import { NotificationsService } from '../../modules/communications/src/notifications/notifications.service.ts';
import { KyselyNotificationsRepository } from '../../modules/communications/src/notifications/notifications.kysely.repository.ts';
import { KyselyOptOutRepository } from '../../modules/communications/src/notifications/notifications.optout.kysely.repository.ts';
import { KyselyTenantSmsSenderResolver } from '../../modules/communications/src/notifications/notifications.tenant-sender.ts';
import { TenantMessagingReadinessService } from '../../modules/communications/src/tenant-messaging/tenant-messaging-readiness.service.ts';
import { TwilioInboundService } from '../../modules/communications/src/messaging-inbound/twilio-inbound.service.ts';
import { computeTwilioSignature } from '../../packages/notifications/src/twilio-inbound-core.ts';
import { testProviderSecrets } from '../../packages/testing/src/provider-secrets.ts';
import { fakeTwilio, COMMS } from './comms-extra.mjs';
import { PILOT, OTHER, BRANCH, BRANCH_O, DESK_USER, OWNER_USER, TECH, id } from './seed.mjs';

const H = 3600_000, D = 86_400_000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
export const INBOX = { mai: null, unknown: '+12675550142', shared: '+18565559876', failedSid: 'SM' + '9'.repeat(32) };
let readyOverride = false;
const silent = { toTenant: () => undefined };

export async function inboxSeed(pg) {
  const q = (s, p = []) => pg.query(s, p);
  const cust = (await q(`select id, full_name, normalized_phone from customers where tenant_id = $1 and full_name not like '%Elsewhere%' order by full_name limit 40`, [PILOT])).rows;
  const mai = cust.find((c) => c.full_name === 'Mai Le') ?? cust[0]; INBOX.mai = mai.id;
  await q(`insert into tenant_messaging_numbers (tenant_id, branch_id, phone_number, channel, provider, status) values ($1, null, $2, 'sms', 'twilio', 'active') on conflict do nothing`, [PILOT, COMMS.number]).catch(() => undefined);
  // two customers share one number → an inbound from it is a "possible match", never linked by guess
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display) values ($1,$3,$4,'Hana','Tran','Hana Tran',$5,'(856) 555-9876'), ($2,$3,$4,'Hien','Tran','Hien Tran','8565559876','856-555-9876')`, [id('d7970000', 1), id('d7970000', 2), PILOT, BRANCH, INBOX.shared]);
  const thread = async (o) => (await q(`insert into communication_threads (tenant_id, branch_id, customer_id, customer_name, customer_contact, contact_normalized, customer_match, channel, status, assigned_to, assigned_to_name, created_at, follow_up_due_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`, [o.tenant ?? PILOT, o.branch ?? BRANCH, o.customer ?? null, o.name ?? null, o.contact, o.channel === 'email' ? null : o.contact, o.match ?? (o.customer ? 'exact_phone' : 'none'), o.channel ?? 'sms', o.status ?? 'open', o.assigned ?? null, o.assignedName ?? null, o.created, o.followUp ?? null])).rows[0].id;
  const msg = async (t, o) => {
    let nid = null;
    if (o.ledger) nid = (await q(`insert into notifications (tenant_id, channel, to_address, body, customer_id, status, provider_id, provider_status, failure_reason, provider_error_code, purpose, created_at, delivered_at)
      values ($1,'sms',$2,$3,$4,$5,$6,$7,$8,$9,'conversation',$10,$11) returning id`, [o.tenant ?? PILOT, o.to, o.body, o.customer ?? null, o.ledger.status, o.ledger.sid ?? null, o.ledger.provider ?? null, o.ledger.reason ?? null, o.ledger.code ?? null, o.at, o.ledger.status === 'delivered' ? o.at : null])).rows[0].id;
    await q(`insert into communication_messages (tenant_id, thread_id, direction, channel, body, author_user_id, author_name, author_kind, status, notification_id, created_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [o.tenant ?? PILOT, t, o.dir, o.channel ?? 'sms', o.body, o.dir === 'outbound' ? OWNER_USER : null, o.dir === 'outbound' ? (o.author ?? 'Pat Owner') : null, o.dir === 'outbound' ? (o.kind ?? 'staff') : 'customer', o.dir === 'outbound' ? (o.mstatus ?? 'sent') : 'delivered', nid, o.at]);
  };
  // Mai Le — the full customer timeline
  const tMai = await thread({ customer: mai.id, name: mai.full_name, contact: mai.normalized_phone, created: ago(6 * D) });
  await msg(tMai, { dir: 'inbound', body: 'Hi! Do you have time for a gel manicure this week?', at: ago(6 * D) });
  await msg(tMai, { dir: 'outbound', body: 'Hi Mai! Yes — Thursday 2 pm or Friday 11 am. Which works?', at: ago(6 * D - 20 * 60_000), to: mai.normalized_phone, customer: mai.id, ledger: { status: 'delivered', sid: 'SM' + '1'.repeat(32), provider: 'delivered' } });
  await msg(tMai, { dir: 'inbound', body: 'Friday 11 please', at: ago(6 * D - 50 * 60_000) });
  await q(`insert into notifications (tenant_id, channel, to_address, body, customer_id, status, provider_id, provider_status, purpose, created_at, delivered_at) values ($1,'sms',$2,'Reminder: Gel Manicure Fri 11:00 at Pilot Nail Salon. Reply C to confirm.',$3,'delivered','SMrem0001','delivered','reminder',$4,$4)`, [PILOT, mai.normalized_phone, mai.id, ago(4 * D)]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Anna','Lee','Anna Lee') on conflict (id) do nothing`, [TECH.anna, PILOT, BRANCH]).catch(() => undefined);
  await q(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, status, source, created_at) values ($1,$2,$3,$4,$5,(now() + interval '5 days')::date,'11:00','11:45','booked','phone',$6)`, [PILOT, BRANCH, TECH.anna, mai.id, mai.full_name, ago(6 * D - 55 * 60_000)]);
  await q(`insert into review_requests (tenant_id, branch_id, customer_id, channel, status, idempotency_key, sent_at, created_at) values ($1,$2,$3,'sms','sent','harness-rr-1',$4,$4)`, [PILOT, BRANCH, mai.id, ago(2 * D)]);
  await q(`insert into call_transcripts (id, tenant_id, branch_id, provider, provider_call_id, customer_id, direction, handler, status) values ($1,$2,$3,'vapi','HCALL1',$4,'inbound','ai','completed')`, [id('d8970000', 1), PILOT, BRANCH, mai.id]);
  await q(`insert into call_transcript_intelligence (tenant_id, branch_id, transcript_id, provider_call_id, quick_summary) values ($1,$2,$3,'HCALL1','Asked whether gel removal is included; told it is $10 extra.')`, [PILOT, BRANCH, id('d8970000', 1)]);
  await q(`insert into call_intelligence_events (tenant_id, branch_id, provider_call_id, customer_id, caller_phone, direction, status, ai_handled, outcome, started_at) values ($1,$2,'HCALL1',$3,$4,'inbound','answered_ai',true,'message',$5)`, [PILOT, BRANCH, mai.id, mai.normalized_phone, ago(3 * D)]);
  await msg(tMai, { dir: 'inbound', body: 'Thank you, see you Friday!', at: ago(90 * 60_000) });
  // an Unknown contact waiting two days (Longest unanswered must surface it)
  const tUnk = await thread({ contact: INBOX.unknown, created: ago(2 * D) });
  await msg(tUnk, { dir: 'inbound', body: 'Hello, are you open on Sundays?', at: ago(2 * D) });
  // a shared number → possible match (two customers)
  const tAmb = await thread({ contact: INBOX.shared, match: 'ambiguous', created: ago(30 * H) });
  await msg(tAmb, { dir: 'inbound', body: 'Is my appointment at 3?', at: ago(30 * H) });
  // a reply the carrier could not deliver (30007) — never shown as Delivered
  const c2 = cust[1];
  const tFail = await thread({ customer: c2.id, name: c2.full_name, contact: c2.normalized_phone, created: ago(3 * D), assigned: DESK_USER, assignedName: 'Vy Front Desk' });
  await msg(tFail, { dir: 'inbound', body: 'Can I move my pedicure to next week?', at: ago(3 * D) });
  await msg(tFail, { dir: 'outbound', mstatus: 'failed', body: 'Sure — what day works best?', at: ago(3 * D - 30 * 60_000), to: c2.normalized_phone, customer: c2.id, ledger: { status: 'failed', sid: INBOX.failedSid, provider: 'undelivered', reason: 'provider_undelivered', code: '30007' } });
  // closed, email, missed call
  const c3 = cust[2];
  const tClosed = await thread({ customer: c3.id, name: c3.full_name, contact: c3.normalized_phone, created: ago(9 * D), status: 'closed' });
  await msg(tClosed, { dir: 'inbound', body: 'Thanks for today!', at: ago(9 * D) });
  const tEmail = await thread({ customer: cust[3].id, name: cust[3].full_name, contact: 'kim.do@example.test', channel: 'email', created: ago(5 * D) });
  await msg(tEmail, { dir: 'inbound', channel: 'email', body: 'Do you sell gift cards online?', at: ago(5 * D) });
  const tCall = await thread({ contact: '+12155550199', channel: 'call', status: 'missed', created: ago(7 * H) });
  await msg(tCall, { dir: 'inbound', channel: 'call', body: 'Missed call (no voicemail)', at: ago(7 * H) });
  // 22 more conversations so pages 1 / 2 / 3 exist
  for (let i = 0; i < 22; i++) {
    const c = cust[(i + 4) % cust.length]; const at = ago((i + 1) * 5 * H);
    const t = await thread({ customer: c.id, name: c.full_name, contact: c.normalized_phone, created: at, status: i % 3 === 0 ? 'replied' : 'open', followUp: i === 5 ? ago(-2 * H) : null });
    await msg(t, { dir: 'inbound', body: ['Running 5 min late', 'Do you do dip powder?', 'What time do you close?', 'Can I bring my daughter?'][i % 4], at });
    if (i % 3 === 0) await msg(t, { dir: 'outbound', body: 'Thanks for letting us know!', at: new Date(Date.parse(at) + 10 * 60_000).toISOString(), to: c.normalized_phone, customer: c.id, ledger: { status: 'sent', sid: 'SM' + String(100 + i).padStart(32, '0'), provider: 'sent' } });
  }
  // the other salon: Mai Le's number, its own conversation (never visible to Pilot)
  const tOther = await thread({ tenant: OTHER, branch: BRANCH_O, contact: mai.normalized_phone, name: 'Mai Elsewhere', created: ago(H) });
  await msg(tOther, { tenant: OTHER, dir: 'inbound', body: 'OTHER SALON PRIVATE TEXT', at: ago(H) });
  // derived columns exactly as migration 730 backfills them (fixtures were inserted raw)
  await q(`UPDATE communication_threads t SET last_message_at = m.last_at, last_inbound_at = m.last_in, last_outbound_at = m.last_out, last_direction = m.last_dir, last_message_preview = left(m.last_body, 140),
      unread_count = CASE WHEN t.status = 'closed' THEN 0 ELSE m.unread END,
      awaiting_reply_since = CASE WHEN m.last_in IS NOT NULL AND (m.last_out IS NULL OR m.last_out < m.last_in) THEN m.first_open_in ELSE NULL END
    FROM (SELECT x.thread_id, max(x.created_at) AS last_at, max(x.created_at) FILTER (WHERE x.direction = 'inbound') AS last_in, max(x.created_at) FILTER (WHERE x.direction = 'outbound' AND x.status = 'sent') AS last_out,
        (array_agg(x.direction ORDER BY x.created_at DESC))[1] AS last_dir, (array_agg(x.body ORDER BY x.created_at DESC))[1] AS last_body,
        count(*) FILTER (WHERE x.direction = 'inbound' AND x.created_at > COALESCE((SELECT max(o.created_at) FROM communication_messages o WHERE o.thread_id = x.thread_id AND o.direction = 'outbound' AND o.status = 'sent'), '-infinity'))::int AS unread,
        min(x.created_at) FILTER (WHERE x.direction = 'inbound' AND x.created_at > COALESCE((SELECT max(o.created_at) FROM communication_messages o WHERE o.thread_id = x.thread_id AND o.direction = 'outbound' AND o.status = 'sent'), '-infinity')) AS first_open_in
      FROM communication_messages x GROUP BY x.thread_id) m WHERE m.thread_id = t.id`);
  await q(`insert into message_templates (id, tenant_id, name, channel, category, status, current_version) values ($1,$2,'Running late reply','sms','reply','published',1), ($3,null,'Booking link','sms','reply','published',1)`, [id('d9970000', 1), PILOT, id('d9970000', 2)]);
  await q(`insert into message_template_versions (template_id, version, body, status, published_at) values ($1,1,'No problem — we will hold your spot for 15 minutes.','published',now()), ($2,1,'You can book online any time here: https://book.pilot.test','published',now())`, [id('d9970000', 1), id('d9970000', 2)]);
  return { inboxThreads: 30, inboxMai: tMai, inboxUnknown: tUnk, inboxAmbiguous: tAmb, inboxFailed: tFail, inboxEmail: tEmail, inboxCall: tCall, inboxOther: tOther };
}

function services(db) {
  const realtime = { toTenant: (...a) => (globalThis.__harnessRealtime ?? silent).toTenant(...a) };
  const notifications = new NotificationsService(new KyselyNotificationsRepository(db), { send: async () => { throw new Error('harness: the platform sender is never used for an inbox reply'); } }, { send: async () => ({ id: 'x' }) }, undefined, new KyselyOptOutRepository(db), undefined, new KyselyTenantSmsSenderResolver(db, testProviderSecrets, fakeTwilio));
  const real = new TenantMessagingReadinessService(db, { record: async () => ({}) }, testProviderSecrets); real.http = fakeTwilio;
  // harness-only override (see the header): the real readiness answer, with outbound forced ready when the switch is on
  const readiness = { readiness: async (t, b, a) => { const v = await real.readiness(t, b, a); return readyOverride ? { ...v, outbound: { ...v.outbound, state: 'ready_to_attempt', blockers: [], reasonCode: null } } : v; } };
  const svc = new InboxService(new InboxRepository(db), notifications, readiness, realtime);
  const hook = new TwilioInboundService(db, notifications, testProviderSecrets, realtime);
  return { svc, hook, activity: new CommunicationsActivityService(db) };
}
let S = null;
export function inboxRoutes(db, routesOf) {
  S = services(db);
  return [
    ...routesOf('modules/communications/src/inbox/inbox.controller.ts', '/pos/communications/inbox', new InboxController(S.svc)),
    { verb: 'GET', re: /^\/pos\/communications\/activity$/, keys: [], perm: 'pos.communications.view', method: 'activity', params: ['req', 'query:days'], fn: (r, days) => S.activity.activity(r.ctx.tenantId, Number(days) || 30) },
  ];
}
const URL_IN = 'https://api.pilot.test/webhooks/twilio/sms/inbound', URL_ST = 'https://api.pilot.test/webhooks/twilio/sms/status';
let seq = 0;
/** /__inbox controls (harness only) */
export async function inboxControl(sp) {
  if (sp.has('ready')) readyOverride = sp.get('ready') === '1';
  if (sp.get('inbound')) {
    const p = { From: sp.get('inbound'), To: COMMS.number, Body: sp.get('body') ?? 'Hello', MessageSid: 'SM' + String(Date.now()).padStart(20, '0') + String(++seq).padStart(12, '0'), AccountSid: COMMS.acPilot, NumMedia: '0' };
    const r = await S.hook.handleInbound({ from: p.From, to: p.To, body: p.Body, signature: computeTwilioSignature('fixture-pilot-token', URL_IN, p), url: URL_IN, params: p });
    return { inbound: r };
  }
  if (sp.get('status')) {
    const p = { MessageSid: sp.get('status'), MessageStatus: sp.get('s') ?? 'delivered', AccountSid: COMMS.acPilot, ...(sp.get('code') ? { ErrorCode: sp.get('code') } : {}) };
    const r = await S.hook.handleStatus({ sid: p.MessageSid, status: p.MessageStatus, signature: computeTwilioSignature('fixture-pilot-token', URL_ST, p), url: URL_ST, params: p });
    return { status: r };
  }
  return { ready: readyOverride };
}
export const inboxSql = (T) => ({
  inboxOut: [`select m.body, m.status, m.idempotency_key is not null as keyed, n.status as ledger, n.purpose, n.provider_id from communication_messages m left join notifications n on n.id = m.notification_id where m.tenant_id = $1 and m.direction = 'outbound' order by m.created_at desc limit 10`, [T]],
  inboxEvents: [`select event_type, previous_value, new_value from communication_thread_events where tenant_id = $1 order by created_at desc limit 20`, [T]],
  inboxAudit: [`select action, status from audit_events where tenant_id = $1 and module = 'communications' order by occurred_at desc limit 20`, [T]],
  inboxThreads: [`select id, customer_id, customer_match, status, unread_count, awaiting_reply_since is not null as awaiting, record_version from communication_threads where tenant_id = $1 order by last_message_at desc nulls last limit 40`, [T]],
  inboxOutCount: [`select count(*)::int as n from communication_messages where tenant_id = $1 and direction = 'outbound'`, [T]],
  inboxAppts: [`select count(*)::int as n from pos_tech_appointments where tenant_id = $1`, [T]],
});
