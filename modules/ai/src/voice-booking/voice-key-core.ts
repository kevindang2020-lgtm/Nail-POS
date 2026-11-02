// voice-key-core.ts — deterministic, testable logic for voice integration keys (Phase 2). No I/O here: secret
// generation uses node crypto in the service; this module composes/hashes/derives status. Mirrors api-webhooks-core.
import { createHash } from 'node:crypto';

export type VoiceKeyStatus = 'active' | 'expired' | 'revoked';

/** Build the displayable raw key + its identifying prefix from an env and an already-random token.
 *  raw = 'vk_<env>_<token>'; prefix = 'vk_<env>_<first 4 of token>'. The service hashes `raw` and stores hash+prefix. */
export function composeVoiceKey(environment: string, randomToken: string): { raw: string; prefix: string } {
  const env = environment === 'test' ? 'test' : 'live';
  const raw = `vk_${env}_${randomToken}`;
  const prefix = `vk_${env}_${randomToken.slice(0, 4)}`;
  return { raw, prefix };
}

/** One-way hash of a raw key. The raw key is never stored; verification re-hashes the presented key and compares. */
export function hashVoiceKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Derive status from the stored timestamps (revoked wins, then expiry). */
export function voiceKeyStatus(k: { revokedMs: number | null; expiresMs: number | null }, nowMs: number): VoiceKeyStatus {
  if (k.revokedMs != null) return 'revoked';
  if (k.expiresMs != null && k.expiresMs <= nowMs) return 'expired';
  return 'active';
}

/** A presented key is usable iff it exists and its derived status is 'active'. */
export function isUsableVoiceKey(k: { revokedMs: number | null; expiresMs: number | null } | null, nowMs: number): boolean {
  return !!k && voiceKeyStatus(k, nowMs) === 'active';
}
