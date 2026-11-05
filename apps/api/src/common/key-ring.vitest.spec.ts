// key-ring.vitest.spec — Constitution 12 §40–42, §47 (finding H1): no fallbacks in production; rotation; purpose separation.
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { keysFor, withKeys, missingProductionKeys, KEY_SOURCES, onKeyFallback, _resetFallbackReports, type KeyPurpose } from './key-ring';
import { encryptSecret, decryptSecret, encryptPaymentSecret, decryptPaymentSecret, paymentSecretNeedsReencrypt } from './mfa-enc';
import * as provider from './provider-crypto';

const HEX = randomBytes(32).toString('hex'), HEX2 = randomBytes(32).toString('hex');
const PROD = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;
beforeEach(() => { _resetFallbackReports(); onKeyFallback(null); });

describe('§41 production has no fallbacks', () => {
  it.each(Object.keys(KEY_SOURCES).filter((p) => KEY_SOURCES[p as KeyPurpose].required) as KeyPurpose[])('%s: unset in production → throws, never derives', (p) => {
    expect(() => keysFor(p, PROD)).toThrow(/refusing to use a derived or constant key in production/);
  });
  it('main.ts refuses to boot: every required key is listed when missing, none when set', () => {
    expect(missingProductionKeys(PROD)).toEqual(['MFA_ENC_KEY', 'PAYMENT_ENC_KEY', 'PROVIDER_VAULT_KEK', 'FUNDING_VAULT_KEK', 'WEBHOOK_SIGNING_KEK', 'AI_PROVIDER_KEK', 'TICKET_DELETION_ENC_KEY']);
    const all = Object.fromEntries(Object.values(KEY_SOURCES).map((s) => [s.env, HEX]));
    expect(missingProductionKeys({ ...PROD, ...all })).toEqual([]);
  });
  it('APP_DATA_ENCRYPTION_KEY stays optional — its module already returns null honestly', () => {
    expect(missingProductionKeys({ ...PROD, MFA_ENC_KEY: HEX, PAYMENT_ENC_KEY: HEX, PROVIDER_VAULT_KEK: HEX, FUNDING_VAULT_KEK: HEX, WEBHOOK_SIGNING_KEK: HEX, AI_PROVIDER_KEK: HEX, TICKET_DELETION_ENC_KEY: HEX })).toEqual([]);
  });
  it('a value that is not a key (too short) counts as missing', () => expect(missingProductionKeys({ ...PROD, MFA_ENC_KEY: 'short' })).toContain('MFA_ENC_KEY'));
});

describe('outside production the legacy derivations still work — and are REPORTED', () => {
  it('provider: the old constant key, so existing ciphertext decrypts', () => {
    expect(keysFor('provider', { NODE_ENV: 'test' })[0]).toEqual(createHash('sha256').update('aipowersalon-dev-provider-vault-kek').digest());
  });
  it('mfa: the old scrypt of the session secret', () => {
    expect(keysFor('mfa', { NODE_ENV: 'test', AUTH_SESSION_SECRET: 's3' })[0]).toEqual(scryptSync('s3', 'aps-mfa-enc', 32));
  });
  it('each fallback is reported ONCE per purpose to the security-event sink', () => {
    const seen: string[] = []; onKeyFallback((p, how) => seen.push(`${p}:${how}`));
    keysFor('funding', { NODE_ENV: 'test' }); keysFor('funding', { NODE_ENV: 'test' }); keysFor('webhook', { NODE_ENV: 'test' });
    expect(seen).toEqual(['funding:constant', 'webhook:constant']);
  });
  it('a configured key is never reported', () => {
    const seen: string[] = []; onKeyFallback((p) => seen.push(p));
    keysFor('funding', { NODE_ENV: 'test', FUNDING_VAULT_KEK: HEX }); expect(seen).toEqual([]);
  });
});

