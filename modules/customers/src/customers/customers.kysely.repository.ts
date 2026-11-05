// customers.kysely.repository.ts — production CustomersRepositoryPort over Postgres (Kysely).
// Real, tenant/branch-scoped over customers, customer_loyalty_profiles, customer_preferences, plus history from
// tickets / appointments / receipts. Per-customer visits/spend are aggregated from tickets. Duplicate detection uses
// the same dto helper. Merge reassigns ticket/appointment/receipt-bearing history to the primary, then archives the rest.
// SCOPE is session-derived (tenant_id + branch_id), never the client.
//
// Schema notes (honest — migration 005 has no tables for these, so they are NOT faked):
//  - customer `source` has no column → defaults to 'manual'.
//  - `tags`, `membership`, and `gift cards` have no tables → get returns empty/none defaults; set is accepted but not stored.
//  - visit serviceName/technicianName and ticket paymentMethod are best-effort (single representative line / payment).
import { storedDateString, monthDayOf, toStorage } from '../birthdays/birthday-core';
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent } from '@aipowersalon/events';
import { sql, type Kysely } from 'kysely';
import { toStoredCustomerPhone, normalizePhone } from '../customer-activation-rules/customer-activation-core';
import type { DB } from '@aipowersalon/database';
import { VISIT_TICKET_STATUSES, RETURNING_MIN_VISITS, INACTIVE_DAYS } from './customer-segments';
import type { CustomersContext, CustomersRepositoryPort } from './customers.repository';
import {
  POSCustomersFullState, POSCustomerRow, POSCustomerDetail, buildCustomersAnalytics, CustomerFilters, CustomerListItem, CustomerListResponse,
  CustomerSource, DuplicateRisk, CustomerVisitRow, CustomerAppointmentRow, CustomerTicketRow, CustomerReceiptRow,
  CustomerNotes, CustomerLoyalty, CustomerMembership, CustomerGiftCard, DuplicateGroup, CreateCustomerRequest,
  EditCustomerRequest, CustomerKpis, POSCustomersKpisFull, Pagination, detectDuplicates, BulkCustomerInsert, BulkCustomerUpdate, CustomerVersionConflict } from './customers.dto';
import { clampPageSize, clampPage, foldVi } from '@aipowersalon/api-contracts';
import { projectionDeliversRealtime } from '@aipowersalon/config';
import { applyLoyaltyEntry, lockLoyaltyCustomer, LoyaltyLedgerError } from '../loyalty/loyalty-ledger.service';
import { mergeCustomersTx } from './customer-merge';

interface Cust {
  customerId: string; firstName: string; lastName: string; phone: string; normalizedPhone?: string | null; email: string; avatarUrl?: string | null; status: 'active' | 'inactive' | 'archived';
  source: CustomerSource; visitCount: number; lastVisitAt: string | null; totalSpendCents: number;
  loyaltyPoints: number; loyaltyTier: string; isVip: boolean; tags: string[]; birthdayMonth?: number; birthdayYear?: number; birthday?: string; birthdayMonthDay?: string;
  marketingOptIn: boolean; smsOptIn: boolean; emailOptIn: boolean; createdAt: string; updatedAt: string; notes: string; version?: number;
  preferredName?: string | null; preferredLanguage?: string | null; preferredBranchId?: string | null;   // Decision 1
}
const iso = (v: any) => (v instanceof Date ? v.toISOString() : v == null ? '' : String(v));
// pos_tech_appointments.services is a JSONB array whose element shape varies by booking source
// (booking writes {serviceName}, customer-booking writes {name}); read both keys.
const apptServiceName = (services: any): string => {
  const arr = Array.isArray(services) ? services : (typeof services === 'string' ? (() => { try { return JSON.parse(services); } catch { return []; } })() : []);
  const first = (arr && arr[0]) || {};
  return first.serviceName || first.name || '';
};
const defNotes = (salon = ''): CustomerNotes => ({ salonNotes: salon, allergyNotes: '', preferredStyle: '', preferredTechnician: '', servicePreferences: '', warnings: '', customerVisible: false });
const defLoyalty = (points: number, tier: string): CustomerLoyalty => ({ points, earned: points, redeemed: 0, tier, tierThresholdPoints: 500, birthdayReward: true, referralReward: true });
const defMembership = (): CustomerMembership => ({ plan: 'None', status: 'none', benefits: [], billingStatus: 'n/a' });

export class KyselyCustomersRepository implements CustomersRepositoryPort {
  // Constitution 8 §18: customer.created is written with the customer row. Optional and null-safe.
  constructor(private readonly db: Kysely<DB>, private readonly outbox: OutboxWriter | null = null) {}
  emitsDomainEvents(): boolean { return projectionDeliversRealtime(this.outbox != null); }   // not merely "has an outbox": the publisher must be ON
  private scoped(qb: any, ctx: CustomersContext, a?: string): any {
    const col = (n: string) => (a ? `${a}.${n}` : n);
    let q = qb.where(col('tenant_id'), '=', ctx.tenantId);
    if (ctx.branchId) q = q.where((eb: any) => eb.or([eb(col('branch_id'), '=', ctx.branchId), eb(col('branch_id'), 'is', null)]));
    return q;
  }
  private daysSince(i: string | null) { return i == null || i === '' ? Infinity : Math.floor((Date.now() - new Date(i).getTime()) / 86400000); }

