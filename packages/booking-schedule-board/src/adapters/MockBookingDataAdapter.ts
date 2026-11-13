/**
 * Mock adapter = an in-memory *authoritative backend* for isolated development
 * and tests (spec §2, §21, §22, §24, §37). It deliberately behaves like the real
 * server will after merge:
 *
 *  - every mutation runs inside a serialized "transaction" and re-validates
 *    overlap / eligibility / protection against committed state, so two
 *    stations racing for the same opening get exactly one success and one
 *    APPOINTMENT_CONFLICT;
 *  - idempotency keys de-duplicate repeated submissions;
 *  - appointment versions enforce optimistic concurrency on move/cancel;
 *  - tenant/branch scope is checked on every call and never leaks;
 *  - every committed change is published as a realtime event.
 *
 * It must never be shipped in a production build (MERGE-CHECKLIST step 11).
 */
import {
  buildDayContext,
  computeGaps,
  daySummary,
  gapsToAvailability,
  requiredDuration,
  slotFits,
} from '../domain/availability';
import { BookingDomainError } from '../domain/bookingErrors';
import { evaluateEligibility, failureToErrorCode } from '../domain/eligibility';
import { bestMatches, collapseOpenings, findOpenings, type SearchContext } from '../domain/openings';
import type {
  Appointment,
  BookingPolicy,
  BranchHours,
  ID,
  ISODate,
  OpeningResult,
  ScheduleRange,
  ScheduleSegment,
  Service,
  ServiceAddOn,
  Technician,
  TechnicianDay,
  TechnicianMatch,
  Unsubscribe,
} from '../domain/scheduleTypes';
import { dateOf, hhmmToMinutes, minuteOfDay, toISO } from '../domain/time';
import { LocalRealtimeBus, type ScheduleEvent, type ScheduleEventEnvelope } from '../realtime/events';
import type {
  BookingDataAdapter,
  CancelAppointmentInput,
  CreateAppointmentInput,
  CreateBlockedTimeInput,
  CreateWalkInInput,
  FindOpeningsInput,
  GetAvailabilityInput,
  GetBestMatchesInput,
  GetScheduleRangeInput,
  GetServicesInput,
  GetTechnicianDayInput,
  MoveAppointmentInput,
  ScopeInput,
  SubscribeScheduleInput,
} from './BookingDataAdapter';

export interface MockBranch {
  tenantId: ID;
  branchId: ID;
  timezone: string;
  branchHours: BranchHours;
  policy?: BookingPolicy;
}

export interface MockStoreData {
  branches: MockBranch[];
  technicians: Technician[];
  services: Service[];
  addOns: ServiceAddOn[];
  appointments: Appointment[];
  segments: ScheduleSegment[];
  /** Fair Turn queue per branch: ordered technician ids, index 0 = next up. */
  fairTurn: Record<string, ID[]>;
}

export interface MockAdapterOptions {
  /** Simulated network latency in ms (0 in tests). */
  latencyMs?: number;
  /** Actor used for createdBy audit fields. */
  userId?: ID;
  /** Fixed "now" for lead-time policy; defaults to the real clock. */
  now?: () => Date;
  bus?: LocalRealtimeBus;
}

export interface AuditEntry {
  at: string;
  tenantId: ID;
  branchId: ID;
  actorUserId: ID;
  action: string;
  entityId: ID;
  previous?: unknown;
  next?: unknown;
}

const branchKey = (s: ScopeInput) => `${s.tenantId}::${s.branchId}`;

export class MockBookingDataAdapter implements BookingDataAdapter {
  readonly bus: LocalRealtimeBus;
  readonly audit: AuditEntry[] = [];
  private data: MockStoreData;
  private readonly opts: Required<Pick<MockAdapterOptions, 'latencyMs' | 'userId' | 'now'>>;
  private versions = new Map<string, number>();
  private idempotency = new Map<string, Appointment | ScheduleSegment>();
  private chain: Promise<unknown> = Promise.resolve();
  private seq = 0;
  /** Counters for tests / diagnostics. */
  readonly stats = { scheduleRangeCalls: 0, mutations: 0 };

