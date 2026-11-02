# Receipt, Expense, Invoice, OCR & Accounting — final report (mandate §209)

Oct 21 2026 · AI PowerSalon · branch `work/dual-screen-display` (local commit; nothing pushed — K-12)

The mandate asked for one integrated Finance capability, preserving what `ai_ocr_receipt` already had. That is what was
built: the OCR pipeline (upload → malware scan → Textract → validation → human review → approval) is unchanged in shape and
now posts into ONE new expense authority, `modules/finance`, which every screen and every report reads.

## A. Existing implementation found

| Area | What existed before | What happened to it |
|---|---|---|
| Migrations | `expenses` (id, tenant, branch, free-text category, amount, vendor, description, incurred_on) from the Owner App module; OCR tables 344 / 359 (`ocr_documents`, files, pages, extracted fields, line items, validation, review decisions, postings, attempts) | `expenses` extended in place (672); OCR tables kept, RLS policies added |
| Receipt services | `modules/safety/src/ai-ocr-receipt` — upload policy, blob store (private evidence bucket, signed previews), S3-tag malware scanner (fails closed), Textract AnalyzeExpense provider, dedup (file hash / perceptual hash / vendor-date-total / invoice), validation, review state machine, posting service | kept; posting now goes to the finance module; receipt events added |
| Expense services | `OwnerService` create / list / summary / update / hard delete on `expenses`; `InventoryService.saveReceiptExpense` raw insert | both delegate to the finance module (kept as wrappers, nothing removed) |
| OCR / AI | `POST /ai/ocr/scan-receipt` (AI gateway vision) used by the Inventory scan modal; a mock provider answered in production when no key was set | permission-checked; production without a key answers 503 |
| Workers | none for expenses | `BillReminderScheduler` (off by default) |
| Storage adapters | evidence blob store + scanner | unchanged |
| APIs | `/owner/expenses*`, `/pos/ai-ocr-receipt/*`, `/inventory/receipt-expense` | kept; `/owner/finance/*` added |
| Frontend | POS Payments → Expenses (list / add / delete); POS Receipt AI workspace; Owner App Expenses (list / add / delete) | POS and Owner App expense screens rebuilt on the finance module; Receipt AI workspace unchanged |
| Reports | Owner finance summary (net profit = revenue − commission − ALL expense rows) | approved expenses only |
| Tests | OCR unit suites (117), owner expense harness | + finance unit (32) and pgtests (18), screen tests, harness rebased |

## B. Problems found

| Class | Found | Fixed |
|---|---|---|
| P0 tenant data leak | none found in the existing code paths. `expenses.branch_id` had no same-salon trigger (B-58) — only reachable if a caller skipped the branch check | trigger + service check |
| P0 financial data corruption | the P&L subtracted every expense row and grouped free-text categories (B-54); a hard delete erased recorded costs (B-55) | status + approved-only; void with reason |
| P0 file security | none found (private bucket, signed URLs, fail-closed scanner) | — |
| P1 OCR / expense wiring | a branch-less receipt posted `''` into a uuid; a failed posting could never retry; postings recorded a placeholder document (B-53); the scan route had no permission and production could fabricate a receipt (B-56) | fixed |
| P1 duplicate detection | expenses had none (OCR had document-level dedup only) | exact / possible detection on every expense; a person decides |
| P1 reporting error | the finance dashboard's bill count would fail on real PostgreSQL (`date + unknown`, B-57); two "today" counts used the server's UTC day (B-60) | fixed |
| P2 missing feature | bills, reimbursements, rules, approvals, exports, import, history, events | built (C–R) |
| P3 cleanup | Owner App copy "Expenses (Labor)" (B-61); a Receipt AI client bug ignoring filters (B-59); a build break left by the previous milestone (B-62) | fixed |

## C. Final domain architecture

- **Receipt document** (`ocr_documents` + files / pages / fields / lines) is the EVIDENCE. It is never edited by finance.
- **Expense** (`expenses`) is the BUSINESS RECORD — one per receipt at most (`uq_expenses_receipt_document`), or manual,
  imported, or (by an owner) payroll. `receipt_document_id` links it to its evidence; `expense_documents` holds further files.
