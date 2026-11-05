// disputes.kysely.repository.ts — Postgres reads for the Chargebacks & Disputes surface. All rows are the human-facing
// dispute records (dispute_reference set). Money is integer cents; BIGINT coerced with Number(). Never selects card data.
import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { DisputesRepo, ListParams, ListResult, DisputeListRow, DisputeDetail, AuditActor, EvidenceInsert, EvidenceSummary, SubmitContext, SubmissionSummary, NotificationInsert, NotificationSummary, OutcomeInsert, OutcomeSummary, DeadlineRow, MerchantRiskRow, RiskFlagInsert } from './disputes.repository';
import type { PatternRow } from './patterns-core';
import type { OverviewInput, DisputeRow, ActivityRow, RiskRow, TrendPoint } from './disputes-overview-core';
import { canMoveToSql } from '@aipowersalon/database';
import { CHARGEBACK_EVIDENCE, DISPUTE_EVIDENCE_REVIEW } from '../lifecycles';
import { InvalidStateTransitionError } from '@aipowersalon/database';
import { CHARGEBACK } from '@aipowersalon/payments';

const OPEN = "('open','needs_evidence','evidence_collecting','submitted','under_review','escalated','reopened')";

export class KyselyDisputesRepo implements DisputesRepo {
  constructor(private readonly db: Kysely<DB>) {}

  async getOverviewData(): Promise<OverviewInput> {
    const dq: any = await sql`
      SELECT c.id, c.dispute_reference, c.tenant_id, COALESCE(t.display_name, t.legal_name, c.tenant_id::text) AS tenant_name,
             b.name AS branch_name, c.amount_cents, c.status, c.evidence_status, c.processor_decision,
             c.reason_code, c.normalized_reason_category, c.funds_withdrawn_cents, c.funds_recovered_cents, c.risk_level,
             c.opened_at, c.due_by, c.decided_at
      FROM chargebacks c
      JOIN tenants t ON t.id = c.tenant_id
      LEFT JOIN branches b ON b.id = c.branch_id
      WHERE c.dispute_reference IS NOT NULL`.execute(this.db).catch(() => ({ rows: [] }));
    const disputes: DisputeRow[] = (dq.rows as any[]).map((x) => ({
      id: String(x.dispute_reference), tenantId: String(x.tenant_id), tenantName: String(x.tenant_name),
      branchName: x.branch_name ?? null, amountCents: Number(x.amount_cents), status: String(x.status),
      evidenceStatus: String(x.evidence_status), processorDecision: String(x.processor_decision),
      reasonCode: x.reason_code ?? null, reasonCategory: x.normalized_reason_category ?? null,
      fundsWithdrawnCents: Number(x.funds_withdrawn_cents), fundsRecoveredCents: Number(x.funds_recovered_cents),
      riskLevel: String(x.risk_level), openedAt: new Date(x.opened_at).toISOString(),
      dueBy: x.due_by ? new Date(x.due_by).toISOString() : null, decidedAt: x.decided_at ? new Date(x.decided_at).toISOString() : null,
    }));

    const aq: any = await sql`
      SELECT e.created_at, c.dispute_reference, e.to_status, COALESCE(t.display_name, t.legal_name) AS tenant_name
      FROM dispute_status_events e JOIN chargebacks c ON c.id = e.chargeback_id JOIN tenants t ON t.id = e.tenant_id
      WHERE c.dispute_reference IS NOT NULL ORDER BY e.created_at DESC LIMIT 10`.execute(this.db).catch(() => ({ rows: [] }));
    const activity: ActivityRow[] = (aq.rows as any[]).map((x) => ({
      at: new Date(x.created_at).toISOString(), disputeRef: String(x.dispute_reference),
      action: `Status: ${String(x.to_status).replace(/_/g, ' ')}`, tenantName: String(x.tenant_name ?? ''), status: String(x.to_status),
    }));

    const rq: any = await sql`
      SELECT c.tenant_id, COALESCE(t.display_name, t.legal_name) AS tenant_name,
             COUNT(*) FILTER (WHERE c.status IN ${sql.raw(OPEN)})::int AS open_disputes,
             COALESCE(SUM(c.amount_cents) FILTER (WHERE c.status IN ${sql.raw(OPEN)}), 0) AS amount_at_risk,
             (SELECT r.risk_level FROM merchant_risk_reviews r WHERE r.tenant_id = c.tenant_id ORDER BY r.reviewed_at DESC LIMIT 1) AS risk_level
      FROM chargebacks c JOIN tenants t ON t.id = c.tenant_id
      WHERE c.dispute_reference IS NOT NULL
      GROUP BY c.tenant_id, t.display_name, t.legal_name
      ORDER BY amount_at_risk DESC`.execute(this.db).catch(() => ({ rows: [] }));
    const risk: RiskRow[] = (rq.rows as any[]).map((x) => ({
      tenantId: String(x.tenant_id), tenantName: String(x.tenant_name), openDisputes: Number(x.open_disputes),
      amountAtRiskCents: Number(x.amount_at_risk), riskLevel: String(x.risk_level ?? 'low'),
    }));

    const tq: any = await sql`
      SELECT to_char(date_trunc('day', c.opened_at), 'YYYY-MM-DD') AS d,
             COUNT(*) FILTER (WHERE c.status IN ('open','needs_evidence','evidence_collecting','escalated','reopened'))::int AS open,
             COUNT(*) FILTER (WHERE c.status IN ('submitted','under_review'))::int AS submitted,
             COUNT(*) FILTER (WHERE c.status='won')::int AS won,
             COUNT(*) FILTER (WHERE c.status='lost')::int AS lost
      FROM chargebacks c WHERE c.dispute_reference IS NOT NULL AND c.opened_at >= now() - interval '35 days'
      GROUP BY 1 ORDER BY 1`.execute(this.db).catch(() => ({ rows: [] }));
    const trend: TrendPoint[] = (tq.rows as any[]).map((x) => ({ date: String(x.d), open: Number(x.open), submitted: Number(x.submitted), won: Number(x.won), lost: Number(x.lost) }));

    const pq: any = await sql`
      SELECT COUNT(*) FILTER (WHERE processor_decision IN ('won','partially_won'))::int AS won,
             COUNT(*) FILTER (WHERE processor_decision='under_review')::int AS under_review,
             COUNT(*) FILTER (WHERE processor_decision='lost')::int AS lost
      FROM chargebacks WHERE dispute_reference IS NOT NULL`.execute(this.db).catch(() => ({ rows: [{}] }));
    const p = pq.rows[0] ?? {};

    return { disputes, activity, risk, trend, wonCountPeriod: Number(p.won ?? 0), lostCountPeriod: Number(p.lost ?? 0), underReviewCountPeriod: Number(p.under_review ?? 0) };
  }

