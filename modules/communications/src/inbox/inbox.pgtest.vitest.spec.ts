// inbox.pgtest — Communications / SMS Inbox guide (Oct 30 2026) + Claude Build Addendum, against the REAL schema (migration 730):
//   S1  two salons share a customer's phone — salon A's search returns only salon A's conversations; B's ids are "not found"
//   S2  10+ matching threads: pages 1 / 2 / 3 are stable and disjoint; a new inbound puts that thread on page 1 (newest sort only)
//   S4  priority: the oldest UNANSWERED customer message outranks a newly active, already answered conversation
//   S5  one customer's timeline joins SMS + ledger reminder + review request + AI call summary + appointment, chronological,
//       channel-labelled, with no duplicate of the reply's own ledger row and nothing from another salon
//   S7  custom From/To in the salon's zone across year end and DST; end before start refused
//   S8  queued then failed → never Delivered; delivered only from the ledger the callback moved
//   S9  permissions: no send permission → refused; opted-out recipient → blocked by the messenger; actor audited
//   S11 readiness unavailable / sender not set up → composer disabled and the reply recorded as blocked (no provider call)
//   + inbound: unknown number = Unknown Contact, one exact phone match links, two matches = ambiguous (unlinked), a retried
//     MessageSid is one message, a closed conversation reopens; reply: one Idempotency-Key = one message = one provider call;
//     the platform's shared sender is never used for an inbox reply; branch scope; optimistic versions; ids-only realtime events.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { InboxRepository, recordInboundSms, type InboxCtx } from './inbox.repository';
import { InboxService } from './inbox.service';
import { InboxError } from './inbox-core';
import { NotificationsService } from '../notifications/notifications.service';
import { KyselyNotificationsRepository } from '../notifications/notifications.kysely.repository';
import { KyselyOptOutRepository } from '../notifications/notifications.optout.kysely.repository';
import { TwilioInboundService } from '../messaging-inbound/twilio-inbound.service';
import { computeTwilioSignature } from '@aipowersalon/notifications';
import { testProviderSecrets } from '@aipowersalon/testing';

const P = 'c0330000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B1 = id('b1'), B2 = id('b2'), BX = id('b9');
const OWNER = id('e1'), MANAGER = id('e2'), RECEP = id('e3'), OTHER = id('e4');
const ALL = ['pos.communications.view', 'pos.communications.send', 'pos.communications.manage', 'pos.customers.view'];
const owner: InboxCtx = { tenantId: T, branchId: B1, userId: OWNER, role: 'OWNER', permissions: ALL, userName: 'Kim Owner', authz: { branchIds: null } };
const manager: InboxCtx = { tenantId: T, branchId: B2, userId: MANAGER, role: 'MANAGER', permissions: ALL, userName: 'Mia Manager', authz: { branchIds: [B2] } };
const viewer: InboxCtx = { tenantId: T, branchId: B1, userId: RECEP, role: 'RECEPTIONIST', permissions: ['pos.communications.view'], userName: 'Rae', authz: { branchIds: null } };
const otherOwner: InboxCtx = { tenantId: T2, branchId: BX, userId: OTHER, role: 'OWNER', permissions: ALL, userName: 'Oz', authz: { branchIds: null } };
const SHARED = '+12155550101';   // the same customer phone in both salons
let pg: any; let db: any; let repo: InboxRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof InboxError ? e.code : String((e as Error).message); } }

// ── fakes at the edges only: the provider HTTP sender and the readiness answer ────────────────────────────────
const sent: { to: string; body: string; from: string }[] = [];
let sidN = 0;
const tenantSender = { resolveSender: async (tenantId: string, branchId?: string | null) => {
  const r = await q(`select from_number, branch_id from tenant_messaging_credentials where tenant_id = $1 and status = 'configured' and (branch_id is null or branch_id = $2) order by (branch_id is null) asc limit 1`, [tenantId, branchId ?? null]);
  const row = r.rows[0]; if (!row) return null;
  return { senderFrom: row.from_number, send: async (to: string, body: string) => { sent.push({ to, body, from: row.from_number }); return { sid: 'SM' + String(++sidN).padStart(32, '0'), segments: 1 }; } } as any;
} };
const platformCalls: string[] = [];
const platformSms = { send: async (to: string) => { platformCalls.push(to); return { sid: 'SMplatform' }; } } as any;
const noEmail = { send: async () => ({ id: 'x' }) } as any;
let readinessState: 'ready' | 'blocked' | 'throw' = 'ready';
const readiness = { readiness: async (tenantId: string) => {
  if (readinessState === 'throw') throw new Error('provider down');
  const has = (await q(`select 1 from tenant_messaging_credentials where tenant_id = $1 and status = 'configured'`, [tenantId])).rows.length > 0;
  return { source: has ? 'tenant_default' : 'none', outbound: { state: readinessState === 'blocked' ? 'blocked' : 'ready_to_attempt', reasonCode: readinessState === 'blocked' ? 'A2P_PENDING' : null, blockers: readinessState === 'blocked' ? ['A2P_PENDING'] : [], warnings: [], deliveryTracking: true, fixLink: '/tenant/communications/messaging-setup' } };
} };
const events: { tenantId: string; branchId: string; event: string; payload: any }[] = [];
const realtime = { toTenant: (c: any, event: string, payload: any) => { events.push({ tenantId: c.tenantId, branchId: c.branchId, event, payload }); } } as any;
let svc: InboxService;

async function thread(tenant: string, o: { branch?: string | null; contact?: string; customer?: string | null; name?: string | null; channel?: string; activity: string; status?: string; awaiting?: string | null }) {
  const r = await q(`insert into communication_threads (tenant_id, branch_id, customer_id, customer_name, customer_contact, contact_normalized, customer_match, channel, status, last_message_at, created_at, awaiting_reply_since, last_message_preview, last_direction)
    values ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $9, $10, 'hi', 'inbound') returning id`,
    [tenant, o.branch ?? null, o.customer ?? null, o.name ?? null, o.contact ?? '+12155559999', o.customer ? 'legacy' : 'none', o.channel ?? 'sms', o.status ?? 'open', o.activity, o.awaiting ?? null]);
  return r.rows[0].id as string;
}

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Lotus LLC','Lotus Nails','ib-lotus','IBL001','active'), ($2,'Other LLC','Other Nails','ib-other','IBL002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$4,'Main','active','America/New_York'), ($2,$4,'Cherry Hill','active','America/New_York'), ($3,$5,'Other','active','America/New_York')`, [B1, B2, BX, T, T2]);
  await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$5,'Kim Owner','kim@ib.test','active','OWNER'), ($2,$5,'Mia Manager','mia@ib.test','active','MANAGER'), ($3,$5,'Rae Desk','rae@ib.test','active','RECEPTION'), ($4,$6,'Oz Other','oz@ib.test','active','OWNER')`, [OWNER, MANAGER, RECEP, OTHER, T, T2]);
  await q(`insert into customers (id, tenant_id, branch_id, full_name, first_name, last_name, normalized_phone, phone_display, email, status) values
    ($1,$5,$6,'Jane Lotus','Jane','Lotus',$7,'(215) 555-0101','jane@lotus.test','active'),
    ($2,$5,$6,'Twin One','Twin','One','+12155550202','(215) 555-0202',null,'active'),
    ($3,$5,$6,'Twin Two','Twin','Two','2155550202','215-555-0202',null,'active'),
    ($4,$8,$9,'Jane Other','Jane','Other',$7,'(215) 555-0101','jane@other.test','active')`, [id('c1'), id('c2'), id('c3'), id('c9'), T, B1, SHARED, T2, BX]);
  await q(`insert into tenant_messaging_credentials (tenant_id, branch_id, provider, account_sid, status, from_number) values ($1, null, 'twilio', 'AC' || repeat('a', 32), 'configured', '+18565550100'), ($1, $2, 'twilio', 'AC' || repeat('b', 32), 'configured', '+18565550200')`, [T, B2]);
  await q(`insert into tenant_messaging_numbers (tenant_id, branch_id, phone_number, channel, provider, status) values ($1, null, '+18565550100', 'sms', 'twilio', 'active'), ($1, $2, '+18565550200', 'sms', 'twilio', 'active'), ($3, null, '+18565550900', 'sms', 'twilio', 'active')`, [T, B2, T2]);
  db = kyselyFor(pg); repo = new InboxRepository(db);
  const notifications = new NotificationsService(new KyselyNotificationsRepository(db), platformSms, noEmail, undefined, new KyselyOptOutRepository(db), undefined, tenantSender as any);
  svc = new InboxService(repo, notifications, readiness as any, realtime);
}, 180_000);

