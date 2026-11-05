// customers.dto.ts — AIPowerSalon POS Customers contracts.
// All endpoints derive tenantId/branchId from the authenticated session — never from the client (§4).
// Super Admin customer search is a separate surface (/super-admin/customers); NOT this module.
import { RETURNING_MIN_VISITS } from './customer-segments';

export type CustomerStatus = "active" | "inactive" | "blocked" | "archived";
export type LoyaltyTier = "VIP Gold" | "VIP Silver" | "Gold" | "Silver" | "Regular";
export type Benchmark = "below_average" | "average" | "above_average";
export type RiskScore = "low" | "medium" | "high";

// ---- §9 KPIs ----
export interface CustomerKpis {
  totalCustomers: number;
  totalCustomersTrendPercent: number;
  newThisMonth: number;
  newThisMonthTrendPercent: number;
  vipMembers: number;
  vipPercentOfTotal: number;
  returningRatePercent: number;
  returningRateTrendPercent: number;
  birthdaysThisWeek: number;
  birthdayCustomerAvatars: { customerId: string; avatarUrl?: string; initials: string }[];
  birthdayExtraCount: number;
}

// ---- §10 table ----
export interface Pagination { page: number; pageSize: number; totalItems: number; totalPages: number; }
export interface CustomerListItem {
  customerId: string;
  fullName: string;
  phone: string;
  /** The number messages actually go to (E.164) — never the editable display text. */
  normalizedPhone?: string | null;
  email?: string;
  avatarUrl?: string;
  visitsCount: number;
  favoriteServiceName?: string;
  favoriteTechnicianName?: string;
  loyaltyTier: LoyaltyTier;
  lastVisitDate?: string;
  totalSpendCents: number;
  status: CustomerStatus;
}
export interface CustomerListResponse { items: CustomerListItem[]; pagination: Pagination; }

// ---- §11-16 profile ----
export interface CustomerRecentVisit {
  visitId: string;
  ticketId?: string;
  appointmentId?: string;
  visitDate: string;
  primaryServiceName: string;
  totalCents: number;
}
export interface CustomerProfile {
  customerId: string;
  fullName: string;
  phone: string;
  email?: string;
  avatarUrl?: string;
  loyaltyTier: string;
  loyaltyPoints: number;
  isVip: boolean;
  totalVisits: number;
  totalSpendCents: number;
  notesAndPreferences?: string;
  allergiesAndPreferences?: string[];
  favoriteServices: { serviceId: string; serviceName: string }[];
  favoriteTechnician?: { technicianId: string; name: string; roleLabel: string; avatarUrl?: string };
  recentVisits: CustomerRecentVisit[];
}

// ---- §17 insights ----
export interface CustomerInsights {
  customerId: string;
  visitFrequencyDays?: number;
  visitFrequencyLabel: string;
  visitFrequencyBenchmark: Benchmark;
  averageSpendCents: number;
  averageSpendBenchmark: Benchmark;
  totalSpendCents: number;
  spendRankPercentile?: number;
  lastReceipt?: { date: string; totalCents: number; primaryServiceName: string; ticketId: string };
  birthday?: { dateLabel: string; daysUntil: number };
  riskScore: RiskScore;
  riskLabel: string;
  riskReason?: string;
}

// ---- §21 mobile quick stats ----
export interface CustomerMobileQuickStats {
  dateLabel: string;
  newCustomers: number;
  newCustomersTrendPercent: number;
  returningCustomers: number;
  returningCustomersTrendPercent: number;
  vipVisits: number;
  vipVisitsTrendPercent: number;
  totalCustomerSpendCents: number;
  totalCustomerSpendTrendPercent: number;
  noShowRatePercent: number;
  noShowRateDeltaPercent: number;
  topServicesByCustomers: { serviceId: string; rank: number; serviceName: string; customerCount: number }[];
}