  async listDisputes(params: ListParams): Promise<ListResult> {
    const where: any[] = [sql`c.dispute_reference IS NOT NULL`];
    if (params.tenantId) where.push(sql`c.tenant_id = ${params.tenantId}`);
    if (params.branchId) where.push(sql`c.branch_id = ${params.branchId}`);
    if (params.reasonCode) where.push(sql`c.reason_code = ${params.reasonCode}`);
    if (params.currentStatus) where.push(sql`c.status = ${params.currentStatus}`);
    if (params.evidenceStatus) where.push(sql`c.evidence_status = ${params.evidenceStatus}`);
    if (params.processorDecision) where.push(sql`c.processor_decision = ${params.processorDecision}`);
    if (params.riskLevel) where.push(sql`c.risk_level = ${params.riskLevel}`);
    if (params.processor) where.push(sql`c.processor_type = ${params.processor}`);
    if (params.deadlineStart) where.push(sql`c.due_by >= ${params.deadlineStart}`);
    if (params.deadlineEnd) where.push(sql`c.due_by <= ${params.deadlineEnd}`);
    if (params.amountMinCents != null) where.push(sql`c.amount_cents >= ${params.amountMinCents}`);
    if (params.amountMaxCents != null) where.push(sql`c.amount_cents <= ${params.amountMaxCents}`);
    if (params.search) {
      const s = `%${params.search.toLowerCase()}%`;
      where.push(sql`(lower(c.dispute_reference) LIKE ${s} OR lower(c.transaction_ref) LIKE ${s} OR lower(c.chargeback_id) LIKE ${s} OR lower(c.processor_transaction_id) LIKE ${s})`);
    }
    const whereSql = sql.join(where, sql` AND `);
    const sortCol = ({ amount: 'c.amount_cents', deadline: 'c.due_by', status: 'c.status', opened: 'c.opened_at' } as any)[params.sort ?? ''] ?? 'c.opened_at';
    const dir = params.direction === 'asc' ? sql`asc` : sql`desc`;
    const offset = (params.page - 1) * params.pageSize;

    const cq: any = await sql`SELECT COUNT(*)::int AS n FROM chargebacks c WHERE ${whereSql}`.execute(this.db).catch(() => ({ rows: [{ n: 0 }] }));
    const total = Number(cq.rows[0]?.n ?? 0);
    const rq: any = await sql`
      SELECT c.id, c.dispute_reference, c.tenant_id, COALESCE(t.display_name, t.legal_name, c.tenant_id::text) AS tenant_name,
             b.name AS branch_name, c.amount_cents, c.reason_code, c.reason, c.transaction_ref, c.due_by, c.status,
             c.evidence_status, c.processor_decision, c.funds_withdrawn_cents, c.funds_recovered_cents, c.risk_level
      FROM chargebacks c JOIN tenants t ON t.id = c.tenant_id LEFT JOIN branches b ON b.id = c.branch_id
      WHERE ${whereSql} ORDER BY ${sql.raw(sortCol)} ${dir} LIMIT ${params.pageSize} OFFSET ${offset}`.execute(this.db).catch(() => ({ rows: [] }));
    const rows: DisputeListRow[] = (rq.rows as any[]).map(mapListRow);
    return { rows, total, page: params.page, pageSize: params.pageSize };
  }

