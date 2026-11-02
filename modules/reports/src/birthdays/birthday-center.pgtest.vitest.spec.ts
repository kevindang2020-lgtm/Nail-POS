// birthday-center.pgtest — Birthday Campaigns guide (Oct 31 2026) §16–§17 against the REAL schema (every migration incl. 750).
//   B02/B05   October count = the stored month/day, any birth year (no shift, no invented dates); the empty state is real
//   B04       missing / invalid birthdays excluded and counted, never fabricated
//   B06       Feb 29: Feb 28 (default) or Mar 1 in a non-leap year; itself in a leap year
//   B07/B08   name / phone digits / e-mail / id / "10/15" — beyond page 1; period vs all vs missing scopes differ
//   B09/B10/B11 a cross-year custom range; 10/20/50 pages, exact totals, stable order, newest account first
//   B13       Missing Birthdays Center counts; the birthday edit is role-validated, versioned and audited; the check writes nothing
//   B15/B16   assistant: selected / eligible / excluded with reasons; an offer is required for a promotion; a per-customer token is
//             refused; save = an UNSENT audience + a DRAFT campaign (occasion = birthday), retried save = the same campaign
//   B17/B19   one birthday message per customer per occasion year: a second birthday campaign is refused; a failed send releases
//   B22       another salon's customer is invisible (list, overlay, edit)
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { RetentionRepository, SegmentsRepository } from '@aipowersalon/customers';
import { CampaignCenter } from '@aipowersalon/communications';
import { KyselyOccasionGuard } from '../../../ai/src/ai-marketing/ai-marketing-send.adapters';
import { BirthdayCenter, BirthdayError } from './birthday-center';

const P = 'b1d7a750-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2');
const PERMS = ['pos.customers.view', 'pos.customers.edit', 'pos.marketing.view', 'pos.marketing.manage'];
const ctx: any = { tenantId: T, branchId: B, userId: id('e01'), role: 'OWNER', permissions: PERMS };
const ctx2: any = { ...ctx, tenantId: T2, branchId: B2 };
let pg: any; let db: any; let bc: BirthdayCenter; let year: number; let today: string;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e: any) { return e instanceof BirthdayError ? e.code : String(e?.code ?? e?.message); } }
const audits: Record<string, unknown>[] = [];
const audit = async (_t: unknown, meta: Record<string, unknown>) => { audits.push(meta); };
let n = 0;
async function cust(name: string, birthday: string | null, o: { phone?: string | null; email?: string | null; sms?: boolean; email_ok?: boolean; tenant?: string; yearKnown?: boolean; daysAgo?: number } = {}) {
  const cid = id('c' + String(++n).padStart(3, '0'));
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, marketing_sms_opt_in, marketing_email_opt_in, birthday, birthday_year_known, created_at)
    values ($1,$2,$3,$4,'Glow',$4 || ' Glow',$5,$6,$7,$8,$9::date,$10, now() - make_interval(days => $11))`,
    [cid, o.tenant ?? T, (o.tenant ?? T) === T ? B : B2, name, o.phone === undefined ? `+1215555${String(1000 + n)}` : o.phone, o.email ?? null, o.sms ?? true, o.email_ok ?? false, birthday, o.yearKnown ?? true, o.daysAgo ?? (200 - n)]);
  return cid;
}
const C: Record<string, string> = {};

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  const ret = new RetentionRepository(db);
  bc = new BirthdayCenter(db, ret, new SegmentsRepository(db, ret), new CampaignCenter(db, async () => { throw new Error('no launch in tests'); }));
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot LLC','Pilot Nail Salon','bd-pilot','BDP001','active'), ($2,'Other LLC','Other Nails','bd-other','BDP002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Other','active','America/New_York')`, [B, T, B2, T2]);
  today = (await q(`select (now() at time zone 'America/New_York')::date::text as d`)).rows[0].d; year = Number(today.slice(0, 4));
  // October birthdays in four different birth years; the day before and after October; nothing recorded; another salon
  C.ava = await cust('Ava', '1990-10-15', { email: 'ava@example.com', email_ok: true });
  C.ben = await cust('Ben', '1975-10-01', { sms: true });
  C.cat = await cust('Cat', '2001-10-31', { sms: false });                       // no SMS consent
  C.dan = await cust('Dan', '1988-10-20', { phone: '7876299624' });              // no +country code: not deliverable
  C.eve = await cust('Eve', '2000-10-05', { yearKnown: false });                  // month/day only
  C.sep = await cust('Sep', '1990-09-30'); C.nov = await cust('Nov', '1990-11-01');
  C.none = await cust('Nora', null); C.none2 = await cust('Ned', null);
  C.leap = await cust('Leap', '1992-02-29'); C.feb28 = await cust('Fern', '1985-02-28'); C.mar1 = await cust('Marta', '1985-03-01');
  C.dec31 = await cust('Dee', '1980-12-31'); C.jan2 = await cust('Jan', '1980-01-02');
  C.fut = await cust('Future', `${year + 1}-01-01`);                               // a future birth date: invalid, never shown as fine
  C.x = await cust('Xena', '1990-10-15', { tenant: T2 });
  await q(`insert into notification_opt_outs (tenant_id, channel, address) values ($1,'sms',(select normalized_phone from customers where id = $2))`, [T, C.ben]);   // Ben texted STOP
  // 25 more October birthdays so the list has three pages of 10
  for (let i = 0; i < 25; i++) await cust(`Oct${String(i).padStart(2, '0')}`, `199${i % 10}-10-${String((i % 28) + 1).padStart(2, '0')}`);
}, 240_000);

