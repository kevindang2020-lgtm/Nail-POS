/**
 * end-of-day-followups.repository.ts — persistence port for the Daily Follow-Up Queue plus an erroring stub. The
 * feature is inherently relational (it reads completed tickets/service-lines and writes tasks/runs/notifications), so
 * the stub refuses rather than pretending; the Kysely implementation is the real one. The service depends only on this
 * port, never on Kysely directly, so all tenant/branch/tech scoping is funneled through these methods.
 */
import type { FollowUpContext, FollowUpSettings, FollowUpStatus } from './end-of-day-followups.dto';

/** A completed service line eligible for follow-up, with the snapshot data the task needs. */
export interface CompletedLineRow {
  ticketId: string;
  ticketNumber: string | null;
  ticketServiceLineId: string;
  serviceId: string | null;
  serviceName: string;
  technicianId: string;
  technicianName: string;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  customerAppUserId: string | null;
  completedAt: string | null;
}

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
  sentAt: string | null; skipReason: string | null;
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
  recordRun(run: { tenantId: string; branchId: string; businessDate: string; runStatus: 'completed' | 'failed'; triggerSource: 'scheduler' | 'manual'; createdCount: number; skippedCount: number; errorMessage?: string | null }): Promise<void>;
  completedServiceLines(tenantId: string, branchId: string, tz: string, businessDate: string): Promise<CompletedLineRow[]>;
  insertTasksIgnoreConflict(rows: NewTaskRow[]): Promise<number>;
  notifyTechnicians(tenantId: string, technicianIds: string[], businessDate: string): Promise<void>;
  /** Soft-delete still-'pending' tasks for a branch created before the cutoff (a tech never acted on them). Returns the count removed. */
  expireStalePending(tenantId: string, branchId: string, cutoffIso: string): Promise<number>;
  /** Stage-2 cleanup: permanently delete soft-deleted (expired) task rows whose deleted_at is older than the cutoff. Global; returns the count purged. */
  purgeExpired(cutoffIso: string): Promise<number>;

  // ---- queries ----
  tasksForTechnician(tenantId: string, branchId: string, technicianId: string, opts: { businessDate?: string; status?: FollowUpStatus }): Promise<TaskRecord[]>;
  tasksForBranch(tenantId: string, branchId: string, opts: { businessDate?: string; technicianId?: string; status?: FollowUpStatus }): Promise<TaskRecord[]>;
  tasksForCustomer(tenantId: string, customerId: string): Promise<TaskRecord[]>;
  taskById(id: string): Promise<TaskRecord | null>;

  // ---- mutations ----
  // each write names the task's tenant as well as its id (the id alone left the write relying on the caller's check)
  markSent(tenantId: string, id: string, message: string, sentByUserId: string, notificationId: string | null): Promise<void>;
  markStatus(tenantId: string, id: string, status: FollowUpStatus, skipReason?: string | null): Promise<void>;
  updateMessage(tenantId: string, id: string, message: string): Promise<void>;
  markCustomerViewed(tenantId: string, id: string): Promise<void>;
  createCustomerNotification(tenantId: string, customerId: string, title: string, body: string, reference: string): Promise<string>;

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
  completedServiceLines() { return NOPE(); }
  insertTasksIgnoreConflict() { return NOPE(); }
  notifyTechnicians() { return NOPE(); }
  expireStalePending() { return NOPE(); }
  purgeExpired() { return NOPE(); }
  tasksForTechnician() { return NOPE(); }
  tasksForBranch() { return NOPE(); }
  tasksForCustomer() { return NOPE(); }
  taskById() { return NOPE(); }
  markSent() { return NOPE(); }
  markStatus() { return NOPE(); }
  updateMessage() { return NOPE(); }
  markCustomerViewed() { return NOPE(); }
  createCustomerNotification() { return NOPE(); }
  audit() { return NOPE(); }
}
