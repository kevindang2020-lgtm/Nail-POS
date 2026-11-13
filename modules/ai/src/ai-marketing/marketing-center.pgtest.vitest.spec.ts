// marketing-center.pgtest — AI Marketing Assistant family guides (Nov 3 2026; migration 780) on the REAL schema.
// SU = the seven cards in a period, Reach & Consent, budget vs money spent (the photographed "$100 with 0 sent") ·
// RC = recommendations from the Retention rule (a customer who visited recently is NOT lapsed; never-visited never included) ·
// EL = eligibility funnel · ES = segments / price / budget · SD = save as an unsent, unapproved Campaign Center draft ·
// AP = the old AI approve route cannot schedule an unapproved campaign · HL = Check AI Marketing System.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { clearBranchTimeZoneCache } from '@aipowersalon/database';
import { CampaignCenter, CampaignsService, KyselyCampaignsRepository } from '@aipowersalon/communications';
import { WinBackCenter } from '@aipowersalon/customers';
import { MarketingCenter, MarketingCenterError, toCampaignText, validTimeZone, nearClockChange } from './marketing-center';
import { AiMarketingCampaignService } from './ai-marketing-campaign.service';

const id = (n: number) => `77800000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), B = id(2), BX = id(3), X = id(4), OWNER = id(10);
const C = { lapsed: id(31), recent: id(32), never: id(33), due: id(34), stop: id(35), nophone: id(36), birthday: id(37), other: id(38), lapsed2: id(39) };
const VIEW = ['pos.marketing.view', 'pos.customers.view'];
const ctx = (o: any = {}) => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: [...VIEW, 'pos.marketing.manage'], ...o });
let pg: any; let db: any; let mc: MarketingCenter;
const q = async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as any[];
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e: any) { return e instanceof MarketingCenterError ? e.code : (e?.code ?? (e as Error).message); } }
let n = 0;
const ticket = (cid: string, daysAgo: number, cents = 5000) => q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, ticket_number, created_at, paid_at)
  values (gen_random_uuid(),$1,$2,$3,'paid',$4,$5, now() - make_interval(days => $6), now() - make_interval(days => $6))`, [T, B, cid, cents, String(78000 + ++n), daysAgo]);

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.query(`set timezone = 'UTC'`);
  db = kyselyFor(pg);
  mc = new MarketingCenter(db, new WinBackCenter(db), new CampaignCenter(db), { AI_MARKETING_SEND_SWEEP_ENABLED: '' } as any);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'S','Pilot','mk-780','MK780','active'), ($2,'X','Other','mk-780x','MK780X','active')`, [T, X]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','UTC'), ($3,$4,'Other','active','UTC')`, [B, T, BX, X]);
  await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$2,'Owner Kim','o@mk.test','active','OWNER')`, [OWNER, T]);
  const cust = (cid: string, name: string, phone: string | null, sms: boolean, email: string | null = null, em = false, birthday: string | null = null, tenant = T) =>
    q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, marketing_sms_opt_in, marketing_email_opt_in, birthday, created_at)
      values ($1,$2,$3,$4,'X',$4,$5,$6,$7,$8,$9::date, now() - interval '400 days')`, [cid, tenant, tenant === T ? B : BX, name, phone, email, sms, em, birthday]);
  await cust(C.lapsed, 'Lana', '+12155550401', true, 'lana@x.test', true);
  await cust(C.recent, 'Remy', '+12155550402', true);
  await cust(C.never, 'Neve', '+12155550403', true);
  await cust(C.due, 'Dua', '+12155550404', true);
  await cust(C.stop, 'Stu', '+12155550405', true);
  await cust(C.nophone, 'Nia', null, true);
  await cust(C.lapsed2, 'Lou', '+12155550409', false, 'lou@x.test', true);
  const bmonth = new Date().toISOString().slice(5, 7);
  await cust(C.birthday, 'Bea', '+12155550406', true, null, false, `1990-${bmonth}-15`);
  // the old rule's bug: Remy's FIRST visit is 200 days old, but he came back 3 days ago — he is not lapsed
  await ticket(C.lapsed, 120); await ticket(C.recent, 200); await ticket(C.recent, 3); await ticket(C.due, 50); await ticket(C.stop, 100); await ticket(C.nophone, 90); await ticket(C.lapsed2, 150);
  await q(`insert into notification_opt_outs (tenant_id, channel, address) values ($1,'sms','+12155550405')`, [T]);
  // a campaign created with a $100 budget that never sent anything (the photographed state) and one that sent two messages
  const [c1] = await q(`insert into campaigns (tenant_id, branch_id, name, channel, status, audience_size, cost_cents) values ($1,$2,'Spring','sms','completed',50,10000) returning id`, [T, B]);
  const [c2] = await q(`insert into campaigns (tenant_id, branch_id, name, channel, status, audience_size, cost_cents) values ($1,$2,'Fall','sms','completed',2,0) returning id`, [T, B]);
  await q(`insert into campaigns (tenant_id, branch_id, name, channel, status, audience_size) values ($1,$2,'Draft','sms','draft',0)`, [T, B]);
  for (const [cid, pid, st, cost] of [[C.lapsed, 'SMa', 'delivered', 7900], [C.due, 'SMb', 'failed', 7900]] as const) {
    await q(`insert into notifications (tenant_id, channel, to_address, body, customer_id, status, provider_id, provider_cost_micros) values ($1,'sms','+1','hi',$2,$3,$4,$5)`, [T, cid, st, pid, cost]);
    await q(`insert into ai_marketing_campaign_sends (tenant_id, branch_id, campaign_id, customer_id, channel, status, provider_id, created_at, updated_at) values ($1,$2,$3,$4,'sms','sent',$5, now(), now())`, [T, B, c2.id, cid, pid]);
  }
  await q(`insert into ai_booking_conversion_events (tenant_id, branch_id, source, stage, outcome, campaign_id, appointment_id, created_at) values ($1,$2,'link','BOOKING_SUCCEEDED','succeeded',$3,'a1', now()), ($1,$2,'link','BOOKING_SUCCEEDED','succeeded',$3,'a1', now())`, [T, B, c2.id]);
  void c1;
  // another salon's customer and campaign never show
  await cust(C.other, 'Oz', '+12155550408', true, null, false, null, X);
}, 180_000);

