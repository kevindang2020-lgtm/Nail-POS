// key-ring.ts — Constitution 12 §40–42, §47 (audit finding H1): one key hierarchy, no fallbacks in production, a rotation path.
//
// WHAT WAS THERE. Seven encryption modules, each resolving its own key, and NONE required at production boot:
//   common/mfa-enc     MFA_ENC_KEY           else scrypt(AUTH_SESSION_SECRET || 'dev-secret')   ← session-signing secret reused
//   provider-crypto    PROVIDER_VAULT_KEK    else sha256('aipowersalon-dev-provider-vault-kek')  ← a constant in the source
//   funding-crypto     FUNDING_VAULT_KEK     else sha256('aipowersalon-dev-funding-vault-kek')
//   webhook-crypto     WEBHOOK_SIGNING_KEK   else sha256('aipowersalon-dev-webhook-kek')
//   ai-provider-crypto AI_PROVIDER_KEK       else sha256('aipowersalon-dev-ai-provider-kek')
//   ticket-deletion    TICKET_DELETION_ENC_KEY else scrypt(AUTH_SESSION_SECRET)
//   field-encryption   APP_DATA_ENCRYPTION_KEY else returns null (honest — the one that was right)
// So in a production deployment with those variables unset, Twilio/email/AI/funding/webhook secrets are encrypted
// under keys anyone holding this repository knows, and payment-processor credentials under a key derived from the
// cookie-signing secret. Nothing would have said so.
//
// WHAT THIS IS. Every module now asks the ring for its PURPOSE key. In PRODUCTION a missing key REFUSES BOOT
// (main.ts lists them alongside DATABASE_URL); there is no derivation and no constant. Outside production the old
// derivations still work so developers and tests need nothing — but each use is a CRITICAL security event and an
// ERROR log line, so a staging box running on constants is visible, not silent.
//
// ROTATION (§42). Each purpose may carry a PREVIOUS key (<VAR>_PREVIOUS). `keysFor` returns [current, previous]: a
// module tries the current key first and the previous on an authentication-tag failure, and writes only with the
// current. Rotate = set PREVIOUS to the old value, CURRENT to the new, deploy, re-encrypt at leisure, drop PREVIOUS.
//
// PAYMENT CREDENTIALS get their own purpose (PAYMENT_ENC_KEY) instead of riding on the MFA key. Rows encrypted
// before this change decrypt through the MFA key as a LEGACY fallback (purpose 'payments-legacy'), and are
// re-encrypted under the payments key the next time they are written.
import { createHash, scryptSync } from 'node:crypto';
import { log as rootLog } from '@aipowersalon/observability';

const log = rootLog.withContext({ component: 'key-ring' });

export type KeyPurpose = 'mfa' | 'payments' | 'provider' | 'funding' | 'webhook' | 'ai_provider' | 'ticket_deletion' | 'field';

/** The environment variable that holds each purpose's key, and how the pre-ring code derived a substitute. */
export const KEY_SOURCES: Readonly<Record<KeyPurpose, { env: string; legacy: 'session-scrypt' | 'constant' | 'mfa' | 'none'; legacyLabel?: string; required: boolean }>> = {
  mfa: { env: 'MFA_ENC_KEY', legacy: 'session-scrypt', legacyLabel: 'aps-mfa-enc', required: true },
  payments: { env: 'PAYMENT_ENC_KEY', legacy: 'mfa', required: true },
  provider: { env: 'PROVIDER_VAULT_KEK', legacy: 'constant', legacyLabel: 'aipowersalon-dev-provider-vault-kek', required: true },
  funding: { env: 'FUNDING_VAULT_KEK', legacy: 'constant', legacyLabel: 'aipowersalon-dev-funding-vault-kek', required: true },
  webhook: { env: 'WEBHOOK_SIGNING_KEK', legacy: 'constant', legacyLabel: 'aipowersalon-dev-webhook-kek', required: true },
  ai_provider: { env: 'AI_PROVIDER_KEK', legacy: 'constant', legacyLabel: 'aipowersalon-dev-ai-provider-kek', required: true },
  ticket_deletion: { env: 'TICKET_DELETION_ENC_KEY', legacy: 'session-scrypt', legacyLabel: 'aps-ticket-deletion', required: true },
  field: { env: 'APP_DATA_ENCRYPTION_KEY', legacy: 'none', required: false },
};

