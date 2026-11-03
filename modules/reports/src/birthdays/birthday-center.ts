// birthday-center.ts — Birthday Campaigns guide (Oct 31 2026): `/pos/birthdays/*`. Reuses, never duplicates:
//   customers.birthday (DATE) + 750 provenance        the ONE birthday; month/day matching through birthday-core (Feb 29 policy,
//                                                     year rollover) — a DATE is never pushed through a timezone
//   RetentionRepository.window                        the salon's timezone + "today"
//   SegmentsRepository                                consent verdicts (the same rules Campaign Center re-checks at send),
//                                                     the unsent audience draft, the authorized customer overlay
//   CampaignCenter                                    the Birthday Campaign Assistant only ever creates a DRAFT campaign there
//                                                     (approval, launch and sending stay in Campaign Center)
//   birthday_message_claims (750)                     "one birthday message per customer per year" — claimed by the send worker
// Nothing here sends a message, issues an offer or changes a customer except the role-gated, audited birthday edit.
import { sql, type Kysely } from 'kysely';
import {
  RetentionRepository, SegmentsRepository, isUuid, type RetentionContext,
  parseBirthdayInput, storedDateString, monthDayOf, occurrence, nextOccurrence, occasionYear, addDays, daysBetween, parts, isLeap,
  isFeb29Policy, BIRTHDAY_RULESET, type Feb29Policy, type MonthDay,
} from '@aipowersalon/customers';
import { CampaignCenter, parseTokens } from '@aipowersalon/communications';

export class BirthdayError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400, readonly details?: Record<string, unknown>) { super(message); }
}
export const BD_SCOPES = ['period', 'all', 'missing'] as const;
export const BD_SORTS = ['upcoming', 'newest', 'name_asc', 'name_desc'] as const;
export const BD_BASES = ['occurrence', 'created'] as const;
export const BD_PRESETS = ['today', 'next7', 'month', 'next_month', 'year', 'custom'] as const;
export const BD_ELIGIBILITY = ['sms_eligible', 'email_eligible', 'not_eligible'] as const;
export const BD_OBJECTIVES = ['greeting', 'service_promotion', 'loyalty_reward'] as const;
export const BD_ALLOWED_TOKENS = ['salon_name', 'offer'] as const;   // what Campaign Center fills (one approved text per campaign)
export const BD_MAX_AUDIENCE = 5000;
const MAX_RANGE_DAYS = 366;
const ASSOCIATION_DAYS = 30;

const N = (v: unknown) => Number(v ?? 0) || 0;
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const str = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const pick = <T extends readonly string[]>(vals: T, v: unknown): T[number] | undefined => ((vals as readonly string[]).includes(String(v)) ? (String(v) as T[number]) : undefined);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const mdKey = (md: MonthDay) => md.month * 100 + md.day;
const maskPhone = (p: unknown) => { const d = String(p ?? '').replace(/\D/g, ''); return d.length >= 4 ? `•••• ${d.slice(-4)}` : null; };
const maskEmail = (e: unknown) => { const s = String(e ?? ''); const at = s.indexOf('@'); return at > 0 ? `${s[0]}•••${s.slice(at)}` : null; };

export interface BirthdayListFilters { scope?: unknown; preset?: unknown; month?: unknown; from?: unknown; to?: unknown; basis?: unknown; q?: unknown;
  eligibility?: unknown; tier?: unknown; sort?: unknown; page?: unknown; pageSize?: unknown }

export class BirthdayCenter {
  constructor(readonly db: Kysely<any>, readonly ret: RetentionRepository, readonly seg: SegmentsRepository, readonly cc: CampaignCenter) {}