// ---- §27 consolidated state ----
export interface POSCustomersState {
  kpis: CustomerKpis;
  customers: CustomerListResponse;
  selectedCustomer?: CustomerProfile;
  selectedCustomerInsights?: CustomerInsights;
  mobileQuickStats?: CustomerMobileQuickStats;
  filters: { statuses: string[]; loyaltyTiers: string[] };
}

// ---- request DTOs (§12/§19/§20) ----
export interface UpdateCustomerPreferencesRequest { notesAndPreferences?: string; preferredStyleNotes?: string; productPreferences?: string[]; }
export interface UpsertCustomerRequest {
  firstName: string; lastName: string; phone: string; email?: string; birthday?: string;
  address?: string; preferredTechnicianId?: string; preferredServiceIds?: string[];
  allergies?: string; notes?: string; marketingSmsOptIn?: boolean; marketingEmailOptIn?: boolean;
  loyaltyTier?: LoyaltyTier; status?: CustomerStatus;
}
export interface MergeCustomersRequest { sourceCustomerId: string; targetCustomerId: string; mergeNotes?: string; }

// ---- §10/§17 pure helpers (unit-testable) ----
export function loyaltyTierRank(t: LoyaltyTier): number {
  return { "VIP Gold": 5, "VIP Silver": 4, Gold: 3, Silver: 2, Regular: 1 }[t];
}

// favorite by frequency (then spend) from completed service lines — never hardcode (§14/§15)
export interface VisitLineAgg { key: string; name: string; count: number; spendCents: number; }
export function topByFrequency(rows: VisitLineAgg[], limit: number): VisitLineAgg[] {
  return [...rows]
    .sort((a, b) => b.count - a.count || b.spendCents - a.spendCents)
    .slice(0, limit);
}

// §17 risk score: low = recent/regular, medium = late vs normal cadence, high = long inactive
export function deriveRisk(daysSinceLastVisit: number, avgFrequencyDays: number): { score: RiskScore; label: string } {
  if (avgFrequencyDays <= 0 || daysSinceLastVisit <= avgFrequencyDays * 1.2) return { score: "low", label: "Low Risk" };
  if (daysSinceLastVisit <= avgFrequencyDays * 2.5) return { score: "medium", label: "Medium Risk" };
  return { score: "high", label: "High Risk" };
}

export function benchmark(value: number, avg: number): Benchmark {
  if (avg <= 0) return "average";
  if (value >= avg * 1.1) return "above_average";
  if (value <= avg * 0.9) return "below_average";
  return "average";
}

// ===== §8/§10/§13-§19 additions: richer row + sub-resources + duplicates + filters =====
export type CustomerSource = "walk_in" | "booking" | "online" | "google" | "ai" | "import" | "manual";
export type DuplicateRisk = "none" | "possible" | "high";

export interface POSCustomerRow {
  customerId: string; tenantId: string; branchId?: string;
  /** Smooth Refresh spec §14–§16: customers.record_version (shared with the phone-activation lock). Send it back as
   *  expectedVersion when editing; a newer server copy → 409 VERSION_CONFLICT instead of a silent overwrite. */
  version?: number;
  firstName: string; lastName?: string; displayName: string; phone?: string; email?: string; avatarUrl?: string; isPhoneVerified?: boolean;
  status: "active" | "inactive" | "archived"; source: CustomerSource;
  visitCount: number; lastVisitAt?: string | null; nextAppointmentAt?: string | null;
  totalSpendCents: number; averageSpendCents: number; loyaltyPoints: number; loyaltyTier?: string; isVip: boolean;
  tags: string[]; duplicateRisk?: DuplicateRisk; marketingOptIn: boolean; smsOptIn: boolean; emailOptIn: boolean;
  /** YYYY-MM-DD when the year is known; absent when only the month/day was recorded (see birthdayMonthDay) */
  birthday?: string;
  /** MM-DD — always present when a birthday is recorded (Birthday Campaigns §05: marketing needs the month/day, never the age) */
  birthdayMonthDay?: string;
  /** Decision 1: profile fields (not private notes) — how to greet the customer, which language, which branch.
   *  preferredLanguage: 'en' | 'vi' | null since WP-I (697) — the language the salon's messages to this customer use. */
  preferredName?: string | null; preferredLanguage?: string | null; preferredBranchId?: string | null;
  createdAt: string; updatedAt: string;
}

