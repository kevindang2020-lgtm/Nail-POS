import Foundation
import Capacitor
// import ProximityReader   // Apple's Tap to Pay on iPhone framework (iOS 16.4+; requires the acceptance entitlement)
// import FiservTTP         // Fiserv's Swift package wrapping ProximityReader + CommerceHub (add via Swift Package Manager)

/// Capacitor bridge for **Tap to Pay on iPhone**. Implements the `TapToPay` plugin the web app calls
/// (see `src/native/tapToPay.ts` → `registerPlugin('TapToPay')`, method `capture`).
///
/// HONESTY CONTRACT — this scaffold never fabricates a payment result. If the device is unsupported, the entitlement
/// is missing, or the backend cannot mint a CommerceHub session, it rejects with a specific error. The web app already
/// treats an unavailable reader as an honest "attaches on the on-device build" state (`isTapToPayAvailable()`).
///
/// REQUIREMENTS (see NATIVE_TAP_TO_PAY_INTEGRATION.md):
///   • iPhone XS or later, iOS 16.4+ (17+ recommended).
///   • Entitlement `com.apple.developer.proximity-reader.payment.acceptance` (requested from Apple; PSP = Fiserv).
///   • The `FiservTTP` Swift package + Fiserv CommerceHub merchant onboarding (the same onboarding the backend
///     records in `tenant_tap_to_pay_onboarding`; readiness must report Tap to Pay `ok` before the app calls this).
@objc(TapToPayPlugin)
public class TapToPayPlugin: CAPPlugin {

    /// `capture({ amountCents, idempotencyKey }) -> TapToPayResult` — matches the TS `TapToPayPlugin` contract.
    @objc func capture(_ call: CAPPluginCall) {
        guard let amountCents = call.getInt("amountCents"), amountCents > 0,
              let idempotencyKey = call.getString("idempotencyKey") else {
            call.reject("amountCents (> 0) and idempotencyKey are required", "TAP_BAD_INPUT")
            return
        }

        // 1) Device + OS support — ProximityReader is the source of truth (never claim support we can't verify).
        // guard PaymentCardReader.isSupported else {
        //     call.reject("This iPhone/iOS does not support Tap to Pay.", "TAP_UNSUPPORTED"); return
        // }

        Task { @MainActor in
            do {
                // 2) SEAM — obtain a CommerceHub session from OUR backend (a token is NEVER minted on device):
                //      POST /mobile-checkout/payment-attempts/{idempotencyKey}/device-session
                //      → { provider, sessionToken, expiresAt, environment }
                //    Wire the app's authenticated HTTP client (same session cookie / Keychain bearer the WKWebView
                //    uses) here. The endpoint is already implemented server-side (MobileCheckoutService.mintDeviceSession).
                //
                //   let session = try await Backend.mintDeviceSession(idempotencyKey: idempotencyKey, amountCents: amountCents)

                // 3) SEAM — run the contactless read via FiservTTP (which drives ProximityReader) with that session,
                //    then MAP the real processor result to the web contract. Do not invent fields.
                //
                //   let reader = try await FiservTTP(config: .init(sessionToken: session.sessionToken,
                //                                                   environment: session.environment))
                //   let result = try await reader.readCard(amount: Decimal(amountCents) / 100)
                //   call.resolve([
                //       "outcome": mapOutcome(result.status),   // "approved" | "declined" | "timeout" | "unknown"
                //       "processorRef": result.referenceId as Any,
                //       "authCode": result.authCode as Any,
                //       "brand": result.cardBrand as Any,
                //       "last4": result.last4 as Any,
                //       "capturedAmountCents": amountCents,
                //   ])
                //   return

                // Until the entitlement + FiservTTP + CommerceHub are provisioned, fail honestly — the web layer keeps
                // the ticket open and the checkout unpaid rather than showing a fabricated success.
                call.reject(
                    "Tap to Pay is not yet provisioned on this build (Apple entitlement + FiservTTP + CommerceHub onboarding required).",
                    "TAP_NOT_PROVISIONED"
                )
            } catch {
                // A read/authorize failure: surface the specific reason, never a generic success.
                call.reject(error.localizedDescription, "TAP_FAILED")
            }
        }
    }
}
