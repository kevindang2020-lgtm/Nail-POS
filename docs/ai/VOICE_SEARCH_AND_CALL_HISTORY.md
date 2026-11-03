# Voice Transcription — Search + Call History (guides of Nov 1 2026, built Nov 3 2026)

Routes: `/tenant/ai/voice-transcription/search` and `/tenant/ai/voice-transcription/history`. The two guides share their
requirements (health check, details + follow-ups, search / calendars / pages), so both pages now use one read-only center.

## Audit findings

| Area | Was | Finding |
|---|---|---|
| Search | `GET transcripts/search` | Keyword only, the 50 newest matches, no total, no pages, no dates, no phone or customer search. The branch came from the browser's query, so a branch login could search the whole salon. |
| Call History | `GET transcripts` | Status + Direction, cursor "load more", branch from the browser, no search, no dates. One empty message for every case. |
| Details | `GET transcripts/:id` (+ intelligence, raw, summary) | **Bug:** looked up by tenant only — a branch login could open any call of the salon by its id. |
| Health check | — | None for the pipeline (the settings page has its own settings check; follow-ups has its own). |
| Phone search | — | Calls carry no caller number; phone search goes through the linked customer only (and only with `customers.view`). The caller is never guessed from a number. |
| Index | — | Search reads the live redacted tables (no separate index), so there is no index lag to report. |

## What was built

`/pos/ai-voice-transcription/calls/*` (`voice-calls-center.ts`, `voice-calls-center.controller.ts`), permission
`ai_voice_transcription.view_transcripts`; the branch is always the server's (a branch login sees its branch + salon-wide calls).

- `GET summary` — calls, last 7 days, still processing, failed (7 days), not transcribed; why a page is empty (`no_calls`,
  `disabled`).
- `GET /` — search: redacted transcript text (all words), summary, intent, call ID / provider call ID, and with `customers.view`
  the linked customer's name and phone digits. Each row says what matched and shows a redacted excerpt, **re-redacted** before it
  leaves the server (a second guard; raw text is never read). Filters: call status group (transcribed · processing · needs review
  · failed · not transcribed — never confused with whether a summary exists), direction, language, what the caller wanted
  (intent), follow-up state (open · in a task · resolved · none). Which date: call · summary · follow-up decision. Presets +
  From/To in salon time (half-open UTC bounds). Sort newest / oldest / best match. Numbered pages 10/25/50/100.
- `GET detail?id=` — the overlay: header, the redacted transcript in order with speakers and unclear-speech marks, summary with
  its time, **what the caller asked for marked "requested — not a booking"**, the follow-up items with their review state and task,
  the customer link (linked / none). Every open is audited (`voice_transcript.viewed`, no transcript text in the audit row).
- `POST check` — **Check Voice Transcription System** (migration 777 `voice_system_health_runs`): provider key, calls arriving,
  calls without a branch in a multi-branch salon, consent skips, transcription jobs (failed / stuck), redaction finished,
  **card-number-shaped digits left in text search reads**, summaries made, customer matching, customer links valid, search
  freshness (live tables), deleted calls with text or summaries left, tenant isolation, no side effects. Each says its part and
  when it last passed. Reuses a run from the last 30 seconds.
- Fixed: the old detail, intelligence, raw-access, summary and delete routes are branch-scoped (not found outside the branch);
  the old list / search pin a branch login to its branch whatever the query says, including salon-wide calls.
- POS: Search and Call History are one `VoiceCallsWorkspace`: the original titles, privacy line, search box and "Enter a search
  term to find calls." stay; counters, filters, calendars, pages, the details overlay (Close keeps filters and page), the check
  (EN/VI `vcx.*`). The old client `list` / `search` are removed (pinned); `GET transcripts` is on the unreached ledger.

Not built (decisions): playback / export of recordings (no recording URLs are stored); semantic / AI search (the guide makes it
optional; basic search needs no AI call); drafting a follow-up message from Search (the Follow-Ups page owns tasks; Communications
owns sending).

## Tests

- `voice-calls-center.pgtest.vitest.spec.ts` 14/14 on the real schema (empty reasons, permission, scope incl. salon-wide calls,
  every search source, raw text never matched, no names / phones without `customers.view`, filters, dates, pages, re-redaction,
  overlay + audit, old routes branch-scoped, the check incl. leak / redaction / deletion failures and reuse). Voice suite 116 passed.
- POS `POSAIVoiceTranscription.test.tsx` 20/20.
