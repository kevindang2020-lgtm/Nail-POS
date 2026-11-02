# AI Business Setup — handoff (guide "AI PowerSalon AI Business Setup Complete Claude Build Guide", Oct 30 2026)

Route kept: `/tenant/ai/receptionist/business-setup` (AI Center sidebar, same shell). Built Oct 31 2026; committed locally, not pushed,
not deployed. Migration `753_ai_business_setup.sql` is applied to the local `aps` test template only.

## P0 — root cause of "Business hours configured / 0 services / 0 technicians" (guide §02)

| Item | Root cause found in code | Fix |
|---|---|---|
| **Services 0** | The old screen called `GET /pos/services` (answers `{ items, pagination }`) and read `r.services.length` — `undefined`, so it **always printed 0** whatever the catalog held. A false zero, not a data problem. | Readiness reads `services` server-side with the **same rule the AI and online booking use** (`CustomerBookingKyselyRepository.listServices`: tenant + branch-or-none + `status = 'active'`) and shows raw vs eligible counts with exclusion reasons. |
| **Business hours "configured"** | "Ready" was "any open day in `storeHours`" — but `VoiceBranchInfoService.storeHours` falls back to the **platform default week** when the salon never saved hours, so an unconfigured salon showed configured. | Readiness says **Needs setup** when the hours come from the platform default; FAILED for an invalid day; overnight days are a warning. |
| **Technicians 0** | The old count was Team Management's list (status-based, branch optional). The AI reads `technicians.is_active` + branch-or-none. Legacy rows can disagree (`status` vs `is_active`). Whether the photographed 0 was real cannot be proven without production access (**BLOCKED_EXTERNAL**). | Readiness shows raw (on file) vs eligible (what the AI offers), inactive / other-branch exclusions, the status-vs-active disagreement count, and qualified / scheduled counts — "0 on file" ≠ "0 available". |
| A failed query | — | **UNKNOWN** with a trace reference and Retry — never 0 (DATA06). |

Other findings (reported on screen, not changed — outside this guide):
- `services.online_booking_enabled` is read by **neither** the AI nor online booking (CustomerBooking `listServices` ignores it) — a service with online booking off is still offered. Shown as a readiness warning; fixing it belongs to Booking.
- Three hours sources exist: POS Settings store hours (what the AI is told), the staff booking grid's own 09:00–19:00 default (`booking-appointments` settings), and Super Admin `tenant_location_hours`. No new source was added; readiness warns when Super Admin location hours exist for the branch.
- **No holiday / special-closure schedule exists** anywhere in the schema → the AI cannot know about closures (warning on the hours row; NOT_IMPLEMENTED — needs an owner decision on where closures live).
- **Before this release no code served FAQs to the voice agent** (`ai_receptionist_faqs` was read only by its own service). The agent now reads them through `get_business_info` (approved revisions only).

## What was built

| Area | Status | Notes |
|---|---|---|
| Readiness (3 core rows + FAQs / Booking / Provider) | COMPLETED_AND_VERIFIED | `GET /pos/ai/business-setup/readiness`; source, branch scope, raw / eligible, exclusions, warnings, checked-at, trace id |
| Check Business Setup (one click) | COMPLETED_AND_VERIFIED | `GET …/health` — 10 checks (tenant/branch, hours, services, technicians, staff schedule, booking, approved FAQs, knowledge sync, agent knowledge, setup jobs); READY / NEEDS_SETUP / STALE / FAILED / DISABLED / UNKNOWN; non-mutating; provider never "ready" from a saved setting |
| FAQ workflow | COMPLETED_AND_VERIFIED | draft → pending_review → approved / needs_review / archived (`AI_RECEPTIONIST_FAQ`); append-only revisions + events; an edit of an approved FAQ is a **pending change** (live text unchanged until approved); version check + request key on every change; audit row in the same transaction |
| FAQ overlay | COMPLETED_AND_VERIFIED | Overview · Answer (live vs pending) · Revision history · Audit; Edit / Submit / Approve / Send back / Archive / Restore (ai.manage) / Close |
| Search + filters + dates + pages | COMPLETED_AND_VERIFIED | scopes FAQs · Services · Technicians · Knowledge tests · History; status / category / date basis (created / updated / approved; history: FAQ change / approval / preview); From/To month calendar (salon-day half-open, DST-safe); Previous 1 2 3 Next, 10/20/50, stable `(created_at desc, id desc)`; new FAQ first; search text never in the URL |
| Preview AI Knowledge | COMPLETED_AND_VERIFIED | `POST …/preview` — hours / price / qualified staff / booking / policy / FAQ intents from approved sources; lists sources; records a redacted run (phones / e-mails stripped); never books, holds, texts, calls or contacts a provider |
| Knowledge Assistant | COMPLETED_AND_VERIFIED | suggestions only (unsaved hours, missing price / duration, unqualified service, unqualified / unscheduled technician, FAQ coverage gaps, an approved answer quoting a price no service has, an FAQ waiting > 7 days); "Draft this FAQ" fills the **question only** — the owner writes the answer; nothing changes automatically. Suggestions are computed, not stored (accepting one creates a normal draft whose revision source is `assistant`). |
| Voice tool `get_business_info` | IMPLEMENTED_NOT_VERIFIED (live agent) | hours + **approved** FAQ revisions, read live per call (no copy to go stale). Server side tested; whether a live Retell agent has the tool registered is **BLOCKED_EXTERNAL** (health shows "Agent knowledge: Unknown/Off"). |
| Customer-linked AI history search (SEARCH04) | NOT_IMPLEMENTED | belongs to AI Calls (guide 22); no unrestricted customer search was added |
| Holiday / closure exceptions | NOT_IMPLEMENTED | no source exists (see findings) |

