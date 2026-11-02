// transfer-preflight-missing-dest.vitest.spec.ts — SW-21 (wave 4 sweep): a branch transfer preflight without a destination
// (?destTenantId=) looked the tenant '' up in PostgreSQL and relied on the catch. It is answered first, unchanged:
// 404 "Destination tenant not found."
import { describe, it, expect } from 'vitest';
import { KyselySuperAdminPlatformRepo } from './super-admin-platform.repository';

describe('transferPreflight', () => {
  it('no destination id → not_found, and the tenants table is never asked about ""', async () => {
    const asked: string[] = [];
    const chain: any = { select: () => chain, where: (_c: any, _o: any, v: any) => { if (typeof v === 'string') asked.push(v); return chain; },
      executeTakeFirst: async () => ({ id: '22222222-2222-4222-8222-222222222222', name: 'Main', tenant_id: '11111111-1111-4111-8111-111111111111' }) };
    const db: any = { selectFrom: (t: string) => { asked.push('table:' + t); return chain; } };
    const r: any = await new KyselySuperAdminPlatformRepo(db).transferPreflight('22222222-2222-4222-8222-222222222222', '');
    expect(r).toEqual({ ok: false, code: 'not_found', message: 'Destination tenant not found.' });
    expect(asked).not.toContain('table:tenants');
  });
});