  async isTenantBranch(ctx: CustomersContext, branchId: string): Promise<boolean> {   // Decision 1
    if (!/^[0-9a-f-]{36}$/i.test(branchId)) return false;
    return !!(await this.db.selectFrom('branches').select('id').where('tenant_id', '=', ctx.tenantId).where('id', '=', branchId).executeTakeFirst().catch(() => undefined));
  }
  private async load(ctx: CustomersContext): Promise<Cust[]> {
    const rows = await this.scoped(this.db.selectFrom('customers'), ctx)
      .select(['id', 'first_name', 'last_name', 'full_name', 'normalized_phone', 'phone_display', 'email', 'birthday', 'birthday_year_known', 'status', 'avatar_url',
        'marketing_sms_opt_in', 'marketing_email_opt_in', 'notes', 'created_at', 'updated_at', 'record_version', 'preferred_name', 'preferred_language', 'preferred_branch_id']).execute().catch(() => []);
    const ids = rows.map((r: any) => r.id);
    // F1 §58: whole-scope reads grouped by customer (a 10,000-id IN list cost more than the rows); rows for customers
    // outside the loaded set are simply not looked up
    const loy = ids.length ? await this.scoped(this.db.selectFrom('customer_loyalty_profiles'), ctx)
      .select(['customer_id', 'loyalty_tier', 'points_balance', 'total_earned_points', 'total_redeemed_points', 'vip_since']).execute().catch(() => []) : [];
    const loyBy: Record<string, any> = {}; for (const l of loy) loyBy[l.customer_id] = l;
    const agg = ids.length ? await this.scoped(this.db.selectFrom('tickets'), ctx).where('customer_id', 'is not', null).where('status', 'in', [...VISIT_TICKET_STATUSES])
      .groupBy('customer_id').select((eb: any) => ['customer_id', eb.fn.countAll().as('cnt'), eb.fn.sum('total_cents').as('spend'), eb.fn.max('created_at').as('last')]).execute().catch(() => []) : [];
    const aggBy: Record<string, any> = {}; for (const a of agg) aggBy[a.customer_id] = a;
    // F1 §11/§36: spend is net of completed refunds (payment_refunds 'refunded') on the customer's settled tickets
    const refunds: any[] = ids.length ? await this.scoped(this.db.selectFrom('payment_refunds as pr').innerJoin('payments as p', 'p.id', 'pr.payment_id').innerJoin('tickets as t', 't.id', 'p.ticket_id'), ctx, 't')
      .where('pr.tenant_id', '=', ctx.tenantId).where('pr.status', '=', 'refunded').where('t.customer_id', 'is not', null).where('t.status', 'in', [...VISIT_TICKET_STATUSES])
      .groupBy('t.customer_id').select((eb: any) => ['t.customer_id as customer_id', eb.fn.sum('pr.amount_cents').as('refunded')]).execute() : [];
    const refundBy: Record<string, number> = {}; for (const x of refunds) refundBy[x.customer_id] = Number(x.refunded) || 0;

    return rows.map((r: any) => {
      const l = loyBy[r.id]; const a = aggBy[r.id];
      const tier = l?.loyalty_tier || 'Regular';
      return {
        customerId: r.id, firstName: r.first_name || '', lastName: r.last_name || '',
        phone: r.phone_display || r.normalized_phone || '', normalizedPhone: r.normalized_phone || null, email: r.email || '', status: r.status, avatarUrl: r.avatar_url || undefined,
        source: 'manual' as CustomerSource, visitCount: Number(a?.cnt || 0), lastVisitAt: a?.last ? iso(a.last) : null,
        totalSpendCents: Math.max(0, Number(a?.spend || 0) - (refundBy[r.id] || 0)), loyaltyPoints: Number(l?.points_balance || 0), loyaltyTier: tier,
        isVip: !!l?.vip_since || /vip/i.test(tier), tags: [], birthdayMonth: monthDayOf(r.birthday)?.month, birthdayYear: r.birthday && r.birthday_year_known !== false ? Number(storedDateString(r.birthday)!.slice(0, 4)) : undefined,
        // Birthday Campaigns §05 P0: a DATE comes back from node-postgres as a JS Date — String(Date).slice(0, 10) printed "Thu Oct 01".
        // The calendar date is read from its parts; a month/day-only birthday never shows its placeholder year.
        birthday: r.birthday && r.birthday_year_known !== false ? storedDateString(r.birthday) ?? undefined : undefined,
        birthdayMonthDay: r.birthday ? storedDateString(r.birthday)?.slice(5) : undefined,
        marketingOptIn: !!r.marketing_sms_opt_in || !!r.marketing_email_opt_in, smsOptIn: !!r.marketing_sms_opt_in, emailOptIn: !!r.marketing_email_opt_in,
        createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), notes: r.notes || '', version: Number(r.record_version ?? 1),
        preferredName: r.preferred_name ?? null, preferredLanguage: r.preferred_language ?? null, preferredBranchId: r.preferred_branch_id ?? null,
      };
    });
  }
  private dupSet(all: Cust[]): Map<string, DuplicateRisk> {
    const groups = detectDuplicates(all.filter((c) => c.status !== 'archived').map((c) => ({ customerId: c.customerId, firstName: c.firstName, lastName: c.lastName, phone: c.phone, email: c.email })));
    const m = new Map<string, DuplicateRisk>();
    for (const g of groups) { const risk: DuplicateRisk = /phone|email/i.test(g.reason) ? 'high' : 'possible'; for (const mem of g.members) if ((m.get(mem.customerId) ?? 'none') !== 'high') m.set(mem.customerId, risk); }
    return m;
  }
  private toRow(ctx: CustomersContext, c: Cust, dup: Map<string, DuplicateRisk>): POSCustomerRow {
    return {
      customerId: c.customerId, tenantId: ctx.tenantId, branchId: ctx.branchId, firstName: c.firstName, lastName: c.lastName,
      displayName: `${c.firstName} ${c.lastName}`.trim(), phone: c.phone, email: c.email, status: c.status, source: c.source, avatarUrl: c.avatarUrl || undefined, isPhoneVerified: !!(c as any).phoneVerifiedAt,
      visitCount: c.visitCount, lastVisitAt: c.lastVisitAt, nextAppointmentAt: null, totalSpendCents: c.totalSpendCents,
      averageSpendCents: c.visitCount > 0 ? Math.round(c.totalSpendCents / c.visitCount) : 0, loyaltyPoints: c.loyaltyPoints, loyaltyTier: c.loyaltyTier,
      isVip: c.isVip, tags: c.tags, duplicateRisk: dup.get(c.customerId) || 'none', marketingOptIn: c.marketingOptIn, smsOptIn: c.smsOptIn, emailOptIn: c.emailOptIn,
      birthday: c.birthday, birthdayMonthDay: c.birthdayMonthDay,
      preferredName: c.preferredName ?? null, preferredLanguage: c.preferredLanguage ?? null, preferredBranchId: c.preferredBranchId ?? null,
      createdAt: c.createdAt, updatedAt: c.updatedAt, version: c.version ?? 1,
    };
  }
  private bool(v?: string) { return v === 'true' || v === 'yes' || v === '1'; }
  private filtered(all: Cust[], f: CustomerFilters, dup: Map<string, DuplicateRisk>, riskDays = INACTIVE_DAYS): Cust[] {
    let r = all.slice();
    if (f.search) { const q = foldVi(f.search);   /* WP-E §41: accent-insensitive ("nguyen" finds "Nguyễn") */ const digits = f.search.replace(/\D/g, ''); const byPhone = digits.length >= 3 && /^[\d\s()+.\-]+$/.test(f.search.trim());   /* F1 §14: "(555) 123-4567", "555.123.4567" and "5551234567" all find the same customer; stored values untouched */ r = r.filter((c) => [`${c.firstName ?? ''} ${c.lastName ?? ''}`, c.firstName, c.lastName, c.preferredName, c.phone, c.email, ...c.tags].some((x) => foldVi(x).includes(q)) || (byPhone && [c.phone, c.normalizedPhone].some((x) => (x ?? '').replace(/\D/g, '').includes(digits)))); }   /* the whole name too: "nguyen thi huong" */
    // F1 §29: Archived is a lifecycle status — hidden from All Customers and every tab unless the Archived status is chosen
    if (f.status) r = r.filter((c) => c.status === f.status); else r = r.filter((c) => c.status !== 'archived');
    if (f.loyaltyTier) r = r.filter((c) => c.loyaltyTier === f.loyaltyTier);
    if (f.source) r = r.filter((c) => c.source === f.source);
    if (f.tag) r = r.filter((c) => c.tags.includes(f.tag!));
    if (f.birthdayMonth) r = r.filter((c) => c.birthdayMonth === Number(f.birthdayMonth));
    if (f.marketingOptIn) r = r.filter((c) => c.marketingOptIn === this.bool(f.marketingOptIn));
    if (f.duplicateRisk) r = r.filter((c) => (dup.get(c.customerId) || 'none') === f.duplicateRisk);
    if (f.inactiveDays != null) r = r.filter((c) => this.daysSince(c.lastVisitAt) >= Number(f.inactiveDays));
    // Customer Segments guide §05 (segments-v1): Never Visited = 0 qualifying visits, New = EXACTLY 1, Returning = 2+ (a
    // newly registered customer with no visit is NOT New — it was `<= 1` before, which mixed them)
    if (f.segment === 'never') r = r.filter((c) => c.visitCount === 0);
    if (f.segment === 'new') r = r.filter((c) => c.visitCount === 1);
    if (f.segment === 'returning') r = r.filter((c) => c.visitCount >= RETURNING_MIN_VISITS);
    if (f.segment === 'vip') r = r.filter((c) => c.isVip);
    // F1 §15/§29: At Risk = has visited, and no visit for the salon's risk threshold (Customer Retention settings, default 60
    // days) — the same rule as the Retention screen. Never-visited customers are not At Risk; Archived is a lifecycle status.
    if (f.segment === 'at_risk') r = r.filter((c) => c.visitCount >= 1 && this.daysSince(c.lastVisitAt) >= riskDays);
    return r;
  }

  private warn(what: string, e: unknown) { console.warn(`[customers] directory ${what} unavailable: ${e instanceof Error ? e.message : String(e)}`); }
  /** F1 §39: bookings made and loyalty adjustments in the last 30 days, for customers in scope (no notes, no amounts) */
  private async activityEvents(ctx: CustomersContext, inScope: Cust[]): Promise<{ customerId: string; displayName: string; avatarUrl?: string; kind: 'booked' | 'loyalty'; at: string }[]> {
    const byId = new Map(inScope.map((c) => [c.customerId, c] as const));
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
    const booked: any[] = await this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx).select(['customer_id', 'created_at'])
      .where('customer_id', 'is not', null).where('created_at', '>=', since).orderBy('created_at', 'desc').limit(20).execute();
    const loyalty: any[] = await this.scoped(this.db.selectFrom('loyalty_ledger'), ctx).select(['customer_id', 'created_at'])
      .where('entry_type', '=', 'adjust').where('created_at', '>=', since).orderBy('created_at', 'desc').limit(20).execute();
    const out: { customerId: string; displayName: string; avatarUrl?: string; kind: 'booked' | 'loyalty'; at: string }[] = [];
    for (const [rows, kind] of [[booked, 'booked'], [loyalty, 'loyalty']] as const) for (const r of rows) {
      const c = byId.get(String(r.customer_id)); if (!c) continue;
      out.push({ customerId: c.customerId, displayName: `${c.firstName} ${c.lastName}`.trim(), avatarUrl: c.avatarUrl || undefined, kind, at: iso(r.created_at) });
    }
    return out;
  }
  /** the salon's At Risk threshold (Customer Retention settings; 60 days when never set) */
  private async riskDays(ctx: CustomersContext): Promise<number> {
    const r = await this.db.selectFrom('tenant_retention_settings').select('risk_days').where('tenant_id', '=', ctx.tenantId).executeTakeFirst().catch(() => undefined);
    return Number(r?.risk_days) || INACTIVE_DAYS;
  }
  /** the location's time zone (or the salon's first location's) — "this month" is the salon's calendar month */
  private async salonTimeZone(ctx: CustomersContext): Promise<string> {
    let q = this.db.selectFrom('branches').select('timezone').where('tenant_id', '=', ctx.tenantId);
    q = ctx.branchId ? q.where('id', '=', ctx.branchId) : q.orderBy('created_at', 'asc');
    const r = await q.executeTakeFirst().catch(() => undefined);
    return (r?.timezone as string | undefined) || 'UTC';
  }

  /** last completed snapshot day of each of the last 6 months → Active ÷ visited customers (null = no reliable data) */
  async retentionSeries(ctx: CustomersContext): Promise<{ month: string; date: string | null; ratePercent: number | null; reason: string | null }[]> {
    const now = new Date(); const months: string[] = [];
    for (let i = 5; i >= 0; i--) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); months.push(d.toISOString().slice(0, 7)); }
    const since = `${months[0]}-01`;
    const runs: any[] = await this.db.selectFrom('customer_retention_snapshot_runs').select(['snapshot_local_date', 'definition_version', 'status', 'coverage', 'has_branch'])
      .where('tenant_id', '=', ctx.tenantId).where('snapshot_local_date', '>=', since).where('status', '=', 'completed')
      .orderBy('snapshot_local_date', 'desc').execute();
    const day = (v: any) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
    const out: { month: string; date: string | null; ratePercent: number | null; reason: string | null }[] = [];
    for (const m of months) {
      const r = runs.find((x) => day(x.snapshot_local_date).startsWith(m) && x.coverage !== 'incomplete');
      if (!r) { out.push({ month: m, date: null, ratePercent: null, reason: 'missing' }); continue; }
      if (ctx.branchId && !r.has_branch) { out.push({ month: m, date: day(r.snapshot_local_date), ratePercent: null, reason: 'no_branch_data' }); continue; }
      let q = this.db.selectFrom('customer_retention_daily_snapshots as s').select(['s.segment', (eb: any) => eb.fn.countAll().as('n')])
        .where('s.tenant_id', '=', ctx.tenantId).where('s.snapshot_local_date', '=', day(r.snapshot_local_date)).where('s.definition_version', '=', r.definition_version);
      if (ctx.branchId) { const b = ctx.branchId; q = q.where((eb: any) => eb.or([eb('s.last_visit_branch_id', '=', b), eb.and([eb('s.last_visit_branch_id', 'is', null), eb('s.home_branch_id', '=', b)])])); }
      const rows: any[] = await q.groupBy('s.segment').execute();
      const n = (seg: string) => Number(rows.find((x) => x.segment === seg)?.n) || 0;
      const visited = n('active') + n('approaching') + n('at_risk');
      out.push({ month: m, date: day(r.snapshot_local_date), ratePercent: visited > 0 ? Math.round((n('active') / visited) * 1000) / 10 : null, reason: visited > 0 ? null : 'no_visits' });
    }
    return out;
  }

  async query(ctx: CustomersContext, f: CustomerFilters): Promise<POSCustomersFullState> {
    const everyone = await this.load(ctx); const dup = this.dupSet(everyone);
    // F1 §29: KPI numerators and denominators count non-archived profiles; the list reaches archived ones via the status filter
    const all = everyone.filter((c) => c.status !== 'archived');
    const riskDays = await this.riskDays(ctx);
    const matched = this.filtered(everyone, f, dup, riskDays);
    // F1 §12/§15: tab counts use the same filter code as the list (the other active filters applied), so a tab's number is
    // exactly what the tab shows
    const segmentCounts = Object.fromEntries((['', 'never', 'new', 'returning', 'vip', 'at_risk'] as const).map((seg) => [seg || 'all', this.filtered(everyone, { ...f, segment: seg || undefined }, dup, riskDays).length])) as Record<'all' | 'never' | 'new' | 'returning' | 'vip' | 'at_risk', number>;
    const tz = await this.salonTimeZone(ctx);
    // one formatter per request (constructing Intl.DateTimeFormat per customer cost ~0.9 s at 10,000 customers)
    const monthFmt = (() => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }); } catch (e) { this.warn('timeZone ' + tz, e); return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit' }); } })();
    const monthKey = (d: string | null | undefined) => (d ? monthFmt.format(new Date(d)) : '');
    const curMonth = monthKey(new Date().toISOString());
    const page = clampPage(f.page), pageSize = clampPageSize(f.pageSize, 20);
    const totalItems = matched.length, totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const pageRows = matched.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
    const pagination: Pagination = { page, pageSize, totalItems, totalPages };
    const listItems: CustomerListItem[] = pageRows.map((c) => ({
      customerId: c.customerId, fullName: `${c.firstName} ${c.lastName}`.trim(), phone: c.phone, normalizedPhone: c.normalizedPhone ?? null, email: c.email,
      visitsCount: c.visitCount, favoriteServiceName: undefined, favoriteTechnicianName: undefined, avatarUrl: c.avatarUrl || undefined,
      loyaltyTier: (c.loyaltyTier as any) || 'Regular', lastVisitDate: c.lastVisitAt || undefined, totalSpendCents: c.totalSpendCents, status: c.status as any,
    }));
    const rowItems = pageRows.map((c) => this.toRow(ctx, c, dup));
    const thisMonth = new Date().getMonth() + 1;
    const avgSpendAll = all.length ? Math.round(all.reduce((a, c) => a + c.totalSpendCents, 0) / all.length) : 0;

    // --- real period-over-period trends (last 30d vs prior 30d) ---
    const now = Date.now();
    const inWin = (d: string | null | undefined, lo: number, hi: number) => { if (!d) return false; const t = new Date(d).getTime(); return t >= lo && t < hi; };
    const newThis30 = all.filter((c) => inWin(c.createdAt, now - 30 * 864e5, now)).length;
    const newPrior30 = all.filter((c) => inWin(c.createdAt, now - 60 * 864e5, now - 30 * 864e5)).length;
    const pct = (cur: number, prev: number): number | null => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);
    const priorTotal = all.length - newThis30;
    // avg spend per active customer, periodized from paid tickets
    const spendWin = async (lo: number, hi: number) => {
      const r = await this.scoped(this.db.selectFrom('tickets'), ctx).where('paid_at', 'is not', null)
        .where('paid_at', '>=', new Date(lo).toISOString()).where('paid_at', '<', new Date(hi).toISOString())
        .select((eb: any) => [eb.fn.sum('total_cents').as('rev'), eb.fn.count('customer_id').distinct().as('custs')]).executeTakeFirst().catch(() => undefined);
      const rev = Number(r?.rev) || 0; const custs = Number(r?.custs) || 0; return custs > 0 ? rev / custs : 0;
    };
    let avgSpendTrend: number | null = null;
    try { const [aThis, aPrior] = await Promise.all([spendWin(now - 30 * 864e5, now), spendWin(now - 60 * 864e5, now - 30 * 864e5)]); avgSpendTrend = pct(aThis, aPrior); } catch { avgSpendTrend = null; }
    const trends = {
      totalCustomers: priorTotal > 0 ? Math.round((newThis30 / priorTotal) * 1000) / 10 : null,
      newCustomers: pct(newThis30, newPrior30),
      avgSpend: avgSpendTrend,
      inactive: null, retention: null, clv: null, // need historical monthly snapshots — not fabricated
    };
    // F1 §37: month-by-month retention from the nightly retention snapshots (the last completed day of each of the last 6
    // months). Retention = Active ÷ customers who have visited. A month with no completed snapshot — or, for a location view,
    // one computed before locations were recorded — is a gap (null), never an estimate.
    // F1 §16: an analytics read that fails leaves the list working and says which card is unavailable (never an empty "no data")
    const unavailable: string[] = [];
    const retentionSeries = await this.retentionSeries(ctx).catch((e: unknown) => { unavailable.push('retentionSeries'); this.warn('retentionSeries', e); return []; });
    // F1 §39: Recent Customer Activity from the whole salon (latest visits and newly added profiles), not the visible page
    const recentActivity = [
      ...all.filter((c) => c.lastVisitAt).map((c) => ({ customerId: c.customerId, displayName: `${c.firstName} ${c.lastName}`.trim(), avatarUrl: c.avatarUrl || undefined, kind: 'visit' as const, at: c.lastVisitAt as string })),
      ...all.filter((c) => c.createdAt && this.daysSince(c.createdAt) <= 30).map((c) => ({ customerId: c.customerId, displayName: `${c.firstName} ${c.lastName}`.trim(), avatarUrl: c.avatarUrl || undefined, kind: 'added' as const, at: c.createdAt as string })),
      ...(await this.activityEvents(ctx, all).catch((e: unknown) => { unavailable.push('recentActivity'); this.warn('recentActivity', e); return []; })),
    ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime() || a.customerId.localeCompare(b.customerId)).slice(0, 8);
    // full-base right-rail aggregations (across all customers, not the current page)
    const tally = (arr: (string | undefined)[]) => { const m = new Map<string, number>(); for (const x of arr) { const key = (x || '').trim(); if (key) m.set(key, (m.get(key) || 0) + 1); } return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count); };
    const directory = {
      topTags: tally(all.flatMap((c) => c.tags)).slice(0, 6),
      allTags: tally(all.flatMap((c) => c.tags)).slice(0, 200),   // F1 §32: the Tags card's View All
      sources: tally(all.map((c) => c.source)),
      topSpendersCount: Math.round(all.length * 0.05), // top 5% by spend
    };

    const kpis: CustomerKpis = {
      totalCustomers: all.length, totalCustomersTrendPercent: 0, newThisMonth: all.filter((c) => monthKey(c.createdAt) === curMonth).length, newThisMonthTrendPercent: 0,
      vipMembers: all.filter((c) => c.isVip).length, vipPercentOfTotal: all.length ? Math.round((all.filter((c) => c.isVip).length / all.length) * 100) : 0,
      returningRatePercent: all.length ? Math.round((all.filter((c) => c.visitCount >= RETURNING_MIN_VISITS).length / all.length) * 100) : 0, returningRateTrendPercent: 0,
      birthdaysThisWeek: all.filter((c) => c.birthdayMonth === thisMonth).length, birthdayCustomerAvatars: [], birthdayExtraCount: 0,
    };
    const kpisFull: POSCustomersKpisFull = {
      totalCustomers: all.length, newCustomersToday: all.filter((c) => this.daysSince(c.createdAt) === 0).length,
      returningCustomersToday: all.filter((c) => c.visitCount >= RETURNING_MIN_VISITS && this.daysSince(c.lastVisitAt) === 0).length,
      vipCustomers: all.filter((c) => c.isVip).length, birthdayThisMonth: all.filter((c) => c.birthdayMonth === thisMonth).length,
      inactiveCustomers: all.filter((c) => this.daysSince(c.lastVisitAt) >= INACTIVE_DAYS).length, duplicateProfiles: dup.size,
      loyaltyMembers: all.filter((c) => c.loyaltyPoints > 0 || c.loyaltyTier !== 'Regular').length, averageSpendCents: avgSpendAll,
      // F1 §11-12 (salon calendar month): profiles added this month; returning (2+ visits) customers who visited this month;
      // At Risk by the salon's risk threshold (see filtered())
      newThisMonth: all.filter((c) => monthKey(c.createdAt) === curMonth).length,
      returningThisMonth: all.filter((c) => c.visitCount >= RETURNING_MIN_VISITS && monthKey(c.lastVisitAt) === curMonth).length,
      atRiskCustomers: all.filter((c) => c.visitCount >= 1 && this.daysSince(c.lastVisitAt) >= riskDays).length,
      riskDays, archivedCustomers: everyone.length - all.length,
    };
    return {
      kpis, customers: { items: listItems, pagination } as CustomerListResponse,
      filters: { statuses: ['active', 'inactive', 'archived'], loyaltyTiers: ['VIP Gold', 'VIP Silver', 'Gold', 'Silver', 'Regular'] },
      kpisFull, analytics: buildCustomersAnalytics(all.map((c) => ({ totalSpendCents: c.totalSpendCents, visitCount: c.visitCount, recencyDays: this.daysSince(c.lastVisitAt), ageYears: c.birthdayYear ? new Date().getFullYear() - c.birthdayYear : undefined }))), rows: { items: rowItems, pagination }, trends, directory, retentionSeries, recentActivity, segmentCounts, ...(unavailable.length ? { unavailable } : {}),
      filterFacets: {
        segments: ['never', 'new', 'returning', 'vip', 'at_risk'], statuses: ['active', 'inactive', 'archived'],
        loyaltyTiers: [...new Set(all.map((c) => c.loyaltyTier))], visitRanges: ['0', '1-3', '4-9', '10+'],
        spendRanges: ['0-5000', '5001-20000', '20001+'], sources: [...new Set(all.map((c) => c.source))], tags: [...new Set(all.flatMap((c) => c.tags))],
      },
    };
  }

  async detail(ctx: CustomersContext, id: string): Promise<POSCustomerDetail | null> {
    const all = await this.load(ctx); const c = all.find((x) => x.customerId === id); if (!c) return null;
    const dup = this.dupSet(all);
    const [tags, loy, mem, gc, visits, notes] = await Promise.all([
      this.getTags(ctx, id),
      this.getLoyalty(ctx, id),
      this.getMembership(ctx, id),
      this.getGiftCards(ctx, id),
      this.visits(ctx, id),
      this.getNotes(ctx, id)
    ]);
    return { ...this.toRow(ctx, c, dup), tags: tags || [], notes: notes || defNotes(c.notes), loyalty: loy || defLoyalty(c.loyaltyPoints, c.loyaltyTier), membership: mem || defMembership(), giftCards: gc || [], recentVisits: visits || [], auditSummary: [{ lastAction: 'updated', lastActorRole: ctx.role, lastAt: c.updatedAt }] };
  }

  async findByContact(ctx: CustomersContext, phone?: string, email?: string, excludeId?: string): Promise<POSCustomerRow | null> {
    const all = await this.load(ctx); const dup = this.dupSet(all);
    const hit = all.find((c) => c.customerId !== excludeId && ((phone && c.phone === phone) || (email && c.email && c.email.toLowerCase() === email.toLowerCase())));
    return hit ? this.toRow(ctx, hit, dup) : null;
  }

  async create(ctx: CustomersContext, req: CreateCustomerRequest): Promise<POSCustomerRow> {
    const fullName = `${req.firstName || ''} ${req.lastName || ''}`.trim();
    // §18: the customer row and customer.created commit together (this was a bare INSERT before).
    const newId: string = await this.db.transaction().execute(async (trx) => {
      const ins = await trx.insertInto('customers').values({
        tenant_id: ctx.tenantId, branch_id: ctx.branchId, first_name: req.firstName || '', last_name: req.lastName || '', full_name: fullName,
        normalized_phone: toStoredCustomerPhone(req.phone), phone_display: req.phone || null, email: req.email || null,
        birthday: req.birthday || null, birthday_year_known: req.birthday ? req.birthdayYearKnown !== false : true, birthday_source: req.birthday ? 'created' : null, birthday_updated_at: req.birthday ? sql`now()` : null, status: 'active', marketing_sms_opt_in: req.smsOptIn ?? false, marketing_email_opt_in: req.emailOptIn ?? false,
        notes: req.notes || null,
      } as any).returning(['id']).executeTakeFirstOrThrow();
      const id = ins.id as string;
      if (this.outbox) {
        await this.outbox.write(trx, createDomainEvent({
          eventType: DOMAIN_EVENTS.CUSTOMER_CREATED, tenantId: ctx.tenantId, branchId: ctx.branchId,
          aggregateType: 'customer', aggregateId: id, actorId: ctx.userId, actorType: 'user',
          // §95: the id and opt-in FACTS only — no name, phone, email or birthday in the event
          payload: { customerId: id, source: 'pos', smsOptIn: req.smsOptIn ?? false, emailOptIn: req.emailOptIn ?? false, hasPhone: !!req.phone, hasEmail: !!req.email },
        }));
      }
      return id;
    });
    return (await this.detail(ctx, newId))!;
  }

  // Tenant-wide contact keys for dedup (all branches): a person already in another branch is still a duplicate.
  async listContactKeys(ctx: CustomersContext): Promise<{ id: string; normalizedPhone: string | null; email: string | null; birthday: string | null }[]> {
    const rows = await this.db.selectFrom('customers').select(['id', 'normalized_phone', 'email', 'birthday'])
      .where('tenant_id', '=', ctx.tenantId).execute().catch(() => [] as any[]);
    return rows.map((r) => ({ id: r.id, normalizedPhone: r.normalized_phone ?? null, email: r.email ?? null, birthday: storedDateString(r.birthday) }));
  }

  // Batched multi-row insert for large imports. Chunked to stay well under Postgres' parameter ceiling, wrapped in one
  // transaction so a mid-way failure rolls the whole import back. Caller has already deduped + validated the rows.
  async bulkInsertCustomers(ctx: CustomersContext, rows: BulkCustomerInsert[]): Promise<number> {
    if (!rows.length) return 0;
    const CHUNK = 1000;
    const toValues = (r: BulkCustomerInsert) => ({
      tenant_id: ctx.tenantId, branch_id: ctx.branchId,
      first_name: r.firstName || '', last_name: r.lastName || '', full_name: `${r.firstName || ''} ${r.lastName || ''}`.trim(),
      normalized_phone: r.normalizedPhone || null, phone_display: r.phoneDisplay || null, email: r.email || null,
      birthday: toStorage(r.birthday)?.date ?? null, birthday_year_known: toStorage(r.birthday)?.yearKnown ?? true, birthday_source: toStorage(r.birthday) ? 'import' : null, birthday_updated_at: toStorage(r.birthday) ? sql`now()` : null, status: 'active', marketing_sms_opt_in: false, marketing_email_opt_in: false,
    });
    let inserted = 0;
    await this.db.transaction().execute(async (trx) => {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK).map(toValues);
        await trx.insertInto('customers').values(slice as any).execute();
        inserted += slice.length;
      }
    });
    return inserted;
  }
  // Fill-only-empty re-import update: COALESCE/NULLIF keep any existing value and only write where the column is empty,
  // so a re-import can never clobber data a salon already has. Counts a row as updated when it matched a customer.
  async bulkUpdateContactInfo(ctx: CustomersContext, updates: BulkCustomerUpdate[]): Promise<number> {
    if (!updates.length) return 0;
    let updated = 0;
    await this.db.transaction().execute(async (trx) => {
      for (const u of updates) {
        const set: any = { updated_at: new Date() };
        const bs = toStorage(u.birthday);
        if (bs) { set.birthday = sql`COALESCE(birthday, ${bs.date}::date)`; set.birthday_year_known = sql`CASE WHEN birthday IS NULL THEN ${bs.yearKnown} ELSE birthday_year_known END`; set.birthday_source = sql`CASE WHEN birthday IS NULL THEN 'import' ELSE birthday_source END`; set.birthday_updated_at = sql`CASE WHEN birthday IS NULL THEN now() ELSE birthday_updated_at END`; }
        if (u.email) set.email = sql`COALESCE(NULLIF(email, ''), ${u.email})`;
        if (u.normalizedPhone) {
          set.normalized_phone = sql`COALESCE(NULLIF(normalized_phone, ''), ${u.normalizedPhone})`;
          set.phone_display = sql`COALESCE(NULLIF(phone_display, ''), ${u.phoneDisplay ?? u.normalizedPhone})`;
        }
        const res: any = await trx.updateTable('customers').set(set).where('id', '=', u.customerId).where('tenant_id', '=', ctx.tenantId).executeTakeFirst();
        if (Number(res?.numUpdatedRows ?? 0) > 0) updated++;
      }
    });
    return updated;
  }
  async update(ctx: CustomersContext, id: string, req: EditCustomerRequest): Promise<POSCustomerRow | null> {
    // Spec §9/§14: every profile edit bumps record_version — the SAME column the phone activation locks on, so a profile
    // edit and a phone change can no longer silently overwrite each other either.
    const patch: any = { updated_at: sql`now()`, record_version: sql`record_version + 1` };
    if (req.firstName != null) patch.first_name = req.firstName; if (req.lastName != null) patch.last_name = req.lastName;
    if (req.firstName != null || req.lastName != null) patch.full_name = sql`trim(coalesce(${req.firstName ?? null}, first_name) || ' ' || coalesce(${req.lastName ?? null}, last_name))`;
    // ── THE PHONE IS NOT EDITABLE HERE. ────────────────────────────────────────────────────────────────
    //
    // This line used to write `normalized_phone` directly, and it was a hole straight through the phone-management
    // module:
    //
    //   * `replace(/[^\d+]/g,'')` is not normalization. "(555) 123-4567" became "5551234567" — no country code,
    //     not E.164, and therefore not a number Twilio can send to.
    //   * no validation, no DUPLICATE CHECK, no VERIFICATION, no optimistic lock, no status model, no audit of the
    //     change.
    //   * the new number was instantly treated as the customer's real number — so a receptionist could point a
    //     customer's booking codes and appointment reminders at any handset they liked, in one PATCH, and nothing
    //     recorded that a phone number had changed at all.
    //
    // The spec's first rule is right: "do not allow each frontend to update customer phone numbers independently
    // using separate business logic." A second path is a second set of rules, and the fraud moves to whichever set
    // is weaker. This was the weaker set.
    //
    // Phone changes go through CustomerPhoneUpdateService: normalize → dedupe → save pending → SMS verify →
    // activate under an optimistic lock → synchronise → audit. Everything ELSE on this endpoint (name, email,
    // tags, consent) still works exactly as before.
    //
    // `phone_display` is left editable: it is the human-readable rendering ("(555) 123-4567"), not the number we
    // send to. Correcting its formatting changes nothing about where a message goes.
    // Phase 3: formatting ONLY. A rendering that is a DIFFERENT number is ignored — it used to be stored, so the
    // POS list, the AI receptionist's caller-ID and the identity reconciliation could all read a number nobody proved
    // (audit E4). A different number goes through CustomerPhoneUpdateService.
    if (req.phone != null) { const e = normalizePhone(String(req.phone)); if (e) patch.phone_display = sql`CASE WHEN normalized_phone = ${e} THEN ${String(req.phone)} ELSE phone_display END`; }
    if (req.email != null) patch.email = req.email;
    if (req.smsOptIn != null) patch.marketing_sms_opt_in = req.smsOptIn; if (req.emailOptIn != null) patch.marketing_email_opt_in = req.emailOptIn;
    if (req.status != null) patch.status = req.status;
    // Decision 1 profile fields (validated by the service; '' → null clears)
    if (req.preferredName !== undefined) patch.preferred_name = req.preferredName || null;
    if (req.preferredLanguage !== undefined) patch.preferred_language = req.preferredLanguage || null;
    if (req.preferredBranchId !== undefined) patch.preferred_branch_id = req.preferredBranchId || null;
    // Birthday Campaigns §10: the profile editor records / corrects / clears a birthday (validated by the service). Who and when are kept.
    if (req.birthday !== undefined) {
      patch.birthday = req.birthday || null; patch.birthday_year_known = req.birthday ? req.birthdayYearKnown !== false : true;
      patch.birthday_source = req.birthday ? 'staff' : null; patch.birthday_updated_at = sql`now()`;
      patch.birthday_updated_by = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(ctx.userId ?? '')) ? ctx.userId : null;
    }
    // §18/§78: the profile edit and customer.updated commit together. The payload names WHICH fields changed —
    // never their values (§95), and the phone is not editable here at all (see the note above).
    const res = await this.db.transaction().execute(async (trx) => {
      let q = this.scoped(trx.updateTable('customers'), ctx).set(patch).where('id', '=', id);
      if (req.expectedVersion != null) q = q.where('record_version', '=', req.expectedVersion);   // §16: never blind last-write-wins
      const r = await q.executeTakeFirst();
      if (req.expectedVersion != null && Number(r?.numUpdatedRows ?? 0) === 0) {
        const cur: any = await this.scoped(trx.selectFrom('customers'), ctx).select(['record_version']).where('id', '=', id).executeTakeFirst();
        if (cur) throw new CustomerVersionConflict(Number(cur.record_version));   // exists, but moved on → conflict (not 404)
      }
      if (Number(r?.numUpdatedRows ?? 0) > 0 && this.outbox) {
        const changed = Object.keys(patch).filter((k) => k !== 'updated_at' && k !== 'record_version');
        await this.outbox.write(trx, createDomainEvent({
          eventType: DOMAIN_EVENTS.CUSTOMER_UPDATED, tenantId: ctx.tenantId, branchId: ctx.branchId, aggregateType: 'customer', aggregateId: id,
          actorId: ctx.userId, actorType: 'user', payload: { customerId: id, changedFields: changed },
        }));
      }
      return r;
    });
    if (!Number(res?.numUpdatedRows ?? 0)) return null;
    const all = await this.load(ctx); const c = all.find((x) => x.customerId === id); return c ? this.toRow(ctx, c, this.dupSet(all)) : null;
  }
  async setStatus(ctx: CustomersContext, id: string, status: 'active' | 'inactive' | 'archived'): Promise<POSCustomerRow | null> {
    const res = await this.scoped(this.db.updateTable('customers'), ctx).set({ status, updated_at: sql`now()`, archived_at: status === 'archived' ? sql`now()` : null }).where('id', '=', id).executeTakeFirst();
    if (!Number(res?.numUpdatedRows ?? 0)) return null;
    const all = await this.load(ctx); const c = all.find((x) => x.customerId === id); return c ? this.toRow(ctx, c, this.dupSet(all)) : null;
  }

  // ---- history (real, scoped by customer_id) ----
  async visits(ctx: CustomersContext, id: string): Promise<CustomerVisitRow[] | null> {
    if (!(await this.exists(ctx, id))) return null;
    const rows = await this.scoped(this.db.selectFrom('tickets as t'), ctx, 't').where('t.customer_id', '=', id).where('t.status', 'in', [...VISIT_TICKET_STATUSES])
      .leftJoin('ticket_service_lines as l', 'l.ticket_id', 't.id').leftJoin('technicians as tech', 'tech.id', 't.primary_technician_id')
      .leftJoin('branches as b', 'b.id', 't.branch_id')
      .select(['t.id as ticketId', 't.created_at as date', 'l.service_name_snapshot as serviceName', 'tech.full_name as technicianName', 't.total_cents as totalCents', 'b.name as branchName'])
      .orderBy('t.created_at', 'desc').execute().catch(() => []);
    const seen = new Set<string>(); const out: CustomerVisitRow[] = [];
    for (const r of rows) { if (seen.has(r.ticketId)) continue; seen.add(r.ticketId); out.push({ visitId: r.ticketId, date: iso(r.date), serviceName: r.serviceName || '', technicianName: r.technicianName || '', totalCents: Number(r.totalCents || 0), tipCents: 0, branchName: r.branchName ?? null }); }
    return out;
  }
  async appointments(ctx: CustomersContext, id: string): Promise<CustomerAppointmentRow[] | null> {
    if (!(await this.exists(ctx, id))) return null;
    const rows = await this.scoped(this.db.selectFrom('pos_tech_appointments as a'), ctx, 'a').where('a.customer_id', '=', id)
      .leftJoin('technicians as tech', 'tech.id', 'a.technician_id')
      .leftJoin('branches as b', 'b.id', 'a.branch_id')
      // w4 sweep SW-09: an appointment reaches its money through the visit it became — appointment → queue item
      // (appointment_id) → ticket (queue_item_id). The old join on a.ticket_id (and duration_mins / actual_duration_mins /
      // cancel_reason) named columns that do not exist; the query failed and the tab was always empty.
      .leftJoin('pos_queue_items as qi', (j: any) => j.onRef('qi.appointment_id', '=', 'a.id').onRef('qi.tenant_id', '=', 'a.tenant_id'))
      .leftJoin('tickets as t', (j: any) => j.onRef('t.queue_item_id', '=', 'qi.id').onRef('t.tenant_id', '=', 'a.tenant_id'))
      .select([
        'a.id as appointmentId', sql<string>`(a.appt_date + a.start_time::time)`.as('startsAt'), 'tech.full_name as technicianName', 'a.status as status', 'a.services as services',
        'b.name as branchName', 'a.source as source', 'a.duration_minutes as scheduledDurationMinutes',
        't.total_cents as totalCents', 't.tax_cents as taxCents', 't.tip_cents as tipCents', 't.discount_cents as discountsCents',
        't.chosen_payment_method as paymentMethod', 't.status as ticketStatus', 't.created_at as ticketAt',
        'a.notes as notes'
      ])
      .orderBy('a.appt_date', 'desc').orderBy('a.start_time', 'desc').orderBy(sql`t.created_at desc nulls last`).execute().catch(() => []);
    // one row per appointment (a re-queued visit can have more than one queue item): the latest ticket wins
    const seenAppt = new Set<string>();
    const uniq = (rows as any[]).filter((r) => (seenAppt.has(r.appointmentId) ? false : (seenAppt.add(r.appointmentId), true)));
    return uniq.map((r: any) => ({
      appointmentId: r.appointmentId, startsAt: iso(r.startsAt), serviceName: apptServiceName(r.services), technicianName: r.technicianName || '', status: r.status,
      branchName: r.branchName || '', source: r.source || 'booking', scheduledDurationMinutes: Number(r.scheduledDurationMinutes || 0), actualDurationMinutes: 0,
      originalPriceCents: (Number(r.totalCents || 0) - Number(r.taxCents || 0) - Number(r.tipCents || 0)) + Number(r.discountsCents || 0),
      discountsCents: Number(r.discountsCents || 0), finalPriceCents: Number(r.totalCents || 0) - Number(r.taxCents || 0) - Number(r.tipCents || 0),
      tipCents: Number(r.tipCents || 0), taxCents: Number(r.taxCents || 0), totalCents: Number(r.totalCents || 0),
      paymentMethodMasked: r.paymentMethod || undefined,
      refundStatus: r.ticketStatus === 'refunded' || r.ticketStatus === 'partially_refunded' ? r.ticketStatus : undefined,
      cancelReason: '', notes: r.notes || '', rebooked: false,
    }));
  }
  async tickets(ctx: CustomersContext, id: string): Promise<CustomerTicketRow[] | null> {
    if (!(await this.exists(ctx, id))) return null;
    const rows = await this.scoped(this.db.selectFrom('tickets'), ctx).where('customer_id', '=', id)
      .select(['id', 'created_at', 'total_cents', 'status']).orderBy('created_at', 'desc').execute().catch(() => []);
    return rows.map((r: any) => ({ ticketId: r.id, date: iso(r.created_at), totalCents: Number(r.total_cents || 0), paymentMethod: '', status: r.status }));
  }
  async receipts(ctx: CustomersContext, id: string): Promise<CustomerReceiptRow[] | null> {
    if (!(await this.exists(ctx, id))) return null;
    const rows = await this.scoped(this.db.selectFrom('receipts as r'), ctx, 'r').innerJoin('tickets as t', 't.id', 'r.ticket_id').where('t.customer_id', '=', id)
      .select(['r.id as id', 'r.created_at as date', 'r.total_cents as totalCents', 'r.emailed_to as emailedTo']).orderBy('r.created_at', 'desc').execute().catch(() => []);
    return rows.map((r: any) => ({ receiptId: r.id, date: iso(r.date), totalCents: Number(r.total_cents || 0), channel: r.emailedTo ? 'email' : 'unknown' }));
  }
  private async exists(ctx: CustomersContext, id: string) {
    const r = await this.scoped(this.db.selectFrom('customers'), ctx).where('id', '=', id).select('id').executeTakeFirst().catch(() => undefined);
    return !!r;
  }

  // ---- notes (customers.notes + preferences) ----
  async getNotes(ctx: CustomersContext, id: string): Promise<CustomerNotes | null> {
    const c = await this.scoped(this.db.selectFrom('customers'), ctx).where('id', '=', id).select(['notes', 'notes_json', 'safety_notes']).executeTakeFirst().catch(() => undefined);
    if (!c) return null;
    const pref = await this.scoped(this.db.selectFrom('customer_preferences'), ctx).where('customer_id', '=', id).select(['preferred_style_notes', 'product_preferences_json', 'favorite_colors_json']).executeTakeFirst().catch(() => undefined);
    const row: any = c;
    // Prefer the full JSON blob (all fields); fall back to legacy columns for rows written before 321.
    let json: any = row.notes_json;
    if (json && typeof json === 'string') { try { json = JSON.parse(json); } catch { json = null; } }
    if (json && typeof json === 'object') return { ...defNotes(''), ...json };
    const safeParse = (v: any) => { if (typeof v === 'string') { try { return JSON.parse(v).join(', '); } catch { return ''; } } if (Array.isArray(v)) return v.join(', '); return ''; };
    return { ...defNotes(row.notes || ''), warnings: row.safety_notes || '', preferredStyle: pref?.preferred_style_notes || '', favoriteProducts: safeParse(pref?.product_preferences_json), preferredNailShapeColor: safeParse(pref?.favorite_colors_json) };
  }
  async setNotes(ctx: CustomersContext, id: string, n: CustomerNotes): Promise<CustomerNotes | null> {
    // Persist the complete object in notes_json; mirror salonNotes + warnings to the legacy columns so
    // existing readers of customers.notes / customers.safety_notes stay consistent.
    const res = await this.scoped(this.db.updateTable('customers'), ctx).set({
      notes: n.salonNotes, safety_notes: n.warnings, notes_json: JSON.stringify(n), updated_at: sql`now()`,
    }).where('id', '=', id).executeTakeFirst();
    if (!Number(res?.numUpdatedRows ?? 0)) return null;
    return n;
  }
  // ---- tags: no schema (accepted, not persisted) ----
  // ── TAGS (real, customer_tags — migration 381) ────────────────────────────────────────────────────────
  //
  // These two used to be:
  //
  //     async getTags(ctx, id) { return (await this.exists(ctx, id)) ? [] : null; }    ← ALWAYS EMPTY
  //     async setTags(ctx, id, t) { return (await this.exists(ctx, id)) ? t : null; }  ← ECHOES. STORED NOTHING.
  //
  // There was no `customer_tags` table. POSCustomersScreen called setTags, the endpoint returned 200, and the
  // screen flashed "saved". EVERY CUSTOMER TAG EVER SET ON THIS PLATFORM WAS DISCARDED.
  //
  // A customer tag is where a salon writes "allergic to acetone", "VIP", "no-show risk", "pregnant — no gel".
  // Somebody typed that, watched it save, and the next person to open the record saw nothing.
  async getTags(ctx: CustomersContext, id: string): Promise<string[] | null> {
    if (!(await this.exists(ctx, id))) return null;
    const rows = await this.db.selectFrom('customer_tags')
      .where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', id)
      .select(['tag']).orderBy('tag').execute().catch(() => []);
    return rows.map((r: any) => r.tag);
  }

  async setTags(ctx: CustomersContext, id: string, t: string[]): Promise<string[] | null> {
    if (!(await this.exists(ctx, id))) return null;
    const tags = [...new Set((t || []).map((x) => String(x).trim()).filter(Boolean))].slice(0, 40);

    await this.db.deleteFrom('customer_tags')
      .where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', id).execute();

    if (tags.length) {
      await this.db.insertInto('customer_tags')
        .values(tags.map((tag) => ({
          tenant_id: ctx.tenantId, branch_id: ctx.branchId || null, customer_id: id,
          tag, created_by_user_id: ctx.userId,
        })))
        .onConflict((oc: any) => oc.columns(['tenant_id', 'customer_id', 'tag']).doNothing())
        .execute();
    }
    return this.getTags(ctx, id);
  }

  // ---- loyalty (real, customer_loyalty_profiles) ----
  async getLoyalty(ctx: CustomersContext, id: string): Promise<any | null> {
    if (!(await this.exists(ctx, id))) return null;
    // w4 sweep SW-12: loyalty is SALON-wide — one profile per (tenant, customer), and loyalty_rewards / loyalty_redemptions
    // have no branch_id at all — so these reads are tenant-scoped (branch scoping failed the rewards + redemptions
    // statements outright and hid a profile opened at another branch)
    const l: any = await this.db.selectFrom('customer_loyalty_profiles').where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', id)
      .select(['loyalty_tier', 'points_balance', 'total_earned_points', 'total_redeemed_points']).executeTakeFirst().catch(() => undefined);
      
    const points = Number(l?.points_balance || 0);
    const earned = Number(l?.total_earned_points || 0);
    const redeemed = Number(l?.total_redeemed_points || 0);
    const tier = l?.loyalty_tier || 'Regular';
    
    const rewards = await this.db.selectFrom('loyalty_rewards').where('tenant_id', '=', ctx.tenantId)
      .where('active', '=', true)
      .where('points_cost', '<=', points)
      .select(['id', 'title', 'description', 'points_cost'])
      .orderBy('points_cost', 'asc')
      .execute().catch(() => []);
      
    const redemptions = await this.db.selectFrom('loyalty_redemptions').where('tenant_id', '=', ctx.tenantId)
      .where('customer_id', '=', id)
      .select(['id', 'reward_title', 'points_spent', 'created_at'])
      .orderBy('created_at', 'desc')
      .execute().catch(() => []);

    return { 
      points, earned, redeemed, tier, tierThresholdPoints: 500, birthdayReward: true, referralReward: true,
      availableRewards: rewards.map((r: any) => ({ id: r.id, title: r.title, description: r.description, pointsCost: r.points_cost })),
      redemptions: redemptions.map((r: any) => ({ id: r.id, title: r.reward_title, pointsSpent: r.points_spent, createdAt: r.created_at }))
    };
  }

  async getLoyaltyLedger(ctx: CustomersContext, id: string): Promise<any[] | null> {
    if (!(await this.exists(ctx, id))) return null;
    // Phase 10: the ledger's canonical columns (540). `type` / `source` stay the finer legacy labels for the history list.
    // the columns the mapping below reads — a whole-row read hid behind the `as any` table name (check:response-exposure)
    const res = await this.db.selectFrom('loyalty_ledger')
      .select(['id', 'tenant_id', 'branch_id', 'customer_id', 'entry_type', 'type', 'delta', 'source', 'source_table', 'source_id', 'reference_id',
        'reason', 'description', 'actor_user_id', 'actor_id', 'balance_after', 'created_at'])
      .where('tenant_id', '=', ctx.tenantId)
      .where('customer_id', '=', id)
      .orderBy('created_at', 'desc')
      .execute();
    return res.map((r: any) => ({
      id: r.id, tenantId: r.tenant_id, branchId: r.branch_id, customerId: r.customer_id,
      entryType: r.entry_type, type: r.type ?? r.entry_type, amount: Number(r.delta), source: r.source, sourceTable: r.source_table ?? null,
      referenceId: r.source_id ?? r.reference_id ?? null, description: r.reason ?? r.description ?? null, reason: r.reason ?? null,
      actorId: r.actor_user_id ?? r.actor_id ?? null, runningBalance: Number(r.balance_after), balanceAfter: Number(r.balance_after),
      createdAt: r.created_at
    }));
  }

  /** The register's +/- points button: an `adjust` ledger entry (reason defaults to "Manual adjustment"). */
  async adjustLoyaltyPoints(ctx: CustomersContext, id: string, b: any): Promise<any | null> {
    if (!(await this.exists(ctx, id))) return null;
    const amount = Number(b.amount);
    if (isNaN(amount) || amount === 0 || !Number.isInteger(amount)) throw new Error('Invalid amount');
    return this.db.transaction().execute(async (trx) => {
      // Smooth Refresh spec §80 + Phase 10: the ledger service serialises per customer (two registers, or the first-ever
      // adjustment racing another, can no longer lose a change or create a second profile).
      const r = await applyLoyaltyEntry(trx as any, { tenantId: ctx.tenantId, branchId: ctx.branchId, customerId: id, entryType: 'adjust', delta: amount,
        reason: String(b.reason ?? '').trim() || 'Manual adjustment', actorUserId: ctx.userId, legacyType: 'manual_adjustment', legacySource: 'pos' });
      const p: any = (await sql`select total_earned_points, total_redeemed_points from customer_loyalty_profiles where tenant_id = ${ctx.tenantId} and customer_id = ${id} order by created_at limit 1`.execute(trx)).rows[0];
      return { points: r.balanceAfter, earned: Number(p?.total_earned_points ?? 0), redeemed: Number(p?.total_redeemed_points ?? 0) };
    });
  }

  /**
   * `PATCH /customers/:id/loyalty` (audit bug 3). It used to OVERWRITE points / earned / redeemed with no lock and no
   * ledger row. Now the requested points become ONE `adjust` entry (delta = requested − current, read under the
   * customer lock) carrying the required reason; earned / redeemed are the ledger's to keep, not the client's. The tier
   * is a label, not points, and is still set directly.
   */
  async setLoyalty(ctx: CustomersContext, id: string, l: CustomerLoyalty): Promise<CustomerLoyalty | null> {
    if (!(await this.exists(ctx, id))) return null;
    const reason = String((l as any).reason ?? '').trim();
    if (!reason) throw new LoyaltyLedgerError('A loyalty adjustment needs a reason', 'LOYALTY_INVALID_ENTRY');
    const target = Number(l.points);
    if (!Number.isInteger(target) || target < 0) throw new LoyaltyLedgerError('Points must be a whole number of 0 or more', 'LOYALTY_INVALID_ENTRY');
    return this.db.transaction().execute(async (trx) => {
      await lockLoyaltyCustomer(trx as any, ctx.tenantId, id);
      const cur: any = (await sql`select points_balance from customer_loyalty_profiles where tenant_id = ${ctx.tenantId} and customer_id = ${id} order by created_at limit 1`.execute(trx)).rows[0];
      const delta = target - Number(cur?.points_balance ?? 0);
      if (delta !== 0) await applyLoyaltyEntry(trx as any, { tenantId: ctx.tenantId, branchId: ctx.branchId, customerId: id, entryType: 'adjust', delta, reason,
        actorUserId: ctx.userId, legacyType: 'manual_set', legacySource: 'pos', newProfileTier: l.tier });
      else if (!cur) await trx.insertInto('customer_loyalty_profiles').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId, customer_id: id, loyalty_tier: l.tier || 'Regular', points_balance: 0, total_earned_points: 0, total_redeemed_points: 0 }).execute();
      if (l.tier) await sql`update customer_loyalty_profiles set loyalty_tier = ${l.tier}, vip_since = case when ${/vip/i.test(l.tier)} and vip_since is null then now() else vip_since end, updated_at = now()
        where tenant_id = ${ctx.tenantId} and customer_id = ${id}`.execute(trx);
      const p: any = (await sql`select loyalty_tier, points_balance, total_earned_points, total_redeemed_points from customer_loyalty_profiles where tenant_id = ${ctx.tenantId} and customer_id = ${id} order by created_at limit 1`.execute(trx)).rows[0];
      return { ...l, points: Number(p.points_balance), earned: Number(p.total_earned_points), redeemed: Number(p.total_redeemed_points), tier: String(p.loyalty_tier) };
    });
  }
  // ---- membership / gift cards: no schema (accepted/empty defaults) ----
  // ── MEMBERSHIP + GIFT CARDS (real — the tables existed all along) ──────────────────────────────────────
  //
  // These three used to be:
  //
  //     async getMembership(ctx, id) { return … ? defMembership() : null; }   ← A HARDCODED DEFAULT
  //     async setMembership(ctx, id, m) { return … ? m : null; }              ← ECHOED. STORED NOTHING.
  //     async getGiftCards(ctx, id) { return … ? [] : null; }                 ← ALWAYS EMPTY
  //
  // `customer_memberships` and `gift_cards` have BOTH existed the whole time, with their own modules writing to
  // them. This repository simply never read them.
  //
  // And `detail()` calls both. So the customer drawer showed "no gift cards" for a customer who HAD gift cards,
  // and a default membership status for a paying member. A guest hands over a gift card, the front desk looks
  // them up, and the screen says they have none. That is not a cosmetic bug; it is a money bug, and the customer
  // is standing there.
  async getMembership(ctx: CustomersContext, id: string): Promise<CustomerMembership | null> {
    if (!(await this.exists(ctx, id))) return null;
    const r: any = await sql`
      select m.status, m.started_at, m.current_period_end, p.name as plan_name
        from customer_memberships m
        left join membership_plans p on p.id = m.plan_id
       where m.tenant_id = ${ctx.tenantId} and m.customer_id = ${id}
       order by m.created_at desc limit 1`.execute(this.db).catch(() => null);
    const row = r?.rows?.[0];
    if (!row) return defMembership();     // genuinely not a member — and that is a FACT, not a placeholder

    // The engine has more states than this DTO does; collapse them honestly rather than inventing one.
    const st = String(row.status ?? '');
    const status: CustomerMembership['status'] =
      ['active', 'trial', 'comped', 'grace'].includes(st) ? 'active'
        : ['paused', 'suspended'].includes(st) ? 'paused'
          : ['canceled', 'cancelling', 'canceling', 'expired', 'completed'].includes(st) ? 'cancelled'
            : 'none';

    return {
      plan: String(row.plan_name ?? ''),
      status,
      startDate: row.started_at ? new Date(row.started_at).toISOString() : undefined,
      renewalDate: row.current_period_end ? new Date(row.current_period_end).toISOString() : undefined,
      benefits: [],
      billingStatus: st,
    };
  }

  /**
   * Membership is ENROLLED, not assigned.
   *
   * `customer_memberships` requires a plan_id AND an immutable plan_version_id, and the memberships module owns
   * the enrollment engine that assigns them along with the credit ledger and the billing schedule. A setter that
   * poked this table directly would create a member with no plan version, no ledger and no billing — a member the
   * billing job cannot see.
   *
   * It used to `return m` — echo the input and store nothing, so a UI wired to it would show a membership that
   * did not exist. It now REFUSES, loudly, which is the only honest thing a method can do when it cannot perform
   * the operation its name promises. Nothing calls it today; the next person to try gets an error, not a lie.
   */
  async setMembership(_ctx: CustomersContext, _id: string, _m: CustomerMembership): Promise<CustomerMembership | null> {
    // §163 run 3 (Oct 27 2026): a named refusal the controller answers 409 CONFLICT (a plain Error was a 500)
    throw Object.assign(new Error('Membership is enrolled through the memberships module (plan + plan version + ledger + billing), not set from the customer record.'), { name: 'MembershipNotSettableError' });
  }

  async getGiftCards(ctx: CustomersContext, id: string): Promise<any[] | null> {
    if (!(await this.exists(ctx, id))) return null;
    const r: any = await sql`
      select g.id, g.code, g.card_number_last4, g.balance_cents, g.status, (g.customer_id = ${id}) as purchased
        from gift_cards g
       where g.tenant_id = ${ctx.tenantId} and g.status not in ('pending_payment', 'draft')
         and (g.customer_id = ${id} or exists (select 1 from gift_card_recipients r where r.tenant_id = g.tenant_id and r.gift_card_id = g.id and r.customer_id = ${id}))
       order by g.created_at desc, g.id desc`.execute(this.db);   // Gift Cards guide (Nov 4 2026): a failed read is an error, never "no gift cards"

    const cards = r?.rows ?? [];
    if (cards.length === 0) return [];

    const cardIds = cards.map((c: any) => c.id);
    const txs: any = await sql`
      select id, gift_card_id, type, amount_cents, balance_after_cents, created_at, ticket_id
        from gift_card_transactions
       where tenant_id = ${ctx.tenantId} and gift_card_id in (${sql.join(cardIds)})
       order by created_at desc`.execute(this.db);
    const txRows = txs?.rows ?? [];

    return cards.map((g: any) => ({
      giftCardId: String(g.id),
      // Never the whole code on a lookup screen — the last four is enough to match the card in their hand.
      // Gift Cards mandate §16 (Oct 29 2026): the printed number's last four (what payments and receipts show), and whether
      // this customer bought the card or received it
      maskedCode: '••••' + String(g.card_number_last4 ?? String(g.code ?? '').slice(-4)),
      role: g.purchased ? 'purchaser' : 'recipient',
      balanceCents: Number(g.balance_cents ?? 0),
      status: String(g.status ?? ''),
      ledger: txRows.filter((t: any) => t.gift_card_id === g.id).map((t: any) => ({
        id: t.id, type: t.type, amountCents: Number(t.amount_cents), balanceAfterCents: Number(t.balance_after_cents), createdAt: t.created_at, ticketId: t.ticket_id
      }))
    }));
  }

  // ---- duplicates / merge (real reassignment + archive) ----
  /** Functional Decision 29 — Keep Separate / Not Sure decisions, keyed by ordered pair. */
  private async duplicateDecisions(ctx: CustomersContext): Promise<Map<string, string>> {
    const rows: any[] = await this.db.selectFrom('customer_duplicate_decisions').select(['customer_a', 'customer_b', 'decision'])
      .where('tenant_id', '=', ctx.tenantId).execute().catch(() => []);
    return new Map(rows.map((r) => [String(r.customer_a) + '|' + String(r.customer_b), String(r.decision)]));
  }
  private static pairKey(x: string, y: string) { return x < y ? x + '|' + y : y + '|' + x; }

  async duplicates(ctx: CustomersContext): Promise<DuplicateGroup[]> {
    const all = await this.load(ctx);
    const byId = new Map(all.map((c) => [c.customerId, c]));
    const decided = await this.duplicateDecisions(ctx);
    const groups = detectDuplicates(all.filter((c) => c.status !== 'archived').map((c) => ({ customerId: c.customerId, firstName: c.firstName, lastName: c.lastName, phone: c.phone, email: c.email })));
    const out: DuplicateGroup[] = [];
    for (const g of groups) {
      const ids = g.members.map((m) => m.customerId);
      const pairs: string[] = []; for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairs.push(KyselyCustomersRepository.pairKey(ids[i], ids[j]));
      // Decision 29: a group whose every pair was judged KEEP SEPARATE leaves the queue for good; NOT SURE stays, flagged.
      if (pairs.length && pairs.every((k) => decided.get(k) === 'keep_separate')) continue;
      out.push({
        ...g, notSure: pairs.some((k) => decided.get(k) === 'not_sure'),
        members: g.members.map((m) => {
          const c = byId.get(m.customerId);
          return c ? { ...m, status: c.status, visitCount: c.visitCount, totalSpendCents: c.totalSpendCents, loyaltyPoints: c.loyaltyPoints, loyaltyTier: c.loyaltyTier, createdAt: c.createdAt, tags: c.tags } : m;
        }),
      } as DuplicateGroup);
    }
    return out;
  }

  /** Functional Decision 29 — remember Keep Separate / Not Sure for every pair in the group (idempotent). */
  async decideDuplicate(ctx: CustomersContext, groupId: string, decision: 'keep_separate' | 'not_sure'): Promise<boolean> {
    const group = (await this.duplicates(ctx)).find((g) => g.duplicateGroupId === groupId); if (!group) return false;
    const ids = group.members.map((m) => m.customerId);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const [x, y] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
      await sql`insert into customer_duplicate_decisions (tenant_id, customer_a, customer_b, decision, decided_by, decided_at)
        values (${ctx.tenantId}, ${x}, ${y}, ${decision}, ${/^[0-9a-f-]{36}$/i.test(String(ctx.userId)) ? ctx.userId : null}, now())
        on conflict (tenant_id, customer_a, customer_b) do update set decision = excluded.decision, decided_by = excluded.decided_by, decided_at = now()`.execute(this.db);
    }
    return true;
  }

  /**
   * Merge a confirmed duplicate group into the primary profile — ONE transaction (Functional Decision 29).
   * Before Oct 1 2026 this moved only tickets / appointments / reviews and archived the rest, with every step's error
   * swallowed: the merged-away profile's LOYALTY POINTS, MEMBERSHIPS, GIFT CARDS and SAVED CARDS stayed on an archived
   * profile (the customer effectively lost them), a failure half-way left a half-merged customer, and nothing was logged.
   * Now everything a customer owns moves to the primary, loyalty balances are consolidated under the per-customer loyalty
   * lock, unique per-customer rows (tags) skip what the primary already has, and a customer_merge_logs row records it.
   */
  async merge(ctx: CustomersContext, groupId: string, primaryId: string): Promise<POSCustomerDetail | null> {
    const group = (await this.duplicates(ctx)).find((g) => g.duplicateGroupId === groupId); if (!group) return null;
    if (!group.members.some((m) => m.customerId === primaryId)) return null;
    const others = group.members.map((m) => m.customerId).filter((cid) => cid !== primaryId);
    if (!others.length) return this.detail(ctx, primaryId);
    // Nov 2 2026: the transaction body is the shared canonical merge (customer-merge.ts) — the Duplicate Review
    // workspace runs exactly the same code.
    await this.db.transaction().execute((trx) => mergeCustomersTx(trx as unknown as Kysely<any>, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId }, primaryId, others, { groupId }, this.outbox));
    return this.detail(ctx, primaryId);
  }

  async exportRows(ctx: CustomersContext, f: CustomerFilters): Promise<{ headers: string[]; rows: (string | number)[][] }> {
    const all = await this.load(ctx); const dup = this.dupSet(all); const rows = this.filtered(all, f, dup, await this.riskDays(ctx));
    return { headers: ['Id', 'Name', 'Phone', 'Email', 'Status', 'Source', 'Visits', 'TotalSpend', 'Tier', 'VIP', 'MarketingOptIn'], rows: rows.map((c) => [c.customerId, `${c.firstName} ${c.lastName}`, c.phone, c.email, c.status, c.source, c.visitCount, c.totalSpendCents, c.loyaltyTier, c.isVip ? 'yes' : 'no', c.marketingOptIn ? 'yes' : 'no']) };
  }
}