const names = (r: any) => r.items.map((x: any) => x.name.replace(' Glow', ''));

describe('B02/B05 — October is the stored month/day, any birth year', () => {
  it('the KPI, the list and a direct count agree (30); Sep 30 / Nov 1 / another salon are not October', async () => {
    const s = await bc.summary(ctx, { month: 10 });
    const direct = Number((await q(`select count(*)::int n from customers where tenant_id = $1 and birthday is not null and extract(month from birthday) = 10`, [T])).rows[0].n);
    expect(direct).toBe(30); expect(s.kpis.inRange).toBe(30);
    const l = await bc.customers(ctx, { month: 10, pageSize: 50 });
    expect(l.totalItems).toBe(30);
    for (const x of ['Sep', 'Nov', 'Xena', 'Nora']) expect(names(l)).not.toContain(x);
    expect(names(l)).toEqual(expect.arrayContaining(['Ava', 'Ben', 'Cat', 'Dan', 'Eve']));
  });
  it('eligibility is counted from consent, a deliverable number and opt-outs — not from having a birthday', async () => {
    const s = await bc.summary(ctx, { month: 10 });
    expect(s.kpis.eligibleSms).toBe(27);   // 30 minus Ben (STOP), Cat (no consent), Dan (no +country code)
    expect(s.kpis.eligibleEmail).toBe(1);  // Ava
    const l = await bc.customers(ctx, { month: 10, pageSize: 50, eligibility: 'not_eligible' });
    expect(names(l).sort()).toEqual(['Ben', 'Cat', 'Dan']);
  });
  it('a month/day-only birthday shows its month/day and never its placeholder year', async () => {
    const l = await bc.customers(ctx, { month: 10, q: 'Eve' });
    expect(l.items[0].birthdayMonthDay).toBe('10-05');
    expect(JSON.stringify(l.items[0])).not.toContain('2000');
  });
});

describe('B06 — Feb 29 policy', () => {
  it('Feb 28 by default in a non-leap year; Mar 1 when the salon chooses it; itself in a leap year', async () => {
    const feb27 = await bc.customers(ctx, { preset: 'custom', from: '2027-02-01', to: '2027-02-28', pageSize: 50 });
    expect(names(feb27).sort()).toEqual(['Fern', 'Leap']);
    const mar27 = await bc.customers(ctx, { preset: 'custom', from: '2027-03-01', to: '2027-03-31', pageSize: 50 });
    expect(names(mar27)).toEqual(['Marta']);
    const st = await bc.saveSettings(ctx, { feb29Policy: 'mar1', expectedVersion: 0 }, audit);
    expect(st).toMatchObject({ feb29Policy: 'mar1', version: 1 });
    expect(await code(bc.saveSettings(ctx, { feb29Policy: 'feb28', expectedVersion: 0 }, audit))).toBe('VERSION_CONFLICT');
    expect(names(await bc.customers(ctx, { preset: 'custom', from: '2027-02-01', to: '2027-02-28', pageSize: 50 }))).toEqual(['Fern']);
    expect(names(await bc.customers(ctx, { preset: 'custom', from: '2027-03-01', to: '2027-03-31', pageSize: 50 })).sort()).toEqual(['Leap', 'Marta']);
    expect(names(await bc.customers(ctx, { preset: 'custom', from: '2028-02-29', to: '2028-02-29', pageSize: 50 }))).toEqual(['Leap']);
    await bc.saveSettings(ctx, { feb29Policy: 'feb28', expectedVersion: 1 }, audit);
    // the stored date is never rewritten by the policy
    expect((await q(`select birthday::text b from customers where id = $1`, [C.leap])).rows[0].b).toBe('1992-02-29');
  });
});

