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
