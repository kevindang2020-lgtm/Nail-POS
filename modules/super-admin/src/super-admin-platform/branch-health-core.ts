/**
 * branch-health-core.ts — pure, DB-free helpers for the Super Admin Branches oversight dashboard.
 *
 * Everything here is DETERMINISTIC and derived from real, observable branch signals — never random (spec §13).
 * The repository gathers raw signals from live tables (branches, users, appointments, ticket_service_lines,
 * support_tickets, the unified device fleet, tenant_location_hours) and calls these helpers. They are unit-tested
 * by branch-health-core.spec.ts so the scoring/bucketing logic is verified without a database.
 *
 * Honesty rules baked in:
 *  - A branch that is pre-operational (draft / opening / pending / under review / setup / ready-to-launch) has no
 *    meaningful operational health yet → score is `null`, rendered as "Not yet calculated" (§10 Bella Vista), never 0.
 *  - A factor whose signal the platform cannot source for a given branch is EXCLUDED and the remaining weights are
 *    renormalized, so missing data neither inflates nor tanks the score.
 */

export type BranchLifecycle = string;

/**
 * Real, observable per-branch signals. Any field may be null when the platform has no source for it on that branch.
 */
export interface BranchHealthSignals {
  status: BranchLifecycle | null;
  /** Whether the branch's tenant has a usable payment gateway configured. */
  paymentConfigured: boolean | null;
  /** Fraction (0..1) of the branch's modelled devices reporting online, or null when no devices are modelled. */
  deviceOnlineRatio: number | null;
  /** Days since the branch's last real activity (audit/event), or null when never. */
  daysSinceLastActivity: number | null;
  todaysAppointments: number | null;
  revenueMtdCents: number | null;
  openSupportTickets: number | null;
}

/**
 * Lifecycle states that are pre-operational — no operational health is computed for these (returns null).
 * Names are normalized to lowercase before lookup, so both 'pending' and 'Opening Requested' resolve here.
 */
const PRE_OPERATIONAL = new Set<string>([
  'draft', 'opening', 'opening_requested', 'opening requested', 'under_review', 'under review',
  'setup_in_progress', 'setup in progress', 'ready_to_launch', 'ready to launch', 'pending', 'requested',
]);

/**
 * Documented factor weights — sum to 100. Each factor produces a 0..1 sub-score; the final score is the
 * weighted average over the factors whose signal is AVAILABLE (renormalized), then scaled to 0..100.
 */
export const HEALTH_WEIGHTS = {
  status: 30, // operational status is the dominant signal
  payment: 15, // can the branch actually take money
  devices: 15, // device availability (online ratio)
  activity: 10, // recency of real activity
  appointments: 10, // demand today
  revenue: 10, // is money flowing this month
  support: 10, // inverse of open support-ticket load
} as const;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Operational-status sub-score. Suspended/closed/inactive contribute 0; active contributes full credit. */
export function statusSubScore(statusLower: string): number {
  switch (statusLower) {
    case 'active': return 1;
    case 'maintenance': case 'temporarily_closed': case 'temp_closed': return 0.6;
    case 'paused': return 0.4;
    case 'closing': return 0.25;
    case 'suspended': case 'closed': case 'inactive': case 'rejected': return 0;
    default: return 0.5; // operational but unrecognized label
  }
}

const activitySub = (days: number): number => (days <= 7 ? 1 : days <= 30 ? 0.6 : days <= 90 ? 0.3 : 0.1);
const apptSub = (n: number): number => (n <= 0 ? 0.1 : n >= 20 ? 1 : 0.1 + (n / 20) * 0.9);
const revenueSub = (cents: number): number => (cents > 0 ? 1 : 0.15);
const supportSub = (open: number): number => (open <= 0 ? 1 : open >= 10 ? 0.1 : 1 - (open / 10) * 0.9);

/**
 * Compute a 0..100 branch health score, or null for pre-operational branches / when no signal is available.
 * Deterministic and fully documented — see HEALTH_WEIGHTS and the sub-score functions above.
 */
