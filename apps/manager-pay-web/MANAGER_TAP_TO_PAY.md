# Manager Tap to Pay on iPhone — Architecture & Handoff

This documents the Manager Tap to Pay feature as it actually exists in the codebase (audited, not aspirational),
plus the login added in this pass. Every route, module, and state below is real and referenced by path.

## 1. What this is

`apps/manager-pay-web` is the iPhone (Capacitor) app an authorized salon user (owner/manager/authorized cashier or
receptionist with payment permission) uses to take contactless payment on a ticket that is Ready for Checkout. It is
**not** a separate checkout or payment system — it drives the canonical POS checkout + payment domain over the
backend `mobile-checkout` module. The app never creates disconnected checkout records and never assigns its own role.

## 2. Architecture

```
manager-pay-web (iPhone)
  → api/mobileCheckoutApi.ts  (session cookie / Keychain token; server derives tenant+branch+device)
    → apps/api/src/mobile-checkout/  (controller → service → readiness/proceed/capture-bridge)
      → canonical checkout + tickets (source of truth)
      → apps/api/src/payments/  PaymentProcessor port → processor.factory → CardPointe / Bolt / Clover clients
      → payment-webhook.service (signature-verified) + payment-reconciliation.service
      → audit + real-time events
```

- **Frontend screens (existing):** `CheckoutQueueScreen` (Ready for Checkout), `TicketScreen` (authoritative
  totals), `TapToPayScreen` (contactless capture), `SuccessScreen`, `HistoryScreen`, `ReportsScreen`,
  `AccountScreen`. Native capture in `native/tapToPay.ts`; stable per-install `DEVICE_ID` + `SESSION_ID` in
  `util/session.ts`.
- **Login (added this pass):** `screens/LoginScreen.tsx` + auth gate in `App.tsx`. See §3.

## 3. Login (this pass)

- Matches the reference design (marble/gold, logo, `TAP TO PAY ON IPHONE`, Welcome Back, contactless illustration,
  Email/Mobile + Password with show/hide, Remember Me, Forgot Password, gold Sign In, **Use Face ID**, the
  **Tap to Pay Experience** panel, and the secure footer), with iPhone safe-area + Dynamic Island spacing.
- Drives the **real** `POST /auth/login` on the **tenant portal**. The backend enforces role + payment permission +
  branch + device; the app assigns nothing. Tenant is resolved from a salon code, which is **remembered per device**
  after the first sign-in (so a provisioned device shows exactly the design — email/mobile + password only).
- **Face ID** is the same implementation the tech/owner apps use (`auth/faceid.ts` + `auth/native-faceid.ts` +
  `api/webauthn.ts`) talking to the same backend verifier — no second biometric system. A biometric success is
  revalidated against the backend (`/auth/me`); it never mints a session on the client.
- **Forgot Password** reuses the real reset endpoint (`/auth/password-reset/request`).
- The Tap to Pay panel describes the experience; it does **not** claim this device is ready. Real readiness is
  verified server-side after sign-in (see §5) — the app already gates payment on it.

## 4. Backend routes (real — `apps/api/src/mobile-checkout/mobile-checkout.controller.ts`)

```
GET  /mobile-checkout/readiness
GET  /mobile-checkout/queue
GET  /mobile-checkout/tickets/:ticketId
POST /mobile-checkout/tickets/:ticketId/lock            GET .../lock   POST .../lock/refresh   POST .../lock/release
POST /mobile-checkout/tickets/:ticketId/proceed-to-payment
POST /mobile-checkout/tickets/:ticketId/payment-attempts
POST /mobile-checkout/payment-attempts/:idempotencyKey/readiness
POST /mobile-checkout/payment-attempts/:idempotencyKey/capture-result
POST /mobile-checkout/payment-attempts/:idempotencyKey/reconcile
POST /mobile-checkout/payment-attempts/:idempotencyKey/cancel
GET  /mobile-checkout/tickets/:ticketId/payment-attempts   GET /mobile-checkout/payment-attempts
GET  /mobile-checkout/reports
POST /mobile-checkout/tickets/:ticketId/receipt
```

- **Ticket locking** prevents two devices charging one ticket: backend creates a short-lived lock, heartbeated by
  the owning session, released on success/failure/cancel/timeout.
- **Payment-attempt flow** is idempotency-keyed. The local SDK result is sent to the backend, which verifies with
  the processor before committing — completion never comes from a local callback alone. Uncertain results go to
  `reconcile` (Pending Verification), not a blind retry.

## 5. Processor & honest readiness

- The wired gateway is **CardPointe (Fiserv/CardConnect)**, built from env in `payments/processor.factory.ts`.
  The abstraction is `payments/payment-processor.port.ts` — `PaymentProcessor { authorizeAndCapture, refund,
  voidTransaction }`, keyed by the processor **retref**, amounts in **integer cents**. Clover and CardPointe/Bolt
  clients exist behind the same port. **No Stripe/Square.**
- `mobile-checkout/mobile-checkout-readiness.ts` is a pure, unit-tested function returning an honest overall status:
  `ready | backend_unavailable | update_required | processor_unavailable | device_unsupported |
  tap_to_pay_setup_required | not_ready`, with per-check detail. **Tap to Pay on iPhone reports
  `tap_to_pay_setup_required`** until onboarded — its detail is literally *"Tap to Pay on iPhone is not onboarded
  (Apple entitlement + CommerceHub)."* The app never fakes readiness or a successful payment.

## 6. Security controls (existing, verified)

- Money is integer cents throughout; totals are authoritative from the backend.
- Tenant/branch/user/device/merchant context is server-derived; the shared client refuses to send tenant/branch ids.
- Webhooks are signature-verified (`payments/payment-webhook.service.ts`,
  `payment-webhook-processor-signature.vitest.spec.ts`); idempotency + reconciliation guard duplicate charges.
- No PAN/CVV stored; merchant secrets never returned to the app; native token in the Keychain, not plain storage.

## 7. Verification (this pass)

- manager-pay-web: `tsc --noEmit` 0 errors; full suite **41 tests pass** (incl. the new login: layout, submit gate,
  tenant-portal wiring with salon code + rememberMe, remembered-salon hides the field, MFA step, error surfacing).
- Backend untouched this pass. Static audits all green (`dead-client`: the new auth calls resolve to real routes;
  `nav`: every nav item reaches a real screen). `check:sql` and the broader API/test suites stand green from prior
  passes.

## 8. Honest remaining (environment-bound)

- **Live Tap to Pay on iPhone** requires the Apple Tap to Pay entitlement + Fiserv **CommerceHub** merchant
  onboarding + a registered, supported device. Until then readiness honestly reports `tap_to_pay_setup_required`.
- **iOS/Capacitor build** requires Xcode/macOS (not runnable in this environment).
- **Device-derived tenant at login:** the app currently remembers the salon code per device; resolving the tenant
  purely from the registered device is the natural next step of the device-activation phase.
- The full checkout/tap/success/refund flow already existed prior to this pass and was reused, not rebuilt.
