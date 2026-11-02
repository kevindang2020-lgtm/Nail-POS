# Payment Gateway — Security Report

The credential-security requirements (§11/§14) were **already implemented and correct** in the existing code; this build
preserves them and adds nothing that can leak a secret. Verified end-to-end.

## Guarantees (and where they're enforced)
- **Encrypted at rest** — credentials are stored in `tenant_payment_config.{api_username_enc, api_password_enc,
  webhook_secret_enc}` (AES-256-GCM, the same cipher as `mfa_factors.secret_enc`), written by `PaymentGatewayResolver`.
- **Write-only from the frontend** — `PaymentGatewayPanel` credential inputs are never pre-filled and are cleared after
  save; the masked summary shows only `Merchant: ••••last4` + "configured" booleans.
- **Masked-only returns** — the list/state endpoints return `merchantIdMasked` (`••••` + last 4) and
  `credentials.{apiConfigured, webhookConfigured}` booleans. The raw MID is masked in `payment-gateways-core` before any
  value is returned; raw API username/password/webhook secret are **never** selected into the state path at all.
- **Tenant isolation** — every gateway read/write/test derives the tenant/branch server-side (Super Admin selected id under
  `SuperAdminGuard`; POS from the authenticated session/ticket). A frontend-supplied tenantId is never trusted for actions.
- **No secrets in logs / errors / audit / CSV** — the pure core is unit-tested to prove a **raw MID never appears** in any
  `GatewayView` or in the exported CSV (2 explicit assertions); webhook events store only `payload_json_safe` + a masked MID.

## Verification
- `payment-gateways-core.spec.ts`: 60 assertions, incl. `view never exposes raw MID` and `csv NEVER contains raw MID`.
- `PaymentGatewaysScreen.test.tsx`: asserts the masked MID renders, no raw secret appears, and the Configure drawer's
  credential inputs are write-only (placeholder `write-only`, never pre-filled) with the "encrypted at rest" assurance.
- `PaymentGatewayPanel.test.tsx` (pre-existing): masked-only view + cleared-after-save behavior.
