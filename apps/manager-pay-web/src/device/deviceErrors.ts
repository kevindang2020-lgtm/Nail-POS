// deviceErrors.ts — Secure Tap to Pay M6-4: the server's device refusals (ERROR_REGISTRY DEVICE_* / PAIRING_CODE_INVALID)
// in plain English for the person holding the phone, and what the app does about each:
//   DEVICE_REVOKED            → the phone's identity and key are wiped and the app locks to "This phone was removed"
//   DEVICE_PENDING_APPROVAL   → "waiting for the owner" banner (nothing to retry until the owner approves)
//   DEVICE_REQUEST_REPLAYED   → retried ONCE with a fresh nonce (the guard refused it before anything ran) — never more
//   everything else           → a clear sentence; no automatic retry (a payment is never blindly re-sent)
import { t } from '@aipowersalon/mobile-sdk';

export const DEVICE_ERROR_CODES = ['DEVICE_NOT_REGISTERED', 'DEVICE_PENDING_APPROVAL', 'DEVICE_SUSPENDED', 'DEVICE_BRANCH_NOT_AUTHORIZED', 'DEVICE_KEY_REQUIRED',
  'DEVICE_KEY_MISMATCH', 'DEVICE_REQUEST_REPLAYED', 'DEVICE_REVOKED', 'PAIRING_CODE_INVALID', 'DEVICE_NOT_AUTHORIZED', 'DEVICE_KEY_UNAVAILABLE'] as const;
export type DeviceErrorCode = typeof DEVICE_ERROR_CODES[number];
export type DeviceErrorAction = 'lock_removed' | 'await_owner' | 'retry_once' | 'show';

export function deviceErrorCode(e: unknown): DeviceErrorCode | null {
  const x = (e ?? {}) as { code?: unknown; details?: { code?: unknown; error?: unknown } };
  const c = x.code ?? x.details?.code ?? x.details?.error;
  return typeof c === 'string' && (DEVICE_ERROR_CODES as readonly string[]).includes(c) ? (c as DeviceErrorCode) : null;
}

const KEY: Record<DeviceErrorCode, string> = {
  DEVICE_NOT_REGISTERED: 'pay.device.notRegistered',
  DEVICE_NOT_AUTHORIZED: 'pay.device.notRegistered',
  DEVICE_PENDING_APPROVAL: 'pay.device.pending',
  DEVICE_SUSPENDED: 'pay.device.suspended',
  DEVICE_BRANCH_NOT_AUTHORIZED: 'pay.device.branchNotAuthorized',
  DEVICE_KEY_REQUIRED: 'pay.device.keyRequired',
  DEVICE_KEY_MISMATCH: 'pay.device.keyMismatch',
  DEVICE_REQUEST_REPLAYED: 'pay.device.replayed',
  DEVICE_REVOKED: 'pay.device.removed',
  PAIRING_CODE_INVALID: 'pay.device.pairingInvalid',
  DEVICE_KEY_UNAVAILABLE: 'pay.device.keyUnavailable',
};
export function deviceErrorMessage(code: DeviceErrorCode, keyUnavailable?: string | null): string {
  if (code === 'DEVICE_KEY_REQUIRED' && keyUnavailable) return `${t('pay.device.keyRequired')} ${keyUnavailable}`;
  return t(KEY[code]);
}
export function deviceErrorAction(code: DeviceErrorCode): DeviceErrorAction {
  if (code === 'DEVICE_REVOKED') return 'lock_removed';
  if (code === 'DEVICE_PENDING_APPROVAL') return 'await_owner';
  if (code === 'DEVICE_REQUEST_REPLAYED') return 'retry_once';
  return 'show';
}
