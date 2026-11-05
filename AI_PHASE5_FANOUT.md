# AI Phase 5 (fan-out) — AI panel across the POS areas

The reusable `AiAssistantPanel` is now placed in every POS screen that has a natural home for an assistant. Each is a
single element using the same gate-aware component (offers the assistant when accessible, shows the exact locked/upgrade
reason otherwise, never calls the model when locked).

## Wired POS areas (8)
| Screen | packageCode | CTA |
|---|---|---|
| POSCheckoutScreen | `ai_checkout_upsell_assistant` | Suggest upsells |
| POSQueueScreen | `ai_queue_technician_assignment` | Balance the queue |
| POSBookingScreen | `ai_booking_assistant` | Booking help |
| POSCustomersScreen | `ai_customer_profile_assistant` | Summarize customer |
| POSCheckInScreen | `ai_reception_copilot` | Reception copilot |
| POSReportsScreen | `ai_analytics_forecasting` | Forecast |
| POSDashboardScreen | `ai_business_assistant` | Business assistant |
| POSCashDrawerScreen | `ai_fraud_money_protection` | Check for anomalies |

Each panel was inserted as the first child of the screen's main `work` container with a tenant-scoped prompt; no existing
screen logic or tests were changed. All prompts are generic per-area instructions for now — the real per-assistant prompt
templates are Phase 3.

## Assistants with no pos-web home yet (7) — intentionally not placed
`ai_phone_call_assistant`, `ai_scheduling_optimizer`, `ai_marketing_assistant`, `ai_inventory_assistant`,
`ai_review_reputation_assistant`, `ai_voice_transcription`, `ai_ocr_receipt_scanner`.

These don't have a matching POS screen in pos-web today (no phone/marketing/inventory/reviews/voice/receipt-scan
surface), so force-fitting them would be wrong. `ai_scheduling_optimizer` was deliberately skipped on
POSLiveTechnicianScheduleScreen because that screen is a fixed 3-row CSS grid (`gridTemplateRows: auto auto minmax(0,1fr)`)
and is also embedded inside other screens — an inline panel would break its layout. These assistants are reachable today
from the owner app's **AI Packages** screen (subscribe / trial / usage) and via `POST /ai/:packageCode`; they each need a
purpose-built surface (a future POS screen or the owner app) rather than an existing POS area.

## Verification
pos-web: `tsc` clean; **67 tests** (unchanged — the panel's own 3 tests plus all existing screen tests still pass);
`vite build` clean. Backend unchanged this turn (529, `RESULT: PASS`).

## Platform status
End-to-end and verified here: enforcement gate (P1) → real-data gate (P2) → Super-Admin API + screen (P4a/b) → tenant API
+ owner screen (P4c) → POS panel + fan-out (P5). Assistants return the deterministic Mock until a provider key is set;
all enforcement, usage logging, billing-status gating, and the three UIs are real.

Remaining (need your environment / keys):
- **Phase 3** — real OpenAI/Anthropic/Gemini adapters + per-assistant prompt templates behind the existing `AiProvider`
  port.
- **Phase 4d** — billing/webhook sync (payment status flips `tenant_ai_subscriptions.status`) + paid activation from the
  owner UI.
- **New surfaces** — purpose-built screens for the 7 assistants that have no POS home (phone, scheduling optimizer,
  marketing, inventory, reviews, voice transcription, receipt OCR).
