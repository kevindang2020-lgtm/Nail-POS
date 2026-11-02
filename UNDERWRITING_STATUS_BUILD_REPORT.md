# Underwriting / Onboarding Status — Build Report (closes REMAINING_BLOCKERS #1)

The detail panel's **"Underwriting Approved"** step was a proxy — it lit up whenever the gateway had a config row and had
moved past `pending`. There was no underwriting state in the schema. It is now driven by a **real, stored merchant-
application status**, separate from the operational gateway status.

## The new status (distinct from operational status)
A `tenant_payment_config.onboarding_status` column with lifecycle
**`not_started` → `submitted` → `under_review` → `approved` | `declined`** — independent of `status`
(pending/active/error/disabled/paused). A gateway can be operationally `active` while underwriting is still `under_review`,
or `approved` before credentials are entered; the two no longer masquerade as one another.

## Where it comes from (two real sources)
1. **Processor application webhook (primary).** The inbound payment webhook now classifies application/underwriting events
   and writes the status for the resolved tenant — `isOnboardingEvent` + `mapOnboardingStatus` (approved / declined /
   under_review / submitted; unrelated phases make no change). Same tenant-resolution + signature path the
   refund/settlement/chargeback ingestion already uses; the response reports `recordedOnboarding`.
2. **Super Admin manual override (Configure drawer).** `PaymentGatewayPanel` gained an **Underwriting status** selector
   (pre-filled from the masked gateway, included in the encrypted-write save body) so it can be recorded/corrected by hand
   when there is no live processor feed yet.

## What was added / changed
- **DB migration `098_gateway_onboarding_status.sql`** — `onboarding_status TEXT NOT NULL DEFAULT 'not_started'` with a CHECK
  on the five values. `kysely.types.ts` updated.
- **`payments/payment-gateway.resolver.ts`** — `onboardingStatus` added to `MaskedPaymentGateway` and `UpsertGatewayInput`;
  `getMasked` returns it (a small dedicated read; `resolveGateway`'s many branches left untouched); `upsertConfig` persists
  it when provided.
- **`payments/payment-webhook.service.ts`** — `isOnboardingEvent` / `mapOnboardingStatus` (pure, exported) + the update
  block + `recordedOnboarding` in the response.
- **`super-admin-platform/payment-gateways-core.ts`** — `onboardingStatus` on `RawGatewayRow` and `GatewayView`;
  `ONBOARDING_LABEL` map; `toGatewayView` passes it through (defaults `not_started`).
- **`super-admin-platform.repository.ts`** — selects `c.onboarding_status` and maps it onto the row.
- **Frontend `PaymentGatewaysScreen.tsx`** — the detail **steps** are now real:
  - *Application Submitted* → `hasConfig` **or** onboarding in {submitted, under_review, approved}
  - *Underwriting Approved* → `onboardingStatus === 'approved'` (no longer a proxy)
  - *Gateway Connected* / *Terminal Linked* unchanged (already real)
  Plus an **Underwriting** line in the summary (Approved=green, Declined=red, in-progress=amber, Not started=grey).
- **Frontend `superAdminApi.ts`** — `PgGateway` carries `onboardingStatus` + `onboardingLabel`.

## Tests / verification
- `payment-gateways-core.spec.ts` — **79 assertions** (view carries onboarding status + label; defaults to `not_started`).
- `payment-webhook-chargeback.vitest.spec.ts` — **5 tests** (onboarding event recognition + lifecycle mapping, incl. the
  no-change case).
- `PaymentGatewaysScreen.test.tsx` — **12 tests** (approved → step done; under_review → not done + label surfaced).
- `PaymentGatewayPanel.test.tsx` — **9 tests** (selector pre-fills from masked + the chosen value is submitted).
- Full backend suite **608 + harness, RESULT: PASS**; full admin-web **30 files / 160 tests**; `tsc` clean (api +
  admin-web); production `vite build` succeeds.

## Honest notes
- The manual override is intentional: until a processor application feed is wired live, this is how the real status gets
  set. It writes through the same encrypted, masked, per-tenant path as the rest of the gateway config.
- Underwriting status is metadata, not a credential — it is returned in the masked view by design.
