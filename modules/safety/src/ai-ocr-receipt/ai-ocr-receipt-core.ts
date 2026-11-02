// ai-ocr-receipt-core.ts — PURE document classification + financial normalization. No I/O, no provider calls,
// deterministic and unit-testable. Money is ALWAYS integer cents (platform invariant). Dates and reconciliation FLAG
// ambiguity rather than guessing, because this output feeds financial records that a human must review. Document/OCR text
// is UNTRUSTED: this module parses it as data and never executes anything embedded in it. Card/bank numbers are masked to
// the last 4 at extraction — full PANs and bank credentials are never produced or stored.

export type DocumentType =
  | 'receipt' | 'invoice' | 'utility_bill' | 'purchase_order' | 'packing_slip' | 'credit_memo' | 'refund_receipt'
  | 'expense_reimbursement' | 'inventory_receiving' | 'subscription_invoice' | 'unknown' | 'unsupported';

export type ConfidenceState = 'high' | 'medium' | 'low' | 'missing' | 'conflicting' | 'manually_confirmed' | 'manually_corrected';

export interface LineItem {
  description: string | null; sku: string | null; quantity: number | null; unit: string | null;
  unitPriceCents: number | null; discountCents: number | null; taxCents: number | null; lineTotalCents: number | null;
  confidence: number; reconciles: boolean | null; sourcePage?: number | null;
}

// ---- document classification (deterministic baseline; a provider/LLM may enrich, never override a human) ----
const TYPE_TERMS: Record<Exclude<DocumentType, 'unknown' | 'unsupported'>, string[]> = {
  invoice: ['invoice', 'invoice #', 'invoice no', 'bill to', 'net 30', 'amount due', 'remit to'],
  receipt: ['receipt', 'thank you for your purchase', 'change due', 'cash tendered', 'subtotal', 'auth code'],
  utility_bill: ['electric', 'utility', 'kwh', 'water usage', 'gas service', 'account number', 'service period'],
  purchase_order: ['purchase order', 'p.o.', 'po number', 'po #', 'ship to', 'order date'],
  packing_slip: ['packing slip', 'packing list', 'items shipped', 'qty shipped', 'no charge'],
  credit_memo: ['credit memo', 'credit note', 'credit applied'],
  refund_receipt: ['refund', 'return receipt', 'refunded to', 'return authorization'],
  expense_reimbursement: ['reimbursement', 'expense report', 'reimburse'],
  inventory_receiving: ['goods received', 'receiving report', 'grn', 'received qty'],
  subscription_invoice: ['subscription', 'recurring', 'billing period', 'renews on', 'monthly plan'],
};

export interface ClassificationResult { type: DocumentType; confidence: number; alternatives: { type: DocumentType; score: number }[]; }

