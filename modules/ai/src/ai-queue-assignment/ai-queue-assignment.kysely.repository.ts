// ai-queue-assignment.kysely.repository.ts — real-SQL persistence over migrations 331 / 524 / 526. Tenant + branch
// scoped on every query. Stores the full envelope (jsonb) plus a flattened candidate row per technician for querying.
//
// BUILD_PLAN Phase 6: the recommendation row records config_version / queue_version / source; a decision row and its
// domain event (QUEUE_ASSIGNMENT_DECIDED, or QUEUE_AUTO_ASSIGNED for the auto-run) commit in ONE transaction — the
// outbox rule; an idempotency key that was already used returns the existing row and writes nothing (unique index
// uq_qad_idempotency closes the race between two identical requests).
import { sql, type Kysely } from 'kysely';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';
import type { QueueAssignmentRepositoryPort, StoredRecommendation, DecisionRecord, NewDecision, DecisionEvent, RecommendationSource } from './ai-queue-assignment.repository';
import type { QueueAssignmentContext, RecommendationEnvelope } from './ai-queue-assignment.dto';

const rows = (r: any): any[] => r?.rows ?? [];

export class KyselyQueueAssignmentRepository implements QueueAssignmentRepositoryPort {
  constructor(private readonly db: Kysely<any>, private readonly outbox: OutboxWriter | null = null) {}

  async saveRecommendation(ctx: QueueAssignmentContext, envelope: RecommendationEnvelope, source: RecommendationSource = 'staff'): Promise<StoredRecommendation> {
    return this.db.transaction().execute(async (trx) => {
      const row = rows(await sql`
        insert into queue_assignment_recommendations
          (tenant_id, branch_id, queue_entry_id, recommended_tech, match_score, confidence, required_action, conflicts, warnings, rule_version, reco_version, envelope,
           config_version, queue_version, source)
        values (${ctx.tenantId}, ${ctx.branchId}, ${envelope.queueEntryId}, ${envelope.recommended?.technicianId ?? null},
          ${envelope.recommended?.matchScore ?? null}, ${envelope.confidence}, ${envelope.requiredAction},
          ${JSON.stringify(envelope.conflicts)}::jsonb, ${JSON.stringify(envelope.warnings)}::jsonb,
          ${envelope.ruleVersion}, ${envelope.recoVersion}, ${JSON.stringify(envelope)}::jsonb,
          ${envelope.configVersion ?? null}, ${envelope.queueVersion ?? null}, ${source})
        returning id, created_at`.execute(trx))[0];
      const all = [envelope.recommended, ...envelope.alternates].filter(Boolean) as NonNullable<RecommendationEnvelope['recommended']>[];
      for (let i = 0; i < all.length; i++) {
        const c = all[i];
        await sql`
          insert into queue_assignment_candidates
            (tenant_id, branch_id, recommendation_id, technician_id, rank, match_score, eligible, reasons, warnings, est_start_min, est_completion_min)
          values (${ctx.tenantId}, ${ctx.branchId}, ${row.id}, ${c.technicianId}, ${i}, ${c.matchScore}, ${c.eligible},
            ${JSON.stringify(c.reasons)}::jsonb, ${JSON.stringify(c.warnings)}::jsonb, ${c.estimatedStartInMinutes}, ${c.estimatedCompletionInMinutes})
        `.execute(trx);
      }
      return { id: String(row.id), tenantId: ctx.tenantId, branchId: ctx.branchId, queueEntryId: envelope.queueEntryId, envelope, createdAt: new Date(row.created_at).toISOString(), source };
    });
  }

  async getRecommendation(ctx: QueueAssignmentContext, id: string): Promise<StoredRecommendation | null> {
    if (!isUuid(id)) return null;   // a malformed id is "not found", never a 500
    const r: any = await sql`select * from queue_assignment_recommendations where id=${id} and tenant_id=${ctx.tenantId} and branch_id=${ctx.branchId} limit 1`.execute(this.db);
    return r.rows[0] ? this.map(r.rows[0]) : null;
  }
  async latestForEntry(ctx: QueueAssignmentContext, queueEntryId: string): Promise<StoredRecommendation | null> {
    const r: any = await sql`select * from queue_assignment_recommendations where queue_entry_id=${queueEntryId} and tenant_id=${ctx.tenantId} and branch_id=${ctx.branchId} order by created_at desc limit 1`.execute(this.db);
    return r.rows[0] ? this.map(r.rows[0]) : null;
  }

