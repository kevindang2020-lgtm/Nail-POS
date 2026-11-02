# AI Receptionist — Provider Integration Spec (implementation-ready)

This is the plan for the four provider-live screens that cannot be *truly* built until the Retell and Twilio
accounts exist. It is written against the real seam already in the codebase (`apps/api/src/voice-booking/
provider-ports.ts`) so a live adapter drops in without changing any call site. Nothing in this document is simulated;
today all operations honestly throw `ProviderNotConnectedError` and every status reads `not_connected` with a
credential-derived reason.

## The seam (already built + tested)
- `VoiceProviderPort` (Retell): `status`, `createAgent`, `updateAgent`, `deleteAgent`, `registerWebhook`.
- `TelephonyProviderPort` (Twilio): `status`, `searchNumbers`, `purchaseNumber`, `assignNumber`, `releaseNumber`.
- `resolveVoiceProvider(env)` / `resolveTelephonyProvider(env)` return the NotConnected default now; when a live
  adapter is added they return it when credentials are present. The Command Center already reads provider status from
  these — so the day the adapter lands and creds are set, the UI flips to `connected` truthfully with no UI change.

## Environment variables
- Voice (Retell): `RETELL_API_KEY`, `RETELL_WEBHOOK_SIGNING_KEY` (already referenced in webhook verification).
- Telephony (Twilio): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`.
- Booking actions: `VOICE_WRITE_TOOLS_ENABLED=true` (already wired end to end).

## Screen 1 — Agent provisioning (durable job)
When "Provision" is pressed on a draft agent, enqueue a durable job (a new `ai_receptionist_provisioning_jobs` row:
tenant/branch, agent_id, status, current_step, progress, error_code, safe_error_message, idempotency_key). A worker
runs the steps, persisting progress so the UI can leave and return. Steps → port calls:
1. Load business info + calendar setup — internal reads (already exist).
2. Generate knowledge snapshot — internal (curated, sanitized; see knowledge notes below).
3. `voiceProvider.createAgent({ name, language, greeting, behavior, knowledge, tools })` → store `providerAgentId`
   on the agent row, flip `provider='retell'`.
4. `voiceProvider.registerWebhook(providerAgentId, <call/tool/transcript webhook URL>)`.
5. Health check `voiceProvider.status()` → transition agent draft→ready.
Idempotency: the job's `idempotency_key` guards against duplicate Retell agents on retry; a failed step preserves the
draft and records the exact `error_code` + `safe_error_message`. Until the adapter exists, step 3 throws
`ProviderNotConnectedError` and the job stops at "Creating voice agent" with that honest reason — never fake progress.

## Screen 2 — Phone Number
- Search: `telephonyProvider.searchNumbers({ areaCode?, tollFree? })`.
- Buy: `telephonyProvider.purchaseNumber(phoneNumber)` → persist a new `ai_receptionist_phone_numbers` row
  (tenant/branch, provider_number_id, phone_number, voice/sms flags, status, assigned_agent_id).
- Assign: `telephonyProvider.assignNumber(providerNumberId, providerAgentId)` (configures the Twilio voice webhook to
  route inbound calls to the agent).
- Release: `telephonyProvider.releaseNumber(providerNumberId)` (confirmation + audit; never on a live number without
  an explicit confirm). All numbers are tenant/branch-scoped — never expose another tenant's numbers.
- Checkout resilience: a reserved-but-unpaid state reconciles against `status()`; no duplicate purchases.

## Screen 3 — Test console (audio + chat)
- Chat: reuse the existing Booking Gateway endpoints directly in a sandbox mode (no writes) — this is buildable today
  and does not need Retell; the "book" tools run in dry-run against real availability.
- Audio (WebRTC): needs the Retell web-call SDK + a live agent. Wire `voiceProvider` to mint a web-call session for
  the agent; stream transcript + tool-call events over the existing SSE bus. Production-write test mode stays behind
  an explicit warning + permission, exactly as the spec requires.

## Screen 4 — Google Reviews
Only build when the existing Google Business Profile integration is connected. Post-appointment review-request SMS
reuses the existing notification service (with quiet-hours + opt-out + dedupe already available). The AI never posts
or edits reviews; drafted responses require human approval. If GBP isn't connected, the screen shows a connect state
— no fabricated review data.

## Knowledge snapshot (used by provisioning step 2)
Curated, sanitized, customer-facing only: business profile, hours (live source), AI-bookable services + customer
prices, technician display names + eligibility, booking/cancellation rules, approved FAQs (the new FAQ store),
policies, handoff rules. Excludes payroll, full customer records, payment tokens, merchant credentials, internal
notes, security settings, API keys. Versioned; the previous working version is preserved until the new one is
confirmed.

## Go-live sequence (owner actions)
1. Create Retell + Twilio accounts.
2. Set `RETELL_API_KEY`, `RETELL_WEBHOOK_SIGNING_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`.
3. Issue a `vk_live_` integration key from the admin screen.
4. Add the live provider adapter (implements the two ports) — the only remaining code once accounts exist.
5. Provision an agent, connect a number, run a test call, then activate.
Full detail: `docs/ai-receptionist/GO_LIVE_RUNBOOK.md`.