export interface CustomerVisitRow { visitId: string; date: string; serviceName: string; technicianName: string; totalCents: number; tipCents: number; branchName?: string | null; }
export interface CustomerAppointmentRow {
  appointmentId: string;
  startsAt: string;
  serviceName: string;
  technicianName: string;
  status: string;
  branchName?: string;
  source?: string;
  scheduledDurationMinutes?: number;
  actualDurationMinutes?: number;
  originalPriceCents?: number;
  discountsCents?: number;
  finalPriceCents?: number;
  tipCents?: number;
  taxCents?: number;
  totalCents?: number;
  paymentMethodMasked?: string;
  loyaltyPointsEarned?: number;
  loyaltyPointsRedeemed?: number;
  giftCardUsageCents?: number;
  membershipBenefitUsage?: string;
  notes?: string;
  rebooked?: boolean;
  cancelReason?: string;
  refundStatus?: string;
}
export interface CustomerTicketRow { ticketId: string; date: string; totalCents: number; paymentMethod: string; status: string; }
export interface CustomerReceiptRow { receiptId: string; date: string; totalCents: number; channel: string; }
export interface CustomerNotes { salonNotes: string; allergyNotes: string; preferredStyle: string; preferredTechnician: string; servicePreferences: string; warnings: string; customerVisible: boolean; preferredLanguage?: string; preferredBranch?: string; preferredName?: string; preferredNailShapeColor?: string; favoriteProducts?: string; appointmentPreferences?: string; }
export interface CustomerLoyalty { points: number; earned: number; redeemed: number; tier: string; tierThresholdPoints: number; birthdayReward: boolean; referralReward: boolean; expiresAt?: string; }
export interface CustomerMembership { plan: string; status: "none" | "active" | "paused" | "cancelled"; startDate?: string; renewalDate?: string; benefits: string[]; billingStatus: string; }
export interface CustomerGiftCard { giftCardId: string; maskedCode: string; balanceCents: number; status: string; }

export interface POSCustomerDetail extends POSCustomerRow {
  notes: CustomerNotes; loyalty: CustomerLoyalty; membership: CustomerMembership; giftCards: CustomerGiftCard[];
  recentVisits: CustomerVisitRow[]; auditSummary: { lastAction: string; lastActorRole: string; lastAt: string }[];
}

export interface DuplicateMember { customerId: string; displayName: string; phone?: string; email?: string; status?: string; visitCount?: number; totalSpendCents?: number; loyaltyPoints?: number; loyaltyTier?: string; createdAt?: string; tags?: string[]; }
export interface DuplicateGroup { duplicateGroupId: string; reason: string; members: DuplicateMember[]; /** Decision 29: someone marked this group Not Sure. */ notSure?: boolean; }

export interface CreateCustomerRequest {
  firstName: string; lastName?: string; phone?: string; email?: string; birthday?: string | null; address?: string;
  /** set by the service from the birthday input: false = month/day only (stored on 2000, the year never shown) */
  birthdayYearKnown?: boolean;
  preferredTechnicianId?: string; preferredServiceIds?: string[]; tags?: string[]; notes?: string;
  marketingOptIn?: boolean; smsOptIn?: boolean; emailOptIn?: boolean; source?: CustomerSource; isVip?: boolean;
}
export type EditCustomerRequest = Partial<CreateCustomerRequest> & { status?: "active" | "inactive" | "archived"; expectedVersion?: number;
  /** Decision 1 profile fields; "" or null clears. preferredLanguage: 'en' / 'vi' or a typed name of one (WP-I). */
  preferredName?: string | null; preferredLanguage?: string | null; preferredBranchId?: string | null };
