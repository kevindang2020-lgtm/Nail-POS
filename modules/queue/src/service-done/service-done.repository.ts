// service-done.repository.ts — persistence port + in-memory adapter for POS Service Done.
// Tenant-scoped completed-service tickets with quality + checkout workflow state. A different tenant sees its own
// (empty) data — isolation. send-to-checkout is idempotent (a retry never duplicates a checkout ticket).
import {
  Money, POSServiceDoneFullState, POSServiceDoneTicketRow, POSServiceDoneTicketDetail, POSServiceDoneKpisFull,
  ServiceDoneFilters, QualityStatus, CheckoutStatus, ServiceDoneStatus, QualityChecklist, ServiceLine,
  ServiceDoneWorkflowSettings, DEFAULT_SERVICE_DONE_SETTINGS, subtotalFromLines, addOnRevenueFromTickets,
  buildServiceMix, buildAddOnMix, buildTechPerformance, completionAccuracyPercent,
} from './service-done.dto';
import { clampPageSize, clampPage, foldVi } from '@aipowersalon/api-contracts';

export interface ServiceDoneContext { tenantId: string; branchId: string; userId: string; role: string; permissions: string[]; }

export interface SDTicket {
  ticketId: string; ticketNumber: string; customerId: string; customerName: string; customerPhone?: string; isVip: boolean; station?: string;
  lines: ServiceLine[]; primaryTechId?: string; primaryTechName?: string; helperTechId?: string; helperTechName?: string;
  startedAt?: string; completedAt: string; durationMinutes: number; checklist: QualityChecklist; qualityStatus: QualityStatus;
  notes: string; customerVisibleNotes: string; customerNotifiedAt: string | null; checkoutStatus: CheckoutStatus; status: ServiceDoneStatus;
  paid: boolean; sentIdempotencyKey?: string; updatedAt: string; serviceDoneLocked?: boolean;
  version?: number; tipCents?: Money;
}
export interface TechRec { technicianId: string; name: string; }

export interface ServiceDoneRepositoryPort {
  /** Constitution 8: true when the repository writes domain events in its transactions. */
  emitsDomainEvents?(): boolean;
  settings(ctx: ServiceDoneContext): Promise<ServiceDoneWorkflowSettings>;
  query(ctx: ServiceDoneContext, f: ServiceDoneFilters): Promise<POSServiceDoneFullState>;
  ticket(ctx: ServiceDoneContext, id: string): Promise<SDTicket | null>;
  detail(ctx: ServiceDoneContext, id: string): Promise<POSServiceDoneTicketDetail | null>;
  /** returns 'conflict' when expectedVersion is given and the ticket moved on (§108) */
  setQuality(ctx: ServiceDoneContext, id: string, status: QualityStatus, checklist?: Partial<QualityChecklist>, expectedVersion?: number): Promise<boolean | 'conflict'>;
  setNotes(ctx: ServiceDoneContext, id: string, notes?: string, customerVisibleNotes?: string): Promise<boolean>;
  technicians(ctx: ServiceDoneContext): Promise<TechRec[]>;
  assignTechnician(ctx: ServiceDoneContext, id: string, technicianId: string): Promise<boolean>;
  assignHelper(ctx: ServiceDoneContext, id: string, technicianId: string | null): Promise<boolean>;
  setCheckoutStatus(ctx: ServiceDoneContext, id: string, cs: CheckoutStatus, st: ServiceDoneStatus): Promise<boolean>;
  /** Reconcile the P5 formal Service Done lock when reopening from the Service Done board: clears the lock columns and
   *  records a single `service_done_reopened` revision (only when a lock was actually set), so this path and the serving
   *  reopen path converge to the same state + timeline. */
  clearServiceDoneLockOnReopen(ctx: ServiceDoneContext, id: string, opts: { reason: string; byUserId?: string }): Promise<void>;
  markNotified(ctx: ServiceDoneContext, id: string): Promise<void>;
  setStatus(ctx: ServiceDoneContext, id: string, st: ServiceDoneStatus): Promise<boolean>;
  getSendKey(ctx: ServiceDoneContext, id: string): Promise<string | undefined>;
  setSendKey(ctx: ServiceDoneContext, id: string, key: string): Promise<void>;
  /**
   * Service Done mandate §32–§37, §99–§100, §107, §110: THE checkout handoff, as ONE atomic compare-and-set. The ticket
   * moves to `target` only if — at the instant of the write — it is still completed (not reopened, not paid), not already
   * at/after the target, and the readiness rule holds (quality approved / notes present when the salon requires them).
   * Two stations tapping at once: exactly one gets 'moved'; the other gets 'already' (idempotent success). The
   * ticket.ready_for_checkout outbox fact is written ONLY with a real transition. Never swallows a database error.
   */
  transitionToCheckout(ctx: ServiceDoneContext, id: string, input: CheckoutTransitionInput): Promise<CheckoutTransitionResult>;
}
export interface CheckoutTransitionInput { target: 'ready_for_checkout' | 'sent_to_checkout'; idempotencyKey?: string; requireApproved: boolean; requireNotes: boolean }
export type CheckoutTransitionResult =
  | { outcome: 'moved'; idempotencyKey?: string }
  | { outcome: 'already'; idempotencyKey?: string }
  | { outcome: 'paid' } | { outcome: 'not_found' }
  | { outcome: 'blocked'; reason: 'QUALITY_NOT_APPROVED' | 'NOTES_REQUIRED' | 'REOPENED' | 'NOT_COMPLETED' };
