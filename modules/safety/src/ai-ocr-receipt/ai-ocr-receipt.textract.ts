// ai-ocr-receipt.textract.ts — a real OCR provider, plus the pure mapping from a provider result to the
// financial fields the validator and the dedup engine consume.
//
// ── Why Textract AnalyzeExpense ──────────────────────────────────────────────────────────────────────────
// Not generic OCR. `AnalyzeExpense` is purpose-built for receipts and invoices: it returns typed SUMMARY fields
// (VENDOR_NAME, TOTAL, TAX, INVOICE_RECEIPT_DATE, …) and structured LINE ITEMS, rather than a bag of words we
// would then have to guess at with regexes. Guessing is exactly what this module must not do — a
// misattributed TOTAL posts the wrong number to a tenant's books.
//
// It also reads the object **directly out of S3** (`Document.S3Object`), so the receipt bytes never round-trip
// through the API. Same bucket the blob store writes to (EVIDENCE_S3_BUCKET) — no second bucket, no copy.
//
// ── The honesty contract ─────────────────────────────────────────────────────────────────────────────────
// Every failure path returns `unavailable: true`, which the pipeline turns into `manual_entry_required` — a
// person keys the values in. It NEVER returns a partially-guessed result. No SDK, no bucket, an unsupported
// media type, a Textract error, a throttle, a malformed response: all `unavailable`. There is no code path here
// that invents a vendor or a total.
//
// Confidence is passed through as Textract reported it (scaled 0..1), never synthesized. The validator uses it
// to decide what a human must look at, so a fabricated confidence would quietly suppress review.
import { createHash } from 'node:crypto';
import { classifyDocument, normalizeDate, parseMoney, redactSensitive } from './ai-ocr-receipt-core';
import type { NormalizedOcrResult, OcrFieldOut, OcrInput, OcrLineOut, OcrProvider } from './ai-ocr-receipt-pipeline';
import type { DocumentFinancials } from './ai-ocr-receipt-validation';
import type { DedupSubject } from './ai-ocr-receipt-dedup';

/** Textract AnalyzeExpense accepts these. HEIC and WEBP are NOT supported — we say so rather than failing oddly. */
const TEXTRACT_MIMES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/tiff']);

/** Textract reports confidence 0..100; the rest of this module works in 0..1. */
const pct = (c: unknown): number => {
  const n = Number(c);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(1, n / 100);
};

/** AnalyzeExpense summary-field types → our canonical field keys. Anything not listed is ignored, not guessed. */
const SUMMARY_KEY: Record<string, string> = {
  VENDOR_NAME: 'vendor',
  SUPPLIER_NAME: 'vendor',
  TOTAL: 'total',
  SUBTOTAL: 'subtotal',
  TAX: 'tax',
  AMOUNT_DUE: 'total',
  INVOICE_RECEIPT_DATE: 'document_date',
  INVOICE_RECEIPT_ID: 'document_number',
  RECEIPT_ID: 'document_number',
  DISCOUNT: 'discount',
  SHIPPING_HANDLING_CHARGE: 'fees',
};

const MONEY_KEYS = new Set(['total', 'subtotal', 'tax', 'discount', 'fees']);