  async getDisputeDetail(id: string): Promise<DisputeDetail | null> {
    const q: any = await sql`
      SELECT c.id, c.dispute_reference, c.tenant_id, COALESCE(t.display_name, t.legal_name, c.tenant_id::text) AS tenant_name,
             b.name AS branch_name, c.amount_cents, c.currency, c.reason_code, c.reason, c.normalized_reason_category,
             c.transaction_ref, c.processor_type, c.due_by, c.status, c.evidence_status, c.processor_decision,
             c.funds_withdrawn_cents, c.funds_recovered_cents, c.risk_level, c.notes, c.opened_at, c.submitted_at, c.decided_at, c.closed_at
      FROM chargebacks c JOIN tenants t ON t.id = c.tenant_id LEFT JOIN branches b ON b.id = c.branch_id
      WHERE c.dispute_reference = ${id} OR c.id::text = ${id} LIMIT 1`.execute(this.db).catch(() => ({ rows: [] }));
    const x = q.rows[0]; if (!x) return null;
    const cbId = String(x.id);
    const [tl, ev, oc, fe, nt]: any[] = await Promise.all([
      sql`SELECT created_at, from_status, to_status, source, reason FROM dispute_status_events WHERE chargeback_id = ${cbId} ORDER BY created_at`.execute(this.db).catch(() => ({ rows: [] })),
      sql`SELECT id, evidence_type, file_name, review_status, scan_status, included_in_submission, created_at FROM dispute_evidence WHERE chargeback_id = ${cbId} ORDER BY created_at`.execute(this.db).catch(() => ({ rows: [] })),
      sql`SELECT result, amount_won_cents, amount_lost_cents, funds_recovered_cents, is_manual_override, original_processor_decision, decided_at FROM dispute_outcomes WHERE chargeback_id = ${cbId} ORDER BY created_at`.execute(this.db).catch(() => ({ rows: [] })),
      sql`SELECT kind, amount_cents, effective_at, settlement_id FROM dispute_funds_events WHERE chargeback_id = ${cbId} ORDER BY created_at`.execute(this.db).catch(() => ({ rows: [] })),
      sql`SELECT channel, recipient, subject, delivery_status, created_at FROM dispute_tenant_notifications WHERE chargeback_id = ${cbId} ORDER BY created_at DESC`.execute(this.db).catch(() => ({ rows: [] })),
    ]);
    return {
      ...mapListRow(x), currency: String(x.currency ?? 'USD'), reasonCategory: x.normalized_reason_category ?? null,
      processorType: x.processor_type ?? null, notes: x.notes ?? null,
      openedAt: new Date(x.opened_at).toISOString(), submittedAt: x.submitted_at ? new Date(x.submitted_at).toISOString() : null,
      decidedAt: x.decided_at ? new Date(x.decided_at).toISOString() : null, closedAt: x.closed_at ? new Date(x.closed_at).toISOString() : null,
      timeline: (tl.rows as any[]).map((y) => ({ at: new Date(y.created_at).toISOString(), fromStatus: y.from_status ?? null, toStatus: String(y.to_status), source: String(y.source), reason: y.reason ?? null })),
      evidence: (ev.rows as any[]).map((y) => ({ id: String(y.id), type: String(y.evidence_type), fileName: y.file_name ?? null, reviewStatus: String(y.review_status), scanStatus: String(y.scan_status), includedInSubmission: !!y.included_in_submission, createdAt: new Date(y.created_at).toISOString() })),
      outcomes: (oc.rows as any[]).map((y) => ({ result: String(y.result), amountWonCents: Number(y.amount_won_cents), amountLostCents: Number(y.amount_lost_cents), fundsRecoveredCents: Number(y.funds_recovered_cents), isManualOverride: !!y.is_manual_override, originalProcessorDecision: y.original_processor_decision ?? null, decidedAt: y.decided_at ? new Date(y.decided_at).toISOString() : null })),
      fundsEvents: (fe.rows as any[]).map((y) => ({ kind: String(y.kind), amountCents: Number(y.amount_cents), effectiveAt: y.effective_at ? new Date(y.effective_at).toISOString() : null, settlementId: y.settlement_id ?? null })),
      notifications: (nt.rows as any[]).map((y) => ({ channel: String(y.channel), recipient: y.recipient ?? null, subject: y.subject ?? null, deliveryStatus: String(y.delivery_status), createdAt: new Date(y.created_at).toISOString() })),
    };
  }
  async resolveDispute(idOrRef: string) {
    const q: any = await sql`
      SELECT id, tenant_id, branch_id, normalized_reason_category, evidence_status, status, processor_decision
      FROM chargebacks WHERE dispute_reference = ${idOrRef} OR id::text = ${idOrRef} LIMIT 1`.execute(this.db).catch(() => ({ rows: [] }));
    const x = q.rows[0]; if (!x) return null;
    return { id: String(x.id), tenantId: String(x.tenant_id), branchId: x.branch_id ? String(x.branch_id) : null, reasonCategory: x.normalized_reason_category ?? null, evidenceStatus: String(x.evidence_status), status: String(x.status), processorDecision: String(x.processor_decision) };
  }

