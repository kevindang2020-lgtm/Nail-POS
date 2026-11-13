// POSDashboardScreen.tsx — POS > Live Operations (owner/manager command center), built to the reference design. Reuses the
// canonical /pos/dashboard/state aggregate. Every module fails independently with its own loading / empty state; one card
// never blanks the page. Live Operations 27-inch mandate (Oct 28 2026): the page is ONE fixed grid (styles.css one-screen
// kit, `.live-ops-page`) — KPI row · snapshot | live activity | AI insights · trend | top technicians · services |
// retention | payment mix | locations · Quick Actions — 1920×1080 at 100 % zoom with the browser bars and the taskbar (a
// 1920×945 page) shows all of it with no scroll; each list shows the rows that fit + "+N more" + View All.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, Empty, More, useFitRows } from '../components/OneScreenKit';
import { REALTIME_STATUS, realtimeStatus } from '../realtime/realtime-client';
import type { RealtimeStatus } from '../realtime/realtime-core';
import { useNavigate } from 'react-router-dom';
import { posDashboardApi } from '../api/posDashboardApi';
import { useRealtime } from '../realtime/useRealtime';
import { useAuth } from '../auth/AuthContext';
import { useCan } from '../components/usePermissions';
import { quickActionGate } from './quickActionGate';
import { useTenantNavAccess } from '../shell/tenant-access';
import { t as tx, currentLocale } from '@aipowersalon/mobile-sdk/i18n';
import { statusLabel } from '../i18n/status-label';
import { fmtMoney, fmtMoneyCompact, fmtTime as fmtClock, fmtYmd } from '../i18n/format';
import { opsStatusLabel } from './opsStatus';
import { FitDialog } from '../components/FitKit';

/** Operational Trend Explainability: the exact source, the window and what changed vs the period before — read-only */
function TrendWhyBody({ e }: { e: TrendWhy }) {
  const d = (ymd: string) => fmtYmd(ymd, { month: 'short', day: 'numeric' }, ymd);
  const pct = e.changePercent == null ? '' : `${e.changePercent > 0 ? '+' : ''}${e.changePercent}%`;
  const cur = fmtMoney(e.currentCents), prev = fmtMoney(e.previousCents), diff = fmtMoney(Math.abs(e.changeCents));
  const rev = e.previousCents <= 0 ? (e.currentCents === 0 ? tx('ops.liveOps.trend.revSame', { cur }) : tx('ops.liveOps.trend.revNoBase', { cur }))
    : e.changeCents > 0 ? tx('ops.liveOps.trend.revUp', { cur, diff, prev, pct }) : e.changeCents < 0 ? tx('ops.liveOps.trend.revDown', { cur, diff, prev, pct }) : tx('ops.liveOps.trend.revSame', { cur });
  return (
    <div className="lo-why" data-testid="lo-trend-why-body">
      <p data-testid="lo-why-window">{tx('ops.liveOps.trend.window', { from: d(e.from), to: d(e.to), days: String(e.days), pfrom: d(e.previousFrom), pto: d(e.previousTo) })}</p>
      <p data-testid="lo-why-rev"><b>{rev}</b></p>
      <p data-testid="lo-why-appts">{tx('ops.liveOps.trend.appts', { cur: String(e.currentAppointments), prev: String(e.previousAppointments) })}</p>
      {e.peakDay ? <p data-testid="lo-why-peak">{tx('ops.liveOps.trend.peak', { day: d(e.peakDay.date), amount: fmtMoney(e.peakDay.valueCents) })}</p> : null}
      {e.includesToday ? <p className="sub" data-testid="lo-why-progress">{tx('ops.liveOps.trend.inProgress')}</p> : null}
      <p className="sub" data-testid="lo-why-source">{tx('ops.liveOps.trend.source', { statuses: e.statuses.map((c) => statusLabel('payment', c)).join(', '), tz: e.timeZone })}</p>
      <p className="sub">{tx('ops.liveOps.trend.apptSource')}</p>
      <p className="sub">{tx('ops.liveOps.trend.readOnly')}</p>
    </div>
  );
}

/** the server's Trend Explainability block (source, windows and the period before) — rendered as is, never recomputed here */
type TrendWhy = {
  source: string; statuses: string[]; appointmentSource: string; timeZone: string;
  from: string; to: string; previousFrom: string; previousTo: string; days: number;
  currentCents: number; previousCents: number; changeCents: number; changePercent: number | null;
  currentAppointments: number; previousAppointments: number; includesToday: boolean; peakDay: { date: string; valueCents: number } | null;
};
type DashState = {
  context: { salonName: string; branchName: string };
  kpis: { todayRevenueCents: number; todayRevenueTrendPercent: number; waitingGuests: number; servingNow: number; readyCheckout: number; activeTechs: number; totalTechs: number; onlineBookings: number; monthlyCardVolumeCents: number; checkInsToday: number; appointmentsToday: number; averageTicketCents: number; customerRetentionPercent: number; aiBookingConversionPercent: number; monthlyCardVolumeTrendPercent?: number; checkInsTodayTrendPercent?: number; appointmentsTodayTrendPercent?: number; averageTicketTrendPercent?: number; customerRetentionTrendPercent?: number; aiBookingConversionTrendPercent?: number };
  calendar?: { appointments: { id: string; customerName: string; technicianId: string; serviceNames: string[]; startTime: string; status: string; source: string }[]; technicians?: { id: string; displayName: string }[] };
  todaysAppointments: { totalAppointments: number; completed: number; noShow: number; cancelled: number; remaining: number; completedPercent: number };
  walkInStatus: { waitingCount: number; estimatedWaitMinutes: number; checkedInNotAssigned: number };
  operationsSnapshot?: { waitingGuests: number; estWaitMinutes: number; walkInsToday: number; walkInPercent: number; readyCheckout: number; readyCheckoutValueCents: number; completedServices: number; noShows: number; noShowPercent: number; upcomingNext3h: number };
  revenueTrend: { period: string; totalCents: number; trendPercent: number; series: { label: string; valueCents: number; apptCount: number; date?: string }[]; explain?: TrendWhy };
  topServices?: { name: string; revenueCents: number }[];
  topTechnicians: { technicianId: string; name: string; revenueCents: number; servicesCount?: number; tipsCents?: number; utilizationPercent?: number | null; rating?: number | null }[];
  paymentMix: { period: string; entries: { method: string; percent: number; amountCents: number }[] };
  liveActivity?: { time: string; guestName: string; serviceName: string; technicianName: string; status: string; elapsedMinutes: number; startedAt?: string | null }[];
  liveActivityTotal?: number;
  customerRetention?: { returningPercent: number; returningCount: number; newPercent: number; newCount: number; inactivePercent: number; inactiveCount: number; totalCustomers: number };
  multiLocation?: { branchId: string; branchName: string; revenueCents: number; checkIns: number; trendPercent: number }[];
  quickInsights: { kind: string; text: string; tone: 'info' | 'success' | 'warning' | 'danger' }[];
  aiInsights?: { id: string; icon: string; primary: string; secondary: string; tone: 'info' | 'success' | 'warning' | 'danger'; action?: { label: string; kind: string }; vars?: Record<string, string | number> }[];
};

