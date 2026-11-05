# AIPowerSalon — Part 2: AI Receipt & Document AI, completed (2026-07-12)

Follow-on to `WIRING_AUDIT_AND_FIXES_2026-07-12.md`. Part 1 made the Receipt AI feature *reachable*. This part
makes it actually **work**: real file storage, real malware scanning, and the three defects that would have
bricked it the moment it was switched on.

**No new infrastructure was added.** `common/evidence-blob-store.ts` already existed, and its own header says
it is *"PRIVATE object storage for Safety Community evidence **and OCR receipt files**"*. It was built for this
and OCR was never connected to it. All of the below is wiring.

---

## Why the evidence bucket, not `MediaStorage`

The tidy-looking "don't duplicate" answer would have been to reuse `MediaStorage` (tech-profile). It would also
have been a data breach. `MediaStorage.put()` returns a **public** URL under `/media/`, and `media/(.*)` is
explicitly excluded from the session middleware — it is world-readable by design, because it serves avatars and
showcase photos.

Receipts are vendor invoices: totals, account numbers, supplier terms. Putting them behind a public CDN URL
would publish a tenant's payables. The evidence store is private-by-default with short-lived signed reads,
which is exactly the shape a receipt needs. Both now share one bucket (`EVIDENCE_S3_BUCKET`).

---

## Three defects found while wiring it — each one alone would have bricked the feature

### 1. The scanner was being asked about a key that was never written

`DbFileStore` hardcoded `tenants/{t}/**ocr**/{id}/original.{ext}`, while `ai-ocr-receipt.service.ts` hands the
scanner `storageKeyFor(...)` = `tenants/{t}/**documents**/{id}/original.{ext}`. **The two never matched.**

Invisible only because the scanner was a no-op that ignored its argument. The instant a real scanner was wired,
it would have looked up an object that did not exist and reported `unscanned` — forever, for every file.
`BlobFileStore` now uses `storageKeyFor()` for both. A test pins it.

### 2. Every uploaded receipt would have been permanently quarantined

`malwareScanRequired` **defaults to `true`**. Every credible S3 scanner (GuardDuty Malware Protection, a ClamAV
lambda) tags the object **out of band**, seconds-to-minutes after upload. So the scan taken at upload time is
almost always `unscanned` → `resolveScanDisposition()` → **quarantine**.

And there was no way to ask again. **Every receipt a tenant uploaded would have gone into quarantine and stayed
there.** The feature would have bricked itself on day one.

The state machine had already anticipated this — `quarantined --scan_clean--> extracting` is a defined edge.
Nothing walked it. Added:

- `AiOcrReceiptService.rescan(ctx, id)` — re-asks the scanner and applies **only** what it actually said
- `POST /pos/ai-ocr-receipt/documents/:id/rescan` (gated on `pos.ai_ocr_receipt.manage` — it releases a file
  into extraction; it does not approve or post anything)
- pos-web: a **Quarantined** tab (quarantined documents were not visible *anywhere* in the UI) and a
  **Re-check scan** button

### 3. A file confirmed MALICIOUS could not be rejected

Caught by a test I wrote for #2. The transition table gives `scanning` a `scan_infected` edge but **not**
`quarantined`. Since out-of-band scanning means "quarantined now, verdict later" is the *normal* order of
events, a file a later scan confirmed **infected** had nowhere to go — it sat in `quarantined`, indistinguishable
from one merely still awaiting its verdict.

Added `quarantined: { … scan_infected: 'rejected' … }`. Strictly tightening: `rejected` is terminal.

### Bonus: previews could never have been requested

`DocRecord` had no `storageKey` and `KyselyDocStore.get()` never selected `storage_key` — so the screen's
`doc.storageKey` was always `undefined` and `previewUrl()` was **never even called**. Now exposed.

---

## The safety property

Everything here is built so that the two failures that would be *worse than no feature at all* are impossible:

1. **It cannot fabricate a preview URL.** No bucket, or a store that declines to sign → the honest
   `notconnected:<key>` marker, never an `https://` link a reviewer could click and believe.
2. **It cannot report a file clean.** No tag, a failed scan, an access-denied, a network blip, a missing SDK,
   or any unrecognised tag value → `unscanned`. There is no input, no state, and no number of retries that
   releases an unscanned file. Tests assert exactly this, in both adapters and in `rescan()`.

