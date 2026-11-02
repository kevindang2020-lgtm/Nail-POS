# Global Loyalty — readiness matrix (truthful)

Definitions (Final guide §14): **CODE_READY** implemented, its executable checks pass, no claim of live money · **SANDBOX_READY** end-to-end sandbox
evidence incl. double-spend, reimbursement and error cases · **PRODUCTION_READY** approved providers + accounting / legal review + monitoring + rollout
controls verified live · **BLOCKED_EXTERNAL** cannot proceed without a named external approval / provider.

**Nothing below is PRODUCTION_READY.** All flags are OFF by default.

| Feature | CODE_READY | SANDBOX_READY | PRODUCTION_READY | Remaining blockers |
|---|---|---|---|---|
| Ledgers (wallet, points, journal), append-only + balanced | ✅ | ✅ (U2, U3, books check; R1 real-Postgres races) | ❌ | accountant approval of the chart of accounts (C-13); CI type-check |
| Global / custom earning rules (T01–T09, T24) | ✅ | ✅ (U2, E1) | ❌ | finance sign-off of refund rule (C-5); CI |
| Earning funded by tokens | ✅ | ✅ (U2, consumer direct) | ❌ | outbox-path consumer tests in CI (U4) |
| Buy Tokens (funding) | ✅ | ✅ sandbox provider only (E1, E2) | ❌ | **BLOCKED_EXTERNAL**: approved payment provider, merchant terms, legal / accounting review |
| Cross-salon Checkout hold / finalize / release / expiry | ✅ | ✅ engine + consumer (U3, U4 direct); Checkout-service path **IMPLEMENTED_NOT_VERIFIED** (U5) | ❌ | CI run of U5; owner confirmation of hold TTL (C-6) |
| Reimbursement payables (owed, adjusted, offset) | ✅ | ✅ (U3, E2, E3 owner) | ❌ | finance policy for refunds / chargebacks (C-14) |
| Payout settlement (PAID) | ✅ code path + DB guards | ⚠️ exercised only with a test-only verified adapter (U3); no sandbox payout by design (C-12) | ❌ | **BLOCKED_EXTERNAL**: approved payout provider + finance approval |
| Daily books check + findings + alerts | ✅ | ✅ (U3, E2) | ❌ | staging run of the scheduled job (worker heartbeat) |
| Super Admin integrity dashboard | ✅ | ✅ (E2) | ❌ | CI type-check of admin-web |
| Fraud signals (review-first) | ✅ | ✅ (U3, E2) | ❌ | thresholds to be tuned on pilot data |
| POS Rewards Network view (EN/VI) | ✅ | ✅ (E1, 4 viewports) | ❌ | CI type-check of pos-web |
| Customer App My Rewards + opt-in (EN) | ✅ | ✅ (E3) | ❌ | legal: terms text, expiry (C-7), withdrawal retention (C-8) |
| Owner App Rewards (EN) | ✅ | ✅ (E3) | ❌ | CI type-check of owner-web |
| T21 scale (200 techs, 100k customers) | — | ❌ not run | ❌ | load-test environment |
