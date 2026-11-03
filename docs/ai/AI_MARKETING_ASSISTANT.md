# AI Marketing Assistant family — Nov 3 2026

Guides: AI Marketing Assistant, Campaign Builder, Message Studio, Audience Builder, Campaign Results.
Routes: `/tenant/ai/marketing`, `/builder`, `/studio`, `/audiences`, `/results`. API: `/pos/ai-marketing/center/*` (migration 780).

The assistant is the analysis and recommendation layer. The systems of record stay where they are:
Campaign Center (campaigns, approval, launch, send ledger read model), Customer Retention (who is approaching / at risk),
Customer Segments (consent verdicts, unsent audience drafts), Birthday Campaigns, the send worker (consent, opt-out,
quiet hours, limits and idempotency re-checked per recipient at send time), notifications (provider cost, delivery).
No new campaign, audience, consent, delivery, billing or attribution table was added.

## Audit (before this change)

| Requirement | Status | Evidence | Action |
|---|---|---|---|
| Seven KPI cards | PARTIAL | `KyselyAiMarketingRepository.campaignTotals` summed `campaigns.sent_count` (never written) and `cost_cents` | Cards now read the send ledger, delivery reports, booking-link conversions and code redemptions, in a period |
| "Message cost to date" | BROKEN | It summed `campaigns.cost_cents` — the BUDGET Campaign Center shows as "Budget". That is the photographed "$100.00 with 0 sent" | Spend = provider cost of sent messages; budgets shown separately with an explanation |
| Reach & Consent | PARTIAL | Counted the opt-in flag only (no phone / STOP-listed still counted) | Opted in vs reachable, overlap and union |
| Recommendations | BROKEN | Own "lapsed" rule: a completed visit older than N days — a customer who came back yesterday still counted; birthday month in UTC | Customer Retention's At Risk / Approaching rule + Segments consent verdict; birthday in salon month |
| Campaign approval (AI path) | BROKEN | `AiMarketingCampaignService.approveAndSchedule` called `transition('scheduled')` — no Campaign Center approval hash, no audience snapshot; the sweep then sent from the plan saved at submit | Now `CampaignsService.schedule()` (send-readiness rule); the builder saves into Campaign Center instead |
| Message Studio tokens | BROKEN (silent) | Drafts use `{{customer_first_name}}`, `{{booking_link}}`…; the sender fills only `{salon_name}` / `{offer}` once | `{{salon_name}}`/`{{promotion_name}}` mapped; the rest are refused (`MKC_TOKENS_UNSUPPORTED`) |
| Search / dates / pages | MISSING | — | Campaign Center's list (search, status, channel, presets + calendar, pages, newest first) |
| Eligibility funnel | PARTIAL | Total / missing contact / opted out only | Per reason (consent, opt-out, contact, recently contacted, upcoming booking, never visited, duplicate) and unique people across channels |
| Cost / budget preview | MISSING (here) | Campaign Center preview had segments × platform price | Same formula in the builder and Message Studio, compared with the budget |
| Health check | MISSING | — | Check AI Marketing System (16 read-only checks, recorded) |
| Per-tenant Twilio, webhooks, idempotent sends | VERIFIED (existing) | Campaign Center + send worker | Reused; reported by the check |
| Budget enforcement while sending | MISSING — decision | The send worker does not stop at the budget | Reported (`budget_respected`); see decisions |
| Per-recipient frequency cap | MISSING — decision | Only platform campaign limits exist | Shown as an exclusion reason where Segments records it; see decisions |

## Endpoints

| Route | Permission | What |
|---|---|---|
| `GET summary` | marketing.view | Seven cards in a period (salon time), reach, budgets vs spend, definitions |
| `GET recommendations?channel=` | marketing.view | Rebooking, win-back (WinBackCenter.plan), birthday (Segments verdict) with status and reasons |
| `POST eligibility` | marketing.view | Funnel per channel; unique people for `both` |
| `POST estimate` | marketing.view | Characters, encoding, segments, platform price, cost, within budget, unfillable placeholders |
| `POST save-draft` | marketing.manage | Unsent Segments audience (win_back) + unapproved Campaign Center draft, idempotent |
| `POST check` | marketing.view | Check AI Marketing System — read-only, 30 s reuse, advisory lock |

Retired from the client (server routes kept, on the unreached ledger): `state`, `audience/preview`, `campaigns`,
`campaigns/:id/approve`, `campaigns/:id/results`.

## Tests

- `modules/ai/src/ai-marketing/marketing-center.pgtest.vitest.spec.ts` — 11 on the real schema (PGlite).
- POS: `POSAIMarketingScreen` (8 + 403), `POSAIAudienceBuilderScreen` (2 + 403), `POSAICampaignBuilderScreen` (4),
  `POSAICampaignResultsScreen` (2), `POSAIMessageStudioScreen` (2 + 403), `posAIMarketingApi.retired` (6).
- No test sends a message. Live Twilio / email delivery is not exercised here (no credentials) — BLOCKED for live verification.

## Decisions for the owner

1. Enforce the campaign budget in the send worker (pause when provider cost would pass it)? Today it is shown and checked only.
2. A per-customer marketing frequency cap (e.g. one campaign message per 7 days) at send time?
3. Per-customer personalization (`{{customer_first_name}}`, booking links) in the sender — today only `{salon_name}` / `{offer}`.