describe('AI Marketing — cards, reach, cost', () => {
  it('SU-01 cards in the period; one booking counted once; failed delivery is not delivered', async () => {
    const s: any = await mc.summary(ctx(), { preset: 'today' });
    expect(s.cards).toMatchObject({ draftCampaigns: 1, messagesSent: 2, delivered: 1, failed: 1, bookings: 1 });
    expect(s.cards.actualCostCents).toBe(2);            // 2 × 7,900 micros = 1.58¢ → 2¢, from the provider
    expect(s.cards.costPerBookingCents).toBe(2);
  });
  it('SU-02 the "$100 with 0 sent": a $100 budget is shown as a budget, the money spent is the provider cost', async () => {
    const s: any = await mc.summary(ctx(), { preset: 'all' });
    expect(s.cost).toMatchObject({ budgetsCents: 10000, campaignsWithBudget: 1, sentAllTime: 2, spentAllTimeCents: 2, explanation: 'budget_and_spend' });
  });
  it('SU-03 reach: opted in vs reachable (no phone, STOP list), overlap and union; other salon never counted', async () => {
    const s: any = await mc.summary(ctx());
    expect(s.reach.sms).toEqual({ optedIn: 7, reachable: 5, noContact: 1, optedOut: 1 });
    expect(s.reach.email).toMatchObject({ optedIn: 2, reachable: 2 });
    expect(s.reach.reachableBoth).toBe(1);               // Lana
    expect(s.reach.reachableEither).toBe(6);             // 5 by text + Lou by email
    expect(s.reach.suppressed.sms).toBe(1);
  });
  it('SU-04 a custom range needs From ≤ To; viewing needs pos.marketing.view', async () => {
    expect(await code(mc.summary(ctx(), { preset: 'custom', from: '2026-11-05', to: '2026-11-01' }))).toBe('MKC_INVALID_PERIOD');
    expect(await code(mc.summary(ctx({ permissions: [] })))).toBe('PERMISSION_DENIED');
  });
});

