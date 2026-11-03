# Voice Transcription Settings — implementation report (guide 18, Nov 2 2026)

Route: `/tenant/ai/voice-transcription/settings` (POS, EN/VI). Module: `modules/ai/src/ai-voice-transcription` (migrations
328–331). This page sets the transcription policy. Calls belong to the voice integration. Transcripts are shown in Call
History and Voice Search. Follow-ups are their own workflow.

## Audit

| Area | State | Evidence |
|---|---|---|
| Redaction always on, applied before storage, search, AI or export | Verified | `ai-voice-transcription-redaction.ts`, stateful verification-code scrub, redaction specs |
| Consent gates transcription (missing or declined → header only, no segments) | Verified | `blockedStatusForConsent`, `ingest` |
| Raw text gated by `view_raw` | Verified | `getRawTranscript` |
| Retention sweep: erases from the store and the provider, idempotent, skips legal holds | Verified (worker is **off by default**: `VOICE_RETENTION_SWEEP_CRON_ENABLED`) | `runRetentionSweep`, scheduler |
| Settings read during ingest | **Broken → fixed** | Failed open |
| Retention window applied to stored calls | **Broken → fixed** | Only new calls got the new window |
| Raw text OFF | **Broken → fixed** | Existing raw text stayed readable |
| Raw-text views logged | **Missing → built** | No trace at all |
| Versioned saves, sensitive-change confirmation, history | **Missing → built** | — |
| Status from real rows, Records, health check | **Missing → built** | — |

## Defects fixed

1. **Ingest failed open.** `getSettings().catch(() => null)` fell back to the environment defaults when the settings row could not be read. A salon that had switched transcription off, or raw text off, was then transcribed on defaults. Now the ingest returns 503 `VT_SETTINGS_UNAVAILABLE`, the provider redelivers, and nothing is stored.
2. **The retention window did not apply to stored calls.** `retention_expires_at` was fixed when each call was ingested. If the window changed from 365 to 30 days, the screen showed 30 days while older calls stayed for 365. Now any change to the window re-dates every live transcript (`created_at + window`) in the same transaction as the save.
3. **Raw text OFF left existing raw text in place.** It stayed readable to anyone with `view_raw`. Now turning raw text off purges stored raw text (segments `raw_text = null`, `raw_available = false`) for every transcript not on legal hold.
4. **Raw-text views left no trace.** Every view is now written to `voice_transcript_access_events` **before** the text is returned. If that write fails, the view is refused.
5. **Saves had no protection.** There was no version check, no confirmation and no history.
   - `expectedVersion` now refuses a stale save with 409 `VT_SETTINGS_VERSION_CONFLICT`.
   - A **sensitive** change returns 409 `VT_CONFIRM_REQUIRED` with its impact, unless the request carries `confirm: true`. Sensitive changes are:
     - a shorter retention window;
     - raw text on;
     - raw text off;
     - transcription off.
   - The impact reports:
     - how many transcripts get a new deletion date;
     - how many are already past the new window;
     - how much raw text would be purged.
   - Every save appends a before → after row with its impact to `voice_transcription_settings_history`.
   - The announcement version must match `[A-Za-z0-9._-]{1,64}`.

## What was added

`/pos/ai-voice-transcription/center/*` is read-only and needs `ai_voice_transcription.view`. It is not behind the entitlement check.

- **`GET summary`** — every figure below is computed from stored rows, not from the form:
  - the saved policy and its version, and the entitlement;
  - transcription: state, last call processed, and a 30-day breakdown (transcribed, blocked by consent, policy off, failed);
  - redaction: always on, plus counts of failed and stuck redactions;
  - raw text: whether it is retained and how many calls hold it;
  - retention: overdue deletions, next due date, legal holds, the last deletion, 30-day deletions and how many lack provider confirmation, and whether the deletion job runs on this server;
  - consent: which announcement versions calls actually played, and how many differ from the saved version.
- **`GET records`** — one list, newest first, of:
  - settings changes;
  - deletions, with provider confirmation;
  - processing failures;
  - raw-text views.

  You can filter by kind, search, use date presets or a From/To range, and page through results. It never selects transcript text or customer identity. Customer call lookup stays in Voice Search.
- **`POST check`** — Check Voice Transcription Settings. It is read-only, runs at most once every 30 seconds per salon, and stores each run in `voice_settings_health_runs`. It checks:
  - settings readable
  - subscription
  - provider: the mock provider counts as "not configured"
  - transcription pipeline
  - redaction
  - **raw text matches the policy**
  - no hidden raw text
  - deletion dates match the window
  - **deletions on time**: anything overdue means the deletion job is not running
  - provider deletion confirmed
  - legal holds respected
  - announcement version
  - **nothing stored without consent**
  - settings history
  - tenant isolation
  - no side effects

**Migration 774:**
- adds `version` to the settings table;
- creates the history table;
- creates the access-events table;
- creates the health-runs table.

**POS:**
- The four controls and the Save button are kept.
- Redaction is shown as "Always on", with an explanation.
- A save sends only the changed fields and the version it read.
- A confirmation dialog shows the impact of a sensitive change.
- The page shows the version saved and the number of unsaved changes.
- A status row of four KPIs shows the real state. Next to it, a status panel shows the 30-day numbers, deletions, legal holds and the consent versions actually used, with links to Call History, Voice Search and Follow-ups.
- Records and Check Voice Transcription Settings appear on the page.
- All new text uses `vsx.*` keys, in English and Vietnamese.

## Tests

- `voice-settings-center.pgtest.vitest.spec.ts` — 11 tests on the real schema. They cover:
  - versions and stale saves;
  - confirmation and the impact it reports;
  - re-dating every live transcript (another salon's transcripts are untouched);
  - raw purge that keeps legal holds;
  - history rows;
  - fail-closed ingest;
  - raw-access logging, and refusal when the log write fails;
  - the status row from real rows;
  - Records (kinds, search, pages, no transcript text);
  - health failures, reuse, and refusal of text stored without consent.

  Sabotage checks: removing the re-dating, the confirmation, the access log or the fail-closed read each turns tests red.
- The existing settings spec was updated to the new behaviour: sensitive changes need `confirm`, and a version-conflict test was added. The module suite passes: 10 files, 93 tests.
- `POSAIVoiceTranscription.test.tsx` — the Settings tests were rewritten. They cover changed-field saves, the confirm flow, a stale save, the status row, Records, the check, and Vietnamese.

## Left for a decision

- **The retention deletion job is off by default** (`VOICE_RETENTION_SWEEP_CRON_ENABLED`). Overdue deletions now show as FAILED in the check. Should it be on in production on the AI worker?
- **GET and PUT settings sit behind the entitlement check** (`assertEnabled`). A salon whose subscription lapsed cannot change its retention window or turn raw text off. The read side, Records and the check stay available. Should saving settings be exempt?
- **Provider-side deletion** is attempted for each erasure and recorded as confirmed or not. There is no retry queue yet for unconfirmed provider deletions; they appear in the status panel and the check.
