# HANDOFF_MANIFEST.md
### The canonical documentation set — and the policy for everything else

## Canonical documents (read these; they are kept current)
| Doc | Role |
| --- | --- |
| README.md | Repo front page: what/stack/apps/quick-start |
| **DEVELOPER_HANDOFF.md** | **The front door — read first**; status block + START HERE + §51 walkthrough |
| PROJECT_STATUS.md | What actually works right now, with evidence |
| REMAINING_WORK.md | What still needs doing, grouped + sized |
| DEVELOPER_TASKS.md | The exact continuation order (APS-001…042, five phases) |
| ARCHITECTURE.md | System diagram + the four load-bearing flows |
| DATABASE_ARCHITECTURE.md | Schema, identity model, migrations discipline |
| API_INVENTORY.md | GENERATED route table (2,281 routes) — regenerate, never hand-edit |
| AUTH_AND_SECURITY.md | Roles, 332-key catalog, sessions, MFA, isolation |
| PAYMENTS_INTEGRATION.md | Fiserv-only truth; sandbox-verified vs credential-gated |
| LOCAL_DEVELOPMENT.md | Clean checkout → running apps (real commands only) |
| DEPLOYMENT.md | Canonical deploy reference (nothing hosted yet — stated) |
| KNOWN_ISSUES.md | P0–P4 register; the "gated, not broken" table |
| FRONTEND_BACKEND_GAPS.md | Both gap directions, measured |
| ENGINEERING_RULES.md | The 17 enforced invariants |
| BOOKING_PAGE.md | The public booking page: deploy, API base, protections, live-verification record |
| PRINT_FEATURES_REMOVED.md | Owner decision: no printed schedules/queues/service tickets, and the gate enforcing it |
| SECRETS_REQUIRED.md | Every credential by NAME; owner provides values |
| TEST_REPORT.md | Every number's provenance (dated sections, newest last) |
| CHANGELOG_HANDOFF.md | Dated history of every fix/feature since the repair session |
| PUSH_TO_GITHUB.md | First-push procedure + security CI activation |
| .env.example | All 158 documented env variable names |

### Database architecture set (Jul 30 2026 — enterprise-DB spec)
| Doc | Role |
| --- | --- |
| DB_ERD_AND_DOMAINS.md | GENERATED ERD + domain map + full 618-table inventory (regenerate, never hand-edit) |
| DB_INDEX_AUDIT.md | GENERATED index-redundancy audit (report-only; measurement protocol for drops) |
| DB_TRANSACTIONS_AND_CONCURRENCY.md | Every critical operation's atomicity/concurrency mechanism, with pins |
| DB_PARTITIONING_READINESS.md | Partition design per large table — design-only, with convert-when triggers |
| DB_ENTERPRISE_VERIFICATION_REPORT.md | §25 final verification: schema/index/FK/performance/security/isolation/backup/scaling |

Honored equivalents that stay authoritative for their domains (not duplicated into new docs):
SMS_PACKAGES_VERIFICATION_REPORT.md (SMS arc §-by-§ truth) · MOBILE_ECOSYSTEM_MATRIX.md +
MOBILE_CONVERSION_HANDOFF.md (native apps) · UNUSED_ROUTE_INVENTORY.md (wire-or-document set) ·
PAYMENT_PROCESSORS_FISERV_CLOVER_ONLY.md (processor decision record) · NEW_CLAUDE_INSTRUCTIONS.md (AI-session
working rules) · ANDROID_SUBMISSION_RUNBOOK.md / APPLE_APP_CODE_AUDIT.md (store paths).

## Archive directories (named so nobody mistakes them for live code)
`_MERGE_ARTIFACTS/` and `HANDOFF/` (historical fix-package deltas, early handoff snippets) were removed Oct 10 2026 —
recover with `git checkout 62a1875d -- _MERGE_ARTIFACTS HANDOFF` · `apple-readiness/` = iOS store
prep notes. All preserved by policy, all tiny, none imported by any build.

## Everything else at root (~380 dated .md reports)
**Preserved project history — deliberately kept, never deleted** (handoff spec §50). They are the audit trail:
per-module build reports, wiring audits, verification runs, incident writeups. Where one is stale it either
carries a SUPERSEDED banner (the six run/deploy docs) or is superseded by a canonical doc above. When you need
"why is X built this way," grep these before asking; they usually contain the decision with its date.

## Keeping this manifest honest
New canonical doc → add a row here in the same commit. Never remove a historical report; if it misleads, banner
it SUPERSEDED with a pointer, exactly as the six run/deploy docs were.