describe('inbound SMS → inbox (identity is never guessed)', () => {
  it('an unknown number is an Unknown Contact; a retried MessageSid is one message', async () => {
    const a = await recordInboundSms(db, { tenantId: T, from: '+12675550111', to: '+18565550100', body: 'Do you have openings Friday?', messageSid: 'SM' + 'u'.repeat(32), numMedia: 0 });
    const b = await recordInboundSms(db, { tenantId: T, from: '+12675550111', to: '+18565550100', body: 'Do you have openings Friday?', messageSid: 'SM' + 'u'.repeat(32), numMedia: 0 });
    expect(a.duplicate).toBe(false); expect(b.duplicate).toBe(true); expect(b.threadId).toBe(a.threadId);
    expect(a.customerMatch).toBe('none');
    const d = await svc.detail(owner, a.threadId);
    expect(d.thread.identity).toBe('unknown'); expect(d.customer).toBeNull();
    expect(d.messages.filter((m) => m.direction === 'inbound')).toHaveLength(1);
    expect(d.thread.awaitingSince).not.toBeNull(); expect(d.thread.unreadCount).toBe(1);
  });
  it('exactly one salon customer with the number links; two (the twins) stay ambiguous and unlinked', async () => {
    const j = await recordInboundSms(db, { tenantId: T, from: SHARED, to: '+18565550100', body: 'Hi it is Jane', messageSid: 'SM' + 'j'.repeat(32), numMedia: 0 });
    expect(j.customerMatch).toBe('exact_phone');
    expect((await svc.detail(owner, j.threadId)).customer?.id).toBe(id('c1'));
    const tw = await recordInboundSms(db, { tenantId: T, from: '(215) 555-0202', to: '+18565550100', body: 'which twin am i', messageSid: 'SM' + 't'.repeat(32), numMedia: 0 });
    expect(tw.customerMatch).toBe('ambiguous');
    const d = await svc.detail(owner, tw.threadId);
    expect(d.customer).toBeNull(); expect(d.thread.identity).toBe('ambiguous'); expect(d.ambiguousCandidates).toBe(2);
  });
  it('the branch number routes to its branch; another salon\'s number never lands in this salon', async () => {
    const br = await recordInboundSms(db, { tenantId: T, from: '+12675550333', to: '+18565550200', body: 'cherry hill q', messageSid: 'SM' + 'c'.repeat(32), numMedia: 0 });
    expect(br.branchId).toBe(B2);
    const before = events.length; svc.emit(T, br.branchId, br.threadId, 'inbound');
    expect(events.slice(before).map((e) => e.branchId)).toEqual([B2]);   // a branch conversation goes to its branch room only
    const ot = await recordInboundSms(db, { tenantId: T2, from: SHARED, to: '+18565550900', body: 'Jane at Other', messageSid: 'SM' + 'o'.repeat(32), numMedia: 0 });
    expect(await code(svc.detail(owner, ot.threadId))).toBe('CONVERSATION_NOT_FOUND');      // S1: B's conversation is "not found" for A
    expect((await svc.detail(otherOwner, ot.threadId)).customer?.id).toBe(id('c9'));
  });
});

describe('the signed Twilio webhook stores the text, emits an ids-only event, and still honours STOP', () => {
  it('a correctly signed customer text reaches the inbox once; a forged one does not; STOP is recorded AND opts out', async () => {
    const env = { sid: process.env.TWILIO_ACCOUNT_SID, tok: process.env.TWILIO_AUTH_TOKEN };
    process.env.TWILIO_ACCOUNT_SID = 'AC' + 'f'.repeat(32); process.env.TWILIO_AUTH_TOKEN = 'platform-token-ib';
    try {
      const notifications = new NotificationsService(new KyselyNotificationsRepository(db), platformSms, noEmail, undefined, new KyselyOptOutRepository(db));
      const hook = new TwilioInboundService(db, notifications, testProviderSecrets, realtime);
      const URL = 'https://api.pilot.test/webhooks/twilio/sms/inbound';
      const p = { From: '+12675550888', To: '+18565550100', Body: 'Running 10 min late', MessageSid: 'SM' + 'w'.repeat(32), NumMedia: '0' };
      const before = events.length;
      const r1: any = await hook.handleInbound({ from: p.From, to: p.To, body: p.Body, signature: computeTwilioSignature('platform-token-ib', URL, p), url: URL, params: p });
      const r2: any = await hook.handleInbound({ from: p.From, to: p.To, body: p.Body, signature: computeTwilioSignature('platform-token-ib', URL, p), url: URL, params: p });
      expect(r1).toMatchObject({ status: 'recorded', duplicate: false }); expect(r2).toMatchObject({ status: 'recorded', duplicate: true });
      // a salon-wide number: the event reaches EVERY branch room of the salon (the bus is per branch), once each
      const fresh = events.slice(before); expect(fresh.map((e) => e.branchId).sort()).toEqual([B1, B2].sort());
      expect(fresh.every((e) => e.tenantId === T && e.event === 'conversation_updated' && e.payload.threadId === r1.threadId && e.payload.kind === 'inbound')).toBe(true);
      const forged = { ...p, MessageSid: 'SM' + 'v'.repeat(32), Body: 'forged' };
      expect(await hook.handleInbound({ from: forged.From, to: forged.To, body: forged.Body, signature: 'forged', url: URL, params: forged })).toMatchObject({ status: 'ignored', reason: 'bad_signature' });
      expect((await svc.detail(owner, r1.threadId)).messages.map((m) => m.body)).toEqual(['Running 10 min late']);
      const stop = { ...p, Body: 'STOP', MessageSid: 'SM' + 's'.repeat(32) };
      expect(await hook.handleInbound({ from: stop.From, to: stop.To, body: stop.Body, signature: computeTwilioSignature('platform-token-ib', URL, stop), url: URL, params: stop })).toMatchObject({ status: 'opted_out' });
      expect((await q(`select 1 from notification_opt_outs where tenant_id = $1 and address = $2`, [T, '+12675550888'])).rows).toHaveLength(1);
      expect((await svc.detail(owner, r1.threadId)).messages.map((m) => m.body)).toEqual(['Running 10 min late', 'STOP']);
    } finally {
      if (env.sid === undefined) delete process.env.TWILIO_ACCOUNT_SID; else process.env.TWILIO_ACCOUNT_SID = env.sid;
      if (env.tok === undefined) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = env.tok;
    }
  });
});

