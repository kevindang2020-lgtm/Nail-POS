/**
 * end-of-day-followups.repository.ts — persistence port for the Daily Follow-Up Queue plus an erroring stub. The
 * feature is inherently relational (it reads completed tickets/service-lines and writes tasks/runs/notifications), so
 * the stub refuses rather than pretending; the Kysely implementation is the real one. The service depends only on this
 * port, never on Kysely directly, so all tenant/branch/tech scoping is funneled through these methods.
 */
import type { FollowUpContext, FollowUpSettings, FollowUpStatus } from './end-of-day-followups.dto';
import type { EodCandidate, ClaimResult, claimAndSendTask } from './eod-center';

/** what a generation run saw (guide §6 "Evidence required") — stored on daily_follow_up_generation_runs */
export interface RunDiagnostics { candidates: number; excluded: number; exclusions: Record<string, number>; ruleVersion: string; timezone: string; generationTime: string; runKey: string }

/** A completed service line eligible for follow-up, with the snapshot data the task needs. */
/** Row to insert for a generated task (snapshots already resolved). */
export interface NewTaskRow {
  tenantId: string; branchId: string; businessDate: string; customerId: string; technicianId: string;
  ticketId: string; ticketServiceLineId: string; serviceId: string | null; serviceName: string;
  customerName: string; customerPhone: string | null; technicianName: string; customerAppUserId: string | null;
  completedAt: string | null; templateKey: string; suggestedMessage: string;
}

export interface TaskRecord {
  id: string; tenantId: string; branchId: string; businessDate: string; status: FollowUpStatus;
  customerId: string; customerName: string; customerPhone: string | null; customerAppUserId: string | null;
  serviceId: string | null; serviceName: string; ticketId: string; ticketNumber: string | null;
  ticketServiceLineId: string; appointmentId: string | null; technicianId: string; technicianName: string;
  completedAt: string | null; templateKey: string | null; suggestedMessage: string; sentMessage: string | null;
  sentAt: string | null; skipReason: string | null; expiredAt?: string | null; managerNote?: string | null;
}

export interface ActiveBranch { tenantId: string; branchId: string; }

export interface DailyFollowUpPort {
  /** Constitution 8: true when the repository writes domain events in its transactions. */
  emitsDomainEvents?(): boolean;
  // ---- config / resolution ----
  branchTimezone(tenantId: string, branchId: string): Promise<string | null>;
  settingsFor(tenantId: string, branchId: string): Promise<FollowUpSettings>;
  saveSettings(ctx: FollowUpContext, patch: Partial<FollowUpSettings>): Promise<FollowUpSettings>;
  activeBranches(): Promise<ActiveBranch[]>;
  resolveTechnicianId(ctx: FollowUpContext): Promise<string | null>;
  resolveCustomerRecordId(ctx: FollowUpContext): Promise<string | null>;

  // ---- generation ----
  runExists(tenantId: string, branchId: string, businessDate: string): Promise<boolean>;
  recordRun(run: { tenantId: string; branchId: string; businessDate: string; runStatus: 'completed' | 'failed'; triggerSource: 'scheduler' | 'manual'; createdCount: number; skippedCount: number; errorMessage?: string | null; diag?: RunDiagnostics }): Promise<void>;
  /** The ONE eligibility rule (eod-center.ts loadEodCandidates) — generation and Preview Tonight both use it. */
  eodCandidates(tenantId: string, branchId: string, tz: string, businessDate: string, cooldownHours: number, now: Date): Promise<EodCandidate[]>;
  insertTasksIgnoreConflict(rows: NewTaskRow[]): Promise<number>;
  notifyTechnicians(tenantId: string, technicianIds: string[], businessDate: string): Promise<void>;
  /** Expire UNSENT tasks (pending / awaiting approval / rejected) created before the cutoff — a status change that keeps
   *  the row and its history (migration 745; nothing is ever deleted or purged). Returns the count expired. */
  expireStalePending(tenantId: string, branchId: string, cutoffIso: string, hours: number): Promise<number>;

  // ---- queries ----
  tasksForTechnician(tenantId: string, branchId: string, technicianId: string, opts: { businessDate?: string; status?: FollowUpStatus }): Promise<TaskRecord[]>;
  tasksForBranch(tenantId: string, branchId: string, opts: { businessDate?: string; technicianId?: string; status?: FollowUpStatus }): Promise<TaskRecord[]>;
  tasksForCustomer(tenantId: string, customerId: string): Promise<TaskRecord[]>;
  taskById(id: string): Promise<TaskRecord | null>;

  // ---- mutations ----
  // each write names the task's tenant as well as its id (the id alone left the write relying on the caller's check)
  /** The send — task lock, customer protections, lifecycle move, Customer App message, event: ONE transaction. */
  claimSend(args: Parameters<typeof claimAndSendTask>[2]): Promise<ClaimResult>;
  /** technician submits a draft for approval (pending / rejected → pending_manager_approval) */
  submitForApproval(tenantId: string, id: string): Promise<boolean>;
  /** manager refuses a draft with a note the technician sees */
  rejectTask(tenantId: string, id: string, userId: string, note: string): Promise<boolean>;
  markStatus(tenantId: string, id: string, status: FollowUpStatus, skipReason?: string | null): Promise<void>;
  updateMessage(tenantId: string, id: string, message: string): Promise<void>;
  markCustomerViewed(tenantId: string, id: string): Promise<void>;

  // ---- audit ----
  audit(entry: { tenantId: string; branchId?: string | null; userId?: string | null; role?: string | null; actionType: string; entityType?: string; entityId?: string; metadata?: any }): Promise<void>;
}

const NOPE = (): never => { throw new Error('Daily Follow-Up Queue requires a database (no in-memory implementation).'); };

export class StubDailyFollowUpRepository implements DailyFollowUpPort {
  branchTimezone() { return NOPE(); }
  settingsFor() { return NOPE(); }
  saveSettings() { return NOPE(); }
  activeBranches() { return NOPE(); }
  resolveTechnicianId() { return NOPE(); }
  resolveCustomerRecordId() { return NOPE(); }
  runExists() { return NOPE(); }
  recordRun() { return NOPE(); }
  eodCandidates() { return NOPE(); }
  insertTasksIgnoreConflict() { return NOPE(); }
  notifyTechnicians() { return NOPE(); }
  expireStalePending() { return NOPE(); }
  tasksForTechnician() { return NOPE(); }
  tasksForBranch() { return NOPE(); }
  tasksForCustomer() { return NOPE(); }
  taskById() { return NOPE(); }
  claimSend() { return NOPE(); }
  submitForApproval() { return NOPE(); }
  rejectTask() { return NOPE(); }
  markStatus() { return NOPE(); }
  updateMessage() { return NOPE(); }
  markCustomerViewed() { return NOPE(); }
  audit() { return NOPE(); }
}
