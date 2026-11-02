import { describe, it, expect } from 'vitest';
import { buildServiceMix, buildAddOnMix, buildTechPerformance, completionAccuracyPercent } from './service-done.dto';

const line = (name: string, opts: Partial<{ serviceId: string; category: string; priceCents: number; isAddOn: boolean }> = {}) =>
  ({ serviceLineId: name, serviceName: name, priceCents: opts.priceCents ?? 0, isAddOn: opts.isAddOn, category: opts.category, serviceId: opts.serviceId } as any);

describe('service-done analytics helpers', () => {
  it('buildServiceMix groups non-add-on lines by category with shares', () => {
    const mix = buildServiceMix([
      { lines: [line('Acrylic', { category: 'Nail Enhancements' }), line('Gel', { category: 'Nail Enhancements', isAddOn: true })] },
      { lines: [line('Pedicure', { category: 'Pedicure' })] },
      { lines: [line('Acrylic Fill', { category: 'Nail Enhancements' })] },
    ]);
    // 3 non-add-on lines total: 2 Nail Enhancements, 1 Pedicure
    expect(mix.find((m) => m.category === 'Nail Enhancements')).toMatchObject({ count: 2, sharePercent: 66.7 });
    expect(mix.find((m) => m.category === 'Pedicure')).toMatchObject({ count: 1, sharePercent: 33.3 });
  });

  it('buildAddOnMix counts only add-ons and rolls the tail into Other', () => {
    const t = (names: string[]) => ({ lines: names.map((n) => line(n, { isAddOn: true })) });
    const mix = buildAddOnMix([t(['Gel Polish', 'Gel Polish', 'Nail Art', 'French Tip', 'Paraffin', 'Chrome'])]);
    expect(mix[0]).toMatchObject({ label: 'Gel Polish', count: 2 });
    expect(mix.find((m) => m.label === 'Other')).toMatchObject({ count: 1 }); // Chrome rolled into Other (top 4 kept)
  });

  it('buildTechPerformance aggregates guests/revenue/tips/avg time per primary tech', () => {
    const perf = buildTechPerformance([
      { primaryTechId: 'lily', primaryTechName: 'Lily Adams', lines: [line('A', { priceCents: 5000 }), line('B', { priceCents: 1000, isAddOn: true })], durationMinutes: 48, tipCents: 1200 },
      { primaryTechId: 'lily', primaryTechName: 'Lily Adams', lines: [line('C', { priceCents: 4000 })], durationMinutes: 52, tipCents: 800 },
      { primaryTechId: 'mia', primaryTechName: 'Mia Johnson', lines: [line('D', { priceCents: 6000 })], durationMinutes: 50, tipCents: 1000 },
    ], { lily: 4.9 });
    const lily = perf.find((p) => p.technicianId === 'lily')!;
    expect(lily).toMatchObject({ completedGuests: 2, revenueCents: 10000, tipsCents: 2000, avgMinutes: 50, rating: 4.9 });
    expect(perf.find((p) => p.technicianId === 'mia')!.rating).toBeNull();
    expect(perf[0].technicianId).toBe('lily'); // sorted by guests desc
  });

  // Service Done mandate §59 (Oct 28 2026): nothing completed is "no data" (null), not a decorative 100 %
  it('completionAccuracyPercent is null when none completed, else (completed-issues)/completed', () => {
    expect(completionAccuracyPercent(0, 0)).toBeNull();
    expect(completionAccuracyPercent(27, 1)).toBe(96);
  });
});
