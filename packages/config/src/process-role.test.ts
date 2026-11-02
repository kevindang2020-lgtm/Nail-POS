import { describe, it, expect } from 'vitest';
import { processRole, workerJobClasses, runsBackgroundJob, JOB_CLASSES } from './process-role';

describe('process role (Constitution 13 Phase 8)', () => {
  it("defaults to 'all' — today's single-process deploy runs every job, unchanged", () => {
    expect(processRole({})).toBe('all');
    for (const c of JOB_CLASSES) expect(runsBackgroundJob(c, {})).toBe(true);
  });
  it('the api role runs no background job', () => {
    for (const c of JOB_CLASSES) expect(runsBackgroundJob(c, { PROCESS_ROLE: 'api' })).toBe(false);
  });
  it('a worker runs exactly the classes it names, or all when it names none', () => {
    const env = { PROCESS_ROLE: 'worker', WORKER_JOB_CLASSES: 'critical, reconciliation' };
    expect(runsBackgroundJob('critical', env)).toBe(true);
    expect(runsBackgroundJob('reconciliation', env)).toBe(true);
    expect(runsBackgroundJob('ai', env)).toBe(false);
    expect(workerJobClasses({ PROCESS_ROLE: 'worker' })).toEqual(JOB_CLASSES);
  });
  it('a typo throws instead of silently stopping work', () => {
    expect(() => processRole({ PROCESS_ROLE: 'wroker' })).toThrow(/PROCESS_ROLE/);
    expect(() => workerJobClasses({ WORKER_JOB_CLASSES: 'critcal' })).toThrow(/unknown job class/);
  });
});
