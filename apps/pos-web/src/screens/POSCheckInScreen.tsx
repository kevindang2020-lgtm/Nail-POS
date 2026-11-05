import { QuickCheckInPanel } from '../components/QuickCheckInPanel';
import { MembershipChip, useMemberStatusMap } from './MembershipChip';
import { useCallback, useEffect, useState } from 'react';
import { ProfileAvatarWithPreview } from '@aipowersalon/ui';
import { useRealtime } from '../realtime/useRealtime';
import { REALTIME_STATUS, realtimeStatus } from '../realtime/realtime-client';
import type { RealtimeStatus } from '../realtime/realtime-core';
import { useNavigate } from 'react-router-dom';
import { posCheckInApi } from '../api/posCheckInApi';
import { useIPadView } from '../components/IPadViewProvider';
import { queueItemRequest } from '../components/ipad-modules';
import { t as tx, currentLocale } from '@aipowersalon/mobile-sdk/i18n';
import { statusLabel } from '../i18n/status-label';
import { fmtTime as fmtClock } from '../i18n/format';
import { opsStatusLabel } from './opsStatus';
import { Card, Empty, More, useFitRows } from '../components/OneScreenKit';

// POS Check-In — the one-screen front-desk command center (Check-In 27-inch mandate, Oct 28 2026). Reads the real
// /pos/check-in/state: KPIs, the live check-in queue, the arriving window, the waiting lounge, the on-duty technicians from
// their real signals, front-desk insights (advisory, with where to act), and the day's analytics — each card showing the
// rows that fit + "+N more" from the server's totals. The page is one fixed grid (styles.css one-screen kit,
// `.check-in-page`): 1920×1080 at 100 % zoom with the browser bars and the taskbar = a 1920×945 page with no scroll.
// Wired mutations: QuickCheckInPanel (existing / new / walk-in, one idempotency key per attempt), appointment Check In,
// and the per-arrival Check In / Start / Notify (arrivals.rowId === checkInId). Tapping a guest opens the visit detail.
type CheckInState = {
  kpis: { todayCheckIns: number; todayCheckInsTrendPercent: number | null; waitingGuests: number; estimatedWaitMinutes: number; walkInsToday: number; appointmentsArrived: number; appointmentArrivalPercent: number; readyForTech: number; noShows?: number; techsAvailable?: number; customerReturnRate?: number };
  arrivals: { rowId: string; timeLabel: string; checkedInAt?: string; waitedMinutes?: number; customerId: string; customerName: string; phone: string; source: string; services: string[]; technicianName?: string; arrivalStatus: string; avatarUrl?: string | null }[];
  appointmentCheckIn: { upcoming: AppointmentMini[]; arrived: AppointmentMini[]; noShow: AppointmentMini[] };
  waiting: { queueItemId: string; timeLabel: string; customerId: string; customerName: string; serviceName: string; status: string; waitedMinutes: number; requestedTechnicianName?: string; requestedTechnicianId?: string; avatarUrl?: string | null }[];
  readyForAssignment: { queueItemId: string; customerName: string; serviceName: string; ticketId: string }[];
  availableTechnicians?: { technicianId: string; displayName: string; activeAssignments: number; status: string; staffStatus?: string; load?: number; next?: string; specialty?: string; avatarUrl?: string | null }[];
  sourceMix?: { name: string; count: number; pct: number; source?: string }[];
  arrivalTrend?: { hourLabel: string; hour: number; count: number }[];
  customerType?: { returning: number; new: number; vip: number; returnRatePct: number };
  frontDeskInsights?: { id: string; text: string; severity: string; vars?: Record<string, number>; route?: string }[];
  dailyPerformance?: { checkInsCompleted: number; noShowRatePct: number; avgCheckInSeconds: number | null; satisfaction: number | null };
  services?: { serviceId: string; name: string; durationMinutes?: number; priceCents?: number }[];
  technicians?: { technicianId: string; displayName: string }[];
  /** 200-technician §2: the Available Technicians page that came back (totalAll = every technician) */
  technicianPage?: { page: number; pageSize: number; total: number; totalPages: number; totalAll: number };
  totals?: { arrivals: number; arriving: number; waiting: number; onDuty: number; available: number; insights: number };
  arrivalWindowMinutes?: number;
  staffSummary?: { onDuty: number; available: number; finishing: number; busy: number; onBreak: number; roster: number };
};
/** 200-technician §2 / Check-In §41: the Available Technicians card asks for this many (one page, available first) — never
 *  the roster (the Quick Check-In picker pages from the server). */
export const CI_TECH_PAGE_SIZE = 6;
type AppointmentMini = { appointmentId: string; timeLabel: string; startTime?: string; customerName: string; serviceName: string; status: 'upcoming' | 'arrived' | 'no_show'; technicianName?: string; avatarUrl?: string | null };
type Detail = { checkInId: string; customerName: string; customerPhone?: string; services?: { serviceName: string; durationMinutes?: number }[]; technicianName?: string | null; status: string; source: string; checkedInAt?: string; quotedWaitMinutes?: number; notes?: string; isVip?: boolean };

