// BookingKpiStrip.tsx — booking200 addendum §08 (round 12): the Booking page's six KPI cards — Appointments, Arriving soon,
// Walk-ins, Waitlist, Available now, Booked revenue — rendered from GET /pos/booking/kpi-cards. Every number comes from the
// server (no rule is re-derived here); a card whose source could not be read says so ("—" + "Could not load"), never 0;
// the "now" cards on another date say "Today only". Six equal cards in one row when wide, 3 × 2 / 2 × 3 when narrower
// (equal-height rows) — decided by the strip's OWN width (a container query), so the sidebar's state never breaks it. Tapping a card opens the board's filtered list where an authorized list exists (onOpen).
// Scoped to this component: no shared top-bar / sidebar styles, no broad selectors.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { BookingKpiCards, BookingKpiValue } from '@aipowersalon/api-contracts/tenant';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posBookingApi } from '../../api/posBookingApi';
import { fmtMoney } from '../../i18n/format';
import { useSessionState } from '../../components/useSessionState';

export type BookingKpiCardKey = 'appointments' | 'arrivingSoon' | 'walkIns' | 'waitlist' | 'availableNow' | 'bookedRevenue';
/** the Arriving-soon window choices (minutes); the server bounds any value to 5–240 */
export const ARRIVING_WINDOW_CHOICES = [30, 60, 90, 120] as const;
/** how often the "now" cards refresh on today's board (they change with the clock, not only with bookings) */
const NOW_REFRESH_MS = 60_000;

interface Props {
  /** the board's date (branch-local YYYY-MM-DD); undefined → the branch's today (server) */
  date?: string;
  /** changes whenever the board reloads (realtime / create / filters) — the strip reloads with it */
  refreshKey?: unknown;
  /** tap → the board's filtered list; a card without a handler is not clickable */
  onOpen?: Partial<Record<BookingKpiCardKey, () => void>>;
  /** test seam: the loader (defaults to the real API) */
  load?: (q: { date?: string; arrivingWindowMinutes?: number }) => Promise<BookingKpiCards>;
}

interface CardView { key: BookingKpiCardKey; label: string; value: string; sub: ReactNode; state: BookingKpiValue['state'] | 'loading'; title?: string; extra?: ReactNode }

const DASH = '—';
const num = (v: number | null | undefined) => (v == null ? DASH : String(v));

export function BookingKpiStrip({ date, refreshKey, onOpen, load = posBookingApi.kpiCards }: Props) {
  const [windowMin, setWindowMin] = useSessionState<number>('aps.booking.kpiArrivingWindow', 60);
  const [data, setData] = useState<BookingKpiCards | null>(null);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);
  const reload = useCallback(() => {
    const my = ++seq.current;
    Promise.resolve().then(() => load({ date, arrivingWindowMinutes: windowMin }))   // a loader that throws = a failed read
      .then((r) => { if (my === seq.current) { setData(r); setFailed(false); } })
      .catch(() => { if (my === seq.current) setFailed(true); });   // the last good numbers stay, marked stale
  }, [load, date, windowMin]);
  useEffect(() => { reload(); }, [reload, refreshKey]);
  const isToday = data?.isToday ?? false;
  useEffect(() => {
    if (!isToday) return undefined;
    const id = window.setInterval(reload, NOW_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [isToday, reload]);

  const shown = data && (!date || data.date === date) ? data : null;   // never paint another date's numbers
  const cards = cardsFrom(shown, failed, windowMin, setWindowMin);
  const stale = failed && !!shown;

  return (
    <section className="bkpi-strip @container" aria-label={tx('bkpi.region')} data-testid="booking-kpi-strip" data-stale={stale ? 'true' : undefined}>
      <div className="grid grid-cols-2 @2xl:grid-cols-3 @6xl:grid-cols-6 auto-rows-fr gap-3" data-testid="booking-kpi-grid">
        {cards.map((c) => {
          const open = c.state === 'ok' ? onOpen?.[c.key] : undefined;
          return (
            <div
              key={c.key}
              data-kpi={c.key}
              data-state={c.state}
              role={open ? 'button' : 'group'}
              tabIndex={open ? 0 : undefined}
              aria-label={open ? `${c.label}: ${c.value} — ${tx('bkpi.open')}` : undefined}
              title={c.title}
              onClick={open}
              onKeyDown={open ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } : undefined}
              className="min-w-0 h-full flex flex-col justify-between rounded-[10px] border border-[var(--line)] bg-[#FFFDF8] px-3.5 py-3"
              style={{ cursor: open ? 'pointer' : 'default', minHeight: 88 }}
            >
              <div className="flex items-start justify-between gap-2 min-w-0">
                <div className="truncate" style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>{c.label}</div>
                {c.extra}
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: c.state === 'ok' ? '#1f1b16' : 'var(--muted)', margin: '4px 0 2px', fontVariantNumeric: 'tabular-nums' }} data-testid={`kpi-value-${c.key}`}>{c.value}</div>
              <div className="truncate" style={{ fontSize: 12, color: c.state === 'unavailable' ? '#B3261E' : 'var(--muted)' }} data-testid={`kpi-sub-${c.key}`}>{c.sub}</div>
            </div>
          );
        })}
      </div>
      {failed ? (
        <div role="status" className="flex items-center gap-2 mt-1.5" style={{ fontSize: 12, color: '#B3261E' }} data-testid="booking-kpi-stale">
          <span>{shown ? tx('bkpi.stale') : tx('bkpi.unavailable')}</span>
          <button type="button" onClick={reload} style={{ appearance: 'none', border: 'none', background: 'none', color: 'var(--aps-orange)', fontWeight: 700, cursor: 'pointer', minHeight: 32 }}>{tx('bkpi.retry')}</button>
        </div>
      ) : null}
    </section>
  );
}

