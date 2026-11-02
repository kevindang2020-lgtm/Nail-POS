# AI Receptionist — Phase Implementation Order (Phase 0)

Buildable-now phases (no external account), in dependency order:
1. **Phase 1a — Voice Booking Gateway, READ tools** (business, hours, services, technicians, availability). Thin
   adapters over existing services. ← starting this now.
2. **Phase 2 — Voice integration-key auth** (new `voice_integration_keys` table + guard mirroring api-webhooks; tenant/
   branch resolved from the key; rate limit; audit). Gates the whole gateway.
3. **Phase 1b — Gateway WRITE tools** (customers lookup-or-create, appointments search/get/create/reschedule/cancel,
   handoff, call outcome) — reuse CustomerBookingService/CustomersService; confirm-before-write enforced at the agent
   layer. *(Large change — per the spec I'll checkpoint with you before wiring the write path.)*
4. **Phase 4 — Call-session state machine + outcome store** (deterministic gating of confirmations).
5. **Phases 6-24 — Prompt catalog** (versioned master prompt + flow prompts as config/docs, not hard-coded).
6. **Phase 25-27 — Learning pipeline + knowledge base + pronunciation** (human-approved, versioned).
7. **Phases 28-33 — Config UI, call-history UI, analytics, Super Admin wiring.**
8. **Phase 34-35 — Test console + full test matrix.**

External-dependent phases (need your input/accounts): **Phase 3** (provider impl), live number, recording-consent legal
review, LLM keys, **Phase 36** pilot.

## Checkpoint (per the spec: "show me before large changes")
Starting with Phase 1a (safe read-only adapters) + Phase 2 scaffolding. I will STOP before the write path (Phase 1b) and
the provider layer (Phase 3) to confirm scope and collect the provider decision + credentials.
