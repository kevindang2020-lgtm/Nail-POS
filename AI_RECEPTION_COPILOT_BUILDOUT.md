# AI Reception Copilot — Full-Spec Buildout (progress)

Closing the full 59-section spec's remaining scope, in priority order. Each item is a real, tested slice.

## #1 — Data model + permission matrix (§37 / §45) ✅ DONE

**Data model (§37):** migration 316 adds `reception_copilot_sessions` (a receptionist working session) and
`reception_copilot_recommendations` (recommendations shown, referenceable by feedback). `ReceptionCopilotSessionService`
provides startSession / endSession / recordRecommendation / markActedOn / listRecommendations — all tenant/branch-scoped,
advisory-only (the authoritative appointment stays in `appointments`), null-DB safe. Endpoints:
`POST /tenant/ai/center/copilot/session/{start,end}`, `POST .../copilot/recommendation`, `GET .../copilot/recommendations`.

**Permission matrix (§45):** 18 `reception_copilot.*` permissions registered in RBAC (use, view_customer_context,
view_queue, view_recommendations, view_ai_phone_activity, explain_services, suggest_waitlist, draft_messages,
create/reschedule/cancel_appointment, send_message, take_over_calls, give_feedback, manage_settings, view_learning,
approve_learning, view_usage). Granted: ops perms → RECEPTION / FRONT_DESK / MANAGER / OWNER; management perms →
MANAGER / OWNER. **Enforcement:** the Copilot action spine now requires the matching `reception_copilot.<action>`
permission IN ADDITION to the existing domain permission (`pos.booking.*`) — high-risk actions require BOTH.

**Verified:** real-PG `RC_DATA_OK` (session + recommendation persistence, tenant-isolated, acted-on + ended); new
permission-denied test (domain perm without Copilot perm → PERMISSION_DENIED, no write); api **2991/2991**, tsc 0,
build clean, migrations 314–316 in sequence.

## #2 — Feedback capture (§44) ✅ DONE
Migration 317 `reception_copilot_feedback` (upsert: one latest rating per recommendation, references migration 316).
`ReceptionCopilotFeedbackService.recordFeedback` (requires `reception_copilot.give_feedback`; ratings helpful/
not_helpful/dismissed + optional reason) and `.summary` (requires `view_usage`/`manage_settings`; helpful rate +
per-recommendation-kind breakdown, bounded window). Endpoints `POST .../copilot/feedback`,
`GET .../copilot/feedback/summary`. Verified: 4 unit tests (permission gate on record + summary, rating validation) +
real-PG `RC_FEEDBACK_OK` (upsert re-rating, byKind join). api **2996/2996**, migrations 315–317 in sequence.

## #3 — Full settings + Super Admin observability (§47 / §46) ✅ DONE
**Settings (§47):** expanded CopilotSettings from 6 to 11 toggles — added `allowDrafting`, `showCustomerHistory`,
`allowAiPhoneActivity`, `allowExplainServices`, `allowWaitlist`. Each gates a REAL capability (not decorative): the
assist service now checks its toggle before surfacing AI-phone activity / explaining a service / suggesting waitlist
(default allow when settings absent). All 11 are settable in the POS Copilot settings UI.
**Observability (§46):** `GET /super-admin/copilot/system-status` reports platform Copilot health — configured AI
provider (→ drafts AI-polished vs template), data-model readiness, confirm-gated action spine — alongside the existing
cross-tenant usage summary.
**Verified:** 3 new gate tests (each toggle off → capability disabled) + settings overlay; api **2999/2999**, pos-web
**325/325**, both builds clean.

## #4 — Learning / knowledge versioning (§36) ✅ DONE
Migration 318 adds `reception_copilot_learning_suggestions` + `reception_copilot_knowledge_versions` (per-tenant
monotonic version). `ReceptionCopilotLearningService` turns the feedback rollup (#2, reused via a permission-free
`rollup`) into human-reviewable suggestions (kind rated not-helpful ≥50% over ≥3 ratings → one open suggestion, no
duplicates), and records manager-approved adjustments as versioned knowledge. Two safety rules enforced structurally:
(1) tenant isolation — suggestions come ONLY from this tenant's feedback, all reads/writes tenant-scoped; (2) no silent
production change — generating changes nothing; a manager with `reception_copilot.approve_learning` must approve, which
writes an auditable knowledge VERSION (it does not auto-mutate live behavior). Endpoints: `POST .../copilot/learning/
{generate,approve,dismiss}`, `GET .../copilot/learning/{suggestions,knowledge}`. Verified: 3 unit tests (view vs
approve permission gates) + real-PG `RC_LEARNING_OK` (feedback→suggestion→approve→knowledge v1, other tenant sees none).

## Buildout complete
All four prioritized items done. Copilot now has: dedicated data model + permission matrix (#1), feedback capture (#2),
full settings + observability (#3), and the learning/knowledge-versioning loop (#4). Final: api **3002/3002**, pos-web
**325/325**, migrations 316–318 in sequence, all real-PG proofs green (RC_DATA_OK, RC_FEEDBACK_OK, RC_LEARNING_OK).

## #5 — Accessibility pass on the Copilot panels (§54) ✅ DONE
The new Copilot panels now meet the §54 frontend-quality bar: each is a labelled `role="region"`; async/loading content
is in `aria-live="polite"` regions with `aria-busy`; the service picker is `aria-labelledby` its heading; status badges
(Handed off / Follow-up) and next-action chips carry `aria-label`; next actions use `role="list"`/`listitem`; headings
are semantic `<h3>`; and a style block adds visible `:focus-visible` outlines plus `prefers-reduced-motion` handling.
Verified: new a11y test asserts labelled regions + a screen-reader-labelled select; pos-web **326/326**, build + lint
clean. (App-wide a11y across every POS screen remains a broader, separate effort.)

### Still genuinely out of scope (unchanged, honest)
- Live telephony call-transfer (§24/§32) — provider-gated (Retell/Twilio call-control).
- Redis session/live-call state (§38) and load tests (§53) — need infra decisions / a load harness.

## Full verification (this pass)
api tsc 0 · **3002/3002** tests · 0 lint errors · build clean. pos-web tsc 0 · **326/326** · build clean.
admin-web tsc 0 · build clean. Migrations 316–318 apply fresh in sequence. Real-PG proofs: RC_DATA_OK, RC_FEEDBACK_OK,
RC_LEARNING_OK, AIPHONE_ACTIVITY_OK.
