# AI Receptionist — Phase 3: provider-agnostic voice layer + Retell adapter (2026-07-03)

Built the voice-provider seam so AIPowerSalon stays vendor-neutral, plus a Retell adapter matching Retell's real
documented webhook format, plus the tool catalog the agent will call. No external account required for this increment;
read tools are live, write tools are declared-but-gated pending the write-path checkpoint.

## Provider decision (recorded)
**Retell AI** on a **Twilio number** — chosen for a solo founder: fastest to production, native warm transfer (the
front-desk handoff requirement), structured post-call outputs (map directly to the call-outcome store), SIP/Twilio
integration (keeps SMS + calls on the existing Twilio account), and PII redaction. Vapi is the equivalent alternative;
the choice is low-regret because the port below keeps AIPowerSalon provider-agnostic (a switch is a new adapter, not a
rewrite).

## What was built
### 1. `voice-provider.port.ts` — the vendor-neutral seam
Canonical types every provider adapter implements: `verifyWebhook`, `parseToolCall`, `formatToolResult`, over canonical
`VoiceToolCall` / `VoiceToolResult`. The gateway and controllers depend only on these, never on a vendor SDK. Tenant
identity is explicitly NOT taken from the tool args — it comes from the integration key (Phase 2).

### 2. `retell-voice.adapter.ts` — Retell implementation (matches their docs)
Webhook auth follows docs.retellai.com/features/secure-webhook exactly:
- Header `X-Retell-Signature` = `v=<unix_ms>,d=<hex_hmac_sha256>`.
- HMAC-SHA256 over `rawBody + timestamp`, keyed by the Retell API key (the "webhook"-badged one).
- 5-minute replay window; constant-time (`timingSafeEqual`) comparison; case-insensitive header; fail-closed on any
  problem (never throws).
- `parseToolCall` accepts the common Retell custom-function body shapes (name/args/call_id/invocation_id, args as
  object or JSON string). `formatToolResult` returns the small fast JSON Retell reads back, with honest error messages
  (never a leaked exception).

### 3. `voice-tools.ts` — the tool catalog (the agent's only allowed actions)
Data-driven catalog mapping to Voice Booking Gateway methods. **READ tools live** (`get_services`, `get_technicians`,
`get_availability`). **WRITE tools declared but `enabled:false`** (`lookup_or_create_customer`, `create_appointment`,
`reschedule_appointment`, `cancel_appointment`, `handoff_to_front_desk`) — the agent cannot be given a booking/cancel
tool until the write path is wired and confirmed (confirm-before-write, per the spec). `enabledVoiceTools()` returns
only what's currently safe to expose.

## Security properties (verified)
- Webhook signature verification interops with a **real Retell-format HMAC** (test builds the signature the same way
  Retell does): valid accepts; tampered body, wrong key, stale timestamp, malformed/missing header all reject.
- Tenant/branch never come from the caller or tool args — they resolve from the integration key server-side.
- Write tools are physically absent from the exposed set until wired.

## Verification (fresh runs)
- Typecheck: api tsc 0.  Lint: voice-booking 0.
- Tests: **21** in `voice-booking/` — 6 read-adapter (reuse + safe projection + honest availability), 12 Retell adapter
  (signature valid/tampered/wrong-key/stale/malformed/no-key/case-insensitive; tool-call parse shapes; result format
  success/error), 3 tool-catalog (read-only exposed, writes gated, required params).
- Full api suite: **2623/2623 across 417 files** (was 2602/414). Build clean.

## Files created
- `apps/api/src/voice-booking/voice-provider.port.ts`
- `apps/api/src/voice-booking/retell-voice.adapter.ts`
- `apps/api/src/voice-booking/voice-tools.ts`
- `apps/api/src/voice-booking/{retell-voice.adapter,voice-tools}.vitest.spec.ts`

## Checkpoint — what needs YOU next (per the spec: stop before large changes + external deps)
1. **Phase 1b write path** (create/reschedule/cancel/handoff adapters + enabling those tools) — touches real
   appointments. Low-risk (delegates to the validated CustomerBookingService with its atomic reschedule), but I'll
   confirm before wiring, and it stays behind confirm-before-write + the call-outcome state machine.
2. **Phase 2 voice integration-key store** (new `voice_integration_keys` table + guard mirroring api-webhooks) — I can
   build this now with no account; it's the auth that resolves tenant/branch from the key.
3. **External (needs your accounts):** a Retell account + API key (the webhook-badged one), connecting your Twilio
   number, and an LLM key for the agent. I'll hand you the exact steps when the write path + key store are in.

## Rollback
Additive only — new module, not wired into app routing yet, no runtime behavior change. Deleting the folder reverts.
