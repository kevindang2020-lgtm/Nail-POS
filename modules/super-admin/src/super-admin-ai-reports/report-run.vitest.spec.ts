import { describe, it, expect, beforeEach } from 'vitest';
import { ReportRunService, ReportRunError } from './report-run.service';
import { InMemoryReportRunRepository } from './report-run.repository';

let repo: InMemoryReportRunRepository; let svc: ReportRunService;
beforeEach(() => { repo = new InMemoryReportRunRepository(); svc = new ReportRunService(repo); });

describe('ReportRunService.generate', () => {
  it('builds a run with a server-computed metrics snapshot from real summary data (status completed)', async () => {
    const r = await svc.generate({ reportKey: 'daily_platform', start: '2026-05-01', end: '2026-05-06' });
    expect(r.idempotentReplay).toBe(false);
    expect(r.run.generationStatus).toBe('completed');
    expect(r.run.metricsSnapshot).toMatchObject({ revenueCents: 128000, bookings: 42, dataAvailable: true });
    expect(r.run.reportReference).toMatch(/^RPT-DAILY_PLATFORM-/);
    expect(repo.runs).toHaveLength(1);
  });

  it('is idempotent — a retry with the same report+scope+period returns the same run, no duplicate', async () => {
    const a = await svc.generate({ reportKey: 'daily_platform', start: '2026-05-01', end: '2026-05-06' });
    const b = await svc.generate({ reportKey: 'daily_platform', start: '2026-05-01', end: '2026-05-06' });
    expect(b.idempotentReplay).toBe(true);
    expect(b.run.id).toBe(a.run.id);
    expect(repo.runs).toHaveLength(1);
  });

  it('a different period generates a distinct run', async () => {
    await svc.generate({ reportKey: 'daily_platform', start: '2026-05-01', end: '2026-05-06' });
    const b = await svc.generate({ reportKey: 'daily_platform', start: '2026-05-07', end: '2026-05-13' });
    expect(b.idempotentReplay).toBe(false);
    expect(repo.runs).toHaveLength(2);
  });

  it('records an honest partial (not fabricated zeros) when the source has no data', async () => {
    repo.metrics = { revenueCents: 0, refundsCents: 0, bookings: 0, completed: 0, cancelled: 0, noShow: 0, newCustomers: 0, returningCustomers: 0, hasData: false };
    const r = await svc.generate({ reportKey: 'daily_platform', start: '2026-05-01', end: '2026-05-06' });
    expect(r.run.generationStatus).toBe('partial');
    expect(r.run.metricsSnapshot).toMatchObject({ dataAvailable: false });
    expect(String((r.run.metricsSnapshot as any).note)).toMatch(/unavailable/i);
  });

  it('rejects an invalid date range and a missing reportKey', async () => {
    await expect(svc.generate({ reportKey: 'daily_platform', start: '2026-05-10', end: '2026-05-01' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(svc.generate({ reportKey: '', start: '2026-05-01', end: '2026-05-06' })).rejects.toBeInstanceOf(ReportRunError);
  });

  it('getRun returns a stored run and 404s an unknown id', async () => {
    const r = await svc.generate({ reportKey: 'daily_platform', start: '2026-05-01', end: '2026-05-06' });
    expect((await svc.getRun(r.run.id)).id).toBe(r.run.id);
    await expect(svc.getRun('ghost')).rejects.toMatchObject({ code: 'not_found' });
  });
});