export function branchHealthScore(sig: BranchHealthSignals): number | null {
  const status = (sig.status || '').toLowerCase();
  if (PRE_OPERATIONAL.has(status)) return null;
  const factors: Array<[number, number]> = [];
  if (sig.status != null) factors.push([HEALTH_WEIGHTS.status, statusSubScore(status)]);
  if (sig.paymentConfigured != null) factors.push([HEALTH_WEIGHTS.payment, sig.paymentConfigured ? 1 : 0]);
  if (sig.deviceOnlineRatio != null) factors.push([HEALTH_WEIGHTS.devices, clamp01(sig.deviceOnlineRatio)]);
  if (sig.daysSinceLastActivity != null) factors.push([HEALTH_WEIGHTS.activity, activitySub(sig.daysSinceLastActivity)]);
  if (sig.todaysAppointments != null) factors.push([HEALTH_WEIGHTS.appointments, apptSub(sig.todaysAppointments)]);
  if (sig.revenueMtdCents != null) factors.push([HEALTH_WEIGHTS.revenue, revenueSub(sig.revenueMtdCents)]);
  if (sig.openSupportTickets != null) factors.push([HEALTH_WEIGHTS.support, supportSub(sig.openSupportTickets)]);
  if (!factors.length) return null;
  let wsum = 0, num = 0;
  for (const [w, s] of factors) { wsum += w; num += w * s; }
  return Math.round((num / wsum) * 100);
}

export type HealthBucket = 'excellent' | 'good' | 'average' | 'poor' | 'critical';

/** Documented banding (§13): Excellent 90–100, Good 70–89, Average 50–69, Poor 30–49, Critical 0–29. */
export function healthBucket(score: number): HealthBucket {
  if (score >= 90) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'average';
  if (score >= 30) return 'poor';
  return 'critical';
}

export interface HealthDistribution {
  excellent: number; good: number; average: number; poor: number; critical: number;
  scored: number; unscored: number; total: number;
}

/**
 * Bucket a set of scores. `scored` + `unscored` = total, so the distribution reconciles with the branch set
 * (unscored = pre-operational branches excluded from the bands; §13 "totals reconcile with Total Branches").
 */
export function bucketHealthDistribution(scores: Array<number | null>): HealthDistribution {
  const d: HealthDistribution = { excellent: 0, good: 0, average: 0, poor: 0, critical: 0, scored: 0, unscored: 0, total: 0 };
  for (const s of scores) {
    d.total++;
    if (s == null) { d.unscored++; continue; }
    d.scored++; d[healthBucket(s)]++;
  }
  return d;
}

/**
 * Hours-availability class (§24) from the number of weekdays (0..6) with a non-closed configured row.
 * Full = all 7 days configured open; Partial = 4–6 days; Limited = ≤3 days (significantly reduced/incomplete).
 */
export function hoursAvailabilityClass(openDays: number): 'full' | 'partial' | 'limited' {
  if (openDays >= 7) return 'full';
  if (openDays >= 4) return 'partial';
  return 'limited';
}

/**
 * Operational alerts (§14) from real aggregates with documented thresholds. Zero-count alerts are omitted so that
 * normal business variation is not surfaced as an emergency. `to` is the in-app destination for the filtered view.
 */
export interface AlertInputs {
  lowHealthBranches: number;
  offlineDeviceBranches: number;
  pendingOpenings: number;
  zeroAppointmentActiveBranches: number;
  revenueDropBranches: number;
}
export interface OperationalAlert { key: string; label: string; count: number; severity: 'info' | 'warning' | 'critical'; to: string; }

export function operationalAlerts(a: AlertInputs): OperationalAlert[] {
  const all: OperationalAlert[] = [
    { key: 'low_health', label: 'branches with low health score', count: a.lowHealthBranches, severity: 'critical', to: '/branches?healthMax=49' },
    { key: 'offline_devices', label: 'branches with offline devices', count: a.offlineDeviceBranches, severity: 'warning', to: '/devices-management?status=offline' },
    { key: 'pending_openings', label: 'opening requests pending approval', count: a.pendingOpenings, severity: 'info', to: '/branches?openingStatus=pending' },
    { key: 'zero_appts', label: 'branches with 0 appointments today', count: a.zeroAppointmentActiveBranches, severity: 'warning', to: '/branches?openToday=1&apptsToday=0' },
    { key: 'revenue_drop', label: 'branches with revenue drop greater than 20%', count: a.revenueDropBranches, severity: 'warning', to: '/branches?revenueDrop=20' },
  ];
  return all.filter((x) => x.count > 0);
}
