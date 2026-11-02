# Global Loyalty — test evidence (T01–T24 + token groups)

Executed 30 Oct 2026 (UTC evening; R1 31 Oct 00:30 UTC), on top of commit `291d5961` plus the handoff commit that adds this file. Schema: migrations through
`734_global_rewards_redemption_payouts.sql`. Each pgtest applies **every** migration file to a fresh database (`migratedPglite()`); 733 + 734 were also
applied twice to the `aps` template (idempotent re-run, rc 0). Environment: cloud workspace, PostgreSQL 16 template + the repo's unit stand-in (raw SQL;
**no Kysely query builder**), Chromium for E2E. No real money, provider, SMS or card was used anywhere; funding is the SANDBOX provider, payouts have none.

Status words (Final guide §13): **PASS** = executed here, passed · **IMPLEMENTED_NOT_VERIFIED** = written, not executed here (needs CI) ·
**BLOCKED** = cannot run in this environment (reason given). No test was invented and labelled T-n; the T-numbers are LoyaltyRules.pdf v2.0 §8.2.

## Commands (exact)
| # | Command | Result |
|---|---|---|
| U1 | `FST_PG_TEMPLATE=aps REPO_ROOT=$PWD bash tooling/full-system-test/unit-standin/run.sh $PWD modules/loyalty/src/global-rewards/global-rewards-core.vitest.spec.ts` | 28/28 PASS, rc 0 |
| U2 | same runner, `modules/loyalty/src/global-rewards/global-rewards-engine.pgtest.vitest.spec.ts` | 24/24 PASS, rc 0 |
| U3 | same runner, `modules/loyalty/src/global-rewards/global-rewards-redemption.pgtest.vitest.spec.ts` | 15/15 PASS, rc 0 |
| U4 | same runner, `apps/api/src/events/consumers/global-rewards.pgtest.vitest.spec.ts` | 3/7 PASS (direct-handler tests); 4 outbox-runner tests **IMPLEMENTED_NOT_VERIFIED** — stand-in: "query builder is not available" |
| U5 | same runner, `apps/api/src/customer/global-rewards-checkout.pgtest.vitest.spec.ts` | 0/3 — **IMPLEMENTED_NOT_VERIFIED** (CheckoutService's Kysely repository needs the query builder; fixture verified up to that point) |
| R1 | `createdb -T aps loyalty_race; PG_RACE_URL=postgres://postgres@127.0.0.1:55432/loyalty_race FST_PG_TEMPLATE=aps REPO_ROOT=$PWD bash tooling/full-system-test/unit-standin/run.sh $PWD modules/loyalty/src/global-rewards/global-rewards.postgres-race.vitest.spec.ts` (31 Oct 2026 00:30 UTC) | 4/4 PASS on REAL PostgreSQL 16, four separate sessions (sampling saw 4 sessions active at once). **Mutation check:** with the hold guard `available_tenths >= …` removed, 2/4 FAIL; restored → 4/4. Same file runs in CI's race lane (`npm run ci:test:race`). |
| E1 | `node tooling/checkout-one-screen/build.mjs && node tooling/catalog-one-screen/interact.mjs rn-e2e rn` | 13/13 PASS — `tooling/catalog-one-screen/results/rn-e2e/` |
| E2 | `APP=admin-web node tooling/checkout-one-screen/build.mjs && node tooling/catalog-one-screen/interact-sa-ln.mjs` | 10/10 PASS — `results/sa-ln-e2e/` |
| E3 | `APP=customer-web …build.mjs; APP=owner-web …build.mjs; node tooling/catalog-one-screen/interact-apps-rn.mjs` | 5/5 PASS — `results/apps-rn-e2e/` |
| G1 | `cd apps/api && npm run -s check:{tenant,state-transitions,as-any,silent-catch,unreached,error-text,error-codes,openapi,attack-surface,critical-step-up,raw-sql-inputs,response-exposure,realtime-contract,migration-safety}` | rc 0 for those **14** gates only. **Correction (31 Oct):** this row earlier read as "all gates"; the repo has 61 `check:*` gates and only these 14 were run. The full run found 5 failures from this and later work (dead-client, list-queries, sql:select, async-exports, audit-writers — 3 of them loyalty), now fixed; 57 pass, 4 cannot run here. See `docs/GATES_2026-10-31.md`. |
| G2 | stand-in loader: `sql-prepare-check`, `gen-actor-columns --check`, `introspect-schema`, `db-ownership --check`, `audit-unique-tenant-review` | 0 schema errors; actor-stamp ok; types match 844 tables; ownership ok; unique review ok |
| CI | full POS / Admin / Owner / Customer `tsc --noEmit` | **IMPLEMENTED_NOT_VERIFIED** — this environment has no React type packages (`@types/react` absent; TypeScript 6 removed `baseUrl`). Must run in CI. |

## T01–T24 (LoyaltyRules.pdf v2.0 §8.2)
| T | Definition (short) | Evidence | Status |
|---|---|---|---|
| T01 | enrolled, no override → global; label GLOBAL DEFAULT | U2 "T01 …"; E1 step 2 (UI "In force now: AI PowerSalon Global Default") | PASS |
| T02 | draft does not change the active rate | U2 "T02 …"; E1 step 3 (DB DRAFT row, KPI still Global) | PASS |
| T03 | $10 = 2 → 2 tokens per $100, all branches | U2 "T03/T04 …", "T03 custom B $10 = 2 … debits 2.00 tokens" | PASS |
| T04 | another salon stays global, unaffected | U2 "T03/T04 … A stays global" | PASS |
| T05 | global change effective tomorrow | U2 "T05 …" | PASS |
| T06 | future-dated custom; late worker uses the right version | U2 "T06 …" | PASS |
| T07 | return to GLOBAL; history unchanged; next sale global | U2 "T07 …" (new); E1 step 6 (history keeps Superseded) | PASS |
| T08 | paused / unenrolled cannot be bypassed by custom | U2 "T08 …"; E2 step 4 (purchases paused → salon blocked) | PASS |
| T09 | custom needs 2, wallet 1 → no points, no fallback | U2 "T09 …" | PASS |
| T10 | concurrent sales cannot overdraw / duplicate / wrong tenant | U2 "T10 …"; **R1** 16 concurrent sales over 4 real sessions on a wallet funding 10 → 10 EARNED, 6 BLOCKED, wallet 0, ledger never below 0; cross-tenant: U2 | PASS (real concurrency) |
| T11 | duplicate webhook → one earn, one debit | U2 "T11 …"; U4 direct; **R1** the same checkout delivered 8× at once → one award, one debit | PASS (outbox-path variant in U4 IMPLEMENTED_NOT_VERIFIED) |
| T12 | refund uses original snapshot; no double reversal | U2 "a refund reverses with the ORIGINAL snapshot …"; U4 direct | PASS |
| T13 | 20 pts at CUSTOM salon, $2 at GLOBAL salon → one $2 payable, no token debit for accepting | U3 "T13 …" (new) | PASS |
| T14 | purchase confirmation ≠ settlement; pending/UNKNOWN never spendable | U2 "authorized/captured/settlement-pending are NOT spendable …"; E1 steps 8–9 | PASS |
| T15 | payable never falsely PAID; provider confirmation required | U3 "no payout provider …", "verified provider settlement is the ONLY path to PAID …" (DB refuses hand-written PAID / sandbox SETTLED); E2 step 8 | PASS |
| T16 | Customer App English; POS EN/VI toggle keeps money + unsaved editor | E1 "T16 …" (editor kept, same numbers), E1 Vietnamese step; E3 (Customer App English) | PASS |
| T17 | tenant-id / rule-version tampering fails; Manager/Receptionist cannot activate | U2 T19 (receptionist refused), cross-tenant ticket test; E1 Front Desk read-only + foreign purchase 404; bodies are `ValidatedBody(…, { strict: true })` and tenant comes only from the session | PASS for permission + cross-tenant; HTTP-layer strict-body rejection **IMPLEMENTED_NOT_VERIFIED** (harness calls controllers directly) |
| T18 | cache invalidation after changes | No rule cache exists (rule resolved live per sale — U2 T05/T06); screens refetch on `loyalty_network_updated` — E1 step 8 (wallet updated live without reload) | PASS (by design + live refetch) |
| T19 | custom flag OFF blocks API and UI; legacy unaffected | U2 "T19 …"; E1 step 1 (flags off: UI disabled) | PASS |
| T20 | realtime reconnect refreshes, no duplicate subscriptions | shared `useRealtime` hook (its own suite `apps/pos-web/src/realtime/useRealtime.test.tsx`) — not executed here | IMPLEMENTED_NOT_VERIFIED |
| T21 | 200 technicians, multiple branches, 100k+ customers, concurrent load | needs a load environment | **BLOCKED** (environment) |
| T22 | redemption conversion change cannot revalue history | U2 "T22 …" (not editable via program API; each award keeps its value snapshot) | PASS |
| T23 | program disabled with custom policy: liabilities + payables auditable, not deleted | U3 "flags off for redemption → … existing liabilities untouched"; U2 T08 | PASS |
| T24 | duplicate simultaneous activations → one version, no overlap | U2 "T24 …" | PASS |

## Token-specific groups (Final guide §13)
| Group | Cases | Evidence | Status |
|---|---|---|---|
| Funding | $1 = 1 token; verified credit only; failed purchase; duplicate callback; insufficient funds | U1 purchaseQuantity; U2 purchase-state + "credits exactly once"; E1 steps 7–9 (no provider → refused; lost answer → same key); E2 step 5 | PASS (refund / chargeback of a PURCHASE: deficit modelled, no provider webhook — **BLOCKED_EXTERNAL**) |
| Earning | 0.5 / 1-point math, custom override, default fallback, rounding, double-earning prevention | U1 computeEarn / preview; U2 earn tests, T03, T09, T11 | PASS |
| Redemption | hold, double-spend, expired hold, release, paid-ticket finalize, cancellation, two salons concurrent | U3 §04 example, race B vs C, expiry (expired / finalized / kept), release, duplicate finalize; **R1** 8 salons hold at once on real Postgres → only what 45 points cover, losers leave no tender; finalize 6× at once → one payable | PASS (Checkout-service integration U5 IMPLEMENTED_NOT_VERIFIED) |
| Payables | accrual, provider absent, pending, failed, matched PAID, duplicate payout, reversal after paid | U3 payout tests (unverified, duplicate event, mismatch → ON_HOLD, OFFSET after PAID); E2 Integrity steps | PASS (with a test-only verified adapter; no real provider exists) |
| Reconciliation | daily idempotent run, missed-run catch-up, mismatch detection, no auto-balance, tenant isolation | U3 books-check tests (clean, run-key replay + catch-up, tampered wallet FAILED + alert, no auto-fix); G1 tenant gate | PASS |
| Apps / security | opt-in, permissions, private records, correct balances in Customer / Owner / Super Admin | E3 (opt-in tick, stale terms refused, owner/front-desk refused); E2 (owner refused SA API); E1 (front desk read-only) | PASS |

## Screenshots / artefacts
`tooling/catalog-one-screen/results/rn-e2e/` (POS, 4 viewports), `sa-ln-e2e/` (Super Admin incl. Integrity), `apps-rn-e2e/` (Customer + Owner).
