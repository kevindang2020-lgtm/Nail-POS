// tenant-messaging-credentials.pgtest — BUILD_PLAN Phase 4: a salon can turn booking verification on through the product.
// Verify Service SID + API key saved, "Test Verify" records the outcome the booking policy reads, a change clears it,
// disconnect, and branch rows beside the salon default (migration 521 dropped the one-row-per-salon index).
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor, testProviderSecrets } from '@aipowersalon/testing';
import { TenantMessagingCredentialsService, CredentialsInputError } from './tenant-messaging-credentials.service';
import { KyselyTenantSmsSenderResolver } from '../notifications/notifications.tenant-sender';

const T = 'aaaaaaaa-1111-4111-8111-111111111111';
const B = 'bbbbbbbb-2222-4222-8222-222222222222';
const OTHER_B = 'cccccccc-3333-4333-8333-333333333333';
const AC = 'AC' + '0'.repeat(31) + '1';
const VA = 'VA' + 'a'.repeat(32);
const VA2 = 'VA' + 'b'.repeat(32);
const SK = 'SK' + 'c'.repeat(32);
let db: any;
const audit = { record: vi.fn(async () => ({})) };
const svc = () => new TenantMessagingCredentialsService(db, audit as any, testProviderSecrets);
const row = async (branch: string | null) => (await sql`select * from tenant_messaging_credentials where tenant_id = ${T} and ${branch ? sql`branch_id = ${branch}::uuid` : sql`branch_id is null`}`.execute(db)).rows[0] as any;

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values (${T}, 'Cred LLC', 'Cred', 'cred-salon', 'CRED01')`.execute(db);
  await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active')`.execute(db);
}, 180_000);

describe('the Verify Service a salon sends booking codes through', () => {
  it('saves the Verify SID and an API key; the secrets are encrypted and never returned', async () => {
    const out = await svc().set('u1', T, { accountSid: AC, authToken: 'tok-secret-1234', verifyServiceSid: VA, apiKeySid: SK, apiKeySecret: 'key-secret-9876' });
    expect(out).toMatchObject({ status: 'configured', verifyServiceSid: VA, apiKeySid: SK, hasApiKeySecret: true, fromNumber: null, lastValidatedAt: null, branchOverride: false });
    expect(JSON.stringify(out)).not.toMatch(/tok-secret|key-secret/);
    const r = await row(null);
    expect(r.auth_token_enc).not.toContain('tok-secret');
    expect(testProviderSecrets.decrypt(r.api_key_secret_enc)).toBe('key-secret-9876');
    // §137 / §55: a Twilio configuration change is audited — and the audit never carries the token or key secret
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ tenantId: T }), expect.objectContaining({ module: 'messaging', action: 'tenant_credentials.updated' }));
    expect(JSON.stringify((audit.record as any).mock.calls)).not.toMatch(/tok-secret|key-secret/);
  });
  it('a malformed SID is refused before anything is stored', async () => {
    await expect(svc().set('u1', T, { accountSid: AC, verifyServiceSid: 'VA123' })).rejects.toBeInstanceOf(CredentialsInputError);
    await expect(svc().set('u1', T, { accountSid: AC, verifyServiceSid: VA, apiKeySid: 'SKnope' })).rejects.toBeInstanceOf(CredentialsInputError);
    await expect(svc().set('u1', T, { accountSid: 'AC123', verifyServiceSid: VA })).rejects.toBeInstanceOf(CredentialsInputError);
  });
});

describe('"Test Verify" records what the booking policy reads', () => {
  it('success sets last_validated_at; the probe is signed with the API key, at the Verify Service', async () => {
    const s = svc();
    const http = vi.fn(async () => new Response(JSON.stringify({ sid: VA, friendly_name: 'Cred Salon' }), { status: 200 }));
    s.http = http as any;
    expect(await s.testVerify('u1', T)).toEqual({ ok: true, friendlyName: 'Cred Salon' });
    const [url, init] = (http.mock.calls[0] as any);
    expect(String(url)).toBe(`https://verify.twilio.com/v2/Services/${VA}`);
    expect(init.headers.Authorization).toBe('Basic ' + Buffer.from(`${SK}:key-secret-9876`).toString('base64'));
    const r = await row(null);
    expect(r.last_validated_at).not.toBeNull();
    expect(r.last_validation_error).toBeNull();
  });
  it('failure clears the validation and records why', async () => {
    const s = svc();
    s.http = vi.fn(async () => new Response(JSON.stringify({ message: 'not found' }), { status: 404 })) as any;
    expect(await s.testVerify('u1', T)).toEqual({ ok: false, error: 'No Verify Service with that SID on this Twilio account.' });
    const r = await row(null);
    expect(r.last_validated_at).toBeNull();
    expect(r.last_validation_error).toMatch(/No Verify Service/);
  });
  it('changing any credential clears the validation — new credentials are untested', async () => {
    const s = svc();
    s.http = vi.fn(async () => new Response('{}', { status: 200 })) as any;
    await s.testVerify('u1', T);
    expect((await row(null)).last_validated_at).not.toBeNull();
    await s.set('u1', T, { accountSid: AC, verifyServiceSid: VA2 });
    expect((await row(null)).last_validated_at).toBeNull();
  });
  it('no Verify Service → the test says so and touches nothing', async () => {
    await sql`update tenant_messaging_credentials set verify_service_sid = null, from_number = '+18565550100' where tenant_id = ${T} and branch_id is null`.execute(db);
    expect(await svc().testVerify('u1', T)).toMatchObject({ ok: false, reason: 'no_verify_service' });
    await sql`update tenant_messaging_credentials set verify_service_sid = ${VA} where tenant_id = ${T} and branch_id is null`.execute(db);
  });
});

describe('branch rows beside the salon default', () => {
  it('a branch row coexists with the default; a branch without one inherits it', async () => {
    const s = svc();
    await s.set('u1', T, { accountSid: AC, authToken: 'branch-token-1', verifyServiceSid: VA2 }, B);
    expect((await sql`select count(*)::int n from tenant_messaging_credentials where tenant_id = ${T}`.execute(db)).rows[0]).toMatchObject({ n: 2 });
    expect(await s.getMasked(T, B)).toMatchObject({ branchId: B, verifyServiceSid: VA2, branchOverride: true });
    expect(await s.getMasked(T, OTHER_B)).toMatchObject({ branchId: OTHER_B, verifyServiceSid: VA, branchOverride: false });
    expect(await s.listBranchOverrides(T)).toEqual([expect.objectContaining({ branchId: B, verifyServiceSid: VA2 })]);
  });
  it('another salon’s branch is refused', async () => {
    await expect(svc().set('u1', T, { accountSid: AC, authToken: 'x', verifyServiceSid: VA }, OTHER_B)).rejects.toBeInstanceOf(CredentialsInputError);
  });
  it('the salon’s own SMS sender is the default row, whatever branch rows exist', async () => {
    const sender = await new KyselyTenantSmsSenderResolver(db, testProviderSecrets).resolveSender(T);
    expect(sender).not.toBeNull();   // the default has a from number; the branch row has none
  });
  it('disconnect removes only that scope — the branch falls back to the default', async () => {
    const s = svc();
    expect(await s.disconnect('u1', T, B)).toEqual({ ok: true });
    expect(await s.getMasked(T, B)).toMatchObject({ verifyServiceSid: VA, branchOverride: false });
    expect(await s.disconnect('u1', T)).toEqual({ ok: true });
    expect(await s.getMasked(T)).toMatchObject({ status: 'not_configured', verifyServiceSid: null });
  });
});
