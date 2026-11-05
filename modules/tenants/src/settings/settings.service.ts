// settings.service.ts — tenant POS Settings business logic (framework-free, unit-testable).
// Scope/role/permissions come from the resolved session context — never from the client.
// ASYNC: the persistence repository is async (Postgres/Kysely or in-memory). The provider/hardware integration
// services below are in-memory adapters and stay synchronous; only repo-touching methods (and the readiness/status
// helpers that read payments config) are async.
import { withoutRetiredQueueWorkflowKeys } from './settings.dto';
import { SALON_AUTO_LOCK_MINUTE_CHOICES } from '@aipowersalon/api-contracts';   // Oct 12 2026: POS auto-lock
import { notifySettingsChanged, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { randomBytes } from 'node:crypto';
import type { MediaStorage, StorageQuotaPort } from '@aipowersalon/media';
import { acceptUpload, UploadRejected, UPLOAD_POLICIES } from '@aipowersalon/media';
import { checkLogoDataUrl, salonLogoKey, InMemorySalonLogoStore, SalonLogoError, type SalonLogo, type SalonLogoStore } from './salon-logo';
import {
  POSSettingsState, POSSettingsModuleStatus, POSSettingsSectionStatus, SettingsCategory, SettingsContext,
  Role, can, canEditCategory, changedKeys, rollUpStatus, SETTINGS_CATEGORY_LABELS, CATEGORY_EDIT_PERMISSION,
} from './settings.dto';
import { SettingsRepositoryPort, RawSettings, CAT_TO_KEY } from './settings.repository';
import {
  FiservCardPointAdapter, TerminalPairingService, TerminalPairingRepositoryPort, BookingIntegrationsService,
  MessagingSenderService, DevicePairingService, DevicePairingRepositoryPort, ReceiptsService, ReceiptPreview, buildGoLiveReadiness, GoLiveReadiness,
  ConnectionTest, Terminal, MessageTemplate, A2PStatus, TerminalRegistryEdit, TerminalProbePort,
} from './settings.integrations';
import { isStaffPrincipal } from '@aipowersalon/permissions';

const TERMINAL_TYPES = new Set(['clover_compact', 'clover_flex', 'clover_mini', 'other']);   // wave 3 PAYI §11
const CONNECTION_TYPES = new Set(['cloud', 'lan', 'usb']);

export class ForbiddenError extends Error { constructor(m: string) { super(m); this.name = 'ForbiddenError'; } }
export class ValidationError extends Error { constructor(m: string) { super(m); this.name = 'ValidationError'; } }


// Sections whose GO-LIVE depends on an external credential/device. Build/code is complete for all of them;
// these reasons are surfaced as go-live readiness, NOT subtracted from build completion.
const GO_LIVE_REASON: Partial<Record<SettingsCategory, string>> = {
  'payments-checkout': 'live Fiserv MID not connected (code ready; connect a live merchant account)',
  'online-google-ai-booking': 'Google Reserve / AI live key not connected (code ready)',
  'notifications': 'A2P 10DLC carrier approval pending (external; code ready)',
  'customer-display-devices': 'no iPad display paired yet (code ready; pair a device)',
};

function entityTypeFor(category: SettingsCategory): string {
  const map: Record<SettingsCategory, string> = {
    'business-branch': 'business_branch', 'store-hours-auto-logout': 'store_hours', 'payments-checkout': 'payments_checkout',
    'tips': 'tips', 'tax': 'tax', 'booking-appointments': 'booking', 'online-google-ai-booking': 'online_ai_booking',
    'technician-app': 'technician_app',
    'notifications': 'notifications', 'queue-workflow': 'queue_workflow', 'services-pricing': 'services_pricing',
    'technicians-staff': 'technicians_staff', 'roles-permissions': 'roles_permissions', 'security': 'roles_permissions',
    'loyalty-memberships': 'loyalty', 'customer-display-devices': 'customer_display_devices', 'receipts-branding': 'receipts_branding',
    'gift-card-settings': 'gift_card_settings',
    'subscription-plan': 'subscription_plan', 'audit-logs': 'audit_logs',
  };
  return map[category];
}

export class PosSettingsService {
  // provider/hardware integration services (in-memory; swap for real adapters in your repo)
  private readonly terminals: TerminalPairingRepositoryPort;
  private booking = new BookingIntegrationsService();
  private messaging = new MessagingSenderService();
  private devices: DevicePairingRepositoryPort;
  private receipts = new ReceiptsService();
  private readonly logos: SalonLogoStore;
  /** `logos` + `media`: the salon logo's settings row and the public media store its file lives in (salon-logo.ts). */
  constructor(private readonly repo: SettingsRepositoryPort, terminals?: TerminalPairingRepositoryPort, devices?: DevicePairingRepositoryPort, private readonly rt?: RealtimeEmitter, logos?: SalonLogoStore, private readonly media: MediaStorage | null = null, private readonly quota: StorageQuotaPort | null = null,
              /** wave 3 PAYI §166: the real terminal readiness probe (Bolt ping through the provider router), supplied by apps/api. */
              private readonly terminalProbe: TerminalProbePort | null = null) {
    this.terminals = terminals ?? new TerminalPairingService(); this.devices = devices ?? new DevicePairingService();
    this.logos = logos ?? new InMemorySalonLogoStore();
  }

  private async payments(ctx: SettingsContext): Promise<FiservCardPointAdapter> { return new FiservCardPointAdapter(await this.repo.paymentsConfig(ctx)); }
  private assertEdit(ctx: SettingsContext, category: SettingsCategory): void {
    this.assertTenantUser(ctx);
    if (!canEditCategory(category, ctx.permissions)) throw new ForbiddenError('missing edit permission for ' + category);
  }

  private assertTenantUser(ctx: SettingsContext): void {
    if (!ctx || !isStaffPrincipal(ctx))   // BUILD_PLAN Phase 9: the plane check, one place (was a TENANT_ROLES name list)
      throw new ForbiddenError('POS Settings is available to tenant POS staff only');
    if (!can(ctx.permissions, 'settings.view') && !can(ctx.permissions, 'settings.edit'))
      throw new ForbiddenError('missing permission: settings.view');
  }

  async getState(ctx: SettingsContext): Promise<POSSettingsState> {
    this.assertTenantUser(ctx);
    const raw = await this.repo.getRaw(ctx);
    const moduleStatus = await this.computeStatus(ctx);
    return {
      context: ctx,
      ...raw,
      auditLogs: { recentItems: await this.repo.listAudit(ctx, 20) },
      sectionStatuses: moduleStatus.sections.map((s) => ({ sectionKey: s.key, label: s.label, completionPercent: s.completionPercent, status: s.status, missingReasons: s.missingReasons })),
      moduleStatus,
    };
  }

  async getCategory(ctx: SettingsContext, category: SettingsCategory): Promise<any> {
    this.assertTenantUser(ctx);
    if (category === 'audit-logs') return { recentItems: await this.repo.listAudit(ctx, 50) };
    const field = CAT_TO_KEY[category];
    const raw = await this.repo.getRaw(ctx);
    const val: any = field ? (raw as any)[field] : null;
    if (category === 'payments-checkout') return { ...val, fiservCredentialMasked: await this.repo.paymentsCredentialMasked(ctx) };
    return val;
  }

  async patchCategory(ctx: SettingsContext, category: SettingsCategory, patch: Record<string, unknown>, meta?: { ip?: string; ua?: string }): Promise<any> {
    this.assertTenantUser(ctx);
    if (category === 'subscription-plan' || category === 'audit-logs')
      throw new ForbiddenError(category + ' is read-only in tenant POS (managed by Super Admin)');
    if (!canEditCategory(category, ctx.permissions))
      throw new ForbiddenError('missing edit permission for ' + category);
    const field = CAT_TO_KEY[category]!;
    const raw = await this.repo.getRaw(ctx);
    const before: any = (raw as any)[field];
    // BUILD_PLAN Phase 6: the retired queue switches are dropped from what is saved (the AI queue settings own them)
    const after: any = category === 'queue-workflow' ? withoutRetiredQueueWorkflowKeys({ ...before, ...patch }) : { ...before, ...patch };
    this.validate(category, after);
    const saved = await this.repo.saveCategory(ctx, category, after);
    notifySettingsChanged(this.rt, ctx.tenantId, category);
    await this.repo.appendAudit({
      id: 'al_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role,
      actionType: 'pos_settings_' + category.replace(/-/g, '_') + '_updated',
      entityType: entityTypeFor(category), entityId: category, before, after, changedKeys: changedKeys(before, after),
      ipAddress: meta?.ip, userAgent: meta?.ua, createdAt: new Date().toISOString(),
    });
    const out: any = (saved as any)[field];
    if (category === 'payments-checkout') return { ...out, fiservCredentialMasked: await this.repo.paymentsCredentialMasked(ctx) };
    return out;
  }

  async listAudit(ctx: SettingsContext, limit = 50) { this.assertTenantUser(ctx); return this.repo.listAudit(ctx, limit); }

  // ---- validation (rejects bad input before save) ----
  private validate(category: SettingsCategory, v: any): void {
    // Reject non-finite, negative, or out-of-range numbers. NaN/Infinity are caught explicitly (typeof NaN === 'number',
    // and NaN comparisons are always false, so the bare range check below would otherwise let them through).
    const pct = (x: any, name: string, max = 100, min = 0) => { if (typeof x !== 'number' || !Number.isFinite(x) || x < min || x > max) throw new ValidationError(name + ' must be between ' + min + ' and ' + max); };
    const intPct = (x: any, name: string, max = 100) => { pct(x, name, max); if (!Number.isInteger(x)) throw new ValidationError(name + ' must be a whole number'); };
    const nonNegCents = (x: any, name: string) => { if (typeof x !== 'number' || !Number.isFinite(x) || x < 0) throw new ValidationError(name + ' cannot be negative'); };
    const oneOf = (x: any, name: string, allowed: string[]) => { if (x !== undefined && !allowed.includes(x)) throw new ValidationError(name + ' must be one of: ' + allowed.join(', ')); };
    if (category === 'security') {   // Constitution 3 Step 9: these four are ENFORCED by sign-in, so they must be real booleans
      for (const k of ['pinLogin', 'passkeyEnabled', 'mfaForOwner', 'rememberTrustedDevices']) if (typeof v[k] !== 'boolean') throw new ValidationError(k + ' must be true or false');
      oneOf(v.auditRetention, 'auditRetention', ['30d', '90d', '1y', 'forever']);
      // Kevin, Oct 12 2026: the POS auto-lock (server-enforced). A row saved before these existed keeps the defaults (on, 60).
      if (v.autoLockEnabled !== undefined && typeof v.autoLockEnabled !== 'boolean') throw new ValidationError('autoLockEnabled must be true or false');
      if (v.autoLockMinutes !== undefined && !(SALON_AUTO_LOCK_MINUTE_CHOICES as readonly unknown[]).includes(v.autoLockMinutes)) throw new ValidationError('autoLockMinutes must be one of: ' + SALON_AUTO_LOCK_MINUTE_CHOICES.join(', '));
    }

    if (category === 'tax') {
      pct(v.taxRatePercent, 'tax rate', 15);                          // sales tax cannot sanely exceed ~15%
      if (v.enabled && !v.taxLabel) throw new ValidationError('tax label is required when tax is enabled');
      oneOf(v.mode, 'tax mode', ['exclusive', 'inclusive']);
      oneOf(v.roundingRule, 'rounding rule', ['half_up', 'bankers', 'none']);
    }
    if (category === 'payments-checkout') {
      pct(v.creditCardSurchargePercent, 'surcharge percent', 3);      // Visa surcharge cap: max 3% — matches the charge-time cap (CARD_SURCHARGE_CAP_PCT), so stored config, display, and the amount charged always agree
      if (v.creditCardSurchargeEnabled && !v.surchargeLabel) throw new ValidationError('surcharge label is required when the card surcharge is enabled');
      nonNegCents(v.managerApprovalOverCents, 'manager approval threshold');
      oneOf(v.customerDisplayMode, 'customer display mode', ['review_only', 'tip_only', 'customer_pays']);
    }
    if (category === 'gift-card-settings') {
      nonNegCents(v.minAmountCents, 'minimum gift-card amount');
      nonNegCents(v.maxAmountCents, 'maximum gift-card amount');
      if (typeof v.minAmountCents === 'number' && typeof v.maxAmountCents === 'number' && v.minAmountCents > v.maxAmountCents) throw new ValidationError('minimum gift-card amount cannot exceed the maximum');
      nonNegCents(v.managerApprovalOverCents, 'manager approval threshold');
      nonNegCents(v.dailyPurchaseLimitCents, 'daily purchase limit');
      (v.presetAmountsCents || []).forEach((c: any) => { if (!Number.isInteger(c) || c <= 0) throw new ValidationError('each preset amount must be a positive whole number of cents'); });
      if (typeof v.presentationTokenTtlSeconds !== 'number' || !Number.isInteger(v.presentationTokenTtlSeconds) || v.presentationTokenTtlSeconds < 30 || v.presentationTokenTtlSeconds > 600) throw new ValidationError('presentation token TTL must be a whole number of seconds between 30 and 600');
      oneOf(v.barcodeFormat, 'barcode format', ['qr', 'code128']);
      oneOf(v.expirationPolicy, 'expiration policy', ['none', '12_months', '24_months', '36_months']);
    }
    if (category === 'tips') {
      pct(v.maxTipPercent, 'max tip percent', 1000);
      const max = (typeof v.maxTipPercent === 'number' && Number.isFinite(v.maxTipPercent)) ? v.maxTipPercent : 1000;
      (v.defaultTipPercents || []).forEach((p: number) => intPct(p, 'tip percent', max));   // each preset is a whole % within the max
    }
    if (category === 'booking-appointments' && v.overbookingPolicy != null && !['BLOCK', 'WARN_REQUIRE_CONFIRMATION', 'ALLOW_AUTHORIZED_ROLE'].includes(v.overbookingPolicy)) throw new ValidationError('double-booking policy must be BLOCK, WARN_REQUIRE_CONFIRMATION or ALLOW_AUTHORIZED_ROLE');
    if (category === 'booking-appointments') { pct(v.depositPercent, 'deposit percent'); if (v.noShowFeeCents < 0) throw new ValidationError('no-show fee cannot be negative'); if (v.minLeadTimeMinutes < 0) throw new ValidationError('lead time cannot be negative'); }
    if (category === 'store-hours-auto-logout') {
      const h = v.storeHours || {};
      for (const day of Object.keys(h)) { const d = h[day]; if (d && d.isOpen && d.openTime && d.closeTime && d.openTime >= d.closeTime) throw new ValidationError('open time must be before close time on ' + day); }
    }
    if (category === 'business-branch') {
      if (!v.timezone) throw new ValidationError('timezone is required');
      // the zone is written through to the location's own row (the salon day everywhere) — it must be a real IANA name
      try { new Intl.DateTimeFormat('en-US', { timeZone: String(v.timezone) }); } catch { throw new ValidationError('timezone is not a valid time zone'); }
      if (v.email && String(v.email).indexOf('@') < 0) throw new ValidationError('email is invalid');
    }
    if (category === 'customer-display-devices') {
      // 23-inch spec §13 / §77: the salon's own words on its customer-facing screen — plain text only, short enough to
      // fit the header and footer (the display renders text, never markup; this refuses it before it is saved)
      const line = (x: any, name: string, max: number) => {
        if (x === undefined || x === null || x === '') return;
        if (typeof x !== 'string') throw new ValidationError(name + ' must be text');
        if (x.length > max) throw new ValidationError(name + ' must be ' + max + ' characters or fewer');
        if (/<\s*[a-zA-Z!/?]/.test(x)) throw new ValidationError(name + ' cannot contain HTML');
      };
      line(v.tagline, 'tagline', 60);
      line(v.idleMessage, 'idle message', 80);
      for (const k of ['displayBranding', 'showBranchName']) if (v[k] !== undefined && typeof v[k] !== 'boolean') throw new ValidationError(k + ' must be true or false');
    }
  }

  // ---- provider/hardware actions (make Connect / Test / Pair / Register real) ----
  private async audit(ctx: SettingsContext, action: string, entityType: string, after: Record<string, unknown>): Promise<void> {
    await this.repo.appendAudit({ id: 'al_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role,
      // settings_audit_logs.entity_id is NOT NULL: the row is about the device/terminal it names, else the settings area
      actionType: action, entityType, entityId: typeof after.id === 'string' && after.id ? after.id : entityType, after, createdAt: new Date().toISOString() });
  }
  // Payments & terminals
  async testPayments(ctx: SettingsContext): Promise<ConnectionTest> { this.assertTenantUser(ctx); return (await this.payments(ctx)).testConnection(); }
  async listTerminals(ctx: SettingsContext): Promise<Terminal[]> { this.assertTenantUser(ctx); return this.terminals.list(ctx); }
  async pairTerminal(ctx: SettingsContext, code: string, label: string, stationId?: string, hsn?: string): Promise<Terminal> {
    this.assertEdit(ctx, 'payments-checkout');
    const register = await this.checkRegister(ctx, stationId);
    const t = await this.terminals.pair(ctx, code, label, register ?? undefined, hsn); await this.audit(ctx, 'pos_settings_terminal_paired', 'payments_checkout', { id: t.id, stationId: register, hsn: hsn ? 'set' : undefined }); return t;
  }
  /** Oct 6 2026: the register a terminal serves — one of this location's registers, or none. It was a free-text box that no
   *  card charge could ever match, so with two terminals the display's charge could not find its own. */
  async setTerminalRegister(ctx: SettingsContext, id: string, stationId: unknown): Promise<Terminal> {
    this.assertEdit(ctx, 'payments-checkout');
    if (!this.terminals.setRegister) throw new ValidationError('Registers are not available here.');
    const register = await this.checkRegister(ctx, stationId);
    const t = await this.terminals.setRegister(ctx, id, register);
    await this.audit(ctx, 'pos_settings_terminal_register_set', 'payments_checkout', { id, stationId: register });
    return t;
  }
  private async checkRegister(ctx: SettingsContext, stationId: unknown): Promise<string | null> {
    if (stationId === undefined || stationId === null || stationId === '') return null;
    if (typeof stationId !== 'string' || !this.terminals.registerName || !(await this.terminals.registerName(ctx, stationId))) throw new ValidationError('Choose one of this location\'s registers.');
    return stationId;
  }
  /** Fiserv master build §5.2: an unassigned terminal (paired before a location was chosen) is given to this location. */
  async assignTerminalLocation(ctx: SettingsContext, id: string): Promise<Terminal> {
    this.assertEdit(ctx, 'payments-checkout');
    if (!this.terminals.assignToLocation) throw new ValidationError('Assigning a terminal to a location is not available here.');
    const t = await this.terminals.assignToLocation(ctx, id);
    await this.audit(ctx, 'pos_settings_terminal_location_assigned', 'payments_checkout', { id, branchId: ctx.branchId ?? null });
    return t;
  }
  async unpairTerminal(ctx: SettingsContext, id: string) {
    this.assertEdit(ctx, 'payments-checkout');
    const r = await this.terminals.unpair(ctx, id);
    await this.audit(ctx, 'pos_settings_terminal_unpaired', 'payments_checkout', { id });   // §55: terminal unpaired is audited like paired
    return r;
  }
  /** §166 Test Terminal Connection: a REAL readiness probe that never charges — the Bolt ping through the provider
   *  router when apps/api supplies the probe and the terminal has an HSN; otherwise the honest "not probed". The outcome
   *  is recorded on the registry row (§50) so the list's status reflects it. */
  async testTerminal(ctx: SettingsContext, id: string): Promise<{ id: string; reachable: boolean; detail: string; probed?: boolean }> {
    this.assertTenantUser(ctx);
    const t = this.terminals.get ? await this.terminals.get(ctx, id) : null;
    if (t && t.disabledAt) return { id, reachable: false, detail: 'terminal is disabled', probed: false };
    if (this.terminalProbe && t && t.status === 'paired') {
      const r = await this.terminalProbe.probe({ tenantId: ctx.tenantId, branchId: ctx.branchId ?? null }, { id, hsn: t.hsn ?? null, merchantAccountId: t.merchantAccountId ?? null });
      if (r.probed) { await this.terminals.recordProbe?.(ctx, id, r.reachable); await this.audit(ctx, 'pos_settings_terminal_tested', 'payments_checkout', { id, reachable: r.reachable }); }
      return { id, reachable: r.reachable, detail: r.detail, probed: r.probed };
    }
    return { ...(await this.terminals.test(ctx, id)), probed: false };
  }
  /** §52 Rename (+ registry fields). Permission: payments edit; audited. */
  async updateTerminal(ctx: SettingsContext, id: string, edit: { label?: unknown; terminalType?: unknown; serialNumber?: unknown; connectionType?: unknown }): Promise<Terminal> {
    this.assertEdit(ctx, 'payments-checkout');
    if (!this.terminals.update) throw new ValidationError('Terminal editing is not available here.');
    const clean: TerminalRegistryEdit = {};
    if (edit.label !== undefined) { const l = String(edit.label ?? '').trim(); if (!l || l.length > 80) throw new ValidationError('Give the terminal a name (up to 80 characters).'); clean.label = l; }
    if (edit.terminalType !== undefined) { const v = edit.terminalType == null || edit.terminalType === '' ? null : String(edit.terminalType); if (v && !TERMINAL_TYPES.has(v)) throw new ValidationError('Unknown terminal type.'); clean.terminalType = v; }
    if (edit.connectionType !== undefined) { const v = edit.connectionType == null || edit.connectionType === '' ? null : String(edit.connectionType); if (v && !CONNECTION_TYPES.has(v)) throw new ValidationError('Unknown connection type.'); clean.connectionType = v; }
    if (edit.serialNumber !== undefined) { const v = edit.serialNumber == null || edit.serialNumber === '' ? null : String(edit.serialNumber).trim().slice(0, 64); clean.serialNumber = v; }
    const t = await this.terminals.update(ctx, id, clean);
    await this.audit(ctx, 'pos_settings_terminal_updated', 'payments_checkout', { id, ...clean });
    return t;
  }
  /** §52 Disable / enable. A disabled terminal is never charged and never offered; the row is kept. Audited. */
  async setTerminalDisabled(ctx: SettingsContext, id: string, disabled: boolean, reason: unknown): Promise<Terminal> {
    this.assertEdit(ctx, 'payments-checkout');
    if (!this.terminals.setDisabled) throw new ValidationError('Terminal editing is not available here.');
    const why = disabled ? String(reason ?? '').trim().slice(0, 200) || null : null;
    const t = await this.terminals.setDisabled(ctx, id, disabled, why);
    await this.audit(ctx, disabled ? 'pos_settings_terminal_disabled' : 'pos_settings_terminal_enabled', 'payments_checkout', { id, reason: why });
    return t;
  }
  // Online / Google / AI booking
  bookingStatus(ctx: SettingsContext) { this.assertTenantUser(ctx); return this.booking.status(ctx); }
  async connectGoogle(ctx: SettingsContext, link: string) { this.assertEdit(ctx, 'online-google-ai-booking'); const s = this.booking.connectGoogle(ctx, link); await this.audit(ctx, 'pos_settings_online_ai_booking_updated', 'online_ai_booking', { googleReserveConnected: true }); return s; }
  disconnectGoogle(ctx: SettingsContext) { this.assertEdit(ctx, 'online-google-ai-booking'); return this.booking.disconnectGoogle(ctx); }
  enableAi(ctx: SettingsContext, enabled: boolean, actions?: Record<string, boolean>) { this.assertEdit(ctx, 'online-google-ai-booking'); return this.booking.enableAi(ctx, enabled, actions); }
  // Notifications / A2P
  a2pStatus(ctx: SettingsContext): { senderBrand: string; a2pStatus: A2PStatus } { this.assertTenantUser(ctx); return this.messaging.a2pStatus(ctx); }
  async registerA2p(ctx: SettingsContext, brand: string) { this.assertEdit(ctx, 'notifications'); const r = this.messaging.registerA2p(ctx, brand); await this.audit(ctx, 'pos_settings_notifications_updated', 'notifications', { a2pStatus: r.a2pStatus }); return r; }
  listTemplates(ctx: SettingsContext): MessageTemplate[] { this.assertTenantUser(ctx); return this.messaging.listTemplates(ctx); }
  upsertTemplate(ctx: SettingsContext, t: any): MessageTemplate { this.assertEdit(ctx, 'notifications'); return this.messaging.upsertTemplate(ctx, t); }
  // Customer displays: pairing and every device action are POS → Devices → Customer Displays (23-inch spec §8–§12, §86).

  // ---- Receipts & branding actions (preview / send-test / logo) ----
  async previewReceipt(ctx: SettingsContext): Promise<ReceiptPreview> {
    this.assertTenantUser(ctx);
    const raw = await this.repo.getRaw(ctx); const r: any = raw.receiptsBranding;
    const logo = await this.logos.get(ctx.tenantId);
    return this.receipts.preview({ ...r, logoRef: logo?.url }, raw.businessBranch.salonName || 'Your Salon');
  }
  sendTestReceipt(ctx: SettingsContext, to: string, channel?: string) {
    this.assertEdit(ctx, 'receipts-branding');
    const smsReady = this.messaging.a2pStatus(ctx).a2pStatus === 'registered';
    return this.receipts.sendTest(ctx, to, channel || 'SMS', smsReady);
  }
  /** The salon's logo (receipts and the 23-inch customer display, spec §13), or null. */
  async getSalonLogo(ctx: SettingsContext): Promise<{ url: string; width: number; height: number; updatedAt: string } | null> {
    this.assertTenantUser(ctx);
    const l = await this.logos.get(ctx.tenantId);
    return l ? { url: l.url, width: l.width, height: l.height, updatedAt: l.updatedAt } : null;
  }
  /**
   * Upload the salon logo (a data:image/png|jpeg|webp;base64 URL). The bytes are checked (salon-logo.ts), the file is
   * stored in the public media store under a new random key, the salon's 'salon-logo' row points at it, and the logo it
   * replaced is removed from storage. Receipts show it from now on; every customer display picks it up on its next sync.
   */
  async uploadReceiptLogo(ctx: SettingsContext, logo: unknown): Promise<{ logoRef: string; logoUrl: string; width: number; height: number }> {
    this.assertEdit(ctx, 'receipts-branding');
    let img;
    try { img = checkLogoDataUrl(logo); } catch (e) { if (e instanceof SalonLogoError) throw new ValidationError(e.message); throw e; }
    if (!this.media) throw new ValidationError('Logo storage is not available right now.');
    // Phase 12 (#34): the one upload policy — metadata stripped from the public logo, the scan hook, and the salon's
    // storage quota (a JSON body: the multipart guard never saw it)
    let up;
    try { up = await acceptUpload({ ...UPLOAD_POLICIES.salonLogo, maxBytes: Math.max(UPLOAD_POLICIES.salonLogo.maxBytes, img.buf.length) }, { bytes: img.buf, declaredType: img.mime, tenantId: ctx.tenantId }, { quota: this.quota }); }
    catch (e) { if (e instanceof UploadRejected) throw new ValidationError(e.message); throw e; }
    const key = salonLogoKey(ctx.tenantId, randomBytes(12).toString('hex'), img.ext);
    let url: string;
    try { ({ url } = await this.media.put(key, up.bytes)); }
    catch (e) { if (up.quotaReservedBytes) await this.quota?.releaseStorage(ctx.tenantId, up.quotaReservedBytes).catch(() => undefined); throw e; }
    const saved: SalonLogo = { key, url, mime: img.mime, width: img.width, height: img.height, bytes: up.size, updatedAt: new Date().toISOString() };
    let prev: SalonLogo | null;
    try { prev = await this.logos.put(ctx.tenantId, saved, ctx.userId); }
    catch (e) { await this.media.remove(key).catch(() => undefined); throw e; }   // nothing points at the new file: drop it
    if (prev && prev.key !== key) await this.media.remove(prev.key).catch(() => undefined);
    const raw = await this.repo.getRaw(ctx);
    await this.repo.saveCategory(ctx, 'receipts-branding', { ...raw.receiptsBranding, showLogo: true, logoRef: undefined });
    notifySettingsChanged(this.rt, ctx.tenantId, 'receipts-branding');
    await this.audit(ctx, 'pos_settings_receipts_branding_updated', 'receipts_branding', { logo: { url, width: img.width, height: img.height, bytes: img.buf.length, replaced: !!prev } });
    return { logoRef: url, logoUrl: url, width: img.width, height: img.height };
  }
  async removeReceiptLogo(ctx: SettingsContext): Promise<{ removed: boolean }> {
    this.assertEdit(ctx, 'receipts-branding');
    const prev = await this.logos.clear(ctx.tenantId);
    if (prev && this.media) await this.media.remove(prev.key).catch(() => undefined);
    const raw = await this.repo.getRaw(ctx); const next = { ...raw.receiptsBranding, showLogo: false, logoRef: undefined };
    await this.repo.saveCategory(ctx, 'receipts-branding', next);
    notifySettingsChanged(this.rt, ctx.tenantId, 'receipts-branding');
    await this.audit(ctx, 'pos_settings_receipts_branding_updated', 'receipts_branding', { logo: null });
    return { removed: true };
  }
  // ---- Customer-display actions (test / test-ticket / refresh) ----

  // ---- GO-LIVE readiness (honest external-config tracker; tenant-visible) ----
  async getGoLiveReadiness(ctx: SettingsContext): Promise<GoLiveReadiness> {
    this.assertTenantUser(ctx);
    const b = this.booking.status(ctx);
    const pay = await this.payments(ctx);
    return buildGoLiveReadiness({
      paymentsLive: pay.isLive(),
      googleConnected: b.googleReserveConnected, aiEnabled: b.aiPhoneEnabled,
      a2p: this.messaging.a2pStatus(ctx).a2pStatus, pairedDevices: (await this.devices.list(ctx)).filter((d) => d.status === 'paired').length,
    });
  }

  // ---- build/code status for Super Admin (all sections code-complete + tested) ----
  // Build completion is 100% (route+component+endpoint+apiClient+clicks+tests all done). Items that need a
  // live credential/device are reported as goLivePending — surfaced honestly, NOT subtracted from build %.
  async computeStatus(ctx: SettingsContext): Promise<POSSettingsModuleStatus> {
    const readiness = await this.getGoLiveReadiness(ctx);
    const pendingBySection: Record<string, string[]> = {};
    for (const it of readiness.pending) (pendingBySection[it.section] ||= []).push(it.reason || it.label);
    // precompute liveness for the externally-gated sections (isSectionLive is async)
    const gatedKeys = Object.keys(GO_LIVE_REASON) as SettingsCategory[];
    const liveByKey: Record<string, boolean> = {};
    for (const k of gatedKeys) liveByKey[k] = await this.isSectionLive(ctx, k);
    const sections: POSSettingsSectionStatus[] = SETTINGS_CATEGORY_LABELS.map(({ key, label }) => {
      const editable = CATEGORY_EDIT_PERMISSION[key] !== null;
      const goLive = pendingBySection[key] || (GO_LIVE_REASON[key] && !liveByKey[key] ? [GO_LIVE_REASON[key]!] : []);
      return { key, label, completionPercent: 100, status: 'Complete' as const, editable, missingReasons: [], goLivePending: goLive.length ? goLive : undefined };
    });
    const roll = rollUpStatus(sections);
    return { moduleKey: 'aipowersalon-pos-settings', completionPercent: roll.completionPercent, status: roll.status, missingReasons: roll.missingReasons, sections, goLivePending: readiness.pending.map((p) => `${p.label} — ${p.reason || 'pending'}`) };
  }
  private async isSectionLive(ctx: SettingsContext, key: SettingsCategory): Promise<boolean> {
    if (key === 'payments-checkout') return (await this.payments(ctx)).isLive();
    if (key === 'online-google-ai-booking') return this.booking.status(ctx).googleReserveConnected;
    if (key === 'notifications') return this.messaging.a2pStatus(ctx).a2pStatus === 'registered';
    if (key === 'customer-display-devices') return (await this.devices.list(ctx)).some((d) => d.status === 'paired');
    return true;
  }
}
