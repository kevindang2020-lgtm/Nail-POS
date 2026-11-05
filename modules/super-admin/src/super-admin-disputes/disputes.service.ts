// disputes.service.ts — Chargebacks & Disputes read surface. Overview aggregation + filtered list + detail. Mutation
// workflows (evidence, submit, outcome, notify, risk, export) arrive in later units. Permission gating uses the
// SuperAdminGuard at the controller plus the disputes.view permission checked here.
import { Injectable, Inject } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import type { DisputesRepo, ListParams } from './disputes.repository';
import { buildDisputesOverview } from './disputes-overview-core';
import { evidenceChecklist, validateUpload, modeledScan } from './evidence-policy-core';
import { canSubmit, buildManifest, outcomeToStatus, outcomeRequiresOverride, OUTCOME_RESULTS } from './disputes-actions-core';
import { deadlineState, daysRemaining, hoursRemaining, inBucket, reminderDue, DEADLINE_BUCKETS, type DeadlineBucket } from './deadline-core';
import { buildPatterns, suggestRiskLevel } from './patterns-core';
import { toCsv, disputeToExportRecord, selectColumns } from './export-core';
import { isPlatformPrincipal } from '@aipowersalon/permissions';

export class DisputesForbiddenError extends Error {}
export class DisputesNotFoundError extends Error {}
export class DisputesValidationError extends Error {}
const VIEW_PERM = 'super_admin.disputes.view';
const MANAGE_PERM = 'super_admin.disputes.manage';
const SUBMIT_PERM = 'super_admin.disputes.evidence.submit';
const OUTCOME_PERM = 'super_admin.disputes.outcome.record';
const OVERRIDE_PERM = 'super_admin.disputes.override';
const RISK_PERM = 'super_admin.disputes.risk.flag';
const EXPORT_PERM = 'super_admin.disputes.export';

export type Actor = { userId?: string | null; role?: string | null; permissions?: string[] };

@Injectable()
export class DisputesService {
  constructor(@Inject('DisputesRepo') private readonly repo: DisputesRepo) {}

  private requireView(actor: Actor) {
    // SUPER_ADMIN auto-inherits super_admin.* — but enforce explicitly so a future non-super role must be granted it.
    if (!isPlatformPrincipal(actor) && !(actor?.permissions ?? []).includes(VIEW_PERM)) throw new DisputesForbiddenError(`missing permission: ${VIEW_PERM}`);
  }
  private requireManage(actor: Actor) {
    if (!isPlatformPrincipal(actor) && !(actor?.permissions ?? []).includes(MANAGE_PERM)) throw new DisputesForbiddenError(`missing permission: ${MANAGE_PERM}`);
  }
  private requirePerm(actor: Actor, perm: string) {
    if (!isPlatformPrincipal(actor) && !(actor?.permissions ?? []).includes(perm)) throw new DisputesForbiddenError(`missing permission: ${perm}`);
  }

  async getOverview(actor: Actor) {
    this.requireView(actor);
    return buildDisputesOverview(await this.repo.getOverviewData());
  }

  async listDisputes(actor: Actor, q: any) {
    this.requireView(actor);
    return this.repo.listDisputes(this.buildListParams(q));
  }

  private buildListParams(q: any, overridePageSize?: number): ListParams {
    return {
      page: overridePageSize ? 1 : Math.max(1, parseInt(q?.page, 10) || 1),
      pageSize: overridePageSize ?? Math.min(100, Math.max(1, parseInt(q?.pageSize, 10) || 10)),
      search: str(q?.search), tenantId: str(q?.tenantId), branchId: str(q?.branchId),
      reasonCode: str(q?.reasonCode), currentStatus: str(q?.currentStatus), evidenceStatus: str(q?.evidenceStatus),
      processorDecision: str(q?.processorDecision), riskLevel: str(q?.riskLevel), processor: str(q?.processor),
      deadlineStart: str(q?.deadlineStart), deadlineEnd: str(q?.deadlineEnd),
      amountMinCents: num(q?.amountMinCents), amountMaxCents: num(q?.amountMaxCents),
      sort: str(q?.sort), direction: q?.direction === 'asc' ? 'asc' : 'desc',
    };
  }