Permissions: read / preview / health / assistant = `ai.use`; create / edit / approve / reject / archive / restore = `ai.manage`
(owners and managers; **Front Desk holds `ai.use` only** — it reads and previews but cannot publish customer-facing answers).
Retired: the legacy `tenant/ai/receptionist/faqs` routes (GET/POST/PATCH/DELETE) and their four `posAiApi` methods — their only
caller was this screen; they wrote `is_active` directly and DELETE erased history. `AiFaqService` stays (DI position) but is unrouted.

Migration 753 backfill (conservative): every existing FAQ gets revision 1; an active one becomes **needs_review**, an inactive one
**archived** — nothing is published automatically (nothing served them before). Rollback: drop the three new tables; the added columns
are ignored by everything else.

## Files

- Migration: `apps/api/db/migrations/753_ai_business_setup.sql`
- Backend: `modules/ai/src/voice-booking/business-setup-center.ts`, `business-setup-center.controller.ts` (new);
  `voice-booking.module.ts`, `voice-booking.controller.ts` (`get_business_info` dispatch), `voice-tools.ts` (catalog),
  `tenant-receptionist.controller.ts` (legacy FAQ routes retired), `modules/ai/src/ai-lifecycles.ts` (`AI_RECEPTIONIST_FAQ`);
  `packages/api-contracts/src/errors.ts` (8 codes); `packages/database/src/kysely.types.ts` (patched)
- POS: `apps/pos-web/src/screens/POSAIBusinessSetupScreen.tsx` (rebuilt in place), `api/posAiBusinessSetupApi.ts` (new), `api/posAiApi.ts`
  (legacy FAQ methods removed), `i18n/ns/aisetup.{en,vi}.ts` (189 keys each), `ns/errors.{en,vi}.ts`, `ns/index.ts`, `styles.css`,
  `POSAIBusinessAndCalendar.test.tsx`
- Tests: `business-setup-center.pgtest.vitest.spec.ts`, `business-setup-faq.postgres-race.vitest.spec.ts`, `voice-tools.vitest.spec.ts`,
  `voice-booking.controller.vitest.spec.ts` (new case)
- Harness: `tooling/catalog-one-screen/bs-extra.mjs`, `interact-bs.mjs`; `live-server.mjs` / `interact.mjs` wiring; screenshots `results/bs-e2e/`
- Generated: openapi manifest, attack-surface docs, state vocabularies, ownership registry, actor columns, owner/tech error catalogs,
  `docs/UNIQUE_INDEX_TENANT_REVIEW.md` (one reviewed row: `uq_airr_no`, GLOBAL — parent)

## Tests (31 Oct 2026, local stand-in + PostgreSQL 16 + Chromium)

| Suite | Result |
|---|---|
| `business-setup-center.pgtest` (DATA01–09, FAQ01–08, SEARCH01–05, DATE04, PAGE01–03, SYNC01–06, SEC01/03/04) | **21/21** |
| `business-setup-faq.postgres-race` (4 sessions) | **3/3**; with the row lock removed **1/3** (mutation-checked) |
| `voice-tools` 3/3 · `ai-faq` 4/4 · `tenant-receptionist` 5/5 · `tenant-receptionist-audit` 3/3 · `tenant-isolation` 6/6 · `ai-receptionist-gateway` 19/19 | pass |
| `voice-booking.controller` | 12/13 — the failing `get_deals` case fails identically on unchanged HEAD (stand-in `vi.fn` has no `mockResolvedValueOnce`) |
| Browser `bs` (EN/VI, Front Desk, 4 viewports, no sideways scroll) | **10/10** |
| Combined browser run `seg,cp,do,promo,cc,mg,mt,cn,pm,bv,ms,eod,fuq,rmd,em,wb,bd,rf,rv,bs` | **212/212** (the known "not in the harness" page error after Open Booking) · `comms` 12/12 |
| Gates | 58/62 pass (52 npm + 6 stand-in); 4 can't run here: lint, boot, api-contract, strict-bodies-types |

## Not verified / blocked

- IMPLEMENTED_NOT_VERIFIED (needs CI): POS / API type-check; `POSAIBusinessAndCalendar.test.tsx`; the 4 gates above.
- BLOCKED_EXTERNAL: the real production counts behind the photographed zeros; a live Retell agent receiving `get_business_info`
  (provider account); migration 753 on staging / production (owner approval); the physical ASUS 27″ at 100% zoom (browser viewports only).
- Readiness / health text from the server is English in the Vietnamese POS (labels, statuses and reasons are translated).

## Hand-offs to the next AI guides

AI Receptionist / AI Calls / AI Front Desk / Reception Copilot / AI Calendar / AI Follow-Ups should read business knowledge through
`BusinessSetupCenter.knowledge(tenantId, branchId)` (or the `get_business_info` voice tool) and readiness through `readiness()` /
`health()` — never a copy. AI Calls owns customer-linked call-history search (SEARCH04). Holiday closures need a canonical source first.

## Open owner decisions

1. Where should holiday / special closures live (no source exists)? The AI cannot mention closures until one does.
2. Should the booking engine respect `online_booking_enabled` (today the AI and online booking offer such services)?
3. The backfilled FAQs are "Needs review" — approve the old answers one by one, or bulk-approve?
4. Which of the three hours sources is canonical for the AI going forward (today: POS Settings store hours)?
