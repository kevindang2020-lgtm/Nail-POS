# `tenant_safety_community` — spec vs code (Oct 6 2026, tree 7301539f)

Verdict: **PARTIAL, about 30%.** The pure safety core, the schema and ~25 backend routes are real and unit-tested. All
frontend work, realtime, tenant settings, most moderation actions and most of the post lifecycle are missing — and three
bugs stop the API from working at all in production (every tenant user maps to "technician" → 403; moderator identity is
undefined; moderation cases are fabricated).

All module code: `modules/safety/src/tenant-safety-community/` (`tsc/` below), mounted in `apps/api/src/app.module.ts:12,113`.

## What the spec asks for
A moderated network where salons share safety advisories — a deliberate exception to tenant isolation. Two records: a
Private Tenant Incident (visible only to the posting tenant) and a sanitized Community Advisory (visible to verified tenants
with permission); an incident never becomes an advisory automatically. Workflow incident_draft → tenant_review →
privacy_scan → manager_approval → moderation_review → published (17 statuses, 5 severities, ~27 categories, neutral wording;
receptionist posts need approval; serious/critical need Super Admin moderation). Privacy: phone, email, address, card, bank,
IDs, faces, plates, QR detected and redacted; no search by customer identifier; optional salted-hash risk matching behind a
disabled flag. Feed/filters/sorting, post detail actions, threaded comments, similar-experience reports, follows +
notifications (in-app, push, email; SMS only for critical), private evidence (encrypted, short-lived signed URLs,
malware-scanned, audited), AI writing/moderation assist (advisory only), disputes/corrections/appeals, anonymous posting,
tenant settings, rules acknowledgment, emergency guidance. Super Admin "Safety Community Moderation" center (16 panels, 21
actions, case-based audited access). ~25 tables, ~20 services, ~30 APIs with auth/validation/rate limits/pagination/audit,
realtime, analytics, abuse prevention, a full test matrix and a 32-item completion list.

## Status by area
| Area | Requirement | Status | Evidence |
|---|---|---|---|
| Schema | settings, private incidents, posts, versions, comments, follows, reports, disputes, moderation cases/actions, evidence, fingerprints | DONE | MIG 360; types `kysely.types.ts:2159-2275,5552` |
| Schema | appeals; critical-SMS opt-in; fingerprint expiry | DONE | MIG 362, 361, 363 |
| Schema | explicit visibility + CHECK-locked private rows | DONE | 360:30,50,70-73 |
| Schema | categories, tags, comment_versions, reactions, comment_reports, redactions, related_posts, similar_incidents, incident_approvals, user_restrictions, ai_analysis | MISSING | — |
| Schema | post fields (incident date, scam method, channels, recommendation, tags, counts, processor, amount range, references, display name) | MISSING | posts have only title, redacted_body, category, severity, region |
| Schema | comment threading (parent_id); FTS/trigram index; FKs | MISSING | 360:95-103; no FKs at all |
| Schema | settings columns (display name, branch visibility, anonymous, retention, region prefs, matching toggle) | MISSING | 360:12-23 + 361 only |
| Services | pure core (visibility, workflow, capability floor, wording guard, deny-service invariant) | DONE | `community-classification.ts`, `community-workflow.ts`, `community-permissions.ts` |
| Services | private incident | PARTIAL | create + get only (`community.service.ts:81-86`) |
| Services | draft / promote / submit / approve | PARTIAL | service 89-165; no update-draft or re-scan; `managerApprovalRequired` ignored |
| Services | comments | PARTIAL | flat add/list (223-237) |
| Services | text privacy scan + redaction | DONE | `community-privacy-scan.ts` (reuses `@aipowersalon/ai` redactor); no name/DOB/image detection |
| Services | evidence | PARTIAL | access core, private S3 store, tag scanner exist; bytes never uploaded (`put()` never called 271-283); scanner injected (37) but never called |
| Services | moderation | PARTIAL | queue, publish, reject, remove, signals (190-217) |
| Services | disputes / appeals | PARTIAL | create + label (251-264); appeals (`community-appeals.ts`, 322-386) broken over HTTP |
| Services | notifications | PARTIAL | `community-notify.ts` on publish only; deep link `/community/posts/:id` exists in no app |
| Services | search | PARTIAL | identifier screening works; `LIKE '%term%'` (`community.repository.ts:169-181`) |
| Services | abuse / rate limits | PARTIAL | `community-abuse.ts`, `gate()` 414-422; `searchesLastHour` hard-coded 0 (repository 155) |
| Services | audit | PARTIAL | `community-audit.ts` → `audit_logs`; case-keyed moderation trail fails silently |
| Services | AI assist | PARTIAL | `community-ai-assist.ts`; no AI backend wired (`tenant-safety-community.module.ts:22-35`) → always 503 |
| Services | risk matching behind a flag | PARTIAL | pure functions only |
| Services | related posts, similar incidents, duplicate detection, settings writes, analytics, retention jobs | MISSING | — |
| Routes | 17 tenant `/community/*` + 8 `/super-admin/community-moderation/*` with guards | DONE | `community.controller.ts:23-86,96-133`; domain `platform-roles.ts:102` |
| Routes | update draft, submit-for-approval, my lists, edit published, add update, resolve, reply, edit/delete comment, follow, similar experience, report comment, notification settings, tenant settings, platform alerts, moderator actions (request evidence/changes, redact, labels, restrict, lock, remove comment, restore, merge, suspend, contact tenant), report/dispute queues | MISSING | — |
| Routes | DTO validation, pagination/sorting, safe serialization | MISSING | controller passes `b?.x` straight through; fixed LIMIT 200/100/500; raw rows returned |
| Permissions | 7 `community.*` keys + role defaults | DONE | `rbac.ts:125-126,149-155,174,196-198` |
| Permissions | service role mapping | BROKEN | service 22-31 expects lowercase roles; real roles are uppercase |
| Permissions | separate keys for settings/report/dispute/appeal/follow; tenant-admin role; technician internal incident | MISSING | all gated by `community.feed.view`; core `NEVER_GRANT` forbids technician incidents |
| UI | pos-web / owner-web / admin-web moderation center / tech-web; rules acknowledgment; emergency banner | MISSING | no "community" match in any app |
| Realtime | events | MISSING | nothing in `packages/realtime-contracts` or `packages/events` |
| Privacy | tenant-scoped incidents; card/SSN/bank blocked; phone/email/address redacted; identifier search refused; private S3 + SSE-AES256 + 5-min signed URLs (1-h cap) + audited; post can never deny service | DONE | repository `getIncident`; service 123-127; `evidence-blob-store.ts`; `communityPostMayDenyService()` false |
| Privacy | name detection, image redaction, access reason, anonymous shape | MISSING | — |
| Tests | 14 spec files (~180 cases), PGlite migration/service/subscribers/audit | DONE | `*.pgtest.vitest.spec.ts` |
| Tests | controller/API with real uppercase roles; duplicate-post, similar-incident, file redaction, e2e, perf, load | MISSING | this gap hides bug 1 |