/** Map a raw AnalyzeExpense response into our normalized shape. Pure — the unit tests drive it directly. */
export function normalizeAnalyzeExpense(res: any, providerKey: string): NormalizedOcrResult {
  const docs: any[] = res?.ExpenseDocuments || [];
  if (!docs.length) {
    // A response with no expense document is not "an empty receipt" — it is a failure to read one.
    return { unavailable: true, providerKey: null, textRedacted: null, pages: 0, fields: [], lineItems: [], overallConfidence: 0 };
  }

  const fields: OcrFieldOut[] = [];
  const lineItems: OcrLineOut[] = [];
  const textParts: string[] = [];

  for (const d of docs) {
    for (const sf of d?.SummaryFields || []) {
      const type = String(sf?.Type?.Text || '').toUpperCase();
      const key = SUMMARY_KEY[type];
      if (!key) continue;                                     // unknown field type → ignored, never guessed at
      const raw = sf?.ValueDetection?.Text ?? null;
      const conf = pct(sf?.ValueDetection?.Confidence);
      if (raw) textParts.push(`${type}: ${raw}`);
      const cents = MONEY_KEYS.has(key) ? (parseMoney(raw)?.cents ?? null) : undefined;
      fields.push({ key, text: raw, ...(cents === undefined ? {} : { cents }), confidence: conf, page: sf?.PageNumber ?? undefined });
    }

    for (const group of d?.LineItemGroups || []) {
      for (const li of group?.LineItems || []) {
        const byType: Record<string, { text: string | null; conf: number }> = {};
        for (const f of li?.LineItemExpenseFields || []) {
          const t = String(f?.Type?.Text || '').toUpperCase();
          byType[t] = { text: f?.ValueDetection?.Text ?? null, conf: pct(f?.ValueDetection?.Confidence) };
          if (byType[t].text) textParts.push(String(byType[t].text));
        }
        const qtyRaw = byType.QUANTITY?.text ?? null;
        const qty = qtyRaw != null && qtyRaw.trim() !== '' && Number.isFinite(Number(qtyRaw)) ? Number(qtyRaw) : null;
        const confs = Object.values(byType).map((v) => v.conf).filter((c) => c > 0);
        lineItems.push({
          description: byType.ITEM?.text ?? byType.PRODUCT_CODE?.text ?? null,
          quantity: qty,
          unitPriceCents: parseMoney(byType.UNIT_PRICE?.text ?? null)?.cents ?? null,
          lineTotalCents: parseMoney(byType.PRICE?.text ?? null)?.cents ?? null,
          confidence: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0,
        });
      }
    }
  }

  if (!fields.length && !lineItems.length) {
    // Textract answered, but recognised nothing usable. Manual entry — not an empty document.
    return { unavailable: true, providerKey: null, textRedacted: null, pages: 0, fields: [], lineItems: [], overallConfidence: 0 };
  }

  const all = [...fields.map((f) => f.confidence), ...lineItems.map((l) => l.confidence)].filter((c) => c > 0);
  return {
    unavailable: false,
    providerKey,
    // Redacted BEFORE it can be persisted: no full PAN or bank/routing run ever survives into stored text.
    textRedacted: redactSensitive(textParts.join('\n')) || null,
    pages: docs.reduce((n, d) => Math.max(n, ...(d?.SummaryFields || []).map((f: any) => Number(f?.PageNumber) || 1), 1), 1),
    fields,
    lineItems,
    overallConfidence: all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0,
  };
}

/** The financial view the validator consumes. Reads ONLY what the provider actually returned.
 *  No `as DocumentFinancials` cast here — an omitted required field would then compile and blow up at runtime
 *  inside the validator (which is exactly what happened while writing this). Let the type checker do its job. */
export function toFinancials(r: NormalizedOcrResult, opts?: { localePrefersDMY?: boolean }): DocumentFinancials {
  const f = (key: string) => r.fields.find((x) => x.key === key);
  const cents = (key: string) => f(key)?.cents ?? null;

  const dateRaw = f('document_date')?.text ?? null;
  const date = normalizeDate(dateRaw, opts);
  const totalCents = cents('total');

  return {
    type: classifyDocument(r.textRedacted).type,
    vendor: f('vendor')?.text ?? null,
    documentDate: date.iso,
    // A DMY/MDY ambiguity is FLAGGED for a human, never silently resolved — 03/04 is two different months.
    dateAmbiguous: date.ambiguous,
    subtotalCents: cents('subtotal'),
    taxCents: cents('tax'),
    feesCents: cents('fees'),
    discountCents: cents('discount'),
    totalCents,
    // A negative total is a credit/refund. parseMoney already told us the sign; we do not re-infer it from text.
    isCreditOrRefund: !!(totalCents != null && totalCents < 0) || !!parseMoney(f('total')?.text ?? null)?.negative,
    // The validator sums these against the total. Pass through exactly what the provider read — a line we could
    // not price stays null and makes the sum fail loudly, rather than being dropped to force a clean balance.
    lineItems: r.lineItems.map((l) => ({ lineTotalCents: l.lineTotalCents })),
    fieldConfidences: r.fields.map((x) => x.confidence),
  };
}

