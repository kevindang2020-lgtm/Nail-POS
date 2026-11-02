# SECURITY_FINAL_REPORT.md — Constitution 12 (Production Security Architecture), final report per §325

**Scope:** all 22 phases, 27 commits (`bb13f80` → HEAD). **Nothing here is deployed; the live site was never inspected** —
every statement is about this code, verified by tests in this repository. Detail lives in the companion documents:
`SECURITY_AUDIT.md` (findings), `SECURITY_THREAT_MODEL.md`, `SECURITY_DATA_CLASSIFICATION.md`, `SECURITY_SECRETS.md`,
`SECURITY_DR.md`, `SECURITY_RUNBOOKS.md`. **Definition of Done (§324), measured by `scripts/security-dod-check.mjs --run`:
58 DONE · 20 PARTIAL · 4 NOT DONE of 82.** PARTIAL lines name what is missing; they are not counted as done.

## 1. Existing security discovery
Authentication (scrypt, TOTP, passkeys, server-side sessions), permissions (RBAC + scope), tenant isolation (query
scoping + a static gate), network (Railway edge + private network), secrets (Railway variables), payments (processor
tokens), webhooks (per-provider signatures), mobile (Keychain/Keystore tokens), files (sniffed images; a private
evidence store), AI (tool registry with no tools granted), backups (C11 reporting). Solid foundations; the failures were
in the joins between them — see §2.

## 2. Vulnerabilities found (not hidden)
- **CRITICAL: none confirmed.**
- **HIGH (9, all fixed):** H1 seven encryption modules, five with source-code fallback keys · H2 no security headers ·
  H3 audit log rewritable · H4 MFA bypassed on owner multi-salon logins · H5 22 self-authenticating routes unreachable
  (incl. the deploy healthcheck and Twilio STOP) · H6 permissions allow-by-default · H7 client IP forgeable or blind
  behind the proxy (login throttle never received an IP) · H8 one-time codes usable twice / guessable past their limit · H9 (found after Phase 22) security values from Math.random() — activation tickets, verification, gift-card, pairing and redemption codes, onboarding temporary passwords.
- **MEDIUM (14):** M1 mass assignment · M3 one-dimensional rate limits · M4 one session length for all roles · M5
  security events · M6–M8 plaintext tokens · M9 front desk could refund anything · M10 activation as an SMS-pumping
  endpoint · M11 lost phones unidentifiable · M12 AI phone line trusted the spoken number · M13 platform lockdown did
  nothing · M14 every staff role could export the whole customer list — all fixed; **M2** (public media store) **closed as correct by design**, verified.
- **LOW:** L1–L8 in `SECURITY_AUDIT.md`; open ones are listed in §60.

## 3. Threat model — see `SECURITY_THREAT_MODEL.md` (trust-boundary diagram and actors).
## 4. Data classification — see `SECURITY_DATA_CLASSIFICATION.md`, generated from the schema; a test fails on any new plaintext secret column.

## 5. Authentication
MFA is asked on every login decision (H4; 8 branches had hard-coded it off). TOTP guesses budgeted per user (M3).
One-time codes claim an attempt atomically and are consumed by exactly one caller (H8). Super Admin sessions capped at
8 h (M4). Sessions carry device name, platform and last-used (M11).

## 6. Authorization
Deny by default: every route must declare its authorization or CI fails (`authz-declared`); `RealmGuard` keeps customer
and staff realms apart on every route; refunds past $50 cash / $200 any need `checkout.approve_refund` (M9); customer export needs `customers.export` — owners and managers only (M14). §323's forty prohibitions are a test on every push.

## 7. Tenant isolation — the layers
Query scoping in every repository · `check:tenant` static gate (new unscoped queries fail; reviewed baseline) · database
triggers refusing a crossed salon id on write (migration 450) · the IDOR suite attacking seven domains with paired
positive controls · realtime rooms derived server-side · tenant-keyed caches · jobs take the tenant from job metadata.

