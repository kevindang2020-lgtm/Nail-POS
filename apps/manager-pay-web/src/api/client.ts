// client.ts — the Tap-to-Pay (Manager Pay) app's API client: a thin wrapper over the ONE mobile transport (@aipowersalon/mobile-sdk
// createTransport — BUILD_PLAN Phase 13, Constitution 6 §11–16). The transport owns the base (read per call), /api/v1, the
// credential (Keychain bearer on native — uploads included — and the httpOnly cookie on the web), the client headers,
// timeouts, GET-only retry, Idempotency-Key and error normalisation. This file keeps the names every screen imports.
//
// Secure Tap to Pay M6-4: every /mobile-checkout request is signed with this phone's P-256 key (device/deviceKeys.ts —
// fresh nonce per attempt), and the server's device refusals are handled here once for every screen:
//   DEVICE_REVOKED → this phone's identity + key are wiped and the app locks to "This phone was removed from the salon";
//   DEVICE_PENDING_APPROVAL / DEVICE_SUSPENDED → the standing banner; DEVICE_REQUEST_REPLAYED → ONE retry with a fresh
//   nonce (the guard refused it before anything ran — this is the only automatic retry; a payment is never re-sent blindly);
//   every DEVICE_* message is replaced by plain English (device/deviceErrors.ts).
import { buildApiUrl } from '@aipowersalon/api-client';
import { createTransport, recordApiLatency, type RequestOptions, clearNativeToken } from '@aipowersalon/mobile-sdk';
import { signingHeaders, wipeDeviceIdentity, keyUnavailableReason } from '../device/deviceKeys';
import { deviceErrorCode, deviceErrorMessage, deviceErrorAction } from '../device/deviceErrors';
import { setDeviceStanding } from '../device/deviceState';

/**
 * The resolved API base: build-time VITE_API_BASE, then runtime window.APS_API_BASE, otherwise "" (same-origin on the
 * web). A native build must be given an absolute https VITE_API_BASE (mobile-sdk initNative refuses anything else).
 * Read on every call, so a runtime override is honoured.
 */
export function apiBase(): string {
  return ((import.meta as any).env?.VITE_API_BASE as string)
    || (typeof window !== "undefined" && (window as any).APS_API_BASE)
    || "";
}

export const transport = createTransport({
  app: 'manager-pay',
  apiBase,
  appVersion: () => (import.meta as any).env?.VITE_APP_VERSION as string | undefined,
  onTiming: recordApiLatency,   // C6 §119: API latency by timeout class + outcome (no URL) → client telemetry
  // NATIVE: the session is gone (expired, or revoked server-side). The stored bearer token is dead — leaving it in the
  // Keychain means it is resent on every request forever. Wipe it. (This app holds its principal in a screen rather than
  // an AuthContext, so the clear happens here, at the source of the 401.)
  onUnauthorized: () => { void clearNativeToken(); },
  requestHeaders: signingHeaders,   // Secure Tap to Pay M6-4: the device proof, per attempt
});

/** The API base + /api/v1 + path, resolved per call. (/auth/refresh and /media stay where they are.) */
export function apiUrl(path: string, query?: Record<string, unknown>): string { return buildApiUrl(apiBase(), path, query); }   // = transport.apiUrl

/** Apply what a device refusal means for this phone, and give the error a plain-English message. Returns the error. */
export async function handleDeviceError(e: unknown): Promise<unknown> {
  const code = deviceErrorCode(e);
  if (!code) return e;
  const action = deviceErrorAction(code);
  if (action === 'lock_removed') { await wipeDeviceIdentity(); setDeviceStanding('removed'); }
  else if (action === 'await_owner') setDeviceStanding('pending');
  else if (code === 'DEVICE_SUSPENDED') setDeviceStanding('suspended');
  try { Object.assign(e as object, { message: deviceErrorMessage(code, keyUnavailableReason()), deviceCode: code }); } catch { /* frozen error: keep its own message */ }
  return e;
}

/** Run one API call with the device rules above (one replay retry, then the mapping). */
export async function withDeviceRules<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (deviceErrorCode(e) === 'DEVICE_REQUEST_REPLAYED') {
      try { return await fn(); }   // ONCE, re-signed with a fresh nonce by the transport
      catch (e2) { throw await handleDeviceError(e2); }
    }
    throw await handleDeviceError(e);
  }
}

type Opts = Omit<RequestOptions, 'body' | 'query'>;
export const api = {
  get: <T>(p: string, query?: Record<string, unknown>, opts?: Opts) => withDeviceRules(() => transport.get<T>(p, { ...opts, query })),
  post: <T>(p: string, body?: Record<string, unknown>, opts?: Opts) => withDeviceRules(() => transport.post<T>(p, body, opts)),
  patch: <T>(p: string, body?: Record<string, unknown>, opts?: Opts) => withDeviceRules(() => transport.patch<T>(p, body, opts)),
  del: <T>(p: string, opts?: Opts) => withDeviceRules(() => transport.del<T>(p, opts)),
};