describe('AI Marketing — recommendations and eligibility', () => {
  it('RC-01 win-back = the Retention At Risk rule: Remy (back 3 days ago) and never-visited Neve are not in it; STOP and no phone are excluded with reasons', async () => {
    const r: any = await mc.recommendations(ctx());
    const wb = r.items.find((x: any) => x.kind === 'winback');
    expect(wb.matched).toBe(4);                         // Lana 120, Stu 100, Nia 90, Lou 150 (Remy 3, Dua 50 are not at risk)
    expect(wb.eligible).toBe(1);                        // Lana; Lou has no SMS consent
    expect(wb.excluded).toMatchObject({ opted_out: 1 });
    expect(wb.status).toBe('ready');
    expect(wb.neverVisited).toBeGreaterThanOrEqual(1);
    const rb = r.items.find((x: any) => x.kind === 'rebooking');
    expect(rb.matched).toBe(1); expect(rb.eligible).toBe(1); // Dua, 50 days (Approaching 45–59)
    const bd = r.items.find((x: any) => x.kind === 'birthday');
    expect(bd).toMatchObject({ matched: 1, eligible: 1, openTo: '/tenant/marketing/birthdays', canSaveDraft: false });
    expect(r.sendsAnything).toBe(false);
  });
  it('EL-01 both channels: per channel and unique people', async () => {
    const e: any = await mc.eligibility(ctx(), { kind: 'winback', channel: 'both' });
    expect(e.channels.map((x: any) => [x.channel, x.eligible])).toEqual([['sms', 1], ['email', 2]]);
    expect(e.uniqueEligible).toBe(2);                    // Lana (both) + Lou (email)
    expect(await code(mc.eligibility(ctx(), { kind: 'everyone' }))).toBe('MKC_KIND_INVALID');
  });
  it('ES-01 segments, platform price and the budget check; email is unpriced', async () => {
    const seeded: any = await mc.estimate(ctx(), { channel: 'sms', body: 'Hi from {salon_name}', recipients: 10 });
    expect(seeded).toMatchObject({ segmentsPerMessage: 1, estimatedSegments: 10, unitPriceCents: 3.5, estimatedCostCents: 35, costNote: 'estimate', withinBudget: null });
    expect(seeded.asSent).toBe('Pilot: Hi from Pilot Reply STOP to opt out');
    await q(`update platform_settings set value = '2'::jsonb where setting_key = 'sms.marketing_segment_price_cents'`);
    const e: any = await mc.estimate(ctx(), { channel: 'sms', body: 'x'.repeat(170), recipients: 10, budgetCents: 30 });
    expect(e).toMatchObject({ segmentsPerMessage: 2, estimatedCostCents: 40, withinBudget: false });
    expect((await mc.estimate(ctx(), { channel: 'email', body: 'Hello', recipients: 5 }) as any).costNote).toBe('email_unpriced');
  });
});

