# AI PowerSalon Safety Community (`tenant_safety_community`) — Phase 1: Trust & Safety Core

> **Superseded Oct 10 2026 (BUILD_PLAN Phase 15 doc check) — the module is COMPLETE since BUILD_PLAN Phase 8 (Oct 8 2026);**
> the full account is `BUILD_PHASES_REPORT.md` → "Phase 8 — `tenant_safety_community`, completed". This file is the
> July build log, kept as written; read its "Remaining" / "Remaining phases" lists as history — all of them were built
> (schema `529_safety_community_complete.sql` on top of 360–363; POS feed / drafts / incidents / settings in
> `apps/pos-web/src/screens/community/`; the Super Admin Moderation center `apps/admin-web/src/screens/CommunityModerationPanels.tsx`;
> fan-out, realtime, notifications, appeals, abuse limits, hourly jobs). Paths changed with Constitution 13: the code is
> `modules/safety/src/tenant-safety-community/`, not `apps/api/src/tenant-safety-community/`.
> Evidence, as of Oct 10 (re-read in the code): blob storage is `S3EvidenceBlobStore` when `EVIDENCE_S3_BUCKET` is set,
> otherwise the honest `NotConnectedEvidenceBlobStore` (upload routes answer 503); the scanner reads the malware-scan
> tag (`S3TagEvidenceScanner`, AWS GuardDuty — `docs/HOSTING_ACTIONS_FOR_KEVIN.md` A10/A11) and evidence stays locked
> while `unscanned` — no code path reports a file clean without a scan. Phase 8's own open items (no automatic face /
> plate redaction, AI writing help 503 until a task is registered, no tech-app screen) still stand.


This is a large new module. Rather than scaffold 25+ tables and dozens of endpoints as stubs, Phase 1 builds
the **safety-critical core** — the pure, tested logic that every later layer must obey — so the module's
hardest guarantees ("private stays private", "no customer PII", "cannot become a blacklist") are correct and
verifiable before any DB/controller/UI is wired on top.

## 1. Codebase inspected + reusable infrastructure found (no duplication)

- **Communications** (`communications/`), **Notifications** (`notifications/`) — the module plugs its feed +
  alerts into these, not a new messaging system.
- **Audit** (`audit/`, `super-admin-audit-logs/`) — all community audit events target the existing
  `audit_logs` table (as the OCR + device work already do).
- **Moderation** — `nail-showcase` already implements a Super-Admin moderation surface
  (`SuperAdminNailShowcaseModerationScreen`); the Safety Community Moderation Center follows that pattern.
- **PII redaction** — **`ai-voice-transcription-redaction.ts`** (`redactText`) already does deterministic
  card/cvv/ssn/bank/gov-id redaction. The community privacy scanner **reuses it** and adds the customer-PII
  layer (phone/email/address/customer-id/appointment-code/credential) — which the transcription redactor
  deliberately *preserves* for matching but the community must *block/redact* because posts cross tenants.
- **Super Admin** guard/permission stack (`SuperAdminGuard`), **tenant guards** (`TenantAuthGuard`,
  `RolePermissionGuard`) — reused for the community APIs.

## 2. What Phase 1 builds (all pure, all tested — 24 tests, tsc clean)

`apps/api/src/tenant-safety-community/`:

- **`community-classification.ts`** — the visibility model. `canView(viewer, record)` is fail-closed and is
  the single source of truth for the controlled cross-tenant exception:
  - a `private_incident` is **never** visible to another tenant; a moderator reaches it **only** under an
    explicit `moderationCaseId` (which the caller must audit);
  - a `community_advisory` is visible to other tenants **only once published** (`isCommunityVisible`), and
    only to tenants with community enabled + the role granted access;
  - `assertExplicitAdvisorySubmission` encodes "a private incident never auto-promotes — an authorized user
    must submit a sanitized advisory."
- **`community-privacy-scan.ts`** — `scanCommunityText` → `{ redactedText, findings, blocked, flagged }`.
  **Blocks** card/cvv/ssn/bank/gov-id (cannot publish); **redacts + flags** phone/email/address/customer-id/
  appointment-code/credential (routes to review). `scanDisposition` → `blocked | needs_review | clean`.
