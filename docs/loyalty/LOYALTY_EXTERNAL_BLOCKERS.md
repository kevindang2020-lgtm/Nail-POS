# Global Loyalty — external blockers (BLOCKED_EXTERNAL preserved)

None of these can be completed in code. Until each is done, the code keeps the conservative behaviour listed. No fake provider confirmation, no
simulated production purchase and no manual "Paid" override exists or may be added.

| # | Blocker | Owner | Code behaviour until resolved | Verification evidence when done | Next action |
|---|---|---|---|---|---|
| X-1 | Approved **payment provider** for salon token purchases (merchant terms; a salon's own card-processing account cannot be assumed — LoyaltyTokens §5.2) | Platform owner + finance | Production: `fundingProviderFromEnv() → null` → Buy Tokens answers `TOKEN_FUNDING_PROVIDER_UNAVAILABLE`; POS shows the reason; Owner App shows "Not available" | signed provider webhook adapter reaching FUNDS_VERIFIED in staging; books check PASS on funding | choose provider; contract; implement `TokenFundingProvider` adapter with signature verification |
| X-2 | Approved **payout provider** for salon reimbursements | Platform owner + finance | `payoutProviderFromEnv() → null`; "Pay out" → `PAYOUT_PROVIDER_UNAVAILABLE`; payables stay owed; DB refuses PAID without a settled attempt | staging payout settled via signature-verified callback with matching amount; `payouts_settled` check PASS | choose provider; implement `PayoutProvider` + callback route with signature verification; enable `merchant_reimbursement_enabled` for pilot salons only |
| X-3 | **Legal / accounting review** of the funding model (collecting prepayments for cross-salon rewards), chart of accounts (C-13), refund / chargeback policy (C-5, C-14), terms, expiry (C-7), withdrawal retention (C-8) | Qualified counsel + accountant | conservative defaults documented in `SPEC_CONFLICT_RESOLVED.md` | written sign-off recorded in that file | brief counsel / accountant with `LOYALTY_NETWORK.md` + `SPEC_CONFLICT_RESOLVED.md` |
| X-4 | **CI** type-check of pos-web / admin-web / owner-web / customer-web and the query-builder tests (U4 outbox path, U5 Checkout integration) | Engineering | — | CI job ids + exit codes in `LOYALTY_TEST_EVIDENCE.md` | push to a branch after K-12 steps 1–5 (owner rule: no push before then) |
| X-5 | **Load test** (T21) | Engineering | — | report attached to evidence | provision a load environment |
| X-6 | **Pilot** salons' explicit consent + allow-list | Platform owner | every flag OFF | flag allow-lists set; rollback drill recorded | select pilot salons; run sandbox scenarios first |
