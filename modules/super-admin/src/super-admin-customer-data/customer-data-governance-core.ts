// Customer Data Oversight — pure governance engine. DB-free and deterministic: every KPI, chart and table value
// on the Super Admin Customer Data Oversight page is DERIVED here from the real `customers` shape, so the modules
// reconcile against one source. Anything the current schema can't back (imports, privacy/deletion requests, legal
// holds, merges) is NOT invented here — it is surfaced as NotConnected at the aggregate layer.
//
// TENANT ISOLATION: within-tenant duplicate detection groups ONLY within a single tenant_id. Cross-tenant matches
// (same normalized phone/email under different tenants) produce a PROTECTED integrity alert with the minimum
// necessary detail (a masked key + tenant ids + count) — never a merge, never one tenant's PII exposed to another.

export interface CustomerLike {
  id: string;
  tenantId: string;
  branchId: string | null;
  fullName: string | null;
  avatarUrl?: string | null;
  normalizedPhone: string | null;
  email: string | null;
  phoneVerifiedAt: string | null;
  status: string | null;
  marketingSmsOptIn: boolean;
  marketingEmailOptIn: boolean;
  marketingOptIn: boolean;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PhoneStatus = 'valid' | 'invalid' | 'missing';
export type EmailStatus = 'valid' | 'invalid' | 'missing';
export type DuplicateRisk = 'none' | 'low' | 'medium' | 'high';
export type ConsentStatus = 'consented' | 'not_consented' | 'unknown';

// ---- Phone / email validation (uses normalized values; verification is a separate signal) ----

/** Valid when the normalized phone is a plausible E.164 / NANP number (10–15 digits, optional leading +). */
export function classifyPhone(normalizedPhone: string | null): PhoneStatus {
  if (!normalizedPhone || !normalizedPhone.trim()) return 'missing';
  const digits = normalizedPhone.replace(/[^\d]/g, '');
  if (/^\+?[0-9]{10,15}$/.test(normalizedPhone.trim()) && digits.length >= 10 && digits.length <= 15) return 'valid';
  return 'invalid';
}

export function isPhoneVerified(phoneVerifiedAt: string | null): boolean {
  return !!(phoneVerifiedAt && phoneVerifiedAt.trim());
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function classifyEmail(email: string | null): EmailStatus {
  if (!email || !email.trim()) return 'missing';
  return EMAIL_RE.test(email.trim()) ? 'valid' : 'invalid';
}

// ---- Consent (purpose-specific; never copied across tenants) ----

export interface ConsentBreakdown { sms: boolean; email: boolean; general: boolean; status: ConsentStatus }
export function consentFor(c: Pick<CustomerLike, 'marketingSmsOptIn' | 'marketingEmailOptIn' | 'marketingOptIn'>): ConsentBreakdown {
  const sms = !!c.marketingSmsOptIn, email = !!c.marketingEmailOptIn, general = !!c.marketingOptIn;
  const status: ConsentStatus = sms || email || general ? 'consented' : 'not_consented';
  return { sms, email, general, status };
}

// ---- Record completeness (documented weighted fields that the schema can actually back) ----

export const COMPLETENESS_WEIGHTS = {
  fullName: 20,      // required identity
  validPhone: 20,    // a valid (not just present) phone
  validEmail: 15,    // a valid email
  tenant: 10,        // tenant ownership
  branch: 10,        // branch assignment
  consentKnown: 10,  // any consent signal recorded
  status: 10,        // lifecycle status present
  source: 5,         // created-by / source attribution
} as const;
const COMPLETENESS_TOTAL = Object.values(COMPLETENESS_WEIGHTS).reduce((a, b) => a + b, 0); // 100

export interface CompletenessResult { score: number; missing: string[]; invalid: string[] }
/** 0–100 completeness score plus the missing/invalid field lists driving it. Optional fields are never penalized. */
export function recordCompleteness(c: CustomerLike): CompletenessResult {
  const missing: string[] = [], invalid: string[] = [];
  let earned = 0;
  if (c.fullName && c.fullName.trim()) earned += COMPLETENESS_WEIGHTS.fullName; else missing.push('full_name');
  const ph = classifyPhone(c.normalizedPhone);
  if (ph === 'valid') earned += COMPLETENESS_WEIGHTS.validPhone; else if (ph === 'invalid') invalid.push('phone'); else missing.push('phone');
  const em = classifyEmail(c.email);
  if (em === 'valid') earned += COMPLETENESS_WEIGHTS.validEmail; else if (em === 'invalid') invalid.push('email'); else missing.push('email');
  if (c.tenantId) earned += COMPLETENESS_WEIGHTS.tenant; else missing.push('tenant');
  if (c.branchId) earned += COMPLETENESS_WEIGHTS.branch; else missing.push('branch');
  if (c.marketingSmsOptIn || c.marketingEmailOptIn || c.marketingOptIn) earned += COMPLETENESS_WEIGHTS.consentKnown; else missing.push('consent');
  if (c.status && c.status.trim()) earned += COMPLETENESS_WEIGHTS.status; else missing.push('status');
  if (c.createdById) earned += COMPLETENESS_WEIGHTS.source; else missing.push('source');
  return { score: Math.round((earned / COMPLETENESS_TOTAL) * 100), missing, invalid };
}

// ---- Within-tenant duplicate detection (NEVER across tenants) ----

const normName = (n: string | null) => (n || '').trim().toLowerCase().replace(/\s+/g, ' ');

export interface DuplicateCluster { tenantId: string; key: string; reason: 'phone' | 'email' | 'name'; ids: string[]; risk: DuplicateRisk; confidence: number }
/**
 * Groups customers that look like duplicates WITHIN the same tenant. Matching signals, strongest first:
 *   same valid phone (high, 0.9) · same valid email (high, 0.85) · same exact name only (low, 0.4).
 * A record never matches across tenant_id. No auto-merge — these are review candidates only.
 */
export function detectDuplicatesWithinTenant(customers: CustomerLike[]): DuplicateCluster[] {
  const clusters: DuplicateCluster[] = [];
  const byPhone = new Map<string, string[]>(), byEmail = new Map<string, string[]>(), byName = new Map<string, string[]>();
  for (const c of customers) {
    if (classifyPhone(c.normalizedPhone) === 'valid') push(byPhone, `${c.tenantId}|${c.normalizedPhone!.replace(/[^\d+]/g, '')}`, c.id);
    if (classifyEmail(c.email) === 'valid') push(byEmail, `${c.tenantId}|${c.email!.trim().toLowerCase()}`, c.id);
    if (normName(c.fullName)) push(byName, `${c.tenantId}|${normName(c.fullName)}`, c.id);
  }
  const seenPairs = new Set<string>();
  const emit = (m: Map<string, string[]>, reason: DuplicateCluster['reason'], risk: DuplicateRisk, confidence: number) => {
    for (const [key, ids] of m) {
      if (ids.length < 2) continue;
      const tenantId = key.split('|')[0];
      const sig = ids.slice().sort().join(',');
      if (reason === 'name' && seenPairs.has(sig)) continue; // don't double-count a name cluster already caught by phone/email
      if (reason !== 'name') seenPairs.add(sig);
      clusters.push({ tenantId, key, reason, ids: ids.slice().sort(), risk, confidence });
    }
  };
  emit(byPhone, 'phone', 'high', 0.9);
  emit(byEmail, 'email', 'high', 0.85);
  emit(byName, 'name', 'low', 0.4);
  return clusters;
}

/** Per-customer duplicate risk = the highest-confidence cluster it belongs to (within its tenant). */
export function duplicateRiskByCustomer(customers: CustomerLike[]): Map<string, DuplicateRisk> {
  const out = new Map<string, DuplicateRisk>();
  const rank: Record<DuplicateRisk, number> = { none: 0, low: 1, medium: 2, high: 3 };
  for (const cl of detectDuplicatesWithinTenant(customers)) {
    for (const id of cl.ids) if (rank[cl.risk] > rank[out.get(id) ?? 'none']) out.set(id, cl.risk);
  }
  return out;
}

// ---- Cross-tenant integrity alerts (protected; minimum necessary; never a merge) ----

function maskKey(k: string): string {
  if (k.includes('@')) { const [u, d] = k.split('@'); return `${u.slice(0, 2)}***@${d}`; }
  return k.length <= 4 ? '***' : `***${k.slice(-4)}`;
}
export interface CrossTenantAlert { reason: 'phone' | 'email'; maskedKey: string; tenantIds: string[]; recordCount: number }
/**
 * Flags the SAME valid phone/email appearing under DIFFERENT tenants. This is an integrity ALERT only — a real
 * person may legitimately be a customer of multiple businesses, so this never links/merges records and never
 * exposes one tenant's customer details to another. Output carries only a masked key, the tenant ids, and a count.
 */
export function detectCrossTenantAlerts(customers: CustomerLike[]): CrossTenantAlert[] {
  const phone = new Map<string, { tenants: Set<string>; n: number }>();
  const email = new Map<string, { tenants: Set<string>; n: number }>();
  for (const c of customers) {
    if (classifyPhone(c.normalizedPhone) === 'valid') bump(phone, c.normalizedPhone!.replace(/[^\d+]/g, ''), c.tenantId);
    if (classifyEmail(c.email) === 'valid') bump(email, c.email!.trim().toLowerCase(), c.tenantId);
  }
  const out: CrossTenantAlert[] = [];
  for (const [k, v] of phone) if (v.tenants.size > 1) out.push({ reason: 'phone', maskedKey: maskKey(k), tenantIds: [...v.tenants].sort(), recordCount: v.n });
  for (const [k, v] of email) if (v.tenants.size > 1) out.push({ reason: 'email', maskedKey: maskKey(k), tenantIds: [...v.tenants].sort(), recordCount: v.n });
  return out;
}

// ---- Data integrity score (documented formula over what the schema can back) ----

export interface IntegritySignals { total: number; invalidPhone: number; invalidEmail: number; incomplete: number; duplicateRecords: number; crossTenantIncidents: number }
export const INTEGRITY_DEDUCTIONS = { invalidPhone: 25, invalidEmail: 20, incomplete: 25, duplicate: 20, crossTenant: 10 } as const;
/**
 * Score = 100 − weighted penalty rates, clamped to [0,100]. Each factor's penalty is (rate × its max deduction);
 * cross-tenant uses incidents/total. Factors NOT yet backed by schema (import failure rate, privacy SLA, legal-hold
 * consistency) are documented as excluded — the score is honest about its current inputs, not padded.
 */
export function dataIntegrityScore(s: IntegritySignals): number {
  if (s.total <= 0) return 100;
  const rate = (n: number) => Math.min(1, Math.max(0, n / s.total));
  const penalty =
    rate(s.invalidPhone) * INTEGRITY_DEDUCTIONS.invalidPhone +
    rate(s.invalidEmail) * INTEGRITY_DEDUCTIONS.invalidEmail +
    rate(s.incomplete) * INTEGRITY_DEDUCTIONS.incomplete +
    rate(s.duplicateRecords) * INTEGRITY_DEDUCTIONS.duplicate +
    rate(s.crossTenantIncidents) * INTEGRITY_DEDUCTIONS.crossTenant;
  return Math.round(Math.max(0, 100 - penalty) * 10) / 10;
}

// ---- small helpers ----
function push(m: Map<string, string[]>, k: string, v: string) { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); }
function bump(m: Map<string, { tenants: Set<string>; n: number }>, k: string, tenant: string) { const e = m.get(k); if (e) { e.tenants.add(tenant); e.n++; } else m.set(k, { tenants: new Set([tenant]), n: 1 }); }
