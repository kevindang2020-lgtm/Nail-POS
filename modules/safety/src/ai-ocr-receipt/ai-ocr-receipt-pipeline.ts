// ai-ocr-receipt-pipeline.ts — the deterministic pipeline state machine + the normalized OCR provider interface.
// The state machine STRUCTURALLY enforces the core safety rule: the ONLY edge into 'posted' is from 'approved', and
// 'approved' is only reachable through review. There is no event that jumps extraction straight to posting. Quarantine
// and infected files never reach extraction; a suspected duplicate holds for review; and when no OCR provider is
// connected the result is honestly 'unavailable' (→ manual entry), never fabricated extraction.

export type PipelineState =
  | 'uploaded' | 'scanning' | 'quarantined' | 'rejected'
  | 'extracting' | 'extraction_failed' | 'manual_entry_required'
  | 'validating' | 'duplicate_hold' | 'review_required' | 'in_review'
  | 'approved' | 'posting' | 'posted' | 'failed';

export type PipelineEvent =
  | 'scan_clean' | 'scan_quarantine' | 'scan_infected'
  | 'extract_ok' | 'extract_failed' | 'extract_unavailable'
  | 'validate_ok' | 'validate_blocked' | 'duplicate_detected'
  | 'start_review' | 'approve' | 'reject' | 'return'
  | 'post_ok' | 'post_failed' | 'retry';

// Transition table. Absence of an (state,event) pair = invalid transition (rejected by transition()).
const TABLE: Partial<Record<PipelineState, Partial<Record<PipelineEvent, PipelineState>>>> = {
  uploaded: { scan_clean: 'extracting', scan_quarantine: 'quarantined', scan_infected: 'rejected' },
  scanning: { scan_clean: 'extracting', scan_quarantine: 'quarantined', scan_infected: 'rejected' },
  // `scan_infected` was missing here while `scanning` had it, so a quarantined file that a later scan confirmed
  // MALICIOUS could not be moved to `rejected` — it just sat in `quarantined` forever, indistinguishable from a
  // file that was merely still waiting for its verdict. Out-of-band scanners tag after the upload, so "quarantined
  // now, infected verdict later" is the normal order of events, not an edge case. Strictly tightening: `rejected`
  // is terminal, and nothing reaches extraction on this edge.
  quarantined: { scan_clean: 'extracting', scan_infected: 'rejected', retry: 'scanning' },
  extracting: { extract_ok: 'validating', extract_failed: 'extraction_failed', extract_unavailable: 'manual_entry_required' },
  extraction_failed: { retry: 'extracting' },
  manual_entry_required: { start_review: 'in_review' },      // human keys in the values, then reviews
  validating: { validate_ok: 'review_required', validate_blocked: 'review_required', duplicate_detected: 'duplicate_hold' },
  duplicate_hold: { start_review: 'in_review' },             // a person must resolve the duplicate
  review_required: { start_review: 'in_review' },
  in_review: { approve: 'approved', reject: 'rejected', return: 'review_required' },
  approved: { post_ok: 'posted', post_failed: 'failed' },    // posting only AFTER approval
  failed: { retry: 'approved' },                             // retry re-attempts posting from the approved state
};

export interface TransitionResult { ok: boolean; state: PipelineState; error?: string; }
export function transition(state: PipelineState, event: PipelineEvent): TransitionResult {
  const next = TABLE[state]?.[event];
  if (!next) return { ok: false, state, error: `invalid_transition:${state}->${event}` };
  return { ok: true, state: next };
}

/** Terminal states that need no further automatic action. */
export const TERMINAL: PipelineState[] = ['posted', 'rejected'];
export const isTerminal = (s: PipelineState) => TERMINAL.includes(s);
/** A document is postable only once it has been approved (never directly from extraction/validation). */
export const canPost = (s: PipelineState) => s === 'approved';

// ── normalized OCR provider interface ────────────────────────────────────────
export interface OcrFieldOut { key: string; text: string | null; cents?: number | null; confidence: number; page?: number; }
export interface OcrLineOut { description: string | null; quantity: number | null; unitPriceCents: number | null; lineTotalCents: number | null; confidence: number; }
export interface NormalizedOcrResult {
  unavailable: boolean;               // true → no provider could process it (honest, → manual entry)
  providerKey: string | null;
  textRedacted: string | null;
  pages: number;
  fields: OcrFieldOut[];
  lineItems: OcrLineOut[];
  overallConfidence: number;
}
/** §17 (Oct 27 2026): `pageKeys` — the extra page files appended to the document (page-2.jpg …); `storageKey` is page 1. */
export interface OcrInput { tenantId: string; documentId: string; storageKey: string; mime: string; pageCount: number; pageKeys?: string[]; }

/** §17: one document from several per-page readings — fields keep their page number, line items are concatenated in page
 *  order, a summary field read on more than one page keeps the most confident reading, `pages` is the number of pages read. */
export function mergeNormalizedResults(parts: NormalizedOcrResult[]): NormalizedOcrResult {
  const read = parts.filter((p) => !p.unavailable);
  if (!read.length) return { unavailable: true, providerKey: null, textRedacted: null, pages: 0, fields: [], lineItems: [], overallConfidence: 0 };
  if (read.length === 1 && parts.length === 1) return read[0];
  const fields: OcrFieldOut[] = []; const lineItems: OcrLineOut[] = []; const text: string[] = [];
  read.forEach((r, i) => {
    for (const f of r.fields) {
      const page = f.page ?? i + 1;
      const prior = fields.findIndex((x) => x.key === f.key);
      if (prior < 0) fields.push({ ...f, page });
      else if (f.confidence > fields[prior].confidence) fields[prior] = { ...f, page };
    }
    lineItems.push(...r.lineItems);
    if (r.textRedacted) text.push(r.textRedacted);
  });
  const all = [...fields.map((f) => f.confidence), ...lineItems.map((l) => l.confidence)].filter((c) => c > 0);
  return { unavailable: false, providerKey: read[0].providerKey, textRedacted: text.join('\n') || null, pages: parts.length, fields, lineItems, overallConfidence: all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0 };
}
export interface OcrProvider {
  key: string;
  connected: boolean;
  supports(mime: string): boolean;
  costRank: number;                   // lower = cheaper/preferred
  extract(input: OcrInput): Promise<NormalizedOcrResult>;
}

/** Honest default: no provider connected → unavailable, never fabricated data. */
export const DisconnectedOcrProvider: OcrProvider = {
  key: 'none', connected: false, costRank: Infinity, supports: () => false,
  async extract() { return { unavailable: true, providerKey: null, textRedacted: null, pages: 0, fields: [], lineItems: [], overallConfidence: 0 }; },
};

/** Order connected providers that support the mime, cheapest first. */
export function routeOcr(providers: OcrProvider[], criteria: { mime: string }): OcrProvider[] {
  return providers.filter((p) => p.connected && p.supports(criteria.mime)).sort((a, b) => a.costRank - b.costRank);
}

/** Try providers in routed order; return the first successful (non-unavailable) result, else unavailable. */
export async function runOcrWithFallback(providers: OcrProvider[], input: OcrInput): Promise<NormalizedOcrResult> {
  const ordered = routeOcr(providers, { mime: input.mime });
  for (const p of ordered) {
    try { const r = await p.extract(input); if (!r.unavailable) return r; } catch { /* try next provider */ }
  }
  return DisconnectedOcrProvider.extract(input);
}
