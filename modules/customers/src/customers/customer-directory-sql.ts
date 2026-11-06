// customer-directory-sql.ts — F1 Customer Directory §58 / §62 (Nov 5 2026): the directory state computed IN POSTGRES.
//
// The repository used to read every customer in scope (plus every ticket aggregate, loyalty row and refund) into memory and
// filter, count, sort and page there — linear in the salon's size (~3–4 s projected at 100,000 customers). Here one CTE
// (`base`) gives each customer its derived columns (visits, last visit, net spend, tier, VIP, tags, duplicate keys) and
// every consumer is a SQL statement over it:
//   • the page of rows                    — WHERE <filters> ORDER BY created_at, id LIMIT / OFFSET
//   • total + the six tab counts + KPIs   — one statement of count(*) FILTER (…)
//   • tags tally, tiers, analytics, recent — small grouped / top-N statements
// The rules are the in-memory ones, line for line (customer-directory-sql.pgtest proves the two agree on every filter):
//   visits = tickets 'closed' / 'paid'; spend = their totals net of completed refunds; days since = floor(Δ / 1 day);
//   Never = 0 visits, New = 1, Returning ≥ 2, At Risk = ≥ 1 visit and ≥ riskDays idle; Archived out unless asked for;
//   search = vi_fold(…) LIKE (the SQL twin of foldVi) on name / first / last / preferred / phone / email / tags, or the
//   number's digits; duplicate risk = same phone or e-mail among live profiles → high, same first + last name → possible.
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { RETURNING_MIN_VISITS, INACTIVE_DAYS } from './customer-segments';
import type { CustomerFilters, CustomersAnalytics } from './customers.dto';

export interface DirectoryScope { tenantId: string; branchId?: string | null }
export interface DirectoryOpts { riskDays: number; timeZone: string; nowMs: number }
const DAY = 86_400_000;
const SEGMENTS = ['never', 'new', 'returning', 'vip', 'at_risk'] as const;

/** `col = branch OR col IS NULL` when a location is selected (the repository's scoped() rule) */
const inScope = (s: DirectoryScope, col: string) => (s.branchId ? sql`and (${sql.ref(col)} = ${s.branchId} or ${sql.ref(col)} is null)` : sql``);

