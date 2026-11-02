# Tenant / branch provider routing — who charges through what, who texts through what

Mandate §5–§7, §13, §56–§60, §169–§172. One rule for both domains: **the tenant and branch come from the authenticated
session (ctx), the configuration is looked up BY that tenant id, and no fallback ever crosses a tenant.**

## Payments

`PaymentGatewayResolver.resolve(tenantId, branchId?)` — `modules/payments/src/payments/payment-gateway.resolver.ts`

```
branch has its own row in payment_merchant_accounts (tenant_id = ctx.tenantId, branch_id = ctx.branchId)?
   yes → that merchant decides (its processor, credentials, status). PAUSED / DISABLED / PENDING blocks charging at
         that branch — it never silently falls back to the tenant default (a different MID settles elsewhere).
   no  → tenant default (tenant_payment_config, one row per tenant)
   none → not_configured (honest)
```

* `resolveTerminalConfig(tenantId, branchId, terminalMerchantAccountId?)` — the Clover Compact route: the terminal's own
  merchant account → the branch merchant → the tenant default; opens the Bolt key with the PAYMENT secrets. Used by the
  customer display's `TerminalCaptureService` and the terminal readiness probe.
* `resolveTenantByMerchantId(mid)` — inbound webhooks: exactly ONE match across tenant defaults + branch merchants, else
  the delivery is refused (`unknown_merchant`).
* Cache (§169): built processors are cached per `(tenant, scope, provider, config_version, credential fingerprint)` —
  any credential write changes the key; bounded; no process-global "current merchant" (§170).
* Callers that pass the branch: POS checkout (`payProc`), skip-line checkout, the customer display terminal capture, the
  terminal probe. Tenant-level by design: membership renewals and customer wallet top-ups (no branch in those flows).
  Mobile checkout (Owner & Manager Pay app) resolves the tenant default today — noted for the TTP owner.
* `PAYMENTS_ALLOW_ENV_FALLBACK=1` (a platform-wide FISERV_* gateway) is a DEV convenience only; production refuses to
  boot with it (`production-config.ts`).

## Communications (Twilio)

```
tenant_messaging_credentials (tenant_id = ctx.tenantId, branch_id NULL, status configured)
   account_mode tenant_owned     → the salon's own Account SID + sealed token; sender = messaging_service_sid (MG…) else from_number
   account_mode platform_managed → (reserved) a platform-provisioned subaccount; same columns
   none                          → the SHARED platform sender (TWILIO_* env) with the salon's sender:
                                   tenant_a2p_registrations.messaging_service_sid when the campaign is VERIFIED,
                                   else the salon's ACTIVE tenant_messaging_numbers row, else TWILIO_FROM
```

* `KyselyTenantSmsSenderResolver` (own account) and `KyselySenderNumberResolver` (shared account sender) —
  `modules/communications/src/notifications/`. Both key on the tenant id; a released / suspended number is never used.
* `TwilioSmsSender` sends `MessagingServiceSid=` when the sender is an MG… SID, `From=` otherwise (§60).
* Phone numbers belong to ONE salon: registering another salon's number is refused (`tenant-number.service.ts`, §5).
* Verify (booking OTP) credentials resolve the same way through `BookingVerificationService` (tenant → branch row).
* Jobs carry `tenantId` + integration ids, never a token (§171–§172); the worker re-resolves credentials at run time.

## Isolation tests

* `modules/payments/src/payments/merchant-routing.pgtest.vitest.spec.ts` — tenant A vs B, branch merchant vs default, paused branch, webhook MID resolution, cache invalidation, cross-tenant branch row refused by the database.
* `apps/api/src/customer-display/terminal-capture-routing.pgtest.vitest.spec.ts` — the Clover at Cherry Hill charges through the Cherry Hill merchant's Bolt key; a disabled terminal is never charged.
* `modules/communications/src/tenant-messaging/tenant-number-isolation.pgtest.vitest.spec.ts` — number ownership, sender routing, Messaging Service.
* `apps/api/src/common/payment-webhook-dedupe.pgtest.vitest.spec.ts` — cross-tenant transaction ids never match.
