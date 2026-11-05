// ai-follow-up.service.ts — human-action follow-ups from the AI receptionist. Tenant-scoped (server-derived in the
// controller), permission-gated for writes. Created from a handoff-callback (source 'ai_receptionist') or manually.
// A retried handoff won't stack duplicates: createFromCall is idempotent per (tenant, provider_call_id) while the
// follow-up is still open. This is a task queue over existing records — it references customer/appointment/call by id.
import { Injectable, Inject } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { canMoveToSql } from '@aipowersalon/database';
import { AI_RECEPTIONIST_FOLLOW_UP } from '../ai-lifecycles';
import { hasPermission } from '@aipowersalon/permissions';

export type FollowUpStatus = 'open' | 'assigned' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
export type FollowUpPriority = 'low' | 'normal' | 'high' | 'urgent';
export const FOLLOW_UP_REASONS = ['CALLBACK', 'CUSTOMER_REQUESTED_HUMAN', 'COMPLAINT', 'REFUND_REQUEST', 'PAYMENT_QUESTION', 'PRICING_REQUIRES_SALON', 'SERVICE_NOT_FOUND', 'NO_ACCEPTABLE_AVAILABILITY', 'GROUP_BOOKING', 'MEDICAL_OR_SAFETY_CONCERN', 'REPEATED_TOOL_FAILURE', 'OTHER'] as const;

export interface FollowUpCtx { tenantId: string; branchId: string | null; userId: string; role: string; permissions: string[] }
export interface FollowUpRow {
  id: string; tenantId: string; branchId: string | null; reason: string; priority: FollowUpPriority; status: FollowUpStatus;
  customerId: string | null; callerPhone: string | null; providerCallId: string | null; appointmentId: string | null;
  assignedUserId: string | null; dueAtMs: number | null; notes: string | null; resolution: string | null;
  source: string; createdByUserId: string | null; createdAtMs: number; updatedAtMs: number;
}
export interface CreateFollowUpInput { reason: string; priority?: FollowUpPriority; customerId?: string | null; callerPhone?: string | null; providerCallId?: string | null; appointmentId?: string | null; notes?: string | null }

export class FollowUpForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'FollowUpForbiddenError'; } }
export class FollowUpNotFoundError extends Error { constructor(msg = 'Follow-up not found') { super(msg); this.name = 'FollowUpNotFoundError'; } }
export class FollowUpValidationError extends Error { constructor(msg: string) { super(msg); this.name = 'FollowUpValidationError'; } }

/** BUILD_PLAN Phase 12 (#27): the ONE table is the ai_receptionist_follow_up machine (ai-lifecycles.ts). */
const STATUS_FLOW = (from: FollowUpStatus): readonly FollowUpStatus[] => (AI_RECEPTIONIST_FOLLOW_UP.transitions[from] ?? []) as readonly FollowUpStatus[];
export function canTransitionFollowUp(from: FollowUpStatus, to: FollowUpStatus): boolean { return STATUS_FLOW(from).includes(to); }

export interface FollowUpRepo {
  list(tenantId: string, opts: { status?: string; assignedUserId?: string; limit?: number }): Promise<FollowUpRow[]>;
  get(tenantId: string, id: string): Promise<FollowUpRow | null>;
  insert(tenantId: string, branchId: string | null, input: Required<Pick<CreateFollowUpInput, 'reason'>> & CreateFollowUpInput, source: string, createdByUserId: string | null): Promise<FollowUpRow>;
  /** Idempotent per open (tenant, provider_call_id): returns the existing open row if present. */
  insertForCall(tenantId: string, branchId: string | null, input: CreateFollowUpInput, source: string): Promise<FollowUpRow>;
  patch(tenantId: string, id: string, fields: Partial<Pick<FollowUpRow, 'status' | 'priority' | 'assignedUserId' | 'notes' | 'resolution'>> & { fromStatus?: FollowUpStatus }): Promise<FollowUpRow | null>;
}

