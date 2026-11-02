# REMAINING_WORK.md
### Everything left between this repo and a live salon — sized, grouped, honestly stated
The codebase itself has **no open buildable items**: every specced arc is complete, battery-stamped
(6,091 + 4, 0 failed), and documented. What remains falls into six groups; A–D are developer-executable once
the owner supplies the listed input, E is owner decisions, F is optional improvement. Task-by-task ordering
with IDs: DEVELOPER_TASKS.md.

## A. Credential-gated implementation (each ≈ days, not weeks)
1. **Tap to Pay capture call** — implement the real CommerceHub call inside the existing labeled socket; run
   the existing payment-attempt suites against the sandbox. *Needs: CommerceHub sandbox creds.* (PAYMENTS_INTEGRATION.md §4)
2. **Live SMS pass** — set Twilio env, run a real verification end-to-end, confirm callback signature handling
   against live traffic, watch the ledger/lifecycle land; then the SMS report's NOT-VERIFIED list shrinks.
   *Needs: Twilio account.* 
3. **Push on-device** — set APNs/Firebase env, register a real device per app, confirm delivery of the four
   wired triggers. *Needs: APNs .p8 + Firebase SA (+ devices).* 
4. **Live email** — SendGrid key + domain auth; templates exist. *Needs: SendGrid.*

## B. Hosting & go-live engineering (≈ 1–2 weeks first pass)
5. Choose host(s); provision Postgres 16; set envs per SECRETS_REQUIRED.md; run migrations; deploy API + static
   frontends; set real CORS origins + TLS + rate limits (the NOT-VERIFIED security items close here); enable
   the 7 workers' flags per environment; push to GitHub to activate security CI (PUSH_TO_GITHUB.md).

## C. Native apps & stores (Mac required)
6. Capacitor builds for customer/tech/owner/manager-pay; Face-ID flip; store assets; submissions
   (ANDROID_SUBMISSION_RUNBOOK.md, APPLE_APP_CODE_AUDIT.md, MOBILE_CONVERSION_HANDOFF.md).

## D. Physical-device validation
7. ASUS V470 checklist on the actual 27" screen; kiosk hardware pass; card-reader-in-hand checks once Fiserv
   hardware ships.

## E. Owner decisions (block specific items above)
SMS package pricing (then type numbers into the Super Admin editor — no deploy) · Schedule-A revenue-split
sign-off · §42 free-trial credit (post-pricing) · caller-number storage policy (privacy/attorney) · React
Router v7 upgrade timing · hosting choice itself.

## F. Optional improvements (real, not urgent)
Restructure the two single-file HTML apps into the app pattern · wire-or-prune passes through
UNUSED_ROUTE_INVENTORY.md · custom SMS credit expiry (becomes a credits table when a real need appears) ·
broader browser-e2e coverage beyond the current harnesses.

## What is deliberately NOT on this list
Printing of schedules, queues, or service tickets — removed by owner decision Jul 30 2026 and gate-blocked
(PRINT_FEATURES_REMOVED.md). Receipts are a different feature and remain supported.

Rebuilds, refactors, or renames of working systems (handoff spec rule); any item already closed in
PROJECT_STATUS.md; anything that would fake provider connectivity to look more finished.
