// ai-key-display.ts — how a stored provider key is shown (mask + fingerprint). Pure; the sealing itself is the
// SECRET_SEALERS port ('ai_provider'), provided by the API over its key ring (Constitution 13 §94).
import { createHash } from 'node:crypto';
export function maskKey(plain: string): string {
  const s = String(plain || '');
  if (s.length <= 8) return '••••';
  return `${s.slice(0, 8)}${'•'.repeat(8)}${s.slice(-4)}`;
}
export const keyFingerprint = (plain: string): string => createHash('sha256').update(String(plain || '')).digest('hex').slice(0, 12);