  // Export the current filtered scope as CSV. Reuses the same filters as the list; requires the export permission;
  // audit-logged. Never includes card/CVV/token/credential or evidence-file contents (enforced by export-core).
  async exportCsv(actor: Actor, q: any): Promise<{ filename: string; csv: string; rowCount: number }> {
    this.requirePerm(actor, EXPORT_PERM);
    const params = this.buildListParams(q, 5000); // filter-aware, capped
    const { rows } = await this.repo.listDisputes(params);
    const columns = selectColumns(Array.isArray(q?.columns) ? q.columns : typeof q?.columns === 'string' ? q.columns.split(',') : undefined);
    const csv = toCsv(columns, rows.map(disputeToExportRecord));
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    await this.repo.writeAuditLog({ userId: actor.userId, role: actor.role }, 'dispute.report.exported', 'platform', null, {
      rowCount: rows.length, columns: columns.map((c) => c.key), filters: sanitizeFilters(params),
    });
    return { filename: `chargebacks-disputes-${stamp}.csv`, csv, rowCount: rows.length };
  }

  async getDispute(actor: Actor, id: string) {
    this.requireView(actor);
    const d = await this.repo.getDisputeDetail(id);
    if (!d) throw new DisputesNotFoundError('dispute not found');
    return d;
  }

  // Track Deadlines workspace. Backend-authoritative time; each row carries its computed state, days/hours remaining,
  // whether a reminder is due, and the extra ops columns (evidence status, tenant-notified, risk, owner). Optional
  // bucket + missing-evidence + not-notified + high-value + high-risk filters, and a summary count per bucket.
  async getDeadlines(actor: Actor, q: any) {
    this.requireView(actor);
    const now = Date.now();
    const rows = await this.repo.getDeadlineRows();
    const bucket = typeof q?.bucket === 'string' && (DEADLINE_BUCKETS as readonly string[]).includes(q.bucket) ? (q.bucket as DeadlineBucket) : null;
    const highValueCents = 100000; // $1,000+
    let items = rows.map((r) => {
      const di = { dueBy: r.dueBy, status: r.status, submitted: r.submitted };
      return {
        disputeReference: r.disputeReference, tenantId: r.tenantId, tenantName: r.tenantName, branchName: r.branchName,
        amountCents: r.amountCents, processorType: r.processorType, reasonCode: r.reasonCode, dueBy: r.dueBy,
        status: r.status, evidenceStatus: r.evidenceStatus, riskLevel: r.riskLevel, tenantNotified: r.tenantNotified,
        deadlineState: deadlineState(di, now), daysRemaining: daysRemaining(r.dueBy, now), hoursRemaining: hoursRemaining(r.dueBy, now),
        reminderDue: reminderDue(di, new Set(), now) != null,
        missingEvidence: !['submitted', 'accepted'].includes(r.evidenceStatus),
      };
    });
    if (bucket) items = items.filter((it) => inBucket({ dueBy: it.dueBy, status: it.status, submitted: ['submitted', 'under_review'].includes(it.status) }, bucket, now));
    if (str(q?.missingEvidence) === 'true') items = items.filter((it) => it.missingEvidence);
    if (str(q?.tenantNotified) === 'false') items = items.filter((it) => !it.tenantNotified);
    if (str(q?.highValue) === 'true') items = items.filter((it) => it.amountCents >= highValueCents);
    if (str(q?.highRisk) === 'true') items = items.filter((it) => ['high', 'critical'].includes(it.riskLevel));
    // Order most-urgent first (overdue, then soonest), submitted/closed last.
    const rank: Record<string, number> = { overdue: 0, due_today: 1, due_soon: 2, approaching: 3, more_than_7_days: 4, unknown: 5, submitted: 6, closed: 7 };
    items.sort((a, b) => (rank[a.deadlineState] - rank[b.deadlineState]) || ((a.daysRemaining ?? 1e9) - (b.daysRemaining ?? 1e9)));

    const summary: Record<string, number> = {};
    for (const bkt of DEADLINE_BUCKETS) summary[bkt] = rows.filter((r) => inBucket({ dueBy: r.dueBy, status: r.status, submitted: r.submitted }, bkt, now)).length;
    return { rows: items, summary, remindersDue: items.filter((it) => it.reminderDue).length, generatedAt: new Date(now).toISOString() };
  }