describe('S1 search is salon-scoped, server-side, beyond page 1', () => {
  it('the shared phone finds only this salon\'s conversation (name, digits, formatted, customer id, message text, email)', async () => {
    for (const term of ['5550101', '(215) 555-0101', '215.555.0101', 'Jane', id('c1'), 'it is Jane', 'jane@lotus']) {
      const r = await svc.list(owner, { q: term });
      expect(r.items.length, term).toBeGreaterThanOrEqual(1);
      expect(r.items.every((x) => x.customerId === id('c1') || x.displayName === 'Jane Lotus'), term).toBe(true);
    }
    const other = await svc.list(otherOwner, { q: '5550101' });
    expect(other.items.map((x) => x.customerId)).toEqual([id('c9')]);
    expect(JSON.stringify(await svc.list(owner, { q: 'Jane' }))).not.toContain('5550101');   // the list masks phones
  });
});

describe('S2 numbered pages + newest activity first; S4 priority keeps the oldest unanswered on top', () => {
  let oldest: string; let answered: string;
  it('25 threads page 10 / 10 / 5, disjoint, stable', async () => {
    const base = Date.parse('2026-10-01T15:00:00Z');
    for (let i = 0; i < 25; i++) {
      const tid = await thread(T, { branch: B1, contact: '+1609555' + String(1000 + i), name: 'Page ' + i, activity: new Date(base + i * 3600_000).toISOString() });
      if (i === 0) oldest = tid;
    }
    const pages = [] as string[][];
    for (const page of [1, 2, 3]) pages.push((await svc.list(owner, { q: 'Page', pageSize: '10', page: String(page) })).items.map((x) => x.id));
    expect(pages.map((p) => p.length)).toEqual([10, 10, 5]);
    expect(new Set(pages.flat()).size).toBe(25);
    const p3 = await svc.list(owner, { q: 'Page', pageSize: '10', page: '9' });
    expect(p3.page).toBe(3);   // an out-of-range page is clamped to the last
  });
  it('a new customer text moves that thread to page 1 in the default view', async () => {
    await q(`update communication_threads set contact_normalized = '+16095551000', customer_contact = '+16095551000' where id = $1`, [oldest]);
    await recordInboundSms(db, { tenantId: T, from: '+16095551000', to: '+18565550100', body: 'Page 0 again', messageSid: 'SM' + 'p'.repeat(32), numMedia: 0 });
    expect((await svc.list(owner, { q: 'Page', pageSize: '10' })).items[0].id).toBe(oldest);
  });
  it('Oldest Unanswered ranks a 3-day-old unanswered text above a fresh, answered conversation', async () => {
    const waiting = await thread(T, { branch: B1, contact: '+16095552000', name: 'Prio Waiting', activity: new Date(Date.now() - 3 * 86400_000).toISOString(), awaiting: new Date(Date.now() - 3 * 86400_000).toISOString() });
    answered = await thread(T, { branch: B1, contact: '+16095553000', name: 'Prio Answered', activity: new Date().toISOString(), status: 'replied', awaiting: null });
    const newest = await svc.list(owner, { q: 'Prio' });
    expect(newest.items[0].id).toBe(answered);
    const prio = await svc.list(owner, { q: 'Prio', sort: 'oldest_unanswered' });
    expect(prio.items[0].id).toBe(waiting);
    const awaitingOnly = await svc.list(owner, { q: 'Prio', awaitingOnly: 'true' });
    expect(awaitingOnly.items.map((x) => x.id)).toEqual([waiting]);
  });
});

describe('reply: one Send = one message = one provider call; delivery only from evidence', () => {
  let tid: string;
  it('sends through the salon sender with the conversation purpose; the same key twice is one message', async () => {
    tid = (await recordInboundSms(db, { tenantId: T, from: '+12675550444', to: '+18565550100', body: 'Can I book?', messageSid: 'SM' + 'r'.repeat(32), numMedia: 0 })).threadId;
    const before = sent.length;
    const r1 = await svc.reply(owner, tid, 'Yes! Tap here to book.', 'key-reply-0001');
    const r2 = await svc.reply(owner, tid, 'Yes! Tap here to book.', 'key-reply-0001');
    expect(sent.length - before).toBe(1); expect(sent.at(-1)).toMatchObject({ to: '+12675550444', from: '+18565550100' });
    expect(r1.message?.delivery).toBe('submitted'); expect(r2.duplicate).toBe(true); expect(r2.message?.id).toBe(r1.message?.id);
    expect((await q(`select count(*)::int n from communication_messages where thread_id = $1 and direction = 'outbound'`, [tid])).rows[0].n).toBe(1);
    const n = (await q(`select purpose, status from notifications where tenant_id = $1 and provider_id = $2`, [T, 'SM' + String(sidN).padStart(32, '0')])).rows[0];
    expect(n).toMatchObject({ purpose: 'conversation', status: 'sent' });
    expect(platformCalls).toEqual([]);   // never the platform's shared sender
    const d = await svc.detail(owner, tid);
    expect(d.thread.status).toBe('replied'); expect(d.thread.awaitingSince).toBeNull(); expect(d.thread.unreadCount).toBe(0);
    expect(await code(svc.reply(owner, tid, 'other text', 'key-reply-0001'))).toBe('ok');   // same key, same thread → replay, still one message
  });
  it('S8: provider "sent" then "failed" never shows Delivered; "delivered" only from the ledger', async () => {
    const sid = 'SM' + String(sidN).padStart(32, '0');
    await q(`update notifications set provider_status = 'sent' where provider_id = $1`, [sid]);
    expect((await svc.detail(owner, tid)).messages.at(-1)?.delivery).toBe('sent');
    await q(`update notifications set status = 'failed', provider_status = 'undelivered', failure_reason = 'provider_undelivered', provider_error_code = '30007' where provider_id = $1`, [sid]);
    const m = (await svc.detail(owner, tid)).messages.at(-1)!;
    expect(m.delivery).toBe('undelivered'); expect(m.reasonCode).toBe('PROVIDER_UNDELIVERED'); expect(m.providerErrorCode).toBe('30007');
  });
  it('a branch conversation uses that branch\'s own sender', async () => {
    const b = await recordInboundSms(db, { tenantId: T, from: '+12675550555', to: '+18565550200', body: 'branch msg', messageSid: 'SM' + 'b'.repeat(32), numMedia: 0 });
    await svc.reply(manager, b.threadId, 'Cherry Hill here', 'key-branch-0001');
    expect(sent.at(-1)).toMatchObject({ from: '+18565550200' });
  });
  it('S9: an opted-out number is blocked by the messenger (recorded, never sent); no send permission is refused', async () => {
    await q(`insert into notification_opt_outs (tenant_id, channel, address, reason) values ($1, 'sms', '+12675550444', 'inbound_stop')`, [T]);
    const before = sent.length;
    const r = await svc.reply(owner, tid, 'are you there?', 'key-optout-0001');
    expect(sent.length).toBe(before); expect(r.message?.delivery).toBe('blocked'); expect(r.message?.reasonCode).toBe('OPTED_OUT');
    expect((await svc.detail(owner, tid)).composer).toMatchObject({ enabled: false, reasonCode: 'OPTED_OUT' });
    expect(await code(svc.reply(viewer, tid, 'hi', 'key-viewer-0001'))).toBe('PERMISSION_DENIED');
    const audit = (await q(`select action, actor_user_id from audit_events where tenant_id = $1 and module = 'communications' and action like 'inbox.reply.%' order by occurred_at`, [T])).rows;
    expect(audit.map((a: any) => a.action)).toEqual(expect.arrayContaining(['inbox.reply.sent', 'inbox.reply.blocked']));
    expect(audit.every((a: any) => a.actor_user_id === OWNER || a.actor_user_id === MANAGER)).toBe(true);
  });
  it('extras Communications 07: the conversation header shows what consent does to each kind of text now (one consent table) and the number\'s consent history', async () => {
    const t7 = (await recordInboundSms(db, { tenantId: T, from: '+12675550777', to: '+18565550100', body: 'hi there', messageSid: 'SM' + 'c7'.repeat(16), numMedia: 0 })).threadId;
    const before = (await svc.detail(owner, t7)).consent;
    expect(before.smsOptedOut).toBe(false); expect(before.history).toEqual([]);
    const cat = (c: typeof before, k: string) => c.categories.find((x) => x.kind === k)!;
    expect(cat(before, 'reminder')).toMatchObject({ blocked: false, why: 'allowed' });
    expect(cat(before, 'marketing')).toMatchObject({ blocked: true, why: 'no_marketing_opt_in', basis: 'marketing' });   // no customer opt-in on file
    expect(cat(before, 'booking_code')).toMatchObject({ blocked: false, why: 'exempt_transactional', basis: 'transactional' });
    await q(`insert into notification_consent_events (tenant_id, channel, address, action, source, actor_user_id, created_at) values ($1,'sms','+12675550777','opt_out','staff',$2, now() - interval '2 days'), ($1,'sms','+12675550777','opt_in','staff',$2, now() - interval '1 day'), ($1,'sms','+12675550777','opt_out','inbound_stop',null, now())`, [T, OWNER]);
    await q(`insert into notification_opt_outs (tenant_id, channel, address, reason, scope) values ($1,'sms','+12675550777','inbound_stop','all')`, [T]);
    const after = (await svc.detail(owner, t7)).consent;
    expect(after.smsOptedOut).toBe(true); expect(after.optOutScope).toBe('all'); expect(after.optOutReason).toBe('inbound_stop'); expect(after.optedOutAt).toBeTruthy();
    for (const k of ['reminder', 'receipt', 'conversation', 'followup', 'marketing', 'notification']) expect(cat(after, k)).toMatchObject({ blocked: true, why: 'stop' });
    expect(cat(after, 'booking_code')).toMatchObject({ blocked: false, why: 'exempt_transactional' });   // Kevin: booking codes still go out after STOP
    expect(cat(after, 'account')).toMatchObject({ blocked: false, why: 'exempt_transactional' });
    expect(after.history.map((h) => `${h.action}:${h.source}`)).toEqual(['opt_out:inbound_stop', 'opt_in:staff', 'opt_out:staff']);
    expect(after.history[1].actor).toBeTruthy();
    expect((await svc.detail(owner, t7)).composer).toMatchObject({ enabled: false, reasonCode: 'OPTED_OUT' });
  });
  it('S11: readiness blocked or unavailable → no provider call, the reply is recorded as blocked, the composer says why', async () => {
    const t2 = (await recordInboundSms(db, { tenantId: T, from: '+12675550666', to: '+18565550100', body: 'hello?', messageSid: 'SM' + 'k'.repeat(32), numMedia: 0 })).threadId;
    const before = sent.length;
    readinessState = 'blocked';
    const r = await svc.reply(owner, t2, 'hi', 'key-blocked-0001');
    expect(r.message?.delivery).toBe('blocked'); expect(r.message?.reasonCode).toBe('SEND_FAILED');
    expect((await svc.detail(owner, t2)).composer).toMatchObject({ enabled: false, reasonCode: 'A2P_PENDING' });
    readinessState = 'throw';
    expect((await svc.detail(owner, t2)).composer).toMatchObject({ enabled: false, reasonCode: 'READINESS_UNAVAILABLE' });
    readinessState = 'ready';
    expect(sent.length).toBe(before);
    expect((await svc.detail(owner, t2)).thread.awaitingSince).not.toBeNull();   // a blocked reply does not answer the customer
  });
  it('a salon with no sender of its own is refused — the platform default is never borrowed', async () => {
    const t3 = (await recordInboundSms(db, { tenantId: T2, from: '+12675550777', to: '+18565550900', body: 'hi other', messageSid: 'SM' + 'z'.repeat(32), numMedia: 0 })).threadId;
    const r = await svc.reply(otherOwner, t3, 'hello', 'key-other-0001');
    expect(r.message?.delivery).toBe('blocked'); expect(platformCalls).toEqual([]);
  });
});