describe('B09 — custom From → To (cross-year, inclusive end) and validation', () => {
  it('Dec 25 → Jan 5 finds Dec 31 and Jan 2 (and Jan 1)', async () => {
    const r = await bc.customers(ctx, { preset: 'custom', from: '2026-12-25', to: '2027-01-05', pageSize: 50 });
    expect(names(r).sort()).toEqual(['Dee', 'Future', 'Jan']);
  });
  it('reversed, impossible and over-long ranges are refused', async () => {
    expect(await code(bc.customers(ctx, { preset: 'custom', from: '2027-01-05', to: '2026-12-25' }))).toBe('BIRTHDAY_RANGE_INVALID');
    expect(await code(bc.customers(ctx, { preset: 'custom', from: '2027-02-30', to: '2027-03-05' }))).toBe('BIRTHDAY_RANGE_INVALID');
    expect(await code(bc.customers(ctx, { preset: 'custom', from: '2026-01-01', to: '2027-06-01' }))).toBe('BIRTHDAY_RANGE_INVALID');
    expect(await code(bc.customers(ctx, { sort: 'cheapest' }))).toBe('BIRTHDAY_FILTER_INVALID');
  });
});

describe('B07/B08 — search across server pages and the three scopes', () => {
  it('name / phone digits / e-mail / customer id / "10/15"', async () => {
    expect(names(await bc.customers(ctx, { month: 10, q: 'ava' }))).toEqual(['Ava']);
    const ph = (await q(`select normalized_phone p from customers where id = $1`, [C.ava])).rows[0].p as string;
    expect(names(await bc.customers(ctx, { month: 10, q: ph.slice(-7) }))).toEqual(['Ava']);
    expect(names(await bc.customers(ctx, { month: 10, q: 'ava@example' }))).toEqual(['Ava']);
    expect(names(await bc.customers(ctx, { month: 10, q: C.ava }))).toEqual(['Ava']);
    expect(names(await bc.customers(ctx, { month: 10, q: '10/15', pageSize: 50 })).sort()).toEqual(['Ava', 'Oct14']);
  });
  it('a customer on page 3 is found by search; a match outside the period says why instead of vanishing', async () => {
    const p3 = await bc.customers(ctx, { month: 10, sort: 'name_asc', pageSize: 10, page: 3 });
    expect(names(p3)).toContain('Oct24');
    expect(names(await bc.customers(ctx, { month: 10, q: 'Oct24' }))).toEqual(['Oct24']);
    const miss = await bc.customers(ctx, { month: 10, q: 'Nov' });
    expect(miss.totalItems).toBe(0); expect(miss.hint).toBe('no_match_in_period');
    expect(names(await bc.customers(ctx, { scope: 'all', q: 'Nov' }))).toEqual(['Nov']);
    expect(names(await bc.customers(ctx, { scope: 'missing' })).sort()).toEqual(['Ned', 'Nora']);
  });
});

describe('B10/B11 — pages, sizes, stable order, upcoming / newest', () => {
  it('3 pages of 10 cover the 30 exactly once; 50 shows all; an unknown size falls back to 20', async () => {
    const seen = new Set<string>();
    for (const page of [1, 2, 3]) { const r = await bc.customers(ctx, { month: 10, pageSize: 10, page }); expect(r.totalPages).toBe(3); r.items.forEach((x: any) => seen.add(x.customerId)); }
    expect(seen.size).toBe(30);
    expect((await bc.customers(ctx, { month: 10, pageSize: 50 })).items.length).toBe(30);
    expect((await bc.customers(ctx, { month: 10, pageSize: 7 })).pageSize).toBe(20);
  });
  it('upcoming: soonest next birthday first (days until never decreases)', async () => {
    const r = await bc.customers(ctx, { month: 10, pageSize: 50, sort: 'upcoming' });
    const d = r.items.map((x: any) => x.daysUntil as number);
    expect(d).toEqual([...d].sort((a, b) => a - b));
  });
});

