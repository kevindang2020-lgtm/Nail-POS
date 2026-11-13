/**
 * Schedule data store: one ScheduleRange per branch/date, held as per-technician
 * slices so realtime events touch only the affected columns (spec §25, §32).
 */
import { buildDayContext, computeGaps, gapsToAvailability, type TechnicianDayContext } from '../domain/availability';
import type { Appointment, AvailabilityGap, ID, ScheduleRange, ScheduleSegment, Technician } from '../domain/scheduleTypes';
import { affectedTechnicians, type ScheduleEvent, type ScheduleEventEnvelope } from '../realtime/events';

export interface TechnicianSlice {
  technician: Technician;
  appointments: Appointment[];
  segments: ScheduleSegment[];
  availability: AvailabilityGap[];
  ctx: TechnicianDayContext;
  /** Bumped whenever the slice changes → stable React keys + memo invalidation. */
  revision: number;
}

export interface ScheduleStoreState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  range: ScheduleRange | null;
  slices: Record<ID, TechnicianSlice>;
  /** Technician order from the server. */
  order: ID[];
  serverVersion: number;
  error: Error | null;
  /** True when a realtime gap was detected and a silent reload is in flight. */
  resyncing: boolean;
}

export const emptyStore: ScheduleStoreState = { status: 'idle', range: null, slices: {}, order: [], serverVersion: 0, error: null, resyncing: false };

function buildSlice(range: ScheduleRange, technician: Technician, appointments: Appointment[], segments: ScheduleSegment[], revision: number, serverAvailability?: AvailabilityGap[]): TechnicianSlice {
  const ctx = buildDayContext({ technician, date: range.date, timezone: range.timezone, branchHours: range.branchHours, appointments, segments });
  return {
    technician,
    appointments: [...appointments].sort((a, b) => a.startAt.localeCompare(b.startAt)),
    segments,
    // Server availability is authoritative on load; after local/realtime patches we project with the same engine.
    availability: serverAvailability ?? gapsToAvailability(ctx, computeGaps(ctx)),
    ctx,
    revision,
  };
}

export function storeFromRange(range: ScheduleRange): ScheduleStoreState {
  const slices: Record<ID, TechnicianSlice> = {};
  const order: ID[] = [];
  for (const t of range.technicians) {
    order.push(t.id);
    slices[t.id] = buildSlice(
      range,
      t,
      range.appointments.filter((a) => a.technicianId === t.id),
      range.segments.filter((s) => s.technicianId === t.id),
      1,
      range.availability[t.id],
    );
  }
  return { status: 'ready', range, slices, order, serverVersion: range.serverVersion, error: null, resyncing: false };
}

export type StoreAction =
  | { type: 'loading' }
  | { type: 'loaded'; range: ScheduleRange }
  | { type: 'failed'; error: Error }
  | { type: 'event'; envelope: ScheduleEventEnvelope }
  | { type: 'patch'; patch: LocalPatch }
  | { type: 'resync-start' };

/** Local (optimistic or confirmed) mutations expressed as the same shapes as realtime events. */
export type LocalPatch =
  | { kind: 'upsert-appointment'; appointment: Appointment; previousTechnicianId?: ID }
  | { kind: 'remove-appointment'; appointmentId: ID; technicianId: ID }
  | { kind: 'upsert-segment'; segment: ScheduleSegment }
  | { kind: 'remove-segment'; segmentId: ID; technicianId: ID };

function applyToTechs(state: ScheduleStoreState, techIds: ID[], fn: (slice: TechnicianSlice) => { appointments?: Appointment[]; segments?: ScheduleSegment[] }): ScheduleStoreState {
  if (!state.range) return state;
  const slices = { ...state.slices };
  for (const id of techIds) {
    const prev = slices[id];
    if (!prev) continue;
    const next = fn(prev);
    slices[id] = buildSlice(state.range, prev.technician, next.appointments ?? prev.appointments, next.segments ?? prev.segments, prev.revision + 1);
  }
  return { ...state, slices };
}

