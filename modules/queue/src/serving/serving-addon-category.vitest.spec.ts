// serving-addon-category.vitest.spec.ts — an "Add-ons" category is an add-on category on the WHOLE floor (wave 4 PILOT).
//
// Found by live-pilot-day.mjs: the owner filed Nail Art under a category named "Add-ons". The kiosk recognised it as an
// add-on (isAddOnCategory: "Add-on" / "Add-ons" / "Addon" …), but the Tech App's "add add-on" refused it ("Technicians
// can only add Add-on services.") and offered no suggestions — both compared the name with the literal 'Add-on'.
import { describe, it, expect } from 'vitest';
import { InMemoryServingRepository, type ServingContext } from './serving.repository';
import { ServingService, ValidationError } from './serving.service';

const tctx: ServingContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_tech_mia', role: 'TECHNICIAN', permissions: [] } as any;
function svcWith(categoryName: string) {
  const repo = new InMemoryServingRepository();
  const orig = repo.services.bind(repo);
  const extra = { serviceId: 'svc_glitter', name: 'Glitter Tips', priceCents: 1200, categoryName, durationMinutes: 10 };
  (repo as any).services = async (c: ServingContext) => [...(await orig(c)), extra];
  (repo as any).serviceCatalog = async (c: ServingContext, id: string) => (await (repo as any).services(c)).find((s: any) => s.serviceId === id) ?? null;
  return new ServingService(repo);
}

describe('add-on category names', () => {
  for (const name of ['Add-ons', 'Addons', 'add on']) {
    it(`a service in "${name}" is suggested and can be added by the technician`, async () => {
      const s = svcWith(name);
      expect((await s.techAddOnSuggestions(tctx, 'sv_4001')).map((x: any) => x.serviceId)).toContain('svc_glitter');
      const r = await s.techAddAddOn(tctx, 'sv_4001', 'svc_glitter', 'tech_mia');
      expect(r).toMatchObject({ ok: true, serviceName: 'Glitter Tips', priceCents: 1200 });
    });
  }
  it('a non-add-on category is still refused', async () => {
    await expect(svcWith('Manicure').techAddAddOn(tctx, 'sv_4001', 'svc_glitter', 'tech_mia')).rejects.toBeInstanceOf(ValidationError);
  });
});
