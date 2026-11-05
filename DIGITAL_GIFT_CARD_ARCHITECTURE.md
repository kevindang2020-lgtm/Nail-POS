# Digital Gift Card Platform — Audit & Architecture

Step 1 of your spec ("audit first; do not start large implementation until this audit
is complete"). Every "exists today" claim below was read from the actual monorepo, not
assumed. **Headline: a real stored-value foundation already exists — this is an
extend-and-wire effort, not a greenfield build.** Building a parallel system would
violate the spec's own reuse rules and duplicate money-handling code.

---

## 1. Current architecture (what exists today)

**Data model (migrations)**
- `033_gift_cards.sql` — `gift_cards` (id, tenant_id, branch_id, `code`, `initial_balance_cents`, `balance_cents`, status ∈ active/redeemed/void, customer_id, issued_by_user_id). Integer cents; `UNIQUE(tenant_id, code)`; tenant-scoped. **And** `gift_card_transactions` — already an **immutable ledger**: type ∈ issue/redeem/adjust/refund, `amount_cents`, `balance_after_cents`, `ticket_id`, `payment_id`, `created_by_user_id`.
- `042_customer_wallet_ledger.sql` — the **canonical Customer App Wallet**: immutable, idempotent (`UNIQUE(tenant_id, idempotency_key)`), entry_type ∈ top_up/refund/adjustment/payment/reversal/promo, integer cents.
- `048_loyalty_rewards.sql`, `170_memberships.sql` (+ pauses/KPIs) — loyalty and membership stored-value analogues.

**Backend**
- `gift-cards` module (`apps/api/src/gift-cards/*`) — `@Controller('pos/gift-cards')`, currently **read-only**: `GET state` (`pos.checkout.view`) → portfolio + outstanding liability.
- Checkout domain (`checkout.service.ts` / `checkout.kysely.repository.ts`) already does the money-moving parts: `issueGiftCard` (`POST /pos/checkout/gift-cards`, perm `pos.checkout.gift_card_issue`), `reloadGiftCard`, `giftCardBalance` (`GET /pos/checkout/gift-cards/:code`), `payGiftCard` (redeem at checkout — **wired**, `POSCheckoutScreen` calls it), and repo `decrementGift` with adversarial guards (void card, over-redeem, zero/negative all rejected — see `checkout-giftcard-guard.vitest.spec`).
- Payments: canonical processors Fiserv / CardPointe / Clover only (verified — no Stripe/Square). Split-tender: `split-payments` + `paySplit` (integer-validated segments, one-card-segment guard, sum-equals-due).
- Notifications: `notifications` module — channels `sms`/`email`, E.164/email validation, credit metering. (No `push` in core — see gaps.)

**Frontend**
- POS: `POSGiftCardsScreen` (read-only portfolio via `posGiftCardsApi → /pos/gift-cards/state`). Gift-card **payment** is wired in `POSCheckoutScreen`. The issue/reload/void endpoints exist but **no UI calls them** (confirmed last session).
- Customer App (`customer-web`, 113 screens): `WalletScreen`, `RewardsScreen`, `PayScreen`, `PaymentMethodsScreen` exist — **no gift-card module**.
- Owner: `owner.kysely.repository.ts` reports `giftCardOutstandingCents` (sum of `balance_cents`) + count.
- Settings: `giftCardsEnabled` flag (loyalty settings) + `giftCard: true` in checkout payment methods. Tax config already exempts a "Gift Cards" category.

---

## 2. Existing reusable code — EXTEND these, do not duplicate

| Need | Canonical thing to reuse |
|---|---|
| Stored-value account | `gift_cards` table + `gift-cards` module |
| Immutable ledger | `gift_card_transactions` (already issue/redeem/adjust/refund + balance_after) |
| Customer wallet | `customer_wallet_ledger` (idempotent) |
| Issue / reload / balance | `checkout.service` `issueGiftCard` / `reloadGiftCard` / `giftCardBalance` |
| Redemption at checkout | `checkout.service.payGiftCard` + `repo.decrementGift` (guarded) |
| Split tender | `split-payments` + `paySplit` (gift card is already a valid segment method) |
| Payments | Fiserv/CardPointe/Clover gateway resolver |
| Customer identity | `customers` module |
| Notifications | `notifications` module (sms/email + metering) |
| Reports / liability | `owner.kysely.repository` gift-card outstanding + `reports` giftCard bucket |
| Settings | `settings` module (`PaymentsCheckoutSettings`, loyalty `giftCardsEnabled`) |

---

## 3. Gap analysis — what is genuinely missing

**Backend**
- No **presentation-token** system (short-lived rotating QR/barcode token). `gift_cards.code` is a static per-tenant code — must NOT be the scanned artifact.
- No **claim / transfer / recipient / delivery** model (buy-for-a-friend, scheduled send, claim by OTP).
- No **redemption holds** (concurrency: same card scanned on two iMacs).
- No **promotional-value separation** (purchased vs bonus tracked apart) — current model is a single `balance_cents`.
- Thin **settings** (denominations, designs, policies, limits) and no **designs** model.
- No dedicated **Super Admin** gift-card oversight surface; **reports** cover payment-mix but not full liability lifecycle (breakage, promo expiry, chargeback).
- Richer **status model** (draft/pending/scheduled/claimed/frozen/lost/chargeback…) vs current active/redeemed/void.

**Frontend**
- Customer App **Gift Cards** module (buy / received / sent / scheduled / show-code / history) — entirely absent.
- POS **Sell Gift Card** fast action (endpoint exists, UI doesn't).
- POS **Scan Gift Card** — **no camera/scanner exists anywhere in the repo** (grep found none). New: `getUserMedia` + `BarcodeDetector` (with a JS QR fallback) + backend token validation.
- POS gift-card **settings** screen; gift-card **designs**; gift-card **reports** in Owner App.

---

## 4. Ownership & liability model

**Ownership** maps cleanly onto existing columns, extended:
- Issuing tenant → `gift_cards.tenant_id` (exists). Selling branch → `branch_id` (exists). Purchasing customer → `customer_id` (exists, repurposed as purchaser). Recipient → **new** `gift_card_recipients`. Account → `gift_cards`. Presentation token → **new** `gift_card_presentation_tokens`.
- Balance lives in the backend account/ledger — never in the token (spec §4).

**Liability / accounting — the one thing to decide before building (RISK).**
Today `ai-business-metrics.ts` counts a **gift-card sale as revenue at sale time** ("gift-card sale counted once at sale"), while `owner` reports also track outstanding `balance_cents` as liability. Recognizing service revenue again at redemption would **double-count**. Your spec §2 is explicit: sale = **liability, not revenue**; revenue recognized at **redemption**. These two are in tension. The correct target model (spec §2/§21):
- **Sale:** payment collected (Fiserv/etc.) → **liability +100** (ledger `issue`), service revenue **0**. Not counted in service sales.
- **Redemption $70:** liability **−70** (ledger `redemption`), the $70 becomes tender against the ticket; the ticket's service lines recognize revenue per the canonical commission/revenue rules. Remaining **30**.
- **Promo bonus** tracked in a **separate ledger dimension** (purchased vs promo) so refund/expiry/breakage apply correctly and bonus is a **marketing expense**, never collected cash.

This requires: a `purchased_cents` vs `promo_cents` split on the account/ledger, and a reporting change so the sales report stops recognizing gift-card sales as service revenue (moving them to a liability line). **Decision needed:** confirm redemption-time recognition (this changes existing reports), or keep sale-time with an explicit no-double-count reconciliation. I will not silently change revenue recognition.

---

## 5. Secure presentation-token approach (new, spec §13–14)

- New `gift_card_presentation_tokens`: `id`, `gift_card_id`, `tenant_id`, `token_hash` (store a hash, never the raw token), `nonce`, `expires_at` (short — e.g. 60–120s), `used_at`, `revoked_at`, optional `session_binding`.
- Customer taps **Show Code** → authenticated request mints a fresh token; the QR encodes **only** an opaque token id + nonce (no balance, no `gift_cards.id`, no PII, no secret). Client shows QR + expiry countdown + `Refresh`.
- POS **Scan** decodes the token → `POST /checkout/gift-cards/scan` → backend validates tenant/branch/status/expiry/replay (single-use, rate-limited, audited) and returns a **safe summary** (masked ref + available balance) — never the raw card.
- High-risk redemption can require a one-time challenge/OTP; a screenshot of an expired rotating token is useless.

---

## 6. Required migrations (reconciled against what exists — additive only)

Extend, don't replace. Proposed new/added:
- `gift_cards`: add `purchased_cents`, `promo_cents`, richer `status` CHECK, `expires_at`, `program_id`, `design_id`, `reference` (masked-display), `recipient_id`. (Keep `balance_cents` reconciled to the ledger.)
- New tables: `gift_card_programs` (multi-salon opt-in), `gift_card_designs`, `gift_card_recipients`, `gift_card_deliveries` (channel + provider status), `gift_card_claim_tokens`, `gift_card_presentation_tokens`, `gift_card_redemption_holds` (uniqueness + expiry), `gift_card_fraud_flags`, `gift_card_adjustments` (reason + before/after + actor).
- Extend `gift_card_transactions` types → add hold/hold_release/transfer/freeze/unfreeze/cancel/expire/chargeback (keep existing rows valid).
- Constraints: non-negative available balance, redemption ≤ available, hold uniqueness, token expiry/replay, payment-activation idempotency, ledger idempotency, tenant ownership on every table.

All verified via the existing PGlite migration harness before wiring.

---

## 7. Risks (fraud / accounting / privacy / security)

- **Double-count revenue** (§4) — the top accounting risk; resolve recognition point first.
- **Token replay / screenshot reuse** — mitigated by short-lived single-use rotating tokens + backend validation + rate limits.
- **Cross-tenant redemption** — a Salon-A card must never redeem at Salon-B; backend verifies issuing vs redeeming tenant on every scan/hold/redeem (reuses the tenant-isolation discipline just audited).
- **Concurrency / double redemption** — redemption holds + version/idempotency + atomic ledger update.
- **Account enumeration** — "does this phone own a card" must not leak; no enumeration messages, rate-limited lookups.
- **Chargeback after redemption** — freeze remaining, flag redeemed, accounting exception, never negative balance.
- **Insider balance edits** — every adjustment requires permission + reason + before/after + actor + audit (no unlogged edits).
- **PII / secrets** — never encode balance/PII/raw id/merchant secrets in the QR; never log tokens; store token hashes only.

---

## 8. Phase-by-phase plan (each phase: typecheck + tests + gates + build, green before next)

- **Phase 0 — Decisions + guard tests** (small): lock the accounting recognition point, promo model, token TTL, multi-tenant program scope, expiration legality. Add failing tests that encode the liability invariant.
- **Phase 1 — Data model + settings foundation**: additive migrations (§6) verified on PGlite; extend `gift_card` types; build the real **Gift Card Settings** surface (`Payments & Money → Gift Card Settings`) enforced server-side. No behavior change yet.
- **Phase 2 — Sell Gift Card at POS**: wire the existing `issueGiftCard` endpoint behind a "Sell Gift Card" fast action; liability ledger entry; receipt; reuse canonical payment. (Closes the already-identified unwired endpoint.)
- **Phase 3 — Ledger + liability accounting + Owner reports**: promo/purchased split; redemption-time recognition; Owner App gift-card report (sales / liability / redemptions / promo).
- **Phase 4 — Presentation tokens + Show Code (Customer App)**: token service + the Customer App **Gift Cards** module (list/details/show-code/history).
- **Phase 5 — iMac camera scan + redemption holds + split-tender**: real POS scanner + `scan/validate/holds/redeem` with concurrency guards, integrated into split checkout.
- **Phase 6 — Buy / send-to-friend / scheduled delivery / claim (OTP)**: recipients, deliveries, claim tokens, notifications.
- **Phase 7 — Refunds / chargebacks / freeze / adjustments / fraud flags**; **Phase 8 — Super Admin oversight**; **Phase 9 — Corporate/bulk (optional)**; **Phase 10 — Docs + full test report**.

---

## 9. Decisions I need from you (they change the build)

1. **Revenue recognition** — move to redemption-time (changes existing sales reports), or keep sale-time with an explicit no-double-count reconciliation?
2. **Promotional value** — required in phase 1, or defer (simpler `balance_cents` first)?
3. **Priority order** — POS "Sell Gift Card" first (fastest real value, endpoint already exists), or the Customer App module first (bigger, spec's headline)?
4. **Token TTL + rotation** and whether high-risk redemptions need OTP.
5. **Multi-tenant portfolio redemption** — in scope now, or single-tenant only for v1?
6. **Expiration / breakage** — jurisdictions where you legally allow it (many US states restrict).

I've deliberately built nothing yet beyond this audit — a money/token/ledger system built hastily is worse than none, and your spec asks for the audit to land first. Confirm the decisions above (or say "you decide, proceed") and I'll start **Phase 1** — the additive migrations + the real Gift Card Settings surface — with tests and green gates, then continue phase by phase.