/** The dedup key. `fileHash` comes from the stored bytes, NOT from extraction — it is the strongest signal. */
export function toDedupSubject(r: NormalizedOcrResult, fin: DocumentFinancials, fileHash: string | null): DedupSubject {
  const f = (key: string) => r.fields.find((x) => x.key === key);
  return {
    fileHash,
    perceptualHash: null,          // no image-hash library is bound; null is honest (dedup falls back to the other signals)
    vendor: fin.vendor,
    documentNumber: f('document_number')?.text ?? null,
    documentDate: fin.documentDate,
    totalCents: fin.totalCents,
  };
}

/** sha256 of the original bytes — the exact-duplicate signal. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

export interface TextractConfig {
  bucket: string;
  region?: string;
  keyPrefix?: string;
}

export class TextractOcrProvider implements OcrProvider {
  readonly key = 'aws-textract';
  readonly costRank = 10;
  private client: any;

  constructor(private readonly cfg: TextractConfig, private readonly injectedSdk?: any) {}

  get connected(): boolean {
    return !!this.cfg.bucket && !!this.sdk();
  }

  supports(mime: string): boolean {
    return TEXTRACT_MIMES.has(String(mime || '').toLowerCase());
  }

  // Resolved at RUNTIME: the AWS SDK is a production-only dependency and is absent in dev/test. The evidence
  // blob store and the scanner both lazy-load it the same way; a static import would break every build that
  // does not install it.
  private sdk(): any | null {
    if (this.injectedSdk) return this.injectedSdk;
    try {
      const req: NodeRequire = eval('require');
      return req('@aws-sdk/client-textract');
    } catch {
      return null;
    }
  }

  async extract(input: OcrInput): Promise<NormalizedOcrResult> {
    const unavailable = (): NormalizedOcrResult =>
      ({ unavailable: true, providerKey: null, textRedacted: null, pages: 0, fields: [], lineItems: [], overallConfidence: 0 });

    if (!this.supports(input.mime)) return unavailable();
    const mod = this.sdk();
    if (!mod || !this.cfg.bucket || !input.storageKey) return unavailable();

    try {
      if (!this.client) this.client = new mod.TextractClient({ region: this.cfg.region });
      const name = this.cfg.keyPrefix
        ? `${this.cfg.keyPrefix.replace(/\/+$/, '')}/${input.storageKey.replace(/^\/+/, '')}`
        : input.storageKey;

      const res = await this.client.send(new mod.AnalyzeExpenseCommand({
        Document: { S3Object: { Bucket: this.cfg.bucket, Name: name } },
      }));
      return normalizeAnalyzeExpense(res, this.key);
    } catch {
      // Throttled, denied, malformed, object missing, network down — none of those is "an empty receipt".
      // Report unavailable and let a person key it in. Never a partially-guessed extraction.
      return unavailable();
    }
  }
}

/**
 * Build the OCR provider list from the environment. Same bucket as the blob store — the object Textract reads
 * is the object we wrote. With no bucket you get an EMPTY list, and `runOcrWithFallback` then returns
 * `unavailable` → manual entry. Nothing is ever fabricated in the absence of a provider.
 */
export function makeOcrProviders(env: NodeJS.ProcessEnv = process.env): OcrProvider[] {
  const bucket = env.EVIDENCE_S3_BUCKET;
  if (!bucket) return [];
  if (env.OCR_TEXTRACT_ENABLED === '0') return [];       // operator kill-switch (Textract is billed per page)
  try {
    return [new TextractOcrProvider({
      bucket,
      region: env.OCR_TEXTRACT_REGION || env.EVIDENCE_S3_REGION || env.AWS_REGION,
      keyPrefix: env.EVIDENCE_S3_PREFIX,
    })];
  } catch {
    return [];
  }
}
