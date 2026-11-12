// serving.repository.ts — persistence port + in-memory adapter for POS Serving.
// Tenant-scoped active-service tickets with a SERVER-TRUTH timer (started/paused/accumulated paused) so the
// elapsed time survives a refresh and never drifts. A different tenant sees its own (empty) data — isolation.
// send-to-service-done is idempotent (a retry never duplicates a service-done ticket).
import {
  Money, POSServingFullState, POSServingTicketRow, POSServingTicketDetailFull, POSServingKpisFull, ServingFilters,
  ServingTicketStatus, DelayStatus, ServingDetailServiceLine, ServiceLineStatus, ServingWorkflowSettings,
  DEFAULT_SERVING_SETTINGS, Pagination, ServiceOption, TechnicianOption, computeElapsedMinutes, deriveDelayStatus,
  subtotalFromServingLines,
  buildServingServiceMix, buildServingAddOnMix, buildServingTechPerformance, servingStageLabel,
  servingTechnicianLoad, buildServingInsights, FINISHING_SOON_FRACTION, ServingStaffRow, ServingInsight,
} from './serving.dto';
import { capReadyStaff } from '../service-done/service-done.dto';
import { clampPageSize, clampPage } from '@aipowersalon/api-contracts';

export interface ServingContext { tenantId: string; branchId: string; userId: string; role: string; permissions: string[]; }

export interface ChangeRequestInsert {
  ticketId: string; lineId?: string | null; requestType: 'add_service' | 'change_service' | 'remove_line' | 'price_change' | 'notes_change';
  oldValue?: unknown; newValue?: unknown; reason?: string | null; requestedByUserId?: string | null; requestedByTechnicianId?: string | null;
}
export interface ChangeRequestRow extends ChangeRequestInsert {
  id: string; status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'applied';
  approvedByUserId?: string | null; approvedAt?: string | null; rejectedByUserId?: string | null; rejectedAt?: string | null; createdAt: string;
}

/** A retail line: a product, a quantity, and the price snapshot taken at the moment of sale. `technicianId` is
 *  who gets credit — retail commission is configured salon-wide and applied by the compensation engine, which
 *  already treats line_kind==='retail' separately from service lines. */
export interface RetailLineIn { serviceLineId: string; productId: string; productName: string; unitPriceCents: Money; quantity: number; technicianId?: string; }

export interface SVLine { serviceLineId: string; serviceId: string; serviceName: string; category?: string; priceCents: Money; technicianId?: string; technicianName?: string; status: ServiceLineStatus; isAddOn?: boolean; estDurationMin: number; }

// Pure aggregate: add-on attach rate (% of tickets carrying >=1 add-on line) and total add-on revenue.
// Shared by both repositories so the KPI contract is identical and unit-testable.
// §50: the opportunity population is every visit on the floor (one visit = one opportunity); null with no visit — never a
// decorative 0 %. §51: revenue counts ADD-ON lines once each (base services and retail are not upsell revenue).
export function computeServingAddOnMetrics(tickets: { lines: SVLine[] }[]): { addOnAttachRatePercent: number | null; addOnRevenueCents: number } {
  let ticketsWithAddOn = 0; let addOnRevenueCents = 0;
  for (const t of tickets) {
    const addOns = (t.lines || []).filter((l) => l.isAddOn);
    if (addOns.length > 0) ticketsWithAddOn++;
    for (const l of addOns) addOnRevenueCents += l.priceCents || 0;
  }
  const total = tickets.length;
  return { addOnAttachRatePercent: total > 0 ? Math.round((ticketsWithAddOn / total) * 100) : null, addOnRevenueCents };
}
/** Serving mandate §17 / §59–§62 / §109 — the floor projection BOTH adapters build from the same loaded facts: stage counts
 *  over every matched ticket (not the visible page), line-owner-aware technician load, the capped Available / Finishing
 *  panel with counts for everyone on duty, and the advisory insights. Pure; exported for tests. */
