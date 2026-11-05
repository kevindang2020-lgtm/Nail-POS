import { describe, it, expect } from 'vitest';
import { IntegrationLifecycleService } from './integration-lifecycle.service';

// In-memory repo double — exercises the service's security branches without a DB.
function makeRepo() {
  const conns: Record<string, any> = {};
  const states: Record<string, any> = {};
  const creds: any[] = [];
  let seq = 0;
  return {
    _conns: conns, _creds: creds,
    async findLiveByScope(pk: string, t: string | null, b: string | null) { return Object.values(conns).find((c: any) => c.provider_key === pk && (c.tenant_id ?? null) === (t ?? null) && (c.branch_id ?? null) === (b ?? null) && c.connection_status !== 'retired'); },
    async createConnection(c: any) { const id = `c${++seq}`; conns[id] = { id, tenant_id: c.tenantId ?? null, branch_id: c.branchId ?? null, provider_key: c.providerKey, category: c.category, ownership_type: c.ownershipType, connection_status: 'pending_setup', authentication_status: 'not_configured', sync_status: 'never_synced', webhook_status: 'not_configured', auth_method: c.authMethod ?? null, granted_scopes: [] }; return conns[id]; },
    async getConnection(id: string) { return conns[id]; },
    async patchConnection(id: string, patch: any) { Object.assign(conns[id], Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v]))); },
    async acquireRefreshLock(id: string) { if (conns[id].authentication_status === 'refresh_in_progress') return null; conns[id].authentication_status = 'refresh_in_progress'; return 'acquired'; },
    async createCredentialRef(i: any) { creds.filter((c) => c.connection_id === i.connectionId && c.kind === i.kind && c.status === 'active').forEach((c) => (c.status = 'rotated')); const masked = '••••••••' + String(i.secret).slice(-4); const id = `cr${++seq}`; creds.push({ id, connection_id: i.connectionId, kind: i.kind, secret: i.secret, masked, status: 'active' }); return { id, masked }; },
    async getActiveSecret(cid: string, kind: string) { const c = creds.find((x) => x.connection_id === cid && x.kind === kind && x.status === 'active'); return c ? c.secret : null; },
    async revokeCredentials(cid: string) { creds.filter((c) => c.connection_id === cid && c.status === 'active').forEach((c) => (c.status = 'revoked')); },
    async listCredentialRefs(cid: string) { return creds.filter((c) => c.connection_id === cid).map((c) => ({ id: c.id, kind: c.kind, masked_value: c.masked, status: c.status })); },
    async beginOAuthState(i: any) { states[i.state] = { ...i, status: 'pending' }; },
    async consumeOAuthState(state: string, cid: string) { const s = states[state]; if (!s || s.status !== 'pending' || s.connectionId !== cid) return null; s.status = 'consumed'; return { codeVerifier: s.codeVerifier, redirectUri: s.redirectUri, scopes: s.scopes }; },
  };
}
const REDIRECT = 'https://admin.aipowersalon.com/cb';

describe('IntegrationLifecycleService', () => {
  it('reports unavailable with no repo', async () => {
    const s = new IntegrationLifecycleService(undefined, undefined);
    expect((await s.createConnection({}, { providerKey: 'quickbooks' })).ok).toBe(false);
  });

  it('only allows approved providers and blocks duplicate scope', async () => {
    const repo = makeRepo(); const s = new IntegrationLifecycleService(repo as any, undefined);
    expect((await s.createConnection({}, { providerKey: 'evilcorp', ownershipType: 'platform_shared' })).error).toBe('unsupported_provider');
    const c = await s.createConnection({}, { providerKey: 'quickbooks', ownershipType: 'platform_shared' }); expect(c.ok).toBe(true);
    const dup = await s.createConnection({}, { providerKey: 'quickbooks', ownershipType: 'platform_shared' }); expect((dup as any).status).toBe(409);
  });

  it('validates OAuth redirect + scopes, then completes once (replay blocked) with no token leaked', async () => {
    const repo = makeRepo(); const s = new IntegrationLifecycleService(repo as any, undefined);
    const c: any = await s.createConnection({}, { providerKey: 'quickbooks', ownershipType: 'platform_shared' });
    expect((await s.beginOAuth({}, c.connection.id, { redirectUri: 'https://evil.com/cb' })).error).toBe('invalid_redirect_uri');
    expect((await s.beginOAuth({}, c.connection.id, { redirectUri: REDIRECT, scopes: ['nope'] })).error).toBe('invalid_scope');
    const b: any = await s.beginOAuth({}, c.connection.id, { redirectUri: REDIRECT });
    expect(b.ok).toBe(true); expect('accessToken' in b).toBe(false); expect('codeVerifier' in b).toBe(false);
    const done: any = await s.completeOAuth({}, c.connection.id, { state: b.state, code: 'goodcode' });
    expect(done.ok).toBe(true); expect(done.authenticationStatus).toBe('valid'); expect('accessToken' in done).toBe(false);
    const replay: any = await s.completeOAuth({}, c.connection.id, { state: b.state, code: 'goodcode' });
    expect(replay.status).toBe(409); expect(replay.error).toBe('invalid_state');
  });

  it('refresh maps invalid_grant to reauthorization_required', async () => {
    const repo = makeRepo(); const s = new IntegrationLifecycleService(repo as any, undefined);
    const c: any = await s.createConnection({}, { providerKey: 'xero', ownershipType: 'platform_shared' });
    const b: any = await s.beginOAuth({}, c.connection.id, { redirectUri: REDIRECT });
    await s.completeOAuth({}, c.connection.id, { state: b.state, code: 'revokedcode' });
    const r: any = await s.refreshAuthentication({}, c.connection.id);
    expect(r.ok).toBe(false); expect(r.error).toBe('reauthorization_required');
  });

  it('API key: blank keeps existing, set masks to last 4, rotate needs reason+secret', async () => {
    const repo = makeRepo(); const s = new IntegrationLifecycleService(repo as any, undefined);
    const c: any = await s.createConnection({}, { providerKey: 'fiserv', ownershipType: 'platform_tenant', tenantId: 't1' });
    expect((await s.configureApiKey({}, c.connection.id, { apiKey: '' }) as any).unchanged).toBe(true);
    expect((await s.configureApiKey({}, c.connection.id, { apiKey: 'sk_live_ABCD1234' }) as any).maskedCredential).toBe('••••••••1234');
    expect((await s.rotateCredential({}, c.connection.id, { kind: 'api_key', newSecret: 'x' }) as any).error).toBe('reason_required');
    expect((await s.rotateCredential({}, c.connection.id, { kind: 'api_key', newSecret: '', reason: 'r' }) as any).error).toBe('secret_required');
    expect((await s.rotateCredential({}, c.connection.id, { kind: 'api_key', newSecret: 'sk_live_ZZ0009', reason: 'r' }) as any).maskedCredential).toBe('••••••••0009');
  });

  it('disable requires a reason and revokes credentials', async () => {
    const repo = makeRepo(); const s = new IntegrationLifecycleService(repo as any, undefined);
    const c: any = await s.createConnection({}, { providerKey: 'fiserv', ownershipType: 'platform_tenant', tenantId: 't1' });
    await s.configureApiKey({}, c.connection.id, { apiKey: 'sk_live_ABCD1234' });
    expect((await s.disableConnection({}, c.connection.id, '') as any).error).toBe('reason_required');
    const d = await s.disableConnection({}, c.connection.id, 'compromised'); expect(d.ok).toBe(true);
    expect(repo._creds.filter((x: any) => x.status === 'active').length).toBe(0);
  });
});
