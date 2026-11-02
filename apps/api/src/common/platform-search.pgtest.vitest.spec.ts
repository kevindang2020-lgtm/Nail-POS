// Constitution 7 §140–§141, §272 on the real schema: platform search results obey the caller's permissions (a group
// the caller cannot see is not returned), customer search is absent, and a user's % / _ are literal.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { platformPermissionsFor } from '@aipowersalon/permissions';
import { PlatformSearchService } from '@aipowersalon/super-admin';
import { seedRow } from '../events/pgtest-seed';

const T = '67676767-6767-4676-8676-676767676767', U = '68686868-6868-4686-8686-686868686868';
let svc: PlatformSearchService;
beforeAll(async () => {
  const pg = await migratedPglite(); const db = kyselyFor(pg);
  await seedRow(pg, 'tenants', { id: T, legal_name: 'B', display_name: 'Belle Palace Nails', tenant_slug: 'bellepalace', tenant_code: 'BELL01', status: 'active' });
  await seedRow(pg, 'branches', { tenant_id: T, name: 'Belle Downtown' });
  await seedRow(pg, 'users', { id: U, email: 'bella.support@platform.test', full_name: 'Bella Support', role: 'SUPER_ADMIN', platform_role: 'PLATFORM_SUPPORT' });
  await seedRow(pg, 'customers', { tenant_id: T, first_name: 'Bella', last_name: 'Customer', normalized_phone: '5551112222' });
  await seedRow(pg, 'support_tickets', { tenant_id: T, subject: 'Belle booking page blank', ticket_number: 'SUP-1001' });
  svc = new PlatformSearchService(db);
});

const kinds = (r: any) => r.groups.map((g: any) => g.kind).sort();
describe('permission-aware platform search', () => {
  it('a Super Admin finds the tenant, branch, platform user and ticket — never a customer', async () => {
    const r = await svc.search('bel', platformPermissionsFor('PLATFORM_SUPER_ADMIN'));
    expect(kinds(r)).toEqual(['branch', 'platform_user', 'support_ticket', 'tenant']);
    expect(JSON.stringify(r)).not.toMatch(/Customer|5551112222/);
  });
  it('a Finance account sees tenants and branches only; the other groups are reported hidden, not queried', async () => {
    const r = await svc.search('bel', platformPermissionsFor('PLATFORM_FINANCE'));
    expect(kinds(r)).toEqual(['branch', 'tenant']);
    expect(r.hidden.sort()).toEqual(['platform_user', 'support_ticket']);
  });
  it('an exact id finds that record; a lone % is literal (no match), and one character searches nothing', async () => {
    expect((await svc.search(T, platformPermissionsFor('PLATFORM_SUPER_ADMIN'))).groups.find((g) => g.kind === 'tenant')?.hits[0].title).toBe('Belle Palace Nails');
    expect((await svc.search('%%', platformPermissionsFor('PLATFORM_SUPER_ADMIN'))).groups).toEqual([]);
    expect((await svc.search('b', platformPermissionsFor('PLATFORM_SUPER_ADMIN'))).groups).toEqual([]);
  });
});
