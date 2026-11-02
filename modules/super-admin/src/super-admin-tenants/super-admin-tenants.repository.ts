/**
 * super-admin-tenants.repository.ts
 * ---------------------------------------------------------------------------
 * Repository PORT for the Super Admin Tenants service + a runnable in-memory
 * implementation (seeded) used by tests/dev. The production Kysely implementation
 * lives in the repo and implements the same interface (joins documented below).
 *
 * CROSS-TENANT: these reads are platform-wide. The production impl must NOT apply
 * scoped() — authorization is the `super-admin` guard, not row scoping.
 */

import { secureToken } from '@aipowersalon/security';
import type {
  TenantRecord,
  StoredTenantStatus,
  AuditEntry,
} from './super-admin-tenants-core';
import type { TenantAuditRecord } from './super-admin-tenants.dto';
import type { DirectoryEnrichmentRaw } from './directory-enrichment';

export interface SuspendMeta {
  reason: string;
  byUserId?: string;
  /** Constitution 7 §18 — set while suspended, cleared otherwise */
  reasonCode?: string | null;
}

export interface CreatedTenantSeed {
  displayName: string;
  legalName?: string;
  tenantCode: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone?: string;
  plan: string;
  aiPackage?: string;
  primaryState?: string;
  primaryCity?: string;
  initialCommissionPercent?: number;
}

export interface SupportSessionRow {
  id: string;
  tenantId: string;
  expiresAt: string; // ISO
}

/** The contract the service depends on. */
/** C2: the owner account an admin-initiated reset targets. */
export interface OwnerAccountForReset { userId: string; role: string; tenantId: string | null; platformRole: string | null; email: string | null; phone: string | null }

export interface SuperAdminTenantsRepo {
  /** Platform-wide list (no scoping). Joins documented in the Kysely impl. */
  listTenantRecords(): Promise<TenantRecord[]>;
  getTenantRecord(id: string): Promise<TenantRecord | null>;
  /** Returns the new tenant id. tenantCode is assumed validated/unique by the service. */
  createTenant(seed: CreatedTenantSeed): Promise<string>;
  tenantCodeExists(code: string): Promise<boolean>;
  setStatus(
    id: string,
    status: StoredTenantStatus,
    meta?: SuspendMeta,
  ): Promise<void>;
  /** Security Deep Scan C2 (Oct 23 2026): the tenant's owner ACCOUNT for an admin-initiated reset — who it is, whether it is
   *  a platform account (refused), and its own email / phone (the only places a temporary password may go). The repo no
   *  longer mints a password: it used to hand one back to the Super Admin. */
  ownerAccountForReset(id: string): Promise<OwnerAccountForReset | null>;
  getAudit(id: string): Promise<TenantAuditRecord[]>;
  /** Constitution 7 §16 — the tenant's lifecycle state, and a move (status follows via the migration-463 trigger). */
  getLifecycle?(id: string): Promise<string | null>;
  /** Constitution 7 §20 — why the tenant is suspended (null when not), and how many of its integrations are disabled as compromised. */
  getSuspensionReasonCode?(id: string): Promise<string | null>;
  compromisedIntegrationCount?(id: string): Promise<number>;
  /** §21 — when the tenant was closed, and how many active legal holds cover it (customer or tenant-scoped audit holds). */
  closureFacts?(id: string): Promise<{ closedAt: Date | null; activeLegalHolds: number }>;
  setLifecycle?(id: string, to: string, meta: { reasonCode?: string | null }): Promise<{ status: string }>;
  writeAudit(entry: AuditEntry & { actorUserId?: string; ip?: string }): Promise<void>;
  /** Persists a tenant warning (Quick Actions → Send Warning). Returns id + the delivery status. */
  createWarning(input: TenantWarningInput): Promise<{ id: string; deliveryStatus: string }>;
  /** Recent warnings for a tenant (newest first) with their dispatch delivery status. */
  listWarnings(tenantId: string, limit?: number): Promise<TenantWarningRow[]>;
  /** Opens a short-lived Super-Admin support session for View POS / Support Access. */
  createSupportSession(tenantId: string, opts: { reason: string; byUserId?: string; ip?: string; ttlMinutes: number }): Promise<{ token: string; expiresAt: string }>;
  /** Thin raw reads for the directory-overview enrichment (active POS devices, application stages, renewals).
   *  Returns `null` per source when not connected — the service treats null as honest "NotConnected", not empty. */
  directoryEnrichmentRaw(): Promise<DirectoryEnrichmentRaw>;
}

