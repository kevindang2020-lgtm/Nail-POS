# AI Receipt & Document Recognition — Receipt Review (POS) — Nov 2 2026

Guide: *AI Receipt & Document Recognition* (Kevin, Nov 1 2026). Route: `/tenant/ai/ocr-receipt` (unchanged).

## Audit findings (before the build)

| Area | Status | Finding |
|---|---|---|
| Tabs | **Broken** | The screen asked `GET /pos/ai-ocr-receipt/documents?status=…`, but the API reads `pipelineState` — so **every tab showed every document**. |
| In review | **Broken** | A document a person started reviewing (`in_review`) had no tab; it disappeared from every queue except "all". |
| Six cards | **Broken** | Counted from the first 200 rows of an unfiltered list; beyond 200 documents they were wrong. |
| Failed reads | **Broken** | `list().catch(() => ({ items: [] }))`: an API failure showed "Nothing here" / "No documents yet". |
| Return / Reject | Partial | Sent a fixed English word as the reason; the reason was then dropped from the audit row. |
| Approval evidence | Note | Approvals live in `ocr_reviews.decision_state` and the module's `audit_logs` rows; `ocr_approvals` (migration 344) is never written. The scanner's health check and trail were corrected to read the real records. |
| Pipeline (verified) | Verified | Upload validation, malware scan + quarantine with re-check, Textract via the AI gateway, manual entry, field confirm / correct, duplicate hold, dual approval rules, `posted` only from `approved`, idempotent postings, retry posting, offline capture queue, multi-page receipts. |
| Pre-existing tests | Note | 3 OCR pgtests fail on the untouched tree (`subtotal_cents` in PGlite, document number/date round-trip) — unchanged by this work. |

## What was built

- **Queues on `/pos/receipt-center/documents`** (shared with the scanner page): each tab is one exact queue
  (`review` = review required + in review, `extracting`, `manual_entry`, `reading_failed`, `duplicate_hold`, `approved` = approved +
  posting + posting failed, `posted`, `rejected`, `quarantined`), with search, which date, presets + From/To calendar, sort and
  numbered pages, newest first. Tab chips show each queue's size.
- **The six cards** read one tenant-scoped count of every pipeline state (`summary.states`); each opens its queue.
- **Errors are errors**: a failed read shows the reason with Try again, never an empty queue.
- **Return / Reject ask for the reason**; it is kept in the audit row (the decide step now records it).
- **Check Receipt & Document System** (read-only; same checks as the scanner page).
- `?doc=<id>` opens a receipt directly (the scanner page links here).
- **Retired**: `GET /pos/ai-ocr-receipt/documents` and `posAiOcrReceiptApi.list` (pinned in `receipt-review-routes.vitest.spec.ts`).
- Kept as they were: the upload panel (combine pages, quality guidance, offline queue), the review panel (preview, field confirm /
  correct, suggested-expense link, re-check scan, run extraction, retry reading, start review, approve, post, retry posting).

## Tests

- `receipt-center.pgtest.vitest.spec.ts` 8/8 (adds RV-01: exact queues + per-state counts) · `receipt-review-routes.vitest.spec.ts` 2/2.
- `POSAIOcrReceiptScreen.queues.test.tsx` 4/4 (new) · `POSAIOcrReceiptScreen.test.tsx` 6/6 (rewritten to the new list source).
- Sabotage: sending the old `status` filter name instead of the queue was caught.
