// @aipowersalon/mobile-sdk — the ONE mobile auth/device layer for the four Capacitor apps (Constitution 13 §89).
// Public API only (§97); nothing else in this package is importable (§98–99).
export { configureMobileSdk, resetMobileSdkHttp, type SdkHttp } from './http';
export {
  setSecureStore, saveNativeToken, loadNativeToken, clearNativeToken, authHeader, tokenFromResponse, InMemorySecureStore,
  saveNativeRefreshToken, loadNativeRefreshToken, saveNativeSession, nativeTokenStore,
  devicePlatform, deviceName, deviceId, deviceIdentity, adoptDeviceId, type SecureStore,
} from './native-auth';
// Secure Tap to Pay M6-4: the payment phone's P-256 key (WebCrypto, non-extractable, IndexedDB) and the request signer
export {
  DEVICE_PROOF_VERSION, DEVICE_PROOF_HEADERS, DeviceKeyUnavailableError, canonicalDeviceRequest, signedPathFor, sha256Hex, newDeviceNonce,
  generateDeviceKeyPair, exportPublicKeySpki, signDeviceRequest, InMemoryDeviceKeyStore, indexedDbDeviceKeyStore, createDeviceIdentity,
  bytesToBase64, bytesToBase64Url, type StoredDeviceKey, type DeviceKeyStore, type SignInput,
} from './device-proof';
export * from './native-faceid';
export * from './faceid';
// webauthn.ts is the WEB passkey flow; faceid.ts wraps it per platform and is the public entry. Only the
// non-overlapping web helpers are exported from it.
export { isFaceIdAvailable as isWebAuthnAvailable, isFaceIdAvailable } from './webauthn';
export { initNative, type NativeCapabilities } from './native-bootstrap';
export { isNativePlatform, makeSecureStore, makeBiometrics, toBiometryKind, CapacitorSecureStore, CapacitorBiometrics } from './capacitor-adapters';
// BUILD_PLAN Phase 13 (agent A): the ONE mobile transport + NetworkState (+ native realtime stream tickets)
export * from './network';
// BUILD_PLAN Phase 13 (agent E): sanitized analytics + perf marks (Constitution 6 §116–119)
export * from './telemetry';
// BUILD_PLAN Phase 13 (agent C): the server-state layer (TanStack Query) + offline read cache + pending-mutation journal
export * from './query';
// BUILD_PLAN Phase 13 (agent B): remote config — AppConfigGate (UPDATE_REQUIRED screen, banners), useRemoteFlag, useModuleNotice
export * from './config';
// BUILD_PLAN Phase 13 (agent E): EN / VI i18n (Constitution 6 §97–98)
export * from './i18n';
// BUILD_PLAN Phase 13 (agent D): push client, route gate + app links, privacy screen + auto-lock (Constitution 6 §58–66, §130, §179, §245–246)
export * from './push';
export * from './links';
export * from './security';
// Receipt / Expense mandate §155–§157 (Oct 27 2026): offline receipt capture (encrypted on the device, synced on reconnect)
export * from './capture';