export function classifyDocument(text: string | null): ClassificationResult {
  const t = (text || '').toLowerCase();
  if (!t.trim()) return { type: 'unknown', confidence: 0, alternatives: [] };
  const scored = (Object.keys(TYPE_TERMS) as (keyof typeof TYPE_TERMS)[])
    .map((type) => ({ type: type as DocumentType, score: TYPE_TERMS[type].reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return { type: 'unknown', confidence: 0.3, alternatives: [] };
  const top = scored[0];
  const second = scored[1];
  // confidence from the margin between the top two candidates
  const margin = second ? (top.score - second.score) / top.score : 1;
  const confidence = Math.min(0.95, 0.5 + 0.45 * margin);
  return { type: top.type, confidence: Math.round(confidence * 100) / 100, alternatives: scored.slice(1, 4) };
}

// ---- money parsing (→ integer cents) ----
export interface ParsedMoney { cents: number; negative: boolean; }
export function parseMoney(raw: string | null): ParsedMoney | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const negative = /^-|\(.*\)|\bCR\b|credit/i.test(s) || /-\s*[\d$]/.test(s);
  const cleaned = s.replace(/[^0-9.,]/g, '');
  if (!/\d/.test(cleaned)) return null;
  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    // both present — the rightmost is the decimal separator
    const decIsComma = lastComma > lastDot;
    normalized = decIsComma ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const after = cleaned.length - lastComma - 1;
    normalized = (cleaned.indexOf(',') === lastComma && after <= 2) ? cleaned.replace(',', '.') : cleaned.replace(/,/g, '');
  } else {
    normalized = cleaned; // only dots (or none) — treat dot as decimal
  }
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return { cents: Math.round(Math.abs(n) * 100), negative };
}

// ---- date normalization (flags ambiguity) ----
export interface NormalizedDate { iso: string | null; ambiguous: boolean; original: string; candidates: string[]; }
const pad = (n: number) => String(n).padStart(2, '0');
const validYMD = (y: number, m: number, d: number) => y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31;

/** Normalize a date string. `localePrefersDMY` (from tenant locale/document country) resolves ambiguous numeric dates. */
export function normalizeDate(raw: string | null, opts?: { localePrefersDMY?: boolean }): NormalizedDate {
  const original = String(raw ?? '').trim();
  if (!original) return { iso: null, ambiguous: false, original, candidates: [] };
  // ISO YYYY-MM-DD — unambiguous
  const iso = original.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) { const y = +iso[1], m = +iso[2], d = +iso[3]; return validYMD(y, m, d) ? { iso: `${y}-${pad(m)}-${pad(d)}`, ambiguous: false, original, candidates: [] } : { iso: null, ambiguous: false, original, candidates: [] }; }
  // numeric with 4-digit year at the end
  const dmy = original.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (dmy) {
    let a = +dmy[1], b = +dmy[2]; let y = +dmy[3]; if (y < 100) y += y < 50 ? 2000 : 1900;
    const asMDY = validYMD(y, a, b) ? `${y}-${pad(a)}-${pad(b)}` : null;   // a=month
    const asDMY = validYMD(y, b, a) ? `${y}-${pad(b)}-${pad(a)}` : null;   // a=day
    if (a > 12 && asDMY) return { iso: asDMY, ambiguous: false, original, candidates: [] };   // a must be the day
    if (b > 12 && asMDY) return { iso: asMDY, ambiguous: false, original, candidates: [] };   // b must be the day
    if (asMDY && asDMY && asMDY !== asDMY) {
      const chosen = opts?.localePrefersDMY ? asDMY : asMDY;
      return { iso: chosen, ambiguous: true, original, candidates: [asMDY, asDMY] };           // genuinely ambiguous → flag
    }
    return { iso: asMDY || asDMY, ambiguous: false, original, candidates: [] };
  }
  return { iso: null, ambiguous: false, original, candidates: [] };   // free-text month names left for the provider/LLM layer
}

// ---- PII masking ----
export function maskCardNumber(raw: string | null): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length < 4) return null;
  return '••••' + digits.slice(-4);
}
/** Guarantee no full PAN/bank/routing number survives into stored/extracted text. */
export function redactSensitive(text: string | null): string {
  return String(text ?? '')
    .replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => '••••' + m.replace(/\D/g, '').slice(-4))   // card-length runs → last 4
    .replace(/\b\d{9,12}\b/g, (m) => '••••' + m.slice(-4));                                 // routing/account-length runs
}

// ---- line-item reconciliation (item level: qty × unit − discount + tax ≈ line total) ----
export function reconcileLineItem(li: Pick<LineItem, 'quantity' | 'unitPriceCents' | 'discountCents' | 'taxCents' | 'lineTotalCents'>, toleranceCents = 2): boolean | null {
  if (li.quantity == null || li.unitPriceCents == null || li.lineTotalCents == null) return null;
  const expected = Math.round(li.quantity * li.unitPriceCents) - (li.discountCents || 0) + (li.taxCents || 0);
  return Math.abs(expected - li.lineTotalCents) <= toleranceCents;
}
