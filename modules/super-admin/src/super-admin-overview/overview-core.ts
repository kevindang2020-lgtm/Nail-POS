// overview-core.ts — pure assembly of the Super-Admin Overview from raw facts. No DB, no Nest — unit-testable.
// All money is integer cents. Percentages are rounded to one decimal. Trends are month-over-month deltas.

import type { OverviewFacts, OverviewState, StatusSlice } from './overview.dto';
import { isPlatformPrincipal } from '@aipowersalon/permissions';

const STATUS_LABELS: Record<string, string> = {
  active: 'Active', pending: 'Pending Setup', pending_setup: 'Pending Setup', suspended: 'On Hold',
  on_hold: 'On Hold', inactive: 'Inactive', cancelled: 'Cancelled', trialing: 'Trialing',
};
const HW_STATUS_LABELS: Record<string, string> = {
  delivered: 'Delivered', in_transit: 'In Transit', ready_to_ship: 'Ready to Ship', ready: 'Ready to Ship',
  pending: 'Pending', cancelled: 'Cancelled', ordered: 'Ordered', activated: 'Activated',
};

export function pctDelta(current: number, prior: number | null): number | null {
  if (prior == null || prior === 0) return null;
  return Math.round(((current - prior) / prior) * 1000) / 10;
}

/**
 * Maps an audit_logs action to a dashboard-friendly icon + title for the Recent Tenant Activity feed.
 * Pure + tested. The activity feed is a presentation layer over audit_logs (no separate activity table).
 */
export function activityPresentation(action: string): { icon: string; title: string } {
  const a = (action || '').toLowerCase();
  const map: Array<[RegExp, string, string]> = [
    [/onboarding_complete/, '✅', 'Onboarding completed'],
    [/tenant_(created|registered)|tenant_created_from_application/, '🟢', 'New tenant registered'],
    [/tenant_(activated|reactivated)/, '🟢', 'Tenant activated'],
    [/tenant_(paused|suspended)/, '⏸️', 'Tenant paused'],
    [/tenant_cancelled/, '🚫', 'Tenant cancelled'],
    [/payment_setup_complete|gateway_connected|payment_gateway.*connect/, '💳', 'Payment setup completed'],
    [/payment_setup_fail|payment_fail|declin/, '⚠️', 'Payment failed'],
    [/payment_retry/, '🔁', 'Payment retry scheduled'],
    [/gateway.*(disconnect|error)/, '⚠️', 'Payment gateway issue'],
    [/billing_updated/, '🧾', 'Billing updated'],
    [/hardware.*ship/, '📦', 'Hardware shipped'],
    [/hardware.*deliver/, '🚚', 'Hardware delivered'],
    [/hardware.*(install|complete|activ)/, '🖥️', 'Hardware installed'],
    [/hardware.*(order|created|recalc|return|cancel)/, '📦', 'Hardware updated'],
    [/ai_.*limit/, '🤖', 'AI usage limit reached'],
    [/ai_package_activ|ai_receptionist|ai_.*enabled/, '🤖', 'AI package activated'],
    [/upgraded_to_enterprise/, '⬆️', 'Plan upgraded to Enterprise'],
    [/plan_upgraded|plan_upgrade|subscription_upgraded/, '⬆️', 'Plan upgraded'],
    [/plan_downgraded|plan_downgrade|subscription_downgraded/, '⬇️', 'Plan downgraded'],
    [/subscription_(created|started)/, '🧾', 'Subscription created'],
    [/subscription_(cancel|expired)/, '🚫', 'Subscription cancelled'],
    [/subscription_updated|billing_updated/, '🧾', 'Billing updated'],
    [/application.*(approv|convert)/, '✅', 'Application approved'],
    [/application.*(submit|created)/, '📋', 'Application submitted'],
    [/lead_/, '🧲', 'Lead activity'],
    [/support_(access|session)/, '🎧', 'Support access opened'],
    [/support_ticket/, '🎧', 'Support ticket opened'],
    [/warning_sent/, '⚠️', 'Warning sent'],
    [/owner_password_reset/, '🔑', 'Owner password reset'],
  ];
  for (const [re, icon, title] of map) if (re.test(a)) return { icon, title };
  return { icon: '📌', title: (action || 'activity').replace(/_/g, ' ').replace(/\bsuper admin\b/i, '').trim() || 'Activity' };
}

