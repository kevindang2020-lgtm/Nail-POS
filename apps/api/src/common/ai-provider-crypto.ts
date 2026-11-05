// Thin adapter over @aipowersalon/security (Constitution 13 §81): keys from the API's key ring, cipher from the package.
// Exported names and the wire format at rest are unchanged — no importer and no row changes.
import { createHash } from 'node:crypto';
import { seal, open } from '@aipowersalon/security';
import { keyFor, keysFor } from './key-ring';

const PURPOSE = 'ai_provider' as const;
const FORMAT = { layout: 'dotted' } as const;   // iv.tag.ct base64url — the format every existing row uses

export function isProviderKekConfigured(): boolean {
  return !!(process.env.AI_PROVIDER_KEK && process.env.AI_PROVIDER_KEK.length >= 32);
}
export function encryptKey(plain: string): string { return seal(keyFor(PURPOSE), plain, FORMAT); }
export function decryptKey(enc: string): string {
  if (!(enc || '').split('.').every(Boolean) || (enc || '').split('.').length !== 3) throw new Error('malformed encrypted secret');
  return open(keysFor(PURPOSE), enc, FORMAT);   // current key, then previous (rotation, §42)
}
export function maskKey(plain: string): string {
  const s = String(plain || '');
  if (s.length <= 8) return '••••';
  return `${s.slice(0, 8)}${'•'.repeat(8)}${s.slice(-4)}`;
}
export const keyFingerprint = (plain: string): string => createHash('sha256').update(String(plain || '')).digest('hex').slice(0, 12);
