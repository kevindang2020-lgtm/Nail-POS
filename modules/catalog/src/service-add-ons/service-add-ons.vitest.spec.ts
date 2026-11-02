import { describe, it, expect } from 'vitest';
import { buildAddOnCatalog, buildAddOnSummary } from './service-add-ons.dto';
import { ServiceAddOnsService, ServiceAddOnsForbiddenError } from './service-add-ons.service';

const ctx = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.services.view'] };
const services = [
  { serviceId: 'svc1', name: 'Signature Manicure', categoryName: 'Manicure' },
  { serviceId: 'svc2', name: 'Deluxe Pedicure', categoryName: 'Pedicure' },
];
const addOns = {
  svc1: [{ addOnId: 'a1', name: 'Paraffin', priceCents: 800, durationDeltaMinutes: 10, isTaxable: true, isActive: true }],
  svc2: [
    { addOnId: 'a2', name: 'Callus Removal', priceCents: 1200, durationDeltaMinutes: 15, isTaxable: true, isActive: true },
    { addOnId: 'a3', name: 'Retired Extra', priceCents: 500, durationDeltaMinutes: 5, isTaxable: false, isActive: false },
  ],
};

describe('service-add-ons — pure builders', () => {
  it('flattens per-service add-ons, active first then price desc', () => {
    const rows = buildAddOnCatalog(services, addOns);
    expect(rows).toHaveLength(3);
    expect(rows[0].name).toBe('Callus Removal'); // active, highest price
    expect(rows[rows.length - 1].isActive).toBe(false); // inactive last
    expect(rows[0].serviceName).toBe('Deluxe Pedicure');
  });
  it('summary counts totals, active, services, average price', () => {
    const s = buildAddOnSummary(buildAddOnCatalog(services, addOns));
    expect(s.totalAddOns).toBe(3); expect(s.activeAddOns).toBe(2); expect(s.servicesWithAddOns).toBe(2);
    expect(s.averagePriceCents).toBe(Math.round((800 + 1200 + 500) / 3));
  });
});

describe('service-add-ons — service composition', () => {
  const fakeServices = { getState: async () => ({ services: { items: [{ serviceId: 'svc1', serviceName: 'Signature Manicure', categoryName: 'Manicure' }, { serviceId: 'svc2', serviceName: 'Basic', categoryName: 'Manicure' }] } }), getAddOns: async (_c: any, id: string) => (id === 'svc1' ? addOns.svc1 : []) } as any;
  it('composes catalog from services + getAddOns (only services with add-ons queried)', async () => {
    const svc = new ServiceAddOnsService(fakeServices);
    const st = await svc.getState(ctx);
    expect(st.addOns).toHaveLength(1); expect(st.addOns[0].name).toBe('Paraffin');
    expect(st.kpis.servicesWithAddOns).toBe(1);
  });
  it('rejects unauthenticated', async () => {
    const svc = new ServiceAddOnsService(fakeServices);
    await expect(svc.getState({ tenantId: '', userId: '' } as any)).rejects.toBeInstanceOf(ServiceAddOnsForbiddenError);
  });
});
