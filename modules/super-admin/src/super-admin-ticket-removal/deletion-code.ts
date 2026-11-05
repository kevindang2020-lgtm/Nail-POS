// deletion-code.ts — the six-digit deletion authorization code: generation (CSPRNG) and constant-time comparison
// against the DECRYPTED stored code. Sealing the code is the SECRET_SEALERS port ('ticket_deletion').
import { randomInt, timingSafeEqual } from 'node:crypto';
/** CSPRNG six-digit code, zero-padded (e.g. "004217"). */
export function generateDeletionCode(): string { return String(randomInt(0, 1_000_000)).padStart(6, '0'); }
/** Constant-time compare of a supplied code against the decrypted stored code ('' when it could not be read). */
export function verifyDeletionCode(supplied: string, plain: string): boolean {
  if (!plain || typeof supplied !== 'string' || supplied.length !== plain.length) return false;
  try { return timingSafeEqual(Buffer.from(supplied), Buffer.from(plain)); } catch { return false; }
}
