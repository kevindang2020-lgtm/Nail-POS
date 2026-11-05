import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { signSession, verifySession, type SessionClaims } from './auth-session-token';
import { readSessionToken, sessionFromRequest } from './session-from-request';

const SECRET = 'test-secret-please-change';
const claims: SessionClaims = { userId: 'u1', tenantId: 't1', branchId: 'b1', role: 'OWNER', permissions: ['pos.queue.view'], subscriptionStatus: 'active' };

describe('auth-session-token', () => {
  it('signs and verifies a round-trip token', () => {
    const tok = signSession(claims, { secret: SECRET });
    const r = verifySession(tok, { secret: SECRET });
    expect(r.valid).toBe(true);
    if (r.valid) { expect(r.payload.userId).toBe('u1'); expect(r.payload.role).toBe('OWNER'); expect(r.payload.exp).toBeGreaterThan(r.payload.iat); }
  });

  it('rejects a tampered payload', () => {
    const tok = signSession(claims, { secret: SECRET });
    const [p, s] = tok.split('.');
    const forged = Buffer.from(JSON.stringify({ ...claims, role: 'SUPER_ADMIN', iat: 1, exp: 9999999999 })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(verifySession(`${forged}.${s}`, { secret: SECRET }).valid).toBe(false);
    void p;
  });

  it('rejects a wrong secret', () => {
    const tok = signSession(claims, { secret: SECRET });
    expect(verifySession(tok, { secret: 'other-secret' }).valid).toBe(false);
  });

  it('rejects an expired token', () => {
    const tok = signSession(claims, { secret: SECRET, ttlSeconds: 100, now: 1000 });
    const r = verifySession(tok, { secret: SECRET, now: 5000 });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe('expired');
  });

  it('rejects malformed tokens without throwing', () => {
    for (const bad of ['', 'no-dot', '.', 'a.', '.b']) expect(verifySession(bad, { secret: SECRET }).valid).toBe(false);
  });
});

describe('session-from-request', () => {
  const tok = signSession(claims, { secret: SECRET });
  it('reads a Bearer token', () => {
    expect(readSessionToken({ authorization: `Bearer ${tok}` })).toBe(tok);
    expect(sessionFromRequest({ headers: { authorization: `Bearer ${tok}` } }, SECRET)?.userId).toBe('u1');
  });
  it('reads the aps_session cookie among others', () => {
    const cookie = `theme=dark; aps_session=${encodeURIComponent(tok)}; lang=en`;
    expect(readSessionToken({ cookie })).toBe(tok);
    expect(sessionFromRequest({ headers: { cookie } }, SECRET)?.role).toBe('OWNER');
  });
  it('returns null when no token / garbage token is present', () => {
    expect(readSessionToken({})).toBeNull();
    expect(sessionFromRequest({ headers: {} }, SECRET)).toBeNull();
    expect(sessionFromRequest({ headers: { authorization: 'Bearer not-a-token' } }, SECRET)).toBeNull();
  });
});

// ---- cookie-size regression (Jul 26, 2026): the token IS the aps_session cookie. Embedding the full role
// permission list pushed it to ~7 KB — past the ~4 KB browser ceiling — so Chromium/Edge silently dropped the
// cookie and NO login survived a page reload. These pin the diet + its exact compatibility semantics. ----
import { permissionsFor } from '@aipowersalon/permissions';
describe('session token stays under the browser cookie ceiling', () => {
  const S = { secret: 'size-pin-secret' };
  const base = { userId: 'u1', tenantId: 't1', branchId: 'b1', subscriptionStatus: 'active', sid: 's1' } as const;

  it('OWNER token with full role permissions serializes far below 4 KB (permissions omitted on the wire, re-derived on verify)', () => {
    const token = signSession({ ...base, role: 'OWNER', permissions: permissionsFor('OWNER') } as any, S);
    expect(token.length).toBeLessThan(1200);
    const wire = JSON.parse(Buffer.from(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    expect(wire.permissions).toBeUndefined();
    const v = verifySession(token, S);
    expect(v.valid).toBe(true);
    if (v.valid) {
      expect(v.payload.permissions).toEqual(expect.arrayContaining(permissionsFor('OWNER')));
      expect(v.payload.permissions.length).toBe(permissionsFor('OWNER').length);
    }
  });

  it('SUPER_ADMIN (the largest permission set) also stays small', () => {
    const token = signSession({ ...base, tenantId: null, role: 'SUPER_ADMIN', permissions: permissionsFor('SUPER_ADMIN') } as any, S);
    expect(token.length).toBeLessThan(1200);
  });

  it('NON-default lists are embedded verbatim (technician overrides, deliberately-empty reset sessions)', () => {
    const custom = ['tech.tickets.view', 'tech.payroll.view'];
    const t1 = signSession({ ...base, role: 'TECHNICIAN', permissions: custom } as any, S);
    const v1 = verifySession(t1, S);
    expect(v1.valid && v1.payload.permissions).toEqual(custom);
    const t2 = signSession({ ...base, role: 'OWNER', permissions: [] } as any, S);
    const v2 = verifySession(t2, S);
    expect(v2.valid && v2.payload.permissions).toEqual([]); // [] ≠ role default → kept as-is, exactly as before
  });

  it('legacy tokens that embed the full list still verify with their embedded list', () => {
    // A legacy token is one minted BEFORE audiences existed. This used iat = now, which became a time bomb on
    // AUDIENCE_REQUIRED_FROM_EPOCH (Oct 2 2026): from then on an aud-less token minted "now" is correctly refused.
    const now = Math.floor(Date.now() / 1000);
    const legacyBody = { ...base, role: 'OWNER', permissions: permissionsFor('OWNER'), iat: AUDIENCE_REQUIRED_FROM_EPOCH - 3600, exp: now + 600 };
    const p = Buffer.from(JSON.stringify(legacyBody)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const sig = require('crypto').createHmac('sha256', S.secret).update(p).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const v = verifySession(`${p}.${sig}`, S);
    expect(v.valid).toBe(true);
    if (v.valid) expect(v.payload.permissions.length).toBe(permissionsFor('OWNER').length);
  });

  it('derivation cannot escalate: the role is inside the SIGNED payload', () => {
    const token = signSession({ ...base, role: 'TECHNICIAN', permissions: permissionsFor('TECHNICIAN') } as any, S);
    const [p] = token.split('.');
    const body = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    body.role = 'SUPER_ADMIN';
    const forgedP = Buffer.from(JSON.stringify(body)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const forged = `${forgedP}.${token.split('.')[1]}`;
    expect(verifySession(forged, S).valid).toBe(false); // bad signature
  });

  it('a validly-signed but non-JSON payload is reported as malformed, never thrown (Jul 29 hardening)', () => {
    const p = Buffer.from('this is not json').toString('base64url');
    const sig = createHmac('sha256', SECRET).update(p).digest('base64url');   // mirrors the module's HMAC shape
    const out = verifySession(`${p}.${sig}`, { secret: SECRET });
    expect(out.valid).toBe(false);
    if (!out.valid) expect(out.reason).toBe('malformed');
  });
});

// ── Constitution 7: platform token AUDIENCE ──────────────────────────────────────────────────────────────────────
import { audienceFor, AUDIENCE_REQUIRED_FROM_EPOCH } from './auth-session-token';
import { createHmac } from 'crypto';
describe('session token audience (Constitution 7 — platform token audience)', () => {
  const S = 'aud-test-secret';
  const b64 = (x: string | Buffer) => Buffer.from(x).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  /** Mint a token by hand (as a buggy or foreign signer would), bypassing signSession — correctly signed, so only the
   *  audience rules can stop it. */
  const handMint = (payload: Record<string, unknown>) => { const p = b64(JSON.stringify(payload)); return `${p}.${b64(createHmac('sha256', S).update(p).digest())}`; };
  const base = { userId: 'u1', tenantId: 't1', branchId: 'b1', permissions: [], subscriptionStatus: 'active' };
  const now = AUDIENCE_REQUIRED_FROM_EPOCH + 3600;

  it('every token is stamped with the audience of its SIGNED role — the caller cannot choose it', () => {
    for (const [role, aud] of [['SUPER_ADMIN', 'platform'], ['OWNER', 'tenant'], ['TECHNICIAN', 'tenant'], ['FRONT_DESK', 'tenant'], ['CUSTOMER', 'customer']] as const) {
      const t = signSession({ ...base, role, aud: 'platform' } as any, { secret: S, now });   // a caller trying to smuggle an aud
      const r = verifySession(t, { secret: S, now: now + 1 });
      expect(r.valid && r.payload.aud).toBe(aud);
      expect(audienceFor(role)).toBe(aud);
    }
  });

  it('a correctly SIGNED token whose audience does not match its role is rejected (bad_audience)', () => {
    const iat = now, exp = now + 3600;
    expect(verifySession(handMint({ ...base, role: 'OWNER', aud: 'platform', iat, exp }), { secret: S, now: now + 1 })).toEqual({ valid: false, reason: 'bad_audience' });
    expect(verifySession(handMint({ ...base, role: 'SUPER_ADMIN', tenantId: null, aud: 'tenant', iat, exp }), { secret: S, now: now + 1 })).toEqual({ valid: false, reason: 'bad_audience' });
    expect(verifySession(handMint({ ...base, role: 'CUSTOMER', aud: 'tenant', iat, exp }), { secret: S, now: now + 1 })).toEqual({ valid: false, reason: 'bad_audience' });
  });

  it('no forced sign-out at deploy: a legacy token (no aud) issued BEFORE the cutover is still accepted until it expires', () => {
    const iat = AUDIENCE_REQUIRED_FROM_EPOCH - 600, exp = iat + 12 * 3600;
    const r = verifySession(handMint({ ...base, role: 'OWNER', iat, exp }), { secret: S, now: iat + 3600 });
    expect(r.valid).toBe(true);
    expect(verifySession(handMint({ ...base, role: 'OWNER', iat, exp }), { secret: S, now: exp + 1 })).toEqual({ valid: false, reason: 'expired' });
  });

  it('a token WITHOUT aud minted AFTER the cutover is rejected — only a signer that bypassed signSession could produce it', () => {
    expect(verifySession(handMint({ ...base, role: 'OWNER', iat: now, exp: now + 3600 }), { secret: S, now: now + 1 })).toEqual({ valid: false, reason: 'bad_audience' });
    expect(verifySession(handMint({ ...base, role: 'OWNER', exp: now + 3600 }), { secret: S, now: now + 1 })).toEqual({ valid: false, reason: 'bad_audience' });   // no iat either
  });

  it('branch switching re-signs from a verified payload and keeps the right audience', () => {
    const first = verifySession(signSession({ ...base, role: 'MANAGER' } as any, { secret: S, now }), { secret: S, now: now + 1 });
    expect(first.valid).toBe(true);
    const again = verifySession(signSession({ ...(first as any).payload, branchId: 'b2' }, { secret: S, now: now + 2 }), { secret: S, now: now + 3 });
    expect(again.valid && again.payload.aud).toBe('tenant');
  });
});