## 8. Branch isolation — branch-scoped queries; the IDOR suite includes salon A's branch id under salon B's tenant.

## 9. Database security
Private network (boot warning on a public host without TLS). Consistency triggers, not composite FKs (D2 revised). **No
RLS (D1)** — isolation is enforced in the application and by triggers. Application-level encryption for credentials.
Backups are Railway's (§33).

## 10. Encryption
Transit: TLS at Railway's edge, HSTS in production. At rest: Railway's. Application level: AES-256-GCM through
`key-ring.ts`, seven purposes, **no fallback in production (boot refused)**, rotation via `<KEY>_PREVIOUS`.

## 11. Secrets — 46 inventoried in `SECURITY_SECRETS.md` (names only, never values); a test holds the inventory true against the code.

## 12. Network security — Railway edge (TLS, DDoS) → API → private Postgres/Redis. `trust proxy` = 1 hop (H7). Boot posture warnings.
## 13. WAF — no dedicated product (D5). Classes covered in-app: rate limits, IP blocks, SMS-destination refusal, fraud detection, security headers.
## 14. Rate limiting — per tenant (existing), per caller IP on login (H7), per user for TOTP guesses, per voice key (M3), per phone / IP / device on activation.
## 15. API security — validation and mass-assignment gate (M1) · parameterised SQL + `check:sql` · CORS allow-list · CSRF via SameSite=lax + no mutating GETs · DNS-resolved SSRF guard · escaped HTML email.

## 16. Payment security — processor tokens only; **a standing guard fails the build on any card-number/CVV column**; refunds atomic under an advisory lock, capped cumulatively, large/cash needing a manager (M9) — proven under real concurrent connections on an embedded PostgreSQL 18 (L6 closed).
## 17. Twilio/SMS — STOP webhook reachable (H5); opt-out enforced at send; premium-rate destinations refused (M10); SMS-wave fraud rule.
## 18. Voice — callers verified by the number the call comes FROM (M12); per-key rate limit; write tools dark by default.
## 19. Mobile — Keychain/Keystore tokens; named device sessions, revocable by name (M11).
## 20. Realtime — rooms from the session; customer/tech streams event-only (no payload); tenant-qualified rooms.
## 21. Events — tenant consistency triggers; consumers verified cross-tenant.
## 22. Worker security — **one database role for API and workers (NOT DONE: least privilege).**
## 23. Webhooks — signatures verified; failures recorded as security events; bank webhook secrets encrypted (M6).
## 24. OAuth/API keys — keys hashed (migration 451); PKCE/state in the integration framework; per-key limits.
## 25. AI — no chat task may call a tool; identity never from model output; retrieval filters by tenant first (not yet live).
## 26. Files — magic-byte validation (avatars fixed, L7); sniffed extensions; traversal refused; private evidence store with a scanner port.
## 27. Fraud & abuse — detector: refund spreading, card testing, SMS waves; flags, never blocks. The salon's owner is told in the Owner app; a refund-spreading alert names the employee and is owner-only (migration 457), so a flagged manager cannot see or dismiss it.
## 28. Security events — append-only table (migration 449), 18 types. 29. Alerts — HIGH/CRITICAL page via the C11 notifier.
## 30. Security Center — encryption keys, rotation, posture and 24 h events on the existing screen. 31. Support Mode — recorded and audited; grants no tenant access today (so nothing to expire — see §60).
## 32. Audit — append-only; purge only by the retention job, past 365 days, never under an active legal hold (H3).
## 33–36. Backups, PITR, restore, DR — Railway-managed backups; **PITR is a plan setting to enable**; `restore-verify.ts` proves a restore usable including every encrypted column; `SECURITY_DR.md`. **A real drill has not been run.**
## 37. DevSecOps — 20 guard files on every push (~40 s); least-privilege CI token. 38. Secret scan — every push. 39. Dependency scan — nightly, fails on runtime CRITICAL.
## 40. Container scan — **NOT DONE.** 41. IaC scan — **NOT DONE.**
## 42. Security unit tests — `test-support/security-expectations.ts` (the four §297 helpers).
## 43. Cross-tenant tests — `cross-tenant-suite.pgtest` + 38 feature suites. 44. API — `api-hardening`, `authz-declared`, `client-ip`.
## 45. Mobile — device-identity tests in all four apps. **Real-device / rooted / pinning tests: not done (needs a device).**
## 46. Webhooks — signature + sessionless-reachability tests. 47. Files — `file-safety`. 48. AI — `voice-caller-id`, tool-registry. 49. Fraud — `fraud-detector.pgtest`, `activation-destination`.
## 50. Penetration testing — automated IDOR suite. **An independent human penetration test is still required.**

