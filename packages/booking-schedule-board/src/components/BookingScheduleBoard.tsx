/**
 * BookingScheduleBoard — the standalone module root (spec §5).
 *
 * Receives context from the host, depends only on `BookingDataAdapter`
 * (+ optional `RealtimeClient`), and emits user intent back to the host through
 * the `on*` callbacks. It never reaches into host page state and never creates
 * appointments itself: `+ Book` hands a `BookingContext` to the host's existing
 * Booking Assistant / New Appointment workflow.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { BoardPermissions, BookingDataAdapter, CreateBlockedTimeInput } from '../adapters/BookingDataAdapter';
import { toBookingError, type BookingErrorCode } from '../domain/bookingErrors';
import { BoardTextProvider, useBoardText, type BoardTranslate } from '../i18n/boardText';
import { pageInfo, pageOfIndex } from '../domain/paging';
import type { Appointment, AvailabilityGap, BoardOverlay, BookingContext, ID, ISODate, OpeningResult, Service, TechnicianMatch } from '../domain/scheduleTypes';
import { dateOf, hhmmToMinutes, minuteOfDay, toISO, todayIn } from '../domain/time';
import { useScheduleRange } from '../hooks/useScheduleRange';
import type { RealtimeClient } from '../realtime/events';
import { boardReducer, initialBoardState, toPersisted, type BoardState, type PersistedBoardState } from '../state/boardState';
import type { TechnicianSlice } from '../state/scheduleStore';
import { AppointmentPanel } from './AppointmentPanel';
import { BestMatchesPanel } from './BestMatchesPanel';
import { BlockTimeDialog } from './BlockTimeAction';
import { BookingLegend } from './BookingLegend';
import { BookingToolbar } from './BookingToolbar';
import { AvailabilityCell, StripLabel } from './DailyAvailabilityStrip';
import { FindOpeningPanel } from './FindOpeningPanel';
import { OpeningToolbar } from './OpeningToolbar';
import { Toast, useToast } from './primitives';
import { ScheduleGrid, type MoveRequest } from './ScheduleGrid';
import { TechnicianHeader } from './TechnicianHeader';
import { TechnicianPager } from './TechnicianPager';
import { TechnicianDayPanel } from './TechnicianDayPanel';
import { ViewAllPopover } from './ViewAllPopover';
import { WeekView } from './WeekView';

export interface BookingScheduleBoardProps {
  tenantId: ID;
  branchId: ID;
  userId: ID;
  /** Branch timezone; falls back to the range's timezone once loaded. */
  timezone?: string;
  /** Initial date (ISO). Defaults to today in the branch timezone. */
  selectedDate?: ISODate;
  permissions: BoardPermissions;
  adapter: BookingDataAdapter;
  /** Optional: host realtime transport. When omitted, `adapter.subscribeSchedule` is used. */
  realtimeClient?: RealtimeClient;
  /** `+ Book` on an open cell / availability strip / View All / View Day. */
  onOpenBookingAssistant: (ctx: BookingContext) => void;
  /** A Find-an-Opening or Best-Matches pick. Falls back to `onOpenBookingAssistant`. */
  onOpenNewBooking?: (ctx: BookingContext) => void;
  /** "Add walk-in" from a technician column menu. */
  onOpenAddWalkIn?: (ctx: Omit<BookingContext, 'startAt' | 'availableDurationMinutes'> & { technicianId: ID | 'any' }) => void;
  /** "Open appointment" from the appointment sheet → host's full appointment workflow. */
  onOpenAppointment?: (appointment: Appointment) => void;
  /** Host override for View Day. When omitted the board shows its own day panel. */
  onViewTechnicianDay?: (technicianId: ID, date: ISODate) => void;
  /** State preservation around host workflows (spec §26). */
  initialState?: Partial<PersistedBoardState>;
  onStateChange?: (state: PersistedBoardState) => void;
  /** Host-provided actions for the legend action slot (left of Block time). */
  legendActions?: ReactNode;
  /** Hide the Day/Week/date/filter row when the host keeps its own. */
  showPrimaryToolbar?: boolean;
  /** Clock injection (tests / demos). */
  now?: () => Date;
  /** Minimum cell height used by Fit day (px). */
  minCellHeight?: number;
  /** Cell height when Fit day is off (px). */
  cellHeight?: number;
  /** Host words (EN / VI…) for every board string; English when omitted or when a key is unknown to the host. */
  translate?: BoardTranslate;
  /** integer cents → the salon's money text */
  formatMoney?: (cents: number) => string;
  /** Host-controlled Fit day (the host keeps its own toolbar). Omit to let the board own it. */
  fitDay?: boolean;
  /** Bring one technician into view (jump-to-technician): the board pages to them and selects the column. Change
   *  `nonce` to repeat the same technician. */
  focusTechnician?: { technicianId: ID; nonce: number } | null;
  /** What is on screen (date, visible technicians, their appointments) — the host scopes realtime refreshes with it. */
  onVisibleChange?: (v: { date: ISODate; technicianIds: ID[]; appointmentIds: ID[] }) => void;
  /** Optional read-only marks from the host (the AI Scheduling Optimizer's lock / conflict / suggestion / unused gap). */
  overlay?: BoardOverlay | null;
}

