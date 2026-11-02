// Thin adapter over @aipowersalon/security (Constitution 13 §81): keys from the API's key ring, cipher from the package.
// Exported names and the wire format at rest are unchanged — no importer and no row changes.
import { seal, open } from '@aipowersalon/security';
import { keyFor, keysFor } from './key-ring';

const PURPOSE = 'funding' as const;
const FORMAT = { layout: 'dotted' } as const;   // iv.tag.ct base64url — the format every existing row uses

export function isFundingVaultConfigured(): boolean {
  return !!(process.env.FUNDING_VAULT_KEK && process.env.FUNDING_VAULT_KEK.length >= 32);
}
export function encryptFunding(plain: string): string { return seal(keyFor(PURPOSE), plain, FORMAT); }
export function decryptFunding(enc: string): string {
  if (!(enc || '').split('.').every(Boolean) || (enc || '').split('.').length !== 3) throw new Error('malformed encrypted secret');
  return open(keysFor(PURPOSE), enc, FORMAT);   // current key, then previous (rotation, §42)
}
export function last4(numeric: string | null | undefined): string | null {
  const d = (numeric || '').replace(/\D/g, '');
  return d.length >= 4 ? d.slice(-4) : null;
}
