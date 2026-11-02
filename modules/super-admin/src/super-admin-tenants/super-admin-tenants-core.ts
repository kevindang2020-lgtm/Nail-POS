import { centsToUsdCompact as centsToUsd } from '@aipowersalon/money';
export { centsToUsd };   // owned by @aipowersalon/money (Constitution 13 §86) — the compact rule (whole dollars without decimals)
/**
 * super-admin-tenants-core.ts
 * ---------------------------------------------------------------------------
 * PURE domain logic for the Super Admin "Tenants" command center.
 *
 * SCOPE / ISOLATION (read this):
 *   Super Admin is a CROSS-TENANT surface. Unlike every POS feature, this code
 *   is NOT tenant-scoped via scoped(). It is mounted behind the `super-admin`
 *   guard (integration-bundle/.../guards/super-admin.ts). Repository queries here
 *   read across ALL tenants on purpose. Never apply scoped() to these reads.
 *
 * STORED vs DERIVED (honest contract — no hidden magic):
 *   Stored (DB, migrations 001 + 022):
 *     - tenants.status            : 'active' | 'pending' | 'suspended' | 'cancelled'
 *     - tenant_subscriptions.plan / .status ('active'|'trialing'|'past_due'|'expired'|'cancelled')
 *     - tenant_ai_packages.package
 *     - tenant_usage_limits (metric/limit/used)  -> customers, technicians, ai_calls, sms
 *     - tenant_payment_config.fiserv_configured   (022)
 *     - tenant_hardware_payoff.remaining_cents     (022)
 *     - branches (count, city/state of primary)
 *     - users.last_login_at (owner)
 *   Derived HERE (not stored):
 *     - display status   : healthy | warning | pastdue | setup | suspended
 *     - plan tier         : Premium | Standard | Basic | Trial
 *     - payment label     : Current | Past Due | Trial
 *     - setup completeness
 *     - KPI roll-ups, monthly-revenue sum
 *
 * This module is framework-free and unit-tested by super-admin-tenants-core.spec.ts.
 */

/* ============================== Domain types ============================== */

export type StoredTenantStatus = 'active' | 'pending' | 'suspended' | 'cancelled';

export type DisplayStatus = 'healthy' | 'warning' | 'pastdue' | 'setup' | 'suspended' | 'cancelled';
export type PlanTier = 'Premium' | 'Standard' | 'Basic' | 'Trial';
export type PaymentLabel = 'Current' | 'Past Due' | 'Trial';
/** Dashboard payment-setup state shown in the table + filter. */
export type PaymentSetup = 'complete' | 'pending' | 'failed' | 'incomplete';

/** Raw per-tenant record as assembled by the repository from joined tables. */
export interface TenantRecord {
  id: string;
  displayName: string;
  tenantCode: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  ownerActivated: boolean; // owner has set a real password / logged in at least once
  primaryCity: string;
  primaryState: string; // e.g. 'NJ' | 'PA' | 'DE'
  branchCount: number;
  posDeviceCount?: number; // active POS terminals for this tenant; undefined when no source connected (honest —)
  storedStatus: StoredTenantStatus;
  /** Constitution 7 §16 — lifecycle state (migration 463); absent from repos that do not have it */
  lifecycleState?: string;
  suspensionReasonCode?: string | null;
  plan: string; // free text plan name, e.g. 'Gold Plan'
  subscriptionStatus: SubscriptionStatus;
  subscriptionPeriodEnd?: string; // ISO from tenant_subscriptions.current_period_end; undefined when no source
  aiPackage: string; // 'AI Pro' | 'AI Basic' | 'None'
  monthlyRevenueCents: number;
  usagePercent: number; // 0..100 headline utilization
  fiservConfigured: boolean;
  paymentConfigStatus: PaymentConfigStatus; // raw tenant_payment_config.status (or 'none')
  hardwarePayoffRemainingCents: number; // 0 = paid off; -1 = N/A (no hardware financed)
  lastLoginLabel: string; // human label, e.g. '12 min ago' | 'Never'
  createdLabel: string; // e.g. 'May 08, 2026'
  createdDaysAgo: number;
  customers: [number, number]; // [used, cap]
  technicians: [number, number]; // [used, cap]
  aiCallsLabel: string;
  smsLabel: string;
  defaultCommissionPercent?: number;
}

