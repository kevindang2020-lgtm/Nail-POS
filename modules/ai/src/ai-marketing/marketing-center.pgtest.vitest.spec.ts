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
import { MarketingCenter, MarketingCenterError, toCampaignText } from './marketing-center';
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
