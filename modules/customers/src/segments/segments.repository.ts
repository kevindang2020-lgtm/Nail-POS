// segments.repository.ts — Marketing & Growth → Customer Segments (/tenant/marketing/segments). Customer Segments Complete
// Build Guide (30 Oct 2026). Raw, parameterised SQL; the session's tenant is written into every statement.
//
// ONE source of visit facts: the per-customer CTE of the Customer Retention module (RetentionRepository.base), so Segments and
// Retention cannot drift (guide §12 "segment definitions must be consistent"). Ruleset `segments-v1` (guide §05):
//   qualifying visit  a settled ticket (status closed / paid), not removed; ONE ticket = ONE visit however many services;
//                     cancelled / no-show appointments never become tickets → never visits; open / void tickets are not visits
//   Never Visited     0 qualifying visits (its own segment; never part of New, Inactive or win-back)
//   New               EXACTLY 1 qualifying visit
//   Returning         2 or more qualifying visits (New and Returning are mutually exclusive)
//   VIP               the salon's authorized VIP flag: a loyalty profile marked VIP (vip_since set, or a tier named VIP) by
//                     staff with the loyalty permission. No spend / visit threshold is configured, so none is invented.
//                     VIP may overlap New / Returning; the loyalty TIER ("Regular", "Gold" …) is not a marketing segment.
//   Inactive          ≥ 1 qualifying visit AND salon-local days since the last ≥ the salon's At Risk threshold
//                     (tenant_retention_settings, versioned) — exactly Retention's At Risk
//   Last Visit        the latest coalesce(paid_at, created_at) of a qualifying visit (UTC instant; shown in salon time)
//   Lifetime Spend    settled ticket totals (as recorded on the ticket) minus completed refunds of those tickets, never < 0
// Counts of overlapping tags (VIP ∩ Returning) are never added together as distinct customers.
import { sql, type Kysely } from 'kysely';
import { canMoveToSql } from '@aipowersalon/database';
import { SEGMENT_AUDIENCE_DRAFT } from '../customer-lifecycles';
import { RetentionRepository, RetentionError, maskPhone, isUuid, smsSegments, type RetentionContext, type Win } from '../retention/retention.repository';
import { VISIT_TICKET_STATUSES } from '../customers/customer-segments';
import { RetentionSnapshotRepository } from '../retention/retention-snapshots';

export const SEGMENT_RULESET = 'segments-v1';
export const SEGMENTS = ['all', 'new', 'returning', 'vip', 'never', 'inactive'] as const;
export type SegmentKey = (typeof SEGMENTS)[number];
export const SEGMENT_SORTS = ['created_desc', 'recent_visit', 'visits', 'spend', 'name_asc', 'name_desc'] as const;
export type SegmentSort = (typeof SEGMENT_SORTS)[number];
export const SEGMENT_BASES = ['none', 'created', 'first_visit', 'last_visit', 'visit_in_range'] as const;
export const PAGE_SIZES = [10, 20, 50] as const;
export const MAX_AUDIENCE = 5000;
export const DRAFT_TTL_HOURS = 24;
const VISIT = [...VISIT_TICKET_STATUSES] as string[];
const N = (v: unknown) => Number(v ?? 0) || 0;
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const pick = <T extends string>(list: readonly T[], v: unknown): T | undefined => ((list as readonly string[]).includes(String(v)) ? (v as T) : undefined);
const int = (v: unknown): number | null => { if (v === undefined || v === null || v === '') return null; const n = Math.trunc(Number(v)); return Number.isFinite(n) && n >= 0 ? n : null; };
export const maskEmail = (e: string | null | undefined): string | null => {
  const s = String(e ?? '').trim(); const at = s.indexOf('@'); if (at < 1) return null;
  return `${s[0]}•••${s.slice(at)}`;
};

export class SegmentsError extends Error {
  constructor(message: string, readonly code: 'SEGMENT_INVALID' | 'SEGMENT_INVALID_FILTER' | 'CUSTOMER_NOT_FOUND' | 'AUDIENCE_EMPTY' | 'AUDIENCE_TOO_LARGE' | 'AUDIENCE_DRAFT_NOT_FOUND'
    | 'AUDIENCE_DRAFT_EXPIRED' | 'AUDIENCE_DRAFT_CLOSED' | 'CAMPAIGN_NOT_FOUND' | 'BRANCH_NOT_AUTHORIZED', readonly status: 400 | 403 | 404 | 409 = 400, readonly details?: Record<string, unknown>) { super(message); this.name = 'SegmentsError'; }
}

export interface SegmentFilters {
  segment?: unknown; q?: unknown; sort?: unknown; page?: unknown; pageSize?: unknown; branch?: unknown;
  preset?: unknown; from?: unknown; to?: unknown; basis?: unknown;
  minVisits?: unknown; maxVisits?: unknown; minSpend?: unknown; maxSpend?: unknown; tier?: unknown; service?: unknown; sms?: unknown; email?: unknown;
}
export interface SegmentRow {
  customerId: string; customerName: string; avatarUrl: string | null; maskedPhone: string | null; maskedEmail: string | null;
  visits: number; visitClass: 'never_visited' | 'new' | 'returning'; isVip: boolean; inactive: boolean; loyaltyTier: string;
  firstVisitAt: string | null; lastVisitAt: string | null; daysAway: number | null; lifetimeSpendCents: number; createdAt: string | null;
  smsStatus: string; emailStatus: string; segments: string[];
}

