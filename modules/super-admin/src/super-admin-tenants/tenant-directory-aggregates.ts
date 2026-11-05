// Tenant-directory aggregation layer — AIPowerSalon Super Admin (spec §7 KPIs, §13/§14/§18 distributions,
// §15 growth, §36 reconciliation). Phase 2a.
//
// PURE + DETERMINISTIC. Derives the Tenants page's headline analytics from the SAME canonical
// `TenantRecord[]` that `/super-admin/tenants/state` already lists — so the KPI cards, the plan and
// status donuts, the health distribution, and the table all reconcile by construction (§36): every
// count here is computed over the identical record set the directory paginates.
//
// Reuse, not duplication:
//   • per-tenant health   → scoreTenantHealth (Phase 1 engine)
//   • billing / merchant / onboarding signals → derivePaymentLabel / derivePaymentSetup / isSetupComplete
//   • revenue rankings (Revenue-by-Tenant, Top-Performing) are NOT recomputed here — the screen already
//     calls the existing `topPerformingTenants` endpoint (ranked monthly card volume + growth%).
//
// Honest gaps: two KPIs (Active POS Devices, Open Support Tickets) and one alert (subscriptions expiring
// in 7 days) have no field on TenantRecord. They are returned as `null` / `available:false` here and get
// real sources in Phase 2b (devices repo, tickets repo, renewal dates) rather than being fabricated.

import {
  type TenantRecord,
  derivePaymentLabel,
  derivePaymentSetup,
  isSetupComplete,
} from './super-admin-tenants-core';
import { scoreTenantHealth, type TenantHealthSignals, type HealthBand, type ChurnRisk } from '../super-admin-tenant-health/tenant-health-score';

export interface DistributionSlice { key: string; label: string; count: number; pct: number }
export interface GrowthPoint { month: string; label: string; totalTenants: number }
export interface HealthAlert { key: string; label: string; count: number; available: boolean }

export interface TenantDirectoryKpis {
  totalTenants: number;
  activeTenants: number;
  trialTenants: number;
  pendingApprovals: number;
  suspendedTenants: number;
  enterpriseTenants: number;
  totalBranches: number;
  totalCustomers: number;
  monthlyRevenueCents: number;
  churnRiskHigh: number;
  overduePayments: number;
  /** Honest-null until Phase 2b wires the device fleet + ticket queue. */
  activePosDevices: number | null;
  openSupportTickets: number | null;
}

export interface TenantDirectoryAggregates {
  kpis: TenantDirectoryKpis;
  planDistribution: DistributionSlice[];
  statusDistribution: DistributionSlice[];
  healthDistribution: DistributionSlice[];
  healthAlerts: HealthAlert[];
  growthTrend: GrowthPoint[];
  /** Documented definitions so the UI can label modules honestly. */
  meta: { growthDefinition: string; revenueDefinition: string };
}

const pct = (count: number, total: number) => (total > 0 ? Math.round((count / total) * 1000) / 10 : 0);
const titleCase = (s: string) => s.replace(/\b\w/g, (m) => m.toUpperCase());

/** Mutually-exclusive bucket for KPI + status donut: trialing wins over active so buckets sum to total. */
function statusBucket(t: TenantRecord): { key: string; label: string } {
  if (t.subscriptionStatus === 'trialing') return { key: 'trial', label: 'Trial' };
  switch (t.storedStatus) {
    case 'active': return { key: 'active', label: 'Active' };
    case 'pending': return { key: 'pending', label: 'Pending' };
    case 'suspended': return { key: 'suspended', label: 'Suspended' };
    case 'cancelled': return { key: 'cancelled', label: 'Cancelled' };
    default: return { key: 'active', label: 'Active' };
  }
}

/** Normalize a free-text plan name ('Gold Plan', 'enterprise') to a stable key + display label. */
function planBucket(plan: string): { key: string; label: string } {
  const raw = (plan || '').trim();
  if (!raw) return { key: 'none', label: 'Unassigned' };
  const label = titleCase(raw.replace(/\bplan\b/i, '').trim()) || titleCase(raw);
  return { key: label.toLowerCase().replace(/\s+/g, '_'), label };
}

const HEALTH_BAND_LABEL: Record<HealthBand, string> = {
  excellent: 'Excellent (90–100)', good: 'Good (70–89)', average: 'Average (50–69)',
  poor: 'Poor (30–49)', critical: 'Critical (0–29)', unrated: 'Not yet rated',
};

/** Map a TenantRecord onto the health engine's signal inputs, reusing existing derivations.
 *  Signals not present on TenantRecord (live devices, appts, tickets, login recency) are left null —
 *  the engine treats null as "unknown" (neutral), never as a fabricated good/bad value. Phase 2b enriches. */
export function signalsFromRecord(t: TenantRecord): TenantHealthSignals {
  const billing = derivePaymentLabel(t.subscriptionStatus); // 'Current' | 'Past Due' | 'Trial'
  const onboardingFrac = isSetupComplete(t)
    ? 1
    : (t.branchCount > 0 ? 0.34 : 0) + (t.fiservConfigured ? 0.33 : 0) + (t.ownerActivated ? 0.33 : 0);
  return {
    status: t.subscriptionStatus === 'trialing' ? 'trial' : t.storedStatus,
    billingStatus: billing === 'Past Due' ? 'past_due' : billing === 'Trial' ? 'trial' : 'current',
    daysSinceLastLogin: null,
    daysSinceLastActivity: null,
    activeDeviceCount: null,
    appointmentsLast30: null,
    paymentVolumeCentsLast30: t.monthlyRevenueCents,
    openTickets: null,
    merchantSetup: derivePaymentSetup(t), // 'complete' | 'pending' | 'failed' | 'incomplete'
    onboardingCompletion: onboardingFrac,
    integrationHealth: t.fiservConfigured ? 'healthy' : 'none',
  };
}

