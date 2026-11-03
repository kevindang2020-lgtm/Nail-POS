# Review & Reputation Settings (POS) — Nov 2 2026

Guide: *Review & Reputation Settings* (Kevin, Nov 1 2026). Route: `/tenant/ai/reputation/settings` (unchanged).

## Audit findings (before the build)

| Area | Status | Finding |
|---|---|---|
| Settings read | **Broken (fail-open)** | `KyselySettings.load` did `.catch(() => [])`: a database error read as "platform defaults", i.e. the assistant **enabled past the salon's Disable**. |
| Save | **Broken** | `PUT /pos/ai-review-reputation/settings` swallowed every error (the screen showed "Saved" for a save that never happened), had no version check (last write wins) and its history insert was fire-and-forget. |
| Assistant switch | **Broken** | AI drafting never looked at the switch — a disabled assistant still drafted. |
| Approval vs auto-reply | **Unsafe** | The automatic-reply gate never consulted "Require approval before publishing"; both could be saved on together. (Nothing calls the automatic-reply path today, so no reply was ever auto-published.) |
| Require approval OFF | Partial | Has no effect: publishing always requires an approved draft. Safe, but the screen implied otherwise. |
| Review requests | Partial | Checkout schedules requests (consent, contact, cooldown, frequency cap, never by rating), but **no sender delivers them** — `sendDue` has no caller. |
| Quiet hours | **Bug** | Computed on the server clock, not the salon's: on a UTC host 21:00–09:00 meant 5 pm–5 am in New York. |
| Send one reminder | Missing | Saved, but no reminder sender exists. |
| Screen | Partial | Raw tone / channel codes, no sources, no history, no health check, no unsaved-changes guard. |

## What was built

- **Fail-closed settings read**; drafting refuses with `ASSISTANT_DISABLED` when the salon or branch turned the assistant off.
- **Approval wins**: `autoResponseDecision` denies with `approval_required`; the settings center refuses to save both on (`RSS_POLICY_CONFLICT`).
- **Salon-time quiet hours**: `computeSendTime(…, timeZone)`; the checkout hook passes the branch's zone (DST-safe).
- **`/pos/reputation-settings/*`** (old `GET` / `PUT settings` routes and client methods retired, pinned in `reputation-routes.vitest.spec.ts`):
  - `GET state` — the eight controls with effective value, default and source (Default / This salon / This branch, invalid stored values flagged);
    the assistant's operational state; package + subscription from the AI entitlement gate; the salon's SMS sender (status only, never
    secrets); review providers; the request safeguards (read-only); and **what actually runs** (approval always enforced, automatic
    replies not running, requests scheduled but not sent, reminder not built, settings read live).
  - `POST save` — existing manage permission; salon level; validated (tone list, channel sms/email/app, delay 0–10080 min); merges;
    version-checked (`RSS_STALE_VERSION`); one transaction writes the row, the History row and a fail-closed audit.
  - `GET history` (+ `/:id`) — search, type, presets + From/To calendar, pages of 10/25/50/100, newest first; before → after per control.
  - `POST check` — Check Reputation Settings, read-only, one run per salon per 30 s.
- **History = the existing `ai_reputation_config_versions`** (no second log): migration 769 adds event type, before, changed keys, reason,
  role, and makes it append-only.
- **POS screen** rebuilt in place: title, description, Save Changes and the eight controls with their labels and help text stay. Added the
  status strip, source chips, "what runs" notes, unsaved-changes marker + Discard + leave warning, a confirmation listing each change,
  History and System Health tabs. EN/VI (`rssx.*`, 196 keys; VI pending native review).
- The settings center is **not** behind the AI package gate on purpose: an unpaid salon must still see why the assistant is blocked.

## Tests

- `reputation-settings-center.pgtest.vitest.spec.ts` 12/12 · `reputation-routes.vitest.spec.ts` 4/4 · requests (quiet hours in the salon's zone, DST) 5/5 ·
  reputation suite 71/71 · request-schemas 101/101.
- `POSAIReviewReputationSettingsScreen.test.tsx` 7/7.
- Sabotage: removing the conflict refusal, replacing the merge with an overwrite, sending the whole form instead of the changes, and
  dropping the screen's conflict guard were each caught.

## Decisions for Kevin

- Automatic replies: build the job that runs them (approval OFF + clean 5-star only), or remove the control?
- Review requests: build the sender (consent, quiet hours, frequency cap, salon Twilio) and the one-reminder sender, or keep them off?
