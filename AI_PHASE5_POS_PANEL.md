# AI Phase 5 — POS entry point (reusable panel + reference wiring)

The POS-side piece: one reusable, gate-aware component that drops into any POS area to surface an AI assistant or a clean
locked/upgrade panel. Wired into Checkout as the reference; the other 13 areas reuse the same one-liner.

## Files
- `apps/pos-web/src/api/posAiApi.ts` (new) — `packages()` (per-package access state) + `invoke(code, body)`
- `apps/pos-web/src/components/AiAssistantPanel.tsx` (new) — the reusable panel
- `apps/pos-web/src/components/AiAssistantPanel.test.tsx` (new) — 3 tests
- `apps/pos-web/src/screens/POSCheckoutScreen.tsx` — reference wiring (upsell assistant in the ticket detail)

## The reusable panel
`<AiAssistantPanel packageCode cta action buildPrompt />`:
- On mount it reads the tenant's access state from `GET /tenant/ai/packages` (the SAME gate decision the backend
  enforces) and branches:
  - **accessible** → shows the CTA button + remaining usage; clicking calls `POST /ai/:packageCode` with a tenant-scoped
    prompt built at click time, then renders the suggestion (with Regenerate).
  - **locked** → shows the package name + the exact **lock label** from the gate (e.g. "Subscribe to unlock this AI
    assistant", "Your free trial has ended", "reached this month's usage limit") + "Ask your salon owner to enable this
    in AI Packages." **It never calls the model when locked.**
  - **unknown to this tenant / status error** → renders nothing (fails quiet — an AI status check never blocks the till).
- Honest by construction: the gate already guarantees the endpoint can't run without a paid/trial subscription, and the
  panel won't even attempt the call when the access state says locked. One source of truth, POS → gate.

## Reference wiring (Checkout)
In `POSCheckoutScreen`, when a ticket is selected, an **AI Checkout + Upsell Assistant** panel appears under the ticket
detail. Its `buildPrompt` is tenant-scoped from the order (subtotal + tip) — no cross-tenant data. Every other POS area
in the spec adds the same single element with its own `packageCode` (Queue → `ai_queue_technician_assignment`, Customers
→ `ai_customer_profile_assistant`, Inventory → `ai_inventory_assistant`, etc.).

## Verification
pos-web: `tsc` clean; **67 tests** (+3: accessible → renders result + calls invoke with the right code; locked → shows
the lock label and never calls the model; unknown package → renders nothing); `vite build` clean. Checkout's existing
tests still pass. Backend unchanged this turn (529, `RESULT: PASS`).

## Where the AI platform stands
Built + verified here end-to-end: gate (P1) → real-data gate (P2) → Super-Admin API + screen (P4a/b) → tenant API + owner
screen (P4c) → POS panel + reference wiring (P5). Until a provider key is set, assistants return the deterministic Mock
through the shared `AiProvider` port — the enforcement, usage logging, billing-status gating, and UI are all real now.

Remaining (need your environment / keys):
- **Phase 3** — real OpenAI/Anthropic/Gemini adapters + per-assistant prompt templates behind the existing port.
- **Phase 4d** — billing/webhook sync (payment status flips `tenant_ai_subscriptions.status`) + paid activation from the
  owner UI.
- **Phase 5 (fan-out)** — add the panel to the remaining 13 POS areas (one element each).