const LIVE_TONE: Record<RealtimeStatus, string> = { CONNECTED: '#2E7D32', RECONNECTING: '#9a6a12', DEGRADED: '#9a6a12', OFFLINE: '#C0392B' };
/** an instant (ISO) in the branch zone, or a branch clock time ('HH:MM') in the user's locale */
const clock = (v?: string) => {
  if (!v) return '';
  const m = /^(\d{1,2}):(\d{2})/.exec(v);
  if (m) { try { return new Intl.DateTimeFormat(currentLocale(), { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(Date.UTC(2000, 0, 1, Number(m[1]), Number(m[2]))); } catch { return v.slice(0, 5); } }
  const d = new Date(v); return isNaN(+d) ? v : fmtClock(d);
};
/** a check-in / arrival status code → the front desk's word (waiting / arrived / ready / in service) */
function ciStatusLabel(st: string): string {
  const k2 = (st || '').toLowerCase();
  return k2 === 'checked_in' || k2 === 'sent_to_queue' ? tx('pos.waiting_2') : k2.includes('arriv') ? tx('pos.arrived') : k2.includes('ready') || k2 === 'sent_to_tech_queue' ? tx('pos.ready')
    : k2.includes('service') ? tx('pos.in_service_3') : st ? statusLabel('queueItem', st) : '—';
}
const staffKey = (s?: string) => String(s || '').toLowerCase().replace(/\s+/g, '_');
function Pill({ s, label }: { s: string; label?: string }) {
  const k = (s || '').toLowerCase();
  const tone = /complete|confirm|ready|available|^in$/.test(k) ? 'ok' : /progress|serving|in_service|arrived|assigned|finishing/.test(k) ? 'info'
    : /wait|pending|upcoming|checked_in|busy|break/.test(k) ? 'warn' : /no.?show|late|cancel/.test(k) ? 'bad' : 'mut';
  return <span className={`pill ${tone}`}>{label ?? opsStatusLabel(s)}</span>;
}
const ICON: Record<string, string> = {
  checkins: 'M6 7.6A2.2 2.2 0 1 0 6 3.2a2.2 2.2 0 0 0 0 4.4Z M2.4 13c0-2.2 1.7-3.5 3.6-3.5 M9.4 10.6l1.3 1.3 2.3-2.7',
  guests: 'M5.6 7.2A2 2 0 1 0 5.6 3.2a2 2 0 0 0 0 4Z M2.3 12.6c0-2 1.5-3.3 3.3-3.3 M10.6 7.3a1.8 1.8 0 1 0 0-3.6 M9.5 9.4c2 0 3.4 1.3 3.4 3.2',
  walkin: 'M9.2 2.6H4.6v10.8h4.6 M7 8h6 M11 6l2 2-2 2',
  calendar: 'M3 4.2h10v8.8H3Z M3 6.7h10 M5.6 2.6v2.1 M10.4 2.6v2.1',
  ready: 'M3.4 8.3 6.2 11.1 12.4 4.9',
  clock: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z M8 5v3l2 1.4',
  noshow: 'M8 3 14 13.2H2L8 3Z M8 6.9v3 M8 11.4h.01',
  techs: 'M8 7.6A2.2 2.2 0 1 0 8 3.2a2.2 2.2 0 0 0 0 4.4Z M3.5 13c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4',
  return: 'M3 13V8 M7 13V4 M11 13V6 M2 13.4h11',
  booking: 'M3 4.4h10v8.6H3Z M3 6.9h10 M5.6 2.8v2 M10.4 2.8v2 M8 8.6v2.6 M6.7 9.9h2.6',
  newci: 'M6 7.6A2.2 2.2 0 1 0 6 3.2a2.2 2.2 0 0 0 0 4.4Z M2.4 13c0-2.2 1.7-3.5 3.6-3.5 M10.6 8.2v3.4 M8.9 9.9h3.4',
  play: 'M5.5 3.5l7 4.5-7 4.5Z',
  pay: 'M2.6 4.4h10.8v7.2H2.6Z M2.6 7h10.8',
  message: 'M2.8 3.6h10.4v7H6l-3.2 2.4Z',
  product: 'M2.4 5.4 8 2.3l5.6 3.1v5.2L8 13.7l-5.6-3V5.4Z M8 8.5v5.2 M2.6 5.5 8 8.5l5.4-3',
};
const Svg = ({ d, size = 16 }: { d: string; size?: number }) => <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;

/** §19: the visit detail — opened by tapping a guest; the Check-In page stays behind it (module-level, so it never remounts) */
function GuestDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const nav = useNavigate();
  const [d, setD] = useState<Detail | null>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { let alive = true; posCheckInApi.detail(id).then((r) => { if (alive) setD(r as Detail); }).catch((e: any) => { if (alive) setErr(e?.message || tx('pos.failed_to_load_check_in')); }); return () => { alive = false; }; }, [id]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onClose]);
  const start = async () => { setBusy(true); setErr(null); try { await posCheckInApi.startService(id); onChanged(); onClose(); } catch (e: any) { setErr(e?.message || tx('pos.label_failed', { label: tx('pos.start') })); } finally { setBusy(false); } };
  const waited = d?.checkedInAt ? Math.max(0, Math.round((Date.now() - new Date(d.checkedInAt).getTime()) / 60000)) : null;
  return (
    <div className="ci-modal" role="dialog" aria-modal="true" aria-label={d?.customerName || tx('pos.guest')} data-testid="check-in-detail" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ci-modal-in">
        <div className="ci-modal-h"><h2 title={d?.customerName}>{d?.customerName || tx('pos.guest')}</h2><button className="ci-x" onClick={onClose} aria-label={tx('pos.close')}>✕</button></div>
        {err ? <div className="ci-err" role="alert">{err}</div> : null}
        {!d ? (err ? null : <div className="sk sk-fill" />) : (
          <div className="ci-detail-b">
            <dl className="ci-dl">
              <dt>{tx('pos.phone')}</dt><dd>{d.customerPhone || '—'}</dd>
              <dt>{tx('pos.status')}</dt><dd><Pill s={d.status} label={ciStatusLabel(d.status)} /></dd>
              <dt>{tx('pos.visit')}</dt><dd>{d.source === 'appointment' ? tx('pos.appt_2') : tx('pos.walk_in_2')}</dd>
              <dt>{tx('pos.time')}</dt><dd>{clock(d.checkedInAt)}{waited != null ? ` · ${tx('pos.w_min', { w: String(waited) })}` : ''}</dd>
              <dt>{tx('pos.service_3')}</dt><dd>{(d.services || []).map((x) => x.serviceName).join(', ') || '—'}</dd>
              <dt>{tx('pos.tech_req')}</dt><dd>{d.technicianName || tx('pos.any')}</dd>
              {d.notes ? <><dt>{tx('pos.notes')}</dt><dd>{d.notes}</dd></> : null}
            </dl>
            <div className="ci-detail-a">
              <button className="btn primary" onClick={() => { onClose(); nav('/queue?assign=1'); }}>{tx('pos.assign_tech')}</button>
              {d.status === 'sent_to_tech_queue' ? <button className="btn" disabled={busy} onClick={() => void start()}>{tx('pos.start_service')}</button> : null}
              <button className="btn" onClick={() => { onClose(); nav('/queue'); }}>{tx('pos.view_full_queue')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function POSCheckInScreen() {
  const nav = useNavigate();
  const [s, setS] = useState<CheckInState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [tabReq, setTabReq] = useState<{ tab: 'existing' | 'new' | 'walkin'; n: number } | undefined>(undefined);
  const [live, setLive] = useState<RealtimeStatus>(() => realtimeStatus());
  useEffect(() => { const h = (e: Event) => setLive((e as CustomEvent<{ status: RealtimeStatus }>).detail.status); window.addEventListener(REALTIME_STATUS, h); return () => window.removeEventListener(REALTIME_STATUS, h); }, []);

  const reload = useCallback(() => {
    return posCheckInApi.state({ roster: 'none', techPage: 1, techPageSize: CI_TECH_PAGE_SIZE })
      .then((d) => { setS(d as CheckInState); setError(null); })
      .catch((e: any) => setError(e?.message || tx('pos.failed_to_load_check_in')));
  }, []);
  useEffect(() => { reload(); }, [reload]);
  // §91–§93: realtime first (check-ins, queue, appointments, technicians) refetches in place — the previous values stay on
  // screen until the new ones arrive and every card keeps its box, so nothing jumps
  useRealtime('check-in', reload);

  const checkIn = async (appointmentId: string) => {
    setActionErr(null); setBusyId(appointmentId);
    try { await posCheckInApi.appointmentCheckIn(appointmentId); await reload(); }
    catch (e: any) { setActionErr(e?.message || tx('pos.check_in_failed')); }
    finally { setBusyId(null); }
  };
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const act = async (rowId: string, fn: () => Promise<unknown>, label: string) => {
    setActionErr(null); setRowBusy(rowId + ':' + label);
    try { await fn(); await reload(); }
    catch (e: any) { setActionErr(e?.message || tx('pos.label_failed', { label: String(label) })); }
    finally { setRowBusy(null); }
  };

  const memberStatus = useMemberStatusMap([...(s?.arrivals ?? []).map((a) => a.customerId), ...(s?.waiting ?? []).map((w) => w.customerId)]);
  const { open: openIPad } = useIPadView();

  const arrivals = s?.arrivals || []; const waiting = s?.waiting || []; const techs = s?.availableTechnicians || [];
  const insights = s?.frontDeskInsights || []; const arriving = s?.appointmentCheckIn.upcoming || []; const tot = s?.totals;
  // rows that fit each card at this density (≤ the server's top rows) — "+N more" is exactly what is not on screen
  const [qRef, qN] = useFitRows(8, arrivals.length);
  const [apRef, apN] = useFitRows(6, arriving.length);
  const [wRef, wN] = useFitRows(6, waiting.length);
  const [tRef, tN] = useFitRows(CI_TECH_PAGE_SIZE, techs.length);
  const [iRef, iN] = useFitRows(5, insights.length);

  const k = s?.kpis;
  const noShowCount = k?.noShows ?? s?.appointmentCheckIn.noShow.length ?? 0;
  const arrivingTotal = tot?.arriving ?? arriving.length;
  const techsAvail = k?.techsAvailable ?? techs.filter((t) => t.status === 'available').length;
  const onDuty = s?.staffSummary?.onDuty ?? tot?.onDuty ?? s?.technicianPage?.totalAll ?? techs.length;
  const ret = s?.customerType; const dp = s?.dailyPerformance;
  const windowH = s?.arrivalWindowMinutes ? Math.round(s.arrivalWindowMinutes / 60) : 3;
  const trendTxt = k && k.todayCheckInsTrendPercent != null ? `${k.todayCheckInsTrendPercent >= 0 ? '▲' : '▼'} ${Math.abs(k.todayCheckInsTrendPercent)}% ${tx('pos.vs_yesterday')}` : null;
  // the nine KPIs — every value from the server (CHECK_IN_KPI_DEFINITIONS); a KPI opens where staff act on it
  const kpiCards = k ? [
    { l: tx('pos.check_ins_today'), v: String(k.todayCheckIns), ic: 'checkins', d: trendTxt ? <span className={k.todayCheckInsTrendPercent! >= 0 ? 'up' : 'dn'}>{trendTxt}</span> : <span className="sub">{tx('pos.today_2')}</span>, to: '/queue' },
    { l: tx('pos.waiting_guests'), v: String(k.waitingGuests), ic: 'guests', d: <span className="sub">{tx('pos.est_wait_estimatedwaitminutes_min', { estimatedWaitMinutes: String(k.estimatedWaitMinutes) })}</span>, to: '/queue' },
    { l: tx('pos.walk_ins_2'), v: String(k.walkInsToday), ic: 'walkin', d: <span className="sub">{k.todayCheckIns > 0 ? tx('pos.v0_of_check_ins', { v0: String(Math.round((k.walkInsToday / k.todayCheckIns) * 100)) }) : '—'}</span>, to: '/queue' },
    { l: tx('pos.appt_arriving_soon'), v: String(arrivingTotal), ic: 'calendar', d: <span className="sub">{tx('ops.checkIn.nextHours', { h: String(windowH) })}</span>, to: '/booking' },
    { l: tx('pos.ready_for_service'), v: String(k.readyForTech), ic: 'ready', d: <span className="sub">{tx('pos.awaiting_tech')}</span>, to: '/queue?status=ready_for_tech' },
    { l: tx('pos.average_wait_time'), v: tx('pos.v0_min', { v0: String(k.estimatedWaitMinutes) }), ic: 'clock', d: <span className="sub">{tx('pos.current_average')}</span>, to: '/queue' },
    { l: tx('pos.no_shows'), v: String(noShowCount), ic: 'noshow', d: <span className="sub">{dp ? tx('pos.noshowratepct_rate_today', { noShowRatePct: String(dp.noShowRatePct) }) : '—'}</span>, to: '/booking' },
    { l: tx('pos.techs_available'), v: `${techsAvail} / ${onDuty}`, ic: 'techs', d: <span className="sub">{tx('ops.checkIn.onDuty')}</span>, to: '/technicians' },
    { l: tx('pos.customer_return_rate'), v: ret ? `${k.customerReturnRate ?? ret.returnRatePct}%` : '—', ic: 'return', d: <span className="sub">{tx('pos.today_2')}</span>, to: '/customers' },
  ] : [];

  // queue row action by status (Check In / Start / Assign / Notify / View)
  const rowAction = (st: string): { label: string; kind: 'checkin' | 'assign' | 'notify' | 'start' | 'view' } => {
    const k2 = (st || '').toLowerCase();
    if (k2.includes('arriv')) return { label: tx('pos.check_in'), kind: 'checkin' };
    if (k2.includes('ready')) return { label: tx('pos.start'), kind: 'start' };
    if (k2.includes('wait') || k2 === 'checked_in') return { label: tx('pos.assign'), kind: 'assign' };
    if (k2.includes('confirm')) return { label: tx('pos.notify'), kind: 'notify' };
    return { label: tx('pos.view'), kind: 'view' };
  };
  const statLabel = ciStatusLabel;
  const hourLabel = (h: number) => { try { return new Intl.DateTimeFormat(currentLocale(), { hour: 'numeric', timeZone: 'UTC' }).format(Date.UTC(2000, 0, 1, h)); } catch { return String(h); } };
  // §30: the server's insight in the user's language from its id + numbers (its English text for an unknown id)
  const insightText = (it: { id: string; text: string; vars?: Record<string, number> }): string => {
    const v = it.vars; if (!v) return it.text;
    switch (it.id) {
      case 'peak': return tx('ops.checkIn.insight.peak', { hour: hourLabel(v.hour), count: String(v.count) });
      case 'wait': return tx('ops.checkIn.insight.wait', { minutes: String(v.minutes) });
      case 'noidle': return tx('ops.checkIn.insight.noIdle', { count: String(v.count) });
      case 'vip': return tx('ops.checkIn.insight.vip', { count: String(v.count) });
      case 'walkin': return tx('ops.checkIn.insight.walkIn', { percent: String(v.percent) });
      case 'longWait': return tx('ops.checkIn.insight.longWait', { count: String(v.count), minutes: String(v.minutes) });
      case 'late': return tx('ops.checkIn.insight.late', { count: String(v.count) });
      case 'arriving': return tx('ops.checkIn.insight.arriving', { count: String(v.count), minutes: String(v.minutes) });
      case 'available': return tx('ops.checkIn.insight.available', { count: String(v.count) });
      default: return it.text;
    }
  };
  const nextLabel = (n?: string) => !n ? '—' : n === 'Now' ? tx('ops.status.now') : n === 'Soon' ? tx('ops.status.soon') : /^\d+$/.test(n) ? tx('pos.w_min', { w: n }) : n;

  const loading = <div className="sk sk-fill" />;
  const trend = s?.arrivalTrend || [];
  const sourceMix = (s?.sourceMix || []).map((m) => ({ name: m.source ? statusLabel('source', m.source) : m.name, n: m.count, pct: m.pct }));
  const SRC_COLORS = ['#7B9FD4', '#6BAF92', '#E0843B', '#B0A0C8', '#C89B5A'];
  const QA: { l: string; ic: string; primary?: boolean; go: () => void }[] = [
    // §51–§54, §90: every action does real work. New Check-In / Walk-In open the Quick Check-In panel's tab on THIS page
    // (they used to navigate to /check-in — the page itself — and did nothing); Assign Tech opens the queue's assign sheet;
    // Start Service the queue filtered to guests ready for a technician; Add Product Inventory's add form.
    { l: tx('pos.new_check_in'), ic: 'newci', primary: true, go: () => setTabReq((p) => ({ tab: 'existing', n: (p?.n ?? 0) + 1 })) },
    { l: tx('pos.new_booking_2'), ic: 'booking', primary: true, go: () => nav('/booking') },
    { l: tx('pos.walk_in'), ic: 'walkin', primary: true, go: () => setTabReq((p) => ({ tab: 'walkin', n: (p?.n ?? 0) + 1 })) },
    { l: tx('pos.assign_tech'), ic: 'guests', primary: true, go: () => nav('/queue?assign=1') },
    { l: tx('pos.start_service'), ic: 'play', go: () => nav('/queue?status=ready_for_tech') },
    { l: tx('pos.take_payment'), ic: 'pay', go: () => nav('/checkout') },
    { l: tx('pos.send_message'), ic: 'message', go: () => nav('/messages') },
    { l: tx('pos.add_product_3'), ic: 'product', go: () => nav('/tenant/inventory?add=1') },
    { l: tx('pos.view_reports'), ic: 'return', go: () => nav('/reports') },
  ];

  if (error && !s) return (
    <div className="work ov check-in-page" data-testid="check-in-page">
      <div role="alert" className="ov-toast"><span>{error}</span><button className="mini" onClick={() => void reload()}>{tx('pos.retry')}</button></div>
    </div>
  );

  return (
    <div className="work ov check-in-page" data-testid="check-in-page">
      {/* 9 KPIs — one row (§11–§14) */}
      <div className="ov-kpis" data-testid="check-in-kpis">
        {(k ? kpiCards : Array.from({ length: 9 })).map((c: any, i) => (
          <button key={i} className="ov-kpi" onClick={() => c && nav(c.to)} disabled={!k}>
            {k ? (<><div className="kc"><span className="ki"><Svg d={ICON[c.ic]} size={13} /></span><span className="kl">{c.l}</span></div>
              <div className="kv">{c.v}</div><div className="kd">{c.d}</div></>) : <div className="sk sk-kpi" />}
          </button>
        ))}
      </div>
      {actionErr || (error && s) ? <div role="alert" className="ov-toast"><span>{actionErr || error}</span><button className="mini" onClick={() => { setActionErr(null); void reload(); }}>{tx('pos.retry')}</button></div> : null}

      {/* Row 1: Live Check-In Queue | Quick Check-In | Front Desk Insights */}
      <div className="ov-grid ov-3 ci-row1">
        <Card testId="ci-queue" title={tx('pos.live_check_in_queue')} bodyRef={qRef}
          right={<span className="live" data-testid="check-in-live" data-live={live} style={{ color: LIVE_TONE[live] }}>● {tx(`payment.board.live.${live}`)}</span>}
          foot={<><More shown={Math.min(arrivals.length, qN)} total={tot?.arrivals} /><button className="ov-more" onClick={() => nav('/queue')}>{tx('pos.view_full_queue')}</button></>}>
          {!s ? loading : arrivals.length === 0 ? <Empty msg={tx('pos.no_check_ins_yet_today')} /> : (
            <table className="ov-tbl ci-tbl"><thead><tr><th className="t-time">{tx('pos.time')}</th><th>{tx('pos.guest')}</th><th className="t-opt">{tx('pos.phone')}</th><th>{tx('pos.service_3')}</th><th>{tx('pos.tech_req')}</th><th className="t-num">{tx('pos.wait')}</th><th className="t-pill">{tx('pos.status')}</th><th className="t-act" /></tr></thead>
              <tbody>
                {arrivals.slice(0, qN).map((a) => { const ra = rowAction(a.arrivalStatus); return (
                  <tr key={a.rowId} className="ci-row" tabIndex={0} onClick={() => setDetailId(a.rowId)} onKeyDown={(e) => { if (e.key === 'Enter') setDetailId(a.rowId); }}>
                    <td className="t-time">{a.checkedInAt ? clock(a.checkedInAt) : a.timeLabel}</td>
                    <td className="t-name" title={a.customerName}><span className="ci-nm">{a.customerName}</span>{memberStatus[a.customerId] ? <MembershipChip planName={memberStatus[a.customerId].planName} status={memberStatus[a.customerId].status} compact /> : null}</td>
                    <td className="t-mut t-opt" title={a.phone}>{a.phone || '—'}</td>
                    <td className="t-mut" title={(a.services || []).join(', ')}>{(a.services || [])[0] || '—'}</td>
                    <td className="t-mut" title={a.technicianName}>{a.technicianName || tx('pos.any')}</td>
                    <td className="t-mut t-num">{a.waitedMinutes != null ? tx('pos.w_min', { w: String(a.waitedMinutes) }) : '—'}</td>
                    <td className="t-pill"><Pill s={a.arrivalStatus} label={statLabel(a.arrivalStatus)} /></td>
                    <td className="t-act">
                      <button className="mini" disabled={rowBusy?.startsWith(a.rowId)} onClick={(e) => {
                        e.stopPropagation();
                        if (ra.kind === 'checkin') void act(a.rowId, () => posCheckInApi.moveToQueue(a.rowId), ra.label);
                        else if (ra.kind === 'start') void act(a.rowId, () => posCheckInApi.startService(a.rowId), ra.label);
                        else if (ra.kind === 'assign') nav('/queue?assign=1');
                        else if (ra.kind === 'notify') void act(a.rowId, () => posCheckInApi.updateWaitEstimate(a.rowId, {}), ra.label);
                        else setDetailId(a.rowId);
                      }}>{ra.label}</button>
                    </td>
                  </tr>
                ); })}
              </tbody></table>
          )}
        </Card>

        {/* §21: the primary action — always visible; its form scrolls inside the card, the page never grows */}
        <section className="ov-card ci-qci" data-testid="ci-quick">
          <div className="ov-card-h"><h3>{tx('pos.quick_check_in_panel')}</h3></div>
          <div className="ov-card-b ci-qci-b">
            {s ? <QuickCheckInPanel bare tabRequest={tabReq} services={(s.services || []).map((sv: any) => ({ serviceId: sv.serviceId, name: sv.name, durationMinutes: sv.durationMinutes, isAddon: sv.isAddon, priceCents: sv.priceCents }))} technicians={(s.technicians || []).map((t) => ({ technicianId: t.technicianId, displayName: t.displayName }))} initialGuest={(s as any).selectedGuest} onComplete={reload} /> : loading}
          </div>
        </section>

        <Card testId="ci-insights" title={tx('pos.front_desk_insights')} bodyRef={iRef}
          right={<span className="badge-soft purple">{tx('pos.new')}</span>}
          foot={<><More shown={Math.min(insights.length, iN)} total={tot?.insights ?? insights.length} /><button className="ov-more" onClick={() => nav('/tenant/ai/command-center')}>{tx('pos.view_all_2')}</button></>}>
          {!s ? loading : insights.length === 0 ? <Empty msg={tx('pos.no_insights_right_now')} /> : (
            <ul className="insights">{insights.slice(0, iN).map((it) => (
              <li key={it.id} className={`ins ${it.severity === 'warn' ? 'warning' : 'info'}`}>
                <span className="ins-dot" aria-hidden /><div className="ins-txt"><div className="ins-t" title={insightText(it)}>{insightText(it)}</div></div>
                {it.route ? <button className="mini" onClick={() => nav(it.route!)}>{tx('ops.insight.open')}</button> : null}
              </li>
            ))}</ul>
          )}
        </Card>
      </div>

      {/* Row 2: Today's Appointments Arriving | Waiting Lounge & Assignment | Available Technicians */}
      <div className="ov-grid ov-3 ci-row2">
        <Card testId="ci-arriving" title={tx('pos.today_s_appointments_arriving')} bodyRef={apRef}
          right={<span className="sub">{tx('ops.checkIn.nextHours', { h: String(windowH) })}</span>}
          foot={<><More shown={Math.min(arriving.length, apN)} total={tot?.arriving} /><button className="ov-more" onClick={() => nav('/booking')}>{tx('pos.view_full_appointments')}</button></>}>
          {!s ? loading : arriving.length === 0 ? <Empty msg={tx('pos.no_upcoming_appointments')} /> : (
            <table className="ov-tbl ci-tbl"><thead><tr><th className="t-time">{tx('pos.time')}</th><th>{tx('pos.guest')}</th><th>{tx('pos.service_3')}</th><th>{tx('pos.tech')}</th><th className="t-pill">{tx('pos.status')}</th><th className="t-act" /></tr></thead>
              <tbody>
                {arriving.slice(0, apN).map((a) => (
                  <tr key={a.appointmentId}>
                    <td className="t-time">{clock(a.startTime) || a.timeLabel || '—'}</td>
                    <td className="t-name" title={a.customerName}>{a.customerName}</td>
                    <td className="t-mut" title={a.serviceName}>{a.serviceName || '—'}</td>
                    <td className="t-mut" title={a.technicianName}>{a.technicianName || '—'}</td>
                    <td className="t-pill">{a.status === 'arrived' ? <Pill s="arrived" label={tx('pos.arrived')} /> : <Pill s="pending" label={tx('pos.pending')} />}</td>
                    <td className="t-act">{a.status === 'arrived' ? <Pill s="in" label={tx('pos.in')} />
                      : <button className="mini" disabled={busyId === a.appointmentId} onClick={() => void checkIn(a.appointmentId)}>{busyId === a.appointmentId ? '…' : tx('pos.check_in')}</button>}</td>
                  </tr>
                ))}
              </tbody></table>
          )}
        </Card>

        <Card testId="ci-lounge" title={tx('pos.waiting_lounge_assignment')} bodyRef={wRef}
          foot={<><More shown={Math.min(waiting.length, wN)} total={tot?.waiting} /><button className="ov-more" onClick={() => nav('/queue')}>{tx('pos.manage_waiting_lounge')}</button></>}>
          {!s ? loading : waiting.length === 0 ? <Empty msg={tx('pos.no_one_waiting')} /> : (
            <table className="ov-tbl ci-tbl"><thead><tr><th>{tx('pos.guest')}</th><th className="t-num">{tx('pos.wait')}</th><th>{tx('pos.service_3')}</th><th>{tx('pos.assigned')}</th><th className="t-act2" /></tr></thead>
              <tbody>
                {waiting.slice(0, wN).map((w) => (
                  <tr key={w.queueItemId} className="ci-row" tabIndex={0} onClick={() => setDetailId(w.queueItemId)} onKeyDown={(e) => { if (e.key === 'Enter') setDetailId(w.queueItemId); }}>
                    <td className="t-name" title={w.customerName}><span className="ci-nm">{w.customerName}</span>{memberStatus[w.customerId] ? <MembershipChip planName={memberStatus[w.customerId].planName} status={memberStatus[w.customerId].status} compact /> : null}</td>
                    <td className="t-mut t-num">{tx('pos.w_min', { w: String(w.waitedMinutes) })}</td>
                    <td className="t-mut" title={w.serviceName}>{w.serviceName || '—'}</td>
                    <td className="t-mut" title={w.requestedTechnicianName}>{w.requestedTechnicianName || tx('pos.any')}</td>
                    <td className="t-act2"><span className="ci-acts">
                      <button className="mini" title={tx('pos.open_full_ipad_view')} onClick={(e) => { e.stopPropagation(); openIPad(queueItemRequest({ queueItemId: w.queueItemId, customerName: w.customerName, requestedServices: [{ serviceId: '', serviceName: w.serviceName }], status: w.status, actualWaitMinutes: w.waitedMinutes })); }}>{tx('pos.full_view')}</button>
                      <button className="mini" onClick={(e) => { e.stopPropagation(); nav('/queue?assign=1'); }}>{tx('pos.assign')}</button>
                    </span></td>
                  </tr>
                ))}
              </tbody></table>
          )}
        </Card>

        <Card testId="ci-techs" title={tx('pos.available_technicians')} bodyRef={tRef}
          right={<span className="sub">{tx('ops.checkIn.availableOf', { available: String(techsAvail), onDuty: String(onDuty) })}</span>}
          foot={<><More shown={Math.min(techs.length, tN)} total={onDuty} /><button className="ov-more" onClick={() => nav('/technicians')}>{tx('pos.view_schedule')}</button></>}>
          {!s ? loading : techs.length === 0 ? <Empty msg={tx('ops.checkIn.noneOnDuty')} /> : (
            <table className="ov-tbl ci-tbl"><thead><tr><th>{tx('pos.technician')}</th><th className="t-opt">{tx('pos.specialty')}</th><th className="t-num" title={tx('ops.checkIn.loadHint')}>{tx('pos.load')}</th><th className="t-num">{tx('pos.next')}</th><th className="t-pill">{tx('pos.status')}</th></tr></thead>
              <tbody>
                {techs.slice(0, tN).map((t) => (
                  <tr key={t.technicianId}>
                    <td className="t-name" title={t.displayName}><span className="ci-tech"><ProfileAvatarWithPreview name={t.displayName} url={t.avatarUrl} size={20} type="technician" /><span className="ci-nm">{t.displayName}</span></span></td>
                    <td className="t-mut t-opt" title={t.specialty}>{t.specialty || '—'}</td>
                    <td className="t-mut t-num" title={tx('ops.checkIn.loadHint')}>{t.load ?? t.activeAssignments ?? 0}</td>
                    <td className="t-mut t-num">{t.staffStatus ? nextLabel(t.next) : (t.status === 'available' ? tx('ops.status.now') : '—')}</td>
                    <td className="t-pill"><Pill s={staffKey(t.staffStatus || t.status)} label={opsStatusLabel(staffKey(t.staffStatus || t.status))} /></td>
                  </tr>
                ))}
              </tbody></table>
          )}
        </Card>
      </div>

      {/* Row 3: Arrival Trend | Source Mix | Customer Type | Daily Front Desk Performance (§45–§50) */}
      <div className="ov-grid ov-4 ci-row3">
        <Card testId="ci-trend" title={tx('pos.arrival_trend')} right={<span className="sub">{tx('pos.today_2')}</span>}>
          {!s ? loading : !trend.length ? <Empty msg={tx('pos.arrivals_build_through_the_day')} /> : (() => {
            const w = 250, hh = 60, max = Math.max(1, ...trend.map((p) => p.count)); const xs = (i: number) => trend.length === 1 ? w / 2 : (i / (trend.length - 1)) * w; const ys = (v: number) => hh - (v / max) * (hh - 8) - 4;
            const dd = trend.map((p, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)} ${ys(p.count).toFixed(1)}`).join(' ');
            return (<div className="ci-trend"><svg className="spark" viewBox={`0 0 ${w} ${hh}`} preserveAspectRatio="none"><path d={`${dd} L${w} ${hh} L0 ${hh} Z`} fill="#FBEAD6" opacity="0.6" /><path d={dd} fill="none" stroke="#E0843B" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>
              <div className="ci-axis">{trend.filter((_, i) => i % Math.max(1, Math.ceil(trend.length / 6)) === 0).map((p) => <span key={p.hour}>{hourLabel(p.hour)}</span>)}</div></div>);
          })()}
        </Card>
        <Card testId="ci-source" title={tx('pos.check_in_source_mix')} right={<span className="sub">{tx('pos.today_2')}</span>}>
          {!s ? loading : (() => { const total = sourceMix.reduce((a, m) => a + m.n, 0); if (!total) return <Empty msg={tx('pos.no_check_ins_yet')} />; let acc = 0; const segs = sourceMix.map((m, i) => { const st = acc; acc += (m.n / total) * 100; return `${SRC_COLORS[i % SRC_COLORS.length]} ${st}% ${acc}%`; });
            return (<div className="donut-wrap"><div className="donut" style={{ background: `conic-gradient(${segs.join(', ')})` }}><div className="donut-hole">{total}</div></div>
              <ul className="legend">{sourceMix.slice(0, 4).map((m, i) => <li key={m.name} title={`${m.name} · ${m.n}`}><span className="lg" style={{ background: SRC_COLORS[i % SRC_COLORS.length] }} />{m.name} {m.pct}%</li>)}{sourceMix.length > 4 ? <li className="lg-more">{tx('ops.overview.moreCount', { count: String(sourceMix.length - 4) })}</li> : null}</ul></div>);
          })()}
        </Card>
        <Card testId="ci-ctype" title={tx('pos.customer_type')} right={<span className="sub">{tx('pos.today_2')}</span>}>
          {!s ? loading : !ret || ret.returning + ret.new + ret.vip === 0 ? <Empty msg={tx('pos.no_data_yet')} /> : (() => {
            const segs = [{ l: tx('pos.returning'), v: ret.returning, c: '#E0843B' }, { l: tx('pos.new'), v: ret.new, c: '#7B9FD4' }, { l: statusLabel('priority', 'vip'), v: ret.vip, c: '#6BAF92' }]; const total = segs.reduce((a, x) => a + x.v, 0) || 1; let acc = 0;
            const ring = segs.map((g) => { const st = acc; acc += (g.v / total) * 100; return `${g.c} ${st}% ${acc}%`; }).join(', ');
            return (<div className="donut-wrap"><div className="donut" style={{ background: `conic-gradient(${ring})` }}><div className="donut-hole">{total}</div></div>
              <ul className="legend">{segs.map((g) => <li key={g.l}><span className="lg" style={{ background: g.c }} />{g.l} {Math.round((g.v / total) * 1000) / 10}%</li>)}</ul></div>);
          })()}
        </Card>
        <Card testId="ci-perf" title={tx('pos.daily_front_desk_performance')} right={<span className="sub">{tx('pos.today_2')}</span>}>
          {!s ? loading : (
            <ul className="rank ci-perf">
              {/* every value is the server's; no invented trend (only the check-ins one has a baseline) */}
              <li><span className="rk-n">{tx('pos.check_ins_completed')}</span><span className="rk-v">{dp?.checkInsCompleted ?? k?.todayCheckIns ?? 0}{trendTxt ? <span className={`rk-sub ${k!.todayCheckInsTrendPercent! >= 0 ? 'up' : 'dn'}`}>{`${k!.todayCheckInsTrendPercent! >= 0 ? '▲' : '▼'} ${Math.abs(k!.todayCheckInsTrendPercent!)}%`}</span> : null}</span></li>
              <li><span className="rk-n">{tx('pos.avg_check_in_time')}</span><span className="rk-v">{dp?.avgCheckInSeconds != null ? tx('ops.common.minutesSeconds', { m: String(Math.floor(dp.avgCheckInSeconds / 60)), s: String(dp.avgCheckInSeconds % 60) }) : '—'}</span></li>
              <li><span className="rk-n">{tx('pos.no_show_rate')}</span><span className="rk-v">{dp ? `${dp.noShowRatePct}%` : '—'}</span></li>
              <li><span className="rk-n">{tx('pos.customer_satisfaction')}</span><span className="rk-v">{dp?.satisfaction != null ? `${dp.satisfaction} / 5` : '—'}</span></li>
            </ul>
          )}
        </Card>
      </div>

      {/* Quick Actions — one row, always visible (§51–§54) */}
      <div className="ov-qa" data-testid="check-in-quick-actions">
        <div className="qa-h">{tx('pos.quick_actions_2')}</div>
        <div className="qa-row">
          {QA.map((a) => (
            <button key={a.l} className={`qa-btn${a.primary ? ' qa-primary' : ''}`} onClick={a.go}>
              <span className="qa-ic"><Svg d={ICON[a.ic]} size={17} /></span><span className="qa-l">{a.l}</span>
            </button>
          ))}
        </div>
      </div>

      {detailId ? <GuestDetail id={detailId} onClose={() => setDetailId(null)} onChanged={() => void reload()} /> : null}
    </div>
  );
}