/** Every customer in scope with its derived columns. `now` is a bound parameter so every statement agrees on "today". */
function base(s: DirectoryScope, nowIso: string, searching = false): RawBuilder<unknown> {
  return sql`
    with t as (
      select customer_id, count(*)::int as cnt, coalesce(sum(total_cents), 0)::bigint as spend, max(created_at) as last
        from tickets where tenant_id = ${s.tenantId} ${inScope(s, 'branch_id')} and customer_id is not null and status in ('closed', 'paid') group by customer_id),
    r as (
      select tk.customer_id, coalesce(sum(pr.amount_cents), 0)::bigint as refunded
        from payment_refunds pr join payments p on p.id = pr.payment_id join tickets tk on tk.id = p.ticket_id
       where pr.tenant_id = ${s.tenantId} and pr.status = 'refunded' and tk.tenant_id = ${s.tenantId} ${inScope(s, 'tk.branch_id')}
         and tk.customer_id is not null and tk.status in ('closed', 'paid') group by tk.customer_id),
    l as (
      select distinct on (customer_id) customer_id, loyalty_tier, points_balance, vip_since
        from customer_loyalty_profiles where tenant_id = ${s.tenantId} ${inScope(s, 'branch_id')} order by customer_id),
    tg as (select customer_id, array_agg(tag order by tag) as tags from customer_tags where tenant_id = ${s.tenantId} group by customer_id),
    c0 as (
      select cu.id, cu.first_name, cu.last_name, cu.preferred_name, cu.phone_display, cu.normalized_phone, cu.email, cu.status, cu.avatar_url,
             cu.birthday, cu.birthday_year_known, cu.marketing_sms_opt_in, cu.marketing_email_opt_in, cu.notes, cu.created_at, cu.updated_at,
             cu.record_version, cu.preferred_language, cu.preferred_branch_id,
             coalesce(t.cnt, 0) as visits, t.last as last_visit,
             greatest(0, coalesce(t.spend, 0) - coalesce(r.refunded, 0))::bigint as spend,
             coalesce(l.points_balance, 0) as points, coalesce(nullif(l.loyalty_tier, ''), 'Regular') as tier,
             (l.vip_since is not null or coalesce(nullif(l.loyalty_tier, ''), 'Regular') ~* 'vip') as is_vip,
             coalesce(tg.tags, '{}'::text[]) as tags,
             (coalesce(cu.marketing_sms_opt_in, false) or coalesce(cu.marketing_email_opt_in, false)) as mkt,
             case when t.last is null then null else floor(extract(epoch from (${nowIso}::timestamptz - t.last)) / 86400)::int end as idle_days,
             floor(extract(epoch from (${nowIso}::timestamptz - cu.created_at)) / 86400)::int as age_days,
             coalesce(nullif(cu.phone_display, ''), nullif(cu.normalized_phone, ''), '') as phone,
             lower(regexp_replace(coalesce(nullif(cu.phone_display, ''), nullif(cu.normalized_phone, ''), ''), '\\s', '', 'g')) as pkey,
             lower(regexp_replace(coalesce(cu.email, ''), '\\s', '', 'g')) as ekey,
             lower(regexp_replace(coalesce(cu.first_name, ''), '\\s', '', 'g')) || '|' || lower(regexp_replace(coalesce(cu.last_name, ''), '\\s', '', 'g')) as nkey
             ${searching ? sql`,
             -- F1 §79 (Nov 6 2026): the searchable text is folded once, when the row is written (customers.search_fold /
             -- search_digits, migration 822 trigger). Folding it per search cost ~6 s at 100,000 customers; folding it per
             -- column and per tab count cost 65–85 s. Only the tags (customer_tags, few rows) are folded here.
             coalesce(cu.search_fold, customer_search_fold(cu.first_name, cu.last_name, cu.preferred_name, cu.phone_display, cu.normalized_phone, cu.email)) as fold_text,
             case when tg.tags is null then null else vi_fold(array_to_string(tg.tags, chr(1))) end as tag_fold,
             coalesce(cu.search_digits, customer_search_digits(cu.phone_display, cu.normalized_phone)) as phone_digits` : sql``}
        from customers cu
        left join t on t.customer_id = cu.id left join r on r.customer_id = cu.id left join l on l.customer_id = cu.id left join tg on tg.customer_id = cu.id
       where cu.tenant_id = ${s.tenantId} ${inScope(s, 'cu.branch_id')}),
    base as materialized (
      select c0.*,
        case when c0.status = 'archived' then 'none'
             when (c0.pkey <> '' and count(*) over (partition by c0.status = 'archived', c0.pkey) > 1)
               or (c0.ekey <> '' and count(*) over (partition by c0.status = 'archived', c0.ekey) > 1) then 'high'
             when count(*) over (partition by c0.status = 'archived', c0.nkey) > 1 then 'possible' else 'none' end as dup_risk
        from c0)`;
}

const escLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
/** The list filters as SQL over `base` (aliased b), WITHOUT the segment (the tab) — that is added per use. */
function filterSql(f: CustomerFilters, o: DirectoryOpts): RawBuilder<unknown>[] {
  const w: RawBuilder<unknown>[] = [];
  const q = String(f.search ?? '').trim();
  if (q) {
    const digits = q.replace(/\D/g, ''); const byPhone = digits.length >= 3 && /^[\d\s()+.\-]+$/.test(q);
    const pat = `%${escLike(q)}%`;
    const text = sql`(b.fold_text like vi_fold(${pat}) or b.tag_fold like vi_fold(${pat}))`;   // stored fold (822) + the tags
    w.push(byPhone ? sql`(${text} or b.phone_digits like ${'%' + digits + '%'})` : text);
  }
  w.push(f.status ? sql`b.status = ${f.status}` : sql`b.status <> 'archived'`);
  if (f.loyaltyTier) w.push(sql`b.tier = ${f.loyaltyTier}`);
  if (f.source && f.source !== 'manual') w.push(sql`false`);   // every profile's source is 'manual' today
  if (f.tag) w.push(sql`${f.tag} = any(b.tags)`);
  if (f.birthdayMonth) w.push(sql`extract(month from b.birthday)::int = ${Number(f.birthdayMonth)}`);
  if (f.marketingOptIn) { const want = ['true', 'yes', '1'].includes(f.marketingOptIn); w.push(sql`b.mkt = ${want}`); }
  if (f.duplicateRisk) w.push(sql`b.dup_risk = ${f.duplicateRisk}`);
  if (f.inactiveDays != null && f.inactiveDays !== ('' as unknown)) w.push(sql`(b.idle_days is null or b.idle_days >= ${Number(f.inactiveDays)})`);
  void o;
  return w;
}
function segmentSql(seg: string | undefined, o: DirectoryOpts): RawBuilder<unknown> {
  switch (seg) {
    case 'never': return sql`b.visits = 0`;
    case 'new': return sql`b.visits = 1`;
    case 'returning': return sql`b.visits >= ${RETURNING_MIN_VISITS}`;
    case 'vip': return sql`b.is_vip`;
    case 'at_risk': return sql`(b.visits >= 1 and b.idle_days >= ${o.riskDays})`;
    default: return sql`true`;
  }
}
const and = (parts: RawBuilder<unknown>[]) => (parts.length ? sql.join(parts, sql` and `) : sql`true`);

