import { describe, it, expect } from 'vitest';
import { SuperAdminScheduledReportsService, computeNextRun } from './super-admin-scheduled-reports.service';
import { InMemorySuperAdminScheduledReportRepo } from './super-admin-scheduled-reports.repository';

const ctx = { userId: 'u1', email: 'admin@aps.test' };

const analyticsStub: any = {
  exportData: async (_c: any, format: string) => ({ filename: `analytics.${format}`, mimeType: 'text/csv', base64: Buffer.from('col,val\nRevenue,$1.00', 'utf8').toString('base64') }),
};
const reportsStub: any = {
  get: async (id: string) => (id === 'missing' ? null : { id, name: 'Saved', dimension: 'branch', measure: 'revenue_cents', visualization: 'bar', rowLimit: 50 }),
  run: async () => ({ ok: true, available: true, columns: ['branch', 'Revenue'], format: 'money', source: 'branchComparison', rows: [{ label: 'A', value: 31260000 }] }),
};
const newSvc = () => {
  const inserts: any[] = [];
  const db: any = { insertInto: () => ({ values: (v: any) => { inserts.push(v); return { execute: async () => {} }; } }) };
  return { svc: new SuperAdminScheduledReportsService(new InMemorySuperAdminScheduledReportRepo(), analyticsStub, reportsStub, db), inserts };
};
const past = new Date(Date.now() - 86_400_000).toISOString();

describe('computeNextRun', () => {
  it('advances by the right interval', () => {
    const base = '2026-06-01T00:00:00.000Z';
    expect(computeNextRun(base, 'daily')).toBe('2026-06-02T00:00:00.000Z');
    expect(computeNextRun(base, 'weekly')).toBe('2026-06-08T00:00:00.000Z');
    expect(computeNextRun(base, 'monthly')).toBe('2026-07-01T00:00:00.000Z');
  });
});

describe('SuperAdminScheduledReportsService', () => {
  it('creates an analytics_export schedule (validated + audited), defaulting next_run to the future', async () => {
    const { svc, inserts } = newSvc();
    const s = await svc.create(ctx, { name: 'Weekly platform CSV', source: 'analytics_export', format: 'csv', frequency: 'weekly', range: '30d' });
    expect(s.id).toBeTruthy();
    expect(new Date(s.nextRunAt).getTime()).toBeGreaterThan(Date.now());
    expect(inserts.some((i) => i.action_type === 'scheduled_report.create')).toBe(true);
  });

  it('rejects an empty name and a saved_report without a definition id', async () => {
    const { svc } = newSvc();
    await expect(svc.create(ctx, { name: ' ', source: 'analytics_export' })).rejects.toThrow(/name/i);
    await expect(svc.create(ctx, { name: 'x', source: 'saved_report' })).rejects.toThrow(/reportDefinitionId/);
  });

  it('runDue executes due schedules, records a success run, and advances next_run past now', async () => {
    const { svc, inserts } = newSvc();
    const s = await svc.create(ctx, { name: 'Due now', source: 'analytics_export', format: 'csv', frequency: 'daily', nextRunAt: past });
    const out = await svc.runDue(ctx);
    expect(out.dueCount).toBe(1);
    expect(out.results[0].status).toBe('success');
    const after = await svc.get(s.id);
    expect(new Date(after!.nextRunAt).getTime()).toBeGreaterThan(Date.now());
    expect(after!.lastRunAt).not.toBeNull();
    const runs = await svc.listRuns(s.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('success');
    expect(inserts.some((i) => i.action_type === 'scheduled_report.run')).toBe(true);
  });

  it('produces a downloadable artifact for a successful run', async () => {
    const { svc } = newSvc();
    const s = await svc.create(ctx, { name: 'X', source: 'analytics_export', format: 'csv', frequency: 'daily', nextRunAt: past });
    await svc.runDue(ctx);
    const run = (await svc.listRuns(s.id))[0];
    const art = await svc.getRunArtifact(run.id);
    expect(art).not.toBeNull();
    expect(art!.mimeType).toBe('text/csv');
    expect(Buffer.from(art!.base64, 'base64').toString('utf8')).toContain('Revenue');
  });

  it('runs a saved_report schedule by executing its definition', async () => {
    const { svc } = newSvc();
    const s = await svc.create(ctx, { name: 'Saved CSV', source: 'saved_report', reportDefinitionId: 'rd1', format: 'csv', frequency: 'weekly' });
    const res = await svc.runNow(ctx, s.id);
    expect(res!.status).toBe('success');
    const art = await svc.getRunArtifact((res as any).runId);
    expect(Buffer.from(art!.base64, 'base64').toString('utf8')).toContain('branch');
  });

  it('records an error run (no fabricated artifact) when the definition is gone', async () => {
    const { svc } = newSvc();
    const s = await svc.create(ctx, { name: 'Broken', source: 'saved_report', reportDefinitionId: 'missing', format: 'csv', frequency: 'weekly' });
    const res = await svc.runNow(ctx, s.id);
    expect(res!.status).toBe('error');
    expect(await svc.getRunArtifact((res as any).runId)).toBeNull(); // no artifact on error
  });

  it('disables a schedule so it is no longer due', async () => {
    const { svc } = newSvc();
    const s = await svc.create(ctx, { name: 'Toggle', source: 'analytics_export', format: 'csv', frequency: 'daily', nextRunAt: past });
    await svc.update(ctx, s.id, { enabled: false });
    const out = await svc.runDue(ctx);
    expect(out.dueCount).toBe(0);
  });
});
