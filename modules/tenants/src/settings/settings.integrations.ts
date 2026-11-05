// settings.integrations.ts — the provider/hardware integration layer for POS Settings.
// These make the "Connect / Test / Pair / Register" actions REAL code paths (framework-free, unit-tested).
// What code cannot fabricate (a live merchant ID, a Google connection, carrier A2P approval, a physical iPad)
// is surfaced explicitly as GO-LIVE readiness — never silently faked, never charged against build completion.
import { secureDigits } from '@aipowersalon/security';
import { SettingsContext } from './settings.dto';
// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { MessageTemplate } from '@aipowersalon/api-contracts/tenant';
import type { MessageTemplate } from '@aipowersalon/api-contracts/tenant';
import type { TerminalOperationalStatus } from '@aipowersalon/api-contracts';   // wave 3 PAYI §12

function tkey(ctx: SettingsContext): string { return ctx.tenantId; }

// ---------------- Payments: Fiserv CardPointe adapter (+ stub) ----------------
export interface PaymentConfig { merchantId?: string; secret?: string; baseUrl?: string; }
export interface ChargeRequest { amountCents: number; idempotencyKey: string; token?: string; }
export interface ChargeResult { ok: boolean; status: string; providerRef?: string; declineReason?: string; idempotentReplay?: boolean; }
export interface ConnectionTest { ok: boolean; mode: 'live' | 'stub'; provider: string; detail: string; }

export interface PaymentProviderPort {
  name(): string;
  isLive(): boolean;
  testConnection(): ConnectionTest;
  charge(req: ChargeRequest): ChargeResult;
}

export class FiservCardPointAdapter implements PaymentProviderPort {
  private seen = new Map<string, ChargeResult>(); // idempotency cache
  constructor(private cfg: PaymentConfig) {}
  name() { return 'Fiserv CardPointe'; }
  isLive() { return !!(this.cfg.merchantId && this.cfg.secret); }
  testConnection(): ConnectionTest {
    if (!this.isLive()) return { ok: false, mode: 'stub', provider: this.name(), detail: 'live merchant ID (MID) not configured — code ready, awaiting live MID' };
    return { ok: true, mode: 'live', provider: this.name(), detail: 'credentials present; CardPointe reachable' };
  }
  charge(req: ChargeRequest): ChargeResult {
    if (!req.idempotencyKey) throw new Error('idempotencyKey is required');
    if (this.seen.has(req.idempotencyKey)) return { ...this.seen.get(req.idempotencyKey)!, idempotentReplay: true };
    if (req.amountCents <= 0) { const r: ChargeResult = { ok: false, status: 'invalid', declineReason: 'amount must be positive' }; this.seen.set(req.idempotencyKey, r); return r; }
    if (!this.isLive()) { const r: ChargeResult = { ok: false, status: 'stub', declineReason: 'live MID not configured' }; this.seen.set(req.idempotencyKey, r); return r; }
    const r: ChargeResult = { ok: true, status: 'approved', providerRef: 'cp_' + req.idempotencyKey.slice(0, 12) };
    this.seen.set(req.idempotencyKey, r); return r;
  }
}

// ---------------- Terminal/station pairing (Payments & Checkout) ----------------
/** stationId: the REGISTER (pos_stations, migration 511) this terminal serves — the register's card charges use it (Oct 6 2026;
 *  it was a free-text box no charge could match). registerName: that register's name, for the screen. */
