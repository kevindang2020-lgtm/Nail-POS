// hardware-packages-activity.pgtest — w4 sweep SW-16 (Oct 13 2026): Super Admin → Hardware Packages "recent activity" was
// ALWAYS empty. The join compared hardware_packages.id (uuid) with audit_logs.entity_id (text) — PostgreSQL refused it
// ("operator does not exist: uuid = text", in the live sweep's PostgreSQL log) and .catch(() => []) hid it.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyHardwarePackagesRepo } from './hardware-packages.repository';

const T = 'c5eb0000-0000-4000-8000-0000000000a1', H = 'c5eb0000-0000-4000-8000-0000000000d1';
let repo: KyselyHardwarePackagesRepo;

beforeAll(async () => {
  const pg: any = await migratedPglite();
  const q = (s: string, p: unknown[] = []) => pg.query(s, p);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Hw LLC','Hardware Salon','hw-w4','HWW401','active')`, [T]);
  await q(`insert into hardware_packages (id, tenant_id) values ($1,$2)`, [H, T]);
  await q(`insert into audit_logs (tenant_id, action_type, entity_type, entity_id, metadata_json) values (null,'hardware_package.shipped','hardware_package',$1,'{}')`, [H]);
  repo = new KyselyHardwarePackagesRepo(kyselyFor(pg) as never);
}, 180_000);

describe('Super Admin → Hardware Packages → recent activity', () => {
  it('lists the package\'s audit events with the salon\'s name', async () => {
    const a = await repo.recentActivity(10);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ actionType: 'hardware_package.shipped', packageId: H, salonName: 'Hardware Salon' });
  });
});
