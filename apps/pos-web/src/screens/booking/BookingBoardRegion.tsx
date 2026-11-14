// BookingBoardRegion — the merged Booking Schedule Board (packages/booking-schedule-board) mounted in the Booking page's
// schedule region (Find an opening → legend / Block time). Everything above it (header, KPI cards, the Day / Week / date /
// filter toolbar) and everything below it (Booking Assistant · New Appointment, the list, the panels) stays the page's.
//
// Data: ProductionBookingDataAdapter on the EXISTING /pos/booking routes (server-paged technicians — 12 a page, 200 → 17
// pages — and the day grid of THOSE columns only). Live updates: the page's realtime (SSE + 15 s change feed, scoped by
// bookingRelevance) calls `realtime.bridge.resync(date)`; the board then reloads only its visible page.
// A tap on an open time PREFILLS the existing Booking Assistant (the board never creates an appointment itself).
import { useMemo, useRef, useState } from 'react';
import type { SchedCalendarIndicators } from '@aipowersalon/api-contracts/tenant';
import { schedToBoardOverlay } from './schedOverlay';
import { BookingScheduleBoard, HostScheduleBridge, MonotonicClock, ProductionBookingDataAdapter, minuteOfDay, minutesToHHmm,
  type BoardPermissions, type BoardTextKey, type BookingContext, type HostDayGridFilters, type HttpClient, type PersistedBoardState, type WireAppointmentRow, type WireCatalogService } from '@aipowersalon/booking-schedule-board';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posHttp } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useCan } from '../../components/usePermissions';
import { readSession, writeSession } from '../../components/useSessionState';
import { fmtMoney } from '../../i18n/format';
import './bookingBoard.css';

/** One clock for snapshot and event versions, one bridge the page's realtime pushes into (create once per page). */
export function createBoardRealtime(): { clock: MonotonicClock; bridge: HostScheduleBridge } {
  const clock = new MonotonicClock();
  return { clock, bridge: new HostScheduleBridge(clock) };
}

/** The board's words come from the POS `bsb` namespace (EN + VI). */
export const boardTranslate = (key: BoardTextKey, vars?: Record<string, string | number>): string => tx(`bsb.${key}`, vars);
const reasonText = (key: 'rank' | 'openSlots' | 'roster', vars: Record<string, number>) => tx(`bsb.best.reason.${key}`, vars);
/** The page's authenticated client (session cookie, client headers, 401 announcement) — it throws { status, code, body }. */
const http: HttpClient = {
  request: <T,>(method: string, path: string, body?: unknown, headers?: Record<string, string>) =>
    posHttp<T>(path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), ...(headers ? { headers } : {}) }),
};
/** Where the board's own state (date / page / filters / scroll) survives a trip into a booking workflow (spec §26). */
export const BOARD_STATE_KEY = 'aps.booking.board.state';

export interface BookingBoardRegionProps {
  date: string;
  timezone: string;
  services: { serviceId: string; name: string; priceCents?: number; durationMinutes?: number }[];
  /** the page toolbar's server filters (status / source / category / search / deposit / conflicts) */
  filters: HostDayGridFilters;
  fitDay: boolean;
  fullScreen: boolean;
  realtime: { clock: MonotonicClock; bridge: HostScheduleBridge };
  focusTechnician: { technicianId: string; nonce: number } | null;
  /** an open time / opening / match → prefill the existing Booking Assistant */
  onPrefill: (p: { technicianId: string; technicianName?: string; date: string; time: string; serviceId?: string }) => void;
  onExitFullScreen: () => void;
  /** open the page's full appointment view for a row of the visible page */
  onOpenAppointment: (row: WireAppointmentRow) => void;
  onVisibleChange: (v: { date: string; technicianIds: string[]; appointmentIds: string[] }) => void;
  /** the AI Scheduling Optimizer's indicators for this date (null = no package / no permission / none) — drawn read-only,
   *  the same lock / conflict / AI badge / unused gap marks as the Classic board */
  sched?: SchedCalendarIndicators | null;
  onOpenRec?: (recommendationId: string) => void;
}