export function buildFloorProjection(all: SVTicket[], elapsedOf: (t: SVTicket) => number, staffRows: ServingStaffRow[], roster: number,
  /** Extras Serving 04: minutes until each technician's next booked appointment today (technicianId → minutes); absent → no conflict check */
  nextBookingMinutes?: Record<string, number>) {
  const LIVE = ['in_service', 'paused', 'delayed'];
  const active = all.filter((t) => LIVE.includes(t.status));
  const finishing = (t: SVTicket) => t.estimatedDurationMinutes > 0 && elapsedOf(t) >= t.estimatedDurationMinutes * FINISHING_SOON_FRACTION;
  const stageCounts = {
    readyToStart: all.filter((t) => t.status === 'not_started').length,
    inService: active.filter((t) => t.status === 'in_service' && !finishing(t)).length,
    finishing: active.filter((t) => t.status === 'in_service' && finishing(t)).length,   // a delayed / paused guest is counted in its own bucket, once
    ready: all.filter((t) => t.status === 'completed' || t.status === 'sent_to_service_done').length,
    paused: all.filter((t) => t.status === 'paused').length,
    delayed: all.filter((t) => t.status === 'delayed').length,
  };
  const load = servingTechnicianLoad(all);
  const busyTechs = new Set(Object.keys(load).filter((k) => load[k] > 0));
  for (const t of active) if (t.primaryTechId) busyTechs.add(t.primaryTechId);
  // §59–§61: the authoritative technician status wins; the load column is the technician's OWN open lines
  const rows = staffRows.map((r) => ({ ...r, currentLoad: r.technicianId ? (load[r.technicianId] ?? 0) : r.currentLoad }));
  const { staff, staffSummary } = capReadyStaff(rows, roster);
  const freeTechnicians = rows.filter((r) => r.status === 'Available' && r.technicianId && !load[r.technicianId]).length;
  const notStarted = all.filter((t) => t.status === 'not_started');
  const busyTechWaiting = notStarted.filter((t) => !t.primaryTechId || busyTechs.has(t.primaryTechId)).length;
  let overloaded: { name: string; open: number } | null = null;
  for (const [tid, n] of Object.entries(load)) if (!overloaded || n > overloaded.open) { const nm = rows.find((r) => r.technicianId === tid)?.name ?? all.find((t) => t.primaryTechId === tid)?.primaryTechName ?? all.flatMap((t) => t.lines).find((l) => l.technicianId === tid)?.technicianName; if (nm) overloaded = { name: nm, open: n }; }
  // Extras Serving 04: a live service expected to run past the same technician's next booking today (the estimate is
  // the ticket's own; a ticket without one is never guessed). One entry per technician, the biggest overrun first.
  const conflicts = new Map<string, { name: string; minutesUntilBooking: number; remainingMinutes: number }>();
  if (nextBookingMinutes) for (const t of active) {
    const tid = t.primaryTechId; if (!tid || !(t.estimatedDurationMinutes > 0)) continue;
    const until = nextBookingMinutes[tid]; if (until == null) continue;
    const remaining = Math.max(0, t.estimatedDurationMinutes - elapsedOf(t));
    if (remaining <= until) continue;
    const prev = conflicts.get(tid);
    if (!prev || remaining - until > prev.remainingMinutes - prev.minutesUntilBooking) conflicts.set(tid, { name: t.primaryTechName || rows.find((r) => r.technicianId === tid)?.name || 'Technician', minutesUntilBooking: until, remainingMinutes: remaining });
  }
  const bookingConflicts = [...conflicts.values()].sort((a, b) => (b.remainingMinutes - b.minutesUntilBooking) - (a.remainingMinutes - a.minutesUntilBooking));
  const insights: ServingInsight[] = buildServingInsights({ bookingConflicts,
    active: active.map((t) => ({ customerName: t.customerName, customerId: t.customerId || undefined, isVip: t.isVip, elapsed: elapsedOf(t), est: t.estimatedDurationMinutes })),
    waitingToStart: notStarted.length, busyTechWaiting, readyForServiceDone: stageCounts.ready, overloaded, freeTechnicians,
  });
  // §52–§53 Potential Revenue in Progress — projected, NOT settled: the floor's real line amounts by where the visit is.
  // Each line counts once: base services of active visits split In Service / Finishing Soon, their add-on lines are
  // Add-Ons Pending, and a visit at Service Done counts all its lines as Ready to Complete (its add-ons included — they
  // were dropped before). Retail lines are not service revenue in progress.
  const isReady = (t: SVTicket) => t.status === 'completed' || t.status === 'sent_to_service_done';
  const svcLines = (t: SVTicket) => t.lines.filter((l) => !!l.serviceId);
  const sum = (ls: SVLine[]) => ls.reduce((a, l) => a + (l.priceCents || 0), 0);
  const inServiceCents = active.filter((t) => !finishing(t)).reduce((a, t) => a + sum(svcLines(t).filter((l) => !l.isAddOn)), 0);
  const finishingSoonCents = active.filter(finishing).reduce((a, t) => a + sum(svcLines(t).filter((l) => !l.isAddOn)), 0);
  const addOnsPendingCents = active.reduce((a, t) => a + sum(svcLines(t).filter((l) => l.isAddOn)), 0);
  const readyToCompleteCents = all.filter(isReady).reduce((a, t) => a + sum(svcLines(t)), 0);
  const potentialRevenue = { inServiceCents, addOnsPendingCents, finishingSoonCents, readyToCompleteCents, totalCents: inServiceCents + addOnsPendingCents + finishingSoonCents + readyToCompleteCents };
  return { stageCounts, staff, staffSummary, insights, techniciansInService: busyTechs.size, readyToStart: stageCounts.readyToStart, potentialRevenue };
}

export interface SVTicket {
  ticketId: string; ticketNumber: string; customerId: string; customerName: string; customerPhone?: string; avatarUrl?: string | null; isVip: boolean; loyaltyTier?: string; station?: string;
  lines: SVLine[]; primaryTechId?: string; primaryTechName?: string; helperTechId?: string; helperTechName?: string;
  startedAtMs: number | null; pausedAtMs: number | null; accumulatedPausedMs: number; estimatedDurationMinutes: number;
  status: ServingTicketStatus; delayStatus: DelayStatus; delayReason?: string; notes: string; customerVisibleNotes: string;
  sentIdempotencyKey?: string; updatedAt: string; version?: number;
  serviceDoneLockedAt?: string; serviceDoneLockedBy?: string; serviceDoneLockedTotal?: number;
}
export interface RevisionInput { action: string; serviceLineId?: string | null; actorUserId?: string | null; actorRole?: string | null; before?: any; after?: any; summary?: string | null; }
export interface RevisionRecord extends RevisionInput { version: number; createdAt: string; }
interface TechRec { technicianId: string; name: string; available: boolean; }

