# AIPowerSalon — Part 3: OCR extraction bound; the pipeline now runs end to end (2026-07-12)

Third and final part. Part 1 made Receipt AI *reachable*, Part 2 gave it *storage and scanning*. This part binds
a real OCR provider — and, in doing so, found that **the entire middle of the pipeline was unreachable.**

---

## The headline defect: nothing ever ran extraction

`runOcrWithFallback()` existed. `finalizeExtraction()` existed. `OcrProvider` existed with a `DisconnectedOcrProvider`
default and a cheapest-first router. All of it was well designed, unit-tested — **and called by nothing.**

- `runOcrWithFallback` was referenced only by its own spec file.
- No controller route reached `finalizeExtraction`.

So a receipt that passed its malware scan moved to `extracting` and **stopped there. Permanently.** Combined
with Part 2's quarantine dead-end, a tenant could upload a receipt and it would simply never be seen again —
by any route, in any state.

**Added:**

- `AiOcrReceiptService.runExtraction(ctx, id)` — the missing stage
- `POST /pos/ai-ocr-receipt/documents/:id/extract` (gated `pos.ai_ocr_receipt.manage` — extraction *proposes*
  values for a human; it cannot approve or post)
- auto-chained after a clean scan when the tenant's `autoPipeline` is on (it is, by default). A failure there
  does **not** fail the upload — the bytes are safely stored, the document stays in `extracting`, and the
  reviewer presses **Run extraction**.
- pos-web: **Extracting** and **Manual Entry** tabs (neither state was visible anywhere) + a **Run extraction**
  button

---

## The provider: Textract `AnalyzeExpense`

Not generic OCR. `AnalyzeExpense` is purpose-built for receipts and invoices — it returns **typed** summary
fields (`VENDOR_NAME`, `TOTAL`, `TAX`, `INVOICE_RECEIPT_DATE`, …) and structured line items, instead of a bag of
words we would then have to guess at with regexes. Guessing is the one thing this module must never do: a
misattributed `TOTAL` posts the wrong number to a tenant's books.

It reads the object **straight out of `EVIDENCE_S3_BUCKET`** — the same bucket Part 2's blob store writes to.
No second bucket, no copy, no receipt bytes round-tripping through the API.

`OCR_TEXTRACT_ENABLED=0` is an explicit kill-switch, because Textract bills per page.

---

## Three more defects found while wiring it

### 1. `file_hash` was never written — exact-duplicate detection could never fire

The `ocr_document_files.file_hash` column existed. `toDoc()` mapped it. `dedupCandidates()` leaned on it as the
**strongest** duplicate signal. And the INSERT simply omitted it — so `fileHash` was always `null`, and an
identical re-upload of the same receipt could never be caught by hash. Now computed (sha256 of the original
bytes) at the only point where the bytes exist.

### 2. Manual-entry documents had no button

The state machine allows `manual_entry_required --start_review--> in_review`. The screen's `reviewable` flag
listed only `review_required` and `duplicate_hold`. So a document that landed in manual entry — which is where
**every** document lands when no provider is bound, i.e. the default deployment — could be *seen* but never
reviewed, never approved, never posted. Another dead end, in the most common configuration.

### 3. An `as DocumentFinancials` cast hid a missing required field

`DocumentFinancials.lineItems` is required; my first `toFinancials()` omitted it and the cast made it compile.
It blew up inside the validator at runtime, and a test caught it. The cast is gone — the type checker does its
job. Worth flagging because the same pattern is what let several of these gaps survive: **a cast, a mock, or an
empty `.catch()` at exactly the seam where the bug lived.**

---

## The safety property

The failure that matters here is not "OCR was wrong" — a reviewer catches that. It is **OCR quietly making
something up**: a fabricated total, a guessed vendor, or a synthesized confidence that suppresses the review
which would have caught it. So:

- **Every** failure path returns `unavailable` → `manual_entry_required`, never a partial guess. No SDK, no
  bucket, unsupported media type, throttled, access denied, malformed response, object missing, network down.
- **Unknown field types are ignored, not guessed at.**
- **Absent fields stay `null`.** `subtotal` is *not* computed as `total - tax` — a computed value a reviewer
  reads as "extracted" is a fabrication.
- **Confidence is passed through as Textract reported it**, never synthesized. No confidence reported → `0`,
  not an invented `1.0`.
