// settings-a2p-status.pgtest — the POS A2P status (GET /pos/settings/notifications-reminders/a2p-status) is read from
// tenant_a2p_registrations, not an in-memory map that defaulted to the platform brand and invented "pending".
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyA2pStatusReader, a2pStatusOf } from './settings.a2p.kysely';
import { PosSettingsService } from './settings.service';
import { InMemorySettingsRepository } from './settings.repository';

const A = '7a2a0000-0000-4000-8000-00000000000a', B = '7a2a0000-0000-4000-8000-00000000000b';
let db: any;
beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${A}', 'A', 'A', 'a2p-a', 'A2PA', 'active'), ('${B}', 'B', 'B', 'a2p-b', 'A2PB', 'active');`);
}, 180_000);

describe('POS A2P status from the registration record', () => {
  it('no registration → not_registered, and no platform brand is claimed', async () => {
    expect(await new KyselyA2pStatusReader(db).read(A)).toMatchObject({ a2pStatus: 'not_registered', senderBrand: '', source: 'tenant_a2p_registrations' });
  });
  it('registered only when brand AND campaign are approved; tenant-scoped', async () => {
    await sql`insert into tenant_a2p_registrations (tenant_id, brand_status, campaign_status, status, business_info) values (${A}, 'APPROVED', 'IN_PROGRESS', 'campaign_submitted', ${JSON.stringify({ businessName: 'Salon A Nails LLC' })}::jsonb)`.execute(db);
    const r = new KyselyA2pStatusReader(db);
    expect(await r.read(A)).toMatchObject({ a2pStatus: 'pending', senderBrand: 'Salon A Nails LLC', brandStatus: 'APPROVED', campaignStatus: 'IN_PROGRESS' });
    expect((await r.read(B)).a2pStatus).toBe('not_registered');
    await sql`update tenant_a2p_registrations set campaign_status = 'VERIFIED' where tenant_id = ${A}`.execute(db);
    // PM-03 (round 2): the record saying VERIFIED is a submission, not provider confirmation → still pending
    expect(await r.read(A)).toMatchObject({ a2pStatus: 'pending', providerVerified: false });
    // the provider confirmed both (registration sync snapshots) → registered; B is untouched
    await sql`insert into tenant_messaging_registration_snapshots (tenant_id, item_kind, normalized_state, verified, source, raw_status) values
      (${A}, 'brand', 'approved', true, 'provider', 'APPROVED'), (${A}, 'campaign', 'approved', true, 'provider', 'VERIFIED')`.execute(db);
    expect(await r.read(A)).toMatchObject({ a2pStatus: 'registered', providerVerified: true });
    expect((await r.read(B)).a2pStatus).toBe('not_registered');
    // a provider outage on the latest read → no longer confirmed → pending (never the old green)
    await sql`insert into tenant_messaging_registration_snapshots (tenant_id, item_kind, normalized_state, verified, source, error_class, checked_at) values
      (${A}, 'campaign', 'unknown', false, 'provider', 'provider_unavailable', now() + interval '1 second')`.execute(db);
    expect((await r.read(A)).a2pStatus).toBe('pending');
  });
  it('provider-confirmed rejection wins; a stale confirmation does not count', () => {
    const now = new Date();
    const ok = { state: 'approved', verified: true, errorClass: null, checkedAt: now };
    expect(a2pStatusOf({ brand_status: 'APPROVED', campaign_status: 'VERIFIED' }, { brand: ok, campaign: { ...ok, state: 'rejected' } }, now)).toBe('rejected');
    const old = new Date(now.getTime() - 80 * 3600 * 1000);
    expect(a2pStatusOf({ brand_status: 'APPROVED', campaign_status: 'VERIFIED' }, { brand: { ...ok, checkedAt: old }, campaign: { ...ok, checkedAt: old } }, now)).toBe('pending');
  });
  it('a failed or suspended step is rejected', () => {
    expect(a2pStatusOf({ brand_status: 'FAILED' })).toBe('rejected');
    expect(a2pStatusOf({ brand_status: 'APPROVED', campaign_status: 'SUSPENDED' })).toBe('rejected');
    expect(a2pStatusOf({ status: 'not_started' })).toBe('not_registered');
  });
  it('the settings service answers the route and the notifications category from it — and registering invents nothing', async () => {
    const owner = { tenantId: B, branchId: '', userId: 'u1', role: 'OWNER', permissions: ['settings.view', 'settings.edit', 'settings.notifications.edit'], principalType: 'staff' } as any;
    const svc = new PosSettingsService(new InMemorySettingsRepository(), undefined, undefined, undefined, undefined, null, null, null, new KyselyA2pStatusReader(db));
    expect((await svc.a2pStatus(owner)).a2pStatus).toBe('not_registered');
    const notif = await svc.getCategory(owner, 'notifications');
    expect(notif).toMatchObject({ a2pStatus: 'not_registered', senderBrand: '' });
    expect((await svc.registerA2p(owner, 'Salon B')).a2pStatus).toBe('not_registered');
  });
});
