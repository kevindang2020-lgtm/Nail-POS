# CHANGELOG_HANDOFF.md

Changes made during this repair/handoff session, grouped by area. The repository was already green; work was additive and audit-first.

## Security
- Ran repo-wide secret scan — confirmed no AWS/private/live API keys in source and no committed `.env` (only sanitized templates). No changes required.

## Database
- No shipped migration edited. The new `branchesDashboard` aggregate reads existing tables only (`branches`, `users`, `appointments`, `ticket_service_lines`, `audit_logs`, `tenants`) — no new migration required.

## Backend (`apps/api`)
- Added pure helper `branchStatusGrouping()` (documented Active / Maintenance / Inactive bucketing + raw breakdown) to `super-admin-platform.repository.ts`.
- Added `branchesDashboard()` repo aggregate (grouped queries stitched in JS, no N+1; honest `null` for capacity/health/performance-trend; server-date note for "today").
- Added interface entry + `InMemorySuperAdminPlatformRepo` stub for `branchesDashboard`.
- Added service passthrough `branchesDashboard()` and controller route `GET /super-admin/platform/branches-dashboard`.

## Frontend (`apps/admin-web`)
- Wired `BranchesScreen.tsx` to the real aggregate: six real KPIs (Total/Active/New-This-Month/Total-Staff/Today's-Appts/Monthly-Revenue) with honest fallback, real MTD revenue in the directory, real Active/Maintenance/Inactive status summary; narrowed the "not connected" note to genuinely-missing pieces (capacity/health/map).
- Added typed `branchesDashboard` client binding in `superAdminApi.ts`.

## Testing
- New DB-free harness `branches-dashboard-core.spec.ts` (10/10) for the grouping helper (buckets, case-insensitivity, null/unknown → inactive, totals, empty).
- Updated `BranchesScreen.test.tsx` mock to provide the aggregate and assert real KPIs.
- Re-ran full gate sweep (api tsc/specs; admin-web tsc/vitest/build; pos/owner/tech/customer/display tsc) — all green.

## Documentation
- Created consolidated `docs/handoff/` set (this package): PROJECT_HANDOFF, REPOSITORY_MAP, AUDIT_REPORT, TEST_REPORT, CHANGELOG_HANDOFF, KNOWN_ISSUES, NEXT_CHAT_START_HERE, ENVIRONMENT_VARIABLES, RUNBOOK, plus sanitized `.env.example` copy.

## Configuration / Performance / Accessibility / Payments / AI / Communications
- No changes this session (already green; out of scope of the additive branch-aggregate unit).

---

## 2026-06-26 — Devices & Integrations arc (Phases 1–11) + handoff refresh

New backend modules (apps/api/src/):
- `devices/` — device-fleet overview aggregate (heartbeat online/offline 5-min window, status mix,
  devices-by-branch, honest-null KPIs) over customer_display_devices + pos_payment_terminals + branches.
- `api-webhooks/` — tenant API keys (sha256-hashed, shown once) + webhooks. Webhook signing secrets
  stored AES-256-GCM ENCRYPTED (server must sign), SSRF-guarded URLs, OWNER-gated minting, audited.
  Real HMAC-SHA256 signed delivery via injectable sender; retry/backoff policy; event DISPATCHER with a
  durable delivery ledger (plan → enqueue → processDue → deliver/retry/dead) and a `WebhookEventSink`.
- `deployments/` — device deployment/rollout state machine (no auto-complete; duplicate-start rejected);
  dispatches deployment.completed/failed/rolled_back webhook events on terminal transitions.
- `logs/` — unified device+integration event-log store (read API /pos/logs); LogSink producers write to it
  (webhook deliveries + key/webhook lifecycle → integration logs; deployment events → device logs);
  sensitive metadata redacted; writes never throw to the caller.

Migrations added: 134_api_keys_webhooks, 135_deployments, 136_event_logs, 137_webhook_deliveries.

Frontend (apps/pos-web/src/screens/):
- `POSDevicesScreen.tsx` — rewritten 1:1 Devices & Integrations overview (8 KPIs, device fleet with
  Test/Revoke, payment hardware with Pair/Test/Unpair, integration center, deployment control, charts,
  9 quick actions). Honest `—`/"Not connected" for unwired signals.
- `TenantApiWebhooksScreen.tsx` — API keys & webhooks management (secret-shown-once reveal).
- `TenantLogsScreen.tsx` — device & integration log viewer (reused existing screen, routed).
Routes added: /tenant/integrations/api-webhooks, /tenant/devices/logs.

Security/correctness notes:
- Corrected an initial Phase-4 flaw: webhook signing secrets are now ENCRYPTED (reversible), not hashed,
  because the server must recover them to sign — distinct from inbound API-key hashing.
- All new SQL verified by tsc + DB-free harness + mocked tests only (live PG smoke deferred).

Verified at handoff: API tsc 0; 65 harness + 138 vitest files / 873 tests PASS; 6 frontend tscs 0;
pos-web 51 files / 139 tests, build OK.
