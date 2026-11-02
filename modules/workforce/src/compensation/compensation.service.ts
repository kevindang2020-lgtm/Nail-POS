/**
 * compensation.service.ts — the canonical orchestrator that turns a PAID ticket into the immutable compensation
 * snapshot + tip allocations (spec §13–§16). It is read-derived and POST-payment: it reads the already-persisted
 * service-line commission snapshots and the ticket tip, runs the ONE engine, and writes the snapshot. It NEVER
 * participates in the payment capture/transaction — a snapshot failure can never void or roll back a captured payment.
 * Ports are injected so this is fully unit-tested without a database.
 */
import {
  computeTicketCompensation, COMPENSATION_ENGINE_VERSION,
} from './compensation-engine';
import { snapshotRowsFromResult, type SnapshotRow } from './compensation-snapshot.repository';
import { tipAllocationRowsFromResult, type TipAllocationRow } from './compensation-tips';
import { allocateByLargestRemainder } from './compensation-engine';
import type { TicketCompensationInput, ServiceLineInput, TicketCompensationResult } from './compensation.types';
import { buildRefundReversal, type ReversibleRow, type RefundEvent, type ReversalOptions, type AdjustmentEntry } from './compensation-adjustments';
import { commissionableBaseCents } from './commission-basis';
import type { LineAllocation } from './compensation-line-allocations';

/** A service-line row as it exists in `ticket_service_lines` today (the engine input source). */
export interface ServiceLineRow {
  id: string; service_id: string | null; technician_id: string | null;
  price_cents_snapshot: number; line_total_cents: number;
  commission_type_snapshot: string; commission_value_snapshot: number;
  supply_method_snapshot?: string; supply_value_snapshot?: number;
  category_snapshot?: string | null; is_add_on?: boolean; line_kind?: string | null;
  /** line-level discount (cents) — part of the commissionable base definition (commission-basis.ts). */
  discount_cents?: number | null;
  /** removed lines carry no commission and are excluded from the engine input. */
  removed_at?: string | Date | null;
  /** which rule priced this line (migration 587) — copied onto the snapshot so payroll can always answer "which rule". */
  policy_id?: string | null; policy_version?: number | null; rule_source?: string | null;
  /** multi-technician allocation rows (migration 587); absent/empty ⇒ technician_id at 100%. */
  allocations?: LineAllocation[];
}

export interface CompCtx { tenantId: string; branchId: string | null; }

/** Tip facts for a ticket: card vs cash from the ticket's PAYMENTS, and any explicit (customer-directed / manual)
 *  per-technician allocation already recorded in ticket_tip_allocations (the ONE tip store). */
export interface TicketMeta {
  discountCents: number; cardTipCents: number; cashTipCents: number; tipMethod?: string; manyTechTipMethod?: string;
  retailCommission?: { method: string; value: number }; paidAtIso?: string;
  directedTips?: { technicianId: string; tipCents: number }[];
}

/** Ports the service needs — implemented by Kysely repos in production, by fakes in tests. */
export interface CompensationPorts {
  loadServiceLines(ctx: CompCtx, ticketId: string): Promise<ServiceLineRow[]>;
  loadTicketMeta(ctx: CompCtx, ticketId: string): Promise<TicketMeta | null>;
  persistSnapshot(rows: SnapshotRow[]): Promise<number>;
  persistTipAllocations(rows: TipAllocationRow[]): Promise<number>;
  // §21 refund/void reversal — load a paid ticket's frozen snapshot rows, and persist the reversal ledger entries.
  // Optional so existing fakes keep compiling; reverseForRefund is a no-op when they're absent.
  loadSnapshotRows?(ctx: CompCtx, ticketId: string): Promise<ReversibleRow[]>;
  persistAdjustments?(ctx: CompCtx, rows: AdjustmentEntry[]): Promise<number>;
  // §21 closed-period routing: is the ticket's payroll period already paid (locked)? Optional; defaults to false (open).
  isTicketPeriodPaid?(ctx: CompCtx, ticketId: string): Promise<boolean>;
  /** tenant flag (tenant_settings.compensation.refundReversalReview). Optional; default false (post immediately). */
  refundReversalReview?(ctx: CompCtx): Promise<boolean>;
  /** wave 2 §54/§129: is the ticket's payroll period LOCKED (approved or paid)? If so, which period is it, and which OPEN
   *  (draft) period should the correction land in (null when none exists yet — it then lands by date). Supersedes
   *  isTicketPeriodPaid when bound. */
  lockedPeriodRouting?(ctx: CompCtx, ticketId: string): Promise<{ locked: boolean; originalPeriodId: string | null; targetPeriodId: string | null }>;
  /** wave 2 §143/§197: raise (or refresh) a financial exception — e.g. a refund against a closed period. Best-effort. */
  raiseException?(ctx: CompCtx, e: { kind: string; severity: 'blocking' | 'warning'; dedupeKey: string; ticketId?: string | null; periodId?: string | null; detail?: Record<string, unknown> }): Promise<void>;
}

