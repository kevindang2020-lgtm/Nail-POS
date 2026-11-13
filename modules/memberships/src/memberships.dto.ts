// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
import type { PlanVersionSubscribers } from '@aipowersalon/api-contracts/tenant';
export type { MemberExportRow, PaymentExportRow, RedemptionExportRow } from '@aipowersalon/api-contracts/tenant';
// memberships.dto.ts — request/response contracts for the Memberships surface. Re-exports the pure engine helpers from
// memberships-core so the in-memory and Kysely repositories compute identically.
export {
  PRODUCT_TYPES, MEMBERSHIP_STATUSES, LEDGER_ENTRY_TYPES,
  isRecurring, canTransition, assertTransition, benefitsActive,
  creditBalance, canReserveServiceCredit, splitMembershipRevenue, isValidSplit, upgradeChargeCents,
  MembershipTransitionError,
} from './memberships-core';
export type { ProductType, MembershipStatus, LedgerEntryType, LedgerEntry, CreditBalance, RevenueSplit } from './memberships-core';

// ── Overview (the screen behind the reference image) ──
export interface OverviewKpis {
  totalMembers: number;            // current member records (excludes fully canceled/expired)
  newMembersThisMonth: number;
  activeMembers: number;
  activePctOfTotal: number;        // 0–100
  membershipRevenueCents: number;  // succeeded membership payments in range
  membershipPaymentsThisMonth?: number;   // how many payments that revenue is (Membership Overview mandate §10)
  revenueDeltaPct: number | null;  // vs previous period; null when no prior basis
  expiringSoon: number;            // terms ending within the window
  expiringWindowDays: number;
  canceledThisMonth: number;
  canceledDeltaPct: number | null;
}

export interface PlanRow {
  planId: string;
  name: string;
  description: string | null;
  productType: string;
  billingInterval: string;
  intervalCount: number;
  priceCents: number;
  isCustomPricing: boolean;
  status: string;                  // draft | active | archived
  isPopular: boolean;
  badge: string | null;
  memberCount: number;
  revenueCents: number;            // recognized membership revenue attributed to the plan in range
}

export interface MemberRow {
  membershipId: string;
  customerId: string;
  customerName: string;
  avatarUrl: string | null;
  maskedPhone: string | null;
  planName: string;
  joinDate: string | null;         // ISO
  nextBillingAt: string | null;    // ISO
  status: string;
}

export interface ActivityRow {
  id: string;
  activityType: string;
  customerName: string | null;
  planName: string | null;
  occurredAt: string;              // ISO
  amountCents: number | null;
}

export interface StatusSlice { status: string; count: number; pct: number }
export interface PlanSlice { planName: string; count: number; pct: number; revenueCents: number }
export interface RevenuePoint { label: string; cents: number }
export interface TopServiceRow { name: string; redemptions: number; valueCents: number }

export interface MembershipOverview {
  kpis: OverviewKpis;
  plans: PlanRow[];
  members: MemberRow[];
  activity: ActivityRow[];
  revenueSeries: RevenuePoint[];
  statusBreakdown: StatusSlice[];
  planDistribution: PlanSlice[];
  topServices: TopServiceRow[];
  rangeDays: number;
  /** Membership Overview mandate (Oct 29 2026) §10: what each chart counts, and its denominator */
  populations?: { statusBreakdown: string; planDistribution: string; topServices: string; revenue: string };
  distributionTotal?: number;
  statusTotal?: number;
}

// ── CSV export rows (full data, tenant/branch scoped) ──

export interface OverviewFilters {
  branchId?: string;     // when omitted, all branches the caller may see
  rangeDays?: number;    // default 30
  expiringWindowDays?: number; // default 7
}

// ── Plan create / publish ──
export interface BenefitInput {
  benefitType: string;
  label: string;
  serviceId?: string | null;
  categorySnapshot?: string | null;
  creditsPerCycle?: number;
  valueCents?: number;
  percent?: number;
  allocatedValueCents?: number;
  minDaysBetween?: number;
  maxPerCycle?: number | null;
  rolloverAllowed?: boolean;
  sortOrder?: number;
}

export interface CreatePlanRequest {
  name: string;
  planCode?: string | null;
  productType?: string;            // default recurring
  description?: string | null;
  badge?: string | null;
  isPopular?: boolean;
  isFeatured?: boolean;
  memberVisible?: boolean;
  branchId?: string | null;        // null = all branches
}

export interface PublishVersionRequest {
  billingInterval?: string;        // month | quarter | six_month | year | none | custom
  intervalCount?: number;
  priceCents?: number;
  isCustomPricing?: boolean;
  enrollmentFeeCents?: number;
  setupFeeCents?: number;
  trialDays?: number;
  autoRenew?: boolean;
  billingCycles?: number | null;
  termType?: string;               // none | fixed
  termDays?: number | null;
  rolloverAllowed?: boolean;
  rolloverMaxCycles?: number;
  creditExpiryDays?: number | null;
  techCommissionBasis?: string;
  techSplitPct?: number;           // default 60
  ownerSplitPct?: number;          // default 40 (must total 100 with techSplitPct)
  techFixedCents?: number | null;
  allocationTiming?: string;       // on_billing | on_redemption | hybrid
  cancellationPolicy?: string;
  minCommitmentCycles?: number;
  pauseMaxPerYear?: number;
  pauseMaxDays?: number;
  termsVersion?: string | null;
  autoRenewDisclosure?: string | null;
  estMarginCents?: number;
  benefits?: BenefitInput[];
  /** extras Membership Overview 13 · 10: a CHANGE to an existing plan — every term not sent is copied from the plan's
   *  current version (benefits too when none are sent), so changing the price never resets the other terms to defaults */
  carryForward?: boolean;
}

/** extras Membership Overview 13 · 10: what the plan's current version is, who is on which version (read for the preview) */
export interface VersionChangeFacts {
  planStatus: string;
  nextVersionNumber: number;
  current: (Required<Omit<PublishVersionRequest, 'carryForward' | 'benefits'>> & { versionNumber: number; benefits: BenefitInput[] }) | null;
  subscribers: PlanVersionSubscribers[];
}
export type { PlanVersionField as VersionField, PlanVersionChangePreview as PlanVersionChangePreviewDto } from '@aipowersalon/api-contracts/tenant';

export interface PlanDetail extends PlanRow {
  branchId: string | null;
  currentVersionId: string | null;
  version: {
    versionNumber: number;
    billingInterval: string;
    intervalCount: number;
    priceCents: number;
    isCustomPricing: boolean;
    autoRenew: boolean;
    termType: string;
    termDays: number | null;
    techSplitPct: number;
    ownerSplitPct: number;
    allocationTiming: string;
    cancellationPolicy: string;
    isPublished: boolean;
    benefits: Array<{ benefitType: string; label: string; creditsPerCycle: number; valueCents: number; percent: number; allocatedValueCents: number }>;
  } | null;
}