/** Fields for a Send-Warning request (Quick Actions). */
export interface TenantWarningInput {
  tenantId: string;
  actorUserId?: string;
  warningType: string;
  severity: string;
  subject: string;
  message: string;
  sendEmail: boolean;
  sendSms: boolean;
  showInTenantDashboard: boolean;
  internalNote?: string;
}

/** A persisted warning as shown in the tenant detail panel's Recent Warnings list. */
export interface TenantWarningRow {
  id: string;
  warningType: string;
  severity: string;
  subject: string;
  message: string;
  sendEmail: boolean;
  sendSms: boolean;
  showInTenantDashboard: boolean;
  deliveryStatus: string;
  createdAt: string;
}

/* ============================================================================
 * Kysely implementation guidance (production — implement in the repo):
 *
 *   listTenantRecords():
 *     SELECT t.id, t.display_name, t.tenant_code, t.status, t.created_at,
 *            o.full_name AS owner_name, o.email AS owner_email,
 *            o.normalized_phone AS owner_phone, o.last_login_at,
 *            (o.password_hash IS NOT NULL) AS owner_activated,
 *            s.plan, s.status AS sub_status,
 *            a.package AS ai_package,
 *            pc.fiserv_configured,
 *            hp.remaining_cents,
 *            (SELECT count(*) FROM branches b WHERE b.tenant_id = t.id) AS branch_count,
 *            -- primary branch city/state = earliest branch
 *            pb.city, pb.state,
 *            -- usage metrics pivoted from tenant_usage_limits
 *            uc.used AS cust_used, uc.limit_value AS cust_cap,
 *            ut.used AS tech_used, ut.limit_value AS tech_cap,
 *            uai.used AS ai_calls, usm.used AS sms
 *     FROM tenants t
 *     LEFT JOIN users o ON o.id = t.owner_user_id
 *     LEFT JOIN LATERAL (SELECT plan, status FROM tenant_subscriptions
 *                        WHERE tenant_id = t.id ORDER BY created_at DESC LIMIT 1) s ON true
 *     LEFT JOIN LATERAL (SELECT package FROM tenant_ai_packages
 *                        WHERE tenant_id = t.id ORDER BY created_at DESC LIMIT 1) a ON true
 *     LEFT JOIN tenant_payment_config pc ON pc.tenant_id = t.id
 *     LEFT JOIN tenant_hardware_payoff hp ON hp.tenant_id = t.id
 *     LEFT JOIN LATERAL (SELECT city, state FROM branches
 *                        WHERE tenant_id = t.id ORDER BY created_at ASC LIMIT 1) pb ON true
 *     LEFT JOIN tenant_usage_limits uc  ON uc.tenant_id  = t.id AND uc.metric  = 'customers'
 *     LEFT JOIN tenant_usage_limits ut  ON ut.tenant_id  = t.id AND ut.metric  = 'technicians'
 *     LEFT JOIN tenant_usage_limits uai ON uai.tenant_id = t.id AND uai.metric = 'ai_calls'
 *     LEFT JOIN tenant_usage_limits usm ON usm.tenant_id = t.id AND usm.metric = 'sms'
 *     ORDER BY t.created_at DESC;
 *   -- map each row -> TenantRecord (cents from a revenue source, labels formatted),
 *   -- hardwarePayoffRemainingCents = hp.remaining_cents ?? -1 (no row => N/A).
 *
 *   setStatus(): UPDATE tenants SET status=$2, suspended_at/reason/by when suspending.
 *   ownerAccountForReset(): the owner user (role, platform_role, email, normalized_phone) — C2.
 *   writeAudit(): INSERT audit_logs (tenant_id, user_id, role, action_type, ...).
 * ==========================================================================*/

let __seq = 1;
function uid(prefix: string): string {
  return prefix + '_' + (__seq++).toString(36) + Date.now().toString(36);
}

/** Runnable in-memory repo — seeded; used by tests and local/offline dev. */
export class InMemorySuperAdminTenantsRepo implements SuperAdminTenantsRepo {
  private tenants: TenantRecord[];
  private audits: Record<string, TenantAuditRecord[]> = {};

  constructor(seed?: TenantRecord[]) {
    this.tenants = seed ? seed.map((t) => ({ ...t })) : defaultSeed();
  }

