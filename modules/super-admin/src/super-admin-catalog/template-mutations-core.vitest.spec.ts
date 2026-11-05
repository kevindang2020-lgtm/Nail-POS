import { describe, it, expect } from 'vitest';
import { normalizeCreateTemplate, normalizeTemplatePatch, assertPublishable, assertRetirable, nextVersionLabel, normalizeCategoryCreate, normalizeCategoryPatch } from './template-mutations-core';

describe('category validators', () => {
  it('normalizeCategoryCreate requires a name', () => {
    expect(normalizeCategoryCreate({ name: ' Waxing ', iconKey: 'flame' })).toEqual({ name: 'Waxing', iconKey: 'flame' });
    expect(() => normalizeCategoryCreate({})).toThrow(/name/);
  });
  it('normalizeCategoryPatch validates fields', () => {
    expect(normalizeCategoryPatch({ name: 'New' })).toEqual({ name: 'New' });
    expect(normalizeCategoryPatch({ status: 'archived', displayOrder: 3 })).toEqual({ status: 'archived', displayOrder: 3 });
    expect(() => normalizeCategoryPatch({ status: 'nope' })).toThrow(/status/);
    expect(() => normalizeCategoryPatch({ displayOrder: -1 })).toThrow(/displayOrder/);
    expect(() => normalizeCategoryPatch({})).toThrow(/no fields/);
  });
});

describe('normalizeCreateTemplate', () => {
  it('normalizes a valid template with resources + add-ons', () => {
    const t = normalizeCreateTemplate({
      name: 'Gel Manicure', categoryCode: 'gel_manicure', description: 'Nice', durationMinutes: 45,
      priceMinCents: 3000, priceMaxCents: 5000, taxSetting: 'taxable', commissionEligible: true,
      resources: [{ label: 'Nail Tech', quantity: 1 }, { label: 'UV Lamp' }],
      addons: [{ name: 'French Tip', priceCents: 800 }],
    });
    expect(t.name).toBe('Gel Manicure');
    expect(t.resources).toEqual([{ label: 'Nail Tech', quantity: 1 }, { label: 'UV Lamp', quantity: 1 }]);
    expect(t.addons[0]).toEqual({ name: 'French Tip', priceCents: 800 });
    expect(t.isCustomizable).toBe(true);
  });
  it('rejects missing name/category, bad prices, dup add-ons', () => {
    expect(() => normalizeCreateTemplate({ categoryCode: 'x', durationMinutes: 1, priceMinCents: 0, priceMaxCents: 0 })).toThrow(/name/);
    expect(() => normalizeCreateTemplate({ name: 'X', durationMinutes: 1, priceMinCents: 0, priceMaxCents: 0 })).toThrow(/categoryCode/);
    expect(() => normalizeCreateTemplate({ name: 'X', categoryCode: 'c', durationMinutes: 1, priceMinCents: 500, priceMaxCents: 100 })).toThrow(/>=/);
    expect(() => normalizeCreateTemplate({ name: 'X', categoryCode: 'c', durationMinutes: 1, priceMinCents: 0, priceMaxCents: 100, addons: [{ name: 'A', priceCents: 1 }, { name: 'a', priceCents: 2 }] })).toThrow(/duplicate/);
  });
});

describe('normalizeTemplatePatch', () => {
  it('accepts partial updates and requires price pair together', () => {
    expect(normalizeTemplatePatch({ name: 'New' })).toEqual({ name: 'New' });
    expect(() => normalizeTemplatePatch({ priceMinCents: 100 })).toThrow(/both/);
    expect(() => normalizeTemplatePatch({})).toThrow(/no fields/);
    expect(normalizeTemplatePatch({ priceMinCents: 100, priceMaxCents: 200, changeNote: 'bump' })).toMatchObject({ priceMinCents: 100, priceMaxCents: 200, changeNote: 'bump' });
  });
});

describe('publish/retire transitions', () => {
  const ok = { status: 'draft', name: 'X', categoryCode: 'c', durationMinutes: 30, priceMinCents: 1000, priceMaxCents: 2000 };
  it('assertPublishable enforces draft + complete fields', () => {
    expect(() => assertPublishable(ok)).not.toThrow();
    expect(() => assertPublishable({ ...ok, status: 'published' })).toThrow(/already published/);
    expect(() => assertPublishable({ ...ok, status: 'retired' })).toThrow(/retired/);
    expect(() => assertPublishable({ ...ok, durationMinutes: 0 })).toThrow(/duration/);
    expect(() => assertPublishable({ ...ok, priceMaxCents: 0 })).toThrow(/price range/);
  });
  it('assertRetirable requires reason and blocks double-retire', () => {
    expect(assertRetirable({ status: 'published' }, ' old ')).toBe('old');
    expect(() => assertRetirable({ status: 'retired' }, 'x')).toThrow(/already retired/);
    expect(() => assertRetirable({ status: 'published' }, '')).toThrow(/reason/);
  });
  it('nextVersionLabel formats', () => { expect(nextVersionLabel(3)).toBe('v3.0'); });
});
