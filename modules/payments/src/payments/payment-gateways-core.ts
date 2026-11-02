// payment-gateways-core.ts — pure shaping/aggregation for the Super Admin → Payment Gateways command center.
// NO DB / Nest deps. The repository produces normalized `RawGatewayRow`s from the REAL tables (tenants,
// tenant_payment_config, branches, users, payment_settlements, pos_payment_terminals, payments) and the REAL
// payment_gateway_events; these functions derive the KPIs, status breakdown, top-processors, MID masking,
// setup-stage, server-side search/filter/pagination, and event/activity mapping. Unit-tested in
// payment-gateways-core.spec.ts. Security: this module never sees raw credentials — only the masked MID and
// boolean "configured" flags reach it, so it cannot leak a secret.

// GatewayStatus: ONE definition, the tenant contract's (Constitution 13 §15) — this module had its own copy.
export type { GatewayStatus } from '@aipowersalon/api-contracts/tenant';
import type { GatewayStatus } from '@aipowersalon/api-contracts/tenant';
export type SettlementStatus = 'settled' | 'failed' | 'pending' | 'needs_review' | 'not_applicable';
export type SetupStage =
  | 'not_started' | 'application_submitted' | 'gateway_connected' | 'terminal_linked' | 'complete';

export interface BranchRef { id: string; name: string; city: string | null; state: string | null; status: string | null }

// What the repo hands us per tenant (already joined; secrets already stripped to booleans).
export interface RawGatewayRow {
  tenantId: string;
  tenantName: string;
  salonCode: string | null;
  tenantStatus: string;
  ownerName: string | null;
  city: string | null;
  state: string | null;
  branchCount: number;                 // total branches for this tenant (table shows primary + "+N")
  branches: BranchRef[];               // full footprint (capped); the one tenant gateway serves all of them
  processor: string | null;            // tenant_payment_config.processor (null = no config row)
  merchantId: string | null;           // RAW MID from DB — masked here, never returned raw
  environment: string | null;
  status: string | null;               // tenant_payment_config.status (null = no config row at all)
  onboardingStatus: string | null;     // merchant-application / underwriting status (not_started..approved/declined)
  baseUrlPresent: boolean;
  credsPresent: boolean;               // any of api_username/password/webhook secret encrypted-present
  fiservConfigured: boolean;
  pairedTerminals: number;
  settlementStatusRaw: string | null;  // latest payment_settlements.status (null = no settlements)
  monthlyVolumeCents: number;          // sum settled gross this calendar month
  failedSettlements: number;           // count failed settlements this month for this tenant
  todayVolumeCents: number;            // sum approved payments since start of the (server-local) day — intraday processed
  todayTxnCount: number;               // approved payment count today
  chargebackAlerts: number;            // OPEN/unresolved chargebacks for this tenant (0 when none / not tracked)
  lastSyncAt: string | null;           // latest of config.updated_at / last settlement / last event
  lastPaymentAt: string | null;
}

// The masked, presentation-ready row the API returns (no raw secrets, no raw MID).
export interface GatewayView {
  tenantId: string;
  tenantName: string;
  salonCode: string | null;
  tenantStatus: string;
  ownerName: string | null;
  city: string | null;
  state: string | null;
  location: string | null;             // "City, ST" or null
  branchCount: number;
  branches: BranchRef[];
  processor: string | null;
  merchantIdMasked: string | null;
  environment: string | null;
  gatewayStatus: GatewayStatus;
  setupStage: SetupStage;
  paymentSetupLabel: string;           // human label for the "Payment Setup" column
  onboardingStatus: string;            // not_started | submitted | under_review | approved | declined
  onboardingLabel: string;             // human label for the underwriting step
  settlementStatus: SettlementStatus;
  monthlyVolumeCents: number;
  todayVolumeCents: number;
  todayTxnCount: number;
  chargebackAlerts: number;
  pairedTerminals: number;
  hasConfig: boolean;
  credentials: { apiConfigured: boolean; webhookConfigured: boolean };
  lastSyncAt: string | null;
  lastPaymentAt: string | null;
}