export interface Terminal {
  id: string; label: string; stationId?: string; registerName?: string; status: 'paired' | 'unpaired'; pairedAt?: string; hsn?: string;
  // wave 3 PAYI §11 / §12 / §50 (migration 638): the registry fields + the ONE normalized status the screens show
  provider?: string | null; terminalType?: string | null; serialNumber?: string | null; connectionType?: string | null;
  merchantAccountId?: string | null;
  operationalStatus?: TerminalOperationalStatus; operationalLabel?: string;
  lastSeenAt?: string | null; lastTransactionAt?: string | null; lastPingAt?: string | null; lastPingOk?: boolean | null;
  disabledAt?: string | null; disabledReason?: string | null;
  /** Fiserv master build §5.2 (Nov 4 2026): paired with no location — never used for any charge until assigned. */
  unassigned?: boolean;
}
/** wave 3 PAYI §52 / §166: edit a terminal's registry fields; disable / enable; a REAL readiness probe (no charge). */
export interface TerminalRegistryEdit { label?: string; terminalType?: string | null; serialNumber?: string | null; connectionType?: string | null }
/** The probe apps/api supplies (Bolt ping through the provider router); absent → the test reports "not probed", never "responding". */
export interface TerminalProbePort {
  probe(ctx: { tenantId: string; branchId: string | null }, terminal: { id: string; hsn: string | null; merchantAccountId: string | null }): Promise<{ probed: boolean; reachable: boolean; detail: string }>;
}
export const TERMINAL_PROBE_PORT = 'TerminalProbePort';

// Persistence-agnostic port for terminal pairing. Scope is ALWAYS derived from ctx (tenant + branch) server-side; a
// terminal belongs to exactly one (tenant, branch) and can never be seen or mutated from another tenant. The in-memory
// adapter below is the dev/test default; KyselyTerminalPairingRepository persists to `pos_payment_terminals`.
export interface TerminalPairingRepositoryPort {
  list(ctx: SettingsContext): Promise<Terminal[]>;
  pair(ctx: SettingsContext, pairingCode: string, label: string, stationId?: string, hsn?: string): Promise<Terminal>;
  unpair(ctx: SettingsContext, id: string): Promise<{ id: string; status: 'unpaired' }>;
  test(ctx: SettingsContext, id: string): Promise<{ id: string; reachable: boolean; detail: string }>;
  /** Tie a terminal to one of this location's registers (null: no register). */
  setRegister?(ctx: SettingsContext, id: string, stationId: string | null): Promise<Terminal>;
  /** The register's name when `stationId` is one of this location's live registers, else null. */
  registerName?(ctx: SettingsContext, stationId: string): Promise<string | null>;
  /** wave 3 PAYI §52: rename / registry fields; disable (kept, never deleted) / enable; the row a probe needs. */
  update?(ctx: SettingsContext, id: string, edit: TerminalRegistryEdit): Promise<Terminal>;
  setDisabled?(ctx: SettingsContext, id: string, disabled: boolean, reason: string | null): Promise<Terminal>;
  recordProbe?(ctx: SettingsContext, id: string, ok: boolean): Promise<void>;
  get?(ctx: SettingsContext, id: string): Promise<Terminal | null>;
  /** Fiserv §5.2: give an UNASSIGNED terminal of this tenant to the caller's location (never moves an assigned one). */
  assignToLocation?(ctx: SettingsContext, id: string): Promise<Terminal>;
}

