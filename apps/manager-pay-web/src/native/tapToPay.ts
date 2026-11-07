import { Capacitor, registerPlugin } from '@capacitor/core';

// Bridge to the native Tap-to-Pay reader (the FiservTTP plugin, added in Xcode on a physical device — see
// NATIVE_TAP_TO_PAY_INTEGRATION.md §5).
//
// Fiserv master build §8C (P0, Nov 4 2026): this bridge NEVER produces a payment result by itself. The previous version
// (a) reported the reader as available on ANY native iOS runtime, even with no plugin registered, and (b) resolved a
// fabricated `approved` result with a `sbx_tap_*` reference when the plugin was missing. Both are removed:
//   • available  = native iOS AND the TapToPay plugin is registered (entitlement / PSP readiness is enforced server-side)
//   • no plugin  = capture() rejects with TAP_NOT_PROVISIONED — no capture call, no approval, the ticket stays unpaid.
// Only the native plugin (backed by the Fiserv TTP SDK) can return an outcome, and the server still verifies it with
// the provider before anything is marked paid.

export type NativeCaptureOutcome = 'approved' | 'declined' | 'timeout' | 'unknown';

export interface TapToPayResult {
  outcome: NativeCaptureOutcome;
  processorRef?: string;
  authCode?: string;
  brand?: string;
  last4?: string;
  capturedAmountCents?: number;
}

export interface TapToPayPlugin {
  capture(opts: { amountCents: number; idempotencyKey: string }): Promise<TapToPayResult>;
}

/** Thrown when there is no provisioned native reader. Callers show "Tap to Pay is not set up on this device". */
export class TapToPayNotProvisionedError extends Error {
  readonly code = 'TAP_NOT_PROVISIONED';
  constructor(message = 'Tap to Pay is not set up on this device.') { super(message); this.name = 'TapToPayNotProvisionedError'; }
}

const Native = registerPlugin<TapToPayPlugin>('TapToPay');

/** True only on a native iOS build that has the TapToPay plugin registered. */
export function isTapToPayAvailable(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios' && Capacitor.isPluginAvailable('TapToPay');
  } catch {
    return false;
  }
}

/** Run a native capture through the plugin. Rejects (never approves) when the reader is not provisioned. */
export async function captureTapToPay(opts: { amountCents: number; idempotencyKey: string }): Promise<TapToPayResult> {
  if (!isTapToPayAvailable()) throw new TapToPayNotProvisionedError();
  return Native.capture(opts);
}
