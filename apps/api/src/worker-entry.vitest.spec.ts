// worker-entry — Constitution 13 Phase 8: the worker entry point's role rules (the boot itself is proven by compiling
// and starting dist/worker.js under each role; see the commit that added it).
import { describe, it, expect } from 'vitest';
import { workerRole } from './worker';

describe('the worker entry point', () => {
  it("runs as 'worker' when PROCESS_ROLE is unset, with every class", () => {
    const env: NodeJS.ProcessEnv = {};
    expect(workerRole(env).classes).toEqual(['critical', 'standard', 'ai', 'report', 'import', 'reconciliation']);
    expect(env.PROCESS_ROLE).toBe('worker');
  });
  it('runs only the classes WORKER_JOB_CLASSES names', () => {
    expect(workerRole({ WORKER_JOB_CLASSES: 'critical,reconciliation' }).classes).toEqual(['critical', 'reconciliation']);
  });
  it("refuses PROCESS_ROLE=api — a worker that runs nothing is a mistake", () => {
    expect(() => workerRole({ PROCESS_ROLE: 'api' })).toThrow(/cannot run with PROCESS_ROLE=api/);
  });
  it('refuses an unknown job class instead of silently running nothing', () => {
    expect(() => workerRole({ WORKER_JOB_CLASSES: 'critcal' })).toThrow(/unknown job class/);
  });
});
