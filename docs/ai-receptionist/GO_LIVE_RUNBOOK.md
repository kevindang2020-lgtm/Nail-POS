# AI Receptionist — Go-Live Runbook (Retell + Twilio wiring)

The gateway code is complete and verified. Everything below is account setup + configuration you perform; there is no
more code to write for a basic pilot. Steps are ordered; do them in a test environment first (Stage 1–2), then one
pilot salon (Stage 3).

## 0. Prerequisites you provide
- A **Twilio** account with a purchased phone number for the salon (A2P/number compliance as your region requires).
- A **Retell AI** account and an agent you can attach custom functions to.
- Your API deployed and reachable over HTTPS (Retell calls it directly).

## 1. Set the salon's transfer number (handoff destination)
The gateway derives the human-transfer number server-side — it is NEVER taken from Retell. It reads, in order:
1. POS Settings → **Business & Branch** → Phone (stored in `tenant_settings` category `business_branch`), then
2. the branch record's `phone` column as a fallback.
Set the Business & Branch phone for the pilot branch to the number Retell should transfer callers to. If neither is
set, `handoff` still succeeds but returns `callbackRequested` instead of a live transfer (honest, not a failure).

## 2. Issue a scoped API key
Super Admin → **AI Receptionist** → Integration keys → Issue (select the pilot tenant + branch, environment `live`).
The raw `vk_live_…` value is shown **once** — copy it now; only its SHA-256 is stored. One key = one tenant + branch.

## 3. Configure environment
On the API service:
- `VOICE_WRITE_TOOLS_ENABLED=true`   ← arms book/reschedule/cancel + customer creation. Leave unset/false to run
  read-only (mutations return HUMAN_HANDOFF_REQUIRED and Retell hands off).
- `RETELL_WEBHOOK_SIGNING_KEY=<from Retell>`   ← enables origin signature verification on the legacy webhook surface.
- Optional: `VOICE_VERIFICATION_MODE=phone_name` (default `phone`) for stricter caller verification on
  reschedule/cancel; `VOICE_GATEWAY_READ_LIMIT_PER_MIN` / `VOICE_GATEWAY_WRITE_LIMIT_PER_MIN` (defaults 240 / 60);
  `BOOKING_BUFFER_MINUTES` (default 5 — the gap between appointments the availability grid now honors; set 0 to
  disable).

## 4. Wire Retell functions
Create the nine custom functions from `docs/ai-receptionist/retell-functions.json`. For each:
- URL = `https://<your-api-host>` + the function's `endpoint.path` (replace `{appointmentId}` with Retell's variable).
- Method = the function's `endpoint.method`.
- Header `X-Voice-Key: vk_live_…` (the key from step 2).
- On the six mutations, add header `Idempotency-Key` = Retell's unique tool-invocation id (prevents double-booking on
  retries).
Paste `docs/ai-receptionist/RETELL_AGENT_PROMPT.md` into the agent's system prompt.

## 5. Point the phone number at Retell
In Twilio, route the salon's number to your Retell agent (Retell provides the SIP/voice webhook target). Place a test
call.

## 6. Verify the pilot (watch while you test)
- Super Admin → AI Receptionist → **Gateway health**: requests, success %, idempotent replays, rate-limit hits,
  handoffs, errors-by-code (in-process, since server start).
- **Call analytics** + **Recent calls**: per-call booking/handoff/intent outcomes.
- Book a test appointment by phone → confirm it appears on the POS Booking screen with source = AI.
- Test reschedule, cancel, and a "let me talk to a person" handoff (confirm it transfers to the step-1 number).

## 7. Rollback (any time, no deploy)
- Disable mutations: `VOICE_WRITE_TOOLS_ENABLED=false` → book/reschedule/cancel return HUMAN_HANDOFF_REQUIRED; reads
  and handoff stay live.
- Disable one salon: revoke its key in the admin screen (immediate).
- Rotate a key: issue a new one, switch Retell's header, revoke the old (two keys can be live during the switch).

## Known limitations (unchanged from Phase 1)
Rate limiter and gateway-health counters are in-process (single-instance); a multi-instance deployment needs a shared
store. The POS booking buffer comes from tenant settings (`bufferMinutes`, default 5) while the customer/voice
availability buffer comes from `BOOKING_BUFFER_MINUTES` (default 5) — aligned by default, but if you customize a
tenant's POS buffer, set the env to match (the two config sources aren't unified). No live phone agent is included —
that's this runbook.