export interface ServingRepositoryPort {
  /** Constitution 8: true when the repository writes domain events in its transactions — the service then leaves realtime to the projection consumer. */
  emitsDomainEvents?(): boolean;
  settings(ctx: ServingContext): Promise<ServingWorkflowSettings>;
  /** §26 platform kill switch for the tech live-edit feature (tenant_app_flags). */
  techEditFeatureEnabled(ctx: ServingContext): Promise<boolean>;
  /** Raw tickets.status (accepted|serving|service_done|checkout|paid|cancelled|voided...) for the §6 edit gate. */
  rawTicketStatus(ctx: ServingContext, ticketId: string): Promise<string | null>;
  insertChangeRequest(ctx: ServingContext, row: ChangeRequestInsert): Promise<string>;
  insertTechNotification(ctx: ServingContext, n: { technicianId: string; type: string; title: string; body?: string | null; reference?: string | null }): Promise<void>;
  listChangeRequests(ctx: ServingContext, filter: { ticketId?: string; status?: string }): Promise<ChangeRequestRow[]>;
  updateChangeRequest(ctx: ServingContext, id: string, patch: Partial<Pick<ChangeRequestRow, 'status' | 'approvedByUserId' | 'approvedAt' | 'rejectedByUserId' | 'rejectedAt'>>): Promise<ChangeRequestRow | null>;
  query(ctx: ServingContext, f: ServingFilters): Promise<POSServingFullState>;
  ticket(ctx: ServingContext, id: string): Promise<SVTicket | null>;
  detail(ctx: ServingContext, id: string): Promise<POSServingTicketDetailFull | null>;
  services(ctx: ServingContext): Promise<ServiceOption[]>;
  technicians(ctx: ServingContext): Promise<TechnicianOption[]>;
  /** 'duplicate' — another station's start won the compare-and-set (Serving mandate §101) */
  start(ctx: ServingContext, id: string): Promise<boolean | 'duplicate'>;
  pause(ctx: ServingContext, id: string): Promise<boolean>;
  resume(ctx: ServingContext, id: string): Promise<boolean>;
  setNotes(ctx: ServingContext, id: string, notes?: string, customerVisibleNotes?: string): Promise<boolean>;
  /** 'duplicate' — a line with this id is already on the ticket (the same logical add-on submitted twice, §103) */
  addService(ctx: ServingContext, id: string, line: SVLine): Promise<boolean | 'duplicate'>;
  /** Serving mandate §72: a customer-app feed notice (customer_notifications) — the communications path Send Update uses. */
  insertCustomerNotification?(ctx: ServingContext, n: { customerId: string; type: string; title: string; body?: string | null; reference?: string | null }): Promise<void>;
  /** Retail: look up a sellable product in this tenant's catalog (active + is_retail + priced). Null when it is
   *  not sellable, so the service layer can say WHY instead of writing a line for something with no price. */
  retailProduct(ctx: ServingContext, productId: string): Promise<{ productId: string; name: string; retailPriceCents: number; allowNegativeStock: boolean; onHand: number } | null>;
  /** Retail: the sellable catalog for the product picker — same sellability rule as retailProduct. */
  retailCatalog(ctx: ServingContext, search?: string): Promise<{ productId: string; name: string; retailPriceCents: number }[]>;
  /** Retail: write ONE retail line onto a ticket (line_kind='retail', product_id set, service_id null). */
  addRetailLine(ctx: ServingContext, ticketId: string, line: RetailLineIn): Promise<boolean>;
  editService(ctx: ServingContext, id: string, lineId: string, patch: Partial<SVLine>): Promise<boolean>;
  removeService(ctx: ServingContext, id: string, lineId: string): Promise<boolean>;
  assignTechnician(ctx: ServingContext, id: string, technicianId: string): Promise<boolean>;
  assignHelper(ctx: ServingContext, id: string, technicianId: string | null): Promise<boolean>;
  setStatus(ctx: ServingContext, id: string, st: ServingTicketStatus): Promise<boolean>;
  setDelay(ctx: ServingContext, id: string, ds: DelayStatus, reason?: string): Promise<boolean>;
  getSendKey(ctx: ServingContext, id: string): Promise<string | undefined>;
  setSendKey(ctx: ServingContext, id: string, key: string): Promise<void>;
  serviceCatalog(ctx: ServingContext, serviceId: string): Promise<ServiceOption | null>;
  /** Optimistic-concurrency version + append-only in-service edit timeline (epic Req §5/§9). */
  getTicketVersion(ctx: ServingContext, id: string): Promise<number>;
  appendRevision(ctx: ServingContext, id: string, rev: RevisionInput): Promise<number>;
  listRevisions(ctx: ServingContext, id: string): Promise<RevisionRecord[]>;
  /** Service Done formal lock (epic Req §5): set on send, cleared on reopen. */
  lockServiceDone(ctx: ServingContext, id: string, byUserId: string, lockedTotalCents: number): Promise<void>;
  reopenServiceDone(ctx: ServingContext, id: string): Promise<void>;
  serviceDoneLock(ctx: ServingContext, id: string): Promise<{ lockedAt: string; lockedByUserId: string | null; lockedTotalCents: number | null } | null>;
  /** THE Service Done transition (service-done/service-done-transition.ts) — Postgres adapters implement it; the
   *  in-memory adapter leaves it undefined and the service falls back to its status-flip path. */
  completeServiceDone?(ctx: ServingContext, id: string, opts: { lock: boolean; source: 'tech_app' | 'serving_mark_done' | 'serving_send' | 'pos'; technicianId?: string | null; notes?: string | null }): Promise<{ ticketId: string; duplicate: boolean; idempotencyKey: string; subtotalCents: number; locked: boolean } | { error: 'TICKET_NOT_FOUND' | 'INVALID_STATUS' | 'NOT_ASSIGNED'; message: string }>;
  /** One-active-service-per-technician read (migration 586). Undefined on the in-memory adapter. */
  technicianActiveSession?(ctx: ServingContext, technicianId: string): Promise<{ ticketId: string; status: string } | null>;
}