/** Decision 1 limits (also enforced by the service). */
export const PREFERRED_NAME_MAX = 60;
export const PREFERRED_LANGUAGE_MAX = 40;
/** Spec §14: the edit was based on an older copy of the customer. */
export class CustomerVersionConflict extends Error {
  readonly code = "VERSION_CONFLICT" as const;
  constructor(public currentVersion: number | null) { super("This customer was changed on another device. The latest details have been loaded."); this.name = "CustomerVersionConflict"; }
}

export interface CustomerFilters {
  search?: string; status?: string; segment?: string; loyaltyTier?: string; source?: string; tag?: string;
  birthdayMonth?: string; inactiveDays?: number; duplicateRisk?: string; marketingOptIn?: string; spendBand?: string;
  page?: number; pageSize?: number;
}
export interface POSCustomersKpisFull {
  totalCustomers: number; newCustomersToday: number; returningCustomersToday: number; vipCustomers: number;
  birthdayThisMonth: number; inactiveCustomers: number; duplicateProfiles: number; loyaltyMembers: number; averageSpendCents: number;
  // F1 §11-12 — see docs/customer-directory-metrics.md
  newThisMonth?: number; returningThisMonth?: number; atRiskCustomers?: number; riskDays?: number; archivedCustomers?: number;
}
export interface CustomersFilterFacets {
  segments: string[]; statuses: string[]; loyaltyTiers: string[]; visitRanges: string[]; spendRanges: string[]; sources: string[]; tags: string[];
}

// Full-population CRM analytics (demographics, lifetime value, RFM, retention) for the dashboard row. Computed from the
// complete customer list the repos already load (not the paginated page), so the numbers reflect the whole base. Real
// data only — age groups are derived from the `birthday` column; segments are rule-based over recency/frequency/monetary.
export interface CustomersAnalytics {
  ageGroups: { label: string; count: number }[];
  lifetimeValue: { totalRevenueCents: number; totalCustomers: number; repeatRatePercent: number; avgClvCents: number };
  rfm: { segment: string; count: number }[];
  retentionRatePercent: number;
}
export interface CustomerAnalyticsInput { totalSpendCents: number; visitCount: number; recencyDays: number; ageYears?: number; }
export function buildCustomersAnalytics(rows: CustomerAnalyticsInput[]): CustomersAnalytics {
  const n = rows.length;
  const ageBuckets = [{ label: '18-25', lo: 18, hi: 25 }, { label: '26-35', lo: 26, hi: 35 }, { label: '36-45', lo: 36, hi: 45 }, { label: '46-55', lo: 46, hi: 55 }, { label: '55+', lo: 56, hi: 999 }];
  const ageGroups = ageBuckets.map((b) => ({ label: b.label, count: rows.filter((r) => r.ageYears != null && r.ageYears >= b.lo && r.ageYears <= b.hi).length })).filter((g) => g.count > 0);
  const totalRevenueCents = rows.reduce((a, r) => a + (r.totalSpendCents || 0), 0);
  const repeat = rows.filter((r) => r.visitCount >= RETURNING_MIN_VISITS).length;
  const lifetimeValue = { totalRevenueCents, totalCustomers: n, repeatRatePercent: n ? Math.round((repeat / n) * 100) : 0, avgClvCents: n ? Math.round(totalRevenueCents / n) : 0 };
  const seg = (r: CustomerAnalyticsInput): string => {
    const recent = r.recencyDays <= 30, mid = r.recencyDays <= 90, freq = r.visitCount;
    if (freq >= 8 && recent) return 'Champions';
    if (freq >= 4 && mid) return 'Loyal Customers';
    if (freq <= 3 && recent) return 'Potential Loyalists';
    if (r.recencyDays > 60 && r.recencyDays <= 120 && freq >= 4) return 'At Risk';
    if (r.recencyDays > 120 && freq >= 6) return 'Cannot Lose Them';
    return 'Hibernating';
  };
  const rfmMap: Record<string, number> = {};
  for (const r of rows) { const s = seg(r); rfmMap[s] = (rfmMap[s] || 0) + 1; }
  const order = ['Champions', 'Loyal Customers', 'Potential Loyalists', 'At Risk', 'Cannot Lose Them', 'Hibernating'];
  const rfm = order.map((s) => ({ segment: s, count: rfmMap[s] || 0 })).filter((x) => x.count > 0);
  return { ageGroups, lifetimeValue, rfm, retentionRatePercent: lifetimeValue.repeatRatePercent };
}

