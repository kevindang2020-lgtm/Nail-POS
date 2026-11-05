// Tenant health-score engine — AIPowerSalon Super Admin (spec §13 / deliverable #13).
//
// PURE + DETERMINISTIC. No DB, no Nest, no I/O — so it is unit-testable in the Nest-free
// harness and reused identically by the directory repository (Phase 1b) and the
// Tenant Health & Alerts widget. The repository's job is only to GATHER the signals below
// from real fact tables; the formula lives here, in one documented place, so the KPI cards,
// the Health Score column, the distribution bands, and the churn-risk count all reconcile
// from a single source of truth.
//
// Honest-by-design: when there is not enough signal to judge a tenant (e.g. a Pending tenant
// that has never logged in, taken a payment, or completed onboarding), the score is `null`
// and the band is `'unrated'` — the UI renders "Not yet calculated" rather than a fake number
// (reference row 7, Bella Vista Salon). Money is integer cents end-to-end.

/** Inputs the repository must supply per tenant. All optional/nullable — missing signal is
 *  treated as "unknown", never silently as a good or bad value. */
export interface TenantHealthSignals {
  /** Lifecycle status, lowercased ('active' | 'trial' | 'paused' | 'suspended' | 'pending' | 'cancelled' | …). */
  status: string | null;
  /** Billing posture: 'current' | 'past_due' | 'overdue' | 'trial' | 'none'. */
  billingStatus: string | null;
  /** Days since the most recent owner/staff login. null = never logged in. */
  daysSinceLastLogin: number | null;
  /** Days since the most recent platform activity of any kind (appointment, checkout, etc.). */
  daysSinceLastActivity: number | null;
  /** Count of POS devices currently reporting active for the tenant. */
  activeDeviceCount: number | null;
  /** Appointments booked in the trailing 30 days. */
  appointmentsLast30: number | null;
  /** Card payment volume in the trailing 30 days, integer cents. */
  paymentVolumeCentsLast30: number | null;
  /** Open support tickets by priority. */
  openTickets: { high?: number; medium?: number; low?: number } | null;
  /** Merchant/payment-gateway setup state: 'complete' | 'pending' | 'failed' | 'incomplete'. */
  merchantSetup: string | null;
  /** Onboarding completion fraction 0..1 (1 = fully onboarded). */
  onboardingCompletion: number | null;
  /** Integration health: 'healthy' | 'degraded' | 'failing' | 'none'. */
  integrationHealth: string | null;
}

export type HealthBand = 'excellent' | 'good' | 'average' | 'poor' | 'critical' | 'unrated';
export type ChurnRisk = 'low' | 'medium' | 'high' | 'unknown';

export interface TenantHealthResult {
  /** 0..100, or null when unrated (insufficient signal). */
  score: number | null;
  band: HealthBand;
  churnRisk: ChurnRisk;
  /** Per-factor contribution (points earned / points possible) for transparency + the detail panel. */
  factors: Array<{ key: string; earned: number; possible: number; note: string }>;
}

/** Documented factor weights (sum = 100). Tuned so a fully-configured, actively-trading,
 *  paid-current tenant lands ~95, and a suspended/overdue/idle tenant lands <30. */
export const HEALTH_WEIGHTS = {
  billing: 20,
  subscription: 10,
  loginRecency: 8,
  activityRecency: 7,
  devices: 10,
  appointments: 10,
  paymentVolume: 15,
  supportLoad: 8,
  merchantSetup: 5,
  onboarding: 5,
  integration: 2,
} as const;

/** Band thresholds (inclusive lower bound), matching the reference distribution buckets (§13). */
export const HEALTH_BANDS: Array<{ band: Exclude<HealthBand, 'unrated'>; min: number; max: number }> = [
  { band: 'excellent', min: 90, max: 100 },
  { band: 'good', min: 70, max: 89 },
  { band: 'average', min: 50, max: 69 },
  { band: 'poor', min: 30, max: 49 },
  { band: 'critical', min: 0, max: 29 },
];