export interface GatewayFilters {
  search?: string;
  status?: string;            // active|pending|needs_setup|error|disabled|all
  processor?: string;         // fiserv|cardpointe|clover|none|all
  setupStage?: string;        // matches SetupStage|all
  settlementStatus?: string;  // settled|failed|pending|needs_review|not_applicable|all
  dateFrom?: string;
  dateTo?: string;
}

export interface Kpis {
  totalGateways: number;
  activeMerchantAccounts: number;
  pendingPaymentSetup: number;
  gatewayIssues: number;
  monthlyProcessedVolumeCents: number;
  failedSettlements: number;
  chargebackAlerts: number;            // honest 0 until a chargebacks source exists (documented blocker)
  chargebacksTracked: boolean;         // false → UI shows "not tracked yet" rather than a real 0
  connectedProcessors: number;
}

// ---------- masking ----------
export function maskMid(mid?: string | null): string | null {
  if (!mid) return null;
  const s = String(mid);
  return s.length <= 4 ? '••••' : '••••' + s.slice(-4);
}

// ---------- status / stage derivation ----------
export function mapGatewayStatus(status: string | null | undefined): GatewayStatus {
  const s = (status || '').toLowerCase();
  if (s === 'active' || s === 'pending' || s === 'error' || s === 'disabled' || s === 'paused') return s as GatewayStatus;
  return 'not_configured';
}

// Pure transition guard for the Super Admin pause / resume / disable actions. Pause holds an active/pending gateway
// ('paused'); disable turns any configured gateway off ('disabled'); resume brings a paused/disabled gateway back
// ('active' — the resolver still re-derives real usability from credentials). Returns the target status or an error.
export type GatewayAction = 'pause' | 'resume' | 'disable';
export function gatewayStatusTransition(current: string | null | undefined, action: GatewayAction): { ok: boolean; to?: GatewayStatus; error?: string } {
  const c = mapGatewayStatus(current);
  if (c === 'not_configured') return { ok: false, error: 'No gateway is configured for this tenant yet.' };
  if (action === 'pause') {
    if (c === 'paused') return { ok: false, error: 'Gateway is already paused.' };
    if (c === 'disabled') return { ok: false, error: 'Gateway is disabled; resume it before pausing.' };
    return { ok: true, to: 'paused' };
  }
  if (action === 'disable') {
    if (c === 'disabled') return { ok: false, error: 'Gateway is already disabled.' };
    return { ok: true, to: 'disabled' };
  }
  // resume
  if (c === 'active') return { ok: false, error: 'Gateway is already active.' };
  return { ok: true, to: 'active' };
}

export function deriveSetupStage(r: Pick<RawGatewayRow, 'status' | 'credsPresent' | 'pairedTerminals' | 'fiservConfigured'>): SetupStage {
  const hasConfig = r.status != null;
  if (!hasConfig) return 'not_started';
  if (r.status === 'active' && r.pairedTerminals > 0) return 'complete';
  if (r.status === 'active' || r.pairedTerminals > 0) return 'terminal_linked';
  if (r.credsPresent || r.fiservConfigured) return 'gateway_connected';
  return 'application_submitted';
}

const SETUP_LABEL: Record<SetupStage, string> = {
  not_started: 'Not Started',
  application_submitted: 'Application Submitted',
  gateway_connected: 'Gateway Connected',
  terminal_linked: 'In Progress',
  complete: 'Complete',
};
export const ONBOARDING_LABEL: Record<string, string> = {
  not_started: 'Not Started', submitted: 'Submitted', under_review: 'Under Review', approved: 'Approved', declined: 'Declined',
};

export function normalizeSettlement(raw: string | null | undefined): SettlementStatus {
  const s = (raw || '').toLowerCase();
  if (s === 'settled' || s === 'failed' || s === 'pending') return s as SettlementStatus;
  if (s === 'needs_review' || s === 'review') return 'needs_review';
  return raw == null ? 'not_applicable' : 'needs_review';
}