  // Analyze Dispute Patterns — aggregate, privacy-minimized. No per-customer profiling, no accusations.
  async getPatterns(actor: Actor) {
    this.requireView(actor);
    return buildPatterns(await this.repo.getPatternRows());
  }

  // High-Risk Merchants list with per-tenant dispute aggregates + a suggested (advisory) risk level.
  async getHighRiskMerchants(actor: Actor) {
    this.requireView(actor);
    const rows = await this.repo.getHighRiskMerchants();
    return rows.map((r) => ({ ...r, suggestedRiskLevel: suggestRiskLevel(r.openDisputes, r.lostDisputes, r.amountAtRiskCents) }));
  }

  // Flag a merchant (tenant) for risk review. Requires the risk-flag permission + a reason. Recorded and audited. Does
  // NOT suspend processing — that is a separate approved risk-control workflow, not this page.
  async flagMerchantRisk(actor: Actor, tenantId: string, body: any) {
    this.requirePerm(actor, RISK_PERM);
    const riskReason = str(body?.riskReason);
    if (!riskReason) throw new DisputesValidationError('A risk reason is required to flag a merchant.');
    const riskLevel = str(body?.riskLevel) ?? 'high';
    if (!['low', 'medium', 'high', 'critical', 'under_review'].includes(riskLevel)) throw new DisputesValidationError('invalid risk level');
    if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new DisputesValidationError('invalid tenant id');
    const res = await this.repo.flagMerchantRisk({ userId: actor.userId, role: actor.role }, tenantId, {
      riskLevel, riskReason, recommendedAction: str(body?.recommendedAction) ?? null, nextReviewAt: str(body?.nextReviewAt) ?? null, merchantAccountId: str(body?.merchantAccountId) ?? null,
    });
    if (!res) throw new DisputesNotFoundError('tenant not found');
    return { ok: true, merchant: res };
  }

  // Review Disputes workspace: the full record plus the reason-code-driven evidence checklist and current evidence.
  async getReviewWorkspace(actor: Actor, id: string) {
    this.requireView(actor);
    const d = await this.repo.getDisputeDetail(id);
    if (!d) throw new DisputesNotFoundError('dispute not found');
    const checklist = evidenceChecklist(d.reasonCategory);
    const haveTypes = new Set(d.evidence.map((e) => e.type));
    const missingRequired = checklist.required.filter((r) => !presentFor(r, haveTypes));
    return { dispute: d, checklist, missingRequired };
  }

  async listEvidence(actor: Actor, id: string) {
    this.requireView(actor);
    const r = await this.repo.resolveDispute(id);
    if (!r) throw new DisputesNotFoundError('dispute not found');
    return { checklist: evidenceChecklist(r.reasonCategory), evidence: await this.repo.listEvidence(r.id) };
  }

  async requestEvidence(actor: Actor, id: string, body: any) {
    this.requireManage(actor);
    const r = await this.repo.resolveDispute(id);
    if (!r) throw new DisputesNotFoundError('dispute not found');
    await this.repo.requestEvidence({ userId: actor.userId, role: actor.role }, r.id, r.tenantId, str(body?.note) ?? null);
    return { ok: true, evidenceStatus: 'requested' };
  }

