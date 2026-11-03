import { useEffect, useMemo, useState } from 'react';
import { Card, Empty, More, useFitRows } from '../components/OneScreenKit';
import { useNavigate } from 'react-router-dom';
import { posOverviewApi } from '../api/posOverviewApi';
import { useAuth } from '../auth/AuthContext';
import { useTenantNavAccess } from '../shell/tenant-access';
import { Icon } from '../shell/tenant-nav';
import { useRealtime } from '../realtime/useRealtime';
import { REALTIME_STATUS, realtimeStatus } from '../realtime/realtime-client';
import type { RealtimeStatus } from '../realtime/realtime-core';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { statusLabel } from '../i18n/status-label';
import { opsStatusLabel } from './opsStatus';
import { fmtMoney, fmtMoneyCompact, fmtTime as fmtClock, fmtYmd } from '../i18n/format';
import { deviceToday } from '../lib/deviceToday';

// POS Overview — the salon's live daily command center. Consumes the canonical rich /pos/overview/state (KPIs, the day's
// appointments, analytics, insights) + /pos/overview/board (arrivals, live tech queue, the service-flow sublists,
// communications, retention, inventory — each the TOP rows plus the server's total).
//
// Overview 27-inch mandate (Oct 28 2026): ONE screen at 1920×1080 with the browser bars and the taskbar (a 1920×945 page),
// at 100 % zoom, in every state from an empty salon to 200 technicians and 100 low-stock items. `.overview-page` is a fixed
// grid (KPIs · arrivals | tech queue | service flow · appointments | communications | AI · 5 analytics · Quick Actions);
// every card keeps its height and shows its top rows + "+N more" + View All (a full list overlay or the domain page) — a
// busy day never grows the page (§4–§5, §11–§21). The screen derives nothing: the lists it used to rebuild from
// appointment statuses in the browser (arrivals, "live" technicians, ready-for-assignment / checkout) are the server's
// board; a card with no data says so (§27). Insights are the server's advisory rules, worded here from `id` + `vars`, and
// each opens the page where staff act (§16). Live shows the realtime connection's real state; an event refetches in place
// and nothing resizes (§30). Loading and errors keep the same card footprint (§30).

type CountKpi = { count: number; changePercent?: number; change?: number; comparisonLabel?: string };
type MoneyKpi = { amountCents: number; displayAmount: string; changePercent: number; comparisonLabel?: string };
type Appt = { appointmentId: string; customerName: string; serviceNames: string[]; startTime: string; status: string; source: string; amountCents?: number; durationMinutes?: number; tech?: string };
type Insight = { id?: string; type: string; title: string; value?: string; severity: string; route?: string; vars?: Record<string, string | number> };
type Rich = {
  context?: { salonName?: string; branchName?: string; businessDate?: string };
  kpis: { todayRevenue: MoneyKpi; todayCheckIns: CountKpi; walkInsToday: CountKpi; averageTicket: MoneyKpi; waitingGuests: CountKpi; servingNow: CountKpi; readyCheckout: CountKpi; activeTechs: { active: number; scheduled: number; onBreak?: number }; onlineBookings?: CountKpi };
  schedulePreview?: { technicians: { technicianId: string; name: string; appointments: Appt[] }[] };
  todayAppointments?: { total: number; completed: number; noShow: number; cancelled: number; remaining: number };
  walkInStatus?: { waiting: number; estimatedWaitMinutes: number; checkedInNotAssigned: number };
  checkoutToday?: { paidTickets: number; tipsCents: number; longestWaitMinutes: number };
  analytics?: {
    revenueTrend: { date: string; revenueCents: number }[];
    topTechnicians: { technicianId: string; technicianName: string; revenueCents: number; completedServices: number; utilizationPercent: number | null }[];
    paymentMix: { method: string; amountCents: number; percent: number }[];
    quickInsights: Insight[];
  };
};
type Board = {
  error?: boolean;
  arrivals?: { startTime: string; customerName: string; serviceName: string; status: string; waitMinutes: number | null }[];
  liveTechQueue?: { technicianName: string; serviceName: string; customerName: string; minutesLeft: number | null; status: string }[];
  readyForAssignment?: { customerName: string; serviceName: string; requestedTech: string }[];
  readyForCheckout?: { customerName: string; amountCents: number }[];
  communications?: { reminders: { customerName: string; service: string; whenLabel: string; channel: string; status: string }[]; messages: { customerName: string; preview: string; unread: boolean; at?: string | null }[]; missedCalls: { from: string; at: string; status: string }[]; missedCallsAvailable?: boolean; messagesAvailable?: boolean };
  customerRetention?: { returningPercent: number; newPercent: number; inactivePercent: number } | null;
  inventoryAlerts?: { product: string; stock: number; reorderLevel: number; status: 'low' | 'critical' | 'out' }[];
  totals?: { arrivals: number; liveTechQueue: number; readyForAssignment: number; readyForCheckout: number; inventoryAlerts: number; reminders: number; messages: number; unreadMessages: number };
};
type Full = null | 'arrivals' | 'techq' | 'appts' | 'comms' | 'insights';