function cardsFrom(d: BookingKpiCards | null, failed: boolean, windowMin: number, setWindowMin: (n: number) => void): CardView[] {
  const pending = !d;
  const base = (key: BookingKpiCardKey, label: string, v: BookingKpiValue | undefined, ok: (val: number) => { value: string; sub: ReactNode }, notToday: ReactNode = tx('bkpi.notToday')): CardView => {
    if (pending || !v) return { key, label, value: DASH, sub: failed ? tx('bkpi.unavailable') : tx('bkpi.loading'), state: failed ? 'unavailable' : 'loading' };
    if (v.state === 'not_today') return { key, label, value: DASH, sub: notToday, state: 'not_today' };
    if (v.state === 'unavailable' || v.value == null) return { key, label, value: DASH, sub: tx('bkpi.unavailable'), state: 'unavailable' };
    return { key, label, state: 'ok', ...ok(v.value) };
  };
  const a = d?.appointments;
  const appointments = base('appointments', tx('pos.appointments'), a, (n) => ({ value: String(n),
    sub: a && a.awaitingConfirmation != null && a.confirmed != null ? tx('bkpi.appointments.sub', { awaiting: String(a.awaitingConfirmation), confirmed: String(a.confirmed) }) : tx('bkpi.appointments.subShort') }));
  const usedWindow = d?.arrivingWindowMinutes ?? windowMin;
  const arriving = base('arrivingSoon', tx('pos.arriving_soon_2'), d?.arrivingSoon, (n) => ({ value: String(n), sub: tx('bkpi.arriving.sub', { minutes: String(usedWindow) }) }));
  arriving.extra = (
    <select
      aria-label={tx('bkpi.arriving.window')}
      value={ARRIVING_WINDOW_CHOICES.includes(windowMin as (typeof ARRIVING_WINDOW_CHOICES)[number]) ? windowMin : 60}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onChange={(e) => setWindowMin(Number(e.target.value))}
      data-testid="kpi-arriving-window"
      style={{ fontSize: 12, border: '1px solid var(--line)', borderRadius: 6, background: '#fff', padding: '1px 4px', minHeight: 28 }}
    >
      {ARRIVING_WINDOW_CHOICES.map((m) => <option key={m} value={m}>{tx('bkpi.arriving.minutes', { minutes: String(m) })}</option>)}
    </select>
  );
  const w = d?.walkIns;
  const walkIns = base('walkIns', tx('pos.walk_ins'), w, (n) => ({ value: String(n), sub: tx('bkpi.walkins.sub', { booked: num(w?.fromAppointments), queue: num(w?.fromQueue) }) }));
  const waitlist = base('waitlist', tx('pos.waitlist'), d?.waitlist, (n) => ({ value: String(n), sub: tx('bkpi.waitlist.sub') }), tx('bkpi.liveTodayOnly'));
  const av = d?.availableNow;
  const availableNow = base('availableNow', tx('pos.available_now_2'), av, (n) => ({ value: String(n), sub: tx('bkpi.available.sub', { working: num(av?.workingCount) }) }),
    av?.workingCount != null ? tx('bkpi.available.otherDay', { working: String(av.workingCount) }) : tx('bkpi.notToday'));
  const revenue = base('bookedRevenue', tx('pos.booked_revenue'), d?.bookedRevenue, (cents) => ({ value: fmtMoney(cents), sub: tx('bkpi.revenue.sub') }));
  revenue.title = tx('bkpi.revenue.basis');
  return [appointments, arriving, walkIns, waitlist, availableNow, revenue];
}

export default BookingKpiStrip;
