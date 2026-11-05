// Thin adapter over @aipowersalon/security (Constitution 13 §81): keys from the API's key ring, cipher from the package.
// Exported names and the wire format at rest are unchanged — no importer and no row changes.
import { seal, open } from '@aipowersalon/security';
import { keyFor, keysFor, type KeyPurpose } from './key-ring';

const fmt = (prefix: string) => ({ layout: 'prefixed', prefix } as const);
function decryptWith(purpose: KeyPurpose, prefix: string, stored: string, legacyPurpose?: KeyPurpose): string {
  const keys = [...keysFor(purpose)];
  if (legacyPurpose) { try { keys.push(...keysFor(legacyPurpose)); } catch { /* legacy purpose unavailable: fine */ } }
  return open(keys, stored, fmt(prefix));
}
export function encryptSecret(plain: string): string { return seal(keyFor('mfa'), plain, fmt('v1')); }
export function decryptSecret(stored: string): string {
  if (!stored) return '';
  if (!stored.startsWith('v1:')) return stored; // legacy/plaintext tolerance
  return decryptWith('mfa', 'v1', stored);
}
/** Payment-processor credentials: their own key. */
export function encryptPaymentSecret(plain: string): string { return seal(keyFor('payments'), plain, fmt('v2p')); }
export function decryptPaymentSecret(stored: string): string {
  if (!stored) return '';
  if (stored.startsWith('v2p:')) return decryptWith('payments', 'v2p', stored);
  if (stored.startsWith('v1:')) return decryptWith('payments', 'v1', stored, 'mfa');   // written before PAYMENT_ENC_KEY existed
  return stored;
}
/** True when a stored payment credential is still under the MFA key and should be re-encrypted on the next write. */
export function paymentSecretNeedsReencrypt(stored: string | null | undefined): boolean { return !!stored && stored.startsWith('v1:'); }
