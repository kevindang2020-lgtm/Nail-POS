// ai-queue-assignment.repository.ts — persistence port + in-memory implementation. Tenant + branch scoped
// everywhere. Stores recommendation envelopes, their candidates, and decisions (staff + auto-run). No queue table is
// touched here — assignments go through the queue's own action.
//
// BUILD_PLAN Phase 6: a decision row carries `applied` (the queue really assigned), the idempotency key (the same key
// replays — no second row, no second event), the previous technician and a structured feedback code; the domain event
// (QUEUE_ASSIGNMENT_DECIDED / QUEUE_AUTO_ASSIGNED) is written in the SAME transaction as the row (the outbox rule).
import { randomUUID } from 'node:crypto';
import type { QueueAssignmentContext, RecommendationEnvelope, StoredDecisionType } from './ai-queue-assignment.dto';

export type RecommendationSource = 'staff' | 'auto_run' | 'board';

export interface StoredRecommendation {
  id: string;
  tenantId: string;
  branchId: string;
  queueEntryId: string;
  envelope: RecommendationEnvelope;
  createdAt: string;
  source?: RecommendationSource;
}

export interface DecisionRecord {
  id: string;
  tenantId: string;
  branchId: string;
  recommendationId: string;
  queueEntryId: string;
  decision: StoredDecisionType;
  chosenTechnicianId: string | null;
  reason: string | null;
  decidedBy: string;
  createdAt: string;
  applied: boolean;
  idempotencyKey: string | null;
  previousTechnicianId: string | null;
  feedbackCode: string | null;
  /** multi-technician routing (569): the lines a plan decision applied — { queueItemId, serviceId, technicianId }[] */
  plan?: unknown;
}
export type NewDecision = Omit<DecisionRecord, 'id' | 'tenantId' | 'branchId' | 'createdAt' | 'applied' | 'idempotencyKey' | 'previousTechnicianId' | 'feedbackCode' | 'plan'>
  & Partial<Pick<DecisionRecord, 'applied' | 'idempotencyKey' | 'previousTechnicianId' | 'feedbackCode' | 'plan'>>;

/** The domain event written with the decision row (same transaction). */
export interface DecisionEvent {
  type: 'decided' | 'auto_assigned';
  actorId: string | null;
  payload: Record<string, unknown>;
}

export interface QueueAssignmentRepositoryPort {
  saveRecommendation(ctx: QueueAssignmentContext, envelope: RecommendationEnvelope, source?: RecommendationSource): Promise<StoredRecommendation>;
  getRecommendation(ctx: QueueAssignmentContext, id: string): Promise<StoredRecommendation | null>;
  latestForEntry(ctx: QueueAssignmentContext, queueEntryId: string): Promise<StoredRecommendation | null>;
  /** Insert the decision (+ its event, same transaction). With an idempotency key already used, returns the EXISTING
   *  row with `replayed: true` and writes nothing. */
  recordDecision(ctx: QueueAssignmentContext, d: NewDecision, event?: DecisionEvent): Promise<DecisionRecord & { replayed?: boolean }>;
  findDecisionByKey(ctx: QueueAssignmentContext, idempotencyKey: string): Promise<DecisionRecord | null>;
  listDecisions(ctx: QueueAssignmentContext, queueEntryId: string): Promise<DecisionRecord[]>;
  queryDecisions(ctx: QueueAssignmentContext, filter: { from?: string; to?: string; limit?: number }): Promise<DecisionRecord[]>;
  /** fixed-order rotation: who the turn passed to last (null = unknown) */
  lastServedTechnician(ctx: QueueAssignmentContext): Promise<string | null>;
}

const uid = () => randomUUID();

export class InMemoryQueueAssignmentRepository implements QueueAssignmentRepositoryPort {
  private recs: StoredRecommendation[] = [];
  private decisions: DecisionRecord[] = [];
  /** the events "written" with decisions (tests read this as the outbox) */
  readonly events: (DecisionEvent & { tenantId: string; branchId: string; decisionId: string })[] = [];
  private lastServed = new Map<string, string>();

  async saveRecommendation(ctx: QueueAssignmentContext, envelope: RecommendationEnvelope, source: RecommendationSource = 'staff'): Promise<StoredRecommendation> {
    const rec: StoredRecommendation = { id: uid(), tenantId: ctx.tenantId, branchId: ctx.branchId, queueEntryId: envelope.queueEntryId, envelope, createdAt: new Date().toISOString(), source };
    this.recs.push(rec);
    return rec;
  }
  async getRecommendation(ctx: QueueAssignmentContext, id: string): Promise<StoredRecommendation | null> {
    return this.recs.find((r) => r.id === id && r.tenantId === ctx.tenantId && r.branchId === ctx.branchId) ?? null;
  }
  async latestForEntry(ctx: QueueAssignmentContext, queueEntryId: string): Promise<StoredRecommendation | null> {
    const matches = this.recs.filter((r) => r.queueEntryId === queueEntryId && r.tenantId === ctx.tenantId && r.branchId === ctx.branchId);
    return matches.length ? matches[matches.length - 1] : null;
  }
  async recordDecision(ctx: QueueAssignmentContext, d: NewDecision, event?: DecisionEvent): Promise<DecisionRecord & { replayed?: boolean }> {
    if (d.idempotencyKey) {
      const existing = this.decisions.find((r) => r.tenantId === ctx.tenantId && r.idempotencyKey === d.idempotencyKey);
      if (existing) return { ...existing, replayed: true };
    }
    const rec: DecisionRecord = {
      id: uid(), tenantId: ctx.tenantId, branchId: ctx.branchId, createdAt: new Date().toISOString(),
      applied: false, idempotencyKey: null, previousTechnicianId: null, feedbackCode: null, ...d,
    };
    this.decisions.push(rec);
    if (event) this.events.push({ ...event, tenantId: ctx.tenantId, branchId: ctx.branchId, decisionId: rec.id });
    if (rec.applied && rec.chosenTechnicianId) this.lastServed.set(ctx.tenantId + ':' + ctx.branchId, rec.chosenTechnicianId);
    return rec;
  }
  async findDecisionByKey(ctx: QueueAssignmentContext, key: string): Promise<DecisionRecord | null> {
    return this.decisions.find((r) => r.tenantId === ctx.tenantId && r.idempotencyKey === key) ?? null;
  }
  async listDecisions(ctx: QueueAssignmentContext, queueEntryId: string): Promise<DecisionRecord[]> {
    return this.decisions.filter((r) => r.queueEntryId === queueEntryId && r.tenantId === ctx.tenantId && r.branchId === ctx.branchId);
  }
  async queryDecisions(ctx: QueueAssignmentContext, filter: { from?: string; to?: string; limit?: number }): Promise<DecisionRecord[]> {
    let rows = this.decisions.filter((r) => r.tenantId === ctx.tenantId && r.branchId === ctx.branchId);
    if (filter.from) rows = rows.filter((r) => r.createdAt >= filter.from!);
    if (filter.to) { const day = /^\d{4}-\d{2}-\d{2}$/.test(filter.to); rows = rows.filter((r) => (day ? r.createdAt.slice(0, 10) <= filter.to! : r.createdAt <= filter.to!)); }   // a bare end day is included whole
    rows = rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return filter.limit ? rows.slice(0, filter.limit) : rows;
  }
  async lastServedTechnician(ctx: QueueAssignmentContext): Promise<string | null> {
    return this.lastServed.get(ctx.tenantId + ':' + ctx.branchId) ?? null;
  }
}