export function BookingBoardRegion(p: BookingBoardRegionProps) {
  const { principal } = useAuth();
  const can = useCan();
  const tenantId = principal?.tenantId ?? '';
  const branchId = principal?.branchId ?? '';
  const userId = principal?.userId ?? '';
  // read at call time — the adapter keeps one identity per filter set (a filter change reloads the board's page)
  const live = useRef({ timezone: p.timezone, services: p.services, filters: p.filters });
  live.current = { timezone: p.timezone, services: p.services, filters: p.filters };
  const filterKey = JSON.stringify(p.filters);
  const names = useRef(new Map<string, string>());   // the loaded page's technician names (for the assistant's prefill note)
  const [rowsVersion, setRowsVersion] = useState(0);  // bumps when a page loads, so the optimizer badges name the right customer
  const adapter = useMemo(() => new ProductionBookingDataAdapter({
    http, realtime: p.realtime.bridge, clock: p.realtime.clock, reasonText,
    timezone: () => live.current.timezone || 'UTC',
    loadServices: async (): Promise<WireCatalogService[]> => live.current.services.map((s) => ({ serviceId: s.serviceId, name: s.name, durationMinutes: s.durationMinutes, priceCents: s.priceCents })),
    filters: () => live.current.filters,
    onRangeLoaded: ({ range }) => { for (const t of range.technicians) names.current.set(t.id, t.displayName); setRowsVersion((v) => v + 1); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [p.realtime, filterKey]);
  // UX gating only — the server enforces every one of these (spec §33)
  const permissions: BoardPermissions = {
    canBook: can('pos.booking.create'),
    canMove: can('pos.booking.reschedule'),
    canReassign: can('pos.booking.reschedule'),
    canCancel: can('pos.booking.cancel'),
    canBlockTime: can('pos.booking.edit'),
    canViewTechnicianDay: can('pos.booking.view'),
    canOverridePrice: false,   // the board never edits a price; the Booking Assistant keeps the authorised override
  };
  const sched = p.sched ?? null, onOpenRec = p.onOpenRec ?? null;
  const overlay = useMemo(() => schedToBoardOverlay(sched && sched.date === p.date ? sched : null,
    { customerNameOf: (id) => adapter.rows.get(id)?.customerName ?? '' }, onOpenRec),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [sched, p.date, adapter, rowsVersion]);
  const initialState = useMemo(() => readSession<Partial<PersistedBoardState>>(BOARD_STATE_KEY, {}), []);
  const prefill = (ctx: BookingContext) => {
    const tz = live.current.timezone || 'UTC';
    p.onPrefill({ technicianId: ctx.technicianId, technicianName: names.current.get(ctx.technicianId), date: ctx.date, time: minutesToHHmm(minuteOfDay(ctx.startAt, ctx.date, tz)), ...(ctx.serviceId ? { serviceId: ctx.serviceId } : {}) });
  };
  return (
    <section className={`pos-booking-board${p.fullScreen ? ' is-fullscreen' : ''}`} data-module-id="booking-schedule-board" data-testid="booking-schedule-board">
      {p.fullScreen ? <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 0' }}><button type="button" className="btn ghost" onClick={p.onExitFullScreen} data-testid="booking-board-exit-fs">{tx('bsb.toolbar.exitFullScreen')}</button></div> : null}
      <BookingScheduleBoard
        tenantId={tenantId} branchId={branchId} userId={userId} timezone={p.timezone || undefined}
        selectedDate={p.date} permissions={permissions} adapter={adapter} realtimeClient={p.realtime.bridge}
        showPrimaryToolbar={false} fitDay={p.fitDay}
        translate={boardTranslate} formatMoney={(c) => fmtMoney(c)}
        initialState={{ ...initialState, date: p.date }} onStateChange={(st) => writeSession(BOARD_STATE_KEY, st)}
        focusTechnician={p.focusTechnician}
        onOpenBookingAssistant={prefill} onOpenNewBooking={prefill}
        onOpenAppointment={(a) => { const row = adapter.rows.get(a.id); if (row) p.onOpenAppointment(row); }}
        onVisibleChange={p.onVisibleChange}
        overlay={overlay}
      />
    </section>
  );
}
