# AI PowerSalon — Security Audit Report

Mode: **full** · Generated: 2026-11-09T09:51:38.412Z · Duration: 1475s
Result: **NO FAILED CHECKS** — PASSED 32 · FAILED 0 · NOT VERIFIED 4

> Honesty rule (spec §19): a green run means "these listed checks passed", never "everything is secure".
> Secrets are always redacted. Severities appear only on FAILED findings.

## Static gates
- ✅ **PASSED** — check:tenant — Tenant isolation (every scoped-table query carries tenant_id)
- ✅ **PASSED** — check:tenant-builder — Tenant isolation, query-builder statements (ratchet: no NEW unscoped builder query)
- ✅ **PASSED** — check:perms — RBAC coverage (every route carries a permission)
- ✅ **PASSED** — check:public — Unguarded-route allowlist (no accidental public endpoints)
- ✅ **PASSED** — check:sql — SQL prepares against the real schema
- ✅ **PASSED** — check:sql:select — Selected columns exist (no silent undefined fields)
- ✅ **PASSED** — check:impossible — No impossible predicates (dead security filters)
- ✅ **PASSED** — check:crosswire — Cross-module wiring audit
- ✅ **PASSED** — check:di — Dependency-injection dead/missing providers
- ✅ **PASSED** — check:types-drift — DB schema ↔ Kysely types drift
- ✅ **PASSED** — check:unreached — Unreached routes audit
- ✅ **PASSED** — check:dead-client — Dead client methods audit
- ✅ **PASSED** — check:nav — Sidebar/nav wiring audit
- ✅ **PASSED** — check:html — Single-file HTML app audit (kiosk, device manager)
- ✅ **PASSED** — check:no-print — Removed print features stay removed (schedule/queue/service ticket)
- ✅ **PASSED** — check:boot — API boots — real Nest AppModule instantiation
## Committed secrets
- ✅ **PASSED** — Secret scan (10277 files, values never printed) — 22 pattern hit(s) confined to test/fixture files (INFORMATIONAL)
## Security test suites
- ✅ **PASSED** — Deny-path census (RBAC-deny + tenant/branch scope-denial assertions) — RBAC-deny 20 (floor 15) · scope-denial 36 (floor 25); enforcement mechanism unit-proven in security-core; per-route exhaustive deny E2E: NOT TESTED
- ✅ **PASSED** — Auth/session core (quick lane) — modules/identity — 19 passed
- ✅ **PASSED** — Permission kernel (packages/permissions) — 129 passed
- ✅ **PASSED** — §20 MFA asked on every login decision (H4) — modules/identity — 7 passed
- ✅ **PASSED** — Constitution 12 security guards (every push) — 325 passed
- ✅ **PASSED** — Full test battery shard 1/4 (includes all real-schema pgtest isolation suites) — 919 passed, 43 skipped
- ✅ **PASSED** — Full test battery shard 2/4 (includes all real-schema pgtest isolation suites) — 708 passed, 24 skipped
- ✅ **PASSED** — Full test battery shard 3/4 (includes all real-schema pgtest isolation suites) — 921 passed, 31 skipped
- ✅ **PASSED** — Full test battery shard 4/4 (includes all real-schema pgtest isolation suites) — 731 passed, 40 skipped
## Dependencies
- ✅ **PASSED** — npm audit — apps/api — runtime critical:0 high:1 [kysely] · incl. dev: critical:2 high:2 (semver-safe fixes applied; major-version fixes deferred per §13 — no auto-upgrades)
- ✅ **PASSED** — npm audit — apps/pos-web — runtime critical:0 high:1 [re2js] · incl. dev: critical:2 high:2 (semver-safe fixes applied; major-version fixes deferred per §13 — no auto-upgrades)
- ✅ **PASSED** — npm audit — apps/admin-web — runtime critical:0 high:0 · incl. dev: critical:2 high:1 (semver-safe fixes applied; major-version fixes deferred per §13 — no auto-upgrades)
- ✅ **PASSED** — npm audit — apps/manager-pay-web — runtime critical:0 high:1 [re2js] · incl. dev: critical:0 high:2 (semver-safe fixes applied; major-version fixes deferred per §13 — no auto-upgrades)
- ✅ **PASSED** — npm audit — apps/customer-display — runtime critical:0 high:1 [re2js] · incl. dev: critical:0 high:2 (semver-safe fixes applied; major-version fixes deferred per §13 — no auto-upgrades)
- ✅ **PASSED** — npm audit — packages/ui — runtime critical:0 high:0 · incl. dev: critical:0 high:0 (semver-safe fixes applied; major-version fixes deferred per §13 — no auto-upgrades)
## Environment
- ⚠️ **NOT VERIFIED** — Fiserv/CardPointe/Bolt live + sandbox behavior — no processor credentials in this environment; UAT script exists (bolt_uat_roundtrip.py) for when creds arrive
- ⚠️ **NOT VERIFIED** — Production CORS / TLS / reverse-proxy rate limiting — infra-level controls live outside the repo; verify on the deployed host
- ⚠️ **NOT VERIFIED** — SMS delivery + Twilio webhook against live account — TWILIO_* credentials are owner-side
- ⚠️ **NOT VERIFIED** — Physical device flows (ASUS touchscreen, Bolt terminal, iPhone TTP) — hardware unavailable in this environment

## How to run
- Every push/PR (CI): `npm run security:fast` — static gates + secret scan + quick security suites.
- Nightly 1am + manual: `npm run security:full` — adds every real-schema pgtest suite and the dependency audit.
