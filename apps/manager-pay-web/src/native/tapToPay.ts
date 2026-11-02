import { Capacitor, registerPlugin } from '@capacitor/core';

// Bridge to the native Tap-to-Pay reader (the FiservTTP plugin, added in Xcode on a physical device — see
// NATIVE_TAP_TO_PAY_INTEGRATION.md §5). On the web or any build without the native plugin registered, the reader is
// simply not available; the UI shows an honest "attaches on the on-device build" state and never invents a result.

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

const Native = registerPlugin<TapToPayPlugin>('TapToPay');

/** True only when running natively AND the native TapToPay plugin is registered (a real device build). */
export function isTapToPayAvailable(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('TapToPay');
  } catch {
    return false;
  }
}

/** Run a native capture. Only call when isTapToPayAvailable() is true. */
export function captureTapToPay(opts: { amountCents: number; idempotencyKey: string }): Promise<TapToPayResult> {
  return Native.capture(opts);
}
