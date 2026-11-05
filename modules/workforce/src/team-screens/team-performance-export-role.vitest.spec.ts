// D1 gaps (Nov 5 2026): the Team Performance export is role-checked — viewing the screen (pos.technicians.view) is not
// enough; reports.export is needed. The CSV is never built for someone without it.
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { TeamPerformanceScreenController } from './team-performance-screen.controller';

const req = (permissions: string[]) => ({ ctx: { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'FRONT_DESK', permissions }, res: { setHeader: vi.fn() } });

describe('Team Performance export role', () => {
  it('without reports.export: 403 EXPORT_NOT_ALLOWED and no CSV built', async () => {
    const exportCsv = vi.fn(async () => ({ csv: 'x', filename: 'f.csv', requestId: 'r' }));
    const c = new TeamPerformanceScreenController({ exportCsv } as any);
    expect(() => c.exportCsv(req(['pos.technicians.view']), {})).toThrow(expect.objectContaining({ status: 403 }));
    try { c.exportCsv(req(['pos.technicians.view']), {}); } catch (e: any) { expect(e.getResponse().code).toBe('EXPORT_NOT_ALLOWED'); }
    expect(exportCsv).not.toHaveBeenCalled();
  });
  it('with reports.export: the CSV is returned', async () => {
    const exportCsv = vi.fn(async () => ({ csv: 'name\n', filename: 'f.csv', requestId: 'r' }));
    const c = new TeamPerformanceScreenController({ exportCsv } as any);
    expect(await c.exportCsv(req(['pos.technicians.view', 'reports.export']), {})).toBe('name\n');
  });
});