## 51–53. Files and migrations
174 files: **85 created, 89 modified**; 40 new test files. Created source includes `key-ring.ts`, `realm.guard.ts`,
`security-headers.middleware.ts`, `client-ip.ts`, `keyed-rate-limit.ts`, `secrets-inventory.ts`, `secret-rotation.ts`,
`network-posture.ts`, `fraud-detector.ts`, `security-posture.ts`, `platform-lockdown.ts`, `restore-verify.ts`,
`refund-approval.ts`, and a `_headers` file for each of the 12 app shells. Migrations: **449** security events · **450**
tenant-consistency triggers · **451** hashed tokens · **452** append-only audit · **453** secret fingerprints · **454**
session devices · **455** fraud event type · **456** ephemeral grants (durable activation tickets and reset sessions, token hashed at rest) · **457** owner-alert audience.

## 54. Infrastructure changes — none to Railway itself; `railway.json` healthcheck already on `/health/ready`.

## 55–56. Environment and secrets required
**Required before deploy:** the seven encryption keys (`MFA_ENC_KEY`, `PAYMENT_ENC_KEY`, `PROVIDER_VAULT_KEK`,
`FUNDING_VAULT_KEK`, `WEBHOOK_SIGNING_KEK`, `AI_PROVIDER_KEK`, `TICKET_DELETION_ENC_KEY`) — production refuses to boot
without them — **and a copy kept outside Railway.** **Strongly advised:** `MEDIA_STORE=s3` (or a volume + `MEDIA_ROOT`) or
uploaded photos are lost on every deploy. Optional: `TRUST_PROXY_HOPS` (default 1), refund thresholds, `ONCALL_PHONE`,
`X-Voice-Caller-Number` for a non-Retell voice platform.

## 57. Deployment order
1. Set the seven keys (and back them up outside Railway). 2. Set `MEDIA_STORE`. 3. Apply patches 1–20 (or the bundle).
4. Deploy — migrations 449–455 run; boot refuses if a key is missing. 5. Check the Security Center: every key
"configured", no posture warnings. 6. Enable PITR in Railway. 7. Run a restore drill (`SECURITY_DR.md`).

## 58. Credential rotation required
Any credential that was ever protected by a source-code fallback key (H1) should be **re-saved** after the new keys are
set — processor, Twilio, bank and AI provider credentials — so it is encrypted under a real key.

## 59. Rollback plan
Code: redeploy the previous release. Migrations are additive (new tables, columns, triggers) and stay in place through a
rollback: **no security control is switched off to recover** (§323). If a consistency trigger refuses a legitimate
legacy row, fix the row (the tests show how legacy data is handled); if the audit tables must be purged, only the
retention job's documented path may do it. Do **not** delete the encryption keys: data encrypted under them would
become unreadable.

## 60. Remaining risks
Workers share one database role · no container or IaC scanning · no independent human penetration test, no real-device
mobile testing · restore verifier built but no real drill run · PITR not verified · fraud thresholds not
tuned on production data · support sessions grant no
access today — if impersonation is built, its guard must enforce expiry · malware scanning not connected until an evidence
bucket is configured · lint is not
a gate (`--max-warnings=99999`) · action pinning by SHA not done.