/** The pure readiness decision both repositories apply inside their atomic write (so the rule has one definition). */
export function checkoutTransitionDecision(t: { paid: boolean; status: ServiceDoneStatus; checkoutStatus: CheckoutStatus; qualityStatus: QualityStatus; notes?: string }, input: CheckoutTransitionInput): CheckoutTransitionResult | null {
  if (t.paid) return { outcome: 'paid' };
  if (t.status === 'reopened' || t.checkoutStatus === 'reopened') return { outcome: 'blocked', reason: 'REOPENED' };
  if (t.checkoutStatus === 'sent_to_checkout') return { outcome: 'already' };
  if (input.target === 'ready_for_checkout' && t.checkoutStatus === 'ready_for_checkout') return { outcome: 'already' };
  if (input.requireApproved && t.qualityStatus !== 'approved') return { outcome: 'blocked', reason: 'QUALITY_NOT_APPROVED' };
  if (input.requireNotes && !(t.notes || '').trim()) return { outcome: 'blocked', reason: 'NOTES_REQUIRED' };
  return null;   // the move may happen
}

const now = () => new Date().toISOString();
const minsAgo = (m: number) => new Date(Date.now() - m * 60000).toISOString();

export class InMemoryServiceDoneRepository implements ServiceDoneRepositoryPort {
  private store = new Map<string, SDTicket[]>();
  private techs = new Map<string, TechRec[]>();