  async requestEvidence(actor: AuditActor, cbId: string, tenantId: string, note: string | null) {
    await this.db.transaction().execute(async (trx) => {
      const cur: any = await sql`SELECT evidence_status FROM chargebacks WHERE id = ${cbId}`.execute(trx);
      const from = String(cur.rows[0]?.evidence_status ?? 'not_requested');
      if (['not_requested', 'incomplete', 'rejected'].includes(from)) {
        await sql`UPDATE chargebacks SET evidence_status = 'requested', updated_at = now() WHERE id = ${cbId} AND ${canMoveToSql(CHARGEBACK_EVIDENCE, 'requested')}`.execute(trx);
      }
      await sql`INSERT INTO dispute_status_events (chargeback_id, tenant_id, from_status, to_status, source, reason, actor_user_id)
                VALUES (${cbId}, ${tenantId}, ${from}, 'evidence_requested', 'super_admin', ${note}, ${actor.userId ?? null})`.execute(trx);
    });
    await this.writeAudit(actor, 'dispute.evidence.requested', cbId, tenantId, { note });
  }

  async insertEvidence(actor: AuditActor, cbId: string, tenantId: string, branchId: string | null, e: EvidenceInsert): Promise<EvidenceSummary> {
    const inserted: any = await sql`
      INSERT INTO dispute_evidence (chargeback_id, tenant_id, branch_id, evidence_type, file_name, storage_ref, mime_type, size_bytes, file_hash, scan_status, review_status, description, source, uploaded_by)
      VALUES (${cbId}, ${tenantId}, ${branchId}, ${e.evidenceType}, ${e.fileName}, ${e.storageRef}, ${e.mimeType}, ${e.sizeBytes}, ${e.fileHash}, ${e.scanStatus}, 'uploaded', ${e.description}, ${e.source}, ${actor.userId ?? null})
      RETURNING id, evidence_type, file_name, mime_type, size_bytes, review_status, scan_status, included_in_submission, description, created_at`.execute(this.db);
    const r = inserted.rows[0];
    // Advance evidence_status toward collecting once the first file lands.
    await sql`UPDATE chargebacks SET evidence_status = 'collecting', updated_at = now() WHERE id = ${cbId} AND ${canMoveToSql(CHARGEBACK_EVIDENCE, 'collecting')}`.execute(this.db).catch(() => {});
    await this.writeAudit(actor, 'dispute.evidence.uploaded', cbId, tenantId, { evidenceId: String(r.id), evidenceType: e.evidenceType, fileHash: e.fileHash, scanStatus: e.scanStatus });
    return mapEvidence(r);
  }

  async reviewEvidence(actor: AuditActor, cbId: string, tenantId: string, evidenceId: string, decision: string, reason: string | null): Promise<EvidenceSummary | null> {
    const upd: any = await sql`
      UPDATE dispute_evidence SET review_status = ${decision}
      WHERE id = ${evidenceId} AND chargeback_id = ${cbId} AND tenant_id = ${tenantId} AND ${canMoveToSql(DISPUTE_EVIDENCE_REVIEW, decision)}
      RETURNING id, evidence_type, file_name, mime_type, size_bytes, review_status, scan_status, included_in_submission, description, created_at`.execute(this.db).catch(() => ({ rows: [] }));
    const r = upd.rows[0]; if (!r) return null;
    await this.writeAudit(actor, 'dispute.evidence.reviewed', cbId, tenantId, { evidenceId, decision, reason });
    return mapEvidence(r);
  }

