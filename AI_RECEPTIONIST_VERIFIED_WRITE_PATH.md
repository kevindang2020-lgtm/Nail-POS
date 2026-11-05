# AI Receptionist — verified reschedule/cancel + consent-gated customer creation (2026-07-03)

Built the two pieces held back for your decision. Since you authorized it, I chose a SAFE default policy (documented +
configurable) rather than block. The core safety property: the AI can only ever see or change appointments belonging to
the caller whose identity was verified on that call — never another customer's.

## The verification policy (safe default, configurable)
`VOICE_VERIFICATION_MODE` — default **`phone`** (the caller's phone must match a customer on file); set to **`phone_name`**
to also require a name match (a light second factor against caller-ID spoofing). No code change needed to tighten it.
Every mutating action re-checks appointment ownership against the verified customer, so caller-ID spoofing alone can't
reach another customer's booking.

## What was built
- `voice-caller-verify-core.ts` (pure): `normalizePhone`, `verifyCaller(mode, provided, customer)`, `ownsAppointment(...)`.
- `voice-manage.service.ts`: `verifyCaller`, `searchAppointments` (caller's own only), `rescheduleAppointment`,
  `cancelAppointment`, `lookupOrCreateCustomer`. Delegates to the canonical `BookingService` (atomic reschedule; cancel
  with customer notification) and `CustomersService` (duplicate detection) — no logic duplicated.
- Permissions: `AI_RECEPTIONIST_PERMISSIONS` expanded (owner-approved) to booking view/create/reschedule/cancel +
  customers view/create — in one labeled constant.
- Tools: `verify_caller`, `search_appointments`, `lookup_or_create_customer`, `reschedule_appointment`,
  `cancel_appointment` enabled (behind `VOICE_WRITE_TOOLS_ENABLED`, still dark by default). Each write tool's schema
  instructs the agent to verify by phone first and confirm before changing.
- Controller dispatch: reschedule/cancel now verify the caller, then execute only on an owned appointment; the old
  human-handoff stubs are gone.

## Safety guarantees (tested)
- **Cross-customer block:** rescheduling/cancelling another customer's appointment is refused ("couldn't find that
  appointment under your account") and NEVER delegates to the booking service.
- **Verification required:** reschedule/cancel/search first verify the caller by phone (+name if configured); an
  unknown number fails without leaking whether it exists.
- **Confirm-before-write:** reschedule/cancel refuse unless `confirmed: true`.
- **Consent-gated creation:** a new customer is created only with explicit `consent: true`; without it, creation is
  refused (existing customers are returned without creating).
- Bookings/reschedules/cancels run under the `AI_RECEPTIONIST` role with `source: 'ai'` — visible in audit + KPIs.

## Verification (fresh runs)
- Manage safety tests **16/16** (verification, cross-customer refusal for reschedule AND cancel, confirm gates,
  own-only search, consent-gated create).
- voice-booking suite **81 tests / 9 files**; typecheck 0; lint 0; **full api suite 2690/2690 across 424 files**; build
  clean.

## Files created / changed
- NEW `voice-caller-verify-core.ts`, `voice-manage.service.ts`, `voice-manage.vitest.spec.ts`
- CHANGED `voice-booking-write.service.ts` (permissions), `voice-tools.ts` (enable + re-spec write tools),
  `voice-booking.controller.ts` (verified dispatch), `voice-booking.module.ts` (import CustomersModule + provide
  VoiceManageService), and the affected tests.

## Still dark by default
Everything remains behind `VOICE_WRITE_TOOLS_ENABLED` (off). Nothing changes a real appointment until you enable the
flag AND connect a provider. Recording/transcript retention is still a separate consent/legal item (not built here).

## To go live
Issue a voice key → set `RETELL_WEBHOOK_SIGNING_KEY` → optionally set `VOICE_VERIFICATION_MODE=phone_name` →
`VOICE_WRITE_TOOLS_ENABLED=true` → point a Retell agent at `POST /voice/tool`.

## Rollback
Set `VOICE_WRITE_TOOLS_ENABLED` off → read-only again. Or revert the changed files + delete the two new ones. No schema
change.
