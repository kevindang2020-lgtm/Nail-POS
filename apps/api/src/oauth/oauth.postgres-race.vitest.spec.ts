// oauth.postgres-race.vitest.spec.ts — Constitution 3 Step 10d: the OAuth authorization server, end to end on real
// Postgres (migration 501), plus its pure rules. Real part opt-in: PG_RACE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { createHash, randomBytes } from 'node:crypto';
import { pkceMatches, redirectAllowed, grantableScopes, oauthHash, KyselyOAuthAccess, readOAuthAccessToken } from '../common/oauth-core';
import { OAuthService } from './oauth.service';

const verifier = () => randomBytes(32).toString('base64url');
const challengeOf = (v: string) => createHash('sha256').update(v).digest('base64url');
describe('OAuth rules', () => {
  it('PKCE S256 only, exact redirect match, scopes = requested ∩ client ∩ read-only allow-list', () => {
    const v = verifier(); expect(pkceMatches(v, challengeOf(v))).toBe(true); expect(pkceMatches(verifier(), challengeOf(v))).toBe(false); expect(pkceMatches('short', challengeOf(v))).toBe(false);
    expect(redirectAllowed('https://a.example/cb', ['https://a.example/cb'])).toBe(true);
    expect(redirectAllowed('https://a.example/cb/../evil', ['https://a.example/cb'])).toBe(false);
    expect(redirectAllowed('https://a.example/cb?x=1', ['https://a.example/cb'])).toBe(false);
    expect(grantableScopes('pos.booking.view pos.checkout.refund pos.customers.view', ['pos.booking.view', 'pos.checkout.refund'])).toEqual(['pos.booking.view']);
    expect(readOAuthAccessToken({ authorization: 'Bearer oat_' + 'x'.repeat(43) })).toBeTruthy(); expect(readOAuthAccessToken({ authorization: 'Bearer ak_live_x' })).toBeNull();
  });
});

