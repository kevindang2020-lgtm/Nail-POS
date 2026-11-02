// scheduler-coordination.ts — one owner per scheduled tick across every process (BUILD_PLAN Phase 2; Constitution 4
// §25 / §167; migration 518).
//
// Every background scheduler calls runTick(meta, fn) for each tick (instead of runJob): when a coordinator is installed
// — the API and the worker install the database lease coordinator at start-up — the tick runs only in the process that
// wins that scheduler's lease for this interval; every other process records a heartbeat and skips. With no
// coordinator (unit tests, a process without a database) the tick simply runs, exactly as runJob did.
import { runJob, noteTickHeartbeat, noteDeclaredInterval, type JobMeta } from './job-telemetry';
import { registry } from './metrics';

export type TickCoordinator = (name: string, everyMs: number, body: () => Promise<unknown>) => Promise<{ ran: boolean }>;

export const schedulerTicksSkipped = registry.counter('aipowersalon_scheduler_ticks_skipped_total', 'Scheduled ticks skipped because another process owns them', ['job_type']);

let coordinator: TickCoordinator | null = null;
export function setTickCoordinator(c: TickCoordinator | null): void { coordinator = c; }
export function tickCoordinatorInstalled(): boolean { return coordinator !== null; }

/**
 * Run one tick of a scheduler. `everyMs` is the scheduler's interval: a tick starts at most once per ~interval across
 * the fleet. Rethrows the tick's failure (like runJob); returns whether THIS process ran it.
 */
const heldLogged = new Set<string>();
function logHoldOnce(jobType: string): void { if (heldLogged.has(jobType)) return; heldLogged.add(jobType); console.warn(`[scheduler:${jobType}] ${POST_RESTORE_HOLD_MESSAGE}`); }
/** Read from process.env on every tick (an env flip on the host, no deploy). Inlined — observability sits below config. */
function postRestoreHoldActive(env: NodeJS.ProcessEnv = process.env): boolean { const v = String(env.POST_RESTORE_HOLD ?? '').trim().toLowerCase(); return v === '1' || v === 'true' || v === 'yes' || v === 'on'; }
const POST_RESTORE_HOLD_MESSAGE = 'POST_RESTORE_HOLD is set: background work (jobs, outbox dispatch, schedulers) is paused until the post-restore reconciliation is done and the variable is cleared (DISASTER_RECOVERY.md §3.1).';

export async function runTick(meta: JobMeta & { everyMs: number }, fn: () => Promise<unknown>): Promise<{ ran: boolean }> {
  const { everyMs, ...jobMeta } = meta;
  noteDeclaredInterval(jobMeta, everyMs);
  // mandate §212 (Oct 20 2026): POST_RESTORE_HOLD pauses every scheduler (membership renewals + autobill, reminders,
  // sweeps, exports …) until the post-restore reconciliation is done. The tick still heartbeats so health sees a paused
  // scheduler, not a dead one.
  if (postRestoreHoldActive()) { noteTickHeartbeat(jobMeta, everyMs); schedulerTicksSkipped.inc({ job_type: jobMeta.jobType }); logHoldOnce(jobMeta.jobType); return { ran: false }; }
  if (!coordinator) { await runJob(jobMeta, fn); return { ran: true }; }
  const out = await coordinator(jobMeta.jobType, everyMs, () => runJob(jobMeta, fn));
  if (!out.ran) { noteTickHeartbeat(jobMeta, everyMs); schedulerTicksSkipped.inc({ job_type: jobMeta.jobType }); }
  return out;
}
