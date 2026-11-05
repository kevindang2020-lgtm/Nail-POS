// Pure, DB-free engine for MASTER product creation: normalization, UPC/EAN checksum validation, decimal-safe money
// checks, input validation, and duplicate-candidate detection. No fabrication, no side effects.

export interface MasterProductInput {
  name?: string | null;
  code?: string | null;
  brandName?: string | null;
  sku?: string | null;
  manufacturerSku?: string | null;
  upc?: string | null;
  barcode?: string | null;
  categoryName?: string | null;
  productType?: string | null;
  description?: string | null;
  costCents?: number | null;
  suggestedRetailCents?: number | null;
  currency?: string | null;
  taxCategory?: string | null;
  inventoryUnit?: string | null;
  vendorName?: string | null;
}

export interface ExistingMaster { id: string; name: string; normalizedSku: string | null; barcode: string | null; brandName: string | null; normalizedName: string }

export const normalizeSku = (s: string | null | undefined): string | null => {
  const v = String(s ?? '').trim().toUpperCase().replace(/\s+/g, '');
  return v || null;
};
export const normalizeName = (s: string | null | undefined): string =>
  String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** UPC-A (12 digit) / EAN-13 (13 digit) check-digit validation. Returns true only for a structurally valid code. */
export function isValidUpc(raw: string | null | undefined): boolean {
  const d = String(raw ?? '').trim();
  if (!/^\d{12}$|^\d{13}$/.test(d)) return false;
  const digits = d.split('').map(Number);
  const check = digits.pop() as number;
  // For UPC-A(12) the first digit weight is x3 starting from the left odd positions; EAN-13 mirrors this from the right.
  let sum = 0;
  const body = digits.slice().reverse(); // process from rightmost body digit
  for (let i = 0; i < body.length; i++) sum += body[i] * (i % 2 === 0 ? 3 : 1);
  const computed = (10 - (sum % 10)) % 10;
  return computed === check;
}

const isCents = (v: unknown): boolean => v == null || (Number.isInteger(v) && (v as number) >= 0);

export interface ValidationResult { errors: string[]; normalized: { normalizedName: string; normalizedSku: string | null } }

export function validateMasterProductInput(input: MasterProductInput): ValidationResult {
  const errors: string[] = [];
  if (!String(input.name ?? '').trim()) errors.push('Product name is required.');
  if (!String(input.categoryName ?? '').trim()) errors.push('Category is required.');

  const sku = input.sku != null && String(input.sku).trim() !== '' ? String(input.sku).trim() : null;
  if (sku && !/^[A-Za-z0-9][A-Za-z0-9._-]{1,49}$/.test(sku)) errors.push('SKU must be alphanumeric with . _ - separators (2–50 chars).');

  if (input.upc != null && String(input.upc).trim() !== '' && !isValidUpc(input.upc)) errors.push('UPC/EAN check digit is invalid.');

  if (!isCents(input.costCents)) errors.push('Cost must be a non-negative whole number of cents.');
  if (!isCents(input.suggestedRetailCents)) errors.push('Suggested retail must be a non-negative whole number of cents.');

  return { errors, normalized: { normalizedName: normalizeName(input.name), normalizedSku: normalizeSku(sku) } };
}

export interface DuplicateCandidate { id: string; name: string; reason: 'exact_sku' | 'exact_barcode' | 'brand_and_name'; confidence: number }

export function duplicateCandidates(input: MasterProductInput, existing: ExistingMaster[]): DuplicateCandidate[] {
  const nSku = normalizeSku(input.sku);
  const bc = String(input.barcode ?? input.upc ?? '').trim() || null;
  const nName = normalizeName(input.name);
  const nBrand = normalizeName(input.brandName);
  const out: DuplicateCandidate[] = [];
  const seen = new Set<string>();
  const push = (e: ExistingMaster, reason: DuplicateCandidate['reason'], confidence: number) => {
    const key = `${e.id}|${reason}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id: e.id, name: e.name, reason, confidence });
  };
  for (const e of existing) {
    if (nSku && e.normalizedSku && e.normalizedSku === nSku) push(e, 'exact_sku', 1);
    if (bc && e.barcode && e.barcode === bc) push(e, 'exact_barcode', 1);
    if (nName && e.normalizedName === nName && nBrand && normalizeName(e.brandName) === nBrand) push(e, 'brand_and_name', 0.8);
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}