// ---------- row shaping ----------
export function toGatewayView(r: RawGatewayRow): GatewayView {
  const setupStage = deriveSetupStage(r);
  const location = r.city && r.state ? `${r.city}, ${r.state}` : (r.city || r.state || null);
  return {
    tenantId: r.tenantId,
    tenantName: r.tenantName,
    salonCode: r.salonCode,
    tenantStatus: r.tenantStatus,
    ownerName: r.ownerName,
    city: r.city,
    state: r.state,
    location,
    branchCount: r.branchCount || (r.branches ? r.branches.length : 0),
    branches: r.branches || [],
    processor: r.processor || null,
    merchantIdMasked: maskMid(r.merchantId),
    environment: r.environment || null,
    gatewayStatus: mapGatewayStatus(r.status),
    setupStage,
    paymentSetupLabel: SETUP_LABEL[setupStage],
    onboardingStatus: r.onboardingStatus || 'not_started',
    onboardingLabel: ONBOARDING_LABEL[r.onboardingStatus || 'not_started'] || 'Not Started',
    settlementStatus: normalizeSettlement(r.settlementStatusRaw),
    monthlyVolumeCents: Math.max(0, Math.round(r.monthlyVolumeCents || 0)),
    todayVolumeCents: Math.max(0, Math.round(r.todayVolumeCents || 0)),
    todayTxnCount: Math.max(0, Math.round(r.todayTxnCount || 0)),
    chargebackAlerts: Math.max(0, Math.round(r.chargebackAlerts || 0)),
    pairedTerminals: r.pairedTerminals || 0,
    hasConfig: r.status != null,
    credentials: { apiConfigured: !!r.credsPresent, webhookConfigured: !!r.credsPresent },
    lastSyncAt: r.lastSyncAt,
    lastPaymentAt: r.lastPaymentAt,
  };
}

// ---------- KPIs ----------
export function computeKpis(rows: RawGatewayRow[], opts?: { chargebacksTracked?: boolean }): Kpis {
  let active = 0, pending = 0, issues = 0, volume = 0, failed = 0, chargebacks = 0;
  const processors = new Set<string>();
  for (const r of rows) {
    const st = mapGatewayStatus(r.status);
    if (st === 'active') active++;
    if (st === 'pending' || st === 'not_configured') pending++;
    if (st === 'error') issues++;
    volume += r.monthlyVolumeCents || 0;
    failed += r.failedSettlements || 0;
    chargebacks += r.chargebackAlerts || 0;
    if (r.status != null && r.processor && r.processor !== 'none') processors.add(r.processor);
  }
  const totalGateways = rows.filter((r) => r.status != null).length;
  return {
    totalGateways,
    activeMerchantAccounts: active,
    pendingPaymentSetup: pending,
    gatewayIssues: issues,
    monthlyProcessedVolumeCents: Math.round(volume),
    failedSettlements: failed,
    chargebackAlerts: chargebacks,
    chargebacksTracked: !!opts?.chargebacksTracked,
    connectedProcessors: processors.size,
  };
}

// ---------- analytics: status breakdown ----------
export interface StatusSlice { key: GatewayStatus; label: string; count: number; pct: number }
const STATUS_LABEL: Record<GatewayStatus, string> = {
  active: 'Active', pending: 'Pending Setup', error: 'Gateway Issues', disabled: 'Disabled', paused: 'On Hold', not_configured: 'Needs Setup',
};
export function statusBreakdown(rows: RawGatewayRow[]): StatusSlice[] {
  const order: GatewayStatus[] = ['active', 'pending', 'not_configured', 'error', 'paused', 'disabled'];
  const counts = new Map<GatewayStatus, number>();
  for (const r of rows) counts.set(mapGatewayStatus(r.status), (counts.get(mapGatewayStatus(r.status)) || 0) + 1);
  const total = rows.length || 1;
  return order
    .map((key) => ({ key, label: STATUS_LABEL[key], count: counts.get(key) || 0, pct: Math.round(((counts.get(key) || 0) / total) * 1000) / 10 }))
    .filter((s) => s.count > 0);
}