describe('AI Marketing — drafts and approval', () => {
  it('SD-01 save-draft makes an unsent Segments audience and an unapproved Campaign Center draft; a retry returns the same one', async () => {
    const r: any = await mc.saveDraft(ctx(), { kind: 'winback', channel: 'sms', message: 'We miss you at {salon_name}!', budgetCents: 500, idempotencyKey: 'key-win-0001' });
    expect(r).toMatchObject({ duplicate: false, eligible: 1, sent: 0 });
    const [c] = await q(`select status, origin, approved_at, audience_source, cost_cents, message_body from campaigns where id = $1`, [r.campaignId]);
    expect(c).toMatchObject({ status: 'draft', origin: 'assistant', approved_at: null, audience_source: 'segment_snapshot', cost_cents: 500 });
    const again: any = await mc.saveDraft(ctx(), { kind: 'winback', channel: 'sms', message: 'We miss you at {salon_name}!', idempotencyKey: 'key-win-0001' });
    expect(again).toMatchObject({ duplicate: true, campaignId: r.campaignId });
    expect((await q(`select count(*)::int as n from ai_marketing_campaign_sends where campaign_id = $1`, [r.campaignId]))[0].n).toBe(0);
    expect(await code(mc.saveDraft(ctx({ permissions: VIEW }), { kind: 'winback', message: 'x', idempotencyKey: 'key-win-0002' }))).toBe('PERMISSION_DENIED');
    expect(await code(mc.saveDraft(ctx(), { kind: 'birthday', message: 'x', idempotencyKey: 'key-win-0003' }))).toBe('MKC_KIND_INVALID');
    // a Message Studio draft with a per-customer token would go out as literal text — refused, nothing saved
    expect(await code(mc.saveDraft(ctx(), { kind: 'winback', message: 'Hi {{customer_first_name}}!', idempotencyKey: 'key-win-0004' }))).toBe('MKC_TOKENS_UNSUPPORTED');
  });
  it('SD-03 Campaign Builder Steps 4 + 5 (SUNMI, Nov 8 2026): approved offers only; a checked proposed send time; both carried on the draft', async () => {
    const D = id(901), DX = id(902), DOLD = id(903), DOTHER = id(904);
    const deal = (did: string, tenant: string, status: string, endsSql: string, title: string) => q(`insert into deals (id, tenant_id, owner_type, title, discount_type, discount_percent, status, ends_at, kind)
      values ($1,$2,'salon',$3,'percent',15,$4, ${endsSql}, 'coupon')`, [did, tenant, title, status]);
    await deal(D, T, 'active', "now() + interval '60 days'", 'Winter 15%');
    await deal(DX, T, 'draft', "now() + interval '60 days'", 'Not approved');
    await deal(DOLD, T, 'active', "now() + interval '2 days'", 'Ends soon');
    await deal(DOTHER, X, 'active', "now() + interval '60 days'", 'Other salon');
    const offers = await mc.offers(ctx());
    expect(offers.items.map((o) => o.title).sort()).toEqual(['Ends soon', 'Winter 15%']);   // never a draft, never another salon
    expect(offers.items.find((o) => o.id === D)).toMatchObject({ kind: 'coupon', discount: { type: 'percent', percent: 15 } });
    // the proposal, checked in the branch's zone (UTC here): quiet hours 21→8 refuse 22:00; a time 10 days out at 11:00 is fine
    await q(`insert into campaign_limits (quiet_hours_start, quiet_hours_end, active) values (21, 8, true)`);
    const day = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const quiet = await mc.scheduleCheck(ctx(), { date: day, time: '22:00' });
    expect(quiet.ok).toBe(false); expect(quiet.checks.find((c) => c.key === 'quiet_hours')?.state).toBe('block');
    const fine = await mc.scheduleCheck(ctx(), { date: day, time: '11:00', dealId: D });
    expect(fine).toMatchObject({ ok: true, sendAt: `${day}T11:00:00.000Z` });
    expect((await mc.scheduleCheck(ctx(), { date: day, time: '11:00', dealId: DOLD })).checks.find((c) => c.key === 'offer_valid')?.state).toBe('block');   // ends before the send
    expect(await code(mc.scheduleCheck(ctx(), { date: day, time: '11:00', dealId: DOTHER }))).toBe('PROMOTION_NOT_FOUND');
    // DST in the branch's zone: 02:30 on a spring-forward day does not exist; 01:30 on a fall-back day happens twice
    await q(`update branches set timezone = 'America/New_York' where id = $1`, [B]); clearBranchTimeZoneCache();
    const fixed = new MarketingCenter(db, new WinBackCenter(db), new CampaignCenter(db), { AI_MARKETING_SEND_SWEEP_ENABLED: '' } as any, () => Date.parse('2027-01-02T15:00:00Z'));
    const gap = await fixed.scheduleCheck(ctx(), { date: '2027-03-14', time: '02:30' });
    expect(gap.ok).toBe(false); expect(gap.sendAt).toBeNull(); expect(gap.checks.find((c) => c.key === 'local_time')?.state).toBe('block');
    const twice = await fixed.scheduleCheck(ctx(), { date: '2027-11-07', time: '01:30' });
    expect(twice.checks.find((c) => c.key === 'ambiguous_time')?.state).toBe('warn');
    expect((await fixed.scheduleCheck(ctx(), { date: '2027-03-15', time: '10:00' })).sendAt).toBe('2027-03-15T14:00:00.000Z');   // EDT
    await q(`update branches set timezone = 'UTC' where id = $1`, [B]); clearBranchTimeZoneCache();
    // save: a blocked proposal or an unapproved offer saves NOTHING; a good one is carried on the Campaign Center draft
    const before = (await q(`select count(*)::int as n from campaigns where tenant_id = $1`, [T]))[0].n;
    expect(await code(mc.saveDraft(ctx(), { kind: 'winback', channel: 'sms', message: 'Back soon {offer}', idempotencyKey: 'key-off-0001', dealId: D, sendDate: day, sendTime: '22:00' }))).toBe('MKC_SCHEDULE_INVALID');
    expect(await code(mc.saveDraft(ctx(), { kind: 'winback', channel: 'sms', message: 'Back soon {offer}', idempotencyKey: 'key-off-0002', dealId: DX }))).toBe('MKC_OFFER_INVALID');
    expect((await q(`select count(*)::int as n from campaigns where tenant_id = $1`, [T]))[0].n).toBe(before);
    const ok: any = await mc.saveDraft(ctx(), { kind: 'winback', channel: 'sms', message: 'Back soon {offer}', idempotencyKey: 'key-off-0003', dealId: D, sendDate: day, sendTime: '11:00' });
    const [c] = await q(`select status, deal_id, proposed_send_at, scheduled_at, approved_at from campaigns where id = $1`, [ok.campaignId]);
    expect({ status: c.status, deal: c.deal_id, proposed: new Date(c.proposed_send_at).toISOString(), scheduled: c.scheduled_at, approved: c.approved_at })
      .toEqual({ status: 'draft', deal: D, proposed: `${day}T11:00:00.000Z`, scheduled: null, approved: null });   // a proposal, never a schedule
    const detail: any = await new CampaignCenter(db).detail({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: [...VIEW, 'pos.marketing.manage'] } as any, ok.campaignId);
    expect(detail).toMatchObject({ proposedSendAt: `${day}T11:00:00.000Z`, proposedSendLocal: `${day}T11:00`, dealId: D });
  });
  it('SD-02 Message Studio tokens: the two Campaign Center can fill are mapped, the rest are listed', () => {
    expect(toCampaignText('{{salon_name}}: {{promotion_name}} for {{customer_first_name}} {{booking_link}} {branch}')).toEqual({
      text: '{salon_name}: {offer} for {{customer_first_name}} {{booking_link}} {branch}', unsupported: ['{{customer_first_name}}', '{{booking_link}}', '{branch}'] });
  });
  it('AP-01 the old AI approve route can no longer schedule an unapproved campaign', async () => {
    const svc = new AiMarketingCampaignService(new CampaignsService(new KyselyCampaignsRepository(db)) as any);
    const [d] = await q(`insert into campaigns (tenant_id, branch_id, name, channel, status, audience_size) values ($1,$2,'Old AI','sms','draft',3) returning id`, [T, B]);
    const r = await code(svc.approveAndSchedule(ctx() as any, d.id, new Date(Date.now() + 3600_000).toISOString()));
    expect(r).toBe('CAMPAIGN_AUDIENCE_NOT_SELECTED');
    expect((await q(`select status from campaigns where id = $1`, [d.id]))[0].status).toBe('draft');
  });
});

