# SECURITY_AUDIT.md — Constitution 12, Phase 1 (Security Discovery)

**Verified against this tree on September 22, 2026** (HEAD `651754c` + this audit). Every claim below was checked by
reading code or the real schema. Rule applied: inspect first; reuse and harden; no `*_v2`; never add security
middleware around an insecure boundary (spec preamble).

---

## 1. What exists — and holds

| Area | Found | Verdict |
|---|---|---|
| **Password storage** (§19) | scrypt, N=16384 r=8 p=1, per-user salt, self-describing format, `MAXMEM` raised. | Approved KDF. Spec *prefers* Argon2id; scrypt at these parameters is acceptable — noted, not a finding. |
| **Session tokens** (§22–25) | Signed httpOnly cookie, `SameSite=lax`, `secure` in production; server-side session store with TTL; `authzVersion` poll disconnects realtime on permission change (C9); revocation. | Holds. |
| **Refresh rotation** (§24) | **CORRECTED in Phase 4.** `refreshTokenDecision` exists but has **no callers**: the platform uses server-side revocable sessions (the cookie carries a session id checked against the session store on every request) and issues no bearer refresh tokens. This row previously said "Holds" — that was wrong. | Not applicable to this architecture; §25 revocation covers the threat and works. Decision D7. The function is labelled as unwired in code. |
| **MFA** (§20) | TOTP with RFC 6238 replay protection (matched step recorded atomically); `SUPER_ADMIN: 'required'`; production refuses the any-6-digit fallback; secrets AES-256-GCM in `mfa_factors.secret_enc`. Passkeys: `webauthn_credentials`. | Holds — with one bypass (H4). |
| **Tenant isolation** (§28, §31, §75) | Tenant from the signed session only; `TenantContextMiddleware` strips client `tenantId/branchId`; 17 gates including `check:tenant`, `check:public`, `check:perms`, `check:crosswire`; C11 cross-tenant attempt signal + 18 integrity invariants. | Holds. Composite FKs (§30) and RLS (§33): none — decided in §4. |
| **Permissions** (§26–27) | RBAC (`rbac.ts`), `@RequirePermission` + `RolePermissionGuard`; `check:perms` gate. | Holds. |
| **Webhooks** (§89, §99, §133) | All four webhook controllers verify signatures (payments, bank, Twilio inbound, Twilio verification); payment events deduplicated by `event_id`. | Holds. |
| **Provider credentials** (§43, §47) | `PROVIDER_VAULT_KEK` AES-256-GCM vault for Twilio/email keys (`auth_token_enc`); payment creds `api_username_enc/api_password_enc/bolt_api_key_enc`; bank `bank_account_enc/routing_number_enc`; decrypted only inside resolvers. | Holds — except the key-hierarchy problem (H1). |
| **API keys** (§138–140) | `tenant_api_keys`: prefix, `secret_hash`, scopes, expires_at, last_used_at, revoked_at. | Holds. |
| **Support Mode** (§154–156) | `super_admin_support_sessions`: reason, tenant, expires_at, ended_at, IP/UA; expiry rides the authz poll (C9 §225). | Holds. |
| **Redaction / logging** (§101, §188, §250) | C11 redaction module (81 key tests), structured JSON logging, no OTP/token/password in logs. | Holds. |
| **CI** (§203–207) | `security.yml`: fast on every push, full nightly — all gates, committed-secret scan, pgtest suites, `npm audit`. | Holds for what it covers; gaps in §3. |
| **Files** (§164) | Evidence store (safety community) is private, quarantined, scan-gated; scanner is an interface with no vendor. Media store (tech photos, showcase) is public-URL by design. | Mixed — M2, L1. |

## 2. Vulnerabilities found — classified, none hidden

**CRITICAL:** none confirmed. No plaintext passwords or OTPs, no CVV or PAN storage found, every webhook verified,
tenant never taken from the client.

**HIGH**
- **H1 — FIXED in Phase 7 (and it was WORSE than the audit said).** Discovery found the MFA key falling back to the
  session secret. Phase 7 found the full picture: SEVEN encryption modules, seven keys, NONE required at production
  boot — five falling back to constants written in the source (`'aipowersalon-dev-provider-vault-kek'` and friends)
  and two to scrypt of the session secret. In a production deployment with those variables unset, Twilio/email/AI/
  funding/webhook secrets were encrypted under keys anyone holding this repository knows, silently. Now: one key
  ring; production refuses to boot without every purpose key (listed beside DATABASE_URL); a `_PREVIOUS` key per
  purpose for rotation; payment credentials on their own key with legacy rows still readable. Key hierarchy (§40–41). `mfa-enc.ts` derives its AES key from `AUTH_SESSION_SECRET` when `MFA_ENC_KEY` is
  unset, and `payment-gateway.resolver.ts` uses that same module for **payment processor credentials**. One secret
  therefore signs sessions *and* is the root for MFA secrets *and* payment credentials — a session-secret exposure
  becomes a payment-credential exposure. Fix: production refuses to boot without dedicated keys; separate keys per
  purpose; a rotation path.
- **H2 — FIXED in Phase 10, with a correction:** the API does NOT serve the apps' `dist/` (they are separate static sites), so the audit's "one place to set them" was wrong. The API sets its own (HSTS in production, nosniff, deny framing, no-page CSP, strict referrer, `no-store` on authenticated responses); each app gets a generated `public/_headers` with a CSP derived from what its shell references. Whether Railway's static sites honour `_headers` is unknown here — `DEPLOY_RAILWAY.md` says so. No security headers (§251–252, §68, §36). No HSTS, CSP, `X-Content-Type-Options`, `Referrer-Policy` or
  frame restriction anywhere; the API serves every app's `dist/`, so it is the one place they can be set.
- **H3 — FIXED in Phase 18 prep (migration 452).** `audit_events` and `audit_logs` are append-only at the database: UPDATE always refused; DELETE only by the (future) retention job, only past 365 days, and — for `audit_events` — never while an ACTIVE legal hold covers the row, matched with the retention preview's own semantics. Audit log is not immutable (§187). `audit_logs` has no trigger or grant preventing UPDATE/DELETE; an
  attacker with DB access — or a bug — can rewrite history.
