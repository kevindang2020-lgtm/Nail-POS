import SourceBadge from './SourceBadge';
import { ImeSafeInput } from '../components/ImeSafeInput';
import { viIncludes } from '@aipowersalon/api-contracts';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRealtime, syncStatus, type RefreshScope } from '../realtime/useRealtime';
import { bookingEventScope, bookingChangesScope, type BoardView } from '../realtime/bookingRelevance';
import { readFeedSweep } from '../realtime/bookingFeed';
import { useNavigate, Link } from 'react-router-dom';
import type { SchedCalendarIndicators, SchedConflict } from '@aipowersalon/api-contracts/tenant';
import { posAiSchedulingOptimizerApi } from '../api/posAiSchedulingOptimizerApi';
import { useCan } from '../components/usePermissions';
import { createIntentKeys } from '@aipowersalon/api-client';
import { posBookingApi, bookingConflictText, type BookingFilters } from '../api/posBookingApi';
import { BOOKING_TECH_PAGE_SIZE, type BookingTechnicianPage, type BookingTechnicianSummary, type BookingOpening, type BookingOpeningsResponse } from '@aipowersalon/api-contracts/tenant';
import { posCheckInApi } from '../api/posCheckInApi';
import { posQueueApi } from '../api/posQueueApi';
import { MoveAppointmentModal } from '../components/MoveAppointmentModal';
import { TechnicianPicker } from '../components/TechnicianPicker';
import { TechnicianPickerButton } from '../components/TechnicianPickerButton';
import { useIPadView } from '../components/IPadViewProvider';
import { appointmentRequest, customerRequest } from '../components/ipad-modules';
import { MembershipChip, useMemberStatusMap } from './MembershipChip';
import { ProfileAvatarWithPreview, resolveAvatarUrl, useInlineAsk, useEventCallback } from '@aipowersalon/ui';
import { t as tx, enPlural, getLanguage, currentLocale } from '@aipowersalon/mobile-sdk/i18n';
import { fmtMoney, fmtTime as fmtClock, fmtYmd } from '../i18n/format';
import { takeBookingHandoff } from '../api/posRebookingApi';

import { statusLabel } from '../i18n/status-label';
import { deviceToday } from '../lib/deviceToday';
// POS Booking — reads the real /pos/booking/state (POSBookingFullState) and now WIRES the full appointment lifecycle.
// Quick actions (no-body, idempotent): Check In, Move to Queue, Start Service. Per-appointment "Manage" drawer wires
// the previously-deferred body-carrying actions with their exact backend shapes: Assign Technician ({technicianId}),
// Reschedule ({startTime, date?, technicianId?}), No-Show ({reason}), Cancel ({reason}). Reschedule/assign may return
// 409 with a conflict — the surfaced message reflects that. Notify honestly surfaces { configured:false }.
type ServiceLine = { serviceName?: string; name?: string };
type Row = {
  appointmentId: string; customerId?: string; customerName: string; customerPhone?: string; isVip?: boolean; technicianId?: string; technicianName?: string;
  services: ServiceLine[]; source: string; startTime: string; endTime: string; durationMinutes: number;
  status: string; depositStatus?: string; conflictStatus?: string;
  version?: number;   // Smooth Refresh spec §15/§50: sent back as expectedVersion on drag/reschedule
  date?: string;      // the appointment's day (YYYY-MM-DD)
};
type BookingState = {
  kpis: { totalBookingsToday: number; confirmedBookings: number; checkedInBookings: number; waitingBookings: number; inServiceBookings: number; completedBookings: number; cancelledBookings: number; noShowBookings: number; onlineBookings: number; googleBookings: number; aiBookings: number; conflictCount: number; depositsCollectedCents: number };
  dateRange: { from: string; to: string; timezone: string };
  bookings: { items: Row[]; pagination?: { totalItems: number; page?: number; pageSize?: number; totalPages?: number } };
  filters: { statuses: string[]; sources: string[]; technicians: { technicianId: string; name: string }[]; services: { serviceId: string; name: string; priceCents?: number; durationMinutes?: number }[]; serviceCategories: string[]; branches: { branchId: string; name: string }[] };
  integrationStatus: { googleReserveConnected?: boolean; aiPhoneEnabled?: boolean; onlineBookingEnabled?: boolean; [k: string]: unknown };
  settings?: { openTime?: string; closeTime?: string; slotIntervalMinutes?: number; [k: string]: unknown };
  aggregates?: { walkInsToday: number; bookedRevenueCents: number; bookedMinutes: number; sourceCounts: { source: string; count: number }[]; serviceCounts: { name: string; count: number }[] };
};