/** Explicit tip instruction a caller (checkout) may pass to the snapshot. */
export interface TipOverride { method: 'customer_directed' | 'by_service_revenue' | 'by_commission_pool' | 'equal' | 'custom'; directed?: { technicianId: string; tipCents: number }[] }

/** Structured, greppable log line for the snapshot path — never silent (mandate §195–§196: a failure is a recorded,
 *  retryable fact, never a swallowed one). */
export interface SnapshotLogger { warn(msg: string, meta?: Record<string, unknown>): void; error(msg: string, meta?: Record<string, unknown>): void }

/**
 * PURE: map existing service-line rows + ticket-level discount/tip into the canonical engine input. The ticket-level
 * discount is allocated across commissionable lines proportionally by price (largest-remainder, exact cents).
 * Retail/add-on lines are flagged so retail commission stays separate (§5). Supply is read from the line snapshot (§9):
 * 'none' (the default) means 0 — Method A, product cost tracked separately and never deducted; 'fixed'/'percent' reduce
 * the commissionable base only when a tenant explicitly authored them.
 */
export function engineInputFromLines(
  ctx: CompCtx, ticketId: string, lines: ServiceLineRow[],
  meta: TicketMeta,
  policy?: { policyId?: string; policyVersion?: number; tip?: TipOverride },
): TicketCompensationInput {
  // Basis (commission-basis.ts, mandate §17–§20): line_total_cents (carries overrides + retail qty) minus any line-level
  // discount; REMOVED lines are excluded entirely. price_cents_snapshot is NOT the basis. A legacy row with a zero
  // line_total_cents (older writers left it unset) falls back to its catalogue price so nothing prices at $0 by accident.
  const live = lines.filter((l) => l.removed_at == null);
  const serviceLines = live.filter((l) => (l.line_kind ?? '') !== 'retail');
  const basis = (l: ServiceLineRow) => commissionableBaseCents({ line_total_cents: Number(l.line_total_cents) || Number(l.price_cents_snapshot) || 0, discount_cents: l.discount_cents ?? 0, removed_at: l.removed_at });
  const prices = serviceLines.map(basis);
  const discountAlloc = allocateByLargestRemainder(Math.max(0, Math.round(meta.discountCents || 0)), prices);

  // explicit allocation rows (migration 587) → the line's technicians at their bps shares; otherwise technician_id at 100%
  const techsFor = (l: ServiceLineRow) => {
    if (l.allocations && l.allocations.length) return l.allocations.map((a) => ({ technicianId: a.technicianId, method: 'percent' as const, value: a.shareBps / 100 }));
    return l.technician_id ? [{ technicianId: l.technician_id, method: 'equal' as const }] : [];
  };

  const mapped: ServiceLineInput[] = serviceLines.map((l, i) => ({
    lineId: l.id, serviceId: l.service_id ?? undefined,
    priceCents: prices[i],
    discountCents: discountAlloc[i], discountFunding: 'proportional',
    supply: (l.supply_method_snapshot && l.supply_method_snapshot !== 'none') ? { method: l.supply_method_snapshot as any, value: Number(l.supply_value_snapshot || 0) } : undefined,
    commission: { type: (l.commission_type_snapshot === 'fixed' ? 'fixed' : 'percent'), value: Number(l.commission_value_snapshot || 0), source: l.rule_source ?? 'Service-line snapshot' },
    technicians: techsFor(l),
    policyId: l.policy_id ?? policy?.policyId ?? null, policyVersion: l.policy_version ?? policy?.policyVersion ?? null, ruleSource: l.rule_source ?? null,
  }));

  // §16 retail commission: the salon's configured retail rate applies to every retail line (percent of gross or fixed per
  // item). Default 'none' ⇒ fall back to the line's own snapshot (usually 0), so retail commission is off unless configured.
  const rc = meta.retailCommission;
  const retail: ServiceLineInput[] = live.filter((l) => (l.line_kind ?? '') === 'retail').map((l) => ({
    lineId: l.id, serviceId: l.service_id ?? undefined, priceCents: basis(l),
    commission: (rc && rc.method !== 'none')
      ? { type: (rc.method === 'fixed' ? 'fixed' : 'percent') as 'fixed' | 'percent', value: rc.value }
      : { type: (l.commission_type_snapshot === 'fixed' ? 'fixed' : 'percent') as 'fixed' | 'percent', value: Number(l.commission_value_snapshot || 0) },
    technicians: l.technician_id ? [{ technicianId: l.technician_id, method: 'equal' }] : [], isRetail: true,
  }));

  const distinctTechs = new Set(mapped.flatMap((l) => l.technicians.map((t) => t.technicianId)));
  // Tip method policy (spec §10–§12). An explicit tipMethod — including a customer-directed allocation — ALWAYS wins:
  // checkout's override first, then an explicit allocation already recorded for the ticket (manual / customer-directed).
  // Otherwise: exactly two technicians → 50/50 equal (§10). Three or more → the salon's configured policy: proportional
  // by earnings by default (safe, unchanged), or equal ONLY when the salon has explicitly opted in (§11). One tech is
  // trivially 100%. The allocation math + reconciliation are identical across methods (largest-remainder).
  const directed = policy?.tip?.directed?.length ? policy.tip.directed : (meta.directedTips?.length ? meta.directedTips : undefined);
  const tipMethod = policy?.tip?.method || (directed ? 'customer_directed' : undefined) || meta.tipMethod || (
    distinctTechs.size === 2 ? 'equal'
      : distinctTechs.size > 2 && meta.manyTechTipMethod === 'equal' ? 'equal'
        : 'by_commission_pool'
  );

  return {
    tenantId: ctx.tenantId, branchId: ctx.branchId, ticketId,
    serviceLines: [...mapped, ...retail],
    tip: (meta.cardTipCents || meta.cashTipCents) ? { method: tipMethod as any, cardTipCents: meta.cardTipCents, cashTipCents: meta.cashTipCents, directed: tipMethod === 'customer_directed' || tipMethod === 'custom' ? directed : undefined } : undefined,
    policyId: policy?.policyId, policyVersion: policy?.policyVersion, engineVersion: COMPENSATION_ENGINE_VERSION,
  };
}

