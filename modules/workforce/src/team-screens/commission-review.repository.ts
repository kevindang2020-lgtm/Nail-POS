// commission-review.repository.ts — F1 + F2 (Finish the Five, 30 Oct 2026): the persisted Commission Discrepancy Review.
//
//   Run Check  scans the period (bounded: ≤ 366 days, ≤ 5,000 service lines, stable order) with every check and UPSERTS one
//              review per finding by its stable fingerprint — a rescan never recreates an issue and never touches a
//              reviewer's decision (ON CONFLICT only refreshes last_seen_at). Checks: the five existing read-only checks
//              (duplicate line, missing technician, tip allocation, earnings over base, payout vs payable) + F2's rate vs
//              historical configuration and refund-reversal verification (commission-checks.ts). UNABLE_TO_VERIFY lines are
//              counted and sampled on the run, never persisted as a discrepancy.
//   Workflow   OPEN → ASSIGNED → INVESTIGATING → RESOLVED; dismiss from any open state; reopen from RESOLVED / DISMISSED;
//              notes at any time. Each action: row lock, expectedVersion (409 on a stale version), server-side transition
//              check (422), the review update + an append-only review event + a central audit_events row in ONE
//              transaction. A reviewer whose own pay the finding concerns cannot resolve or dismiss it without a financial
//              manager permission (the denial is itself recorded). Resolve / dismiss need an explanation.
//   Money      NOTHING here pays, deducts, refunds, voids, reverses or edits a ledger, snapshot, adjustment or payout.
import { notifySettingsChanged, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { dateColumnYmd } from '@aipowersalon/date-time';
import { sql, type Kysely } from 'kysely';
import { N, iso, like, paging, served, branchOf, teamPeriod, inPeriod, UUID, actorOf, err, canAny, logGap, type TeamCtx, type TPeriod } from './screen-kit';
import { CommissionScreenRepository } from './commission-screen.repository';
import { writeAuditRow } from './audit-rows';
import { canMoveToSql } from '@aipowersalon/database';
import { COMMISSION_DISCREPANCY_REVIEW, COMMISSION_DISCREPANCY_SCAN_RUN } from '../workforce-lifecycles';
import {
  checkRateLine, checkRefundTicket, rateFingerprint, refundFingerprint, severityFor, type RateLineInput, type RateHistory, type RefundPolicy, type RefundRow, type RecordedReversal,
} from './commission-checks';
import type { ReversibleRow } from '../compensation/compensation-adjustments';

/** the finding columns the detail view maps (item() + the detail fields) — never the whole row */
const REVIEW_DETAIL_COLS = sql`r.id, r.finding_type, r.verification_state, r.status, r.severity, r.severity_reason, r.summary, r.evidence_json, r.technician_id,
  r.service_line_id, r.transaction_id, r.refund_id, r.expected_cents, r.recorded_cents, r.difference_cents, r.assigned_to_user_id, r.assigned_at, r.investigating_at,
  r.resolution_code, r.resolution_note, r.resolved_at, r.dismiss_reason, r.dismissed_at, r.detected_at, r.last_seen_at, r.updated_at, r.version`;

export const REVIEW_STATUSES = ['OPEN', 'ASSIGNED', 'INVESTIGATING', 'RESOLVED', 'DISMISSED'] as const;
export const FINDING_TYPES = ['RATE_CONFIG', 'REFUND_REVERSAL', 'DUPLICATE_LINE', 'MISSING_TECHNICIAN', 'TIP_MISMATCH', 'EARNINGS_OVER_BASE', 'PAYOUT_MISMATCH'] as const;
export const RESOLUTION_CODES = ['NO_ACTION', 'CORRECTED_SEPARATELY', 'FALSE_POSITIVE'] as const;
export const REFUND_POLICIES = ['PRO_RATA', 'NO_REVERSAL'] as const;
export type ReviewAction = 'assign' | 'investigate' | 'note' | 'resolve' | 'dismiss' | 'reopen';
type Status = typeof REVIEW_STATUSES[number];

const MAX_LINES = 5000; const MAX_DAYS = 366;
const VIEW = ['payroll.view', 'technicians.view_pay', 'reports.view', 'pos.reports.view'];
const REVIEW = ['payroll.manage', 'payroll.approve', 'payroll.adjust', 'payroll.view', 'technicians.view_pay'];
const FINANCE_MANAGER = ['payroll.manage', 'payroll.approve'];
const OLD_KIND: Record<string, typeof FINDING_TYPES[number]> = { duplicate_line: 'DUPLICATE_LINE', missing_technician: 'MISSING_TECHNICIAN', tip_mismatch: 'TIP_MISMATCH', earnings_over_base: 'EARNINGS_OVER_BASE', payout_mismatch: 'PAYOUT_MISMATCH' };
const OLD_SUMMARY: Record<string, string> = {
  DUPLICATE_LINE: 'The same service line is recorded more than once for this technician.', MISSING_TECHNICIAN: 'A paid service line has no technician.',
  TIP_MISMATCH: "The ticket's tip allocations do not add up to the ticket's tip.", EARNINGS_OVER_BASE: 'Recorded earnings are larger than the commissionable base.',
  PAYOUT_MISMATCH: 'Recorded payouts for a paid payroll period do not match the payable amount.',
};

/** the documented state machine (server-side; the UI only offers what this allows) */
export const TRANSITIONS: Record<ReviewAction, { from: Status[]; to: (cur: Status) => Status }> = {
  assign: { from: ['OPEN', 'ASSIGNED', 'INVESTIGATING'], to: (c) => (c === 'INVESTIGATING' ? 'INVESTIGATING' : 'ASSIGNED') },
  investigate: { from: ['OPEN', 'ASSIGNED'], to: () => 'INVESTIGATING' },
  note: { from: ['OPEN', 'ASSIGNED', 'INVESTIGATING', 'RESOLVED', 'DISMISSED'], to: (c) => c },
  resolve: { from: ['OPEN', 'ASSIGNED', 'INVESTIGATING'], to: () => 'RESOLVED' },
  dismiss: { from: ['OPEN', 'ASSIGNED', 'INVESTIGATING'], to: () => 'DISMISSED' },
  reopen: { from: ['RESOLVED', 'DISMISSED'], to: () => 'OPEN' },
};
export function allowedActions(status: Status): ReviewAction[] { return (Object.keys(TRANSITIONS) as ReviewAction[]).filter((a) => TRANSITIONS[a].from.includes(status)); }
const EVENT_OF: Record<ReviewAction, string> = { assign: 'ASSIGNED', investigate: 'INVESTIGATION_STARTED', note: 'NOTE_ADDED', resolve: 'RESOLVED', dismiss: 'DISMISSED', reopen: 'REOPENED' };

export interface ActionBody { expectedVersion?: unknown; assigneeUserId?: unknown; note?: unknown; resolutionCode?: unknown; reason?: unknown }
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export class CommissionReviewRepository {
  private readonly screen: CommissionScreenRepository;
  constructor(private readonly db: Kysely<any>, private readonly rt: RealtimeEmitter | null = null) { this.screen = new CommissionScreenRepository(db); }
  private mustView(ctx: TeamCtx) { if (!canAny(ctx, ...VIEW)) throw err(403, 'FORBIDDEN', 'You do not have permission to view technician pay.'); }
  private mustReview(ctx: TeamCtx) { if (!canAny(ctx, ...REVIEW)) throw err(403, 'FORBIDDEN', 'You do not have permission to review commission discrepancies.'); }
  private brR(ctx: TeamCtx) { const b = branchOf(ctx); return b ? sql`(r.branch_id = ${b} or r.branch_id is null)` : sql`true`; }

  // ── policy (tenant_settings category 'compensation', key refundReversalPolicy) ─────────────────────────────────────
  async refundPolicy(ctx: TeamCtx): Promise<RefundPolicy> {
    const r = (await sql<any>`select ts.settings_json->>'refundReversalPolicy' as p from tenant_settings ts where ts.tenant_id = ${ctx.tenantId} and ts.category = 'compensation' and ts.branch_id is null
      order by ts.updated_at desc nulls last limit 1`.execute(this.db)).rows[0];
    return (REFUND_POLICIES as readonly string[]).includes(String(r?.p)) ? (String(r.p) as RefundPolicy) : null;
  }
  /** set the documented policy (configuration only — no ledger row is touched); financial manager only, audited */
  async setRefundPolicy(ctx: TeamCtx, policy: unknown, requestId: string) {
    if (!canAny(ctx, ...FINANCE_MANAGER)) throw err(403, 'FORBIDDEN', 'Only a payroll manager can set the refund-reversal policy.');
    if (!(REFUND_POLICIES as readonly string[]).includes(String(policy))) throw err(422, 'INVALID_POLICY', 'Choose PRO_RATA or NO_REVERSAL.');
    const T = ctx.tenantId; const before = await this.refundPolicy(ctx);
    await this.db.transaction().execute(async (trx) => {
      const ex = (await sql<any>`select ts.id from tenant_settings ts where ts.tenant_id = ${T} and ts.category = 'compensation' and ts.branch_id is null order by ts.updated_at desc nulls last limit 1 for update`.execute(trx)).rows[0];
      if (ex) await sql`update tenant_settings ts set settings_json = coalesce(ts.settings_json, '{}'::jsonb) || jsonb_build_object('refundReversalPolicy', ${String(policy)}::text), updated_at = now(), updated_by_user_id = ${ctx.userId ?? null}
          where ts.tenant_id = ${T} and ts.id = ${ex.id}`.execute(trx);
      else await sql`insert into tenant_settings (tenant_id, branch_id, category, settings_json, updated_by_user_id) values (${T}, null, 'compensation', jsonb_build_object('refundReversalPolicy', ${String(policy)}::text), ${ctx.userId ?? null})`.execute(trx);
      await writeAuditRow(trx, ctx, { module: 'payroll', action: 'compensation.refund_reversal_policy.set', resourceType: 'tenant_settings', resourceId: 'compensation', summary: `Refund-reversal policy set to ${policy}`,
        before: { refundReversalPolicy: before }, after: { refundReversalPolicy: policy }, requestId });
    });
    notifySettingsChanged(this.rt, T, 'compensation');   // after the commit: other open screens reload
    return { policy: String(policy) };
  }

  // ── Run Check ──────────────────────────────────────────────────────────────────────────────────────────────────
  async runCheck(ctx: TeamCtx, f: { preset?: unknown; from?: unknown; to?: unknown }, requestId: string) {
    this.mustReview(ctx); const T = ctx.tenantId;
    const per = await teamPeriod(this.db, ctx, f, 'month');
    if (per.from && per.to && (Date.parse(per.to) - Date.parse(per.from)) / 86_400_000 > MAX_DAYS) throw err(422, 'RANGE_TOO_LONG', `Run the check over ${MAX_DAYS} days or fewer.`);
    if (!per.from) throw err(422, 'RANGE_REQUIRED', 'Choose a period for the check.');
    const run = (await sql<any>`insert into commission_discrepancy_scan_runs (tenant_id, branch_id, actor_user_id, period_from, period_to, request_id) values (${T}, ${branchOf(ctx)}, ${ctx.userId ?? null}, ${per.from}, ${per.to}, ${requestId}) returning id`.execute(this.db)).rows[0];
    const summary = { detected: 0, alreadyKnown: 0, checkedLines: 0, rateOk: 0, rateMismatch: 0, unableToVerify: 0, unableSamples: [] as { serviceLineId: string; reason: string }[],
      refundTickets: 0, refundFindings: 0, policy: null as RefundPolicy, truncated: false, byType: {} as Record<string, number> };
    try {
      const put = async (row: Finding) => {
        const r = await this.upsert(ctx, row, String(run.id), requestId); summary.byType[row.type] = (summary.byType[row.type] ?? 0) + 1;
        if (r) summary.detected++; else summary.alreadyKnown++;
      };
      // a. the five existing checks (same SQL the read-only panel used)
      for (let p = 1; p <= 50; p++) {
        const d = await this.screen.discrepancies(ctx, { ...f, kind: 'all', page: p, pageSize: 100 });
        for (const x of d.items) {
          const type = OLD_KIND[x.kind]; if (!type) continue;
          const diff = x.kind === 'duplicate_line' ? null : x.recorded - x.expected;
          await put({ type, fingerprint: [type, x.ref ?? '', x.technicianId ?? '', x.ticketId ?? ''].join('|'), severity: (x.severity === 'high' || x.severity === 'low' ? x.severity : 'medium'), severityReason: 'severity of the existing check',
            technicianId: x.technicianId, serviceLineId: x.kind === 'payout_mismatch' || x.kind === 'tip_mismatch' ? null : (x.ref && UUID.test(x.ref) ? x.ref : null),
            ticketId: x.ticketId && UUID.test(x.ticketId) ? x.ticketId : null, refundId: null, periodRef: x.kind === 'payout_mismatch' ? x.ref : null,
            expected: x.kind === 'duplicate_line' ? null : x.expected, recorded: x.recorded, difference: diff, summary: OLD_SUMMARY[type], verification: 'CONFIRMED',
            evidence: { check: x.kind, ref: x.ref, ticketNumber: x.ticketNumber, expectedCents: x.expected, recordedCents: x.recorded, at: x.at } });
        }
        if (p >= d.totalPages) break;
      }
      // b. rate vs historical configuration
      const lines = await this.rateLines(ctx, per); summary.truncated = lines.truncated;
      const hist = await this.rateHistory(ctx, lines.serviceIds);
      for (const l of lines.items) {
        summary.checkedLines++;
        const res = checkRateLine(l.input, { versions: hist.versions, service: l.input.serviceId ? hist.services.get(l.input.serviceId) ?? null : null, tenantDefault: hist.tenantDefault } as RateHistory);
        if (res.state === 'OK') { summary.rateOk++; continue; }
        if (res.state === 'UNABLE_TO_VERIFY') { summary.unableToVerify++; if (summary.unableSamples.length < 20) summary.unableSamples.push({ serviceLineId: l.input.serviceLineId, reason: res.reasons[0] }); continue; }
        summary.rateMismatch++;
        const sev = severityFor(res.deltaCents ?? 0); const tech = l.input.rows.length === 1 ? l.input.rows[0].technicianId : l.input.technicianId;
        await put({ type: 'RATE_CONFIG', fingerprint: rateFingerprint(l.input.serviceLineId, res), severity: sev.severity, severityReason: sev.reason, technicianId: tech, serviceLineId: l.input.serviceLineId,
          ticketId: l.input.ticketId, refundId: null, periodRef: null, expected: res.expectedCents, recorded: res.recordedCents, difference: res.deltaCents, verification: 'CONFIRMED',
          summary: `Captured commission does not match the configuration in effect at service time.`,
          evidence: { check: 'rate_vs_historical_config', explanation: res.explanation, reasons: res.reasons, expectedRate: res.expected, recordedRate: res.recorded, pricedAt: l.input.pricedAt,
            snapshotIds: l.input.rows.map((r) => r.snapshotId), commissionableCents: l.input.rows.reduce((n, r) => n + r.commissionableCents, 0), rounding: 'largest remainder, 1¢ tolerance' } });
      }
      // c. refund reversal verification
      summary.policy = await this.refundPolicy(ctx);
      for (const t of await this.refundTickets(ctx, per, summary.policy)) {
        summary.refundTickets++;
        for (const fnd of checkRefundTicket(t.input)) {
          summary.refundFindings++;
          const sev = fnd.kind === 'POLICY_NOT_CONFIGURED' ? { severity: 'medium' as const, reason: 'policy not configured — review required' }
            : fnd.paidAlready ? { severity: 'high' as const, reason: 'commission already paid — special review' } : severityFor(fnd.deltaCents ?? 0);
          await put({ type: 'REFUND_REVERSAL', fingerprint: refundFingerprint(t.input.ticketId, fnd), severity: sev.severity, severityReason: sev.reason, technicianId: fnd.technicianId, serviceLineId: null,
            ticketId: t.input.ticketId, refundId: fnd.refundIds[0] ?? null, periodRef: null, expected: fnd.expectedCents, recorded: fnd.recordedCents, difference: fnd.deltaCents,
            verification: fnd.kind === 'POLICY_NOT_CONFIGURED' ? 'POLICY_NOT_CONFIGURED' : fnd.paidAlready ? 'REVIEW_REQUIRED' : 'CONFIRMED',
            summary: fnd.kind === 'POLICY_NOT_CONFIGURED' ? 'Refund posted — refund-reversal policy not configured (review required).' : `Refund reversal ${fnd.kind.toLowerCase()} for the posted refund(s).`,
            evidence: { check: 'refund_reversal', kind: fnd.kind, explanation: fnd.explanation, policy: summary.policy, refundIds: fnd.refundIds, recordedEntryIds: fnd.recordedEntryIds, paidAlready: fnd.paidAlready,
              ticketNumber: t.ticketNumber, capturedCents: t.input.capturedCents, refundedCents: t.refundedCents,
              timing: 'Only posted (refunded) POS refunds are reconciled; processor settlement and payroll timing may lag.' } });
        }
      }
      await sql`update commission_discrepancy_scan_runs r set status = 'succeeded', finished_at = now(), summary_json = ${JSON.stringify(summary)}::jsonb where r.tenant_id = ${T} and r.id = ${run.id} and ${canMoveToSql(COMMISSION_DISCREPANCY_SCAN_RUN, 'succeeded', 'r')}`.execute(this.db);
      await writeAuditRow(this.db, ctx, { module: 'payroll', action: 'commission.discrepancy.scan', resourceType: 'commission_discrepancy_scan_run', resourceId: String(run.id),
        summary: `Commission discrepancy check ${per.from} – ${per.to}: ${summary.detected} new, ${summary.alreadyKnown} already known`, metadata: { ...summary, unableSamples: undefined }, requestId });
      return { runId: String(run.id), period: per, ...summary };
    } catch (e: any) {
      await sql`update commission_discrepancy_scan_runs r set status = 'failed', finished_at = now(), summary_json = ${JSON.stringify({ ...summary, error: String(e?.code ?? 'SCAN_FAILED') })}::jsonb where r.tenant_id = ${T} and r.id = ${run.id} and ${canMoveToSql(COMMISSION_DISCREPANCY_SCAN_RUN, 'failed', 'r')}`.execute(this.db).catch(logGap('commission_scan_failure_not_recorded'));
      throw e;
    }
  }

  /** insert when new (returns true) — never changes a known review except its last_seen_at */
  private async upsert(ctx: TeamCtx, f: Finding, runId: string, requestId: string): Promise<boolean> {
    const T = ctx.tenantId;
    return this.db.transaction().execute(async (trx) => {
      const r = (await sql<any>`insert into commission_discrepancy_reviews (tenant_id, branch_id, finding_fingerprint, finding_type, verification_state, severity, severity_reason, technician_id, service_line_id, transaction_id,
          refund_id, period_ref, expected_cents, recorded_cents, difference_cents, summary, evidence_json, scan_run_id)
        values (${T}, ${branchOf(ctx)}, ${f.fingerprint}, ${f.type}, ${f.verification}, ${f.severity}, ${f.severityReason}, ${f.technicianId}, ${f.serviceLineId}, ${f.ticketId}, ${f.refundId}, ${f.periodRef},
          ${f.expected}, ${f.recorded}, ${f.difference}, ${f.summary.slice(0, 500)}, ${JSON.stringify(f.evidence)}::jsonb, ${runId})
        on conflict (tenant_id, finding_fingerprint) do update set last_seen_at = now()
        returning id, (xmax = 0) as inserted`.execute(trx)).rows[0];
      if (r?.inserted) await sql`insert into commission_discrepancy_review_events (tenant_id, branch_id, review_id, actor_user_id, event_type, new_status, safe_metadata_json, request_id)
          values (${T}, ${branchOf(ctx)}, ${r.id}, ${ctx.userId ?? null}, 'DETECTED', 'OPEN', ${JSON.stringify({ scanRunId: runId, type: f.type })}::jsonb, ${requestId})`.execute(trx);
      return !!r?.inserted;
    });
  }

  private async rateLines(ctx: TeamCtx, per: TPeriod) {
    const T = ctx.tenantId; const b = branchOf(ctx);
    const rows = (await sql<any>`select s.id, s.service_line_id, s.ticket_id, s.technician_id, s.commissionable_cents, s.tech_service_earnings_cents, s.commission_type, s.commission_value, coalesce(s.rule_source, s.commission_source) as rule_source,
        s.policy_id, s.policy_version, s.discount_cents, s.discount_funding, s.branch_id, s.snapshot_at, tl.created_at as priced_at, coalesce(tl.service_id, s.service_id) as service_id, tl.category_snapshot, tl.technician_id as line_tech
      from ticket_compensation_snapshots s left join ticket_service_lines tl on tl.id = s.service_line_id and tl.tenant_id = s.tenant_id
      where s.tenant_id = ${T} and (${b}::uuid is null or s.branch_id = ${b} or s.branch_id is null) and s.service_line_id is not null and ${inPeriod(sql`s.snapshot_at`, per)}
        and tl.removed_at is null and coalesce(tl.line_kind, 'service') <> 'retail' and coalesce(s.gross_price_cents, 0) > 0
      order by s.snapshot_at desc, s.service_line_id, s.id limit ${MAX_LINES * 4 + 1}`.execute(this.db)).rows;
    const by = new Map<string, any[]>(); for (const r of rows) { const k = String(r.service_line_id); by.set(k, [...(by.get(k) ?? []), r]); }
    const items: { input: RateLineInput }[] = []; const serviceIds = new Set<string>();
    for (const [lineId, rs] of by) {
      if (items.length >= MAX_LINES) break;
      const h = rs[0]; if (h.service_id) serviceIds.add(String(h.service_id));
      items.push({ input: { tenantId: T, ticketId: h.ticket_id ? String(h.ticket_id) : null, serviceLineId: lineId, branchId: h.branch_id ? String(h.branch_id) : null, serviceId: h.service_id ? String(h.service_id) : null,
        serviceCategory: h.category_snapshot ?? null, technicianId: h.line_tech ? String(h.line_tech) : h.technician_id ? String(h.technician_id) : null, pricedAt: iso(h.priced_at ?? h.snapshot_at) ?? '',
        recordedType: h.commission_type ?? null, recordedValue: h.commission_value == null ? null : Number(h.commission_value), ruleSource: h.rule_source ?? null,
        policyId: h.policy_id ?? null, policyVersion: h.policy_version == null ? null : Number(h.policy_version), discountCents: rs.reduce((n, r) => n + N(r.discount_cents), 0), discountFunding: h.discount_funding ?? null,
        rows: rs.map((r) => ({ snapshotId: String(r.id), technicianId: r.technician_id ? String(r.technician_id) : null, commissionableCents: N(r.commissionable_cents), earningsCents: N(r.tech_service_earnings_cents) })) } });
    }
    return { items, serviceIds: [...serviceIds], truncated: by.size > MAX_LINES || rows.length > MAX_LINES * 4 };
  }

  private async rateHistory(ctx: TeamCtx, serviceIds: string[]) {
    const T = ctx.tenantId;
    const versions = (await sql<any>`select v.policy_id, v.id as version_id, v.version, p.branch_id, p.technician_id, p.service_id, p.service_category, p.ticket_id, v.commission_type, v.commission_value,
        v.supply_method, v.supply_value, v.discount_funding, v.effective_start, v.effective_end, v.approved, v.created_at
      from compensation_policy_versions v join compensation_policies p on p.id = v.policy_id and p.tenant_id = v.tenant_id
      where v.tenant_id = ${T} and v.status in ('active', 'scheduled', 'expired', 'replaced')`.execute(this.db)).rows;
    const services = new Map<string, any>();
    if (serviceIds.length) for (const r of (await sql<any>`select sv.id, sv.commission_type, sv.commission_value, sv.updated_at from services sv where sv.tenant_id = ${T} and sv.id = any(${serviceIds}::uuid[])`.execute(this.db)).rows)
      services.set(String(r.id), { commission_type: r.commission_type ?? null, commission_value: r.commission_value == null ? null : Number(r.commission_value), updated_at: r.updated_at ?? null });
    const t = (await sql<any>`select tn.default_commission_percent, tn.updated_at from tenants tn where tn.id = ${T}`.execute(this.db)).rows[0];
    const pct = t?.default_commission_percent != null && Number.isFinite(Number(t.default_commission_percent)) ? Math.max(0, Math.min(100, Number(t.default_commission_percent))) : 50;
    return { versions, services, tenantDefault: { percent: pct, updatedAt: t?.updated_at ?? null } };
  }

  private async refundTickets(ctx: TeamCtx, per: TPeriod, policy: RefundPolicy) {
    const T = ctx.tenantId; const b = branchOf(ctx);
    const tks = (await sql<any>`select distinct p.ticket_id from payment_refunds r join payments p on p.id = r.payment_id and p.tenant_id = r.tenant_id
      where r.tenant_id = ${T} and (${b}::uuid is null or r.branch_id = ${b} or r.branch_id is null) and r.status = 'refunded' and p.ticket_id is not null and ${inPeriod(sql`r.created_at`, per)}
      order by p.ticket_id limit 2000`.execute(this.db)).rows.map((r: any) => String(r.ticket_id));
    const out: { input: Parameters<typeof checkRefundTicket>[0]; ticketNumber: string | null; refundedCents: number }[] = [];
    for (const ticketId of tks) {
      const [tk, pays, refunds, snaps, adj] = await Promise.all([
        sql<any>`select tk.id, tk.ticket_number, tk.subtotal_cents, tk.paid_at,
            exists (select 1 from payroll_periods pp where pp.tenant_id = ${T} and pp.status = 'paid' and tk.paid_at is not null and (tk.paid_at at time zone ${per.tz})::date between pp.period_start and pp.period_end) as period_paid
          from tickets tk where tk.tenant_id = ${T} and tk.id = ${ticketId}`.execute(this.db),
        sql<any>`select coalesce(sum(p.amount_cents) filter (where p.status in ('approved', 'partial', 'captured', 'completed', 'settled', 'succeeded', 'partially_refunded', 'refunded')), 0)::bigint as captured from payments p where p.tenant_id = ${T} and p.ticket_id = ${ticketId}`.execute(this.db),
        sql<any>`select r.id, r.amount_cents, r.status, coalesce(r.event_id, r.processor_refund_id) as dedupe, r.created_at, r.request_detail from payment_refunds r join payments p on p.id = r.payment_id and p.tenant_id = r.tenant_id
          where r.tenant_id = ${T} and p.ticket_id = ${ticketId} order by r.created_at, r.id`.execute(this.db),
        sql<any>`select s.service_line_id, s.technician_id, s.tech_service_earnings_cents, s.salon_service_share_cents, s.supply_cents, s.card_tip_cents, s.cash_tip_cents, s.retail_commission_cents
          from ticket_compensation_snapshots s where s.tenant_id = ${T} and s.ticket_id = ${ticketId} order by s.service_line_id, s.technician_id`.execute(this.db),
        sql<any>`select a.id, a.technician_id, a.service_line_id, a.category, a.amount_cents, a.status, a.refund_payment_id, a.targets_future_period from compensation_adjustments a
          where a.tenant_id = ${T} and a.ticket_id = ${ticketId} and a.source in ('refund', 'void')`.execute(this.db),
      ]);
      const t = tk.rows[0]; if (!t) continue;
      const captured = N(pays.rows[0]?.captured);
      const detail = (v: any) => { try { return typeof v === 'string' ? JSON.parse(v) : v ?? {}; } catch (e) { logGap('refund_request_detail_unreadable')(e); return {}; } };
      const rf: RefundRow[] = refunds.rows.map((r: any) => { const d = detail(r.request_detail); return { id: String(r.id), amountCents: N(r.amount_cents), status: String(r.status), dedupeKey: r.dedupe ?? null, createdAt: iso(r.created_at) ?? '',
        serviceLineIds: Array.isArray(d?.serviceLineIds) ? d.serviceLineIds.map(String) : null, tipRefunded: !!d?.tipRefunded }; });
      const rows: ReversibleRow[] = snaps.rows.map((s: any) => ({ service_line_id: String(s.service_line_id), technician_id: s.technician_id ? String(s.technician_id) : null, tech_service_earnings_cents: N(s.tech_service_earnings_cents),
        salon_service_share_cents: N(s.salon_service_share_cents), supply_cents: N(s.supply_cents), card_tip_cents: N(s.card_tip_cents), cash_tip_cents: N(s.cash_tip_cents), retail_commission_cents: N(s.retail_commission_cents) }));
      const recorded: RecordedReversal[] = adj.rows.map((a: any) => ({ id: String(a.id), technicianId: a.technician_id ? String(a.technician_id) : null, serviceLineId: a.service_line_id ? String(a.service_line_id) : null,
        category: String(a.category), amountCents: N(a.amount_cents), status: String(a.status), refundPaymentId: a.refund_payment_id ? String(a.refund_payment_id) : null, targetsFuturePeriod: !!a.targets_future_period }));
      const nonComm = t.subtotal_cents != null ? Math.max(0, captured - N(t.subtotal_cents)) : null;
      out.push({ input: { ticketId, capturedCents: captured, nonCommissionableCents: nonComm, refunds: rf, rows, recorded, policy, periodPaid: !!t.period_paid },
        ticketNumber: t.ticket_number ?? null, refundedCents: rf.filter((r) => r.status === 'refunded').reduce((n, r) => n + r.amountCents, 0) });
    }
    return out;
  }

  // ── list / detail ───────────────────────────────────────────────────────────────────────────────────────────────
  async list(ctx: TeamCtx, f: { status?: string; severity?: string; type?: string; assignee?: string; q?: string; from?: string; to?: string; page?: unknown; pageSize?: unknown }) {
    this.mustView(ctx); const T = ctx.tenantId; const { page, pageSize } = paging(f.page, f.pageSize, 8);
    const st = (REVIEW_STATUSES as readonly string[]).includes(String(f.status)) ? String(f.status) : f.status === 'open_all' ? 'open_all' : 'all';
    const sev = ['low', 'medium', 'high'].includes(String(f.severity)) ? String(f.severity) : null;
    const type = (FINDING_TYPES as readonly string[]).includes(String(f.type)) ? String(f.type) : null;
    const who = f.assignee === 'me' ? ctx.userId : f.assignee && UUID.test(f.assignee) ? f.assignee : null; const unassigned = f.assignee === 'none';
    const raw = String(f.q ?? '').trim().slice(0, 100); const l = like(raw); const isId = UUID.test(raw);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(f.from)) ? String(f.from) : null; const to = /^\d{4}-\d{2}-\d{2}$/.test(String(f.to)) ? String(f.to) : null;
    const base = sql`from commission_discrepancy_reviews r left join technicians te on te.id = r.technician_id and te.tenant_id = r.tenant_id left join tickets tk on tk.id = r.transaction_id and tk.tenant_id = r.tenant_id
      left join users au on au.id = r.assigned_to_user_id and au.tenant_id = r.tenant_id where r.tenant_id = ${T} and ${this.brR(ctx)}`;
    const w = sql`(${st} = 'all' or (${st} = 'open_all' and r.status in ('OPEN', 'ASSIGNED', 'INVESTIGATING')) or r.status = ${st}) and (${sev}::text is null or r.severity = ${sev}) and (${type}::text is null or r.finding_type = ${type})
      and (${who}::uuid is null or r.assigned_to_user_id = ${who}) and (not ${unassigned} or r.assigned_to_user_id is null)
      and (${from}::date is null or r.detected_at >= ${from}::date) and (${to}::date is null or r.detected_at < (${to}::date + 1))
      and (${raw} = '' or coalesce(te.full_name, '') ilike ${l} or coalesce(tk.ticket_number, '') ilike ${l} or r.summary ilike ${l} or (${isId} and (r.id::text = ${raw} or r.transaction_id::text = ${raw} or r.service_line_id::text = ${raw})))`;
    const counts = (await sql<any>`select r.status, count(*)::int as n ${base} group by r.status`.execute(this.db)).rows;
    const total = N((await sql<any>`select count(*)::int as n ${base} and ${w}`.execute(this.db)).rows[0]?.n); const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select r.id, r.finding_type, r.verification_state, r.status, r.severity, r.summary, r.technician_id, te.full_name as technician, r.transaction_id, tk.ticket_number, r.expected_cents, r.recorded_cents,
        r.difference_cents, r.assigned_to_user_id, coalesce(nullif(au.full_name, ''), au.email) as assignee, r.detected_at, r.updated_at, r.version
      ${base} and ${w} order by r.detected_at desc, r.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    return { counts: Object.fromEntries(REVIEW_STATUSES.map((s) => [s, N(counts.find((c: any) => c.status === s)?.n)])), lastRun: await this.lastRun(ctx), policy: await this.refundPolicy(ctx),
      items: rows.map((r: any) => this.item(r)), page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }
  private item(r: any) {
    return { id: String(r.id), type: String(r.finding_type), verification: String(r.verification_state), status: String(r.status), severity: String(r.severity), summary: String(r.summary),
      technicianId: r.technician_id ? String(r.technician_id) : null, technician: r.technician ?? null, ticketId: r.transaction_id ? String(r.transaction_id) : null, ticketNumber: r.ticket_number ?? null,
      expectedCents: r.expected_cents == null ? null : N(r.expected_cents), recordedCents: r.recorded_cents == null ? null : N(r.recorded_cents), differenceCents: r.difference_cents == null ? null : N(r.difference_cents),
      assigneeUserId: r.assigned_to_user_id ? String(r.assigned_to_user_id) : null, assignee: r.assignee ?? null, detectedAt: iso(r.detected_at), updatedAt: iso(r.updated_at), version: N(r.version),
      actions: allowedActions(String(r.status) as Status) };
  }
  async lastRun(ctx: TeamCtx) {
    const r = (await sql<any>`select r.id, r.status, r.started_at, r.finished_at, to_char(r.period_from, 'YYYY-MM-DD') as period_from, to_char(r.period_to, 'YYYY-MM-DD') as period_to, r.summary_json, coalesce(nullif(u.full_name, ''), u.email) as actor from commission_discrepancy_scan_runs r
      left join users u on u.id = r.actor_user_id and u.tenant_id = r.tenant_id where r.tenant_id = ${ctx.tenantId} and ${this.brR(ctx)} order by r.started_at desc, r.id desc limit 1`.execute(this.db)).rows[0];
    if (!r) return null;
    const ymd = (v: unknown) => dateColumnYmd(v);
    return { id: String(r.id), status: String(r.status), startedAt: iso(r.started_at), finishedAt: iso(r.finished_at), from: ymd(r.period_from), to: ymd(r.period_to), actor: r.actor ?? null, summary: r.summary_json ?? {} };
  }

  async detail(ctx: TeamCtx, id: string, f: { page?: unknown; pageSize?: unknown } = {}) {
    this.mustView(ctx); const T = ctx.tenantId;
    if (!UUID.test(id)) throw err(404, 'REVIEW_NOT_FOUND', 'That finding is not in this salon.');
    const r = (await sql<any>`select ${REVIEW_DETAIL_COLS}, te.full_name as technician, tk.ticket_number, coalesce(nullif(au.full_name, ''), au.email) as assignee, coalesce(nullif(rb.full_name, ''), rb.email) as resolver,
        coalesce(nullif(db.full_name, ''), db.email) as dismisser
      from commission_discrepancy_reviews r left join technicians te on te.id = r.technician_id and te.tenant_id = r.tenant_id left join tickets tk on tk.id = r.transaction_id and tk.tenant_id = r.tenant_id
        left join users au on au.id = r.assigned_to_user_id and au.tenant_id = r.tenant_id left join users rb on rb.id = r.resolved_by and rb.tenant_id = r.tenant_id left join users db on db.id = r.dismissed_by and db.tenant_id = r.tenant_id
      where r.tenant_id = ${T} and ${this.brR(ctx)} and r.id = ${id}`.execute(this.db)).rows[0];
    if (!r) throw err(404, 'REVIEW_NOT_FOUND', 'That finding is not in this salon.');
    const { page, pageSize } = paging(f.page, f.pageSize, 8);
    const total = N((await sql<any>`select count(*)::int as n from commission_discrepancy_review_events e where e.tenant_id = ${T} and e.review_id = ${id}`.execute(this.db)).rows[0]?.n); const sp = served(page, pageSize, total);
    const ev = (await sql<any>`select e.id, e.event_type, e.old_status, e.new_status, e.reason, e.safe_metadata_json, e.created_at, coalesce(nullif(u.full_name, ''), u.email) as actor
      from commission_discrepancy_review_events e left join users u on u.id = e.actor_user_id and u.tenant_id = e.tenant_id where e.tenant_id = ${T} and e.review_id = ${id}
      order by e.created_at desc, e.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    return { ...this.item(r), severityReason: r.severity_reason ?? null, evidence: r.evidence_json ?? {}, serviceLineId: r.service_line_id ? String(r.service_line_id) : null, refundId: r.refund_id ? String(r.refund_id) : null,
      assignedAt: iso(r.assigned_at), investigatingAt: iso(r.investigating_at), resolutionCode: r.resolution_code ?? null, resolutionNote: r.resolution_note ?? null, resolvedAt: iso(r.resolved_at), resolvedBy: r.resolver ?? null,
      dismissReason: r.dismiss_reason ?? null, dismissedAt: iso(r.dismissed_at), dismissedBy: r.dismisser ?? null, lastSeenAt: iso(r.last_seen_at), selfPay: await this.isOwnPay(ctx, r.technician_id),
      canAct: canAny(ctx, ...REVIEW), canClose: canAny(ctx, ...REVIEW) && (canAny(ctx, ...FINANCE_MANAGER) || !(await this.isOwnPay(ctx, r.technician_id))),
      history: { items: ev.map((e: any) => ({ id: String(e.id), type: String(e.event_type), from: e.old_status ?? null, to: e.new_status ?? null, reason: e.reason ?? null, metadata: e.safe_metadata_json ?? {}, at: iso(e.created_at), actor: e.actor ?? null })),
        page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages } };
  }
  private async isOwnPay(ctx: TeamCtx, technicianId: unknown): Promise<boolean> {
    if (!technicianId || !ctx.userId) return false;
    const r = (await sql<any>`select 1 as x from technicians te where te.tenant_id = ${ctx.tenantId} and te.id = ${String(technicianId)} and te.user_id = ${ctx.userId}`.execute(this.db)).rows[0];
    return !!r;
  }

  /** active users of this salon a finding may be assigned to (searchable, capped) */
  async assignees(ctx: TeamCtx, q?: string) {
    this.mustReview(ctx); const raw = String(q ?? '').trim().slice(0, 100); const l = like(raw);
    const rows = (await sql<any>`select u.id, coalesce(nullif(u.full_name, ''), u.email) as name from users u where u.tenant_id = ${ctx.tenantId} and coalesce(u.status, 'active') = 'active'
      and (${raw} = '' or coalesce(u.full_name, '') ilike ${l} or coalesce(u.email, '') ilike ${l}) order by lower(coalesce(nullif(u.full_name, ''), u.email, '')), u.id limit 25`.execute(this.db)).rows;
    return { items: rows.map((r: any) => ({ userId: String(r.id), name: r.name ?? null })) };
  }

  // ── workflow ────────────────────────────────────────────────────────────────────────────────────────────────────
  async act(ctx: TeamCtx, id: string, action: ReviewAction, b: ActionBody, requestId: string) {
    this.mustReview(ctx); const T = ctx.tenantId;
    if (!UUID.test(id)) throw err(404, 'REVIEW_NOT_FOUND', 'That finding is not in this salon.');
    const expected = Number(b.expectedVersion);
    if (!Number.isInteger(expected) || expected < 1) throw err(400, 'EXPECTED_VERSION_REQUIRED', 'Reload the finding and try again.');
    const note = text(b.note ?? b.reason, 2000);
    if ((action === 'resolve' || action === 'dismiss' || action === 'reopen') && note.length < 5) throw err(422, 'REASON_REQUIRED', 'Write an explanation (at least 5 characters).');
    if (action === 'note' && note.length < 1) throw err(422, 'NOTE_REQUIRED', 'Write the note.');
    const code = action === 'resolve' ? String(b.resolutionCode ?? '') : null;
    if (action === 'resolve' && !(RESOLUTION_CODES as readonly string[]).includes(code!)) throw err(422, 'RESOLUTION_CODE_REQUIRED', 'Choose how the finding was resolved.');
    let assignee: string | null = null;
    if (action === 'assign') {
      assignee = typeof b.assigneeUserId === 'string' && UUID.test(b.assigneeUserId) ? b.assigneeUserId : null;
      if (!assignee) throw err(422, 'ASSIGNEE_REQUIRED', 'Choose who reviews this finding.');
      const u = (await sql<any>`select 1 as x from users u where u.tenant_id = ${T} and u.id = ${assignee} and coalesce(u.status, 'active') = 'active'`.execute(this.db)).rows[0];
      if (!u) throw err(422, 'ASSIGNEE_NOT_IN_SALON', 'That person is not an active user of this salon.');
    }
    let denied: { techId: string; status: string } | null = null;
    const out = await this.db.transaction().execute(async (trx) => {
      const cur = (await sql<any>`select r.id, r.branch_id, r.status, r.version, r.finding_type, r.technician_id, r.assigned_to_user_id, r.resolution_code, r.resolution_note, r.dismiss_reason from commission_discrepancy_reviews r where r.tenant_id = ${T} and ${this.brR(ctx)} and r.id = ${id} for update`.execute(trx)).rows[0];
      if (!cur) throw err(404, 'REVIEW_NOT_FOUND', 'That finding is not in this salon.');
      if (N(cur.version) !== expected) throw err(409, 'VERSION_CONFLICT', 'Someone else changed this finding. Reload to see the latest.', { currentVersion: N(cur.version), currentStatus: String(cur.status) });
      const from = String(cur.status) as Status; const t = TRANSITIONS[action];
      if (!t.from.includes(from)) throw err(422, 'INVALID_TRANSITION', `A ${from.toLowerCase()} finding cannot be ${action === 'note' ? 'noted' : action + 'ed'}.`, { status: from, allowed: allowedActions(from) });
      if ((action === 'resolve' || action === 'dismiss') && !canAny(ctx, ...FINANCE_MANAGER) && (await this.isOwnPayTx(trx, ctx, cur.technician_id))) {
        denied = { techId: String(cur.technician_id), status: from }; return null;
      }
      const to = t.to(from); const v = expected + 1;
      let moved: { numAffectedRows?: bigint } | null = null;   // the row is locked; 0 rows here means the machine refused the move
      if (action === 'assign') moved = await sql`update commission_discrepancy_reviews r set status = ${to}, assigned_to_user_id = ${assignee}, assigned_at = now(), version = ${v}, updated_by = ${actorOf(ctx)}::uuid, updated_at = now() where r.tenant_id = ${T} and r.id = ${id} and ${canMoveToSql(COMMISSION_DISCREPANCY_REVIEW, to, 'r')}`.execute(trx);
      else if (action === 'investigate') moved = await sql`update commission_discrepancy_reviews r set status = ${to}, investigating_at = now(), assigned_to_user_id = coalesce(r.assigned_to_user_id, ${ctx.userId ?? null}), version = ${v}, updated_by = ${actorOf(ctx)}::uuid, updated_at = now() where r.tenant_id = ${T} and r.id = ${id} and ${canMoveToSql(COMMISSION_DISCREPANCY_REVIEW, to, 'r')}`.execute(trx);
      else if (action === 'resolve') moved = await sql`update commission_discrepancy_reviews r set status = ${to}, resolution_code = ${code}, resolution_note = ${note}, resolved_at = now(), resolved_by = ${ctx.userId ?? null}, version = ${v}, updated_by = ${actorOf(ctx)}::uuid, updated_at = now() where r.tenant_id = ${T} and r.id = ${id} and ${canMoveToSql(COMMISSION_DISCREPANCY_REVIEW, to, 'r')}`.execute(trx);
      else if (action === 'dismiss') moved = await sql`update commission_discrepancy_reviews r set status = ${to}, dismiss_reason = ${note}, dismissed_at = now(), dismissed_by = ${ctx.userId ?? null}, version = ${v}, updated_by = ${actorOf(ctx)}::uuid, updated_at = now() where r.tenant_id = ${T} and r.id = ${id} and ${canMoveToSql(COMMISSION_DISCREPANCY_REVIEW, to, 'r')}`.execute(trx);
      // reopen keeps the previous resolution / dismissal columns (and their events) — the old disposition is never erased
      else if (action === 'reopen') moved = await sql`update commission_discrepancy_reviews r set status = ${to}, assigned_to_user_id = null, assigned_at = null, investigating_at = null, version = ${v}, updated_by = ${actorOf(ctx)}::uuid, updated_at = now() where r.tenant_id = ${T} and r.id = ${id} and ${canMoveToSql(COMMISSION_DISCREPANCY_REVIEW, to, 'r')}`.execute(trx);
      else await sql`update commission_discrepancy_reviews r set version = ${v}, updated_by = ${actorOf(ctx)}::uuid, updated_at = now() where r.tenant_id = ${T} and r.id = ${id}`.execute(trx);
      if (moved && moved.numAffectedRows === 0n) throw err(409, 'INVALID_STATE_TRANSITION', `A ${from.toLowerCase()} finding cannot move to ${to.toLowerCase()}.`, { status: from, allowed: allowedActions(from) });
      const meta = { ...(assignee ? { assigneeUserId: assignee, previousAssigneeUserId: cur.assigned_to_user_id ?? null } : {}), ...(code ? { resolutionCode: code } : {}), version: v,
        ...(action === 'reopen' ? { previousResolutionCode: cur.resolution_code ?? null, previousResolutionNote: cur.resolution_note ?? null, previousDismissReason: cur.dismiss_reason ?? null } : {}) };
      await sql`insert into commission_discrepancy_review_events (tenant_id, branch_id, review_id, actor_user_id, event_type, old_status, new_status, reason, safe_metadata_json, request_id)
        values (${T}, ${cur.branch_id ?? null}, ${id}, ${ctx.userId ?? null}, ${EVENT_OF[action]}, ${from}, ${to}, ${note || null}, ${JSON.stringify(meta)}::jsonb, ${requestId})`.execute(trx);
      await writeAuditRow(trx, ctx, { module: 'payroll', action: `commission.discrepancy.${action}`, resourceType: 'commission_discrepancy_review', resourceId: id, summary: `Commission finding ${from} → ${to}`,
        before: { status: from, version: expected }, after: { status: to, version: v }, reason: note || null, metadata: { findingType: String(cur.finding_type), ...meta }, requestId });
      return { id, status: to, version: v };
    });
    if (denied) {
      const d = denied as { techId: string; status: string };
      await sql`insert into commission_discrepancy_review_events (tenant_id, branch_id, review_id, actor_user_id, event_type, old_status, new_status, reason, safe_metadata_json, request_id)
        values (${T}, ${branchOf(ctx)}, ${id}, ${ctx.userId ?? null}, 'DENIED', ${d.status}, ${d.status}, ${'own pay'}, ${JSON.stringify({ attempted: action })}::jsonb, ${requestId})`.execute(this.db).catch(logGap('commission_review_denial_event_not_recorded'));
      await writeAuditRow(this.db, ctx, { module: 'payroll', action: `commission.discrepancy.${action}.denied`, resourceType: 'commission_discrepancy_review', resourceId: id, status: 'denied', severity: 'warning',
        summary: 'Denied: a reviewer cannot close a finding about their own pay', metadata: { attempted: action }, requestId }).catch(logGap('commission_review_denial_audit_not_recorded'));
      throw err(403, 'OWN_PAY', 'This finding is about your own pay. A payroll manager must resolve or dismiss it.');
    }
    return this.detail(ctx, out!.id);
  }
  private async isOwnPayTx(trx: Kysely<any>, ctx: TeamCtx, technicianId: unknown) {
    if (!technicianId || !ctx.userId) return false;
    return !!(await sql<any>`select 1 as x from technicians te where te.tenant_id = ${ctx.tenantId} and te.id = ${String(technicianId)} and te.user_id = ${ctx.userId}`.execute(trx)).rows[0];
  }
}

interface Finding {
  type: typeof FINDING_TYPES[number]; fingerprint: string; severity: 'low' | 'medium' | 'high'; severityReason: string; technicianId: string | null; serviceLineId: string | null; ticketId: string | null;
  refundId: string | null; periodRef: string | null; expected: number | null; recorded: number | null; difference: number | null; summary: string;
  verification: 'CONFIRMED' | 'POLICY_NOT_CONFIGURED' | 'REVIEW_REQUIRED'; evidence: Record<string, unknown>;
}