const url = process.env.PG_RACE_URL;
const T = 'a8400000-0000-4000-8000-0000000000a1', T2 = 'a8400000-0000-4000-8000-0000000000a2', B = 'b8400000-0000-4000-8000-0000000000b1', U = 'c8400000-0000-4000-8000-0000000000c1';
const CID = 'app_test_widget', REDIRECT = 'https://widget.example/callback', SECRET = 'ocs_test_secret_test_secret';
describe.skipIf(!url)('OAuth server on real Postgres', () => {
  let db: Kysely<any>; let pool: pg.Pool; let svc: OAuthService; let access: KyselyOAuthAccess;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 3 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) }); svc = new OAuthService(db); access = new KyselyOAuthAccess(db);
    for (const [t, s] of [[T, 'oa-a'], [T2, 'oa-b']]) await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${t}, ${s}, ${s}, ${s}, ${s.toUpperCase()}, 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name) values (${B}, ${T}, 'Main') on conflict (id) do nothing`.execute(db);
    await sql`insert into users (id, tenant_id, branch_id, email, password_hash, status, role) values (${U}, ${T}, ${B}, 'oa-owner@example.test', 'x', 'active', 'OWNER') on conflict (id) do nothing`.execute(db);
    await sql`delete from oauth_clients where client_id = ${CID}`.execute(db);
    await sql`insert into oauth_clients (client_id, name, redirect_uris, client_secret_hash, allowed_scopes) values (${CID}, 'Widget', ${[REDIRECT]}::text[], ${oauthHash(SECRET)}, ${['pos.booking.view', 'pos.services.view']}::text[])`.execute(db);
  });
  afterAll(async () => { await sql`delete from oauth_clients where client_id = ${CID}`.execute(db).catch(() => undefined); await db?.destroy(); });
  const authorize = async (v: string, scope = 'pos.booking.view pos.checkout.refund') => {
    const { redirect } = await svc.approve({ clientId: CID, redirectUri: REDIRECT, scope, state: 'xyz', codeChallenge: challengeOf(v), codeChallengeMethod: 'S256' }, { userId: U, tenantId: T });
    const u = new URL(redirect); expect(u.origin + u.pathname).toBe(REDIRECT); expect(u.searchParams.get('state')).toBe('xyz');
    return u.searchParams.get('code')!;
  };

  it('consent validates first: unknown app, unregistered redirect, missing PKCE, nothing grantable → refused', async () => {
    const q = { clientId: CID, redirectUri: REDIRECT, scope: 'pos.booking.view', codeChallenge: challengeOf(verifier()) };
    expect(await svc.describe(q)).toEqual({ clientName: 'Widget', scopes: ['pos.booking.view'] });
    await expect(svc.describe({ ...q, clientId: 'nope' })).rejects.toMatchObject({ code: 'invalid_client' });
    await expect(svc.describe({ ...q, redirectUri: 'https://evil.example/cb' })).rejects.toMatchObject({ code: 'invalid_redirect_uri' });
    await expect(svc.describe({ ...q, codeChallenge: 'plain' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(svc.describe({ ...q, scope: 'pos.checkout.refund' })).rejects.toMatchObject({ code: 'invalid_scope' });
  });
  it('code → tokens with the right verifier, ONCE; the token reads as this salon with the approved scopes only', async () => {
    const v = verifier(); const code = await authorize(v);
    await expect(svc.exchangeCode({ clientId: CID, clientSecret: SECRET, code, redirectUri: REDIRECT, codeVerifier: verifier() })).rejects.toMatchObject({ code: 'invalid_grant' });
    const code2 = await authorize(v);
    await expect(svc.exchangeCode({ clientId: CID, clientSecret: 'wrong', code: code2, redirectUri: REDIRECT, codeVerifier: v })).rejects.toMatchObject({ code: 'invalid_client' });
    const t = await svc.exchangeCode({ clientId: CID, clientSecret: SECRET, code: code2, redirectUri: REDIRECT, codeVerifier: v });
    expect(t).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'pos.booking.view' });
    await expect(svc.exchangeCode({ clientId: CID, clientSecret: SECRET, code: code2, redirectUri: REDIRECT, codeVerifier: v })).rejects.toMatchObject({ code: 'invalid_grant' });   // once
    expect(await access.verify(t.access_token)).toMatchObject({ tenantId: T, clientId: CID, scopes: ['pos.booking.view'] });
  });
  it('refresh rotates; reusing an exchanged refresh token revokes the app\'s access to the salon', async () => {
    const v = verifier(); const t = await svc.exchangeCode({ clientId: CID, clientSecret: SECRET, code: await authorize(v), redirectUri: REDIRECT, codeVerifier: v });
    const t2 = await svc.refresh({ clientId: CID, clientSecret: SECRET, refreshToken: t.refresh_token });
    expect(await access.verify(t2.access_token)).not.toBeNull();
    await expect(svc.refresh({ clientId: CID, clientSecret: SECRET, refreshToken: t.refresh_token })).rejects.toMatchObject({ code: 'invalid_grant' });
    expect(await access.verify(t2.access_token)).toBeNull();                        // the whole grant ended
    expect(await svc.listGrants(T)).toEqual([]);
  });
  it('the owner sees and disconnects the app; another salon cannot touch it', async () => {
    const v = verifier(); const t = await svc.exchangeCode({ clientId: CID, clientSecret: SECRET, code: await authorize(v), redirectUri: REDIRECT, codeVerifier: v });
    const [g] = await svc.listGrants(T); expect(g).toMatchObject({ name: 'Widget', scopes: ['pos.booking.view'] });
    expect(await svc.revokeGrant(T2, g.id)).toBe(false);
    expect(await svc.revokeGrant(T, g.id)).toBe(true);
    expect(await access.verify(t.access_token)).toBeNull();
  });
});
