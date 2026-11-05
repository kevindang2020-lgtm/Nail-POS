// tenant-navigation.pgtest.vitest.spec.ts — wave 4 (UI sweep): the POS header showed the placeholder "Your Salon" for a
// salon that has a registered name, because the sidebar's name came only from the business-settings store (empty until
// the owner saves that form). The registered name (tenants.display_name) is the salon's own — not an invented one.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { TenantNavigationService } from './tenant-navigation.service';

const T1 = '11111111-0000-4000-8000-000000000001', T2 = '11111111-0000-4000-8000-000000000002';
const B1 = '22222222-0000-4000-8000-000000000001', B2 = '22222222-0000-4000-8000-000000000002';
let pg: any; let svc: TenantNavigationService;
const ctx = (tenantId: string, branchId: string) => ({ tenantId, branchId, role: 'OWNER', permissions: ['dashboard.view'] });

beforeAll(async () => {
  pg = await migratedPglite();
  svc = new TenantNavigationService(kyselyFor(pg) as any);
  await pg.query(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Pilot LLC','Pilot Nail Salon','pilot','PILOT'),($2,'Other LLC','Other Salon','other','OTHER')`, [T1, T2]);
  await pg.query(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','UTC'),($3,$4,'Main','active','UTC')`, [B1, T1, B2, T2]);
}, 240_000);

describe('the salon name in the POS header', () => {
  it('is the registered name when the business settings have none', async () => {
    expect((await svc.navigation(ctx(T1, B1))).salonName).toBe('Pilot Nail Salon');
  });
  it('is the name saved in the business settings when there is one (branch row first)', async () => {
    await pg.query(`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values ($1, null, 'business-branch', '{"salonName":"Pilot Nails & Spa"}')`, [T1]);
    expect((await svc.navigation(ctx(T1, B1))).salonName).toBe('Pilot Nails & Spa');
    await pg.query(`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values ($1, $2, 'business-branch', '{"salonName":"Pilot — Main St"}')`, [T1, B1]);
    expect((await svc.navigation(ctx(T1, B1))).salonName).toBe('Pilot — Main St');
  });
  it('never another tenant\'s name', async () => {
    expect((await svc.navigation(ctx(T2, B2))).salonName).toBe('Other Salon');
  });
});