/** Shape the Tenants screen consumes for each table row + detail panel. */
export interface TenantViewRow {
  /** Constitution 7 §16 — the lifecycle state and the moves the transition table allows from it */
  lifecycleState?: string | null;
  lifecycleMoves?: string[];
  /** Constitution 7 §19 — while suspended: what the cause allows and whether each line is enforced today */
  suspensionReasonCode?: string | null;
  suspensionPolicy?: Array<{ capability: string; allowed: boolean; effective: boolean | null; enforced: boolean }> | null;
  id: string;
  n: string;
  code: string;
  owner: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  branches: number;
  posDevices?: number | null; // active POS terminals; null when no source connected (renders —)
  subscription?: string | null; // renewal/status label; null when subscription status unknown (renders —)
  plan: string;
  planTier: PlanTier;
  ai: string;
  rev: string;
  use: number;
  pay: PaymentLabel;
  paymentSetup: PaymentSetup;
  status: DisplayStatus;
  sl: string; // status label text
  aiEnabled: boolean;
  fiserv: boolean;
  last: string;
  created: string;
  createdDays: number;
  payoff: string;
  cust: [number, number];
  tech: [number, number];
  aiCalls: string;
  sms: string;
  commissionPct?: number;
  /** Per-row tenant health (attached by the service via the shared scoring engine). null = not yet rated. */
  healthScore?: number | null;
  healthBand?: string;
  churnRisk?: string;
}

export interface KpiCard {
  ic: string;
  c: string;
  lab: string;
  val: string;
  d: string;
  dt: string;
  tip: string;
}

export interface Pagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface TenantsState {
  kpis: KpiCard[];
  tenants: TenantViewRow[];
  pagination: Pagination;
}

export interface TenantFilter {
  q?: string;
  plan?: string;
  ai?: string;
  state?: string;
  pay?: string; // 'Current' | 'Past Due' | 'Trial'
  setup?: '' | 'complete' | 'incomplete' | 'pending' | 'failed';
}

export type TabKey =
  | 'all'
  | 'active'
  | 'trial'
  | 'pastdue'
  | 'suspended'
  | 'cancelled'
  | 'setup'
  | 'ai'
  | 'nomid';

/* ============================== Formatting ============================== */


/* ============================== Derivation ============================== */

export function derivePlanTier(plan: string): PlanTier {
  const p = (plan || '').toLowerCase();
  if (p.includes('gold') || p.includes('premium')) return 'Premium';
  if (p.includes('trial')) return 'Trial';
  if (p.includes('starter') || p.includes('basic')) return 'Basic';
  if (p.includes('pro') || p.includes('standard')) return 'Standard';
  return 'Basic';
}

export function derivePaymentLabel(sub: SubscriptionStatus): PaymentLabel {
  if (sub === 'past_due' || sub === 'expired') return 'Past Due';
  if (sub === 'trialing') return 'Trial';
  return 'Current';
}

const SUB_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/**
 * Per-row Subscription column label, from the tenant's latest subscription (status + current_period_end).
 * The date is formatted from the stored ISO date parts (TZ-independent, deterministic) — never a fabricated
 * value: when the status is known but the period end isn't, it shows the status word without a date; when the
 * status itself is unknown it returns null → the column renders "—".
 */
