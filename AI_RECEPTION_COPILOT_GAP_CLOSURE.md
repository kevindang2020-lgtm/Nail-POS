# AI Reception Copilot — Gap Closure (spec §1)

Audit found 5 §1 capabilities missing from the Copilot; this closes them. Backend for all five is built + tested;
gap 1 is also surfaced in the POS Copilot screen; gap 2's live-transfer piece is honestly provider-gated (not faked).

## Closed

1. **Display AI Phone Receptionist completed actions** ✅ — `ReceptionCopilotAssistService.recentAiPhoneActivity`
   reads `voice_call_outcomes` tenant/branch-scoped (booking outcome, intents, summary, handoff, follow-up). Endpoint
   `GET /tenant/ai/center/copilot/ai-phone-activity`; **POS panel added** ("AI Phone Receptionist — recent activity")
   with handed-off / follow-up badges. Real-PG proven (`AIPHONE_ACTIVITY_OK`, tenant-isolated + handoff mapping).
2. **Take over an active AI call** ◑ — the Copilot now DISPLAYS AI calls and flags which were handed off to a human
   (the takeover surface). Initiating a live telephony transfer requires the voice provider (Retell/Twilio) and is
   deliberately NOT faked; `handedOffToHuman` reflects what the voice system actually recorded.
3. **Explain services and approved policies** ✅ — `explainService` reuses the real services catalog + returns applicable
   policies (duration/price/booking-policy); only real fields, nothing fabricated. `POST .../copilot/explain-service`.
4. **Suggest waitlist / standby placement** ✅ — `recommendWaitlist` (the queue "waiting" stage is the waitlist) reuses
   the real queue summary; advisory only (placement still via the Queue domain service). `GET .../copilot/waitlist`.
5. **Show safe recommended next actions** ✅ — `recommendNextActions` returns deterministic, intent-driven safe steps
   (each maps to an existing Copilot capability). `POST .../copilot/next-actions`.

All tenant/branch-scoped, advisory (no direct DB writes — mutations stay in existing domain services), reusing existing
data/services (voice-call-outcome, services catalog, queue) rather than duplicating.

## Verified
api **2990/2990** (+7 assist tests), pos-web **324/324**, tsc 0, both builds clean, migration 299 read confirmed on
real Postgres. api client methods added for all four new endpoints.

## UI now complete (all five surfaced in the POS Copilot)
- Gap 1: "AI Phone Receptionist — recent activity" panel (handed-off / follow-up badges).
- Gap 3: "Explain a service" panel — service dropdown (real catalog) → details + policies.
- Gap 4: "Waitlist / standby" advisory card (live queue).
- Gap 5: recommended next-action chips under the detected-intent hint.
- Gap 2: AI calls display + handoff status (the takeover surface); a LIVE telephony transfer remains provider-gated
  (Retell/Twilio) and is intentionally not faked.
pos-web **325/325**, build clean; a panel-render test asserts the AI-phone, service-explainer, and waitlist panels
appear.