  async listTenantRecords(): Promise<TenantRecord[]> {
    return this.tenants.map((t) => ({ ...t }));
  }
  async getTenantRecord(id: string): Promise<TenantRecord | null> {
    const t = this.tenants.find((x) => x.id === id);
    return t ? { ...t } : null;
  }
  async tenantCodeExists(code: string): Promise<boolean> {
    return this.tenants.some((t) => t.tenantCode === code);
  }
  async createTenant(seed: CreatedTenantSeed): Promise<string> {
    const id = uid('ten');
    this.tenants.push({
      id,
      displayName: seed.displayName,
      tenantCode: seed.tenantCode,
      ownerName: seed.ownerName,
      ownerEmail: seed.ownerEmail,
      ownerPhone: seed.ownerPhone ?? '',
      ownerActivated: false,
      primaryCity: seed.primaryCity ?? '',
      primaryState: seed.primaryState ?? '',
      branchCount: 0,
      storedStatus: 'pending',
      plan: seed.plan,
      subscriptionStatus: 'trialing',
      aiPackage: seed.aiPackage ?? 'None',
      monthlyRevenueCents: 0,
      usagePercent: 0,
      fiservConfigured: false,
      paymentConfigStatus: 'pending',
      hardwarePayoffRemainingCents: -1,
      lastLoginLabel: 'Never',
      createdLabel: 'Just now',
      createdDaysAgo: 0,
      customers: [0, 0],
      technicians: [0, 0],
      aiCallsLabel: '0',
      smsLabel: '0',
    });
    return id;
  }
  async setStatus(id: string, status: StoredTenantStatus): Promise<void> {
    const t = this.tenants.find((x) => x.id === id);
    if (t) t.storedStatus = status;
  }
  /** Owner account overrides for tests (e.g. a platform account set as a salon's owner). */
  ownerOverrides: Record<string, Partial<OwnerAccountForReset>> = {};
  async ownerAccountForReset(id: string): Promise<OwnerAccountForReset | null> {
    const t = this.tenants.find((x) => x.id === id);
    if (!t) return null;
    return { userId: 'owner_' + id, role: 'OWNER', tenantId: id, platformRole: null, email: t.ownerEmail || null, phone: t.ownerPhone || null, ...(this.ownerOverrides[id] ?? {}) };
  }
  async getAudit(id: string): Promise<TenantAuditRecord[]> {
    return this.audits[id] ? this.audits[id].slice() : [];
  }
  async writeAudit(
    entry: AuditEntry & { actorUserId?: string; ip?: string },
  ): Promise<void> {
    const list = (this.audits[entry.entityId] ||= []);
    list.unshift({
      id: uid('aud'),
      actionType: entry.actionType,
      actorName: 'Super Admin',
      actorRole: 'SUPER_ADMIN',
      createdAt: new Date().toISOString(),
      ip: entry.ip,
      summary: entry.actionType.replace(/_/g, ' '),
    });
  }

  // Quick Actions ----------------------------------------------------------
  warnings: Array<TenantWarningInput & { id: string; deliveryStatus: string; createdAt: string }> = [];
  supportSessions: Array<{ token: string; tenantId: string; expiresAt: string }> = [];

  async createWarning(input: TenantWarningInput): Promise<{ id: string; deliveryStatus: string }> {
    // Honest delivery status: 'sent' only for channels actually requested; nothing is hardcoded to a provider here —
    // the service decides 'pending'/'skipped' when no notification provider is configured.
    const channels = [input.sendEmail ? 'email' : null, input.sendSms ? 'sms' : null, input.showInTenantDashboard ? 'dashboard' : null].filter(Boolean);
    const deliveryStatus = channels.length ? 'pending' : 'recorded';
    const id = uid('warn');
    this.warnings.unshift({ ...input, id, deliveryStatus, createdAt: new Date().toISOString() });
    return { id, deliveryStatus };
  }

  async listWarnings(tenantId: string, limit = 20): Promise<TenantWarningRow[]> {
    return this.warnings.filter((w) => w.tenantId === tenantId).slice(0, limit).map((w) => ({
      id: w.id, warningType: w.warningType, severity: w.severity, subject: w.subject, message: w.message,
      sendEmail: !!w.sendEmail, sendSms: !!w.sendSms, showInTenantDashboard: w.showInTenantDashboard !== false,
      deliveryStatus: w.deliveryStatus, createdAt: w.createdAt,
    }));
  }

