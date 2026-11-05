// Pure, DB-free engine for barcode management: normalize a barcode, classify its type, and validate a change
// (checksum for UPC-A/EAN-13, reason required). Conflict detection (barcode already active on another product) is a
// repository concern; this engine covers the format/checksum/reason rules.

import { isValidUpc } from './product-master-core';

export type BarcodeType = 'upc_a' | 'ean_13' | 'other' | 'unknown';

export const normalizeBarcode = (s: string | null | undefined): string => String(s ?? '').trim().replace(/\s+/g, '');

export function classifyBarcodeType(barcode: string): BarcodeType {
  const b = normalizeBarcode(barcode);
  if (/^\d{12}$/.test(b)) return 'upc_a';
  if (/^\d{13}$/.test(b)) return 'ean_13';
  if (!b) return 'unknown';
  return 'other';
}

export interface BarcodeChangeInput { barcode?: string | null; reason?: string | null; requireChecksum?: boolean }
export interface BarcodeValidation { errors: string[]; normalized: string; type: BarcodeType }

export function validateBarcodeChange(input: BarcodeChangeInput): BarcodeValidation {
  const normalized = normalizeBarcode(input.barcode);
  const type = classifyBarcodeType(normalized);
  const errors: string[] = [];
  if (!normalized) errors.push('A barcode value is required.');
  else if ((type === 'upc_a' || type === 'ean_13')) { if (!isValidUpc(normalized)) errors.push('Barcode check digit is invalid.'); }
  else if (input.requireChecksum) errors.push('A valid 12-digit UPC-A or 13-digit EAN-13 is required.');
  if (!String(input.reason ?? '').trim()) errors.push('A reason is required for barcode changes.');
  return { errors, normalized, type };
}