- **`community-workflow.ts`** — the posting state machine
  (`incident_draft → tenant_review → privacy_scan → manager_approval → moderation_review → published`, plus
  `sensitive_data_detected`, `returned_for_correction`, `evidence_requested`, `disputed`, `corrected`,
  `resolved`, `removed`, `archived`). Transitions are role- and scan-gated: a blocked/flagged scan diverts to
  `sensitive_data_detected`; receptionists/technicians can't approve; **critical severity and serious
  categories force `moderation_review` before publication**; only a moderator removes a published post.
- **`community-permissions.ts`** — role→capability defaults + a **safety floor**: tenant settings can remove
  capabilities but can **never** grant a receptionist/technician `approve_advisory`/publish, and `moderate` is
  never tenant-grantable. Plus guardrails: `checkWording` rejects accusatory/criminalizing language unless an
  official report is referenced and moderation approved it; `communityPostMayDenyService()` returns a
  hard-typed `false` (any service-gating path must call it and get false); `relatedReportsDisposition` requires
  ≥2 reliable indicators and only ever surfaces "possible related reports", never "known scammer".

## Invariants proven by tests (`community-core.vitest.spec.ts`, 24 passing)
- Tenant A cannot see Tenant B's private incident; moderator only with an audited case.
- Advisories are visible cross-tenant only when published, and only to community-enabled tenants with access.
- Receptionists/technicians cannot publish or approve; approval-required is the default.
- Payment-card/SSN content is blocked; customer phone/email is redacted + flagged for review.
- Serious categories and critical severity require moderation before platform-wide distribution.
- A community post can never auto-deny service; the matcher never labels a "known scammer".

## Verification
- `apps/api` `tsc --noEmit`: **exit 0**.
- `tenant-safety-community` tests: **24 passed**.

## Remaining phases (build ON this core — honest scope)
2. **Data model** — migrations for `tenant_private_incidents`, `community_posts` (+ versions), `community_comments`,
   `community_follows`, `community_reports`, `community_disputes`/`appeals`, `community_moderation_cases`/`actions`,
   `community_evidence`, `tenant_community_settings`, `privacy_safe_risk_fingerprints` (feature-flagged, disabled),
   each with an **explicit `visibility` column** (never inferred) + tenant/category/region/severity/status indexes.
3. **Services + controllers** — private-incident, advisory, comment, approval, privacy-scan, redaction, evidence
   (short-lived signed URLs + malware scan reusing the OCR/voice patterns), moderation, dispute, appeal,
   notification (via existing notifications), search (no raw-identifier search), settings — all `@RequirePermission`
   + tenant-validated, calling the Phase-1 core for every visibility/scan/workflow decision.
4. **Frontend** — Safety Community under Communications (Feed, Critical/Scam/Payment/Booking alerts, My Posts,
   Drafts Awaiting Approval, Followed, Reported, Rules, Notification Settings) + the Super-Admin Moderation Center
   (following the nail-showcase moderation pattern).
5. **Real-time + notifications + analytics + abuse-prevention (rate limits/reputation)**, and the full test
   matrix (integration/permission/isolation/e2e/load).

Nothing above is stubbed or faked here — Phase 1 is real, tested code; phases 2–5 are the disclosed remaining
build, each of which consumes the Phase-1 core so the safety guarantees hold by construction.

---

## Phase 2 — Data model (built + verified)

`apps/api/db/migrations/360_tenant_safety_community.sql` creates the model with the safety rules enforced in the
schema itself:
- **Every shareable record has an explicit `visibility` column** — never inferred. `tenant_private_incidents`
  is CHECK-locked to `visibility='tenant_private'` (immutable); `community_posts.visibility ∈
  (draft|community_published|removed)` with a `ck_published_visibility` constraint that **a `published_*`
  status MUST be `community_published`**. There is no column that flips a private incident public — going
  public requires creating a separate sanitized `community_posts` row.
