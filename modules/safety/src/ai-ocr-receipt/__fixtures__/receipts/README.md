# Receipt OCR fixture corpus (§147 / §197)

Sixteen SYNTHETIC receipts and invoices, each a hand-written AnalyzeExpense-shaped provider response plus the values a
reviewer should see. No real customer data — vendors, numbers and dates are invented. They cover the mandate's test sets
(retail, restaurant, utility, equipment, subscription, landlord, nail supply, handwritten) and conditions (crumpled, faded
thermal, angled / ambiguous date, long, multi-page, discount, tax, refund, unreadable).

`ai-ocr-receipt-accuracy.vitest.spec.ts` drives every fixture through the real adapter (`normalizeAnalyzeExpense` →
`toFinancials` → `buildValidationReport` → `classifyDocument`), prints the accuracy matrix and fails below the floors.
Accuracy against the LIVE provider (Textract on real photos) stays BLOCKED_EXTERNAL until its credentials exist; this corpus
proves the adapter, the validator and the review routing, not the provider.