export class SegmentsRepository {
  readonly ret: RetentionRepository;
  constructor(readonly db: Kysely<any>, ret?: RetentionRepository) { this.ret = ret ?? new RetentionRepository(db); }

  private seg(v: unknown): SegmentKey {
    if (v === undefined || v === null || v === '') return 'all';
    const s = pick(SEGMENTS, v); if (!s) throw new SegmentsError('Unknown segment.', 'SEGMENT_INVALID'); return s;
  }
  private async win(ctx: RetentionContext, f: SegmentFilters): Promise<Win> {
    try { return await this.ret.window(ctx, { preset: f.preset, from: f.from, to: f.to, branch: f.branch }); }
    catch (e) { if (e instanceof RetentionError) throw new SegmentsError(e.message, e.code === 'BRANCH_NOT_AUTHORIZED' ? 'BRANCH_NOT_AUTHORIZED' : 'SEGMENT_INVALID_FILTER', e.status === 403 ? 403 : 400, { cause: e.code }); throw e; }
  }

  /** Retention's per-customer CTE + the segment facts (VIP flag, tier, visit class, inactivity, e-mail consent) as `s` */
  cte(ctx: RetentionContext, k: Win) {
    const T = ctx.tenantId;
    return sql`${this.ret.base(ctx, k)},
      s as (
        select b.*, coalesce(lp.loyalty_tier, 'Regular') as loyalty_tier, lp.vip_since,
               (lp.vip_since is not null or coalesce(lp.loyalty_tier, '') ~* 'vip') as is_vip,
               case when b.visits = 0 then 'never_visited' when b.visits = 1 then 'new' else 'returning' end as visit_class,
               (b.visits > 0 and b.days_away >= ${k.risk}) as inactive,
               case when b.sms_status = 'upcoming_booking' then 'eligible' else b.sms_status end as sms_marketing
        from b
        left join lateral (select p.loyalty_tier, p.vip_since from customer_loyalty_profiles p where p.tenant_id = ${T} and p.customer_id = b.id order by p.created_at limit 1) lp on true)`;
  }
  private segWhere(seg: SegmentKey) {
    switch (seg) {
      case 'new': return sql`b.visit_class = 'new'`;
      case 'returning': return sql`b.visit_class = 'returning'`;
      case 'never': return sql`b.visit_class = 'never_visited'`;
      case 'vip': return sql`b.is_vip`;
      case 'inactive': return sql`b.inactive`;
      default: return sql`true`;
    }
  }
  private filters(ctx: RetentionContext, f: SegmentFilters, seg: SegmentKey, k: Win) {
    const T = ctx.tenantId;
    const raw = String(f.q ?? '').trim().slice(0, 100);
    const parts = [this.segWhere(seg)];
    // guide §07: name · phone · e-mail · customer id (+ Retention's ticket / appointment id and service) over the whole salon
    // the shared Retention search already covers e-mail (with % and _ escaped — they used to act as wildcards here, so "%" matched everyone)
    if (raw) parts.push(raw.includes('@') ? sql`coalesce(b.email, '') ilike ${'%' + raw.replace(/[\\%_]/g, (m) => '\\' + m) + '%'}` : this.ret.search(ctx, raw));
    const basis = pick(SEGMENT_BASES, f.basis) ?? 'none';
    const inP = (col: ReturnType<typeof sql>) => sql`(${col} >= ${k.start} and ${col} < ${k.end})`;
    if (basis === 'created') parts.push(inP(sql`b.created_at`));
    else if (basis === 'first_visit') parts.push(inP(sql`b.first_visit`));
    else if (basis === 'last_visit') parts.push(inP(sql`b.last_visit`));
    else if (basis === 'visit_in_range') parts.push(sql`b.visited_in`);
    const minV = int(f.minVisits), maxV = int(f.maxVisits), minS = int(f.minSpend), maxS = int(f.maxSpend);
    if (minV != null && maxV != null && minV > maxV) throw new SegmentsError('Minimum visits must not exceed maximum visits.', 'SEGMENT_INVALID_FILTER');
    if (minS != null && maxS != null && minS > maxS) throw new SegmentsError('Minimum spend must not exceed maximum spend.', 'SEGMENT_INVALID_FILTER');
    if (minV != null) parts.push(sql`b.visits >= ${minV}`);
    if (maxV != null) parts.push(sql`b.visits <= ${maxV}`);
    if (minS != null) parts.push(sql`b.spend >= ${minS}`);
    if (maxS != null) parts.push(sql`b.spend <= ${maxS}`);
    const tier = typeof f.tier === 'string' ? f.tier.trim().slice(0, 40) : '';
    if (tier) parts.push(sql`lower(b.loyalty_tier) = lower(${tier})`);
    const service = typeof f.service === 'string' ? f.service.trim().slice(0, 60) : '';
    if (service) parts.push(sql`exists (select 1 from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id
      where l.tenant_id = ${T} and t.customer_id = b.id and l.removed_at is null and t.removed_at is null and t.status = any(${VISIT}::text[])
        and ${k.scope.branchIds ? sql`t.branch_id = any(${k.scope.branchIds}::uuid[])` : sql`true`} and l.service_name_snapshot ilike ${'%' + service + '%'})`);
    if (f.sms === 'eligible') parts.push(sql`b.sms_marketing = 'eligible'`); else if (f.sms === 'not_eligible') parts.push(sql`b.sms_marketing <> 'eligible'`);
    if (f.email === 'eligible') parts.push(sql`b.email_status = 'eligible'`); else if (f.email === 'not_eligible') parts.push(sql`b.email_status <> 'eligible'`);
    // a branch filter limits the ACTIVITY counted (Retention CR-02); customers who never visited that branch are not "of" it
    if (k.scope.selected && seg !== 'never') parts.push(sql`b.visits > 0`);
    return { where: sql.join(parts, sql` and `), applied: { basis, minVisits: minV, maxVisits: maxV, minSpendCents: minS, maxSpendCents: maxS, tier: tier || null, service: service || null,
      sms: f.sms === 'eligible' || f.sms === 'not_eligible' ? f.sms : null, email: f.email === 'eligible' || f.email === 'not_eligible' ? f.email : null, hasSearch: !!raw } };
  }
  private order(sort?: SegmentSort) {
    switch (sort ?? 'created_desc') {
      case 'recent_visit': return { sql: sql`b.last_visit desc nulls last, b.id desc`, label: 'recent_visit' };
      case 'visits': return { sql: sql`b.visits desc, b.created_at desc, b.id desc`, label: 'visits' };
      case 'spend': return { sql: sql`b.spend desc, b.created_at desc, b.id desc`, label: 'spend' };
      case 'name_asc': return { sql: sql`lower(b.full_name) asc, b.id asc`, label: 'name_asc' };
      case 'name_desc': return { sql: sql`lower(b.full_name) desc, b.id desc`, label: 'name_desc' };
      default: return { sql: sql`b.created_at desc nulls last, b.id desc`, label: 'created_desc' };   // guide §09: newest account first
    }
  }
  private row(r: any): SegmentRow {
    const tags = [String(r.visit_class)]; if (r.is_vip) tags.push('vip'); if (r.inactive) tags.push('inactive');
    return { customerId: String(r.id), customerName: String(r.full_name || ''), avatarUrl: r.avatar_url ?? null, maskedPhone: maskPhone(r.normalized_phone), maskedEmail: maskEmail(r.email),
      visits: N(r.visits), visitClass: String(r.visit_class) as SegmentRow['visitClass'], isVip: !!r.is_vip, inactive: !!r.inactive, loyaltyTier: String(r.loyalty_tier || 'Regular'),
      firstVisitAt: iso(r.first_visit), lastVisitAt: iso(r.last_visit), daysAway: r.days_away == null ? null : N(r.days_away), lifetimeSpendCents: N(r.spend), createdAt: iso(r.created_at),
      smsStatus: String(r.sms_marketing), emailStatus: String(r.email_status), segments: tags };
  }
  private meta(k: Win) {
    return { ruleset: SEGMENT_RULESET, settingsVersion: k.settingsVersion, timeZone: k.tz, today: k.today, inactiveDays: k.risk, evaluatedAt: new Date().toISOString(),
      period: this.ret.periodOut(k), scope: this.ret.scopeOut(k) };
  }