- Raw, customer-referencing detail lives ONLY in `tenant_private_incidents` (tenant-scoped); `community_posts`
  stores `redacted_body` only.
- `classification`/`status`/`severity`/`verification_label` are CHECK-constrained to the workflow's legal
  values; indexes on visibility+status, category+severity, region, origin tenant, and a partial index on
  published posts.
- Tables: `tenant_community_settings`, `tenant_private_incidents`, `community_posts` (+ `_versions`),
  `community_comments`, `community_follows`, `community_reports`, `community_disputes`,
  `community_moderation_cases` (+ `_actions`), `community_evidence`, and a feature-flagged
  `community_risk_fingerprints` that stores **salted one-way fingerprints only — no identity/PII/reporter
  columns** (verified by test).

Verified: `community-migration.pgtest.vitest.spec.ts` loads the real migration into PGlite and asserts the
constraints reject unsafe rows — **29 tests pass total** (24 core + 5 migration); the schema creates cleanly.

Remaining: Phase 3 (services/controllers calling the Phase-1 core for every decision), Phase 4 (frontend +
moderation center), Phase 5 (real-time/notifications/abuse-prevention + full test matrix).

---

## Phase 3 — Service + repository (built + verified end-to-end)

`apps/api/src/tenant-safety-community/community.repository.ts` (Kysely + in-memory) and `community.service.ts`.
The service performs **no policy of its own** — every decision is delegated to the Phase-1 core:
- `createPrivateIncident` — `can(create_private_incident)`; tenant-scoped insert (raw detail stays private).
- `createAdvisoryDraft` — `can(create_advisory_draft)`; **privacy-scans the body and stores the redacted text
  only** (raw customer PII is never persisted), recording the found categories as flags.
- `promoteIncidentToAdvisory` — `assertExplicitAdvisorySubmission` gate (a private incident becomes an
  advisory ONLY via an authorized, sanitized submission), creates a linked draft.
- `submitAdvisory` — decides disposition from the **flags captured at draft time** (so a post that *contained*
  payment/PII still goes to `sensitive_data_detected` for human review even after auto-redaction), applies the
  `checkWording` guard, and runs the workflow transition; serious categories/critical severity set
  `moderation_required`.
- `approveAdvisory` — approver-role only; publishes ordinary advisories, routes serious/critical to
  `moderation_review` (not community-visible).
- `viewPost` / `listFeed` — reads are gated by `canView`; disabled tenants get an empty feed; unpublished
  drafts are invisible cross-tenant.

**A real bug was caught and fixed during Phase 3:** because the draft stores redacted text, re-scanning it at
submit read clean — so a post that had contained a card number would have advanced. Submit now decides from the
draft-time flags, so contained-sensitive-data posts still get review. (Test proves it.)

Verified: `apps/api` `tsc` exit 0; **47 tests pass** — 24 core, 5 migration, 15 service (in-memory policy
matrix), and 3 end-to-end over the real `KyselyCommunityRepo` + migration 360 in PGlite (draft→submit→approve→
cross-tenant feed; private incident never cross-tenant; payment data diverted).

Remaining: Phase 4 (controllers with `TenantAuthGuard`/`RolePermissionGuard` + `SuperAdminGuard` moderation,
module wiring into AppModule; frontend feed + moderation center) and Phase 5 (notifications/real-time via the
existing services, evidence upload reusing the OCR/voice blob+scan pattern, abuse prevention, full test matrix).

---

## Phase 4 (backend) — Controllers + module mounted

- `community.controller.ts` — tenant API (`community/*`) behind `TenantAuthGuard` + `RolePermissionGuard`, with
  granular `community.*` permissions per handler (feed.view, incident.create, advisory.draft/submit/approve);
  tenant/branch come from `req.ctx` (server-derived). Endpoints: feed, view post, create incident, create
  draft, promote incident→advisory, submit, approve.
- `CommunityModerationController` (`super-admin/community-moderation/*`) behind `SuperAdminGuard`: queue,
  publish, reject, remove — every cross-tenant action performed under a moderation case id.
