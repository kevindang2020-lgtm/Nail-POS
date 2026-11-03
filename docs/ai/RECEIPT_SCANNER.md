# AI OCR Receipt Scanner (POS) — Nov 2 2026

Guide: *AI OCR Receipt Scanner* (Kevin, Nov 1 2026). Route: `/tenant/ai/receipt-scanner` (unchanged).

## Audit findings (before the build)

| Area | Status | Finding |
|---|---|---|
| Page | Partial | The route rendered the generic add-on card only (price, usage, status, Cancel). The receipt pipeline itself lives in Receipt Review (`/tenant/ai/ocr-receipt`, guide 12). |
| Subscription display | **Broken** | The chip showed the stored row ("On trial") while Status said "Limited" and the lock text said "Your free trial has ended" — three answers. The honest state already existed (`/tenant/ai/usage-screen`, AI Usage & Limits guide) but the add-on pages did not use it. |
| Price | Bug | The card always showed the catalog list price, not the salon's subscription price. |
| Failed reads | **Broken** | `/tenant/ai/packages` swallowed DB errors into "not subscribed + Start trial" (pages no longer read it; owner-web still does — left as is). |
| Cancel | Partial | One click, no confirmation, no idempotency (the usage-screen action has both and is audited). |
| Receipt history | Missing | The old list stopped at 200 rows, had no search, dates or pages. |
| Pipeline (verified) | Verified | Upload validation + malware scan + private storage, Textract via the AI gateway (entitlement, kill switch, usage per scan), state machine where `posted` is reachable only from `approved`, idempotent postings through the finance module's ExpenseService / the InventoryService, duplicate detection (hash + perceptual hash), branch scope (audit F2). |
| Extraction job key | Note | The extraction job's idempotency key includes `Date.now()`, so it does not deduplicate two enqueues of the same document. Each upload enqueues once today; left as a note. |

## What was built

- **Every AI add-on page** (`AiPackagePanel`, used by booking, customer insights, checkout upsell, fraud, reviews and the scanner) now
  reads `/tenant/ai/usage-screen/packages/:code`: one state (Trial expired is never "On trial"), the salon's price (labelled plan vs
  catalog), current-period usage with its reset date, trial end date, next step. Start trial / Cancel confirm first and use the audited,
  idempotent actions. A failed read is an error. `posAiUsageApi.packages/startTrial/cancel` retired (no caller left in the POS).
- **`/pos/receipt-center/*`** (read only, `pos.ai_ocr_receipt.view`, not package-gated so scanned receipts stay visible after a trial ends):
  - `GET summary` — Scanned (uploaded in period) · Needs review (current queue) · Potential duplicates (open holds) · Approved expenses
    (approved from a receipt in the period, with the amount) · being read / failed / quarantined / approved-not-posted.
  - `GET documents` — search (vendor, receipt / invoice no., product or SKU on a line, exact amount, document or expense id), status
    groups, which date (upload · purchase · posted), presets + From/To in salon time, sort, pages of 10/25/50/100, newest first with a
    stable id tie; four separate tracks per receipt (reading · expense · stock receiving · duplicate).
  - `GET documents/:id` — fields with their state (confidence only when the provider gave one), lines with mismatch flags, the
    arithmetic check, duplicates (scoped), category suggestion, the expense / posting links and the approval trail.
  - `POST check` — Check OCR System, read-only, one run per salon per 30 s (subscription, reading service, stuck / failed reads,
    recent jobs, unsafe files held, originals fingerprinted, nothing posted without approval, no double posting, posting failures,
    review backlog, tenant isolation, no side effects).
- **POS screen** `POSAIReceiptScannerScreen`: the add-on header + Refresh / Check OCR System / Open Receipt Review, the cards with
  their definitions, what is stuck, the history, a read-only receipt overlay that links to Receipt Review. EN/VI (`pkgx.*`, `rcsx.*`, 223 keys).
- Migration 770: history indexes + `receipt_scanner_health_runs`.

## Tests

- `receipt-center.pgtest.vitest.spec.ts` 7/7 (cards, search incl. SKU and amount, groups + tracks, purchase-date filter, pages,
  branch scope, detail, health). Sabotage: dropping the branch scope and ignoring approvals in the health check were each caught.
- `POSAIReceiptScannerScreen.test.tsx` 5/5 · `POSAiPackageScreen.test.tsx` 4/4 (rewritten to the honest state) · 403 test 1/1.

## Decisions for Kevin

- owner-web still reads `/tenant/ai/packages` (the older, fail-open list). Move the Owner app to the usage-screen state too?
