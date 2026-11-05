// barcode-core.ts — pure, testable helpers for card scanning (spec §11). extractCardNumber pulls a usable gift-card
// value out of a scanned barcode/QR payload; scannerSupported feature-detects the native camera + BarcodeDetector path
// so the UI only offers "Scan" where it actually works. Manual entry remains available everywhere.

// Turn a scanned payload into a gift-card lookup value: a plain 16-digit number (spacing tolerated), or a card code.
// Anything else (an unrelated barcode, a URL without a 16-digit run) returns null so the caller can ignore it.
export function extractCardNumber(text: string): string | null {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, '');
  if (digits.length === 16) return digits;
  if (/^GC-[A-Za-z0-9-]+$/.test(raw)) return raw;
  return null;
}

// True only when both the camera API and the native barcode detector exist (Chromium-based POS browsers). Elsewhere the
// caller hides the Scan affordance and the receptionist types the number.
export function scannerSupported(): boolean {
  return typeof window !== 'undefined'
    && typeof (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector !== 'undefined'
    && typeof navigator !== 'undefined'
    && !!navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === 'function';
}
