// Report-schedule engine — create / pause / resume / list + executeOccurrence. Every change is validated by
// report-schedule-core. Executing an occurrence delegates to the run engine with a schedule-occurrence idempotency key,
// so one occurrence produces exactly one run even under worker retries or duplicate ticks.
import { validateScheduleInput, computeNextRunAt, canScheduleTransition, buildScheduleOccurrenceKey } from './report-schedule-core';
import type { ReportScheduleRepositoryPort } from './report-schedule.repository';
import type { ReportRunService } from './report-run.service';

export class ScheduleError extends Error { constructor(public code: 'invalid' | 'not_found' | 'conflict', message: string) { super(message); } }

export interface CreateScheduleInput { name: string; reportKey: string; frequency: string; runAtTime?: string; timezone?: string; scopeType?: string; tenantId?: string | null; branchId?: string | null; owner?: string }

export class ReportScheduleService {
  constructor(private readonly repo: ReportScheduleRepositoryPort, private readonly runs: ReportRunService) {}

  async create(input: CreateScheduleInput, createdBy: string | null = null) {
    const runAtTime = input.runAtTime || '06:00';
    const v = validateScheduleInput({ name: input.name, reportKey: input.reportKey, frequency: input.frequency, runAtTime, nowMs: Date.now() });
    if (!v.ok) throw new ScheduleError('invalid', v.reason);
    const nextMs = computeNextRunAt(input.frequency, runAtTime, Date.now());
    return this.repo.insert({
      name: input.name.trim(), reportKey: input.reportKey.trim(), frequency: input.frequency.toLowerCase(), runAtTime, timezone: input.timezone || 'UTC',
      scopeType: input.scopeType || (input.tenantId ? 'tenant' : 'platform'), tenantId: input.tenantId ?? null, branchId: input.branchId ?? null,
      nextRunAt: nextMs ? new Date(nextMs).toISOString() : null, owner: input.owner || 'System', createdBy,
    });
  }

  private async transition(id: string, to: string) {
    const s = await this.repo.get(String(id || ''));
    if (!s) throw new ScheduleError('not_found', 'Schedule not found');
    if (!canScheduleTransition(s.status, to)) throw new ScheduleError('conflict', `cannot move a schedule from "${s.status}" to "${to}"`);
    return this.repo.setStatus(s.id, to);
  }
  async pause(id: string) { return this.transition(id, 'paused'); }
  async resume(id: string) { return this.transition(id, 'active'); }
  async list(limit = 20) { return this.repo.list(limit); }

  // Fire one occurrence: only an active schedule runs; the run is deduped by the schedule-occurrence key. After a
  // successful run, the schedule's next_run_at rolls forward. A retry of the same occurrence returns the same run.
  async executeOccurrence(id: string, occurrenceIso: string, period: { start: string; end: string }) {
    const s = await this.repo.get(String(id || ''));
    if (!s) throw new ScheduleError('not_found', 'Schedule not found');
    if (s.status !== 'active') throw new ScheduleError('conflict', `schedule is "${s.status}", not active`);
    const idempotencyKey = buildScheduleOccurrenceKey(s.id, occurrenceIso);
    const result = await this.runs.generate({ reportKey: s.reportKey, scopeType: s.scopeType, tenantId: s.tenantId, branchId: s.branchId, start: period.start, end: period.end, source: 'scheduled', idempotencyKey });
    if (!result.idempotentReplay) { const nextMs = computeNextRunAt(s.frequency, s.runAtTime, new Date(occurrenceIso).getTime()); if (nextMs) await this.repo.setNextRun(s.id, new Date(nextMs).toISOString()); }
    return { schedule: s, ...result };
  }
}
