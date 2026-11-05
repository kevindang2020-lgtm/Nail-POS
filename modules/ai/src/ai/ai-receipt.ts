import type { ReceiptItem, ParsedReceipt } from '@aipowersalon/api-contracts/tenant';
export type { ReceiptItem, ParsedReceipt };   // owned by packages/api-contracts (Constitution 13 §13)
// ai-receipt.ts — pure helpers for the OCR receipt scanner (ai_ocr_receipt_scanner): the strict extraction prompt and a
// tolerant parser that turns the vision model's output into a normalized receipt (integer cents). No imports; fully
// testable. The service runs the image through the vision gateway with RECEIPT_SYSTEM, then parses with parseReceiptJson.


export const RECEIPT_SYSTEM =
  'You read a photographed purchase receipt for a nail salon and extract its contents as STRICT JSON only — no prose, no ' +
  'markdown, no code fences. Schema: {"vendor":string|null,"date":"YYYY-MM-DD"|null,"items":[{"name":string,' +
  '"quantity":number,"unitPriceCents":integer,"totalCents":integer}],"subtotalCents":integer,"taxCents":integer,' +
  '"totalCents":integer,"currency":string|null}. All money is integer cents (e.g. $12.00 → 1200). If a field is ' +
  'unreadable use null (0 for amounts, [] for items). Output only the JSON object.';

export const RECEIPT_PROMPT = 'Extract this receipt as JSON using the schema. Return only the JSON object.';

const cents = (v: unknown): number => { // a value already in integer cents
  if (typeof v === 'number' && isFinite(v)) return Math.round(v);
  if (typeof v === 'string') { const n = Number(v.replace(/[^0-9.-]/g, '')); return isFinite(n) ? Math.round(n) : 0; }
  return 0;
};
const dollarsToCents = (v: unknown): number => { // a dollar amount → cents
  if (typeof v === 'number' && isFinite(v)) return Math.round(v * 100);
  if (typeof v === 'string') { const n = Number(v.replace(/[^0-9.-]/g, '')); return isFinite(n) ? Math.round(n * 100) : 0; }
  return 0;
};
const has = (v: unknown) => v != null && v !== '';
/** Prefer an explicit *Cents field; otherwise fall back to a dollar-denominated field. Clamped non-negative. */
const pickCents = (centsVal: unknown, dollarVal: unknown): number =>
  has(centsVal) ? Math.max(0, cents(centsVal)) : has(dollarVal) ? Math.max(0, dollarsToCents(dollarVal)) : 0;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Tolerant parse of the model's output into a normalized receipt. Strips code fences, accepts a JSON object embedded in
 *  surrounding prose, coerces money to integer cents (cents fields trusted as-is, dollar fields × 100), clamps negatives,
 *  and back-fills totals. Returns null when no JSON object can be recovered (caller treats that as "enter manually"). */
export function parseReceiptJson(raw: string): ParsedReceipt | null {
  if (!raw) return null;
  let text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  if (text[0] !== '{') { const a = text.indexOf('{'), b = text.lastIndexOf('}'); if (a >= 0 && b > a) text = text.slice(a, b + 1); }
  let j: any;
  try { j = JSON.parse(text); } catch { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const items: ReceiptItem[] = Array.isArray(j.items) ? j.items.map((it: any) => {
    const q = Number(it?.quantity);
    const quantity = isFinite(q) && q > 0 ? q : 1;
    const unitPriceCents = pickCents(it?.unitPriceCents ?? it?.priceCents, it?.unitPrice ?? it?.price);
    const totalCents = has(it?.totalCents ?? it?.total) ? pickCents(it?.totalCents, it?.total) : unitPriceCents * quantity;
    return { name: str(it?.name) ?? 'Item', quantity, unitPriceCents, totalCents };
  }) : [];
  const subtotalCents = pickCents(j.subtotalCents, j.subtotal);
  const taxCents = pickCents(j.taxCents, j.tax);
  let totalCents = pickCents(j.totalCents, j.total);
  if (!totalCents) totalCents = (subtotalCents + taxCents) || items.reduce((s, it) => s + it.totalCents, 0);
  return { vendor: str(j.vendor), date: str(j.date), items, subtotalCents, taxCents, totalCents, currency: str(j.currency) };
}
