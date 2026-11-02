// Vietnamese POS mandate WP-A (§93): the Super Admin's default-POS-language routes — refusals map to 400 / 404, a real
// change is audited once in the Super Admin tenant audit, a no-op is not, and no database answers 503 (never a guess).
// The SQL itself (authority, isolation, settings audit, trigger) is proved in apps/api language.pgtest.
import { describe, it, expect } from 'vitest';
import { SuperAdminTenantsController } from './super-admin-tenants.controller';
import { TenantPosLanguageError } from './tenant-pos-language';

const T = 'a7a00000-0000-4000-8000-0000000000b1';
function fakeLang() {
  let language: 'en' | 'vi' | null = null;
  return {
    async get(id: string) { if (id !== T) throw new TenantPosLanguageError('RESOURCE_NOT_FOUND', 'Tenant not found.'); return { tenantId: id, language, effective: language ?? 'en', staffWithOwnChoice: { en: 0, vi: 0 }, updatedAt: null }; },
    async set(id: string, l: unknown) {
      if (l !== 'en' && l !== 'vi') throw new TenantPosLanguageError('VALIDATION_FAILED', 'Choose English or Vietnamese.');
      const before = await this.get(id); const changed = before.language !== l; language = l;
      return { ...(await this.get(id)), changed };
    },
  };
}
const req = { ctx: { userId: 'sa-1' }, ip: '10.0.0.9' };

describe('Super Admin tenant POS language routes', () => {
  it('400 for an unsupported language, 404 for an unknown tenant', async () => {
    const c = new SuperAdminTenantsController({ recordGatewayAudit: async () => {} } as any, null as any, fakeLang() as any);
    await expect(c.setPosLanguage(T, { language: 'fr' } as any, req)).rejects.toMatchObject({ status: 400 });
    await expect(c.getPosLanguage('nope')).rejects.toMatchObject({ status: 404 });
  });
  it('a real change is audited once (actor, new value, reason); setting the same value again is not', async () => {
    const recorded: any[] = [];
    const c = new SuperAdminTenantsController({ recordGatewayAudit: async (...a: any[]) => { recorded.push(a); } } as any, null as any, fakeLang() as any);
    expect(await c.setPosLanguage(T, { language: 'vi', reason: 'Owner request' }, req)).toMatchObject({ language: 'vi', changed: true });
    expect(recorded).toEqual([[T, 'super_admin_tenant_pos_language_changed', expect.objectContaining({ userId: 'sa-1' }), expect.objectContaining({ to: 'vi', reason: 'Owner request' })]]);
    expect(await c.setPosLanguage(T, { language: 'vi' }, req)).toMatchObject({ changed: false });
    expect(recorded).toHaveLength(1);
  });
  it('no database → 503, not a made-up answer', async () => {
    const c = new SuperAdminTenantsController({} as any, null as any, undefined);
    await expect(c.getPosLanguage(T)).rejects.toMatchObject({ status: 503 });
  });
});