- **Vendor**: raw text on the expense (`vendor`), the directory row (`vendor_id` → `inventory_vendors`, the salon's one
  vendor list), linked on approval.
- **Category**: a KEY (ten defaults in code + the salon's own rows in `expense_categories`, each with an optional
  accounting code); `category_raw` keeps what the receipt / person typed; `category_source` says who decided.
- **Line items** (`expense_line_items`) — copied from the receipt or typed; each may carry its own category.
- **Bill** = an expense with `kind = 'bill'`, a due date and `bill_status`; payments in `expense_bill_payments`.
- **Reimbursement** = `reimbursement_status` on the expense (personal card → request → approve → pay).
- **Accounting export** reads approved expenses with their category's accounting code.

## D. OCR architecture

Provider: Textract AnalyzeExpense (`ai-ocr-receipt.textract.ts`), cheapest-first list; with no bucket / provider the list
is empty and the document routes to manual entry (never a guess). AI gateway: the separate quick scan
(`/ai/ocr/scan-receipt`) uses the gateway's vision provider; production with no key → 503. Worker: extraction runs inline
after a clean scan (`autoPipeline`) or on demand; a quarantined file is rescanned on demand. Structured output: fields
with confidence + line items; validation report; dedup verdict. Confidence: low-confidence fields are flagged for review;
nothing is ever approved by the OCR itself. Retry: extraction is retriable from `extracting`; a failed posting is retried
on the same idempotency key. Failure handling: provider failure → `manual_entry_required` + `expense_receipt.processing_failed`;
the bytes are kept.

## E. Receipt storage

Original bytes in the PRIVATE evidence bucket under `tenants/{t}/documents/{id}/original.{ext}` (exact, metadata not
stripped — it is evidence); SHA-256 file hash and perceptual hash in `ocr_document_files`; previews by short-lived signed
URL only; storage counted against the salon's quota; retention follows the evidence store's policy (unchanged).
**BLOCKED_EXTERNAL**: the bucket (`EVIDENCE_S3_BUCKET`) and its malware tagging are Kevin's AWS setup.

## F. Categorization (exact priority)

1. **Owner rule** — a rule the owner created (`kind = owner_lock`) for the vendor (+ keyword); never overridden by learning.
2. **Tenant vendor rule** — a rule this salon learned (second identical correction) for the vendor.
3. **Vendor + line rule** — a rule with a keyword matching a line description.
4. **System rule** — built-in vendor words (landlord / realty → Rent; Sally Beauty / CosmoProf / OPI / CND → Supplies; PSE&G / JCP&L / Comcast → Utilities; Google Workspace / QuickBooks → Software; Meta / Yelp → Marketing; State Farm → Insurance; ADP / Gusto → Payroll; Home Depot → Repairs; salon furniture → Equipment) and line-item hints (equipment vs. supplies vs. repair parts).
5. **AI recommendation** — only a key from this salon's list; port wired, no provider bound today.
6. **Fallback** — Other.

## G. Duplicate detection

File hash (exact, OCR side) · image similarity (perceptual hash distance, OCR side) · vendor + date + total (expense side:
same normalized vendor and total, dates within a day → possible; a different vendor text with the same total and date and a near-identical photo → possible) · invoice / receipt number (same vendor +
number → exact). A manual save that looks duplicated is refused with `RECEIPT_POSSIBLE_DUPLICATE` / `RECEIPT_DUPLICATE`
until the person gives a reason (`duplicate_status = overridden`); a flagged expense cannot be approved until someone
decides "not a duplicate" or "duplicate" (with a reason). Nothing is ever deleted automatically.

## H. Vendor architecture

Raw vendor text is kept as typed / read. `normalizeVendorName` lower-cases, strips punctuation, store numbers and legal
suffixes. On approval the expense is linked to the salon's vendor directory (matched by similarity, created if new).
Tenant vendor preferences are the salon's rules (F). A vendor's default category is the most-used approved category
(`GET vendors/:id/spend` shows it with month / year spend).