const DEFAULT_CELL = 18;
const DEFAULT_MIN_CELL = 11;

export function BookingScheduleBoard(p: BookingScheduleBoardProps) {
  return (
    <BoardTextProvider translate={p.translate} money={p.formatMoney}>
      <BoardInner {...p} />
    </BoardTextProvider>
  );
}

function BoardInner(p: BookingScheduleBoardProps) {
  const { t } = useBoardText();
  const errText = useCallback((code: BookingErrorCode) => t(`err.${code}`), [t]);
  const now = p.now ?? (() => new Date());
  const tzGuess = p.timezone ?? 'UTC';
  const today = todayIn(tzGuess, now());
  const [state, dispatch] = useReducer(boardReducer, undefined, () => initialBoardState(p.selectedDate ?? today, { fitDay: true, ...(p.initialState ?? {}) }));
  const serverPaged = p.adapter.pagesOnServer === true;
  const { store, reload, applyPatch } = useScheduleRange({ adapter: p.adapter, tenantId: p.tenantId, branchId: p.branchId, date: state.date, realtime: p.realtimeClient,
    ...(serverPaged ? { pageIndex: state.pageIndex, pageSize: state.perPage, workingOnly: state.workingOnly } : {}) });
  const fitDay = p.fitDay ?? state.fitDay;

  // host-controlled date (the POS keeps its own date navigation): follow it without resetting filters / page (spec §26)
  const firstDate = useRef(true);
  useEffect(() => {
    if (firstDate.current) { firstDate.current = false; return; }
    if (p.selectedDate) dispatch({ type: 'set-date', date: p.selectedDate });
  }, [p.selectedDate]);
  const timezone = store.range?.timezone ?? tzGuess;
  const nowDate = now();
  const nowMinute = dateOf(nowDate.toISOString(), timezone) === state.date ? minuteOfDay(nowDate.toISOString(), state.date, timezone) : null;
  const [services, setServices] = useState<Service[]>([]);
  const [bookingServiceId, setBookingServiceId] = useState<ID | null>(null);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<ID>>(new Set());
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewAll, setViewAll] = useState<{ technicianId: ID; left: number; top: number } | null>(null);
  const { toast, show: showToast, dismiss } = useToast();
  const rootRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const [viewportHeight, setViewportHeight] = useState(560);
  const idem = useRef(0);
  const userIdForKeys = p.userId;
  const nextKey = useCallback(() => `${userIdForKeys}-${Date.now()}-${++idem.current}`, [userIdForKeys]);

  // ---- services (once per scope) ------------------------------------------
  useEffect(() => {
    let cancelled = false;
    p.adapter.getServices({ tenantId: p.tenantId, branchId: p.branchId }).then((s) => {
      if (cancelled) return;
      setServices(s);
      setBookingServiceId((cur) => cur ?? s[0]?.id ?? null);
    }).catch(() => { /* services are optional for rendering; Find/Best report their own errors */ });
    return () => { cancelled = true; };
  }, [p.adapter, p.tenantId, p.branchId]);

  // ---- host state preservation ---------------------------------------------
  const persisted = toPersisted(state);
  const persistedKey = JSON.stringify(persisted);
  const onStateChange = p.onStateChange;
  useEffect(() => { onStateChange?.(persisted); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistedKey, onStateChange]);

  // ---- technicians, filters, paging ----------------------------------------
  const allSlices: TechnicianSlice[] = useMemo(() => store.order.map((id) => store.slices[id]).filter(Boolean), [store.order, store.slices]);
  const technicians = useMemo(() => allSlices.map((s) => s.technician), [allSlices]);
  // Columns = technicians actually on shift for this branch/date (spec §19: staff who are off are not counted or paged).
  // Server-paged: the range IS the page (the server filtered and counted); client-paged: page the working list here.
  const paging = serverPaged ? store.range?.paging : undefined;
  const workingSlices = useMemo(() => (paging ? allSlices : allSlices.filter((s) => s.ctx.working.length > 0)), [allSlices, paging]);
  const workingCount = paging ? paging.workingCount : workingSlices.length;
  const filtered = useMemo(() => (!paging && state.technicianIds.length ? workingSlices.filter((s) => state.technicianIds.includes(s.technician.id)) : workingSlices), [workingSlices, state.technicianIds, paging]);
  const page = paging ? pageInfo(paging.total, paging.pageSize, paging.page - 1) : pageInfo(filtered.length, state.perPage, state.pageIndex);
  const visible = paging ? filtered : filtered.slice(page.startIndex, page.endIndex);
  // the server clamps an out-of-range page (the roster shrank) — follow it so Previous / Next stay in step
  // (only when a NEW answer arrives — never while the next page is still loading)
  const pageIndexRef = useRef(state.pageIndex);
  pageIndexRef.current = state.pageIndex;
  useEffect(() => { if (paging && paging.page - 1 !== pageIndexRef.current) dispatch({ type: 'set-page', pageIndex: paging.page - 1 }); }, [paging]);
  const onVisibleChange = p.onVisibleChange;
  const visibleKey = `${state.date}|${visible.map((s) => s.technician.id).join(',')}|${visible.map((s) => s.appointments.map((a) => a.id).join(',')).join(';')}`;
  useEffect(() => {
    onVisibleChange?.({ date: state.date, technicianIds: visible.map((s) => s.technician.id), appointmentIds: visible.flatMap((s) => s.appointments.map((a) => a.id)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey, onVisibleChange]);
  const branchHours = store.range?.branchHours ?? { openAt: '09:00', closeAt: '20:00' };
  const dayStart = hhmmToMinutes(branchHours.openAt);
  const dayEnd = hhmmToMinutes(branchHours.closeAt);
  const cells = Math.max(1, (dayEnd - dayStart) / 15);
  const cellHeight = fitDay ? Math.max(p.minCellHeight ?? DEFAULT_MIN_CELL, Math.floor(viewportHeight / cells)) : (p.cellHeight ?? DEFAULT_CELL);
  const statusFilter = useMemo(() => (state.statuses.length ? new Set(state.statuses) : null), [state.statuses]);
  const totalOpenVisible = visible.reduce((n, s) => n + s.availability.reduce((m, g) => m + g.durationMinutes, 0), 0);

  // keep the selected technician's page in view when the filter/page size changes
  useEffect(() => {
    if (!state.selectedTechnicianId || serverPaged) return;
    const idx = filtered.findIndex((s) => s.technician.id === state.selectedTechnicianId);
    if (idx >= 0 && pageOfIndex(idx, state.perPage) !== state.pageIndex) dispatch({ type: 'set-page', pageIndex: pageOfIndex(idx, state.perPage) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.perPage, state.technicianIds]);

  // ---- bring a technician into view (Find an Opening / Best Matches pick, host jump-to-technician) ----------
  const goToTechnician = useCallback(async (technicianId: ID) => {
    dispatch({ type: 'select-technician', technicianId });
    if (!serverPaged) {
      const idx = filtered.findIndex((s) => s.technician.id === technicianId);
      if (idx >= 0) dispatch({ type: 'set-page', pageIndex: pageOfIndex(idx, state.perPage) });
      return;
    }
    if (visible.some((s) => s.technician.id === technicianId) || !p.adapter.locateTechnician) return;
    try {
      const loc = await p.adapter.locateTechnician({ tenantId: p.tenantId, branchId: p.branchId, technicianId, date: state.date, pageSize: state.perPage, workingOnly: state.workingOnly });
      if (loc) dispatch({ type: 'set-page', pageIndex: loc.pageIndex });
    } catch (e) {
      const err = toBookingError(e);
      showToast({ kind: 'error', message: errText(err.code) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverPaged, filtered, visible, state.perPage, state.date, state.workingOnly, p.adapter, p.tenantId, p.branchId, errText]);
  const focusNonce = p.focusTechnician?.nonce;
  const focusId = p.focusTechnician?.technicianId;
  useEffect(() => { if (focusId) void goToTechnician(focusId); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, focusNonce]);

  // ---- fit day measurement ---------------------------------------------------
  useLayoutEffect(() => {
    const el = boardRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const scroll = el.querySelector<HTMLElement>('.bsb-scroll');
      if (scroll) setViewportHeight(Math.max(120, scroll.clientHeight));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [store.status, state.view, state.fullScreen]);

  // ---- full screen -------------------------------------------------------------
  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement && state.fullScreen) dispatch({ type: 'set-full-screen', on: false }); };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [state.fullScreen]);
  const toggleFullScreen = useCallback(() => {
    const on = !state.fullScreen;
    dispatch({ type: 'set-full-screen', on });
    const el = rootRef.current;
    try {
      if (on && el?.requestFullscreen) void el.requestFullscreen().catch(() => undefined);
      else if (!on && document.fullscreenElement && document.exitFullscreen) void document.exitFullscreen().catch(() => undefined);
    } catch { /* CSS fallback mode handles it */ }
  }, [state.fullScreen]);

  // ---- host emits ---------------------------------------------------------------
  const emitBooking = useCallback((technicianId: ID, startMinute: number, availableDurationMinutes: number, serviceId?: ID, viaNewBooking = false) => {
    const ctx: BookingContext = {
      tenantId: p.tenantId, branchId: p.branchId, date: state.date, technicianId,
      startAt: toISO(state.date, startMinute, timezone), availableDurationMinutes,
      ...(serviceId ? { serviceId } : {}),
    };
    dispatch({ type: 'select-slot', slot: { technicianId, startMinute, durationMinutes: availableDurationMinutes } });
    if (viaNewBooking && p.onOpenNewBooking) p.onOpenNewBooking(ctx);
    else p.onOpenBookingAssistant(ctx);
  }, [p, state.date, timezone]);

  const bookGap = useCallback((technicianId: ID, gap: AvailabilityGap) => {
    emitBooking(technicianId, minuteOfDay(gap.startAt, state.date, timezone), gap.durationMinutes, bookingServiceId ?? undefined);
  }, [emitBooking, state.date, timezone, bookingServiceId]);

  const onViewDay = useCallback((technicianId: ID) => {
    if (p.onViewTechnicianDay) p.onViewTechnicianDay(technicianId, state.date);
    else dispatch({ type: 'open-panel', panel: { kind: 'technician-day', technicianId } });
  }, [p, state.date]);

  const onViewAll = useCallback((technicianId: ID, anchor: HTMLElement) => {
    const root = boardRef.current?.getBoundingClientRect();
    const r = anchor.getBoundingClientRect();
    if (!root) return;
    setViewAll({ technicianId, left: Math.max(4, Math.min(r.left - root.left, root.width - 240)), top: r.bottom - root.top + 4 });
  }, []);

  // ---- mutations (validated by the adapter / backend) -----------------------------
  const failWith = useCallback((e: unknown, fallbackReload = true) => {
    const err = toBookingError(e);
    setMutationError(errText(err.code));
    showToast({ kind: 'error', message: errText(err.code) });
    if (fallbackReload && ['APPOINTMENT_CONFLICT', 'SCHEDULE_CHANGED', 'UNKNOWN', 'BLOCKED_TIME_CONFLICT', 'APPOINTMENT_PROTECTION'].includes(err.code)) void reload();
    return err;
  }, [reload, showToast, errText]);

  const moveAppointment = useCallback(async ({ appointment, technicianId, startMinute }: MoveRequest) => {
    if (pendingIds.has(appointment.id)) return;
    const dur = minuteOfDay(appointment.endAt, state.date, timezone) - minuteOfDay(appointment.startAt, state.date, timezone);
    const optimistic: Appointment = { ...appointment, technicianId, startAt: toISO(state.date, startMinute, timezone), endAt: toISO(state.date, startMinute + dur, timezone) };
    setPendingIds((s) => new Set([...s, appointment.id]));
    setMutationError(null);
    applyPatch({ kind: 'upsert-appointment', appointment: optimistic, previousTechnicianId: appointment.technicianId });
    try {
      const saved = await p.adapter.moveAppointment({ tenantId: p.tenantId, branchId: p.branchId, appointmentId: appointment.id, expectedVersion: appointment.version, technicianId, startAt: optimistic.startAt, idempotencyKey: nextKey() });
      applyPatch({ kind: 'upsert-appointment', appointment: saved, previousTechnicianId: appointment.technicianId });
      showToast({ kind: 'info', message: t(saved.technicianId === appointment.technicianId ? 'toast.movedTime' : 'toast.movedTech', { name: appointment.customerName }) });
      dispatch({ type: 'close-panel' });
    } catch (e) {
      // Rollback: restore the original booking exactly (spec §20).
      applyPatch({ kind: 'upsert-appointment', appointment, previousTechnicianId: technicianId });
      failWith(e);
    } finally {
      setPendingIds((s) => { const n = new Set(s); n.delete(appointment.id); return n; });
    }
  }, [p.adapter, p.tenantId, p.branchId, state.date, timezone, pendingIds, applyPatch, showToast, failWith, t, nextKey]);

  const cancelAppointment = useCallback(async (a: Appointment, reason: string) => {
    setBusy(true);
    setMutationError(null);
    try {
      await p.adapter.cancelAppointment({ tenantId: p.tenantId, branchId: p.branchId, appointmentId: a.id, expectedVersion: a.version, reason: reason || null });
      applyPatch({ kind: 'remove-appointment', appointmentId: a.id, technicianId: a.technicianId });
      showToast({ kind: 'info', message: t('toast.cancelled', { name: a.customerName }) });
      dispatch({ type: 'close-panel' });
    } catch (e) { failWith(e); } finally { setBusy(false); }
  }, [p.adapter, p.tenantId, p.branchId, applyPatch, showToast, failWith, t]);

  const createBlockedTime = useCallback(async (input: Omit<CreateBlockedTimeInput, 'idempotencyKey'>) => {
    setBusy(true);
    setMutationError(null);
    try {
      const seg = await p.adapter.createBlockedTime({ ...input, idempotencyKey: nextKey() });
      applyPatch({ kind: 'upsert-segment', segment: seg });
      showToast({ kind: 'info', message: t('toast.blocked') });
      dispatch({ type: 'close-panel' });
    } catch (e) { failWith(e, false); } finally { setBusy(false); }
  }, [p.adapter, applyPatch, showToast, failWith, t, nextKey]);

  const pickOpening = useCallback((o: OpeningResult, serviceIds: ID[]) => {
    dispatch({ type: 'close-panel' });
    void goToTechnician(o.technicianId);
    emitBooking(o.technicianId, minuteOfDay(o.startAt, state.date, timezone), o.gapDurationMinutes, serviceIds[0], true);
  }, [goToTechnician, state.date, timezone, emitBooking]);

  const pickMatch = useCallback((m: TechnicianMatch, serviceId: ID) => {
    if (!m.earliestStartAt) return;
    dispatch({ type: 'close-panel' });
    void goToTechnician(m.technicianId);
    const slice = store.slices[m.technicianId];
    const start = minuteOfDay(m.earliestStartAt, state.date, timezone);
    const gap = slice?.availability.find((g) => minuteOfDay(g.startAt, state.date, timezone) <= start && minuteOfDay(g.endAt, state.date, timezone) > start);
    const avail = gap ? minuteOfDay(gap.endAt, state.date, timezone) - start : services.find((s) => s.id === serviceId)?.durationMinutes ?? 15;
    emitBooking(m.technicianId, start, avail, serviceId, true);
  }, [goToTechnician, state.date, timezone, store.slices, services, emitBooking]);

  const closePanel = useCallback(() => { dispatch({ type: 'close-panel' }); setMutationError(null); }, []);
  const openAppointment = useCallback((a: Appointment) => dispatch({ type: 'open-panel', panel: { kind: 'appointment', appointmentId: a.id } }), []);
  const panelAppointment = state.panel.kind === 'appointment' ? allSlices.flatMap((s) => s.appointments).find((a) => a.id === (state.panel as { appointmentId: ID }).appointmentId) ?? null : null;
  useEffect(() => { if (state.panel.kind === 'appointment' && !panelAppointment && store.status === 'ready') dispatch({ type: 'close-panel' }); }, [state.panel.kind, panelAppointment, store.status]);

  // ---- render ---------------------------------------------------------------------
  const rootClass = `bsb-root${state.fullScreen ? ' bsb-fullscreen' : ''}`;
  return (
    <div ref={rootRef} className={rootClass} data-testid="bsb-root" data-server-version={store.serverVersion}>
      {p.showPrimaryToolbar !== false && (
        <BookingToolbar
          date={state.date} timezone={timezone} today={today} view={state.view}
          services={services} serviceId={state.serviceId} statuses={state.statuses}
          fitDay={fitDay} fullScreen={state.fullScreen}
          onDate={(d) => dispatch({ type: 'set-date', date: d })}
          onShiftDate={(n) => dispatch({ type: 'shift-date', days: n })}
          onView={(v) => dispatch({ type: 'set-view', view: v })}
          onService={(id) => dispatch({ type: 'set-service', serviceId: id })}
          onStatuses={(s) => dispatch({ type: 'set-statuses', statuses: s })}
          onToggleFitDay={() => dispatch({ type: 'toggle-fit-day' })}
          onToggleFullScreen={toggleFullScreen}
        />
      )}
      <OpeningToolbar
        services={services} bookingServiceId={bookingServiceId} onBookingService={setBookingServiceId}
        onFindOpening={() => dispatch({ type: 'open-panel', panel: { kind: 'find-opening' } })}
        onBestMatches={() => dispatch({ type: 'open-panel', panel: { kind: 'best-matches' } })}
        technicians={technicians} workingCount={workingCount}
        technicianFilter={state.technicianIds} onTechnicianFilter={(ids) => dispatch({ type: 'set-technicians', technicianIds: ids })}
        serverFilter={paging ? { workingOnly: state.workingOnly, workingCount: paging.workingCount, totalAll: paging.totalAll, onWorkingOnly: (on) => dispatch({ type: 'set-working-only', on }) } : undefined}
        perPage={state.perPage} onPerPage={(n) => dispatch({ type: 'set-per-page', perPage: n })}
        page={page} onPrev={() => dispatch({ type: 'prev-page' })} onNext={() => dispatch({ type: 'next-page', pageCount: page.pageCount })}
      />

      <div ref={boardRef} className="bsb-board" data-testid="bsb-board" aria-busy={store.status === 'loading' || store.resyncing}>
        {store.status === 'loading' && (
          <div className="bsb-skeleton" aria-label={t('grid.loading')} data-testid="bsb-skeleton">{Array.from({ length: 13 }, (_, i) => <span key={i} />)}</div>
        )}
        {store.status === 'error' && (
          <div className="bsb-panel-body"><div className="bsb-error" role="alert">{errText(toBookingError(store.error).code)}</div><button type="button" className="bsb-btn" onClick={() => void reload()}>{t('grid.retry')}</button></div>
        )}
        {store.status === 'ready' && state.view === 'week' && (
          <WeekView adapter={p.adapter} tenantId={p.tenantId} branchId={p.branchId} date={state.date} today={today} timezone={timezone} technicians={visible.map((s) => s.technician)} onPickDay={(d) => { dispatch({ type: 'set-date', date: d }); dispatch({ type: 'set-view', view: 'day' }); }} />
        )}
        {store.status === 'ready' && state.view === 'day' && (
          <>
            <div className="bsb-head" style={{ ['--bsb-cols' as string]: visible.length }}>
              <div className="bsb-head-corner" />
              <div className="bsb-cols" role="row">
                {visible.map((slice, i) => (
                  <TechnicianHeader
                    key={slice.technician.id}
                    slice={slice}
                    sequence={paging?.rosterNumbers?.[slice.technician.id] ?? page.startIndex + i + 1}
                    selected={state.selectedTechnicianId === slice.technician.id}
                    canViewDay={p.permissions.canViewTechnicianDay}
                    canBlockTime={p.permissions.canBlockTime}
                    onViewDay={onViewDay}
                    onSelect={(id) => dispatch({ type: 'select-technician', technicianId: id })}
                    onBlockTime={(id) => dispatch({ type: 'open-panel', panel: { kind: 'block-time', technicianId: id } })}
                  />
                ))}
                {visible.length === 0 && <div className="bsb-tech bsb-muted" style={{ gridColumn: '1 / -1' }}>{t('grid.noTechs')}</div>}
              </div>
            </div>
            <div className="bsb-strip" style={{ ['--bsb-cols' as string]: visible.length }}>
              <div className="bsb-strip-caption"><b>{t('avail.caption')}</b> · {t('avail.captionHint')}</div>
              <StripLabel openMinutes={totalOpenVisible} />
              <div className="bsb-cols">
                {visible.map((slice) => (
                  <AvailabilityCell key={slice.technician.id} slice={slice} date={state.date} timezone={timezone} nowMinute={nowMinute} onViewAll={onViewAll} onBook={bookGap} />
                ))}
              </div>
            </div>
            <ScheduleGrid
              date={state.date} timezone={timezone} branchHours={branchHours}
              dayStart={dayStart} dayEnd={dayEnd} cellHeight={cellHeight}
              slices={visible} nowMinute={nowMinute}
              selectedTechnicianId={state.selectedTechnicianId} selectedSlot={state.selectedSlot}
              permissions={p.permissions} pendingIds={pendingIds}
              statusFilter={statusFilter} serviceFilter={state.serviceId}
              onBookSlot={(t, s, d) => emitBooking(t, s, d, bookingServiceId ?? undefined)}
              onOpenAppointment={openAppointment}
              onMove={(req) => void moveAppointment(req)}
              onScroll={(top) => dispatch({ type: 'set-scroll', scrollTop: top })}
              initialScrollTop={state.scrollTop}
              onSelectSlot={(slot) => dispatch({ type: 'select-slot', slot })}
              overlay={p.overlay ?? null}
            />
            <div className="bsb-bottom">
              <button type="button" className="bsb-btn" aria-label={t('bottom.prev')} onClick={() => dispatch({ type: 'prev-page' })} disabled={!page.hasPrevious}>‹</button>
              <div className="bsb-track" role="scrollbar" aria-valuemin={1} aria-valuemax={page.pageCount} aria-valuenow={page.pageIndex + 1} aria-label={t('bottom.pages')}
                onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); dispatch({ type: 'set-page', pageIndex: Math.min(page.pageCount - 1, Math.floor(((e.clientX - r.left) / r.width) * page.pageCount)) }); }}>
                <div className="bsb-thumb" style={{ left: `${(page.pageIndex / page.pageCount) * 100}%`, width: `${100 / page.pageCount}%` }} />
              </div>
              <button type="button" className="bsb-btn" aria-label={t('bottom.next')} onClick={() => dispatch({ type: 'next-page', pageCount: page.pageCount })} disabled={!page.hasNext}>›</button>
              <span className="bsb-hint">{t('bottom.hint')}</span>
              <TechnicianPager variant="bottom" page={page} onPrev={() => dispatch({ type: 'prev-page' })} onNext={() => dispatch({ type: 'next-page', pageCount: page.pageCount })} />
            </div>
          </>
        )}

        {viewAll && store.slices[viewAll.technicianId] && (
          <ViewAllPopover
            technicianId={viewAll.technicianId}
            technicianName={store.slices[viewAll.technicianId].technician.displayName}
            gaps={store.slices[viewAll.technicianId].availability}
            date={state.date} timezone={timezone} left={viewAll.left} top={viewAll.top}
            canBook={p.permissions.canBook}
            onBook={bookGap}
            onClose={() => setViewAll(null)}
          />
        )}
        {state.panel.kind === 'find-opening' && (
          <FindOpeningPanel adapter={p.adapter} tenantId={p.tenantId} branchId={p.branchId} date={state.date} timezone={timezone} services={services} technicians={technicians} initialServiceId={bookingServiceId} dayStart={dayStart} dayEnd={dayEnd} onPick={pickOpening} onClose={closePanel} />
        )}
        {state.panel.kind === 'best-matches' && bookingServiceId && (
          <BestMatchesPanel adapter={p.adapter} tenantId={p.tenantId} branchId={p.branchId} date={state.date} timezone={timezone} services={services} technicians={technicians} serviceId={bookingServiceId} dayStart={dayStart} dayEnd={dayEnd} nowMinute={nowMinute} onPick={pickMatch} onClose={closePanel} />
        )}
        {state.panel.kind === 'technician-day' && (
          <TechnicianDayPanel adapter={p.adapter} tenantId={p.tenantId} branchId={p.branchId} date={state.date} timezone={timezone} technicianId={state.panel.technicianId} onBook={(t, g) => { closePanel(); bookGap(t, g); }} onOpenAppointment={openAppointment} onClose={closePanel} />
        )}
        {state.panel.kind === 'block-time' && (
          <BlockTimeDialog tenantId={p.tenantId} branchId={p.branchId} date={state.date} timezone={timezone} technicians={workingSlices.map((s) => s.technician)} dayStart={dayStart} dayEnd={dayEnd} initialTechnicianId={state.panel.technicianId ?? state.selectedTechnicianId ?? undefined} initialStartMinute={state.panel.startMinute} busy={busy} error={mutationError} onSubmit={(i) => void createBlockedTime(i)} onClose={closePanel} />
        )}
        {panelAppointment && (
          <AppointmentPanel appointment={panelAppointment} date={state.date} timezone={timezone} technicians={technicians} dayStart={dayStart} dayEnd={dayEnd} permissions={p.permissions} busy={busy || pendingIds.has(panelAppointment.id)} error={mutationError} onOpenInHost={p.onOpenAppointment} onMove={(a, t, s) => void moveAppointment({ appointment: a, technicianId: t, startMinute: s })} onCancel={(a, r) => void cancelAppointment(a, r)} onClose={closePanel} />
        )}
        <Toast toast={toast} onDismiss={dismiss} />
      </div>

      <BookingLegend canBlockTime={p.permissions.canBlockTime} onBlockTime={() => dispatch({ type: 'open-panel', panel: { kind: 'block-time' } })} actions={p.legendActions} />
    </div>
  );
}

export type { BoardState };
