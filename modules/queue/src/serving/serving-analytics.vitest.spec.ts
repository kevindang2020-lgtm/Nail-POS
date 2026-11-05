import { describe, it, expect } from 'vitest';
import { servingStageLabel, buildServingServiceMix, buildServingAddOnMix, buildServingTechPerformance } from './serving.dto';

const line = (name: string, o: Partial<{ category: string; isAddOn: boolean; priceCents: number; serviceId: string }> = {}) =>
  ({ serviceLineId: name, serviceName: name, priceCents: o.priceCents ?? 0, isAddOn: o.isAddOn, category: o.category, serviceId: o.serviceId } as any);

describe('serving analytics helpers', () => {
  it('servingStageLabel derives coarse stage from status + elapsed/estimate', () => {
    expect(servingStageLabel('not_started', 0, 60)).toBe('Just Started');
    expect(servingStageLabel('in_service', 10, 60)).toBe('In Service');
    expect(servingStageLabel('in_service', 55, 60)).toBe('Finishing Soon'); // >=85%
    expect(servingStageLabel('paused', 10, 60)).toBe('Paused');
    expect(servingStageLabel('delayed', 10, 60)).toBe('Delayed');
    expect(servingStageLabel('sent_to_service_done', 60, 60)).toBe('Ready');
  });

  it('buildServingServiceMix groups non-add-on lines by category', () => {
    const mix = buildServingServiceMix([
      { lines: [line('Acrylic', { category: 'Acrylic Full Set' }), line('Gel', { category: 'Add-On', isAddOn: true })] },
      { lines: [line('Ped', { category: 'Pedicure' })] },
      { lines: [line('Acrylic2', { category: 'Acrylic Full Set' })] },
    ]);
    expect(mix.find((m) => m.category === 'Acrylic Full Set')).toMatchObject({ count: 2, sharePercent: 66.7 });
  });

  it('buildServingAddOnMix counts add-ons with Other rollup', () => {
    const t = (names: string[]) => ({ lines: names.map((n) => line(n, { isAddOn: true })) });
    const mix = buildServingAddOnMix([t(['Nail Art', 'Nail Art', 'Gel Polish', 'French Tip', 'Paraffin', 'Waxing'])]);
    expect(mix[0]).toMatchObject({ label: 'Nail Art', count: 2 });
    expect(mix.find((m) => m.label === 'Other')).toMatchObject({ count: 1 });
  });

  it('buildServingTechPerformance aggregates active guests/revenue/avg time/rating, sorted by revenue', () => {
    const perf = buildServingTechPerformance([
      { primaryTechId: 'lily', primaryTechName: 'Lily Adams', lines: [line('A', { priceCents: 112000 })], elapsedMinutes: 54 },
      { primaryTechId: 'mia', primaryTechName: 'Mia Johnson', lines: [line('B', { priceCents: 90000 })], elapsedMinutes: 51 },
    ], { lily: 4.9 });
    expect(perf[0]).toMatchObject({ technicianId: 'lily', activeGuests: 1, revenueCents: 112000, avgMinutes: 54, rating: 4.9 });
    expect(perf[1].rating).toBeNull();
    expect(perf[0].utilizationPercent).toBeNull();
  });
});
