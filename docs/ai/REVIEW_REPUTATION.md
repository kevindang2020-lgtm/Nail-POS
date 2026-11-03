# AI Review & Reputation (POS) — Nov 2 2026

Guide: *AI Review & Reputation* (Kevin, Nov 1 2026). Route: `/tenant/ai/reputation` (unchanged). Package gate:
`@RequiresAiPackage('ai_review_reputation_assistant')`.

## Audit findings (before the build)

| Area | Status | Finding |
|---|---|---|
| Cards | **Broken** | "Awaiting approval" and "Response rate" read `reviews.response_status`, which the approval flow never updated — both were **always 0**. "Awaiting approval" was also counted from the first inbox page only. |
| Failed reads | **Broken** | A failed read showed "—" / an empty list, i.e. looked like "no reviews". |
| Store writes | **Broken** | Draft, version, approval and escalation writes swallowed errors: **Approve could answer "approved" without saving**. |
| Approval records | **Broken** | `review_approvals.draft_id` stored the review id; the actor was not stored. |
| AI drafting | **Unsafe** | The draft was built from review text the browser sent, not the stored review. |
| Average rating | Bug | Shown rounded to a whole number (4.2 → 4). |
| Review requests | Partial | Checkout schedules requests, but no sender runs — nothing is ever sent. The screen did not say so. |
| Tabs / filters | Partial | No search, filters, dates or pages; trends and branches used different definitions from the cards. |

## What was built

- **One metrics definition** (reviews ⟕ drafts ⟕ latest complaint case) used by the cards, Feedback Trends and Branch Comparison.
  Response state comes from the draft; every draft write now also syncs `reviews.response_status`.
- **`/pos/reputation/*`** (read side, view permission): `summary`, `reviews` (search · source · rating · response · complaint ·
  review/imported date · presets + From/To calendar · sort · pages), `reviews/:id` (provider evidence, stored customer link —
  restricted without `customers.view`, analysis, draft + versions, approval history, complaint case, notes, recovery),
  `approvals`, `complaints`, `trends`, `branches`, `requests` (says `sender.running = false`, counts overdue unsent),
  `integrations`, and `POST check` (read-only, one run per salon per 30 s, stored in `review_reputation_health_runs`).
- **Workflow writes stay on the existing routes** (`/pos/ai-review-reputation/:id/draft|request-approval|approve|reject|publish|notes`,
  `escalations/:id/acknowledge|resolve`). Errors now propagate; the drafting service loads the stored review text and ignores
  anything the browser sends. Publish is separate from Approve and counts as a response only when the provider confirms.
  Nothing on this screen refunds, credits, discounts or messages a customer.
- **Retired** (no callers after the rebuild; pinned in `reputation-routes.vitest.spec.ts`): `GET inbox`, `GET analytics`,
  `GET branch-comparison`, `GET escalations/urgent`, `GET integration-status`, `GET :id`, and the matching POS client methods.
- **POS screen** rebuilt in place: title, description, the eight tabs and the six cards keep their keys. Each tab has its own
  filters and pages; the review overlay runs Draft → Send for approval → Approve / Reject (reason required) → Publish; a role
  without manage sees no workflow buttons. EN/VI (`rpx.*`, 244 keys; VI pending native review).

## Database (migration 768, additive)

- Indexes on `review_response_drafts`, `review_escalations`, `review_requests` for the queues.
- `review_reputation_health_runs` (tenant, branch, actor, overall, checks, created_at).

## Check Reputation System

Reviews on record · provider connected · provider imports · credentials valid · response states agree · reviews analyzed ·
publishing · nothing stuck publishing · serious reviews have a case · cases acknowledged in time · review requests ·
tenant isolation · no automatic actions. Text is localized on the POS (`rpx.health.d.<key>.<state>`).

## Tests

- `reputation-center.pgtest.vitest.spec.ts` 11/11 · `reputation-routes.vitest.spec.ts` 3/3 · reputation suite 54/54.
- `POSAIReviewReputationScreen.test.tsx` 8/8.
- Sabotage: disabling the status sync, removing the reject-reason requirement, and sending review text from the browser were each caught.

## Decisions for Kevin

- Draft and approve use the same manage permission — split them (and forbid approving your own draft)?
- Build the review-request sender (consent, quiet hours, frequency cap), or keep requests off?
