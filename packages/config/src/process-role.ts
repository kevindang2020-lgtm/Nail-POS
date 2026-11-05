// process-role.ts — which background work THIS process runs (Constitution 13 Phase 8, §60–61, §288).
//
// Every interval scheduler used to start in the API's web process. Now each background scheduler asks, once at start-up,
// runsBackgroundJob(<its job class>). The switch is two environment variables:
//
//   PROCESS_ROLE        'all' (default) | 'api' | 'worker'
//                        all    — today's single-process deploy: the API also runs every background job (unchanged)
//                        api    — the web process: serves requests, runs NO background jobs
//                        worker — a worker process (apps/workers): runs the job classes WORKER_JOB_CLASSES names
//   WORKER_JOB_CLASSES  comma-separated job classes for a worker, e.g. "critical,reconciliation"; unset = every class
//
// Process-LOCAL schedulers (the HTTP metrics flush, the realtime live-ops presence) are not background jobs: they run in
// every process and do not ask. An unknown PROCESS_ROLE or job class throws — a typo must not silently stop billing.
export const JOB_CLASSES = ['critical', 'standard', 'ai', 'report', 'import', 'reconciliation'] as const;
export type BackgroundJobClass = (typeof JOB_CLASSES)[number];
export type ProcessRole = 'all' | 'api' | 'worker';

export function processRole(env: NodeJS.ProcessEnv = process.env): ProcessRole {
  const r = (env.PROCESS_ROLE ?? 'all').trim().toLowerCase();
  if (r === 'all' || r === 'api' || r === 'worker') return r;
  throw new Error(`PROCESS_ROLE must be all | api | worker (got "${env.PROCESS_ROLE}")`);
}

export function workerJobClasses(env: NodeJS.ProcessEnv = process.env): readonly BackgroundJobClass[] {
  const raw = (env.WORKER_JOB_CLASSES ?? '').trim();
  if (!raw) return JOB_CLASSES;
  const out = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const c of out) if (!(JOB_CLASSES as readonly string[]).includes(c)) throw new Error(`WORKER_JOB_CLASSES: unknown job class "${c}" (known: ${JOB_CLASSES.join(', ')})`);
  return out as BackgroundJobClass[];
}

/** Does this process run background jobs of this class? Asked once, in a scheduler's onModuleInit. */
export function runsBackgroundJob(jobClass: BackgroundJobClass, env: NodeJS.ProcessEnv = process.env): boolean {
  const role = processRole(env);
  if (role === 'all') return true;
  if (role === 'api') return false;
  return workerJobClasses(env).includes(jobClass);
}