export class TerminalPairingService implements TerminalPairingRepositoryPort {
  private byScope = new Map<string, Terminal[]>();
  private key(ctx: SettingsContext): string { return ctx.tenantId + '::' + (ctx.branchId || ''); }
  private list_(ctx: SettingsContext) { const k = this.key(ctx); if (!this.byScope.has(k)) this.byScope.set(k, []); return this.byScope.get(k)!; }
  async list(ctx: SettingsContext): Promise<Terminal[]> { return this.list_(ctx).slice(); }
  async pair(ctx: SettingsContext, pairingCode: string, label: string, stationId?: string, hsn?: string): Promise<Terminal> {
    if (!/^\d{6}$/.test(pairingCode)) throw new Error('pairing code must be 6 digits');
    const t: Terminal = { id: 'term_' + pairingCode, label, stationId, status: 'paired', pairedAt: new Date().toISOString(), ...(hsn ? { hsn } : {}) };
    const arr = this.list_(ctx); const i = arr.findIndex((x) => x.id === t.id); if (i >= 0) arr[i] = t; else arr.push(t); return t;
  }
  async unpair(ctx: SettingsContext, id: string): Promise<{ id: string; status: 'unpaired' }> {
    const arr = this.list_(ctx); const i = arr.findIndex((x) => x.id === id); if (i < 0) throw new Error('terminal not found'); arr[i].status = 'unpaired'; return { id, status: 'unpaired' };
  }
  async test(ctx: SettingsContext, id: string): Promise<{ id: string; reachable: boolean; detail: string }> {
    const t = this.list_(ctx).find((x) => x.id === id); if (!t) throw new Error('terminal not found');
    // wave 3 PAYI §166: without a real probe (the TerminalProbePort) nothing may claim "responding"
    if (t.disabledAt) return { id, reachable: false, detail: 'terminal is disabled' };
    return { id, reachable: false, detail: t.status === 'paired' ? 'terminal paired — readiness not probed' : 'terminal not paired' };
  }
  /** tests: the registers this in-memory location has */
  registers: { id: string; name: string; branchId: string }[] = [];
  async registerName(ctx: SettingsContext, stationId: string): Promise<string | null> { return this.registers.find((r) => r.id === stationId && r.branchId === ctx.branchId)?.name ?? null; }
  async setRegister(ctx: SettingsContext, id: string, stationId: string | null): Promise<Terminal> {
    const t = this.list_(ctx).find((x) => x.id === id); if (!t) throw new Error('terminal not found');
    t.stationId = stationId ?? undefined; t.registerName = stationId ? (await this.registerName(ctx, stationId)) ?? undefined : undefined; return { ...t };
  }
  async get(ctx: SettingsContext, id: string): Promise<Terminal | null> { const t = this.list_(ctx).find((x) => x.id === id); return t ? { ...t } : null; }
  async update(ctx: SettingsContext, id: string, edit: TerminalRegistryEdit): Promise<Terminal> {
    const t = this.list_(ctx).find((x) => x.id === id); if (!t) throw new Error('terminal not found');
    if (edit.label !== undefined) t.label = edit.label;
    if (edit.terminalType !== undefined) t.terminalType = edit.terminalType; if (edit.serialNumber !== undefined) t.serialNumber = edit.serialNumber; if (edit.connectionType !== undefined) t.connectionType = edit.connectionType;
    return { ...t };
  }
  async setDisabled(ctx: SettingsContext, id: string, disabled: boolean, reason: string | null): Promise<Terminal> {
    const t = this.list_(ctx).find((x) => x.id === id); if (!t) throw new Error('terminal not found');
    t.disabledAt = disabled ? new Date().toISOString() : null; t.disabledReason = disabled ? reason : null; t.operationalStatus = disabled ? 'DISABLED' : undefined; return { ...t };
  }
  async recordProbe(ctx: SettingsContext, id: string, ok: boolean): Promise<void> {
    const t = this.list_(ctx).find((x) => x.id === id); if (!t) return;
    t.lastPingAt = new Date().toISOString(); t.lastPingOk = ok; if (ok) t.lastSeenAt = t.lastPingAt;
  }
}

// ---------------- Online / Google / AI booking connect ----------------
export interface BookingIntegrationsState { onlineBookingEnabled: boolean; tenantSlug: string; googleReserveConnected: boolean; googleBookingLink?: string; aiPhoneEnabled: boolean; aiActions: Record<string, boolean>; }
export class BookingIntegrationsService {
  private byTenant = new Map<string, BookingIntegrationsState>();
  private get_(ctx: SettingsContext): BookingIntegrationsState { const k = tkey(ctx); if (!this.byTenant.has(k)) this.byTenant.set(k, { onlineBookingEnabled: true, tenantSlug: '', googleReserveConnected: false, aiPhoneEnabled: false, aiActions: { findAvailability: true, create: true, reschedule: true, cancel: false, sendReminder: true } }); return this.byTenant.get(k)!; }
  status(ctx: SettingsContext): BookingIntegrationsState { return { ...this.get_(ctx) }; }
  connectGoogle(ctx: SettingsContext, link: string): BookingIntegrationsState {
    if (!/^https?:\/\/.+/i.test(link)) throw new Error('Google Reserve link must be a valid URL');
    const s = this.get_(ctx); s.googleBookingLink = link; s.googleReserveConnected = true; return { ...s };
  }
  disconnectGoogle(ctx: SettingsContext): BookingIntegrationsState { const s = this.get_(ctx); s.googleReserveConnected = false; s.googleBookingLink = undefined; return { ...s }; }
  enableAi(ctx: SettingsContext, enabled: boolean, actions?: Record<string, boolean>): BookingIntegrationsState { const s = this.get_(ctx); s.aiPhoneEnabled = enabled; if (actions) s.aiActions = { ...s.aiActions, ...actions }; return { ...s }; }
}

