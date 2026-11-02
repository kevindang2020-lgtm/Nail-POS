# AI Receptionist — Phase 1a wiring: callable read gateway (2026-07-03)

Wired the voice gateway into a real, guarded HTTP surface. The AI voice agent can now (once pointed at the endpoint
with a valid key) call the read tools end-to-end. Write tools remain gated. No external account used.

## What was built
### `voice-booking.controller.ts` — `POST /voice/tool` (guarded)
The single custom-function endpoint the voice provider hits. Layered security:
1. **VoiceAuthGuard (mandatory)** — resolves tenant+branch from the integration key (`X-Voice-Key` / `Bearer`); 401
   without a valid key. tenant/branch are read from the key, never from the body.
2. **Retell signature (defense-in-depth)** — when `RETELL_WEBHOOK_SIGNING_KEY` is set, the Retell adapter verifies the
   HMAC over `req.rawBody` (the app already boots with `rawBody:true`, same as the payment webhook). When unset, the
   integration-key bearer auth is the sole gate and this is logged.

Dispatch routes read tools (`get_services`, `get_technicians`, `get_availability`) to the gateway; disabled WRITE tools
and unknown tools are refused with honest messages. Tool failures return a non-leaky "I couldn't complete that" the
agent can relay — never a stack trace.

### `voice-booking.module.ts` — wiring (reuse, not duplication)
Imports `CustomerBookingModule` and reuses its exported `CustomerBookingService` (the canonical booking logic).
Provides the gateway, `RetellVoiceAdapter`, the key service (kysely repo when a DB handle exists, else in-memory), and
the guard. Registered in `app.module.ts` next to `CustomerBookingModule`.

## Verification (fresh runs)
- Typecheck 0; lint 0 (voice-booking).
- Controller/wiring tests **8/8**: read-tool dispatch uses the guard's tenant/branch context; availability requires
  service+date; a disabled write tool and an unknown tool are refused; the guard rejects a missing key and admits a
  valid issued key (attaching `voiceCtx`); the repo factory picks the in-memory repo with no DB.
- voice-booking suite **38 tests / 5 files**.
- **Full api suite 2640/2640 across 419 files** (was 2632/418) — the app boots with the module wired in. Build clean.

## Files created / changed
- NEW `apps/api/src/voice-booking/voice-booking.controller.ts`
- NEW `apps/api/src/voice-booking/voice-booking.module.ts`
- NEW `apps/api/src/voice-booking/voice-booking.controller.vitest.spec.ts`
- CHANGED `apps/api/src/app.module.ts` (import + register `VoiceBookingModule`)

## Receptionist status
Built + verified, no external account used: Phase 0 (audit), **1a (read gateway, now CALLABLE)**, 2 (key auth), 3
(provider port + Retell adapter + tools). The read path is complete end-to-end: valid key → guard resolves tenant →
tool dispatch → canonical service → safe projection → provider-formatted result.

## Checkpoint — needs your input
1. **Phase 1b WRITE path** (enable create/reschedule/cancel/handoff): touches real appointments. Delegates to the
   validated `CustomerBookingService` (atomic reschedule), stays behind the guard + confirm-before-write. **Awaiting
   your go-ahead before wiring.**
2. **External accounts:** Retell account + webhook-badged API key (for `RETELL_WEBHOOK_SIGNING_KEY`), Twilio number,
   LLM key. Small admin surface to issue/revoke voice keys is buildable now if wanted.
3. Follow-up (not blocking): store the Retell signing secret per-key (encrypted) instead of one env var, for
   multi-tenant origin verification.

## Rollback
Remove the two `app.module.ts` lines and delete the module/controller files. The gateway becomes unreachable again with
no other effect; no schema change in this step.
