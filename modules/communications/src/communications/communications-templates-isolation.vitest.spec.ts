// communications-templates-isolation.vitest.spec.ts — 🔴 a cross-tenant WRITE, now closed.
//
// `POST /pos/communications/templates/:id/versions/:version/publish` sits behind TenantAuthGuard — any salon's
// staff. The publish chain fetched the template by id and mutated it **without ever checking the tenant**. So a
// manager at Salon A could publish (or add versions to, or read) **Salon B's** message template, just by knowing
// its id.
//
// Nothing caught it because `message_templates` is one of the 212 tenant-owned tables missing from the generated
// Kysely types, so the tenant-isolation guard could not see the query at all.
import { describe, it, expect, beforeEach } from 'vitest';
import { CommunicationsTemplatesService } from './communications-templates.service';

const SALON_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const SALON_B = 'bbbbbbbb-0000-0000-0000-000000000002';

/** A stub repo: one template owned by Salon B. */
function repo() {
  const bTemplate = {
    id: 'cccccccc-0000-0000-0000-00000000000b', tenant_id: SALON_B, name: 'Belle promo', channel: 'email',
    category: 'promotional', status: 'draft', current_version: 1, created_at: '',
  };
  return {
    published: [] as string[],
    async head(id: string) { return id === 'cccccccc-0000-0000-0000-00000000000b' ? bTemplate : null; },
    async versionRow(_id: string, _v: number) { return { status: 'draft' }; },
    async versions() { return []; },
    async publish(id: string) { (this as any).published.push(id); },
    async writeAudit() {},
    async insertHead() { return { id: 'x' }; },
    async addVersionRow() { return {}; },
  } as any;
}

let r: ReturnType<typeof repo>;
let svc: CommunicationsTemplatesService;
beforeEach(() => { r = repo(); svc = new CommunicationsTemplatesService(r); });

const asSalonA = { userId: 'mgr-a', tenantId: SALON_A };
const asSalonB = { userId: 'mgr-b', tenantId: SALON_B };

describe('a salon cannot touch another salon\'s message template', () => {
  it('Salon A CANNOT publish Salon B\'s template, even knowing its id', async () => {
    await expect(svc.publishVersion(asSalonA as any, 'cccccccc-0000-0000-0000-00000000000b', 1)).rejects.toBeTruthy();
    expect(r.published).not.toContain('cccccccc-0000-0000-0000-00000000000b');   // the write never happened
  });

  it('Salon A CANNOT read Salon B\'s template', async () => {
    await expect(svc.get(asSalonA as any, 'cccccccc-0000-0000-0000-00000000000b')).rejects.toBeTruthy();
  });

  it('the refusal is "not found" — a tenant cannot even confirm another salon\'s template EXISTS', async () => {
    const crossTenant = await svc.get(asSalonA as any, 'cccccccc-0000-0000-0000-00000000000b').catch((e) => e);
    const madeUp = await svc.get(asSalonA as any, '99999999-9999-9999-9999-999999999999').catch((e) => e);
    expect(crossTenant.constructor.name).toBe(madeUp.constructor.name);   // NotFoundException both times
  });

  it('Salon B CAN publish its own template', async () => {
    const res = await svc.publishVersion(asSalonB as any, 'cccccccc-0000-0000-0000-00000000000b', 1);
    expect(res.ok).toBe(true);
    expect(r.published).toContain('cccccccc-0000-0000-0000-00000000000b');
  });
});
