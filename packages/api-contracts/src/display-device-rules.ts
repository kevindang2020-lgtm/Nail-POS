// display-device-rules.ts — 23-inch dual-screen spec §8–§12, §85–§88, §97: the rules about a customer display as a
// DEVICE that the server, the POS and the display itself must agree on — pairing codes, heartbeat timing, the §85 device
// state, the §87 profile, and how a receipt destination is masked. Realm-neutral (like display-ads-rules): the customer
// realm (the display) and the tenant realm (the POS) both read it.

/** 8 digits: typed on a POS keypad; at most a few hundred codes are open at once, so a guess is ~1 in 100,000+. */
export const DISPLAY_PAIRING_CODE_DIGITS = 8;
export const DISPLAY_PAIRING_TTL_SECONDS = 600;
/** '48291374' → '4829 1374' (how the display shows it and the POS echoes it). */
export function formatPairingCode(code: string): string {
  const d = String(code ?? '').replace(/\D/g, '');
  return d.length === DISPLAY_PAIRING_CODE_DIGITS ? `${d.slice(0, 4)} ${d.slice(4)}` : d;
}
/** Whatever staff typed ('4829-1374', ' 4829 1374 ') → the 8 digits, or null. */
export function normalizePairingCode(input: unknown): string | null {
  const d = String(input ?? '').replace(/[\s-]/g, '');
  return new RegExp(`^\\d{${DISPLAY_PAIRING_CODE_DIGITS}}$`).test(d) ? d : null;
}

/** What the display is doing right now, as it reports it. */
export type DisplayReportedMode = 'check_in' | 'checkout' | 'advertisement' | 'idle';
export const DISPLAY_REPORTED_MODES: readonly DisplayReportedMode[] = ['check_in', 'checkout', 'advertisement', 'idle'];
/** §87: the display profile, worked out from the screen it runs on. */
export type DisplayProfile = 'CUSTOMER_DISPLAY_23_LANDSCAPE' | 'LANDSCAPE' | 'PORTRAIT_TABLET';
export const DISPLAY_PROFILES: readonly DisplayProfile[] = ['CUSTOMER_DISPLAY_23_LANDSCAPE', 'LANDSCAPE', 'PORTRAIT_TABLET'];
export const DISPLAY_HEARTBEAT_MS = 30_000;
/** A display that has not been heard from for this long is OFFLINE (two missed heartbeats and a margin). */
export const DISPLAY_ONLINE_WINDOW_MS = 75_000;

/** §87–§88: from the viewport, never from inches — a landscape screen of at least 1366×768 runs the 23-inch layout. */
export function displayProfileFor(width: number, height: number): DisplayProfile {
  if (!(width > 0 && height > 0)) return 'LANDSCAPE';
  if (width / height < 1.25) return 'PORTRAIT_TABLET';
  return width >= 1366 && height >= 768 ? 'CUSTOMER_DISPLAY_23_LANDSCAPE' : 'LANDSCAPE';
}

export type DisplayDeviceState = 'ONLINE' | 'OFFLINE' | 'CHECK_IN' | 'CHECKOUT' | 'ADVERTISEMENT' | 'MAINTENANCE' | 'REVOKED';
export interface DisplayDeviceFacts {
  revoked: boolean;
  maintenance: boolean;
  /** Last heartbeat or device request, epoch ms (null: never heard from). */
  lastSeenMs: number | null;
  reportedMode: DisplayReportedMode | null;
  /** A checkout is attached to the display on the server (it outranks what the display last reported). */
  hasActiveSession: boolean;
}
/**
 * §85, one rule for every screen: REVOKED, then MAINTENANCE (the owner's switch), then OFFLINE (not heard from), then
 * what it is doing — a checkout attached on the server is CHECKOUT whatever the display last said; otherwise its own
 * report (CHECK_IN / ADVERTISEMENT), else ONLINE.
 */
export function displayDeviceState(d: DisplayDeviceFacts, nowMs: number): DisplayDeviceState {
  if (d.revoked) return 'REVOKED';
  if (d.maintenance) return 'MAINTENANCE';
  if (d.lastSeenMs == null || nowMs - d.lastSeenMs > DISPLAY_ONLINE_WINDOW_MS) return 'OFFLINE';
  if (d.hasActiveSession || d.reportedMode === 'checkout') return 'CHECKOUT';
  if (d.reportedMode === 'check_in') return 'CHECK_IN';
  if (d.reportedMode === 'advertisement') return 'ADVERTISEMENT';
  return 'ONLINE';
}

export type DisplayReceiptChannel = 'sms' | 'email' | 'none';
export const DISPLAY_RECEIPT_DECIDE_SECONDS = 45;
/** '+1 (215) 555-0142' / '2155550142' → '(•••) •••-0142'; anything unusable → null. */
export function maskPhone(phone: unknown): string | null {
  const d = String(phone ?? '').replace(/\D/g, '');
  return d.length >= 7 ? `(•••) •••-${d.slice(-4)}` : null;
}
/** 'sophia.lee@gmail.com' → 's•••@gmail.com'; anything that is not an address → null. */
export function maskEmail(email: unknown): string | null {
  const m = /^([^\s@]+)@([^\s@]+\.[^\s@]+)$/.exec(String(email ?? '').trim());
  return m ? `${m[1][0]}•••@${m[2].toLowerCase()}` : null;
}