  private ensure(tenantId: string) {
    if (this.store.has(tenantId)) return;
    if (tenantId !== 'luxe001') { this.store.set(tenantId, []); this.techs.set(tenantId, []); return; }
    const chk = (over: Partial<QualityChecklist> = {}): QualityChecklist => ({ allServicesCompleted: true, customerReady: true, servicesReviewed: false, noOpenIssues: true, notesCompleted: false, ...over });
    const mk = (id: string, num: string, cust: string, phone: string, vip: boolean, station: string, lines: ServiceLine[], primId: string, primName: string, helperId: string | undefined, helperName: string | undefined, dur: number, q: QualityStatus, cs: CheckoutStatus, st: ServiceDoneStatus, over: Partial<SDTicket> = {}): SDTicket => ({
      ticketId: id, ticketNumber: num, customerId: 'c_' + id, customerName: cust, customerPhone: phone, isVip: vip, station,
      lines, primaryTechId: primId, primaryTechName: primName, helperTechId: helperId, helperTechName: helperName,
      startedAt: minsAgo(dur + 5), completedAt: minsAgo(5), durationMinutes: dur, checklist: chk(q === 'approved' ? { servicesReviewed: true } : {}),
      qualityStatus: q, notes: '', customerVisibleNotes: '', customerNotifiedAt: null, checkoutStatus: cs, status: st, paid: false, updatedAt: now(), ...over,
    });
    this.techs.set(tenantId, [{ technicianId: 'tech_mia', name: 'Mia' }, { technicianId: 'tech_ava', name: 'Ava' }, { technicianId: 'tech_leo', name: 'Leo' }]);
    this.store.set(tenantId, [
      mk('sd_3001', '#2041', 'Grace Kim', '+18565550101', true, 'Station 3', [{ serviceLineId: 'l1', serviceName: 'Signature Manicure', category: 'Manicure', technicianName: 'Mia', priceCents: 5500 }, { serviceLineId: 'l2', serviceName: 'Gel Add-on', category: 'Add-on', technicianName: 'Mia', priceCents: 1500, isAddOn: true }], 'tech_mia', 'Mia', undefined, undefined, 45, 'pending', 'not_ready', 'completed'),
      mk('sd_3002', '#2042', 'Nora Patel', '+18565550102', false, 'Station 1', [{ serviceLineId: 'l3', serviceName: 'Spa Pedicure', category: 'Pedicure', technicianName: 'Ava', priceCents: 6500 }], 'tech_ava', 'Ava', 'tech_leo', 'Leo', 55, 'approved', 'not_ready', 'completed'),
      mk('sd_3003', '#2043', 'Liv Chen', '+18565550103', false, 'Station 2', [{ serviceLineId: 'l4', serviceName: 'Full Set Acrylic', category: 'Enhancement', technicianName: 'Leo', priceCents: 9000 }, { serviceLineId: 'l5', serviceName: 'Nail Art', category: 'Add-on', technicianName: 'Leo', priceCents: 2000, isAddOn: true }], 'tech_leo', 'Leo', undefined, undefined, 70, 'approved', 'ready_for_checkout', 'ready_for_checkout'),
      mk('sd_3004', '#2044', 'Ivy Park', '+18565550104', false, 'Station 4', [{ serviceLineId: 'l6', serviceName: 'Classic Manicure', category: 'Manicure', technicianName: 'Mia', priceCents: 3500 }], 'tech_mia', 'Mia', undefined, undefined, 30, 'issue_found', 'not_ready', 'completed', { checklist: chk({ noOpenIssues: false }) }),
      mk('sd_3005', '#2040', 'Mia Wong', '+18565550105', false, 'Station 1', [{ serviceLineId: 'l7', serviceName: 'Dip Powder', category: 'Enhancement', technicianName: 'Ava', priceCents: 6000 }], 'tech_ava', 'Ava', undefined, undefined, 50, 'approved', 'sent_to_checkout', 'sent_to_checkout', { sentIdempotencyKey: 'sd_3005:send_to_checkout:6465' }),
    ]);
  }
  private L(ctx: ServiceDoneContext) { this.ensure(ctx.tenantId); return this.store.get(ctx.tenantId)!; }
  private _ticket(ctx: ServiceDoneContext, id: string) { return this.L(ctx).find((t) => t.ticketId === id) || null; }
  async ticket(ctx: ServiceDoneContext, id: string) { return this._ticket(ctx, id); }
  private _settings() { return DEFAULT_SERVICE_DONE_SETTINGS; }
  async settings(_ctx: ServiceDoneContext) { return this._settings(); }

  private subtotal(t: SDTicket) { return subtotalFromLines(t.lines); }
  private daysSince0(iso: string) { return iso.slice(0, 10) === new Date().toISOString().slice(0, 10); }