  constructor(data: MockStoreData, opts: MockAdapterOptions = {}) {
    this.data = structuredClone(data);
    this.bus = opts.bus ?? new LocalRealtimeBus();
    this.opts = { latencyMs: opts.latencyMs ?? 0, userId: opts.userId ?? 'user-mock', now: opts.now ?? (() => new Date()) };
  }

  // ---------------------------------------------------------------- helpers

  private async delay(): Promise<void> {
    if (this.opts.latencyMs > 0) await new Promise((r) => setTimeout(r, this.opts.latencyMs));
  }

  /** Serialize mutations: this is the stand-in for a DB transaction + row locks. */
  private transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private branch(scope: ScopeInput): MockBranch {
    const b = this.data.branches.find((x) => x.tenantId === scope.tenantId && x.branchId === scope.branchId);
    // Unknown tenant/branch is indistinguishable from "not yours" — never leak existence.
    if (!b) throw new BookingDomainError('PERMISSION_DENIED');
    return b;
  }

  private version(scope: ScopeInput): number {
    return this.versions.get(branchKey(scope)) ?? 1;
  }

  private bump(scope: ScopeInput): number {
    const v = this.version(scope) + 1;
    this.versions.set(branchKey(scope), v);
    return v;
  }

  private techsIn(scope: ScopeInput): Technician[] {
    return this.data.technicians
      .filter((t) => t.tenantId === scope.tenantId && t.branchId === scope.branchId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName));
  }

  private servicesIn(scope: ScopeInput, includeInactive = false): Service[] {
    return this.data.services.filter(
      (s) => s.tenantId === scope.tenantId && (includeInactive || s.active) && (!s.branchIds?.length || s.branchIds.includes(scope.branchId)),
    );
  }

  private apptsOn(scope: ScopeInput, date: ISODate, tz: string): Appointment[] {
    return this.data.appointments.filter(
      (a) => a.tenantId === scope.tenantId && a.branchId === scope.branchId && dateOf(a.startAt, tz) === date,
    );
  }

  private segmentsOn(scope: ScopeInput, date: ISODate, tz: string): ScheduleSegment[] {
    return this.data.segments.filter(
      (s) => s.tenantId === scope.tenantId && s.branchId === scope.branchId && (dateOf(s.startAt, tz) === date || dateOf(s.endAt, tz) === date),
    );
  }

  private searchContext(scope: ScopeInput, date: ISODate): SearchContext {
    const b = this.branch(scope);
    const now = this.opts.now();
    const nowMinute = dateOf(now.toISOString(), b.timezone) === date ? minuteOfDay(now.toISOString(), date, b.timezone) : undefined;
    return {
      tenantId: scope.tenantId,
      branchId: scope.branchId,
      date,
      timezone: b.timezone,
      branchHours: b.branchHours,
      technicians: this.techsIn(scope),
      appointments: this.apptsOn(scope, date, b.timezone),
      segments: this.segmentsOn(scope, date, b.timezone),
      policy: b.policy,
      nowMinute,
    };
  }

  private resolveServices(scope: ScopeInput, serviceIds: ID[]): Service[] {
    const all = this.servicesIn(scope, true);
    const out: Service[] = [];
    for (const id of serviceIds) {
      const s = all.find((x) => x.id === id);
      if (!s) throw new BookingDomainError('VALIDATION_FAILED', `Unknown service ${id}`);
      out.push(s);
    }
    if (out.length === 0) throw new BookingDomainError('VALIDATION_FAILED', 'At least one service is required');
    return out;
  }

  private resolveAddOns(ids: ID[] | undefined): ServiceAddOn[] {
    return (ids ?? []).map((id) => {
      const a = this.data.addOns.find((x) => x.id === id);
      if (!a) throw new BookingDomainError('VALIDATION_FAILED', `Unknown add-on ${id}`);
      return a;
    });
  }

  private publish(scope: ScopeInput, date: ISODate, event: ScheduleEvent): void {
    const envelope: ScheduleEventEnvelope = {
      tenantId: scope.tenantId,
      branchId: scope.branchId,
      date,
      serverVersion: this.bump(scope),
      at: new Date().toISOString(),
      event,
    };
    // Deliver asynchronously, like a real transport would.
    queueMicrotask(() => this.bus.publish(envelope));
  }

  private log(scope: ScopeInput, action: string, entityId: ID, previous?: unknown, next?: unknown): void {
    this.audit.push({ at: new Date().toISOString(), tenantId: scope.tenantId, branchId: scope.branchId, actorUserId: this.opts.userId, action, entityId, previous, next });
  }

  /**
   * The authoritative validation every write goes through (spec §20, §21, §23).
   * Throws a domain error; returns the resolved pieces on success.
   */
  private validatePlacement(
    scope: ScopeInput,
    technicianId: ID,
    startAt: string,
    services: Service[],
    durationMinutes: number,
    ignoreAppointmentIds?: ReadonlySet<ID>,
    requestedTechnicianId?: ID | null,
  ): { technician: Technician; date: ISODate; startMinute: number; timezone: string } {
    const ctx = this.searchContext(scope, dateOf(startAt, this.branch(scope).timezone));
    const technician = ctx.technicians.find((t) => t.id === technicianId);
    if (!technician) throw new BookingDomainError('TECHNICIAN_UNAVAILABLE', 'Technician not found at this branch.');
    const startMinute = minuteOfDay(startAt, ctx.date, ctx.timezone);
    const elig = evaluateEligibility({
      technician,
      tenantId: scope.tenantId,
      branchId: scope.branchId,
      services,
      durationMinutes,
      date: ctx.date,
      timezone: ctx.timezone,
      branchHours: ctx.branchHours,
      appointments: ctx.appointments,
      segments: ctx.segments,
      startMinute,
      nowMinute: ctx.nowMinute,
      policy: ctx.policy,
      ignoreAppointmentIds,
      requestedTechnicianId,
    });
    if (!elig.eligible) {
      throw new BookingDomainError(failureToErrorCode(elig.failures), undefined, { failures: elig.failures, conflictId: elig.conflictId }, this.version(scope));
    }
    return { technician, date: ctx.date, startMinute, timezone: ctx.timezone };
  }

  private buildItems(services: Service[], addOns: ServiceAddOn[]): Appointment['items'] {
    return services.map((s, i) => ({
      serviceId: s.id,
      name: s.name,
      durationMinutes: s.durationMinutes,
      priceCents: s.priceCents,
      // Add-ons attach to the first service item for display purposes.
      addOns: i === 0 && addOns.length ? addOns : undefined,
    }));
  }

  // ------------------------------------------------------------------ reads

  async getScheduleRange(input: GetScheduleRangeInput): Promise<ScheduleRange> {
    await this.delay();
    this.stats.scheduleRangeCalls += 1;
    const b = this.branch(input);
    const date = input.fromDate; // Day view; Week view calls per day in the demo host.
    let technicians = this.techsIn(input);
    if (input.technicianIds?.length) technicians = technicians.filter((t) => input.technicianIds!.includes(t.id));
    let appointments = this.apptsOn(input, date, b.timezone);
    if (input.serviceId) appointments = appointments.filter((a) => a.items.some((i) => i.serviceId === input.serviceId));
    if (input.statuses?.length) appointments = appointments.filter((a) => input.statuses!.includes(a.status));
    const segments = this.segmentsOn(input, date, b.timezone);
    // Availability is computed from the UNFILTERED appointments: filters change what you see, not what is open.
    const allAppointments = this.apptsOn(input, date, b.timezone);
    const availability: ScheduleRange['availability'] = {};
    for (const t of technicians) {
      const ctx = buildDayContext({ technician: t, date, timezone: b.timezone, branchHours: b.branchHours, appointments: allAppointments, segments });
      availability[t.id] = gapsToAvailability(ctx, computeGaps(ctx));
    }
    return {
      tenantId: input.tenantId,
      branchId: input.branchId,
      date,
      timezone: b.timezone,
      branchHours: b.branchHours,
      technicians: structuredClone(technicians),
      appointments: structuredClone(appointments),
      segments: structuredClone(segments),
      availability,
      serverVersion: this.version(input),
      updatedAt: new Date().toISOString(),
    };
  }

  async getAvailability(input: GetAvailabilityInput) {
    await this.delay();
    const b = this.branch(input);
    const appointments = this.apptsOn(input, input.date, b.timezone);
    const segments = this.segmentsOn(input, input.date, b.timezone);
    const gaps: Record<ID, ReturnType<typeof gapsToAvailability>> = {};
    for (const t of this.techsIn(input)) {
      if (input.technicianIds?.length && !input.technicianIds.includes(t.id)) continue;
      const ctx = buildDayContext({ technician: t, date: input.date, timezone: b.timezone, branchHours: b.branchHours, appointments, segments });
      gaps[t.id] = gapsToAvailability(ctx, computeGaps(ctx)).filter((g) => g.durationMinutes >= (input.minimumDurationMinutes ?? 15));
    }
    return { date: input.date, timezone: b.timezone, gaps, serverVersion: this.version(input) };
  }

  async findOpenings(input: FindOpeningsInput): Promise<OpeningResult[]> {
    await this.delay();
    const ctx = this.searchContext(input, input.date);
    const services = this.resolveServices(input, input.serviceIds);
    const window = input.windowStart || input.windowEnd
      ? { start: input.windowStart ? hhmmToMinutes(input.windowStart) : 0, end: input.windowEnd ? hhmmToMinutes(input.windowEnd) : 1440 }
      : undefined;
    const all = findOpenings(ctx, { services, durationMinutes: input.durationMinutes, technicianId: input.technicianId, window, preferredTechnicianId: input.preferredTechnicianId });
    const collapsed = collapseOpenings(all);
    return input.limit ? collapsed.slice(0, input.limit) : collapsed;
  }

  async getBestMatches(input: GetBestMatchesInput): Promise<TechnicianMatch[]> {
    await this.delay();
    const ctx = this.searchContext(input, input.date);
    const services = this.resolveServices(input, input.serviceIds);
    const order = this.data.fairTurn[branchKey(input)] ?? [];
    const fairTurnOrder: Record<ID, number> = {};
    order.forEach((id, i) => { fairTurnOrder[id] = i; });
    return bestMatches(ctx, {
      services,
      durationMinutes: input.durationMinutes,
      requestedTechnicianId: input.requestedTechnicianId,
      preferredTechnicianId: input.preferredTechnicianId,
      preferredStartMinute: input.preferredStart ? hhmmToMinutes(input.preferredStart) : ctx.nowMinute ?? hhmmToMinutes(ctx.branchHours.openAt),
      fairTurnOrder,
    });
  }

  async getTechnicianDay(input: GetTechnicianDayInput): Promise<TechnicianDay> {
    await this.delay();
    const b = this.branch(input);
    const technician = this.techsIn(input).find((t) => t.id === input.technicianId);
    if (!technician) throw new BookingDomainError('NOT_FOUND', 'Technician not found.');
    const appointments = this.apptsOn(input, input.date, b.timezone).filter((a) => a.technicianId === technician.id).sort((x, y) => x.startAt.localeCompare(y.startAt));
    const segments = this.segmentsOn(input, input.date, b.timezone).filter((s) => s.technicianId === technician.id);
    const ctx = buildDayContext({ technician, date: input.date, timezone: b.timezone, branchHours: b.branchHours, appointments, segments });
    const sum = daySummary(ctx);
    return {
      technician: structuredClone(technician),
      date: input.date,
      timezone: b.timezone,
      appointments: structuredClone(appointments),
      segments: structuredClone(segments),
      availability: gapsToAvailability(ctx, computeGaps(ctx)),
      summary: { ...sum, appointmentCount: appointments.filter((a) => a.status !== 'cancelled' && a.status !== 'no_show').length },
    };
  }

  async getServices(input: GetServicesInput): Promise<Service[]> {
    await this.delay();
    this.branch(input);
    return structuredClone(this.servicesIn(input, input.includeInactive));
  }

  async getBookingPolicy(input: ScopeInput): Promise<BookingPolicy> {
    return { gridMinutes: 15, ...(this.branch(input).policy ?? {}) };
  }

  subscribeSchedule(input: SubscribeScheduleInput, handler: (e: ScheduleEventEnvelope) => void): Unsubscribe {
    this.branch(input);
    return this.bus.subscribe({ tenantId: input.tenantId, branchId: input.branchId, date: input.date }, handler);
  }

  // ----------------------------------------------------------------- writes

  async createAppointment(input: CreateAppointmentInput): Promise<Appointment> {
    await this.delay();
    return this.transaction(() => {
      const replay = this.idempotency.get(input.idempotencyKey);
      if (replay) return structuredClone(replay as Appointment);
      const b = this.branch(input);
      const services = this.resolveServices(input, input.serviceIds);
      const addOns = this.resolveAddOns(input.addOnIds);
      const duration = requiredDuration(this.buildItems(services, addOns));
      // `expectedServerVersion` is advisory: a stale board is fine as long as the
      // slot is still genuinely open — the placement check below is what decides (spec §21).
      const date = dateOf(input.startAt, b.timezone);
      let technicianId = input.technicianId;
      if (technicianId === 'any') technicianId = this.pickFairTurn(input, date, services, duration, input.startAt);
      const placed = this.validatePlacement(input, technicianId, input.startAt, services, duration, undefined, input.requestedTechnician ? technicianId : null);
      const appointment: Appointment = {
        id: `appt-${++this.seq}-${Math.random().toString(36).slice(2, 8)}`,
        tenantId: input.tenantId,
        branchId: input.branchId,
        customerId: input.customerId ?? null,
        customerName: input.customerName,
        customerPhone: input.customerPhone ?? null,
        technicianId,
        items: this.buildItems(services, addOns),
        startAt: toISO(placed.date, placed.startMinute, placed.timezone),
        endAt: toISO(placed.date, placed.startMinute + duration, placed.timezone),
        status: 'scheduled',
        source: input.source ?? 'pos',
        requestedTechnician: input.requestedTechnician,
        protected: input.protected ?? false,
        notes: input.notes ?? null,
        version: 1,
      };
      this.data.appointments.push(appointment);
      this.idempotency.set(input.idempotencyKey, appointment);
      this.stats.mutations += 1;
      this.log(input, 'appointment.created', appointment.id, undefined, appointment);
      if (input.priceOverrideCents != null) this.log(input, 'price.override', appointment.id, undefined, { priceOverrideCents: input.priceOverrideCents });
      this.publish(input, date, { type: 'appointment.created', appointment: structuredClone(appointment) });
      return structuredClone(appointment);
    });
  }

  /** Fair Turn over the ELIGIBLE set only (spec §24). */
  private pickFairTurn(scope: ScopeInput, date: ISODate, services: Service[], duration: number, startAt: string): ID {
    const ctx = this.searchContext(scope, date);
    const order = this.data.fairTurn[branchKey(scope)] ?? ctx.technicians.map((t) => t.id);
    const startMinute = minuteOfDay(startAt, date, ctx.timezone);
    const eligible = ctx.technicians.filter((t) =>
      evaluateEligibility({
        technician: t, tenantId: scope.tenantId, branchId: scope.branchId, services, durationMinutes: duration,
        date, timezone: ctx.timezone, branchHours: ctx.branchHours, appointments: ctx.appointments, segments: ctx.segments,
        startMinute, nowMinute: ctx.nowMinute, policy: ctx.policy,
      }).eligible,
    );
    if (eligible.length === 0) throw new BookingDomainError('TECHNICIAN_UNAVAILABLE', 'No eligible technician is available at that time.');
    const eligibleIds = new Set(eligible.map((t) => t.id));
    const next = order.find((id) => eligibleIds.has(id)) ?? eligible[0].id;
    // Consume ONLY the chosen (eligible) technician's turn: move them to the back.
    this.data.fairTurn[branchKey(scope)] = [...order.filter((id) => id !== next), next];
    return next;
  }

  async createWalkIn(input: CreateWalkInInput): Promise<Appointment> {
    await this.delay();
    const b = this.branch(input);
    const now = this.opts.now();
    const date = dateOf(now.toISOString(), b.timezone);
    // Walk-ins start at the next grid cell from now.
    const nowMin = minuteOfDay(now.toISOString(), date, b.timezone);
    const start = Math.ceil(nowMin / 15) * 15;
    const created = await this.createAppointment({
      tenantId: input.tenantId,
      branchId: input.branchId,
      idempotencyKey: input.idempotencyKey,
      technicianId: input.technicianId,
      customerId: input.customerId,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      serviceIds: input.serviceIds,
      addOnIds: input.addOnIds,
      startAt: toISO(date, start, b.timezone),
      requestedTechnician: input.requestedTechnician,
      notes: input.notes,
      source: 'walk_in',
      priceOverrideCents: input.priceOverrideCents,
    });
    // Mark as arrived + link a queue ticket; publish the walk-in specific event too.
    return this.transaction(() => {
      const a = this.data.appointments.find((x) => x.id === created.id)!;
      a.status = 'arrived';
      a.queueTicketId = `ticket-${a.id}`;
      a.version += 1;
      this.publish(input, date, { type: 'walkin.created', appointment: structuredClone(a) });
      return structuredClone(a);
    });
  }

  async moveAppointment(input: MoveAppointmentInput): Promise<Appointment> {
    await this.delay();
    return this.transaction(() => {
      const replay = this.idempotency.get(input.idempotencyKey);
      if (replay) return structuredClone(replay as Appointment);
      const b = this.branch(input);
      const a = this.data.appointments.find((x) => x.id === input.appointmentId && x.tenantId === input.tenantId && x.branchId === input.branchId);
      if (!a) throw new BookingDomainError('NOT_FOUND');
      if (a.version !== input.expectedVersion) throw new BookingDomainError('SCHEDULE_CHANGED', undefined, { currentVersion: a.version }, this.version(input));
      if (a.status === 'completed' || a.status === 'cancelled' || a.status === 'in_service') {
        throw new BookingDomainError('VALIDATION_FAILED', `A ${a.status.replace('_', ' ')} appointment cannot be moved.`);
      }
      const services = this.resolveServices(input, a.items.map((i) => i.serviceId));
      const duration = requiredDuration(a.items);
      const placed = this.validatePlacement(
        input, input.technicianId, input.startAt, services, duration, new Set([a.id]),
        a.requestedTechnician ? a.technicianId : null,
      );
      const previous = structuredClone(a);
      a.technicianId = input.technicianId;
      a.startAt = toISO(placed.date, placed.startMinute, placed.timezone);
      a.endAt = toISO(placed.date, placed.startMinute + duration, placed.timezone);
      a.version += 1;
      this.idempotency.set(input.idempotencyKey, a);
      this.stats.mutations += 1;
      const action = previous.technicianId !== a.technicianId ? 'appointment.reassigned' : 'appointment.moved';
      this.log(input, action, a.id, previous, a);
      const date = dateOf(a.startAt, b.timezone);
      if (action === 'appointment.reassigned') this.publish(input, date, { type: 'appointment.reassigned', appointment: structuredClone(a), previousTechnicianId: previous.technicianId });
      else this.publish(input, date, { type: 'appointment.moved', appointment: structuredClone(a), previousTechnicianId: previous.technicianId, previousStartAt: previous.startAt });
      return structuredClone(a);
    });
  }

  async cancelAppointment(input: CancelAppointmentInput): Promise<void> {
    await this.delay();
    return this.transaction(() => {
      const b = this.branch(input);
      const a = this.data.appointments.find((x) => x.id === input.appointmentId && x.tenantId === input.tenantId && x.branchId === input.branchId);
      if (!a) throw new BookingDomainError('NOT_FOUND');
      if (a.version !== input.expectedVersion) throw new BookingDomainError('SCHEDULE_CHANGED');
      const previous = structuredClone(a);
      a.status = 'cancelled';
      a.version += 1;
      this.stats.mutations += 1;
      this.log(input, 'appointment.cancelled', a.id, previous, { status: 'cancelled', reason: input.reason ?? null });
      this.publish(input, dateOf(a.startAt, b.timezone), { type: 'appointment.cancelled', appointmentId: a.id, technicianId: a.technicianId });
    });
  }

  async createBlockedTime(input: CreateBlockedTimeInput): Promise<ScheduleSegment> {
    await this.delay();
    return this.transaction(() => {
      const replay = this.idempotency.get(input.idempotencyKey);
      if (replay) return structuredClone(replay as ScheduleSegment);
      const b = this.branch(input);
      const tech = this.techsIn(input).find((t) => t.id === input.technicianId);
      if (!tech) throw new BookingDomainError('TECHNICIAN_UNAVAILABLE', 'Technician not found at this branch.');
      const s = minuteOfDay(input.startAt, input.date, b.timezone);
      const e = minuteOfDay(input.endAt, input.date, b.timezone);
      if (!(e > s) || s % 15 !== 0 || e % 15 !== 0) throw new BookingDomainError('INVALID_DURATION', 'Blocked time must be a positive 15-minute multiple.');
      if (!input.reason?.trim()) throw new BookingDomainError('VALIDATION_FAILED', 'A reason is required for blocked time.');
      // Blocking over an existing appointment is refused: cancel/move it first (auditable, no silent overlap).
      const ctx = buildDayContext({ technician: tech, date: input.date, timezone: b.timezone, branchHours: b.branchHours, appointments: this.apptsOn(input, input.date, b.timezone), segments: [] });
      const overlapping = ctx.busy.find((x) => x.kind === 'appointment' && x.start < e && x.end > s);
      if (overlapping) throw new BookingDomainError('APPOINTMENT_CONFLICT', 'An appointment already occupies part of that time.', { conflictId: overlapping.refId });
      const segment: ScheduleSegment = {
        id: `blk-${++this.seq}`,
        tenantId: input.tenantId,
        branchId: input.branchId,
        technicianId: input.technicianId,
        startAt: toISO(input.date, s, b.timezone),
        endAt: toISO(input.date, e, b.timezone),
        type: 'blocked',
        reason: input.reason,
        notes: input.notes ?? null,
        createdByUserId: this.opts.userId,
        createdAt: new Date().toISOString(),
      };
      this.data.segments.push(segment);
      this.idempotency.set(input.idempotencyKey, segment);
      this.stats.mutations += 1;
      this.log(input, 'blocked_time.created', segment.id, undefined, segment);
      this.publish(input, input.date, { type: 'blocked_time.created', segment: structuredClone(segment) });
      return structuredClone(segment);
    });
  }

  // ------------------------------------------------- test / demo utilities

  /** Apply a status transition as the host's check-in / serving flow would (spec §29). */
  async transition(scope: ScopeInput, appointmentId: ID, status: Appointment['status']): Promise<Appointment> {
    return this.transaction(() => {
      const b = this.branch(scope);
      const a = this.data.appointments.find((x) => x.id === appointmentId && x.tenantId === scope.tenantId);
      if (!a) throw new BookingDomainError('NOT_FOUND');
      const previous = a.status;
      a.status = status;
      a.version += 1;
      this.log(scope, `appointment.${status}`, a.id, { status: previous }, { status });
      const date = dateOf(a.startAt, b.timezone);
      const type = status === 'arrived' ? 'appointment.checked_in' : status === 'in_service' ? 'service.started' : status === 'completed' ? 'service.completed' : null;
      if (type) this.publish(scope, date, { type, appointment: structuredClone(a) });
      return structuredClone(a);
    });
  }

  /** Snapshot for assertions. */
  snapshot(): MockStoreData {
    return structuredClone(this.data);
  }

  /** Ask every subscriber to resync (host "silent safety synchronization"). */
  forceResync(scope: ScopeInput, date: ISODate): void {
    this.publish(scope, date, { type: 'schedule.resync' });
  }

  /** Direct validation hook used by tests to assert a placement without writing. */
  checkPlacement(scope: ScopeInput, technicianId: ID, startAt: string, serviceIds: ID[]): ReturnType<typeof slotFits> {
    const b = this.branch(scope);
    const date = dateOf(startAt, b.timezone);
    const tech = this.techsIn(scope).find((t) => t.id === technicianId);
    if (!tech) return { fits: false, failure: 'NOT_WORKING' };
    const services = this.resolveServices(scope, serviceIds);
    const ctx = buildDayContext({ technician: tech, date, timezone: b.timezone, branchHours: b.branchHours, appointments: this.apptsOn(scope, date, b.timezone), segments: this.segmentsOn(scope, date, b.timezone) });
    return slotFits(ctx, minuteOfDay(startAt, date, b.timezone), requiredDuration(services.map((s) => ({ durationMinutes: s.durationMinutes }))));
  }
}