function toSlices(counts: { status: string; count: number }[], labels: Record<string, string>): StatusSlice[] {
  const total = counts.reduce((a, b) => a + (b.count || 0), 0);
  return counts.map((c) => ({
    status: c.status,
    label: labels[c.status] ?? (c.status ? c.status[0].toUpperCase() + c.status.slice(1) : 'Unknown'),
    count: c.count || 0,
    percent: total > 0 ? Math.round(((c.count || 0) / total) * 1000) / 10 : 0,
  }));
}

const QUICK_ACTIONS = [
  'super_admin.tenants.create', 'super_admin.leads.create', 'super_admin.hardware.assign',
  'super_admin.payments.configure', 'super_admin.reports.view', 'super_admin.support_access.start',
  'super_admin.settings.manage', 'super_admin.system_health.view',
] as const;

/** SUPER_ADMIN holds every platform permission; anyone else holds none (the guard already blocks non-super-admins). */
export function quickActionsPermissions(role: string | null | undefined): Record<string, boolean> {
  const isSa = isPlatformPrincipal(role);
  return Object.fromEntries(QUICK_ACTIONS.map((p) => [p, isSa]));
}

export function buildOverview(facts: OverviewFacts, role: string | null | undefined): OverviewState {
  const tenantsByStatus = toSlices(facts.tenantStatusCounts, STATUS_LABELS);
  const totalTenants = facts.tenantStatusCounts.reduce((a, b) => a + (b.count || 0), 0);
  const hardwarePackageStatus = toSlices(facts.hardwareStatusCounts, HW_STATUS_LABELS);

  const blockers: { module: string; reason: string }[] = [];
  if (!facts.aiInteractionsAvailable) blockers.push({ module: 'platformKpis.aiInteractions', reason: 'No ai_usage_events table yet; AI Interactions reports 0 until an AI usage source is wired.' });
  blockers.push({ module: 'kpis.openSupportTickets', reason: 'No support-ticket system; mapped to active Super-Admin support sessions (support_access_sessions).' });

  return {
    kpis: {
      totalTenants,
      activeSalons: facts.activeSalons,
      pendingApplications: facts.newApplications,
      paymentSetupNeeded: facts.paymentSetupNeeded,
      monthlyCardVolumeCents: facts.monthlyCardVolumeCents,
      openSupportTickets: facts.openSupportSessions,
      systemHealthPercent: facts.systemHealthPercent,
      systemHealthLabel: facts.systemHealthLabel,
      trends: {
        totalTenants: pctDelta(totalTenants, facts.trendBaselines.totalTenantsPrior),
        activeSalons: pctDelta(facts.activeSalons, facts.trendBaselines.activeSalonsPrior),
        pausedTenants: pctDelta(facts.pausedTenants, facts.trendBaselines.pausedTenantsPrior),
        trialTenants: pctDelta(facts.trialTenants, facts.trendBaselines.trialTenantsPrior),
        pendingApplications: pctDelta(facts.newApplications, facts.trendBaselines.newApplicationsPrior),
        paymentSetupNeeded: pctDelta(facts.paymentSetupNeeded, facts.trendBaselines.paymentSetupPrior),
        monthlyCardVolume: pctDelta(facts.monthlyCardVolumeCents, facts.priorMonthCardVolumeCents || null),
        openSupportTickets: pctDelta(facts.openSupportSessions, facts.trendBaselines.openSupportPrior),
      },
    },
    monthlySalesVolume: facts.salesSeries,
    tenantsByStatus,
    recentAlerts: facts.recentAlertsRaw,
    hardwareSummary: facts.hardwareSummary,
    topPerformingTenants: facts.topTenants,
    recentTenantApplications: facts.recentApplications,
    hardwarePackageStatus,
    platformKpis: facts.platformKpis,
    quickActionsPermissions: quickActionsPermissions(role),
    recentActivity: facts.recentActivity,
    blockers,
    generatedAt: new Date().toISOString(),
  };
}