// Refined, dedicated Quick Action icons (kept separate from the sidebar icon set).
const QA_SVG: Record<string, JSX.Element> = {
  checkin: <><circle cx="10" cy="8" r="3.1" /><path d="M4.2 19.5c0-3.2 2.6-5.5 5.8-5.5" /><path d="M14.8 17.8l2 2 3.7-4.3" /></>,
  booking: <><rect x="3" y="4.5" width="18" height="16.5" rx="2.6" /><path d="M3 9.5h18M8 2.6v3.6M16 2.6v3.6" /><path d="M12 12.6v4.2M9.9 14.7h4.2" /></>,
  walkin: <><circle cx="12" cy="4" r="1.9" /><path d="M12 6.6l-1.6 4.6 2.6 2 1.1 5.6" /><path d="M10.4 11.2L6.8 13.2M12 8.6l3.2 1.6" /></>,
  assign: <><circle cx="9" cy="8" r="3" /><path d="M3.6 19.8c0-3 2.5-5.4 5.4-5.4" /><path d="M14.6 15.2h5.8M17.8 12.4l3 2.8-3 2.8" /></>,
  scissors: <><circle cx="6" cy="7" r="2.1" /><circle cx="6" cy="17" r="2.1" /><path d="M7.8 8.3L20 16M7.8 15.7L20 8" /></>,
  pay: <><rect x="2.6" y="5.6" width="18.8" height="12.8" rx="2.6" /><path d="M2.6 9.8h18.8" /><path d="M6 14.8h3.4" /></>,
  product: <><path d="M3.6 7.6l8.4-3.9 8.4 3.9v8.8l-8.4 3.9-8.4-3.9z" /><path d="M3.6 7.6l8.4 4 8.4-4M12 11.6v8.7" /></>,
  message: <><path d="M20.5 11.6a7.6 7.6 0 01-10.8 6.9L4 20l1.5-5.6A7.6 7.6 0 1120.5 11.6z" /><path d="M8.6 12h.01M12 12h.01M15.4 12h.01" /></>,
  drawer: <><rect x="3" y="10" width="18" height="9" rx="1.8" /><path d="M3 10l2.3-5h13.4L21 10M9.5 14.5h5" /></>,
};
function QAIcon({ name }: { name: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{QA_SVG[name]}</svg>;
}

// money in the salon's currency, clock times in the branch zone, month names in the user's language (i18n/format)
const money = (c: number) => fmtMoney(c || 0);
const moneyK = (c: number) => fmtMoney(c || 0, { whole: true });
/** §10: a KPI value never grows its card — $100,000 and above is shown compact ($2.45M); the exact figure is the tooltip */
const kpiMoney = (k: MoneyKpi) => { const c = k.amountCents || 0; return { v: Math.abs(c) < 10000000 ? fmtMoney(c) : fmtMoneyCompact(c), full: fmtMoney(c) }; };
/** the payment-mix ring's centre is small: whole dollars, compact from $10,000 ($12K, $2.45M); the exact figure is the tooltip */
const compactMoney = (c: number) => fmtMoneyCompact(c, 1000000, 1);
const fmtTime = (s: string) => { if (/^\d{1,2}:\d{2}/.test(s)) return s.slice(0, 5); const d = new Date(s); return isNaN(+d) ? s : fmtClock(d); };
const trend = (p?: number) => (p == null ? null : <span className={`trend ${p >= 0 ? 'up' : 'dn'}`}>{p >= 0 ? '▲' : '▼'} {Math.abs(p)}{tx('pos.vs_yesterday_2')}</span>);
const fmtDate = (d: string) => fmtYmd(d, { month: 'short', day: '2-digit', year: 'numeric' }, d);
const PAY_COLOR: Record<string, string> = { card: '#2C5B93', cash: '#2E7D32', gift_card: '#C9971B', tap_to_pay: '#5B4B93', split: '#7A5C93', other: '#8A7A66' };
/** a reminder's channel code ("sms") → its label in the user's language (an unknown channel shows as written, upper-case) */
const channelLabel = (c: string) => { const k = `ops.channel.${String(c || '').toLowerCase()}`; const v = tx(k); return v === k ? String(c || '').toUpperCase() : v; };
const LIVE_TONE: Record<RealtimeStatus, string> = { CONNECTED: '#2E7D32', RECONNECTING: '#9a6a12', DEGRADED: '#9a6a12', OFFLINE: '#C0392B' };

function StatusPill({ s }: { s: string }) {
  const k = (s || '').toLowerCase();
  const tone = /complete|delivered|paid|confirmed|sent/.test(k) ? 'ok' : /progress|serving|in_service|arrived|scheduled|assigned|ready/.test(k) ? 'info'
    : /wait|upcoming|open|called|booked|paused/.test(k) ? 'warn' : /no.?show|fail|cancel|late/.test(k) ? 'bad' : 'mut';
  // the board mixes appointment / queue / technician / message statuses — the code stays the tone, the label is translated
  return <span className={`pill ${tone}`}>{opsStatusLabel(s)}</span>;
}
export function POSOverviewScreen() {
  const nav = useNavigate();
  const { principal } = useAuth();
  const access = useTenantNavAccess(principal?.role, principal?.permissions);
  const aiAllowed = access.aiPackages.length > 0; // AI Insights require an active AI package
  const [s, setS] = useState<Rich | null>(null);
  const [sErr, setSErr] = useState<string | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [reload, setReload] = useState(0);
  const [commTab, setCommTab] = useState<'reminders' | 'messages' | 'missed'>('reminders');
  const [apptDate, setApptDate] = useState<string | null>(null); // null = today's business date
  const [apptDay, setApptDay] = useState<Rich | null>(null);     // state for a non-today selected date
  const [fullView, setFullView] = useState<Full>(null);         // the full list overlay ("View All")
  const [live, setLive] = useState<RealtimeStatus>(() => realtimeStatus());
  useEffect(() => { const h = (e: Event) => setLive((e as CustomEvent<{ status: RealtimeStatus }>).detail.status); window.addEventListener(REALTIME_STATUS, h); return () => window.removeEventListener(REALTIME_STATUS, h); }, []);

  useEffect(() => {
    if (!fullView) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullView(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fullView]);

  useEffect(() => {
    let alive = true;
    posOverviewApi.getOverview().then((r) => { if (alive) { setS(r as Rich); setSErr(null); } }).catch((e: any) => { if (alive) setSErr(e?.message || tx('pos.unable_to_load_overview')); });
    posOverviewApi.getBoard().then((b) => { if (alive) setBoard(b as Board); }).catch(() => { if (alive) setBoard({ error: true }); });
    return () => { alive = false; };
  }, [reload]);

  // §30: realtime first — check-ins, service starts / completions, checkout readiness, payments, appointments refetch the
  // summary in place (the previous values stay on screen until the new ones arrive, so nothing jumps)
  useRealtime('overview', () => setReload((r) => r + 1));

  // Date selector on Today's Appointments refetches the real /state for the chosen day (KPIs/queues stay on today).
  useEffect(() => {
    const today = s?.context?.businessDate;
    if (!apptDate || !today || apptDate === today) { setApptDay(null); return; }
    let alive = true;
    posOverviewApi.getOverview(apptDate).then((r) => { if (alive) setApptDay(r as Rich); }).catch(() => { if (alive) setApptDay(null); });
    return () => { alive = false; };
  }, [apptDate, s?.context?.businessDate]);

  // Today's Appointments: the day's appointments from the Booking domain (every status but cancelled — it dropped arrived /
  // waiting / no-show guests), in time order, starting at the first one not finished yet
  const apptSource = apptDay || s;
  const apptList = useMemo<Appt[]>(() => {
    const list = (apptSource?.schedulePreview?.technicians || []).flatMap((t) => (t.appointments || []).map((a) => ({ ...a, tech: t.name })))
      .filter((a) => !/cancel/i.test(a.status));
    return list.sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
  }, [apptSource]);
  const apptFirst = Math.max(0, apptList.findIndex((a) => !/complete|done|no.?show/i.test(a.status)));
  const apptWindow = (n: number) => apptList.slice(apptFirst, apptFirst + n).length < n ? apptList.slice(Math.max(0, apptList.length - n)) : apptList.slice(apptFirst, apptFirst + n);
  const selDate = apptDate || s?.context?.businessDate || '';
  const apptLoading = !!apptDate && apptDate !== (s?.context?.businessDate || '') && !apptDay;
  const shiftDate = (delta: number) => { const base = new Date((selDate || deviceToday()) + 'T00:00:00'); base.setDate(base.getDate() + delta); setApptDate(base.toISOString().slice(0, 10)); };

  // KPI values come straight from the backend (OVERVIEW_KPI_DEFINITIONS), never re-derived from loaded rows
  const k = s?.kpis; const wi = s?.walkInStatus; const tot = board?.totals;
  const checkIns = k?.todayCheckIns?.count ?? 0;
  const walkIns = k?.walkInsToday?.count ?? 0;
  const paidToday = s?.checkoutToday?.paidTickets ?? 0;
  const onDutyPct = k && (k.activeTechs?.scheduled ?? 0) > 0 ? Math.round(((k.activeTechs?.active ?? 0) / (k.activeTechs!.scheduled)) * 100) : 0;
  const rev = k ? kpiMoney(k.todayRevenue) : null; const avg = k ? kpiMoney(k.averageTicket) : null;

  const kpis = k ? [
    { l: tx('pos.today_s_check_ins'), v: String(checkIns), d: trend(k.todayCheckIns?.changePercent) || <span className="sub">{tx('pos.vs_yesterday')}</span>, to: '/check-in', ic: 'checkin' as const },
    { l: tx('pos.waiting_guests'), v: String(k.waitingGuests.count), d: <span className="sub">{tx('pos.est_wait')}{' '}{wi?.estimatedWaitMinutes ?? 0} {tx('pos.min')}</span>, to: '/queue', ic: 'queue' as const },
    { l: tx('pos.walk_ins'), v: String(walkIns), d: <span className="sub">{checkIns > 0 ? Math.round((walkIns / Math.max(1, checkIns)) * 100) : 0}{tx('pos.of_check_ins')}</span>, to: '/check-in', ic: 'checkin' as const },
    { l: tx('pos.active_services'), v: String(k.servingNow.count), d: <span className="sub">{tx('pos.in_progress')}</span>, to: '/serving', ic: 'serving' as const },
    { l: tx('pos.ready_for_checkout'), v: String(k.readyCheckout.count), d: <span className="sub">{tx('pos.tickets_waiting')}</span>, to: '/checkout', ic: 'checkout' as const },
    { l: tx('pos.today_s_revenue'), v: rev!.v, title: rev!.full, d: trend(k.todayRevenue.changePercent), to: '/reports', ic: 'reports' as const },
    { l: tx('pos.average_ticket'), v: avg!.v, title: avg!.full, d: <span className="sub">{tx('ops.overview.paidToday', { count: String(paidToday) })}</span>, to: '/reports', ic: 'payments' as const },
    { l: tx('pos.staff_on_duty'), v: `${k.activeTechs.active} / ${k.activeTechs.scheduled}`, d: <span className="sub">{k.activeTechs.onBreak ? tx('ops.overview.onBreak', { count: String(k.activeTechs.onBreak) }) : `${onDutyPct}${tx('pos.on_duty')}`}</span>, to: '/technicians', ic: 'team' as const },
  ] : [];

  // §13: the stages are the server's counts (Completed = tickets paid today — it read completed appointments)
  const flow = k ? [
    { l: tx('pos.waiting_2'), n: k.waitingGuests.count, c: '#8A7A66', to: '/queue' },
    { l: tx('pos.ready_for_assignment'), n: wi?.checkedInNotAssigned ?? 0, c: '#C9971B', to: '/queue?assign=1' },
    { l: tx('pos.in_progress'), n: k.servingNow.count, c: '#B5821F', to: '/serving' },
    { l: tx('pos.ready_for_checkout'), n: k.readyCheckout.count, c: '#2C5B93', to: '/checkout' },
    { l: tx('pos.completed_2'), n: paidToday, c: '#2E7D32', to: '/reports' },
  ] : [];

  // §16: the server's advisory insight, worded in the user's language from its id + vars (its English text otherwise)
  const insightText = (q: Insight): { t: string; v?: string } => {
    const key = q.id || q.type; const t = tx(`ops.overview.insight.${key}`); const vk = `ops.overview.insightV.${key}`; const vv = tx(vk, Object.fromEntries(Object.entries(q.vars || {}).map(([a, b]) => [a, String(b)])));
    return { t: t === `ops.overview.insight.${key}` ? q.title : t, v: vv === vk ? (q.id === 'high_revenue_service' && q.vars?.name ? String(q.vars.name) : q.value) : vv };
  };
  const insights = s?.analytics?.quickInsights || [];
  const insightRow = (q: Insight, i: number, big = false) => { const x = insightText(q); return (
    <li key={q.id || i} className={`ins ${q.severity}`}>
      <span className="ins-dot" aria-hidden /><div className="ins-txt"><div className="ins-t">{x.t}</div>{x.v ? <div className="ins-v">{x.v}</div> : null}</div>
      {q.route ? <button className={`mini${big ? ' lg' : ''}`} onClick={() => { setFullView(null); nav(q.route!); }}>{tx('ops.insight.open')}</button> : null}
    </li>
  ); };

  // Quick Actions — the approved glossary terms (§29), each a real route into its domain flow (§22): New Check-In / Walk-In →
  // Check-In; New Booking → Booking; Assign Tech → the queue's assign sheet; Start Service → the queue filtered to guests
  // ready to start; Take Payment → Checkout; Add Product → Inventory's add form; Send Message → the Inbox; Open Cash
  // Drawer → the Cash Drawer screen, whose open / count flow carries its own permission and audit (checkout.process_payment)
  const QA: [string, string, string][] = [
    [tx('glossary.action.newCheckIn'), '/check-in', 'checkin'], [tx('glossary.action.newBooking'), '/booking', 'booking'], [tx('glossary.action.walkIn'), '/check-in', 'walkin'],
    [tx('glossary.action.assignTech'), '/queue?assign=1', 'assign'], [tx('glossary.action.startService'), '/queue?status=ready_for_tech', 'scissors'], [tx('glossary.action.takePayment'), '/checkout', 'pay'],
    [tx('glossary.action.addProduct'), '/tenant/inventory?add=1', 'product'], [tx('glossary.action.sendMessage'), '/messages', 'message'],
    [tx('glossary.action.openCashDrawer'), '/cash-drawer', 'drawer'],
  ];

  const loading = <div className="sk sk-fill" />;
  const boardErr = board?.error ? <Empty msg={tx('pos.unable_to_load_overview')} /> : null;
  const comm = board?.communications;
  const arrivals = board?.arrivals || []; const techq = board?.liveTechQueue || [];
  const assignRows = board?.readyForAssignment || []; const checkoutRows = board?.readyForCheckout || [];
  const inv = board?.inventoryAlerts || [];
  // rows that fit each card at this density (≤ the server's top rows), so "+N more" is exactly what is not on screen
  const [arrRef, arrN] = useFitRows(7, arrivals.length);
  const [tqRef, tqN] = useFitRows(6, techq.length);
  const [asRef, asN] = useFitRows(4, assignRows.length);
  const [coRef, coN] = useFitRows(4, checkoutRows.length);
  const [apRef, apN] = useFitRows(6, `${apptList.length}:${selDate}`);
  const [cmRef, cmN] = useFitRows(5, `${commTab}:${comm?.reminders?.length}:${comm?.messages?.length}`);
  const [inRef, inN] = useFitRows(4, `${insights.length}:${aiAllowed}`);
  const [pfRef, pfN] = useFitRows(3, s?.analytics?.topTechnicians?.length || 0);
  const [ivRef, ivN] = useFitRows(4, inv.length);
  const apptShown = apptWindow(apN);

  return (
    <div className="work ov overview-page" data-testid="overview-page">
      {/* KPI row — 8 cards, one row (§10) */}
      <div className="ov-kpis" data-testid="overview-kpis">
        {(s ? kpis : Array.from({ length: 8 })).map((c: any, i) => (
          <button key={i} className="ov-kpi" onClick={() => c && nav(c.to)} disabled={!s} title={c?.title}>
            {s ? (<><div className="kc"><span className="ki"><Icon name={c.ic} /></span><span className="kl">{c.l}</span></div>
              <div className="kv">{c.v}</div><div className="kd">{c.d}</div></>) : <div className="sk sk-kpi" />}
          </button>
        ))}
      </div>
      {sErr ? <div role="alert" className="ov-toast"><span>{sErr}</span><button className="mini" onClick={() => setReload((n) => n + 1)}>{tx('pos.retry')}</button></div> : null}

      {/* Row 1: arrivals · live tech queue · service flow */}
      <div className="ov-grid ov-3 ov-row1">
        <Card testId="ov-arrivals" bodyRef={arrRef} title={tx('pos.arrivals_check_in_queue')} right={<span className="live" data-testid="overview-live" data-live={live} style={{ color: LIVE_TONE[live] }}>● {tx(`payment.board.live.${live}`)}</span>}
          foot={<><More shown={Math.min(arrivals.length, arrN)} total={tot?.arrivals} /><button className="ov-more" onClick={() => setFullView('arrivals')}>{tx('pos.view_all_4')}</button></>}>
          {!board ? loading : boardErr || (arrivals.length === 0 ? <Empty msg={tx('pos.no_arrivals_yet')} /> : (
            <table className="ov-tbl"><tbody>
              {arrivals.slice(0, arrN).map((a, i) => (
                <tr key={i}>
                  <td className="t-time">{fmtTime(a.startTime)}</td>
                  <td className="t-name" title={a.customerName}>{a.customerName}</td>
                  <td className="t-mut t-flex t-opt" title={a.serviceName}>{a.serviceName || '—'}</td>
                  <td><StatusPill s={a.status} /></td>
                  <td className="t-mut t-num">{a.waitMinutes != null && a.waitMinutes >= 0 ? tx('pos.w_min', { w: String(a.waitMinutes) }) : '—'}</td>
                  <td className="t-act"><button className="mini" onClick={() => nav('/queue')}>{tx('ops.insight.open')}</button></td>
                </tr>
              ))}
            </tbody></table>
          ))}
        </Card>

        <Card testId="ov-techq" bodyRef={tqRef} title={tx('pos.live_tech_queue')} right={s ? <span className="badge-soft">{k!.servingNow.count} {tx('pos.in_progress')}</span> : null}
          foot={<><More shown={Math.min(techq.length, tqN)} total={tot?.liveTechQueue} /><button className="ov-more" onClick={() => setFullView('techq')}>{tx('pos.view_all_4')}</button></>}>
          {!board ? loading : boardErr || (techq.length === 0 ? <Empty msg={tx('pos.no_technicians_currently_serving')} /> : (
            <table className="ov-tbl"><tbody>
              {techq.slice(0, tqN).map((t, i) => (
                <tr key={i}>
                  <td className="t-name" title={t.technicianName}>{t.technicianName}</td>
                  <td className="t-mut t-flex t-opt" title={t.serviceName}>{t.serviceName || '—'}</td>
                  <td className="t-mut t-flex" title={t.customerName}>{t.customerName || '—'}</td>
                  <td><StatusPill s={t.status || 'in_service'} /></td>
                  <td className="t-mut t-num">{t.minutesLeft != null ? tx('pos.minutesleft_min', { minutesLeft: String(t.minutesLeft) }) : '—'}</td>
                </tr>
              ))}
            </tbody></table>
          ))}
        </Card>

        <Card testId="ov-flow" title={tx('pos.service_flow_overview')}>
          {!s ? loading : (
            <>
              <div className="flow-h">
                {flow.map((f) => (
                  <button key={f.l} className="flow-st" onClick={() => nav(f.to)} title={f.l}>
                    <span className="flow-bar" style={{ background: f.c }} /><span className="flow-n">{f.n}</span><span className="flow-l">{f.l}</span>
                  </button>
                ))}
              </div>
              <div className="flow-subs">
                <div className="flow-sub" ref={asRef}>
                  <div className="flow-sub-h">{tx('pos.ready_for_assignment')}<More shown={Math.min(assignRows.length, asN)} total={tot?.readyForAssignment} /></div>
                  {!board ? null : assignRows.length === 0 ? <div className="ov-empty sm">{tx('pos.none_waiting')}</div> : assignRows.slice(0, asN).map((a, i) => (
                    <div key={i} className="flow-sub-row">
                      <span className="fs-name" title={a.customerName}>{a.customerName}</span>
                      <span className="fs-mut" title={a.requestedTech}>{a.requestedTech || tx('pos.any_available')}</span>
                      <button className="mini" onClick={() => nav('/queue?assign=1')}>{tx('pos.assign')}</button>
                    </div>
                  ))}
                </div>
                <div className="flow-sub" ref={coRef}>
                  <div className="flow-sub-h">{tx('pos.ready_for_checkout')}<More shown={Math.min(checkoutRows.length, coN)} total={tot?.readyForCheckout} /></div>
                  {!board ? null : checkoutRows.length === 0 ? <div className="ov-empty sm">{tx('pos.none_ready')}</div> : checkoutRows.slice(0, coN).map((c, i) => (
                    <div key={i} className="flow-sub-row">
                      <span className="fs-name" title={c.customerName}>{c.customerName}</span>
                      <span className="fs-mut">{money(c.amountCents)}</span>
                      <button className="mini" onClick={() => nav('/checkout')}>{tx('pos.checkout')}</button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </Card>
      </div>

      {/* Row 2: appointments · communications · AI insights */}
      <div className="ov-grid ov-3 ov-row2">
        <Card testId="ov-appts" bodyRef={apRef} title={tx('pos.today_s_appointments')} right={
          <span className="ov-datesel">
            <button className="dnav" aria-label={tx('pos.previous_day')} onClick={() => shiftDate(-1)}>‹</button>
            <span className="dlabel">{selDate ? fmtDate(selDate) : ''}</span>
            <button className="dnav" aria-label={tx('pos.next_day')} onClick={() => shiftDate(1)}>›</button>
          </span>
        } foot={<><More shown={apptShown.length} total={apptList.length} /><button className="ov-more" onClick={() => setFullView('appts')}>{tx('pos.view_all_4')}</button></>}>
          {!s || apptLoading ? loading : apptList.length === 0 ? <Empty msg={tx('pos.no_appointments_scheduled')} /> : (
            <table className="ov-tbl"><tbody>
              {apptShown.map((a) => (
                <tr key={a.appointmentId}>
                  <td className="t-time">{fmtTime(a.startTime)}</td>
                  <td className="t-name" title={a.customerName}>{a.customerName}</td>
                  <td className="t-mut t-flex t-opt" title={a.serviceNames?.[0]}>{a.serviceNames?.[0] || '—'}</td>
                  <td className="t-mut t-flex" title={a.tech}>{a.tech || '—'}</td>
                  <td><StatusPill s={a.status} /></td>
                  <td className="t-amt">{a.amountCents ? money(a.amountCents) : '—'}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </Card>

        <Card testId="ov-comms" bodyRef={cmRef} title={tx('pos.customer_communications')}
          foot={<><More shown={commTab === 'reminders' ? Math.min(comm?.reminders?.length || 0, cmN) : commTab === 'messages' ? Math.min(comm?.messages?.length || 0, cmN) : 0} total={commTab === 'reminders' ? tot?.reminders : commTab === 'messages' ? tot?.messages : undefined} /><button className="ov-more" onClick={() => setFullView('comms')}>{tx('pos.view_all_communications')}</button></>}>
          {!board ? loading : boardErr || (
            <>
              <div className="tabs sm">
                <button className={`tab ${commTab === 'reminders' ? 'on' : ''}`} onClick={() => setCommTab('reminders')}>{tx('pos.reminders')}{tot?.reminders ? ` (${tot.reminders})` : ''}</button>
                <button className={`tab ${commTab === 'messages' ? 'on' : ''}`} onClick={() => setCommTab('messages')}>{tx('pos.messages_2')}{tot?.unreadMessages ? ` (${tot.unreadMessages})` : ''}</button>
                <button className={`tab ${commTab === 'missed' ? 'on' : ''}`} onClick={() => setCommTab('missed')}>{tx('pos.missed_calls')}</button>
              </div>
              {commTab === 'reminders' && ((comm?.reminders?.length || 0) === 0 ? <Empty msg={tx('pos.no_reminders_scheduled')} /> : (
                <table className="ov-tbl"><tbody>
                  {comm!.reminders.slice(0, cmN).map((r, i) => (
                    <tr key={i}><td className="t-name" title={r.customerName}>{r.customerName}</td><td className="t-mut">{r.whenLabel}</td>
                      <td className="t-mut">{channelLabel(r.channel)}</td><td><StatusPill s={r.status} /></td></tr>
                  ))}
                </tbody></table>
              ))}
              {commTab === 'messages' && (comm?.messagesAvailable === false ? <Empty msg={tx('ops.overview.messagesLocked')} /> : (comm?.messages?.length || 0) === 0 ? <Empty msg={tx('pos.no_messages_yet')} /> : (
                <table className="ov-tbl"><tbody>
                  {comm!.messages.slice(0, cmN).map((m, i) => (
                    <tr key={i} onClick={() => nav('/messages')} style={{ cursor: 'pointer' }}><td className="t-name" title={m.customerName}>{m.customerName}{m.unread ? <span className="dot-unread" /> : null}</td>
                      <td className="t-mut t-flex" title={m.preview}>{m.preview}</td></tr>
                  ))}
                </tbody></table>
              ))}
              {/* Jul 27, 2026 audit: nothing records a missed call yet — the AI receptionist's outcome table deliberately
                  stores no caller number. An empty list here means "not tracked", NOT "none happened". */}
              {commTab === 'missed' && ((comm?.missedCalls?.length || 0) === 0 ? <Empty msg={comm?.missedCallsAvailable === false ? tx('pos.missed_call_tracking_isn_t_connected_9saa') : tx('pos.no_missed_calls')} /> : (
                <table className="ov-tbl"><tbody>
                  {comm!.missedCalls.slice(0, cmN).map((c, i) => (
                    <tr key={i}><td className="t-name">{c.from}</td><td className="t-mut">{c.at}</td><td><StatusPill s={c.status} /></td>
                      <td className="t-act"><button className="mini" onClick={() => nav('/messages')}>{tx('pos.call_back')}</button></td></tr>
                  ))}
                </tbody></table>
              ))}
            </>
          )}
        </Card>

        <Card testId="ov-insights" bodyRef={inRef} title={tx('pos.ai_insights')} right={<span className="badge-soft purple">{tx('ops.common.ai')}</span>}
          foot={aiAllowed ? <><More shown={Math.min(insights.length, inN)} total={insights.length} /><button className="ov-more" onClick={() => setFullView('insights')}>{tx('pos.view_all_insights')}</button></> : undefined}>
          {!aiAllowed ? (
            <div className="ov-lock">
              <div className="lock-ic"><Icon name="lock" /></div>
              <p>{tx('pos.subscribe_to_an_ai_package_to_wmne')}</p>
              <button className="btn primary" onClick={() => nav('/tenant/account/overview')}>{tx('pos.browse_ai_packages')}</button>
            </div>
          ) : !s ? loading : insights.length === 0 ? <Empty msg={tx('pos.no_ai_insights_available')} /> : (
            <ul className="insights">{insights.slice(0, inN).map((q, i) => insightRow(q, i))}</ul>
          )}
        </Card>
      </div>

      {/* Row 3: revenue trend · tech performance · retention · payment mix · inventory (§17–§21) */}
      <div className="ov-grid ov-5 ov-row3">
        <Card testId="ov-revenue" title={tx('pos.revenue_trend')} right={<span className="sub">{tx('pos.this_week_2')}</span>}>
          {!s ? loading : (() => {
            const pts = s.analytics?.revenueTrend || [];
            const total = pts.reduce((a, p) => a + p.revenueCents, 0);
            if (pts.length === 0 || total === 0) return <Empty msg={tx('pos.no_revenue_yet')} />;
            const max = Math.max(...pts.map((p) => p.revenueCents), 1);
            const w = 220, h = 60, step = pts.length > 1 ? w / (pts.length - 1) : w;
            const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - (p.revenueCents / max) * (h - 8) - 4).toFixed(1)}`).join(' ');
            return (<><div className="big" title={money(total)}>{moneyK(total)}</div>
              <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"><path d={path} fill="none" stroke="#C9971B" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg></>);
          })()}
        </Card>

        <Card testId="ov-perf" bodyRef={pfRef} title={tx('pos.technician_performance')} foot={<button className="ov-more" onClick={() => nav('/tenant/reports/technicians')}>{tx('ops.overview.leaderboard')}</button>}>
          {!s ? loading : (s.analytics?.topTechnicians || []).length === 0 ? <Empty msg={tx('pos.no_data_yet')} /> : (
            <ul className="rank">
              {s.analytics!.topTechnicians.slice(0, pfN).map((t) => (
                <li key={t.technicianId}><span className="rk-n" title={t.technicianName}>{t.technicianName}</span><span className="rk-v">{money(t.revenueCents)}<span className="rk-sub">{t.utilizationPercent == null ? tx('pos.completedservices_svc', { completedServices: String(t.completedServices) }) : tx('pos.utilizationpercent_util', { utilizationPercent: String(t.utilizationPercent) })}</span></span></li>
              ))}
            </ul>
          )}
        </Card>

        <Card testId="ov-retention" title={tx('pos.customer_retention')}>
          {!board ? loading : !board.customerRetention ? <Empty msg={tx('pos.not_enough_history_yet')} /> : (() => {
            const r = board.customerRetention;
            const ring = `conic-gradient(#2E7D32 0 ${r.returningPercent}%, #C9971B 0 ${r.returningPercent + r.newPercent}%, #C0392B 0 100%)`;
            return (<div className="donut-wrap"><div className="donut" style={{ background: ring }}><div className="donut-hole">{Math.round(r.returningPercent)}%</div></div>
              <ul className="legend"><li><span className="lg" style={{ background: '#2E7D32' }} />{tx('pos.returning')}{' '}{r.returningPercent}%</li>
                <li><span className="lg" style={{ background: '#C9971B' }} />{tx('pos.new')}{' '}{r.newPercent}%</li>
                <li><span className="lg" style={{ background: '#C0392B' }} />{tx('pos.inactive_2')}{' '}{r.inactivePercent}%</li></ul></div>);
          })()}
        </Card>

        <Card testId="ov-paymix" title={tx('pos.payment_mix')}>
          {!s ? loading : (s.analytics?.paymentMix || []).length === 0 ? <Empty msg={tx('pos.no_payments_yet')} /> : (() => {
            const mix = s.analytics!.paymentMix;
            const total = mix.reduce((a, p) => a + p.amountCents, 0);
            let acc = 0; const segs = mix.map((p) => { const start = acc; acc += p.percent; return `${PAY_COLOR[p.method] || '#8A7A66'} ${start}% ${acc}%`; });
            return (<div className="donut-wrap"><div className="donut" style={{ background: `conic-gradient(${segs.join(', ')})` }} title={money(total)}><div className="donut-hole sm">{compactMoney(total)}</div></div>
              <ul className="legend">{mix.slice(0, 4).map((p) => (
                <li key={p.method} title={`${statusLabel('paymentMethod', p.method)} · ${money(p.amountCents)}`}><span className="lg" style={{ background: PAY_COLOR[p.method] || '#8A7A66' }} />{statusLabel('paymentMethod', p.method)} {p.percent}%</li>
              ))}{mix.length > 4 ? <li className="lg-more">{tx('ops.overview.moreCount', { count: String(mix.length - 4) })}</li> : null}</ul></div>);
          })()}
        </Card>

        <Card testId="ov-inventory" bodyRef={ivRef} title={tx('pos.inventory_alerts')} right={<span className="badge-soft orange">{tx('pos.low_stock')}</span>}
          foot={<><More shown={Math.min(inv.length, ivN)} total={tot?.inventoryAlerts} /><button className="ov-more" onClick={() => nav('/tenant/inventory')}>{tx('pos.view_all_inventory')}</button></>}>
          {!board ? loading : boardErr || (inv.length === 0 ? <Empty msg={tx('pos.no_low_stock_products')} /> : (
            <ul className="rank">
              {inv.slice(0, ivN).map((it, i) => (
                <li key={i}><span className="rk-n" title={it.product}>{it.product}</span><span className={`pill ${it.status === 'low' ? 'warn' : 'bad'}`}>{it.status === 'out' ? '⚠ ' : ''}{it.stock} {tx('pos.left')}</span></li>
              ))}
            </ul>
          ))}
        </Card>
      </div>

      {/* Quick actions — the whole bar always visible (§22) */}
      <div className="ov-qa" data-testid="overview-quick-actions">
        <div className="qa-h">{tx('pos.quick_actions_2')}</div>
        <div className="qa-row">
          {QA.map(([label, to, ic]) => (
            <button key={label} className="qa-btn" onClick={() => nav(to)}>
              <span className="qa-ic"><QAIcon name={ic} /></span><span className="qa-l">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Full list overlay ("View All") — the complete live list without leaving the dashboard; the page never grows */}
      {fullView && (() => {
        const cfg = ({
          arrivals: { title: tx('pos.arrivals_check_in_queue'), live: true, to: '/queue', toLabel: tx('pos.view_full_queue'), total: tot?.arrivals,
            cols: [tx('pos.time'), tx('pos.guest'), tx('pos.service_3'), tx('pos.status'), tx('pos.wait'), tx('pos.action')], rows: arrivals.length },
          techq: { title: tx('pos.live_tech_queue'), live: true, to: '/tech-queue', toLabel: tx('pos.view_full_tech_queue'), total: tot?.liveTechQueue,
            cols: [tx('pos.technician'), tx('pos.current_service'), tx('pos.customer'), tx('pos.status'), tx('ops.overview.timeLeft')], rows: techq.length },
          appts: { title: tx('pos.today_s_appointments'), live: false, to: '/booking', toLabel: tx('ops.overview.viewFullCalendar'), total: apptList.length,
            cols: [tx('pos.time'), tx('pos.guest'), tx('pos.service_3'), tx('pos.technician'), tx('pos.status'), tx('pos.amount_2')], rows: apptList.length },
          comms: { title: commTab === 'messages' ? tx('pos.customer_communications_messages') : commTab === 'missed' ? tx('pos.customer_communications_missed_calls') : tx('pos.customer_communications_reminders'), live: false, to: '/messages', toLabel: tx('pos.view_all_communications'),
            total: commTab === 'messages' ? tot?.messages : commTab === 'reminders' ? tot?.reminders : 0,
            cols: commTab === 'messages' ? [tx('pos.customer'), tx('pos.message')] : commTab === 'missed' ? [tx('pos.from'), tx('pos.time'), tx('pos.status'), tx('pos.action')] : [tx('pos.customer'), tx('pos.when'), tx('pos.channel'), tx('pos.status')],
            rows: commTab === 'messages' ? comm?.messages?.length || 0 : commTab === 'missed' ? comm?.missedCalls?.length || 0 : comm?.reminders?.length || 0 },
          insights: { title: tx('pos.ai_insights'), live: false, to: '/tenant/ai/command-center', toLabel: tx('pos.view_all_insights'), total: insights.length, cols: [] as string[], rows: insights.length },
        })[fullView];
        const shown = cfg.rows; const total = cfg.total ?? shown;
        return (
          <div className="ov-full" role="dialog" aria-modal="true" aria-label={cfg.title} data-testid="overview-full" onMouseDown={(e) => { if (e.target === e.currentTarget) setFullView(null); }}>
            <div className="ov-full-in">
              <div className="ov-full-top">
                <h2>{cfg.title}</h2>
                {cfg.live && <span className="live">{tx(`payment.board.live.${live}`)}</span>}
                <span className="ov-full-count">{total > shown ? tx('ops.overview.ofTotal', { shown: String(shown), total: String(total) }) : `${shown} ${tx('pos.total_3')}`}</span>
                <button className="ov-full-open" onClick={() => { setFullView(null); nav(cfg.to); }}>{cfg.toLabel} →</button>
                <button className="ov-full-x" onClick={() => setFullView(null)} aria-label={tx('pos.close')}>×</button>
              </div>
              {fullView === 'comms' && (
                <div className="tabs sm ov-full-tabs">
                  <button className={`tab ${commTab === 'reminders' ? 'on' : ''}`} onClick={() => setCommTab('reminders')}>{tx('pos.reminders')}</button>
                  <button className={`tab ${commTab === 'messages' ? 'on' : ''}`} onClick={() => setCommTab('messages')}>{tx('pos.messages_2')}</button>
                  <button className={`tab ${commTab === 'missed' ? 'on' : ''}`} onClick={() => setCommTab('missed')}>{tx('pos.missed_calls')}</button>
                </div>
              )}
              <div className="ov-full-body">
                {fullView === 'insights' ? (
                  insights.length === 0 ? <div className="ov-full-empty">{tx('pos.no_ai_insights_available')}</div> : <ul className="insights lg">{insights.map((q, i) => insightRow(q, i, true))}</ul>
                ) : (
                  <table className="ov-full-tbl">
                    <thead><tr>{cfg.cols.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
                    <tbody>
                      {shown === 0 ? <tr><td colSpan={cfg.cols.length || 1} className="ov-full-empty">{tx('pos.nothing_to_show_right_now')}</td></tr> :
                        fullView === 'arrivals' ? arrivals.map((a, i) => <tr key={i}><td className="t-time">{fmtTime(a.startTime)}</td><td className="t-name">{a.customerName}</td><td className="t-mut">{a.serviceName || '—'}</td><td><StatusPill s={a.status} /></td><td className="t-mut">{a.waitMinutes != null && a.waitMinutes >= 0 ? tx('pos.wait_min', { wait: String(a.waitMinutes) }) : '—'}</td><td><button className="mini" onClick={() => { setFullView(null); nav('/queue'); }}>{tx('ops.insight.open')}</button></td></tr>)
                        : fullView === 'techq' ? techq.map((t, i) => <tr key={i}><td className="t-name">{t.technicianName}</td><td className="t-mut">{t.serviceName || '—'}</td><td className="t-mut">{t.customerName || '—'}</td><td><StatusPill s={t.status || 'in_service'} /></td><td className="t-mut">{t.minutesLeft != null ? tx('pos.left_min', { left: String(t.minutesLeft) }) : '—'}</td></tr>)
                        : fullView === 'comms' ? (commTab === 'messages' ? (comm?.messages || []).map((m, i) => <tr key={i}><td className="t-name">{m.customerName}{m.unread ? <span className="dot-unread" /> : null}</td><td className="t-mut">{m.preview}</td></tr>)
                          : commTab === 'missed' ? (comm?.missedCalls || []).map((c, i) => <tr key={i}><td className="t-name">{c.from}</td><td className="t-mut">{c.at}</td><td><StatusPill s={c.status} /></td><td><button className="mini" onClick={() => { setFullView(null); nav('/messages'); }}>{tx('pos.call_back')}</button></td></tr>)
                            : (comm?.reminders || []).map((r, i) => <tr key={i}><td className="t-name">{r.customerName}</td><td className="t-mut">{r.whenLabel}</td><td className="t-mut">{channelLabel(r.channel)}</td><td><StatusPill s={r.status} /></td></tr>))
                          : apptList.map((a) => <tr key={a.appointmentId}><td className="t-time">{fmtTime(a.startTime)}</td><td className="t-name">{a.customerName}</td><td className="t-mut">{a.serviceNames?.[0] || '—'}</td><td className="t-mut">{a.tech || '—'}</td><td><StatusPill s={a.status} /></td><td className="t-amt">{a.amountCents ? money(a.amountCents) : '—'}</td></tr>)}
                    </tbody>
                  </table>
                )}
                {total > shown ? <div className="ov-full-note">{tx('ops.overview.ofTotal', { shown: String(shown), total: String(total) })} · <button className="ov-more inline" onClick={() => { setFullView(null); nav(cfg.to); }}>{cfg.toLabel} →</button></div> : null}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