- **H4 — FIXED in Phase 4.** MFA bypass on the owner multi-salon login path (§20). Eight branches in `auth-login.service.ts` hard-code
  `mfaRequired: false, mfaSatisfied: true`; the owner "home salon" resolution path is among them, so an owner who
  enabled MFA is not asked for it there. SUPER_ADMIN is unaffected (its path calls `mfaRequiredForRole`).

**MEDIUM**
- **M1 — FIXED in Phase 10 (gate: no Kysely write receives a body/input/dto whole; zero today, kept at zero).** Mass assignment is discipline, not enforcement (§64). No global `ValidationPipe`, no `whitelist`.
  Controllers pick fields explicitly today; nothing stops the next one passing `req.body` through. A gate can.
- **M2 — CLOSED in Phase 16: accepted by design, verified.** The public media store holds only images MEANT to be public (technician avatars, covers, portfolio and showcase photos); only `tech-profile` and `nail-showcase` write to it (pinned); every key takes its extension from the SNIFFED type (no .html can be stored); path traversal is refused; responses carry `nosniff`. Private files (safety evidence, OCR receipts) live in separate private stores. Media storage is public by design (§164–166). Tech photos and showcase images are served by public URL.
  Acceptable for intentionally public assets; confirm nothing private lands there (receipts, documents).
- **M3 — FIXED (keyed-rate-limit.ts):** TOTP verification during login is budgeted per user (10 failed codes / 15 min; successes never counted; checked BEFORE a guess is spent), and every voice-integration-key route (4 controllers) is budgeted per key (120/min). Same sliding-window, opt-in, fail-open design as the existing limiters. `tenant_api_keys` has no inbound authentication path yet, so there is nothing to key a limit on until one exists. Rate limiting has one dimension (§58). `TenantRateLimitGuard` keys by tenant; login throttle by
  identifier+IP; OTP has its own fraud module. No per-actor, per-device or per-API-key limit.
- **M4 — FIXED in Phase 4.** Session lifetime is one policy for every role (§152, §23). `AUTH_SESSION_TTL` applies to SUPER_ADMIN and
  technicians alike; the spec wants shorter privileged sessions.
- **M5 — PARTLY FIXED in Phase 4** (`security_events`, 17-type catalog; webhook signature failures ×5 sites, cross-tenant attempts, Support Mode start/end, MFA enrol/confirm now recorded). Security-event gaps (§189). C11 records cross-tenant attempts; token reuse, MFA reset, webhook signature
  failure and API-key revocation are handled but not emitted as security events.

- **M6 — FIXED in Phase 7 (migration 451; lookups by token hash, secret in `signing_secret_enc`, plaintext cleared on first use; the empty columns are dropped in a follow-up once every row is NULL).** Bank webhook secret and endpoint token are plaintext columns (§13, §47). `bank_webhook_endpoints.signing_secret`
  and `.token` — the only secrets in the schema without `_enc`/`_hash`. A DB read lets someone forge deposit webhooks.
- **M7 — FIXED in Phase 7 (migration 451, `download_token_hash`).** Billing export download token is plaintext (`billing_export_jobs.download_token`, §170): a DB read downloads exports.
- **M8 — FIXED in Phase 7 (migration 451 drops the column; the table is referenced by no code).** Kiosk session token plaintext (`public_check_in_sessions.public_token`) while `go_checkin_sessions` hashes its equivalent.

- **H5 — FOUND AND FIXED in Phase 5: 22 self-authenticating routes answered 401 to their real callers (§62, §133).**
  TenantContextMiddleware runs on `forRoutes('*')` and throws "No session"; only its exclusion list bypasses it. Routes
  that authenticate themselves (signature, shared secret, device token) or hold no data were missing from it: Railway's
  deploy healthcheck `/health/ready` (added in Constitution 11 — every deploy would have failed), Twilio inbound SMS
  incl. STOP opt-outs and delivery status, the booking-verification status webhook, the customer display's
  signature and rating (its siblings tip/pay were excluded), the public AI booking channel, the backup reporter,
  crash intake, integration inbound, and the AI/membership billing and tenant-warning crons. Each route's own
  authentication was verified before it was excluded; a permanent test pins all of them.