describe('B13 — Missing Birthdays Center (read-only) and the audited birthday edit', () => {
  it('counts recorded / missing / invalid / year-unknown and writes nothing', async () => {
    const before = (await q(`select max(updated_at)::text m, count(*)::int n from customers where tenant_id = $1`, [T])).rows[0];
    const m = await bc.missing(ctx);
    expect(m.counts).toMatchObject({ missing: 2, invalid: 1, yearUnknown: 1 });
    expect(m.counts.recorded + m.counts.missing).toBe(m.counts.total);
    expect(m.status).toBe('needs_review');
    expect(m.importRejected).toBeNull();
    expect((await q(`select max(updated_at)::text m, count(*)::int n from customers where tenant_id = $1`, [T])).rows[0]).toEqual(before);
  });
  it('record MM-DD (year unknown) → versioned, sourced, audited; impossible / future / stale / other salon refused; clear works', async () => {
    const v = Number((await q(`select record_version v from customers where id = $1`, [C.none])).rows[0].v);
    const r = await bc.updateBirthday(ctx, C.none, { birthday: '07-04', expectedVersion: v }, audit);
    expect(r).toMatchObject({ monthDay: '07-04', yearKnown: false, source: 'staff', recordVersion: v + 1 });
    expect((await q(`select birthday::text b, birthday_year_known k, birthday_source s, birthday_updated_by u from customers where id = $1`, [C.none])).rows[0])
      .toEqual({ b: '2000-07-04', k: false, s: 'staff', u: ctx.userId });
    expect(audits.at(-1)).toMatchObject({ hadBirthday: false, hasBirthday: true, yearKnown: false });
    expect(await code(bc.updateBirthday(ctx, C.none, { birthday: '1990-07-04', expectedVersion: v }, audit))).toBe('VERSION_CONFLICT');
    expect(await code(bc.updateBirthday(ctx, C.none, { birthday: '1990-02-30', expectedVersion: v + 1 }, audit))).toBe('BIRTHDAY_INVALID');
    expect(await code(bc.updateBirthday(ctx, C.none, { birthday: `${year + 1}-01-01`, expectedVersion: v + 1 }, audit))).toBe('BIRTHDAY_INVALID');
    expect(await code(bc.updateBirthday(ctx2, C.none, { birthday: '1990-07-04', expectedVersion: v + 1 }, audit))).toBe('CUSTOMER_NOT_FOUND');
    const cl = await bc.updateBirthday(ctx, C.none, { birthday: null, expectedVersion: v + 1 }, audit);
    expect(cl).toMatchObject({ monthDay: null, source: null });
    expect((await bc.missing(ctx)).counts.missing).toBe(2);
  });
});

describe('B14/B22 — the overlay and tenant isolation', () => {
  it('overlay: month/day + a true empty history; another salon cannot open it or see its customers', async () => {
    const o: any = await bc.overlay(ctx, C.ava);
    expect(o.birthday).toMatchObject({ monthDay: '10-15', status: 'recorded', yearKnown: true });
    expect(o.noHistory).toBe(true); expect(o.birthdayMessages).toEqual([]);
    expect(await code(bc.overlay(ctx2, C.ava))).toBe('CUSTOMER_NOT_FOUND');
    expect(names(await bc.customers(ctx2, { month: 10 }))).toEqual(['Xena']);
  });
});

