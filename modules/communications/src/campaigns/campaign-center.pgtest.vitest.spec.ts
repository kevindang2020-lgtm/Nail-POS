// campaign-center.pgtest — Campaign Center Complete Build Guide (30 Oct 2026) on the REAL schema (every migration incl. 739).
// The guide's §19 matrix, executable: the "spring into glow" 50 / 0 / Completed audit, distinct counts, audience snapshot from a
// Customer Segments draft, approval gating + edit-after-approval invalidation, launch idempotency, the REAL send executor
// (AiMarketingSendService) over the approved snapshot with consent changed after scheduling, delivery callbacks, ROI only with
// real cost, search beyond page 1, salon-timezone date basis, numbered paging, branch + tenant isolation, the existing
// schedule route's gate, the health checker's trace, and the assistant (drafts only, never-visited excluded from win-back).
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { CampaignCenter, campaignSendReadiness, countsOf } from './campaign-center';
import { CampaignsService } from './campaigns.service';
import { AiMarketingSendService } from '../../../ai/src/ai-marketing/ai-marketing-send.service';
import { snapshotRecipients } from '../../../ai/src/ai-marketing/ai-marketing-send.adapters';

const P = 'd7390000-0000-4000-8000-0000000';
const id = (s: string) => P + s.padStart(5, '0');
const T = id('a1'), TX = id('a2'), B = id('b1'), B2 = id('b2'), BX = id('b9'), OWNER = id('e1'), MGR = id('e2'), FD = id('e3'), OX = id('e9');
const perms = ['pos.marketing.view', 'pos.marketing.manage', 'pos.customers.view'];
const owner: any = { tenantId: T, branchId: null, userId: OWNER, role: 'OWNER', permissions: perms };
const manager: any = { tenantId: T, branchId: null, userId: MGR, role: 'MANAGER', permissions: perms };
const frontDesk: any = { tenantId: T, branchId: B, userId: FD, role: 'FRONT_DESK', permissions: ['pos.marketing.view', 'pos.marketing.manage'] };
const viewer: any = { tenantId: T, branchId: null, userId: FD, role: 'FRONT_DESK', permissions: ['pos.marketing.view'] };
const other: any = { tenantId: TX, branchId: null, userId: OX, role: 'OWNER', permissions: perms };
let db: any; let cc: CampaignCenter; let n = 0;
const q = async (s: any) => (await s.execute(db)).rows as any[];
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e: any) { return e?.code ?? e?.name + ':' + e?.message; } }