export interface DirectoryRow {
  id: string; first_name: string | null; last_name: string | null; preferred_name: string | null; phone_display: string | null; normalized_phone: string | null;
  email: string | null; status: string; avatar_url: string | null; birthday: unknown; birthday_year_known: boolean | null; marketing_sms_opt_in: boolean | null;
  marketing_email_opt_in: boolean | null; notes: string | null; created_at: unknown; updated_at: unknown; record_version: number | null; preferred_language: string | null;
  preferred_branch_id: string | null; visits: number; last_visit: unknown; spend: string | number; points: number; tier: string; is_vip: boolean; tags: string[]; dup_risk: string;
}

export interface DirectoryCounts {
  totalItems: number; segmentCounts: Record<'all' | (typeof SEGMENTS)[number], number>;
  live: number; archived: number; vip: number; returning: number; inactive: number; loyaltyMembers: number; duplicates: number; spendSum: number;
  newToday: number; returningToday: number; birthdaysThisMonth: number; newThisMonth: number; returningThisMonth: number; atRisk: number; newThis30: number; newPrior30: number;
}

/** Every directory statement aggregates the whole scope, so a hash plan is the right one at any size. Right after a bulk
 *  import (before autovacuum has analyzed the new rows) the planner's estimates can be ~1,000× low and it picks nested
 *  loops over the per-customer aggregates — measured 11.5 s at 10,000 customers vs 0.56 s with hash joins. The statement
 *  runs in a transaction with nested loops disabled for that transaction only. */
export async function withDirectoryPlan<T>(db: Kysely<any>, fn: (trx: Kysely<any>) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (trx) => { await sql`set local enable_nestloop = off`.execute(trx); return fn(trx); });
}

export interface DirectoryState {
  rows: DirectoryRow[]; counts: DirectoryCounts;
  roll: { tags: { name: string; count: number }[]; tiers: string[]; analytics: CustomersAnalytics };
  recent: { visits: DirectoryRow[]; added: DirectoryRow[] };
}

/** ONE statement: `base` is computed once (MATERIALIZED) and every part of the directory is a sub-select over it — the page,
 *  the total, the six tab counts, the KPIs, the tags tally, the tiers, the analytics groups and the two recent lists. */