describe('S5 unified customer timeline', () => {
  it('joins the canonical records chronologically, labels each channel, no duplicates, nothing from another salon', async () => {
    const cid = id('c1');
    const tJane = (await svc.list(owner, { q: 'Jane' })).items[0].id;
    await svc.reply(owner, tJane, 'See you Friday Jane', 'key-jane-0001');
    const t0 = Date.now();
    await q(`insert into notifications (tenant_id, channel, to_address, body, customer_id, status, provider_id, purpose, created_at) values ($1,'sms',$2,'Reminder: Fri 2pm',$3,'delivered','SMrem',  'reminder', $4), ($1,'sms',$2,'123456 is your code',$3,'sent','SMotp','account',$5)`, [T, SHARED, cid, new Date(t0 - 5 * 86400_000), new Date(t0 - 4 * 86400_000)]);
    await q(`insert into review_requests (tenant_id, branch_id, customer_id, channel, status, idempotency_key, created_at) values ($1, $2, $3, 'sms', 'sent', 'rr-ib-1', $4)`, [T, B1, cid, new Date(t0 - 3 * 86400_000)]);
    await q(`insert into call_transcripts (id, tenant_id, branch_id, provider, provider_call_id, customer_id, direction, handler, status) values ($1, $2, $3, 'vapi', 'CALL1', $4, 'inbound', 'ai', 'completed')`, [id('d1'), T, B1, cid]);
    await q(`insert into call_transcript_intelligence (tenant_id, branch_id, transcript_id, provider_call_id, quick_summary) values ($1, $2, $3, 'CALL1', 'Asked about gel removal; booked Friday')`, [T, B1, id('d1')]);
    await q(`insert into call_intelligence_events (tenant_id, branch_id, provider_call_id, customer_id, caller_phone, direction, status, ai_handled, outcome, started_at) values ($1, $2, 'CALL1', $3, $4, 'inbound', 'answered_ai', true, 'booked', $5)`, [T, B1, cid, SHARED, new Date(t0 - 2 * 86400_000)]);
    await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1, $2, $3, 'Tam', 'Nguyen', 'Tam Nguyen')`, [id('f1'), T, B1]);
    await q(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, status, created_at) values ($1, $2, $5, $3, 'Jane Lotus', '2026-11-06', '14:00', '14:45', 'booked', $4)`, [T, B1, cid, new Date(t0 - 2 * 86400_000 + 60_000), id('f1')]).catch((e: Error) => { throw new Error('appointment fixture: ' + e.message); });
    await q(`insert into notifications (tenant_id, channel, to_address, body, customer_id, status, purpose) values ($1,'sms',$2,'Other salon reminder',$3,'sent','reminder')`, [T2, SHARED, id('c9')]);
    const tl = await svc.timeline(owner, tJane, null, null);
    const types = tl.events.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['customer_message', 'staff_reply', 'appointment_reminder', 'verification_code', 'review_request', 'ai_call', 'appointment_booked']));
    const ats = tl.events.map((e) => Date.parse(e.at)); expect([...ats].sort((a, b) => a - b)).toEqual(ats);   // oldest → newest
    expect(tl.events.filter((e) => e.source === 'automated' && e.type === 'staff_reply')).toHaveLength(0);   // the reply's ledger row is not shown twice
    expect(tl.events.find((e) => e.type === 'verification_code')?.body).toBeNull();                       // one-time codes never shown
    expect(tl.events.find((e) => e.type === 'ai_call')?.summary).toMatch(/gel removal/);
    expect(JSON.stringify(tl)).not.toContain('Other salon reminder');
    const onlyCalls = await svc.timeline(owner, tJane, null, 'call');
    expect(onlyCalls.events.every((e) => e.source === 'call')).toBe(true);
  });
});