// money in the salon's currency, clock times in the branch zone, words in the user's language (i18n/format)
const money = (c?: number | null) => (c == null ? '—' : fmtMoney(c));
const moneyK = (c: number) => fmtMoney(c || 0, { whole: true });
const avgTicketCents = (rev: number, n: number) => (n > 0 ? Math.round(rev / n) : 0);
const onDutyPct = (a: number, t: number) => (t > 0 ? Math.round((a / t) * 100) : 0);
const fmtTime = (s: string) => { const d = new Date(s); return isNaN(+d) ? s : fmtClock(d); };
/** an hour of the branch's day (0–23) as a clock label in the user's language ("1:00 PM" / "13:00") */
const hourLabel = (h: number) => { try { return new Intl.DateTimeFormat(currentLocale(), { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(Date.UTC(2000, 0, 1, h)); } catch { return String(h); } };
/** the server's AI insight (id + vars) in the user's language; its English text for an id this screen does not know */
function aiInsightText(it: { id: string; primary: string; secondary: string; vars?: Record<string, string | number>; action?: { label: string; kind: string } }): { primary: string; secondary: string; action?: string } {
  const v = it.vars || {};
  const own = { primary: it.primary, secondary: it.secondary, action: it.action?.label };
  const win = v.fromHour != null && v.toHour != null ? `${hourLabel(Number(v.fromHour))} – ${hourLabel(Number(v.toHour))}` : '';
  switch (it.id) {
    case 'peak_time': return win ? { primary: tx('ops.liveOps.ai.peak', { window: win }), secondary: v.service ? tx('ops.liveOps.ai.peakService', { service: String(v.service) }) : tx('ops.liveOps.ai.peakPlan') } : own;
    case 'staffing': return { primary: tx('ops.liveOps.ai.staffing'), secondary: win ? tx('ops.liveOps.ai.staffingWindow', { window: win }) : tx('ops.liveOps.ai.staffingPeak') };
    case 'missed_calls': return v.count != null ? { primary: tx('ops.liveOps.ai.missedCalls', { count: String(v.count) }), secondary: tx('ops.liveOps.ai.missedCallsValue', { value: fmtMoney(Number(v.valueCents || 0), { whole: true }) }), action: tx('ops.liveOps.ai.viewCallBack') } : own;
    case 'upsell': return v.count != null ? { primary: tx('ops.liveOps.ai.upsell'), secondary: tx('ops.liveOps.ai.upsellGuests', { count: String(v.count) }) } : own;
    case 'rebooking': return v.count != null ? { primary: tx('ops.liveOps.ai.rebooking', { count: String(v.count) }), secondary: tx('ops.liveOps.ai.rebookingReach') } : own;
    case 'low_stock': return v.count != null ? { primary: tx('ops.liveOps.ai.lowStock'), secondary: tx('ops.liveOps.ai.lowStockCount', { count: String(v.count) }), action: tx('ops.liveOps.ai.viewInventory') } : own;
    default: return own;
  }
}
type RangeKey = 'today' | 'week' | 'month';
const RANGE_OPTS: { key: RangeKey; label: string }[] = [{ key: 'today', get label() { return tx('pos.today_2'); } }, { key: 'week', get label() { return tx('pos.this_week_2'); } }, { key: 'month', get label() { return tx('pos.this_month_3'); } }];
const trendEl = (p?: number) => (p == null ? null : <span className={`dt ${p >= 0 ? 'up' : 'dn'}`}>{p >= 0 ? '▲' : '▼'} {Math.abs(p)}{tx('pos.vs_yesterday_2')}</span>);
// Trend delta with an explicit comparison label; falls back to `sub` when there is no prior-period baseline yet.
const trendOr = (p: number | undefined, label: string, sub: React.ReactNode) => (p ? <span className={`dt ${p >= 0 ? 'up' : 'dn'}`}>{p >= 0 ? '▲' : '▼'} {Math.abs(p)}% {label}</span> : <span className="dsub">{sub}</span>);
const PAY_COLOR: Record<string, string> = { card: '#2C5B93', cash: '#2E7D32', split: '#5B4B93', gift_card: '#C9971B', gift: '#C9971B', other: '#8A7A66' };
const isInProgress = (st: string) => /progress|serving|started/i.test(st || '');

// where each AI insight's action routes
const insightRoute = (kind: string) => kind === 'missed_calls' ? '/messages' : kind === 'inventory' ? '/tenant/inventory' : kind === 'rebooking' ? '/customers' : kind === 'upsell' ? '/customers' : kind === 'staffing' ? '/technicians/schedule' : '/tenant/ai/command-center';

// Dashboard line-icons (cream/gold stroke; no emoji per design spec).
const K_ICON: Record<string, string> = {
  money: 'M8 2.6v10.8 M10.1 5.1C10.1 4.2 9.2 3.7 8 3.7S5.9 4.3 5.9 5.3s.9 1.4 2.1 1.6 2.1.7 2.1 1.7-.9 1.6-2.1 1.6-2.1-.5-2.1-1.4',
  card: 'M2.6 4.4h10.8v7.2H2.6Z M2.6 7h10.8',
  usercheck: 'M6 7.6A2.2 2.2 0 1 0 6 3.2a2.2 2.2 0 0 0 0 4.4Z M2.4 13c0-2.2 1.7-3.5 3.6-3.5 M9.4 10.6l1.3 1.3 2.3-2.7',
  calendar: 'M3 4.2h10v8.8H3Z M3 6.7h10 M5.6 2.6v2.1 M10.4 2.6v2.1',
  scissors: 'M4.5 4.5 13.2 13.2 M4.5 11.5 13.2 2.8 M5.4 5.4a1.5 1.5 0 1 1-2.2 0 1.5 1.5 0 0 1 2.2 0Z M5.4 10.6a1.5 1.5 0 1 0-2.2 0 1.5 1.5 0 0 0 2.2 0Z',
  receipt: 'M4 2.6h8v11l-1.3-1-1.3 1-1.4-1-1.3 1-1.4-1L4 13.6Z M6 5.6h4 M6 8.1h4 M6 10.4h2.6',
  people: 'M5.6 7.2A2 2 0 1 0 5.6 3.2a2 2 0 0 0 0 4Z M2.3 12.6c0-2 1.5-3.3 3.3-3.3 M10.6 7.3a1.8 1.8 0 1 0 0-3.6 M9.5 9.4c2 0 3.4 1.3 3.4 3.2',
  heart: 'M8 13.1C8 13.1 2.9 9.6 2.9 6.3 2.9 4.7 4.1 3.6 5.5 3.6c1 0 1.8.6 2.5 1.5.7-.9 1.5-1.5 2.5-1.5 1.4 0 2.6 1.1 2.6 2.7C13.1 9.6 8 13.1 8 13.1Z',
  sparkle: 'M8 2.5l1.4 3.7 3.6 1.3-3.6 1.4L8 12.6 6.6 8.9 3 7.5l3.6-1.3Z',
  walkin: 'M9.2 2.6H4.6v10.8h4.6 M7 8h6 M11 6l2 2-2 2',
  check: 'M3.4 8.3 6.2 11.1 12.4 4.9',
  alert: 'M8 3 14 13.2H2L8 3Z M8 6.9v3 M8 11.4h.01',
  pin: 'M8 14.1s4.5-4.3 4.5-7.6A4.5 4.5 0 0 0 3.5 6.5C3.5 9.8 8 14.1 8 14.1Z M8 8.1a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2Z',
};
function KIcon({ k }: { k: string }) {
  return <svg className="dki" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d={K_ICON[k] || K_ICON.calendar} /></svg>;
}

function PeriodDropdown({ value, onChange }: { value: RangeKey; onChange: (r: RangeKey) => void }) {
  return (
    <select className="dperiod dperiod-sel" aria-label={tx('pos.period')} value={value} onChange={(e) => onChange(e.target.value as RangeKey)}>
      {RANGE_OPTS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
    </select>
  );
}
function Pill({ s }: { s: string }) {
  const k = (s || '').toLowerCase();
  const tone = /complete|paid|confirmed|delivered/.test(k) ? 'ok' : /progress|serving|arrived|sent|scheduled/.test(k) ? 'info' : /wait|upcoming|open/.test(k) ? 'warn' : /no.?show|fail|cancel|late|out/.test(k) ? 'bad' : 'mut';
  return <span className={`pill ${tone}`}>{opsStatusLabel(s)}</span>;
}

const LIVE_TONE: Record<RealtimeStatus, string> = { CONNECTED: '#2E7D32', RECONNECTING: '#9a6a12', DEGRADED: '#9a6a12', OFFLINE: '#C0392B' };
/** §26: a large amount stays one line ($2.45M) and the exact figure is the tooltip; below $100,000 it is exact */
const kpiMoney = (c: number) => ({ v: Math.abs(c) < 10000000 ? fmtMoney(c) : fmtMoneyCompact(c), full: fmtMoney(c) });
/** a donut centre: compact from $10,000 ($18.1K), exact below — the exact figure is the donut's tooltip */
const hubMoney = (c: number) => (Math.abs(c) < 1000000 ? fmtMoney(c, { whole: true }) : fmtMoneyCompact(c, 1000000, 1));

export function POSDashboardScreen() {
  const nav = useNavigate();
  const { principal } = useAuth(); const can = useCan();
  const access = useTenantNavAccess(principal?.role, principal?.permissions);
  const aiAllowed = access.aiPackages.length > 0;
  const [s, setS] = useState<DashState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // §9 on-card period selectors (Today / This Week / This Month) — each refetches its card from the range-scoped endpoint
  const [revRange, setRevRange] = useState<RangeKey>('week');
  const [svcRange, setSvcRange] = useState<RangeKey>('today');
  const [payRange, setPayRange] = useState<RangeKey>('week');
  const [revOverride, setRevOverride] = useState<DashState['revenueTrend'] | null>(null);
  const [svcOverride, setSvcOverride] = useState<NonNullable<DashState['topServices']> | null>(null);
  const [payOverride, setPayOverride] = useState<DashState['paymentMix'] | null>(null);
  const [live, setLive] = useState<RealtimeStatus>(() => realtimeStatus());
  const [syncedAt, setSyncedAt] = useState<string | null>(null);   // last successful read (Realtime Recovery Indicator)
  const [whyOpen, setWhyOpen] = useState(false);   // Trend Explainability dialog
  useEffect(() => { const h = (e: Event) => setLive((e as CustomEvent<{ status: RealtimeStatus }>).detail.status); window.addEventListener(REALTIME_STATUS, h); return () => window.removeEventListener(REALTIME_STATUS, h); }, []);

  // §25: a refetch keeps the previous values on screen until the new ones arrive (no blank page, no scroll reset)
  const load = useCallback(() => {
    posDashboardApi.getState().then((d) => { setS(d as DashState); setErr(null); setSyncedAt(new Date().toISOString()); }).catch((e: any) => setErr(e?.message || tx('pos.unable_to_load_dashboard')));
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtime('dashboard', load);

  const pickRevRange = useCallback((r: RangeKey) => { setRevRange(r); posDashboardApi.getRevenueTrend(r).then((d) => setRevOverride(d as DashState['revenueTrend'])).catch(() => setRevOverride(null)); }, []);
  const pickSvcRange = useCallback((r: RangeKey) => { setSvcRange(r); posDashboardApi.getTopServices(r).then((d) => setSvcOverride(d as NonNullable<DashState['topServices']>)).catch(() => setSvcOverride(null)); }, []);
  const pickPayRange = useCallback((r: RangeKey) => { setPayRange(r); posDashboardApi.getPaymentMix(r).then((d) => setPayOverride(d as DashState['paymentMix'])).catch(() => setPayOverride(null)); }, []);

  const k = s?.kpis; const ta = s?.todaysAppointments; const wi = s?.walkInStatus;
  const appts = useMemo(() => (s?.calendar?.appointments || []).slice().sort((a, b) => String(a.startTime).localeCompare(String(b.startTime))), [s]);
  const techName = useCallback((id: string) => (s?.calendar?.technicians || []).find((t) => t.id === id)?.displayName || '—', [s]);
  // Live Salon Activity = the server's services in progress. The calendar fallback is only for an older server that
  // does not send the field at all (an EMPTY list means nothing is in progress — it is not filled from the calendar).
  const liveActivity = useMemo(() => {
    if (s?.liveActivity) return s.liveActivity.map((l) => ({ id: `${l.guestName}-${l.startedAt || l.time}`, time: l.startedAt ? fmtTime(l.startedAt) : l.time, customerName: l.guestName, technicianName: l.technicianName, serviceNames: [l.serviceName], status: l.status, elapsedMinutes: l.elapsedMinutes as number | undefined }));
    return appts.filter((a) => isInProgress(a.status)).map((a) => ({ id: a.id, time: fmtTime(a.startTime), customerName: a.customerName, technicianName: techName(a.technicianId), serviceNames: a.serviceNames, status: a.status, elapsedMinutes: undefined as number | undefined }));
  }, [s, appts, techName]);
  const liveTotal = s?.liveActivityTotal ?? liveActivity.length;
  const insights = aiAllowed ? (s?.aiInsights || []) : [];
  const locs = s?.multiLocation || [];
  const techs = s?.topTechnicians || [];
  // rows that fit each card at this density — "+N more" is exactly what is not on screen
  const [laRef, laN] = useFitRows(8, liveActivity.length);
  const [aiRef, aiN] = useFitRows(5, insights.length);
  const [ttRef, ttN] = useFitRows(5, techs.length);
  const [locRef, locN] = useFitRows(6, locs.length);

  const revenue = k?.todayRevenueCents ?? 0;
  const completed = ta?.completed ?? 0;
  const rv = kpiMoney(revenue); const cv = kpiMoney(k?.monthlyCardVolumeCents ?? 0); const av = kpiMoney(k ? (k.averageTicketCents || avgTicketCents(revenue, completed)) : 0);
  const kpiCards = k ? [
    { l: tx('pos.today_s_revenue'), v: rv.v, title: rv.full, d: trendEl(k.todayRevenueTrendPercent), to: '/reports', ic: 'money', tn: '#2E7D32' },
    { l: tx('pos.monthly_card_volume'), v: cv.v, title: cv.full, d: trendOr(k.monthlyCardVolumeTrendPercent, tx('pos.vs_last_month'), tx('ops.liveOps.cardPaymentsMtd')), to: '/tenant/payments/overview', ic: 'card', tn: '#5B4B93' },
    { l: tx('pos.check_ins_today_2'), v: String(k.checkInsToday), d: trendOr(k.checkInsTodayTrendPercent, tx('pos.vs_yesterday'), tx('ops.liveOps.nWaiting', { n: String(wi?.waitingCount ?? 0) })), to: '/check-in', ic: 'usercheck', tn: '#5B4B93' },
    { l: tx('pos.appointments_today'), v: String(k.appointmentsToday || ta?.totalAppointments || 0), d: trendOr(k.appointmentsTodayTrendPercent, tx('pos.vs_yesterday'), tx('ops.liveOps.nRemaining', { n: String(ta?.remaining ?? 0) })), to: '/booking', ic: 'calendar', tn: '#2C5B93' },
    { l: tx('pos.active_services'), v: String(k.servingNow), d: <span className="dsub">{tx('pos.in_progress')}</span>, to: '/serving', ic: 'scissors', tn: '#E0843B' },
    { l: tx('pos.average_ticket'), v: av.v, title: av.full, d: trendOr(k.averageTicketTrendPercent, tx('pos.vs_yesterday'), tx('ops.liveOps.perPaidTicket')), to: '/reports', ic: 'receipt', tn: '#2C5B93' },
    { l: tx('pos.staff_on_duty'), v: `${k.activeTechs}${k.totalTechs ? ` / ${k.totalTechs}` : ''}`, d: <span className="dsub">{onDutyPct(k.activeTechs, k.totalTechs)}{tx('pos.on_duty')}</span>, to: '/technicians', ic: 'people', tn: '#B23B3B' },
    { l: tx('pos.customer_retention'), v: k.customerRetentionPercent ? `${k.customerRetentionPercent}%` : '—', d: trendOr(k.customerRetentionTrendPercent, tx('pos.vs_last_month'), tx('ops.liveOps.returningGuests')), to: '/customers', ic: 'heart', tn: '#E0843B' },
    { l: tx('pos.ai_booking_conversion'), v: k.aiBookingConversionPercent ? `${k.aiBookingConversionPercent}%` : '—', d: trendOr(k.aiBookingConversionTrendPercent, tx('pos.vs_last_month'), tx('ops.liveOps.viaAiAssistant')), to: '/tenant/ai/command-center', ic: 'sparkle', tn: '#C9971B' },
  ] : [];

  const rt = revOverride ?? s?.revenueTrend;
  const series = rt?.series || [];
  const maxRev = Math.max(1, ...series.map((p) => p.valueCents));
  const maxAppt = Math.max(1, ...series.map((p) => p.apptCount));
  // §12: the chart draws into whatever height its grid row gives it (viewBox + preserveAspectRatio none) — no 300 px canvas
  const W = 560, H = 120;
  const xAt = (i: number) => (series.length <= 1 ? 0 : (i / (series.length - 1)) * W);
  const revPts = series.map((p, i) => `${xAt(i).toFixed(1)},${(H - (p.valueCents / maxRev) * (H - 14) - 5).toFixed(1)}`);
  const apptPts = series.map((p, i) => `${xAt(i).toFixed(1)},${(H - (p.apptCount / maxAppt) * (H - 14) - 5).toFixed(1)}`);
  const areaPath = revPts.length ? `M0,${H} L${revPts.join(' L')} L${W},${H} Z` : '';
  const revLine = revPts.length ? `M${revPts.join(' L')}` : '';
  const apptLine = apptPts.length ? `M${apptPts.join(' L')}` : '';

  const payMix = payOverride ?? s?.paymentMix;
  const payEntries = payMix?.entries || [];
  const payTotal = payEntries.reduce((n, e) => n + e.amountCents, 0);
  const ring = (segs: { pct: number; c: string }[]) => { let acc = 0; return `conic-gradient(${segs.map((g) => { const st = acc; acc += g.pct; return `${g.c} ${st}% ${acc}%`; }).join(', ') || '#F1E9DB 0 100%'})`; };
  const topSvc = svcOverride ?? s?.topServices ?? [];
  const svcTotal = topSvc.reduce((n, x) => n + x.revenueCents, 0);
  const SVC_COLOR = ['#C9971B', '#E0843B', '#2E7D32', '#2C5B93', '#B23B3B', '#5B4B93'];
  const ret = s?.customerRetention;
  const ops = s?.operationsSnapshot;
  const stars = (r?: number | null) => (r == null ? '—' : '★ ' + r.toFixed(1));
  const loading = <div className="sk sk-fill" />;
  const legend = (rows: { k: string; c: string; l: string; pct: number; amt?: string }[], max = 3) => (
    <ul className="legend">{rows.slice(0, max).map((r) => <li key={r.k} title={r.amt ? `${r.l} · ${r.amt}` : r.l}><span className="lg" style={{ background: r.c }} />{r.l} {r.pct}%</li>)}{rows.length > max ? <li className="lg-more">{tx('ops.overview.moreCount', { count: String(rows.length - max) })}</li> : null}</ul>
  );
  const QA: [string, string, string][] = [
    // §15 / §25: every action opens its real flow — Start Service the queue filtered to guests ready for a technician (it
    // opened the Serving board, where nothing can be started), Assign Tech the queue's assign sheet, Add Product the add form
    [tx('pos.new_check_in'), '/check-in', 'M6 7.6A2.2 2.2 0 1 0 6 3.2a2.2 2.2 0 0 0 0 4.4Z M2.4 13c0-2.2 1.7-3.5 3.6-3.5 M10.6 8.2v3.4 M8.9 9.9h3.4'],
    [tx('pos.new_booking_2'), '/booking', 'M3 4.4h10v8.6H3Z M3 6.9h10 M5.6 2.8v2 M10.4 2.8v2 M8 8.6v2.6 M6.7 9.9h2.6'],
    [tx('pos.walk_in'), '/booking/walk-in', 'M9.2 2.6H4.6v10.8h4.6 M7 8h6 M11 6l2 2-2 2'],
    [tx('pos.assign_tech'), '/queue?assign=1', 'M6 7.2A2 2 0 1 0 6 3.2a2 2 0 0 0 0 4Z M2.3 12.6c0-2 1.5-3.3 3.3-3.3 M10.6 7.3a1.8 1.8 0 1 0 0-3.6 M9.5 9.4c2 0 3.4 1.3 3.4 3.2'],
    [tx('pos.start_service'), '/queue?status=ready_for_tech', 'M5.5 3.5l7 4.5-7 4.5Z'],
    [tx('pos.take_payment'), '/checkout', 'M2.6 4.4h10.8v7.2H2.6Z M2.6 7h10.8'],
    [tx('pos.send_message'), '/messages', 'M2.8 3.6h10.4v7H6l-3.2 2.4Z'],
    [tx('pos.add_product_3'), '/tenant/inventory?add=1', 'M2.4 5.4 8 2.3l5.6 3.1v5.2L8 13.7l-5.6-3V5.4Z M8 8.5v5.2 M2.6 5.5 8 8.5l5.4-3'],
    [tx('pos.view_reports'), '/reports', 'M3 13V8 M7 13V4 M11 13V6 M2 13.4h11'],
  ];
  const tile = (label: string, value: string | number, sub: string, ic: string, color: string, to: string, bad = false) => (
    <button className="lo-tile" onClick={() => nav(to)}><span className="lo-tile-ic" style={{ color }}><KIcon k={ic} /></span>
      <span className="lo-tile-l">{label}</span><span className={`lo-tile-v${bad ? ' bad' : ''}`}>{value}</span><span className="lo-tile-s">{sub}</span></button>
  );

  return (
    <div className="work ov live-ops-page" data-testid="live-ops-page">
      {/* KPI strip (9) — one row (§8) */}
      <div className="ov-kpis" data-testid="live-ops-kpis">
        {(k ? kpiCards : Array.from({ length: 9 })).map((c: any, i) => (
          <button key={i} className="ov-kpi" onClick={() => c && nav(c.to)} disabled={!k} title={c?.title}>
            {k ? (<><div className="kc"><span className="ki" style={{ color: c.tn }}><KIcon k={c.ic} /></span><span className="kl">{c.l}</span></div>
              <div className="kv">{c.v}</div><div className="kd">{c.d}</div></>) : <div className="sk sk-kpi" />}
          </button>
        ))}
      </div>
      {err ? <div role="alert" className="ov-toast"><span>{err}</span><button className="mini" onClick={load}>{tx('pos.retry')}</button></div> : null}

      {/* Row 1 — Operations snapshot · Live salon activity · AI insights (§9–§11) */}
      <div className="ov-grid ov-3 lo-row1">
        <Card testId="lo-snapshot" title={tx('pos.today_s_operations_snapshot')} right={<span className="live" data-testid="live-ops-live" data-live={live} style={{ color: LIVE_TONE[live] }}>● {tx(`payment.board.live.${live}`)}{syncedAt ? <span className="sub" data-testid="live-ops-synced"> · {tx('ops.liveOps.updatedAt', { t: fmtTime(syncedAt) })}</span> : null}
          <button type="button" className="fk-link" onClick={load} aria-label={tx('ops.liveOps.refresh')} title={tx('ops.liveOps.refresh')} data-testid="live-ops-refresh">↻</button></span>}>
          {!s ? loading : (
            <div className="lo-tiles">
              {tile(tx('pos.waiting_guests'), ops?.waitingGuests ?? 0, `${tx('pos.est_wait')} ${ops?.estWaitMinutes ?? 0} ${tx('pos.min')}`, 'people', '#5B4B93', '/queue')}
              {tile(tx('pos.walk_ins'), ops?.walkInsToday ?? 0, `${ops?.walkInPercent ?? 0}${tx('pos.of_check_ins')}`, 'walkin', '#2C5B93', '/check-in')}
              {tile(tx('pos.ready_for_checkout'), ops?.readyCheckout ?? 0, `${tx('pos.est_2')} ${money(ops?.readyCheckoutValueCents ?? 0)}`, 'card', '#E0843B', '/checkout')}
              {tile(tx('pos.completed_services'), ops?.completedServices ?? 0, tx('pos.today_so_far'), 'check', '#2E7D32', '/service-done')}
              {tile(tx('pos.no_shows'), ops?.noShows ?? 0, `${ops?.noShowPercent ?? 0}${tx('pos.of_bookings')}`, 'alert', '#B23B3B', '/booking', true)}
              {tile(tx('pos.upcoming_bookings'), ops?.upcomingNext3h ?? 0, tx('pos.next_3_hours_2'), 'calendar', '#2C5B93', '/booking')}
            </div>
          )}
        </Card>

        <Card testId="lo-activity" title={tx('pos.live_salon_activity')} bodyRef={laRef} right={<span className="badge-soft">{liveTotal} {tx('pos.in_progress')}</span>}
          foot={<><More shown={Math.min(liveActivity.length, laN)} total={liveTotal} /><button className="ov-more" onClick={() => nav('/serving')}>{tx('pos.view_all_4')}</button></>}>
          {!s ? loading : liveActivity.length === 0 ? <Empty msg={tx('pos.no_services_currently_in_progress')} /> : (
            <table className="ov-tbl lo-tbl"><thead><tr><th>{tx('pos.guest')}</th><th>{tx('pos.technician')}</th><th>{tx('pos.service_3')}</th><th className="t-num">{tx('pos.elapsed')}</th><th className="t-pill">{tx('pos.status')}</th></tr></thead>
              <tbody>{liveActivity.slice(0, laN).map((a) => (
                <tr key={a.id}>
                  <td className="t-name" title={a.customerName}>{a.customerName}</td>
                  <td className="t-mut" title={a.technicianName}>{a.technicianName}</td>
                  <td className="t-mut" title={a.serviceNames?.[0]}>{a.serviceNames?.[0] || '—'}</td>
                  <td className="t-mut t-num">{a.elapsedMinutes != null ? tx('pos.elapsedminutes_min', { elapsedMinutes: String(a.elapsedMinutes) }) : '—'}</td>
                  <td className="t-pill"><Pill s={a.status} /></td>
                </tr>
              ))}</tbody></table>
          )}
        </Card>

        <Card testId="lo-ai" title={tx('pos.ai_insights')} bodyRef={aiRef} right={<span className="badge-soft purple">{tx('pos.new')}</span>}
          foot={aiAllowed ? <><More shown={Math.min(insights.length, aiN)} total={insights.length} /><button className="ov-more" onClick={() => nav('/tenant/ai/command-center')}>{tx('pos.view_all_4')}</button></> : undefined}>
          {!aiAllowed ? (
            <div className="ov-lock"><p>{tx('pos.ai_insights_require_an_active_ai_p8rn')}</p><button className="btn primary" onClick={() => nav('/tenant/account/overview')}>{tx('pos.browse_ai_packages')}</button></div>
          ) : !s ? loading : insights.length === 0 ? <Empty msg={tx('pos.no_ai_insights_right_now')} /> : (
            <ul className="insights">{insights.slice(0, aiN).map((it) => { const txt = aiInsightText(it); return (
              <li className={`ins ${it.tone}`} key={it.id}>
                <span className="ins-dot" aria-hidden /><div className="ins-txt"><div className="ins-t" title={txt.primary}>{txt.primary}</div><div className="ins-v" title={txt.secondary}>{txt.secondary}</div></div>
                {it.action ? <button className="mini" onClick={() => nav(insightRoute(it.action!.kind))}>{txt.action ?? it.action.label}</button> : null}
              </li>
            ); })}</ul>
          )}
        </Card>
      </div>

      {/* Row 2 — Revenue & appointments trend · Top technicians (§12–§13) */}
      <div className="ov-grid lo-row2">
        <Card testId="lo-trend" title={tx('pos.revenue_appointments_trend')} right={<span className="lo-hr"><span className="dlegend"><span><i className="lg-rev" />{tx('pos.revenue')}</span><span><i className="lg-appt" />{tx('pos.appointments')}</span></span>{rt?.explain ? <button type="button" className="fk-link" onClick={() => setWhyOpen(true)} aria-label={tx('ops.liveOps.trend.whyAria')} data-testid="lo-trend-why">{tx('ops.liveOps.trend.why')}</button> : null}<PeriodDropdown value={revRange} onChange={pickRevRange} /></span>}
          foot={series.length ? <div className="lo-trend-sum">
            <span>{tx('pos.total_revenue')} <b>{money(rt?.totalCents)}</b></span>
            <span>{tx('pos.appointments')} <b>{series.reduce((a, x) => a + x.apptCount, 0)}</b></span>
            {rt?.explain ? <span title={tx('ops.liveOps.trend.vsPrev', { days: String(rt.explain.days) })} data-testid="lo-trend-change">{tx('pos.trend')} <b className={(rt.explain.changePercent ?? 0) >= 0 ? 'up' : 'dn'}>{rt.explain.changePercent == null ? '—' : `${rt.explain.changePercent >= 0 ? '+' : ''}${rt.explain.changePercent}%`}</b></span>
              : <span>{tx('pos.trend')} <b className={rt && rt.trendPercent >= 0 ? 'up' : 'dn'}>{rt ? (rt.trendPercent >= 0 ? '+' : '') + rt.trendPercent : 0}%</b></span>}
          </div> : undefined}>
          {!s ? loading : series.length === 0 ? <Empty msg={tx('pos.no_revenue_or_appointments_yet')} /> : (
            <div className="lo-chart">
              <svg viewBox={`0 0 ${W} ${H}`} className="lo-svg" preserveAspectRatio="none" aria-hidden>
                <defs><linearGradient id="rgrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#E8843B" stopOpacity="0.30" /><stop offset="100%" stopColor="#E8843B" stopOpacity="0.02" /></linearGradient></defs>
                <path d={areaPath} fill="url(#rgrad)" />
                <path d={revLine} fill="none" stroke="#E0843B" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
                <path d={apptLine} fill="none" stroke="#2C5B93" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
              </svg>
              <div className="lo-x">{series.map((p, i) => <span key={i}>{p.date ? (rt?.period === 'month' ? fmtYmd(p.date, { day: 'numeric' }, p.label) : fmtYmd(p.date, { weekday: 'short' }, p.label)) : p.label}</span>)}</div>
            </div>
          )}
        </Card>

        <Card testId="lo-techs" title={tx('pos.top_technicians_today')} bodyRef={ttRef} right={<span className="sub">{tx('pos.today_2')}</span>}
          foot={<><More shown={Math.min(techs.length, ttN)} total={techs.length} /><button className="ov-more" onClick={() => nav('/reports')}>{tx('ops.liveOps.viewLeaderboard')}</button></>}>
          {!s ? loading : techs.length === 0 ? <Empty msg={tx('pos.no_technician_performance_data_yet')} /> : (
            <table className="ov-tbl lo-tbl"><thead><tr><th>{tx('pos.technician')}</th><th className="t-num">{tx('pos.revenue')}</th><th className="t-num">{tx('pos.svc')}</th><th className="t-num">{tx('pos.util')}</th><th className="t-num">{tx('pos.tips')}</th><th className="t-num">{tx('pos.rating')}</th></tr></thead>
              <tbody>{techs.slice(0, ttN).map((t) => (
                <tr key={t.technicianId || t.name}>
                  <td className="t-name" title={t.name}>{t.name}</td>
                  <td className="t-num">{moneyK(t.revenueCents)}</td>
                  <td className="t-mut t-num">{t.servicesCount ?? 0}</td>
                  <td className="t-mut t-num">{t.utilizationPercent != null ? `${t.utilizationPercent}%` : '—'}</td>
                  <td className="t-mut t-num">{t.tipsCents != null ? moneyK(t.tipsCents) : '—'}</td>
                  <td className="t-num drate">{stars(t.rating)}</td>
                </tr>
              ))}</tbody></table>
          )}
        </Card>
      </div>

      {/* Row 3 — Top services · Customer retention · Payment mix · Multi-location (§14) */}
      <div className="ov-grid ov-4 lo-row3">
        <Card testId="lo-services" title={tx('pos.top_services_today')} right={<PeriodDropdown value={svcRange} onChange={pickSvcRange} />}
          foot={<button className="ov-more" onClick={() => nav('/reports')}>{tx('ops.liveOps.viewServiceReports')}</button>}>
          {!s ? loading : topSvc.length === 0 ? <Empty msg={tx('pos.no_service_sales_yet')} /> : (
            <div className="donut-wrap"><div className="donut" style={{ background: ring(topSvc.map((sv, i) => ({ pct: svcTotal > 0 ? (sv.revenueCents / svcTotal) * 100 : 0, c: SVC_COLOR[i % SVC_COLOR.length] }))) }} title={money(svcTotal)}><div className="donut-hole sm">{hubMoney(svcTotal)}</div></div>
              {legend(topSvc.map((sv, i) => ({ k: sv.name, c: SVC_COLOR[i % SVC_COLOR.length], l: sv.name, pct: svcTotal > 0 ? Math.round((sv.revenueCents / svcTotal) * 100) : 0, amt: money(sv.revenueCents) })))}</div>
          )}
        </Card>
        <Card testId="lo-retention" title={tx('pos.customer_retention')} right={<span className="sub">{tx('pos.this_month_3')}</span>}
          foot={<button className="ov-more" onClick={() => nav('/customers')}>{tx('ops.liveOps.viewRetentionReport')}</button>}>
          {!s ? loading : !ret || ret.totalCustomers === 0 ? <Empty msg={tx('pos.no_customer_retention_data_yet')} /> : (
            <div className="donut-wrap"><div className="donut" style={{ background: ring([{ pct: ret.returningPercent, c: '#2C5B93' }, { pct: ret.newPercent, c: '#C9971B' }, { pct: ret.inactivePercent, c: '#B23B3B' }]) }}><div className="donut-hole">{Math.round(ret.returningPercent)}%</div></div>
              {legend([{ k: 'r', c: '#2C5B93', l: tx('pos.returning'), pct: ret.returningPercent, amt: String(ret.returningCount) }, { k: 'n', c: '#C9971B', l: tx('pos.new'), pct: ret.newPercent, amt: String(ret.newCount) }, { k: 'i', c: '#B23B3B', l: tx('pos.inactive_2'), pct: ret.inactivePercent, amt: String(ret.inactiveCount) }])}</div>
          )}
        </Card>
        <Card testId="lo-paymix" title={tx('pos.payment_mix')} right={<PeriodDropdown value={payRange} onChange={pickPayRange} />}
          foot={<button className="ov-more" onClick={() => nav('/tenant/payments/overview')}>{tx('ops.liveOps.viewPaymentCenter')}</button>}>
          {!s ? loading : payEntries.length === 0 ? <Empty msg={tx('pos.no_payments_yet')} /> : (
            <div className="donut-wrap"><div className="donut" style={{ background: ring(payEntries.map((e) => ({ pct: payTotal > 0 ? (e.amountCents / payTotal) * 100 : 0, c: PAY_COLOR[e.method] || '#8A7A66' }))) }} title={money(payTotal)}><div className="donut-hole sm">{hubMoney(payTotal)}</div></div>
              {legend(payEntries.map((e) => ({ k: e.method, c: PAY_COLOR[e.method] || '#8A7A66', l: statusLabel('paymentMethod', e.method), pct: e.percent, amt: money(e.amountCents) })))}</div>
          )}
        </Card>
        <Card testId="lo-locations" title={tx('pos.multi_location_snapshot')} bodyRef={locRef} right={<span className="sub">{tx('pos.today_2')}</span>}
          foot={<><More shown={Math.min(locs.length, locN)} total={locs.length} /><button className="ov-more" onClick={() => nav('/tenant/management/locations')}>{tx('ops.liveOps.viewAllLocations')}</button></>}>
          {!s ? loading : locs.length === 0 ? <Empty msg={tx('pos.single_location_no_branch_breakdown')} /> : (
            <ul className="rank lo-locs">{locs.slice(0, locN).map((loc) => (
              <li key={loc.branchId}><span className="rk-n" title={loc.branchName}>{loc.branchName}</span><span className="rk-v">{money(loc.revenueCents)}<span className={`rk-sub ${loc.trendPercent >= 0 ? 'up' : 'dn'}`}>{loc.trendPercent >= 0 ? '▲' : '▼'} {Math.abs(loc.trendPercent)}%</span></span></li>
            ))}</ul>
          )}
        </Card>
      </div>

      {whyOpen && rt?.explain ? <FitDialog title={tx('ops.liveOps.trend.whyTitle')} onClose={() => setWhyOpen(false)} testId="lo-trend-why-dialog"><TrendWhyBody e={rt.explain} /></FitDialog> : null}

      {/* Quick Actions (9) — one row, always visible (§15) */}
      <div className="ov-qa" data-testid="live-ops-quick-actions">
        <div className="qa-h">{tx('pos.quick_actions_2')}</div>
        <div className="qa-row">
          {QA.map(([l, to, d]) => { const g = quickActionGate(to, can); const why = g.ok ? undefined : tx('ops.qa.needsPermission', { p: g.missing.join(', ') }); return (<button key={l} className="qa-btn" disabled={!g.ok} aria-disabled={!g.ok} title={why} aria-description={why} data-testid={'qa-' + to} onClick={() => { if (g.ok) nav(to); }}><span className="qa-ic"><svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg></span><span className="qa-l">{l}</span>{why ? <span className="qa-why" data-testid="qa-why">{tx('ops.qa.locked')}</span> : null}</button>); })}
        </div>
      </div>
    </div>
  );
}