const fallbackReported = new Set<KeyPurpose>();
let fallbackSink: ((purpose: KeyPurpose, how: string) => void) | null = null;
/** The security-event recorder registers here at boot (a plain function: this module must not depend on Nest). */
export function onKeyFallback(fn: ((purpose: KeyPurpose, how: string) => void) | null): void { fallbackSink = fn; }
export function _resetFallbackReports(): void { fallbackReported.clear(); }

function parseKey(raw: string | undefined): Buffer | null {
  const v = (raw || '').trim();
  if (!v) return null;
  if (/^[0-9a-fA-F]{64}$/.test(v)) return Buffer.from(v, 'hex');
  if (v.length >= 32) return createHash('sha256').update(v).digest();   // the KEK modules' existing convention
  return null;
}

function legacyKey(purpose: KeyPurpose, env: NodeJS.ProcessEnv): Buffer | null {
  const src = KEY_SOURCES[purpose];
  switch (src.legacy) {
    case 'session-scrypt': return scryptSync(env.AUTH_SESSION_SECRET || 'dev-secret', src.legacyLabel!, 32);
    case 'constant': return createHash('sha256').update(src.legacyLabel!).digest();
    case 'mfa': return keysFor('mfa', env)[0] ?? null;
    default: return null;
  }
}

export function isProduction(env: NodeJS.ProcessEnv = process.env): boolean { return env.NODE_ENV === 'production'; }

/**
 * [current, previous?] for a purpose. Production: the configured key only — a missing one throws (main.ts refuses to
 * boot before any request could reach this). Non-production: the legacy derivation, reported once per purpose.
 */
export function keysFor(purpose: KeyPurpose, env: NodeJS.ProcessEnv = process.env): Buffer[] {
  const src = KEY_SOURCES[purpose];
  const current = parseKey(env[src.env]);
  const previous = parseKey(env[`${src.env}_PREVIOUS`]);
  if (current) return previous ? [current, previous] : [current];
  if (isProduction(env)) throw new Error(`${src.env} is not set — refusing to use a derived or constant key in production (Constitution 12 §41)`);
  const legacy = legacyKey(purpose, env);
  if (!legacy) return [];
  if (!fallbackReported.has(purpose)) {
    fallbackReported.add(purpose);
    log.error('key.fallback_in_use', { purpose, env: src.env, how: src.legacy });
    try { fallbackSink?.(purpose, src.legacy); } catch { /* never throw into a caller */ }
  }
  return [legacy];
}

/** The key to ENCRYPT with. */
export function keyFor(purpose: KeyPurpose, env: NodeJS.ProcessEnv = process.env): Buffer {
  const [k] = keysFor(purpose, env);
  if (!k) throw new Error(`no ${purpose} key available`);
  return k;
}

/** Try a decrypt under each candidate key (current, previous, then the legacy purpose if named). */
export function withKeys<T>(purpose: KeyPurpose, attempt: (key: Buffer) => T, env: NodeJS.ProcessEnv = process.env, legacyPurpose?: KeyPurpose): T {
  const candidates = [...keysFor(purpose, env)];
  if (legacyPurpose) { try { candidates.push(...keysFor(legacyPurpose, env)); } catch { /* legacy purpose unavailable: fine */ } }
  let lastErr: unknown = new Error(`no ${purpose} key available`);
  for (const k of candidates) { try { return attempt(k); } catch (e) { lastErr = e; } }
  throw lastErr;
}

/** For main.ts: the production variables that must be set. `field` is optional by its own contract. */
export function missingProductionKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  return (Object.keys(KEY_SOURCES) as KeyPurpose[]).filter((p) => KEY_SOURCES[p].required && !parseKey(env[KEY_SOURCES[p].env])).map((p) => KEY_SOURCES[p].env);
}
