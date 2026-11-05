// gift-card-claim-core.spec.ts — Nest-free harness for the claim-token core.
import { mintClaimToken, hashClaimToken, claimValidity, CLAIM_TTL_DAYS } from './gift-card-claim-core';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };

const now = Date.now();
const future = new Date(now + 60_000).toISOString();
const past = new Date(now - 60_000).toISOString();

const { token, tokenHash } = mintClaimToken();
ok('mint returns a usable token', typeof token === 'string' && token.length >= 20);
ok('mint hash is sha256 hex (64 chars)', /^[0-9a-f]{64}$/.test(tokenHash));
ok('hash of the token matches the minted hash', hashClaimToken(token) === tokenHash);
ok('two mints produce different tokens', mintClaimToken().token !== mintClaimToken().token);
ok('hashing is deterministic', hashClaimToken('abc') === hashClaimToken('abc'));
ok('different inputs hash differently', hashClaimToken('abc') !== hashClaimToken('abd'));

ok('a fresh, unclaimed, in-window token is valid', claimValidity({ claimedAt: null, revokedAt: null, expiresAt: future }, now).ok === true);
ok('a missing token is not_found', claimValidity(null, now).reason === 'not_found');
ok('an already-claimed token is rejected', claimValidity({ claimedAt: past, revokedAt: null, expiresAt: future }, now).reason === 'claimed');
ok('a revoked token is rejected', claimValidity({ claimedAt: null, revokedAt: past, expiresAt: future }, now).reason === 'revoked');
ok('an expired token is rejected', claimValidity({ claimedAt: null, revokedAt: null, expiresAt: past }, now).reason === 'expired');
ok('revoked takes precedence over claimed', claimValidity({ claimedAt: past, revokedAt: past, expiresAt: future }, now).reason === 'revoked');
ok('claim links live 30 days', CLAIM_TTL_DAYS === 30);

console.log(`\ngift-card-claim-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' OK'));
if (fail) process.exit(1);