describe('§42 rotation', () => {
  it('encrypt with the current key; decrypt tries current then PREVIOUS', () => {
    const env = { NODE_ENV: 'test', PROVIDER_VAULT_KEK: HEX2, PROVIDER_VAULT_KEK_PREVIOUS: HEX };
    expect(keysFor('provider', env)).toHaveLength(2);
    const oldKey = keysFor('provider', { NODE_ENV: 'test', PROVIDER_VAULT_KEK: HEX })[0];
    const tried: Buffer[] = [];
    withKeys('provider', (k) => { tried.push(k); if (!k.equals(oldKey)) throw new Error('bad tag'); return 'ok'; }, env);
    expect(tried).toHaveLength(2); expect(tried[1]).toEqual(oldKey);
  });
  it('a ciphertext under neither key fails with the LAST error, not a silent empty string', () => {
    expect(() => withKeys('provider', () => { throw new Error('Unsupported state or unable to authenticate data'); }, { NODE_ENV: 'test', PROVIDER_VAULT_KEK: HEX })).toThrow(/authenticate/);
  });
});

describe('payment credentials leave the MFA key', () => {
  const env = { NODE_ENV: 'test', MFA_ENC_KEY: HEX, PAYMENT_ENC_KEY: HEX2 };
  const withEnv = (fn: () => void) => { const prev = { ...process.env }; Object.assign(process.env, env); try { fn(); } finally { for (const k of Object.keys(env)) delete process.env[k]; Object.assign(process.env, prev); } };
  it('new payment secrets are v2p under PAYMENT_ENC_KEY and are not decryptable as an MFA secret', () => withEnv(() => {
    const ct = encryptPaymentSecret('api-password'); expect(ct.startsWith('v2p:')).toBe(true);
    expect(decryptPaymentSecret(ct)).toBe('api-password');
    expect(() => decryptSecret(ct.replace('v2p:', 'v1:'))).toThrow();       // the MFA key cannot open it
  }));
  it('a v1 payment row (written under the MFA key before this change) still decrypts, and is flagged for re-encryption', () => withEnv(() => {
    const legacy = encryptSecret('old-password');                           // exactly what the old resolver wrote
    expect(decryptPaymentSecret(legacy)).toBe('old-password');
    expect(paymentSecretNeedsReencrypt(legacy)).toBe(true); expect(paymentSecretNeedsReencrypt(encryptPaymentSecret('x'))).toBe(false);
  }));
  it('the MFA path is unchanged: round trip + plaintext tolerance', () => withEnv(() => {
    expect(decryptSecret(encryptSecret('JBSWY3DPEHPK3PXP'))).toBe('JBSWY3DPEHPK3PXP'); expect(decryptSecret('PLAINTEXT')).toBe('PLAINTEXT');
  }));
});

describe('the KEK modules keep their ciphertext format byte-for-byte', () => {
  it('provider-crypto: iv.tag.ct base64url, and a value encrypted under the constant fallback key still decrypts in test', () => {
    const ct = provider.encryptSecret('twilio-token'); expect(ct.split('.')).toHaveLength(3); expect(provider.decryptSecret(ct)).toBe('twilio-token');
  });
});

describe('the boot check is wired — the only thing that makes "refused in production" true', () => {
  it('the ONE production check adds every missing production key to the same refusal list as DATABASE_URL', async () => {
    const { readFileSync } = await import('node:fs'); const { join } = await import('node:path');
    // Constitution 13 Phase 8: the check moved out of main.ts into common/production-config.ts so the worker entry uses
    // the same one (section 62) — this guard follows it, and now also pins BOTH entry points to call it before booting.
    const src = readFileSync(join(process.cwd(), 'src/common/production-config.ts'), 'utf8');
    expect(src).toMatch(/for \(const k of missingProductionKeys\((env)?\)\) missing\.push\(/);   // Phase 11: the check is pure over an env argument
    expect(src.indexOf('of missingProductionKeys(')).toBeGreaterThan(src.indexOf("missing.push('AUTH_SESSION_SECRET"));
  });
  it('both entry points (API and worker) run that check before they build the Nest graph', async () => {
    const { readFileSync } = await import('node:fs'); const { join } = await import('node:path');
    for (const [file, boot] of [['src/main.ts', 'NestFactory.create('], ['src/worker.ts', 'NestFactory.createApplicationContext(']] as const) {
      const src = readFileSync(join(process.cwd(), file), 'utf8');
      const call = src.indexOf('assertProductionConfig();'); const b = src.indexOf(boot);
      expect(call, `${file} calls assertProductionConfig()`).toBeGreaterThan(-1);
      expect(call, `${file} checks BEFORE booting`).toBeLessThan(b);
    }
  });
});