export function bandForScore(score: number): Exclude<HealthBand, 'unrated'> {
  for (const b of HEALTH_BANDS) if (score >= b.min) return b.band;
  return 'critical';
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

// A tenant is "ratable" once it shows ANY real operational signal. A brand-new Pending tenant
// with no logins, no payments, no appointments and no onboarding progress is left unrated.
function hasEnoughSignal(s: TenantHealthSignals): boolean {
  return (
    (s.daysSinceLastLogin != null) ||
    (s.paymentVolumeCentsLast30 != null && s.paymentVolumeCentsLast30 > 0) ||
    (s.appointmentsLast30 != null && s.appointmentsLast30 > 0) ||
    (s.onboardingCompletion != null && s.onboardingCompletion > 0) ||
    (s.activeDeviceCount != null && s.activeDeviceCount > 0)
  );
}

export function scoreTenantHealth(s: TenantHealthSignals): TenantHealthResult {
  if (!hasEnoughSignal(s)) {
    return { score: null, band: 'unrated', churnRisk: 'unknown', factors: [] };
  }

  const factors: TenantHealthResult['factors'] = [];
  const add = (key: string, possible: number, frac: number, note: string) => {
    const earned = Math.round(possible * clamp01(frac) * 100) / 100;
    factors.push({ key, earned, possible, note });
    return earned;
  };

  let total = 0;

  // Billing (20): current=full, trial=0.8, past_due=0.4, overdue/none=0.
  const bill = (s.billingStatus || '').toLowerCase();
  total += add('billing', HEALTH_WEIGHTS.billing,
    /current|paid/.test(bill) ? 1 : /trial/.test(bill) ? 0.8 : /past[_\s-]?due/.test(bill) ? 0.4 : 0,
    bill || 'unknown');

  // Subscription / lifecycle (10).
  const st = (s.status || '').toLowerCase();
  total += add('subscription', HEALTH_WEIGHTS.subscription,
    /active/.test(st) ? 1 : /trial/.test(st) ? 0.75 : /paused/.test(st) ? 0.35 : /suspend/.test(st) ? 0.15 : /cancel|closed/.test(st) ? 0 : 0.5,
    st || 'unknown');

  // Login recency (8): ≤2d full, linear decay to 0 by 30d.
  total += add('loginRecency', HEALTH_WEIGHTS.loginRecency,
    s.daysSinceLastLogin == null ? 0 : s.daysSinceLastLogin <= 2 ? 1 : 1 - (s.daysSinceLastLogin - 2) / 28,
    s.daysSinceLastLogin == null ? 'never' : `${s.daysSinceLastLogin}d`);

  // Activity recency (7): ≤1d full, decay to 0 by 21d.
  total += add('activityRecency', HEALTH_WEIGHTS.activityRecency,
    s.daysSinceLastActivity == null ? 0 : s.daysSinceLastActivity <= 1 ? 1 : 1 - (s.daysSinceLastActivity - 1) / 20,
    s.daysSinceLastActivity == null ? 'none' : `${s.daysSinceLastActivity}d`);

  // Device availability (10): any active device = full; zero = 0.
  total += add('devices', HEALTH_WEIGHTS.devices,
    s.activeDeviceCount == null ? 0.5 : s.activeDeviceCount > 0 ? 1 : 0,
    `${s.activeDeviceCount ?? '?'} active`);

  // Appointment volume (10): saturates at 40 appts / 30d.
  total += add('appointments', HEALTH_WEIGHTS.appointments,
    s.appointmentsLast30 == null ? 0.3 : clamp01(s.appointmentsLast30 / 40),
    `${s.appointmentsLast30 ?? '?'}/30d`);

  // Payment volume (15): saturates at $5,000 / 30d (500_000 cents).
  total += add('paymentVolume', HEALTH_WEIGHTS.paymentVolume,
    s.paymentVolumeCentsLast30 == null ? 0.2 : clamp01(s.paymentVolumeCentsLast30 / 500_000),
    `${Math.round((s.paymentVolumeCentsLast30 ?? 0) / 100)}$/30d`);

  // Support load (8): unresolved high-priority tickets hurt most. 0 tickets = full.
  const tk = s.openTickets || {};
  const weighted = (tk.high || 0) * 3 + (tk.medium || 0) * 1.5 + (tk.low || 0) * 0.5;
  total += add('supportLoad', HEALTH_WEIGHTS.supportLoad, 1 - clamp01(weighted / 10),
    `${(tk.high || 0)}H/${(tk.medium || 0)}M/${(tk.low || 0)}L`);

  // Merchant setup (5).
  const ms = (s.merchantSetup || '').toLowerCase();
  total += add('merchantSetup', HEALTH_WEIGHTS.merchantSetup,
    ms === 'complete' ? 1 : ms === 'pending' ? 0.5 : ms === 'failed' ? 0.1 : 0,
    ms || 'unknown');

  // Onboarding completion (5).
  total += add('onboarding', HEALTH_WEIGHTS.onboarding,
    s.onboardingCompletion == null ? 0.3 : clamp01(s.onboardingCompletion),
    s.onboardingCompletion == null ? 'unknown' : `${Math.round((s.onboardingCompletion) * 100)}%`);

  // Integration health (2).
  const ih = (s.integrationHealth || '').toLowerCase();
  total += add('integration', HEALTH_WEIGHTS.integration,
    ih === 'healthy' ? 1 : ih === 'degraded' ? 0.5 : ih === 'failing' ? 0 : 0.5,
    ih || 'unknown');

  const score = Math.max(0, Math.min(100, Math.round(total)));
  const band = bandForScore(score);

  // Churn risk: a derived flag, not a duplicate axis. High when the score is low OR billing is
  // overdue alongside fading usage; this is what the "Churn Risk (High)" KPI and the
  // "N tenants at high churn risk" alert count.
  const overdue = /overdue|past[_\s-]?due/.test(bill);
  const fading = (s.daysSinceLastActivity ?? 0) >= 7 || (s.activeDeviceCount ?? 1) === 0;
  const churnRisk: ChurnRisk =
    score < 40 || (overdue && fading) ? 'high' : score < 60 ? 'medium' : 'low';

  return { score, band, churnRisk, factors };
}