const now = () => new Date().toISOString();

export class InMemoryServingRepository implements ServingRepositoryPort {
  private store = new Map<string, SVTicket[]>();
  private techs = new Map<string, TechRec[]>();
  private catalog = new Map<string, ServiceOption[]>();
  private revisions = new Map<string, RevisionRecord[]>();
  private seq = 6000;

  private ensure(tenantId: string) {
    if (this.store.has(tenantId)) return;
    if (tenantId !== 'luxe001') { this.store.set(tenantId, []); this.techs.set(tenantId, []); this.catalog.set(tenantId, []); return; }
    const mAgo = (m: number) => Date.now() - m * 60000;
    const line = (lid: string, sid: string, name: string, cat: string, price: number, techName: string, dur: number, addOn = false): SVLine => ({ serviceLineId: lid, serviceId: sid, serviceName: name, category: cat, priceCents: price, technicianName: techName, status: 'serving', isAddOn: addOn, estDurationMin: dur });
    const mk = (id: string, num: string, cust: string, phone: string, vip: boolean, station: string, lines: SVLine[], primId: string, primName: string, helperId: string | undefined, helperName: string | undefined, estDur: number, startedMinAgo: number | null, pausedMinAgo: number | null, status: ServingTicketStatus, over: Partial<SVTicket> = {}): SVTicket => ({
      ticketId: id, ticketNumber: num, customerId: 'c_' + id, customerName: cust, customerPhone: phone, isVip: vip, loyaltyTier: vip ? 'VIP Gold' : 'Regular', station,
      lines, primaryTechId: primId, primaryTechName: primName, helperTechId: helperId, helperTechName: helperName,
      startedAtMs: startedMinAgo == null ? null : mAgo(startedMinAgo), pausedAtMs: pausedMinAgo == null ? null : mAgo(pausedMinAgo), accumulatedPausedMs: 0, estimatedDurationMinutes: estDur,
      status, delayStatus: 'none', notes: '', customerVisibleNotes: '', updatedAt: now(), ...over,
    });
    this.techs.set(tenantId, [{ technicianId: 'tech_mia', name: 'Mia', available: true }, { technicianId: 'tech_ava', name: 'Ava', available: true }, { technicianId: 'tech_leo', name: 'Leo', available: false }]);
    this.catalog.set(tenantId, [
      { serviceId: 'svc_mani', name: 'Signature Manicure', priceCents: 5500, categoryName: 'Manicure', durationMinutes: 45 },
      { serviceId: 'svc_pedi', name: 'Spa Pedicure', priceCents: 6500, categoryName: 'Pedicure', durationMinutes: 55 },
      { serviceId: 'svc_gel', name: 'Gel Add-on', priceCents: 1500, categoryName: 'Add-on', durationMinutes: 15 },
      { serviceId: 'svc_art', name: 'Nail Art', priceCents: 2000, categoryName: 'Add-on', durationMinutes: 20 },
    ]);
    this.store.set(tenantId, [
      mk('sv_4001', '#3041', 'Grace Kim', '+18565550101', true, 'Station 3', [line('l1', 'svc_mani', 'Signature Manicure', 'Manicure', 5500, 'Mia', 45), line('l2', 'svc_gel', 'Gel Add-on', 'Add-on', 1500, 'Mia', 15, true)], 'tech_mia', 'Mia', undefined, undefined, 45, 20, null, 'in_service'),
      mk('sv_4002', '#3042', 'Nora Patel', '+18565550102', false, 'Station 1', [line('l3', 'svc_pedi', 'Spa Pedicure', 'Pedicure', 6500, 'Ava', 55)], 'tech_ava', 'Ava', 'tech_leo', 'Leo', 55, 30, 5, 'paused', { accumulatedPausedMs: 0 }),
      mk('sv_4003', '#3043', 'Liv Chen', '+18565550103', false, 'Station 2', [line('l4', 'svc_mani', 'Signature Manicure', 'Manicure', 5500, 'Leo', 45)], 'tech_leo', 'Leo', undefined, undefined, 45, null, null, 'not_started'),
      mk('sv_4004', '#3044', 'Ivy Park', '+18565550104', false, 'Station 4', [line('l5', 'svc_pedi', 'Spa Pedicure', 'Pedicure', 6500, 'Mia', 30)], 'tech_mia', 'Mia', undefined, undefined, 30, 60, null, 'delayed', { delayStatus: 'late', delayReason: 'Add-on requested mid-service' }),
      mk('sv_4005', '#3045', 'Mia Wong', '+18565550105', false, 'Station 1', [line('l6', 'svc_mani', 'Signature Manicure', 'Manicure', 5500, 'Ava', 45)], 'tech_ava', 'Ava', undefined, undefined, 45, 40, null, 'in_service'),
    ]);
  }
  private L(ctx: ServingContext) { this.ensure(ctx.tenantId); return this.store.get(ctx.tenantId)!; }
  private _ticket(ctx: ServingContext, id: string) { return this.L(ctx).find((t) => t.ticketId === id) || null; }
  async ticket(ctx: ServingContext, id: string) { return this._ticket(ctx, id); }
  private _settings() { return DEFAULT_SERVING_SETTINGS; }
  async settings(_ctx: ServingContext) { return this._settings(); }