  private toRow(ctx: ServiceDoneContext, t: SDTicket): POSServiceDoneTicketRow {
    const sub = this.subtotal(t);
    return {
      ticketId: t.ticketId, ticketNumber: t.ticketNumber, tenantId: ctx.tenantId, branchId: ctx.branchId, customerId: t.customerId, customerName: t.customerName,
      customerPhone: t.customerPhone, isVip: t.isVip, station: t.station, serviceCount: t.lines.length, serviceNames: t.lines.map((l) => l.serviceName),
      primaryTechnicianId: t.primaryTechId, primaryTechnicianName: t.primaryTechName, helperTechnicianId: t.helperTechId, helperTechnicianName: t.helperTechName,
      startedAt: t.startedAt, completedAt: t.completedAt, durationMinutes: t.durationMinutes, subtotalCents: sub, estimatedCommissionCents: null,
      qualityStatus: t.qualityStatus, checkoutStatus: t.checkoutStatus, customerNotifiedAt: t.customerNotifiedAt, notes: t.notes, status: t.status,
    };
  }

  private filtered(ctx: ServiceDoneContext, f: ServiceDoneFilters): SDTicket[] {
    let rows = this.L(ctx).slice();
    if (f.search) { const q = foldVi(f.search);   /* accent-insensitive (Vietnamese POS §41) */ rows = rows.filter((t) => [t.ticketNumber, t.customerName, t.customerPhone, t.primaryTechName, t.station, ...t.lines.map((l) => l.serviceName)].some((x) => foldVi(x).includes(q))); }
    if (f.status) rows = rows.filter((t) => t.status === f.status);
    if (f.qualityStatus) rows = rows.filter((t) => t.qualityStatus === f.qualityStatus);
    if (f.checkoutStatus) rows = rows.filter((t) => t.checkoutStatus === f.checkoutStatus);
    if (f.technicianId) rows = rows.filter((t) => t.primaryTechId === f.technicianId || t.helperTechId === f.technicianId);
    if (f.serviceCategory) rows = rows.filter((t) => t.lines.some((l) => l.category === f.serviceCategory));
    if (f.station) rows = rows.filter((t) => t.station === f.station);
    return rows;
  }

  async query(ctx: ServiceDoneContext, f: ServiceDoneFilters) {
    const all = this.L(ctx);
    const matched = this.filtered(ctx, f);
    const page = clampPage(f.page), pageSize = clampPageSize(f.pageSize, 20);
    const totalItems = matched.length, totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const pageRows = matched.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize).map((t) => this.toRow(ctx, t));

    const durations = all.map((t) => t.durationMinutes).filter((d) => d > 0);
    const salesReady = all.filter((t) => t.status !== 'sent_to_checkout');
    const kpis: POSServiceDoneKpisFull = {
      completedServicesToday: all.filter((t) => this.daysSince0(t.completedAt)).length,
      ticketsReadyForReview: all.filter((t) => t.qualityStatus === 'pending' || t.qualityStatus === 'needs_review').length,
      ticketsReadyForCheckout: all.filter((t) => t.checkoutStatus === 'ready_for_checkout').length,
      qualityIssuesCount: all.filter((t) => t.qualityStatus === 'issue_found').length,
      reopenedServicesToday: all.filter((t) => t.status === 'reopened').length,
      averageServiceDurationMinutes: durations.length ? Math.round(durations.reduce((a, d) => a + d, 0) / durations.length) : 0,
      estimatedSalesCents: salesReady.reduce((a, t) => a + this.subtotal(t), 0),
      estimatedCommissionCents: null,
      addOnRevenueCents: addOnRevenueFromTickets(all),
      averageTurnaroundSeconds: 0,
      customerSatisfactionAvg: null, customerSatisfactionCount: 0,
      tipsCapturedCents: 0,
      rebookingRatePercent: null, rebookingEligible: 0,
      completionAccuracyPercent: completionAccuracyPercent(all.filter((t) => this.daysSince0(t.completedAt)).length, all.filter((t) => this.daysSince0(t.completedAt) && t.qualityStatus === 'issue_found').length),
    };

