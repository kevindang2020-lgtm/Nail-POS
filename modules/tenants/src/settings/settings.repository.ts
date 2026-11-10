// settings.repository.ts — persistence port + in-memory adapter for POS Settings.
// Tenant isolation: every record is keyed by tenantId(+branchId); a tenant only ever sees its own row.
// Secrets (e.g. Fiserv) are stored server-side and NEVER returned raw — the service exposes a masked form.
import {
  POSSettingsState, POSSettingsAuditLogRow, SettingsCategory, SettingsContext,
  DEFAULT_SETTINGS, maskSecret,
} from './settings.dto';

export type RawSettings = Omit<POSSettingsState, 'context' | 'auditLogs' | 'moduleStatus' | 'sectionStatuses'>;

// settings category -> POSSettingsState field (audit-logs has no stored section)
export const CAT_TO_KEY: Record<SettingsCategory, keyof RawSettings | null> = {
  'business-branch': 'businessBranch', 'store-hours-auto-logout': 'storeHoursAutoLogout',
  'payments-checkout': 'paymentsCheckout', 'tips': 'tips', 'tax': 'tax',
  'booking-appointments': 'bookingAppointments', 'online-google-ai-booking': 'onlineGoogleAiBooking',
  'notifications': 'notifications', 'queue-workflow': 'queueWorkflow', 'technician-app': 'technicianApp', 'services-pricing': 'servicesPricing',
  'technicians-staff': 'techniciansStaff', 'roles-permissions': 'rolesPermissions', 'security': 'security',
  'loyalty-memberships': 'loyaltyMemberships', 'customer-display-devices': 'customerDisplayDevices',
  'receipts-branding': 'receiptsBranding', 'subscription-plan': 'subscriptionPlan', 'audit-logs': null,
  'gift-card-settings': 'giftCardSettings',
};

export interface SettingsRepositoryPort {
  getRaw(ctx: SettingsContext): Promise<RawSettings>;
  saveCategory(ctx: SettingsContext, category: SettingsCategory, value: unknown): Promise<RawSettings>;
  paymentsCredentialMasked(ctx: SettingsContext): Promise<string>; // masked only — never the raw secret
  paymentsConfig(ctx: SettingsContext): Promise<{ merchantId?: string; secret?: string }>; // server-only; for the provider adapter
  appendAudit(row: POSSettingsAuditLogRow): Promise<void>;
  listAudit(ctx: SettingsContext, limit: number): Promise<POSSettingsAuditLogRow[]>;
  /** batch 9 guide 20: the change history one page at a time (Postgres adapter only) */
  listAuditPage?(ctx: SettingsContext, f: { q?: string; from?: string; to?: string; page: number; pageSize: number }): Promise<{ rows: any[]; total: number; tz: string }>;
}

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }
function key(ctx: SettingsContext): string { return ctx.tenantId + '::' + (ctx.branchId || '-'); }

export class InMemorySettingsRepository implements SettingsRepositoryPort {
  private store = new Map<string, RawSettings>();
  private secrets = new Map<string, string>();      // tenantId -> fiserv secret (server-only)
  private merchantIds = new Map<string, string>();  // tenantId -> live Fiserv MID (none until merchant goes live)
  private audit: POSSettingsAuditLogRow[] = [];

  constructor() {
    // DEV SEED (allowed: seed/mock only — NOT shipped as production data). One tenant/branch.
    const seed = clone(DEFAULT_SETTINGS) as RawSettings;
    seed.businessBranch = { ...seed.businessBranch, salonName: 'Luxe Nails Studio', legalName: 'Luxe Nails LLC', branchName: 'Cherry Hill', city: 'Cherry Hill', state: 'NJ', zip: '08003', email: 'hello@luxenails.example', phone: '(856) 555-0142' };
    seed.onlineGoogleAiBooking = { ...seed.onlineGoogleAiBooking, tenantSlug: 'luxe-nails' };
    this.store.set('luxe001::br_cherryhill', seed);
    this.secrets.set('luxe001', 'fiserv_live_secret_8842'); // server-only; surfaces masked only
  }

  async getRaw(ctx: SettingsContext): Promise<RawSettings> {
    const k = key(ctx);
    if (!this.store.has(k)) this.store.set(k, clone(DEFAULT_SETTINGS) as RawSettings); // isolation: new tenant => own defaults
    return clone(this.store.get(k)!);
  }
  async saveCategory(ctx: SettingsContext, category: SettingsCategory, value: unknown): Promise<RawSettings> {
    const field = CAT_TO_KEY[category];
    const cur = await this.getRaw(ctx);
    if (field) (cur as any)[field] = clone(value);
    this.store.set(key(ctx), cur);
    return clone(cur);
  }
  async paymentsCredentialMasked(ctx: SettingsContext): Promise<string> {
    const s = this.secrets.get(ctx.tenantId);
    return s ? maskSecret(s) : ''; // '' => not configured
  }
  async paymentsConfig(ctx: SettingsContext): Promise<{ merchantId?: string; secret?: string }> {
    return { merchantId: this.merchantIds.get(ctx.tenantId), secret: this.secrets.get(ctx.tenantId) };
  }
  async appendAudit(row: POSSettingsAuditLogRow): Promise<void> { this.audit.push(row); }
  async listAudit(ctx: SettingsContext, limit: number): Promise<POSSettingsAuditLogRow[]> {
    return this.audit
      .filter((r) => r.tenantId === ctx.tenantId && (!r.branchId || !ctx.branchId || r.branchId === ctx.branchId))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit);
  }
}