  private _changeRequests: (ChangeRequestRow & { tenantId: string })[] = [];
  /** test hook for the §26 kill switch */
  techEditFlag = true;
  async techEditFeatureEnabled(_ctx: ServingContext) { return this.techEditFlag; }
  async rawTicketStatus(ctx: ServingContext, ticketId: string) {
    this.ensure(ctx.tenantId);
    const t = (this.store.get(ctx.tenantId) || []).find((x) => x.ticketId === ticketId);
    if (!t) return null;
    return t.status === 'completed' || t.status === 'sent_to_service_done' ? 'service_done' : t.status === 'not_started' ? 'accepted' : 'serving';
  }
  techNotifications: { technicianId: string; type: string; title: string; body?: string | null; reference?: string | null }[] = [];
  async insertTechNotification(_ctx: ServingContext, n: { technicianId: string; type: string; title: string; body?: string | null; reference?: string | null }) { this.techNotifications.push(n); }

  async insertChangeRequest(ctx: ServingContext, row: ChangeRequestInsert) {
    const id = 'tcr_' + (this._changeRequests.length + 1);
    this._changeRequests.push({ ...row, id, status: 'pending', createdAt: new Date().toISOString(), tenantId: ctx.tenantId });
    return id;
  }
  async listChangeRequests(ctx: ServingContext, f: { ticketId?: string; status?: string }) {
    return this._changeRequests.filter((r) => r.tenantId === ctx.tenantId && (!f.ticketId || r.ticketId === f.ticketId) && (!f.status || r.status === f.status)).map(({ tenantId: _t, ...r }) => r);
  }
  async updateChangeRequest(ctx: ServingContext, id: string, patch: any) {
    const r = this._changeRequests.find((x) => x.tenantId === ctx.tenantId && x.id === id);
    if (!r) return null;
    Object.assign(r, patch);
    const { tenantId: _t, ...out } = r; return out;
  }
  private _services(ctx: ServingContext) { this.ensure(ctx.tenantId); return (this.catalog.get(ctx.tenantId) || []).map((s) => ({ ...s })); }
  async services(ctx: ServingContext) { return this._services(ctx); }
  async serviceCatalog(ctx: ServingContext, serviceId: string) { return this._services(ctx).find((s) => s.serviceId === serviceId) || null; }
  private _technicians(ctx: ServingContext) { this.ensure(ctx.tenantId); return (this.techs.get(ctx.tenantId) || []).map((t) => ({ technicianId: t.technicianId, name: t.name, role: 'Technician', available: t.available })); }
  async technicians(ctx: ServingContext) { return this._technicians(ctx); }

  private elapsed(t: SVTicket) { return computeElapsedMinutes({ startedAtMs: t.startedAtMs, pausedAtMs: t.pausedAtMs, accumulatedPausedMs: t.accumulatedPausedMs, nowMs: Date.now() }); }
  private subtotal(t: SVTicket) { return subtotalFromServingLines(t.lines); }
  private estEnd(t: SVTicket): string | null { return t.startedAtMs ? new Date(t.startedAtMs + t.accumulatedPausedMs + t.estimatedDurationMinutes * 60000).toISOString() : null; }
  private syncDelay(t: SVTicket) { if (t.status === 'delayed') return; const ds = deriveDelayStatus(this.elapsed(t), t.estimatedDurationMinutes, this._settings().delayAlertMinutes); t.delayStatus = ds; }

  private toRow(ctx: ServingContext, t: SVTicket): POSServingTicketRow {
    this.syncDelay(t); const sub = this.subtotal(t); const el = this.elapsed(t);
    return {
      ticketId: t.ticketId, ticketNumber: t.ticketNumber, tenantId: ctx.tenantId, branchId: ctx.branchId, customerId: t.customerId, customerName: t.customerName,
      customerPhone: t.customerPhone, isVip: t.isVip, station: t.station, serviceCount: t.lines.length, serviceNames: t.lines.map((l) => l.serviceName), stage: servingStageLabel(t.status, el, t.estimatedDurationMinutes), addOnsLabel: t.lines.filter((l) => l.isAddOn).map((l) => l.serviceName).join(", ") || undefined,
      primaryTechnicianId: t.primaryTechId, primaryTechnicianName: t.primaryTechName, helperTechnicianId: t.helperTechId, helperTechnicianName: t.helperTechName,
      startedAt: t.startedAtMs ? new Date(t.startedAtMs).toISOString() : undefined, pausedAt: t.pausedAtMs ? new Date(t.pausedAtMs).toISOString() : null, estimatedEndAt: this.estEnd(t),
      elapsedMinutes: el, estimatedDurationMinutes: t.estimatedDurationMinutes, subtotalCents: sub, estimatedCommissionCents: null,
      status: t.status, delayStatus: t.delayStatus, notes: t.notes,
      technicianNames: [...new Set([t.primaryTechName, ...t.lines.map((l) => l.technicianName)].filter((x): x is string => !!x))],
    };
  }

