import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Donut, NotConnected } from './_chartkit';
import { fetchAppointmentOversight, type AppointmentOversight, type AoKpi } from '../api/superAdminAppointmentOversightApi';

// AppointmentOversightScreen — Super Admin › Operations Oversight › Appointment Oversight › Overview.
// READ-ONLY platform monitoring of the appointment RECORD + LIFECYCLE across every authorized tenant/branch.
// Data: GET /super-admin/appointment-oversight/overview (real Postgres, composed from platform aggregates).
// Signals the schema does not yet instrument render an honest "—/Not connected" — never fabricated.
// DEV-only ?fixture=1 substitutes the reference values for 1:1 screenshot parity (never ships to prod paths).
// This is deliberately NOT the Booking & Check-In Monitor (/booking-checkin) — a separate module/route.

type Trend = { dir: 'up' | 'down'; pct: string; good: boolean };
const num = (n: number) => n.toLocaleString();
const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString()}`;

type IconName = 'calendar' | 'check' | 'checkCircle' | 'x' | 'userX' | 'copy' | 'overlap' | 'alert' | 'wifi'
  | 'bot' | 'user' | 'calEdit' | 'sync' | 'userAlert' | 'list' | 'db' | 'plug' | 'dollar'
  | 'building' | 'store' | 'usersGroup' | 'customers' | 'today' | 'search' | 'history' | 'escalate' | 'download';

function Ico({ name }: { name: IconName }) {
  const c = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'calendar': return <svg {...c}><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9h18M8 2.5v4M16 2.5v4" /></svg>;
    case 'check': return <svg {...c}><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12 2.5 2.5L16 9.5" /></svg>;
    case 'checkCircle': return <svg {...c}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>;
    case 'x': return <svg {...c}><circle cx="12" cy="12" r="8.5" /><path d="m9 9 6 6M15 9l-6 6" /></svg>;
    case 'userX': return <svg {...c}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19.5c.6-3.2 2.9-5 5.5-5M16 9l4 4M20 9l-4 4" /></svg>;
    case 'copy': return <svg {...c}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M4 16V5a2 2 0 0 1 2-2h9" /></svg>;
    case 'overlap': return <svg {...c}><circle cx="9.5" cy="12" r="6" /><circle cx="14.5" cy="12" r="6" /></svg>;
    case 'alert': return <svg {...c}><path d="M12 4 2.5 20h19L12 4Z" /><path d="M12 10v4M12 17.5v.01" /></svg>;
    case 'wifi': return <svg {...c}><path d="M5 12.5a10 10 0 0 1 14 0M8 16a5 5 0 0 1 8 0M12 19.5v.01" /></svg>;
    case 'bot': return <svg {...c}><rect x="4" y="7" width="16" height="12" rx="3" /><path d="M12 3v4M9 13v.01M15 13v.01" /></svg>;
    case 'user': return <svg {...c}><circle cx="12" cy="8" r="3.4" /><path d="M5 20c.7-3.6 3.3-5.6 7-5.6s6.3 2 7 5.6" /></svg>;
    case 'calEdit': return <svg {...c}><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9h18M8 2.5v4M16 2.5v4M15.5 15.5 13 16l.5-2.5 3-3 2 2-3 3Z" /></svg>;
    case 'sync': return <svg {...c}><path d="M20 11a8 8 0 0 0-14-4M4 13a8 8 0 0 0 14 4M18 3v4h-4M6 21v-4h4" /></svg>;
    case 'userAlert': return <svg {...c}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19.5c.6-3.2 2.9-5 5.5-5M18 8v4M18 15v.01" /></svg>;
    case 'list': return <svg {...c}><path d="M8 6h12M8 12h12M8 18h12M4 6v.01M4 12v.01M4 18v.01" /></svg>;
    case 'db': return <svg {...c}><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" /></svg>;
    case 'plug': return <svg {...c}><path d="M9 3v6M15 3v6M7 9h10v3a5 5 0 0 1-10 0V9ZM12 17v4" /></svg>;
    case 'dollar': return <svg {...c}><circle cx="12" cy="12" r="8.5" /><path d="M14.5 9c-.5-1-1.5-1.4-2.5-1.4-1.4 0-2.3.8-2.3 1.9 0 2.4 4.8 1.3 4.8 3.7 0 1.2-1 1.9-2.5 1.9-1.2 0-2.2-.5-2.6-1.5M12 6v12" /></svg>;
    case 'building': return <svg {...c}><rect x="5" y="3" width="14" height="18" rx="1.5" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" /></svg>;
    case 'store': return <svg {...c}><path d="M4 9 5 4h14l1 5M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9ZM4 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0" /></svg>;
    case 'usersGroup': return <svg {...c}><circle cx="9" cy="9" r="3" /><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6S13.9 16 14.5 19M16 6.5a3 3 0 0 1 0 5.6M21 19c-.4-2-1.4-3.4-3-4.2" /></svg>;
    case 'customers': return <svg {...c}><circle cx="12" cy="8" r="3.4" /><path d="M5 20c.7-3.6 3.3-5.6 7-5.6s6.3 2 7 5.6" /></svg>;
    case 'today': return <svg {...c}><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9h18M8 2.5v4M16 2.5v4" /><circle cx="12" cy="14.5" r="2" /></svg>;
    case 'search': return <svg {...c}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>;
    case 'history': return <svg {...c}><path d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3 2" /></svg>;
    case 'escalate': return <svg {...c}><path d="M12 4v10M7 9l5-5 5 5M5 20h14" /></svg>;
    case 'download': return <svg {...c}><path d="M12 3v12M7 11l5 5 5-5M5 21h14" /></svg>;
  }
}

const TONE: Record<string, { fg: string; bg: string }> = {
  gold: { fg: 'var(--g7)', bg: '#F6ECD6' }, green: { fg: 'var(--ok)', bg: 'var(--ok-bg)' },
  blue: { fg: 'var(--info)', bg: '#E8F1F8' }, red: { fg: 'var(--danger)', bg: '#FBEDEA' },
  amber: { fg: 'var(--warn)', bg: 'var(--warn-bg)' }, purple: { fg: '#7B5BB6', bg: '#F0EAF8' },
  orange: { fg: '#C0762A', bg: '#FBEEDD' },
};
const KPI_META: Record<string, { icon: IconName; tone: string }> = {
  total: { icon: 'calendar', tone: 'gold' }, confirmed: { icon: 'check', tone: 'green' }, completed: { icon: 'checkCircle', tone: 'blue' },
  cancelled: { icon: 'x', tone: 'red' }, no_shows: { icon: 'userX', tone: 'red' }, duplicates: { icon: 'copy', tone: 'purple' },
  overlaps: { icon: 'overlap', tone: 'purple' }, failed_bookings: { icon: 'alert', tone: 'red' }, online_booking_failures: { icon: 'wifi', tone: 'red' },
  ai_created: { icon: 'bot', tone: 'blue' }, staff_created: { icon: 'user', tone: 'green' }, rescheduled: { icon: 'calEdit', tone: 'blue' },
  sync_failures: { icon: 'sync', tone: 'red' }, missing_customer: { icon: 'userAlert', tone: 'amber' }, missing_service: { icon: 'list', tone: 'amber' },
  data_integrity: { icon: 'db', tone: 'red' }, external_errors: { icon: 'plug', tone: 'orange' }, appointment_value: { icon: 'dollar', tone: 'green' },
};

const FIX_TREND: Record<string, Trend> = {
  total: { dir: 'up', pct: '12.4%', good: true }, confirmed: { dir: 'up', pct: '10.2%', good: true }, completed: { dir: 'up', pct: '9.8%', good: true },
  cancelled: { dir: 'down', pct: '8.6%', good: false }, no_shows: { dir: 'down', pct: '6.3%', good: false }, duplicates: { dir: 'down', pct: '12.1%', good: false },
  overlaps: { dir: 'down', pct: '9.4%', good: false }, failed_bookings: { dir: 'down', pct: '14.8%', good: false }, online_booking_failures: { dir: 'down', pct: '11.5%', good: false },
  ai_created: { dir: 'up', pct: '15.2%', good: true }, staff_created: { dir: 'up', pct: '11.3%', good: true }, rescheduled: { dir: 'up', pct: '9.1%', good: true },
  sync_failures: { dir: 'down', pct: '13.3%', good: false }, missing_customer: { dir: 'down', pct: '7.6%', good: false }, missing_service: { dir: 'down', pct: '7.2%', good: false },
  data_integrity: { dir: 'down', pct: '10.0%', good: false }, external_errors: { dir: 'down', pct: '12.5%', good: false }, appointment_value: { dir: 'up', pct: '22.5%', good: true },
};
const FIX_KPI: Record<string, number> = {
  total: 12846, confirmed: 8942, completed: 7624, cancelled: 1248, no_shows: 614, duplicates: 128,
  overlaps: 96, failed_bookings: 312, online_booking_failures: 84, ai_created: 2146, staff_created: 10700, rescheduled: 1032,
  sync_failures: 52, missing_customer: 156, missing_service: 142, data_integrity: 37, external_errors: 28, appointment_value: 12876400,
};
const FIX_STATUS = { available: true, total: 12846, slices: [
  { label: 'Confirmed', value: 8942, pct: 69.6 }, { label: 'Completed', value: 7264, pct: 19.4 }, { label: 'Cancelled', value: 1248, pct: 9.7 },
  { label: 'No-Shows', value: 614, pct: 4.8 }, { label: 'Other Issues', value: 418, pct: 3.3 },
] };
const FIX_SOURCE = { available: true, total: 12846, bars: [
  { label: 'Online Booking', value: 5642, pct: 43.9 }, { label: 'AI Receptionist', value: 2146, pct: 16.7 }, { label: 'Staff (Front Desk)', value: 3782, pct: 29.4 },
  { label: 'Staff (Tech App)', value: 1104, pct: 8.6 }, { label: 'Walk-In Added', value: 172, pct: 1.3 },
] };
const FIX_TREND_SERIES = {
  dates: ['Apr 30', 'May 1', 'May 2', 'May 3', 'May 4', 'May 5', 'May 6'],
  total: [7200, 8400, 7900, 8600, 8200, 8700, 8000], completed: [4600, 5200, 4900, 5300, 5000, 5400, 5100],
  cancelled: [900, 1100, 1000, 1150, 1050, 1200, 1080], noShows: [520, 640, 600, 660, 610, 680, 620],
};
// the submodule that investigates each issue type (the row's "View issue")
const ISSUE_ROUTE: Record<string, string> = {
  'Failed Booking': '/appointment-oversight/failures', 'Duplicate Appointment': '/appointment-oversight/duplicates',
  'Overlapping Appointment': '/appointment-oversight/overlapping', 'Sync Failure': '/appointment-oversight/sync-failures',
  'Missing Customer Info': '/appointment-oversight/missing-info',
};
const FIX_ISSUES = [
  { issueType: 'Failed Booking', appointmentId: 'APT-250506-00125', customer: 'Emma Johnson', tenantBranch: 'Glamour Studio / Downtown', dateTime: 'May 06, 2026 2:30 PM', technician: 'N/A', source: 'Online Booking', status: 'Failed', severity: 'critical' },
  { issueType: 'Duplicate Appointment', appointmentId: 'APT-250505-00987', customer: 'Michael Thompson', tenantBranch: 'Luxe Salon & Spa / Main', dateTime: 'May 05, 2026 11:00 AM', technician: 'Sarah J.', source: 'Staff (Front Desk)', status: 'Open', severity: 'high' },
  { issueType: 'Overlapping Appointment', appointmentId: 'APT-250505-00765', customer: 'Priya Patel', tenantBranch: 'The Hair Lounge / City Center', dateTime: 'May 05, 2026 3:00 PM', technician: 'David L.', source: 'Staff (Tech App)', status: 'Open', severity: 'high' },
  { issueType: 'Sync Failure', appointmentId: 'APT-250505-00432', customer: 'Jennifer Lee', tenantBranch: 'Elite Cuts / Uptown', dateTime: 'May 05, 2026 9:15 AM', technician: 'N/A', source: 'AI Receptionist', status: 'Investigating', severity: 'medium' },
  { issueType: 'Missing Customer Info', appointmentId: 'APT-250504-00321', customer: 'Unknown', tenantBranch: 'Radiant Beauty / West End', dateTime: 'May 04, 2026 1:45 PM', technician: 'Anna M.', source: 'Online Booking', status: 'Open', severity: 'medium' },
];
const FIX_SUMMARY: Record<string, number> = { 'Total Tenants': 2418, 'Active Branches': 3317, 'Active Technicians': 12746, 'Total Customers': 1284741, "Today's Appointments": 1248, "Today's Revenue": 12876400 };

const ISSUE_TONE: Record<string, string> = { Failed: 'red', Open: 'amber', Investigating: 'blue', Resolved: 'green', Escalated: 'purple', Retrying: 'blue', Closed: 'green', Acknowledged: 'blue' };
const TREND_COLORS = { total: 'var(--info)', completed: 'var(--ok)', cancelled: 'var(--danger)', noShows: 'var(--g7)' };

function MultiLine({ dates, series, height = 200 }: { dates: string[]; series: { key: string; color: string; vals: number[] }[]; height?: number }) {
  if (!dates.length) return <div className="state" style={{ fontSize: 12 }}>No appointment trend data yet.</div>;
  const W = 560, H = height, padL = 34, padR = 12, padT = 14, padB = 26;
  const max = Math.max(1, ...series.flatMap((s) => s.vals));
  const x = (i: number) => padL + (i * (W - padL - padR)) / Math.max(1, dates.length - 1);
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  const ticks = 4;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Appointments trend: total, completed, cancelled, no-shows">
      {Array.from({ length: ticks + 1 }, (_, ti) => { const gy = padT + (ti * (H - padT - padB)) / ticks; const val = Math.round(max * (1 - ti / ticks)); return (
        <g key={ti}><line x1={padL} y1={gy} x2={W - padR} y2={gy} stroke="var(--line)" strokeWidth="1" /><text x={padL - 6} y={gy + 3} textAnchor="end" fontSize="9" fill="var(--muted)">{val >= 1000 ? `${Math.round(val / 1000)}K` : val}</text></g>); })}
      {dates.map((d, i) => <text key={d} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9.5" fill="var(--soft)">{d}</text>)}
      {series.map((s) => (
        <g key={s.key}>
          <polyline fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={s.vals.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
          {s.vals.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="2.6" fill="#FFFCF6" stroke={s.color} strokeWidth="1.6" />)}
        </g>
      ))}
    </svg>
  );
}

export function AppointmentOversightScreen() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const fixture = import.meta.env.DEV && sp.get('fixture') === '1';   // dev-server aid only (SCAN, Oct 12)
  const [data, setData] = useState<AppointmentOversight | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [issueTab, setIssueTab] = useState<'all' | 'failed' | 'duplicates' | 'overlapping' | 'sync' | 'missing'>('all');
  const [lastOk, setLastOk] = useState<Date | null>(null);
  const inflight = useRef(false);

  const load = async (isRefresh = false) => {
    if (inflight.current) return; inflight.current = true;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try { const d = await fetchAppointmentOversight(); setData(d); setLastOk(new Date()); setError(null); }
    catch (e: any) { if (!data) setError(e?.message || 'Failed to load Appointment Oversight.'); }
    finally { setLoading(false); setRefreshing(false); inflight.current = false; }
  };
  useEffect(() => { void load();   }, []);

  const kpiValue = (k: AoKpi): { text: string; gap: boolean } => {
    if (fixture) { const v = FIX_KPI[k.key]; return { text: k.financial ? money(v) : num(v), gap: false }; }
    if (!k.available || k.value == null) return { text: '—', gap: true };
    return { text: k.financial ? money(k.value) : num(k.value), gap: false };
  };
  const kpiTrend = (k: AoKpi): Trend | null => (fixture ? FIX_TREND[k.key] ?? null : null);

  const handleExport = () => {
    const rows = (data?.kpis ?? []).map((k) => `${k.label},${k.available && k.value != null ? k.value : ''}`);
    const csv = ['Metric,Value', ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `appointment-oversight-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  if (error) return <div className="work"><div className="state">{error} <button className="linkbtn" onClick={() => void load()}>Retry</button></div></div>;
  if (loading || !data) return <div className="work"><div className="state">Loading Appointment Oversight…</div></div>;

  const ps = data.platformSummary;
  const statusDist = fixture ? FIX_STATUS : data.statusDistribution;
  const sourceDist = fixture ? FIX_SOURCE : data.sourceDistribution;
  const trendDates = fixture ? FIX_TREND_SERIES.dates : data.trend.dates;
  const trendSeries = fixture
    ? [{ key: 'total', color: TREND_COLORS.total, vals: FIX_TREND_SERIES.total }, { key: 'completed', color: TREND_COLORS.completed, vals: FIX_TREND_SERIES.completed }, { key: 'cancelled', color: TREND_COLORS.cancelled, vals: FIX_TREND_SERIES.cancelled }, { key: 'noShows', color: TREND_COLORS.noShows, vals: FIX_TREND_SERIES.noShows }]
    : [{ key: 'total', color: TREND_COLORS.total, vals: data.trend.series.total }, { key: 'completed', color: TREND_COLORS.completed, vals: data.trend.series.completed }, { key: 'cancelled', color: TREND_COLORS.cancelled, vals: data.trend.series.cancelled }, { key: 'noShows', color: TREND_COLORS.noShows, vals: data.trend.series.noShows }];
  const issues = fixture ? FIX_ISSUES : data.recentIssues.rows;
  const tabs = data.recentIssues.tabs;

  // SCAN (Oct 12): the overview endpoint takes only the tenant scope (the top-bar selector). These pills show what the
  // numbers cover and are disabled — filter by status / source / text in the Search submodule ("More Filters").
  const range = trendDates.length ? `${trendDates[0]} – ${trendDates[trendDates.length - 1]}` : 'Overview window';
  const filters: { label: string; value: string }[] = [
    { label: 'Date Range', value: range }, { label: 'Branch', value: 'All Branches' }, { label: 'Tenant', value: data.scope?.label === 'platform' || !data.scope?.tenantId ? 'All Tenants' : data.scope.label },
    { label: 'Service', value: 'All Services' }, { label: 'Technician', value: 'All Technicians' }, { label: 'Source', value: 'All Sources' },
  ];
  const quickActions: { icon: IconName; title: string; sub: string; onClick: () => void }[] = [
    { icon: 'search', title: 'Search Appointment', sub: 'Find any appointment across all salons', onClick: () => nav('/appointment-oversight/search') },
    { icon: 'history', title: 'Review Booking History', sub: 'View full appointment history', onClick: () => nav('/appointment-oversight/change-history') },
    { icon: 'copy', title: 'Identify Duplicates', sub: 'Find and review duplicate bookings', onClick: () => nav('/appointment-oversight/duplicates') },
    { icon: 'sync', title: 'Retry Failed Synchronization', sub: 'Open the synchronization-failures view', onClick: () => nav('/appointment-oversight/sync-failures') },
    { icon: 'escalate', title: 'Escalate to Tenant Support', sub: 'Open the Support Center for this tenant', onClick: () => nav('/support-access') },
    { icon: 'download', title: 'Export Appointment Report', sub: 'Download detailed appointment data', onClick: handleExport },
  ];
  const summaryCards: { icon: IconName; tone: string; label: string; card: { available: boolean; value: number }; to: string; money?: boolean }[] = [
    { icon: 'building', tone: 'gold', label: 'Total Tenants', card: ps.totalTenants, to: '/tenants' },
    { icon: 'store', tone: 'green', label: 'Active Branches', card: ps.activeBranches, to: '/branches' },
    { icon: 'usersGroup', tone: 'blue', label: 'Active Technicians', card: ps.activeTechnicians, to: '/staff' },
    { icon: 'customers', tone: 'purple', label: 'Total Customers', card: ps.totalCustomers, to: '/customer-data-oversight' },
    { icon: 'today', tone: 'gold', label: "Today's Appointments", card: ps.todaysAppointments, to: '/appointment-oversight' },
    { icon: 'dollar', tone: 'green', label: "Today's Revenue", card: ps.todaysRevenueCents, to: '/platform-reports', money: true },
  ];
  const donutColors = ['var(--ok)', 'var(--info)', 'var(--danger)', 'var(--g7)', '#7B5BB6'];
  const srcColors = ['var(--info)', 'var(--ok)', 'var(--g7)', '#7B5BB6', 'var(--danger)'];

  return (
    <div className="work !p-5" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className=" flex flex-col lg:flex-row justify-between gap-3">
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>Appointment Oversight <span style={{ color: 'var(--g7)' }}>★</span></h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>Monitor and support appointments across all tenants and branches.</div>
        </div>
        <div className='self-baseline' style={{ display: 'flex', gap: 8 }}>
          <button className="btn flex justify-center items-center gap-2" onClick={handleExport} aria-label="Export Report"><Ico name="download" /> Export Report</button>
          <button className="btn primary flex justify-center items-center gap-2" disabled title="Dashboard widgets are not customizable yet" aria-label="Add Widget">+ Add Widget</button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {filters.map((f) => (
          <label key={f.label} className='flex gap-2 items-center justify-center'>
            <span className=" text-[12px] font-bold capitalize">{f.label}</span>
            <button className="filterpill border border-[var(--line)] p-1 rounded-md" disabled title="This overview follows the tenant scope selector — use More Filters to search by status, source or text" style={{ justifyContent: 'space-between', opacity: 0.75 }} aria-label={`${f.label}: ${f.value}`}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.value}</span><span style={{ color: 'var(--muted)' }}>▾</span></button>
          </label>
        ))}
        <button className="filterpill" aria-label="More Filters" onClick={() => nav('/appointment-oversight/search')}>⇄ More Filters</button>
        <button className="filterpill" aria-label="Refresh" disabled={refreshing} onClick={() => void load(true)} title={lastOk ? `Last updated ${lastOk.toLocaleTimeString()}` : ''}><span style={{ display: 'inline-block', transform: refreshing ? 'rotate(180deg)' : 'none', transition: 'transform .3s' }}>⟳</span></button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        {data.kpis.map((k) => {
          const meta = KPI_META[k.key] ?? { icon: 'calendar' as IconName, tone: 'gold' };
          const tone = TONE[meta.tone]; const { text, gap } = kpiValue(k); const tr = kpiTrend(k);
          return (
            <div className="card" key={k.key} role="button" tabIndex={0} aria-label={`${k.label}: ${gap ? 'not connected' : text}`}
              onClick={() => nav('/appointment-oversight')} onKeyDown={(e) => { if (e.key === 'Enter') nav('/appointment-oversight'); }}
              style={{ padding: 14, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 92 }}>
              <div style={{ width: 38, height: 38, borderRadius: '50%', background: tone.bg, color: tone.fg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico name={meta.icon} /></div>
              <div className="muted" style={{ fontSize: 11.5, fontWeight: 600 }}>{k.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: gap ? 'var(--muted)' : 'var(--text)', lineHeight: 1 }}>{gap ? <NotConnected>—</NotConnected> : text}</div>
              {tr ? <div style={{ fontSize: 11, fontWeight: 600, color: tr.good ? 'var(--ok)' : 'var(--danger)' }}>{tr.dir === 'up' ? '▲' : '▼'} {tr.pct} vs last week</div>
                  : !gap ? <div className="muted" style={{ fontSize: 10.5 }}>vs last week <NotConnected>—</NotConnected></div>
                  : <div className="muted" style={{ fontSize: 10.5 }}>{k.financial ? 'financial access required' : 'not instrumented'}</div>}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1.15fr_1fr_1.15fr] gap-3">
        <section className="panel">
          <div className="phead"><h2 style={{ fontSize: 15 }}>Appointments Trend</h2><span className="filterpill" style={{ fontSize: 11 }}>This Week ▾</span></div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', margin: '4px 0 6px' }}>
            {[['Total Appointments', TREND_COLORS.total], ['Completed', TREND_COLORS.completed], ['Cancelled', TREND_COLORS.cancelled], ['No-Shows', TREND_COLORS.noShows]].map(([l, col]) => (
              <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--soft)' }}><span style={{ width: 16, height: 3, borderRadius: 2, background: col as string }} />{l}</span>
            ))}
          </div>
          <MultiLine dates={trendDates} series={trendSeries} />
        </section>

        <section className="panel">
          <div className="phead"><h2 style={{ fontSize: 15 }}>Appointment Status Distribution</h2></div>
          {statusDist.available ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Donut data={statusDist.slices.map((s) => ({ label: s.label, value: s.value }))} centerLabel={`${num(statusDist.total)}\nTotal`} hideLegend />
              <div className="legend" style={{ flex: 1 }}>
                {statusDist.slices.map((s, i) => (
                  <div className="li" key={s.label}><span className="sw" style={{ background: donutColors[i % donutColors.length] }} /><span>{s.label}</span><span className="va">{num(s.value)} ({s.pct}%)</span></div>
                ))}
              </div>
            </div>
          ) : <div className="state" style={{ fontSize: 12 }}>No status data yet.</div>}
        </section>

        <section className="panel">
          <div className="phead"><h2 style={{ fontSize: 15 }}>Appointments by Source</h2><span className="filterpill" style={{ fontSize: 11 }}>This Week ▾</span></div>
          {sourceDist.bars.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 6 }}>
              {sourceDist.bars.map((b, i) => { const maxV = Math.max(1, ...sourceDist.bars.map((x) => x.value)); return (
                <div key={b.label} role="button" tabIndex={0} onClick={() => nav('/appointment-oversight')} onKeyDown={(e) => { if (e.key === 'Enter') nav('/appointment-oversight'); }} style={{ cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 3 }}><span style={{ color: 'var(--soft)' }}>{b.label}</span><span style={{ fontWeight: 700 }}>{num(b.value)} ({b.pct}%)</span></div>
                  <div style={{ height: 10, background: 'var(--cream2)', borderRadius: 6, overflow: 'hidden' }}><div style={{ width: `${Math.max(2, (b.value / maxV) * 100)}%`, height: '100%', background: srcColors[i % srcColors.length], borderRadius: 6 }} /></div>
                </div>); })}
            </div>
          ) : <div className="state" style={{ fontSize: 12 }}>No source data yet.</div>}
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.9fr_1fr] gap-3">
        <section className="panel">
          <div className="phead"><h2 style={{ fontSize: 15 }}>Recent Appointment Issues</h2></div>
          <div style={{ overflowX: 'auto', display: 'flex', gap: 14, borderBottom: '1px solid var(--line)', margin: '4px 0 8px', fontSize: 12.5 }}>
            {([['all', 'All Issues'], ['failed', 'Failed Bookings'], ['duplicates', 'Duplicates'], ['overlapping', 'Overlapping'], ['sync', 'Sync Failures'], ['missing', 'Missing Info']] as const).map(([key, label]) => (
              <button key={key} className='whitespace-nowrap' onClick={() => setIssueTab(key)} style={{ background: 'none', border: 'none', padding: '4px 0', cursor: 'pointer', fontWeight: issueTab === key ? 700 : 500, color: issueTab === key ? 'var(--g7)' : 'var(--soft)', borderBottom: issueTab === key ? '2px solid var(--g7)' : '2px solid transparent' }}>{label}</button>
            ))}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12,minWidth:900 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5, textTransform: 'uppercase' }}>
                {['Issue Type', 'Appointment ID', 'Customer', 'Tenant / Branch', 'Date & Time', 'Technician', 'Source', 'Status', 'Actions'].map((h) => <th key={h} style={{ padding: '6px 8px', fontWeight: 600 }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {issues.length ? issues.map((r) => (
                  <tr key={r.appointmentId} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={{ padding: '8px', color: 'var(--danger)', fontWeight: 600 }}>{r.issueType}</td>
                    <td style={{ padding: '8px', fontVariantNumeric: 'tabular-nums' }}>{r.appointmentId}</td>
                    <td style={{ padding: '8px' }}>{r.customer}</td>
                    <td style={{ padding: '8px' }}>{r.tenantBranch}</td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{r.dateTime}</td>
                    <td style={{ padding: '8px' }}>{r.technician}</td>
                    <td style={{ padding: '8px' }}>{r.source}</td>
                    <td style={{ padding: '8px' }}><span style={{ fontSize: 11, fontWeight: 700, color: TONE[ISSUE_TONE[r.status] ?? 'amber'].fg }}>{r.status}</span></td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }}><button className="iconbtn" aria-label="View issue" onClick={() => nav(ISSUE_ROUTE[r.issueType] ?? '/appointment-oversight/search')}>👁</button></td>
                  </tr>
                )) : (
                  <tr><td colSpan={9} style={{ padding: 16, textAlign: 'center', color: 'var(--muted)' }}>
                    No issue rows to display.{(() => { const parts = [tabs.duplicates.available ? `${tabs.duplicates.count} duplicates` : null, tabs.overlapping.available ? `${tabs.overlapping.count} overlapping` : null, tabs.missingInfo.available ? `${tabs.missingInfo.count} missing-info` : null].filter(Boolean); return parts.length ? ` Detected: ${parts.join(' · ')} — open a submodule to investigate.` : ''; })()}
                    {(issueTab === 'failed' || issueTab === 'sync') && <div style={{ marginTop: 4 }}><NotConnected>{issueTab === 'failed' ? 'Failed-booking event source not instrumented yet' : 'Sync-event source not instrumented yet'}</NotConnected></div>}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, fontSize: 12 }}>
            <span className="muted">Showing 1 to {issues.length} of {fixture ? 25 : issues.length} results</span>
            <button className="linkbtn" onClick={() => setIssueTab('all')}>View All Issues</button>
          </div>
        </section>

        <section className="panel">
          <div className="phead"><h2 style={{ fontSize: 15 }}>Quick Actions</h2></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
            {quickActions.map((a) => (
              <button key={a.title} onClick={a.onClick} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 8px', background: 'none', border: 'none', borderRadius: 8, cursor: 'pointer', textAlign: 'left' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cream2)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}>
                <span style={{ width: 34, height: 34, borderRadius: '50%', background: '#F6ECD6', color: 'var(--g7)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Ico name={a.icon} /></span>
                <span><div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{a.title}</div><div className="muted" style={{ fontSize: 11 }}>{a.sub}</div></span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {summaryCards.map((c) => {
          const tone = TONE[c.tone]; const fin = !!c.money && !c.card.available;
          const text = fixture ? (c.money ? money(FIX_SUMMARY[c.label] ?? 0) : num(FIX_SUMMARY[c.label] ?? 0))
            : fin ? '—' : (c.money ? money(c.card.value) : num(c.card.value));
          return (
            <div className="card" key={c.label} role="button" tabIndex={0} onClick={() => nav(c.to)} onKeyDown={(e) => { if (e.key === 'Enter') nav(c.to); }} style={{ padding: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 38, height: 38, borderRadius: '50%', background: tone.bg, color: tone.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Ico name={c.icon} /></span>
              <span><div className="muted" style={{ fontSize: 11, fontWeight: 600 }}>{c.label}</div><div style={{ fontSize: 19, fontWeight: 800, color: fin ? 'var(--muted)' : 'var(--text)' }}>{fin ? <NotConnected>—</NotConnected> : text}</div></span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
