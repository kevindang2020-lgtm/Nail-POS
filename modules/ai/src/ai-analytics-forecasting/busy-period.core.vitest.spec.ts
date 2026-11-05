// busy-period.core.vitest.spec.ts
import { describe, it, expect } from 'vitest';
import { classifyBusyPeriods, type HourCellInput } from './busy-period.core';

const cell = (dow: number, hour: number, avg: number, occurrences = 8, samples = avg * occurrences): HourCellInput => ({ dow, hour, avg, occurrences, samples });

describe('classifyBusyPeriods', () => {
  it('classifies cells relative to the branch average and finds the peak', () => {
    const r = classifyBusyPeriods([
      cell(6, 14, 8),  // Saturday 2pm — busiest
      cell(6, 10, 4),
      cell(1, 10, 2),  // Monday 10am — slow
      cell(1, 11, 2),
      cell(2, 10, 4),
    ]);
    expect(r.confidence).toBe('moderate');
    expect(r.peak!.dow).toBe(6); expect(r.peak!.hour).toBe(14);
    expect(r.peak!.level).toBe('very_busy');
    const monday = r.cells.find((c) => c.dow === 1 && c.hour === 10)!;
    expect(['slow', 'very_slow', 'normal']).toContain(monday.level);
    expect(monday.reason).toMatch(/Monday/);
  });

  it('marks the slowest populated cell', () => {
    const r = classifyBusyPeriods([cell(6, 14, 10), cell(1, 9, 1), cell(2, 9, 5), cell(3, 9, 5), cell(4, 9, 5)]);
    expect(r.slowest!.dow).toBe(1); expect(r.slowest!.hour).toBe(9);
  });

  it('is insufficient_data with too few cells or occurrences', () => {
    expect(classifyBusyPeriods([cell(6, 14, 5, 1)]).confidence).toBe('insufficient_data');
    expect(classifyBusyPeriods([]).confidence).toBe('insufficient_data');
  });
});