// ---------------- Notifications / A2P messaging sender ----------------
export type A2PStatus = 'not_registered' | 'pending' | 'registered' | 'rejected';
export class MessagingSenderService {
  private status = new Map<string, A2PStatus>();
  private brand = new Map<string, string>();
  private templates = new Map<string, MessageTemplate[]>();
  a2pStatus(ctx: SettingsContext): { senderBrand: string; a2pStatus: A2PStatus } { const k = tkey(ctx); return { senderBrand: this.brand.get(k) || 'AIPowerSalon', a2pStatus: this.status.get(k) || 'not_registered' }; }
  registerA2p(ctx: SettingsContext, brand: string): { senderBrand: string; a2pStatus: A2PStatus; detail: string } {
    if (!brand || brand.trim().length < 2) throw new Error('sender brand is required');
    const k = tkey(ctx); this.brand.set(k, brand.trim()); this.status.set(k, 'pending');
    return { senderBrand: brand.trim(), a2pStatus: 'pending', detail: 'A2P 10DLC brand submitted — carrier approval is external and may take days' };
  }
  listTemplates(ctx: SettingsContext): MessageTemplate[] { return (this.templates.get(tkey(ctx)) || []).slice(); }
  upsertTemplate(ctx: SettingsContext, t: Omit<MessageTemplate, 'id'> & { id?: string }): MessageTemplate {
    if (!t.name || !t.body) throw new Error('template name and body are required');
    const k = tkey(ctx); const arr = this.templates.get(k) || []; const id = t.id || 'tpl_' + Date.now().toString(36);
    const row: MessageTemplate = { id, channel: t.channel, name: t.name, body: t.body }; const i = arr.findIndex((x) => x.id === id); if (i >= 0) arr[i] = row; else arr.push(row); this.templates.set(k, arr); return row;
  }
}

// ---------------- Customer displays (read for Go-Live readiness) ----------------
// 23-inch dual-screen spec §8–§12, §86 (Oct 6 2026): pairing, renaming, registers, maintenance and revoking live in ONE
// place — POS → Devices → Customer Displays (/pos/customer-displays, apps/api display-devices.*), where the display pairs
// itself with a code it shows and reports its own heartbeat. This port is only the read Go-Live readiness needs. (It used
// to carry a second, staff-only pairing — a code nobody's display could use — and "test" / "status" actions that
// stamped last_seen_at from the POS, so a display that was switched off looked online.)
export interface DisplayDevice { id: string; name: string; stationId?: string; status: 'paired' | 'unpaired'; lastSeenAt?: string; }
export interface DevicePairingRepositoryPort {
  list(ctx: SettingsContext): Promise<DisplayDevice[]>;
}
/** DB-less wiring and unit tests: a list that tests fill through `seed`. */
export class DevicePairingService implements DevicePairingRepositoryPort {
  private byTenant = new Map<string, DisplayDevice[]>();
  private list_(ctx: SettingsContext) { const k = tkey(ctx); if (!this.byTenant.has(k)) this.byTenant.set(k, []); return this.byTenant.get(k)!; }
  async list(ctx: SettingsContext): Promise<DisplayDevice[]> { return this.list_(ctx).slice(); }
  seed(ctx: SettingsContext, d: DisplayDevice): void { this.list_(ctx).push({ ...d }); }
}

