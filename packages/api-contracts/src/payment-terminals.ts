// terminal-status-core.ts — Payments mandate §12 / §50 (wave 3): the ONE normalized payment-terminal status, derived from
// the registry row (migration 638) + the live lease (migration 485). Pure: no I/O, a fixed clock. The frontend never
// interprets raw Clover / Bolt states; the processor's own words stay in the server log.
//
//   DISABLED    the salon disabled it (disabled_at) — never charged, never offered to a register
//   OFFLINE     unpaired, or the last ping failed and nothing has answered since
//   PROCESSING  a charge holds the terminal's lease right now (a second register would get TERMINAL_BUSY)
//   BUSY        reserved for a lease held by something other than a charge (display message, test) — same effect
//   ONLINE      answered (ping or transaction) within the freshness window
//   DEGRADED    answered once, but not within the window — may be asleep, unplugged or on a flaky network
//   UNKNOWN     paired but never heard from (no ping, no transaction) — "Test connection" resolves it
export type TerminalOperationalStatus = 'ONLINE' | 'OFFLINE' | 'BUSY' | 'PROCESSING' | 'DEGRADED' | 'DISABLED' | 'UNKNOWN';

export interface TerminalStatusInput {
  paired: boolean;
  disabledAt?: Date | string | null;
  lastSeenAt?: Date | string | null;
  lastPingAt?: Date | string | null;
  lastPingOk?: boolean | null;
  /** The live lease holder, when one holds the terminal right now (not expired, not released). */
  leaseHolder?: string | null;
}

/** A terminal that answered within this window counts as ONLINE; older → DEGRADED. */
export const TERMINAL_FRESH_MS = 15 * 60_000;

const ms = (v: Date | string | null | undefined): number | null => { if (!v) return null; const t = v instanceof Date ? v.getTime() : Date.parse(String(v)); return Number.isFinite(t) ? t : null; };

export function terminalOperationalStatus(t: TerminalStatusInput, now: Date = new Date()): TerminalOperationalStatus {
  if (t.disabledAt) return 'DISABLED';
  if (!t.paired) return 'OFFLINE';
  if (t.leaseHolder) return /^(ticket:|display:|mobile:|charge:)/.test(t.leaseHolder) ? 'PROCESSING' : 'BUSY';
  const seen = ms(t.lastSeenAt); const ping = ms(t.lastPingAt);
  if (t.lastPingOk === false && ping !== null && (seen === null || ping >= seen)) return 'OFFLINE';   // the last word was a failed ping
  if (seen === null) return 'UNKNOWN';
  return now.getTime() - seen <= TERMINAL_FRESH_MS ? 'ONLINE' : 'DEGRADED';
}

/** §135: the sentence a register shows for a status (never the provider's words). */
export const TERMINAL_STATUS_LABEL: Record<TerminalOperationalStatus, string> = {
  ONLINE: 'Online', OFFLINE: 'Offline — check power and network', BUSY: 'In use', PROCESSING: 'Taking a payment',
  DEGRADED: 'Not heard from recently', DISABLED: 'Disabled by the salon', UNKNOWN: 'Not tested yet',
};

// ---- wire types for the terminal registry + branch merchant routes (wave 3 PAYI §10–§12, §52, §165; Constitution 5 #30) ----

/** One payment terminal as POS Devices → Payment Terminals shows it (GET/POST /pos/settings/payments-checkout/terminals…). */
export interface PaymentTerminalView {
  id: string; label: string; stationId?: string; registerName?: string; status: 'paired' | 'unpaired'; pairedAt?: string; hsn?: string;
  provider?: string | null; terminalType?: string | null; serialNumber?: string | null; connectionType?: string | null;
  merchantAccountId?: string | null;
  operationalStatus?: TerminalOperationalStatus; operationalLabel?: string;
  lastSeenAt?: string | null; lastTransactionAt?: string | null; lastPingAt?: string | null; lastPingOk?: boolean | null;
  disabledAt?: string | null; disabledReason?: string | null;
}
/** POST …/terminals/:id/rename — the registry fields a salon may edit. */
export interface PaymentTerminalEditRequest { label?: string; terminalType?: string | null; serialNumber?: string | null; connectionType?: string | null }
/** POST …/terminals/:id/disable — why (kept on the row, audited). */
export interface PaymentTerminalDisableRequest { reason?: string | null }

/** A location's own merchant account as Super Admin sees it — masked, never a credential (§10, §53, §162). */
export interface BranchMerchantAccountView {
  id: string; tenantId: string; branchId: string; branchName: string | null; processorType: string; environment: 'sandbox' | 'production';
  displayName: string | null; merchantIdMasked: string; currency: string; status: string; credentialsConfigured: boolean;
  terminalConfigured: boolean; terminalBaseUrl: string | null; webhookSecretConfigured: boolean; configVersion: number;
  lastValidatedAt: string | null; lastValidationError: string | null; updatedAt: string | null;
}
/** POST /super-admin/tenants/:id/payment-gateway/branches/:branchId/status */
export interface BranchMerchantStatusRequest { action: 'pause' | 'resume' | 'disable' }
/** A harmless connectivity check (never a charge) — §165. */
export interface MerchantConnectionTestResult { ok: boolean; configured: boolean; status: string; tested: boolean; note: string; scope: 'tenant' | 'branch' }
