import { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { BoardPermissions } from '../adapters/BookingDataAdapter';
import { availableDurationAt, buildDayContext, slotFits, type Interval, type TechnicianDayContext } from '../domain/availability';
import { useBoardText } from '../i18n/boardText';
import type { Appointment, AvailabilityGap, BranchHours, ID, ScheduleSegment } from '../domain/scheduleTypes';
import { formatClock, minuteOfDay } from '../domain/time';
import type { SelectedSlot } from '../state/boardState';
import type { TechnicianSlice } from '../state/scheduleStore';
import { AppointmentCard } from './AppointmentCard';
import { BlockedTimeCard } from './BlockedTimeCard';
import { OpenSlotCard } from './OpenSlotCard';

export interface DragState {
  appointment: Appointment;
  fromTechnicianId: ID;
  pointerOffsetMinutes: number;
  targetTechnicianId: ID | null;
  targetStartMinute: number | null;
  valid: boolean;
  reason?: string;
}

export interface MoveRequest {
  appointment: Appointment;
  technicianId: ID;
  startMinute: number;
}

export interface ScheduleGridProps {
  date: string;
  timezone: string;
  branchHours: BranchHours;
  /** Visible range in minutes since local midnight. */
  dayStart: number;
  dayEnd: number;
  cellHeight: number;
  slices: TechnicianSlice[];
  nowMinute: number | null;
  selectedTechnicianId: ID | null;
  selectedSlot: SelectedSlot | null;
  permissions: BoardPermissions;
  /** Appointment ids with an in-flight mutation (rendered dimmed, not draggable). */
  pendingIds: ReadonlySet<ID>;
  statusFilter: ReadonlySet<Appointment['status']> | null;
  serviceFilter: ID | null;
  onBookSlot: (technicianId: ID, startMinute: number, availableDurationMinutes: number) => void;
  onOpenAppointment: (appointment: Appointment) => void;
  onMove: (req: MoveRequest) => void;
  onScroll: (scrollTop: number) => void;
  initialScrollTop: number;
  onSelectSlot: (slot: SelectedSlot | null) => void;
}

export function ScheduleGrid(p: ScheduleGridProps) {
  const { t } = useBoardText();
  const scrollRef = useRef<HTMLDivElement>(null);
  const colRefs = useRef(new Map<ID, HTMLDivElement>());
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  const totalMinutes = p.dayEnd - p.dayStart;
  const cells = totalMinutes / 15;
  const height = cells * p.cellHeight;
  const minuteToY = useCallback((m: number) => ((m - p.dayStart) / 15) * p.cellHeight, [p.dayStart, p.cellHeight]);

  // restore scroll position once mounted (spec §26)
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !scrollRef.current) return;
    restored.current = true;
    scrollRef.current.scrollTop = p.initialScrollTop;
  }, [p.initialScrollTop]);

  const sliceById = useMemo(() => new Map(p.slices.map((s) => [s.technician.id, s])), [p.slices]);

  const locate = useCallback((clientX: number, clientY: number): { technicianId: ID; minute: number } | null => {
    const scroll = scrollRef.current;
    if (!scroll) return null;
    let technicianId: ID | null = null;
    for (const [id, el] of colRefs.current) {
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX < r.right) { technicianId = id; break; }
    }
    if (!technicianId) return null;
    const rect = scroll.getBoundingClientRect();
    const y = clientY - rect.top + scroll.scrollTop;
    const minute = p.dayStart + Math.floor(y / p.cellHeight) * 15;
    return { technicianId, minute };
  }, [p.dayStart, p.cellHeight]);

  const evaluateTarget = useCallback((d: DragState, technicianId: ID, startMinute: number): Pick<DragState, 'valid' | 'reason'> => {
    const slice = sliceById.get(technicianId);
    if (!slice) return { valid: false, reason: t('grid.notVisible') };
    if (technicianId !== d.fromTechnicianId && !p.permissions.canReassign) return { valid: false, reason: t('grid.noReassign') };
    const ctx: TechnicianDayContext = buildDayContext({
      technician: slice.technician, date: p.date, timezone: p.timezone, branchHours: p.branchHours,
      appointments: slice.appointments, segments: slice.segments, ignoreAppointmentIds: new Set([d.appointment.id]),
    });
    // unknown relation (null) → no local verdict; the backend validates the drop (spec §20) and the board rolls back on refusal
    const ids = slice.technician.serviceIds;
    const serviceOk = ids == null || d.appointment.items.every((it) => ids.includes(it.serviceId));
    if (!serviceOk) return { valid: false, reason: t('elig.SERVICE_INELIGIBLE') };
    const dur = minuteOfDay(d.appointment.endAt, p.date, p.timezone) - minuteOfDay(d.appointment.startAt, p.date, p.timezone);
    const fit = slotFits(ctx, startMinute, dur);
    if (!fit.fits) return { valid: false, reason: fit.failure ? t(`elig.${fit.failure}`) : t('grid.unavailable') };
    return { valid: true };
  }, [sliceById, p.date, p.timezone, p.branchHours, p.permissions.canReassign, t]);

  const onCardPointerDown = useCallback((e: ReactPointerEvent, appointment: Appointment) => {
    if (e.button !== 0) return;
    if (!p.permissions.canMove || p.pendingIds.has(appointment.id)) return;
    if (['completed', 'cancelled', 'in_service', 'no_show'].includes(appointment.status)) return;
    const loc = locate(e.clientX, e.clientY);
    if (!loc) return;
    const start = minuteOfDay(appointment.startAt, p.date, p.timezone);
    const d: DragState = {
      appointment,
      fromTechnicianId: appointment.technicianId,
      pointerOffsetMinutes: loc.minute - start,
      targetTechnicianId: null,
      targetStartMinute: null,
      valid: false,
    };
    // Only start a real drag after the pointer moves (so click still opens the appointment).
    let started = false;
    const onMove = (ev: PointerEvent) => {
      const l = locate(ev.clientX, ev.clientY);
      if (!l) return;
      const startMinute = Math.max(p.dayStart, Math.min(p.dayEnd - 15, l.minute - d.pointerOffsetMinutes));
      if (!started) {
        if (l.technicianId === d.fromTechnicianId && startMinute === start) return;
        started = true;
      }
      const v = evaluateTarget(d, l.technicianId, startMinute);
      const next: DragState = { ...d, targetTechnicianId: l.technicianId, targetStartMinute: startMinute, ...v };
      setDrag(next);
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      const cur = dragRef.current;
      setDrag(null);
      if (!started || !cur || cur.targetTechnicianId == null || cur.targetStartMinute == null) return;
      if (cur.targetTechnicianId === cur.fromTechnicianId && cur.targetStartMinute === start) return;
      if (!cur.valid) return; // the board refuses locally; the backend would refuse too
      p.onMove({ appointment: cur.appointment, technicianId: cur.targetTechnicianId, startMinute: cur.targetStartMinute });
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }, [p, locate, evaluateTarget]);

  const hours: number[] = [];
  for (let m = p.dayStart; m < p.dayEnd; m += 60) hours.push(m);
  const style = { '--bsb-cell': `${p.cellHeight}px`, '--bsb-cols': p.slices.length } as CSSProperties;

  return (
    <div ref={scrollRef} className="bsb-scroll" data-testid="bsb-scroll" onScroll={(e) => p.onScroll(e.currentTarget.scrollTop)} style={style}>
      <div className="bsb-grid" style={{ height }}>
        <div className="bsb-axis" aria-hidden="true">
          {hours.map((m) => <div key={m} className="bsb-hour" style={{ top: minuteToY(m) }}>{formatClock(m)}</div>)}
          {p.cellHeight >= 14 && hours.flatMap((m) => [15, 30, 45].map((q) => <div key={m + q} className="bsb-quarter" style={{ top: minuteToY(m + q) }}>:{q}</div>))}
        </div>
        <div className="bsb-cols">
          {p.slices.map((slice) => (
            <TechnicianColumn
              key={slice.technician.id}
              ref={(el) => { if (el) colRefs.current.set(slice.technician.id, el); else colRefs.current.delete(slice.technician.id); }}
              slice={slice}
              date={p.date}
              timezone={p.timezone}
              dayStart={p.dayStart}
              dayEnd={p.dayEnd}
              cellHeight={p.cellHeight}
              nowMinute={p.nowMinute}
              selected={p.selectedTechnicianId === slice.technician.id}
              selectedSlot={p.selectedSlot?.technicianId === slice.technician.id ? p.selectedSlot : null}
              canBook={p.permissions.canBook}
              canMove={p.permissions.canMove}
              pendingIds={p.pendingIds}
              statusFilter={p.statusFilter}
              serviceFilter={p.serviceFilter}
              draggingId={drag?.appointment.id ?? null}
              ghost={drag && drag.targetTechnicianId === slice.technician.id && drag.targetStartMinute != null ? { start: drag.targetStartMinute, end: drag.targetStartMinute + (minuteOfDay(drag.appointment.endAt, p.date, p.timezone) - minuteOfDay(drag.appointment.startAt, p.date, p.timezone)), valid: drag.valid, reason: drag.reason } : null}
              onBookSlot={p.onBookSlot}
              onOpenAppointment={p.onOpenAppointment}
              onCardPointerDown={onCardPointerDown}
              onSelectSlot={p.onSelectSlot}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface ColumnProps {
  slice: TechnicianSlice;
  date: string;
  timezone: string;
  dayStart: number;
  dayEnd: number;
  cellHeight: number;
  nowMinute: number | null;
  selected: boolean;
  selectedSlot: SelectedSlot | null;
  canBook: boolean;
  canMove: boolean;
  pendingIds: ReadonlySet<ID>;
  statusFilter: ReadonlySet<Appointment['status']> | null;
  serviceFilter: ID | null;
  draggingId: ID | null;
  ghost: { start: number; end: number; valid: boolean; reason?: string } | null;
  onBookSlot: (technicianId: ID, startMinute: number, availableDurationMinutes: number) => void;
  onOpenAppointment: (appointment: Appointment) => void;
  onCardPointerDown: (e: ReactPointerEvent, appointment: Appointment) => void;
  onSelectSlot: (slot: SelectedSlot | null) => void;
  ref?: (el: HTMLDivElement | null) => void;
}


const TechnicianColumn = memo(forwardRef<HTMLDivElement, ColumnProps>(function TechnicianColumn(p, ref) {
  const { slice } = p;
  const toMin = (iso: string) => minuteOfDay(iso, p.date, p.timezone);
  const y = (m: number) => ((m - p.dayStart) / 15) * p.cellHeight;
  const h = (s: number, e: number) => ((e - s) / 15) * p.cellHeight;
  const working = slice.ctx.working;
  const offShift: Interval[] = [];
  let cursor = p.dayStart;
  for (const w of working) {
    if (w.start > cursor) offShift.push({ start: cursor, end: Math.min(w.start, p.dayEnd) });
    cursor = Math.max(cursor, w.end);
  }
  if (cursor < p.dayEnd) offShift.push({ start: cursor, end: p.dayEnd });
  const gaps: AvailabilityGap[] = slice.availability.filter((g) => g.bookable);

  const visibleAppointment = (a: Appointment) => {
    if (p.statusFilter && p.statusFilter.size > 0 && !p.statusFilter.has(a.status)) return false;
    if (p.serviceFilter && !a.items.some((it) => it.serviceId === p.serviceFilter)) return false;
    return true;
  };

  return (
    <div ref={ref} className={`bsb-col${p.selected ? ' is-selected' : ''}${working.length === 0 ? ' is-offshift' : ''}`} data-testid={`bsb-col-${slice.technician.id}`} data-revision={slice.revision}>
      <div className="bsb-gridlines" />
      {offShift.map((o) => <div key={`off-${o.start}`} className="bsb-offshift" style={{ top: y(o.start), height: h(o.start, o.end) }} aria-hidden="true" />)}
      {slice.segments.filter((s: ScheduleSegment) => s.type !== 'working').map((s) => {
        const sMin = Math.max(p.dayStart, toMin(s.startAt));
        const eMin = Math.min(p.dayEnd, toMin(s.endAt));
        if (eMin <= sMin) return null;
        return <BlockedTimeCard key={s.id} segment={s} top={y(sMin)} height={h(sMin, eMin)} durationMinutes={eMin - sMin} />;
      })}
      {gaps.map((g) => {
        const sMin = Math.max(p.dayStart, toMin(g.startAt));
        const eMin = Math.min(p.dayEnd, toMin(g.endAt));
        if (eMin <= sMin) return null;
        return (
          <OpenSlotCard
            key={`gap-${g.startAt}`}
            technicianId={slice.technician.id}
            startMinute={sMin}
            endMinute={eMin}
            cellHeight={p.cellHeight}
            top={y(sMin)}
            nowMinute={p.nowMinute}
            canBook={p.canBook}
            selected={p.selectedSlot && p.selectedSlot.startMinute >= sMin && p.selectedSlot.startMinute < eMin ? p.selectedSlot : null}
            availableAt={(m) => availableDurationAt(slice.ctx, m)}
            onBook={p.onBookSlot}
            onSelect={p.onSelectSlot}
          />
        );
      })}
      {slice.appointments.filter(visibleAppointment).map((a) => {
        const sMin = Math.max(p.dayStart, toMin(a.startAt));
        const eMin = Math.min(p.dayEnd, toMin(a.endAt));
        if (eMin <= sMin) return null;
        return (
          <AppointmentCard
            key={a.id}
            appointment={a}
            top={y(sMin)}
            height={h(sMin, eMin)}
            durationMinutes={toMin(a.endAt) - toMin(a.startAt)}
            dragging={p.draggingId === a.id}
            pending={p.pendingIds.has(a.id)}
            draggable={p.canMove}
            onOpen={p.onOpenAppointment}
            onPointerDown={p.onCardPointerDown}
          />
        );
      })}
      {p.ghost && (
        <div className={`bsb-drop-ghost${p.ghost.valid ? '' : ' is-invalid'}`} style={{ top: y(p.ghost.start), height: h(p.ghost.start, p.ghost.end) }} data-testid="bsb-drop-ghost" data-valid={p.ghost.valid}>
          {p.ghost.valid ? formatClock(p.ghost.start) : p.ghost.reason}
        </div>
      )}
      {p.nowMinute != null && p.nowMinute >= p.dayStart && p.nowMinute <= p.dayEnd && <div className="bsb-nowline" style={{ top: y(p.nowMinute) }} aria-hidden="true" />}
    </div>
  );
}));