const money = (c: number) => fmtMoney(c || 0);   // the salon's currency (i18n/format)
const tm = (iso?: string | null) => {
  if (!iso || iso.toLowerCase().includes('invalid')) return '—';
  try {
    const d = new Date(iso);
    if (!isNaN(d.getTime())) {
      return fmtClock(d);   // the branch's clock, the user's language
    }
  } catch {}
  const min = calMinutes(iso);
  if (min !== null && !isNaN(min)) {
    return clockOfMinutes(min);
  }
  return iso || '—';
};
const statusTone = (s?: string, qKey?: string, techStatus?: string, hasTech?: boolean) => {
  if (!s) return '';
  const st = s.toLowerCase();
  if (['confirmed', 'completed'].includes(st)) return 'ok';
  if (st === 'in_service' || techStatus === 'serving') return 'warn';
  if (['cancelled', 'no_show'].includes(st)) return 'bad';
  if (st === 'late') return 'bad';   // Decision 38: computed by the server (start passed, customer not here)
  if (techStatus === 'accepted') return 'ok';
  if (techStatus === 'assigned' || (hasTech && (st === 'checked_in' || !!qKey))) return 'info';
  if (st === 'checked_in' && qKey) return 'warn';
  if (['checked_in', 'arrived', 'booked'].includes(st)) return 'info';
  return '';
};
const formatStatusLabel = (s?: string, qKey?: string, techStatus?: string, hasTech?: boolean, startSource?: string) => {
  if (!s) return '—';
  const st = s.toLowerCase();
  if (st === 'in_service' || techStatus === 'serving') {
    return startSource === 'tech' ? tx('pos.in_service_tech') : startSource === 'pos' ? tx('pos.in_service_front_desk') : tx('pos.in_service_3');
  }
  if (st === 'no_show' || st === 'late' || st === 'cancelled' || st === 'completed') return statusLabel('appointment', st);
  if (techStatus === 'accepted') return statusLabel('techTicket', 'accepted');
  if (techStatus === 'assigned' || (hasTech && (st === 'checked_in' || !!qKey))) return statusLabel('techTicket', 'assigned');
  if (st === 'checked_in') return qKey ? tx('pos.in_queue_2') : tx('pos.checked_in_2');
  return statusLabel('appointment', st);
};
const svcNames = (r: ServiceLine[]) => r.map((x) => x.serviceName || x.name || '').filter(Boolean).join(', ');
const Line = ({ k, v, strong }: { k: string; v?: string; strong?: boolean }) => (<div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '2px 0', fontWeight: strong ? 700 : 400, color: '#4A4032' }}><span>{k}</span><span>{v}</span></div>);
const inputStyle: React.CSSProperties = { height: 34, border: '1px solid var(--line)', borderRadius: 9, padding: '0 10px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 12.5, color: 'var(--text)' };

const MIX_COLORS = ['#A96F22', '#2E7D32', '#C9971B', '#5B8DEF', '#C0392B', '#7E57C2', '#8A7A66'];
/** a booking source code → its label (the canonical source labels; "ai" on this board is the AI receptionist) */
const srcLabel = (code: string) => statusLabel('source', code === 'ai' ? 'ai_receptionist' : code);
function MixDonut({ title, items, sub }: { title: string; items: { label: string; count: number }[]; sub?: string }) {
  const total = items.reduce((a, x) => a + x.count, 0);
  if (total === 0) return (<section className="panel"><h2>{title}{sub ? <span className="s"> · {sub}</span> : null}</h2><div className="muted">{tx('pos.no_data_yet')}</div></section>);
  let acc = 0;
  const stops = items.map((x, i) => { const start = (acc / total) * 100; acc += x.count; const end = (acc / total) * 100; return `${MIX_COLORS[i % MIX_COLORS.length]} ${start}% ${end}%`; }).join(', ');
  return (
    <section className="panel">
      <h2>{title}{sub ? <span className="s"> · {sub}</span> : null}</h2>
      <div className="donut-wrap">
        <div className="donut" style={{ background: `conic-gradient(${stops})` }}><div className="donut-hole">{total}</div></div>
        <ul className="legend">
          {items.map((x, i) => (<li key={x.label}><span className="lg" style={{ background: MIX_COLORS[i % MIX_COLORS.length] }} />{x.label} · {Math.round((x.count / total) * 100)}%</li>))}
        </ul>
      </div>
    </section>
  );
}

// --- Calendar helpers: parse HH:MM (24h) or ISO -> minutes-since-midnight; format -> 9:00a ---
export const calMinutes = (t: string): number | null => {
  if (!t) return null;
  if (!t.includes('T') && !t.includes(' ')) { const m = /^(\d{1,2}):(\d{2})/.exec(t); if (m) return (+m[1]) * 60 + (+m[2]); }
  const d = new Date(t); if (!isNaN(d.getTime())) return d.getHours() * 60 + d.getMinutes();
  const m = /(\d{1,2}):(\d{2})/.exec(t); return m ? (+m[1]) * 60 + (+m[2]) : null;
};
/** the calendar axis label for minutes-since-midnight: "9:00a" in English, "9:00" (24-hour) in Vietnamese */
export const calLabel = (min: number): string => { const h = Math.floor(min / 60), mm = min % 60; if (getLanguage() === 'vi') return `${h}:${String(mm).padStart(2, '0')}`; const ap = h < 12 ? 'a' : 'p'; return `${(h % 12) || 12}:${String(mm).padStart(2, '0')}${ap}`; };
/** minutes-since-midnight as the user's clock ("2:30 PM" / "14:30") */
const clockOfMinutes = (min: number): string => { try { return new Intl.DateTimeFormat(currentLocale(), { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(Date.UTC(2000, 0, 1, Math.floor(min / 60), min % 60)); } catch { return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`; } };
// "Arriving Soon" (design picture) is NOT an API status — the server's vocabulary is booked/confirmed/arrived/checked_in/
// waiting/in_service/completed/cancelled/no_show, plus the computed displayStatus 'late' (Decision 38). It is a DERIVED presentation state: an appointment that has not
// checked in yet and starts within this many minutes. One constant, so the window is a one-line change.
export const ARRIVING_SOON_MINUTES = 15;
/** Pure (exported for tests): does this row read as "arriving soon" at `nowMinutes`? */
export const isArrivingSoon = (status: string, startMinutes: number, nowMinutes: number): boolean =>
  (status === 'booked' || status === 'confirmed')
  && startMinutes >= nowMinutes && startMinutes - nowMinutes <= ARRIVING_SOON_MINUTES;
const CAL_TONE: Record<string, { bg: string; bd: string; label: string }> = {
  arriving_soon: { bg: '#E8F1FB', bd: '#2A6BB0', get label() { return tx('pos.arriving_soon'); } },
  confirmed: { bg: '#E8F5E9', bd: '#2E7D32', get label() { return tx('pos.confirmed'); } }, booked: { bg: '#E8F5E9', bd: '#2E7D32', get label() { return tx('pos.booked'); } },
  arrived: { bg: '#E6F4F1', bd: '#2B7A6B', get label() { return tx('pos.arrived'); } }, late: { bg: '#FDECEA', bd: '#C0392B', get label() { return tx('pos.late'); } },   // Decision 38
  checked_in: { bg: '#E3F2FD', bd: '#1565C0', get label() { return tx('pos.checked_in_2'); } }, waiting: { bg: '#FFF3E0', bd: '#E8742B', get label() { return tx('pos.waiting_2'); } },
  in_service: { bg: '#FFF8E1', bd: '#A96F22', get label() { return tx('pos.in_service_3'); } }, completed: { bg: '#F2EFEA', bd: '#8A7A66', get label() { return tx('pos.done'); } },
  cancelled: { bg: '#FDECEA', bd: '#C0392B', get label() { return tx('pos.cancelled'); } }, no_show: { bg: '#FDECEA', bd: '#C0392B', get label() { return tx('pos.no_show'); } },
};

/** 200-technician mandate: Full Screen shows more columns, still a bounded server page (never 200 columns in the DOM). */
export const FULL_SCREEN_TECH_PAGE_SIZE = 24;
/** Week view: at most this many appointments listed per day (then "+N more" opens the day). */
export const WEEK_DAY_CAP = 8;
/** Monday of the week holding `isoDate` (YYYY-MM-DD, calendar arithmetic in UTC — no time zone shifts). */
export function weekStart(isoDate: string): string { const d = new Date(isoDate + 'T00:00:00Z'); const dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow); return d.toISOString().slice(0, 10); }
export function weekDays(mondayIso: string): string[] { return Array.from({ length: 7 }, (_, i) => { const d = new Date(mondayIso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); }); }
/** §19/§20 (200-technician mandate): the key of ONE board page — date, branch, every board filter, the technician
 *  filters and the page. The adjacent-page prefetch cache answers only an exact match (never a neighbouring date,
 *  filter set or page). The cache lives in the mounted board (one signed-in tenant session) and holds one entry. */
export function boardPageCacheKey(f: BookingFilters, tq: { working: boolean; search: string; pageSize: number }, page: number): string {
  return JSON.stringify([f.date ?? '', f.branchId ?? '', f.search ?? '', f.status ?? '', f.source ?? '', f.serviceCategory ?? '', f.depositStatus ?? '', f.conflictOnly ? 1 : 0,
    tq.working ? 1 : 0, tq.search, tq.pageSize, page]);
}
/** One page of the appointment LIST under the calendar (the calendar itself holds the whole day of its 12 columns). */
export const BOOKING_LIST_PAGE_SIZE = 50;
/** §19: how long a page must stay put before the next one is prefetched */
export const BOARD_PREFETCH_DELAY_MS = 400;
// ── schedule-grid pure helpers (exported for tests) ──
export type GridRange = { start: number; end: number; minutes?: number };
export type GridColumn = {
  technicianId: string; name: string; available: boolean; skills?: string[]; avatarUrl?: string | null; rating?: number | null; reviewCount?: number;
  windows: GridRange[]; blocked: { blockId?: string; startTime: string; endTime: string; reason: string }[];
  openRanges: { start: number; end: number; minutes: number }[]; openMinutes: number; openSlotCount: number;
};
export type DayGrid = {
  date: string; openTime: string; closeTime: string; slotIntervalMinutes: number; bufferMinutes: number;
  defaultServiceDurationMinutes: number; columns: GridColumn[]; totalOpenSlots: number;
  /** the whole day's appointments of THESE columns (+ the unassigned column), filtered like the board */
  appointments?: Row[];
};
export const calRangeLabel = (a: number, b: number): string => `${calLabel(a)}–${calLabel(b)}`;
export const calGapText = (minutes: number, end: number, trailing: boolean): string => trailing ? tx('pos.open_until_end', { end: String(calLabel(end)) }) : tx('pos.minutes_min_open', { minutes: String(minutes) });
export const calSnap = (minute: number, interval: number): number => Math.round(minute / interval) * interval;
/** Deep-scan (Oct 22 2026): the board drew only the FIRST PAGE of the day (the API's default 50, at most 100 a page) —
 *  a busy 24-technician day lost every later appointment from the grid without a word. It now asks for the largest page
 *  and follows the pagination to the end (bounded), so the board holds the whole day. */
export async function loadAllBookings(f: BookingFilters, maxPages = 20): Promise<any> {
  const first: any = await posBookingApi.state({ ...f, pageSize: 100, page: 1 });
  const pages = Math.min(Number(first?.bookings?.pagination?.totalPages) || 1, maxPages);
  if (pages <= 1 || !Array.isArray(first?.bookings?.items)) return first;
  const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => posBookingApi.appointments({ ...f, pageSize: 100, page: i + 2 })));
  const items = [...first.bookings.items, ...rest.flatMap((r: any) => (Array.isArray(r?.items) ? r.items : []))];
  return { ...first, bookings: { ...first.bookings, items } };
}
/** Best Matches: the earliest open start for the chosen service from GET /pos/booking/availability (which offers only
 *  technicians who may perform it, inside their schedules, around bookings and holds); on today, never a start already past. */
export function earliestOpening(rows: { technicianId: string; slots: string[] }[], notBefore?: string): { technicianId: string; time: string } | null {
  let best: { technicianId: string; time: string } | null = null;
  for (const r of rows || []) for (const t of r.slots || []) {
    if (notBefore && t < notBefore) continue;
    if (!best || t < best.time) best = { technicianId: r.technicianId, time: t };
  }
  return best;
}
export const calHHMM = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
// BUILD_PLAN Phase 7 — AI Scheduling Optimizer overlay (GET /pos/ai-scheduling-optimizer/calendar?date=). Read-only marks:
// the optimizer's unused gaps per technician, conflicts, open recommendations and locks. Anything that is not the
// contract's shape (no package, no permission, an older server) draws nothing.
export const isSchedIndicators = (x: unknown): x is SchedCalendarIndicators =>
  !!x && typeof x === 'object' && Array.isArray((x as SchedCalendarIndicators).gaps) && Array.isArray((x as SchedCalendarIndicators).conflicts)
  && !!(x as SchedCalendarIndicators).appointments && typeof (x as SchedCalendarIndicators).appointments === 'object';
const SEV_RANK: Record<SchedConflict['severity'], number> = { info: 1, warning: 2, critical: 3 };
/** the worst open conflict severity per appointment */
export function schedConflictByAppt(ind: SchedCalendarIndicators | null): Record<string, SchedConflict['severity']> {
  const out: Record<string, SchedConflict['severity']> = {};
  for (const c of ind?.conflicts ?? []) if (!c.resolved) for (const a of c.appointmentIds) if (!out[a] || SEV_RANK[c.severity] > SEV_RANK[out[a]]) out[a] = c.severity;
  return out;
}
/** §4.2 responsive density: compact technician-column width so ~`target` columns share the full-screen viewport.
 *  Never below 88px (readability floor), never above 170px (the standard-mode width) — a hard-coded width is
 *  exactly what this replaces. Returns the px min-width each column should get. */
export const calColMinWidth = (viewportW: number, timeColW: number, colCount: number, target = 20): number => {
  const usable = Math.max(320, viewportW - timeColW - 40);            // scrollbar + fs padding allowance
  const per = Math.floor(usable / Math.max(1, Math.min(colCount, target)));
  return Math.max(88, Math.min(170, per));
};
/** §6/§8 fit indicator: does a service of `serviceMinutes` fit inside an open range of `rangeMinutes`?
 *  null when no service is selected (no indicator shown). */
export const calFitsIn = (rangeMinutes: number, serviceMinutes: number | null | undefined): 'fits' | 'no-fit' | null =>
  serviceMinutes == null || serviceMinutes <= 0 ? null : serviceMinutes <= rangeMinutes ? 'fits' : 'no-fit';

// ── §3–§9 optimistic open-range recompute (frontend mirror of the backend pbOpenRanges) ──
// After a drag the appointment list moves instantly but the server-computed open ranges would stay stale until the
// authoritative refetch returns. To avoid a stale gap flash we recompute the affected column(s) locally with the
// SAME rule the backend uses: free = windows − each buffered blocking appointment, then (for today) drop past time.
// The authoritative grid from refetch replaces this shortly after; this only bridges the optimistic window.
const PB_BLOCKING_STATUSES = ['booked', 'confirmed', 'arrived', 'checked_in', 'in_service', 'waiting'];   // = CHAIR_HOLDING_STATUSES (Decision 38)
export type CalBusy = { startTime: string; endTime: string; status: string };
/** Subtract [s,e) from a set of ranges (minutes-of-day), returning the remaining sub-ranges. */
function calSubtract(ranges: GridRange[], s: number, e: number): GridRange[] {
  const out: GridRange[] = [];
  for (const r of ranges) {
    if (e <= r.start || s >= r.end) { out.push(r); continue; }   // no overlap
    if (s > r.start) out.push({ start: r.start, end: s });
    if (e < r.end) out.push({ start: e, end: r.end });
  }
  return out.filter((r) => r.end > r.start);
}
/** Continuous free ranges for one technician: windows minus every buffered blocking appointment, clamped to
 *  `notBeforeMinute` on the current day. Mirrors backend pbOpenRanges (buffer applied symmetrically). */
export function calRecomputeOpenRanges(
  windows: GridRange[], bufferMinutes: number, busy: CalBusy[], notBeforeMinute?: number | null,
): { start: number; end: number; minutes: number }[] {
  let free: GridRange[] = windows.map((w) => ({ start: w.start, end: w.end }));
  for (const a of busy) {
    if (PB_BLOCKING_STATUSES.indexOf(a.status) === -1) continue;
    const s = (calMinutes(a.startTime) ?? 0) - bufferMinutes;
    const e = (calMinutes(a.endTime) ?? 0) + bufferMinutes;
    free = calSubtract(free, s, e);
  }
  if (notBeforeMinute != null && notBeforeMinute > 0) {
    free = free.map((r) => ({ start: Math.max(r.start, notBeforeMinute), end: r.end })).filter((r) => r.end > r.start);
  }
  return free.map((r) => ({ start: r.start, end: r.end, minutes: r.end - r.start }));
}

function TechAvatar({ name, url, size = 26 }: { name: string; url?: string | null; size?: number }) {
  const initials = name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
  const resolvedUrl = resolveAvatarUrl(url);
  return resolvedUrl
    ? <img src={resolvedUrl} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: '1.5px solid #E4D7BE', flex: 'none' }} />
    : <span aria-hidden style={{ width: size, height: size, borderRadius: '50%', background: '#F1E3C8', color: '#A96F22', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: size * 0.42, border: '1.5px solid #E4D7BE', flex: 'none' }}>{initials}</span>;
}

// Open-Today summary state for one technician (spec §5): honest empty/off/unavailable states, never fabricated hours.
export function openTodayState(col: GridColumn | undefined): { kind: 'ranges' | 'full' | 'off' | 'unavailable' } {
  if (!col) return { kind: 'unavailable' };
  if (!col.available) return { kind: 'unavailable' };
  if (col.windows.length === 0) return { kind: 'off' };
  if (col.openRanges.length === 0) return { kind: 'full' };
  return { kind: 'ranges' };
}

function BookingCalendar({ rows, technicians, grid, openTime, closeTime, dateLabel, onPick, onSlotPick, onMove, fs, onFs, selectedServiceMinutes, assistant, onBlockAdd, onBlockRemove, controls, techPage = 1, techPageSize = 12, onTechPageChange, onTechPageSizeChange: _onTechPageSizeChange, nav, sched = null, onOpenRec, paging = null, highlightTechId = null }: {
  rows: Row[]; technicians: { technicianId: string; name: string }[]; grid: DayGrid | null;
  openTime?: string; closeTime?: string; dateLabel?: string;
  onPick?: (aid: string) => void;
  onSlotPick?: (technicianId: string, time: string) => void;
  /** `version` = the appointment's version when the drag STARTED (spec §50) — not whatever a background refresh brought in meanwhile. */
  onMove?: (aid: string, technicianId: string | undefined, time: string, version?: number) => void;
  fs: null | 'all' | string; onFs: (next: null | 'all' | string) => void;
  /** total minutes of the service(s) currently selected in the Booking Assistant — drives fits / does-not-fit hints */
  selectedServiceMinutes?: number | null;
  /** Booking Assistant body, rendered as a slide-over inside full-screen mode (§10) */
  assistant?: ReactNode;
  onBlockAdd?: (technicianId: string, startTime: string, endTime: string, reason: string) => Promise<void>;
  onBlockRemove?: (blockId: string) => Promise<void>;
  /** Date-nav + filter controls shown INSIDE View-All full screen (spec §2) so the receptionist keeps the date,
   *  search, and filters without the covered normal-page bar. Rendered only when fs === 'all'. */
  controls?: {
    date: string; onPrev: () => void; onNext: () => void; onToday: () => void; onDate: (d: string) => void;
    search: string; onSearch: (v: string) => void;
    status: string; onStatus: (v: string) => void; statuses: string[];
    source: string; onSource: (v: string) => void; sources: string[];
    techFilter: string; onTechFilter: (v: string) => void;
    workingToday: boolean; onWorkingToday: (v: boolean) => void;
  };
  techPage?: number;
  techPageSize?: number;
  onTechPageChange?: (p: number) => void;
  onTechPageSizeChange?: (s: number) => void;
  nav?: (p: string) => void;
  /** Phase 7: AI Scheduling Optimizer overlay for this date (null = none) + open one recommendation in the optimizer */
  sched?: SchedCalendarIndicators | null;
  onOpenRec?: (recommendationId: string) => void;
  /** 200-technician mandate (Oct 23 2026): the columns are ONE server page — never sliced or filtered here; the pager shows
   *  the server's numbers ("Page 17 of 17", "Technicians 193–200 of 200") */
  paging?: { total: number; page: number; totalPages: number; first: number; last: number; pageSize: number } | null;
  /** jump-to-technician: the column briefly highlighted after a search selection */
  highlightTechId?: string | null;
}) {
  const schedConflict = schedConflictByAppt(sched);
  const [openMenuTechId, setOpenMenuTechId] = useState<string | null>(null);
  const openMin = calMinutes(grid?.openTime || openTime || '') ?? 9 * 60;
  const closeMin = Math.max(openMin + 60, calMinutes(grid?.closeTime || closeTime || '') ?? 18 * 60);
  const interval = grid?.slotIntervalMinutes || 15;
  const isFs = fs !== null;
  const PX = isFs ? 1.15 : 0.85;
  const totalH = (closeMin - openMin) * PX;
  const gcols: GridColumn[] = grid?.columns ?? technicians.map((t) => ({
    technicianId: t.technicianId, name: t.name, available: true, windows: [], blocked: [], openRanges: [], openMinutes: 0, openSlotCount: 0,
  }));
  let cols = fs && fs !== 'all' ? gcols.filter((c) => c.technicianId === fs) : gcols;
  // View-All in-calendar filters (spec §2): technician search + Working Today. Applied only in fs==='all' so the
  // normal page and single-tech view are unaffected. Working Today = has at least one bookable window today.
  if (fs === 'all' && controls && !paging) {   // server-paged: search / working run on the server (the page IS the filter)
    const q = controls.search.trim();
    if (q) cols = cols.filter((c) => viIncludes(c.name, q));   // accent-insensitive (WP-E)
    if (controls.workingToday) cols = cols.filter((c) => c.windows.length > 0);
  }
  const hasUnassigned = rows.some((r) => !r.technicianId);
  if (hasUnassigned && !(fs && fs !== 'all')) cols = [...cols, { technicianId: '__none__', name: tx('pos.unassigned'), available: true, windows: [], blocked: [], openRanges: [], openMinutes: 0, openSlotCount: 0 }];

  const isSingleTech = fs !== null && fs !== 'all';
  const totalCols = paging ? paging.total : cols.length;
  const totalPages = paging ? paging.totalPages : Math.max(1, Math.ceil(totalCols / techPageSize));
  const activePage = paging ? paging.page : Math.min(Math.max(1, techPage), totalPages);
  const startIndex = paging ? Math.max(0, paging.first - 1) : isSingleTech ? 0 : (activePage - 1) * techPageSize;
  const endIndex = paging ? paging.last : isSingleTech ? totalCols : Math.min(totalCols, startIndex + techPageSize);
  // server-paged: the columns already ARE the page (never 200 columns in the DOM); client-paged (older callers): slice
  const visibleCols = (paging || isSingleTech || fs === 'all') ? cols : cols.slice(startIndex, endIndex);
  const byCol: Record<string, Row[]> = {};
  for (const r of rows) { const key = r.technicianId || '__none__'; (byCol[key] ||= []).push(r); }
  const hours: number[] = []; for (let m = Math.ceil(openMin / 60) * 60; m <= closeMin; m += 60) hours.push(m);
  const quarters: number[] = []; for (let m = Math.ceil(openMin / interval) * interval; m <= closeMin; m += interval) if (m % 60 !== 0) quarters.push(m);
  const today = new Date(); const isToday = grid?.date === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const nowMin = today.getHours() * 60 + today.getMinutes();
  const [drag, setDrag] = useState<{ aid: string; dur: number; col: string; snapped: number } | null>(null);
  // §4.2 responsive density — full-screen View-All shares the viewport across up to ~20 compact columns.
  const [vw, setVw] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1440));
  useEffect(() => {
    if (!(isFs && fs === 'all')) return;
    const onR = () => setVw(window.innerWidth);
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, [isFs, fs]);
  const colMin = fs === 'all' ? calColMinWidth(vw, 56, cols.length) : 170;
  const dense = colMin < 150;                                   // triggers 2-line wrapping + icon-compact cards
  const colW = fs && fs !== 'all' ? '1 1 auto' : `1 0 ${colMin}px`;
  // §6 Open-Today overflow: show the first ranges, expose the rest behind "+N more" per technician.
  const [moreOpen, setMoreOpen] = useState<Record<string, boolean>>({});
  const CHIP_LIMIT = dense ? 2 : 3;
  // §10 Booking-Assistant slide-over inside full-screen mode.
  const [assistOpen, setAssistOpen] = useState(false);
  useEffect(() => { if (!isFs) setAssistOpen(false); }, [isFs]);
  // §9 block-time mini-form (single-technician full screen).
  const [blockForm, setBlockForm] = useState<null | { start: string; end: string; reason: string; busy?: boolean; err?: string }>(null);
  useEffect(() => { setBlockForm(null); }, [fs]);
  // §10 restore the standard-mode scroll position after closing full screen.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const savedScroll = useRef<{ t: number; l: number } | null>(null);
  const prevFs = useRef<typeof fs>(fs);
  useEffect(() => {
    if (prevFs.current === null && fs !== null && scrollRef.current) savedScroll.current = { t: scrollRef.current.scrollTop, l: scrollRef.current.scrollLeft };
    if (prevFs.current !== null && fs === null && savedScroll.current) {
      const v = savedScroll.current;
      requestAnimationFrame(() => { if (scrollRef.current) { scrollRef.current.scrollTop = v.t; scrollRef.current.scrollLeft = v.l; } });
    }
    prevFs.current = fs;
  }, [fs]);

  // ── §13 unified pointer drag: mouse/trackpad drag immediately after a small move; touch begins after a
  // 350 ms long-press (a scroll before that cancels via pointercancel); edge proximity auto-scrolls the container;
  // Escape cancels; release commits through onMove (server re-validates — optimistic update rolls back on reject).
  const dragRef = useRef<null | { aid: string; dur: number; pointerId: number; startX: number; startY: number; active: boolean; isTouch: boolean; version?: number }>(null);
  const dragStateRef = useRef<typeof drag>(null);
  useEffect(() => { dragStateRef.current = drag; }, [drag]);
  const lpTimer = useRef<number | null>(null);
  const blockTouchScroll = useRef<((e: TouchEvent) => void) | null>(null);
  const clearLp = () => { if (lpTimer.current != null) { window.clearTimeout(lpTimer.current); lpTimer.current = null; } };
  const samePointer = (e: PointerEvent, d: { pointerId: number }) => e.pointerId == null || e.pointerId === d.pointerId;
  const endDrag = useEventCallback((commit: boolean) => {
    const d = dragRef.current;
    const cur = dragStateRef.current;
    clearLp();
    if (blockTouchScroll.current) { window.removeEventListener('touchmove', blockTouchScroll.current); blockTouchScroll.current = null; }
    dragRef.current = null;
    if (commit && d?.active && cur && onMove) {
      const tech = cur.col === '__none__' ? undefined : cur.col;
      onMove(cur.aid, tech, calHHMM(cur.snapped), d.version);
    }
    setDrag(null);
    return d;
  });
  const activateDrag = (aid: string, dur: number, colId: string, startMin: number, isTouch: boolean) => {
    if (dragRef.current) dragRef.current.active = true;
    setDrag({ aid, dur, col: colId, snapped: startMin });
    if (isTouch) {
      const stop = (e: TouchEvent) => e.preventDefault();       // freeze native scrolling while a touch drag is live
      blockTouchScroll.current = stop;
      window.addEventListener('touchmove', stop, { passive: false });
    }
  };
  const trackPointer = useEventCallback((clientX: number, clientY: number) => {
    const el = typeof document !== 'undefined' ? (document.elementFromPoint(clientX, clientY)?.closest('[data-cal-col]') as HTMLElement | null) : null;
    const d = dragRef.current;
    if (!el || !d?.active) return;
    const colId = el.getAttribute('data-cal-col') || '';
    const rect = el.getBoundingClientRect();
    const raw = openMin + (clientY - rect.top) / PX;
    const snapped = Math.max(openMin, Math.min(closeMin - d.dur, calSnap(raw, interval)));
    setDrag((cur) => (cur ? { ...cur, col: colId, snapped } : cur));
    // §11 edge auto-scroll while dragging near the container edges
    const box = scrollRef.current;
    if (box) {
      const b = box.getBoundingClientRect(); const EDGE = 44, STEP = 14;
      if (clientX > b.right - EDGE) box.scrollLeft += STEP; else if (clientX < b.left + 56 + EDGE) box.scrollLeft -= STEP;
      if (clientY > b.bottom - EDGE) box.scrollTop += STEP; else if (clientY < b.top + EDGE) box.scrollTop -= STEP;
    }
  });
  useEffect(() => {
    const onMoveEvt = (e: PointerEvent) => {
      const d = dragRef.current; if (!d || !samePointer(e, d)) return;
      const dx = Math.abs(e.clientX - d.startX), dy = Math.abs(e.clientY - d.startY);
      if (!d.active) {
        if (d.isTouch) { if (dx > 10 || dy > 10) { clearLp(); dragRef.current = null; setDrag(null); } return; }  // moved → let the page scroll
        if (dx > 4 || dy > 4) d.active = true;                                                                    // mouse: activate on first real move
        else return;
      }
      trackPointer(e.clientX, e.clientY);
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current; if (!d || !samePointer(e, d)) return;
      const wasActive = d.active; const aid = d.aid;
      endDrag(true);
      if (!wasActive && onPick) onPick(aid);                     // press without drag = open the appointment
    };
    const onCancel = (e: PointerEvent) => { const d = dragRef.current; if (d && samePointer(e, d)) endDrag(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && dragRef.current?.active) { e.stopPropagation(); endDrag(false); } };
    window.addEventListener('pointermove', onMoveEvt);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointermove', onMoveEvt);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
    };
     
  }, [onMove, onPick, openMin, closeMin, interval, PX, trackPointer, endDrag]);
  const cardPointerDown = (e: React.PointerEvent, a: Row, colId: string, startMin: number, dur: number, draggable: boolean) => {
    if ((globalThis as any).__DND_DEBUG) console.log("DBG down", e.pointerType, e.pointerId, e.clientX, e.clientY, draggable);
    if (!draggable) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const isTouch = e.pointerType === 'touch';
    dragRef.current = { aid: a.appointmentId, dur, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, active: false, isTouch, version: (a as any).version };
    if (isTouch) {
      clearLp();
      lpTimer.current = window.setTimeout(() => { if (dragRef.current?.aid === a.appointmentId) activateDrag(a.appointmentId, dur, colId, startMin, true); }, 350);
    } else {
      setDrag({ aid: a.appointmentId, dur, col: colId, snapped: startMin });   // preview arms; activates on first move
    }
  };

  useEffect(() => {
    if (!isFs) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onFs(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFs, onFs]);

  // Shaded (non-working) segments per column = complement of windows inside store hours.
  const shadeFor = (c: GridColumn): GridRange[] => {
    if (!grid) return [];
    const out: GridRange[] = []; let cursor = openMin;
    for (const w of [...c.windows].sort((a, b) => a.start - b.start)) { if (w.start > cursor) out.push({ start: cursor, end: w.start }); cursor = Math.max(cursor, w.end); }
    if (cursor < closeMin) out.push({ start: cursor, end: closeMin });
    return out;
  };

  const singleCol = fs && fs !== 'all' ? gcols.find((c) => c.technicianId === fs) : null;
  const singleStats = singleCol ? (() => {
    const appts = (byCol[singleCol.technicianId] || []).filter((a) => !['cancelled', 'no_show'].includes(a.status));
    const booked = appts.reduce((a, r) => a + (r.durationMinutes || 0), 0);
    const windowMin = singleCol.windows.reduce((a, w) => a + (w.end - w.start), 0);
    return { appts: appts.length, booked, open: singleCol.openMinutes, util: windowMin ? Math.min(100, Math.round((booked / windowMin) * 100)) : null };
  })() : null;

  const body = (
    <section className="panel mb-4" style={isFs ? { position: 'fixed', inset: 0, zIndex: 60, margin: 0, borderRadius: 0, overflow: 'auto', background: '#FBF6EC', padding: 18 } : undefined} aria-label={fs && fs !== 'all' ? tx('pos.full_day_schedule_for_v0', { v0: String(singleCol?.name ?? '') }) : tx('pos.booking_calendar')}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
        {singleCol ? (
          <>
            <TechAvatar name={singleCol.name} url={singleCol.avatarUrl} size={44} />
            <div style={{ flex: 1, minWidth: 200 }}>
              <h2 style={{ margin: 0 }}>{singleCol.name} <span className="s">· {dateLabel || grid?.date || 'today'}</span></h2>
              <div className="s" style={{ marginTop: 2 }}>
                {singleStats ? <>{singleStats.appts} {tx('pos.appointment_2')}{enPlural(singleStats.appts === 1 ? '' : 's')} · {singleStats.booked} {tx('pos.min_booked')}{' '}{singleStats.open} {tx('pos.min_open')}{singleStats.util != null ? tx('pos.util_utilized', { util: String(singleStats.util) }) : ''}</> : null}
              </div>
            </div>
          </>
        ) : (
          <h2 style={{ margin: 0, flex: 1 }}>{tx('pos.schedule')}{' '}<span className="s">· {dateLabel || 'today'} {tx('pos.by_technician')}{grid ? tx('pos.totalopenslots_open_slots', { totalOpenSlots: String(grid.totalOpenSlots) }) : ''}</span></h2>
        )}
        {!isFs ? <button className="btn ghost" onClick={() => onFs('all')} title={tx('pos.open_the_full_screen_calendar')}>{tx('pos.view_all_techs')}</button> : null}
        {isFs && assistant ? <button className="btn ghost" onClick={() => setAssistOpen((v) => !v)} aria-expanded={assistOpen} title={tx('pos.open_the_booking_assistant')}>{assistOpen ? tx('pos.hide_assistant') : tx('pos.booking_assistant')}</button> : null}
        {isFs && fs !== 'all' && onBlockAdd && singleCol ? <button className="btn ghost" onClick={() => setBlockForm((f) => (f ? null : { start: '', end: '', reason: '' }))} aria-expanded={!!blockForm}>{tx('pos.block_time')}</button> : null}
        {isFs ? <button className="btn" onClick={() => onFs(null)} aria-label={tx('pos.close_full_screen_calendar')}>{tx('pos.close_2')}</button> : null}
      </div>
      {fs === 'all' && controls ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '10px 0 6px' }} aria-label={tx('pos.schedule_controls')}>
          <button className="btn ghost" onClick={controls.onPrev} aria-label={tx('pos.previous_day')}>‹</button>
          <input type="date" aria-label={tx('pos.calendar_date')} value={controls.date} onChange={(e) => controls.onDate(e.target.value)} style={{ font: 'inherit', padding: '5px 9px', border: '1px solid var(--line)', borderRadius: 8, background: '#FFFDF8' }} />
          <button className="btn ghost" onClick={controls.onNext} aria-label={tx('pos.next_day')}>›</button>
          <button className="btn ghost" onClick={controls.onToday}>{tx('pos.today_2')}</button>
          <ImeSafeInput placeholder={tx('pos.search_technicians')} aria-label={tx('pos.technician_search')} value={controls.search} onValue={controls.onSearch} style={{ font: 'inherit', padding: '5px 9px', border: '1px solid var(--line)', borderRadius: 8, background: '#FFFDF8', minWidth: 150 }} />
          <select aria-label={tx('pos.status_filter')} value={controls.status} onChange={(e) => controls.onStatus(e.target.value)} style={{ font: 'inherit', padding: '5px 9px', border: '1px solid var(--line)', borderRadius: 8, background: '#FFFDF8' }}>
            <option value="">{tx('pos.all_statuses')}</option>
            {controls.statuses.map((x) => <option key={x} value={x}>{statusLabel('appointment', x)}</option>)}
          </select>
          <select aria-label={tx('pos.source_filter')} value={controls.source} onChange={(e) => controls.onSource(e.target.value)} style={{ font: 'inherit', padding: '5px 9px', border: '1px solid var(--line)', borderRadius: 8, background: '#FFFDF8' }}>
            <option value="">{tx('pos.all_sources')}</option>
            {controls.sources.map((x) => <option key={x} value={x}>{statusLabel('source', x)}</option>)}
          </select>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
            <input type="checkbox" checked={controls.workingToday} onChange={(e) => controls.onWorkingToday(e.target.checked)} /> {tx('pos.working_today')}
          </label>
        </div>
      ) : null}
      {isFs && fs !== 'all' && blockForm && singleCol && onBlockAdd ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '8px 0', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10, background: '#FFFDF8' }}>
          <span className="s">{tx('pos.block')}{' '}{singleCol.name} ·</span>
          <input type="time" aria-label={tx('pos.block_start')} value={blockForm.start} onChange={(e) => setBlockForm((f) => f && ({ ...f, start: e.target.value }))} style={{ font: 'inherit', padding: '4px 8px', border: '1px solid var(--line)', borderRadius: 8 }} />
          <span className="s">{tx('pos.to')}</span>
          <input type="time" aria-label={tx('pos.block_end')} value={blockForm.end} onChange={(e) => setBlockForm((f) => f && ({ ...f, end: e.target.value }))} style={{ font: 'inherit', padding: '4px 8px', border: '1px solid var(--line)', borderRadius: 8 }} />
          <input placeholder={tx('pos.reason_break_training')} aria-label={tx('pos.block_reason')} value={blockForm.reason} onChange={(e) => setBlockForm((f) => f && ({ ...f, reason: e.target.value }))} style={{ font: 'inherit', padding: '4px 8px', border: '1px solid var(--line)', borderRadius: 8, minWidth: 180 }} />
          <button className="btn" disabled={!!blockForm.busy || !blockForm.start || !blockForm.end} onClick={async () => {
            setBlockForm((f) => f && ({ ...f, busy: true, err: undefined }));
            try { await onBlockAdd(singleCol.technicianId, blockForm.start, blockForm.end, blockForm.reason.trim() || 'unavailable'); setBlockForm(null); }
            catch (e: any) { setBlockForm((f) => f && ({ ...f, busy: false, err: e?.message || tx('pos.could_not_block_that_window') })); }
          }}>{tx('pos.save_block')}</button>
          <button className="btn ghost" onClick={() => setBlockForm(null)}>{tx('pos.cancel')}</button>
          {blockForm.err ? <span className="s" style={{ color: '#B3261E' }}>{blockForm.err}</span> : null}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '8px 0', fontSize: 11.5, color: 'var(--muted)' }}>
        {Object.entries(CAL_TONE).filter(([k]) => !['booked'].includes(k)).map(([k, t]) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: t.bd }} />{t.label}</span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, border: '1.5px dashed #B9A778', background: '#FFFDF8' }} />{tx('pos.open_slot')}</span>
      </div>
      <div
        ref={scrollRef}
        className="w-full max-w-full min-w-0 overflow-auto border border-[var(--line)] rounded-[10px] bg-white"
        style={{
          maxHeight: isFs
            ? (fs === 'all' ? 'calc(100vh - 150px)' : 'calc(100vh - 130px)')
            : 560,
        }}
      >
        <div className="min-w-[700px]">
        {/* header: avatar + name + shift + open-count — sticky on vertical scroll */}
        <div style={{ display: 'flex', position: 'sticky', top: 0, background: '#fff', zIndex: 4, borderBottom: '1px solid var(--line)', minWidth: 'max-content' }}>
          <div style={{ flex: '0 0 56px', position: 'sticky', left: 0, background: '#fff', zIndex: 5 }} />
          {visibleCols.map((c, idx) => {
            const win = c.windows.length ? calRangeLabel(c.windows[0].start, c.windows[c.windows.length - 1].end) : null;
            const techNum = String(startIndex + idx + 1).padStart(2, '0');
            return (
              <div key={c.technicianId} data-technician-column={c.technicianId} data-highlighted={highlightTechId === c.technicianId ? 'true' : undefined}
                style={{ flex: colW, minWidth: colMin, padding: dense ? '6px 6px' : '8px 10px', borderLeft: '1px solid var(--line)', ...(highlightTechId === c.technicianId ? { outline: '3px solid var(--aps-orange)', outlineOffset: -3, background: '#FFF4E5', transition: 'background 300ms' } : {}) }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#9E8E7A' }}>{c.technicianId !== '__none__' ? techNum : '—'}</span>
                  {c.technicianId !== '__none__' ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
                      <button
                        type="button"
                        onClick={() => onFs(fs === c.technicianId ? null : c.technicianId)}
                        title={tx('pos.view_name_s_day', { name: String(c.name) })}
                        style={{ background: 'none', border: 'none', padding: 0, fontSize: 11, fontWeight: 600, color: 'var(--aps-orange)', cursor: 'pointer' }}
                      >{tx('pos.view_day')}</button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setOpenMenuTechId(openMenuTechId === c.technicianId ? null : c.technicianId); }}
                        title={tx('pos.options')}
                        aria-label={tx('pos.technician_actions')}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, padding: '0 2px', color: 'var(--muted)', lineHeight: 1 }}
                      >⋮</button>
                      {openMenuTechId === c.technicianId ? (
                        <div style={{ position: 'absolute', right: 0, top: 22, background: '#fff', border: '1px solid var(--line)', borderRadius: 8, boxShadow: '0 4px 14px rgba(0,0,0,0.12)', zIndex: 20, minWidth: 130, padding: 4 }}>
                          <button type="button" onClick={() => { setOpenMenuTechId(null); onFs(c.technicianId); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', background: 'none', border: 'none', fontSize: 12, cursor: 'pointer', borderRadius: 4 }}>{tx('pos.view_day_2')}</button>
                          <button type="button" onClick={() => { setOpenMenuTechId(null); nav?.(`/booking/new?technicianId=${encodeURIComponent(c.technicianId)}&date=${encodeURIComponent(dateLabel || grid?.date || '')}`); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', background: 'none', border: 'none', fontSize: 12, cursor: 'pointer', borderRadius: 4 }}>{tx('pos.add_booking')}</button>
                          <button type="button" onClick={() => { setOpenMenuTechId(null); if (onBlockAdd) setBlockForm({ start: '13:00', end: '14:00', reason: tx('pos.break') }); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', background: 'none', border: 'none', fontSize: 12, cursor: 'pointer', borderRadius: 4 }}>{tx('pos.block_time_2')}</button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => c.technicianId !== '__none__' && onFs(fs === c.technicianId ? null : c.technicianId)}
                  title={c.technicianId === '__none__' ? undefined : tx('pos.open_name_s_full_day', { name: String(c.name) })}
                  style={{ display: 'flex', alignItems: 'center', gap: dense ? 6 : 8, background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: c.technicianId === '__none__' ? 'default' : 'pointer', textAlign: 'left', width: '100%' }}
                >
                  {c.technicianId !== '__none__' ? <TechAvatar name={c.name} url={c.avatarUrl} size={dense ? 24 : 28} /> : null}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: dense ? 11.5 : 12.5, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                    <div className="s" style={{ fontSize: dense ? 9.5 : 10.5 }}>{win ? win : c.technicianId === '__none__' ? tx('pos.unassigned') : grid ? (c.available ? tx('pos.store_hours') : tx('pos.unavailable')) : '—'}</div>
                  </div>
                </button>
              </div>
            );
          })}
        </div>
        {/* Pinned Open Times mint band (Section B6 + §6) */}
        <div style={{ display: 'flex', borderBottom: '1px solid #B8E2CB', background: '#EAF7F0', minWidth: 'max-content' }}>
          <div style={{ flex: '0 0 56px', padding: '6px 4px', textAlign: 'center', position: 'sticky', left: 0, background: '#EAF7F0', zIndex: 3, borderRight: '1px solid #B8E2CB', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontSize: 9.5, fontWeight: 800, color: '#1B5E20' }}>{tx('pos.8_9_am')}</div>
            <div style={{ fontSize: 7.5, fontWeight: 700, color: '#2E7D32', textTransform: 'uppercase', letterSpacing: '0.4px', marginTop: 1 }}>{tx('pos.open_times')}</div>
            <span title={tx('pos.pinned_availability_summary_band_tap_any_7wsp')} style={{ fontSize: 10, color: '#2E7D32', cursor: 'help', marginTop: 2 }}>ⓘ</span>
            <div className="s" style={{ fontSize: 8.5, color: '#2E7D32', marginTop: 2 }}>{tx('pos.open_today')}</div>
          </div>
          {visibleCols.map((c) => {
            const st = openTodayState(c.technicianId === '__none__' ? undefined : c);
            const expanded = !!moreOpen[c.technicianId];
            const shown = expanded ? c.openRanges : c.openRanges.slice(0, CHIP_LIMIT);
            const hidden = c.openRanges.length - shown.length;
            return (
              <div key={c.technicianId} style={{ flex: colW, minWidth: colMin, padding: '5px 7px', borderLeft: '1px solid #B8E2CB', display: 'flex', flexWrap: 'wrap', gap: 4, alignContent: 'flex-start', alignItems: 'center' }}>
                {c.technicianId === '__none__' ? <span className="s" style={{ fontSize: 10.5 }}>—</span>
                  : !grid || st.kind === 'unavailable' ? <span className="s" style={{ fontSize: 10.5 }}>{tx('pos.schedule_unavailable')}</span>
                  : st.kind === 'off' ? <span className="s" style={{ fontSize: 10.5 }}>{tx('pos.off_today')}</span>
                  : st.kind === 'full' ? <span className="s" style={{ fontSize: 10.5, color: '#B3261E' }}>{tx('pos.fully_booked')}</span>
                  : (
                    <>
                      {shown.map((r) => {
                        const fit = calFitsIn(r.minutes, selectedServiceMinutes);
                        return (
                          <button
                            key={r.start}
                            onClick={() => onSlotPick?.(c.technicianId, calHHMM(r.start))}
                            title={tx('pos.book_name_v1_minutes_min_v3', { name: String(c.name), v1: String(calRangeLabel(r.start, r.end)), minutes: String(r.minutes), v3: String(fit === 'no-fit' ? tx('pos.selected_service_needs_selectedserviceminutes_min_does_6kzy', { selectedServiceMinutes: String(selectedServiceMinutes) }) : fit === 'fits' ? tx('pos.selected_service_fits') : '') })}
                            aria-label={tx('pos.open_v0_minutes_minutes_v2', { v0: String(calRangeLabel(r.start, r.end)), minutes: String(r.minutes), v2: String(fit === 'no-fit' ? tx('pos.selected_service_does_not_fit') : fit === 'fits' ? tx('pos.selected_service_fits_2') : '') })}
                            style={{
                              font: 'inherit',
                              fontSize: dense ? 9.5 : 10.5,
                              padding: '2px 7px',
                              borderRadius: 999,
                              cursor: 'pointer',
                              border: fit === 'fits' ? '1px solid #2E7D32' : '1px solid #A3D9B8',
                              background: fit === 'no-fit' ? '#F5F0E6' : '#FFFFFF',
                              color: fit === 'no-fit' ? '#9A8F7C' : '#1B5E20',
                              textDecoration: fit === 'no-fit' ? 'line-through' : 'none'
                            }}
                          >
                            {calRangeLabel(r.start, r.end)} · {r.minutes} {tx('pos.min')}{fit === 'fits' ? ' ✓' : ''}
                          </button>
                        );
                      })}
                      {hidden > 0 ? (
                        <button
                          type="button"
                          className="s"
                          onClick={() => setMoreOpen((m) => ({ ...m, [c.technicianId]: true }))}
                          aria-label={tx('pos.show_hidden_more_open_ranges_for_239f', { hidden: String(hidden), name: String(c.name) })}
                          style={{ font: 'inherit', fontSize: dense ? 9.5 : 10.5, padding: '2px 7px', borderRadius: 999, border: '1px solid #B8E2CB', background: '#fff', color: '#1B5E20', cursor: 'pointer' }}
                        >+{hidden} {tx('pos.more')}</button>
                      ) : null}
                      {expanded && c.openRanges.length > CHIP_LIMIT ? (
                        <button
                          type="button"
                          className="s"
                          onClick={() => setMoreOpen((m) => ({ ...m, [c.technicianId]: false }))}
                          style={{ font: 'inherit', fontSize: dense ? 9.5 : 10.5, padding: '2px 7px', borderRadius: 999, border: '1px solid #B8E2CB', background: '#fff', color: '#1B5E20', cursor: 'pointer' }}
                        >{tx('pos.less')}</button>
                      ) : null}
                      {c.openRanges.length > 0 ? (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onFs(c.technicianId); }}
                          title={tx('pos.view_all_length_open_intervals_for_s7fi', { length: String(c.openRanges.length), name: String(c.name) })}
                          style={{ background: 'none', border: 'none', padding: 0, fontSize: 10, fontWeight: 700, color: '#1B5E20', cursor: 'pointer', marginLeft: 'auto' }}
                        >{tx('pos.view_all')}</button>
                      ) : null}
                    </>
                  )
                }
              </div>
            );
          })}
        </div>
        {/* grid body */}
        <div style={{ display: 'flex', position: 'relative', minWidth: 'max-content' }}>
          <div style={{ flex: '0 0 56px', position: 'sticky', left: 0, background: '#fff', zIndex: 3, height: totalH, borderRight: '1px solid var(--line)' }}>
            {hours.map((h) => (<div key={h} className="s" style={{ position: 'absolute', top: (h - openMin) * PX - 7, right: 6, fontSize: 10.5, fontWeight: 700 }}>{calLabel(h)}</div>))}
            {quarters.map((q) => (<div key={q} className="s" style={{ position: 'absolute', top: (q - openMin) * PX - 6, right: 6, fontSize: 8.5, color: '#C9BBA0' }}>{`:${String(q % 60).padStart(2, '0')}`}</div>))}
            {isToday && nowMin >= openMin && nowMin <= closeMin ? <div aria-hidden style={{ position: 'absolute', top: (nowMin - openMin) * PX - 1, right: 2, width: 6, height: 6, borderRadius: '50%', background: '#D33' }} /> : null}
          </div>
          {visibleCols.map((c) => (
            <div key={c.technicianId} data-cal-col={c.technicianId} style={{ flex: colW, minWidth: colMin, position: 'relative', height: totalH, borderLeft: '1px solid var(--line)' }}>
              {/* non-working shading + blocked slices */}
              {grid ? shadeFor(c).map((r) => (
                <div key={'sh' + r.start} aria-hidden style={{ position: 'absolute', left: 0, right: 0, top: (r.start - openMin) * PX, height: (r.end - r.start) * PX, background: '#F5F0E6', opacity: 0.85 }} />
              )) : null}
              {c.blocked.map((b, i) => {
                const bs = calMinutes(b.startTime), be = calMinutes(b.endTime);
                if (bs == null || be == null) return null;
                return (
                  <div key={'bl' + i} title={tx('pos.blocked_reason', { reason: String(b.reason) })} style={{ position: 'absolute', left: 2, right: 2, top: (bs - openMin) * PX, height: Math.max(12, (be - bs) * PX - 2), borderRadius: 6, background: 'repeating-linear-gradient(45deg, #EFE6D4, #EFE6D4 6px, #E7DBC4 6px, #E7DBC4 12px)', border: '1px solid #D8C8A8', color: '#8A7A66', fontSize: 10, padding: '2px 6px', overflow: 'hidden', display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>⛔ {b.reason}</span>
                    {b.blockId && onBlockRemove ? <button aria-label={tx('pos.remove_block_reason', { reason: String(b.reason) })} title={tx('pos.remove_this_blocked_window')} onClick={(e) => { e.stopPropagation(); void onBlockRemove(b.blockId!); }}
                      style={{ font: 'inherit', fontSize: 10, lineHeight: 1, padding: '1px 4px', border: '1px solid #D8C8A8', borderRadius: 5, background: '#FFFDF8', color: '#8A7A66', cursor: 'pointer', flex: 'none' }}>✕</button> : null}
                  </div>
                );
              })}
              {/* hour + quarter lines */}
              {hours.map((h) => (<div key={h} aria-hidden style={{ position: 'absolute', left: 0, right: 0, top: (h - openMin) * PX, borderTop: '1px solid #E8DFCE' }} />))}
              {quarters.map((q) => (<div key={q} aria-hidden style={{ position: 'absolute', left: 0, right: 0, top: (q - openMin) * PX, borderTop: '1px dashed #F3EDE0' }} />))}
              {/* current-time indicator across the column */}
              {isToday && nowMin >= openMin && nowMin <= closeMin ? <div aria-hidden style={{ position: 'absolute', left: 0, right: 0, top: (nowMin - openMin) * PX, borderTop: '2px solid #D33', zIndex: 2 }} /> : null}
              {/* gap-minute labels inside free ranges (spec §7/§8) */}
              {grid && c.technicianId !== '__none__' ? c.openRanges.filter((r) => r.minutes >= interval).map((r) => {
                const trailing = c.windows.length > 0 && r.end === c.windows[c.windows.length - 1].end;
                const fit = calFitsIn(r.minutes, selectedServiceMinutes);
                return (
                  <button key={'gap' + r.start} data-gap-slot="1" onClick={() => onSlotPick?.(c.technicianId, calHHMM(r.start))}
                    title={tx('pos.book_this_gap_v0_minutes_min_e9dq', { v0: String(calRangeLabel(r.start, r.end)), minutes: String(r.minutes), v2: String(fit === 'no-fit' ? tx('pos.selected_service_needs_selectedserviceminutes_min_does_6kzy', { selectedServiceMinutes: String(selectedServiceMinutes) }) : '') })}
                    style={{ position: 'absolute', left: 8, right: 8, top: (r.start - openMin) * PX + 3, height: Math.max(18, r.minutes * PX - 6), display: 'flex', alignItems: 'center', justifyContent: 'center', font: 'inherit', fontSize: dense ? 9.5 : 10.5, color: fit === 'no-fit' ? '#A89A82' : '#9A7B33', background: 'transparent', border: `1.5px dashed ${fit === 'fits' ? '#2E7D32' : '#D8C89F'}`, borderRadius: 8, cursor: 'pointer' }}>
                    + {calGapText(r.minutes, r.end, trailing)}{fit === 'fits' ? ' ✓' : fit === 'no-fit' ? tx('pos.does_not_fit') : ''}
                  </button>
                );
              }) : null}
              {/* Phase 7: the optimizer's unused gaps for this technician — a thin strip on the column's left edge */}
              {(sched?.gaps ?? []).filter((g) => g.technicianId === c.technicianId).map((g) => {
                const gs = calMinutes(g.startTime), ge = calMinutes(g.endTime);
                if (gs == null || ge == null || ge <= gs) return null;
                return <div key={'sg' + g.id} data-sched-gap={g.id} title={tx('pos.ai_optimizer_durationmin_min_unused_v1', { durationMin: String(g.durationMin), v1: String(g.servicesThatFit.length ? tx('pos.fits_v0', { v0: String(g.servicesThatFit.join(', ')) }) : '') })}
                  style={{ position: 'absolute', left: 0, width: 4, top: (gs - openMin) * PX, height: Math.max(6, (ge - gs) * PX), background: '#E0A84A', borderRadius: 2, zIndex: 2 }} />;
              })}
              {/* drag preview */}
              {drag && drag.col === c.technicianId ? (
                <div aria-hidden style={{ position: 'absolute', left: 3, right: 3, top: (drag.snapped - openMin) * PX, height: Math.max(20, drag.dur * PX - 2), border: '2px solid #A96F22', borderRadius: 7, background: '#FFF4DE', zIndex: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#7A5E22', pointerEvents: 'none' }}>
                  {calRangeLabel(drag.snapped, drag.snapped + drag.dur)}
                </div>
              ) : null}
              {/* appointments */}
              {(byCol[c.technicianId] || []).map((a) => {
                const sMin = calMinutes(a.startTime); if (sMin == null) return null;
                const dur = a.durationMinutes || (() => { const e2 = calMinutes(a.endTime); return e2 != null ? Math.max(15, e2 - sMin) : 30; })();
                const top = Math.max(0, (sMin - openMin) * PX), height = Math.max(20, dur * PX - 2);
                // Derived, not stored: a not-yet-arrived booking inside the window reads as "Arriving Soon"
                // (only for TODAY's grid — a future date has no meaningful "soon").
                const soon = isToday && isArrivingSoon(a.status, sMin, nowMin);
                const tone = (soon ? CAL_TONE.arriving_soon : CAL_TONE[(a as any).displayStatus || a.status]) || { bg: '#FFFDF8', bd: 'var(--line)', label: a.status };   // displayStatus: the server's computed 'late' (Decision 38)
                const strike = a.status === 'cancelled' || a.status === 'no_show';
                const svc = a.services.map((x) => x.serviceName || x.name || '').filter(Boolean).join(', ');
                const draggable = !!onMove && !['cancelled', 'no_show', 'completed'].includes(a.status);
                const dragging = drag?.aid === a.appointmentId;
                const sm = sched?.appointments?.[a.appointmentId];
                const sc = schedConflict[a.appointmentId];
                return (
                  <div key={a.appointmentId} style={{ display: 'contents' }}>
                  <button
                    onClick={(e) => { if (e.detail === 0) onPick?.(a.appointmentId); }}  /* keyboard Enter/Space; pointer path handles mouse+touch */
                    onPointerDown={(e) => cardPointerDown(e, a, c.technicianId, sMin, dur, draggable)}
                    data-appt={a.appointmentId}
                    data-sched-conflict={sc || undefined}
                    title={`${a.customerName} · ${svc} · ${calLabel(sMin)}–${calLabel(sMin + dur)} · ${tone.label}${draggable ? tx('pos.drag_to_move_touch_press_and_n0th') : ''}`}
                    aria-label={tx('pos.customername_v1_smin_to_v3_label', { customerName: String(a.customerName), v1: String(svc || 'appointment'), sMin: String(calLabel(sMin)), v3: String(calLabel(sMin + dur)), label: String(tone.label) })}
                    style={{ position: 'absolute', left: 3, right: 3, top, height, textAlign: 'left', cursor: draggable ? 'grab' : onPick ? 'pointer' : 'default', zIndex: 3, opacity: dragging ? 0.55 : 1,
                      background: tone.bg, borderLeft: `3px solid ${tone.bd}`, border: `1px solid ${tone.bd}33`, borderRadius: 7, padding: 0, font: 'inherit' }}>
                    {/* §78: the clipping moved from the card to this inner box (same padding box, same corners) so the card's
                        own overflow no longer clips its hit area (shell/hitSlop.ts) — the card looks exactly as before */}
                    <span style={{ position: 'absolute', inset: 0, display: 'block', overflow: 'hidden', borderRadius: 6, padding: dense ? '2px 4px' : '3px 6px' }}>
                    <div style={dense && height > 34
                      ? { fontSize: 10.5, fontWeight: 700, color: 'var(--text)', textDecoration: strike ? 'line-through' : 'none', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any, overflow: 'hidden', lineHeight: 1.15, wordBreak: 'break-word' }
                      : { fontSize: dense ? 10.5 : 11.5, fontWeight: 700, color: 'var(--text)', textDecoration: strike ? 'line-through' : 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {sm?.locked ? <span data-testid={`sched-lock-${a.appointmentId}`} title={tx('pos.locked_the_ai_optimizer_will_not_2smd')} aria-label={tx('pos.locked')}>🔒 </span> : null}
                      {a.customerName}{a.isVip ? ' ★' : ''}
                    </div>
                    {height > (dense ? 44 : 30) ? <div className="s" style={dense
                      ? { fontSize: 9.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any, overflow: 'hidden', lineHeight: 1.2, wordBreak: 'break-word' }
                      : { fontSize: 10.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{svc || tone.label} · {calLabel(sMin)}–{calLabel(sMin + dur)} · {tone.label}</div> : null}
                    </span>
                  </button>
                  {sc ? <span aria-hidden style={{ position: 'absolute', left: 3, right: 3, top, height, border: `2px solid ${sc === 'critical' ? '#B4451E' : '#D69A2D'}`, borderRadius: 7, pointerEvents: 'none', zIndex: 4 }} /> : null}
                  {sm && onOpenRec ? (
                    <button type="button" data-testid={`sched-rec-badge-${a.appointmentId}`} onClick={(e) => { e.stopPropagation(); onOpenRec(sm.recommendationId); }}
                      title={tx('pos.ai_optimizer_suggestion_v0_v1_open_l8q9', { v0: statusLabel('aiSuggestion', sm.type), v1: statusLabel('aiSuggestion', sm.status) })} aria-label={tx('pos.open_the_ai_optimizer_suggestion_for_1gkj', { customerName: String(a.customerName) })}
                      style={{ position: 'absolute', right: 5, top: top + 2, zIndex: 5, font: 'inherit', fontSize: 9.5, fontWeight: 800, lineHeight: 1, padding: '2px 5px', borderRadius: 999, border: '1px solid #E0A84A', background: '#FFF4DE', color: '#7A5E22', cursor: 'pointer' }}>AI</button>
                  ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      </div>
      {/* Bottom horizontal navigation bar (Section B8) */}
      {!isSingleTech && totalCols > (techPageSize || 12) ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '10px 14px', background: '#FDFBF7', border: '1px solid var(--line)', borderTop: 'none', borderRadius: '0 0 10px 10px', flexWrap: 'wrap' }}>
          <div data-testid="board-tech-pager" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* §5: First / Last beside the slider (200 technicians = 17 pages) */}
            <button type="button" className="btn ghost" disabled={activePage <= 1} onClick={() => onTechPageChange?.(1)} style={{ padding: '4px 10px', fontSize: 12.5 }}>{tx('pos.first_page')}</button>
            <button
              type="button"
              className="btn ghost"
              disabled={activePage <= 1}
              onClick={() => onTechPageChange?.(activePage - 1)}
              style={{ padding: '4px 10px', fontSize: 13 }}
              aria-label={tx('pos.previous_technicians')}
            >‹</button>
            <input
              type="range"
              min={1}
              max={totalPages}
              value={activePage}
              onChange={(e) => onTechPageChange?.(Number(e.target.value))}
              style={{ width: 140, accentColor: 'var(--aps-orange)' }}
              aria-label={tx('pos.technician_page_slider')}
            />
            <button
              type="button"
              className="btn ghost"
              disabled={activePage >= totalPages}
              onClick={() => onTechPageChange?.(activePage + 1)}
              style={{ padding: '4px 10px', fontSize: 13 }}
              aria-label={tx('pos.next_technicians')}
            >›</button>
            <button type="button" className="btn ghost" disabled={activePage >= totalPages} onClick={() => onTechPageChange?.(totalPages)} style={{ padding: '4px 10px', fontSize: 12.5 }}>{tx('pos.last_page')}</button>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{tx('pos.swipe_or_drag_left_right_to_1k43')}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#1f1b16' }}>{tx('pos.page')}{' '}{activePage} {tx('pos.of')}{' '}{totalPages}</span>
            {activePage < totalPages ? (
              <button
                type="button"
                className="btn outline"
                onClick={() => onTechPageChange?.(activePage + 1)}
                style={{ padding: '4px 12px', fontSize: 12.5, fontWeight: 600, color: 'var(--aps-orange)', borderColor: 'var(--aps-orange)' }}
              >
                {tx('pos.next')}{' '}{Math.min(techPageSize || 12, totalCols - endIndex)} {tx('pos.technicians_3')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Footer utilities (Section B9) */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginTop: 12, padding: '10px 14px', background: '#FFF', border: '1px solid var(--line)', borderRadius: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            className="btn ghost"
            onClick={() => { if (onBlockAdd) setBlockForm({ start: '12:00', end: '13:00', reason: tx('ops.booking.blockTeamMeeting') }); }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}
          >
            {tx('pos.block_time_3')}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: '#4A90E2' }} />{tx('pos.confirmed')}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: '#9B51E0' }} />{tx('pos.arrived')}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: '#7B1FA2' }} />{tx('pos.in_service')}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: '#F5A623' }} />{tx('pos.walk_in_2')}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, border: '1.5px dashed #27AE60', background: '#EAF7F0' }} />{tx('pos.open')}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: '#9E9E9E' }} />{tx('pos.break')}
          </span>
        </div>
      </div>
      {!grid ? <div className="s" style={{ marginTop: 6 }}>{tx('pos.schedule_detail_unavailable_showing_appointments_only_fp2v')}</div> : null}
      <div className="s" style={{ marginTop: 6 }}>{tx('pos.drag_an_appointment_to_a_new_f308')}{' '}{interval}{tx('pos.minute_slots_and_the_move_is_1y0r')}</div>
      {isFs && assistant && assistOpen ? (
        <div role="dialog" aria-label={tx('pos.booking_assistant')} style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(400px, 92vw)', zIndex: 70, background: '#FBF6EC', borderLeft: '1px solid var(--line)', boxShadow: '-8px 0 24px rgba(60,45,20,0.12)', overflow: 'auto', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <h2 style={{ margin: 0, flex: 1 }}>{tx('pos.booking_assistant')}</h2>
            <button className="btn ghost" onClick={() => setAssistOpen(false)} aria-label={tx('pos.close_booking_assistant')}>✕</button>
          </div>
          {assistant}
        </div>
      ) : null}
    </section>
  );
  return body;
}

/** 200-technician mandate §11/§12/§83: search the WHOLE roster on the server (name, phone, "#200") and jump to the page
 *  that holds the technician — the board then highlights the column. Separate from the appointment search. */
export function TechnicianJump({ value, onChange, matches, onPick }: { value: string; onChange: (v: string) => void; matches: BookingTechnicianSummary[] | null; onPick: (technicianId: string) => void }) {
  return (
    <div style={{ position: 'relative' }}>
      <ImeSafeInput type="search" value={value} onValue={onChange} placeholder={tx('pos.find_technician_placeholder')} aria-label={tx('pos.find_technician')}
        onKeyDown={(e) => { if (e.key === 'Enter' && matches && matches[0]) onPick(matches[0].technicianId); if (e.key === 'Escape') onChange(''); }}
        style={{ height: 34, border: '1px solid var(--line)', borderRadius: 9, padding: '0 10px', background: '#FFFDF8', font: 'inherit', fontSize: 12.5, minWidth: 190 }} />
      {value.trim() && matches ? (
        <div role="listbox" aria-label={tx('pos.find_technician')} style={{ position: 'absolute', zIndex: 30, top: 38, left: 0, minWidth: 240, background: '#fff', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)', padding: 4 }}>
          {matches.length === 0 ? <div className="muted" style={{ padding: 8, fontSize: 12.5 }}>{tx('pos.no_technician_matches')}</div> : matches.map((t) => (
            <button key={t.technicianId} type="button" role="option" aria-selected={false} onClick={() => onPick(t.technicianId)}
              style={{ display: 'flex', width: '100%', gap: 8, alignItems: 'center', padding: '6px 8px', border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', fontSize: 12.5, textAlign: 'left' }}>
              <span className="pill" style={{ fontSize: 11 }}>#{t.rosterNumber}</span><span style={{ flex: 1 }}>{t.name}</span>
              {!t.available ? <span className="s">{tx('pos.inactive')}</span> : t.workingToday ? <span className="s">{tx('pos.working_today_label')}</span> : <span className="s">{tx('pos.off_today')}</span>}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function POSBookingScreen() {
  const intentKeys = useRef(createIntentKeys());   // mandate §31: one Idempotency-Key per booking intent
  const { ask, askUi } = useInlineAsk();   // spec §11: confirm-with-reason for an intentional double booking
  const nav = useNavigate();
  const [s, setS] = useState<BookingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [techSel, setTechSel] = useState('');
  const [techSelName, setTechSelName] = useState<string | undefined>(undefined);
  const [whenStr, setWhenStr] = useState('');
  const [reason, setReason] = useState('');
  // Booking Assistant (create) form state
  const [form, setForm] = useState({ customerName: '', customerPhone: '', primaryService: '', addons: [] as string[], technicianId: '', date: '', time: '', notes: '', source: 'manual' });
  const [bookTab, setBookTab] = useState<'new' | 'walkin'>('new');
  const [slots, setSlots] = useState<{ technicianId: string; name: string; slots: string[] }[] | null>(null);
  const [slotsBusy, setSlotsBusy] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createMsg, setCreateMsg] = useState<{ ok?: boolean; text: string } | null>(null);
  const [grid, setGrid] = useState<DayGrid | null>(null);
  const [fs, setFs] = useState<null | 'all' | string>(null);
  // '' = today (server default). AI Calendar guide §13: "Open in POS Booking" may pass ?date=YYYY-MM-DD — it only picks the
  // day shown; navigating never changes a booking.
  const [calDate, setCalDate] = useState(() => { try { const d = new URLSearchParams(window.location.search).get('date') ?? ''; return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : ''; } catch { return ''; } });
  const [techFilter, setTechFilter] = useState('');
  const [techFilterName, setTechFilterName] = useState<string | undefined>(undefined);
  // §57: the quick-book technician comes from the server-paged picker; its name is kept here (the page may not hold it)
  const [formTechName, setFormTechName] = useState<string | undefined>(undefined);
  const [catFilter, setCatFilter] = useState('');
  const [workingToday, setWorkingToday] = useState(false);
  const [waitlist, setWaitlist] = useState<{ queueItemId: string; customerName: string; services: string; waitedMin: number | null }[] | null>(null);
  const [moveFor, setMoveFor] = useState<Row | null>(null);   // §14 dedicated Move Appointment workflow
  const [techPage, setTechPage] = useState(1);
  const [techPageSize, setTechPageSize] = useState(12);
  const [slotIncrement, setSlotIncrement] = useState(15);
  const [fitDay, setFitDay] = useState(false);
  // Find an Opening / Best Matches search for ONE real service of this salon ('' = the first in the catalog). It used to be
  // a fixed label ("Gel Manicure · 45 min") that matched any free 45-minute gap of any technician, skilled or not.
  const [searchOpeningServiceId, setSearchOpeningServiceId] = useState('');
  const [bestNote, setBestNote] = useState<string | null>(null);
  // Best Matches on the server (mandate §16/§17): eligible technicians only, ranked, top 5 + View More
  const [best, setBest] = useState<BookingOpeningsResponse | null>(null);
  // Week view (mandate §53): the week's appointments by their REAL date, paged from the server (it laid the day's list
  // round-robin across Mon–Sun by list position — not the appointments' dates)
  const [week, setWeek] = useState<{ from: string; to: string; items: Row[]; total: number; page: number } | null>(null);
  // "More Filters" (the design picture's button) exposes three filters the API has always implemented but no
  // screen ever surfaced: branch, deposit status and conflicts-only. Nothing invented — see BookingFilters.
  const [moreOpen, setMoreOpen] = useState(false);
  const [branchId, setBranchId] = useState('');
  const [depositStatus, setDepositStatus] = useState('');
  const [conflictOnly, setConflictOnly] = useState(false);
  const [calendarView, setCalendarView] = useState<'day' | 'week'>('day');
  // Phase 7: AI Scheduling Optimizer overlay — reloaded with every grid load (realtime schedule_* events reach this
  // screen through the 'booking' key and reload the grid). Only for roles that may see the optimizer.
  const canSched = useCan()('ai_scheduling.view');
  const [sched, setSched] = useState<SchedCalendarIndicators | null>(null);

  // ── 200-technician mandate (Oct 23 2026): the board pages its technician columns ON THE SERVER (12 a page → 200 = 17
  // pages) and asks the day grid for THOSE technicians only; the appointment list below is paged too. Nothing here holds
  // the whole roster's calendars. The technician search is its own box (it used to share the appointment search text).
  const [techSearch, setTechSearch] = useState('');
  const [techPageData, setTechPageData] = useState<BookingTechnicianPage | null>(null);
  const [highlightTech, setHighlightTech] = useState<string | null>(null);
  const [techMatches, setTechMatches] = useState<BookingTechnicianSummary[] | null>(null);
  const [listPage, setListPage] = useState(1);
  const locateRef = useRef<string | null>(null);   // jump-to-technician: the next load answers the page that holds this id
  const loadSeq = useRef(0);
  // §19: after a page settles, the NEXT page (technicians + its day grid) is fetched once into a one-entry cache; going
  // there paints it at once and the normal load still revalidates. Any partial (realtime) refresh drops the entry.
  const prefetchRef = useRef<{ key: string; tp: BookingTechnicianPage; grid: DayGrid | null } | null>(null);
  const tpQuery = useRef({ page: 1, pageSize: BOOKING_TECH_PAGE_SIZE, working: false, search: '' });
  // Full Screen: its search box narrows the technician COLUMNS on the server (the toolbar box jumps instead)
  const fsTechSearch = fs === 'all' ? techSearch.trim() : '';
  tpQuery.current = { page: techPage, pageSize: fs === 'all' ? FULL_SCREEN_TECH_PAGE_SIZE : techPageSize, working: workingToday, search: fsTechSearch };
  const listPageRef = useRef(1); listPageRef.current = listPage;
  // Waitlist / Standby = today's WAITING customer-queue guests (real intake data; honest null on failure).
  const loadWaitlist = useCallback(() => {
    return posQueueApi.state({ status: 'waiting', pageSize: 6 })
      .then((q: any) => {
        const items = q?.queue?.items;
        setWaitlist(Array.isArray(items) ? items.map((it: any) => ({
          queueItemId: it.queueItemId, customerName: it.customerName || tx('pos.guest'),
          services: (it.requestedServices || []).map((x: any) => x.serviceName || x.name).filter(Boolean).join(', '),
          waitedMin: it.actualWaitMinutes ?? it.quotedWaitMinutes ?? null,
        })) : null);
      })
      .catch(() => setWaitlist(null));
  }, []);
  // §22/§61 (M5 pilot, Oct 24 2026): a change for an OFF-SCREEN technician refreshes only the board's metadata — the
  // appointment list, KPIs and the technician page's counts — never the 12-column day grid (scope 'partial').
  const load = useCallback((f: BookingFilters, scope: 'full' | 'partial' = 'full') => {
    if (scope === 'partial') {
      prefetchRef.current = null;
      const tq = tpQuery.current; const seq = loadSeq.current;
      const st = posBookingApi.state({ ...f, page: listPageRef.current, pageSize: BOOKING_LIST_PAGE_SIZE, roster: 'none' })
        .then((d) => { if (seq === loadSeq.current) { setS(d as BookingState); setError(null); } })
        .catch((e: any) => setError(e?.message || tx('pos.failed_to_load_booking')));
      const tp = posBookingApi.technicians({ date: f.date, page: tq.page, pageSize: tq.pageSize, working: tq.working || undefined, search: tq.search || undefined })
        .then((t) => { if (seq === loadSeq.current && t && Array.isArray(t.technicians)) setTechPageData((cur) => (cur && cur.page === t.page && cur.technicians.map((x) => x.technicianId).join() === t.technicians.map((x) => x.technicianId).join() ? { ...cur, total: t.total, totalAll: t.totalAll, workingCount: t.workingCount, availableNowCount: t.availableNowCount, totalPages: t.totalPages } : cur)); })
        .catch((e: any) => setError(e?.message || tx('pos.failed_to_load_booking')));
      return Promise.all([st, tp, loadWaitlist()]);
    }
    const seq = ++loadSeq.current;
    const tq = tpQuery.current; const locate = locateRef.current;
    const hit = !locate && prefetchRef.current && prefetchRef.current.key === boardPageCacheKey(f, tq, tq.page) ? prefetchRef.current : null;
    if (hit) { prefetchRef.current = null; setTechPageData(hit.tp); if (hit.grid) setGrid(hit.grid); }
    const st = posBookingApi.state({ ...f, page: listPageRef.current, pageSize: BOOKING_LIST_PAGE_SIZE, roster: 'none' })
      .then((d) => { if (seq === loadSeq.current) { setS(d as BookingState); setError(null); } })
      .catch((e: any) => setError(e?.message || tx('pos.failed_to_load_booking')));
    const dg = posBookingApi.technicians({ date: f.date, page: tq.page, pageSize: tq.pageSize, working: tq.working || undefined, search: tq.search || undefined, locate: locate || undefined })
      .then(async (tp) => {
        if (seq !== loadSeq.current) return;
        // A malformed answer (an older API, an error page) leaves the board unpaged rather than crashing the screen.
        if (!tp || !Array.isArray(tp.technicians)) {
          setTechPageData(null);
          const g0 = await posBookingApi.dayGrid(f.date, undefined, f);
          if (seq === loadSeq.current) setGrid(g0 && Array.isArray(g0.columns) ? (g0 as DayGrid) : null);
          return;
        }
        setTechPageData(tp);
        if (locate) {
          locateRef.current = null;
          if (tp.located) { setTechPage(tp.page); setHighlightTech(locate); setTimeout(() => setHighlightTech((h) => (h === locate ? null : h)), 2500); }
          else setBestNote(tx('pos.technician_not_in_view'));
        }
        const g = await posBookingApi.dayGrid(f.date, tp.technicians.map((t) => t.technicianId), f);
        if (seq === loadSeq.current) setGrid(g && Array.isArray(g.columns) ? (g as DayGrid) : null);
        // §19: the page has settled — fetch the next one (only that one) for an instant Next
        if (seq === loadSeq.current && tp.page < tp.totalPages) {
          const next = tp.page + 1; const key = boardPageCacheKey(f, tq, next);
          setTimeout(() => {
            if (seq !== loadSeq.current || prefetchRef.current?.key === key) return;
            posBookingApi.technicians({ date: f.date, page: next, pageSize: tq.pageSize, working: tq.working || undefined, search: tq.search || undefined })
              .then(async (np) => {
                if (seq !== loadSeq.current || !np || !Array.isArray(np.technicians) || np.page !== next) return;
                const ng = await posBookingApi.dayGrid(f.date, np.technicians.map((t) => t.technicianId), f);
                if (seq === loadSeq.current) prefetchRef.current = { key, tp: np, grid: ng && Array.isArray(ng.columns) ? (ng as DayGrid) : null };
              })
              .catch(() => { /* a prefetch is only a hint; the real load still runs on Next */ });
          }, BOARD_PREFETCH_DELAY_MS);
        }
      })
      .catch(() => { if (seq === loadSeq.current) { setGrid(null); setTechPageData(null); } });
    return Promise.all([st, dg, loadWaitlist()]);
  }, [loadWaitlist]);
  const filtersNow = (): BookingFilters => ({ search: search || undefined, status: status || undefined, source: source || undefined, date: calDate || undefined, technicianId: techFilter || undefined, serviceCategory: catFilter || undefined, branchId: branchId || undefined, depositStatus: depositStatus || undefined, conflictOnly: conflictOnly || undefined });

  // a new filter or date starts the appointment list at its first page
  useEffect(() => { setListPage(1); }, [search, status, source, calDate, techFilter, catFilter, branchId, depositStatus, conflictOnly]);
  useEffect(() => {
    const t = setTimeout(() => { load(filtersNow()); }, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search, status, source, calDate, techFilter, catFilter, branchId, depositStatus, conflictOnly, techPage, techPageSize, workingToday, fs === 'all', listPage, fsTechSearch]);   // eslint-disable-line react-hooks/exhaustive-deps

  // technician search (mandate §11/§12): server-side matches by name / phone / "#200"; picking one jumps to its page
  useEffect(() => {
    const q = techSearch.trim();
    if (!q) { setTechMatches(null); return; }
    let live = true;
    const t = setTimeout(() => {
      posBookingApi.technicians({ date: calDate || undefined, search: q, pageSize: 8, status: 'all' })
        .then((r) => { if (live) setTechMatches(r.technicians); })
        .catch(() => { if (live) setTechMatches([]); });
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [techSearch, calDate]);
  const jumpToTechnician = (technicianId: string) => {
    setTechSearch(''); setTechMatches(null); setFs((f) => (f && f !== 'all' ? null : f));
    locateRef.current = technicianId;
    load(filtersNow());
  };

  const refetch = (scope: 'full' | 'partial' = 'full') => { if (calendarView === 'week' && scope === 'full') void loadWeek(1); return load(filtersNow(), scope); };
  // what is on screen right now — the date, the 12 visible technicians and the appointments drawn in their columns
  const boardView = useRef<BoardView>({ date: null, visibleTechnicianIds: [] });
  boardView.current = { date: grid?.date ?? null, visibleTechnicianIds: (techPageData?.technicians ?? []).map((t) => t.technicianId), visibleAppointmentIds: (grid?.appointments ?? []).map((a) => a.appointmentId) };
  const weekOpen = calendarView === 'week';
  const loadWeek = async (page: number) => {
    const from = weekStart(calDate || grid?.date || deviceToday()); const to = weekDays(from)[6];
    try {
      const r: any = await posBookingApi.appointments({ ...filtersNow(), date: undefined, from, to, page, pageSize: 100 });
      const items: Row[] = Array.isArray(r?.items) ? r.items : [];
      setWeek((prev) => ({ from, to, items: page > 1 && prev && prev.from === from ? [...prev.items, ...items] : items, total: Number(r?.pagination?.totalItems ?? items.length), page }));
    } catch (e: any) { setNote(e?.message || tx('pos.failed_to_load_booking')); }
  };
  useEffect(() => { if (calendarView === 'week') { setWeek(null); void loadWeek(1); } }, [calendarView, calDate, status, source, techFilter, catFilter, search]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Smooth Refresh spec §24/§25/§89: the 15 s safety tick asks the change feed "anything since my cursor?" — one tiny
  // request that is almost always empty — and reloads the board only when something changed or the feed says
  // RESYNC_REQUIRED. Realtime events, reconnects and focus still reload at once (they already know something changed).
  const feedCursor = useRef<string | null>(null);
  const reloadAndBaseline = async (scope: 'full' | 'partial' = 'full') => {
    const base = await posBookingApi.changes().catch(() => null);   // cursor taken BEFORE the snapshot: nothing slips between
    await refetch(scope);
    feedCursor.current = base?.cursor ?? null;
  };
  const onSync = async (reason?: string, scope?: RefreshScope) => {
    // an event for an off-screen technician (scope 'partial') never reloads the grid; the week view has no columns to spare
    if (reason === 'manual' && scope === 'partial' && !weekOpen) return reloadAndBaseline('partial');
    if (reason !== 'interval' || !feedCursor.current) return reloadAndBaseline();
    try {
      // M4: a busy minute's sweep can span pages — follow `hasMore` at once (the server bounds a sweep and answers
      // RESYNC_REQUIRED past its last page), then scope the tick over every row of the sweep.
      const sw = await readFeedSweep((c) => posBookingApi.changes(c), feedCursor.current);
      if (sw.resync) { syncStatus.recordResync(); return reloadAndBaseline(); }
      syncStatus.recordPayload({ bytes: sw.bytes, recordsChanged: sw.rows.length });   // §100
      const tick = weekOpen ? (sw.rows.length ? 'full' : 'skip') : bookingChangesScope(sw.rows, boardView.current);
      if (tick !== 'skip') await refetch(tick);
      feedCursor.current = sw.cursor;
    } catch (e: any) {
      if (e?.status === 409 && e?.code === 'RESYNC_REQUIRED') { syncStatus.recordResync(); return reloadAndBaseline(); }   // §26/§27: snapshot, no page reload
      throw e;   // reported by the sync layer ("Couldn't refresh — showing data from …"); the board keeps its data
    }
  };
  const { open: openIPad } = useIPadView();
  const memberStatus = useMemberStatusMap(s?.bookings?.items?.map((a) => a.customerId) || []);
  const openCustomerProfile = useCallback((a: { customerId?: string; customerName: string; customerPhone?: string; isVip?: boolean }) => {
    const cid = a.customerId || `cust_${a.customerName.replace(/\s+/g, '_').toLowerCase()}`;
    openIPad(customerRequest({
      customerId: cid,
      displayName: a.customerName,
      phone: a.customerPhone,
      isVip: a.isVip,
    } as any));
  }, [openIPad]);
  const shiftDay = (delta: number) => {
    const base = grid?.date || s?.dateRange.from || deviceToday();
    const d = new Date(base + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + delta);
    setCalDate(d.toISOString().slice(0, 10));
  };
  // §22/§61: a queue change that names no appointment moves the waitlist, never a column; anything else is scoped by
  // its technician and date (bookingRelevance) — an off-screen technician or another day never reloads the grid
  useRealtime('booking', onSync, { relevance: (d) => (weekOpen ? 'full' : bookingEventScope(d.event, d.payload, boardView.current)) });
  useEffect(() => {
    const d = grid?.date;
    if (!canSched || !d) { setSched(null); return; }
    let live = true;
    posAiSchedulingOptimizerApi.calendar(d)
      .then((x) => { if (live) setSched(isSchedIndicators(x) && x.date === d ? x : null); })
      .catch(() => { if (live) setSched(null); });   // no package / no permission → no overlay, never an error on the board
    return () => { live = false; };
  }, [grid, canSched]);
  const schedOpenConflicts = (sched?.conflicts ?? []).filter((c) => !c.resolved).length;
  const act = async (aid: string, fn: () => Promise<any>, kind: string, closeDrawer?: boolean) => {
    setNote(null); setBusyId(aid + kind);
    try {
      const r = await fn();
      if (kind === 'notify' && r && r.configured === false) setNote(r.disabledReason || tx('pos.notifications_are_not_configured'));
      if (closeDrawer) { setOpenId(null); setReason(''); setWhenStr(''); setTechSel(''); }
      await refetch();
    } catch (e: any) {
      setNote(bookingConflictText(e, tx('pos.action_failed')));
      if (e?.status === 409) await refetch().catch(() => undefined);   // show the server's truth after a lost race (merge Oct 12, other chat)
    }
    finally { setBusyId(null); }
  };

  // A11 Nov 6 (owner decision, Kevin "pick best"): /booking?date=…&appointmentId=<id> (the AI Calendar overlay link) opens that appointment's Manage drawer
  // once the day's list contains it, and scrolls it into view. Read once; an id that is not on the list opens nothing.
  const deepAppt = useRef<string | null>((() => { try { const u = new URLSearchParams(window.location.search); const v = u.get('appointmentId') ?? u.get('appointment') ?? ''; return /^[0-9a-f-]{36}$/i.test(v) ? v : null; } catch { return null; } })());
  useEffect(() => {
    const id = deepAppt.current; if (!id || !s?.bookings?.items) return;
    const a = s.bookings.items.find((x) => x.appointmentId === id); if (!a) return;
    deepAppt.current = null; toggleDrawer(a as Row);
    window.setTimeout(() => { try { document.querySelector(`[data-appt-row="${id}"]`)?.scrollIntoView({ block: 'center' }); } catch { /* jsdom / no layout */ } }, 0);
  });   // no deps on purpose: runs until the deep-linked row appears, then never again
  const toggleDrawer = (a: Row) => {
    if (openId === a.appointmentId) { setOpenId(null); return; }
    setOpenId(a.appointmentId); setNote(null); setReason('');
    setTechSel(''); // technicianName isn't an id; leave unset so the user picks explicitly
    // developer merge (Oct 2026): rows carry startTime as HH:MM (+ the row's date) — `new Date('10:30')` is Invalid Date, so the
    // picker always opened empty. Build the datetime-local value from the row's own date + time.
    try { const hm = /T(\d{2}:\d{2})/.exec(String(a.startTime))?.[1] ?? String(a.startTime).slice(0, 5); setWhenStr(hm ? `${a.date || s?.dateRange?.from || deviceToday()}T${hm}` : ''); } catch { setWhenStr(''); }
  };

  const doAssign = (aid: string) => { if (!techSel) { setNote(tx('pos.pick_a_technician_to_assign')); return; } const version = s?.bookings.items.find((r) => r.appointmentId === aid)?.version; act(aid, () => posBookingApi.assignTechnician(aid, { technicianId: techSel, ...(version != null ? { expectedVersion: version } : {}) }), 'assign', true); };
  const doReschedule = (aid: string) => {
    if (!whenStr) { setNote(tx('pos.pick_a_new_date_time')); return; }
    const startTime = whenStr.slice(11, 16); const date = whenStr.slice(0, 10);   // the API takes HH:MM + date (RESCHEDULE_BODY startTime ≤16 chars), not an ISO instant
    const version = s?.bookings.items.find((r) => r.appointmentId === aid)?.version;
    act(aid, () => posBookingApi.reschedule(aid, { startTime, date, expectedVersion: version, ...(techSel ? { technicianId: techSel } : {}) }), 'resch', true);
  };
  const doNoShow = (aid: string) => { if (!reason.trim()) { setNote(tx('pos.a_reason_is_required_to_mark_940a')); return; } act(aid, () => posBookingApi.noShow(aid, { reason: reason.trim() }), 'noshow', true); };
  const doCancel = (aid: string) => { if (!reason.trim()) { setNote(tx('pos.a_reason_is_required_to_cancel')); return; } act(aid, () => posBookingApi.cancel(aid, { reason: reason.trim() }), 'cancel', true); };

  // --- Booking Assistant: real availability + create against /pos/booking ---
  const formServiceIds = () => Array.from(new Set([form.primaryService, ...form.addons].filter(Boolean)));
  const formDate = () => form.date || s?.dateRange.from || '';
  const loadSlots = async () => {
    const ids = formServiceIds(); if (!ids.length) { setCreateMsg({ text: tx('pos.choose_a_service_first') }); return; }
    setSlotsBusy(true); setCreateMsg(null);
    try { setSlots(await posBookingApi.availability({ date: formDate(), serviceIds: ids, technicianId: form.technicianId || undefined })); }
    catch (e: any) { setCreateMsg({ text: e?.message || tx('pos.could_not_load_availability') }); }
    finally { setSlotsBusy(false); }
  };
  const availableTimes = (): string[] => {
    if (!slots) return [];
    const rel = form.technicianId ? slots.filter((t) => t.technicianId === form.technicianId) : slots;
    return Array.from(new Set(rel.flatMap((t) => t.slots))).sort();
  };
  const doCreate = async () => {
    if (!form.customerName.trim()) { setCreateMsg({ text: tx('pos.customer_name_is_required') }); return; }
    const ids = formServiceIds(); if (!ids.length) { setCreateMsg({ text: tx('pos.choose_at_least_one_service') }); return; }
    if (!form.time) { setCreateMsg({ text: tx('pos.pick_a_time_check_availability_first') }); return; }
    setCreateBusy(true); setCreateMsg(null);
    try {
      { const body = { customerName: form.customerName.trim(), customerPhone: form.customerPhone.trim() || undefined, serviceIds: ids, technicianId: form.technicianId || undefined, date: formDate(), startTime: form.time, source: form.source, notes: form.notes.trim() || undefined };
        await posBookingApi.create(body, intentKeys.current.keyFor('booking-create', body)); intentKeys.current.done('booking-create'); }   // mandate §31: one key per intent
      setCreateMsg({ ok: true, text: tx('pos.appointment_booked') });
      setForm((f) => ({ ...f, customerName: '', customerPhone: '', notes: '', time: '' })); setSlots(null);
      await refetch();
    } catch (e: any) { setCreateMsg({ text: e?.status === 409 ? bookingConflictText(e) : (e?.message || tx('pos.could_not_book_the_appointment')) }); }
    finally { setCreateBusy(false); }
  };


  // Open-slot / gap click → prefill the Booking Assistant with that technician + time (spec §5/§7).
  const assistantRef = useRef<HTMLElement | null>(null);
  const prefillSlot = (technicianId: string, time: string) => {
    setForm((f) => ({ ...f, technicianId: technicianId === '__none__' ? '' : technicianId, date: grid?.date || f.date, time }));
    setSlots(null);
    const techName = grid?.columns.find((c) => c.technicianId === technicianId)?.name ?? techPageData?.technicians.find((t) => t.technicianId === technicianId)?.name;
    setFormTechName(techName);
    setCreateMsg({ ok: true, text: tx('pos.prefilled_v0_v1_pick_the_service_y0xa', { v0: String(techName ? techName + ' · ' : ''), v1: String(calLabel(calMinutes(time) ?? 0)) }) });
    assistantRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  // Rebooking Opportunities / Service Recommendations (Nov 1 2026): "Open AI Booking Assistant" hands over a one-use prefill (customer · service ·
  // technician · day). Nothing is booked here either: staff pick a time and confirm, and availability, conflicts and the
  // salon's phone verification apply exactly as for any booking.
  useEffect(() => {
    const h = takeBookingHandoff();
    if (!h) return;
    setForm((f) => ({ ...f, customerName: h.customerName ?? '', customerPhone: h.customerPhone ?? '', primaryService: h.serviceId ?? '', addons: [], technicianId: h.technicianId ?? '', date: h.date, time: '', source: 'manual' }));
    setFormTechName(h.technicianName ?? undefined); setSlots(null); setBookTab('new');
    setCreateMsg({ ok: true, text: tx(h.source === 'recommendation' ? 'srx.prefill' : 'rbx.prefill', { name: h.customerName ?? '' }) });
  }, []);

  // Drag-and-drop move: optimistic UI, server re-validates (schedule windows + conflicts), rollback on rejection.
  const moveAppointment = async (aid: string, technicianId: string | undefined, time: string, versionAtDragStart?: number) => {
    if (!s) return;
    const prev = s;
    const prevGrid = grid;
    const moved = (grid?.appointments ?? []).find((r) => r.appointmentId === aid) ?? s.bookings.items.find((r) => r.appointmentId === aid);
    const sourceTechId = moved?.technicianId;
    const destTechId = technicianId ?? sourceTechId;
    const dur = moved?.durationMinutes || 30;
    const sMin = calMinutes(time) ?? 0;

    // 1) move the appointment in the list (cards reposition instantly)
    const shift = (r: Row) => (r.appointmentId !== aid ? r : { ...r, technicianId: destTechId, startTime: time, endTime: calHHMM(sMin + dur) });
    const items = (grid?.appointments ?? s.bookings.items).map(shift);
    setS({ ...s, bookings: { ...s.bookings, items: s.bookings.items.map(shift) } });
    setNote(null);

    // 2) recompute open ranges for BOTH affected technicians on the grid so the Open-Today chips + gap labels
    //    update immediately (no stale flash). Uses the same windows/buffer the backend used; refetch reconciles.
    if (grid) {
      const today = new Date();
      const isToday = grid.date === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const notBefore = isToday ? Math.ceil((today.getHours() * 60 + today.getMinutes()) / grid.slotIntervalMinutes) * grid.slotIntervalMinutes : null;
      const affected = new Set([sourceTechId, destTechId].filter(Boolean) as string[]);
      const columns = grid.columns.map((col) => {
        if (!affected.has(col.technicianId)) return col;
        const busy: CalBusy[] = items
          .filter((r) => r.technicianId === col.technicianId && !['cancelled', 'no_show'].includes(r.status))
          .map((r) => ({ startTime: r.startTime, endTime: r.endTime, status: r.status }));
        const openRanges = calRecomputeOpenRanges(col.windows, grid.bufferMinutes, busy, notBefore);
        return { ...col, openRanges, openMinutes: openRanges.reduce((a, r) => a + r.minutes, 0) };
      });
      setGrid({ ...grid, columns, appointments: items });
    }

    // 3) authoritative save; refetch reconciles both columns from the server. On rejection, roll BOTH back.
    // Spec §50: the drop carries the version the appointment had when the drag STARTED. Reading it from the board at
    // drop time was wrong: the 15 s safety sync can refresh the board mid-drag, and the drop would then quote the
    // NEWER version and silently overwrite what another device just changed. The server validates; its answer wins.
    const body = { startTime: time, technicianId, date: grid?.date, expectedVersion: versionAtDragStart ?? moved?.version };
    const rollback = () => { setS(prev); setGrid(prevGrid); };   // restore the original open-gap geometry, not just the appointment
    try {
      await posBookingApi.reschedule(aid, body);
      await refetch();
    } catch (e: any) {
      rollback();
      if (e?.status === 409 && e.code === 'OVERBOOK_CONFIRMATION_REQUIRED') {
        // Spec §11: an intentional double booking is confirmed WITH a reason (the server audits it); cancelling leaves the board as it was.
        ask(e.message || tx('pos.this_technician_is_already_booked_then_1cib'), (reason) => {
          posBookingApi.reschedule(aid, { ...body, overbookConfirmed: true, overbookReason: reason })
            .then(() => refetch())
            .catch((e2: any) => { setNote(bookingConflictText(e2, tx('ops.booking.moveFailed'))); void refetch(); });
        }, { inputLabel: tx('ops.booking.doubleBookReason'), confirmLabel: tx('pos.double_book') });
        return;
      }
      setNote(bookingConflictText(e, tx('ops.booking.moveFailed')));
      // Spec §12: another device won — show the server's truth for this day right away, not on the next sync tick.
      if (e?.status === 409) void refetch();
    }
  };

  if (error && !s) return <div className="work"><div className="err">{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{tx('pos.loading_booking')}</div></div>;

  const k = s.kpis;
  const agg = s.aggregates;
  // §6/§8 fit hints: total minutes of the assistant's selected service + add-ons (null when nothing picked).
  const selectedServiceMinutes = (() => {
    const ids = Array.from(new Set([form.primaryService, ...form.addons].filter(Boolean)));
    if (!ids.length) return null;
    const total = ids.reduce((a, id2) => a + (s.filters.services.find((sv) => sv.serviceId === id2)?.durationMinutes || 0), 0);
    return total > 0 ? total : null;
  })();
  const openingSvc = s.filters.services.find((x) => x.serviceId === searchOpeningServiceId) ?? s.filters.services[0] ?? null;
  const loadBest = async (offset: number) => {
    try {
      const r = await posBookingApi.openings({ date: calDate || grid?.date || undefined, serviceIds: openingSvc ? [openingSvc.serviceId] : [], limit: 5, offset });
      setBest((prev) => (offset > 0 && prev ? { ...r, openings: [...prev.openings, ...r.openings] } : r));
    } catch (e: any) { setBestNote(e?.message || tx('pos.opening_search_failed')); }
  };
  const nonCancelledAppts = s.bookings.items.filter((a) => !['cancelled', 'no_show'].includes(a.status));
  // whole-day numbers from the SERVER (the board holds one page of technicians and one page of the list)
  const apptCount = Math.max(0, k.totalBookingsToday - k.cancelledBookings - k.noShowBookings);
  const todayDateStr = deviceToday();
  const currentBoardDate = calDate || grid?.date || s.dateRange.from || todayDateStr;
  const isDateToday = currentBoardDate === todayDateStr;
  const curMin = new Date().getHours() * 60 + new Date().getMinutes();

  void curMin;
  const arrivingSoonCount = isDateToday ? ((k as { arrivingSoonBookings?: number }).arrivingSoonBookings ?? 0) : 0;
  const walkinCount = agg?.walkInsToday ?? nonCancelledAppts.filter((a) => a.source === 'walk_in').length;
  const waitlistCount = waitlist ? waitlist.length : null;   // unknown → "—" (it used to show a made-up 4)

  // the whole roster's "free right now" (server), else the working count for another day
  const availableNowCount = isDateToday ? (techPageData?.availableNowCount ?? 0) : (techPageData?.workingCount ?? 0);

  const bookedRevenueDisplay = agg?.bookedRevenueCents != null
    ? money(agg.bookedRevenueCents)
    : money(nonCancelledAppts.reduce((sum, a) => {
        const lineTotal = (a.services || []).reduce((ls, sv) => ls + ((sv as any).priceCents || (sv as any).price || 0), 0);
        return sum + (lineTotal || (a as any).priceCents || 0);
      }, 0));

  const metricCards: { label: string; value: string; sub: React.ReactNode; note?: React.ReactNode; onClick?: () => void }[] = [
    { label: tx('pos.appointments'), value: String(apptCount), sub: <span>{tx('pos.appointments_today')}</span>, onClick: () => setStatus('') },
    { label: tx('pos.arriving_soon_2'), value: isDateToday ? String(arrivingSoonCount) : '—', sub: isDateToday ? tx('pos.next_60_min') : tx('pos.future_date'), onClick: () => setStatus('confirmed') },
    { label: tx('pos.walk_ins'), value: String(walkinCount), sub: tx('pos.walk_in_visits'), onClick: () => setSource('walk_in') },
    { label: tx('pos.waitlist'), value: waitlistCount == null ? '—' : String(waitlistCount), sub: tx('pos.active_requests'), onClick: () => nav('/queue') },
    { label: tx('pos.available_now_2'), value: isDateToday ? String(availableNowCount) : tx('pos.availablenowcount_staff', { availableNowCount: String(availableNowCount) }), sub: <span>{grid ? tx('pos.from_live_schedule') : (isDateToday ? tx('pos.ready_for_work') : tx('pos.scheduled_staff'))}</span>, note: <span>{tx('pos.tech_utilization')}</span> },
    { label: tx('pos.booked_revenue'), value: bookedRevenueDisplay, sub: tx('pos.projected_value') },
  ];

  const ACTIVE_ST = ['booked', 'confirmed', 'arrived', 'checked_in', 'waiting', 'in_service'];
  // the technicians on the board's page (server-paged) — never the whole roster as one list
  const techStatus = (techPageData?.technicians ?? []).map((t) => {
    const appts = s.bookings.items.filter((a) => a.technicianId === t.technicianId);
    const inSvc = appts.find((a) => a.status === 'in_service');
    return { id: t.technicianId, name: t.name, busy: !!inSvc, busyUntil: inSvc?.endTime, count: appts.filter((a) => ACTIVE_ST.includes(a.status)).length };
  }).sort((a, b) => Number(a.busy) - Number(b.busy));
  const insights: { id: string; text: string; severity: 'info' | 'warn' }[] = [];
  if (agg?.serviceCounts?.length) insights.push({ id: 'top', text: tx('pos.highest_demand_name_count_booking_plural_1gyc', { name: String(agg.serviceCounts[0].name), count: String(agg.serviceCounts[0].count), plural: String(agg.serviceCounts[0].count === 1 ? '' : 's') }), severity: 'info' });
  if (agg && k.totalBookingsToday > 0 && agg.walkInsToday / k.totalBookingsToday >= 0.3) insights.push({ id: 'walkin', text: tx('pos.walk_ins_are_v0_of_today_2u48', { v0: String(Math.round((agg.walkInsToday / k.totalBookingsToday) * 100)) }), severity: 'info' });
  if (k.noShowBookings > 0) insights.push({ id: 'noshow', text: tx('pos.noshowbookings_no_show_plural_today_sending_8nb7', { noShowBookings: String(k.noShowBookings), plural: String(k.noShowBookings === 1 ? '' : 's') }), severity: 'warn' });
  if (k.conflictCount > 0) insights.push({ id: 'conflict', text: tx('pos.conflictcount_scheduling_conflict_plural_to_resolve_110j', { conflictCount: String(k.conflictCount), plural: String(k.conflictCount === 1 ? '' : 's') }), severity: 'warn' });
  if (k.onlineBookings > 0 && k.totalBookingsToday > 0) insights.push({ id: 'online', text: tx('pos.v0_of_today_s_bookings_came_1n2p', { v0: String(Math.round((k.onlineBookings / k.totalBookingsToday) * 100)) }), severity: 'info' });

  // Booking Assistant body — one JSX tree rendered in the standard panel AND inside the full-screen
  // slide-over (§10). State lives in this component, so both mounts stay in sync; no duplicated form.
  const assistantBody = (
    <>
        <div role="tablist" aria-label={tx('pos.booking_mode')} style={{ display: 'flex', gap: 4, marginBottom: 10, borderBottom: '1px solid var(--line)' }}>
          {([['new', tx('glossary.action.newBooking')], ['walkin', tx('glossary.action.walkIn')]] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={bookTab === id} onClick={() => {
              setBookTab(id);
              if (id === 'walkin') setForm((f) => ({ ...f, source: 'walk_in', date: grid?.date || s.dateRange.from, time: '' }));
              else setForm((f) => ({ ...f, source: 'manual' }));
              setSlots(null);
            }} style={{ appearance: 'none', border: 'none', background: 'none', font: 'inherit', fontWeight: 700, fontSize: 13, padding: '6px 10px', cursor: 'pointer', color: bookTab === id ? 'var(--aps-orange)' : 'var(--muted)', borderBottom: `2px solid ${bookTab === id ? 'var(--aps-orange)' : 'transparent'}`, marginBottom: -1 }}>{label}</button>
          ))}
        </div>
        {createMsg ? <div style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 8, fontSize: 12.5, background: createMsg.ok ? '#E8F5E9' : '#FDECEA', color: createMsg.ok ? '#1B5E20' : '#B3261E', border: `1px solid ${createMsg.ok ? '#2E7D3233' : '#C0392B33'}` }}>{createMsg.text}</div> : null}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          <input placeholder={tx('pos.customer_name')} value={form.customerName} onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))} style={inputStyle} />
          <input type="tel" inputMode="tel" placeholder={tx('pos.phone')} value={form.customerPhone} onChange={(e) => setForm((f) => ({ ...f, customerPhone: e.target.value }))} style={inputStyle} />
          <select value={form.primaryService} onChange={(e) => { setForm((f) => ({ ...f, primaryService: e.target.value, time: '' })); setSlots(null); }} style={inputStyle}>
            <option value="">{tx('pos.service_4')}</option>
            {s.filters.services.map((sv) => <option key={sv.serviceId} value={sv.serviceId}>{sv.name}</option>)}
          </select>
          <input type="date" value={formDate()} onChange={(e) => { setForm((f) => ({ ...f, date: e.target.value, time: '' })); setSlots(null); }} style={inputStyle} />
          <select value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} style={inputStyle} aria-label={tx('pos.booking_source')}>
            <option value="manual">{tx('pos.manual_front_desk')}</option>
            <option value="phone">{tx('pos.phone')}</option>
            <option value="walk_in">{tx('pos.walk_in_2')}</option>
          </select>
          <select value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} style={inputStyle} disabled={!slots && !form.time}>
            <option value="">{slots ? (availableTimes().length ? tx('pos.pick_a_time') : tx('pos.no_open_slots')) : tx('pos.check_availability')}</option>
            {form.time && !availableTimes().includes(form.time) ? <option value={form.time}>{calLabel(calMinutes(form.time) ?? 0)} {tx('pos.from_calendar')}</option> : null}
            {availableTimes().map((t) => <option key={t} value={t}>{calLabel(calMinutes(t) ?? 0)}</option>)}
          </select>
        </div>
        <div style={{ marginTop: 10 }}>
          <div className="s" style={{ marginBottom: 4 }}>{tx('pos.technician')}{form.technicianId ? '' : ` · ${tx('pos.any_technician')}`}</div>
          <TechnicianPicker value={form.technicianId} selectedName={formTechName} anyLabel={tx('pos.any_technician')} date={formDate() || undefined}
            serviceIds={[form.primaryService, ...form.addons].filter(Boolean)}
            onChange={(id, t) => { setForm((f) => ({ ...f, technicianId: id, time: '' })); setFormTechName(t?.name); setSlots(null); }} />
        </div>
        {s.filters.services.filter((sv) => sv.serviceId !== form.primaryService).length ? (
          <div style={{ marginTop: 10 }}>
            <div className="s" style={{ marginBottom: 4 }}>{tx('pos.add_ons')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {s.filters.services.filter((sv) => sv.serviceId !== form.primaryService).map((sv) => (
                <label key={sv.serviceId} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.addons.includes(sv.serviceId)} onChange={(e) => { setForm((f) => ({ ...f, addons: e.target.checked ? [...f.addons, sv.serviceId] : f.addons.filter((x) => x !== sv.serviceId), time: '' })); setSlots(null); }} />
                  {sv.name}
                </label>
              ))}
            </div>
          </div>
        ) : null}
        <textarea placeholder={tx('pos.notes_optional')} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} style={{ ...inputStyle, height: 'auto', padding: 10, marginTop: 10, width: '100%', resize: 'vertical', boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button className="btn ghost" disabled={slotsBusy} onClick={loadSlots}>{slotsBusy ? tx('pos.checking') : tx('pos.check_availability_2')}</button>
          <button className="btn" disabled={createBusy} onClick={doCreate}>{createBusy ? tx('pos.booking_3') : tx('pos.book_appointment')}</button>
        </div>
        {(() => {
          const primarySvc = s.filters.services.find((sv) => sv.serviceId === form.primaryService);
          const addonSvcs = form.addons.map((id) => s.filters.services.find((sv) => sv.serviceId === id)).filter(Boolean) as { serviceId: string; name: string; priceCents?: number; durationMinutes?: number }[];
          const previewTotal = (primarySvc?.priceCents || 0) + addonSvcs.reduce((a, sv) => a + (sv.priceCents || 0), 0);
          const previewDur = (primarySvc?.durationMinutes || 0) + addonSvcs.reduce((a, sv) => a + (sv.durationMinutes || 0), 0);
          const techName = form.technicianId ? formTechName : undefined;
          const hasAny = !!(form.customerName || primarySvc || techName || form.time);
          return (
            <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              <div className="s" style={{ marginBottom: 8 }}>{tx('pos.customer_preview_how_the_appointment_looks_1k5c')}</div>
              <div  style={{ maxWidth: 300, margin: '0 auto', border: '2px solid #C28A34', borderRadius: 8, padding: 14, background: '#FFFCF6' }}>
                <div style={{ textAlign: 'center', fontWeight: 800, color: '#A96F22', marginBottom: 8 }}>{tx('pos.your_appointment')}</div>
                {!hasAny ? <div className="muted" style={{ textAlign: 'center', fontSize: 12 }}>{tx('pos.fill_the_form_to_preview_the_mcvc')}</div> : (
                  <>
                    <div style={{ fontSize: 12.5, color: '#6A5C45', textAlign: 'center', marginBottom: 10 }}>{formDate() || '—'}{form.time ? ` · ${calLabel(calMinutes(form.time) ?? 0)}` : ''}</div>
                    {primarySvc ? <Line k={primarySvc.name} v={primarySvc.priceCents != null ? money(primarySvc.priceCents) : ''} strong /> : null}
                    {techName ? <div style={{ fontSize: 12, color: '#8A7A66', margin: '2px 0 8px' }}>{tx('pos.with')}{' '}{techName}{previewDur ? tx('pos.previewdur_min', { previewDur: String(previewDur) }) : ''}</div> : null}
                    {addonSvcs.map((sv) => <Line key={sv.serviceId} k={sv.name} v={sv.priceCents != null ? money(sv.priceCents) : ''} />)}
                    {previewTotal > 0 ? <div style={{ borderTop: '1px solid #E7DCC8', marginTop: 8, paddingTop: 8 }}><Line k={tx('pos.total')} v={money(previewTotal)} strong /></div> : null}
                    <button className="btn" style={{ width: '100%', marginTop: 12 }} disabled={createBusy} onClick={doCreate}>{createBusy ? tx('pos.booking_3') : tx('pos.confirm_booking_2')}</button>
                  </>
                )}
              </div>
            </div>
          );
        })()}
    </>
  );

  return (
    <div className="work">
      {askUi}
      <div className="vh flex flex-col md:flex-row gap-3 justify-between">
        <div>
          <h1 style={{ margin: 0, fontSize: 28, color: '#1f1b16' }}>{tx('pos.booking')}</h1>
          <div className="sub" style={{ fontSize: 14, color: 'var(--muted)', marginTop: 4 }}>{tx('pos.a_clear_day_for_your_team_cz0w')}</div>
        </div>
        <div className='items-baseline whitespace-nowrap' style={{ display: 'flex', gap: 12 }}>
          <button onClick={() => nav('/booking/walk-in')} className="btn ghost" >{tx('pos.add_walk_in')}</button>
          <button onClick={() => nav('/booking/new')} className="btn">{tx('pos.new_booking')}</button>
        </div>
      </div>
      {/* Nov 3 audit: the "Booking help" panel asked the model for "the best available slots" with NO schedule data — a billable
          call that could only invent openings. Removed like the old "Optimize schedule" panel; real openings come from the
          optimizer below and New Booking's availability. */}
      {/* Phase 7: the old LLM "Optimize schedule" panel is gone — it asked the generic assistant with no schedule data.
          The deterministic optimizer lives in its own workspace; its findings are drawn on this calendar. */}
      {canSched ? (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5, margin: '6px 0 10px' }} aria-label={tx('pos.ai_scheduling_optimizer')}>
          <Link to="/tenant/ai/scheduling-optimizer" style={{ color: '#A96F22', fontWeight: 700 }}>{tx('pos.ai_scheduling_optimizer_2')}</Link>
          {sched ? <span style={{ color: 'var(--muted)' }}>{sched.gaps.length} {tx('pos.unused_gap')}{enPlural(sched.gaps.length === 1 ? '' : 's')}{sched.utilizationPct != null ? tx('pos.utilization_utilizationpct', { utilizationPct: String(Math.round(sched.utilizationPct)) }) : ''} · {Object.keys(sched.appointments).length} {tx('pos.suggestion')}{enPlural(Object.keys(sched.appointments).length === 1 ? '' : 's')} {tx('pos.on_this_day')}</span> : null}
          {schedOpenConflicts > 0 ? <span data-testid="sched-conflict-badge" style={{ background: '#F7DDD3', color: '#B4451E', borderRadius: 999, padding: '2px 8px', fontWeight: 700, fontSize: 11 }}>⚠ {schedOpenConflicts} {tx('pos.conflict')}{enPlural(schedOpenConflicts === 1 ? '' : 's')}</span> : null}
        </div>
      ) : null}

      {note ? <div className="err" style={{ marginBottom: 12 }}>{note}</div> : null}

      {/* KPI summary cards belong to the normal Booking page only. In View All Techs full-screen mode they are
          removed from the layout flow entirely (not merely hidden) so no empty band remains and the technician
          calendar gets the full viewport — see BOOKING_VIEWALL_KPI_GAP_REPORT.md §1. */}
      {/* 6 Metric Cards (Section B2 of specifications) */}
      {fs !== 'all' ? (
        <div className="kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
          {metricCards.map((c) => (
            <div
              className="kpi"
              key={c.label}
              onClick={c.onClick}
              role={c.onClick ? 'button' : undefined}
              tabIndex={c.onClick ? 0 : undefined}
              style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px', cursor: c.onClick ? 'pointer' : 'default', transition: 'box-shadow 0.15s' }}
            >
              <div className="l" style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>{c.label}</div>
              <div className="v" style={{ fontSize: 22, fontWeight: 800, color: '#1f1b16', margin: '4px 0 2px' }}>{c.value}</div>
              <div className="s" style={{ fontSize: 11, color: 'var(--muted)' }}>
                {c.sub}
                {c.note ? <span style={{ display: 'none' }}>{c.note}</span> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Toolbar 1 (Section B3): Day/Week, Today, Date nav, All services, Status, 15-min grid, Fit day, Full screen */}
      <div className="flex flex-col gap-3 my-1.5 px-3 py-2 bg-[#FFFDF8] border border-[var(--line)] rounded-[10px] md:flex-row md:flex-wrap md:items-center">
        <div
          role="tablist"
          aria-label={tx('pos.calendar_view')}
          className="flex w-fit overflow-hidden rounded-lg border border-[var(--line)] md:inline-flex md:w-auto"
        >
          <button
            type="button"
            role="tab"
            aria-selected={calendarView === 'day'}
            onClick={() => setCalendarView('day')}
            style={{ appearance: 'none', border: 'none', font: 'inherit', fontWeight: 700, fontSize: 12.5, padding: '6px 14px', cursor: 'pointer', background: calendarView === 'day' ? 'var(--aps-orange)' : '#FFFDF8', color: calendarView === 'day' ? '#fff' : 'var(--text)' }}
          >{tx('pos.day')}</button>
          <button
            type="button"
            role="tab"
            aria-selected={calendarView === 'week'}
            onClick={() => setCalendarView('week')}
            style={{ appearance: 'none', border: 'none', borderLeft: '1px solid var(--line)', font: 'inherit', fontWeight: 700, fontSize: 12.5, padding: '6px 14px', cursor: 'pointer', background: calendarView === 'week' ? 'var(--aps-orange)' : '#FFFDF8', color: calendarView === 'week' ? '#fff' : 'var(--text)' }}
          >{tx('pos.week')}</button>
        </div>
        <div className=" flex gap-2 items-center ">
        <button type="button" className="btn ghost w-10 !h-8 " onClick={() => shiftDay(-1)} aria-label={tx('pos.previous_day')} style={{ padding: '6px 10px', fontSize: 13 }}>‹</button>
        <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
          <input
            type="date"
            aria-label={tx('pos.calendar_date')}
            value={calDate || grid?.date || s.dateRange.from}
            onChange={(e) => setCalDate(e.target.value)}
            style={{ ...inputStyle, fontWeight: 700 }}
          />
        </div>
          <button type="button" className="btn ghost w-10 !h-8" onClick={() => shiftDay(1)} aria-label={tx('pos.next_day')} style={{ padding: '6px 10px', fontSize: 13 }}>›</button>
        {calDate ? <button type="button" className="btn ghost" onClick={() => setCalDate('')} style={{ fontSize: 12.5, padding: '6px 10px' }}>{tx('pos.today_2')}</button> : null}
          <button type="button" className="btn ghost" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)} style={{ fontSize: 12.5, padding: '6px 10px' }}>
            {tx('pos.more_filters')}{(branchId ? 1 : 0) + (depositStatus ? 1 : 0) + (conflictOnly ? 1 : 0) ? ` (${(branchId ? 1 : 0) + (depositStatus ? 1 : 0) + (conflictOnly ? 1 : 0)})` : ''}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <select aria-label={tx('pos.calendar_service_filter')} value={catFilter} onChange={(e) => setCatFilter(e.target.value)} style={{ ...inputStyle, height: 34 }}>
            <option value="">{tx('pos.all_services')}</option>
            {s.filters.serviceCategories.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <TechnicianJump value={techSearch} onChange={setTechSearch} matches={techMatches} onPick={jumpToTechnician} />
          <select aria-label={tx('pos.calendar_status_filter')} value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...inputStyle, height: 34 }}>
            <option value="">{tx('pos.status_all')}</option>
            {s.filters.statuses.map((x) => <option key={x} value={x}>{statusLabel('appointment', x)}</option>)}
          </select>
          <select aria-label={tx('pos.calendar_source_filter')} value={source} onChange={(e) => setSource(e.target.value)} style={{ ...inputStyle, height: 34 }}>
            <option value="">{tx('pos.all_sources_2')}</option>
            {s.filters.sources.map((x) => <option key={x} value={x}>{statusLabel('source', x)}</option>)}
          </select>
          <select aria-label={tx('pos.grid_increment')} value={slotIncrement} onChange={(e) => setSlotIncrement(Number(e.target.value))} style={{ ...inputStyle, height: 34 }}>
            <option value={15}>{tx('pos.15_min_grid')}</option>
            <option value={30}>{tx('pos.30_min_grid')}</option>
            <option value={60}>{tx('pos.60_min_grid')}</option>
          </select>
          <button
            type="button"
            className={`btn ${fitDay ? '' : 'ghost'}`}
            onClick={() => setFitDay(!fitDay)}
            style={{ fontSize: 12, padding: '6px 10px' }}
          >{tx('pos.fit_day')}</button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => setFs(fs ? null : 'all')}
            style={{ fontSize: 12, padding: '6px 10px' }}
          >{fs === 'all' ? tx('pos.exit_full_screen') : tx('pos.full_screen_3')}</button>
        </div>
      </div>

      {/* Toolbar 2 (Section B4): Find opening, Service & duration, Best matches, Working techs, 12 per page, Paging */}
      <div className="flex flex-wrap items-center gap-2.5 mb-3 px-3 py-2 bg-[#F8F9FA] border border-[var(--line)] rounded-[10px]">
        <button
          type="button"
          className="btn "
          onClick={() => nav(`/booking/new?date=${encodeURIComponent(calDate || grid?.date || '')}${openingSvc ? `&serviceId=${encodeURIComponent(openingSvc.serviceId)}` : ''}`)}
        >
          {tx('pos.find_an_opening')}
        </button>
        <select
          aria-label={tx('pos.opening_search_service')}
          value={openingSvc?.serviceId ?? ''}
          onChange={(e) => { setSearchOpeningServiceId(e.target.value); setBestNote(null); }}
          style={{ ...inputStyle, height: 32, fontSize: 12, fontWeight: 600 }}
        >
          {s.filters.services.map((sv) => <option key={sv.serviceId} value={sv.serviceId}>{sv.name}{sv.durationMinutes ? ` · ${sv.durationMinutes} ${tx('pos.min')}` : ''}</option>)}
        </select>
        <button
          type="button"
          className="btn ghost"
          aria-expanded={!!best}
          onClick={() => { setBestNote(null); void loadBest(0); }}
          style={{ height: 34, fontSize: 12.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}
        >
          {tx('pos.best_matches')}
        </button>
        {bestNote ? <span role="status" style={{ fontSize: 12, color: '#B45309' }}>{bestNote}</span> : null}
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5 }}>
          <input type="checkbox" checked={workingToday} onChange={(e) => { setWorkingToday(e.target.checked); setTechPage(1); }} />
          <span className="pill" style={{ fontSize: 11.5, background: '#EAF7F0', color: '#1B5E20', border: '1px solid #B8E2CB' }}>
            {tx('pos.working_technicians_count', { working: String(techPageData?.workingCount ?? 0), total: String(techPageData?.totalAll ?? 0) })}
          </span>
        </label>

        <div role="navigation" aria-label={tx('pos.technician_pages')} style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <select
            value={techPageSize}
            onChange={(e) => { setTechPageSize(Number(e.target.value)); setTechPage(1); }}
            style={{ ...inputStyle, height: 32, fontSize: 12 }}
            aria-label={tx('pos.technician_density')}
          >
            <option value={6}>{tx('pos.6_per_page')}</option>
            <option value={8}>{tx('pos.8_per_page')}</option>
            <option value={12}>{tx('pos.12_per_page')}</option>
          </select>
          {(() => {
            const tp = techPageData; const page = tp?.page ?? 1; const pages = tp?.totalPages ?? 1;
            const first = tp && tp.total ? (page - 1) * tp.pageSize + 1 : 0; const last = tp ? Math.min(tp.total, (page - 1) * tp.pageSize + tp.technicians.length) : 0;
            const go = (n: number) => setTechPage(Math.min(Math.max(1, n), pages));
            return (
              <>
                <button type="button" className="btn ghost" disabled={page <= 1} onClick={() => go(1)} style={{ padding: '4px 8px', fontSize: 12 }}>{tx('pos.first_page')}</button>
                <button type="button" className="btn ghost" disabled={page <= 1} onClick={() => go(page - 1)} style={{ padding: '4px 8px', fontSize: 12 }}>{tx('pos.previous')}</button>
                <span data-testid="tech-page-label" style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{tx('pos.page_x_of_y', { page: String(page), pages: String(pages) })}</span>
                <span data-testid="tech-range-label" style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>{tx('pos.technicians')}{' '}{first}–{last} {tx('pos.of')}{' '}{tp?.total ?? 0}</span>
                <button type="button" className="btn ghost" disabled={page >= pages} onClick={() => go(page + 1)} style={{ padding: '4px 8px', fontSize: 12 }}>{tx('pos.next')}{' '}{tp?.pageSize ?? techPageSize} ›</button>
                <button type="button" className="btn ghost" disabled={page >= pages} onClick={() => go(pages)} style={{ padding: '4px 8px', fontSize: 12 }}>{tx('pos.last_page')}</button>
              </>
            );
          })()}
        </div>
      </div>
      {best ? (
        <section className="panel" aria-label={tx('pos.best_matches')} style={{ marginBottom: 12 }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{tx('pos.best_matches')}
            <span className="s">{tx('pos.best_matches_summary', { service: openingSvc?.name ?? '', eligible: String(best.eligibleCount), open: String(best.withOpenings) })}</span>
            <button type="button" className="btn ghost" style={{ marginLeft: 'auto', fontSize: 12 }} onClick={() => setBest(null)}>{tx('pos.close')}</button>
          </h2>
          {best.openings.length === 0 ? <div className="muted">{tx('pos.no_opening_for_service', { service: openingSvc?.name ?? '' })}</div> : (
            <div className="list">
              {best.openings.map((o: BookingOpening) => (
                <div key={o.technicianId} className="row" style={{ alignItems: 'center' }}>
                  <span className="pill">{o.rank}</span>
                  <div className="t" style={{ flex: 1 }}>#{o.rosterNumber} {o.name}</div>
                  <div className="s">{calLabel(calMinutes(o.time) ?? 0)} · {tx('pos.open_slots_count', { n: String(o.openSlots) })}</div>
                  <button type="button" className="btn ghost" style={{ fontSize: 12 }} onClick={() => jumpToTechnician(o.technicianId)}>{tx('pos.show_on_board')}</button>
                  <button type="button" className="btn" style={{ fontSize: 12 }} onClick={() => nav(`/booking/new?technicianId=${encodeURIComponent(o.technicianId)}&time=${encodeURIComponent(o.time)}&date=${encodeURIComponent(best.date)}${openingSvc ? `&serviceId=${encodeURIComponent(openingSvc.serviceId)}` : ''}`)}>{tx('pos.book')}</button>
                </div>
              ))}
            </div>
          )}
          {best.hasMore ? <button type="button" className="btn ghost" style={{ marginTop: 8 }} onClick={() => void loadBest(best.offset + best.limit)}>{tx('pos.view_more')}</button> : null}
        </section>
      ) : null}

      {moreOpen ? (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #E7DCC8' }}>
          {s.filters.branches.length > 1 ? (
            <select aria-label={tx('pos.branch_filter')} value={branchId} onChange={(e) => setBranchId(e.target.value)} style={{ ...inputStyle, height: 34 }}>
              <option value="">{tx('pos.all_branches')}</option>{s.filters.branches.map((b) => <option key={b.branchId} value={b.branchId}>{b.name}</option>)}
            </select>
          ) : null}
          <select aria-label={tx('pos.deposit_filter')} value={depositStatus} onChange={(e) => setDepositStatus(e.target.value)} style={{ ...inputStyle, height: 34 }}>
            <option value="">{tx('pos.any_deposit_status')}</option><option value="required">{tx('pos.deposit_required')}</option><option value="paid">{tx('pos.deposit_paid')}</option><option value="not_required">{tx('pos.no_deposit')}</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={conflictOnly} onChange={(e) => setConflictOnly(e.target.checked)} /> {tx('pos.conflicts_only')}
          </label>
          {branchId || depositStatus || conflictOnly ? (
            <button className="btn ghost" style={{ height: 34 }} onClick={() => { setBranchId(''); setDepositStatus(''); setConflictOnly(false); }}>{tx('pos.clear')}</button>
          ) : null}
        </div>
      ) : null}
      {calendarView === 'week' ? (
        <section className="panel" style={{ padding: 16 }} aria-label={tx('pos.week_agenda')}>
          <h3 style={{ margin: '0 0 12px' }}>{tx('pos.week_agenda')}{' '}{week?.from ?? ''} {tx('pos.to')}{' '}{week?.to ?? ''}
            {week && week.total > week.items.length ? <span className="s" style={{ marginLeft: 8 }}>{tx('pos.showing_x_of_y', { x: String(week.items.length), y: String(week.total) })}</span> : null}</h3>
          {!week ? <div className="state">{tx('pos.loading_booking')}</div> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {weekDays(week.from).map((day) => {
              const dayRows = week.items.filter((a) => a.date === day);
              const shown = dayRows.slice(0, WEEK_DAY_CAP);
              return (
                <div key={day} data-week-day={day} style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 8, padding: 10 }}>
                  <button type="button" onClick={() => { setCalDate(day); setCalendarView('day'); }} style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%', fontWeight: 800, fontSize: 13, color: '#1f1b16', marginBottom: 8, borderBottom: '1px solid var(--line)', paddingBottom: 4 }}>
                    {fmtYmd(day, { weekday: 'short', month: 'short', day: 'numeric' }, day)} · {dayRows.length}
                  </button>
                  {dayRows.length === 0 ? <div style={{ fontSize: 11, color: 'var(--muted)' }}>{tx('pos.no_bookings')}</div> : shown.map((a) => (
                    <div key={a.appointmentId} onClick={() => toggleDrawer(a)} style={{ fontSize: 11, padding: '4px 6px', background: '#F5EFE6', borderRadius: 4, marginBottom: 4, cursor: 'pointer' }}>
                      <strong>{tm(a.startTime)}</strong> · {a.customerName}{a.technicianName ? ` · ${a.technicianName}` : ''}
                    </div>
                  ))}
                  {dayRows.length > shown.length ? <button type="button" className="btn ghost" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => { setCalDate(day); setCalendarView('day'); }}>{tx('pos.plus_n_more_open_day', { n: String(dayRows.length - shown.length) })}</button> : null}
                </div>
              );
            })}
          </div>
          )}
          {week && week.total > week.items.length ? <button type="button" className="btn ghost" style={{ marginTop: 10 }} onClick={() => void loadWeek(week.page + 1)}>{tx('pos.view_more')}</button> : null}
        </section>
      ) : (
        <BookingCalendar
          rows={grid?.appointments ?? []}
          technicians={(techPageData?.technicians ?? []).map((t) => ({ technicianId: t.technicianId, name: t.name }))}
          grid={grid}
          openTime={s.settings?.openTime}
          closeTime={s.settings?.closeTime}
          dateLabel={s.dateRange.from}
          paging={techPageData ? { total: techPageData.total, page: techPageData.page, totalPages: techPageData.totalPages, pageSize: techPageData.pageSize,
            first: techPageData.total ? (techPageData.page - 1) * techPageData.pageSize + 1 : 0, last: Math.min(techPageData.total, (techPageData.page - 1) * techPageData.pageSize + techPageData.technicians.length) } : null}
          highlightTechId={highlightTech}
          onPick={(aid) => { const a = (grid?.appointments ?? []).find((x) => x.appointmentId === aid) ?? s.bookings.items.find((x) => x.appointmentId === aid); if (a) toggleDrawer(a); }}
          onSlotPick={prefillSlot}
          onMove={moveAppointment}
          fs={fs}
          onFs={setFs}
          selectedServiceMinutes={selectedServiceMinutes}
          assistant={assistantBody}
          techPage={techPage}
          techPageSize={techPageData?.pageSize ?? techPageSize}
          onTechPageChange={(n) => setTechPage(Math.min(Math.max(1, n), techPageData?.totalPages ?? n))}
          onTechPageSizeChange={setTechPageSize}
          nav={nav}
          sched={sched}
          onOpenRec={(id) => nav(`/tenant/ai/scheduling-optimizer?rec=${encodeURIComponent(id)}`)}
          onBlockAdd={async (technicianId, startTime, endTime, reasonTxt) => {
            await posBookingApi.addBlockedTime({ technicianId, date: grid?.date, startTime, endTime, reason: reasonTxt });
            await refetch();
          }}
          onBlockRemove={async (blockId) => {
            try { await posBookingApi.removeBlockedTime(blockId); await refetch(); }
            catch (e: any) { setNote(e?.message || tx('pos.could_not_remove_that_blocked_window')); }
          }}
          controls={{
            date: calDate || grid?.date || s.dateRange.from,
            onPrev: () => shiftDay(-1), onNext: () => shiftDay(1), onToday: () => setCalDate(''), onDate: (d) => setCalDate(d),
            search: techSearch, onSearch: setTechSearch,   // Full Screen's box searches TECHNICIANS (server), not appointments
            status, onStatus: setStatus, statuses: s.filters.statuses,
            source, onSource: setSource, sources: s.filters.sources,
            techFilter, onTechFilter: setTechFilter,
            workingToday, onWorkingToday: setWorkingToday,
          }}
        />
      )}

      <section className="panel mb-3 " id="booking-assistant" ref={assistantRef as any}>
        <h2>{tx('pos.booking_assistant')}{' '}<span className="s">{tx('pos.new_appointment')}</span></h2>
        <div
          className="w-full max-w-full min-w-0 overflow-x-auto"
          style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}
        >
          <div className="w-full min-w-[800px] pb-2">
            {assistantBody}
          </div>
        </div>
      </section>

      <section className="panel">
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <ImeSafeInput type="search" enterKeyHint="search" placeholder={tx('pos.search_customer_phone_tech')} value={search} onValue={setSearch}
            style={{ flex: 1, minWidth: 200, height: 36, border: '1px solid var(--line)', borderRadius: 10, padding: '0 12px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 13 }} />
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...inputStyle, height: 36 }}>
            <option value="">{tx('pos.all_statuses')}</option>
            {s.filters.statuses.map((x) => <option key={x} value={x}>{statusLabel('appointment', x)}</option>)}
          </select>
          <TechnicianPickerButton value={techFilter} valueName={techFilterName} emptyLabel={tx('pos.all_technicians_2')} anyLabel={tx('pos.all_technicians_2')}
            ariaLabel={tx('pos.all_technicians_2')} date={calDate || grid?.date || undefined}
            onChange={(id, t) => { setTechFilter(id); setTechFilterName(t?.name); }} />
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} style={{ ...inputStyle, height: 36 }}>
            <option value="">{tx('pos.all_services_2')}</option>
            {s.filters.serviceCategories.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value)} style={{ ...inputStyle, height: 36 }}>
            <option value="">{tx('pos.all_sources')}</option>
            {s.filters.sources.map((x) => <option key={x} value={x}>{statusLabel('source', x)}</option>)}
          </select>
        </div>

        {s.bookings.items.length > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: '#F5EFE6', border: '1px solid var(--line)', borderRadius: '8px 8px 0 0', fontSize: 11, fontWeight: 700, color: '#6E5D4B', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4 }}>
            <div style={{ width: 140, flex: 'none' }}>{tx('pos.time')}</div>
            <div style={{ flex: '1 1 180px', minWidth: 150 }}>{tx('pos.customer_service')}</div>
            <div style={{ width: 110, flex: 'none' }}>{tx('pos.status')}</div>
            <div style={{ width: 130, flex: 'none' }}>{tx('pos.deposit')}</div>
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>{tx('pos.actions')}</div>
          </div>
        ) : null}

        <div className="list" style={{ maxHeight: 'calc(100vh - 320px)' }}>
          {s.bookings.items.length === 0 ? <div className="muted">{tx('pos.no_appointments_match')}</div> : null}
          {s.bookings.items.map((a) => (
            <div key={a.appointmentId} data-appt-row={a.appointmentId} style={{ borderBottom: '1px solid var(--line)' }}>
              <div className="row" style={{ borderBottom: 'none', gap: 12, alignItems: 'center' }}>
                <div style={{ width: 140, flex: 'none' }} className="s">{tm(a.startTime)}–{tm(a.endTime)}</div>
                <div style={{ flex: '1 1 180px', minWidth: 150 }}>
                  <div className="t" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <ProfileAvatarWithPreview name={a.customerName} url={(a as any).customerAvatarUrl} size={26} type="customer" subtitle={a.customerPhone || undefined} onClick={() => openCustomerProfile(a)} />
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openCustomerProfile(a); }}
                      title={tx('pos.view_customer_profile')}
                      style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, color: 'var(--ink)', cursor: 'pointer' }}
                    >
                      {a.customerName}
                    </button>
                    {a.isVip ? <span className="pill warn">VIP</span> : null}
                    {memberStatus[a.customerId || ''] ? (
                      <MembershipChip planName={memberStatus[a.customerId || ''].planName} status={memberStatus[a.customerId || ''].status} compact />
                    ) : null}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openCustomerProfile(a); }}
                      title={tx('pos.open_customer_profile')}
                      style={{
                        background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 6,
                        padding: '1px 6px', fontSize: 10.5, fontWeight: 600, color: 'var(--orange)',
                        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3
                      }}
                    >
                      {tx('pos.profile')}
                    </button>
                  </div>
                  <div className="s" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 }}><span>{svcNames(a.services) || '—'}</span> · <SourceBadge source={a.source} />{a.technicianName ? <span>· {a.technicianName}</span> : null}</div>
                </div>
                <div style={{ width: 110, flex: 'none' }}>
                  <span className={'pill ' + statusTone((a as any).displayStatus || a.status, (a as any).queueKey, (a as any).techTicketStatus, !!a.technicianId)}>{formatStatusLabel((a as any).displayStatus || a.status, (a as any).queueKey, (a as any).techTicketStatus, !!a.technicianId, (a as any).startSource)}{(a as any).lateMinutes ? tx('pos.lateminutes_min', { lateMinutes: String((a as any).lateMinutes) }) : ''}</span>
                </div>
                <div style={{ width: 130, flex: 'none' }}>
                  {a.depositStatus === 'pending' ? <span className="pill warn">{tx('pos.deposit_pending')}</span>
                    : a.depositStatus === 'collected' ? <span className="pill ok">{tx('pos.deposit_paid_2')}</span>
                    : a.depositStatus === 'refunded' ? <span className="pill">{tx('pos.deposit_refunded')}</span>
                    : <span className="muted" style={{ fontSize: 11.5 }}>{tx('pos.not_required')}</span>}
                  {a.conflictStatus && a.conflictStatus !== 'none' ? <span className="pill warn" style={{ marginLeft: 4 }}>{tx('pos.conflict')}</span> : null}
                </div>
                {(() => {
                  const st = (a.status || '').toLowerCase();
                  const isEnqueued = !!(a as any).queueKey;
                  const isBookedOrConfirmed = st === 'booked' || st === 'confirmed';
                  const isCheckedInOrArrived = st === 'checked_in' || st === 'arrived';
                  const isWaitingOrQueue = st === 'waiting' || st === 'queue' || st === 'in_queue' || isEnqueued;
                  const isInService = st === 'in_service' || (a as any).techTicketStatus === 'serving' || st === 'completed' || st === 'cancelled' || st === 'no_show';

                  const showArrived = isBookedOrConfirmed && !isEnqueued && !isInService;   // Decision 38: in the salon, not yet checked in
                  const showCheckIn = (isBookedOrConfirmed || st === 'arrived') && !isEnqueued && !isInService;
                  const showToQueue = (isBookedOrConfirmed || isCheckedInOrArrived) && !isEnqueued && !isInService;
                  const showStart = (isBookedOrConfirmed || isCheckedInOrArrived || isWaitingOrQueue) && !isInService;

                  return (
                    // §76/§79: on a narrow screen (or with longer Vietnamese labels) the buttons wrap as whole buttons, never
                    // their text inside a fixed-height button
                    <div className="aps-row-actions" style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexWrap: 'wrap', justifyContent: 'flex-end', rowGap: 4 }}>
                      {showArrived && (
                        <button className="btn ghost" disabled={busyId === a.appointmentId + 'ar'} onClick={() => act(a.appointmentId, () => posBookingApi.markArrived(a.appointmentId), 'ar')}>{tx('pos.arrived')}</button>
                      )}
                      {showCheckIn && (
                        <button className="btn ghost" disabled={busyId === a.appointmentId + 'ci'} onClick={() => act(a.appointmentId, () => posCheckInApi.appointmentCheckIn(a.appointmentId), 'ci')}>{tx('pos.check_in')}</button>
                      )}
                      {showToQueue && (
                        <button className="btn ghost" disabled={busyId === a.appointmentId + 'mq'} onClick={() => act(a.appointmentId, () => posBookingApi.moveToQueue(a.appointmentId), 'mq')}>{tx('pos.to_queue')}</button>
                      )}
                      {showStart && (
                        <button className="btn ghost" disabled={busyId === a.appointmentId + 'ss'} onClick={() => act(a.appointmentId, () => posBookingApi.startService(a.appointmentId), 'ss')}>{tx('pos.start')}</button>
                      )}
                      <button className="btn ghost" title={tx('pos.open_full_ipad_view')} onClick={() => openIPad(appointmentRequest(a as any, refetch))}>{tx('pos.full_view')}</button>
                      <button className="btn" onClick={() => toggleDrawer(a)}>{openId === a.appointmentId ? tx('pos.close') : tx('pos.manage')}</button>
                    </div>
                  );
                })()}
              </div>

              {openId === a.appointmentId ? (
                <div style={{ padding: '4px 4px 12px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                  <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10, background: '#FFFDF8' }}>
                    <div className="s" style={{ marginBottom: 6 }}>{tx('pos.assign_reschedule')}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <TechnicianPickerButton value={techSel} valueName={techSelName} emptyLabel={tx('pos.choose_technician')} ariaLabel={tx('pos.choose_technician')}
                        date={a.date || calDate || grid?.date || undefined} onChange={(id, t) => { setTechSel(id); setTechSelName(t?.name); }} style={{ height: 34, maxWidth: 'none', width: '100%' }} />
                      <input type="datetime-local" value={whenStr} onChange={(e) => setWhenStr(e.target.value)} style={inputStyle} />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn ghost" disabled={busyId === a.appointmentId + 'assign'} onClick={() => doAssign(a.appointmentId)}>{tx('pos.assign')}</button>
                        <button className="btn" disabled={busyId === a.appointmentId + 'resch'} onClick={() => doReschedule(a.appointmentId)}>{tx('pos.reschedule')}</button>
                        <button className="btn ghost" onClick={() => setMoveFor(a)} title={tx('pos.guided_move_with_real_suggested_open_7j1a')}>{tx('pos.move')}</button>
                      </div>
                    </div>
                  </div>
                  <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10, background: '#FFFDF8' }}>
                    <div className="s" style={{ marginBottom: 6 }}>{tx('pos.cancel_no_show_reason_required')}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <input placeholder={tx('pos.reason_3')} value={reason} onChange={(e) => setReason(e.target.value)} style={inputStyle} />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn ghost" disabled={busyId === a.appointmentId + 'noshow'} onClick={() => doNoShow(a.appointmentId)}>{tx('pos.no_show_2')}</button>
                        <button className="btn ghost" disabled={busyId === a.appointmentId + 'cancel'} onClick={() => doCancel(a.appointmentId)} style={{ color: 'var(--danger)' }}>{tx('pos.cancel_appt')}</button>
                      </div>
                    </div>
                  </div>
                  <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10, background: '#FFFDF8' }}>
                    <div className="s" style={{ marginBottom: 6 }}>{tx('pos.customer_profile_contact')}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{a.customerName} {a.isVip ? <span className="pill warn">VIP</span> : null}</div>
                      <div className="s">{a.customerPhone ? tx('pos.phone_customerphone', { customerPhone: String(a.customerPhone) }) : tx('pos.no_phone_registered')}</div>
                      <button className="btn ghost" onClick={() => openCustomerProfile(a)} style={{ color: 'var(--orange)', display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                        {tx('pos.view_full_customer_profile')}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        {(() => { const pg = s.bookings.pagination; const tp = Number(pg?.totalPages ?? 1); if (!pg || tp <= 1) return null; const cur = Number(pg.page ?? listPage); return (
          <div data-testid="booking-list-pager" style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', padding: '8px 4px', fontSize: 12 }}>
            <span className="s">{tx('pos.showing_x_of_y', { x: String(s.bookings.items.length), y: String(pg.totalItems ?? s.bookings.items.length) })}</span>
            <button type="button" className="btn ghost" disabled={cur <= 1} onClick={() => setListPage(1)}>{tx('pos.first_page')}</button>
            <button type="button" className="btn ghost" disabled={cur <= 1} onClick={() => setListPage(cur - 1)}>{tx('pos.previous')}</button>
            <span>{tx('pos.page_x_of_y', { page: String(cur), pages: String(tp) })}</span>
            <button type="button" className="btn ghost" disabled={cur >= tp} onClick={() => setListPage(cur + 1)}>{tx('pos.next')}</button>
            <button type="button" className="btn ghost" disabled={cur >= tp} onClick={() => setListPage(tp)}>{tx('pos.last_page')}</button>
          </div>); })()}
      </section>

      <div className="grid grid-cols-1  md:grid-cols-2 gap-3 mt-3">
        <MixDonut title={tx('pos.channel_source_mix')} sub={tx('pos.today')} items={(agg?.sourceCounts || []).map((x) => ({ label: srcLabel(x.source), count: x.count }))} />
        <MixDonut title={tx('pos.service_mix')} sub={tx('pos.today')} items={(agg?.serviceCounts || []).slice(0, 6).map((x) => ({ label: x.name, count: x.count }))} />
      </div>

      <div className="grid grid-cols-1  md:grid-cols-2 gap-3 mt-3">
        <section className="panel">
          <h2>{tx('pos.upcoming_appointments')}{' '}<span className="s">{tx('pos.booked_confirmed')}</span></h2>
          <div className="list">
            {(() => {
              const up = s.bookings.items.filter((a) => a.status === 'booked' || a.status === 'confirmed').sort((a, b) => (calMinutes(a.startTime) ?? 0) - (calMinutes(b.startTime) ?? 0)).slice(0, 8);
              if (up.length === 0) return <div className="muted">{tx('pos.no_upcoming_appointments')}</div>;
              return up.map((a) => (
                <div className="row" key={a.appointmentId} style={{ cursor: 'pointer' }} onClick={() => toggleDrawer(a)}>
                  <div className="s" style={{ minWidth: 56 }}>{calLabel(calMinutes(a.startTime) ?? 0)}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ProfileAvatarWithPreview name={a.customerName} url={(a as any).customerAvatarUrl} size={26} type="customer" />
                    <div><div className="t">{a.customerName}</div><div className="s">{svcNames(a.services) || '—'}{a.technicianName ? ' · ' + a.technicianName : ''}</div></div>
                  </div>
                  <span className={'pill ' + (a.status === 'confirmed' ? 'ok' : '')} style={{ marginLeft: 'auto' }}>{statusLabel('appointment', a.status)}</span>
                </div>
              ));
            })()}
          </div>
        </section>

        <section className="panel">
          <h2>{tx('pos.booking_conversion')}{' '}<span className="s">{tx('pos.today_5')}</span></h2>
          <div style={{ display: 'flex', gap: 16, marginTop: 6 }}>
            <div><div className="v" style={{ fontSize: 26, fontWeight: 800 }}>{k.totalBookingsToday}</div><div className="s">{tx('pos.bookings')}</div></div>
            <div><div className="v" style={{ fontSize: 26, fontWeight: 800 }}>{k.confirmedBookings}</div><div className="s">{tx('pos.confirmed_2')}</div></div>
            <div><div className="v" style={{ fontSize: 26, fontWeight: 800 }}>{k.totalBookingsToday > 0 ? Math.round((k.confirmedBookings / k.totalBookingsToday) * 100) + '%' : '—'}</div><div className="s">{tx('pos.confirmed_rate')}</div></div>
          </div>
          <div className="s" style={{ marginTop: 10 }}>{tx('pos.visitor_to_booking_conversion_needs_website_1ofl')}</div>
        </section>
      </div>

      <div className="grid grid-cols-1  md:grid-cols-2 2xl:grid-cols-3 gap-3 mt-3">
        <section className="panel">
          <h2>{tx('pos.available_technicians')}{' '}<span className="s">{tx('pos.from_today_s_schedule')}</span></h2>
          <div className="list">
            {techStatus.length === 0 ? <div className="muted">{tx('pos.no_technicians_on_file')}</div> : techStatus.map((t) => (
              <div className="row" key={t.id}>
                <div className="t">{t.name}</div>
                <span className={'pill ' + (t.busy ? 'warn' : 'ok')} style={{ marginLeft: 'auto' }}>{t.busy ? (t.busyUntil ? tx('pos.busy_until_v0', { v0: String(calLabel(calMinutes(t.busyUntil) ?? 0)) }) : tx('pos.busy')) : tx('pos.available')}</span>
                <span className="s" style={{ minWidth: 64, textAlign: 'right' }}>{t.count} {tx('pos.today')}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>{tx('pos.ai_insights')}</h2>
          <div className="list">
            {insights.length === 0 ? <div className="muted">{tx('pos.no_insights_right_now')}</div> : insights.map((ins) => (
              <div className="row" key={ins.id}>
                <span className={'pill ' + (ins.severity === 'warn' ? 'warn' : '')} style={{ flex: 'none' }}>{ins.severity === 'warn' ? '!' : 'i'}</span>
                <div className="t" style={{ marginLeft: 8 }}>{ins.text}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>{tx('pos.waitlist_standby')}{' '}<span className="s">{tx('pos.waiting_in_customer_queue')}</span></h2>
          {waitlist === null ? <div className="muted">{tx('pos.queue_unavailable_right_now')}</div>
            : waitlist.length === 0 ? <div className="muted">{tx('pos.no_one_is_waiting')}</div>
            : (
              <div className="list">
                {waitlist.map((w) => (
                  <div className="row" key={w.queueItemId}>
                    <div><div className="t">{w.customerName}</div><div className="s">{w.services || '—'}</div></div>
                    <span className="pill" style={{ marginLeft: 'auto' }}>{w.waitedMin != null ? tx('pos.waitedmin_min', { waitedMin: String(w.waitedMin) }) : 'waiting'}</span>
                  </div>
                ))}
              </div>
            )}
          <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => nav('/queue')}>{tx('pos.view_full_waitlist')}</button>
        </section>
      </div>

      <section className="panel" style={{ marginTop: 12 }}>
        <h2>{tx('pos.quick_actions_2')}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5 mt-2.5">
          {[
            {
              l: tx('pos.move_appointment'),
              d: 'M3 8h10M9 4l4 4-4 4', // arrow move
              fn: () => {
                const a = openId ? s.bookings.items.find((x) => x.appointmentId === openId) : null;
                if (a) {
                  setMoveFor(a);
                } else {
                  document.getElementById('booking-table')?.scrollIntoView({ behavior: 'smooth' });
                  setNote(tx('pos.pick_an_appointment_below_manage_first_7ges'));
                }
              },
            },
            {
              l: tx('pos.send_reminder'),
              d: 'M2.8 3.6h10.4v7H6l-3.2 2.4ZM8 5.8v2.4M8 9.8h.01', // message/reminder
              fn: () => nav('/tenant/communications/sms'),
            },
            {
              l: tx('pos.assign_tech'),
              d: 'M6 7.2A2 2 0 1 0 6 3.2a2 2 0 0 0 0 4ZM2.3 12.6c0-2 1.5-3.3 3.3-3.3M10.6 7.3a1.8 1.8 0 1 0 0-3.6M9.5 9.4c2 0 3.4 1.3 3.4 3.2', // user assign
              fn: () => nav('/tech-queue'),
            },
            {
              l: tx('pos.view_calendar'),
              d: 'M3 4.4h10v8.6H3ZM3 6.9h10M5.6 2.8v2M10.4 2.8v2', // calendar
              fn: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
            },
            {
              l: tx('pos.refresh'),
              d: 'M13.5 8A5.5 5.5 0 1 1 12 4.1L13.5 2v4H9.5', // refresh loop
              fn: () => refetch(),
            },
          ].map((a) => (
            <button
              key={a.l}
              type="button"
              onClick={a.fn}
              className="group dqa flex flex-col items-center justify-center gap-1.5 p-3 rounded-lg border border-[#e5d8c3]/70 bg-white text-center cursor-pointer transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-[#fbf7ee] hover:border-[#a96f22] hover:shadow-md active:translate-y-0 active:shadow-sm"
            >
              <svg
                className="dqa-ic transition-transform duration-200 ease-out group-hover:scale-110"
                viewBox="0 0 16 16"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ stroke: 'var(--aps-orange, #a96f22)' }}
              >
                <path d={a.d} />
              </svg>
              <span className="text-[12px] font-semibold text-[#2c251e] leading-tight transition-colors duration-200 group-hover:text-[#a96f22]">
                {a.l}
              </span>
            </button>
          ))}
        </div>
      </section>
      {moveFor ? <MoveAppointmentModal appt={moveFor} defaultDate={grid?.date || s.dateRange.from} onClose={() => setMoveFor(null)} onMoved={async () => { await refetch(); }} /> : null}
    </div>
  );
}
