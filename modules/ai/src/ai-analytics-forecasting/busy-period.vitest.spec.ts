// busy-period.vitest.spec.ts
import { describe, it, expect } from 'vitest';
import { BusyPeriodService } from './busy-period.service';
import { AiForecastError, InMemoryHourlyDemandSource, type AiForecastContext } from './ai-analytics-forecasting.dto';
import type { HourCellInput } from './busy-period.core';

const cell = (dow: number, hour: number, avg: number, occurrences = 8): HourCellInput => ({ dow, hour, avg, occurrences, samples: avg * occurrences });
const ctx = (o: Partial<AiForecastContext> = {}): AiForecastContext => ({
  tenantId: 'T1', branchId: 'B1', userId: 'U1', role: 'OWNER', permissions: ['reports.view'], ...o,
});
const grid = () => [cell(6, 14, 8), cell(6, 15, 7), cell(5, 17, 6), cell(1, 10, 2), cell(1, 11, 2), cell(2, 10, 3), cell(3, 10, 3)];

function svc(cells: HourCellInput[]) {
  const src = new InMemoryHourlyDemandSource();
  src.seed('T1', 'B1', cells);
  src.seed('T2', 'B1', [cell(1, 9, 99)]);
  return { svc: new BusyPeriodService(src), src };
}

describe('gate', () => {
  it('requires reports.view', async () => {
    await expect(svc(grid()).svc.getBusyPeriods(ctx({ permissions: [] }))).rejects.toBeInstanceOf(AiForecastError);
  });
});

describe('classification', () => {
  it('surfaces the peak and slowest windows with a disclaimer', async () => {
    const out = await svc(grid()).svc.getBusyPeriods(ctx());
    expect(out.peak!.dow).toBe(6); expect(out.peak!.hour).toBe(14);
    expect(out.peak!.level).toBe('very_busy');
    expect(out.slowest!.avg).toBeLessThan(out.peak!.avg);
    expect(out.disclaimer).toMatch(/not a guarantee/i);
  });
});

describe('isolation', () => {
  it('reads only ctx tenant', async () => {
    const { svc: s, src } = svc(grid());
    await s.getBusyPeriods(ctx({ tenantId: 'T1' }));
    expect(src.lastCtx!.tenantId).toBe('T1');
  });
});