let campA = ''; let campB = '';
describe('B15/B16 — Smart Birthday Campaign Assistant: counts with reasons, checks, an UNSENT draft', () => {
  it('plan: selected = eligible + excluded with reasons; a promotion needs an offer; a per-customer token is refused', async () => {
    const p = await bc.plan(ctx, { objective: 'greeting', channel: 'sms', month: 10 });
    expect(p.audience.selected).toBe(30);
    expect(p.audience.eligible + p.audience.excluded).toBe(30);
    expect(p.audience.eligible).toBeLessThanOrEqual(27);
    expect(Object.keys(p.audience.excludedReasons).length).toBeGreaterThan(0);
    expect(p.suggestions.messageIsSuggestion).toBe(true);
    expect(await code(bc.plan(ctx, { objective: 'service_promotion', channel: 'sms', month: 10 }))).toBe('BIRTHDAY_OFFER_REQUIRED');
    const tid = id('f01');
    await q(`insert into message_templates (id, tenant_id, name, channel, category, status, current_version) values ($1,$2,'Birthday hi','sms','birthday','published',1)`, [tid, T]);
    await q(`insert into message_template_versions (template_id, version, body, status) values ($1,1,'Happy birthday {{customer_first_name}} from {{salon_name}}!','published')`, [tid]);
    const pt = await bc.plan(ctx, { objective: 'greeting', channel: 'sms', month: 10, templateId: tid });
    expect(pt.template?.usable).toBe(false);
    expect(await code(bc.save(ctx, { objective: 'greeting', channel: 'sms', month: 10, templateId: tid, idempotencyKey: 'bday-tpl-0001' }, audit))).toBe('BIRTHDAY_TEMPLATE_INVALID');
    expect(await code(bc.save(ctx, { objective: 'greeting', channel: 'sms', month: 10, message: 'Hi {customer_first_name}', idempotencyKey: 'bday-tok-0001' }, audit))).toBe('BIRTHDAY_TEMPLATE_INVALID');
  });
  it('save: an unsent audience + a DRAFT birthday campaign; a retried save returns the same campaign; nothing is sent', async () => {
    const s = await bc.save(ctx, { objective: 'greeting', channel: 'sms', month: 10, idempotencyKey: 'bday-oct-0001' }, audit);
    campA = s.campaignId;
    const c = (await q(`select status, occasion, goal, audience_size from campaigns where id = $1`, [campA])).rows[0];
    expect(c).toMatchObject({ status: 'draft', occasion: 'birthday', goal: 'Birthday: greeting' });
    expect(Number(c.audience_size)).toBe(30);
    expect(Number((await q(`select count(*)::int n from campaign_recipients where campaign_id = $1`, [campA])).rows[0].n)).toBe(30);
    expect((await bc.save(ctx, { objective: 'greeting', channel: 'sms', month: 10, idempotencyKey: 'bday-oct-0001' }, audit))).toMatchObject({ campaignId: campA, duplicate: true });
    expect(Number((await q(`select count(*)::int n from notifications where tenant_id = $1`, [T])).rows[0].n)).toBe(0);
    expect(Number((await q(`select count(*)::int n from birthday_message_claims where tenant_id = $1`, [T])).rows[0].n)).toBe(0);
    const s2 = await bc.save(ctx, { objective: 'greeting', channel: 'sms', month: 10, name: 'Second birthday push', idempotencyKey: 'bday-oct-0002' }, audit);
    campB = s2.campaignId; expect(campB).not.toBe(campA);
  });
});

describe('B17/B19 — one birthday message per customer per occasion year (the send-time claim)', () => {
  it('first campaign claims; a second claim mid-send is refused; a second birthday campaign is refused; a failed send releases', async () => {
    const g = new KyselyOccasionGuard(db);
    const a = await g.claim(ctx, campA, C.ava, 'sms'); expect(a.allowed).toBe(true);
    expect(await g.claim(ctx, campA, C.ava, 'sms')).toMatchObject({ allowed: false, reason: 'birthday_send_in_progress' });   // a second worker / a died run: never a 2nd text
    expect(await g.claim(ctx, campB, C.ava, 'sms')).toMatchObject({ allowed: false, reason: 'birthday_already_sent_this_year' });
    expect((await g.claim(ctx, campB, C.ava, 'email')).allowed).toBe(true);                     // per channel
    await g.settle(ctx, a.claimId!, 'released');                                               // the send failed
    const b = await g.claim(ctx, campB, C.ava, 'sms'); expect(b.allowed).toBe(true);
    await g.settle(ctx, b.claimId!, 'sent');
    expect(await g.claim(ctx, campA, C.ava, 'sms')).toMatchObject({ allowed: false });
    expect((await bc.summary(ctx, { month: 10 })).kpis.messagesSent).toBe(1);
    const row = (await q(`select occasion_year y from birthday_message_claims where customer_id = $1 and channel = 'sms'`, [C.ava])).rows[0];
    expect([year, year + 1]).toContain(Number(row.y));
  });
  it('a non-birthday campaign is never limited; a cleared birthday is not texted', async () => {
    const g = new KyselyOccasionGuard(db);
    const plain = (await q(`insert into campaigns (tenant_id, branch_id, name, channel, status, audience_size) values ($1,$2,'Plain','sms','draft',0) returning id`, [T, B])).rows[0].id;
    expect((await g.claim(ctx, plain, C.ava, 'sms')).allowed).toBe(true);
    expect(await g.claim(ctx, campA, C.none2, 'sms')).toMatchObject({ allowed: false, reason: 'birthday_not_recorded' });
  });
});
