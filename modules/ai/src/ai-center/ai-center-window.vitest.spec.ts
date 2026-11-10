// batch 9 guide 14 (Nov 10 2026): the AI Analytics window — presets resolve to salon days, custom ranges are clamped
import { describe, it, expect } from 'vitest';
import { resolveWindow } from './ai-center.kysely.repository';

describe('resolveWindow', () => {
  it('defaults to today; presets are salon days ending today (week starts Monday)', () => {
    expect(resolveWindow(undefined, '2026-11-10')).toEqual({ from: '2026-11-10', to: '2026-11-10' });
    expect(resolveWindow({ preset: 'week' }, '2026-11-10')).toEqual({ from: '2026-11-09', to: '2026-11-10' });   // Tue → Mon
    expect(resolveWindow({ preset: 'month' }, '2026-11-10')).toEqual({ from: '2026-11-01', to: '2026-11-10' });
    expect(resolveWindow({ preset: 'year' }, '2026-11-10')).toEqual({ from: '2026-01-01', to: '2026-11-10' });
  });
  it('a custom range never runs past today, never inverts, and is capped at a year', () => {
    expect(resolveWindow({ from: '2026-10-01', to: '2026-12-31' }, '2026-11-10')).toEqual({ from: '2026-10-01', to: '2026-11-10' });
    expect(resolveWindow({ from: '2026-11-20', to: '2026-11-25' }, '2026-11-10')).toEqual({ from: '2026-11-10', to: '2026-11-10' });
    expect(resolveWindow({ from: '2020-01-01', to: '2026-11-10' }, '2026-11-10').from).toBe('2025-11-10');
  });
});
