// display-device.ts — 23-inch dual-screen spec §8–§12, §85–§86, §97–§98: the customer display as a DEVICE, on the wire —
// pairing, heartbeat and the receipt step. The shared rules (codes, timing, the §85 state, masking) are in
// ../display-device-rules and re-exported here for the display app, which reads only the customer realm.
import type { DisplayProfile, DisplayReceiptChannel, DisplayReportedMode } from '../display-device-rules';
export * from '../display-device-rules';

// ── pairing (§8, §12): the display asks for a code and shows it; staff type it into the POS ──────────────────────────
/** What the display runs on — the device's type in the POS (the Android or iOS app, or a browser on a second monitor). */
export type DisplayPlatform = 'android' | 'ios' | 'web';
/** POST /customer-display/pairing body. */
export interface DisplayPairingRequest { platform?: DisplayPlatform }
/** POST /customer-display/pairing — public. The display shows `code`; it keeps `pollSecret` to itself. */
export interface DisplayPairingStart { pairingId: string; code: string; pollSecret: string; expiresAt: string }
/** POST /customer-display/pairing/:id/poll — the display asks (with its pollSecret) whether a salon claimed it. The
 *  device token is minted at that moment and handed over ONCE. */
export type DisplayPairingPoll =
  | { status: 'waiting'; expiresAt: string }
  | { status: 'paired'; deviceToken: string; deviceName: string; salonName: string; branchName: string | null }
  | { status: 'expired' };

// ── heartbeat (§85–§86) ─────────────────────────────────────────────────────────────────────────────────────────────
/** POST /customer-display/device/heartbeat — every 30 s and whenever the mode changes. */
export interface DisplayHeartbeat {
  mode: DisplayReportedMode;
  appVersion: string;
  screen: { width: number; height: number; pixelRatio: number };
  profile: DisplayProfile;
  /** G7: the advertising policy this display APPLIED (from the playlist it is playing) — its acknowledgment */
  adPolicy?: { version: number; mode: 'PLATFORM_ONLY' | 'TENANT_ONLY' } | null;
}
export interface DisplayHeartbeatAck { maintenance: boolean }

// ── the receipt step (§97–§98) ──────────────────────────────────────────────────────────────────────────────────────
/** One choice on the display. `destination` is MASKED ('(•••) •••-0142', 's•••@gmail.com') — never the full contact. */
export interface DisplayReceiptOption { channel: DisplayReceiptChannel; destination?: string }
export type CustomerDisplayReceipt =
  | { status: 'choose'; options: DisplayReceiptOption[]; /** applied when the customer walks away (§97 "configured automatic receipt behavior") */ automatic: DisplayReceiptChannel; decideWithinSeconds: number }
  /** sending: chosen and on its way · sent · skipped: no receipt · unavailable: that channel is not set up · failed: the send failed */
  | { status: 'sending' | 'sent' | 'skipped' | 'unavailable' | 'failed'; channel: DisplayReceiptChannel; destination?: string };
/** POST /customer-display/device/receipt — `auto` = the customer did not choose in time (the salon's default applies). */
export interface DisplayReceiptSubmission { choice: DisplayReceiptChannel | 'auto' }