describe('S7 dates in the salon zone; branch scope; versions; KPIs; events', () => {
  it('custom ranges include the whole local end day across year end and DST; end before start is refused', async () => {
    const ye = await thread(T, { branch: B1, contact: '+16095554000', name: 'Date YearEnd', activity: '2027-01-01T04:30:00Z' });   // Dec 31 11:30 pm New York
    const dst = await thread(T, { branch: B1, contact: '+16095554001', name: 'Date DST', activity: '2026-11-01T06:30:00Z' });      // Nov 1 1:30 am EST (after fall-back)
    const dec = await svc.list(owner, { q: 'Date', preset: 'custom', from: '2026-12-01', to: '2026-12-31' });
    expect(dec.items.map((x) => x.id)).toEqual([ye]);
    expect((await svc.list(owner, { q: 'Date', preset: 'custom', from: '2027-01-01', to: '2027-01-31' })).items).toHaveLength(0);
    expect((await svc.list(owner, { q: 'Date', preset: 'custom', from: '2026-11-01', to: '2026-11-01' })).items.map((x) => x.id)).toEqual([dst]);
    expect(await code(svc.list(owner, { preset: 'custom', from: '2026-12-31', to: '2026-12-01' }))).toBe('DATE_RANGE_INVALID');
    expect(dec.period).toMatchObject({ tz: 'America/New_York', from: '2026-12-01', to: '2026-12-31' });
  });
  it('a branch manager sees their branch + salon-wide conversations only; another branch is 403 / not found', async () => {
    const b1 = await thread(T, { branch: B1, contact: '+16095555000', name: 'Scope B1', activity: new Date().toISOString() });
    const b2 = await thread(T, { branch: B2, contact: '+16095555001', name: 'Scope B2', activity: new Date().toISOString() });
    const all = await thread(T, { branch: null, contact: '+16095555002', name: 'Scope All', activity: new Date().toISOString() });
    expect((await svc.list(manager, { q: 'Scope' })).items.map((x) => x.id).sort()).toEqual([b2, all].sort());
    expect(await code(svc.list(manager, { branch: B1 }))).toBe('INBOX_BRANCH_NOT_AUTHORIZED');
    expect(await code(svc.detail(manager, b1))).toBe('CONVERSATION_NOT_FOUND');
    expect(await code(svc.assign(manager, b1, { userId: MANAGER }))).toBe('CONVERSATION_NOT_FOUND');
  });
  it('assign / status / follow-up are version-checked, evented and audited; link customer is manual and audited', async () => {
    const t = (await svc.list(owner, { q: 'which twin' })).items[0];
    const a = await svc.assign(owner, t.id, { userId: RECEP, expectedVersion: t.version });
    expect(a.assignedToName).toBe('Rae Desk');
    expect(await code(svc.setStatus(owner, t.id, { status: 'closed', expectedVersion: t.version }))).toBe('INBOX_VERSION_CONFLICT');
    const c = await svc.setStatus(owner, t.id, { status: 'closed', expectedVersion: a.version });
    expect(c.status).toBe('closed');
    const f = await svc.snooze(owner, t.id, { dueAt: new Date(Date.now() + 86400_000).toISOString(), expectedVersion: c.version });
    expect(f.followUpDueAt).not.toBeNull();
    expect((await svc.list(owner, { sort: 'follow_up_due' })).items[0].id).toBe(t.id);
    const l = await svc.linkCustomer(owner, t.id, { customerId: id('c3'), expectedVersion: f.version });
    expect(l.customerId).toBe(id('c3'));
    expect(await code(svc.linkCustomer(owner, t.id, { customerId: id('c9') }))).toBe('CUSTOMER_NOT_FOUND');   // another salon's customer
    expect(await code(svc.assign(owner, t.id, { userId: OTHER }))).toBe('INBOX_ASSIGNEE_INVALID');
    const evs = (await q(`select event_type from communication_thread_events where thread_id = $1 order by created_at`, [t.id])).rows.map((r: any) => r.event_type);
    expect(evs).toEqual(expect.arrayContaining(['assigned', 'status_changed', 'snoozed', 'customer_linked']));
    const au = (await q(`select action from audit_events where tenant_id = $1 and resource_id = $2::text`, [T, t.id])).rows.map((r: any) => r.action);
    expect(au).toEqual(expect.arrayContaining(['inbox.assigned', 'inbox.status_changed', 'inbox.follow_up_set', 'inbox.customer_linked']));
    // a customer text to a closed conversation reopens it
    await recordInboundSms(db, { tenantId: T, from: '215-555-0202', to: '+18565550100', body: 'one more thing', messageSid: 'SM' + 'x'.repeat(32), numMedia: 0 });
    expect((await svc.detail(owner, t.id)).thread.status).toBe('open');
  });
  it('KPIs are counted in SQL over the whole visible inbox, with definitions; realtime events carry ids only', async () => {
    const s = await svc.summary(owner, null);
    const listAll = await svc.list(owner, { pageSize: '50' });
    expect(s.conversations.total).toBe(listAll.total);
    expect(s.conversations.awaiting).toBeGreaterThan(0); expect(s.channelMix.find((x) => x.channel === 'sms')!.count).toBeGreaterThan(0);
    expect(s.sentToday.submitted).toBeGreaterThanOrEqual(1);
    expect(s.definitions.openConversations).toBeTruthy();
    const mine = events.filter((e) => e.event === 'conversation_updated');
    expect(mine.length).toBeGreaterThan(3);
    expect(mine.every((e) => Object.keys(e.payload).sort().join(',') === 'kind,threadId,version')).toBe(true);
    expect(JSON.stringify(mine)).not.toMatch(/\+1\d{10}|Jane|Twin/);
  });
});

// C2 audit (Nov 4 2026)
describe('C2 audit fixes', () => {
  it('a STOP text does not reopen the thread, add unread or start "awaiting reply"', async () => {
    const r = await recordInboundSms(db, { tenantId: T, from: '+12675550777', to: '+18565550100', body: 'Thanks!', messageSid: 'SM' + 'c2a'.padEnd(32, '1'), numMedia: 0 });
    await q(`update communication_threads set status = 'closed', unread_count = 0, awaiting_reply_since = null where id = $1`, [r.threadId]);
    await recordInboundSms(db, { tenantId: T, from: '+12675550777', to: '+18565550100', body: 'STOP', messageSid: 'SM' + 'c2b'.padEnd(32, '1'), numMedia: 0 });
    const [t] = (await q(`select status, unread_count, awaiting_reply_since from communication_threads where id = $1`, [r.threadId])).rows;
    expect(t).toMatchObject({ status: 'closed', unread_count: 0, awaiting_reply_since: null });
  });
  it('a viewer without customers.view cannot find a conversation by its full phone number; by name still works', async () => {
    await recordInboundSms(db, { tenantId: T, from: '+12675550666', to: '+18565550100', body: 'hi', messageSid: 'SM' + 'c2c'.padEnd(32, '1'), numMedia: 0 });
    expect((await svc.list(owner, { q: '2675550666' })).items.length).toBeGreaterThan(0);
    expect((await svc.list(viewer, { q: '2675550666' })).items).toHaveLength(0);
  });
});

describe('C4 audit: a branch number', () => {
  it('a text to Branch 2\'s own number is Branch 2\'s conversation, not the salon-wide one', async () => {
    const { registerTenantNumber } = await import('../tenant-messaging/tenant-number.service');
    expect(await registerTenantNumber(db, { tenantId: T, phoneNumber: '+18565550222', branchId: B2 })).toEqual({ ok: true });
    const a = await recordInboundSms(db, { tenantId: T, from: '+12675550533', to: '+18565550100', body: 'to salon', messageSid: 'SM' + 'c4a'.padEnd(32, '1'), numMedia: 0 });
    const b = await recordInboundSms(db, { tenantId: T, from: '+12675550533', to: '+18565550222', body: 'to branch 2', messageSid: 'SM' + 'c4b'.padEnd(32, '1'), numMedia: 0 });
    expect(a.branchId).toBeNull(); expect(b.branchId).toBe(B2); expect(b.threadId).not.toBe(a.threadId);
  });
});