export class CompensationService {
  constructor(private readonly ports: CompensationPorts, private readonly logger: SnapshotLogger = { warn: (m, x) => console.warn(m, x ?? ''), error: (m, x) => console.error(m, x ?? '') }) {}

  /** Compute the canonical result for a ticket (used by previews/receipts; read-only). */
  async computeForTicket(ctx: CompCtx, ticketId: string): Promise<TicketCompensationResult | null> {
    const [lines, meta] = await Promise.all([this.ports.loadServiceLines(ctx, ticketId), this.ports.loadTicketMeta(ctx, ticketId)]);
    if (!lines.length || !meta) return null;
    return computeTicketCompensation(engineInputFromLines(ctx, ticketId, lines, meta));
  }

  /** Oct 13 2026 (FLOW duplicate D6 merged): THE commission preview for one ticket, per technician — the immutable
   *  snapshot when the ticket has one (paid), else the engine's live computation (rule → service rate → tenant default,
   *  discount basis). Screens never re-resolve a rate of their own. Null ⇒ nothing to show (no lines / no ports). */
  async previewForTicket(ctx: CompCtx, ticketId: string): Promise<{ source: 'snapshot' | 'engine'; byTechnician: { technicianId: string | null; cents: number }[] } | null> {
    const add = (m: Map<string | null, number>, k: string | null, v: number) => m.set(k, (m.get(k) ?? 0) + Math.round(v || 0));
    const out = (source: 'snapshot' | 'engine', m: Map<string | null, number>) => ({ source, byTechnician: [...m.entries()].map(([technicianId, cents]) => ({ technicianId, cents })) });
    try {
      if (this.ports.loadSnapshotRows) {
        const rows = await this.ports.loadSnapshotRows(ctx, ticketId);
        if (rows.length) { const m = new Map<string | null, number>(); for (const r of rows) add(m, r.technician_id ?? null, r.tech_service_earnings_cents + r.retail_commission_cents); return out('snapshot', m); }
      }
      const r = await this.computeForTicket(ctx, ticketId);
      if (!r) return null;
      const m = new Map<string | null, number>();
      for (const t of r.perTechnician) add(m, t.technicianId, t.serviceEarningsCents + t.retailCommissionCents);
      // a line nobody is assigned to yet still has a commission the engine computed (shown as unassigned)
      const assigned = r.perTechnician.reduce((a, t) => a + t.serviceEarningsCents + t.retailCommissionCents, 0);
      const total = r.totals.techServiceEarningsCents + r.totals.retailCommissionCents;
      if (total - assigned > 0) add(m, null, total - assigned);
      return out('engine', m);
    } catch { return null; }
  }