  /** guide §14 Summary counts: verified segment counts, the unique-customer total, overlaps, evaluation time, data health */
  async summary(ctx: RetentionContext, f: SegmentFilters = {}) {
    const k = await this.win(ctx, f);
    const r = (await sql<any>`${this.cte(ctx, k)}
      select count(*)::int as total, count(*) filter (where b.visit_class = 'new')::int as new, count(*) filter (where b.visit_class = 'returning')::int as returning,
             count(*) filter (where b.visit_class = 'never_visited')::int as never, count(*) filter (where b.is_vip)::int as vip, count(*) filter (where b.inactive)::int as inactive,
             count(*) filter (where b.is_vip and b.visit_class = 'returning')::int as vip_returning, count(*) filter (where b.is_vip and b.visit_class = 'new')::int as vip_new,
             count(*) filter (where b.is_vip and b.visit_class = 'never_visited')::int as vip_never, count(*) filter (where b.inactive and b.is_vip)::int as vip_inactive
      from s b`.execute(this.db)).rows[0] || {};
    const health = await this.health(ctx, k);
    return { ...this.meta(k),
      counts: { all: N(r.total), new: N(r.new), returning: N(r.returning), never: N(r.never), vip: N(r.vip), inactive: N(r.inactive) },
      overlaps: { vipReturning: N(r.vip_returning), vipNew: N(r.vip_new), vipNever: N(r.vip_never), vipInactive: N(r.vip_inactive),
        note: 'VIP and Inactive overlap the visit classes; Never Visited + New + Returning = all customers.' },
      vipRule: { configured: true, kind: 'authorized_flag', text: 'VIP = a loyalty profile marked VIP by authorized staff (VIP flag or a tier named VIP). No automatic spend or visit threshold is configured.' },
      health };
  }
  /** guide §14 Health: freshness, visit reconciliation, rule facts, the snapshot job */
  private async health(ctx: RetentionContext, k: Win) {
    const T = ctx.tenantId;
    const h = (await sql<any>`select
        (select count(*)::int from tickets t where t.tenant_id = ${T} and t.customer_id is not null and t.removed_at is null and t.status = any(${VISIT}::text[])
           and (t.branch_id is null or not exists (select 1 from branches br where br.tenant_id = ${T} and br.id = t.branch_id))) as unknown_branch_visits,
        (select count(*)::int from tickets t where t.tenant_id = ${T} and t.customer_id is null and t.removed_at is null and t.status = any(${VISIT}::text[])) as walk_in_visits,
        (select count(*)::int from (select c.normalized_phone from customers c where c.tenant_id = ${T} and c.status <> 'archived' and coalesce(c.normalized_phone, '') <> ''
           group by c.normalized_phone having count(*) > 1) x) as shared_phone_groups,
        (select max(coalesce(t.paid_at, t.updated_at, t.created_at)) from tickets t where t.tenant_id = ${T} and t.status = any(${VISIT}::text[])) as last_visit_recorded`.execute(this.db)).rows[0] || {};
    const run = (await sql<any>`select to_char(r.snapshot_local_date, 'YYYY-MM-DD') as d, r.status, r.coverage, r.finished_at, r.last_error from customer_retention_snapshot_runs r
      where r.tenant_id = ${T} order by r.snapshot_local_date desc, r.created_at desc limit 1`.execute(this.db)).rows[0];
    return { unknownBranchVisits: N(h.unknown_branch_visits), walkInVisitsWithoutCustomer: N(h.walk_in_visits), sharedPhoneGroups: N(h.shared_phone_groups),
      lastVisitRecordedAt: iso(h.last_visit_recorded),
      lastSnapshot: run ? { date: String(run.d), status: String(run.status), coverage: run.coverage ?? null, finishedAt: iso(run.finished_at), lastError: run.last_error ? String(run.last_error).slice(0, 200) : null } : null,
      liveRefresh: 'customers_and_checkout_realtime' };
  }