describe('C2 audit §9.3: a booking made from a conversation is linked back', () => {
  it('links once per appointment; another customer\'s appointment is refused', async () => {
    const tJane = (await svc.list(owner, { q: 'Jane' })).items[0]!.id;
    const appt = (await q(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, status) values ($1, $2, $3, $4, 'Jane Lotus', '2026-11-20', '10:00', '10:45', 'booked') returning id`, [T, B1, id('f1'), id('c1')])).rows[0].id;
    const other = (await q(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, status) values ($1, $2, $3, $4, 'Twin One', '2026-11-20', '11:00', '11:45', 'booked') returning id`, [T, B1, id('f1'), id('c2')])).rows[0].id;
    const r1 = await svc.linkBooking(owner, tJane, { appointmentId: appt });
    const r2 = await svc.linkBooking(owner, tJane, { appointmentId: appt });
    expect(r1.changed).toBe(true); expect(r2.changed).toBe(false);
    expect((await q(`select count(*)::int n from communication_thread_events where thread_id = $1 and event_type = 'booking_created' and new_value = $2`, [tJane, appt])).rows[0].n).toBe(1);
    expect(await code(svc.linkBooking(owner, tJane, { appointmentId: other }))).toBe('APPOINTMENT_NOT_FOUND');
    expect(await code(svc.linkBooking(otherOwner, tJane, { appointmentId: appt }))).toBe('CONVERSATION_NOT_FOUND');
  });
});

describe('C2 gap (Nov 5 2026): conversations that came from a campaign', () => {
  it('source filter keeps threads whose customer was sent the campaign and replied within 14 days; the picker lists it', async () => {
    const C = id('c2');   // Twin One
    const camp = (await q(`insert into retention_sms_campaigns (tenant_id, status, body, body_sha256, label) values ($1, 'completed', 'Come back!', 'x', 'October win-back') returning id`, [T])).rows[0].id;
    await q(`insert into retention_sms_recipients (campaign_id, tenant_id, customer_id, eligibility, status, sent_at) values ($1, $2, $3, 'eligible', 'sent', now() - interval '2 days')`, [camp, T, C]);
    const inWindow = await thread(T, { branch: B1, customer: C, name: 'Twin One', contact: '+12155550202', activity: new Date(Date.now() - 86_400_000).toISOString() });
    await thread(T, { branch: B1, customer: C, name: 'Twin One', contact: '+12155550202', activity: new Date(Date.now() - 5 * 86_400_000).toISOString() });   // before the send
    const r = await svc.list(owner, { campaign: `rsms:${camp}` });
    expect(r.items.map((x: any) => x.id)).toEqual([inWindow]);
    expect(r.filters.campaign).toBe(`rsms:${camp}`);
    const pick = await svc.sourceCampaigns(owner);
    expect(pick.items.find((x: any) => x.value === `rsms:${camp}`)).toMatchObject({ name: 'October win-back', kind: 'rsms' });
    expect((await svc.list(otherOwner, { campaign: `rsms:${camp}` })).items).toHaveLength(0);
  });
});

