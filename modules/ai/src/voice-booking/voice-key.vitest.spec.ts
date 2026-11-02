// voice-key.vitest.spec.ts — Phase 2 auth: the voice integration-key core + service. The security contract is that
// tenant/branch are resolved FROM THE STORED KEY, never from the caller, and that unknown/expired/revoked keys fail.
import { describe, it, expect } from 'vitest';
import { composeVoiceKey, hashVoiceKey, voiceKeyStatus, isUsableVoiceKey } from './voice-key-core';
import { VoiceKeyService, InMemoryVoiceKeyRepo } from './voice-key.service';

describe('voice-key-core', () => {
  it('composes a prefixed raw key and a short display prefix', () => {
    const { raw, prefix } = composeVoiceKey('live', 'abcd1234efgh');
    expect(raw).toBe('vk_live_abcd1234efgh');
    expect(prefix).toBe('vk_live_abcd'); // first 4 of the token, for display only
  });

  it('hashes one-way (same input → same hash; the raw is not recoverable)', () => {
    const h1 = hashVoiceKey('vk_live_secret');
    const h2 = hashVoiceKey('vk_live_secret');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);           // sha-256 hex
    expect(h1).not.toContain('secret');    // one-way — raw not embedded
  });

  it('derives status: revoked wins, then expiry, else active', () => {
    const now = 1_000_000;
    expect(voiceKeyStatus({ revokedMs: 500, expiresMs: null }, now)).toBe('revoked');
    expect(voiceKeyStatus({ revokedMs: null, expiresMs: 999 }, now)).toBe('expired');
    expect(voiceKeyStatus({ revokedMs: null, expiresMs: now + 1000 }, now)).toBe('active');
    expect(isUsableVoiceKey({ revokedMs: null, expiresMs: null }, now)).toBe(true);
    expect(isUsableVoiceKey(null, now)).toBe(false);
  });
});

describe('VoiceKeyService.resolveContext — tenant/branch come from the KEY, not the caller', () => {
  async function svcWithKey(extra: any = {}) {
    const repo = new InMemoryVoiceKeyRepo();
    const svc = new VoiceKeyService(repo);
    const { raw, row } = await svc.issue({ tenantId: 'ten_A', branchId: 'br_1', label: 'Retell main', ...extra });
    return { svc, raw, row, repo };
  }

  it('resolves a valid key to its stored tenant+branch', async () => {
    const { svc, raw } = await svcWithKey();
    const ctx = await svc.resolveContext(raw);
    expect(ctx).toMatchObject({ tenantId: 'ten_A', branchId: 'br_1', provider: 'retell' });
  });

  it('the raw key is never stored — only its hash', async () => {
    const { row, raw } = await svcWithKey();
    expect(row.secretHash).toBe(hashVoiceKey(raw));
    expect(JSON.stringify(row)).not.toContain(raw); // the full raw key is never stored — only the short prefix + hash
    expect(JSON.stringify(row)).not.toContain(raw.slice(row.prefix.length)); // and the secret portion (past the display prefix) is absent
  });

  it('returns null for an unknown key (no cross-tenant leakage)', async () => {
    const { svc } = await svcWithKey();
    expect(await svc.resolveContext('vk_live_not_a_real_key')).toBeNull();
    expect(await svc.resolveContext('')).toBeNull();
    expect(await svc.resolveContext(undefined)).toBeNull();
  });

  it('returns null for a revoked key', async () => {
    const { svc, raw, row } = await svcWithKey();
    await svc.revoke('ten_A', row.id);
    expect(await svc.resolveContext(raw)).toBeNull();
  });

  it('returns null for an expired key', async () => {
    const past = Date.now() - 60_000;
    const { svc, raw } = await svcWithKey({ expiresMs: past });
    expect(await svc.resolveContext(raw)).toBeNull();
  });

  it('a caller cannot revoke another tenant\'s key', async () => {
    const { svc, row } = await svcWithKey();
    expect(await svc.revoke('ten_OTHER', row.id)).toBe(false); // wrong tenant → no-op
  });
});