// ---------- analytics: top processors ----------
export interface ProcessorRow { rank: number; processor: string; activeGateways: number; monthlyVolumeCents: number }
export function topProcessors(rows: RawGatewayRow[]): ProcessorRow[] {
  const agg = new Map<string, { active: number; volume: number }>();
  for (const r of rows) {
    if (r.status == null || !r.processor || r.processor === 'none') continue;
    const a = agg.get(r.processor) || { active: 0, volume: 0 };
    if (mapGatewayStatus(r.status) === 'active') a.active++;
    a.volume += r.monthlyVolumeCents || 0;
    agg.set(r.processor, a);
  }
  return [...agg.entries()]
    .map(([processor, a]) => ({ processor, activeGateways: a.active, monthlyVolumeCents: Math.round(a.volume) }))
    .sort((x, y) => y.monthlyVolumeCents - x.monthlyVolumeCents || y.activeGateways - x.activeGateways)
    .map((p, i) => ({ rank: i + 1, ...p }));
}

// ---------- events / activity ----------
export interface RawEventRow {
  id: string; tenantName: string | null; processorType: string | null; eventType: string | null;
  signatureValid: boolean; processedAt: string | null; createdAt: string;
}
export interface EventView { id: string; kind: 'success' | 'warning' | 'error' | 'info'; label: string; tenantName: string | null; at: string }

export function mapEvent(e: RawEventRow): EventView {
  const t = (e.eventType || '').toLowerCase();
  let kind: EventView['kind'] = 'info';
  let label = e.eventType || 'Gateway event';
  if (!e.signatureValid) { kind = 'error'; label = 'Webhook signature error'; }
  else if (t.includes('settle') && t.includes('fail')) { kind = 'error'; label = 'Settlement failed'; }
  else if (t.includes('settle')) { kind = 'success'; label = 'Settlement processed'; }
  else if (t.includes('chargeback') || t.includes('dispute')) { kind = 'warning'; label = 'Chargeback received'; }
  else if (t.includes('connect')) { kind = 'success'; label = 'Gateway connected'; }
  else if (t.includes('terminal') || t.includes('pair')) { kind = 'success'; label = 'Terminal linked'; }
  else if (t.includes('setup') && t.includes('complete')) { kind = 'success'; label = 'Payment setup completed'; }
  else if (t.includes('test') && t.includes('fail')) { kind = 'error'; label = 'Test connection failed'; }
  else if (t.includes('error') || (e.processedAt == null)) { kind = 'error'; label = e.eventType || 'Gateway error'; }
  return { id: e.id, kind, label, tenantName: e.tenantName, at: e.createdAt };
}

// ---------- server-side filter + paginate ----------
function inDateWindow(at: string | null, from?: string, to?: string): boolean {
  if (!from && !to) return true;
  if (!at) return false;
  const t = new Date(at).getTime();
  if (from && t < new Date(from).getTime()) return false;
  if (to && t > new Date(to + 'T23:59:59.999Z').getTime()) return false;
  return true;
}

