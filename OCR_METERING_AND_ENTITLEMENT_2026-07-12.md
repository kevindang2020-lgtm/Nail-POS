# AIPowerSalon — Part 4: OCR metering + the entitlement gate (2026-07-12)

Receipt AI now *runs* (Parts 1–3). This part makes it **billable and bounded** — and found a money bug in each
direction.

---

## Two gaps, opposite directions, both about money

### 1. Nothing wrote to `ai_usage_logs` — OCR spend was invisible

Textract bills **per page**. The `ai_usage_logs` table exists, `KyselyAiUsageLogger` exists, and voice
transcription already binds it. OCR simply never did — so extraction produced no usage row, and OCR activity
appeared **nowhere** on the tenant or Super Admin AI Usage screens.

Now bound (same logger, no parallel table). One row per extraction.

### 2. Nothing called `evaluateAiAccess()` — extraction ran unentitled

`ai-access-gate.ts` describes itself as *"the enforcement heart of the business rule: a tenant must have an
active paid AI package before any AI runs."* `USAGE_LIMIT_REACHED` sits in this module's error taxonomy, mapped
to 429.

**It was never thrown.** Nothing in the OCR module called the gate. An expired trial, a cancelled package, a
suspended tenant, or one 400 scans past their 500-scan limit — all of them would have kept scanning. **Billed
to us, free to them.**

Now gated, **before** the provider is called: an unentitled tenant never costs a Textract page. The document
stays in `extracting` rather than being lost — it can be extracted once the subscription is sorted, or keyed in
by hand meanwhile.

---

## The subtle one: `scans` vs `pages`

I initially metered in **pages** — Textract's unit. That would have been a silent overcharge, and it is worth
spelling out why:

`ai-catalog.ts` sells this package as **500 `scans` included, 8¢ overage**. And the entitlement counter in
`ai-access.kysely.repository.ts` counts **rows** of successful usage against `includedUsageLimit`:

```sql
select count(*) ... where package_code = $1 and status = 'success' and created_at >= period_start
```

So **one extraction = one scan**, whatever its page count. A 5-page invoice metered as `5` would burn a tenant's
allowance **five times faster than the plan they bought**.

The two units are genuinely different things and are now kept apart:

| | unit | value |
|---|---|---|
| what the **tenant** is billed | `scans` | `1` per extraction |
| what the **platform** pays AWS | pages | `pages × OCR_COST_MICRO_USD_PER_PAGE` |

A test pins the multi-page case specifically, because that is the one that would have gone wrong quietly.

---

## Honesty rules in the metering

- **No usage row when no provider was ever called** (the default deployment). Nothing ran, nothing was billed —
  a zero-cost row would put phantom OCR activity on a tenant's usage screen for work that never happened.
- **A failed provider attempt IS logged** (`provider_error`, `usageAmount: 0`) — it may well have been billed to
  us — but it does **not** consume the tenant's scan allowance.
- **Tokens stay `0`.** Textract is not a token model; inventing token counts would corrupt the usage screens.
- **The cost is an estimate and is treated as one.** `cost_estimate_cents` defaults to AWS's *published list
  price*, not a figure read back from a bill, and is overridable via `OCR_COST_MICRO_USD_PER_PAGE` so a tenant
  on negotiated pricing does not silently accrue a wrong number.
- **A broken usage logger cannot fail an extraction that already succeeded.** A lost telemetry row is better
  than a lost receipt.

---

## Tests

| Spec | Result |
|---|---|
| `ai-ocr-receipt-usage.vitest.spec.ts` (new) | **16/16** |
| **whole OCR suite** (13 spec files) | **102/102 — zero regressions** |
| `route-collision.vitest.spec.ts` | **3/3** |
| pos-web sidebar↔route invariant | **7/7** |

Routes: **2,188, 0 collisions.** DI: **192/192 modules, 272/272 controllers, 97/97 services.**

Unchanged caveat: `npm install` will not complete in this sandbox, so the real vitest runner and `tsc --noEmit`
did not execute here. **Run `npm run typecheck && npm test` locally.**

---

## Files changed (4)

```
apps/api/src/ai-ocr-receipt/ai-ocr-receipt-usage.vitest.spec.ts   NEW — 16 tests
apps/api/src/ai-ocr-receipt/ai-ocr-receipt.service.ts             + usage metering, + AI entitlement gate
apps/api/src/ai-ocr-receipt/ai-ocr-receipt.module.ts              binds KyselyAiUsageLogger + KyselyAiAccessRepo
.env.example                                                      documented OCR_COST_MICRO_USD_PER_PAGE
```

---

## Two things I noticed and did NOT touch

1. **`ai/ai-receipt.ts` + `ai-prompts.ts` contain an LLM-based receipt-extraction path** (`RECEIPT_SYSTEM`,
   `RECEIPT_PROMPT`, `parseReceiptJson`) keyed to the same `ai_ocr_receipt_scanner` package. It is a *second*,
   independent way to read a receipt, and it is wired to the AI assistant, not to this pipeline. Two extraction
   paths under one package code is a real design question — LLM-as-fallback behind `OcrProvider` would be the
   clean answer — but it is a product decision, not a bug, so I left it alone and am flagging it.

2. **`evaluateAiAccess()` is called by only three places** (`ai-assistant`, `tenant-ai`, and now OCR). Whether
   the other AI modules — queue assignment, money protection, scheduling optimizer, review reputation — are
   meant to be gated too is worth a deliberate pass. I did not assume.