  async listEvidence(cbId: string): Promise<EvidenceSummary[]> {
    const q: any = await sql`
      SELECT id, evidence_type, file_name, mime_type, size_bytes, review_status, scan_status, included_in_submission, description, created_at
      FROM dispute_evidence WHERE chargeback_id = ${cbId} ORDER BY created_at`.execute(this.db).catch(() => ({ rows: [] }));
    return (q.rows as any[]).map(mapEvidence);
  }

  async getSubmitContext(cbId: string): Promise<SubmitContext> {
    const c: any = await sql`SELECT status, due_by, processor_type FROM chargebacks WHERE id = ${cbId}`.execute(this.db).catch(() => ({ rows: [] }));
    const x = c.rows[0] ?? {};
    const e: any = await sql`SELECT id, file_hash, scan_status, review_status, file_name, evidence_type FROM dispute_evidence WHERE chargeback_id = ${cbId} ORDER BY created_at`.execute(this.db).catch(() => ({ rows: [] }));
    return {
      status: String(x.status ?? 'open'), dueBy: x.due_by ? new Date(x.due_by).toISOString() : null, processorType: x.processor_type ?? null,
      evidence: (e.rows as any[]).map((y) => ({ id: String(y.id), fileHash: y.file_hash ?? null, scanStatus: String(y.scan_status), reviewStatus: String(y.review_status), fileName: y.file_name ?? null, evidenceType: y.evidence_type ?? null })),
    };
  }

  async findSubmission(tenantId: string, key: string): Promise<SubmissionSummary | null> {
    const q: any = await sql`SELECT id, result, processor_ref, idempotency_key, created_at FROM dispute_submissions WHERE tenant_id = ${tenantId} AND idempotency_key = ${key} LIMIT 1`.execute(this.db).catch(() => ({ rows: [] }));
    const r = q.rows[0]; if (!r) return null;
    return { id: String(r.id), result: String(r.result), processorRef: r.processor_ref ?? null, idempotencyKey: String(r.idempotency_key), createdAt: new Date(r.created_at).toISOString(), alreadyExisted: true };
  }

  async recordSubmission(actor: AuditActor, cbId: string, tenantId: string, key: string, processorType: string | null, processorRef: string, manifest: unknown, result: string, safeError: string | null, newStatus: string): Promise<SubmissionSummary> {
    return await this.db.transaction().execute(async (trx) => {
      const ins: any = await sql`
        INSERT INTO dispute_submissions (chargeback_id, tenant_id, idempotency_key, processor_type, processor_ref, manifest_json, result, safe_error, submitted_by)
        VALUES (${cbId}, ${tenantId}, ${key}, ${processorType}, ${processorRef}, ${JSON.stringify(manifest)}::jsonb, ${result}, ${safeError}, ${actor.userId ?? null})
        ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
        RETURNING id, result, processor_ref, idempotency_key, created_at`.execute(trx);
      if (ins.rows.length === 0) {
        const ex: any = await sql`SELECT id, result, processor_ref, idempotency_key, created_at FROM dispute_submissions WHERE tenant_id = ${tenantId} AND idempotency_key = ${key} LIMIT 1`.execute(trx);
        const r = ex.rows[0];
        return { id: String(r.id), result: String(r.result), processorRef: r.processor_ref ?? null, idempotencyKey: String(r.idempotency_key), createdAt: new Date(r.created_at).toISOString(), alreadyExisted: true };
      }
      const r = ins.rows[0];
      if (result === 'accepted' || result === 'pending') {
        const cur: any = await sql`SELECT status FROM chargebacks WHERE id = ${cbId}`.execute(trx);
        const from = String(cur.rows[0]?.status ?? 'open');
        // Included evidence is flagged; evidence_status advances to submitted; dispute status advances (or escalates on error).
        await sql`UPDATE dispute_evidence SET included_in_submission = true WHERE chargeback_id = ${cbId} AND scan_status = 'clean' AND review_status <> 'rejected'`.execute(trx);
        await sql`UPDATE chargebacks SET evidence_status = 'submitted', status = ${newStatus}, submitted_at = now(), updated_at = now() WHERE id = ${cbId} AND ${canMoveToSql(CHARGEBACK_EVIDENCE, 'submitted')} AND status = ${from} AND ${canMoveToSql(CHARGEBACK, newStatus)}`.execute(trx);
        await sql`INSERT INTO dispute_status_events (chargeback_id, tenant_id, from_status, to_status, source, reason, actor_user_id) VALUES (${cbId}, ${tenantId}, ${from}, ${newStatus}, 'super_admin', 'Evidence submitted to processor', ${actor.userId ?? null})`.execute(trx);
      }
      return { id: String(r.id), result: String(r.result), processorRef: r.processor_ref ?? null, idempotencyKey: String(r.idempotency_key), createdAt: new Date(r.created_at).toISOString(), alreadyExisted: false };
    }).then(async (res) => { await this.writeAudit(actor, 'dispute.evidence.submitted', cbId, tenantId, { idempotencyKey: key, result, processorRef, alreadyExisted: res.alreadyExisted }); return res; });
  }