  /** guide §14 List segment members: server-side search / filters / date basis / sort / numbered pages + the exact count */
  async members(ctx: RetentionContext, f: SegmentFilters) {
    const seg = this.seg(f.segment);
    const sort = pick(SEGMENT_SORTS, f.sort);
    if (f.sort !== undefined && f.sort !== '' && !sort) throw new SegmentsError('Unknown sort.', 'SEGMENT_INVALID_FILTER');
    const ps = Math.trunc(Number(f.pageSize)) || 10;
    const pageSize = (PAGE_SIZES as readonly number[]).includes(ps) ? ps : 10;
    const page = Math.max(1, Math.trunc(Number(f.page)) || 1);
    const k = await this.win(ctx, f);
    const { where, applied } = this.filters(ctx, f, seg, k);
    const ord = this.order(sort);
    const pageOf = async (pg: number) => (await sql<any>`${this.cte(ctx, k)} select b.*, count(*) over ()::int as total_n from s b where ${where}
      order by ${ord.sql} limit ${pageSize} offset ${(pg - 1) * pageSize}`.execute(this.db)).rows;
    let p = page; let rows = await pageOf(p); let total = N(rows[0]?.total_n);
    if (!rows.length) {
      total = N((await sql<any>`${this.cte(ctx, k)} select count(*)::int as n from s b where ${where}`.execute(this.db)).rows[0]?.n);
      const last = Math.max(1, Math.ceil(total / pageSize));
      if (p > last && total > 0) { p = last; rows = await pageOf(p); } else p = Math.min(p, last);
    }
    return { ...this.meta(k), segment: seg, sort: ord.label, filters: applied, items: rows.map((x: any) => this.row(x)), page: p, pageSize, totalItems: total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  /** guide §10 A — Why This Segment? The segment facts, the effective ruleset, thresholds and the evidence (settled tickets). */
  async qualification(ctx: RetentionContext, customerId: string) {
    if (!isUuid(customerId)) throw new SegmentsError('Customer not found.', 'CUSTOMER_NOT_FOUND', 404);
    const k = await this.win(ctx, {});
    const r = (await sql<any>`${this.cte(ctx, k)} select b.* from s b where b.id = ${customerId}`.execute(this.db)).rows[0];
    if (!r) throw new SegmentsError('Customer not found.', 'CUSTOMER_NOT_FOUND', 404);
    const row = this.row(r);
    const refunded = N((await sql<any>`select coalesce(sum(pr.amount_cents), 0)::bigint as n from payment_refunds pr join payments p on p.id = pr.payment_id and p.tenant_id = pr.tenant_id
      join tickets t on t.id = p.ticket_id and t.tenant_id = p.tenant_id where pr.tenant_id = ${ctx.tenantId} and pr.status = 'refunded' and t.customer_id = ${customerId}
      and t.removed_at is null and t.status = any(${VISIT}::text[])`.execute(this.db)).rows[0]?.n);
    const v = row.visits; const d = row.daysAway;
    const reasons = [
      { segment: 'never', met: v === 0, rule: '0 qualifying visits', text: v === 0 ? 'No settled visit on record.' : `${v} settled visit(s) on record.` },
      { segment: 'new', met: v === 1, rule: 'exactly 1 qualifying visit', text: `${v} settled visit(s).` },
      { segment: 'returning', met: v >= 2, rule: '2 or more qualifying visits', text: `${v} settled visit(s).` },
      { segment: 'inactive', met: row.inactive, rule: `at least 1 visit and ${k.risk}+ salon days since the last`, text: v === 0 ? 'Never visited — not Inactive.' : `${d ?? 0} salon day(s) since the last settled visit (Inactive from ${k.risk}).` },
      { segment: 'vip', met: row.isVip, rule: 'VIP flag or a VIP tier set by authorized staff', text: row.isVip ? (r.vip_since ? `Marked VIP on ${iso(r.vip_since)!.slice(0, 10)} (tier ${row.loyaltyTier}).` : `Loyalty tier ${row.loyaltyTier}.`) : `Not marked VIP (loyalty tier ${row.loyaltyTier} — a loyalty tier, not a marketing segment).` },
    ];
    return { customerId, customerName: row.customerName, ruleset: SEGMENT_RULESET, settingsVersion: k.settingsVersion, timeZone: k.tz, evaluatedAt: new Date().toISOString(), asOf: k.today,
      visitClass: row.visitClass, segments: row.segments, isVip: row.isVip, loyaltyTier: row.loyaltyTier, vipSince: iso(r.vip_since),
      facts: { qualifyingVisits: v, firstVisitAt: row.firstVisitAt, lastVisitAt: row.lastVisitAt, daysAway: d, lifetimeSpendCents: row.lifetimeSpendCents, refundedCents: refunded,
        spendDefinition: 'Settled ticket totals minus completed refunds (never below 0).' },
      thresholds: { newVisits: 1, returningMinVisits: 2, inactiveDays: k.risk },
      reasons };
  }

  /** guide §10 B — the overlay: qualification + Retention's visit evidence / bookings / outreach + loyalty, consent, appointments,
   *  spending / refunds and this salon's marketing history. Masked contact details only. */
  async overlay(ctx: RetentionContext, customerId: string) {
    const q = await this.qualification(ctx, customerId);
    const T = ctx.tenantId;
    const snap = await this.ret.customerSnapshot(ctx, customerId);
    const c = (await sql<any>`select c.normalized_phone, c.email, c.created_at, c.marketing_sms_opt_in, c.marketing_email_opt_in, c.preferred_language, c.updated_at from customers c where c.tenant_id = ${T} and c.id = ${customerId}`.execute(this.db)).rows[0] || {};
    const lp = (await sql<any>`select p.points_balance, p.loyalty_tier from customer_loyalty_profiles p where p.tenant_id = ${T} and p.customer_id = ${customerId} order by p.created_at limit 1`.execute(this.db)).rows[0];
    const optSms = c.normalized_phone ? !!(await sql<any>`select 1 from notification_opt_outs o where o.tenant_id = ${T} and o.channel = 'sms'
      and regexp_replace(o.address, '[^0-9]', '', 'g') = regexp_replace(${String(c.normalized_phone)}, '[^0-9]', '', 'g') limit 1`.execute(this.db)).rows[0] : false;
    const optEmail = c.email ? !!(await sql<any>`select 1 from notification_opt_outs o where o.tenant_id = ${T} and o.channel = 'email' and lower(o.address) = lower(${String(c.email)}) limit 1`.execute(this.db)).rows[0] : false;
    const appts = (await sql<any>`select a.id, to_char(a.appt_date, 'YYYY-MM-DD') as appt_date, a.start_time, a.status from pos_tech_appointments a
      where a.tenant_id = ${T} and a.customer_id = ${customerId} order by a.appt_date desc, a.start_time desc limit 12`.execute(this.db)).rows;
    const refunds = (await sql<any>`select pr.id, pr.amount_cents, pr.status, pr.created_at, t.ticket_number from payment_refunds pr join payments p on p.id = pr.payment_id and p.tenant_id = pr.tenant_id
      join tickets t on t.id = p.ticket_id and t.tenant_id = p.tenant_id where pr.tenant_id = ${T} and t.customer_id = ${customerId} order by pr.created_at desc limit 10`.execute(this.db)).rows;
    const drafts = (await sql<any>`select d.id, d.channel, d.segment, d.status, d.created_at, m.eligibility from segment_audience_members m join segment_audience_drafts d on d.id = m.draft_id and d.tenant_id = m.tenant_id
      where m.tenant_id = ${T} and m.customer_id = ${customerId} order by d.created_at desc limit 10`.execute(this.db)).rows;
    return { ...q,
      contact: { maskedPhone: maskPhone(c.normalized_phone), maskedEmail: maskEmail(c.email), preferredLanguage: c.preferred_language ?? null, customerSince: iso(c.created_at) },
      preferences: { smsMarketingConsent: !!c.marketing_sms_opt_in, emailMarketingConsent: !!c.marketing_email_opt_in, smsOptedOut: optSms, emailOptedOut: optEmail, consentUpdatedAt: iso(c.updated_at) },
      loyalty: { tier: String(lp?.loyalty_tier ?? 'Regular'), pointsBalance: N(lp?.points_balance) },
      visits: snap?.visitEvidence ?? [], upcomingBookings: snap?.upcomingBookings ?? [],
      appointments: appts.map((a: any) => ({ appointmentId: String(a.id), date: a.appt_date ?? null, startTime: a.start_time == null ? null : String(a.start_time), status: String(a.status) })),
      refunds: refunds.map((x: any) => ({ refundId: String(x.id), amountCents: N(x.amount_cents), status: String(x.status), at: iso(x.created_at), ticketNumber: x.ticket_number == null ? null : String(x.ticket_number) })),
      marketingHistory: { retentionOutreach: snap?.outreach ?? [],
        audienceDrafts: drafts.map((x: any) => ({ draftId: String(x.id), channel: String(x.channel), segment: String(x.segment), status: String(x.status), eligibility: String(x.eligibility), at: iso(x.created_at) })) } };
  }

  /** guide §11 — the stored snapshot of a past salon day, read from the Retention daily snapshot rows (never recomputed) */
  async snapshotDay(ctx: RetentionContext, date: unknown) {
    const d = await new RetentionSnapshotRepository(this.db).day(ctx, date);
    if (d.state !== 'available' || !d.run) return { ...d, ruleset: SEGMENT_RULESET, counts: null };
    const c = (await sql<any>`select count(*)::int as total, count(*) filter (where s.visit_count = 0)::int as never, count(*) filter (where s.visit_count = 1)::int as new,
        count(*) filter (where s.visit_count >= 2)::int as returning, count(*) filter (where s.segment = 'at_risk')::int as inactive,
        count(*) filter (where s.is_vip)::int as vip, count(*) filter (where s.is_vip is null)::int as vip_unrecorded
      from customer_retention_daily_snapshots s where s.tenant_id = ${ctx.tenantId} and s.snapshot_local_date = ${d.date}::date and s.definition_version = ${d.run.definitionVersion}`.execute(this.db)).rows[0] || {};
    const vipUnrecorded = N(c.vip_unrecorded);
    return { ...d, ruleset: SEGMENT_RULESET,
      counts: { all: N(c.total), never: N(c.never), new: N(c.new), returning: N(c.returning), inactive: N(c.inactive), vip: vipUnrecorded > 0 && vipUnrecorded === N(c.total) ? null : N(c.vip) },
      vipUnrecorded };
  }

  // ── guide §10 C — Smart Marketing Audience Builder (draft only — nothing here sends) ───────────────────────────────────
  /** per-customer verdicts for a channel; a shared destination is kept once (dedup, identities never merged) */
  async verdicts(ctx: RetentionContext, ids: string[], channel: 'sms' | 'email', purpose: 'general' | 'win_back', db: Kysely<any> = this.db) {
    const valid = [...new Set(ids.filter(isUuid))];
    const out = new Map<string, { status: string; destination: string | null; masked: string | null }>();
    for (const id of ids) out.set(id, { status: 'not_found', destination: null, masked: null });
    if (!valid.length) return out;
    const k = await this.win(ctx, {});
    const rows = (await sql<any>`${this.cte(ctx, k)} select b.id, b.normalized_phone, b.email, b.visits, b.sms_marketing, b.sms_status, b.email_status from s b where b.id = any(${valid}::uuid[])
      order by b.created_at asc, b.id asc`.execute(db)).rows;
    const seen = new Set<string>();
    for (const r of rows) {
      let status = channel === 'sms' ? (purpose === 'win_back' ? String(r.sms_status) : String(r.sms_marketing)) : String(r.email_status);
      if (purpose === 'win_back' && N(r.visits) === 0) status = 'never_visited';
      const dest = channel === 'sms' ? (r.normalized_phone ?? null) : (r.email ? String(r.email).toLowerCase() : null);
      if (status === 'eligible' && dest) { if (seen.has(dest)) status = 'duplicate_destination'; else seen.add(dest); }
      out.set(String(r.id), { status, destination: dest, masked: channel === 'sms' ? maskPhone(r.normalized_phone) : maskEmail(r.email) });
    }
    return out;
  }
  async matchingIds(ctx: RetentionContext, f: SegmentFilters): Promise<string[]> {
    const seg = this.seg(f.segment);
    const k = await this.win(ctx, f);
    const { where } = this.filters(ctx, f, seg, k);
    const rows = (await sql<any>`${this.cte(ctx, k)} select b.id from s b where ${where} order by ${this.order(pick(SEGMENT_SORTS, f.sort)).sql} limit ${MAX_AUDIENCE + 1}`.execute(this.db)).rows;
    if (rows.length > MAX_AUDIENCE) throw new SegmentsError(`Choose at most ${MAX_AUDIENCE} customers per audience.`, 'AUDIENCE_TOO_LARGE');
    return rows.map((x: any) => String(x.id));
  }
  async priceCents(): Promise<number | null> {
    const r = (await sql<any>`select value from platform_settings where setting_key = 'sms.marketing_segment_price_cents' limit 1`.execute(this.db).catch(() => ({ rows: [] as { value: unknown }[] }))).rows[0];
    const n = Number(typeof r?.value === 'string' ? r.value : r?.value); return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  }

  /** create an UNSENT audience draft (idempotent per key). The audit row is written in the same transaction (fail-closed). */
  async createDraft(ctx: RetentionContext, b: { channel: 'sms' | 'email'; purpose: 'general' | 'win_back' | 'birthday'; selectionMode: 'page' | 'selected' | 'all_matching'; customerIds: string[] | null;
    filters: SegmentFilters; message: string | null; idempotencyKey: string }, audit: (trx: Kysely<any>, meta: Record<string, unknown>) => Promise<void>) {
    const T = ctx.tenantId;
    const prior = (await sql<any>`select id from segment_audience_drafts where tenant_id = ${T} and idempotency_key = ${b.idempotencyKey}`.execute(this.db)).rows[0];
    if (prior) return { ...(await this.draft(ctx, String(prior.id))), duplicate: true };
    const seg = this.seg(b.filters.segment);
    let ids: string[];
    if (b.selectionMode === 'all_matching') ids = await this.matchingIds(ctx, b.filters);
    else ids = [...new Set((b.customerIds ?? []).filter(isUuid))];
    if (ids.length > MAX_AUDIENCE) throw new SegmentsError(`Choose at most ${MAX_AUDIENCE} customers per audience.`, 'AUDIENCE_TOO_LARGE');
    if (!ids.length) throw new SegmentsError('Select at least one customer.', 'AUDIENCE_EMPTY');
    // 'birthday' (Birthday Campaign Assistant) is ordinary marketing consent; Campaign Center reads the purpose to enforce one birthday message a year
    const v = await this.verdicts(ctx, ids, b.channel, b.purpose === 'win_back' ? 'win_back' : 'general');
    const counts: Record<string, number> = {}; let eligible = 0;
    for (const x of v.values()) { if (x.status === 'eligible') eligible++; else counts[x.status] = (counts[x.status] || 0) + 1; }
    const message = b.message ? b.message.slice(0, 1000) : null;
    const price = b.channel === 'sms' && message ? await this.priceCents() : null;
    const est = price == null || !message ? null : eligible * smsSegments(message).segments * price;
    const id = await this.db.transaction().execute(async (trx) => {
      const ins = (await sql<any>`insert into segment_audience_drafts (tenant_id, branch_id, channel, status, ruleset_version, segment, selection_mode, filters_json, selected_count, eligible_count,
          excluded_count, excluded_reasons_json, message_preview, estimated_cost_cents, idempotency_key, created_by_user_id, updated_by, expires_at)
        values (${T}, ${isUuid(ctx.branchId) ? ctx.branchId : null}, ${b.channel}, 'draft', ${SEGMENT_RULESET}, ${seg}, ${b.selectionMode}, ${JSON.stringify({ ...b.filters, purpose: b.purpose })}::jsonb,
          ${ids.length}, ${eligible}, ${ids.length - eligible}, ${JSON.stringify(counts)}::jsonb, ${message}, ${est}, ${b.idempotencyKey}, ${isUuid(ctx.userId) ? ctx.userId : null},
          ${isUuid(ctx.userId) ? ctx.userId : null}, now() + make_interval(hours => ${DRAFT_TTL_HOURS}))
        on conflict (tenant_id, idempotency_key) do nothing returning id`.execute(trx)).rows[0];
      if (!ins) return null;
      const did = String(ins.id); const all = [...v.entries()];
      for (let i = 0; i < all.length; i += 500) {
        const sl = all.slice(i, i + 500);
        await sql`insert into segment_audience_members (draft_id, tenant_id, customer_id, eligibility, destination_masked)
          select ${did}::uuid, ${T}::uuid, x.cid::uuid, x.elig, nullif(x.dest, '') from unnest(${sl.map(([c]) => c)}::text[], ${sl.map(([, x]) => x.status)}::text[], ${sl.map(([, x]) => x.masked ?? '')}::text[]) as x(cid, elig, dest)
          where x.cid ~ '^[0-9a-fA-F-]{36}$' on conflict do nothing`.execute(trx);
      }
      await audit(trx, { draftId: did, channel: b.channel, purpose: b.purpose, segment: seg, selectionMode: b.selectionMode, selected: ids.length, eligible, excluded: ids.length - eligible });
      return did;
    });
    const did = id ?? String((await sql<any>`select id from segment_audience_drafts where tenant_id = ${T} and idempotency_key = ${b.idempotencyKey}`.execute(this.db)).rows[0].id);
    return { ...(await this.draft(ctx, did)), duplicate: !id };
  }
  async draft(ctx: RetentionContext, id: string) {
    if (!isUuid(id)) throw new SegmentsError('Audience draft not found.', 'AUDIENCE_DRAFT_NOT_FOUND', 404);
    const T = ctx.tenantId;
    // an elapsed draft is closed on read (draft → expired), never silently reused
    await sql`update segment_audience_drafts set status = 'expired', updated_at = now() where tenant_id = ${T} and id = ${id} and status = 'draft' and expires_at <= now()
      and ${canMoveToSql(SEGMENT_AUDIENCE_DRAFT, 'expired')}`.execute(this.db);
    const d = (await sql<any>`select id, status, channel, segment, selection_mode, ruleset_version, filters_json, selected_count, eligible_count, excluded_count, excluded_reasons_json, message_preview, estimated_cost_cents, campaign_id, created_at, expires_at from segment_audience_drafts where tenant_id = ${T} and id = ${id}`.execute(this.db)).rows[0];
    if (!d) throw new SegmentsError('Audience draft not found.', 'AUDIENCE_DRAFT_NOT_FOUND', 404);
    const members = (await sql<any>`select m.customer_id, m.eligibility, m.destination_masked, c.full_name from segment_audience_members m left join customers c on c.id = m.customer_id and c.tenant_id = m.tenant_id
      where m.tenant_id = ${T} and m.draft_id = ${id} order by (m.eligibility = 'eligible') desc, lower(c.full_name), m.customer_id limit 100`.execute(this.db)).rows;
    const j = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v ?? {});
    return { draftId: String(d.id), status: String(d.status), channel: String(d.channel), segment: String(d.segment), selectionMode: String(d.selection_mode), ruleset: String(d.ruleset_version),
      filters: j(d.filters_json), selected: N(d.selected_count), eligible: N(d.eligible_count), excluded: N(d.excluded_count), excludedReasons: j(d.excluded_reasons_json),
      messagePreview: d.message_preview ?? null, estimatedCostCents: d.estimated_cost_cents == null ? null : N(d.estimated_cost_cents), campaignId: d.campaign_id ? String(d.campaign_id) : null,
      createdAt: iso(d.created_at), expiresAt: iso(d.expires_at), sends: 0,
      members: members.map((m: any) => ({ customerId: String(m.customer_id), customerName: String(m.full_name || ''), eligibility: String(m.eligibility), maskedDestination: m.destination_masked ?? null })) };
  }
  /** consent / opt-out / contact re-checked NOW (guide §10 C "at launch time, not only preview time"); the stored audience is not rewritten */
  async recheck(ctx: RetentionContext, id: string) {
    const d = await this.draft(ctx, id);
    if (d.status === 'expired') throw new SegmentsError('This audience draft expired.', 'AUDIENCE_DRAFT_EXPIRED', 409);
    if (d.status !== 'draft') throw new SegmentsError('This audience draft is closed.', 'AUDIENCE_DRAFT_CLOSED', 409);
    const ids = (await sql<any>`select customer_id from segment_audience_members where tenant_id = ${ctx.tenantId} and draft_id = ${id}`.execute(this.db)).rows.map((r: any) => String(r.customer_id));
    const before = new Map((await sql<any>`select customer_id, eligibility from segment_audience_members where tenant_id = ${ctx.tenantId} and draft_id = ${id}`.execute(this.db)).rows.map((r: any) => [String(r.customer_id), String(r.eligibility)]));
    const purpose = (d.filters as { purpose?: unknown } | null)?.purpose === 'win_back' ? 'win_back' : 'general';
    const now = await this.verdicts(ctx, ids, d.channel as 'sms' | 'email', purpose);
    const changed: { customerId: string; from: string; to: string }[] = []; let eligibleNow = 0;
    for (const [cid, x] of now) { if (x.status === 'eligible') eligibleNow++; const b = before.get(cid); if (b && b !== x.status) changed.push({ customerId: cid, from: b, to: x.status }); }
    return { draftId: id, checkedAt: new Date().toISOString(), eligibleAtCreation: d.eligible, eligibleNow, changed: changed.slice(0, 200), changedCount: changed.length };
  }
  /** the audit row is written in the SAME transaction as the change (it used to be written after, so a failed audit left an unaudited change) */
  async discard(ctx: RetentionContext, id: string, audit?: (trx: Kysely<any>) => Promise<unknown>) {
    const d = await this.draft(ctx, id);
    if (d.status !== 'draft') throw new SegmentsError('This audience draft is closed.', 'AUDIENCE_DRAFT_CLOSED', 409);
    await this.db.transaction().execute(async (trx) => {
      const r = (await sql<any>`update segment_audience_drafts set status = 'discarded', updated_by = ${isUuid(ctx.userId) ? ctx.userId : null}, updated_at = now()
        where tenant_id = ${ctx.tenantId} and id = ${id} and ${canMoveToSql(SEGMENT_AUDIENCE_DRAFT, 'discarded')} returning id`.execute(trx)).rows[0];
      if (!r) throw new SegmentsError('This audience draft is closed.', 'AUDIENCE_DRAFT_CLOSED', 409);
      if (audit) await audit(trx);
    });
    return this.draft(ctx, id);
  }
  /** record the Campaign Center draft this audience was handed to (the campaign must be this salon's and still a draft) */
  async linkCampaign(ctx: RetentionContext, id: string, campaignId: string, audit?: (trx: Kysely<any>) => Promise<unknown>) {
    const d = await this.draft(ctx, id);
    if (d.status === 'expired') throw new SegmentsError('This audience draft expired.', 'AUDIENCE_DRAFT_EXPIRED', 409);
    if (d.status !== 'draft') throw new SegmentsError('This audience draft is closed.', 'AUDIENCE_DRAFT_CLOSED', 409);
    if (!isUuid(campaignId)) throw new SegmentsError('Campaign not found.', 'CAMPAIGN_NOT_FOUND', 404);
    const c = (await sql<any>`select id, status from campaigns where tenant_id = ${ctx.tenantId} and id = ${campaignId}`.execute(this.db)).rows[0];
    if (!c) throw new SegmentsError('Campaign not found.', 'CAMPAIGN_NOT_FOUND', 404);
    if (String(c.status) !== 'draft') throw new SegmentsError('Only a draft campaign can take this audience.', 'AUDIENCE_DRAFT_CLOSED', 409);
    await this.db.transaction().execute(async (trx) => {
      const r = (await sql<any>`update segment_audience_drafts set campaign_id = ${campaignId}, updated_by = ${isUuid(ctx.userId) ? ctx.userId : null}, updated_at = now()
        where tenant_id = ${ctx.tenantId} and id = ${id} and status = 'draft' returning id`.execute(trx)).rows[0];
      if (!r) throw new SegmentsError('This audience draft is closed.', 'AUDIENCE_DRAFT_CLOSED', 409);
      if (audit) await audit(trx);
    });
    return this.draft(ctx, id);
  }
}