- **An ambiguous date is flagged, not resolved.** `03/04` is two different months; a human decides.
- **Dedup uses the stored file hash**, never anything OCR produced.
- Extraction lands at `review_required` — **never past review**. Only `approved` can post, and only a human
  can approve.

---

## Tests

| Spec | Result |
|---|---|
| `ai-ocr-receipt.textract.vitest.spec.ts` (new) | **26/26** |
| `ai-ocr-receipt.blob.vitest.spec.ts` (Part 2) | **13/13** |
| `ai-ocr-receipt-rescan.vitest.spec.ts` (Part 2) | **8/8** |
| every pre-existing OCR spec (core, dedup, matching, pipeline, posting, review, settings, upload, validation) | **35/35** |
| **OCR suite total** | **82/82 — zero regressions** |
| `route-collision.vitest.spec.ts` (Part 1) | **3/3** |
| pos-web sidebar↔route invariant | **7/7** |

Route table: **2,188 routes, 0 collisions.** DI: **192/192 modules, 272/272 controllers, 97/97 services.**

Same caveat as Parts 1–2: `npm install` will not complete in this sandbox, so the real vitest runner and
`tsc --noEmit` did not execute here — the specs above were run against their real source through a
transpile + shim harness. **Please run `npm run typecheck && npm test` locally.**

---

## The pipeline, end to end, for the first time

```
upload → [sha256 + bytes → private S3] → scan
      → clean?      → extracting → Textract → validate → dedup → review_required
      → unscanned?  → quarantined ──[Re-check scan]──┘
      → infected?   → rejected
      → no provider → manual_entry_required ──[a person keys it in]──┘
                                    ↓
                        in_review → approved → posted (real expenses / PO receiving)
```

Every arrow above now exists. Before this session, four of them did not.

---

## To switch it on

```bash
EVIDENCE_S3_BUCKET=aipowersalon-evidence-prod   # private bucket — NOT the public media bucket
AWS_REGION=us-east-1
EVIDENCE_SCAN_ENABLED=1     # after attaching GuardDuty Malware Protection to that bucket
OCR_TEXTRACT_ENABLED=1      # Textract bills per page
```

The API's IAM role needs `s3:PutObject` / `s3:GetObject` / `s3:GetObjectTagging` on that bucket, plus
`textract:AnalyzeExpense`. With none of it set, everything degrades honestly: no bytes stored, no fabricated
preview URL, nothing reported clean, and every document routed to manual entry.

---

## Files changed in Part 3 (7)

```
apps/api/src/ai-ocr-receipt/ai-ocr-receipt.textract.ts              NEW — TextractOcrProvider + pure normalizer
apps/api/src/ai-ocr-receipt/ai-ocr-receipt.textract.vitest.spec.ts  NEW — 26 tests
apps/api/src/ai-ocr-receipt/ai-ocr-receipt.service.ts               + runExtraction(); auto-chain; mimeForKey()
apps/api/src/ai-ocr-receipt/ai-ocr-receipt.controller.ts            + POST documents/:id/extract
apps/api/src/ai-ocr-receipt/ai-ocr-receipt.module.ts                binds makeOcrProviders()
apps/api/src/ai-ocr-receipt/ai-ocr-receipt.blob.ts                  + file_hash (sha256) at upload
apps/pos-web/src/api/posAiOcrReceiptApi.ts                          + extract()
apps/pos-web/src/screens/POSAIOcrReceiptScreen.tsx                  + Extracting / Manual Entry tabs; manual-entry review
.env.example                                                        documented OCR_TEXTRACT_*
```

---

## Honest remaining gaps

1. **Perceptual (image) hashing is not bound** — `perceptualHash` is `null`. Exact duplicates are caught by
   sha256; a *re-photographed* copy of the same receipt is caught only by the vendor/number/date/total
   signature. Binding an image-hash library would tighten that. `null` is honest, not broken.
2. **Multi-page PDFs** are read via the synchronous `AnalyzeExpense` API, which is fine for receipts but caps at
   a few pages. Long invoices would need the async `StartExpenseAnalysis` flow.
3. **No OCR cost tracking.** Textract bills per page, and `ai_usage_logs` already exists with a mandatory
   `package_code` column. Extraction should be logging to it. It currently is not — that is the obvious next
   piece of work.