  async createSupportSession(tenantId: string, opts: { reason: string; byUserId?: string; ip?: string; ttlMinutes: number }): Promise<{ token: string; expiresAt: string }> {
    const token = 'ss_' + secureToken(24);   // H9 (test double; production uses gen_random_uuid())
    const expiresAt = new Date(Date.now() + opts.ttlMinutes * 60_000).toISOString();
    this.supportSessions.unshift({ token, tenantId, expiresAt });
    return { token, expiresAt };
  }

  // Offline/in-memory has no device fleet, application table, or subscription periods — return honest nulls so
  // the directory overview shows "NotConnected" rather than fabricated numbers (matches the platform pattern).
  async directoryEnrichmentRaw(): Promise<DirectoryEnrichmentRaw> {
    return { activePosDevices: null, applications: null, renewals: null };
  }
}

export function defaultSeed(): TenantRecord[] {
  const base = (over: Partial<TenantRecord>): TenantRecord => ({
    id: 'x', displayName: 'X', tenantCode: 'X', ownerName: 'O', ownerEmail: 'o@x.com',
    ownerPhone: '(555) 000-0000', ownerActivated: true, primaryCity: 'Cherry Hill',
    primaryState: 'NJ', branchCount: 1, storedStatus: 'active', plan: 'Pro Plan',
    subscriptionStatus: 'active', aiPackage: 'AI Basic', monthlyRevenueCents: 100000,
    usagePercent: 50, fiservConfigured: true, paymentConfigStatus: 'active', hardwarePayoffRemainingCents: 0,
    lastLoginLabel: '1 hr ago', createdLabel: 'Apr 02, 2026', createdDaysAgo: 36,
    customers: [980, 1500], technicians: [5, 6], aiCallsLabel: '1,260', smsLabel: '880',
    ...over,
  });
  return [
    base({ id: 'luxe001', displayName: 'Luxe Nails & Spa', tenantCode: 'LUXE001', ownerName: 'Emily Johnson', ownerEmail: 'emily@luxenails.com', branchCount: 3, plan: 'Gold Plan', aiPackage: 'AI Pro', monthlyRevenueCents: 486000, usagePercent: 82, hardwarePayoffRemainingCents: 120000, createdDaysAgo: 0 }),
    base({ id: 'gold003', displayName: 'Golden Nail Bar', tenantCode: 'GOLD003', ownerName: 'Amy Nguyen', ownerEmail: 'amy@goldennailbar.com', plan: 'Trial Plan', subscriptionStatus: 'trialing', aiPackage: 'None', fiservConfigured: false, paymentConfigStatus: 'pending', monthlyRevenueCents: 128000, usagePercent: 45, hardwarePayoffRemainingCents: -1, createdDaysAgo: 6 }),
    base({ id: 'quee004', displayName: 'Queen Nails', tenantCode: 'QUEE004', ownerName: 'Linda Vu', ownerEmail: 'linda@queennails.com', plan: 'Gold Plan', subscriptionStatus: 'past_due', aiPackage: 'AI Pro', paymentConfigStatus: 'error', monthlyRevenueCents: 274000, usagePercent: 91, primaryState: 'NJ', hardwarePayoffRemainingCents: 64000 }),
    base({ id: 'bell005', displayName: 'Bella Spa', tenantCode: 'BELL005', ownerName: 'Grace Pham', ownerEmail: 'grace@bellaspa.com', plan: 'Starter Plan', subscriptionStatus: 'trialing', aiPackage: 'None', fiservConfigured: false, paymentConfigStatus: 'none', ownerActivated: false, monthlyRevenueCents: 0, usagePercent: 8, hardwarePayoffRemainingCents: -1, createdDaysAgo: 1 }),
    base({ id: 'pear009', displayName: 'Pearl Nail Spa', tenantCode: 'PEAR009', ownerName: 'Mai Vo', ownerEmail: 'mai@pearlnailspa.com', storedStatus: 'suspended', plan: 'Starter Plan', subscriptionStatus: 'trialing', aiPackage: 'None', fiservConfigured: false, paymentConfigStatus: 'disabled', primaryState: 'DE', monthlyRevenueCents: 0, usagePercent: 2, hardwarePayoffRemainingCents: -1, createdDaysAgo: 176 }),
  ];
}
