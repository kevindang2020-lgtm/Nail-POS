# Customer Wallet (Store Credit) — Security & Correctness Audit

Audit of the customer store-credit ledger — real customer money — completing the money-path review alongside
`CASH_SECURITY_AUDIT.md` and `PAYMENT_PATH_AUDIT.md`. **Result: clean — no findings.** The design is correct; no change
was made (and none was manufactured).

## Why it's sound
| Risk | Result | Why |
|---|---|---|
| **Overdraw / double-spend (concurrency)** | ✅ Safe | `postDebitAtomic` runs in a transaction that first takes a **per-wallet advisory lock** (`pg_advisory_xact_lock` over `tenant|customer|wallet`), then computes `SUM(amount_cents)` and checks `balance + amount < 0` and inserts — all **inside the lock**. Concurrent debits on the same wallet are serialized, so two debits can't each pass and drive the balance negative. |
| **Double-credit / double-debit (retries)** | ✅ Safe | Idempotent: a pre-check by `idempotency_key` plus the DB partial unique index `uq_customer_wallet_ledger_idem (tenant_id, idempotency_key)`. A retried top-up/payment can't post twice. |
| **Minting free credit** | ✅ Safe | There is **no** customer-callable credit endpoint — the wallet controller exposes only `GET /customer/wallet` (read). Credit is posted **only** inside the top-up flow, **after** an approved card charge (`if (!res.approved) return …`), keyed on the processor retref. No charge ⇒ no credit. |
| **Balance drift** | ✅ Safe | Append-only ledger; balance is always `SUM(amount_cents)` — there is no mutable balance column to drift. Corrections are new reversal rows; rows are never updated or deleted. |
| **Tenant / customer isolation** | ✅ Safe | `customerId` is resolved from the **session** (never the client); every balance/transaction/posting query is scoped by `(tenant_id, customer_id)`. A customer at two salons has two independent wallets; funds never mix. |
| **Amount validation** | ✅ Safe | Postings require a positive whole number of cents (`isPostableAmount`); debits post `-abs(amount)`. |

## Bottom line
The wallet's money-safety properties — no overdraw (even under concurrency), no double-post, no free credit, no drift,
strict isolation — all hold. This is a well-built ledger; the audit is a clean confirmation.

## Money-path review status
- Cash drawer / movements / hand-offs — audited; void/correction gap fixed (`CASH_SECURITY_AUDIT.md`).
- Card checkout / refunds / PCI — audited; concurrent-idempotency id and recursive-scrub fixes (`PAYMENT_PATH_AUDIT.md`).
- Customer wallet ledger — audited; **clean** (this doc).
- Remaining: subscription / overage **billing** (the salon-billed path) is the last natural money-path audit.
