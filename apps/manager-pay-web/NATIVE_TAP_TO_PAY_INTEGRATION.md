# Native Tap to Pay on iPhone — iOS Integration

This documents the iOS scaffold that turns `apps/manager-pay-web` (a Capacitor app) into a real Tap-to-Pay-on-iPhone
terminal. The scaffold is **structured and honest**: it compiles into a Capacitor plugin, but it deliberately rejects
with `TAP_NOT_PROVISIONED` until the external prerequisites are in place — it never fabricates a charge.

## What exists

- `src/native/tapToPay.ts` — the web-side plugin contract (`TapToPay.capture({ amountCents, idempotencyKey })`) and
  `isTapToPayAvailable()`. On any build without the native plugin, the app shows an honest unavailable state.
- `ios-native/TapToPayPlugin.swift` — the Capacitor plugin implementing `capture`. Contains two clearly-marked SEAMS:
  (2) fetch a CommerceHub session from our backend, (3) run the read via FiservTTP and map the result.
- `ios-native/TapToPayPlugin.m` — registers the plugin with Capacitor as `TapToPay`.
- Backend: `POST /mobile-checkout/payment-attempts/:idempotencyKey/device-session` already mints the session via
  `TapToPaySessionPort` (honest 503/501 until the CommerceHub adapter is wired). Readiness
  (`GET /mobile-checkout/readiness`) already reports Tap to Pay `ok` only when the tenant is onboarded, credentials
  exist, and the device is approved.

## Prerequisites (external — not code)

1. **Apple Tap-to-Pay entitlement** `com.apple.developer.proximity-reader.payment.acceptance`, requested from Apple
   with PSP = **Fiserv**. Without it the ProximityReader framework will not run.
2. **Fiserv CommerceHub** merchant onboarding + credentials, and the **FiservTTP** Swift package. Record the onboarding
   in the backend (`POST /super-admin/tap-to-pay/tenants/:tenantId/onboarding`) so readiness flips on.
3. **Device**: iPhone XS or later, iOS 16.4+ (17+ recommended).
4. **Xcode / macOS** to generate the iOS project and build to a registered physical device (Tap to Pay does not run
   in the Simulator).

## Setup steps

1. Generate the iOS project: `npx cap add ios` (from `apps/manager-pay-web`).
2. Add the `ios-native/TapToPayPlugin.swift` + `.m` to the generated `App` target (or package them as a local
   Capacitor plugin).
3. Add the entitlement to the App target and the `FiservTTP` package via Swift Package Manager.
4. Fill **SEAM 2** (backend session fetch) using the app's authenticated HTTP client and the `device-session` route.
5. Fill **SEAM 3** (FiservTTP read + result mapping) against the real FiservTTP API and CommerceHub sandbox.
6. Wire the backend CommerceHub adapter seams in `apps/api/src/mobile-checkout/fiserv-commercehub-ttp.adapter.ts`
   (`mintDeviceSession` / `finalizeTransaction`) against the same verified contract.

## Verifying without a device

The **certification harness** (`apps/api/src/mobile-checkout/ttp-certification.vitest.spec.ts`) exercises the full
server flow — readiness → mint session → capture result → reconcile — against a mock CommerceHub test double, proving
the orchestration is correct so the real adapter drops in without orchestration changes.

## Honest limitations

- The scaffold **cannot be compiled or run in this environment** (no Xcode/macOS/device) and rejects with
  `TAP_NOT_PROVISIONED` until seams 2–3 and the backend adapter are wired against the real CommerceHub contract.
- No fabricated success is ever returned at any layer — web, native, or backend.