export interface POSCustomersFullState extends POSCustomersState {
  kpisFull: POSCustomersKpisFull;
  analytics: CustomersAnalytics;
  rows: { items: POSCustomerRow[]; pagination: Pagination };
  filterFacets: CustomersFilterFacets;
  selectedCustomerDetail?: POSCustomerDetail;
  // Real period-over-period deltas (last 30d vs prior 30d). null where the metric needs a historical
  // monthly snapshot the system does not yet persist (inactive/retention/clv) — never fabricated.
  trends?: { totalCustomers: number | null; newCustomers: number | null; avgSpend: number | null; inactive: number | null; retention: number | null; clv: number | null };
  // Full-base aggregations for the right rail (computed across ALL customers, not just the current page).
  directory?: { topTags: { name: string; count: number }[]; sources: { name: string; count: number }[]; topSpendersCount: number };
  // F1 §37: last 6 months of retention from the nightly snapshots (null rate = no reliable snapshot for that month; reason says why)
  retentionSeries?: { month: string; date: string | null; ratePercent: number | null; reason: string | null }[];
  // F1 §39: the salon's latest customer activity (visits + profiles added in the last 30 days), newest first, max 8
  segmentCounts?: Record<'all' | 'never' | 'new' | 'returning' | 'vip' | 'at_risk', number>;
  recentActivity?: { customerId: string; displayName: string; avatarUrl?: string; kind: 'visit' | 'added'; at: string }[];
}

