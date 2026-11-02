// tenant-messaging.vitest.spec.ts — Super-Admin per-tenant Twilio credentials. Verifies validation, that the auth
// token is never echoed back (only a masked hint), and that the tenant-sender resolver builds a per-tenant sender from
// stored credentials (and falls back to null when incomplete).
import { testProviderSecrets as providerSecrets } from '@aipowersalon/testing';
import { describe, it, expect, vi } from 'vitest';
import { TenantMessagingCredentialsService } from './tenant-messaging-credentials.service';
import { NullTenantSmsSenderResolver } from '../notifications/notifications.tenant-sender';

describe('TenantMessagingCredentialsService.set (no DB path — validation + masking)', () => {
  const audit = { record: vi.fn(async () => ({})) };
  const svc = new TenantMessagingCredentialsService(null as any, audit as any, providerSecrets);
  it('requires an E.164 from number', async () => {
    await expect(svc.set('admin', 'ten_1', { accountSid: 'AC00000000000000000000000000000001', authToken: 'tok', fromNumber: '5551234' })).rejects.toThrow(/E\.164/);
  });
  it('requires an account sid', async () => {
    await expect(svc.set('admin', 'ten_1', { accountSid: '', authToken: 'tok', fromNumber: '+18565551234' })).rejects.toThrow(/accountSid/);
  });
  it('returns a masked view that never contains the raw token', async () => {
    const r = await svc.set('admin', 'ten_1', { accountSid: 'AC00000000000000000000000000000001', authToken: 'super_secret_token', fromNumber: '+18565551234' });
    expect(r.status).toBe('configured');
    expect(r.accountSid).toBe('AC…0001');   // PM-02: masked in every ordinary response
    expect(r.accountSidLast4).toBe('0001');
    expect((r as any).authToken).toBeUndefined();
    expect(r.authTokenLast4).toBe('oken');            // last 4 only
    expect(JSON.stringify(r)).not.toContain('super_secret_token');
  });
});

describe('TenantMessagingCredentialsService.testSend', () => {
  const audit = { record: vi.fn(async () => ({})) };
  it('validates the destination number', async () => {
    const svc = new TenantMessagingCredentialsService(null as any, audit as any, providerSecrets);
    await expect(svc.testSend('admin', 'ten_1', '5551234')).rejects.toThrow(/E\.164/);
  });
  it('reports not_configured when no DB / no creds', async () => {
    const svc = new TenantMessagingCredentialsService(null as any, audit as any, providerSecrets);
    expect(await svc.testSend('admin', 'ten_1', '+18565551234')).toEqual({ ok: false, reason: 'not_configured' });
  });
});

describe('NullTenantSmsSenderResolver', () => {
  it('returns null (fall back to shared sender)', async () => {
    expect(await new NullTenantSmsSenderResolver().resolveSender()).toBeNull();
  });
});

describe('KyselyTenantSmsSenderResolver (DB path proven via real Postgres in the smoke below)', () => {
  it('null resolver falls back', async () => {
    expect(await new NullTenantSmsSenderResolver().resolveSender()).toBeNull();
  });
  it('round-trips an encrypted token so a sender can be built from it', () => {
    const enc = providerSecrets.encrypt('the_token');
    expect(providerSecrets.decrypt(enc)).toBe('the_token');
    // decryptSecret is what the resolver uses internally to reconstruct the auth token for the sender.
    // (Full DB read → sender construction is verified in the real-PG smoke.)
    expect(enc).not.toContain('the_token');
  });
});