export function applyPatch(state: ScheduleStoreState, p: LocalPatch): ScheduleStoreState {
  switch (p.kind) {
    case 'upsert-appointment': {
      const touched = [...new Set([p.appointment.technicianId, ...(p.previousTechnicianId ? [p.previousTechnicianId] : [])])];
      // The appointment may have moved from a technician not listed in `previousTechnicianId` (unknown origin) → scan.
      for (const id of Object.keys(state.slices)) {
        if (state.slices[id].appointments.some((a) => a.id === p.appointment.id) && !touched.includes(id)) touched.push(id);
      }
      return applyToTechs(state, touched, (slice) => ({
        appointments: [
          ...slice.appointments.filter((a) => a.id !== p.appointment.id),
          ...(slice.technician.id === p.appointment.technicianId ? [p.appointment] : []),
        ],
      }));
    }
    case 'remove-appointment':
      return applyToTechs(state, [p.technicianId], (slice) => ({ appointments: slice.appointments.filter((a) => a.id !== p.appointmentId) }));
    case 'upsert-segment':
      return applyToTechs(state, [p.segment.technicianId], (slice) => ({ segments: [...slice.segments.filter((s) => s.id !== p.segment.id), p.segment] }));
    case 'remove-segment':
      return applyToTechs(state, [p.technicianId], (slice) => ({ segments: slice.segments.filter((s) => s.id !== p.segmentId) }));
  }
}

/** Translate a realtime event into local patches; `null` = full resync required. */
export function eventToPatches(e: ScheduleEvent): LocalPatch[] | null {
  switch (e.type) {
    case 'appointment.created':
    case 'walkin.created':
    case 'appointment.checked_in':
    case 'service.started':
    case 'service.completed':
      return [{ kind: 'upsert-appointment', appointment: e.appointment }];
    case 'appointment.moved':
    case 'appointment.reassigned':
      return [{ kind: 'upsert-appointment', appointment: e.appointment, previousTechnicianId: e.previousTechnicianId }];
    case 'appointment.cancelled':
      return [{ kind: 'remove-appointment', appointmentId: e.appointmentId, technicianId: e.technicianId }];
    case 'blocked_time.created':
    case 'blocked_time.changed':
      return [{ kind: 'upsert-segment', segment: e.segment }];
    case 'blocked_time.removed':
      return [{ kind: 'remove-segment', segmentId: e.segmentId, technicianId: e.technicianId }];
    case 'technician.schedule_changed':
      return null; // segments replaced wholesale → simplest safe path is a reload
    case 'schedule.resync':
      return null;
  }
}

export interface EventOutcome {
  state: ScheduleStoreState;
  /** The store could not apply the event incrementally → caller must reload. */
  needsReload: boolean;
}

export function applyEvent(state: ScheduleStoreState, envelope: ScheduleEventEnvelope): EventOutcome {
  if (!state.range) return { state, needsReload: false };
  if (envelope.date !== state.range.date || envelope.branchId !== state.range.branchId || envelope.tenantId !== state.range.tenantId) {
    return { state, needsReload: false };
  }
  // Silent safety synchronization: a version gap means we missed something → reload.
  if (envelope.serverVersion > state.serverVersion + 1) return { state: { ...state, resyncing: true }, needsReload: true };
  if (envelope.serverVersion <= state.serverVersion) return { state, needsReload: false }; // already applied (e.g. our own mutation)
  const touched = affectedTechnicians(envelope.event);
  if (touched === 'all') return { state: { ...state, resyncing: true }, needsReload: true };
  if (touched.some((id) => !state.slices[id])) return { state: { ...state, serverVersion: envelope.serverVersion, resyncing: true }, needsReload: true };
  const patches = eventToPatches(envelope.event);
  if (!patches) return { state: { ...state, resyncing: true }, needsReload: true };
  let next = state;
  for (const p of patches) next = applyPatch(next, p);
  return { state: { ...next, serverVersion: envelope.serverVersion }, needsReload: false };
}

export function storeReducer(state: ScheduleStoreState, action: StoreAction): ScheduleStoreState {
  switch (action.type) {
    case 'loading':
      return { ...state, status: state.range ? state.status : 'loading', error: null };
    case 'loaded':
      return storeFromRange(action.range);
    case 'failed':
      return { ...state, status: state.range ? state.status : 'error', error: action.error, resyncing: false };
    case 'event':
      return applyEvent(state, action.envelope).state;
    case 'patch':
      return applyPatch(state, action.patch);
    case 'resync-start':
      return { ...state, resyncing: true };
  }
}