  /**
   * Freeze the immutable snapshot + tip allocations for a PAID ticket (§14). Idempotent; never throws into the money
   * path (the payment already succeeded) — but NEVER silent either (mandate §195–§196): every non-ok outcome is logged
   * with a stable `compensation_snapshot_failed` marker (ticket, reason) so the recovery worker / ops can retry it, and
   * the status object is returned to the caller. `policy.tip` lets checkout pass a customer-directed allocation through.
   * A ticket with no service lines (a gift-card-only sale) has nothing to snapshot — reported, not logged as a failure.
   */
  async snapshotPaidTicket(ctx: CompCtx, ticketId: string, policy?: { policyId?: string; policyVersion?: number; tip?: TipOverride }): Promise<{ ok: boolean; snapshotRows: number; tipRows: number; reconciled: boolean; error?: string }> {
    const fail = (error: string) => {
      if (error !== 'no lines/meta') this.logger.error('compensation_snapshot_failed', { tenantId: ctx.tenantId, ticketId, error });
      return { ok: false, snapshotRows: 0, tipRows: 0, reconciled: false, error };
    };
    try {
      const [lines, meta] = await Promise.all([this.ports.loadServiceLines(ctx, ticketId), this.ports.loadTicketMeta(ctx, ticketId)]);
      if (!lines.length || !meta) return fail('no lines/meta');
      const input = engineInputFromLines(ctx, ticketId, lines, meta, policy);
      const result = computeTicketCompensation(input);
      const snapRows = snapshotRowsFromResult(input, result, { tenantId: ctx.tenantId, branchId: ctx.branchId, snapshotAt: meta.paidAtIso || new Date().toISOString(), engineVersion: COMPENSATION_ENGINE_VERSION });
      const tipRows = tipAllocationRowsFromResult(input, result, { tenantId: ctx.tenantId, branchId: ctx.branchId });
      const [s, tcount] = await Promise.all([this.ports.persistSnapshot(snapRows), this.ports.persistTipAllocations(tipRows)]);
      const reconciled = result.reconciliation.splitsReconcile && result.reconciliation.tipsReconcile && result.reconciliation.salonTipIsZero;
      if (snapRows.length && s === 0) return fail('snapshot persist wrote 0 rows');
      if (!reconciled) this.logger.warn('compensation_snapshot_unreconciled', { tenantId: ctx.tenantId, ticketId, warnings: result.warnings });
      else if (result.warnings.length) this.logger.warn('compensation_snapshot_warnings', { tenantId: ctx.tenantId, ticketId, warnings: result.warnings });
      return { ok: true, snapshotRows: s, tipRows: tcount, reconciled };
    } catch (e: any) {
      return fail(e?.message || String(e));
    }
  }

