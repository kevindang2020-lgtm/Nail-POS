import { describe, it, expect, beforeEach } from 'vitest';
import { ReportScheduleService, ScheduleError } from './report-schedule.service';
import { InMemoryReportScheduleRepository } from './report-schedule.repository';
import { ReportRunService } from './report-run.service';
import { InMemoryReportRunRepository } from './report-run.repository';

let schedRepo: InMemoryReportScheduleRepository; let runRepo: InMemoryReportRunRepository; let svc: ReportScheduleService;
beforeEach(() => { schedRepo = new InMemoryReportScheduleRepository(); runRepo = new InMemoryReportRunRepository(); svc = new ReportScheduleService(schedRepo, new ReportRunService(runRepo)); });

describe('ReportScheduleService', () => {
  it('creates an active schedule with a computed next run', async () => {
    const s = await svc.create({ name: 'Daily Platform', reportKey: 'daily_platform', frequency: 'daily', runAtTime: '06:00' });
    expect(s.status).toBe('active');
    expect(s.nextRunAt).toBeTruthy();
  });

  it('rejects an invalid schedule (bad frequency, missing name)', async () => {
    await expect(svc.create({ name: '', reportKey: 'x', frequency: 'daily' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(svc.create({ name: 'x', reportKey: 'x', frequency: 'hourly' })).rejects.toBeInstanceOf(ScheduleError);
  });

  it('pause then resume follows the status machine; cannot resume a disabled schedule', async () => {
    const s = await svc.create({ name: 'S', reportKey: 'daily_platform', frequency: 'daily' });
    expect((await svc.pause(s.id))!.status).toBe('paused');
    expect((await svc.resume(s.id))!.status).toBe('active');
  });

  it('executing an occurrence produces exactly ONE run, and a retry of the same occurrence reuses it', async () => {
    const s = await svc.create({ name: 'S', reportKey: 'daily_platform', frequency: 'daily' });
    const occ = '2026-05-06T06:00:00.000Z';
    const a = await svc.executeOccurrence(s.id, occ, { start: '2026-05-06', end: '2026-05-06' });
    const b = await svc.executeOccurrence(s.id, occ, { start: '2026-05-06', end: '2026-05-06' });
    expect(a.idempotentReplay).toBe(false);
    expect(b.idempotentReplay).toBe(true);
    expect(a.run.id).toBe(b.run.id);
    expect(runRepo.runs).toHaveLength(1); // one occurrence ⇒ one run, despite two executions
  });

  it('a different occurrence produces a distinct run', async () => {
    const s = await svc.create({ name: 'S', reportKey: 'daily_platform', frequency: 'daily' });
    await svc.executeOccurrence(s.id, '2026-05-06T06:00:00.000Z', { start: '2026-05-06', end: '2026-05-06' });
    await svc.executeOccurrence(s.id, '2026-05-07T06:00:00.000Z', { start: '2026-05-07', end: '2026-05-07' });
    expect(runRepo.runs).toHaveLength(2);
  });

  it('a paused schedule does not execute', async () => {
    const s = await svc.create({ name: 'S', reportKey: 'daily_platform', frequency: 'daily' });
    await svc.pause(s.id);
    await expect(svc.executeOccurrence(s.id, '2026-05-06T06:00:00.000Z', { start: '2026-05-06', end: '2026-05-06' })).rejects.toMatchObject({ code: 'conflict' });
    expect(runRepo.runs).toHaveLength(0);
  });
});