## I. Branch / tenant isolation — actual tests

`modules/finance/src/expense.pgtest.vitest.spec.ts` (migrated schema): another salon cannot list / read / approve an
expense; a MANAGER confined to B1 cannot write to B2 or list a B2 expense; a branch from another salon is refused; a
receipt from another salon cannot be posted; the salon's rules never leak to another salon.
`apps/api/scripts/verify-owner-expenses.ts`: foreign-tenant expense excluded from totals; manager branch scoping on list
and P&L; foreign id → not_found. `in-app-notification.pgtest`: another salon's bill event writes no alert.

## J. Permissions

`owner.expenses.view` (read, reports) · `owner.expenses.manage` (record, edit, submit, archive, bill payments, attach) ·
`owner.expenses.approve` (approve, reject, void, duplicate decisions, batch approve) · `owner.expenses.export` (CSV / XLSX)
· `owner.expenses.categories.manage` (categories, rules, settings) · `owner.expenses.reimbursements.manage` (approve / pay
a reimbursement) · `pos.ai_ocr_receipt.post` may post an approved receipt. OWNER: all. MANAGER: view, manage, approve,
export — at their own branch(es). ACCOUNTANT template: view, export. Front desk with `owner.expenses.manage`: records;
their expense waits for approval. Scopes come from the Owner App's branch rule (`resolveBranchScope`).

## K. Frontend (finished screens)

POS → Payments → **Receipts & Expenses**: dashboard KPIs, receipt upload (→ Receipt AI review), inbox tabs (Inbox / Needs
Review / Approved / Bills / Duplicates / Archived), add expense or bill with a category suggestion, approve / reject /
void / pay / archive / restore / delete draft, duplicate decisions, "where the money went", CSV / Excel export — English
and Vietnamese. Receipt Review and settings of the OCR itself stay in the existing Receipt AI workspace.

## L. Owner App

Expenses: camera ("Snap receipt"), photo or PDF upload, review inbox with approve, reject, to-draft, approve-all-clean,
set-category-for-all, duplicate decisions, bills and payments, reimbursements, attach a receipt, vendor history,
"where the money went" with export, categories (add, rename), vendor rules, settings, CSV import. Search is in the POS
screen; the Owner App filters by tab and period.

## M. Reports (formulas and sources)