An upload also now **fails** if the blob write throws, rather than recording a metadata row pointing at an
object that is not there — the tenant would otherwise believe the receipt was filed while the original was gone.

---

## Tests

| Spec | Result |
|---|---|
| `ai-ocr-receipt.blob.vitest.spec.ts` (new) | **13/13** |
| `ai-ocr-receipt-rescan.vitest.spec.ts` (new) | **8/8** |
| `ai-ocr-receipt-pipeline.vitest.spec.ts` (existing — regression check) | **5/5** |
| `route-collision.vitest.spec.ts` (Part 1) | **3/3** |
| pos-web sidebar↔route invariant | **7/7** |

Route table: **2,187 routes, 0 collisions.** DI: **192/192 modules, 272/272 controllers, 97/97 services.**
All 11 changed files parse cleanly under TypeScript 5.6.

Same caveat as Part 1: `npm install` will not complete in this sandbox, so full `tsc --noEmit` and the real
vitest runner did not execute here — the specs above were run against their real source through a transpile +
shim. **Please run `npm run typecheck && npm test` locally.**

---

## To switch it on

```bash
EVIDENCE_S3_BUCKET=aipowersalon-evidence-prod   # private bucket — NOT the public media bucket
AWS_REGION=us-east-1
EVIDENCE_SCAN_ENABLED=1                          # only after a scanner is attached to the bucket
```

Attach **GuardDuty Malware Protection for S3** to that bucket. It tags objects with
`GuardDutyMalwareScanStatus` and requires **no code change** — `S3TagEvidenceScanner` already reads that tag by
default. With `EVIDENCE_S3_BUCKET` unset, everything stays NotConnected and honest.

Leaving `EVIDENCE_SCAN_ENABLED=0` while the bucket IS set is a valid intermediate state: files store and preview
normally, and scanning reports `unscanned` — so set `malwareScanRequired: false` in the tenant's OCR settings if
you want uploads to flow before the scanner is attached.

---

## Files changed in Part 2 (9)

```
apps/api/src/ai-ocr-receipt/ai-ocr-receipt.blob.ts               NEW — BlobFileStore + EvidenceMalwareScan
apps/api/src/ai-ocr-receipt/ai-ocr-receipt.blob.vitest.spec.ts   NEW — 13 tests
apps/api/src/ai-ocr-receipt/ai-ocr-receipt-rescan.vitest.spec.ts NEW — 8 tests
apps/api/src/ai-ocr-receipt/ai-ocr-receipt.module.ts             binds the real bucket + scanner
apps/api/src/ai-ocr-receipt/ai-ocr-receipt.kysely.ts             − 3 superseded adapters; + storage_key
apps/api/src/ai-ocr-receipt/ai-ocr-receipt.service.ts            + rescan(); DocRecord.storageKey
apps/api/src/ai-ocr-receipt/ai-ocr-receipt.controller.ts         + POST documents/:id/rescan
apps/api/src/ai-ocr-receipt/ai-ocr-receipt-pipeline.ts           quarantined --scan_infected--> rejected
apps/pos-web/src/api/posAiOcrReceiptApi.ts                       + rescan()
apps/pos-web/src/screens/POSAIOcrReceiptScreen.tsx               + Quarantined tab + Re-check scan
.env.example                                                     documented the storage/scanner vars
```

`DbFileStore`, `NotConnectedMalwareScan`, and `InMemoryFileStore` were **deleted** rather than deprecated —
nothing referenced them, and leaving them meant the broken key shape could be re-wired by mistake.

---

## What is genuinely still not built

**OCR extraction itself.** `OcrProvider` is an interface with `connected: boolean`, and no provider is bound —
so `extract()` honestly reports `unavailable` and the document routes to `manual_entry_required`, where a person
keys in the values and reviews them. That is the honest behaviour, not a bug, but it does mean "AI Receipt
Scanner" currently means *"stores, quarantines, routes, reviews, and posts receipts"* — a human still reads the
numbers off the image.

Binding a provider (Textract / Google Document AI / Azure Document Intelligence) to `OcrProvider` is the last
step, and the pipeline is already built to route to the cheapest connected one and fall back honestly.