async function customer(name: string, opts: { phone?: string | null; email?: string | null; sms?: boolean; emailOk?: boolean; branch?: string; tenant?: string } = {}) {
  const cid = id('c' + (++n));
  await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, status, marketing_sms_opt_in, marketing_email_opt_in)
    values (${cid}, ${opts.tenant ?? T}, ${opts.branch ?? B}, ${name.split(' ')[0]}, ${name.split(' ')[1] ?? 'X'}, ${name}, ${opts.phone === undefined ? '+1609555' + String(1000 + n) : opts.phone}, ${opts.email ?? null}, 'active', ${opts.sms ?? true}, ${opts.emailOk ?? false})`);
  return cid;
}
async function paidVisit(cid: string, daysAgo: number, cents = 5000) {
  await q(sql`insert into tickets (tenant_id, branch_id, customer_id, status, total_cents, subtotal_cents, tax_cents, discount_cents, paid_at, created_at)
    values (${T}, ${B}, ${cid}, 'paid', ${cents}, ${cents}, 0, 0, now() - make_interval(days => ${daysAgo}), now() - make_interval(days => ${daysAgo}))`);
}
/** a Customer Segments audience draft, exactly as the Segments Audience Builder stores it */
async function audienceDraft(members: Array<[string, string]>, channel = 'sms', opts: { expired?: boolean } = {}) {
  const d = (await q(sql`insert into segment_audience_drafts (tenant_id, channel, ruleset_version, segment, selection_mode, selected_count, eligible_count, excluded_count, idempotency_key, expires_at)
    values (${T}, ${channel}, 'segments-v1', 'returning', 'selected', ${members.length}, ${members.filter((m) => m[1] === 'eligible').length}, ${members.filter((m) => m[1] !== 'eligible').length},
      ${'k' + (++n)}, now() + ${opts.expired ? sql`interval '-1 hour'` : sql`interval '1 day'`}) returning id`))[0].id;
  for (const [cid, el] of members) await q(sql`insert into segment_audience_members (draft_id, tenant_id, customer_id, eligibility, destination_masked) values (${d}, ${T}, ${cid}, ${el}, '••• 0000')`);
  return String(d);
}

/** the executor's ports over the real tables (the production ledger adapter uses the Kysely query builder this runner lacks;
 *  this one is the same contract in raw SQL — insert-if-absent on the 320 unique index, final statuses never rewritten) */
function executor(sent: Array<{ to: string; body: string; subject?: string | null }>, opts: { failFor?: string } = {}) {
  const lifecycle = {
    detail: async (_c: any, cid: string) => { const r = (await q(sql`select id, status, channel from campaigns where tenant_id = ${T} and id = ${cid}`))[0]; return { ...r, id: String(r.id) } as any; },
    transition: async (_c: any, cid: string, to: string) => { await q(sql`update campaigns set status = ${to}, started_at = case when ${to} = 'in_progress' then coalesce(started_at, now()) else started_at end,
        completed_at = case when ${to} = 'completed' then coalesce(completed_at, now()) else completed_at end where tenant_id = ${T} and id = ${cid}`); return { id: cid, status: to } as any; },
  };
  const parse = (k: string) => k.split('|');
  const ledger = {
    claim: async (_k: string, p: any) => {
      const ins = (await q(sql`insert into ai_marketing_campaign_sends (tenant_id, branch_id, campaign_id, customer_id, channel, message_version, status) values (${p.tenantId}, ${p.branchId}, ${p.campaignId}, ${p.customerId}, ${p.channel}, ${p.messageVersion}, 'queued')
        on conflict (tenant_id, campaign_id, customer_id, channel, message_version) do nothing returning id`))[0];
      if (ins) return { created: true, status: 'queued' };
      const ex = (await q(sql`select status from ai_marketing_campaign_sends where tenant_id = ${p.tenantId} and campaign_id = ${p.campaignId} and customer_id = ${p.customerId} and channel = ${p.channel} and message_version = ${p.messageVersion}`))[0];
      return { created: false, status: String(ex?.status ?? 'queued') };
    },
    markSent: async (k: string, pid: string | null) => { const [t, c, cu, ch, v] = parse(k); await q(sql`update ai_marketing_campaign_sends set status = 'sent', provider_id = ${pid}, updated_at = now() where tenant_id = ${t} and campaign_id = ${c} and customer_id = ${cu} and channel = ${ch} and message_version = ${Number(v)} and status = 'queued'`); },
    markSkipped: async (k: string, reason: string) => { const [t, c, cu, ch, v] = parse(k); await q(sql`update ai_marketing_campaign_sends set status = 'skipped', skip_reason = ${reason}, updated_at = now() where tenant_id = ${t} and campaign_id = ${c} and customer_id = ${cu} and channel = ${ch} and message_version = ${Number(v)} and status = 'queued'`); },
    markFailed: async (k: string, reason: string) => { const [t, c, cu, ch, v] = parse(k); await q(sql`update ai_marketing_campaign_sends set status = 'failed', skip_reason = ${reason}, updated_at = now() where tenant_id = ${t} and campaign_id = ${c} and customer_id = ${cu} and channel = ${ch} and message_version = ${Number(v)} and status = 'queued'`); },
  };
  const recipients = { enumerate: async (ctx: any, c: any) => { const plan = (await q(sql`select audience_definition from ai_marketing_campaign_plans where tenant_id = ${ctx.tenantId} and campaign_id = ${c.id}`))[0]; const def = typeof plan.audience_definition === 'string' ? JSON.parse(plan.audience_definition) : plan.audience_definition; return snapshotRecipients(db, ctx.tenantId, c.id, def.snapshotVersion, c.channel); } };
  const suppression = { isOptedOut: async (t: string, ch: string, addr: string) => !!(await q(sql`select 1 from notification_opt_outs where tenant_id = ${t} and channel = ${ch} and address = ${addr}`))[0] };
  // the TEST sender (never a provider): it logs the message the way notifications.service does, with a provider id
  const dispatcher = { send: async (_ctx: any, m: any) => {
    if (opts.failFor && m.to === opts.failFor) throw new Error('provider_error 30007');
    sent.push({ to: m.to, body: m.body, subject: m.subject ?? null });
    const pid = 'SMtest' + (++n);
    await q(sql`insert into notifications (tenant_id, channel, to_address, body, customer_id, status, provider_id) values (${T}, ${m.channel}, ${m.to}, ${m.body}, ${m.customerId}, 'sent', ${pid})`);
    return { sent: true, status: 'sent', providerId: pid };
  } };
  return new AiMarketingSendService(lifecycle as any, recipients as any, ledger as any, { evaluate: async () => ({ action: 'allow' as const }) }, suppression as any, { isActive: async () => false }, dispatcher as any);
}

let legacyId = ''; let cA = ''; let custs: string[] = []; let draftA = '';

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Pilot', 'Pilot Nail Salon', 'cc-pilot', 'CCPILOT', 'active'), (${TX}, 'Other', 'Other Salon', 'cc-other', 'CCOTHER', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York'), (${B2}, ${T}, 'Second', 'America/New_York'), (${BX}, ${TX}, 'X', 'America/New_York')`);
  for (const [u, t, r] of [[OWNER, T, 'OWNER'], [MGR, T, 'MANAGER'], [FD, T, 'FRONT_DESK'], [OX, TX, 'OWNER']]) await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${u}, ${t}, ${r + ' Person'}, ${u + '@cc.test'}, 'active', ${r})`);
  // the owner's real case: created through the old form with a typed "audience size" 50, then Activate → Complete by hand
  legacyId = id('f1');
  await q(sql`insert into campaigns (id, tenant_id, branch_id, name, offer, channel, audience_label, audience_size, status, created_by, created_at, started_at)
    values (${legacyId}, ${T}, null, 'spring into glow', '20% off', 'sms', 'Lapsed clients', 50, 'completed', ${OWNER}, now() - interval '3 days', now() - interval '3 days')`);
  cc = new CampaignCenter(db);
}, 240_000);

describe('§03 data audit — spring into glow: audience 50 / sent 0 / Completed', () => {
  it('is reported as a hand-typed estimate with NO send record — never "50 reached"; the row itself is unchanged', async () => {
    const list: any = await cc.list(owner, { q: 'spring', preset: 'all' });
    expect(list.pagination.totalItems).toBe(1);
    const r = list.items[0];
    expect(r.counts).toMatchObject({ selected: 50, selectedIsEstimate: true, eligible: null, queued: 0, attempted: 0, submitted: 0, delivered: 0, booked: 0, roi: null });
    expect(r).toMatchObject({ displayStatus: 'completed', outcome: 'completed_no_send_record', audienceSource: 'manual_estimate' });
    const ov: any = await cc.overview(owner, { preset: 'all' });
    expect(ov.funnel.find((f: any) => f.key === 'selected').value).toBe(0);     // an estimate is not a selection
    expect(ov.funnel.find((f: any) => f.key === 'submitted').value).toBe(0);
    expect(ov.legacyEstimateTotal).toBe(50);
    expect(ov.kpis).toMatchObject({ totalSent: 0, avgRoi: null, avgOpenRate: null });
    const h: any = await cc.healthCheck(owner, { campaignId: legacyId }, {});
    expect(h.sendsAnything).toBe(false);
    expect(h.trace).toMatchObject({ status: 'completed', audienceSource: 'manual_estimate', plan: null, ledgerRows: 0, submitted: 0 });
    expect(h.findings.find((f: any) => f.subsystem === 'execution')).toMatchObject({ status: 'attention_required' });
    expect(h.findings.find((f: any) => f.subsystem === 'execution').summary).toMatch(/no send was ever recorded/i);
    expect((await q(sql`select audience_size, sent_count, status from campaigns where id = ${legacyId}`))[0]).toEqual({ audience_size: 50, sent_count: 0, status: 'completed' });
    expect(Number((await q(sql`select count(*)::int as n from campaign_health_runs where tenant_id = ${T} and campaign_id = ${legacyId}`))[0].n)).toBe(1);
  });
  it('the existing schedule route refuses a campaign with no approved audience (CampaignsService gate)', async () => {
    const legacy2 = id('f2');
    await q(sql`insert into campaigns (id, tenant_id, name, channel, audience_size, status) values (${legacy2}, ${T}, 'typed only', 'sms', 40, 'draft')`);
    const repo: any = { get: async (_c: any, cid: string) => { const r = (await q(sql`select * from campaigns where id = ${cid}`))[0]; return r ? { id: String(r.id), status: r.status, channel: r.channel, audienceSize: r.audience_size, branchId: null } : null; },
      setStatus: async () => { throw new Error('must not move'); }, sendReadiness: (c: any, cid: string) => campaignSendReadiness(db, c.tenantId, cid) };
    const svc = new CampaignsService(repo);
    expect(await code(svc.schedule(owner, legacy2))).toBe('CAMPAIGN_AUDIENCE_NOT_SELECTED');
    expect(await code(svc.activate(owner, legacy2, { confirmEstimate: true }))).toBe('CAMPAIGN_AUDIENCE_NOT_SELECTED');
  });
});

describe('§08 wizard: details → audience snapshot → message → preview → approval → launch', () => {
  it('creates a draft; a Segments audience becomes snapshot 1 with distinct selected / eligible / excluded', async () => {
    custs = [await customer('Ava Kim'), await customer('Ben Lee'), await customer('Cara Diaz', { sms: false }), await customer('Dee Moe', { phone: null })];
    for (const c of custs) await paidVisit(c, 20);
    cA = (await cc.createDraft(owner, { name: 'Fall glow', channel: 'sms', goal: 'Bring back regulars', messageBody: 'Hi from {salon_name}! {offer} this week.', offer: '15% off' })).id;
    draftA = await audienceDraft([[custs[0], 'eligible'], [custs[1], 'eligible'], [custs[2], 'no_consent'], [custs[3], 'no_phone']]);
    expect(await cc.setAudience(owner, cA, { draftId: draftA })).toEqual({ snapshotVersion: 1, selected: 4, eligible: 2, excluded: 2 });
    const d: any = await cc.detail(owner, cA);
    expect(d.counts).toMatchObject({ selected: 4, selectedIsEstimate: false, eligible: 2, excluded: 2, submitted: 0 });
    expect(d.exclusionReasons).toEqual(expect.arrayContaining([{ reason: 'no_consent', count: 1 }, { reason: 'no_phone', count: 1 }]));
    expect((await q(sql`select campaign_id from segment_audience_drafts where id = ${draftA}`))[0].campaign_id).toBe(cA);
    // wrong channel / expired drafts are refused
    expect(await code(cc.setAudience(owner, cA, { draftId: await audienceDraft([[custs[0], 'eligible']], 'email') }))).toBe('AUDIENCE_CHANNEL_MISMATCH');
    expect(await code(cc.setAudience(owner, cA, { draftId: await audienceDraft([[custs[0], 'eligible']], 'sms', { expired: true }) }))).toBe('AUDIENCE_DRAFT_CLOSED');
  });
  it('preview renders the message, segments and cost note — and sends nothing', async () => {
    const before = Number((await q(sql`select count(*)::int as n from notifications where tenant_id = ${T}`))[0].n);
    const p: any = await cc.preview(owner, cA);
    const priceRaw = (await q(sql`select value from platform_settings where setting_key = 'sms.marketing_segment_price_cents'`))[0]?.value;
    const unit = priceRaw == null ? null : Number(String(priceRaw).replace(/"/g, ''));
    expect(p).toMatchObject({ sends: false, eligible: 2, selected: 4, segmentsPerMessage: 1, estimatedSegments: 2, estimatedCostCents: unit == null ? null : Math.round(2 * unit) });
    expect(p.body).toBe('Hi from Pilot Nail Salon! 15% off this week.');
    expect(p.asSent).toMatch(/Reply STOP to opt out$/);
    expect(Number((await q(sql`select count(*)::int as n from notifications where tenant_id = ${T}`))[0].n)).toBe(before);
    expect(Number((await q(sql`select count(*)::int as n from ai_marketing_campaign_sends where campaign_id = ${cA}`))[0].n)).toBe(0);
  });
  it('launch needs approval; a role without marketing.manage cannot approve; approval writes the plan; an edit voids it; re-approval bumps the version', async () => {
    expect(await code(cc.launch(owner, cA, { confirm: true }))).toBe('CAMPAIGN_APPROVAL_REQUIRED');
    await cc.submit(manager, cA);
    expect((await cc.list(owner, { status: 'awaiting_approval' })).items.map((x: any) => x.id)).toContain(cA);
    // AI Marketing 10 (source verification): 'all_drafts' is the Drafts card's own set — every campaign still in status draft
    expect((await cc.list(owner, { status: 'all_drafts' })).items.map((x: any) => x.id)).toContain(cA);
    expect((await cc.list(owner, { status: 'draft' })).items.map((x: any) => x.id)).not.toContain(cA);
    expect(await code(cc.approve(viewer, cA))).toBe('PERMISSION_DENIED');
    expect(await cc.approve(owner, cA)).toMatchObject({ approved: true, messageVersion: 1 });
    const plan = (await q(sql`select message_version, body, audience_definition from ai_marketing_campaign_plans where campaign_id = ${cA}`))[0];
    expect(plan).toMatchObject({ message_version: 1, body: 'Hi from Pilot Nail Salon! 15% off this week.' });
    expect(plan.audience_definition).toMatchObject({ campaignSnapshot: true, snapshotVersion: 1 });
    expect((await cc.list(owner, { status: 'approved' })).items.map((x: any) => x.id)).toContain(cA);
    expect((await cc.list(owner, { status: 'all_drafts' })).items.map((x: any) => x.id)).toContain(cA);   // approved, not yet launched: still a draft
    expect(await cc.updateDraft(owner, cA, { messageBody: 'Hi from {salon_name}! {offer} — this week only.' })).toMatchObject({ approvalVoided: true });
    expect(await campaignSendReadiness(db, T, cA)).toMatchObject({ ok: false, code: 'CAMPAIGN_APPROVAL_STALE' });
    expect(await code(cc.launch(owner, cA, { confirm: true }))).toBe('CAMPAIGN_APPROVAL_STALE');
    expect(await cc.approve(manager, cA)).toMatchObject({ messageVersion: 2 });
    expect(await code(cc.launch(owner, cA, {}))).toBe('CAMPAIGN_CONFIRMATION_REQUIRED');
  });
  it('launch moves it to scheduled once; a second launch is refused; scheduled → draft is allowed before sending', async () => {
    const at = new Date(Date.now() - 1000).toISOString();
    expect(await cc.launch(owner, cA, { confirm: true, at })).toMatchObject({ status: 'scheduled', eligible: 2 });
    expect((await cc.list(owner, { status: 'all_drafts' })).items.map((x: any) => x.id)).not.toContain(cA);   // launched: no longer a draft
    expect(await code(cc.launch(owner, cA, { confirm: true }))).toBe('CAMPAIGN_ALREADY_LAUNCHED');
    expect(await cc.unschedule(owner, cA)).toMatchObject({ status: 'draft' });
    expect(await campaignSendReadiness(db, T, cA)).toMatchObject({ ok: true, eligible: 2 });   // approval still matches the content
    await cc.launch(owner, cA, { confirm: true, at });
    expect((await q(sql`select string_agg(action, ',' order by occurred_at, id) as a from audit_events where tenant_id = ${T} and resource_id = ${cA}`))[0].a)
      .toBe('campaign.created,campaign.audience_set,campaign.approval_requested,campaign.approved,campaign.updated,campaign.approved,campaign.launched,campaign.unscheduled,campaign.launched');
    // Nov 8 2026: the launch dialog's datetime-local value has no zone — it is SALON time (New York), not the server's UTC
    expect(await cc.unschedule(owner, cA)).toMatchObject({ status: 'draft' });
    const local = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    const r: any = await cc.launch(owner, cA, { confirm: true, at: `${local}T10:00` });
    const ny = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(r.scheduledAt));
    expect(ny.replace(',', '')).toBe(`${local} 10:00`);   // 10:00 in the salon, whatever the server's zone
    expect(await cc.unschedule(owner, cA)).toMatchObject({ status: 'draft' });
    await cc.launch(owner, cA, { confirm: true, at });   // back to the original (due) time for the executor tests below
  });
});

describe('AI Marketing Assistant 05 — campaign bookings are de-duplicated', () => {
  it('a booking recorded twice for one appointment counts once (list, details, cost per booking); duplicates and the booking span are reported', async () => {
    const cid = String((await q(sql`insert into campaigns (tenant_id, branch_id, name, channel, status, audience_size) values (${T}, ${B}, 'Dedupe test', 'sms', 'completed', 0) returning id`))[0].id);
    const ev = (appt: string, hoursAgo: number) => q(sql`insert into ai_booking_conversion_events (tenant_id, branch_id, source, stage, outcome, campaign_id, appointment_id, created_at)
      values (${T}, ${B}, 'link', 'BOOKING_SUCCEEDED', 'succeeded', ${cid}, ${appt}, now() - make_interval(hours => ${hoursAgo}))`);
    await ev('appt-dd-1', 30); await ev('appt-dd-1', 29); await ev('appt-dd-2', 5);
    await q(sql`insert into ai_booking_conversion_events (tenant_id, branch_id, source, stage, outcome, campaign_id, appointment_id, created_at) values (${T}, ${B}, 'link', 'BOOKING_FAILED', 'failed', ${cid}, 'appt-dd-3', now())`);
    const d: any = await cc.detail(owner, cid);
    expect(d.counts).toMatchObject({ booked: 2, bookedDuplicatesIgnored: 1 });
    expect(new Date(d.counts.firstBookedAt).getTime()).toBeLessThan(new Date(d.counts.lastBookedAt).getTime());
    expect(d.definitions.booked).toMatch(/each appointment counts once/);
    const row = (await cc.list(owner, { q: 'Dedupe test' })).items.find((x: any) => x.id === cid);
    expect(row.counts.booked).toBe(2);
  });
});

describe('AI Marketing Assistant 09 — delivery failure triage', () => {
  it('splits invalid contacts, provider refusals, carrier failures, missing callbacks and waiting sends; states the retry rule; reads only', async () => {
    const cid = (await q(sql`insert into campaigns (tenant_id, branch_id, name, channel, status, audience_size) values (${T}, ${B}, 'Triage test', 'sms', 'in_progress', 0) returning id`))[0].id;
    const people = [];
    for (let i = 0; i < 7; i++) people.push(await customer('Tri Age' + i));
    const send = async (cu: string, status: string, o: { reason?: string; pid?: string; nStatus?: string; code?: string; hoursAgo?: number } = {}) => {
      if (o.pid) await q(sql`insert into notifications (tenant_id, channel, to_address, body, customer_id, status, provider_id, provider_error_code) values (${T}, 'sms', '+1', 'x', ${cu}, ${o.nStatus ?? 'sent'}, ${o.pid}, ${o.code ?? null})`);
      await q(sql`insert into ai_marketing_campaign_sends (tenant_id, branch_id, campaign_id, customer_id, channel, message_version, status, skip_reason, provider_id, created_at, updated_at)
        values (${T}, ${B}, ${cid}, ${cu}, 'sms', 1, ${status}, ${o.reason ?? null}, ${o.pid ?? null}, now() - make_interval(hours => ${o.hoursAgo ?? 0}), now() - make_interval(hours => ${o.hoursAgo ?? 0}))`);
    };
    await send(people[0], 'skipped', { reason: 'missing_contact' });
    await send(people[1], 'sent', { pid: 'TRI1', nStatus: 'failed', code: '21614' });          // not a mobile number
    await send(people[2], 'sent', { pid: 'TRI2', nStatus: 'failed', code: '30007' });          // carrier filtered
    await send(people[3], 'failed', { reason: 'Sender is not configured' });
    await send(people[4], 'sent', { pid: 'TRI3', nStatus: 'sent', hoursAgo: 3 });              // no callback after 3 h
    await send(people[5], 'sent', { pid: 'TRI4', nStatus: 'delivered', hoursAgo: 3 });
    await send(people[6], 'queued', { hoursAgo: 2 });
    const before = await q(sql`select status, skip_reason from ai_marketing_campaign_sends where campaign_id = ${cid} order by customer_id`);
    const d: any = await cc.detail(owner, String(cid));
    expect(d.triage).toMatchObject({ invalidContact: 2, missingContact: 1, invalidNumber: 1, refusedAtSend: 1, refusedReasons: [{ reason: 'Sender is not configured', count: 1 }],
      carrierFailed: 1, noCallbackOver1h: 1, waitingToSend: 1, retry: { waitingResumedByNextSweep: true, failedResent: false } });
    expect(d.triage.oldestNoCallbackAt).toEqual(expect.any(String)); expect(d.triage.oldestWaitingAt).toEqual(expect.any(String));
    expect(await q(sql`select status, skip_reason from ai_marketing_campaign_sends where campaign_id = ${cid} order by customer_id`)).toEqual(before);
  });
});

describe('Campaign Results 17 — comparison ratios come from the server', () => {
  it('delivery rate = delivered / submitted and cost per booking = reported cost / bookings; N/A (null) for a zero denominator or unreported cost', () => {
    const snap = { audience_source: 'segment_snapshot', snapshot_version: 1, selected: 10, eligible: 8 };
    expect(countsOf({ ...snap, submitted: 8, delivered: 6, costed: 8, cost_micros: 60_000, booked: 3 })).toMatchObject({ deliveryRatePercent: 75, actualCostCents: 6, costPerBookingCents: 2 });
    expect(countsOf({ ...snap, submitted: 3, delivered: 1, costed: 3, cost_micros: 0, booked: 0 })).toMatchObject({ deliveryRatePercent: 33.3, costPerBookingCents: null });
    expect(countsOf({ ...snap, submitted: 4, delivered: 4, costed: 2, cost_micros: 20_000, booked: 2 })).toMatchObject({ actualCostCents: null, costPerBookingCents: null });   // cost not reported for every message
    expect(countsOf({ ...snap, submitted: 0 })).toMatchObject({ deliveryRatePercent: null, costPerBookingCents: null });
  });
});

describe('AI Marketing Assistant 11 — campaign approval timeline (versioned audit)', () => {
  it('each approval records reviewer, content version + hash, audience snapshot + counts, channel and spend cap; an edit says it voided the approval; launches carry the versions', async () => {
    const a: any = await cc.audit(owner, cA);
    const approvals = a.items.filter((x: any) => x.action === 'campaign.approved');
    expect(approvals).toHaveLength(2);
    const [v2, v1] = approvals;                                          // newest first
    expect(v1.version).toMatchObject({ messageVersion: 1, snapshotVersion: 1, channel: 'sms', selected: 4, eligible: 2, budgetCents: 0, selfApproved: false });
    expect(v2.version).toMatchObject({ messageVersion: 2, snapshotVersion: 1, channel: 'sms', selected: 4, eligible: 2 });
    expect(v1.version.contentHash).toMatch(/^[0-9a-f]{12}$/);
    expect(v2.version.contentHash).not.toBe(v1.version.contentHash);   // the edited message is a different content
    expect(v1.actor).not.toBe('system'); expect(v2.actor).not.toBe(v1.actor);   // owner approved v1, the manager v2
    const edit = a.items.find((x: any) => x.action === 'campaign.updated');
    expect(edit.version).toMatchObject({ approvalVoided: true, fields: ['messageBody'] });
    const launched = a.items.filter((x: any) => x.action === 'campaign.launched');
    expect(launched.length).toBeGreaterThan(0);
    expect(launched[0].version).toMatchObject({ messageVersion: 2, snapshotVersion: 1, channel: 'sms', eligible: 2 });
    expect(JSON.stringify(a)).not.toMatch(/Hi from|Ava Kim|\+1\d{10}/);   // no message text, names or numbers in the timeline
  });
});

describe('§10 execution through the REAL executor over the approved snapshot', () => {
  it('consent revoked after scheduling → skipped; opted-out → skipped; others submitted once; delivery callbacks counted; a rerun sends nothing', async () => {
    const extra = await customer('Eve Fox'); const optOut = await customer('Gus Hill');
    // a second snapshot cannot be swapped in after approval without re-approval — so add to a NEW campaign B instead
    await q(sql`update customers set marketing_sms_opt_in = false where id = ${custs[1]}`);   // Ben revokes consent after scheduling
    const sent: any[] = [];
    const ex = executor(sent);
    const sysCtx: any = { tenantId: T, branchId: null, userId: 'system', role: 'SYSTEM' };
    const plan = (await q(sql`select message_version, body from ai_marketing_campaign_plans where campaign_id = ${cA}`))[0];
    const s1 = await ex.executeCampaign(sysCtx, { campaignId: cA, messageVersion: plan.message_version, body: plan.body });
    expect(s1).toMatchObject({ attempted: 2, sent: 1, skipped: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toBe('Hi from Pilot Nail Salon! 15% off — this week only.');
    const s2 = await ex.executeCampaign(sysCtx, { campaignId: cA, messageVersion: plan.message_version, body: plan.body }).catch((e: any) => e.message);
    expect(String(s2)).toMatch(/Only a scheduled campaign/);   // completed → never re-sent
    expect(sent).toHaveLength(1);
    // provider callbacks: delivered for Ava
    await q(sql`update notifications set status = 'delivered', delivered_at = now() where tenant_id = ${T} and to_address = (select normalized_phone from customers where id = ${custs[0]})`);
    const d: any = await cc.detail(owner, cA);
    expect(d.counts).toMatchObject({ selected: 4, eligible: 2, attempted: 1, submitted: 1, delivered: 1, unknown: 0, skippedAtSend: 1, failed: 0, actualCostCents: null, roi: null });
    expect(d.outcome).toBeNull();
    expect(d.sendTimeReasons).toEqual([{ reason: 'no_consent', count: 1 }]);
    const rec: any = await cc.recipients(owner, cA, { status: 'all' });
    expect(rec.pagination.totalItems).toBe(4);
    expect(rec.items.find((x: any) => x.customerId === custs[0])).toMatchObject({ selection: 'eligible', sendStatus: 'sent', deliveryStatus: 'delivered' });
    expect(rec.items.find((x: any) => x.customerId === custs[1])).toMatchObject({ selection: 'eligible', sendStatus: 'skipped', sendReason: 'no_consent', consentNow: false });
    expect(rec.items.find((x: any) => x.customerId === custs[2])).toMatchObject({ selection: 'excluded', exclusionReason: 'no_consent', sendStatus: null });
    expect((await cc.recipients(owner, cA, { status: 'delivered' })).pagination.totalItems).toBe(1);
    expect((await cc.events(owner, cA, {})).pagination.totalItems).toBe(2);
    void extra; void optOut;
  });
  it('a provider failure is recorded per recipient; opt-out at send time skips; zero sent is "completed — 0 sent", not reach', async () => {
    const a = await customer('Ian Jay'); const b = await customer('Kim Lo');
    await q(sql`insert into notification_opt_outs (tenant_id, channel, address, reason) values (${T}, 'sms', (select normalized_phone from customers where id = ${b}), 'STOP')`);
    const cB = (await cc.createDraft(owner, { name: 'Zero send', channel: 'sms', messageBody: 'Hello' })).id;
    await cc.setAudience(owner, cB, { draftId: await audienceDraft([[a, 'eligible'], [b, 'eligible']]) });
    await cc.approve(owner, cB); await cc.launch(owner, cB, { confirm: true });
    const phoneA = (await q(sql`select normalized_phone from customers where id = ${a}`))[0].normalized_phone;
    const sent: any[] = [];
    const s = await executor(sent, { failFor: phoneA }).executeCampaign({ tenantId: T } as any, { campaignId: cB, messageVersion: 1, body: 'Hello' });
    expect(s).toMatchObject({ sent: 0, failed: 1, skipped: 1 });
    const d: any = await cc.detail(owner, cB);
    expect(d.counts).toMatchObject({ submitted: 0, failed: 1, skippedAtSend: 1 });
    expect(d).toMatchObject({ displayStatus: 'completed', outcome: 'completed_zero_sent' });
  });
  it('ROI appears only when every sent message has a provider cost; revenue only from paid tickets that redeemed the campaign\'s code', async () => {
    const deal = (await q(sql`insert into deals (tenant_id, owner_type, title, discount_type, kind, status) values (${T}, 'salon', 'Fall 15', 'percent', 'coupon', 'active') returning id`))[0].id;
    const batch = (await q(sql`insert into deal_coupon_batches (tenant_id, deal_id, quantity, single_use, purpose, campaign_id) values (${T}, ${deal}, 5, true, 'marketing', ${cA}) returning id`))[0].id;
    const codeId = (await q(sql`insert into deal_coupon_codes (tenant_id, deal_id, batch_id, code_hash, code_hint) values (${T}, ${deal}, ${batch}, 'h1', 'AB12') returning id`))[0].id;
    const tk = (await q(sql`insert into tickets (tenant_id, branch_id, customer_id, status, total_cents, subtotal_cents, tax_cents, discount_cents, paid_at) values (${T}, ${B}, ${custs[0]}, 'paid', 8500, 10000, 0, 1500, now()) returning id`))[0].id;
    await q(sql`insert into deal_redemptions (deal_id, tenant_id, branch_id, customer_id, ticket_id, amount_discounted_cents, deal_version, status, coupon_code_id) values (${deal}, ${T}, ${B}, ${custs[0]}, ${tk}, 1500, 1, 'redeemed', ${codeId})`);
    let d: any = await cc.detail(owner, cA);
    expect(d.counts).toMatchObject({ redemptions: 1, discountCents: 1500, associatedRevenueCents: 8500, actualCostCents: null, roi: null });
    expect(d.counts.roiNote).toMatch(/not reported the cost/i);
    await q(sql`update notifications set provider_cost_micros = 79000 where tenant_id = ${T} and status in ('sent', 'delivered')`);   // $0.0079 → 1 cent
    d = await cc.detail(owner, cA);
    expect(d.counts.actualCostCents).toBe(Math.round(79000 / 10_000));
    expect(d.counts.roi).toBe(Math.round(((8500 - 8) / 8) * 10) / 10);
    expect(countsOf({ audience_source: null, audience_size: 0, submitted: 0 }).roiNote).toMatch(/nothing was sent/i);
  });
});

describe('§05–§07 search, calendar, paging, isolation', () => {
  it('campaign search by partial name / id / promotion; recipient search by name, phone digits, beyond page 1', async () => {
    expect((await cc.list(owner, { q: 'GLOW' })).items.map((x: any) => x.name).sort()).toEqual(['Fall glow', 'spring into glow']);
    expect((await cc.list(owner, { q: cA })).items.map((x: any) => x.id)).toEqual([cA]);
    // 12 more recipients on a fresh campaign so the recipient pages are real
    const many: Array<[string, string]> = []; for (let i = 0; i < 12; i++) many.push([await customer(`Pager Person${String(i).padStart(2, '0')}`), 'eligible']);
    const cP = (await cc.createDraft(owner, { name: 'Paging', channel: 'sms', messageBody: 'x' })).id;
    await cc.setAudience(owner, cP, { draftId: await audienceDraft(many) });
    const p1: any = await cc.recipients(owner, cP, { page: 1, pageSize: 10 }); const p2: any = await cc.recipients(owner, cP, { page: 2, pageSize: 10 });
    expect([p1.items.length, p2.items.length, p1.pagination.totalPages]).toEqual([10, 2, 2]);
    expect(new Set([...p1.items, ...p2.items].map((x: any) => x.customerId)).size).toBe(12);
    const hit: any = await cc.searchRecipients(owner, { q: 'Person11' });
    expect(hit.items.map((x: any) => x.customerName)).toEqual(['Pager Person11']);
    const phone = (await q(sql`select normalized_phone from customers where id = ${custs[0]}`))[0].normalized_phone;
    expect((await cc.searchRecipients(owner, { q: phone.slice(-7) })).items.every((x: any) => x.customerId === custs[0])).toBe(true);
    expect((await cc.searchRecipients(owner, { q: 'Nobody Here' })).pagination.totalItems).toBe(0);
    // a viewer without customer access sees masked rows
    const masked: any = await cc.recipients(viewer, cP, { page: 1 });
    expect(masked.items[0].name).toBeNull(); expect(masked.maskedBecause).toMatch(/hidden/);
  });
  it('newest first by default (a new matching campaign is on page 1), 10/20/50 sizes, salon-timezone inclusive date basis', async () => {
    for (let i = 0; i < 11; i++) await q(sql`insert into campaigns (tenant_id, name, channel, status, created_at) values (${T}, ${'Old ' + i}, 'email', 'draft', now() - make_interval(days => ${30 + i}))`);
    const fresh = (await cc.createDraft(owner, { name: 'Brand new', channel: 'email', messageBody: 'x', emailSubject: 'Hi' })).id;
    const p: any = await cc.list(owner, { pageSize: 10 });
    expect(p.items[0].id).toBe(fresh); expect(p.pagination.pageSize).toBe(10);
    expect((await cc.list(owner, { pageSize: 20 })).pagination.pageSize).toBe(20);
    expect((await cc.list(owner, { pageSize: 50 })).items.length).toBe(p.pagination.totalItems);
    const p2: any = await cc.list(owner, { pageSize: 10, page: 2 });
    expect(new Set([...p.items, ...p2.items].map((x: any) => x.id)).size).toBe(p.items.length + p2.items.length);
    // 23:30 New York on the 1st is the 2nd in UTC — it belongs to the 1st (inclusive local day)
    const edge = (await q(sql`insert into campaigns (tenant_id, name, channel, status, created_at) values (${T}, 'Edge', 'sms', 'draft', '2026-03-02T04:30:00Z') returning id`))[0].id;
    expect((await cc.list(owner, { preset: 'custom', from: '2026-03-01', to: '2026-03-01' })).items.map((x: any) => x.id)).toEqual([edge]);
    expect((await cc.list(owner, { preset: 'custom', from: '2026-03-02', to: '2026-03-02' })).items).toEqual([]);
    expect(await code(cc.list(owner, { preset: 'custom', from: '2026-03-05', to: '2026-03-01' }))).toBe('DATE_RANGE_INVALID');
    expect((await cc.list(owner, { basis: 'completed', preset: 'custom', from: '2026-03-01', to: '2026-03-01' })).items).toEqual([]);
  });
  it('tenant isolation: another salon cannot read, change or find these campaigns or recipients', async () => {
    expect(await code(cc.detail(other, cA))).toBe('CAMPAIGN_NOT_FOUND');
    expect(await code(cc.approve(other, cA))).toBe('CAMPAIGN_NOT_FOUND');
    expect(await code(cc.launch(other, cA, { confirm: true }))).toBe('CAMPAIGN_NOT_FOUND');
    expect((await cc.list(other, { q: 'glow' })).pagination.totalItems).toBe(0);
    expect((await cc.searchRecipients(other, { q: 'Ava' })).pagination.totalItems).toBe(0);
    expect(await code(cc.setAudience(other, cA, { draftId: draftA }))).toBe('CAMPAIGN_NOT_FOUND');
  });
  it('branch scope: a branch user sees salon-wide campaigns and their own branch, not the other branch', async () => {
    const own = (await cc.createDraft({ ...owner, branchId: B }, { name: 'Branch one', channel: 'sms', messageBody: 'x' })).id;
    const two = (await cc.createDraft({ ...owner, branchId: B2 }, { name: 'Branch two', channel: 'sms', messageBody: 'x' })).id;
    const seen = (await cc.list({ ...owner, branchId: B }, { q: 'Branch', pageSize: 50 })).items.map((x: any) => x.id);
    expect(seen).toContain(own); expect(seen).not.toContain(two);
    expect(await code(cc.detail({ ...owner, branchId: B }, two))).toBe('CAMPAIGN_NOT_FOUND');
  });
});

describe('§14 assistant — suggestions and drafts only', () => {
  it('win-back counts lapsed customers with a visit, never the never-visited; saving makes a draft that sends nothing', async () => {
    const lapsed = await customer('Lap Sed'); await paidVisit(lapsed, 120);
    await customer('Never Came');   // zero visits
    const s: any = await cc.assistantSuggest(owner, 'inactive');
    expect(s).toMatchObject({ isSuggestion: true, sends: false, channel: 'sms' });
    expect(s.audience).toMatch(/NOT included/);
    expect(s.liveEligibleEstimate).toBe(1);
    const d = await cc.assistantSaveDraft(owner, { goal: 'inactive' });
    const row = (await q(sql`select status, origin, approved_at, audience_source from campaigns where id = ${d.id}`))[0];
    expect(row).toMatchObject({ status: 'draft', origin: 'assistant', approved_at: null, audience_source: null });
    expect(Number((await q(sql`select count(*)::int as n from ai_marketing_campaign_sends where campaign_id = ${d.id}`))[0].n)).toBe(0);
    expect(await code(cc.assistantSuggest(owner, 'spam_everyone'))).toBe('ASSISTANT_GOAL_INVALID');
    expect((await cc.assistantSuggest(owner, 'slow_weekdays')).risks.join(' ')).toMatch(/capacity/i);
  });
});