Source: `expenses` with `status = 'approved'`, the salon's calendar (`tenant_settings` time zone). Day / week / month / year
= `incurred_on` within `periodWindow(period, today)`; the previous window for the change %. Category = `SUM(amount_cents)
GROUP BY category` (all ten defaults listed); vendor = by `vendor_id`, else raw vendor; branch = by `branch_id` ("Whole
salon" for none). The report proves `Σ category = Σ vendor = Σ branch = total` (`reconciles`). P&L: revenue − commission −
approved expenses. Payroll is never added from the payroll module (§90).

## N. Accounting export

CSV and XLSX: Date, Vendor, Category, Accounting code, Branch, Description, Subtotal, Tax, Total, Payment method, Receipt #,
Invoice #, Receipt attached, Status, then a TOTAL row. Cells starting `= + - @` are neutralised. Approved only unless
`includeUnapproved`. Large exports run as an async operation.

## O. AI expense insights (advisory only)

Category moves of ±15% or more (on categories that were ≥ $50 before, the three largest), possible duplicates waiting, receipts waiting for review, overdue bills, new
vendors this period; recurring charges detected (same vendor, similar amount, monthly cadence). They never change a number.

## P. Database

Migration **672_expense_finance.sql** (additive):
- `expenses` + status, kind, category_raw, category_source, vendor_id, receipt_document_id, subtotal / tax / tip / fee /
  discount cents, currency, payment_method, card_brand, card_last4, receipt / invoice / reference numbers, due_date,
  bill_status, paid_cents, paid_at, reimbursement_status, reimburse_user_id, reimbursed_at, recurring, duplicate_status,
  duplicate_of_id, duplicate_reason, source, tax_review_status, accountant_note, approved_by / at, rejected_reason,
  voided_by / at, void_reason, archived_at / by, idempotency_key, extraction_confidence, review_flags, bill_reminder_kind,
  bill_reminded_on, version. CHECKs on every vocabulary, card_last4, currency, paid ≤ total, bill shape.
- Unique: `(tenant_id, receipt_document_id)` while not voided; `(tenant_id, idempotency_key)`.
- Indexes: status / branch / category / vendor / bills / invoice / amount by tenant and date.
- Tables: `expense_categories`, `expense_category_rules`, `expense_line_items`, `expense_allocations`,
  `expense_documents`, `expense_bill_payments`, `expense_history`, `expense_settings` — each tenant-keyed, unique keys
  include `tenant_id`, same-salon triggers on every foreign key, RLS policy `tenant_isolation`.
- Backfill: `category_raw = category`; category → one of the ten keys (else `other`); `source = 'legacy'`; status `approved`
  (every existing row keeps counting).

## Q. APIs

New (`/owner/finance`): GET dashboard · GET reports · GET expenses/export · GET vendors/:vendorId/spend · GET expenses ·
GET expenses/:id · POST expenses · PATCH expenses/:id · DELETE expenses/:id · POST expenses/:id/{submit, return-to-draft,
approve, reject, void, archive, restore, duplicate-decision, bill-payments, reimbursement, documents} · POST
expenses/batch/{approve, categorize} · POST expenses/check-duplicates · POST expenses/recommend-category · POST
expenses/import · GET/POST expense-categories · PATCH expense-categories/:key · GET/POST expense-rules · DELETE
expense-rules/:id · GET/PUT expense-settings.
Changed: `/owner/expenses*` (delegate; delete = void), `POST /inventory/receipt-expense` (delegates), `POST
/pos/ai-ocr-receipt/documents/:id/post` (posts through finance), `POST /ai/ocr/scan-receipt` (permission; 503 without a key).

## R. Events & workers

Events: `expense_receipt.uploaded / extracted / review_required / processing_failed`, `expense.created / updated /
approved / rejected / voided / archived / duplicate_detected / reimbursement_changed`, `bill.payment_recorded /
due_soon / overdue` — all through the transactional outbox. Consumers: realtime projection → `expense_updated` (ids +
status); in-app notifications → owner alerts (bill due soon / overdue, possible duplicate). Worker: `BillReminderScheduler`
(hourly, `EXPENSE_BILL_REMINDERS_ENABLED=1`, `runTick` leased). Retry / DLQ: the outbox runner's existing retry ladder and
dead-letter. Idempotency: expense create (key), approve (state), bill payment (key), OCR post (document + version), bill
reminders (`bill_reminded_on`), consumer processed_events.

## S. Files changed

See the commit; the new files are `modules/finance/**`, `apps/api/db/migrations/672_expense_finance.sql`,
`apps/api/src/finance/finance-wiring.ts`, `apps/api/src/finance/finance-bindings.ts`,
`packages/api-contracts/src/tenant/finance.ts`, `modules/safety/src/ai-ocr-receipt/ai-ocr-receipt-events.ts`,
`modules/safety/src/ai-ocr-receipt/ai-ocr-receipt-lifecycles.ts`, this report.

## T. Tests

Actual results on Oct 21 2026 (this tree, after the fixes):

| Lane | Result |
|---|---|
| `modules/finance` unit (category engine, vendor names, money, duplicates, lifecycles, reports, export) | PASS 32 / 32 |
| `modules/finance` pgtest (isolation, versions, idempotency, duplicates, categories, reports ↔ export, bills, reimbursement, OCR post, import, outbox) | PASS 18 / 18 |
| `modules/safety` (OCR, incl. the new posting-retry test) | PASS 523, 3 skipped |
| `modules/analytics` · `inventory` · `tenants` · `ai` | PASS 279 · 29 (2 skipped) · 150 · 1,999 (14 skipped) |
| packages: realtime-contracts · realtime-client · api-contracts · permissions · events | PASS 4 · 28 · 97 · 108 · 12 |
| apps/api vitest | first pass 2,276 passed; the 61 files that then failed (60 could not load because of B-62, plus snapshot / IDOR / authz / outbox-wiring checks this work had to update) re-ran: PASS 719, 0 failed, 46 skipped (live-only lanes) — incl. the new finance-alert case in `in-app-notification.pgtest` |
| harness `verify-owner-expenses` (PGlite) | PASS 19 / 19 |
| POS web · Owner App web | PASS 1,387 · 343 (incl. Receipts & Expenses 11, Owner Expenses 13) |
| `ci:gates` (52 gates + 15 audits) | PASS after two regenerated records (OpenAPI manifest, one reviewed mass-assignment entry) |
| fresh real PostgreSQL 16 migration | PASS 612 applied (672 in 63 ms; 13 tenant-consistency triggers on the expense tables) |
| Textract reading a real receipt | BLOCKED_EXTERNAL — needs the AWS bucket + Textract |
| AI category suggestion | BLOCKED_EXTERNAL — no AI provider key; the deterministic rules decide |
| SMS / e-mail / push for bill reminders | BLOCKED_EXTERNAL — providers; in-app owner alerts work |
| Real salon day with receipts | BLOCKED_EXTERNAL — nothing is hosted |

## U. Build matrix

| Component | Result |
|---|---|
| API | PASS (typecheck, build of every module from source, 3,031 routes in the manifest) |
| POS | PASS (typecheck, 1,387 tests, `check:pos-i18n`) |
| Owner App | PASS (typecheck, 343 tests) |
| Super Admin | PASS (unchanged; frontend build gate) |
| Workers | PASS (`BillReminderScheduler` gated + leased; outbox consumers) |
| AI OCR | PASS for the pipeline / posting; real reading BLOCKED_EXTERNAL (Textract) |
| Object Storage | BLOCKED_EXTERNAL (evidence bucket); NotConnected degrades honestly |
| Database Migrations | PASS (fresh PostgreSQL 16, 612) |
| Unit Tests | PASS |
| Integration Tests | PASS (pgtests, harness) |
| Security Tests | PASS (authz baseline, role matrix, IDOR coverage, response exposure, mass assignment) |
| Tenant Isolation | PASS (finance pgtest, cross-tenant suite, harness, consumer tenant check) |

## Oct 27 2026 — close-out of the INTERNAL rows (mandate `docs/mandates/2026-10-27_RECEIPT_EXPENSE_OCR_MANDATE.txt`)

Strict section status: `docs/mandates/status/RECEIPT_EXPENSE_OCR_STATUS.md` — **192 DONE · 18 PARTIAL · 1 NOT DONE (§181,
decided against — allowed-not-required) · 1 BLOCKED_EXTERNAL (§127)** of 212 rows (was 145 / 46 / 20 / 1 at the audit).
Commits `9a0a1dd1` `86769c75` `25144e33` `063e03fb` `70d19425` `75d61e9d` `d6e499e8` `2eefe1de` (+ `aee55104` by the Remaining
Production agent: §29/§30/§47/§125). Migration **700** (expand-only). Nothing external changed: Textract / S3 / ClamAV / an AI key /
push-SMS-e-mail providers are still NotConfigured and every path degrades as before (quarantine, manual entry, in-app alerts).

### What was built (by mandate row)

| Rows | Built | Where | Proven by |
|---|---|---|---|
| §17 §18 §110 §137 §12 | Multi-page receipts: `POST /pos/ai-ocr-receipt/documents/{id}/pages` appends page 2, 3 … under ONE document (`ocr_document_pages` + a file row each, `page_count`); `deferExtraction` on the first upload holds the automatic reading until the pages are in; the provider receives every page key (one AnalyzeExpense per page, merged into one reading with `pages` = files); `source` names the channel (pos_upload / owner_app_upload / mobile_camera / web_upload / api_import). POS + Owner App: several photos → "one receipt or several?" (Combine / Separate) | `ai-ocr-receipt.service.ts` `appendPage`, `ai-ocr-receipt-pipeline.ts` `mergeNormalizedResults`, `ai-ocr-receipt.textract.ts`, `POSAIOcrReceiptScreen.tsx`, `ExpensesScreen.tsx` | `ai-ocr-receipt-close.pgtest` '§17 / §18', `POSAIOcrReceiptScreen.test` §18 ×2, `ExpensesScreen.test` §18, pilot 10d |
| §22 §25 §26 | Server-side image measurement and quality heuristics (dimensions from the header; luminance / contrast / sharpness from the decoded pixels; two receipts side by side) → `quality_flags` and the upload answer's `quality { flags, difficult }` — advice, never a rejection; both apps show "This receipt may be difficult to read — Retake photo / Process anyway" | `ai-ocr-receipt-quality.ts` (dependency-free; reuses the pHash decoder) | `ai-ocr-receipt-quality.vitest` 8, `ocr-close`, the two screen tests |
| §24 §159 §151 | Derivatives beside the untouched original: a grey PNG thumbnail (≤ 320 px) and, for an original over 2 MB, a review / OCR copy (≤ 1600 px); stored only with a bucket (NotConnected → `thumbnailKey` null, nothing pretended); the list carries the key, the POS draws it through the document-bound signed preview | `makeDerivatives`, `BlobFileStore.storeDerivative`, `KyselyDocStore` (`thumbnail_key` lateral join) | `ocr-close` 'a decodable image gets a thumbnail', `fin-scale` (no bytes column in a list) |
| §113 §114 §115 | Extraction leaves the request thread: the upload enqueues `ocr.receipt_extract` (the ONE job queue, class 'ai') and answers `extracting`; the worker runs the service's own `runExtraction`; the 5-minute sweep is the net. The retry ladder: a connected provider that fails → `extraction_failed` + `next_extraction_at` (1 min, 2 min; the sweep retries when due); the 3rd failure is the dead letter (no due time, `processing_failed` max_attempts, counted on the Super Admin overview); a person's `POST …/retry-extract` restarts it; no provider at all → manual entry at once | `ai-ocr-receipt.module.ts` (handler), `ai-ocr-receipt.service.ts`, `ai-ocr-receipt-pipeline.scheduler.ts` | `ocr-close` '§113 / §114 / §115' (end to end with a flaky provider), `sa-pg` |
| §35 §36 §37 §38 | The per-field reading (confidence + state) and the line items are PERSISTED (`ocr_extracted_fields`, `ocr_line_items`, breakdown + overall confidence on the row); a correction is STORED (manually_corrected / manually_confirmed, the document row updated); `GET documents/{id}` carries `fields` + `lineItems`; the POS review panel marks a weak field **Verify · NN%** with Confirm / Edit. (Found on the way: the old `correctField` received the field's NAME where the pure function expected the field object — every edit was lost.) | `KyselyDocStore.saveExtraction / extraction / saveFieldCorrection`, `POSAIOcrReceiptScreen.tsx` `FieldReview` | `ocr-close` '§35–§38', `POSAIOcrReceiptScreen.test` §38 |
| §142 §182 | Receipt → existing expense: `matchReceiptToExpenses` (vendor / date ±2 d / total / reference) → MATCHED / POSSIBLE_MATCH / UNMATCHED; stored on the document at review and in the review event; `GET /owner/finance/receipts/{documentId}/suggested-expense`; the POS offers "Link to that expense" (attach as the receipt) — never auto-linked | `expense-matching.ts`, `ExpenseService.suggestExpenseForReceipt`, `ai-ocr-receipt.service.ts` `finalizeExtraction` | `fin-close` §142, `ocr-close` §142, `POSAIOcrReceiptScreen.test` §142, pilot 10d |
| §62 §63 | Expense ↔ payment / bank transaction with the same vocabulary over a `PaymentFeedPort` (unbound today → UNMATCHED with the reason, never a fabricated match); `POST expenses/{id}/payment-match`, `POST expenses/{id}/payment-link` (a person confirms a statement reference / clears); columns on `expenses` | `expense-matching.ts` `matchExpenseToPayments`, `ExpenseService.matchPayment / setPaymentMatch` | `fin-close` §62/§63, pilot 10d |
| §83 | Owner auto-approval rules (`expense_settings.auto_approval_rules`): a receipt-backed expense from a trusted vendor at or under its threshold, money reconciling, no flag, no suspected duplicate → approved by the OWNER's rule (history `auto_approved`, `approved_by` null); anything else waits; Owner App "Approve automatically" panel | `autoApprovalDecision`, `ExpenseService.create / saveSettings`, `ExpensesScreen.tsx` | `fin-close` §83, `ExpensesScreen.test` §83, pilot 10d |
| §177 §178 §179 §121 | Five owner switches (needs review, bill due, duplicate, weekly, monthly) saved / read through the expense settings and honoured by the in-app consumer; four new alerts (receipt ready to review, receipt could not be read — never silenced, reimbursement awaiting approval, weekly / monthly summary); `sweepDigests` once per COMPLETED week / month per salon (`weekly_summary_sent_for` / `monthly_summary_sent_for`) → `expense.summary_ready` → the owner feed, on the hourly bill-reminder tick | `expense-digests.ts`, `ExpenseService.sweepDigests`, `bill-reminder.scheduler.ts`, `in-app-notification.consumer.ts` | `fin-close` §177 / §178-179, `in-app-notification.pgtest` (+1), `ExpensesScreen.test` §177 |
| §155 §156 §157 | Offline receipt capture (`@aipowersalon/mobile-sdk` `capture`): AES-GCM under a non-extractable IndexedDB key (refuses plain storage), synced on `online` / visibility / "Upload now", deleted the moment the server answers a `documentId`, 48 h TTL, capped at 50; wired into the POS Receipt AI upload panel and the Owner App | `receipt-capture-queue.ts` | 6 queue tests, `POSAIOcrReceiptScreen.test` §155, `ExpensesScreen.test` §155 |
| §131 | Nightly retention tick: documents past the salon's `retentionDays` (default 7 y, floor 30 d) are marked `retention_archived_at` — never deleted; a live expense keeps its document; `retention_hold` honoured | `sweepRetention`, `OcrPipelineScheduler.retentionTick` | `ocr-close` §131 |
| §74 §75 | The owner's `receptionist_upload` / `technician_upload` switches are enforced: upload + page append refuse a front-desk / technician caller with 403 and the reason until the switch is on; a front-desk manual entry is refused the same way; a technician records only a receipt paid personally (reimbursement). An approved receipt posting is exempt (it is the review's decision). The permission KEY for those roles is the Security agent's lane (§73 PARTIAL) | `uploadRefusalFor`, `ExpenseService.create` | `ocr-close` §74/§75, `fin-close` §74/§75 |
| §28 | The adapter also reads tip / gratuity (joins the reconciliation, lands on the expense), due date, payment terms, PO number (→ `reference_number`), vendor address / phone, time, a masked account reference | `ai-ocr-receipt.textract.ts`, `ai-ocr-receipt-validation.ts`, `postFromReceipt` | corpus `restaurant-tip`, `ai-ocr-receipt.textract.vitest` |
| §145 §149 | Super Admin OCR overview `metrics` (30 days): uploads, extracted, failed, OCR success, median read time, review rate, auto-category accuracy / correction rate (from `category_corrected` history), duplicate rate + the dead-letter count — counts and rates only, no salon named | `super-admin-ai-ocr-receipt.service.ts`, `AiOcrReceiptOversightScreen.tsx` | `sa-pg` 2 |
| §147 §197 | A synthetic receipt corpus (16 fixtures: retail, restaurant, utility, equipment, subscription, landlord, nail supply, handwritten; crumpled, faded, angled, long, multi-page, discount, tax, refund, unreadable) driven through the REAL adapter → validator → classifier: **100 %** on vendor / date / total / subtotal / tax / number / lines / type / review routing; every degraded reading routed to review with its reason. Two adapter faults found and fixed: the classifier read Textract's field-type NAMES (every receipt said "invoice" and "receipt"); a faded receipt without a subtotal was never reconciled against its lines | `__fixtures__/receipts/`, `ai-ocr-receipt-accuracy.vitest.spec.ts` | 17 / 17 |
| §205 | Scale pgtest: 1,000 receipts + 100,000 expenses (`SCALE_TESTS=1`; 10,000 routinely): one page of 50 (200 cap) + counted total, filters / search paged, dashboard and report aggregate in SQL and reconcile, EXPLAIN plans use the indexes (never a sequential scan of expenses), the OCR list capped at 200, ten postings idempotent. Full figure: 6 / 6 in 277 s on this 2-core host | `expense-scale.pgtest.vitest.spec.ts` | 6 / 6 |
| §181 | Decided, not built: the mandate allows but does not require purchase orders ("do not create a full procurement system unless already required"); the inventory module keeps its POs and the OCR posting already receives one through `inventory_receipt` | — | `NEXT_STEPS.md` |

### Honest limits that remain

- The reading itself: Textract / S3 / ClamAV are NotConfigured — uploads quarantine (scanner required) or go to manual entry (no provider), exactly as the pilot shows; the corpus proves the adapter, not the provider.
- §87 the category / vendor / payment-method chips are not drawn on the two list screens (the API takes them); §94 / §98 no expense ÷ revenue KPI label, no PDF summary export.
- §73 permission keys (`read_own`, `bills.*`, an upload-only key) — Security agent's lane; the service-side switches are ready for them.
- §201 the version-conflict test is sequential, not a true parallel race; §203 an expired signed URL is S3's refusal (BLOCKED_EXTERNAL).
- Push / SMS / e-mail delivery of the new alerts and summaries — providers (BLOCKED_EXTERNAL); the in-app feed carries them today.

### Gates and suites (this machine, TZ=UTC)

`check:openapi` (manifest), `check:api-contract` (types baseline), `check:attack-surface`, `check:db-ownership`, `check:actor-stamp`,
`check:event-producers` (catalog), `check:validated-bodies`, `check:list-queries`, `check:mass-assignment`, `check:critical-step-up`,
role matrix (snapshot), IDOR coverage (documentId fixture) — green for the files of this build; `npm run ci:gates` was run at the end
(failures in other lanes' files are listed in the hand-back, not here). Suites: see the status report's "Close-out" section.

### Pilot day — receipt step executed (Oct 27 2026)

`apps/api/scripts/live-pilot-day.mjs` phases 1–10 were run against the freshly built API (`build:packages` → `build:modules` →
`build:api`) on a fresh PostgreSQL database `pilot_ocr` (642 migrations). Both new 10d checks PASS — the evidence is in
`docs/pilot-runs/2026-10-27-receipt-ocr/pilot.txt` lines 116–117:

- **RECEIPT CLOSE-OUT — multi-page + quality (§12 / §17 / §18 / §25):** the upload answered 201 with its channel (`owner_app_upload`) and the server's
  quality verdict on a 1 px image (`low_resolution`, `washed_out`, `low_contrast`, difficult — accepted all the same); page 2 was appended under
  the SAME document (`pageCount` 2, one document id, never a second expense); the detail read back the channel and the flags.
- **FINANCE CLOSE-OUT — preferences, rules, matching (§177 / §83 / §142 / §62 / §63):** the monthly summary switched off with the others on;
  the auto-approval rule read back normalised (`pse and g electric`, 500.00, utilities); the unread receipt's suggested expense was UNMATCHED
  (nothing invented); the payment match without a transaction feed was UNMATCHED with the reason `no transaction feed connected`;
  a person's statement-reference link → `matched`; the settings were restored.

The run was 94 / 96 overall. The two failures are not in this mandate's surfaces: both are the Weekly Paycheck lane's new 10e2 checks
(a wrong QR handoff code answered `400 BAD_REQUEST` where the check expects `401 HANDOFF_TOKEN_INVALID`; its outbox query names
`column "payload"` where the table has `payload_json`). The API log and the PostgreSQL log were clean for the whole day.