  private filtered(ctx: ServingContext, f: ServingFilters): SVTicket[] {
    let rows = this.L(ctx).slice();
    if (f.search) { const q = f.search.toLowerCase(); rows = rows.filter((t) => [t.ticketNumber, t.customerName, t.customerPhone, t.primaryTechName, t.station, ...t.lines.map((l) => l.serviceName)].some((x) => (x || '').toLowerCase().includes(q))); }
    if (f.status) rows = rows.filter((t) => t.status === f.status);
    if (f.technicianId) rows = rows.filter((t) => t.primaryTechId === f.technicianId || t.helperTechId === f.technicianId);
    if (f.serviceCategory) rows = rows.filter((t) => t.lines.some((l) => l.category === f.serviceCategory));
    if (f.station) rows = rows.filter((t) => t.station === f.station);
    if (f.delayStatus) { rows.forEach((t) => this.syncDelay(t)); rows = rows.filter((t) => t.delayStatus === f.delayStatus); }
    return rows;
  }

  async query(ctx: ServingContext, f: ServingFilters) {
    const all = this.L(ctx); all.forEach((t) => this.syncDelay(t));
    const matched = this.filtered(ctx, f);
    const page = clampPage(f.page), pageSize = clampPageSize(f.pageSize, 20);
    const totalItems = matched.length, totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const pageRows = matched.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize).map((t) => this.toRow(ctx, t));
    const pagination: Pagination = { page, pageSize, totalItems, totalPages };

    const active = all.filter((t) => ['in_service', 'paused', 'delayed'].includes(t.status));
    const durations = active.map((t) => this.elapsed(t)).filter((d) => d > 0);
    const techs = this.techs.get(ctx.tenantId) || [];
    const load = servingTechnicianLoad(all);
    const staffRows: ServingStaffRow[] = techs.map((r) => ({ technicianId: r.technicianId, name: r.name, status: (load[r.technicianId] || active.some((t) => t.primaryTechId === r.technicianId)) ? 'Busy' : r.available ? 'Available' : 'Break', nextAvailable: r.available ? 'Now' : '—' }));
    const floor = buildFloorProjection(all, (t) => this.elapsed(t), staffRows, techs.length);
    const kpis: POSServingKpisFull = {
      servingNow: all.filter((t) => t.status === 'in_service').length,
      activeTickets: active.length,
      delayedServices: all.filter((t) => t.status === 'delayed' || t.delayStatus === 'late' || t.delayStatus === 'critical').length,
      nearingCompletion: active.filter((t) => t.estimatedDurationMinutes > 0 && this.elapsed(t) >= t.estimatedDurationMinutes * FINISHING_SOON_FRACTION).length,
      averageServiceDurationMinutes: durations.length ? Math.round(durations.reduce((a, d) => a + d, 0) / durations.length) : null,
      totalInServiceSalesCents: active.reduce((a, t) => a + this.subtotal(t), 0),
      techniciansInService: floor.techniciansInService,
      servicesCompletedToday: all.filter((t) => t.status === 'completed' || t.status === 'sent_to_service_done').length,
      ...computeServingAddOnMetrics(all.filter((t) => t.status !== 'not_started')),
      customerSatisfactionAvg: null,    // §85: the in-memory adapter has no ratings — never a fabricated score
      onTimeCompletionPercent: null,
      techniciansTotal: techs.length,
      techniciansOnDuty: techs.length,
      readyToStart: floor.readyToStart,
    };
    const activeMix = active.map((t) => ({ lines: t.lines.map((l) => ({ serviceId: l.serviceId, serviceName: l.serviceName, category: l.category, isAddOn: l.isAddOn, priceCents: l.priceCents })) }));
    const startedCount = all.filter((t) => t.startedAtMs || t.status !== 'not_started').length;
    const analytics = {
      serviceTimeTrend: [] as { hour: number; minutes: number }[],
      serviceMix: buildServingServiceMix(activeMix), addOnMix: buildServingAddOnMix(activeMix),
      funnel: { started: startedCount, finishing: kpis.nearingCompletion, serviceDone: kpis.servicesCompletedToday, completionRatePercent: startedCount > 0 ? Math.round((kpis.servicesCompletedToday / startedCount) * 1000) / 10 : 0 },
      potentialRevenue: floor.potentialRevenue,
      potentialRevenueDeltaPercent: null,
    };
    const techPerformance = buildServingTechPerformance(active.map((t) => ({ primaryTechId: t.primaryTechId, primaryTechName: t.primaryTechName, lines: t.lines, elapsedMinutes: this.elapsed(t) })));

