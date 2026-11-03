# AI add-on pages — assistant workspaces (guides of Nov 1–2 2026, built Nov 3 2026)

The AI add-on pages (`/tenant/ai/reviews`, `/tenant/ai/customer-insights`, `/tenant/ai/checkout-upsell`,
`/tenant/ai/fraud-protection`) were one shared `POSAiPackageScreen`: the add-on's name, description, price, usage, status and
Cancel add-on, and a large empty area. Each guide asks for the same three things: (1) fix the contradictory subscription state and
add a one-click system check, (2) the assistant's real work, (3) a full-screen dashboard with search, From/To month calendars and
numbered pages.

## Subscription state (all pages)

The "On trial · Limited · Your free trial has ended" contradiction was already fixed for every add-on page by the AI OCR Receipt
Scanner guide (Nov 2 2026): `AiPackagePanel` reads the ONE package state the AI Usage screen computes
(`/tenant/ai/usage-screen/packages/:code`) — a trial that ended is never shown as "On trial", Cancelled offers no Cancel, the price is
the salon's own or the labelled catalog price, usage is the current period with its reset date. Nothing hardcodes $39 or 1,000.
Cancel and Start trial confirm first and go through the audited, idempotent actions. The tenant-wide AI usage check
(`POST /tenant/ai/usage-screen/check`) covers stale trial rows and AI calls after a trial ended.

## The shared workspace

`components/AssistantDashboard.tsx` renders, under the honest header: Refresh · Check <module> System · Open <module>; the module's
own counters (an unreadable summary is an error, never zeros); the module's record list from its own server query (search, the
module's filters, presets + From/To month calendar, sort, numbered pages of 10/25/50/100, newest first); and the module's read-only
check with its localized checks. Everything is read from the module that owns the data — no second review, customer, checkout or
fraud system — and every change still happens in that module's workspace. Strings: `asx.*` (shared) + one block per page
(namespace `assistants`).

## AI Review / Reputation Assistant (`/tenant/ai/reviews`)

- Reads Reviews & Reputation (`/pos/reputation/*`, built Nov 1 2026): six cards (reviews, average rating, negative count + share,
  replies awaiting approval, open complaints, response rate — one definition each), the review list (search: text, reviewer,
  source, review id; reply state, rating, complaint state; review date presets + range; newest / oldest / lowest / highest rating;
  pages), and **Check AI Review System** = the reputation check (reviews on record, provider connected / imports / credentials,
  response states agree, analysis coverage, publishing, stuck publishes, complaints tracked / acknowledged, request delivery,
  tenant isolation, no automatic actions).
- Drafting, approval (a person approves every reply) and publishing stay in Reviews & Reputation; the page says so and links there.
- Tests: `POSAIReviewAssistantScreen.test.tsx` 4/4 (one honest state, cards, list query, empty vs error, localized check, refused
  check is an error).
- Not built here (already decisions 5–7): separate approve permission, the review-request sender, automatic replies.