@Injectable()
export class AiFollowUpService {
  constructor(@Inject('FollowUpRepo') private readonly repo: FollowUpRepo) {}
  private canManage(ctx: FollowUpCtx) { if (!hasPermission(ctx as any, 'ai.manage')) throw new FollowUpForbiddenError('Missing ai.manage'); }
  private validReason(r: string) { if (!FOLLOW_UP_REASONS.includes(r as any)) throw new FollowUpValidationError('Invalid follow-up reason.'); }

  async list(ctx: FollowUpCtx, opts: { status?: string; mine?: boolean; limit?: number } = {}): Promise<FollowUpRow[]> {
    const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500); // bounded: never return an unbounded set
    return this.repo.list(ctx.tenantId, { status: opts.status, assignedUserId: opts.mine ? ctx.userId : undefined, limit });
  }
  async get(ctx: FollowUpCtx, id: string): Promise<FollowUpRow> {
    const row = await this.repo.get(ctx.tenantId, id); if (!row) throw new FollowUpNotFoundError(); return row;
  }
  async createManual(ctx: FollowUpCtx, input: CreateFollowUpInput): Promise<FollowUpRow> {
    this.canManage(ctx); this.validReason(input.reason);
    return this.repo.insert(ctx.tenantId, ctx.branchId, { ...input, reason: input.reason, notes: input.notes ? String(input.notes).slice(0, 2000) : null }, 'manual', ctx.userId);
  }
  /** Called by the gateway handoff (AI, no user). Idempotent per open source call. */
  async createFromHandoff(scope: { tenantId: string; branchId: string | null }, input: CreateFollowUpInput): Promise<FollowUpRow> {
    return this.repo.insertForCall(scope.tenantId, scope.branchId, { ...input, reason: FOLLOW_UP_REASONS.includes(input.reason as any) ? input.reason : 'CALLBACK' }, 'ai_receptionist');
  }
  async assign(ctx: FollowUpCtx, id: string, assignedUserId: string | null): Promise<FollowUpRow> {
    this.canManage(ctx); const cur = await this.get(ctx, id);
    // Phase 12 (#27): assigning moves the status to 'assigned' only where the table allows it (it used to force it from any
    // status — re-opening a closed or resolved follow-up); otherwise the assignee changes and the status stays
    const move = cur.status !== 'assigned' && canTransitionFollowUp(cur.status, 'assigned');
    const row = await this.repo.patch(ctx.tenantId, id, move ? { assignedUserId, status: 'assigned', fromStatus: cur.status } : { assignedUserId });
    if (!row) throw new FollowUpValidationError('This follow-up changed — refresh and try again.'); return row;
  }
  async addNote(ctx: FollowUpCtx, id: string, note: string): Promise<FollowUpRow> {
    this.canManage(ctx); const cur = await this.get(ctx, id);
    const merged = [cur.notes, `\u2022 ${String(note).slice(0, 1000)}`].filter(Boolean).join('\n');
    const row = await this.repo.patch(ctx.tenantId, id, { notes: merged }); if (!row) throw new FollowUpNotFoundError(); return row;
  }
  async setStatus(ctx: FollowUpCtx, id: string, status: FollowUpStatus, resolution?: string): Promise<FollowUpRow> {
    this.canManage(ctx); const cur = await this.get(ctx, id);
    if (!canTransitionFollowUp(cur.status, status)) throw new FollowUpValidationError(`Cannot move a follow-up from ${cur.status} to ${status}.`);
    const row = await this.repo.patch(ctx.tenantId, id, { status, fromStatus: cur.status, resolution: resolution ? String(resolution).slice(0, 2000) : cur.resolution });
    if (!row) throw new FollowUpValidationError('This follow-up changed — refresh and try again.'); return row;
  }
}

