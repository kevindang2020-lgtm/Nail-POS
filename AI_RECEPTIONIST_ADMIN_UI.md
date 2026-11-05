# AI Receptionist — admin UI (2026-07-03)

Built the Super Admin → AI Receptionist screen in admin-web, wired to the real `/super-admin/voice/*` endpoints. This is
the human-facing surface that makes the whole backend operable. Honest verification note: a UI can't get the
real-Postgres-level proof the backends got — it's validated by typecheck + build + component tests, not live-DB runs.

## What was built
`admin-web/src/screens/AiReceptionistScreen.tsx` + `superAdminVoiceApi.ts`, registered at `/ai-receptionist` under
AI & Automation. Three real sections:
1. **Integration keys** — issue (raw key shown ONCE with a "copy now, won't be shown again" banner), list (prefix +
   status only — the secret hash never reaches the browser), revoke.
2. **Recent calls** — the real call-outcome store: started, booking/handoff outcome, intents, tool count (+ failures),
   follow-up. A note states transcripts/recordings are retention-governed and not shown.
3. **Learning review** — open suggestions with Approve/Reject, the active prompt version + Roll back. Approving prompts
   for the new prompt text and states plainly it drafts a version that "never goes live until you activate it" —
   the human-approval gate surfaced in the UI, not just the API.

## Design
Follows the existing cream/gold system (tokens `--g7`/`--line`/`--card`, Playfair Display headings), mirrors the
AiHandoffsScreen conventions (inline-styled panels, status pills, em-dash for missing data). Empty states are
directional ("No keys yet. Issue one to connect a voice provider."), errors speak in the interface's voice.

## Verification
- admin-web typecheck 0; lint 0 (new files); **admin-web build clean**; **admin-web suite 721/721 across 119 files**
  (+6 for the new screen test: tenant-gated load, honest empty states, raw-key-once display, required-field validation,
  approval-drafts safeguard copy).
- Caveat: no live-DB verification is possible for a frontend; the API layer beneath it is separately proven
  (2675 api tests, real-Postgres). The screen consumes only real endpoints — no mocked/fabricated data in the product.

## Files created / changed
- NEW `admin-web/src/screens/AiReceptionistScreen.tsx` (+ `.test.tsx`), `admin-web/src/api/superAdminVoiceApi.ts`
- CHANGED `admin-web/src/App.tsx` (route), `admin-web/src/shell/AdminLayout.tsx` (nav link)

## Receptionist status — end to end now operable
Backend spine + admin UI complete, all with no external account:
audit → read gateway (callable) → key auth → provider port + Retell adapter → pilot-safe write path (dark) →
call-outcome store → human-approved learning loop → admin API → **admin UI**.
A human can now issue a voice key, review calls, and approve learning changes from the admin app.

## Remaining (all gated on you)
- Decision-gated: reschedule/cancel policy + caller verification; consent-gated customer creation; recording retention +
  legal review.
- Account-gated: Retell + Twilio + LLM keys → then `VOICE_WRITE_TOOLS_ENABLED=true` and point an agent at `/voice/tool`.
- Optional: a provider-config store/UI (agent name/voice/phone) — most fields only meaningful once Retell exists.

## Rollback
Additive: new screen + api client + one route + one nav line. Revert those to remove; no backend or schema change.
