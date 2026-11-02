import { describe, it, expect } from 'vitest';
import { buildRebookingSuggestion } from './service-done.dto';

describe('buildRebookingSuggestion', () => {
  const now = new Date('2026-05-06T14:00:00Z');

  it('returns null with fewer than 2 prior visits (no guess)', () => {
    expect(buildRebookingSuggestion([], now)).toBeNull();
    expect(buildRebookingSuggestion(['2026-04-01T10:00:00Z'], now)).toBeNull();
  });

  it('infers a ~3 week cadence from evenly spaced visits', () => {
    const r = buildRebookingSuggestion(['2026-03-04T10:00:00Z', '2026-03-25T10:00:00Z', '2026-04-15T10:00:00Z'], now);
    expect(r).not.toBeNull();
    expect(r!.label).toBe('Fill in ~3 weeks'); // 21-day gaps
    expect(r!.window).toMatch(/–/); // a date range
  });

  it('clamps an extreme cadence into the 7–60 day range', () => {
    const r = buildRebookingSuggestion(['2026-05-04T10:00:00Z', '2026-05-05T10:00:00Z'], now); // 1-day gap -> clamp to 7
    expect(r!.label).toBe('Fill in ~1 week');
  });

  it('ignores unparseable dates', () => {
    const r = buildRebookingSuggestion(['bad', '2026-03-04T10:00:00Z', '2026-03-25T10:00:00Z', null], now);
    expect(r!.label).toBe('Fill in ~3 weeks');
  });
});