- `tenant-safety-community.module.ts` — provides `CommunityService` via `useFactory` (Kysely repo when a DB is
  present, in-memory otherwise); imported into `app.module.ts`. Service moderation methods (`listModerationQueue`,
  `moderate`) added and routed through the workflow core (moderator-only, case-gated).

Verified: `apps/api` `tsc` exit 0; **51 tests pass** (24 core + 5 migration + 18 service incl. moderation +
3 e2e + the pglite stack). The API now mounts; a serious post lands in the moderation queue and stays out of the
public feed until a moderator publishes it.

Remaining: Phase 4 (frontend) — the Safety Community feed under Communications + the Super-Admin Moderation
Center (nail-showcase pattern); Phase 5 — notifications/real-time via existing services, evidence upload reusing
the OCR/voice blob+scan pattern, abuse prevention (rate limits/reputation), and the full integration/e2e/load
test matrix.

---

## Interaction layer — comments, reports, disputes (built + verified)

Added to the service/repo/controllers (tables already in migration 360):
- **Comments** — `addComment` requires the post be visible to the viewer (`viewPost` gate) AND the `comment`
  capability, then **privacy-scans the comment exactly like a post**: payment/ID data is BLOCKED
  (`comment_contains_payment_data`), customer PII is redacted, and only the redacted body is stored. `listComments`
  is visibility-gated.
- **Reports** — `reportPost`: any tenant that can see a post may report it; creates an `open` report that feeds
  moderation.
- **Disputes** — `disputePost`: applies the visible **"under review" label** (status → `disputed`) to a published
  post while keeping it community-visible; never removes content automatically. Disputing an unpublished post is
  refused unless you own it.
- Controller endpoints: `GET/POST community/posts/:id/comments`, `POST community/posts/:id/report`,
  `POST community/posts/:id/dispute`.

Verified: `apps/api` `tsc` exit 0; **56 tests pass**, including a pglite test proving comments/reports/disputes
persist against the real schema (comment PII redacted in the DB, report `open`, dispute label applied).

### Current status across the module
Real, tested backend: safety core, constraint-enforcing schema, service routing every decision through the core,
mounted guarded controllers (tenant + moderation), and the comment/report/dispute interaction layer. Remaining:
frontend (feed + moderation center) and Phase 5 infra-dependent pieces (evidence blob storage + malware scan —
shared with the pending OCR infra — notifications/real-time, and abuse-prevention rate limiting).

---

## Evidence layer — access-controlled, honest infra (built + verified)

`community-evidence.ts` (pure access core + honest ports) + service/repo/controller wiring over the
`community_evidence` table:
- **`canAccessRawEvidence`** (fail-closed): raw bytes reachable ONLY by the owning tenant's authorized roles
  (owner/admin/manager) or a moderator under an explicit case; receptionist/technician denied; **another tenant
  is always denied**; and an `unscanned`/`infected` file is never released.
- **`evidenceSummary`** — the only thing community readers get: counts (`count`, `scanned`, `redactionPending`),
  never a storage key or URL.
- Service: `uploadEvidence` (own post/incident only; records honest metadata with `scan_status='unscanned'`),
  `evidenceSummaryForPost` (visibility-gated), `accessEvidence` (routes through the core; returns a signed URL).
- Honest infra: `NotConnectedEvidenceBlob` (returns a `notconnected:` marker, never a fake signed URL) and
  `NotConnectedEvidenceScanner` (returns `unscanned`, never a fabricated `clean`) — so access control holds and
  nothing is faked until blob storage + a scanner are wired (shared with the pending OCR infra).
- Endpoints: `POST community/posts/:id/evidence`, `GET community/posts/:id/evidence/summary`,
  `GET community/evidence/:id/access`, and moderator `GET super-admin/community-moderation/evidence/:id/access`.

Verified: `apps/api` `tsc` exit 0; **67 tests pass** — including proofs that a community reader gets a summary
only, cross-tenant raw access is denied, the owner can't fetch bytes until scanned clean, and a moderator needs
a case. The required spec invariant "Tenant A cannot access Tenant B's private incident evidence" and "moderators
need an authorized case" are enforced and tested.