  async uploadEvidence(actor: Actor, id: string, body: any) {
    this.requireManage(actor);
    const r = await this.repo.resolveDispute(id);
    if (!r) throw new DisputesNotFoundError('dispute not found');
    const meta = { fileName: str(body?.fileName), mimeType: str(body?.mimeType), sizeBytes: Number(body?.sizeBytes) };
    const v = validateUpload(meta);
    if (!v.ok) throw new DisputesValidationError(v.error!);
    // Decode the transported content so the scanner and hash see the actual file bytes, not the base64 envelope.
    let decoded: Buffer | null = null;
    if (typeof body?.contentBase64 === 'string' && body.contentBase64.length) {
      try { decoded = Buffer.from(body.contentBase64, 'base64'); } catch { decoded = null; }
    }
    const scan = modeledScan(decoded ? decoded.toString('latin1') : null);
    if (scan === 'infected') throw new DisputesValidationError('The uploaded file failed the malware scan and was rejected.');
    // Hash the decoded bytes for duplicate detection (falls back to a descriptor when content is not streamed here).
    const fileHash = createHash('sha256').update(decoded ?? Buffer.from(`${meta.fileName}:${meta.sizeBytes}:${randomUUID()}`)).digest('hex');
    const storageRef = `evidence/${r.id}/${randomUUID()}-${(meta.fileName ?? 'file').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    try {
      const summary = await this.repo.insertEvidence(
        { userId: actor.userId, role: actor.role }, r.id, r.tenantId, r.branchId,
        { evidenceType: str(body?.evidenceType) ?? 'other', fileName: meta.fileName!, mimeType: meta.mimeType!, sizeBytes: meta.sizeBytes, fileHash, storageRef, scanStatus: scan, description: str(body?.description) ?? null, source: str(body?.source) ?? 'super_admin' },
      );
      return { ok: true, evidence: summary };
    } catch (e: any) {
      if (String(e?.message ?? '').includes('uq_dispute_evidence_hash') || e?.code === '23505') throw new DisputesValidationError('This exact file has already been uploaded for this dispute.');
      throw e;
    }
  }

  async reviewEvidence(actor: Actor, id: string, evidenceId: string, body: any) {
    this.requireManage(actor);
    const decision = str(body?.decision);
    if (!decision || !['accepted', 'rejected', 'incomplete'].includes(decision)) throw new DisputesValidationError('decision must be accepted, rejected, or incomplete');
    const r = await this.repo.resolveDispute(id);
    if (!r) throw new DisputesNotFoundError('dispute not found');
    const res = await this.repo.reviewEvidence({ userId: actor.userId, role: actor.role }, r.id, r.tenantId, evidenceId, decision, str(body?.reason) ?? null);
    if (!res) throw new DisputesNotFoundError('evidence not found for this dispute');
    return { ok: true, evidence: res };
  }

  // Submit evidence to the processor. Idempotent on the client-supplied key; a retry returns the same submission and
  // never creates a duplicate processor call. Deadline + eligibility + clean-evidence are validated first.
  async submitEvidence(actor: Actor, id: string, body: any) {
    this.requirePerm(actor, SUBMIT_PERM);
    const key = str(body?.idempotencyKey);
    if (!key) throw new DisputesValidationError('idempotencyKey is required for evidence submission.');
    const r = await this.repo.resolveDispute(id);
    if (!r) throw new DisputesNotFoundError('dispute not found');
    // Short-circuit on a known key so we never re-run the eligibility gate for an already-submitted package.
    const existing = await this.repo.findSubmission(r.tenantId, key);
    if (existing) return { ok: true, idempotent: true, submission: existing };

    const ctx = await this.repo.getSubmitContext(r.id);
    const gate = canSubmit({ status: ctx.status, dueBy: ctx.dueBy }, ctx.evidence, Date.now());
    if (!gate.ok) throw new DisputesValidationError(gate.error!);
    const manifest = buildManifest(ctx.evidence);

    // Modeled processor adapter: in sandbox the submission is accepted. A real deployment calls the processor's dispute
    // API here; an uncertain/error response records the submission and routes the dispute to manual investigation
    // (escalated) rather than blindly flipping it to submitted or retrying.
    const outcome = modeledProcessorSubmit();
    const newStatus = outcome.result === 'accepted' ? 'submitted' : 'escalated';
    const summary = await this.repo.recordSubmission({ userId: actor.userId, role: actor.role }, r.id, r.tenantId, key, ctx.processorType, outcome.processorRef, manifest, outcome.result, outcome.safeError, newStatus);
    return { ok: true, idempotent: !!summary.alreadyExisted, submission: summary, manifestCount: manifest.count };
  }

  // Notify a tenant about a dispute. Recorded with delivery status; idempotent per key; never carries card data.
  async notifyTenant(actor: Actor, id: string, body: any) {
    this.requireManage(actor);
    const r = await this.repo.resolveDispute(id);
    if (!r) throw new DisputesNotFoundError('dispute not found');
    const channel = str(body?.channel) ?? 'in_app';
    if (!['in_app', 'email', 'sms'].includes(channel)) throw new DisputesValidationError('channel must be in_app, email, or sms');
    const subject = scrub(str(body?.subject) ?? `Action needed on dispute ${id}`);
    const bodyText = scrub(str(body?.body) ?? '');
    const key = str(body?.idempotencyKey) ?? `${r.id}:${channel}:${hashish(subject + bodyText)}`;
    const existing = await this.repo.findNotification(r.tenantId, key);
    if (existing) return { ok: true, idempotent: true, notification: existing };
    const res = await this.repo.recordNotification({ userId: actor.userId, role: actor.role }, r.id, r.tenantId, r.branchId, { key, channel, recipient: str(body?.recipient) ?? 'tenant-admin', subject, body: bodyText, deliveryStatus: 'sent' });
    return { ok: true, idempotent: !!res.alreadyExisted, notification: res };
  }

  // Record a dispute outcome. The processor's authoritative decision is preserved. Marking won/lost without an
  // authoritative processor result is a manual override that requires the override permission + a reason.
  async recordOutcome(actor: Actor, id: string, body: any) {
    this.requirePerm(actor, OUTCOME_PERM);
    const result = str(body?.result);
    if (!result || !OUTCOME_RESULTS.has(result)) throw new DisputesValidationError(`result must be one of: ${[...OUTCOME_RESULTS].join(', ')}`);
    const r = await this.repo.resolveDispute(id);
    if (!r) throw new DisputesNotFoundError('dispute not found');

    const isOverride = outcomeRequiresOverride(r.processorDecision, result);
    const overrideReason = str(body?.overrideReason);
    if (isOverride) {
      this.requirePerm(actor, OVERRIDE_PERM);
      if (!overrideReason) throw new DisputesValidationError('A manual outcome override requires an override reason.');
    }
    const fundsRecoveredCents = intOr0(body?.fundsRecoveredCents);
    const amountWonCents = intOr0(body?.amountWonCents);
    const amountLostCents = intOr0(body?.amountLostCents);
    const processorFeeCents = intOr0(body?.processorFeeCents);
    // Only reflect a processor decision when this is NOT an override (i.e., it mirrors a real processor result).
    const setProcessorDecision = isOverride ? null : mapResultToDecision(result);

    const summary = await this.repo.recordOutcome({ userId: actor.userId, role: actor.role }, r.id, r.tenantId, {
      result, amountWonCents, amountLostCents, fundsRecoveredCents, processorFeeCents,
      decisionReason: str(body?.decisionReason) ?? null, isManualOverride: isOverride, overrideReason: overrideReason ?? null,
      originalProcessorDecision: r.processorDecision, newStatus: outcomeToStatus(result), setProcessorDecision,
    });
    return { ok: true, outcome: summary, manualOverride: isOverride };
  }
}

// Modeled processor submit adapter (sandbox). Real deploys call the Fiserv/CardPointe dispute API here.
function modeledProcessorSubmit(): { result: 'accepted' | 'pending' | 'error'; processorRef: string; safeError: string | null } {
  return { result: 'accepted', processorRef: `fiserv-sub-${randomUUID()}`, safeError: null };
}
function mapResultToDecision(result: string): string | null {
  const m: Record<string, string> = { won: 'won', lost: 'lost', partially_won: 'partially_won', reversed: 'reversed', withdrawn: 'withdrawn', expired: 'expired' };
  return m[result] ?? null;
}
// Remove anything resembling a long card-like digit run from free-text notifications (defensive; no card data flows here).
function scrub(s: string): string { return s.replace(/\b\d{13,19}\b/g, '••••'); }
function hashish(s: string): string { let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return String(h >>> 0); }
function intOr0(v: any): number { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? n : 0; }
// Only echo non-sensitive filter values into the audit metadata.
function sanitizeFilters(p: ListParams): Record<string, unknown> {
  const { page, pageSize, ...rest } = p;
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => v != null && v !== ''));
}

// A required checklist label is considered satisfied when an evidence row's type maps to it (loose contains match on
// normalized tokens) — the checklist is guidance, not a hard schema, so this stays forgiving.
function presentFor(requiredLabel: string, haveTypes: Set<string>): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, '');
  const target = norm(requiredLabel);
  for (const t of haveTypes) { const n = norm(t); if (n && (target.includes(n) || n.includes(target))) return true; }
  return false;
}

const str = (v: any) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: any) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : undefined; };