## Bugs (all confirmed in code)
1. **Critical — role mapping.** `community.service.ts:22-31` switches on lowercase names; `req.ctx.role` is OWNER / MANAGER /
   FRONT_DESK / RECEPTION → every tenant user maps to "technician" (no capabilities): every write 403, feed always empty.
2. **Critical — moderator identity.** `mctx()` (controller 91-94) reads `req.user`, never set → `community_moderation_actions`
   inserts fail silently (NOT NULL actor), `lastModeratorFor` always null (no reviewer separation), appeal decide violates
   `ck_appeal_decided` and the error is swallowed (appeal stays "submitted" while an overturn restores the post).
3. **Fabricated case ids** `case-${id}` (controller 106,110,114,122,131) — not UUIDs, trail insert fails; no code creates
   `community_moderation_cases` rows.
4. **Status-check bypass:** `moderate()` hard-codes the start state `moderation_review` (service 203) → a draft/rejected/
   sensitive post can be published without re-scan; every publish sets `evidence_reviewed` (207).
5. **Dead end:** `sensitive_data_detected` has no edit/re-scan route and is not in the moderation queue.
6. **Evidence unusable** (no bytes, no scan); missing-storage error surfaces as HTTP 500.
7. **Phantom rows:** repository swallows errors and returns rows with id '' (`community.repository.ts:73-76,90,104,186,196,202,208,277`).
8. **Empty branchId** reaches UUID columns (`tctx`'s `?? null` misses '').
9. **Raw identifiers exposed:** feed/post/search/comment responses include other tenants' `originTenantId`, `originBranchId`, `createdByUserId`, `privacyScanFlags`.
10. Disputes label immediately with no moderation step and no rate limit; search rate limit never fires; evidence/disputes/appeals unlimited.
11. `managerApprovalRequired` ignored (`requiresApprovalBeforePublish` imported, unused); `notify_categories` never read.
12. Moderator remove too narrow (not from `published_multiple_reports`, `published_official_report`, `corrected`, `resolved`).
13. Stale docs: `SAFETY_COMMUNITY_PHASE1.md` cites `apps/api/src/tenant-safety-community/`; `API_INVENTORY.md:100-119`
    lists moderator routes under `/community/*`; `STATUS_CHECK.md:84` overstates ("Verified… holds up").

## Build order
1. Production-breaking bugs: uppercase role map (OWNER→owner, MANAGER→branch_manager, FRONT_DESK/RECEPTION→receptionist);
   moderator from `req.ctx.userId`; real create/open-case flow instead of `case-${id}`; empty branch → null; repo throws
   on failed writes; HTTP tests with real session roles.
2. Tenant settings API (enable, approvals, grants, display name, branch visibility, anonymous, notification prefs).
3. Workflow completion (my lists, update draft + re-scan, receptionist submit, edit published with versions, add update,
   resolve, dispute review/correct/restore, sensitive posts in the queue).
4. Safe response shape, pagination, sorting, full filters, name detection, DTO validation.
5. Evidence bytes (presigned upload), scanner call, redaction workflow.
6. Moderation endpoints + admin-web Moderation Center.
7. pos-web + owner-web Safety Community UI (fixes the deep link).
8. Threaded comments, follows, in-app/push, realtime.
9. Similar experience, related/duplicate detection, analytics, risk-matching store behind the flag, retention jobs, e2e/load.