// duplicate detection (§16): group by exact phone, exact email, or similar first+last name
export interface DuplicateCandidate { customerId: string; firstName: string; lastName?: string; phone?: string; email?: string; }
export function detectDuplicates(rows: DuplicateCandidate[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const seen = new Set<string>();
  const norm = (s?: string) => (s || '').toLowerCase().replace(/\s+/g, '');
  const push = (reason: string, members: DuplicateCandidate[]) => {
    if (members.length < 2) return;
    const key = members.map((m) => m.customerId).sort().join('|') + ':' + reason;
    if (seen.has(key)) return; seen.add(key);
    groups.push({ duplicateGroupId: 'dup_' + (groups.length + 1), reason, members: members.map((m) => ({ customerId: m.customerId, displayName: `${m.firstName} ${m.lastName || ''}`.trim(), phone: m.phone, email: m.email })) });
  };
  const byPhone = new Map<string, DuplicateCandidate[]>();
  const byEmail = new Map<string, DuplicateCandidate[]>();
  const byName = new Map<string, DuplicateCandidate[]>();
  for (const r of rows) {
    if (r.phone) { const k = norm(r.phone); byPhone.set(k, [...(byPhone.get(k) || []), r]); }
    if (r.email) { const k = norm(r.email); byEmail.set(k, [...(byEmail.get(k) || []), r]); }
    const nk = norm(r.firstName) + '|' + norm(r.lastName); byName.set(nk, [...(byName.get(nk) || []), r]);
  }
  byPhone.forEach((m) => push('Same phone', m));
  byEmail.forEach((m) => push('Same email', m));
  byName.forEach((m) => push('Similar name', m));
  return groups;
}

export function customersToCsv(headers: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'; return s; };
  return [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
}

// ===== Bulk customer import (CSV → tenant customers; the same Postgres the tenant AI customer-insights reads) =====
// Built to handle large salon exports (50k+ rows): flexible header mapping, phone normalization, tolerant birthday
// parsing, and dedup against existing + within-file. Preview is a dry run (writes nothing); commit batch-inserts.

export interface CustomerImportRow {
  rowNumber: number;            // 1-based row in the file (excluding header) for error reporting
  firstName: string;
  lastName: string;
  phone?: string;               // display form, as provided
  normalizedPhone?: string;     // digits/+ only — the dedup + storage key
  email?: string;               // lowercased; dropped if malformed
  birthday?: string;            // normalized to YYYY-MM-DD, or --MM-DD when only the month/day is known
  action: 'create' | 'update' | 'duplicate' | 'error';
  reason?: string;              // why duplicate/error/update
  customerId?: string;          // (update) the matched existing customer
  fills?: ('birthday' | 'email' | 'phone')[]; // (update) which empty fields this row will fill
}

export interface CustomerImportPreview {
  detectedColumns: { firstName?: string; lastName?: string; fullName?: string; phone?: string; email?: string; birthday?: string };
  totalRows: number;
  toCreate: number;
  toUpdate: number;             // (update-existing mode) matched rows that will fill missing fields
  duplicates: number;           // matched an existing customer or an earlier row in the file
  errors: number;
  invalidEmailsDropped: number; // rows kept but with the malformed email removed
  sample: CustomerImportRow[];  // first N classified rows (the full set is never returned for large files)
}

export interface CustomerImportResult {
  /** How many imported customers were linked to a global identity inline. */
  identityLinked?: number;
  /** True when more rows remain unlinked than the inline cap — the nightly reconciliation will finish them. */
  identityDeferred?: boolean;
  created: number;
  updated: number;              // (update-existing mode) existing customers whose missing fields were filled
  duplicatesSkipped: number;
  errors: number;
  invalidEmailsDropped: number;
  totalRows: number;
  errorSamples: { rowNumber: number; reason: string }[];
}

// Robust CSV parser (RFC-4180-ish): handles quoted fields, embedded commas/newlines, and "" escapes. Tolerates \r\n.
export function parseCustomerCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let inQuotes = false;
  const s = text.replace(/^\uFEFF/, ''); // strip BOM
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* swallow; \n handles the break */ }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => (cell ?? '').trim() !== '')); // drop fully blank lines
}