// ---- repos ----
const nowMs = () => Date.now();
export class InMemoryFollowUpRepo implements FollowUpRepo {
  private rows: FollowUpRow[] = []; private seq = 0;
  private mk(tenantId: string, branchId: string | null, input: CreateFollowUpInput, source: string, createdByUserId: string | null): FollowUpRow {
    return { id: 'fu_' + (++this.seq), tenantId, branchId, reason: input.reason, priority: input.priority ?? 'normal', status: 'open', customerId: input.customerId ?? null, callerPhone: input.callerPhone ?? null, providerCallId: input.providerCallId ?? null, appointmentId: input.appointmentId ?? null, assignedUserId: null, dueAtMs: null, notes: input.notes ?? null, resolution: null, source, createdByUserId, createdAtMs: nowMs(), updatedAtMs: nowMs() };
  }
  async list(tenantId: string, opts: { status?: string; assignedUserId?: string; limit?: number }): Promise<FollowUpRow[]> {
    return this.rows.filter((r) => r.tenantId === tenantId && (!opts.status || r.status === opts.status) && (!opts.assignedUserId || r.assignedUserId === opts.assignedUserId)).sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, opts.limit ?? 200);
  }
  async get(tenantId: string, id: string) { return this.rows.find((r) => r.tenantId === tenantId && r.id === id) ?? null; }
  async insert(tenantId: string, branchId: string | null, input: CreateFollowUpInput, source: string, createdByUserId: string | null) { const r = this.mk(tenantId, branchId, input, source, createdByUserId); this.rows.push(r); return r; }
  async insertForCall(tenantId: string, branchId: string | null, input: CreateFollowUpInput, source: string) {
    const open = this.rows.find((r) => r.tenantId === tenantId && r.providerCallId && r.providerCallId === input.providerCallId && r.status !== 'resolved' && r.status !== 'closed');
    if (open) return open;
    const r = this.mk(tenantId, branchId, input, source, null); this.rows.push(r); return r;
  }
  async patch(tenantId: string, id: string, fields: any) {
    const r = this.rows.find((x) => x.tenantId === tenantId && x.id === id); if (!r) return null;
    const { fromStatus, ...rest } = fields ?? {};
    if (fromStatus !== undefined && r.status !== fromStatus) return null;   // the conditional write (Phase 12 #27)
    Object.assign(r, rest, { updatedAtMs: nowMs() }); if (fields.status === 'resolved' || fields.status === 'closed') (r as any).resolvedAtMs = nowMs(); return r;
  }
}

