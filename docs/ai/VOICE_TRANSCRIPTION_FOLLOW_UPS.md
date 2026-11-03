# Voice Transcription Follow-Ups — implementation report (guide 19, Nov 2 2026)

Route: `/tenant/ai/voice-transcription/unresolved` (POS, EN/VI). Extraction: `ai-voice-transcription-intelligence.ts`.
Tasks: the **one** task system, `ai_receptionist_follow_ups` with migration 759 and the AI Follow-Ups & Human Handoff
Center at `/tenant/ai/receptionist/follow-ups`. This page does not create a second task system.

## Audit

| Area | State | Evidence |
|---|---|---|
| Extraction of callback, manager, health / safety, refund, complaint and unanswered-pricing items from redacted text | Verified | `detectUnresolved` with intelligence specs |
| Task system: assignment, due dates, contact attempts, escalation, resolution, audit | Verified (in the follow-up center) | `ai-follow-up-center.ts`, migration 759 |
| The page acting on an item | **Missing → built** | No action existed; an item could never leave "open" |
| Priority order | **Broken → fixed** | The 100 newest calls were taken first and sorted after; older urgent calls never showed |
| Branch scope | **Broken → fixed** | A branch user saw the whole salon |
| Empty state | **Broken → fixed** | "Every call is resolved" really meant "nothing was flagged" |
| Search, dates, pages, health check | **Missing → built** | — |

## What was built

**Migration 775: `voice_followup_reviews`.**
- It records the staff decision on each extracted item (call + type). Decisions are `task_created`, `dismissed` or `reopened`.
- It is append-only: the newest row is the current decision, and earlier rows are never rewritten.
- Database checks enforce the rules: a task decision must carry its task id, and a dismissal or reopen must carry a reason.

**`/pos/ai-voice-transcription/follow-ups/*`**

Viewing needs `ai_voice_transcription.view_transcripts`. Acting on an item also needs `communications.manage` or `ai.manage`.

- **`summary`**
  - Counters, each with its definition:
    - open
    - urgent: health / safety or high priority
    - in a task
    - task overdue
    - resolved in the last 30 days
  - Pipeline state: calls, processing, errors in the last 24 hours, calls not yet checked for items.
  - **`emptyReason`**: `no_calls`, `processing`, `pipeline_errors` or `none_open`. "Every call is resolved" is shown only for `none_open`.
  - The urgent lane: health / safety first, then oldest first.
- **`items`**
  - One row per call and item.
  - Tabs: Open, In task, Resolved, All.
  - Search by call ID, item type or assignee. Customer name and phone are searchable only with `customers.view`.
  - Filters: type, and which date the range applies to (call, decision or due).
  - Date presets, or a From/To range in salon time.
  - Sort: newest, priority or oldest. Priority covers **all** calls.
  - Pages: 10, 25, 50 or 100 rows.
  - Scope: this branch plus salon-wide items.
- **`items/task`** — creates a task in the task system, all in one transaction:
  - The reason is mapped to the board's own vocabulary:

    | Item | Task reason |
    |---|---|
    | callback | `CALLBACK` |
    | manager | `CUSTOMER_REQUESTED_HUMAN` |
    | health / safety | `MEDICAL_OR_SAFETY_CONCERN` |
    | refund | `REFUND_REQUEST` |
    | complaint | `COMPLAINT` |
    | pricing | `PRICING_REQUIRES_SALON` |

  - Priority: health / safety is always urgent. You can also set an assignee (active staff in this branch), a due date and a note.
  - The same transaction writes the activity row, a strict audit event and the review row.
  - It is idempotent. If an open task already exists for the same call and reason (for example, one the AI receptionist created), the item is **linked** to that task, never duplicated.
  - Nothing is called, texted, booked or refunded.
- **`items/dismiss`** and **`items/reopen`** — each needs a reason. Dismiss works only on an open item; reopen only on a resolved one.
- **`items/history`** — the item's append-only list of decisions.
- **`check`** (Check Voice Follow-Up System) — read-only. It runs at most once every 30 seconds, and each run is stored in `voice_followup_health_runs`. It checks:
  - calls arriving
  - transcription errors
  - processing backlog
  - extraction ran
  - **urgent items reviewed within a day**
  - tasks on time
  - task links intact
  - no duplicate tasks
  - tasks assigned
  - dismissals explained
  - tenant isolation
  - no side effects

**Retired:** `GET /pos/ai-voice-transcription/unresolved`. Its client method was removed, which is pinned in the screen test. The route is listed on the unreached-routes ledger. The service method stays for its existing spec.

**POS** (all strings are `vfx.*`, EN and VI):
- The title and description are kept.
- New on the page:
  - a safety note;
  - five counters, each opening its tab;
  - pipeline chips;
  - the urgent lane;
  - the tabs, search, filters, presets with the month calendar, and pages.
- Each row shows the customer (masked phone), the item with its priority, and its status, including the task status, assignee, due date and an overdue mark.
- Row actions: View call, Create task, Dismiss, Open task (goes to the board), Reopen, History.
- Dialogs:
  - Create task: priority, due date, assignee from the board's staff list, note.
  - Dismiss and Reopen: reason required.
- The empty state explains why it is empty.

## Tests

- **`voice-followups-center.pgtest.vitest.spec.ts`** — 10 tests on the real schema. They cover:
  - the empty-state reasons;
  - counters and the urgent lane;
  - scope and priority sort across all calls;
  - search with customer gating, type, dates and an invalid range;
  - creating a task (mapping, assignee check, activity and audit rows, idempotency);
  - linking to an existing receptionist task instead of duplicating it;
  - a task resolved on the board resolving the item, and reopen with a reason;
  - dismissal rules and history;
  - the health check (stale urgent item, read-only, reuse).

  Sabotage checks: removing the link-instead-of-duplicate rule, or the empty-state reasons, turns tests red.
- **`POSAIVoiceTranscription.test.tsx`** — the Follow-ups tests were rewritten for the review queue (the old list test asserted the retired shape). They cover:
  - counters, the urgent lane and the rows;
  - the exact task body;
  - dismissal requires a reason;
  - the empty state's reason;
  - tabs, search and the check;
  - Vietnamese;
  - the retired client method.

## Left for a decision

- **Drafting a message** from this page. Texting runs through the task board's Reception Copilot path: prepare, confirm, verify. It was not duplicated here.
- **Linking or matching a caller to a customer.** Transcripts carry `customer_id` only when the call already matched one. Matching by phone belongs to Customer Management and was not added.
