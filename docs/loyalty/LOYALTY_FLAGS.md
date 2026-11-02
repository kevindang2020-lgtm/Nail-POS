# Global Loyalty — flags, environment gates, rollback

All flags are `platform_settings` booleans evaluated per salon with `platform_flag_rollouts` (rollout %, **allow-list of pilot salon ids**, deny-list,
kill switch). Every flag defaults **OFF**; an unreadable setting is OFF (fail-closed, `global-rewards-flags.ts`). Every feature also needs the master
`global_loyalty_engine_enabled`. Owner of every flag: platform owner (Super Admin with `super_admin.settings.manage`).

| Flag (actual name) | Guide intent | Default | Gates | Release condition / external dependency | Rollback (safe) |
|---|---|---|---|---|---|
| `global_loyalty_engine_enabled` | Global loyalty / membership (master) | OFF | everything below | opt-in rules, identity, ledgers verified | turn OFF: no new earning / holds / purchases; liabilities and payables untouched (T23) |
| `global_loyalty_earn_enabled` | Earn points | OFF | `earnForTicket` | funded-token policy + point accounting tests | OFF: sales complete normally, earn nothing |
| `tenant_custom_earning_enabled` | (custom earning rules) | OFF | drafts / activation | owner-facing rules approved | OFF: active custom stays in force (C-10); no new edits |
| `global_loyalty_redemption_enabled` | Cross-salon hold & redeem | OFF | Checkout quote / hold | atomic Checkout + payable accrual sandbox-verified | OFF: no new holds; existing holds expire / finalize normally |
| `tenant_token_purchases_enabled` | Real token purchase | OFF | Buy Tokens | **BLOCKED_EXTERNAL**: approved payment provider + finance approval | OFF: no new purchases; pending ones resolve by provider |
| `merchant_reimbursement_enabled` | Real payout settlement | OFF | Super Admin "Pay out" | **BLOCKED_EXTERNAL**: approved payout provider + finance approval | OFF: payables stay owed (never PAID) |
| `legacy_loyalty_migration_enabled` | (legacy balances) | OFF | nothing converts legacy points (never auto-convert) | reviewed backfill scripts + snapshots | — |

Program switches (Super Admin → Overview, step-up + reason): `earn_paused`, `redeem_paused`, `purchases_paused`, `reimbursements_paused`.

Environment gates (process level):
| Variable | Effect | Production |
|---|---|---|
| `GLOBAL_REWARDS_SANDBOX_PROVIDER=on` | sandbox token-funding provider (TEST, no money) | **ignored** when `NODE_ENV=production` |
| `GLOBAL_REWARDS_HOLD_SWEEP=off` | stops the hold-expiry job (critical job class) | leave on |
| `GLOBAL_REWARDS_BOOKS_CHECK=off` | stops the daily books check (reconciliation job class) | leave on |
| — | no payout provider exists in code (`payoutProviderFromEnv() → null`) | BLOCKED_EXTERNAL |

Pilot (Final §12): deploy 733 + 734 with every flag OFF → sandbox scenarios with synthetic users (`GLOBAL_REWARDS_SANDBOX_PROVIDER=on`, non-production) →
enroll explicitly consenting pilot salons and add them to each flag's allow-list → monitor duplicate-hold rate, books-check findings, payable age,
payout failures, support tickets → kill switch / flag OFF to roll back (never deletes liabilities or provider obligations).