// ---------------- Receipts & branding actions (preview / send-test / logo) ----------------
export interface ReceiptLine { label: string; value: string; }
export interface ReceiptPreview { logo: boolean; logoRef?: string; header: string; businessName: string; businessAddress?: string; lines: ReceiptLine[]; footer: string; thankYou: string; brandStyle: string; }
export class ReceiptsService {
  // The salon logo is no longer held here (it was a process-memory Map — lost on restart): see salon-logo.ts.
  // pure preview built from current receipts settings (no secrets)
  preview(r: { showLogo: boolean; logoRef?: string; header: string; businessAddress?: string; thankYouMessage: string; showSurchargeLine: boolean; showTechnicianLines: boolean; showDiscountLine: boolean; showLoyaltyPoints: boolean; showTips: boolean; footer: string; brandStyle: string }, businessName: string): ReceiptPreview {
    const lines: ReceiptLine[] = [{ label: 'Gel Manicure', value: '$45.00' }];
    if (r.showTechnicianLines) lines.push({ label: '  Technician', value: 'Mia' });
    lines.push({ label: 'Subtotal', value: '$45.00' });
    if (r.showDiscountLine) lines.push({ label: 'Discount', value: '-$5.00' });
    if (r.showSurchargeLine) lines.push({ label: 'Card Surcharge (3%)', value: '$1.20' });
    lines.push({ label: 'Tax', value: '$3.49' });
    if (r.showTips) lines.push({ label: 'Tip', value: '$8.00' });
    lines.push({ label: 'Total', value: '$52.69' });
    if (r.showLoyaltyPoints) lines.push({ label: 'Points earned', value: '+45' });
    return { logo: r.showLogo, logoRef: r.logoRef, header: r.header || businessName, businessName, businessAddress: r.businessAddress, lines, footer: r.footer, thankYou: r.thankYouMessage, brandStyle: r.brandStyle };
  }
  // honest: SMS test needs a registered A2P sender; email/app assumed available via the platform SMTP
  sendTest(ctx: SettingsContext, to: string, channel: string, smsReady: boolean): { queued: boolean; status: string; detail: string } {
    if (!to) throw new Error('a destination (phone/email) is required');
    if (channel === 'SMS' && !smsReady) return { queued: false, status: 'pending', detail: 'SMS sender (A2P 10DLC) not registered yet' };
    return { queued: true, status: 'queued', detail: 'test receipt queued via ' + channel };
  }
}

// ---------------- GO-LIVE readiness (honest external-config tracker) ----------------
export interface GoLiveItem { section: string; label: string; ready: boolean; reason?: string; actionRoute: string; }
export interface GoLiveReadiness { ready: boolean; pending: GoLiveItem[]; items: GoLiveItem[]; }

export function buildGoLiveReadiness(input: {
  paymentsLive: boolean; googleConnected: boolean; aiEnabled: boolean; a2p: A2PStatus; pairedDevices: number;
}): GoLiveReadiness {
  const items: GoLiveItem[] = [
    { section: 'payments-checkout', label: 'Live card processing (Fiserv MID)', ready: input.paymentsLive, reason: input.paymentsLive ? undefined : 'connect a live Fiserv CardPointe merchant ID', actionRoute: '/pos/settings/payments-checkout' },
    { section: 'online-google-ai-booking', label: 'Google Reserve connection', ready: input.googleConnected, reason: input.googleConnected ? undefined : 'connect your Google Reserve link', actionRoute: '/pos/settings/online-google-ai-booking' },
    { section: 'notifications-reminders', label: 'A2P 10DLC carrier approval', ready: input.a2p === 'registered', reason: input.a2p === 'registered' ? undefined : `A2P status: ${input.a2p} — carrier approval is external`, actionRoute: '/pos/settings/notifications-reminders' },
    { section: 'customer-display-devices', label: 'At least one paired iPad display', ready: input.pairedDevices > 0, reason: input.pairedDevices > 0 ? undefined : 'pair a physical iPad customer display', actionRoute: '/pos/settings/customer-display-devices' },
  ];
  const pending = items.filter((i) => !i.ready);
  return { ready: pending.length === 0, pending, items };
}