const normHeader = (h: string) => (h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Map common header spellings to canonical column keys.
export function detectCustomerColumns(header: string[]): Record<string, number> {
  const idx: Record<string, number> = {};
  header.forEach((h, i) => {
    const n = normHeader(h);
    if (idx.firstName === undefined && (n === 'firstname' || n === 'first' || n === 'fname' || n === 'givenname')) idx.firstName = i;
    else if (idx.lastName === undefined && (n === 'lastname' || n === 'last' || n === 'lname' || n === 'surname' || n === 'familyname')) idx.lastName = i;
    else if (idx.fullName === undefined && (n === 'name' || n === 'fullname' || n === 'customer' || n === 'customername' || n === 'client' || n === 'clientname')) idx.fullName = i;
    else if (idx.phone === undefined && (n === 'phone' || n === 'phonenumber' || n === 'mobile' || n === 'mobilephone' || n === 'cell' || n === 'cellphone' || n === 'tel' || n === 'telephone' || n === 'contact' || n === 'contactnumber')) idx.phone = i;
    else if (idx.email === undefined && (n === 'email' || n === 'emailaddress' || n === 'mail' || n === 'email')) idx.email = i;
    else if (idx.birthday === undefined && (n === 'birthday' || n === 'birthdate' || n === 'dob' || n === 'dateofbirth' || n === 'bday' || n === 'birth')) idx.birthday = i;
  });
  return idx;
}

export function splitFullName(full: string): { firstName: string; lastName: string } {
  const parts = (full || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

// DELIBERATELY TOLERANT — not a legacy normalizer (Jul 28, 2026). CSV import is reconciliation-owned: the 7 PM
// customer-identity engine normalizes/links later via identity-core.normalizePhoneE164. Strict E.164 here would
// silently drop importable rows the reconciliation engine is designed to handle. Keep + and digits, drop junk.
export function normalizeImportPhone(raw?: string): string | undefined {
  const n = (raw || '').replace(/[^\d+]/g, '');
  return n.length >= 3 ? n : undefined; // keep anything plausibly phone-like; very short junk is dropped
}

const isEmailValid = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
export function cleanImportEmail(raw?: string): { email?: string; dropped: boolean } {
  const e = (raw || '').trim().toLowerCase();
  if (!e) return { dropped: false };
  return isEmailValid(e) ? { email: e, dropped: false } : { dropped: true };
}

// Tolerant birthday parsing → YYYY-MM-DD. Supports ISO, US M/D/Y, and month/day-only ("--MM-DD", year unknown). Returns
// undefined when nothing sensible can be parsed (birthday is optional and must never fail a row).
export function parseImportBirthday(raw?: string): string | undefined {
  const v = (raw || '').trim(); if (!v) return undefined;
  const pad = (n: number) => String(n).padStart(2, '0');
  // a REAL calendar date (Birthday Campaigns §10: "02/30/1990" used to pass here and fail the insert)
  const DIM = [31, (y: number) => ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28), 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
  const valid = (y: number, m: number, d: number) => { if (m < 1 || m > 12 || d < 1) return false; const x = DIM[m - 1]; return d <= (typeof x === 'function' ? x(y) : x); };
  let mm: RegExpMatchArray | null;
  // ISO: YYYY-MM-DD (or YYYY/MM/DD)
  if ((mm = v.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/))) {
    const y = +mm[1], m = +mm[2], d = +mm[3]; if (valid(y, m, d)) return `${y}-${pad(m)}-${pad(d)}`;
  }
  // US: M/D/YYYY or M-D-YYYY
  if ((mm = v.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/))) {
    const m = +mm[1], d = +mm[2], y = +mm[3]; if (valid(y, m, d)) return `${y}-${pad(m)}-${pad(d)}`;
  }
  // US 2-digit year: M/D/YY
  if ((mm = v.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2})$/))) {
    const m = +mm[1], d = +mm[2]; const yy = +mm[3]; const cut = new Date().getFullYear() % 100;
    const y = yy <= cut ? 2000 + yy : 1900 + yy; if (valid(y, m, d)) return `${y}-${pad(m)}-${pad(d)}`;
  }
  // Month/day only: M/D → ISO 8601 month-day "--MM-DD" (Birthday Campaigns §05: the year is UNKNOWN, not 1900; stored
  // as year-unknown so 02/29 is accepted and no age is ever derived). Before 750 this used the sentinel year 1900.
  if ((mm = v.match(/^(\d{1,2})[-/](\d{1,2})$/))) {
    const m = +mm[1], d = +mm[2]; if (valid(2000, m, d)) return `--${pad(m)}-${pad(d)}`;
  }
  // Try the engine's Date parser as a last resort (e.g., "Jan 5 1990")
  // Only for a written month name, and never a roll-over: the engine turns "02/30/1990" or "Feb 30 1990" into March 2 — a
  // birthday nobody gave (Birthday Campaigns §05). The day in the text must be the day it parsed to.
  if (/[a-z]/i.test(v)) { const t = Date.parse(v); if (!Number.isNaN(t)) { const dt = new Date(t); if (new RegExp(`(^|\\D)0?${dt.getDate()}(\\D|$)`).test(v)) return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`; } }
  return undefined;
}

export interface BulkCustomerInsert { firstName: string; lastName: string; phoneDisplay?: string; normalizedPhone?: string; email?: string; birthday?: string; }
// Fill-only-empty update for re-imports: only the provided fields are written, and only where the existing value is empty.
export interface BulkCustomerUpdate { customerId: string; birthday?: string; email?: string; normalizedPhone?: string; phoneDisplay?: string; }
export interface CustomerImportOptions { updateExisting?: boolean; }