    const completedToday = all.filter((t) => this.daysSince0(t.completedAt));
    const analytics = {
      completionTrend: [] as { hour: number; count: number }[],
      serviceMix: buildServiceMix(completedToday), addOnMix: buildAddOnMix(completedToday),
      funnel: { completed: kpis.completedServicesToday, inReview: kpis.ticketsReadyForReview, readyForCheckout: kpis.ticketsReadyForCheckout, sentToFrontDesk: all.filter((t) => t.status === 'sent_to_checkout').length },
      potentialRevenue: (() => { const serviceCents = salesReady.reduce((a, t) => a + this.subtotal({ ...t, lines: t.lines.filter((l) => !l.isAddOn) }), 0); const addOnCents = addOnRevenueFromTickets(salesReady); return { serviceCents, addOnCents, tipsEstCents: 0, taxesEstCents: 0, totalCents: serviceCents + addOnCents }; })(),
      completionTrendDeltaPercent: null, potentialRevenueDeltaPercent: null,
    };
    const techPerformance = buildTechPerformance(completedToday.map((t) => ({ primaryTechId: t.primaryTechId, primaryTechName: t.primaryTechName, lines: t.lines, durationMinutes: t.durationMinutes, tipCents: 0 })));

    return {
      kpis, analytics, techPerformance, staff: [], staffSummary: { onDuty: 0, available: 0, finishing: 0, busy: 0, onBreak: 0, shown: 0, roster: 0 }, insights: [], tickets: { items: pageRows, pagination: { page, pageSize, totalItems, totalPages } },
      filters: {
        statuses: ['completed', 'ready_for_checkout', 'sent_to_checkout', 'reopened'],
        technicians: [...new Set(all.map((t) => t.primaryTechName || ''))].filter(Boolean),
        serviceCategories: [...new Set(all.flatMap((t) => t.lines.map((l) => l.category || '')))].filter(Boolean),
        qualityStatuses: ['pending', 'approved', 'issue_found', 'needs_review'], stations: [...new Set(all.map((t) => t.station || ''))].filter(Boolean),
      },
      workflowSettings: this._settings(),
    };
  }

  async detail(ctx: ServiceDoneContext, id: string) {
    const t = this._ticket(ctx, id); if (!t) return null; const sub = this.subtotal(t);
    return {
      ticketId: t.ticketId, ticketNumber: t.ticketNumber, customer: { customerId: t.customerId, fullName: t.customerName, phone: t.customerPhone, isVip: t.isVip },
      station: t.station, services: t.lines, primaryTechnician: t.primaryTechId ? { technicianId: t.primaryTechId, name: t.primaryTechName! } : undefined,
      helperTechnician: t.helperTechId ? { technicianId: t.helperTechId, name: t.helperTechName! } : null, startedAt: t.startedAt, completedAt: t.completedAt, durationMinutes: t.durationMinutes,
      qualityChecklist: t.checklist, qualityStatus: t.qualityStatus, notes: t.notes, customerVisibleNotes: t.customerVisibleNotes, customerNotifiedAt: t.customerNotifiedAt,
      subtotalCents: sub, estimatedCommissionCents: null, checkoutStatus: t.checkoutStatus, status: t.status, serviceDoneLocked: !!t.serviceDoneLocked,
      auditSummary: [{ lastAction: 'updated', lastActorRole: ctx.role, lastAt: t.updatedAt }],
    };
  }

  async setQuality(ctx: ServiceDoneContext, id: string, status: QualityStatus, checklist?: Partial<QualityChecklist>, expectedVersion?: number): Promise<boolean | 'conflict'> { const t = this._ticket(ctx, id); if (!t) return false; if (expectedVersion != null && (t.version ?? 1) !== expectedVersion) return 'conflict'; t.qualityStatus = status; if (checklist) t.checklist = { ...t.checklist, ...checklist }; t.version = (t.version ?? 1) + 1; t.updatedAt = now(); return true; }
  async setNotes(ctx: ServiceDoneContext, id: string, notes?: string, customerVisibleNotes?: string) { const t = this._ticket(ctx, id); if (!t) return false; if (notes != null) { t.notes = notes; t.checklist.notesCompleted = !!notes.trim(); } if (customerVisibleNotes != null) t.customerVisibleNotes = customerVisibleNotes; t.updatedAt = now(); return true; }
  private _technicians(ctx: ServiceDoneContext) { this.ensure(ctx.tenantId); return (this.techs.get(ctx.tenantId) || []).slice(); }
  async technicians(ctx: ServiceDoneContext) { return this._technicians(ctx); }
  async assignTechnician(ctx: ServiceDoneContext, id: string, technicianId: string) { const t = this._ticket(ctx, id); const tech = this._technicians(ctx).find((x) => x.technicianId === technicianId); if (!t || !tech) return false; t.primaryTechId = tech.technicianId; t.primaryTechName = tech.name; t.updatedAt = now(); return true; }
  async assignHelper(ctx: ServiceDoneContext, id: string, technicianId: string | null) { const t = this._ticket(ctx, id); if (!t) return false; if (technicianId === null) { t.helperTechId = undefined; t.helperTechName = undefined; } else { const tech = this._technicians(ctx).find((x) => x.technicianId === technicianId); if (!tech) return false; t.helperTechId = tech.technicianId; t.helperTechName = tech.name; } t.updatedAt = now(); return true; }
  async setCheckoutStatus(ctx: ServiceDoneContext, id: string, cs: CheckoutStatus, st: ServiceDoneStatus) { const t = this._ticket(ctx, id); if (!t) return false; t.checkoutStatus = cs; t.status = st; t.updatedAt = now(); return true; }
  /** Test-visible record of reopen reconciliations (the kysely impl clears columns + writes a revision). */
  public reopenLockClears: Array<{ id: string; reason: string; byUserId?: string }> = [];
  async clearServiceDoneLockOnReopen(_ctx: ServiceDoneContext, id: string, opts: { reason: string; byUserId?: string }) { this.reopenLockClears.push({ id, reason: opts.reason, byUserId: opts.byUserId }); }
  async markNotified(ctx: ServiceDoneContext, id: string) { const t = this._ticket(ctx, id); if (t) { t.customerNotifiedAt = now(); t.updatedAt = now(); } }
  async setStatus(ctx: ServiceDoneContext, id: string, st: ServiceDoneStatus) { const t = this._ticket(ctx, id); if (!t) return false; t.status = st; t.updatedAt = now(); return true; }
  /** Test-visible: every ticket.ready_for_checkout fact the in-memory adapter "wrote" (the Kysely one writes the outbox). */
  public readyFacts: Array<{ ticketId: string; checkoutStatus: CheckoutStatus }> = [];
  // No await between the read and the write: under concurrent calls (Promise.all) exactly one sees the old state.
  async transitionToCheckout(ctx: ServiceDoneContext, id: string, input: CheckoutTransitionInput): Promise<CheckoutTransitionResult> {
    const t = this._ticket(ctx, id); if (!t) return { outcome: 'not_found' };
    const d = checkoutTransitionDecision(t, input);
    if (d) return d.outcome === 'already' ? { outcome: 'already', idempotencyKey: t.sentIdempotencyKey } : d;
    t.checkoutStatus = input.target; t.status = input.target; if (input.idempotencyKey) t.sentIdempotencyKey = input.idempotencyKey;
    t.version = (t.version ?? 1) + 1; t.updatedAt = now();
    this.readyFacts.push({ ticketId: id, checkoutStatus: input.target });
    return { outcome: 'moved', idempotencyKey: input.idempotencyKey };
  }
  async getSendKey(ctx: ServiceDoneContext, id: string) { return this._ticket(ctx, id)?.sentIdempotencyKey; }
  async setSendKey(ctx: ServiceDoneContext, id: string, key: string) { const t = this._ticket(ctx, id); if (t) t.sentIdempotencyKey = key; }
}