  async findNotification(tenantId: string, key: string): Promise<NotificationSummary | null> {
    const q: any = await sql`SELECT id, channel, recipient, subject, delivery_status, created_at FROM dispute_tenant_notifications WHERE tenant_id = ${tenantId} AND idempotency_key = ${key} LIMIT 1`.execute(this.db).catch(() => ({ rows: [] }));
    const r = q.rows[0]; if (!r) return null;
    return { id: String(r.id), channel: String(r.channel), recipient: r.recipient ?? null, subject: r.subject ?? null, deliveryStatus: String(r.delivery_status), createdAt: new Date(r.created_at).toISOString(), alreadyExisted: true };
  }

  async recordNotification(actor: AuditActor, cbId: string, tenantId: string, branchId: string | null, n: NotificationInsert): Promise<NotificationSummary> {
    const ins: any = await sql`
      INSERT INTO dispute_tenant_notifications (chargeback_id, tenant_id, branch_id, channel, recipient, subject, body, delivery_status, idempotency_key, sent_by)
      VALUES (${cbId}, ${tenantId}, ${branchId}, ${n.channel}, ${n.recipient}, ${n.subject}, ${n.body}, ${n.deliveryStatus}, ${n.key}, ${actor.userId ?? null})
      ON CONFLICT (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
      RETURNING id, channel, recipient, subject, delivery_status, created_at`.execute(this.db).catch((e: any) => { throw e; });
    if (ins.rows.length === 0 && n.key) {
      const ex = await this.findNotification(tenantId, n.key);
      if (ex) return ex;
    }
    const r = ins.rows[0];
    await this.writeAudit(actor, 'dispute.tenant.notified', cbId, tenantId, { channel: n.channel, recipient: n.recipient, idempotencyKey: n.key });
    return { id: String(r.id), channel: String(r.channel), recipient: r.recipient ?? null, subject: r.subject ?? null, deliveryStatus: String(r.delivery_status), createdAt: new Date(r.created_at).toISOString(), alreadyExisted: false };
  }

  async recordOutcome(actor: AuditActor, cbId: string, tenantId: string, o: OutcomeInsert): Promise<OutcomeSummary> {
    return await this.db.transaction().execute(async (trx) => {
      const ins: any = await sql`
        INSERT INTO dispute_outcomes (chargeback_id, tenant_id, result, amount_won_cents, amount_lost_cents, funds_recovered_cents, processor_fee_cents, decision_reason, is_manual_override, override_reason, original_processor_decision, recorded_by, decided_at)
        VALUES (${cbId}, ${tenantId}, ${o.result}, ${o.amountWonCents}, ${o.amountLostCents}, ${o.fundsRecoveredCents}, ${o.processorFeeCents}, ${o.decisionReason}, ${o.isManualOverride}, ${o.overrideReason}, ${o.originalProcessorDecision}, ${actor.userId ?? null}, now())
        RETURNING id, result, is_manual_override, funds_recovered_cents, created_at`.execute(trx);
      const r = ins.rows[0];
      const cur: any = await sql`SELECT status FROM chargebacks WHERE id = ${cbId}`.execute(trx);
      const from = String(cur.rows[0]?.status ?? 'open');
      if (o.fundsRecoveredCents > 0) {
        await sql`INSERT INTO dispute_funds_events (chargeback_id, tenant_id, kind, amount_cents, effective_at, source) VALUES (${cbId}, ${tenantId}, 'recovered', ${o.fundsRecoveredCents}, now(), 'super_admin')`.execute(trx);
      }
      // Update business status + funds; only set processor_decision when this reflects a real (non-override) processor result.
      await sql`UPDATE chargebacks SET status = ${o.newStatus},
                  funds_recovered_cents = funds_recovered_cents + ${o.fundsRecoveredCents},
                  processor_decision = COALESCE(${o.setProcessorDecision}, processor_decision),
                  decided_at = now(), closed_at = CASE WHEN ${o.newStatus} IN ('won','lost','expired','cancelled','withdrawn') THEN now() ELSE closed_at END,
                  updated_at = now() WHERE id = ${cbId} AND status = ${from} AND ${canMoveToSql(CHARGEBACK, o.newStatus)} RETURNING id`.execute(trx).then((x: any) => { if (!x.rows.length) throw new InvalidStateTransitionError(CHARGEBACK, from, o.newStatus, 'concurrent'); });   // Phase 12 (#27): a concurrent outcome rolls this one (and its funds event) back
      await sql`INSERT INTO dispute_status_events (chargeback_id, tenant_id, from_status, to_status, source, reason, actor_user_id) VALUES (${cbId}, ${tenantId}, ${from}, ${o.newStatus}, 'super_admin', ${o.isManualOverride ? 'Manual outcome override' : 'Outcome recorded'}, ${actor.userId ?? null})`.execute(trx);
      return { id: String(r.id), result: String(r.result), isManualOverride: !!r.is_manual_override, newStatus: o.newStatus, fundsRecoveredCents: Number(r.funds_recovered_cents), createdAt: new Date(r.created_at).toISOString() };
    }).then(async (res) => { await this.writeAudit(actor, o.isManualOverride ? 'dispute.outcome.override' : 'dispute.outcome.recorded', cbId, tenantId, { result: o.result, isManualOverride: o.isManualOverride, overrideReason: o.overrideReason, originalProcessorDecision: o.originalProcessorDecision, fundsRecoveredCents: o.fundsRecoveredCents }); return res; });
  }