describe('AI Marketing — Check AI Marketing System', () => {
  it('HL-01 read-only, recorded, failures first; the disabled send worker and the unspent budget are warnings; repeated taps reuse the run', async () => {
    const before = (await q(`select count(*)::int as n from campaigns where tenant_id = $1`, [T]))[0].n;
    const h: any = await mc.check(ctx());
    expect(h.sendsAnything).toBe(false);
    const by = Object.fromEntries(h.checks.map((x: any) => [x.key, x]));
    expect(by.send_worker.state).toBe('WARNING');
    expect(by.budget_not_spending).toMatchObject({ state: 'WARNING', count: 2 });   // Spring's $100 and the saved draft's $5: budgets, nothing spent
    expect(by.consent_contacts).toMatchObject({ state: 'WARNING', count: 1 });
    expect(by.tenant_isolation.state).toBe('PASSED');
    expect(by.approved_before_sending.state).toBe('PASSED');
    const order = ['FAILED', 'UNAVAILABLE', 'WARNING', 'INSUFFICIENT_DATA', 'PASSED'];
    expect(h.checks.map((x: any) => order.indexOf(x.state))).toEqual([...h.checks.map((x: any) => order.indexOf(x.state))].sort((a, b) => a - b));
    const again: any = await mc.check(ctx());
    expect(again).toMatchObject({ reused: true, id: h.id });
    expect((await q(`select count(*)::int as n from campaigns where tenant_id = $1`, [T]))[0].n).toBe(before);
  });
});