  async recordDecision(ctx: QueueAssignmentContext, d: NewDecision, event?: DecisionEvent): Promise<DecisionRecord & { replayed?: boolean }> {
    return this.db.transaction().execute(async (trx) => {
      const inserted = rows(await sql`
        insert into queue_assignment_decisions (tenant_id, branch_id, recommendation_id, queue_entry_id, decision, chosen_technician, reason, decided_by,
                                                applied, idempotency_key, previous_technician, feedback_code, plan)
        values (${ctx.tenantId}, ${ctx.branchId}, ${d.recommendationId || null}, ${d.queueEntryId}, ${d.decision}, ${d.chosenTechnicianId}, ${d.reason}, ${d.decidedBy},
                ${!!d.applied}, ${d.idempotencyKey ?? null}, ${d.previousTechnicianId ?? null}, ${d.feedbackCode ?? null}, ${d.plan == null ? null : JSON.stringify(d.plan)}::jsonb)
        on conflict (tenant_id, idempotency_key) where idempotency_key is not null do nothing
        returning *`.execute(trx))[0];
      if (!inserted) {
        // the key was used before (or by a concurrent twin that won): the first answer stands — no second row, no event
        const prior = rows(await sql`select * from queue_assignment_decisions where tenant_id=${ctx.tenantId} and idempotency_key=${d.idempotencyKey ?? null} limit 1`.execute(trx))[0];
        return { ...this.mapDecision(prior), replayed: true };
      }
      const rec = this.mapDecision(inserted);
      if (event && this.outbox) {
        await this.outbox.write(trx as any, createDomainEvent({
          eventType: event.type === 'auto_assigned' ? DOMAIN_EVENTS.QUEUE_AUTO_ASSIGNED : DOMAIN_EVENTS.QUEUE_ASSIGNMENT_DECIDED,
          tenantId: ctx.tenantId, branchId: ctx.branchId, aggregateType: 'pos_queue_item', aggregateId: d.queueEntryId,
          actorId: event.actorId ?? undefined, actorType: event.actorId ? 'user' : 'system',
          payload: { decisionId: rec.id, ...event.payload },
        }));
      }
      // Fixed-order rotation moves on from the technician just served. Only an EXISTING branch rotation row is touched:
      // inserting one here would pin the branch to the default policy over the salon's.
      if (rec.applied && rec.chosenTechnicianId) {
        await sql`update queue_assignment_rotation_state set last_served_tech = ${rec.chosenTechnicianId}, last_served_at = now()
                  where tenant_id = ${ctx.tenantId} and branch_id = ${ctx.branchId}`.execute(trx);
      }
      return rec;
    });
  }
  async findDecisionByKey(ctx: QueueAssignmentContext, key: string): Promise<DecisionRecord | null> {
    const r = rows(await sql`select * from queue_assignment_decisions where tenant_id=${ctx.tenantId} and idempotency_key=${key} limit 1`.execute(this.db))[0];
    return r ? this.mapDecision(r) : null;
  }
  async listDecisions(ctx: QueueAssignmentContext, queueEntryId: string): Promise<DecisionRecord[]> {
    const r: any = await sql`select * from queue_assignment_decisions where queue_entry_id=${queueEntryId} and tenant_id=${ctx.tenantId} and branch_id=${ctx.branchId} order by created_at asc`.execute(this.db);
    return rows(r).map((row: any): DecisionRecord => this.mapDecision(row));
  }
  async queryDecisions(ctx: QueueAssignmentContext, filter: { from?: string; to?: string; limit?: number }): Promise<DecisionRecord[]> {
    let q = sql`select * from queue_assignment_decisions where tenant_id=${ctx.tenantId} and branch_id=${ctx.branchId}`;
    if (filter.from) q = sql`${q} and created_at >= ${filter.from}`;
    if (filter.to) q = sql`${q} and created_at <= ${filter.to}`;
    const lim = Math.min(filter.limit ?? 1000, 5000);
    const r: any = await sql`${q} order by created_at desc limit ${lim}`.execute(this.db);
    return rows(r).map((row: any): DecisionRecord => this.mapDecision(row));
  }
  async lastServedTechnician(ctx: QueueAssignmentContext): Promise<string | null> {
    const r = rows(await sql`select last_served_tech from queue_assignment_rotation_state where tenant_id=${ctx.tenantId} and branch_id=${ctx.branchId} limit 1`.execute(this.db))[0];
    return r?.last_served_tech ?? null;
  }

  private mapDecision(row: any): DecisionRecord {
    return {
      id: String(row.id), tenantId: String(row.tenant_id), branchId: String(row.branch_id), recommendationId: row.recommendation_id ? String(row.recommendation_id) : '',
      queueEntryId: row.queue_entry_id, decision: row.decision, chosenTechnicianId: row.chosen_technician ?? null, reason: row.reason ?? null, decidedBy: row.decided_by,
      createdAt: new Date(row.created_at).toISOString(), applied: !!row.applied, idempotencyKey: row.idempotency_key ?? null,
      previousTechnicianId: row.previous_technician ?? null, feedbackCode: row.feedback_code ?? null,
      ...(row.plan != null ? { plan: typeof row.plan === 'string' ? JSON.parse(row.plan) : row.plan } : {}),
    };
  }
  private map(row: any): StoredRecommendation {
    const envelope = typeof row.envelope === 'string' ? JSON.parse(row.envelope) : row.envelope;
    return { id: String(row.id), tenantId: String(row.tenant_id), branchId: String(row.branch_id), queueEntryId: row.queue_entry_id, envelope, createdAt: new Date(row.created_at).toISOString(), source: row.source ?? 'staff' };
  }
}

function isUuid(s: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || '')); }