export async function directoryState(db: Kysely<any>, s: DirectoryScope, f: CustomerFilters, o: DirectoryOpts, page: number, pageSize: number): Promise<DirectoryState> {
  const nowIso = new Date(o.nowMs).toISOString();
  const where = filterSql(f, o);
  const seg = segmentSql(f.segment, o);
  const month = new Date(o.nowMs).getUTCMonth() + 1;   // the in-memory rule used the process clock (UTC) for "this month's birthdays"
  const year = new Date(o.nowMs).getFullYear();
  const curMonth = sql`to_char(${nowIso}::timestamptz at time zone ${o.timeZone}, 'YYYY-MM')`;
  const live = sql`b.status <> 'archived'`;
  type Out = { page: unknown; counts: unknown; tags: unknown; tiers: unknown; groups: unknown; recent_visits: unknown; recent_added: unknown };
  const r = (await sql<Out>`${base(s, nowIso, !!String(f.search ?? '').trim())},
    cut as (select (select spend from base where status <> 'archived' and visits > 0 order by spend desc
              offset greatest(0, ceil((select count(*) from base where status <> 'archived' and visits > 0) * 0.2)::int - 1) limit 1) as v),
    pg as (select b.* from base b where ${and([...where, seg])} order by b.created_at, b.id limit ${pageSize} offset ${(page - 1) * pageSize}),
    cnt as (select
      count(*) filter (where ${and([...where, seg])})::int as total_items,
      count(*) filter (where ${and(where)})::int as seg_all,
      ${sql.join(SEGMENTS.map((g) => sql`count(*) filter (where ${and([...where, segmentSql(g, o)])})::int as ${sql.ref('seg_' + g)}`), sql`, `)},
      count(*) filter (where ${live})::int as live,
      count(*) filter (where b.status = 'archived')::int as archived,
      count(*) filter (where ${live} and b.is_vip)::int as vip,
      count(*) filter (where ${live} and b.visits >= ${RETURNING_MIN_VISITS})::int as returning,
      count(*) filter (where ${live} and (b.idle_days is null or b.idle_days >= ${INACTIVE_DAYS}))::int as inactive,
      count(*) filter (where ${live} and (b.points > 0 or b.tier <> 'Regular'))::int as loyalty_members,
      count(*) filter (where ${live} and b.dup_risk <> 'none')::int as duplicates,
      coalesce(sum(b.spend) filter (where ${live}), 0)::bigint as spend_sum,
      count(*) filter (where ${live} and b.age_days = 0)::int as new_today,
      count(*) filter (where ${live} and b.visits >= ${RETURNING_MIN_VISITS} and b.idle_days = 0)::int as returning_today,
      count(*) filter (where ${live} and extract(month from b.birthday)::int = ${month})::int as birthdays_month,
      count(*) filter (where ${live} and to_char(b.created_at at time zone ${o.timeZone}, 'YYYY-MM') = ${curMonth})::int as new_month,
      count(*) filter (where ${live} and b.visits >= ${RETURNING_MIN_VISITS} and to_char(b.last_visit at time zone ${o.timeZone}, 'YYYY-MM') = ${curMonth})::int as returning_month,
      count(*) filter (where ${live} and b.visits >= 1 and b.idle_days >= ${o.riskDays})::int as at_risk,
      count(*) filter (where ${live} and b.created_at >= ${new Date(o.nowMs - 30 * DAY).toISOString()}::timestamptz and b.created_at < ${nowIso}::timestamptz)::int as new_30,
      count(*) filter (where ${live} and b.created_at >= ${new Date(o.nowMs - 60 * DAY).toISOString()}::timestamptz and b.created_at < ${new Date(o.nowMs - 30 * DAY).toISOString()}::timestamptz)::int as new_prior_30
      from base b),
    tgs as (select btrim(x) as name, count(*)::int as count from base b, unnest(b.tags) x where ${live} and btrim(x) <> '' group by btrim(x) order by count(*) desc, btrim(x) limit 200),
    ti as (select distinct b.tier from base b where ${live}),
    grp as (select
      case when b.birthday is not null and coalesce(b.birthday_year_known, true) then ${year} - extract(year from b.birthday)::int end as age,
      least(b.visits, 8) as v,
      case when b.idle_days is null then 9 when b.idle_days <= 30 then 1 when b.idle_days <= 60 then 2 when b.idle_days <= 90 then 3 when b.idle_days <= 120 then 4 else 5 end as rb,
      (cut.v is not null and b.spend >= greatest(100, cut.v)) as top,
      count(*)::int as n, coalesce(sum(b.spend), 0)::bigint as spend
      from base b, cut where ${live} group by 1, 2, 3, 4),
    rv as (select b.* from base b where ${live} and b.last_visit is not null order by b.last_visit desc, b.id limit 8),
    ra as (select b.* from base b where ${live} and b.age_days <= 30 order by b.created_at desc, b.id limit 8)
    select
      (select coalesce(json_agg(pg order by pg.created_at, pg.id), '[]'::json) from pg) as page,
      (select row_to_json(cnt) from cnt) as counts,
      (select coalesce(json_agg(tgs order by tgs.count desc, tgs.name), '[]'::json) from tgs) as tags,
      (select coalesce(json_agg(ti.tier order by ti.tier), '[]'::json) from ti) as tiers,
      (select coalesce(json_agg(grp), '[]'::json) from grp) as groups,
      (select coalesce(json_agg(rv order by rv.last_visit desc, rv.id), '[]'::json) from rv) as recent_visits,
      (select coalesce(json_agg(ra order by ra.created_at desc, ra.id), '[]'::json) from ra) as recent_added`.execute(db)).rows[0] ?? ({} as Out);
  const js = <T,>(v: unknown, d: T): T => (typeof v === 'string' ? JSON.parse(v) : (v as T) ?? d);
  const c = js<Record<string, unknown>>(r.counts, {});
  const n = (k: string) => Number(c[k] ?? 0) || 0;
  const groups = js<{ age: unknown; v: unknown; rb: unknown; top: unknown; n: unknown; spend: unknown }[]>(r.groups, []).map((x) => ({ age: x.age == null ? null : Number(x.age), visits: Number(x.v), band: Number(x.rb), top: !!x.top, n: Number(x.n), spend: Number(x.spend) }));
  return {
    rows: js<DirectoryRow[]>(r.page, []),
    counts: {
      totalItems: n('total_items'),
      segmentCounts: { all: n('seg_all'), never: n('seg_never'), new: n('seg_new'), returning: n('seg_returning'), vip: n('seg_vip'), at_risk: n('seg_at_risk') },
      live: n('live'), archived: n('archived'), vip: n('vip'), returning: n('returning'), inactive: n('inactive'), loyaltyMembers: n('loyalty_members'),
      duplicates: n('duplicates'), spendSum: n('spend_sum'), newToday: n('new_today'), returningToday: n('returning_today'), birthdaysThisMonth: n('birthdays_month'),
      newThisMonth: n('new_month'), returningThisMonth: n('returning_month'), atRisk: n('at_risk'), newThis30: n('new_30'), newPrior30: n('new_prior_30'),
    },
    roll: { tags: js<{ name: unknown; count: unknown }[]>(r.tags, []).map((t) => ({ name: String(t.name), count: Number(t.count) })), tiers: js<unknown[]>(r.tiers, []).map(String), analytics: analyticsFromGroups(groups) },
    recent: { visits: js<DirectoryRow[]>(r.recent_visits, []), added: js<DirectoryRow[]>(r.recent_added, []) },
  };
}