describe('Marketing Growth 12 — Alerting for Marketing Anomalies in Check AI Marketing System', () => {
  it('a cost spike, a send-failure spike, duplicate claims and a points balance off its ledger are each flagged with evidence; nothing is changed', async () => {
    const TA = id(751), BA = id(752), CA = id(753), CB = id(754), CC = id(755), DEAL = id(756), CODE = id(757), TK1 = id(758), TK2 = id(759), TK3 = id(760), TK4 = id(761);
    const cA = (o: any = {}) => ({ tenantId: TA, branchId: BA, userId: OWNER, role: 'OWNER', permissions: [...VIEW, 'pos.marketing.manage'], ...o });
    await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'A','Anomaly','mk-781a','MK781A','active')`, [TA]);
    await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','UTC')`, [BA, TA]);
    for (const cid of [CA, CB, CC]) await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, created_at) values ($1,$2,$3,'A','X','A X', now() - interval '100 days')`, [cid, TA, BA]);
    const quiet: any = await mc.check(cA());
    const q0 = Object.fromEntries(quiet.checks.map((x: any) => [x.key, x]));
    expect(q0.anomaly_cost_spike.state).toBe('INSUFFICIENT_DATA');                 // nothing sent: no baseline, no alarm
    expect(q0.anomaly_send_failures.state).toBe('INSUFFICIENT_DATA');
    expect(q0.anomaly_duplicate_claims).toMatchObject({ state: 'PASSED', count: 0 });
    expect(q0.anomaly_balance_drift).toMatchObject({ state: 'PASSED', count: 0 });
    await q(`delete from ai_marketing_health_runs where tenant_id = $1`, [TA]);
    const [camp] = await q(`insert into campaigns (tenant_id, branch_id, name, channel, status, audience_size) values ($1,$2,'Blast','sms','completed',12) returning id`, [TA, BA]);
    // 14 days before: two 1-cent messages · last 24 h: twelve 20-cent messages, four of them failed on the delivery report
    let k = 0;
    const send = async (ago: string, costMicros: number, st: string) => {
      const pid = `AN${++k}`; const cust = [CA, CB, CC][k % 3];
      await q(`insert into notifications (tenant_id, channel, to_address, body, customer_id, status, provider_id, provider_cost_micros) values ($1,'sms','+1','hi',$2,$3,$4,$5)`, [TA, cust, st, pid, costMicros]);
      await q(`insert into ai_marketing_campaign_sends (tenant_id, branch_id, campaign_id, customer_id, channel, status, provider_id, message_version, created_at, updated_at) values ($1,$2,$3,$4,'sms','sent',$5,$6, now() - $7::interval, now() - $7::interval)`, [TA, BA, camp.id, cust, pid, k, ago]);
    };
    await send('5 days', 10000, 'delivered'); await send('9 days', 10000, 'delivered');
    for (let i = 0; i < 12; i++) await send('2 hours', 200000, i < 4 ? 'failed' : 'delivered');
    // claims: a single-use code redeemed on two tickets; a deal limited to one per customer redeemed twice by CC (two tickets)
    await q(`set session_replication_role = replica`);
    await q(`insert into deals (id, tenant_id, owner_type, title, discount_type, discount_percent, max_per_customer) values ($1,$2,'salon','One per customer','percent',10,1)`, [DEAL, TA]);
    await q(`insert into deal_coupon_codes (id, tenant_id, deal_id, code_hash, code_hint, single_use) values ($1,$2,$3,'h','ABCD',true)`, [CODE, TA, DEAL]);
    await q(`insert into deal_redemptions (tenant_id, deal_id, customer_id, ticket_id, coupon_code_id, deal_version, amount_discounted_cents, status) values
      ($1,$2,$3,$4,$5,1,500,'redeemed'), ($1,$2,$6,$7,$5,1,500,'redeemed'), ($1,$2,$8,$9,null,1,500,'redeemed'), ($1,$2,$8,$10,null,1,500,'redeemed')`, [TA, DEAL, CA, TK1, CODE, CB, TK2, CC, TK3, TK4]);
    await q(`set session_replication_role = origin`);
    // loyalty: CA's balance says 100, its ledger adds to 80
    await q(`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, points_balance) values ($1,$2,$3,100), ($1,$2,$4,30)`, [TA, BA, CA, CB]);
    await q(`insert into loyalty_ledger (tenant_id, branch_id, customer_id, type, amount, source, running_balance, entry_type, delta, balance_after) values
      ($1,$2,$3,'earn',80,'ticket',80,'earn',80,80), ($1,$2,$4,'earn',30,'ticket',30,'earn',30,30)`, [TA, BA, CA, CB]);
    const before = { sends: await q(`select id, status from ai_marketing_campaign_sends where tenant_id = $1 order by id`, [TA]), pts: await q(`select customer_id, points_balance from customer_loyalty_profiles where tenant_id = $1 order by customer_id`, [TA]) };
    const h: any = await mc.check(cA());
    const by = Object.fromEntries(h.checks.map((x: any) => [x.key, x]));
    expect(by.anomaly_cost_spike).toMatchObject({ state: 'WARNING', component: 'anomalies', count: 1, detail: { last24hCents: 240, priorDailyAverageCents: 0 } });
    expect(by.anomaly_send_failures).toMatchObject({ state: 'WARNING', count: 4, detail: { attempts24h: 12, failed24h: 4 } });
    expect(by.anomaly_duplicate_claims).toMatchObject({ state: 'WARNING', count: 2, detail: { codesOverLimit: 1, customersOverDealLimit: 1 } });
    expect(by.anomaly_balance_drift).toMatchObject({ state: 'WARNING', count: 1, detail: { profiles: 1, pointsOff: 20 } });
    expect(h.sendsAnything).toBe(false);
    expect(await q(`select id, status from ai_marketing_campaign_sends where tenant_id = $1 order by id`, [TA])).toEqual(before.sends);
    expect(await q(`select customer_id, points_balance from customer_loyalty_profiles where tenant_id = $1 order by customer_id`, [TA])).toEqual(before.pts);   // reported, never corrected here
    // the original salon's own data has no such anomalies (another salon's spike never leaks in)
    await q(`delete from ai_marketing_health_runs where tenant_id = $1`, [T]);
    const own: any = await mc.check(ctx());
    expect(own.checks.find((x: any) => x.key === 'anomaly_duplicate_claims')).toMatchObject({ state: 'PASSED', count: 0 });
    expect(own.checks.find((x: any) => x.key === 'anomaly_cost_spike').state).not.toBe('WARNING');
  });
});

describe('Marketing Growth 07 — Date/Timezone Diagnostics in Check AI Marketing System', () => {
  it('an unknown branch zone FAILS; a send scheduled on a clock-change day WARNS; zones are listed; nothing is changed', async () => {
    const B2 = id(5), B3 = id(6);
    await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$3,'Uptown','active','America/New_York'), ($2,$3,'Typo','active','America/Nowhere')`, [B2, B3, T]);
    // 2027-03-14 is the US spring-forward day: 15:00 UTC that day is the morning after the clocks jumped
    await q(`insert into campaigns (tenant_id, branch_id, name, channel, status, audience_size, scheduled_at) values ($1,$2,'Spring forward','sms','scheduled',0,'2027-03-14T15:00:00Z'), ($1,$2,'Ordinary day','sms','scheduled',0,'2027-04-20T15:00:00Z')`, [T, B2]);
    clearBranchTimeZoneCache();
    const before = await q(`select id, status, scheduled_at from campaigns where tenant_id = $1 order by id`, [T]);
    const h: any = await mc.check(ctx({ branchId: null }));
    const tz = h.checks.find((x: any) => x.key === 'date_timezone');
    expect(tz).toMatchObject({ state: 'FAILED', component: 'campaigns', count: 2, detail: { invalidZones: 1, scheduledOnClockChange: 1, scheduledChecked: 2 } });
    expect(tz.detail.zones).toEqual(['America/New_York', 'UTC']);
    expect(await q(`select id, status, scheduled_at from campaigns where tenant_id = $1 order by id`, [T])).toEqual(before);
    // one branch with a good zone: only the clock-change send remains → WARNING
    const h2: any = await mc.check(ctx({ branchId: B2 }));
    expect(h2.checks.find((x: any) => x.key === 'date_timezone')).toMatchObject({ state: 'WARNING', count: 1, detail: { invalidZones: 0, zones: ['America/New_York'] } });
  });
  it('the rules alone: a real zone is valid, a made-up one is not; a clock change within a day either side is "near"', () => {
    expect(validTimeZone('America/New_York')).toBe(true); expect(validTimeZone('UTC')).toBe(true);
    expect(validTimeZone('America/Nowhere')).toBe(false); expect(validTimeZone('')).toBe(false); expect(validTimeZone(null)).toBe(false);
    expect(nearClockChange(Date.parse('2027-03-14T15:00:00Z'), 'America/New_York')).toBe(true);
    expect(nearClockChange(Date.parse('2027-03-13T12:00:00Z'), 'America/New_York')).toBe(true);    // the day before
    expect(nearClockChange(Date.parse('2027-04-20T15:00:00Z'), 'America/New_York')).toBe(false);
    expect(nearClockChange(Date.parse('2027-03-14T15:00:00Z'), 'UTC')).toBe(false);
  });
});

