/**
 * overview.kysely.repository.ts — Postgres (Kysely) OverviewDataPort.
 *
 * Every metric is its own resilient query: a missing column/table degrades THAT metric to 0/empty (via `.catch`),
 * never crashing the whole Overview. No fabricated numbers — zeros mean "no data / not yet wired", which the frontend
 * renders as an empty state. Sources: tenants, branches, tenant_applications, tenant_payment_config,
 * tenant_daily_sales_summary, support_access_sessions, hardware_packages, hardware_payment_invoices, users,
 * technicians, customers, appointments, audit_logs, payment_gateway_events.
 */
import { type DB, andTenant, tenantPred, type OverviewScope } from '@aipowersalon/database';
import { sql, type Kysely } from 'kysely';
import type { OverviewDataPort } from './overview.repository';
import { EMPTY_FACTS } from './overview.repository';
import { activityPresentation } from './overview-core';
import type { OverviewFacts, Range, SalesPoint, Severity, AlertItem, ActivityItem } from './overview.dto';

type Row = Record<string, any>;
const num = (x: any) => Number(x ?? 0) || 0;

function ageLabel(d: Date | string | null): string {
  if (!d) return 'recently';
  const t = new Date(d).getTime(); if (Number.isNaN(t)) return 'recently';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export class KyselyOverviewRepository implements OverviewDataPort {
  constructor(private readonly db: Kysely<DB>) {}

  private async rows(q: ReturnType<typeof sql>): Promise<Row[]> {
    try { return (await q.execute(this.db)).rows as Row[]; } catch { return []; }
  }
  private async scalar(q: ReturnType<typeof sql>, key = 'n'): Promise<number> {
    const r = await this.rows(q); return r.length ? num(r[0][key]) : 0;
  }

  private rangeSql(range: Range): { bucket: string; since: string } {
    switch (range) {
      case 'day': return { bucket: "to_char(date_trunc('day', created_at), 'Mon DD')", since: "now() - interval '30 days'" };
      case 'week': return { bucket: "to_char(date_trunc('week', created_at), 'Mon DD')", since: "now() - interval '12 weeks'" };
      case 'year': return { bucket: "to_char(date_trunc('year', created_at), 'YYYY')", since: "now() - interval '5 years'" };
      case 'month':
      default: return { bucket: "to_char(date_trunc('month', created_at), 'Mon')", since: "now() - interval '12 months'" };
    }
  }

  async getFacts(range: Range, scope?: OverviewScope): Promise<OverviewFacts> {
    // Operational facts (card volume, sales series, top tenants, per-tenant KPIs, recent activity) honor an optional
    // single-tenant scope. Governance facts (tenant counts, applications, payment-setup, support, hardware) and the
    // alerts derived from them stay platform-wide by design — scoping to one salon should not change platform health.
    const f: OverviewFacts = { ...EMPTY_FACTS, salesSeries: [], tenantStatusCounts: [], hardwareStatusCounts: [], topTenants: [], recentApplications: [], recentActivity: [], recentAlertsRaw: [] };

    // --- tenant status + active salons ---
    const statusRows = await this.rows(sql`select status, count(*)::int n from tenants group by status order by n desc`);
    f.tenantStatusCounts = statusRows.map((r) => ({ status: String(r.status ?? 'unknown'), count: num(r.n) }));
    f.activeSalons = f.tenantStatusCounts.find((s) => s.status === 'active')?.count ?? 0;
    f.pausedTenants = f.tenantStatusCounts.find((s) => s.status === 'suspended')?.count ?? 0;
    f.trialTenants = await this.scalar(sql`select count(distinct tenant_id)::int n from tenant_subscriptions where status = 'trialing'`);

    // --- pending applications + payment setup needed ---
    f.newApplications = await this.scalar(sql`select count(*)::int n from tenant_applications where status in ('new','reviewing')`);
    f.paymentSetupNeeded = await this.scalar(sql`
      select count(*)::int n from tenants t
      where not exists (select 1 from tenant_payment_config c where c.tenant_id = t.id and coalesce(c.status,'') in ('active','live','complete'))`);

    // --- card volume: current vs prior calendar month ---
    f.monthlyCardVolumeCents = await this.scalar(sql`select coalesce(sum(revenue_cents),0)::bigint n from tenant_daily_sales_summary where created_at >= date_trunc('month', now()) ${andTenant(scope)}`);
    f.priorMonthCardVolumeCents = await this.scalar(sql`select coalesce(sum(revenue_cents),0)::bigint n from tenant_daily_sales_summary where created_at >= date_trunc('month', now()) - interval '1 month' and created_at < date_trunc('month', now()) ${andTenant(scope)}`);

    // --- sales series for the requested range ---
    const { bucket, since } = this.rangeSql(range);
    const seriesRows = await this.rows(sql`
      select ${sql.raw(bucket)} as label, coalesce(sum(revenue_cents),0)::bigint v,
             min(created_at) as ord
      from tenant_daily_sales_summary
      where created_at >= ${sql.raw(since)} ${andTenant(scope)}
      group by 1 order by ord asc`);
    f.salesSeries = seriesRows.map((r): SalesPoint => ({ label: String(r.label ?? ''), valueCents: num(r.v) }));

    // --- open support sessions (mapped to "open support tickets") ---
    // Constitution 7: one Support Mode store (the legacy View POS rows were merged in by migration 541)
    f.openSupportSessions = await this.scalar(sql`select count(*)::int n from support_access_sessions where ended_at is null and expires_at > now()`);

    // --- system health: 100% unless recent gateway errors (real signal, floored at 90%) ---
    const gwErrors = await this.scalar(sql`select count(*)::int n from payment_gateway_events where created_at > now() - interval '24 hours' and (coalesce(event_type,'') ilike '%error%' or coalesce(event_type,'') ilike '%fail%' or last_error is not null or signature_valid = false)`);   // w4 sweep SW-13: there is no status column — the old predicate failed every time and health read 100%
    f.systemHealthPercent = gwErrors > 0 ? Math.max(90, Math.round((100 - Math.min(gwErrors, 10) * 1) * 10) / 10) : 100;
    f.systemHealthLabel = gwErrors > 0 ? `${gwErrors} gateway issue${gwErrors === 1 ? '' : 's'} (24h)` : 'All Systems Online';

    // --- hardware status + summary ---
    const hwRows = await this.rows(sql`select status, count(*)::int n from hardware_packages group by status order by n desc`);
    f.hardwareStatusCounts = hwRows.map((r) => ({ status: String(r.status ?? 'unknown'), count: num(r.n) }));
    const hwAgg = (await this.rows(sql`
      select
        count(*) filter (where status = 'pending_approval')::int pending,
        count(*) filter (where status in ('ordered','in_transit','ready_to_ship','ready'))::int ordered,
        count(*) filter (where delivered_at is not null or status = 'delivered')::int delivered,
        count(*) filter (where activated_at is not null or status = 'activated')::int activated,
        count(*) filter (where imac_serial is not null)::int imac,
        count(*) filter (where clover_flex_serial is not null)::int clover,
        count(*) filter (where checkin_display_serial is not null)::int checkin
      from hardware_packages`))[0] ?? {};
    const outstanding = await this.scalar(sql`select coalesce(sum(shortfall_cents),0)::bigint n from hardware_payment_invoices where coalesce(status,'') <> 'paid'`);
    f.hardwareSummary = {
      pending: num(hwAgg.pending), ordered: num(hwAgg.ordered), delivered: num(hwAgg.delivered), activated: num(hwAgg.activated),
      outstandingBalanceCents: outstanding,
      byType: { imac: num(hwAgg.imac), cloverFlex: num(hwAgg.clover), checkinDisplay: num(hwAgg.checkin) },
    };

    // --- top performing tenants (current month, vs prior for growth) ---
    const topRows = await this.rows(sql`
      with cur as (select tenant_id, sum(revenue_cents) v from tenant_daily_sales_summary where created_at >= date_trunc('month', now()) ${andTenant(scope)} group by tenant_id),
           prev as (select tenant_id, sum(revenue_cents) v from tenant_daily_sales_summary where created_at >= date_trunc('month', now()) - interval '1 month' and created_at < date_trunc('month', now()) ${andTenant(scope)} group by tenant_id)
      select c.tenant_id, c.v::bigint cur, coalesce(p.v,0)::bigint prev, t.display_name as name,
             (select city from branches b where b.tenant_id = c.tenant_id order by created_at asc limit 1) as city,
             (select state from branches b where b.tenant_id = c.tenant_id order by created_at asc limit 1) as state
      from cur c join tenants t on t.id = c.tenant_id
      left join prev p on p.tenant_id = c.tenant_id
      order by c.v desc limit 5`);
    f.topTenants = topRows.map((r, i) => ({
      rank: i + 1, tenantId: String(r.tenant_id), name: String(r.name ?? 'Tenant'), city: r.city ?? null, state: r.state ?? null,
      monthlyVolumeCents: num(r.cur),
      growthPercent: num(r.prev) > 0 ? Math.round(((num(r.cur) - num(r.prev)) / num(r.prev)) * 1000) / 10 : null,
    }));

    // --- recent applications table ---
    const appRows = await this.rows(sql`select id, salon_name, owner_name, city, state, phone, status, created_at from tenant_applications order by created_at desc limit 6`);
    f.recentApplications = appRows.map((r) => ({
      id: String(r.id), salonName: String(r.salon_name ?? ''), owner: String(r.owner_name ?? ''), city: r.city ?? null,
      state: r.state ?? null, phone: r.phone ?? null, status: String(r.status ?? 'new'),
      date: r.created_at ? new Date(r.created_at).toISOString() : '',
    }));

    // --- platform KPIs ---
    f.platformKpis = {
      activeUsers: await this.scalar(sql`select count(*)::int n from users where status = 'active' ${andTenant(scope)}`),   // w4 sweep SW-13: users has no is_active column
      totalLocations: await this.scalar(sql`select count(*)::int n from branches where ${tenantPred(scope)}`),
      technicians: await this.scalar(sql`select count(*)::int n from technicians where ${tenantPred(scope)}`),
      customers: await this.scalar(sql`select count(*)::int n from customers where ${tenantPred(scope)}`),
      totalAppointments: await this.scalar(sql`select count(*)::int n from pos_tech_appointments where ${tenantPred(scope)}`),
      aiInteractions: 0, // no ai_usage_events table — honest 0 (see blockers)
    };
    f.aiInteractionsAvailable = false;

    // --- recent activity (presentation layer over audit_logs; real names, per-event icon/title) ---
    const actRows = await this.rows(sql`
      select al.id, al.action_type as action, al.entity_type, al.tenant_id, al.created_at, t.display_name as tenant_name
      from audit_logs al left join tenants t on t.id = al.tenant_id
      where ${tenantPred(scope, 'al.tenant_id')}
      order by al.created_at desc limit 8`);
    f.recentActivity = actRows.map((r): ActivityItem => {
      const action = String(r.action ?? 'event');
      const sev: Severity = /fail|error|declin/i.test(action) ? 'error' : /complete|success|activ|approv/i.test(action) ? 'success' : /pending|warn|shortfall|pause|suspend/i.test(action) ? 'warning' : 'info';
      const p = activityPresentation(action);
      return { id: String(r.id), icon: p.icon, title: p.title, tenantName: r.tenant_name ? String(r.tenant_name) : null, message: String(r.entity_type ?? '').replace(/_/g, ' '), ageLabel: ageLabel(r.created_at), severity: sev };
    });

    // --- recent alerts (derived from live counts) ---
    const alerts: AlertItem[] = [];
    if (f.newApplications > 0) alerts.push({ id: 'a_apps', severity: 'warning', title: `${f.newApplications} new tenant application${f.newApplications === 1 ? '' : 's'}`, message: 'Needs review', ageLabel: 'today', to: '/tenant-applications' });
    if (f.paymentSetupNeeded > 0) alerts.push({ id: 'a_pay', severity: 'warning', title: `${f.paymentSetupNeeded} salon${f.paymentSetupNeeded === 1 ? '' : 's'} need payment setup`, message: 'Action required', ageLabel: 'today', to: '/payment-gateways' });
    if (f.hardwareSummary.pending > 0) alerts.push({ id: 'a_hw', severity: 'info', title: `${f.hardwareSummary.pending} hardware package${f.hardwareSummary.pending === 1 ? '' : 's'} pending`, message: 'Ready to ship', ageLabel: 'today', to: '/hardware-packages' });
    if (gwErrors > 0) alerts.push({ id: 'a_gw', severity: 'error', title: `${gwErrors} payment gateway error${gwErrors === 1 ? '' : 's'}`, message: 'Check immediately', ageLabel: '24h', to: '/payment-gateways' });
    if (f.openSupportSessions > 0) alerts.push({ id: 'a_sup', severity: 'info', title: `${f.openSupportSessions} active support session${f.openSupportSessions === 1 ? '' : 's'}`, message: 'In progress', ageLabel: 'now', to: '/support-access' });
    f.recentAlertsRaw = alerts;

    // --- trend baselines ---
    // Total Tenants prior month is exact from created_at (tenants created before this month = the total as of last month).
    f.trendBaselines = {
      totalTenantsPrior: await this.scalar(sql`select count(*)::int n from tenants where created_at < date_trunc('month', now())`),
      activeSalonsPrior: null, newApplicationsPrior: null, paymentSetupPrior: null, openSupportPrior: null, pausedTenantsPrior: null, trialTenantsPrior: null,
    };
    // State-based baselines (active salons / pending apps / payment-setup / support) are only accurate from a monthly
    // snapshot — read last month's snapshot if the analytics table has one; otherwise stay null (never a faked arrow).
    try {
      const prev = await this.rows(sql`
        select active_salons, pending_applications, payment_setup_needed, open_support_tickets
        from overview_monthly_snapshots
        where month = to_char(date_trunc('month', now()) - interval '1 month', 'YYYY-MM')
        order by created_at desc limit 1`);
      if (prev[0]) {
        f.trendBaselines.activeSalonsPrior = num(prev[0].active_salons);
        f.trendBaselines.newApplicationsPrior = num(prev[0].pending_applications);
        f.trendBaselines.paymentSetupPrior = num(prev[0].payment_setup_needed);
        f.trendBaselines.openSupportPrior = num(prev[0].open_support_tickets);
        f.trendBaselines.pausedTenantsPrior = prev[0].paused_tenants == null ? null : num(prev[0].paused_tenants);
        f.trendBaselines.trialTenantsPrior = prev[0].trial_tenants == null ? null : num(prev[0].trial_tenants);
      }
    } catch { /* snapshot table not present yet → baselines stay null */ }
    return f;
  }

  /** Captures the current month's KPI values into overview_monthly_snapshots (idempotent per month). Drives accurate
   *  month-over-month trends for state-based metrics from next month onward. Called by POST /super-admin/overview/snapshot. */
  async captureMonthlySnapshot(f: OverviewFacts): Promise<void> {
    const total = f.tenantStatusCounts.reduce((a, b) => a + (b.count || 0), 0);
    await sql`
      insert into overview_monthly_snapshots (id, month, total_tenants, active_salons, paused_tenants, trial_tenants, pending_applications, payment_setup_needed, monthly_card_volume_cents, open_support_tickets, system_health_percent)
      values (gen_random_uuid(), to_char(date_trunc('month', now()), 'YYYY-MM'), ${total}, ${f.activeSalons}, ${f.pausedTenants}, ${f.trialTenants}, ${f.newApplications}, ${f.paymentSetupNeeded}, ${f.monthlyCardVolumeCents}, ${f.openSupportSessions}, ${f.systemHealthPercent})
      on conflict (month) do update set total_tenants=excluded.total_tenants, active_salons=excluded.active_salons,
        paused_tenants=excluded.paused_tenants, trial_tenants=excluded.trial_tenants,
        pending_applications=excluded.pending_applications, payment_setup_needed=excluded.payment_setup_needed,
        monthly_card_volume_cents=excluded.monthly_card_volume_cents, open_support_tickets=excluded.open_support_tickets,
        system_health_percent=excluded.system_health_percent, updated_at=now()
    `.execute(this.db);
  }
}