/** buildCustomersAnalytics, over the grouped facts (same rules, same order — see customers.dto.ts). Exported for tests. */
export function analyticsFromGroups(groups: { age: number | null; visits: number; band: number; top: boolean; n: number; spend: number }[]): CustomersAnalytics {
  const total = groups.reduce((a, g) => a + g.n, 0);
  const buckets = [{ label: '18-25', lo: 18, hi: 25 }, { label: '26-35', lo: 26, hi: 35 }, { label: '36-45', lo: 36, hi: 45 }, { label: '46-55', lo: 46, hi: 55 }, { label: '55+', lo: 56, hi: 999 }];
  const ageGroups = buckets.map((b) => ({ label: b.label, count: groups.filter((g) => g.age != null && g.age >= b.lo && g.age <= b.hi).reduce((a, g) => a + g.n, 0) })).filter((x) => x.count > 0);
  const totalRevenueCents = groups.reduce((a, g) => a + g.spend, 0);
  const repeat = groups.filter((g) => g.visits >= RETURNING_MIN_VISITS).reduce((a, g) => a + g.n, 0);
  const lifetimeValue = { totalRevenueCents, totalCustomers: total, repeatRatePercent: total ? Math.round((repeat / total) * 100) : 0, avgClvCents: total ? Math.round(totalRevenueCents / total) : 0 };
  const seg = (g: (typeof groups)[number]): string => {
    if (g.visits === 0) return 'No Visits Yet';
    const recent = g.band === 1, mid = g.band <= 3, freq = g.visits;
    if (recent && (freq >= 8 || (freq >= 4 && g.top))) return 'Champions';
    if (freq >= 4 && mid) return 'Loyal Customers';
    if (freq <= 3 && recent) return 'Potential Loyalists';
    if (g.band === 3 || g.band === 4) { if (freq >= 4) return 'At Risk'; }
    if (g.band === 5 && (freq >= 6 || (freq >= 3 && g.top))) return 'Cannot Lose Them';
    return 'Hibernating';
  };
  const m: Record<string, number> = {};
  for (const g of groups) { const k = seg(g); m[k] = (m[k] || 0) + g.n; }
  const order = ['Champions', 'Loyal Customers', 'Potential Loyalists', 'At Risk', 'Cannot Lose Them', 'Hibernating', 'No Visits Yet'];
  return { ageGroups, lifetimeValue, rfm: order.map((x) => ({ segment: x, count: m[x] || 0 })).filter((x) => x.count > 0), retentionRatePercent: lifetimeValue.repeatRatePercent };
}

/** The live (non-archived) profiles among these ids — Recent Activity's bookings / loyalty events name only customers in scope. */
export async function liveCustomersByIds(db: Kysely<any>, s: DirectoryScope, ids: string[]): Promise<Map<string, { firstName: string; lastName: string; avatarUrl: string | null }>> {
  if (!ids.length) return new Map();
  const rows = (await sql<{ id: string; first_name: string | null; last_name: string | null; avatar_url: string | null }>`select id, first_name, last_name, avatar_url from customers where tenant_id = ${s.tenantId} ${inScope(s, 'branch_id')}
    and status <> 'archived' and id = any(${ids}::uuid[])`.execute(db)).rows;
  return new Map(rows.map((r) => [String(r.id), { firstName: r.first_name || '', lastName: r.last_name || '', avatarUrl: r.avatar_url || null }]));
}