describe('Marketing Growth 09 — Reward Liability Reconciliation on the summary', () => {
  it('points, token wallet, referral expense and gift-card balances come back separately from their own ledgers; nothing is changed', async () => {
    const TL = id(820), BL = id(821), CA = id(822), CB = id(823), REF = id(824);
    const cL = (o: any = {}) => ({ tenantId: TL, branchId: BL, userId: OWNER, role: 'OWNER', permissions: [...VIEW, 'pos.reports.view'], ...o });
    await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'L','Liability','mk-809l','MK809L','active')`, [TL]);
    await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','UTC')`, [BL, TL]);
    for (const cid of [CA, CB]) await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, created_at) values ($1,$2,$3,'L','X','L X', now() - interval '100 days')`, [cid, TL, BL]);
    // an empty salon: zeros, no wallet, nothing invented
    const empty: any = (await mc.summary(cL(), { preset: 'all' })).rewardLiability;
    expect(empty).toMatchObject({ visible: true, scope: 'salon', points: { outstandingPoints: 0, ledgerPoints: 0, driftPoints: 0, valueCents: null }, tokens: { wallet: false }, giftCards: { outstandingCents: 0, cards: 0 } });
    // points: CA 120 (ledger 150 earned − 30 used), CB 40 with a 10-point drift (ledger 30)
    await q(`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, points_balance) values ($1,$2,$3,120), ($1,$2,$4,40)`, [TL, BL, CA, CB]);
    await q(`insert into loyalty_ledger (tenant_id, branch_id, customer_id, type, amount, source, running_balance, entry_type, delta, balance_after) values
      ($1,$2,$3,'earn',150,'ticket',150,'earn',150,150), ($1,$2,$3,'redeem',-30,'ticket',120,'redeem',-30,120), ($1,$2,$4,'earn',30,'ticket',30,'earn',30,30)`, [TL, BL, CA, CB]);
    await q(`set session_replication_role = replica`);
    // tokens: funded $50, $7.50 allocated to earned global points; the wallet projection says $42.50 left
    await q(`insert into tenant_token_wallets (tenant_id, available_cents, lifetime_funded_cents, lifetime_allocated_cents) values ($1,4250,5000,750)`, [TL]);
    await q(`insert into token_wallet_ledger (tenant_id, entry_type, delta_cents, balance_after_cents, source_table, source_id) values
      ($1,'purchase_funded',5000,5000,'token_purchase_intents','p1'), ($1,'earn_allocation',-750,4250,'reward_earn_transactions','e1')`, [TL]);
    // referrals: one $20 cash payout issued, one points reward (500) issued, one cash reward still pending approval (not expense);
    // vouchers: a $10 redeemed (expense), a $15 open (owed), a $5 pending (not yet owed), a $25 void (nothing)
    await q(`insert into referral_rewards (tenant_id, referral_id, recipient_customer_id, reward_type, points, amount_cents, policy_version, state, issued_at, ledger_entry_id) values
      ($1,$2,$3,'cash_payout',null,2000,1,'ISSUED',now(),null), ($1,$5,$3,'loyalty_points',500,null,1,'ISSUED',now(),gen_random_uuid()), ($1,$6,$4,'cash_payout',null,9900,1,'PENDING_APPROVAL',null,null)`, [TL, REF, CA, CB, id(826), id(827)]);
    await q(`insert into referral_vouchers (tenant_id, referral_id, customer_id, role, face_cents, state, policy_version, coupon_code_id, redeemed_at, created_at, updated_at) values
      ($1,$2,$3,'friend',1000,'REDEEMED',1,gen_random_uuid(),now(),now(),now()), ($1,$2,$4,'referrer',1500,'AVAILABLE',1,gen_random_uuid(),null,now(),now()),
      ($1,$5,$3,'referrer',500,'PENDING',1,null,null,now(),now()), ($1,$5,$4,'friend',2500,'VOID',1,null,null,now(),now())`, [TL, REF, CA, CB, id(825)]);
    // gift cards: the canonical liability rule — active / frozen / partially redeemed with a balance; redeemed, void and expired are not owed
    await q(`insert into gift_cards (tenant_id, branch_id, code, initial_balance_cents, balance_cents, status) values
      ($1,$2,'G1',5000,5000,'active'), ($1,$2,'G2',5000,1200,'partially_redeemed'), ($1,$2,'G3',3000,3000,'frozen'), ($1,$2,'G4',5000,0,'redeemed'), ($1,$2,'G5',4000,4000,'void'), ($1,$2,'G6',2000,2000,'expired')`, [TL, BL]);
    await q(`set session_replication_role = origin`);
    const snap = async () => ({ p: await q(`select customer_id, points_balance from customer_loyalty_profiles where tenant_id = $1 order by customer_id`, [TL]),
      w: await q(`select available_cents from tenant_token_wallets where tenant_id = $1`, [TL]), g: await q(`select code, balance_cents, status from gift_cards where tenant_id = $1 order by code`, [TL]),
      v: await q(`select face_cents, state from referral_vouchers where tenant_id = $1 order by face_cents`, [TL]) });
    const before = await snap();
    const r: any = (await mc.summary(cL(), { preset: 'today' })).rewardLiability;
    expect(r.points).toEqual({ members: 2, outstandingPoints: 160, ledgerPoints: 150, driftPoints: 10, earnedInPeriod: 180, usedInPeriod: 30, valueCents: null });
    expect(r.tokens).toEqual({ wallet: true, availableCents: 4250, deficitCents: 0, fundedAllTimeCents: 5000, allocatedAllTimeCents: 750, fundedInPeriodCents: 5000, allocatedInPeriodCents: 750 });
    expect(r.referrals).toEqual({ cashPaidInPeriodCents: 2000, cashPaidInPeriod: 1, pointsIssuedInPeriod: 500, vouchersRedeemedInPeriodCents: 1000, vouchersRedeemedInPeriod: 1,
      vouchersOpenCents: 1500, vouchersOpen: 1, vouchersPendingCents: 500, vouchersPending: 1 });
    expect(r.giftCards).toEqual({ outstandingCents: 9200, cards: 3 });
    // a past period: the period amounts drop to zero, the balances owed now do not
    const past: any = (await mc.summary(cL(), { preset: 'custom', from: '2020-01-01', to: '2020-01-31' })).rewardLiability;
    expect(past.referrals).toMatchObject({ cashPaidInPeriodCents: 0, vouchersRedeemedInPeriodCents: 0, vouchersOpenCents: 1500 });
    expect(past.tokens).toMatchObject({ allocatedInPeriodCents: 0, availableCents: 4250 });
    expect(past.points).toMatchObject({ earnedInPeriod: 0, outstandingPoints: 160 });
    expect(past.giftCards.outstandingCents).toBe(9200);
    // no pos.reports.view → no money amounts at all; another salon never sees these
    expect((await mc.summary(cL({ permissions: VIEW }), { preset: 'all' })).rewardLiability).toEqual({ visible: false });
    const other: any = (await mc.summary(ctx({ permissions: [...VIEW, 'pos.reports.view'] }), { preset: 'all' })).rewardLiability;
    expect(other.giftCards).toEqual({ outstandingCents: 0, cards: 0 });
    expect(other.tokens).toEqual({ wallet: false });
    expect(await snap()).toEqual(before);
  });
});
