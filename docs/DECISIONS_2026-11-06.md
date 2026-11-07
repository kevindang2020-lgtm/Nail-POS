# Decisions — Nov 6 2026 (Kevin: "can you pick best for my POS")

Kevin answered the open list. Items marked **yes** are his; the rest are picks made for a multi-tenant nail-salon POS that is
run by one founder today. Each pick favours: nothing a salon uses is removed, nothing sends or changes money on its own,
nothing locks the only Super Admin out, and every choice can be undone from a setting or a single change.

## Kevin's answers
| Item | Answer | What happens |
|---|---|---|
| Receipts PDF summary (§98) + pay-stub PDF (17.5) vs the no-print rule | **yes** | Both are downloads (PDF files), not print features: no print dialog, no print buttons. Expense PDF export built (85815cf); pay stub was built Oct 27. `check:no-print` stays green. |
| Real 27-inch touchscreen | **yes** — Kevin tests on the device | The one-screen checks run at 1920×945 in Chromium; touch feel on the real panel is his check. |
| Live Twilio | **yes** — Kevin sets it up | Every send goes through the salon messenger; without Twilio it takes the honest "not configured" path. |

## Picks
| Item | Pick | Why | Where |
|---|---|---|---|
| G8 review-request sender | **Built; OFF until a salon turns it on.** Sends every 5 min, expires anything more than 48 h late, re-checks settings, AI package, quiet hours and opt-out at send time, claims each request before sending (no double texts), salon name + its Google review link, one optional reminder after 72 h. | Checkout already scheduled requests that nothing ever sent; an automatic customer text must be opt-in and impossible to send twice or late. | `ai-review-reputation-sender.job.ts`, migration 823 |
| G8 automatic review replies | **Wired; OFF by default.** Publishes only with approval switched OFF, on a clean 5-star review, with a safe draft. Defaults never auto-publish (confidence floor 0.9 vs the analyzer's 0.8 — a salon that wants it lowers the floor). | A public reply in the salon's name must be the salon's explicit choice. | `ai-review-reputation-auto-reply.ts` |
| Batch C 1 — second approval on the global loyalty rule / program | **Dual control ON, with self-approval when you are the only Super Admin** (audited). Adding a second Super Admin turns real dual control on by itself. Emergency pauses are never held. | The guide wants two people; with one person a hard rule would block every change. | `global-rewards-dual-control.ts`, migration 824 |
| Batch C 2 — custom-earning flag off vs salons already on a custom rate | **Grandfather**: their current custom rate keeps working; no new custom changes; "Use global rules" always open. | Turning a flag off must not silently re-price customers' points. | engine pgtest, POS notice |
| Batch C 3 — how long inbox message text is kept | **24 months**, then the text is replaced with "[removed]"; the record (who/when/channel/status) stays; the 4-year notification ledger is unchanged. | Keeps a full year-over-year history for the salon, limits stored personal text, keeps TCPA evidence. | `retention-policy.json` |
| §73 separate expense permission keys | **Split** delete-draft / archive / bill-payments out of "manage expenses"; every role and saved custom role that had "manage" keeps them. | The role editor can now give "record expenses" alone; no one loses access. | migration 825 |
| G9 — when a backup is restored into live data | **Never in place.** Restore into a new database, verify, then cut over. Per-salon restores stay compare-only until the staging pilots and one drill are done. | A wrong restore over live data is the one mistake that cannot be undone. | `BACKUP_AND_DR.md` §4a |
| 845 untyped API routes | **New baseline, ratchet kept**: the 845 are recorded debt; any NEW untyped route fails the gate; type a module's routes when it is next changed. | Typing 845 routes at once risks working screens for no behaviour change. | `docs/api/API_CONTRACT_TYPES_DEBT.md` |
| Several terminals at once | **Proved in the pilot day** (phase 15): two POS terminals live on one queue, an assign race, a pay race, a retried tap. | This is what goes wrong on a busy floor. | `scripts/lib/pilot-multi-terminal.mjs` |
| Processors' webhook signing specs | **Webhooks are an accelerator, never the source of truth.** Keep HMAC-SHA256 over the exact raw bytes (raw body mandatory in production), fail closed without a secret; money truth comes from the processor inquiry (Verify / stranded sweep). When CardPointe / CommerceHub send their spec, only the header name / timestamp rule changes. | Works safely today without the spec; a missing or wrong webhook can delay, never double or lose, a payment. | `docs/integrations/webhooks.md`, payment-webhook.service |
| Production restore test | **Quarterly drill into a throw-away database** (never production) with `restore-verify.ts`; first one before launch. | Proves the backups open, without risk to live data. | HOSTING A3, `BACKUP_AND_DR.md` §4a |
| WAF and Secrets Manager | **Cloudflare WAF in front now** (managed rules + OWASP, challenge then block). **Railway variables for secrets at launch** (per environment, members limited), with the field-encryption keys kept only there; move to AWS Secrets Manager / KMS when the first enterprise or compliance customer asks. | Cloudflare is cheap and immediate; Secrets Manager adds cost and moving parts a one-person team does not need yet. | HOSTING A8, B5 |
| Real receipts for OCR accuracy | **Synthetic corpus stays the gate** (16 receipts, floors fail the suite); every low-confidence reading already goes to review. When Textract is on: scan 50 real salon receipts (supply stores, utilities, landlord, handwritten), compare against what was typed, and set the low-confidence threshold from the measured accuracy (readings below it always go to review; an OCR reading is never approved without a person today). | Real accuracy needs real receipts and the live provider; the review step keeps bad readings out until then. | `__fixtures__/receipts/README.md` |

## Added while finishing the guides (Nov 6, afternoon)
| Item | Pick | Why |
|---|---|---|
| A3 "All my salons" across separate legal entities (P4) | **Not built.** One login belongs to one salon; within a salon, every branch is compared. | Cross-salon views need an owner identity that spans tenants (and consent from each salon's owner); building it as a screen would quietly widen tenant isolation. |

## F5 §215 — server-state cache in pos-web / admin-web (Nov 6, picked under "pick best")

**Decision.** pos-web and admin-web keep per-screen fetch plus the shared realtime client, with targeted invalidation as in the
Smooth Refresh spec. No react-query cache is added to them.

**Why.**
- Each POS screen is a single-owner view that realtime events already refresh in place.
- A query cache would be a second invalidation system next to the realtime one.
- owner-, tech-, customer- and manager-pay-web already use `@tanstack/react-query` and stay as they are.