export class KyselyFollowUpRepo implements FollowUpRepo {
  constructor(private readonly db: Kysely<any>) {}
  private map = (r: any): FollowUpRow => ({ id: r.id, tenantId: r.tenant_id, branchId: r.branch_id ?? null, reason: r.reason, priority: r.priority, status: r.status, customerId: r.customer_id ?? null, callerPhone: r.caller_phone ?? null, providerCallId: r.provider_call_id ?? null, appointmentId: r.appointment_id ?? null, assignedUserId: r.assigned_user_id ?? null, dueAtMs: r.due_at ? new Date(r.due_at).getTime() : null, notes: r.notes ?? null, resolution: r.resolution ?? null, source: r.source, createdByUserId: r.created_by_user_id ?? null, createdAtMs: new Date(r.created_at).getTime(), updatedAtMs: new Date(r.updated_at).getTime() });
  async list(tenantId: string, opts: { status?: string; assignedUserId?: string; limit?: number }): Promise<FollowUpRow[]> {
    const lim = Math.min(Math.max(opts.limit ?? 200, 1), 500);
    const rows = opts.status && opts.assignedUserId
      ? (await sql`SELECT * FROM ai_receptionist_follow_ups WHERE tenant_id = ${tenantId} AND status = ${opts.status} AND assigned_user_id = ${opts.assignedUserId} ORDER BY created_at DESC LIMIT ${lim}`.execute(this.db)).rows
      : opts.status
      ? (await sql`SELECT * FROM ai_receptionist_follow_ups WHERE tenant_id = ${tenantId} AND status = ${opts.status} ORDER BY created_at DESC LIMIT ${lim}`.execute(this.db)).rows
      : opts.assignedUserId
      ? (await sql`SELECT * FROM ai_receptionist_follow_ups WHERE tenant_id = ${tenantId} AND assigned_user_id = ${opts.assignedUserId} ORDER BY created_at DESC LIMIT ${lim}`.execute(this.db)).rows
      : (await sql`SELECT * FROM ai_receptionist_follow_ups WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT ${lim}`.execute(this.db)).rows;
    return rows.map(this.map);
  }
  async get(tenantId: string, id: string) { const r: any = (await sql`SELECT * FROM ai_receptionist_follow_ups WHERE tenant_id = ${tenantId} AND id = ${id} LIMIT 1`.execute(this.db)).rows[0]; return r ? this.map(r) : null; }
  async insert(tenantId: string, branchId: string | null, input: CreateFollowUpInput, source: string, createdByUserId: string | null) {
    const r: any = (await sql`INSERT INTO ai_receptionist_follow_ups (tenant_id, branch_id, reason, priority, customer_id, caller_phone, provider_call_id, appointment_id, notes, source, created_by_user_id)
      VALUES (${tenantId}, ${branchId}, ${input.reason}, ${input.priority ?? 'normal'}, ${input.customerId ?? null}, ${input.callerPhone ?? null}, ${input.providerCallId ?? null}, ${input.appointmentId ?? null}, ${input.notes ?? null}, ${source}, ${createdByUserId}) RETURNING *`.execute(this.db)).rows[0];
    return this.map(r);
  }
  async insertForCall(tenantId: string, branchId: string | null, input: CreateFollowUpInput, source: string) {
    const inserted: any = (await sql`INSERT INTO ai_receptionist_follow_ups (tenant_id, branch_id, reason, priority, customer_id, caller_phone, provider_call_id, appointment_id, notes, source)
      VALUES (${tenantId}, ${branchId}, ${input.reason}, ${input.priority ?? 'normal'}, ${input.customerId ?? null}, ${input.callerPhone ?? null}, ${input.providerCallId ?? null}, ${input.appointmentId ?? null}, ${input.notes ?? null}, ${source})
      ON CONFLICT (tenant_id, provider_call_id) WHERE provider_call_id IS NOT NULL AND status NOT IN ('resolved','closed') DO NOTHING RETURNING *`.execute(this.db)).rows[0];
    if (inserted) return this.map(inserted);
    const existing: any = (await sql`SELECT * FROM ai_receptionist_follow_ups WHERE tenant_id = ${tenantId} AND provider_call_id = ${input.providerCallId ?? null} AND status NOT IN ('resolved','closed') ORDER BY created_at DESC LIMIT 1`.execute(this.db)).rows[0];
    return this.map(existing);
  }
  async patch(tenantId: string, id: string, fields: Partial<FollowUpRow> & { fromStatus?: FollowUpStatus }) {
    const status = (fields as any).status;
    const r: any = (await sql`UPDATE ai_receptionist_follow_ups SET
        status = COALESCE(${status ?? null}, status),
        priority = COALESCE(${(fields as any).priority ?? null}, priority),
        assigned_user_id = ${'assignedUserId' in fields ? (fields.assignedUserId ?? null) : sql`assigned_user_id`},
        notes = COALESCE(${(fields as any).notes ?? null}, notes),
        resolution = COALESCE(${(fields as any).resolution ?? null}, resolution),
        resolved_at = ${status === 'resolved' || status === 'closed' ? sql`now()` : sql`resolved_at`},
        updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${id}
        AND ${status ? canMoveToSql(AI_RECEPTIONIST_FOLLOW_UP, status) : sql`true`}
        AND ${(fields as any).fromStatus ? sql`status = ${(fields as any).fromStatus}` : sql`true`} RETURNING *`.execute(this.db)).rows[0];
    return r ? this.map(r) : null;
  }
}