describe('C2 gap (Nov 5 2026): a delivery report refreshes the reminder / campaign / notification screens live', () => {
  it('a signed status callback for a sent text emits message_delivery_updated (ids + status only)', async () => {
    const env = { sid: process.env.TWILIO_ACCOUNT_SID, tok: process.env.TWILIO_AUTH_TOKEN };
    process.env.TWILIO_ACCOUNT_SID = 'AC' + 'f'.repeat(32); process.env.TWILIO_AUTH_TOKEN = 'platform-token-ib';
    try {
      const sid = 'SM' + 'dl'.padEnd(32, '7');
      await q(`insert into notifications (tenant_id, channel, to_address, body, status, provider_id) values ($1, 'sms', '+12155550202', 'Reminder: tomorrow 10am', 'sent', $2)`, [T, sid]);
      const notifications = new NotificationsService(new KyselyNotificationsRepository(db), platformSms, noEmail, undefined, new KyselyOptOutRepository(db));
      const hook = new TwilioInboundService(db, notifications, testProviderSecrets, realtime);
      const URL = 'https://api.pilot.test/webhooks/twilio/sms/status';
      const p = { MessageSid: sid, MessageStatus: 'delivered', AccountSid: 'AC' + 'f'.repeat(32) };
      const before = events.length;
      const r: any = await hook.handleStatus({ sid, status: 'delivered', signature: computeTwilioSignature('platform-token-ib', URL, p), url: URL, params: p });
      expect(r.status).toBe('recorded');
      const fresh = events.slice(before).filter((e) => e.event === 'message_delivery_updated');
      expect(fresh).toHaveLength(1);
      expect(fresh[0]).toMatchObject({ tenantId: T, payload: { messageSid: sid, status: 'delivered' } });
      expect(JSON.stringify(fresh)).not.toMatch(/\+1\d{10}|Reminder/);
    } finally { for (const [k, v] of [['TWILIO_ACCOUNT_SID', env.sid], ['TWILIO_AUTH_TOKEN', env.tok]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  });
});

// Extras · SMS Inbox 12 — missing-webhook warning from timestamps only
describe('callback health (missing webhook warning)', () => {
  const other: InboxCtx = { tenantId: T2, branchId: BX, userId: OTHER, role: 'OWNER', permissions: ALL, userName: 'Oz Other', authz: { branchIds: null } };
  it('a text handed off 2 h ago with no callback → stale (never "failed"); a later callback for another text → delayed; its own callback clears it', async () => {
    const s0 = await svc.summary(other, null);
    expect(s0.callbacks).toMatchObject({ state: 'ok', awaiting: 0, waitMinutes: 30 });
    const th = await thread(T2, { branch: BX, contact: '+12155554444', activity: new Date(Date.now() - 2 * 3600_000).toISOString() });
    const old = new Date(Date.now() - 2 * 3600_000);
    const n1 = (await q(`insert into notifications (tenant_id, channel, to_address, body, status, provider_id, created_at) values ($1,'sms','+12155554444','See you Friday','sent','SMcb1',$2) returning id`, [T2, old])).rows[0].id;
    await q(`insert into communication_messages (tenant_id, thread_id, direction, channel, body, status, notification_id, author_kind, created_at) values ($1,$2,'outbound','sms','See you Friday','sent',$3,'staff',$4)`, [T2, th, n1, old]);
    // a fresh text (5 min ago) is not yet "waiting too long"
    const fresh = new Date(Date.now() - 5 * 60_000);
    const n2 = (await q(`insert into notifications (tenant_id, channel, to_address, body, status, provider_id, created_at) values ($1,'sms','+12155554444','ok','sent','SMcb2',$2) returning id`, [T2, fresh])).rows[0].id;
    await q(`insert into communication_messages (tenant_id, thread_id, direction, channel, body, status, notification_id, author_kind, created_at) values ($1,$2,'outbound','sms','ok','sent',$3,'staff',$4)`, [T2, th, n2, fresh]);
    const s1 = await svc.summary(other, null);
    expect(s1.callbacks).toMatchObject({ state: 'stale', awaiting: 1, lastCallbackAt: null, oldestAwaitingAt: old.toISOString() });
    expect(s1.sentToday.failed).toBe(s0.sentToday.failed);   // waiting is not failure
    await q(`insert into notification_delivery_events (tenant_id, notification_id, provider_message_sid, provider_status, applied, signature_verified) values ($1,$2,'SMcb2','sent',true,true)`, [T2, n2]);
    expect((await svc.summary(other, null)).callbacks).toMatchObject({ state: 'delayed', awaiting: 1 });
    await q(`insert into notification_delivery_events (tenant_id, notification_id, provider_message_sid, provider_status, applied, signature_verified) values ($1,$2,'SMcb1','delivered',true,true)`, [T2, n1]);
    expect((await svc.summary(other, null)).callbacks).toMatchObject({ state: 'ok', awaiting: 0 });
    expect((await svc.summary(owner, null)).definitions.callbackHealth).toMatch(/never counted as failed/);
  });
});

// Extras · SMS Inbox 14 — performance freshness: source timestamps + unknown / partial warnings
describe('performance freshness', () => {
  const T5 = id('a5'), B5 = id('b51'), O5 = id('e51');
  const own5: InboxCtx = { tenantId: T5, branchId: B5, userId: O5, role: 'OWNER', permissions: ALL, userName: 'Fay', authz: { branchIds: null } };
  it('no call record → missed is unknown; simulated sends → sent partial; waiting callbacks → delivered partial; timestamps come from the records', async () => {
    await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Fern LLC','Fern Nails','ib-fern','IBL005','active')`, [T5]);
    await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Fern Main','active','America/New_York')`, [B5, T5]);
    const empty = await svc.summary(own5, null);
    expect(empty.freshness).toMatchObject({ conversationsAt: null, messagesAt: null, callsAt: null, deliveryCallbacksAt: null });
    expect(empty.freshness.warnings).toEqual([{ metric: 'missed', kind: 'unknown', reason: 'no_call_records', count: null }]);
    const act = new Date(Date.now() - 3 * 3600_000);
    const th = await thread(T5, { branch: B5, contact: '+12155556001', activity: act.toISOString() });
    const old = new Date(Date.now() - 2 * 3600_000);
    const nSent = (await q(`insert into notifications (tenant_id, channel, to_address, body, status, provider_id, created_at) values ($1,'sms','+12155556001','hi','sent','SMfr1',$2) returning id`, [T5, old])).rows[0].id;
    await q(`insert into communication_messages (tenant_id, thread_id, direction, channel, body, status, notification_id, author_kind, created_at) values ($1,$2,'outbound','sms','hi','sent',$3,'staff',$4)`, [T5, th, nSent, old]);
    const nSim = (await q(`insert into notifications (tenant_id, channel, to_address, body, status, created_at) values ($1,'sms','+12155556001','sim','simulated',now()) returning id`, [T5])).rows[0].id;
    const msgAt = new Date(Date.now() - 60_000);
    await q(`insert into communication_messages (tenant_id, thread_id, direction, channel, body, status, notification_id, author_kind, created_at) values ($1,$2,'outbound','sms','sim','sent',$3,'staff',$4)`, [T5, th, nSim, msgAt]);
    const callAt = new Date(Date.now() - 5 * 86400_000);
    await q(`insert into call_intelligence_events (tenant_id, branch_id, provider_call_id, status, started_at) values ($1,$2,'CALLFR1','answered_ai',$3)`, [T5, B5, callAt]);
    const s = await svc.summary(own5, null);
    expect(s.freshness.messagesAt).toBe(msgAt.toISOString());
    expect(s.freshness.callsAt).toBe(callAt.toISOString());
    expect(s.freshness.conversationsAt).not.toBeNull();
    expect(s.conversations.missed).toBe(0);                     // a real zero now: calls do reach the ledger
    expect(s.freshness.warnings).toEqual([
      { metric: 'sentToday', kind: 'partial', reason: 'simulated_sends', count: 1 },
      { metric: 'delivered', kind: 'partial', reason: 'callbacks_stale', count: 1 },
    ]);
    // another salon's records never move this salon's timestamps
    expect((await svc.summary(otherOwner, null)).freshness.callsAt).toBeNull();
  });
});

// Extras · SMS Inbox 02 — KPI accuracy: every tile's calculation, the salon-day scope, unknown states and no double counting
describe('KPI accuracy (extras SMS Inbox 02)', () => {
  const T6 = id('a6'), B61 = id('b61'), B62 = id('b62'), O6 = id('e61'), M6 = id('e62');
  const own6: InboxCtx = { tenantId: T6, branchId: B61, userId: O6, role: 'OWNER', permissions: ALL, userName: 'Gia', authz: { branchIds: null } };
  const mgr6: InboxCtx = { tenantId: T6, branchId: B62, userId: M6, role: 'MANAGER', permissions: ALL, userName: 'Hal', authz: { branchIds: [B62] } };
  it('counts each tile once from its own records, salon day in the branch zone, a closed thread is never awaiting, branch scope and another salon never', async () => {
    await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Gem LLC','Gem Nails','ib-gem','IBL006','active')`, [T6]);
    await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$3,'Gem Main','active','America/Los_Angeles'), ($2,$3,'Gem Two','active','America/Los_Angeles')`, [B61, B62, T6]);
    const otherBefore = await svc.summary(otherOwner, null);
    const before = await svc.summary(own6, null);
    expect(before.conversations).toMatchObject({ total: 0, open: 0, unreadThreads: 0, unreadMessages: 0, awaiting: 0, oldestAwaitingSince: null });
    // no call ledger yet: the 0 is flagged unknown, never presented as a clean zero
    expect(before.freshness.warnings).toContainEqual({ metric: 'missed', kind: 'unknown', reason: 'no_call_records', count: null });
    const hr = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
    // B61: open + awaiting (3 unread), replied, closed-with-stale-awaiting (never awaiting); B62: pending (1 unread); salon-wide email
    const oldest = hr(5);
    const a = await thread(T6, { branch: B61, contact: '+12135556001', activity: oldest, status: 'open', awaiting: oldest });
    await thread(T6, { branch: B61, contact: '+12135556002', activity: hr(4), status: 'replied' });
    await thread(T6, { branch: B61, contact: '+12135556003', activity: hr(30), status: 'closed', awaiting: hr(30) });
    const d = await thread(T6, { branch: B62, contact: '+12135556004', activity: hr(2), status: 'pending', awaiting: hr(2) });
    await thread(T6, { branch: null, contact: 'gem@guest.test', channel: 'email', activity: hr(1), status: 'open' });
    await q(`update communication_threads set unread_count = 3 where id = $1`, [a]);
    await q(`update communication_threads set unread_count = 1 where id = $1`, [d]);
    // outbound texts on thread a: just before the salon's midnight (yesterday — never "today"), and today: one delivered
    // (by the provider status only), one handed over and waiting, one failed at the provider, one simulated
    const midnight = `((now() at time zone 'America/Los_Angeles')::date)::timestamp at time zone 'America/Los_Angeles'`;
    const note = async (status: string, provider: string | null) => (await q(`insert into notifications (tenant_id, channel, to_address, body, status, provider_status) values ($1,'sms','+12135556001','x',$2,$3) returning id`, [T6, status, provider])).rows[0].id;
    const msg = async (nid: string | null, status: string, at: string) => q(`insert into communication_messages (tenant_id, thread_id, direction, channel, body, status, notification_id, author_kind, created_at) values ($1,$2,'outbound','sms','x',$3,$4,'staff',${at})`, [T6, a, status, nid]);
    await msg(await note('delivered', 'delivered'), 'sent', `${midnight} - interval '30 minutes'`);
    await msg(await note('sent', 'delivered'), 'sent', `greatest(${midnight} + interval '1 second', now() - interval '1 minute')`);
    await msg(await note('sent', null), 'sent', `greatest(${midnight} + interval '1 second', now() - interval '1 minute')`);
    await msg(await note('failed', 'undelivered'), 'sent', `greatest(${midnight} + interval '1 second', now() - interval '1 minute')`);
    await msg(await note('simulated', null), 'sent', `greatest(${midnight} + interval '1 second', now() - interval '1 minute')`);
    // calls: missed today in B61, missed yesterday in B61 (not today), answered today in B62
    await q(`insert into call_intelligence_events (tenant_id, branch_id, provider_call_id, status, started_at) values
      ($1,$2,'GEM1','missed', greatest(${midnight} + interval '1 second', now() - interval '1 minute')),
      ($1,$2,'GEM2','missed', ${midnight} - interval '1 hour'),
      ($1,$3,'GEM3','answered_ai', now() - interval '2 minutes')`, [T6, B61, B62]);
    const s = await svc.summary(own6, null);
    expect(s.scope.tz).toBe('America/Los_Angeles');
    expect(s.conversations).toMatchObject({ total: 5, open: 3, unreadThreads: 2, unreadMessages: 4, replied: 1, awaiting: 2, missed: 1 });
    expect(s.conversations.oldestAwaitingSince).toBe(oldest);       // the open thread's, not the closed one's older stamp
    expect(s.channelMix).toEqual([{ channel: 'sms', count: 4 }, { channel: 'email', count: 1 }, { channel: 'call', count: 0 }]);
    // today only: 4 texts; the failed one never "left" (failed only); delivered once although both the status and provider say so
    expect(s.sentToday).toEqual({ total: 3, submitted: 2, delivered: 1, failed: 1, simulated: 1 });
    // a manager of B62 sees B62 + salon-wide threads only; B61's texts and missed call are not theirs
    const m = await svc.summary(mgr6, null);
    expect(m.conversations).toMatchObject({ total: 2, open: 2, unreadThreads: 1, unreadMessages: 1, awaiting: 1, missed: 0 });
    expect(m.sentToday.total).toBe(0);
    // one branch picked: B61 only (the salon-wide email thread is not in a branch)
    const b1 = await svc.summary(own6, B61);
    expect(b1.conversations).toMatchObject({ total: 3, open: 1, awaiting: 1, missed: 1 });
    // another salon's records never move these counts
    const o = await svc.summary(otherOwner, null);
    expect(o.conversations).toEqual(otherBefore.conversations);
    expect(o.sentToday).toEqual(otherBefore.sentToday);
  });
});

// Extras · Customer Notifications 03 — Mark all as read with a cutoff
describe('mark all as read with a cutoff', () => {
  const T3 = id('a3'), C1 = id('b31'), C2 = id('b32'), O3 = id('e31'), M3 = id('e32');
  const own3: InboxCtx = { tenantId: T3, branchId: C1, userId: O3, role: 'OWNER', permissions: ALL, userName: 'Ann', authz: { branchIds: null } };
  const mgr3: InboxCtx = { tenantId: T3, branchId: C2, userId: M3, role: 'MANAGER', permissions: ALL, userName: 'Ben', authz: { branchIds: [C2] } };
  const view3: InboxCtx = { tenantId: T3, branchId: C1, userId: M3, role: 'RECEPTIONIST', permissions: ['pos.communications.view'], userName: 'Ben', authz: { branchIds: null } };
  async function unread(branch: string | null, inboundAt: Date, contact: string) {
    const t = await thread(T3, { branch, contact, activity: inboundAt.toISOString() });
    await q(`update communication_threads set unread_count = 2, last_inbound_at = $2 where id = $1`, [t, inboundAt]);
    return t;
  }
  const unreadOf = async (t: string) => Number((await q(`select unread_count from communication_threads where id = $1`, [t])).rows[0].unread_count);
  it('marks only conversations whose customer wrote at or before the cutoff; newer texts, other branches and other salons stay unread', async () => {
    await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Rose LLC','Rose Nails','ib-rose','IBL003','active')`, [T3]);
    await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$3,'Rose Main','active','America/New_York'), ($2,$3,'Rose Two','active','America/New_York')`, [C1, C2, T3]);
    await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$3,'Ann Owner','ann@ib.test','active','OWNER'), ($2,$3,'Ben Manager','ben@ib.test','active','MANAGER')`, [O3, M3, T3]);
    const cutoff = new Date(Date.now() - 10 * 60_000);
    const old1 = await unread(C1, new Date(cutoff.getTime() - 60_000), '+16095551001');
    const old2 = await unread(C2, new Date(cutoff.getTime() - 3600_000), '+16095551002');
    const atCut = await unread(null, cutoff, '+16095551003');
    const newer = await unread(C2, new Date(cutoff.getTime() + 60_000), '+16095551004');   // arrived after the list was shown
    const otherSalon = (await q(`select id from communication_threads where tenant_id = $1 limit 1`, [T])).rows[0].id;
    await q(`update communication_threads set unread_count = 3, last_inbound_at = $2 where id = $1`, [otherSalon, new Date(cutoff.getTime() - 86_400_000)]);
    // a viewer cannot bulk-mark; a branch manager only reaches their branch (+ salon-wide) and cannot ask for another branch
    expect(await code(svc.markAllRead(view3, { cutoff: cutoff.toISOString() }))).toBe('PERMISSION_DENIED');
    expect(await code(svc.markAllRead(mgr3, { cutoff: cutoff.toISOString(), branch: C1 }))).toBe('INBOX_BRANCH_NOT_AUTHORIZED');
    expect(await code(svc.markAllRead(own3, { cutoff: 'not a date' }))).toBe('DATE_INVALID');
    const before = events.length;
    const m = await svc.markAllRead(mgr3, { cutoff: cutoff.toISOString() });
    expect(m).toEqual({ cutoff: cutoff.toISOString(), branch: null, marked: 2, skippedNewer: 1 });   // old2 (C2) + atCut (salon-wide)
    expect(await unreadOf(old2)).toBe(0); expect(await unreadOf(atCut)).toBe(0);
    expect(await unreadOf(old1)).toBe(2);       // branch 1 is outside the manager's scope
    expect(await unreadOf(newer)).toBe(2);      // the newer text is never erased
    expect(await unreadOf(otherSalon)).toBe(3);
    // the owner's pass picks up branch 1; the newer one still stays unread
    const o = await svc.markAllRead(own3, { cutoff: cutoff.toISOString(), branch: 'all' });
    expect(o).toMatchObject({ marked: 1, skippedNewer: 1 });
    expect(await unreadOf(old1)).toBe(0); expect(await unreadOf(newer)).toBe(2);
    // nothing left → a no-op with no audit row
    expect(await svc.markAllRead(own3, { cutoff: cutoff.toISOString() })).toMatchObject({ marked: 0, skippedNewer: 1 });
    const au = (await q(`select metadata from audit_events where tenant_id = $1 and action = 'inbox.read_all' order by occurred_at`, [T3])).rows;
    expect(au).toHaveLength(2);
    expect(au[0].metadata).toMatchObject({ cutoff: cutoff.toISOString(), marked: 2, skippedNewer: 1 });
    const evs = (await q(`select thread_id, previous_value, new_value, reason from communication_thread_events where tenant_id = $1 and event_type = 'read' order by thread_id`, [T3])).rows;
    expect(evs.map((e: any) => e.thread_id).sort()).toEqual([old1, old2, atCut].sort());
    expect(evs.every((e: any) => e.previous_value === '2' && e.new_value === '0' && e.reason === 'mark_all_read')).toBe(true);
    const mine = events.slice(before).filter((e) => e.event === 'conversation_updated' && e.payload.kind === 'read').map((e) => e.payload.threadId);
    expect(new Set(mine)).toEqual(new Set([old1, old2, atCut]));
  });
  it('a cutoff ahead of the server clock is clamped to now, so a text that arrives later is not swallowed', async () => {
    const r = await svc.markAllRead(own3, { cutoff: new Date(Date.now() + 3600_000).toISOString() });
    expect(new Date(r.cutoff).getTime()).toBeLessThanOrEqual(Date.now());
  });
});