- **H6 — FIXED in Phase 5: the permission layer was allow-by-default (§27).** RolePermissionGuard passes any handler
  without @RequirePermission, and 336 routes had neither a permission nor a realm guard — a CUSTOMER session (which
  carries a salon's tenantId) could reach staff routes. The ones inspected refuse it in their domain services, but
  nothing guaranteed it. `canAccessRoutePrefix` existed for exactly this and was never called (a dead control, with
  bugs: prefix — not segment — matching caught `/customer-display`, and its `/pos` rule would have locked technicians
  out). Revived as RealmGuard (global): customer ≠ staff on every route; a CUSTOMER denied a staff route gets a 404.
  A CI gate (`authz-declared`) now requires every route to declare its authorization; 22 self-service routes
  (auth/me, MFA enrolment, change-password, push registration…) are baselined and the list only shrinks.
- **L4 — Two cron secrets compared with `!==`** (membership billing, tenant warnings, AI billing) — not constant-time.

- **L5 — SSRF DNS rebinding (§72).** Tenant webhook URLs are now refused if the host RESOLVES to a private/metadata address, but `fetch` resolves the name again itself; a DNS answer that changes between check and connect is not stopped. Pinning the connection needs a custom agent.

- **H7 — FOUND AND FIXED in Phase 9: every IP-keyed control was blind or forgeable (§50, §58).** Express's `trust proxy`
  was never set, so behind Railway's edge `req.ip` was the PROXY for every request — every per-IP limit was one bucket
  shared by all users. The public website forms and booking verification read `X-Forwarded-For` RAW, a header the
  client writes, so a bot sending a fresh value got a fresh rate-limit budget each time. The login throttle, built to
  key on the caller's IP, was never given one — it locked per ACCOUNT, so anyone could lock an owner out from
  everywhere by failing five times — and the session's recorded IP came from the request BODY. Now: `trust proxy` is a
  hop count (1 = Railway's edge; never `true`, which trusts the attacker-written leftmost entry — proven on a real
  Express server), one `clientIp()` for every site, no raw header read anywhere (a test pins it).

- **M9 — FOUND AND FIXED in Phase 11: any front-desk employee could refund any payment in full (§93, §180).**
  `pos.checkout.refund` collapses to the same coarse capability as taking a payment, so FRONT_DESK and RECEPTION could
  refund in full with only a typed reason — for cash, the classic insider fraud (refund a cash sale, pocket the cash).
  Now the CUMULATIVE refunded amount on a payment may not pass $50 (cash) or $200 (any method) unless the refunder holds
  the new `checkout.approve_refund` (owners, managers). Evaluated inside the existing advisory-locked reservation, on all
  three refund paths (cash/gift card, live processor, sandbox). Role step-up, not a second-person PIN (none exists).
- **Card data (§84–86) — VERIFIED CLEAN in Phase 11.** No payment-card number or CVV column exists; stored cards are
  processor token + brand + last4 + expiry. `gift_cards.card_number` is a dead plaintext column — every writer stores
  only the hash and last4 — to drop in a cleanup migration.
- **L6 — CLOSED: the refund cap and the manager-approval rule are proven under REAL concurrency.** `refund-race.realpg`
  starts an embedded PostgreSQL 18, applies all 457 migrations, and races reservations on separate connections: two
  $30 refunds of a $50 payment → exactly one passes (the loser sees $20 left); ten at once never exceed the captured
  amount; two front-desk cash refunds → one passes, one is told to get a manager. Removing the advisory lock from the
  production code fails it — the mutation PGlite could never see. The Super Admin one-time code (H8) is proven the same
  way. Opt-in (`REALPG_MODULES`), so CI without the binaries skips it and says so.

- **H8 — FOUND AND FIXED in Phase 12: every one-time code could be used twice and guessed past its limit (§112–114).**
  Super Admin login codes, customer activation codes and password-reset temporary passwords all did read → slow hash
  compare → consume/increment UNCONDITIONALLY. Reproduced on the real schema: one Super Admin code submitted twice at
  once gave TWO logins; twenty simultaneous wrong guesses were all checked against a limit of five. The reset code is
  "APS-" + six digits, so outrunning its limit is an account-takeover route. Now an attempt is claimed atomically
  BEFORE comparing and consumption is a conditional update exactly one caller wins — in all three stores.
- **M10 — FOUND AND FIXED in Phase 12: customer activation was an SMS-pumping endpoint (§115).** Public, any country,
  guarded by a per-phone cooldown and a per-IP throttle (which only began working with H7). Neither stops a distributed
  attack sending one request each to premium-rate numbers. Now the booking-verification fraud module's own
  `destinationRisk` is applied: premium-rate/satellite and unnormalizable numbers refused; other countries sent but
  recorded as SMS_ABUSE_DETECTED (no challenge step exists here, and salons have international customers).
- **Functional — FIXED after Phase 22 (migration 456):** activation tickets and password-reset sessions moved from process
  memory to `ephemeral_grants` — they survive a deploy and work on any instance; only the token's SHA-256 is stored;
  redemption is one atomic DELETE … RETURNING. The reset flow no longer holds the temporary password in plaintext (its
  "must differ" check compares against the token's existing hash).

- **M11 — FIXED in Phase 13: a lost phone could not be found in the sessions list (§144–146).** Revocation worked, and
  the list selected device and user-agent columns — but login wrote neither, so every row was blank. Sessions now carry
  the app-supplied device name, platform and per-install id (display data; no authorization rests on them), the
  User-Agent from the REQUEST, and last_seen_at (touched at most once a minute, on the revocation read). All four apps
  send their identity at login. Tokens were already in the Keychain/Keystore, never localStorage — verified.
  **Bug found on the way:** the in-memory secure-store fallback held one value and ignored the key, so minting a device
  id overwrote the session-token slot; now keyed, in all four apps.

- **M12 — FOUND AND FIXED in Phase 15: the AI phone line verified callers by the number they SAID (§108–110).**
  Knowing a customer's number was enough to hear their upcoming appointments — `search_appointments` is a READ tool,
  always on (a stalking risk: when she will be at the salon, with whom) — and, with write tools enabled, to cancel or
  move them. Verification now requires the number the call COMES FROM: Retell's `call.from_number` (inbound only; never
  a tool argument), or the `X-Voice-Caller-Number` header the voice platform's server-side integration sets on the JSON
  gateway. The spoken number must match it; no caller id → no verification → front-desk handoff. `callerId` is a
  REQUIRED parameter, so the compiler forced all five sites.
- **AI (§104–111) — VERIFIED in Phase 15:** the Constitution 10 chat tasks may call NO tools (every `allowedTools` is
  empty); tenant/branch/actor are injected from the trusted context, never the model. Knowledge retrieval is built to
  filter by tenant BEFORE searching but is not yet called by production code — no retrieval, no cross-tenant retrieval.

- **L7 — FIXED in Phase 16: profile avatars trusted the DECLARED image type.** The data URL's `image/png` label was
  whatever the uploader wrote; the bytes are now magic-number checked and must match it (SVG not accepted).
- **O1 — OPERATIONAL (not security), found in Phase 16: uploaded photos are lost on every deploy by default.** Media
  defaults to local disk, and a Railway container's filesystem is replaced on each deploy. An S3 adapter exists
  (`MEDIA_STORE=s3`). The API now logs a boot warning in production unless `MEDIA_STORE=s3` or `MEDIA_ROOT` is set.

- **Phase 17 — fraud detector BUILT (§172–180, decision D6).** One surface over existing data, every finding explained,
  FLAG-NEVER-BLOCK: refund_spread (one employee's cash refunds across ≥3 payments in 24 h totalling > 3× the per-payment
  approval limit — the gap M9 leaves by design), card_testing (≥10 declines at one branch in 15 min HIGH, ≥25 CRITICAL),
  sms_wave (≥20 SMS-abuse events platform-wide in 1 h). HIGH/CRITICAL open one security incident + one paging alert per
  rule/subject/day. Thresholds are reasoned defaults, not tuned on production data. DONE after Phase 22: the salon's owner is told in
  the Owner app; refund-spreading alerts name the employee and are owner-only (migration 457) on every read and
  status-change path, so a flagged manager can neither see nor dismiss them.

- **Phase 18 — Security Center panel filled (§270–271).** The existing Security screen's "Encryption & Backup Health"
  panel read "No encryption-health schema" — an honest placeholder. It now shows each key-ring purpose (configured /
  on a fallback / optional), secrets overdue for rotation, boot posture warnings (e.g. photos on container disk), and
  security events in the last 24 h by severity and type — names and counts only, never key material (tested). Extended
  in place, not a second screen. Alert routing was already done (security_signal alerts page via the notifier).

- **Phase 19 — restore drills can now be PERFORMED, and they prove the keys (§225–238).** Constitution 11 could only
  receive a drill report. `restore-verify` runs against a scratch restore: schema complete, core tables hold data, and
  one sample of EVERY encrypted column (13, held true against the schema) decrypts with the current keys — because a
  backup restored without its keys "succeeds" with every credential unreadable. `SECURITY_DR.md`: what is and is not in
  a backup (photos and keys are NOT), RPO/RTO targets, the quarterly drill, and the rule that keys must also be kept
  OUTSIDE Railway.

- **Phase 20 — DevSecOps (§203–209).** Found: the every-push CI lane ran the static `check:*` gates, the secret scan and
  just TWO test files; every Constitution 12 guard ran only in the NIGHTLY battery, so a regression (a re-opened
  allow-by-default route, an unlisted secret, a loosened CSP) merged first and failed the next morning. Now the 16
  guards that pin the High findings and isolation properties run on every push (185 tests, ~41 s), held in step with
  the audit script by a test. The workflow token is least-privilege (`contents: read`; it had inherited the repo default).
  Nightly: full battery + `npm audit` failing on any runtime CRITICAL (kept). Not built (L3): container image scan, SBOM,
  action pinning by commit SHA — the SHAs cannot be verified from here and a guessed SHA is worse than a tag.

- **Phase 21 — automated penetration tests (§286–299).** `test-support/security-expectations.ts` gives the four §297
  helpers; `expectIsolated` PAIRS every denial with the owner finding the record, so a query broken to return nothing
  cannot pass. `cross-tenant-suite.pgtest` attacks seven domains (customers, appointments, queue, payments + tickets,
  deals, loyalty, inventory) through their REAL repositories — salon B, salon A's real id — plus a forged-branch case;
  the other five §299 domains are mapped to the files that prove them, each checked to exist and assert isolation. Every
  real IDOR (the salon filter removed from each production query) is caught, and so is an always-empty query. Runs on
  every push. **No IDOR found.** Not automated here (§286, §288): an independent human pen test, and mobile binary /
  rooted-device / certificate-pinning testing — those need a real device and a real tester.

- **M13 — FOUND AND FIXED in Phase 22: the PLATFORM emergency lockdown did nothing (§198, §279).** Account and tenant
  lockdowns revoked sessions; a platform lockdown was recorded 'active' — "relies on the auth gate" — and nothing outside
  the lockdown module ever read it. A Super Admin responding to a breach would have seen "active" while every session and
  login carried on. Now: executing it revokes every non-Super-Admin session (keeping the initiator's), and while active
  every non-Super-Admin request is refused (503) in TenantContextMiddleware — cached per instance, fail-open on a read
  error. Without enforcement wired it refuses to activate rather than report a lock that locks nothing. The existing test
  that asserted the old behaviour ("auth-gate enforced", zero effect) passed only because nothing checked that claim.
- **L8 — FIXED in Phase 22: two automatic incident writers used categories outside the controlled vocabulary**
  (`cross_tenant_access` from C11's signal, `fraud` from Phase 17's detector) — anything filtering by the list never
  showed the two most important incident kinds. Both added; a test holds every writer inside the list.
- **Phase 22 — incident response (§195–202, §310–312).** The existing incident workflow is mapped to §195's states and
  §196's SEV1–4 (`sevLevel`). `SECURITY_RUNBOOKS.md`: all 13 §310 runbooks with the §311 eight-step structure, naming ONLY
  controls that exist — a test checks every route, variable, script and event type named, and that no notification
  deadline is promised (§312: ask counsel).

- **H9 — FOUND AND FIXED after Phase 22: security values from Math.random() (§47, §112).** Node's Math.random() is
  xorshift128+ — predictable from a handful of outputs, which an attacker collects freely. It generated: the customer-
  activation ticket (proof a phone was verified; redeeming it links that customer's account — and it carried a
  sequence counter), the customer phone-verification code, loyalty redemption codes, gift-card codes (spendable money),
  customer-display pairing codes, and the temporary password for every newly onboarded owner/staff account. All now use
  `common/secure-random.ts` (node:crypto). A keyword sweep was tried first and MISSED gift-card and pairing codes, so the
  guard does not guess: every remaining Math.random() must be on a reviewed non-secret list with a reason (29 entries —
  labels, correlation ids, storage-key suffixes, test doubles), and a new one fails CI.

- **M14 — FOUND AND FIXED in the §323 sweep: every staff role could export the entire customer list (§323 "never
  allow unrestricted customer export").** `pos.customers.export` collapsed to the coarse capability `customers.view`,
  held by OWNER, MANAGER, FRONT_DESK, RECEPTION and TECHNICIAN — a departing technician could download every client's
  name, phone and email as a CSV (audited afterwards, which stops nothing). Now `customers.export`, owners and managers
  only; a test pins the holders. Same shape as M9.
- **§323 sweep (all forty prohibitions) — `absolute-prohibitions.vitest.spec.ts` on every push.** Also fixed: signed
  download URLs accepted any lifetime from a caller (now capped at one hour, proven behaviourally); Retell configured
  without its webhook signing key is a boot warning; and my own final report's rollback plan advised dropping the
  security triggers in an emergency — the guard caught it, and the plan now says no control is switched off to recover.

**LOW**
- **L1 — Malware scanning has no vendor (§160)**; media uploads are not scanned at all.
- **L2 — VERIFIED in Phase 10:** no @Get handler is named like a mutation (two reviewed reads); cookie is SameSite=lax + httpOnly. CSRF relies on `SameSite=lax` + Origin checks (§69).
- **L3 — No container/IaC scanning (§208–209)** — Railway builds the Dockerfile; no IaC exists to scan.

## 3. Gaps — not vulnerabilities, but spec items with nothing behind them
Threat model and trust-boundary map (§4–6) · data-classification registry (§14) · device registration/trust for the
mobile apps (§144–146; device tables exist for POS/kiosk hardware, not for app devices) · fraud & abuse risk engine as a
named component (§172–175; signals exist piecemeal: OTP fraud module, money-protection AI, C11 cross-tenant) ·
Security Center screens (§270) · security runbooks (§310) · restore drills, DR validation (§231, §238) · penetration
tests (§286).

## 4. Decisions
| # | Decision | Why |
|---|---|---|
| D1 | **No PostgreSQL RLS.** | §33 says evaluate, not adopt. Every query already carries `tenant_id` from the signed session, `check:tenant` guards the ones that don't, and C11's integrity checks detect crossed rows. RLS with a pooled connection (Railway PgBouncer) needs `SET LOCAL` on every transaction and a worker context on 21 schedulers — a large surface for a second copy of a control that holds. Revisit if a real cross-tenant leak is ever found through the API layer. |
| D2 | **REVISED in Phase 6: tenant-consistency TRIGGERS, not composite FKs**, on the same 18 relationships C11 checks (migration 450, generated from `INVARIANTS` so detection and prevention cannot drift). | Most of these relationships have no FK today: a composite FK would make DELETING a still-referenced parent fail (customer merge/dedupe may rely on it) and needs UNIQUE (tenant_id, id) on nine hot tables. A trigger checks only the child's WRITE — insert, re-point, or tenant move — and leaves delete/orphan behaviour exactly as it was. |
| D3 | **Keep scrypt.** | Approved KDF at sound parameters; a KDF migration forces every user through a re-hash for no concrete gain. |
| D4 | **Secrets Manager = Railway's variable store** (§43). No new secret store. The work is: no fallbacks in production, a documented reference list, rotation audit. | Railway injects secrets at runtime already (§46); a second store adds a failure mode, not security. |
| D5 | **WAF/DDoS = Railway's edge** (§56–57). Documented as the edge; application controls (rate limits, validation) are what this codebase can build. | No IaC to place a WAF in. |
| D7 | **Server-side sessions, no refresh tokens.** | Revocation is immediate (every request checks the session store); refresh-token rotation (§24) exists to limit the damage of a stolen BEARER token, which this platform does not issue to browsers. Privileged-session length is the real lever — Phase 4 caps SUPER_ADMIN at 8 h with no remember-me. |
| D8 | **`security_events` is a new table** (the one justified new store in Phase 4). | `audit_events.tenant_id` is NOT NULL and has no event vocabulary, so platform security events (Super Admin, webhooks before tenant resolution) could not be recorded there at all. Append-only by trigger from birth. |
| D6 | **Fraud engine is built on the signals that exist** (OTP fraud module, C11 cross-tenant, money-protection) as one scoring surface with §174 levels — not a parallel detector. | Reuse. |

## 5. Phase map (§321) — what each phase does in THIS tree
| Phase | Work |
|---|---|
| 2 Threat model | `SECURITY_THREAT_MODEL.md`: boundaries, actors, the eight §307 flows. |
| 3 Classification | `SECURITY_DATA_CLASSIFICATION.md`: registry generated from the schema + a test that every `*_enc` and PII column is classified. |
| 4 Authentication | H4 fix; security events for token reuse / MFA reset; shorter SUPER_ADMIN session (M4). |
| 5 Authorization | Verify deny-by-default with a test over every controller (the gate exists; the test pins it). |
| 6 Tenant isolation | D2 composite FKs; `expectTenantDenied()` helpers (§297); cross-tenant suite over §299's twelve domains. |
| 7 Encryption/keys | H1: dedicated keys, production refuses fallbacks, key versioning for rotation (§42). |
| 8 Secrets | Reference list, rotation audit table, "no secret in frontend bundle" test. |
| 9 Network | Document Railway topology; HTTPS redirect + HSTS (with H2). |
| 10 API | H2 headers; M1 mass-assignment gate; CSRF test (L2); SSRF guard for URL-accepting features; CSV formula injection (§247). |
| 11 Payments | Verify CVV/PAN never stored (test over schema + redaction), refund step-up review. |
| 12 Comms | OTP: single-use/attempt-limited pinned by tests; SMS pumping signal into the fraud engine. |
| 13 Mobile | App-device registry + revocation (§144–146). |
| 14 Realtime/Events | Already C8/C9; add the §34 realtime/worker isolation tests to the cross-tenant suite. |
| 15 AI | Already C10; prompt-injection + cross-tenant retrieval tests (§293). |
| 16 Files | Upload validation (size/MIME/magic/extension), private-by-default for anything not intentionally public, signed downloads for evidence; scanner stays a port (L1). |
| 17 Fraud | D6 risk engine with levels and actions. |
| 18 Monitoring | Security events catalog (M5), Security Center overview screen (§270–271), alert routing via C11 paging. |
| 19 Backup/DR | Reuse C11 backup reports; document encryption/access; DR checklist. |
| 20 DevSecOps | Extend `security.yml`: secret scan on history, dependency policy, headers CI (§305). |
| 21 Pen tests | Automated: IDOR, tenant tampering, cache/WebSocket/job/file tampering (§287). |
| 22 Incidents | Runbooks (§310) in `SECURITY_RUNBOOKS.md`; playbooks §200–202. |

<!-- DOD-TABLE:BEGIN (generated) -->
## 6. Definition of Done (§324) — final status, BUILD_PLAN Phase 14 (Oct 9 2026)

Generated, not written by hand: `cd apps/api && node scripts/security-dod-check.mjs --markdown` (regenerate after any change; the plain run
prints the same lines). Every line is a predicate over evidence in the tree — an export, a route, a migration, a test or a CI
gate — and `src/common/dod-predicates.vitest.spec.ts` proves each one flips to NOT DONE when its evidence is removed.
**HOSTING** = the code is built and tested; the remaining step is Kevin's, named by its row in `docs/HOSTING_ACTIONS_FOR_KEVIN.md`.

**§324: 71 DONE · 11 HOSTING (Kevin) · 0 PARTIAL · 0 NOT DONE of 82**

| # | §324 line | Status | Evidence / Kevin action |
|---|---|---|---|
| 1 | Threat model completed | **DONE** | `SECURITY_THREAT_MODEL.md` |
| 2 | Trust boundaries documented | **DONE** | `SECURITY_THREAT_MODEL.md` |
| 3 | Data classification completed | **DONE** | `SECURITY_DATA_CLASSIFICATION.md`, `apps/api/src/common/data-classification.pgtest.vitest.spec.ts` |
| 4 | Authentication realms implemented | **DONE** | `apps/api/src/common/realm.guard.ts` |
| 5 | Passwords securely hashed | **DONE** | `packages/auth/src/password.ts` |
| 6 | MFA implemented | **DONE** | `modules/identity/src/auth/mfa.controller.ts`, `modules/identity/src/auth/mfa-bypass-regression.vitest.spec.ts` |
| 7 | Passkeys supported | **DONE** | `modules/identity/src/auth/webauthn.service.ts` |
| 8 | Session rotation works | **DONE** | `modules/identity/src/auth/auth.controller.ts` |
| 9 | Session revocation works | **DONE** | `modules/identity/src/auth/session-store.ts` |
| 10 | Device trust implemented | **DONE** | `modules/identity/src/auth/webauthn.kysely.ts`, `apps/api/db/migrations/454_session_devices.sql` |
| 11 | Device revocation works | **DONE** | `modules/identity/src/auth/session-devices.pgtest.vitest.spec.ts` |
| 12 | Authorization deny-by-default works | **DONE** | `apps/api/src/common/authz-declared.vitest.spec.ts` |
| 13 | Tenant isolation enforced | **DONE** | `apps/api/src/common/cross-tenant-suite.pgtest.vitest.spec.ts`, `apps/api/db/migrations/450_tenant_consistency_triggers.sql` |
| 14 | Branch isolation enforced | **DONE** | `apps/api/src/common/cross-tenant-suite.pgtest.vitest.spec.ts` |
| 15 | Composite DB constraints implemented where appropriate | **DONE** | decision D2: consistency triggers, not composite FKs — `apps/api/db/migrations/450_tenant_consistency_triggers.sql`, `apps/api/src/common/tenant-consistency.pgtest.vitest.spec.ts` |
| 16 | Cross-tenant tests pass | **DONE** | `apps/api/src/common/cross-tenant-suite.pgtest.vitest.spec.ts` |
| 17 | Platform/tenant realms separated | **DONE** | `apps/api/src/common/realm.guard.vitest.spec.ts` |
| 18 | Support Mode secure | **DONE** | `apps/api/src/common/tenant-context.middleware.ts` |
| 19 | Support Mode expires | **DONE** | `apps/api/src/common/support-session-gate.ts`, `apps/api/src/common/support-session-gate.pgtest.vitest.spec.ts`, `apps/api/src/common/support-session-gate.vitest.spec.ts` |
| 20 | Support actions audited | **DONE** | `modules/security-center/src/security-events/security-events.ts` |
| 21 | TLS enforced | **HOSTING** | TLS is terminated at Railway's edge (decision D5) and HSTS is sent; keep every custom domain HTTPS-only on Railway (HOSTING_ACTIONS A7) — `apps/api/src/common/security-headers.middleware.ts`, `apps/api/src/common/security-headers.vitest.spec.ts` |
| 22 | Database private | **HOSTING** | point DATABASE_URL at the *.railway.internal host and turn the public TCP proxy off (HOSTING_ACTIONS B4); the app warns at boot on a public host without TLS — `apps/api/src/common/network-posture.ts`, `apps/api/src/common/network-posture.vitest.spec.ts` |
| 23 | Redis private | **HOSTING** | the same for REDIS_URL (HOSTING_ACTIONS B1) — `apps/api/src/common/network-posture.ts`, `apps/api/src/common/network-posture.vitest.spec.ts` |
| 24 | Secrets Manager implemented | **DONE** | decision D4: Railway variables are the store — `apps/api/src/common/secrets-inventory.ts`, `apps/api/src/common/secrets-inventory.pgtest.vitest.spec.ts`, `apps/api/src/common/secret-rotation.ts` |
| 25 | No secrets in source | **DONE** | `apps/api/src/common/key-ring.ts`, `apps/api/scripts/security-audit.mjs` |
| 26 | No secrets in frontend/mobile | **DONE** | `apps/api/src/common/secrets-inventory.pgtest.vitest.spec.ts` |
| 27 | Key management implemented | **DONE** | `apps/api/src/common/key-ring.ts` |
| 28 | Key rotation documented | **DONE** | `SECURITY_SECRETS.md`, `apps/api/src/common/secret-rotation.ts` |
| 29 | WAF implemented | **HOSTING** | application-level abuse controls are built (keyed rate limits, IP blocks, fraud engine; decision D5); a managed WAF in front of Railway (e.g. Cloudflare proxy) is Kevin's choice (HOSTING_ACTIONS A8) — `apps/api/src/common/keyed-rate-limit.ts`, `apps/api/db/migrations/264_ip_block_rules.sql`, `apps/api/src/common/fraud-detector.ts`, `apps/api/src/common/tenant-rate-limit.vitest.spec.ts` |
| 30 | Rate limiting implemented | **DONE** | `apps/api/src/common/keyed-rate-limit.ts`, `packages/security/src/client-ip.ts` |
| 31 | OTP abuse protection implemented | **DONE** | `apps/api/src/common/otp-race.pgtest.vitest.spec.ts`, `modules/identity/src/auth/mfa-brute-force.vitest.spec.ts` |
| 32 | API validation implemented | **DONE** | `apps/api/src/common/api-hardening.vitest.spec.ts` |
| 33 | Mass-assignment prevented | **DONE** | `apps/api/src/common/api-hardening.vitest.spec.ts` |
| 34 | SQL injection protection implemented | **DONE** | `apps/api/scripts/sql-prepare-check.mjs` |
| 35 | XSS protection implemented | **DONE** | `modules/tenants/src/branding/email-layout-safety.vitest.spec.ts`, `apps/api/src/common/app-headers.vitest.spec.ts` |
| 36 | CSRF protection implemented where required | **DONE** | `modules/identity/src/auth/auth.http.ts`, `apps/api/src/common/api-hardening.vitest.spec.ts` |
| 37 | CORS restricted | **DONE** | `apps/api/src/main.ts` |
| 38 | SSRF protections implemented | **DONE** | `apps/api/src/common/api-hardening.vitest.spec.ts` |
| 39 | Payment tokenization architecture verified | **DONE** | `apps/api/src/common/card-data.pgtest.vitest.spec.ts` |
| 40 | CVV never stored | **DONE** | `apps/api/src/common/card-data.pgtest.vitest.spec.ts` |
| 41 | Payment webhooks verified | **DONE** | `modules/security-center/src/security-events/security-events.ts` |
| 42 | Twilio webhooks verified | **DONE** | `modules/communications/src/messaging-inbound/twilio-inbound.vitest.spec.ts`, `apps/api/src/common/sessionless-routes.vitest.spec.ts` |
| 43 | OAuth secured | **DONE** | `apps/api/src/common/oauth-core.ts`, `apps/api/src/oauth/oauth.postgres-race.vitest.spec.ts`, `modules/super-admin/src/super-admin-integrations/integration-connections.kysely.repository.ts` |
| 44 | API keys hashed/scoped | **DONE** | `apps/api/db/migrations/451_hash_plaintext_tokens.sql` |
| 45 | Webhooks deduplicated | **DONE** | `apps/api/db/migrations/565_webhook_dedupe_uniques.sql`, `apps/api/src/common/payment-webhook-dedupe.pgtest.vitest.spec.ts`, `modules/communications/src/messaging-inbound/twilio-webhook-dedupe.pgtest.vitest.spec.ts`, `modules/booking/src/customer-booking/booking-verification-webhook-dedupe.pgtest.vitest.spec.ts`, `modules/super-admin/src/super-admin-billing/billing-webhook-dedupe.postgres-race.vitest.spec.ts`, `modules/super-admin/src/super-admin-integrations/integration-webhook-dedupe.pgtest.vitest.spec.ts`, `modules/ai/src/ai/ai-webhook-dedupe.pgtest.vitest.spec.ts` |
| 46 | Realtime subscriptions authorized | **DONE** | `apps/api/src/realtime/realtime-isolation.vitest.spec.ts` |
| 47 | Realtime payloads sanitized | **DONE** | `apps/api/src/realtime/realtime-isolation.vitest.spec.ts` |
| 48 | Workers least privileged | **HOSTING** | run node apps/api/scripts/db-provision-roles.mjs as the database owner, then set PG_WORKER_DATABASE_URL (worker) and DATABASE_URL (API) to the new logins (HOSTING_ACTIONS D1) — `packages/database/src/kysely.provider.ts`, `apps/api/scripts/db-provision-roles.mjs`, `apps/api/db/roles`, `apps/api/src/common/worker-role.postgres-race.vitest.spec.ts` |
| 49 | Events tenant-validated | **DONE** | `apps/api/db/migrations/450_tenant_consistency_triggers.sql`, `apps/api/src/events/consumers/loyalty-points.pgtest.vitest.spec.ts` |
| 50 | AI tools authorized | **DONE** | `modules/ai/src/ai/ai-tool-registry.ts` |
| 51 | AI cross-tenant isolation tested | **DONE** | `modules/ai/src/ai/ai-knowledge.ts`, `modules/ai/src/ai-center/reception-copilot-assist.service.ts`, `modules/ai/src/ai/ai-knowledge-retrieval.pgtest.vitest.spec.ts` |
| 52 | Prompt injection tests pass | **DONE** | `modules/ai/src/ai/ai-evaluation.ts`, `modules/ai/src/ai/prompt-injection-eval.vitest.spec.ts` |
| 53 | File upload validation works | **DONE** | `apps/api/src/common/file-safety.vitest.spec.ts` |
| 54 | Malware scanning works | **HOSTING** | run a clamd service on Railway and set CLAMAV_HOST (HOSTING_ACTIONS D2); until then uploads are scanned as "not configured" — `modules/safety/src/tenant-safety-community/evidence-scanner.ts`, `packages/media/src/clamav-scanner.ts`, `packages/media/src/upload-policy.ts`, `packages/media/src/clamav-scanner.vitest.spec.ts` |
| 55 | Object storage private by default | **DONE** | decision M2 — `SECURITY_AUDIT.md`, `packages/media/src/private-store.ts` |
| 56 | Signed URLs expire | **DONE** | `modules/safety/src/tenant-safety-community/evidence-blob-store.ts` |
| 57 | Fraud risk engine implemented | **DONE** | `apps/api/src/common/fraud-detector.ts` |
| 58 | Booking abuse controls implemented | **DONE** | `modules/booking/src/customer-booking/booking-verification-fraud.ts` |
| 59 | SMS pumping controls implemented | **DONE** | `modules/booking/src/customer-activation/activation-destination.vitest.spec.ts` |
| 60 | Coupon/gift-card abuse controls implemented | **DONE** | `modules/gift-cards/src/gift-cards/gift-card-number-core.ts`, `packages/security/src/code-lookup-limit.ts`, `apps/api/db/migrations/564_code_lookup_attempts.sql`, `apps/api/src/common/code-lookup-limit.postgres-race.vitest.spec.ts` |
| 61 | Security events implemented | **DONE** | `apps/api/db/migrations/449_security_events.sql` |
| 62 | Security alerts implemented | **DONE** | `apps/api/db/migrations/448_alert_notifications.sql` |
| 63 | Security Center implemented | **DONE** | `apps/api/src/common/security-posture.ts` |
| 64 | Audit immutable | **DONE** | `apps/api/db/migrations/452_audit_append_only.sql` |
| 65 | Backup encrypted | **HOSTING** | credentials inside a backup are ciphertext under keys kept outside it (verified by the restore verifier); confirm encryption at rest of Railway's backups on the plan (HOSTING_ACTIONS D9) — `SECURITY_DR.md`, `apps/api/src/common/restore-verify.pgtest.vitest.spec.ts` |
| 66 | Backup access restricted | **HOSTING** | limit Railway project membership to named people with 2FA; restores only through the scratch-restore workflow (HOSTING_ACTIONS D9) — `SECURITY_DR.md`, `apps/api/scripts/restore-verify.ts` |
| 67 | PITR enabled | **HOSTING** | enable point-in-time recovery on the Railway Postgres plan (HOSTING_ACTIONS A2) — `apps/api/scripts/restore-verify.ts`, `docs/DR_DRILLS_2026-10-08.md` |
| 68 | Restore test completed | **HOSTING** | the drill passed on a local backup (DR_DRILLS); restore a REAL Railway backup into a scratch DB with scripts/restore-verify.ts (HOSTING_ACTIONS A3) — `docs/DR_DRILLS_2026-10-08.md`, `apps/api/scripts/restore-verify.ts` |
| 69 | DR security validated | **DONE** | `SECURITY_DR.md`, `apps/api/src/common/restore-verify.pgtest.vitest.spec.ts` |
| 70 | Secure CI/CD implemented | **DONE** | `.github/workflows/security.yml` |
| 71 | Secret scanning implemented | **DONE** | `apps/api/scripts/security-audit.mjs` |
| 72 | Dependency scanning implemented | **DONE** | `apps/api/scripts/security-audit.mjs` |
| 73 | Container scanning implemented | **DONE** | `.github/workflows/build-image.yml`, `apps/api/src/common/container-image.vitest.spec.ts` |
| 74 | IaC scanning implemented | **DONE** | `.github/workflows/build-image.yml`, `.github/trivy-iac.yaml` |
| 75 | Security regression suite implemented | **DONE** | `apps/api/scripts/security-audit.mjs` |
| 76 | Penetration tests completed where possible | **HOSTING** | commission an independent human penetration test and real-device mobile testing (§286, §288; HOSTING_ACTIONS D7/D8) — `apps/api/src/common/cross-tenant-suite.pgtest.vitest.spec.ts`, `apps/api/src/common/idor-route-coverage.vitest.spec.ts`, `apps/api/scripts/live-phase14-idor.mjs` |
| 77 | Incident-response runbooks created | **DONE** | `SECURITY_RUNBOOKS.md`, `apps/api/src/common/security-runbooks.vitest.spec.ts` |
| 78 | No known critical vulnerability remains | **DONE** | `SECURITY_AUDIT.md` |
| 79 | Build passes | **DONE** | gated on every push (build-image.yml docker build of the API; security.yml build:packages + build:modules); --run measures it here — `.github/workflows/build-image.yml`, `Dockerfile`, `.github/workflows/security.yml` |
| 80 | Type checking passes | **DONE** | gated on every push (API build = tsc over src; gate "app types" typechecks every SPA); --run measures it here — `apps/api/package.json`, `tooling/ci/run-gates.mjs` |
| 81 | Lint passes | **DONE** | gated on every push (gate "lint" = tooling/ci/lint-ratchet.mjs: 0 errors, no rule above lint-baseline.json; npm run lint is the same ratchet); --run measures it here — `tooling/ci/run-gates.mjs`, `apps/api/package.json`, `package.json`, `tooling/ci/lint-ratchet.mjs`, `tooling/ci/lint-baseline.json`, `.github/workflows/security.yml` |
| 82 | Tests pass | **DONE** | gated on every push (security.yml: every suite in a 4-way matrix + the race lane; --run: the 26-file every-push security lane); --run measures it here — `.github/workflows/security.yml`, `tooling/ci/run-tests.mjs` |
<!-- DOD-TABLE:END -->

### Recorded runs (Oct 9 2026, Phase 14 E, branch work/dual-screen-display, uncommitted tree after agents A–D landed)
- `cd apps/api && node scripts/security-dod-check.mjs --run` → exit 0, 2 min 23 s: `tsc --noEmit` (API) passed; lint ratchet
  (`tooling/ci/lint-ratchet.mjs`) 0 errors, 203 warnings, no rule above `lint-baseline.json`; the 26-file every-push security
  lane (`C12_GUARDS` in `scripts/security-audit.mjs`) 303/303 → **§324: 71 DONE · 11 HOSTING · 0 PARTIAL · 0 NOT DONE of 82**.
  (The first `--run` that day was red on four things, fixed before this run: a lint error in `dod-predicates.vitest.spec.ts`,
  four new env secrets missing from `secrets-inventory.ts`, an unreviewed `Math.random()` (INFO-log sampling) in the telemetry
  store, and a stale literal in `absolute-prohibitions.vitest.spec.ts` after the count check moved into `dod-lib.mjs`.)
- `cd apps/api && node scripts/observability-dod-check.mjs --run` → exit 0, 3 min 4 s (tsc, lint, `src/observability` +
  `src/health` suites) → **§396: 70 DONE · 6 HOSTING · 0 PARTIAL · 0 NOT DONE of 76** (OBSERVABILITY_AUDIT.md §6).
- §286 automated penetration test, live: `DATABASE_URL=… node apps/api/scripts/live-phase14-idor.mjs` → 8/8 — 175 tenant-realm
  GET-by-id routes from the manifest = 158 cross-salon cases + 17 reasoned exemptions; 135 denied, 23 answered 2xx with none of
  salon A's data, **0 leaks, 0 crashes**; positive control proven or differential on 131/158. Its first runs found four
  handlers that answered another salon's id with a 500 (mobile-checkout ticket, AI-booking appointment, terminal test /
  unpair, OCR preview without a key) — fixed with failing tests first (`mobile-checkout-foreign-id`, `ai-booking-foreign-id`, `terminal-foreign-id`,
  `ai-ocr-receipt-preview-key` specs; the route table is pinned by `src/common/idor-route-coverage.vitest.spec.ts`).
