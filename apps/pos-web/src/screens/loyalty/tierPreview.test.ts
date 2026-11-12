import { describe, it, expect } from 'vitest';
import { tierPreview } from './tierPreview';

const T = [
  { name: 'Silver', rank: 1, minPoints: 500, active: true },
  { name: 'Gold', rank: 2, minPoints: 1000, active: true },
  { name: 'Hand', rank: 3, minPoints: null, active: true },
  { name: 'Old', rank: 4, minPoints: 300, active: false },
];
describe('tierPreview', () => {
  it('compares lifetime earned points with the current and next configured thresholds', () => {
    const p = tierPreview(T, 'silver', 650);
    expect(p.current?.name).toBe('Silver'); expect(p.meetsCurrent).toBe(true);
    expect(p.next?.name).toBe('Gold'); expect(p.toNext).toBe(350);
  });
  it('a tier outside the configured list starts from zero; retired tiers never count', () => {
    const p = tierPreview(T, 'Regular', 1200);
    expect(p.current).toBeNull(); expect(p.next?.name).toBe('Silver'); expect(p.toNext).toBe(0);
  });
  it('a tier with no threshold has no rule and no next step; below-threshold shows the lower fit', () => {
    expect(tierPreview(T, 'Hand', 50)).toMatchObject({ meetsCurrent: null, next: null, toNext: null });
    const p = tierPreview(T, 'Gold', 600);
    expect(p.meetsCurrent).toBe(false); expect(p.lower?.name).toBe('Silver'); expect(p.next).toBeNull();
  });
});
