# AI Receptionist — Phase 1b: pilot-safe write path (2026-07-03)

Built the write path per the recommended pilot-safe posture: the AI can BOOK (through the canonical staff BookingService)
but never reschedules or cancels unattended — those hand off to a human. All of it stays dark by default behind an env
flag. No external account used.

## Security posture (built as recommended — review `AI_RECEPTIONIST_PERMISSIONS` to change)
- **Dedicated principal:** the AI acts under role `AI_RECEPTIONIST` with the MINIMAL permission set
  `['pos.booking.view', 'pos.booking.create']` — **no edit, no cancel**. Defined in one place
  (`voice-booking-write.service.ts`).
- **Source tagging:** bookings are created with `source: 'ai'` (already a first-class source in your schema) so the audit
  trail and KPIs (`aiBookings`) clearly show AI-made appointments.
- **Confirm-before-write:** `createAppointment` refuses unless the agent passes `confirmed: true` (set only after the
  caller verbally confirms service/date/time/technician).
- **Dark by default:** write tools are exposed only when `VOICE_WRITE_TOOLS_ENABLED` is on. With it off (default), even a
  valid key + live agent cannot book. Reschedule/cancel tools stay disabled in the catalog regardless.

## What was built
### `voice-booking-write.service.ts`
Delegates `createAppointment` to the canonical `BookingService.create(...)` — reusing its conflict, skill, and
store-hours checks + audit (no booking logic duplicated). Returns exactly what the backend produced or an honest,
relayable error (a slot-taken conflict becomes "That time was just taken." for the agent to offer another). Never claims
success the backend didn't confirm. `rescheduleRequiresHuman()` / `cancelRequiresHuman()` return a handoff signal —
those actions are never executed by the AI in this posture.

### Controller + catalog wiring
- `create_appointment` and `handoff_to_front_desk` are enabled (behind `VOICE_WRITE_TOOLS_ENABLED`).
- `reschedule_appointment` / `cancel_appointment` are declared but disabled → the agent is guided to `handoff`.
- `enabledVoiceTools(env)` hides all write tools unless the flag is on.
- Module now imports `BookingModule` and provides `VoiceBookingWriteService`.

## Verification (fresh runs)
- Write-path tests **8/8**: confirm-before-write; delegation under the AI role with `source:'ai'` and no cancel
  permission; required fields; honest conflict; no internal-error leak; reschedule/cancel → handoff; write tools dark by
  default.
- Controller tests include: create dispatches to the write service only when the flag is on; cancel refused; write tool
  refused when dark.
- voice-booking suite **48 tests / 6 files**; typecheck 0; lint 0; **full api suite 2650/2650 across 420 files**; build
  clean.

## Files created / changed
- NEW `apps/api/src/voice-booking/voice-booking-write.service.ts` (+ `.vitest.spec.ts`)
- CHANGED `voice-booking.controller.ts` (write dispatch, env-gated), `voice-tools.ts` (enable create+handoff, env gate),
  `voice-booking.module.ts` (import BookingModule + provide write service), and the two affected test files.

## How to go live (when you have the account)
1. Create voice integration key(s) for the tenant/branch (via `VoiceKeyService.issue`).
2. Set `RETELL_WEBHOOK_SIGNING_KEY` (the webhook-badged Retell key) for origin verification.
3. Set `VOICE_WRITE_TOOLS_ENABLED=true` to expose create + handoff.
4. Point a Retell agent's custom functions at `POST /voice/tool` with `X-Voice-Key: <key>`.
Reschedule/cancel remain human-handled until you decide to extend the permission set + verification policy.

## Deliberately NOT built (needs your decisions, as flagged)
- AI-driven reschedule/cancel (needs a caller-verification policy + expanded permissions).
- Customer-record creation with consent capture (pilot books with name+phone on the appointment).
- Call-outcome store + learning loop; config/history UI; provider account wiring.

## Rollback
Set `VOICE_WRITE_TOOLS_ENABLED` unset/false → instantly read-only again. Or remove the write service + revert the
controller/catalog/module edits. No schema change in this step.