  async getDeadlineRows(): Promise<DeadlineRow[]> {
    const q: any = await sql`
      SELECT c.id, c.dispute_reference, c.tenant_id, COALESCE(t.display_name, t.legal_name, c.tenant_id::text) AS tenant_name,
             b.name AS branch_name, c.amount_cents, c.processor_type, c.reason_code, c.due_by, c.status, c.evidence_status, c.risk_level,
             c.submitted_at IS NOT NULL AS submitted,
             EXISTS (SELECT 1 FROM dispute_tenant_notifications n WHERE n.chargeback_id = c.id) AS tenant_notified
      FROM chargebacks c JOIN tenants t ON t.id = c.tenant_id LEFT JOIN branches b ON b.id = c.branch_id
      WHERE c.dispute_reference IS NOT NULL`.execute(this.db).catch(() => ({ rows: [] }));
    return (q.rows as any[]).map((x) => ({
      id: String(x.dispute_reference), disputeReference: String(x.dispute_reference), tenantId: String(x.tenant_id),
      tenantName: String(x.tenant_name), branchName: x.branch_name ?? null, amountCents: Number(x.amount_cents),
      processorType: x.processor_type ?? null, reasonCode: x.reason_code ?? null,
      dueBy: x.due_by ? new Date(x.due_by).toISOString() : null, status: String(x.status), evidenceStatus: String(x.evidence_status),
      riskLevel: String(x.risk_level), submitted: !!x.submitted, tenantNotified: !!x.tenant_notified,
    }));
  }

  async getPatternRows(): Promise<PatternRow[]> {
    const q: any = await sql`
      SELECT COALESCE(t.display_name, t.legal_name, c.tenant_id::text) AS tenant_name, b.name AS branch_name,
             c.reason_code, c.normalized_reason_category, c.processor_type, c.status, c.processor_decision,
             c.amount_cents, c.funds_withdrawn_cents, c.funds_recovered_cents, c.risk_level
      FROM chargebacks c JOIN tenants t ON t.id = c.tenant_id LEFT JOIN branches b ON b.id = c.branch_id
      WHERE c.dispute_reference IS NOT NULL`.execute(this.db).catch(() => ({ rows: [] }));
    return (q.rows as any[]).map((x) => ({
      tenantName: String(x.tenant_name), branchName: x.branch_name ?? null, reasonCode: x.reason_code ?? null,
      reasonCategory: x.normalized_reason_category ?? null, processor: x.processor_type ?? null, status: String(x.status),
      processorDecision: String(x.processor_decision), amountCents: Number(x.amount_cents),
      fundsWithdrawnCents: Number(x.funds_withdrawn_cents), fundsRecoveredCents: Number(x.funds_recovered_cents), riskLevel: String(x.risk_level),
    }));
  }

