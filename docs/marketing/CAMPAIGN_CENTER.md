# Campaign Center — Complete Build Guide (30 Oct 2026): implementation, evidence, handoff

Routes: `/tenant/marketing/campaigns` (Campaign Center), `/tenant/marketing/sms` and `/tenant/marketing/email` — the **same** screen pre-filtered
to that channel and titled "SMS Marketing" / "Email Marketing" (one campaign engine, intentional; guide §03 last question).
Nothing in this work sends a real message, charges, or deploys. Migration **739** is applied to the local test template only.

## 1. Root cause — "spring into glow: 20% off · SMS · audience 50 · Completed · sent 0" (guide §03, owner highest priority)
| Question (guide §03) | Answer from the code + data |
|---|---|
| Draft / scheduled / processed / cancelled / blocked / legitimately completed? | Moved by hand: the old screen offered **Activate** (draft → in_progress, a bare status move) and **Complete** (in_progress → completed). No send ever ran. |
| 50 identities, 50 records or 50 estimated? | **50 typed into the "Audience size" box** of the old New Campaign form. `campaigns.audience_size` was a free number, never a list of customers. |
| How many passed consent / opt-out / dedupe / format filters? | None were evaluated — no customers were ever selected. |
| Were send jobs created / attempted / rejected? | **No.** The only sender (`AiMarketingSendSweep` → `AiMarketingSendService`) sends only campaigns that have a row in `ai_marketing_campaign_plans`; the POS never wrote one. `ai_marketing_campaign_sends` has no row for it. |
| Did Twilio / registration / limits / workers block it? | Not reached. (The health checker now reports each of these separately.) |
| Why does the Growth Funnel say 50 reached? | The old screen computed "Audience Reached" = `sum(audience_size)` of the loaded rows. |
| What makes a campaign Completed — sending or processing? | Either the hand "Complete" button, or the executor after it handled every recipient. Neither wrote `campaigns.sent_count` (nothing in the codebase ever did). |

The row is **left exactly as it is** (status, audience 50, sent 0). The read model now shows it as `~50 est.` with the outcome
**"No messages were sent — no send record exists"**, Sent 0, Open / Click / Reply / ROI **N/A**, the funnel's *Audience selected* 0 and a
note "Not counted: 50 typed-in audience estimate(s)"; Check Campaign System traces it (status → audience source → plan → ledger → counts).

