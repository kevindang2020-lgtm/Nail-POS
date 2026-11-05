import { describe, it, expect } from 'vitest';
import { buildUpsellMix, effectiveLineKind } from './checkout.dto';

describe('checkout upsell mix', () => {
  it('effectiveLineKind prefers line_kind, falls back to is_add_on', () => {
    expect(effectiveLineKind('retail', false)).toBe('retail');
    expect(effectiveLineKind(null, true)).toBe('add_on');
    expect(effectiveLineKind(null, false)).toBe('service');
    expect(effectiveLineKind(undefined, null)).toBe('service');
  });

  it('builds shares over upsell lines only, excluding base services, sorted desc', () => {
    const mix = buildUpsellMix([
      { kind: 'service', count: 40 }, // excluded
      { kind: 'add_on', count: 24 },
      { kind: 'retail', count: 12 },
      { kind: 'upgrade', count: 4 },
    ]);
    // upsell total = 24+12+4 = 40
    expect(mix.map((m) => m.category)).toEqual(['Add-Ons', 'Retail', 'Upgrades']);
    expect(mix[0]).toMatchObject({ category: 'Add-Ons', count: 24, sharePercent: 60 });
    expect(mix[1]).toMatchObject({ category: 'Retail', sharePercent: 30 });
    expect(mix[2]).toMatchObject({ category: 'Upgrades', sharePercent: 10 });
  });

  it('returns empty when there are no upsell lines', () => {
    expect(buildUpsellMix([{ kind: 'service', count: 10 }])).toEqual([]);
  });
});