  // ── salon basics ────────────────────────────────────────────────────────────────────────────────────────────────
  async settings(ctx: RetentionContext, db: Kysely<any> = this.db) {
    const r = (await sql<any>`select feb29_policy, version, updated_at from tenant_birthday_settings where tenant_id = ${ctx.tenantId}`.execute(db)).rows[0];
    return { feb29Policy: (isFeb29Policy(r?.feb29_policy) ? r.feb29_policy : 'feb28') as Feb29Policy, version: N(r?.version), isDefault: !r, updatedAt: iso(r?.updated_at) };
  }
  async saveSettings(ctx: RetentionContext, b: { feb29Policy?: unknown; expectedVersion?: unknown }, audit: (trx: Kysely<any>, meta: Record<string, unknown>) => Promise<void>) {
    if (!isFeb29Policy(b.feb29Policy)) throw new BirthdayError('Choose Feb 28 or Mar 1.', 'BIRTHDAY_POLICY_INVALID');
    const expected = Math.trunc(N(b.expectedVersion));
    const actor = isUuid(ctx.userId) ? ctx.userId : null;
    return this.db.transaction().execute(async (trx) => {
      const cur = await this.settings(ctx, trx);
      if (cur.version !== expected) throw new BirthdayError('Someone else changed this setting. Reload and try again.', 'VERSION_CONFLICT', 409, { currentVersion: cur.version });
      if (cur.isDefault) await sql`insert into tenant_birthday_settings (tenant_id, feb29_policy, version, created_by, updated_by) values (${ctx.tenantId}, ${b.feb29Policy}, 1, ${actor}, ${actor})`.execute(trx);
      else await sql`update tenant_birthday_settings set feb29_policy = ${b.feb29Policy}, version = version + 1, updated_by = ${actor}, updated_at = now() where tenant_id = ${ctx.tenantId} and version = ${expected}`.execute(trx);
      await audit(trx, { before: cur.feb29Policy, after: b.feb29Policy });
      return this.settings(ctx, trx);
    });
  }
  private async base(ctx: RetentionContext) {
    const k = await this.ret.window(ctx);
    const st = await this.settings(ctx);
    return { tz: k.tz, today: k.today, policy: st.feb29Policy, year: parts(k.today)!.y, settingsVersion: st.version };
  }
  /** the customers this session may see — the same rule as the Customers list (tenant + session branch or no branch) */
  private branchW(ctx: RetentionContext) {
    return isUuid(ctx.branchId) ? sql`(c.branch_id = ${ctx.branchId} or c.branch_id is null)` : sql`true`;
  }
  /** month/day keys (MMDD) whose occurrence falls in [from, to]; 0229 joins on the policy's stand-in day in non-leap years */
  mdKeysIn(from: string, to: string, policy: Feb29Policy): number[] {
    const keys = new Set<number>();
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const p = parts(d)!; keys.add(p.m * 100 + p.d);
      if (!isLeap(p.y) && ((policy === 'feb28' && p.m === 2 && p.d === 28) || (policy === 'mar1' && p.m === 3 && p.d === 1))) keys.add(229);
      if (isLeap(p.y) && p.m === 2 && p.d === 29) keys.add(229);
    }
    // in a leap year 0229 is itself; in a non-leap year it stands on the policy day — never both in one year
    return [...keys];
  }
  /** the occurrence range a list / KPI reads: preset or month or custom From → To (inclusive, ≤ 366 days, may cross years) */
  range(b: { today: string; year: number }, f: { preset?: unknown; month?: unknown; from?: unknown; to?: unknown }): { preset: string; from: string; to: string } {
    const month = Math.trunc(N(f.month));
    const preset = pick(BD_PRESETS, f.preset) ?? (f.from || f.to ? 'custom' : month ? 'month' : 'month');
    const mEnd = (y: number, m: number) => { const nm = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`; return addDays(nm, -1); };
    const cur = parts(b.today)!;
    if (preset === 'today') return { preset, from: b.today, to: b.today };
    if (preset === 'next7') return { preset, from: b.today, to: addDays(b.today, 6) };
    if (preset === 'year') return { preset, from: `${b.year}-01-01`, to: `${b.year}-12-31` };
    if (preset === 'next_month') { const y = cur.m === 12 ? cur.y + 1 : cur.y; const m = cur.m === 12 ? 1 : cur.m + 1; return { preset, from: `${y}-${String(m).padStart(2, '0')}-01`, to: mEnd(y, m) }; }
    if (preset === 'custom') {
      const from = typeof f.from === 'string' && DAY.test(f.from) && parts(f.from) ? f.from : null;
      const to = typeof f.to === 'string' && DAY.test(f.to) && parts(f.to) ? f.to : null;
      if (!from || !to) throw new BirthdayError('Choose a From and a To date.', 'BIRTHDAY_RANGE_INVALID');
      if (from > to) throw new BirthdayError('The From date must be on or before the To date.', 'BIRTHDAY_RANGE_INVALID');
      if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) throw new BirthdayError('Choose a range of 366 days or less.', 'BIRTHDAY_RANGE_INVALID');
      return { preset, from, to };
    }
    const m = month >= 1 && month <= 12 ? month : cur.m;
    return { preset: 'month', from: `${cur.y}-${String(m).padStart(2, '0')}-01`, to: mEnd(cur.y, m) };
  }
  private mdExpr() { return sql`(extract(month from c.birthday)::int * 100 + extract(day from c.birthday)::int)`; }
  /** SQL predicates for marketing eligibility (the list filter); each row's shown verdict comes from Customer Segments */
  private smsEligibleW() {
    return sql`(c.marketing_sms_opt_in and coalesce(c.normalized_phone, '') like '+%' and not exists (select 1 from notification_opt_outs o where o.tenant_id = c.tenant_id and o.channel = 'sms'
      and regexp_replace(o.address, '[^0-9]', '', 'g') = regexp_replace(c.normalized_phone, '[^0-9]', '', 'g')))`;
  }
  private emailEligibleW() {
    return sql`(c.marketing_email_opt_in and coalesce(c.email, '') like '%@%' and not exists (select 1 from notification_opt_outs o where o.tenant_id = c.tenant_id and o.channel = 'email' and lower(o.address) = lower(c.email)))`;
  }

  // ── KPI strip (guide §04 B) ─────────────────────────────────────────────────────────────────────────────────────
  async summary(ctx: RetentionContext, f: { month?: unknown; preset?: unknown; from?: unknown; to?: unknown }) {
    const b = await this.base(ctx);
    const r = this.range(b, f);
    const W = this.branchW(ctx); const md = this.mdExpr();
    const keysR = this.mdKeysIn(r.from, r.to, b.policy);
    const keys7 = this.mdKeysIn(b.today, addDays(b.today, 6), b.policy);
    const k = (await sql<any>`select
        count(*) filter (where c.birthday is not null and ${md} = any(${keysR}::int[]))::int as in_range,
        count(*) filter (where c.birthday is not null and ${md} = any(${keys7}::int[]))::int as next7,
        count(*) filter (where c.birthday is not null and ${md} = any(${keysR}::int[]) and ${this.smsEligibleW()})::int as sms_eligible,
        count(*) filter (where c.birthday is not null and ${md} = any(${keysR}::int[]) and ${this.emailEligibleW()})::int as email_eligible,
        count(*)::int as total, count(*) filter (where c.birthday is not null)::int as recorded, count(*) filter (where c.birthday is not null and not c.birthday_year_known)::int as year_unknown
      from customers c where c.tenant_id = ${ctx.tenantId} and ${W} and c.archived_at is null and c.status <> 'archived'`.execute(this.db)).rows[0];
    // Nov 3 audit: the message / offer / visit KPIs are scoped to the branch like the customer counts, and to the customers whose birthday
    // falls in the chosen range (they used to count the whole year whatever range was picked)
    const yrs = [...new Set([Number(r.from.slice(0, 4)), Number(r.to.slice(0, 4))])];
    const inR = sql`c.birthday is not null and ${md} = any(${keysR}::int[]) and m.occasion_year = any(${yrs}::int[])`;
    const sent = (await sql<any>`select count(*) filter (where m.status = 'sent')::int as sent, count(*) filter (where m.status = 'claimed')::int as in_flight
      from birthday_message_claims m join customers c on c.id = m.customer_id and c.tenant_id = m.tenant_id where m.tenant_id = ${ctx.tenantId} and ${inR} and ${W}`.execute(this.db)).rows[0];
    // offers redeemed: a redemption of the deal attached to a birthday campaign, by a customer that campaign messaged, after the message
    const red = (await sql<any>`select count(distinct dr.id)::int as n from birthday_message_claims m
        join campaigns cp on cp.id = m.campaign_id and cp.tenant_id = m.tenant_id
        join deal_redemptions dr on dr.tenant_id = m.tenant_id and dr.deal_id = cp.deal_id and dr.customer_id = m.customer_id and dr.status = 'redeemed' and coalesce(dr.redeemed_at, dr.created_at) >= m.created_at
        join customers c on c.id = m.customer_id and c.tenant_id = m.tenant_id
      where m.tenant_id = ${ctx.tenantId} and ${inR} and m.status = 'sent' and ${W}`.execute(this.db)).rows[0];
    // completed visits after a birthday message: an ASSOCIATION (observed), never claimed as caused by the campaign
    const bk = (await sql<any>`select count(distinct t.id)::int as n, coalesce(sum(t.total_cents), 0)::bigint as cents from birthday_message_claims m
        join tickets t on t.tenant_id = m.tenant_id and t.customer_id = m.customer_id and t.status in ('paid', 'closed') and t.removed_at is null
          and t.paid_at >= m.created_at and t.paid_at < m.created_at + make_interval(days => ${ASSOCIATION_DAYS})   -- anchored on the send (claim) time; updated_at moves on any later update
        join customers c on c.id = m.customer_id and c.tenant_id = m.tenant_id
      where m.tenant_id = ${ctx.tenantId} and ${inR} and m.status = 'sent' and ${W}`.execute(this.db)).rows[0];
    return {
      asOf: new Date().toISOString(), timezone: b.tz, today: b.today, ruleset: BIRTHDAY_RULESET, feb29Policy: b.policy, range: r,
      kpis: { inRange: N(k.in_range), next7Days: N(k.next7), eligibleSms: N(k.sms_eligible), eligibleEmail: N(k.email_eligible),
        messagesSent: N(sent.sent), messagesInFlight: N(sent.in_flight), offersRedeemed: N(red.n),
        bookingsAfterMessage: N(bk.n), bookingsAfterMessageCents: N(bk.cents), associationDays: ASSOCIATION_DAYS, occasionYear: b.year },
      completeness: { total: N(k.total), recorded: N(k.recorded), missing: N(k.total) - N(k.recorded), yearUnknown: N(k.year_unknown),
        percent: N(k.total) ? Math.round((N(k.recorded) / N(k.total)) * 1000) / 10 : null },
    };
  }

  // ── customer table (guide §04 D, §07) ───────────────────────────────────────────────────────────────────────────
  async customers(ctx: RetentionContext, f: BirthdayListFilters) {
    const b = await this.base(ctx);
    const scope = pick(BD_SCOPES, f.scope) ?? 'period';
    const basis = pick(BD_BASES, f.basis) ?? 'occurrence';
    const sort = pick(BD_SORTS, f.sort) ?? (scope === 'missing' ? 'newest' : 'upcoming');
    if (f.sort != null && f.sort !== '' && !pick(BD_SORTS, f.sort)) throw new BirthdayError('Unknown sort.', 'BIRTHDAY_FILTER_INVALID');
    if (f.scope != null && f.scope !== '' && !pick(BD_SCOPES, f.scope)) throw new BirthdayError('Unknown scope.', 'BIRTHDAY_FILTER_INVALID');
    const elig = f.eligibility == null || f.eligibility === '' ? undefined : pick(BD_ELIGIBILITY, f.eligibility);
    if (f.eligibility != null && f.eligibility !== '' && !elig) throw new BirthdayError('Unknown eligibility filter.', 'BIRTHDAY_FILTER_INVALID');
    const pageSize = [10, 20, 50].includes(Math.trunc(N(f.pageSize))) ? Math.trunc(N(f.pageSize)) : 20;
    const page = Math.max(1, Math.trunc(N(f.page)) || 1);
    const W = this.branchW(ctx); const md = this.mdExpr();
    const conds = [W, sql`c.archived_at is null`, sql`c.status <> 'archived'`];
    let r: { preset: string; from: string; to: string } | null = null;
    if (scope === 'missing') conds.push(sql`c.birthday is null`);
    else {
      conds.push(sql`c.birthday is not null`);
      if (scope === 'period') {
        r = this.range(b, f);
        if (basis === 'occurrence') conds.push(sql`${md} = any(${this.mdKeysIn(r.from, r.to, b.policy)}::int[])`);
        else conds.push(sql`c.created_at >= (${r.from}::date::timestamp at time zone ${b.tz}) and c.created_at < ((${r.to}::date + 1)::timestamp at time zone ${b.tz})`);
      }
    }
    if (scope === 'missing' && (f.from || f.to)) { const rr = this.range(b, { preset: 'custom', from: f.from, to: f.to }); conds.push(sql`c.created_at >= (${rr.from}::date::timestamp at time zone ${b.tz}) and c.created_at < ((${rr.to}::date + 1)::timestamp at time zone ${b.tz})`); }
    const q = str(f.q, 100);
    if (q) {
      const digits = q.replace(/\D/g, '');
      const mdm = /^(\d{1,2})[/-](\d{1,2})$/.exec(q);
      const parts2: any[] = [sql`c.full_name ilike ${'%' + q + '%'}`, sql`(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) ilike ${'%' + q + '%'}`, sql`c.email ilike ${'%' + q + '%'}`, sql`c.id::text = ${q.toLowerCase()}`];
      if (digits.length >= 4) parts2.push(sql`regexp_replace(coalesce(c.normalized_phone, ''), '[^0-9]', '', 'g') like ${'%' + digits + '%'}`);
      if (mdm) parts2.push(sql`${md} = ${Number(mdm[1]) * 100 + Number(mdm[2])}`);
      conds.push(sql`(${sql.join(parts2, sql` or `)})`);
    }
    if (elig === 'sms_eligible') conds.push(this.smsEligibleW());
    if (elig === 'email_eligible') conds.push(this.emailEligibleW());
    if (elig === 'not_eligible') conds.push(sql`not ${this.smsEligibleW()} and not ${this.emailEligibleW()}`);
    const tier = str(f.tier, 40);
    if (tier) conds.push(sql`exists (select 1 from customer_loyalty_profiles lp where lp.tenant_id = c.tenant_id and lp.customer_id = c.id and lp.loyalty_tier = ${tier})`);
    const where = sql.join(conds, sql` and `);
    const t = parts(b.today)!; const todayKey = t.m * 100 + t.d;
    const order = sort === 'newest' ? sql`c.created_at desc, c.id desc`
      : sort === 'name_asc' ? sql`lower(coalesce(c.full_name, '')) asc, c.id asc`
      : sort === 'name_desc' ? sql`lower(coalesce(c.full_name, '')) desc, c.id desc`
      : scope === 'missing' ? sql`c.created_at desc, c.id desc`
      // soonest next occurrence first: this year's remaining month/days, then next year's (Dec 31 → Jan 1 wraps)
      // a Feb 29 birthday sorts on the day it is celebrated (Feb 28 or Mar 1 by the salon's policy) in a non-leap year — it used to sort
      // as "Feb 29", so on Mar 1 with the Mar 1 policy that day's celebrant sorted to next year
      : (() => {
          const k29 = (y: number) => (isLeap(y) ? 229 : b.policy === 'mar1' ? 301 : 228);
          const effThis = sql`(case when ${md} = 229 then ${k29(t.y)} else ${md} end)`, effNext = sql`(case when ${md} = 229 then ${k29(t.y + 1)} else ${md} end)`;
          return sql`case when ${effThis} >= ${todayKey} then 0 else 1 end, case when ${effThis} >= ${todayKey} then ${effThis} else ${effNext} end, c.id`;
        })();
    const total = N((await sql<any>`select count(*)::int as n from customers c where c.tenant_id = ${ctx.tenantId} and ${where}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<any>`select c.id, c.full_name, c.first_name, c.last_name, c.normalized_phone, c.email, c.created_at, to_char(c.birthday, 'YYYY-MM-DD') as birthday, c.birthday_year_known, c.birthday_source,
        (select max(coalesce(tk.paid_at, tk.created_at)) from tickets tk where tk.tenant_id = c.tenant_id and tk.customer_id = c.id and tk.status in ('paid', 'closed') and tk.removed_at is null) as last_visit,
        (select lp.loyalty_tier from customer_loyalty_profiles lp where lp.tenant_id = c.tenant_id and lp.customer_id = c.id order by lp.created_at limit 1) as tier
      from customers c where c.tenant_id = ${ctx.tenantId} and ${where} order by ${order} limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    const ids = rows.map((x: any) => String(x.id));
    const [vs, ve] = ids.length ? await Promise.all([this.seg.verdicts(ctx, ids, 'sms', 'general'), this.seg.verdicts(ctx, ids, 'email', 'general')]) : [new Map(), new Map()];
    const claims = ids.length ? (await sql<any>`select customer_id, channel, status, occasion_year from birthday_message_claims where tenant_id = ${ctx.tenantId} and customer_id = any(${ids}::uuid[]) and occasion_year between ${b.year - 1} and ${b.year + 1}`.execute(this.db)).rows : [];
    const items = rows.map((x: any) => {
      const id = String(x.id); const m = monthDayOf(x.birthday);
      const next = m ? nextOccurrence(m, b.today, b.policy) : null;
      const occ = m ? occasionYear(m, b.today, b.policy) : null;
      const mine = claims.filter((c: any) => String(c.customer_id) === id && N(c.occasion_year) === occ);
      const message = mine.some((c: any) => c.status === 'sent') ? 'sent' : mine.some((c: any) => c.status === 'claimed') ? 'sending' : 'not_sent';
      return {
        customerId: id, name: String(x.full_name || `${x.first_name ?? ''} ${x.last_name ?? ''}`.trim() || '—'),
        maskedPhone: maskPhone(x.normalized_phone), maskedEmail: maskEmail(x.email), createdAt: iso(x.created_at),
        birthdayMonthDay: m ? `${String(m.month).padStart(2, '0')}-${String(m.day).padStart(2, '0')}` : null, birthdayStatus: m ? 'recorded' : 'not_recorded',
        birthdaySource: x.birthday_source ?? null, nextOccurrence: next?.date ?? null, daysUntil: next?.daysUntil ?? null,
        lastVisitAt: iso(x.last_visit), loyaltyTier: x.tier ?? null,
        sms: vs.get(id)?.status ?? 'unknown', email: ve.get(id)?.status ?? 'unknown', birthdayMessage: m ? message : null,
      };
    });
    return { scope, basis, sort, range: r, page, pageSize, totalItems: total, totalPages: Math.max(1, Math.ceil(total / pageSize)), items,
      timezone: b.tz, today: b.today, feb29Policy: b.policy, ruleset: BIRTHDAY_RULESET,
      // guide §07: a search hit outside the selected period is not silently dropped from view — the client is told why
      hint: scope === 'period' && q && total === 0 ? 'no_match_in_period' : null };
  }

  // ── Missing Birthdays Center (recommendation 1) — read-only health check ────────────────────────────────────────────
  async missing(ctx: RetentionContext) {
    const b = await this.base(ctx);
    const W = this.branchW(ctx);
    const k = (await sql<any>`select count(*)::int as total, count(*) filter (where c.birthday is not null)::int as recorded,
        count(*) filter (where c.birthday is not null and c.birthday_year_known and (c.birthday > ${b.today}::date or extract(year from c.birthday) <= 1900))::int as invalid,
        count(*) filter (where c.birthday is not null and not c.birthday_year_known)::int as year_unknown,
        count(*) filter (where c.birthday is not null and c.birthday_source is null)::int as source_unrecorded,
        count(*) filter (where c.birthday is not null and c.birthday_source = 'staff')::int as by_staff,
        count(*) filter (where c.birthday is not null and c.birthday_source = 'customer_app')::int as by_customer,
        count(*) filter (where c.birthday is not null and c.birthday_source = 'import')::int as by_import,
        count(*) filter (where c.birthday is not null and c.birthday_source = 'created')::int as at_creation
      from customers c where c.tenant_id = ${ctx.tenantId} and ${W} and c.archived_at is null and c.status <> 'archived'`.execute(this.db)).rows[0];
    const missing = N(k.total) - N(k.recorded);
    const status = N(k.total) === 0 ? 'unknown' : N(k.invalid) > 0 ? 'needs_review' : missing === 0 ? 'data_complete' : 'missing';
    return { checkedAt: new Date().toISOString(), today: b.today, status,
      counts: { total: N(k.total), recorded: N(k.recorded), missing, invalid: N(k.invalid), yearUnknown: N(k.year_unknown),
        completenessPercent: N(k.total) ? Math.round((N(k.recorded) / N(k.total)) * 1000) / 10 : null },
      sources: { staff: N(k.by_staff), customerApp: N(k.by_customer), import: N(k.by_import), atCreation: N(k.at_creation), notRecorded: N(k.source_unrecorded) },
      // the CSV import keeps no rejected-row log: those counts are Unknown, never 0
      importRejected: null, importRejectedReason: 'The customer import does not store rejected rows, so rejected birthdays cannot be counted.' };
  }

  // ── authorized overlay (guide §09) ─────────────────────────────────────────────────────────────────────────────
  async overlay(ctx: RetentionContext, customerId: string) {
    if (!isUuid(customerId)) throw new BirthdayError('Customer not found.', 'CUSTOMER_NOT_FOUND', 404);
    const b = await this.base(ctx);
    const c = (await sql<any>`select c.id, c.full_name, to_char(c.birthday, 'YYYY-MM-DD') as birthday, c.birthday_year_known, c.birthday_source, c.birthday_updated_at, c.record_version from customers c where c.tenant_id = ${ctx.tenantId} and ${this.branchW(ctx)} and c.id = ${customerId}`.execute(this.db)).rows[0];
    if (!c) throw new BirthdayError('Customer not found.', 'CUSTOMER_NOT_FOUND', 404);
    const base = await this.seg.overlay(ctx, customerId);
    const m = monthDayOf(c.birthday);
    const claims = (await sql<any>`select m.occasion_year, m.channel, m.status, m.created_at, m.updated_at, cp.id as campaign_id, cp.name as campaign_name, cp.deal_id
      from birthday_message_claims m left join campaigns cp on cp.id = m.campaign_id and cp.tenant_id = m.tenant_id
      where m.tenant_id = ${ctx.tenantId} and m.customer_id = ${customerId} order by m.created_at desc limit 20`.execute(this.db)).rows;
    const dealIds = [...new Set(claims.map((x: any) => x.deal_id).filter(Boolean).map(String))];
    const offers = dealIds.length ? (await sql<any>`select dr.id, dr.deal_id, dr.status, dr.redeemed_at, dr.created_at, dr.ticket_id, d.title from deal_redemptions dr join deals d on d.id = dr.deal_id and d.tenant_id = dr.tenant_id
      where dr.tenant_id = ${ctx.tenantId} and dr.customer_id = ${customerId} and dr.deal_id = any(${dealIds}::uuid[]) order by dr.created_at desc limit 20`.execute(this.db)).rows : [];
    return { ...base,
      birthday: { monthDay: m ? `${String(m.month).padStart(2, '0')}-${String(m.day).padStart(2, '0')}` : null, status: m ? 'recorded' : 'not_recorded',
        yearKnown: m ? c.birthday_year_known !== false : null, source: c.birthday_source ?? null, updatedAt: iso(c.birthday_updated_at),
        nextOccurrence: m ? nextOccurrence(m, b.today, b.policy) : null, recordVersion: N(c.record_version) },
      birthdayMessages: claims.map((x: any) => ({ occasionYear: N(x.occasion_year), channel: String(x.channel), status: String(x.status), at: iso(x.updated_at ?? x.created_at),
        campaignId: x.campaign_id ? String(x.campaign_id) : null, campaignName: x.campaign_name ?? null })),
      birthdayOffers: offers.map((x: any) => ({ redemptionId: String(x.id), dealId: String(x.deal_id), title: String(x.title ?? ''), status: String(x.status), redeemedAt: iso(x.redeemed_at), ticketId: x.ticket_id ? String(x.ticket_id) : null })),
      // a true empty state, never a fabricated greeting (guide §09)
      noHistory: claims.length === 0 };
  }

  // ── role-gated birthday edit (guide §10) ───────────────────────────────────────────────────────────────────────
  async updateBirthday(ctx: RetentionContext, customerId: string, b: { birthday?: unknown; expectedVersion?: unknown }, audit: (trx: Kysely<any>, meta: Record<string, unknown>) => Promise<void>) {
    if (!isUuid(customerId)) throw new BirthdayError('Customer not found.', 'CUSTOMER_NOT_FOUND', 404);
    const base = await this.base(ctx);
    let value: { date: string; yearKnown: boolean } | null = null;
    if (b.birthday !== null && !(typeof b.birthday === 'string' && b.birthday.trim() === '')) {
      const p = parseBirthdayInput(b.birthday, base.today);
      if (!p.ok) throw new BirthdayError(p.reason, 'BIRTHDAY_INVALID');
      value = { date: p.value.date, yearKnown: p.value.yearKnown };
    }
    const expected = Math.trunc(N(b.expectedVersion));
    const actor = isUuid(ctx.userId) ? ctx.userId : null;
    return this.db.transaction().execute(async (trx) => {
      const cur = (await sql<any>`select c.id, to_char(c.birthday, 'YYYY-MM-DD') as birthday, c.birthday_year_known, c.record_version from customers c where c.tenant_id = ${ctx.tenantId} and ${this.branchW(ctx)} and c.id = ${customerId} for update`.execute(trx)).rows[0];
      if (!cur) throw new BirthdayError('Customer not found.', 'CUSTOMER_NOT_FOUND', 404);
      if (N(cur.record_version) !== expected) throw new BirthdayError('This customer was changed by someone else. Reload and try again.', 'VERSION_CONFLICT', 409, { currentVersion: N(cur.record_version) });
      await sql`update customers set birthday = ${value?.date ?? null}::date, birthday_year_known = ${value ? value.yearKnown : true}, birthday_source = ${value ? 'staff' : null},
          birthday_updated_at = now(), birthday_updated_by = ${actor}, record_version = record_version + 1, updated_at = now()
        where tenant_id = ${ctx.tenantId} and id = ${customerId}`.execute(trx);
      // the audit names what changed, never the date itself (a birthday is personal data)
      await audit(trx, { hadBirthday: cur.birthday != null, hasBirthday: !!value, yearKnown: value?.yearKnown ?? null });
      const m = value ? monthDayOf(value.date) : null;
      return { customerId, monthDay: m ? `${String(m.month).padStart(2, '0')}-${String(m.day).padStart(2, '0')}` : null, yearKnown: value?.yearKnown ?? null,
        source: value ? 'staff' : null, recordVersion: N(cur.record_version) + 1 };
    });
  }

  // ── birthday message history (guide §04 H) ─────────────────────────────────────────────────────────────────────
  async history(ctx: RetentionContext, f: { q?: unknown; page?: unknown; pageSize?: unknown; year?: unknown }) {
    const pageSize = [10, 20, 50].includes(Math.trunc(N(f.pageSize))) ? Math.trunc(N(f.pageSize)) : 20;
    const page = Math.max(1, Math.trunc(N(f.page)) || 1);
    const conds = [sql`m.tenant_id = ${ctx.tenantId}`, this.branchW(ctx)];   // another branch's customers never appear (Nov 3 audit)
    const y = Math.trunc(N(f.year)); if (y >= 2000 && y <= 2200) conds.push(sql`m.occasion_year = ${y}`);
    const q = str(f.q, 100); if (q) conds.push(sql`(c.full_name ilike ${'%' + q + '%'} or cp.name ilike ${'%' + q + '%'})`);
    const where = sql.join(conds, sql` and `);
    const total = N((await sql<any>`select count(*)::int as n from birthday_message_claims m left join customers c on c.id = m.customer_id and c.tenant_id = m.tenant_id left join campaigns cp on cp.id = m.campaign_id and cp.tenant_id = m.tenant_id where ${where}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<any>`select m.id, m.customer_id, c.full_name, m.occasion_year, m.channel, m.status, m.created_at, m.updated_at, cp.id as campaign_id, cp.name as campaign_name
      from birthday_message_claims m left join customers c on c.id = m.customer_id and c.tenant_id = m.tenant_id left join campaigns cp on cp.id = m.campaign_id and cp.tenant_id = m.tenant_id
      where ${where} order by m.created_at desc, m.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return { page, pageSize, totalItems: total, totalPages: Math.max(1, Math.ceil(total / pageSize)),
      items: rows.map((x: any) => ({ id: String(x.id), customerId: String(x.customer_id), customerName: x.full_name ?? '—', occasionYear: N(x.occasion_year), channel: String(x.channel),
        status: String(x.status), claimedAt: iso(x.created_at), updatedAt: iso(x.updated_at), campaignId: x.campaign_id ? String(x.campaign_id) : null, campaignName: x.campaign_name ?? null })) };
  }

  // ── Smart Birthday Campaign Assistant (recommendation 2) — suggestions + an UNSENT draft ─────────────────────────────
  private async offerCheck(ctx: RetentionContext, dealId: unknown, to: string) {
    if (dealId == null || dealId === '') return null;
    if (!isUuid(dealId)) throw new BirthdayError('Offer not found.', 'BIRTHDAY_OFFER_INVALID', 404);
    const d = (await sql<any>`select id, title, status, kind, starts_at, ends_at from deals where tenant_id = ${ctx.tenantId} and id = ${dealId}`.execute(this.db)).rows[0];
    if (!d) throw new BirthdayError('Offer not found.', 'BIRTHDAY_OFFER_INVALID', 404);
    const problems: string[] = [];
    if (!['active', 'scheduled'].includes(String(d.status))) problems.push(`The offer is ${String(d.status)}, not active or scheduled.`);
    if (d.ends_at && iso(d.ends_at)!.slice(0, 10) < to) problems.push('The offer ends before the last birthday in this range.');
    return { dealId: String(d.id), title: String(d.title ?? ''), status: String(d.status), endsAt: iso(d.ends_at), usable: problems.length === 0, problems };
  }
  private async templateCheck(ctx: RetentionContext, templateId: unknown, channel: 'sms' | 'email') {
    if (templateId == null || templateId === '') return null;
    if (!isUuid(templateId)) throw new BirthdayError('Template not found.', 'BIRTHDAY_TEMPLATE_INVALID', 404);
    const t = (await sql<any>`select t.id, t.name, t.channel, t.category, t.status, v.body, v.subject from message_templates t
      left join message_template_versions v on v.template_id = t.id and v.version = t.current_version where t.tenant_id = ${ctx.tenantId} and t.id = ${templateId}`.execute(this.db)).rows[0];
    if (!t) throw new BirthdayError('Template not found.', 'BIRTHDAY_TEMPLATE_INVALID', 404);
    const problems: string[] = [];
    if (t.status !== 'published') problems.push('Only a published template can be used.');
    if (t.channel !== channel) problems.push(`This is a ${String(t.channel).toUpperCase()} template; the campaign is ${channel.toUpperCase()}.`);
    if (!['birthday', 'promotions', 'general'].includes(String(t.category))) problems.push('Choose a Birthday, Promotions or General template.');
    // Campaign Center sends ONE approved text per campaign and fills only {salon_name} / {offer}: a per-customer token would go out literally
    const bad = [...new Set(parseTokens(`${t.subject ?? ''} ${t.body ?? ''}`).map((x) => x.token).filter((x) => !(BD_ALLOWED_TOKENS as readonly string[]).includes(x)))];
    if (bad.length) problems.push(`Campaign Center can't fill ${bad.map((x) => `{${x}}`).join(', ')} for each customer — remove it or use a template without it.`);
    return { templateId: String(t.id), name: String(t.name), body: t.body ?? '', subject: t.subject ?? null, usable: problems.length === 0, problems };
  }
  private async audience(ctx: RetentionContext, from: string, to: string, policy: Feb29Policy, channel: 'sms' | 'email', year: number) {
    const ids = (await sql<any>`select c.id from customers c where c.tenant_id = ${ctx.tenantId} and ${this.branchW(ctx)} and c.archived_at is null and c.status <> 'archived' and c.birthday is not null
      and ${this.mdExpr()} = any(${this.mdKeysIn(from, to, policy)}::int[]) order by c.id limit ${BD_MAX_AUDIENCE + 1}`.execute(this.db)).rows.map((x: any) => String(x.id));
    if (ids.length > BD_MAX_AUDIENCE) throw new BirthdayError(`More than ${BD_MAX_AUDIENCE} birthdays fall in this range — choose a shorter range.`, 'BIRTHDAY_AUDIENCE_TOO_LARGE');
    // already sent (or sending) a birthday message this occasion year on this channel → excluded before the draft is built
    const already = ids.length ? new Set((await sql<any>`select customer_id from birthday_message_claims where tenant_id = ${ctx.tenantId} and customer_id = any(${ids}::uuid[])
      and channel = ${channel} and status in ('claimed', 'sent') and occasion_year in (${year}, ${year + 1})`.execute(this.db)).rows.map((x: any) => String(x.customer_id))) : new Set<string>();
    const rest = ids.filter((id) => !already.has(id));
    const v = rest.length ? await this.seg.verdicts(ctx, rest, channel, 'general') : new Map();
    const reasons: Record<string, number> = {}; let eligible = 0;
    for (const x of v.values()) { if (x.status === 'eligible') eligible++; else reasons[x.status] = (reasons[x.status] || 0) + 1; }
    if (already.size) reasons.birthday_already_sent_this_year = already.size;
    return { ids: rest, selected: ids.length, eligible, excluded: ids.length - eligible, excludedReasons: reasons };
  }
  async plan(ctx: RetentionContext, b: { objective?: unknown; channel?: unknown; preset?: unknown; from?: unknown; to?: unknown; month?: unknown; dealId?: unknown; templateId?: unknown }) {
    const objective = pick(BD_OBJECTIVES, b.objective);
    if (!objective) throw new BirthdayError('Choose Birthday Greeting, Service Promotion or Loyalty Reward.', 'BIRTHDAY_OBJECTIVE_INVALID');
    const channel = b.channel === 'email' ? 'email' : b.channel === 'sms' || b.channel == null ? 'sms' : null;
    if (!channel) throw new BirthdayError('Choose SMS or Email.', 'BIRTHDAY_CHANNEL_INVALID');
    const base = await this.base(ctx);
    const r = this.range(base, b);
    const aud = await this.audience(ctx, r.from, r.to, base.policy, channel, base.year);
    const offer = await this.offerCheck(ctx, b.dealId, r.to);
    if (objective !== 'greeting' && !offer) throw new BirthdayError('Choose an existing offer for a promotion or reward birthday campaign.', 'BIRTHDAY_OFFER_REQUIRED');
    const template = await this.templateCheck(ctx, b.templateId, channel);
    const templates = (await sql<any>`select t.id, t.name, t.category from message_templates t where t.tenant_id = ${ctx.tenantId} and t.status = 'published' and t.channel = ${channel}
      and t.category in ('birthday', 'promotions', 'general') order by (t.category = 'birthday') desc, lower(t.name) limit 20`.execute(this.db)).rows;
    const suggestion = template?.usable ? template.body
      : objective === 'greeting' ? 'Happy birthday from all of us at {salon_name}! We hope your day is wonderful.'
      : 'Happy birthday from {salon_name}! Celebrate with {offer} — we would love to see you.';
    return {
      objective, channel, range: r, timezone: base.tz, feb29Policy: base.policy,
      audience: { selected: aud.selected, eligible: aud.eligible, excluded: aud.excluded, excludedReasons: aud.excludedReasons },
      offer, template, templates: templates.map((t: any) => ({ templateId: String(t.id), name: String(t.name), category: String(t.category) })),
      // labelled: a suggestion is never a fact and never sends anything
      suggestions: { message: suggestion, messageIsSuggestion: !template?.usable, schedule: { date: r.from < base.today ? base.today : r.from, note: 'Suggested: the first day of the range, in the salon\'s time zone.' } },
      variables: BD_ALLOWED_TOKENS.map((t) => `{${t}}`),
      safety: 'Nothing is sent, issued or charged. Saving creates an unsent draft in Campaign Center; it needs approval there.',
    };
  }
  async save(ctx: RetentionContext, b: { objective?: unknown; channel?: unknown; preset?: unknown; from?: unknown; to?: unknown; month?: unknown; dealId?: unknown; templateId?: unknown;
      name?: unknown; message?: unknown; emailSubject?: unknown; idempotencyKey?: unknown },
    audit: (trx: Kysely<any>, meta: Record<string, unknown>) => Promise<void>) {
    const key = String(b.idempotencyKey ?? '');
    if (key.length < 8 || key.length > 120) throw new BirthdayError('An idempotency key is required.', 'IDEMPOTENCY_KEY_REQUIRED');
    const p = await this.plan(ctx, b);
    if (p.offer && !p.offer.usable) throw new BirthdayError(p.offer.problems[0] ?? 'That offer cannot be used.', 'BIRTHDAY_OFFER_INVALID', 409);
    if (p.template && !p.template.usable) throw new BirthdayError(p.template.problems[0] ?? 'That template cannot be used.', 'BIRTHDAY_TEMPLATE_INVALID', 409);
    const message = str(b.message, 1600) ?? p.suggestions.message;
    const bad = [...new Set(parseTokens(message).map((x) => x.token).filter((x) => !(BD_ALLOWED_TOKENS as readonly string[]).includes(x)))];
    if (bad.length) throw new BirthdayError(`Campaign Center can't fill ${bad.map((x) => `{${x}}`).join(', ')} for each customer.`, 'BIRTHDAY_TEMPLATE_INVALID');
    if (!p.audience.eligible) throw new BirthdayError('No eligible customers have a birthday in this range.', 'BIRTHDAY_AUDIENCE_EMPTY', 409);
    const base = await this.base(ctx);
    const channel = p.channel as 'sms' | 'email';   // plan() refuses anything else
    const aud = await this.audience(ctx, p.range.from, p.range.to, base.policy, channel, base.year);
    const draft = await this.seg.createDraft(ctx, { channel, purpose: 'birthday', selectionMode: 'selected', customerIds: aud.ids, filters: { segment: 'all' },
      message, idempotencyKey: `birthday:${key}` }, (trx, meta) => audit(trx, { ...meta, objective: p.objective, range: p.range, assistant: true, ruleset: BIRTHDAY_RULESET }));
    // a retried save returns the campaign already made for this draft — never a second campaign
    if (draft.campaignId) return { draftId: draft.draftId, campaignId: draft.campaignId, duplicate: true, selected: draft.selected, eligible: draft.eligible, excluded: draft.excluded };
    const name = str(b.name, 120) ?? `Birthdays ${p.range.from} – ${p.range.to}`;
    const c = await this.cc.createDraft(ctx, { name, channel: p.channel, goal: `Birthday: ${p.objective}`, description: `Birthdays ${p.range.from} to ${p.range.to} (${base.tz})`,
      offer: p.offer?.title ?? null, dealId: p.offer?.dealId ?? null, messageBody: message, emailSubject: p.channel === 'email' ? (str(b.emailSubject, 200) ?? 'Happy birthday from {salon_name}') : null, origin: 'assistant' });
    const set = await this.cc.setAudience(ctx, c.id, { draftId: draft.draftId });
    return { draftId: draft.draftId, campaignId: c.id, duplicate: false, selected: set.selected, eligible: set.eligible, excluded: set.excluded, sent: 0 };
  }
}

/** the occurrence a customer's birthday lands on in a year — exported for the overlay / tests */
export const birthdayOccurrence = (birthday: unknown, year: number, policy: Feb29Policy) => { const m = monthDayOf(birthday); return m ? occurrence(m, year, policy) : null; };
export { storedDateString };
