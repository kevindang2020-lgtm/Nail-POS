// catalog-lines.vitest.spec.ts — the ONE rule for services on a booking / check-in / queue item / tech ticket (Oct 1).
import { describe, it, expect } from 'vitest';
import { resolveCatalogLines, CatalogLineError } from './catalog-lines';

const catalog = [
  { serviceId: 'mani', name: 'Gel Manicure', durationMinutes: 60, priceCents: 4500 },
  { serviceId: 'gel', name: 'Gel Add-on', durationMinutes: 15, priceCents: 1500 },
];
const run = (a: any) => resolveCatalogLines({ catalog, mayOverride: false, ...a });

describe('resolveCatalogLines', () => {
  it('a catalog id takes the catalog name, duration and price', () => {
    expect(run({ ids: ['mani'] })).toEqual([{ serviceId: 'mani', serviceName: 'Gel Manicure', durationMinutes: 60, priceCents: 4500 }]);
  });
  it('an id not in the catalog is refused — never saved as a $0 "Archived/Custom Service" (the Sep 28 regression)', () => {
    expect(() => run({ ids: ['nope'] })).toThrow(CatalogLineError);
    expect(() => run({ lines: [{ serviceId: 'nope', name: 'X', durationMinutes: 30, priceCents: 0 }] })).toThrow(/Unknown service/);
  });
  it('an archived service already on the record is kept exactly as it was (not re-priced, not refused)', () => {
    const existing = [{ serviceId: 'old', serviceName: 'Retired Pedicure', durationMinutes: 50, priceCents: 3900 }];
    expect(run({ ids: ['old', 'mani'], existing })).toEqual([existing[0], { serviceId: 'mani', serviceName: 'Gel Manicure', durationMinutes: 60, priceCents: 4500 }]);
  });
  it("the device's duration is ignored for a catalog service (a 60-minute service sent as 10 minutes stays 60)", () => {
    expect(run({ lines: [{ serviceId: 'mani', name: 'Gel Manicure', durationMinutes: 10, priceCents: 4500 }] })[0].durationMinutes).toBe(60);
  });
  it('a price change needs the override permission AND a reason', () => {
    const line = { serviceId: 'mani', priceCents: 3000, overrideReason: 'loyal client' };
    expect(() => run({ lines: [line] })).toThrow(/needs a manager/);
    expect(() => resolveCatalogLines({ catalog, mayOverride: true, lines: [{ ...line, overrideReason: ' ' }] })).toThrow(/needs a reason/);
    expect(resolveCatalogLines({ catalog, mayOverride: true, lines: [line] })[0]).toMatchObject({ priceCents: 3000, priceOverrideCents: 3000, overrideReason: 'loyal client' });
    expect(() => run({ ids: ['mani'], priceOverrides: { mani: { priceCents: 100, reason: 'x' } } })).toThrow(/needs a manager/);
  });
  it('sending the catalog price is not an override (no permission needed)', () => {
    expect(run({ lines: [{ serviceId: 'mani', priceCents: 4500 }] })[0]).not.toHaveProperty('priceOverrideCents');
  });
  it('a custom service (no id) is an override: permission, reason and a real duration; never negative or fractional cents', () => {
    const custom = { name: 'Nail repair', durationMinutes: 20, priceCents: 1000, overrideReason: 'broken nail' };
    expect(() => run({ lines: [custom] })).toThrow(/needs a manager/);
    expect(resolveCatalogLines({ catalog, mayOverride: true, lines: [custom] })[0]).toMatchObject({ serviceId: 'custom_0', serviceName: 'Nail repair', durationMinutes: 20, priceCents: 1000 });
    expect(() => resolveCatalogLines({ catalog, mayOverride: true, lines: [{ ...custom, durationMinutes: 0 }] })).toThrow(/duration/);
    expect(() => resolveCatalogLines({ catalog, mayOverride: true, lines: [{ ...custom, priceCents: -5 }] })).toThrow(/whole cents/);
    expect(() => resolveCatalogLines({ catalog, mayOverride: true, lines: [{ serviceId: 'mani', priceCents: 12.5, overrideReason: 'x' }] })).toThrow(/whole cents/);
  });
  it('add-on markers are carried', () => {
    expect(run({ lines: [{ serviceId: 'gel', isAddon: true, parentServiceId: 'mani' }] })[0]).toMatchObject({ isAddon: true, parentServiceId: 'mani', durationMinutes: 15 });
  });
});