export function filterGateways(views: GatewayView[], f: GatewayFilters): GatewayView[] {
  const q = (f.search || '').trim().toLowerCase();
  const wantStatus = (f.status || 'all').toLowerCase();
  const wantProc = (f.processor || 'all').toLowerCase();
  const wantStage = (f.setupStage || 'all').toLowerCase();
  const wantSettle = (f.settlementStatus || 'all').toLowerCase();
  return views.filter((v) => {
    if (q) {
      const hay = [v.tenantName, v.salonCode, v.ownerName, v.merchantIdMasked, v.processor, v.location]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (wantStatus !== 'all') {
      if (wantStatus === 'needs_setup') { if (v.gatewayStatus !== 'not_configured') return false; }
      else if (v.gatewayStatus !== wantStatus) return false;
    }
    if (wantProc !== 'all' && (v.processor || 'none').toLowerCase() !== wantProc) return false;
    if (wantStage !== 'all' && v.setupStage !== wantStage) return false;
    if (wantSettle !== 'all' && v.settlementStatus !== wantSettle) return false;
    if (!inDateWindow(v.lastSyncAt, f.dateFrom, f.dateTo)) return false;
    return true;
  });
}

export interface Page<T> { rows: T[]; total: number; page: number; limit: number; pages: number }
export function paginate<T>(rows: T[], page = 1, limit = 10): Page<T> {
  const lim = Math.min(100, Math.max(1, limit || 10));
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / lim));
  const p = Math.min(pages, Math.max(1, page || 1));
  return { rows: rows.slice((p - 1) * lim, (p - 1) * lim + lim), total, page: p, limit: lim, pages };
}

// CSV export of the filtered rows (no secrets; masked MID only).
export function toCsv(views: GatewayView[]): string {
  const head = ['Tenant', 'Salon Code', 'Owner', 'City', 'State', 'Processor', 'MID (masked)', 'Gateway Status', 'Payment Setup', 'Settlement Status', 'Monthly Volume (USD)', 'Last Sync'];
  const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = views.map((v) => [
    v.tenantName, v.salonCode, v.ownerName, v.city, v.state, v.processor, v.merchantIdMasked,
    v.gatewayStatus, v.paymentSetupLabel, v.settlementStatus, (v.monthlyVolumeCents / 100).toFixed(2), v.lastSyncAt,
  ].map(esc).join(','));
  return [head.join(','), ...lines].join('\n');
}

// ---- Configure Gateway: credential completeness (pure; the resolver supplies which fields are present) ----
// Verify Credentials (spec §5/§6) is distinct from Test Connection: it reports exactly which REQUIRED credential fields
// are still missing for the chosen processor, without ever touching the secret values themselves.
export type GatewayCredField = 'merchantId' | 'apiUsername' | 'apiPassword' | 'baseUrl';

export function requiredGatewayCredentials(processorType: string | null | undefined): GatewayCredField[] {
  const p = (processorType || '').toLowerCase();
  if (p === 'fiserv' || p === 'cardpointe') return ['merchantId', 'apiUsername', 'apiPassword', 'baseUrl'];
  if (p === 'clover') return ['apiPassword']; // single bearer secret (base URL defaults)
  return []; // 'none'/unconfigured needs nothing
}

export function missingGatewayCredentials(
  processorType: string | null | undefined,
  present: Partial<Record<GatewayCredField, boolean>>,
): GatewayCredField[] {
  return requiredGatewayCredentials(processorType).filter((f) => !present[f]);
}

// ---- Configure Gateway: webhook health (pure; the resolver supplies the recent events) ----
// Webhook health (spec §4.H) summarizes recent inbound processor webhooks: how many arrived, how many failed signature
// verification, and when the last one landed. Any signature failure flips health to 'failing' (a tampered/misconfigured
// secret is the thing an operator must notice).
export interface WebhookEventSummary { signatureValid: boolean; receivedAt: string | null }
export function webhookHealth(events: WebhookEventSummary[]): { received: number; signatureFailures: number; lastReceivedAt: string | null; status: 'healthy' | 'failing' | 'none' } {
  if (!events.length) return { received: 0, signatureFailures: 0, lastReceivedAt: null, status: 'none' };
  const signatureFailures = events.filter((e) => !e.signatureValid).length;
  const lastReceivedAt = events.reduce<string | null>((acc, e) => (e.receivedAt && (!acc || e.receivedAt > acc) ? e.receivedAt : acc), null);
  return { received: events.length, signatureFailures, lastReceivedAt, status: signatureFailures > 0 ? 'failing' : 'healthy' };
}