    return {
      kpis, analytics, techPerformance, staff: floor.staff, staffSummary: floor.staffSummary, insights: floor.insights, stageCounts: floor.stageCounts, tickets: { items: pageRows, pagination },
      filters: {
        statuses: ['not_started', 'in_service', 'paused', 'delayed', 'completed', 'sent_to_service_done'],
        technicians: [...new Set(all.map((t) => t.primaryTechName || ''))].filter(Boolean),
        serviceCategories: [...new Set(all.flatMap((t) => t.lines.map((l) => l.category || '')))].filter(Boolean),
        stations: [...new Set(all.map((t) => t.station || ''))].filter(Boolean), delayStatuses: ['none', 'warning', 'late', 'critical'],
      },
      workflowSettings: this._settings(),
    };
  }

  async detail(ctx: ServingContext, id: string) {
    const t = this._ticket(ctx, id); if (!t) return null; this.syncDelay(t); const sub = this.subtotal(t);
    return {
      ticketId: t.ticketId, ticketNumber: t.ticketNumber, customer: { customerId: t.customerId, fullName: t.customerName, phone: t.customerPhone, isVip: t.isVip, loyaltyTier: t.loyaltyTier },
      station: t.station, services: t.lines.map((l) => ({ serviceLineId: l.serviceLineId, serviceId: l.serviceId, serviceName: l.serviceName, category: l.category, priceCents: l.priceCents, technicianId: l.technicianId, technicianName: l.technicianName, status: l.status, isAddOn: l.isAddOn })),
      primaryTechnician: t.primaryTechId ? { technicianId: t.primaryTechId, name: t.primaryTechName! } : undefined, helperTechnician: t.helperTechId ? { technicianId: t.helperTechId, name: t.helperTechName! } : null,
      startedAt: t.startedAtMs ? new Date(t.startedAtMs).toISOString() : undefined, pausedAt: t.pausedAtMs ? new Date(t.pausedAtMs).toISOString() : null, estimatedEndAt: this.estEnd(t),
      elapsedMinutes: this.elapsed(t), estimatedDurationMinutes: t.estimatedDurationMinutes, delayStatus: t.delayStatus, delayReason: t.delayReason, notes: t.notes, customerVisibleNotes: t.customerVisibleNotes,
      subtotalCents: sub, estimatedCommissionCents: null, status: t.status,
      auditSummary: [{ lastAction: 'updated', lastActorRole: ctx.role, lastAt: t.updatedAt }],
    };
  }

  async start(ctx: ServingContext, id: string) { const t = this._ticket(ctx, id); if (!t || !['not_started', 'paused'].includes(t.status)) return false; if (!t.startedAtMs) t.startedAtMs = Date.now(); if (t.pausedAtMs) { t.accumulatedPausedMs += Date.now() - t.pausedAtMs; t.pausedAtMs = null; } t.status = 'in_service'; t.updatedAt = now(); return true; }
  async pause(ctx: ServingContext, id: string) { const t = this._ticket(ctx, id); if (!t || t.status !== 'in_service') return false; t.pausedAtMs = Date.now(); t.status = 'paused'; t.updatedAt = now(); return true; }
  async resume(ctx: ServingContext, id: string) { const t = this._ticket(ctx, id); if (!t || t.status !== 'paused') return false; if (t.pausedAtMs) { t.accumulatedPausedMs += Date.now() - t.pausedAtMs; t.pausedAtMs = null; } t.status = 'in_service'; t.updatedAt = now(); return true; }
  async setNotes(ctx: ServingContext, id: string, notes?: string, customerVisibleNotes?: string) { const t = this._ticket(ctx, id); if (!t) return false; if (notes != null) t.notes = notes; if (customerVisibleNotes != null) t.customerVisibleNotes = customerVisibleNotes; t.updatedAt = now(); return true; }
  async addService(ctx: ServingContext, id: string, lineIn: SVLine): Promise<boolean | 'duplicate'> { const t = this._ticket(ctx, id); if (!t) return false; if (t.lines.some((l) => l.serviceLineId === lineIn.serviceLineId)) return 'duplicate'; t.lines.push(lineIn); t.estimatedDurationMinutes += lineIn.estDurationMin; t.updatedAt = now(); return true; }
  customerNotifications: { tenantId: string; customerId: string; type: string; title: string; body?: string | null; reference?: string | null }[] = [];
  async insertCustomerNotification(ctx: ServingContext, n: { customerId: string; type: string; title: string; body?: string | null; reference?: string | null }) { this.customerNotifications.push({ tenantId: ctx.tenantId, ...n }); }
  // In-memory retail seed for tests; seed with repo.retailProducts.set(id, {...}).
  public retailProducts = new Map<string, { productId: string; name: string; retailPriceCents: number; allowNegativeStock: boolean; onHand: number }>();
  async retailProduct(_ctx: ServingContext, productId: string) { return this.retailProducts.get(productId) ?? null; }
  async retailCatalog(_ctx: ServingContext, search?: string) {
    const all = [...this.retailProducts.values()];
    const q = (search || '').trim().toLowerCase();
    return q ? all.filter((p) => p.name.toLowerCase().includes(q)) : all;
  }
  async addRetailLine(ctx: ServingContext, ticketId: string, line: RetailLineIn) {
    const t = this._ticket(ctx, ticketId); if (!t) return false;
    // A retail line carries NO duration — selling a bottle of polish must not extend the appointment estimate.
    t.lines.push({ serviceLineId: line.serviceLineId, serviceId: '', serviceName: line.productName, priceCents: line.unitPriceCents * line.quantity, technicianId: line.technicianId, status: 'done', isAddOn: false, estDurationMin: 0 } as SVLine);
    t.updatedAt = now(); return true;
  }
  async editService(ctx: ServingContext, id: string, lineId: string, patch: Partial<SVLine> & { notes?: string }) { const t = this._ticket(ctx, id); if (!t) return false; const l = t.lines.find((x) => x.serviceLineId === lineId); if (!l) return false; if (patch.priceCents != null) l.priceCents = patch.priceCents; if (patch.technicianId != null) l.technicianId = patch.technicianId; if (patch.status != null) l.status = patch.status; if (patch.serviceId != null) l.serviceId = patch.serviceId; if (patch.serviceName != null) l.serviceName = patch.serviceName; if (patch.category !== undefined) l.category = patch.category; if (patch.isAddOn !== undefined) l.isAddOn = patch.isAddOn; if (patch.estDurationMin != null) l.estDurationMin = patch.estDurationMin; if (patch.notes !== undefined) (l as any).notes = patch.notes; t.updatedAt = now(); return true; }
  async removeService(ctx: ServingContext, id: string, lineId: string) { const t = this._ticket(ctx, id); if (!t) return false; const before = t.lines.length; t.lines = t.lines.filter((x) => x.serviceLineId !== lineId); t.updatedAt = now(); return t.lines.length < before; }
  async assignTechnician(ctx: ServingContext, id: string, technicianId: string) { const t = this._ticket(ctx, id); const tech = this._technicians(ctx).find((x) => x.technicianId === technicianId); if (!t || !tech) return false; t.primaryTechId = tech.technicianId; t.primaryTechName = tech.name; t.updatedAt = now(); return true; }
  async assignHelper(ctx: ServingContext, id: string, technicianId: string | null) { const t = this._ticket(ctx, id); if (!t) return false; if (technicianId === null) { t.helperTechId = undefined; t.helperTechName = undefined; } else { const tech = this._technicians(ctx).find((x) => x.technicianId === technicianId); if (!tech) return false; t.helperTechId = tech.technicianId; t.helperTechName = tech.name; } t.updatedAt = now(); return true; }
  /** compare-and-set like the Postgres transition: a ticket already completed / sent is not completed again (false) */
  async setStatus(ctx: ServingContext, id: string, st: ServingTicketStatus) { const t = this._ticket(ctx, id); if (!t) return false; if (st === 'completed' && (t.status === 'completed' || t.status === 'sent_to_service_done')) return false; if (st === 'sent_to_service_done' && t.status === 'sent_to_service_done') return false; t.status = st; t.updatedAt = now(); return true; }
  async setDelay(ctx: ServingContext, id: string, ds: DelayStatus, reason?: string) { const t = this._ticket(ctx, id); if (!t) return false; t.delayStatus = ds; t.delayReason = reason; if (ds === 'none') { if (t.status === 'delayed') t.status = 'in_service'; } else { t.status = 'delayed'; } t.updatedAt = now(); return true; }
  async getSendKey(ctx: ServingContext, id: string) { return this._ticket(ctx, id)?.sentIdempotencyKey; }
  async setSendKey(ctx: ServingContext, id: string, key: string) { const t = this._ticket(ctx, id); if (t) t.sentIdempotencyKey = key; }
  async getTicketVersion(ctx: ServingContext, id: string) { return this._ticket(ctx, id)?.version ?? 0; }
  async appendRevision(ctx: ServingContext, id: string, rev: RevisionInput) {
    const t = this._ticket(ctx, id); if (!t) return 0;
    t.version = (t.version ?? 0) + 1;
    const arr = this.revisions.get(id) ?? []; arr.push({ ...rev, version: t.version, createdAt: now() }); this.revisions.set(id, arr);
    return t.version;
  }
  async listRevisions(ctx: ServingContext, id: string) { return (this.revisions.get(id) ?? []).slice(); }
  async lockServiceDone(ctx: ServingContext, id: string, byUserId: string, lockedTotalCents: number) { const t = this._ticket(ctx, id); if (t) { t.serviceDoneLockedAt = now(); t.serviceDoneLockedBy = byUserId; t.serviceDoneLockedTotal = lockedTotalCents; } }
  async reopenServiceDone(ctx: ServingContext, id: string) { const t = this._ticket(ctx, id); if (t) { t.serviceDoneLockedAt = undefined; t.serviceDoneLockedBy = undefined; t.serviceDoneLockedTotal = undefined; t.status = 'in_service'; t.updatedAt = now(); } }
  async serviceDoneLock(ctx: ServingContext, id: string) { const t = this._ticket(ctx, id); return t?.serviceDoneLockedAt ? { lockedAt: t.serviceDoneLockedAt, lockedByUserId: t.serviceDoneLockedBy ?? null, lockedTotalCents: t.serviceDoneLockedTotal ?? null } : null; }
}