  async getHighRiskMerchants(): Promise<MerchantRiskRow[]> {
    const q: any = await sql`
      SELECT c.tenant_id, COALESCE(t.display_name, t.legal_name) AS tenant_name,
             COUNT(*)::int AS total_disputes,
             COUNT(*) FILTER (WHERE c.status IN ('open','needs_evidence','evidence_collecting','submitted','under_review','escalated','reopened'))::int AS open_disputes,
             COUNT(*) FILTER (WHERE c.status = 'lost')::int AS lost_disputes,
             COALESCE(SUM(c.amount_cents) FILTER (WHERE c.status IN ('open','needs_evidence','evidence_collecting','submitted','under_review','escalated','reopened')), 0) AS amount_at_risk,
             r.risk_level, r.reviewed_at, r.next_review_at, r.recommended_action, r.risk_reason
      FROM chargebacks c JOIN tenants t ON t.id = c.tenant_id
      LEFT JOIN LATERAL (SELECT risk_level, reviewed_at, next_review_at, recommended_action, risk_reason FROM merchant_risk_reviews mr WHERE mr.tenant_id = c.tenant_id ORDER BY mr.reviewed_at DESC LIMIT 1) r ON true
      WHERE c.dispute_reference IS NOT NULL
      GROUP BY c.tenant_id, t.display_name, t.legal_name, r.risk_level, r.reviewed_at, r.next_review_at, r.recommended_action, r.risk_reason
      ORDER BY amount_at_risk DESC`.execute(this.db).catch(() => ({ rows: [] }));
    return (q.rows as any[]).map((x) => ({
      tenantId: String(x.tenant_id), tenantName: String(x.tenant_name), openDisputes: Number(x.open_disputes),
      totalDisputes: Number(x.total_disputes), lostDisputes: Number(x.lost_disputes), amountAtRiskCents: Number(x.amount_at_risk),
      riskLevel: String(x.risk_level ?? 'low'), lastReviewedAt: x.reviewed_at ? new Date(x.reviewed_at).toISOString() : null,
      nextReviewAt: x.next_review_at ? new Date(x.next_review_at).toISOString() : null, recommendedAction: x.recommended_action ?? null, riskReason: x.risk_reason ?? null,
    }));
  }

  async flagMerchantRisk(actor: AuditActor, tenantId: string, f: RiskFlagInsert): Promise<MerchantRiskRow | null> {
    const t: any = await sql`SELECT COALESCE(display_name, legal_name) AS name FROM tenants WHERE id = ${tenantId} LIMIT 1`.execute(this.db).catch(() => ({ rows: [] }));
    if (t.rows.length === 0) return null;
    await sql`INSERT INTO merchant_risk_reviews (tenant_id, merchant_account_id, risk_level, risk_reason, recommended_action, reviewer_user_id, reviewed_at, next_review_at)
              VALUES (${tenantId}, ${f.merchantAccountId}, ${f.riskLevel}, ${f.riskReason}, ${f.recommendedAction}, ${actor.userId ?? null}, now(), ${f.nextReviewAt})`.execute(this.db);
    await this.writeAudit(actor, 'dispute.merchant_risk.flagged', tenantId, tenantId, { riskLevel: f.riskLevel, riskReason: f.riskReason, recommendedAction: f.recommendedAction, nextReviewAt: f.nextReviewAt });
    const list = await this.getHighRiskMerchants();
    return list.find((m) => m.tenantId === tenantId) ?? null;
  }

  async writeAuditLog(actor: AuditActor, action: string, entityId: string, tenantId: string | null, meta: Record<string, unknown>): Promise<void> {
    return this.writeAudit(actor, action, entityId, tenantId, meta);
  }

  private async writeAudit(actor: AuditActor, action: string, entityId: string, tenantId: string | null, meta: Record<string, unknown>): Promise<void> {
    const tid = tenantId && /^[0-9a-f-]{36}$/i.test(tenantId) ? tenantId : null;
    await (this.db as any).insertInto('audit_logs').values({
      id: sql`gen_random_uuid()`, tenant_id: tid, user_id: actor.userId ?? null, role: actor.role ?? 'SUPER_ADMIN',
      action_type: action, entity_type: 'dispute', entity_id: entityId, metadata_json: JSON.stringify(meta),
    }).execute().catch(() => {});
  }
}

function mapEvidence(r: any): EvidenceSummary {
  return { id: String(r.id), evidenceType: String(r.evidence_type), fileName: r.file_name ?? null, mimeType: r.mime_type ?? null, sizeBytes: r.size_bytes == null ? null : Number(r.size_bytes), reviewStatus: String(r.review_status), scanStatus: String(r.scan_status), includedInSubmission: !!r.included_in_submission, description: r.description ?? null, createdAt: new Date(r.created_at).toISOString() };
}

function mapListRow(x: any): DisputeListRow {
  return {
    id: String(x.dispute_reference), disputeReference: String(x.dispute_reference), tenantId: String(x.tenant_id),
    tenantName: String(x.tenant_name), branchName: x.branch_name ?? null, amountCents: Number(x.amount_cents),
    reasonCode: x.reason_code ?? null, reason: x.reason ?? null, transactionRef: x.transaction_ref ?? null,
    dueBy: x.due_by ? new Date(x.due_by).toISOString() : null, status: String(x.status), evidenceStatus: String(x.evidence_status),
    processorDecision: String(x.processor_decision), fundsWithdrawnCents: Number(x.funds_withdrawn_cents),
    fundsRecoveredCents: Number(x.funds_recovered_cents), riskLevel: String(x.risk_level),
  };
}