## 2. What was built (no second messaging engine)
| Piece | Where | Notes |
|---|---|---|
| Distinct counts, each from its own source | `campaign-center.ts` `countsCte` / `countsOf` | Selected / Eligible / Excluded = `campaign_recipients` snapshot (or the legacy estimate, flagged) · Queued / Attempted / Accepted / Skipped / Failed = `ai_marketing_campaign_sends` · Delivered / Failed-later / Simulated = `notifications` by `provider_id` · Booked = `ai_booking_conversion_events.campaign_id` · Redemptions / discount / associated paid revenue = `deal_coupon_batches.campaign_id → deal_redemptions → paid tickets` · Provider cost = `notifications.provider_cost_micros` |
| ROI | `countsOf` | `(associated revenue − provider cost) / provider cost`, only when **every** accepted message has a provider cost; otherwise N/A with the reason. Budget is a plan, never treated as cost. |
| Opens / clicks / replies | screen | "N/A — not tracked" (SMS has no open event; email engagement is not ingested per campaign). Never 0 %. |
| Search scopes | `GET pos/campaign-center/campaigns`, `…/recipients` | campaigns: name / ID / goal / offer / promotion / audience / creator, status (incl. awaiting approval / approved / sending), channel, branch; recipients & delivery history: only real campaign-recipient + send-ledger rows — customer name / phone digits / email / customer ID / provider message id. Server-side, exact counts. |
| From / To month calendar | `PeriodBar` (shared FinanceKit) | presets Today / Week / Month / Year / Custom; date basis Created / Scheduled start / Actual launch / Completion; salon time zone, both days inclusive, DST-safe bounds |
| Numbered pages | shared `Pager` | 10 / 20 / 50, `created_at DESC, id DESC`, filters reset to page 1, view kept in the URL |
| Audience snapshot | `POST …/campaigns/:id/audience` + table `campaign_recipients` (739) | copies a Customer Segments audience draft (`segment_audience_members`, consent verdicts included) as snapshot *v*; channel must match; expired / discarded drafts refused; the draft is linked back (`segment_audience_drafts.campaign_id`) |
| Six-step New Campaign | screen `WizardDialog` | Details → Audience → Message (`{salon_name}`, `{offer}`) → Schedule → Review (rendered message as sent, segments, cost estimate when priced) → Approval. Save-as-draft at every step. Preview never sends. |
| Approval | `POST …/submit`, `…/approve` | approver needs `marketing.manage` (owner / manager by default). Approval stores the **content hash** (channel, subject, body, promotion, snapshot version, branch) and writes the send plan (`ai_marketing_campaign_plans`, `audienceDefinition: { campaignSnapshot: true, snapshotVersion, emailSubject }`) in the same transaction. Any later edit voids it ("approve again"); a re-approval after an edit bumps the message version (new idempotency keys). |
| Launch | `POST …/launch` `{ confirm: true, at? }` | refuses unless approved + unchanged + ≥ 1 eligible + platform limits pre-check; re-checked under the row lock; moves to `scheduled` through the CAMPAIGN machine. **Launch itself sends nothing** — the existing worker sends. Scheduled → draft ("Move back to draft") before it starts. |
| Send path (existing, extended) | `modules/ai/src/ai-marketing/*` | `snapshotRecipients()` enumerates exactly the approved snapshot's eligible customers with consent / contact / active status **re-read at send time**; the executor re-checks opt-out per recipient, is idempotent per (campaign, customer, channel, version), now stops future sends when the campaign is cancelled mid-run (never marks it completed), and carries the email subject. The sweep also resumes an interrupted `in_progress` run that has a plan. |
| Existing routes gated | `CampaignsService.schedule / activate` | refuse an unapproved / audience-less / stale campaign (`sendReadiness`), so the old routes cannot bypass approval. The sweep's move to `in_progress` now goes through the platform limits too (the code comment promised it; it never did). |
| Details overlay | screen `DetailDialog` | Overview (facts + every count with its definition, readiness, exclusion / send-time / provider reasons) · Recipients (search, status filter, own pages, consent now, booked / redeemed per customer, names masked without customer access) · Message · Delivery Events · Bookings & Redemptions · Financial Results · Audit History; Close + Escape; Duplicate / Continue setup / Move back to draft / Cancel (in-dialog confirmation, no browser dialog) |
| Check Campaign System | `POST pos/campaign-center/health-check` + table `campaign_health_runs` (739) | read-only: Twilio (tenant credentials, sender, last check — no secret shown), recent SMS failures, email provider key present, workers' heartbeats, overdue scheduled campaigns; per campaign: recipients, execution (explains "completed with no send record"), reporting mismatch (old counter vs ledger). Ready / Attention Required / Pending / Failed / Unknown with evidence and next step; correlation id stored. |
| Campaign Assistant | `POST …/assistant/suggest`, `…/assistant/draft` | goals: inactive (Retention's at-risk days; never-visited **excluded**), slow weekdays (8 weeks of paid tickets; capacity NOT checked — said so), new service, repeat visits. Live contactable count, message, timing, cost when priced, risks. Saves a **draft** (origin `assistant`) only. No AI provider call — rules over real data, labelled a suggestion. |
| Quick Actions / related cards | unchanged destinations | Create Campaign opens the wizard; Send SMS / Send Email open the channel views; Launch Promo / Issue Gift Card → Promotions; Request Review → Follow-ups; View Reports → Reports; the four related cards keep their routes. |

## 3. Files
- **Backend:** new `modules/communications/src/campaigns/campaign-center.ts`, `campaign-center.controller.ts`; changed `campaigns.service.ts`
  (readiness gate, `preflightLimits`, limits on the sweep's start), `campaigns.repository.ts` (`sendReadiness?` port), `campaigns.kysely.repository.ts`
  (`completed_at`, readiness), `campaigns.controller.ts` (dead `GET :id/cost-preview` removed — no caller after the rebuild), `campaigns.module.ts`,
  `request-schemas.ts`; `modules/ai/src/ai-marketing/ai-marketing-send.service.ts` (cancel stop, subject), `ai-marketing-send.adapters.ts`
  (`snapshotRecipients`, subject), `ai-marketing-send-sweep.ts` (raw-SQL due query incl. resume, subject), `ai-marketing-send-adapters-core.ts` (`dueForSend` resume).
- **Migration:** `apps/api/db/migrations/739_campaign_center.sql` (additive; rollback = drop the two tables and the new columns / indexes — no data was rewritten).
- **POS:** `screens/POSCampaignCenterScreen.tsx` (rebuilt in place), `api/posCampaignCenterApi.ts`, `i18n/ns/campaigns.{en,vi}.ts` (262 keys each),
  `i18n/ns/index.ts`, `i18n/ns/errors.{en,vi}.ts`, `styles.css`; `api/posCampaignsApi.ts` (dead `costPreview` removed); tests: `POSCampaignCenterScreen.test.tsx`
  rewritten (the `.channel` and `.cost-preview` tests merged into it and deleted).
- **Contracts / generated:** `packages/api-contracts/src/errors.ts` (13 codes), `packages/database/src/kysely.types.ts`, `actor-columns.generated.ts`,
  `apps/api/db/ownership/registry.generated.json` (`campaigns` now CONFIDENTIAL — stricter, from the new columns), openapi manifest, attack-surface docs,
  owner / tech error catalogs.
- **Tests:** `campaign-center.pgtest.vitest.spec.ts`, `campaign-center.postgres-race.vitest.spec.ts`, a new executor case in `ai-marketing-send.vitest.spec.ts`,
  a new `dueForSend` case. **Harness:** `tooling/catalog-one-screen/cc-extra.mjs` (seeded on demand), `interact-cc.mjs`, wired in `live-server.mjs` / `interact.mjs`;
  screenshots in `results/cc-e2e/`.

## 4. Evidence (31 Oct 2026, cloud workspace, PostgreSQL 16 `aps` template through 739, Chromium)
| Suite | Command | Result |
|---|---|---|
| Campaign Center pgtest (§19: data audit, distinct counts, snapshot, preview no-send, approval / stale / re-approval, launch, REAL executor with consent revoked after scheduling, opt-out, provider failure, zero-sent outcome, delivery callbacks, ROI only with cost, search beyond page 1, salon-tz inclusive dates, paging, tenant + branch isolation, old schedule route gated, health trace, assistant) | `FST_PG_TEMPLATE=aps REPO_ROOT=$PWD bash tooling/full-system-test/unit-standin/run.sh $PWD modules/communications/src/campaigns/campaign-center.pgtest.vitest.spec.ts` | **14/14** |
| Real-Postgres races (4 sessions): 8 launch taps → 1; launch vs edit never schedules unapproved content (4 rounds); 8 ledger claims → 1 row; 2 approvals → 1 consistent plan | `PG_RACE_URL=postgres://postgres@127.0.0.1:55432/cc_race … campaign-center.postgres-race.vitest.spec.ts` | **4/4**; **mutation check:** with the launch row lock + machine guard removed, 2/4 fail; restored → 4/4 |
| Send executor / sweep / adapters core | stand-in runner | 12/12 · 8/8 · 7/7 |
| Regression: campaigns 10/10, cost-preview 6/6, limits-core 23/23, oversight 5/5, delivery-queries 7/7, compliance-queries 8/8, segments 13/13 | stand-in runner | all pass |
| Campaign Center browser E2E (14 steps: preserved modules, spring into glow, overlay + health, SMS route, wizard → snapshot → review, approval → confirm → launch, worker run + re-run, recipient scope, paging, calendar, assistant, Vietnamese, 5 viewports incl. 1536×864 / 1440×900, Front Desk) | `FST_PG_TEMPLATE=aps REPO_ROOT=$PWD node tooling/catalog-one-screen/interact.mjs cc-e2e cc` | **14/14**, no page errors |
| Browser regression | `… interact.mjs cp-e2e cp` / `seg-e2e seg` | Coupons 14/14 · Segments 10/11 — the one failure is pre-existing from the Promotions harness (guide 4 seeds "Promo Tester", now the newest customer on Segments' "newest first" step); not caused by this work |
| Gates | all 61 `check:*` (51 via npm, 6 via the stand-in loader) | **57 pass**, 0 fail; 4 can't run here (lint, boot, api-contract, strict-bodies-types — see `docs/GATES_2026-10-31.md`) |

## 5. Guide §22 status per feature
| Feature | Status |
|---|---|
| spring into glow audit + honest labels, row untouched | COMPLETED_AND_VERIFIED |
| Distinct selected / eligible / queued / attempted / accepted / delivered / failed / unknown / booked counts | COMPLETED_AND_VERIFIED |
| SMS open rate not misrepresented; ROI N/A without cost | COMPLETED_AND_VERIFIED |
| Search (campaigns + recipients), calendar, numbered paging, newest first | COMPLETED_AND_VERIFIED |
| Six-step creation, preview, approval with invalidation, launch, move back to draft, duplicate, cancel stops future sends | COMPLETED_AND_VERIFIED (cancel via the existing route; mid-run stop proven in the executor unit test) |
| Pause / resume of an **in-progress** send | NOT_IMPLEMENTED — the CAMPAIGN machine has no paused state; cancel stops future sends; a scheduled campaign can go back to draft |
| Details overlay (recipients, exclusions, delivery, bookings, redemptions, revenue, audit, Close) | COMPLETED_AND_VERIFIED |
| Check Campaign System (read-only) | COMPLETED_AND_VERIFIED |
| Campaign Assistant (drafts only) | COMPLETED_AND_VERIFIED |
| Recipient export (guide §13 "export only for authorized roles") | NOT_IMPLEMENTED — no export button was added (nothing to leak); add with `@AsyncExport` + audit if wanted |
| Real SMS / email delivery through the salon's Twilio / the email provider | BLOCKED_EXTERNAL — never exercised here (test sender only); needs a staging tenant with real credentials and the owner's explicit authorization |
| Live delivery / engagement webhooks per campaign | IMPLEMENTED_NOT_VERIFIED — delivery callbacks reuse the existing signed `notifications` status path (read here by provider id); email opens / clicks are not ingested per campaign (shown as not tracked) |
| WebSocket refresh | IMPLEMENTED_NOT_VERIFIED — the screen subscribes to `campaigns / marketing / notifications` with the shared `useRealtime` (polling fallback); no server producer emits a campaign topic yet, so the polling fallback is what refreshes |
| POS + API type-check, `POSCampaignCenterScreen.test.tsx` | IMPLEMENTED_NOT_VERIFIED — needs CI (no node_modules here) |
| Query-builder suites `campaign-limits-enforcement.pgtest` (2/11), `ai-marketing-adapters-pgtest` (1/4) | IMPLEMENTED_NOT_VERIFIED — the same counts on the unchanged code; every failure is "query builder is not available" (CI) |
| Physical ASUS 27″ at 100 % | BLOCKED_EXTERNAL — browser viewports only (1920×945, 1536×864, 1440×900, 1366×768, 1024×768) |
| Migration 739 on staging / production | BLOCKED_EXTERNAL — owner approval |

## 6. Decisions and open owner questions
- **Approval = `marketing.manage`** (owner / manager by default), not a role-name list (repo rule: decide by permission). Self-approval is allowed and
  audited (`selfApproved` in the audit metadata). *Owner decision:* require a second person? (same question as Promotions.)
- **Personalization:** only `{salon_name}` and `{offer}`, resolved once when approved — the sender has no per-recipient merge, and there is no
  booking-link generator, so `{booking_link}` is not offered (never a placeholder in a real text).
- **Attribution:** revenue = paid tickets that redeemed a code issued for the campaign ("associated", not proven incremental); bookings = conversion
  events stamped with the campaign. *Owner decision:* an attribution window for bookings without a code.
- **Zero eligible:** Launch is refused (nothing would be sent) rather than "completing" an empty campaign.
- The ownership registry classifies `campaigns` CONFIDENTIAL now (heuristic on the new columns) — stricter than before; review if it should stay.
