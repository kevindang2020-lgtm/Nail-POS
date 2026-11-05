# AI PowerSalon — Security Audit Report

Mode: **fast** · Generated: 2026-09-29T18:38:19.306Z · Duration: 150s
Result: **NO FAILED CHECKS** — PASSED 22 · FAILED 0 · NOT VERIFIED 4

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
- ✅ **PASSED** — Secret scan (6250 files, values never printed) — 8 pattern hit(s) confined to test/fixture files (INFORMATIONAL)
## Security test suites
- ✅ **PASSED** — Deny-path census (RBAC-deny + tenant/branch scope-denial assertions) — RBAC-deny 15 (floor 15) · scope-denial 25 (floor 25); enforcement mechanism unit-proven in security-core; per-route exhaustive deny E2E: NOT TESTED
- ✅ **PASSED** — Auth/session core (quick lane) — modules/identity — 14 passed
- ✅ **PASSED** — Permission kernel (packages/permissions) — 25 passed
- ✅ **PASSED** — §20 MFA asked on every login decision (H4) — modules/identity — 7 passed
- ✅ **PASSED** — Constitution 12 security guards (every push) — 270 passed
## Environment
- ⚠️ **NOT VERIFIED** — Fiserv/CardPointe/Bolt live + sandbox behavior — no processor credentials in this environment; UAT script exists (bolt_uat_roundtrip.py) for when creds arrive
- ⚠️ **NOT VERIFIED** — Production CORS / TLS / reverse-proxy rate limiting — infra-level controls live outside the repo; verify on the deployed host
- ⚠️ **NOT VERIFIED** — SMS delivery + Twilio webhook against live account — TWILIO_* credentials are owner-side
- ⚠️ **NOT VERIFIED** — Physical device flows (ASUS touchscreen, Bolt terminal, iPhone TTP) — hardware unavailable in this environment

## How to run
- Every push/PR (CI): `npm run security:fast` — static gates + secret scan + quick security suites.
- Nightly 1am + manual: `npm run security:full` — adds every real-schema pgtest suite and the dependency audit.