  /**
   * §21 — reverse a paid ticket's technician attribution on refund/void. Loads the FROZEN snapshot rows (never rewrites
   * them), builds signed reversal ledger entries with the canonical engine, and persists them to compensation_adjustments
   * (idempotent per refund payment — migration 588). Best-effort and NON-THROWING: a reversal failure must never break
   * the already-processed refund, but it is logged. Entries post immediately unless the tenant opted into review or the
   * original period is already paid (then 'pending', targeting a future period) — never a rewrite of the closed period.
   */
  async reverseForRefund(ctx: CompCtx, ticketId: string, event: RefundEvent, opts: ReversalOptions): Promise<{ ok: boolean; entries: number; error?: string }> {
    try {
      if (!this.ports.loadSnapshotRows || !this.ports.persistAdjustments) return { ok: false, entries: 0, error: 'reversal not wired' };
      const rows = await this.ports.loadSnapshotRows(ctx, ticketId);
      if (!rows.length) { this.logger.warn('compensation_reversal_skipped', { tenantId: ctx.tenantId, ticketId, reason: 'no snapshot to reverse' }); return { ok: false, entries: 0, error: 'no snapshot to reverse' }; }
      // §9/§21: if the original payroll period is already paid (locked), the reversal targets a FUTURE period instead of
      // rewriting the locked one. Detected best-effort; defaults to the open-period path.
      let priorPeriodPaid = false; let routing: { locked: boolean; originalPeriodId: string | null; targetPeriodId: string | null } | null = null;
      if (this.ports.lockedPeriodRouting) {
        // fail CLOSED on the routing read: an unknown period state is treated as locked (the entry waits for review)
        routing = await this.ports.lockedPeriodRouting(ctx, ticketId).catch(() => ({ locked: true, originalPeriodId: null, targetPeriodId: null }));
        priorPeriodPaid = routing.locked;
      } else if (this.ports.isTicketPeriodPaid) {
        priorPeriodPaid = await this.ports.isTicketPeriodPaid(ctx, ticketId).catch(() => false);
      }
      // Entries POST immediately (counted in period earnings) unless the tenant opted into review — a refund is a fact,
      // not a request (mandate §51: refunds create reversals). A paid prior period still forces 'pending' (future-period
      // routing needs a manager's eyes).
      const review = opts.requireApproval ?? (this.ports.refundReversalReview ? await this.ports.refundReversalReview(ctx).catch(() => false) : false);
      const entries = buildRefundReversal(ticketId, rows, event, { ...opts, requireApproval: review, priorPeriodPaid,
        targetPeriodId: routing?.locked ? routing.targetPeriodId : null, originalPeriodId: routing?.locked ? routing.originalPeriodId : null });
      const n = await this.ports.persistAdjustments(ctx, entries);
      // §143/§197: a refund against a closed period is an owner-visible exception (the entries wait in the review queue)
      if (priorPeriodPaid && n > 0 && this.ports.raiseException) {
        await this.ports.raiseException(ctx, { kind: 'refund_closed_period', severity: 'warning', dedupeKey: `${ticketId}:${event.refundPaymentId ?? event.type}`, ticketId,
          periodId: routing?.originalPeriodId ?? null, detail: { entries: n, targetPeriodId: routing?.targetPeriodId ?? null } }).catch(() => undefined);
      }
      return { ok: true, entries: n };
    } catch (e: any) {
      this.logger.error('compensation_reversal_failed', { tenantId: ctx.tenantId, ticketId, error: e?.message || String(e) });
      return { ok: false, entries: 0, error: e?.message || String(e) };
    }
  }
}