export function subscriptionLabel(status: SubscriptionStatus | undefined, periodEndIso?: string | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(periodEndIso ?? '');
  const date = m ? `${SUB_MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : null;
  switch (status) {
    case 'trialing': return date ? `Trial ends ${date}` : 'Trial';
    case 'active': return date ? `Renews ${date}` : 'Active';
    case 'past_due': return date ? `Past due (${date})` : 'Past due';
    case 'expired': return date ? `Expired ${date}` : 'Expired';
    case 'cancelled': return 'Cancelled';
    default: return date ? `Renews ${date}` : null;
  }
}

/**
 * Real payment-setup state for the table + filter, from the tenant's gateway config (tenant_payment_config.status):
 *   active → complete · error → failed · pending → pending · disabled/none → incomplete.
 * A legacy fiserv_configured flag with no live status still counts as complete.
 */
export function derivePaymentSetup(t: TenantRecord): PaymentSetup {
  if (t.paymentConfigStatus === 'active') return 'complete';
  if (t.paymentConfigStatus === 'error') return 'failed';
  if (t.paymentConfigStatus === 'pending') return 'pending';
  if (t.paymentConfigStatus === 'none' && t.fiservConfigured) return 'complete';
  return 'incomplete'; // disabled, or none with no gateway
}

// isAiEnabled: the one definition is @aipowersalon/platform's (AI plan entitlements); re-exported for this core's callers.
import { isAiEnabled } from '@aipowersalon/platform';
// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15).
export type { PaymentConfigStatus, SubscriptionStatus } from '@aipowersalon/api-contracts/platform';
import type { PaymentConfigStatus, SubscriptionStatus } from '@aipowersalon/api-contracts/platform';
export { isAiEnabled };

/**
 * A tenant is "setup complete" only when onboarding essentials are in place:
 * at least one branch, a configured Fiserv MID, and an activated owner login.
 */
export function isSetupComplete(t: TenantRecord): boolean {
  return t.branchCount > 0 && t.fiservConfigured && t.ownerActivated;
}

/**
 * Display status precedence (highest first):
 *   suspended > pastdue > setup-required > warning > healthy
 * warning = trialing-ending-soon OR headline usage >= 90%.
 */
export function deriveDisplayStatus(t: TenantRecord): DisplayStatus {
  if (t.storedStatus === 'cancelled') {
    return 'cancelled';
  }
  if (t.storedStatus === 'suspended') {
    return 'suspended';
  }
  if (t.subscriptionStatus === 'past_due' || t.subscriptionStatus === 'expired') {
    return 'pastdue';
  }
  if (!isSetupComplete(t)) return 'setup';
  const trialEndingSoon = t.subscriptionStatus === 'trialing' && t.createdDaysAgo <= 14;
  if (trialEndingSoon || t.usagePercent >= 90) return 'warning';
  return 'healthy';
}

const STATUS_LABEL: Record<DisplayStatus, string> = {
  healthy: 'Healthy',
  warning: 'Warning',
  pastdue: 'Past Due',
  setup: 'Setup Required',
  suspended: 'Suspended',
  cancelled: 'Cancelled',
};

export function payoffLabel(remainingCents: number): string {
  if (remainingCents < 0) return '—';
  if (remainingCents === 0) return 'Paid off';
  return centsToUsd(remainingCents) + ' remaining';
}

/** Map a raw record into the exact shape the screen renders. */
export function toViewRow(t: TenantRecord): TenantViewRow {
  const status = deriveDisplayStatus(t);
  const ls = t.lifecycleState ?? null;
  return {
    lifecycleState: ls,
    lifecycleMoves: isLifecycleState(ls) ? [...LIFECYCLE_TRANSITIONS[ls]] : [],
    suspensionReasonCode: t.suspensionReasonCode ?? null,
    suspensionPolicy: t.storedStatus === 'suspended' ? suspensionPolicyFor(t.suspensionReasonCode) : null,
    id: t.id,
    n: t.displayName,
    code: t.tenantCode,
    owner: t.ownerName,
    email: t.ownerEmail,
    phone: t.ownerPhone,
    city: t.primaryCity,
    state: t.primaryState,
    branches: t.branchCount,
    posDevices: t.posDeviceCount ?? null,
    subscription: subscriptionLabel(t.subscriptionStatus, t.subscriptionPeriodEnd),
    plan: t.plan,
    planTier: derivePlanTier(t.plan),
    ai: t.aiPackage,
    rev: centsToUsd(t.monthlyRevenueCents),
    use: t.usagePercent,
    pay: derivePaymentLabel(t.subscriptionStatus),
    paymentSetup: derivePaymentSetup(t),
    status,
    sl: STATUS_LABEL[status],
    aiEnabled: isAiEnabled(t.aiPackage),
    fiserv: t.fiservConfigured,
    last: t.lastLoginLabel,
    created: t.createdLabel,
    createdDays: t.createdDaysAgo,
    payoff: payoffLabel(t.hardwarePayoffRemainingCents),
    cust: t.customers,
    tech: t.technicians,
    aiCalls: t.aiCallsLabel,
    sms: t.smsLabel,
    commissionPct: t.defaultCommissionPercent ?? 50,
  };
}

/* ============================== Tabs ============================== */

export const TAB_PREDICATES: Record<TabKey, (t: TenantViewRow) => boolean> = {
  all: () => true,
  active: (t) => t.status === 'healthy' || t.status === 'warning',
  trial: (t) => t.pay === 'Trial' || /trial/i.test(t.plan),
  pastdue: (t) => t.status === 'pastdue',
  suspended: (t) => t.status === 'suspended',
  cancelled: (t) => t.status === 'cancelled',
  setup: (t) => t.status === 'setup',
  ai: (t) => t.aiEnabled === true,
  nomid: (t) => t.fiserv === false,
};

export function tabCounts(rows: TenantViewRow[]): Record<TabKey, number> {
  const out = {} as Record<TabKey, number>;
  (Object.keys(TAB_PREDICATES) as TabKey[]).forEach((k) => {
    out[k] = rows.filter(TAB_PREDICATES[k]).length;
  });
  return out;
}

/* ============================== Filtering ============================== */

export function applyFilter(rows: TenantViewRow[], f: TenantFilter): TenantViewRow[] {
  const q = (f.q || '').trim().toLowerCase();
  return rows.filter((t) => {
    if (q) {
      const hay = [t.n, t.owner, t.code, t.city, t.state, t.phone, t.email]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.plan && t.plan !== f.plan) return false;
    if (f.ai && t.ai !== f.ai) return false;
    if (f.state && t.state !== f.state) return false;
    if (f.pay && t.pay !== f.pay) return false;
    if (f.setup && t.paymentSetup !== f.setup) return false;
    return true;
  });
}

export function applyTabThenFilter(
  rows: TenantViewRow[],
  tab: TabKey,
  f: TenantFilter,
): TenantViewRow[] {
  return applyFilter(rows.filter(TAB_PREDICATES[tab] ?? TAB_PREDICATES.all), f);
}

/* ============================== Pagination ============================== */

export function paginate<T>(
  items: T[],
  page: number,
  pageSize: number,
): { slice: T[]; pagination: Pagination } {
  const size = Math.max(1, Math.floor(pageSize) || 10);
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  const start = (p - 1) * size;
  return {
    slice: items.slice(start, start + size),
    pagination: { page: p, pageSize: size, totalItems, totalPages },
  };
}

/* ============================== KPI roll-up ============================== */

export function buildKpis(rows: TenantViewRow[]): KpiCard[] {
  const total = rows.length;
  const active = rows.filter((t) => t.status === 'healthy' || t.status === 'warning').length;
  const trial = rows.filter((t) => t.pay === 'Trial' || /trial/i.test(t.plan)).length;
  const trialEndingSoon = rows.filter(
    (t) => (t.pay === 'Trial' || /trial/i.test(t.plan)) && t.createdDays <= 14,
  ).length;
  const suspended = rows.filter((t) => t.status === 'suspended').length;
  const pastDue = rows.filter((t) => t.status === 'pastdue').length;
  const setup = rows.filter((t) => t.status === 'setup').length;
  const aiEnabled = rows.filter((t) => t.aiEnabled).length;
  const aiPct = total ? Math.round((aiEnabled / total) * 100) : 0;
  const activePct = total ? Math.round((active / total) * 100) : 0;
  const mrrCents = rows.reduce((sum, t) => sum + usdLabelToCents(t.rev), 0);

  return [
    { ic: 'users', c: 'info', lab: 'Total Tenants', val: String(total), d: '', dt: 'up', tip: 'All tenants on platform' },
    { ic: 'check', c: 'success', lab: 'Active Tenants', val: String(active), d: activePct + '%', dt: 'success', tip: activePct + '% active' },
    { ic: 'clock', c: 'purple', lab: 'Trial Tenants', val: String(trial), d: trialEndingSoon + ' soon', dt: 'warning', tip: trialEndingSoon + ' ending soon' },
    { ic: 'userx', c: 'danger', lab: 'Suspended', val: String(suspended), d: 'review', dt: 'danger', tip: 'Need review' },
    { ic: 'alert', c: 'warning', lab: 'Past Due', val: String(pastDue), d: 'overdue', dt: 'danger', tip: 'Payment required' },
    { ic: 'wrench', c: 'info', lab: 'Setup Required', val: String(setup), d: 'pending', dt: 'info', tip: 'Missing onboarding' },
    { ic: 'cpu', c: 'purple', lab: 'AI Enabled', val: String(aiEnabled), d: aiPct + '%', dt: 'purple', tip: aiPct + '% adoption' },
    { ic: 'dollar', c: 'gold', lab: 'Monthly Revenue', val: centsToUsd(mrrCents), d: '', dt: 'up', tip: 'Sum of active MRR' },
  ];
}

/** Parse a '$4,860' / '$4,860.50' style label back to integer cents. */
export function usdLabelToCents(label: string): number {
  const n = parseFloat(String(label).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/* ============================== State assembly ============================== */

export function buildTenantsState(
  records: TenantRecord[],
  opts: { tab?: TabKey; filter?: TenantFilter; page?: number; pageSize?: number } = {},
): TenantsState {
  const allRows = records.map(toViewRow);
  const tab = opts.tab ?? 'all';
  const filtered = applyTabThenFilter(allRows, tab, opts.filter ?? {});
  const { slice, pagination } = paginate(filtered, opts.page ?? 1, opts.pageSize ?? 10);
  return {
    // KPIs are always computed over the FULL platform, not the filtered page.
    kpis: buildKpis(allRows),
    tenants: slice,
    pagination,
  };
}

/* ============================== Status state machine ============================== */
// Constitution 7 §18 — the suspension reason codes and minimum reason length live with the lifecycle (one direction of import)
import { SUSPENSION_REASON_CODES, MIN_STATUS_REASON, LIFECYCLE_TRANSITIONS, isLifecycleState } from './tenant-lifecycle-core';
import { suspensionPolicyFor } from '@aipowersalon/permissions';
export { SUSPENSION_REASON_CODES, MIN_STATUS_REASON } from './tenant-lifecycle-core';
export type { SuspensionReasonCode } from './tenant-lifecycle-core';
/**
 * §18 / §20 / §21 — what a transition must carry. Suspension: a reason code AND a written reason. Reactivation and
 * cancellation (closure): a written reason. First activation of a pending tenant: nothing extra (onboarding decides).
 * Returns the refusal message, or null when the request carries what it needs.
 */
export function statusChangeRequirement(action: TenantAction, reason: string | undefined, reasonCode: string | undefined): string | null {
  const hasReason = (reason ?? '').trim().length >= MIN_STATUS_REASON;
  if (action === 'suspend') {
    if (!reasonCode || !(SUSPENSION_REASON_CODES as readonly string[]).includes(reasonCode)) return `Choose a suspension reason (${SUSPENSION_REASON_CODES.join(', ')}).`;
    if (!hasReason) return `Describe the reason for the suspension (at least ${MIN_STATUS_REASON} characters).`;
  }
  if ((action === 'reactivate' || action === 'cancel') && !hasReason) return `A reason of at least ${MIN_STATUS_REASON} characters is required to ${action === 'cancel' ? 'close' : 'reactivate'} a tenant.`;
  return null;
}

export type TenantAction = 'activate' | 'suspend' | 'reactivate' | 'cancel';

export const LEGAL_TRANSITIONS: Record<StoredTenantStatus, StoredTenantStatus[]> = {
  pending: ['active', 'cancelled'],
  active: ['suspended', 'cancelled'],
  suspended: ['active', 'cancelled'],
  cancelled: [], // terminal
};

const ACTION_TARGET: Record<TenantAction, StoredTenantStatus> = {
  activate: 'active',
  reactivate: 'active',
  suspend: 'suspended',
  cancel: 'cancelled',
};

export interface TransitionResult {
  ok: boolean;
  from: StoredTenantStatus;
  to?: StoredTenantStatus;
  error?: string;
}

export function canTransition(
  from: StoredTenantStatus,
  action: TenantAction,
): TransitionResult {
  const to = ACTION_TARGET[action];
  if (!to) return { ok: false, from, error: `Unknown action: ${action}` };
  // reactivate is only meaningful from suspended
  if (action === 'reactivate' && from !== 'suspended') {
    return { ok: false, from, error: 'Only a suspended tenant can be reactivated' };
  }
  if (from === to) {
    return { ok: false, from, error: `Tenant is already ${to}` };
  }
  if (!LEGAL_TRANSITIONS[from].includes(to)) {
    return { ok: false, from, error: `Illegal transition: ${from} → ${to}` };
  }
  return { ok: true, from, to };
}

/* ============================== Input validation ============================== */

export interface CreateTenantInput {
  legalName?: string;
  displayName?: string;
  tenantCode?: string;
  ownerEmail?: string;
  ownerName?: string;
  plan?: string;
  state?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^[A-Z0-9]{3,12}$/;

export function validateCreateTenant(input: CreateTenantInput): ValidationResult {
  const e: string[] = [];
  if (!input.displayName || !input.displayName.trim()) e.push('Salon name is required');
  if (!input.ownerName || !input.ownerName.trim()) e.push('Owner name is required');
  if (!input.ownerEmail || !EMAIL_RE.test(input.ownerEmail)) e.push('A valid owner email is required');
  if (!input.plan || !input.plan.trim()) e.push('A plan is required');
  if (input.tenantCode && !CODE_RE.test(input.tenantCode)) {
    e.push('Tenant code must be 3–12 uppercase letters/numbers');
  }
  return { ok: e.length === 0, errors: e };
}

export interface SuspendInput {
  reason?: string;
}

export function validateSuspend(input: SuspendInput): ValidationResult {
  const e: string[] = [];
  const r = (input.reason || '').trim();
  if (r.length < 5) e.push('A suspension reason of at least 5 characters is required');
  return { ok: e.length === 0, errors: e };
}



/* ============================== Audit helpers ============================== */

export type TenantAuditAction =
  | 'tenant_lifecycle_changed'   // Constitution 7 §16
  | 'super_admin_tenant_created'
  | 'super_admin_tenant_suspended'
  | 'super_admin_tenant_reactivated'
  | 'super_admin_tenant_owner_password_reset'
  | 'super_admin_support_session_started'
  | 'super_admin_support_session_ended'
  | 'super_admin_tenant_viewed'
  | 'super_admin_tenant_pos_language_changed'   // Vietnamese POS mandate WP-A §93
  // Quick Actions (Tenants/Salons detail panel)
  | 'tenant_paused'
  | 'tenant_activated'
  | 'tenant_suspended'
  | 'tenant_cancelled'
  | 'warning_sent'
  | 'support_access_opened'
  // Payment Gateways lifecycle actions
  | 'super_admin_gateway_paused'
  | 'super_admin_gateway_resumed'
  | 'super_admin_gateway_disabled'
  // Configure Gateway actions
  | 'payment_gateway_credentials_verified'
  | 'payment_gateway_status_synced'
  | 'payment_gateway_webhook_secret_rotated'
  // wave 3 PAYI §55: branch merchant accounts (migration 638) — configured / changed / tested / status
  | 'payment_merchant_account_configured'
  | 'payment_merchant_account_status_changed'
  | 'payment_merchant_account_tested';

/**
 * Maps a desired target status (from the Quick Actions panel) to the lifecycle action the transition engine
 * understands. Returns null when the target isn't a supported Quick Action target. 'active' resolves to `reactivate`
 * from a suspended/paused tenant (the only legal source for reactivate) and to `activate` otherwise.
 */
export function actionForStatus(from: StoredTenantStatus, target: string): TenantAction | null {
  switch (target) {
    case 'paused':
    case 'suspended': return 'suspend';
    case 'cancelled': return 'cancel';
    case 'active': return from === 'suspended' ? 'reactivate' : 'activate';
    default: return null;
  }
}

/** The audit event a status change should record. */
export function auditEventForStatus(target: string): TenantAuditAction {
  return target === 'paused' || target === 'suspended' ? 'tenant_paused'
    : target === 'cancelled' ? 'tenant_cancelled'
    : 'tenant_activated';
}

export interface AuditEntry {
  actionType: TenantAuditAction;
  entityType: 'tenant';
  entityId: string;
  metadata?: Record<string, unknown>;
}

export function auditFor(
  action: TenantAuditAction,
  tenantId: string,
  metadata?: Record<string, unknown>,
): AuditEntry {
  return { actionType: action, entityType: 'tenant', entityId: tenantId, metadata };
}
