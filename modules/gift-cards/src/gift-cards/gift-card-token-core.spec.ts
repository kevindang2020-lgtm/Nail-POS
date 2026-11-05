// gift-card-token-core.spec.ts — Nest-free harness (esbuild + node, ok() style) for presentation tokens.
// Covers the pure core (mint/hash/parse/validity/ttl-clamp) and the service lifecycle over the in-memory repo:
// first-use success, single-use replay rejection, expiry rejection, malformed payload, and tenant isolation.
import { mintTokenMaterial, hashTokenParts, parsePayload, tokenHashFromPayload, tokenValidity, clampTtlSeconds } from './gift-card-token-core';
import { GiftCardTokenService, InMemoryGiftCardTokenRepository } from './gift-card-token.service';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };

(async () => {
  // ---- pure core ----
  const m = mintTokenMaterial();
  ok('mint yields a token.nonce payload', m.payload === m.token + '.' + m.nonce && m.token.length > 20);
  ok('token hash is sha256(token:nonce)', m.tokenHash === hashTokenParts(m.token, m.nonce));
  ok('payload re-derives the same hash', tokenHashFromPayload(m.payload) === m.tokenHash);
  ok('two mints differ (high entropy)', mintTokenMaterial().tokenHash !== mintTokenMaterial().tokenHash);
  ok('parse rejects a payload with no dot', parsePayload('abcnodot') === null);
  ok('parse rejects an empty token part', parsePayload('.nonce') === null);
  ok('parse rejects an empty nonce part', parsePayload('token.') === null);
  ok('tampered payload yields a different hash', tokenHashFromPayload(m.token + '.' + m.nonce + 'x') !== m.tokenHash);

  const future = new Date(Date.now() + 60000).toISOString();
  const past = new Date(Date.now() - 1000).toISOString();
  ok('valid when unused/unexpired/unrevoked', tokenValidity({ expiresAt: future, usedAt: null, revokedAt: null }, Date.now()).ok);
  ok('not_found when row missing', tokenValidity(null, Date.now()).reason === 'not_found');
  ok('used when used_at set', tokenValidity({ expiresAt: future, usedAt: past, revokedAt: null }, Date.now()).reason === 'used');
  ok('revoked when revoked_at set', tokenValidity({ expiresAt: future, usedAt: null, revokedAt: past }, Date.now()).reason === 'revoked');
  ok('expired when past expiry', tokenValidity({ expiresAt: past, usedAt: null, revokedAt: null }, Date.now()).reason === 'expired');

  ok('ttl clamps 0 up to 30', clampTtlSeconds(0) === 30);
  ok('ttl clamps huge down to 300', clampTtlSeconds(99999) === 300);
  ok('ttl passes a sane value', clampTtlSeconds(90) === 90);
  ok('ttl defaults NaN to 90', clampTtlSeconds(undefined) === 90);

  // ---- service lifecycle ----
  const ctx = { tenantId: 'luxe001' };
  {
    let t = 1_000_000_000_000;
    const svc = new GiftCardTokenService(new InMemoryGiftCardTokenRepository(), () => t);
    const minted = await svc.mint(ctx, 'gc_1', 90);
    const r1 = await svc.validate(ctx, minted.payload);
    ok('validate returns the card id on first use', r1.ok === true && (r1 as any).giftCardId === 'gc_1');
    const r2 = await svc.validate(ctx, minted.payload);
    ok('replay of a used token is rejected', r2.ok === false && (r2 as any).reason === 'used');
  }
  {
    let t = 2_000_000_000_000;
    const svc = new GiftCardTokenService(new InMemoryGiftCardTokenRepository(), () => t);
    const minted = await svc.mint(ctx, 'gc_2', 90);
    t += 91_000; // advance past the 90s expiry
    const r = await svc.validate(ctx, minted.payload);
    ok('an expired token is rejected', r.ok === false && (r as any).reason === 'expired');
  }
  {
    const svc = new GiftCardTokenService(new InMemoryGiftCardTokenRepository());
    ok('a malformed payload is rejected', (await svc.validate(ctx, 'garbage')).ok === false);
    const minted = await svc.mint(ctx, 'gc_3', 90);
    const other = await svc.validate({ tenantId: 'OTHER' }, minted.payload);
    ok('a token from another tenant is not found', other.ok === false && (other as any).reason === 'not_found');
  }

  console.log(`\ngift-card-token-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' OK'));
  if (fail) process.exit(1);
})();