export function buildTenantDirectoryAggregates(
  records: TenantRecord[],
  opts: { now?: number } = {},
): TenantDirectoryAggregates {
  const total = records.length;
  const now = opts.now ?? Date.now();

  // Per-tenant health (single pass) drives the distribution, the churn KPI, and the alert count.
  const health = records.map((t) => scoreTenantHealth(signalsFromRecord(t)));

  // ---- Status distribution + status-derived KPIs (mutually exclusive → sum to total) ----
  const statusMap = new Map<string, DistributionSlice>();
  for (const t of records) {
    const b = statusBucket(t);
    const cur = statusMap.get(b.key) || { key: b.key, label: b.label, count: 0, pct: 0 };
    cur.count++; statusMap.set(b.key, cur);
  }
  const statusDistribution = [...statusMap.values()].map((s) => ({ ...s, pct: pct(s.count, total) }))
    .sort((a, b) => b.count - a.count);
  const statusCount = (k: string) => statusMap.get(k)?.count ?? 0;

  // ---- Plan distribution + enterprise KPI ----
  const planMap = new Map<string, DistributionSlice>();
  for (const t of records) {
    const b = planBucket(t.plan);
    const cur = planMap.get(b.key) || { key: b.key, label: b.label, count: 0, pct: 0 };
    cur.count++; planMap.set(b.key, cur);
  }
  const planDistribution = [...planMap.values()].map((s) => ({ ...s, pct: pct(s.count, total) }))
    .sort((a, b) => b.count - a.count);
  const enterpriseTenants = records.filter((t) => /enterprise/i.test(t.plan || '')).length;

  // ---- Health distribution (5 bands + not-yet-rated) ----
  const bandOrder: HealthBand[] = ['excellent', 'good', 'average', 'poor', 'critical', 'unrated'];
  const bandCount = new Map<HealthBand, number>();
  for (const h of health) bandCount.set(h.band, (bandCount.get(h.band) ?? 0) + 1);
  const healthDistribution = bandOrder
    .filter((b) => (bandCount.get(b) ?? 0) > 0)
    .map((b) => ({ key: b, label: HEALTH_BAND_LABEL[b], count: bandCount.get(b) ?? 0, pct: pct(bandCount.get(b) ?? 0, total) }));

  const churnCount = (r: ChurnRisk) => health.filter((h) => h.churnRisk === r).length;
  const overduePayments = records.filter((t) => t.subscriptionStatus === 'past_due' || t.subscriptionStatus === 'expired').length;

  // ---- KPIs (10 derived real; 2 honest-null until 2b) ----
  const kpis: TenantDirectoryKpis = {
    totalTenants: total,
    activeTenants: statusCount('active'),
    trialTenants: statusCount('trial'),
    pendingApprovals: statusCount('pending'),
    suspendedTenants: statusCount('suspended'),
    enterpriseTenants,
    totalBranches: records.reduce((a, t) => a + (t.branchCount || 0), 0),
    totalCustomers: records.reduce((a, t) => a + (t.customers?.[0] || 0), 0),
    monthlyRevenueCents: records.reduce((a, t) => a + (t.monthlyRevenueCents || 0), 0),
    churnRiskHigh: churnCount('high'),
    overduePayments,
    activePosDevices: null, // Phase 2b: device fleet repo
    openSupportTickets: null, // Phase 2b: tickets repo
  };

  // ---- Health alerts (derivable now; renewal-based one is honestly unavailable) ----
  const healthAlerts: HealthAlert[] = [
    { key: 'high_churn_risk', label: 'tenants at high churn risk', count: kpis.churnRiskHigh, available: true },
    { key: 'subscriptions_expiring_7d', label: 'subscriptions expiring in 7 days', count: 0, available: false },
    { key: 'overdue_payments', label: 'tenants with overdue payments', count: overduePayments, available: true },
    { key: 'pending_onboarding', label: 'pending onboarding approvals', count: kpis.pendingApprovals, available: true },
  ];

  // ---- Growth trend: cumulative total tenants at each of the last 12 month-ends (§15 definition labeled) ----
  const createdAt = (t: TenantRecord) => now - (t.createdDaysAgo || 0) * 86_400_000;
  const growthTrend: GrowthPoint[] = [];
  const base = new Date(now);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i + 1, 0, 23, 59, 59, 999); // last day of that month
    const boundary = d.getTime();
    const count = records.reduce((a, t) => a + (createdAt(t) <= boundary ? 1 : 0), 0);
    growthTrend.push({
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleString('en-US', { month: 'short' }),
      totalTenants: count,
    });
  }

  return {
    kpis,
    planDistribution,
    statusDistribution,
    healthDistribution,
    healthAlerts,
    growthTrend,
    meta: {
      growthDefinition: 'Total tenants existing at each month-end (cumulative).',
      revenueDefinition: 'Monthly Revenue = sum of per-tenant monthlyRevenueCents (completed card volume this month, integer cents).',
    },
  };
}
