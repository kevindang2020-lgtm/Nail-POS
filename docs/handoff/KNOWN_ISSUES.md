# KNOWN_ISSUES — AI PowerSalon (as of 2026-06-26)

These are genuine remaining items, not invented placeholders.

## Environment-gated (need a real runtime, not code defects)
- **Live Postgres smoke not run.** Migrations through 138 (incl. 134–137 from the Devices &
  Integrations arc) are verified by tsc + DB-free harness + mocked/in-memory adapters only.
  Action: `npm run db:up && npm run db:setup`, then re-run integration paths against live PG.
- **No end-to-end run against a live API+DB+browser.** Unit/integration suites cover the logic;
  a full booted-stack e2e pass remains.
- **No iMac pixel QA.** Mac-fit shell rules are followed in code (fixed 100vh shell, internal
  table scroll) but the Devices & Integrations screens are not visually verified at 1920×1080/100%.

## Functional gaps (scoped, incremental)
- **Webhook event dispatcher has no periodic scheduler.** `WebhookDispatchService.processDue` and
  the retry/backoff/ledger are built + tested and reachable via POST /pos/webhooks/process, but no
  cron/queue worker invokes it on a schedule yet.
- **DNS-rebinding residual on the webhook SSRF guard.** `isSafeWebhookUrl` blocks http/loopback/
  RFC-1918/link-local/IPv6-ULA at create and re-checks at send, but does not pin DNS.
- **Device-log producers are partial.** Device logs are produced by deployment events; terminal/
  device pair-test-revoke actions (in the pre-existing settings module) are not yet wired as producers.
- **Deferred granular RBAC.** Current authority for super-admin surfaces is binary `SuperAdminGuard`;
  per-permission RBAC remains blocked on `/auth/me` session-gating.

## Invariants to preserve (not issues — guardrails for the next session)
- Payments are Fiserv (CardPointe/Bolt) + Clover ONLY. Stripe/Square are permanently removed.
  The only "stripe" token in the tree is the AI-billing webhook *signature scheme name*
  (`stripe-style` HMAC), which is NOT a payment processor and must NOT be removed.
- Money is always integer cents. Tenant identity is derived server-side, never trusted from the browser.
- Oversight aggregates are read-only; mutations are session-gated and audited.
