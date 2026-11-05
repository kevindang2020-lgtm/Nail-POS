// provider-secrets.ts — a ProviderSecrets for TESTS (Constitution 13 §90): REAL AES-GCM sealing from
// @aipowersalon/security, under a fixed test key. A module's tests exercise genuine encryption without reaching back
// into the API's key ring (§105). The API's own implementation (key ring, rotation) is proven by its
// provider-secrets.vitest.spec.
import { seal, open, type ProviderSecrets } from '@aipowersalon/security';
import { createHash } from 'node:crypto';

const TEST_KEY = createHash('sha256').update('aipowersalon-TEST-ONLY-provider-key').digest();
const FORMAT = { layout: 'dotted' } as const;

export const testProviderSecrets: ProviderSecrets = {
  encrypt: (plain) => seal(TEST_KEY, plain, FORMAT),
  decrypt: (enc) => {
    if ((enc || '').split('.').length !== 3) throw new Error('malformed encrypted secret');
    return open([TEST_KEY], enc, FORMAT);
  },
  isConfigured: () => true,   // a real (test) key is always configured here
};
