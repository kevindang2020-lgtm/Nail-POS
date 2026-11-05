import { Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useOverviewAggregate, type OverviewState, type Range, type Severity } from '../api/superAdminOverviewApi';

function formatServiceName(service: any): string {
  if (!service) return '—';
  if (typeof service === 'string') return service || '—';
  if (typeof service === 'object' && service !== null) {
    return service.serviceName || service.name || service.title || service.label || '—';
  }
  return String(service);
}

function formatServicesList(services: any): string {
  if (!services) return '—';
  if (Array.isArray(services)) {
    if (services.length === 0) return '—';
    const names = services.map(formatServiceName).filter((n) => n && n !== '—');
    return names.length > 0 ? names.join(', ') : '—';
  }
  return formatServiceName(services);
}
import { useScope } from '../shell/ScopeContext';
import { AreaLine, Donut, NotConnected, money } from './_chartkit';

// DashboardScreen.tsx — Super Admin › Overview (/dashboard), the platform-level command center, rebuilt 1:1 to the
// reference design: 30 platform KPI cards, Daily Operations Flow, a 4-chart analytics row, a 4-table performance row, a
// 4-widget activity row, Quick Actions, and the At-a-Glance summary. Data is composed from REAL platform endpoints that
// already exist — GET /super-admin/overview/state plus the platform module overviews (staff, queue, check-in,
// memberships, loyalty). Cells with no live source yet render an honest "—" / Not-Connected and are itemised in the
// footer; NO screenshot fixture values are hardcoded as live data. Device, payment-volume, top-service, and upcoming-
// appointment sections are wired in the next pass (super-admin-platform exposes those aggregates).

const moneyM = (c: number | null | undefined) => '$' + Math.round((c || 0) / 100).toLocaleString();
const compact = (n: number | null | undefined) => (n || 0).toLocaleString();
const fmtWait = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`);
const DASH = '—';

const SEV: Record<Severity, string> = { error: 'var(--danger)', warning: 'var(--warn)', success: 'var(--ok)', info: 'var(--info)' };
const sevBadge = (s: Severity) => (s === 'error' ? { background: '#FBEFE9', color: '#B85B4D', label: 'High' } : s === 'warning' ? { background: '#FFF6E5', color: '#D09A36', label: 'Medium' } : s === 'success' ? { background: '#EAF5EE', color: '#3E8F57', label: 'OK' } : { background: '#EAF2FB', color: '#3C7FB6', label: 'Low' });

// Compact line-icon set (tinted-circle KPI badges), keyed by category.
const ICON: Record<string, string> = {
  building: 'M3 21h18M5 21V7l8-4v18M19 21V11l-6-3M9 9v.01M9 12v.01M9 15v.01',
  store: 'M3 9l1.5-5h15L21 9M4 9v11h16V9M9 20v-6h6v6',
  clipboard: 'M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1zM8 6H6v15h12V6h-2M9 12l2 2 4-4',
  ban: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM5 5l14 14',
  device: 'M5 2h14a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM12 18h.01',
  wifi: 'M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01',
  wifioff: 'M2 2l20 20M8.5 15.5a5 5 0 0 1 7 0M12 19h.01',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87',
  tech: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4 8.12 15.88M14.47 14.48 20 20',
  customer: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  calendar: 'M3 4h18v18H3zM16 2v4M8 2v4M3 10h18',
  check: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3',
  checkin: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  scissors: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4 8.12 15.88',
  cart: 'M9 22a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM20 22a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6',
  dollar: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5M12 17h.01',
  queue: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2',
  card: 'M2 7h20v10H2zM2 11h20',
  alertpay: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 8v4M12 16h.01',
  refund: 'M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 7',
  member: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 11l-3 3-2-2',
  revenue: 'M3 3v18h18M7 14l3-3 3 3 5-6',
  gift: 'M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z',
  ai: 'M12 2a3 3 0 0 1 3 3v1a3 3 0 0 1 3 3 3 3 0 0 1 0 6 3 3 0 0 1-3 3v1a3 3 0 0 1-6 0v-1a3 3 0 0 1-3-3 3 3 0 0 1 0-6 3 3 0 0 1 3-3V5a3 3 0 0 1 3-3z',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  reminder: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2',
  ticket: 'M3 9a2 2 0 0 0 2 2 2 2 0 0 1 0 2 2 2 0 0 0-2 2v1h18v-1a2 2 0 0 0-2-2 2 2 0 0 1 0-2 2 2 0 0 0 2-2V8H3z',
  uptime: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2',
};
const tint = (fg: string) => ({ bg: `${fg}1A`, fg });
const T = { orange: '#A96F22', blue: '#3C7FB6', green: '#3E8F57', purple: '#7B5BB6', red: '#B85B4D', amber: '#D09A36' };

function Chevron() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C9BBA6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><path d="M9 18l6-6-6-6" /></svg>; }
function KIcon({ name, fg }: { name: string; fg: string }) {
  const t = tint(fg);
  return <span style={{ width: 30, height: 30, borderRadius: 9, background: t.bg, display: 'grid', placeItems: 'center', flex: 'none' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={t.fg} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ICON[name] || ICON.building} /></svg></span>;
}

interface Kpi { label: string; value: string; icon: string; fg: string; to?: string; trend?: number | null; trendVsYesterday?: boolean; sub?: string; goodWhenUp?: boolean; live: boolean }

function KpiCard({ kpi, nav }: { kpi: Kpi; nav: (to: string) => void }) {
  const up = (kpi.trend ?? 0) >= 0;
  const good = kpi.goodWhenUp === false ? !up : up;
  const trendColor = good ? 'var(--ok)' : 'var(--danger)';
  return (
    <div className="kpi" onClick={() => kpi.to && nav(kpi.to)} style={{ cursor: kpi.to ? 'pointer' : 'default', display: 'flex', flexDirection: 'column', gap: 5 }} role={kpi.to ? 'button' : undefined} tabIndex={kpi.to ? 0 : undefined} aria-label={`${kpi.label}: ${kpi.value}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <KIcon name={kpi.icon} fg={kpi.fg} />
        <div className="l" style={{ flex: 1, minWidth: 0 }}>{kpi.label}</div>
        {kpi.to && <Chevron />}
      </div>
      <div className="v" style={{ fontSize: 21 }}>{kpi.value}</div>
      {kpi.trend != null ? (
        <div className="d" style={{ color: trendColor, fontSize: 11 }}>{up ? '▲' : '▼'} {Math.abs(kpi.trend)}% {kpi.trendVsYesterday === false ? 'vs last month' : 'vs yesterday'}</div>
      ) : kpi.sub ? <div className="d flat" style={{ fontSize: 11 }}>{kpi.sub}</div> : <div className="d flat" style={{ fontSize: 11, color: 'var(--muted)' }}>{kpi.live ? '' : 'Not connected'}</div>}
    </div>
  );
}

function FlowStage({ icon, fg, label, value, conv }: { icon: string; fg: string; label: string; value: string; conv?: string | null }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 92 }}>
      <span style={{ width: 44, height: 44, borderRadius: 12, background: tint(fg).bg, display: 'grid', placeItems: 'center' }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ICON[icon] || ICON.calendar} /></svg></span>
      <div className="muted" style={{ fontSize: 11.5, fontWeight: 700 }}>{label}</div>
      <div style={{ fontWeight: 800, fontSize: 18 }}>{value}</div>
      <div className="muted" style={{ fontSize: 10.5 }}>{conv == null ? '\u00A0' : conv}</div>
    </div>
  );
}
function Arrow() { return <svg width="34" height="20" viewBox="0 0 34 20" fill="none" stroke="#D8CBB4" strokeWidth="2" strokeLinecap="round" style={{ flex: 'none', alignSelf: 'center', marginTop: 18 }}><path d="M2 10h28M24 4l6 6-6 6" /></svg>; }

export function DashboardScreen() {
  const { tenantId: scopedTenantId, tenantName: scopedTenantName } = useScope();
  const { data, mods, loading, error, range, setRange, reload } = useOverviewAggregate('month', scopedTenantId);
  const { principal } = useAuth();
  const nav = useNavigate();

  if (loading && !data) return <div className="work"><div className="state">Loading the Overview…</div></div>;
  if (error) return <div className="work"><div className="err">{error} <button className="btn ghost" onClick={reload} style={{ marginLeft: 10 }}>Retry</button></div></div>;
  if (!data) return <div className="work"><div className="state">No overview data.</div></div>;
  const d: OverviewState = data;
  const k = d.kpis, p = d.platformKpis;
  // trends is a fixed-key object on the server (always sent); keyed lookups read it as a record.
  const tr = (key: string): number | null => (d.kpis.trends as Record<string, number | null>)[key] ?? null;
  const suspended = d.tenantsByStatus.find((s) => s.status === 'suspended')?.count ?? null;
  const Q = mods.queue, C = mods.checkin, S = mods.staff, M = mods.memberships, L = mods.loyalty, Dv = mods.devices, Pay = mods.payments;
  const devTotal = Dv?.kpis.totalDevices ?? 0, devOnline = Dv?.kpis.online ?? 0, devOffline = Dv?.kpis.offline ?? 0;
  const onlinePct = devTotal ? Math.round((devOnline / devTotal) * 1000) / 10 : null;
  const offlinePct = devTotal ? Math.round((devOffline / devTotal) * 1000) / 10 : null;
  const deviceDonut = Dv ? [{ label: 'Online', value: devOnline }, { label: 'Offline', value: devOffline }] : [];
  const Br = mods.branches, Sv = mods.services, Ap = mods.appts;
  const completedServices = Ap ? (Ap.byStatus.find((b) => b.status === 'completed')?.count ?? 0) : null;
  const nowMs = Date.now();
  const upcoming = Ap ? Ap.rows.filter((r) => { const t = Date.parse(r.startTime); return !isNaN(t) && t >= nowMs; }).sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime)).slice(0, 5) : [];
  const topSvcs = Sv ? Sv.topServices.slice(0, 5) : [];
  const branchRows = Br ? Br.directory.slice(0, 5) : [];
  const apptTime = (iso: string) => { const d = new Date(iso); return isNaN(+d) ? '—' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
  const csat = Sv && Sv.kpis.reviewCount > 0 ? Sv.kpis.avgRating : null;
  const apptTotal = Ap ? Ap.byStatus.reduce((a, b) => a + b.count, 0) : 0;
  const noShowCount = Ap ? (Ap.byStatus.find((b) => b.status === 'no_show')?.count ?? 0) : 0;
  const noShowRate = Ap && apptTotal > 0 ? Math.round((noShowCount / apptTotal) * 1000) / 10 : null;

  // ── 30 platform KPIs (real where a source exists; honest '—' otherwise) ──
  const kpis: Kpi[] = [
    { label: 'Total Tenants', value: compact(k.totalTenants), icon: 'building', fg: T.orange, to: '/tenants', trend: tr('totalTenants'), live: true },
    { label: 'Active Salons', value: compact(k.activeSalons), icon: 'store', fg: T.purple, to: '/tenants', trend: tr('activeSalons'), live: true },
    { label: 'Pending Approvals', value: compact(k.pendingApplications), icon: 'clipboard', fg: T.amber, to: '/tenant-applications', trend: tr('pendingApplications'), live: true },
    { label: 'Suspended Salons', value: suspended == null ? DASH : compact(suspended), icon: 'ban', fg: T.red, to: '/tenants', trend: tr('suspendedSalons'), goodWhenUp: false, live: suspended != null },
    { label: 'Total Branches', value: compact(p.totalLocations), icon: 'building', fg: T.green, to: '/branches', trend: tr('totalBranches'), live: true },
    { label: 'Active POS Devices', value: Dv ? compact(devTotal) : DASH, icon: 'device', fg: T.blue, to: '/devices-management', live: !!Dv },

    { label: 'Online Devices', value: Dv ? compact(devOnline) : DASH, icon: 'wifi', fg: T.green, to: '/devices-management', sub: onlinePct != null ? `${onlinePct}% online` : undefined, live: !!Dv },
    { label: 'Offline Devices', value: Dv ? compact(devOffline) : DASH, icon: 'wifioff', fg: T.red, to: '/devices-management', sub: offlinePct != null ? `${offlinePct}% offline` : undefined, goodWhenUp: false, live: !!Dv },
    { label: 'Total Users & Roles', value: compact(p.activeUsers), icon: 'users', fg: T.blue, to: '/users-roles', trend: tr('activeUsers'), live: true },
    { label: 'Active Technicians', value: S ? compact(S.kpis.activeTechnicians) : DASH, icon: 'tech', fg: T.orange, to: '/staff', live: !!S },
    { label: 'Total Customers', value: compact(p.customers), icon: 'customer', fg: T.purple, to: '/customers', trend: tr('customers'), live: true },
    { label: 'Today\u2019s Appointments', value: compact(p.totalAppointments), icon: 'calendar', fg: T.red, to: '/appointment-oversight', trend: tr('totalAppointments'), live: true },

    { label: 'Completed Services', value: completedServices == null ? DASH : compact(completedServices), icon: 'check', fg: T.green, to: '/appointment-oversight', live: completedServices != null },
    { label: 'Customers Checked In', value: C ? compact(C.kpis.sessionsToday) : DASH, icon: 'checkin', fg: T.blue, to: '/booking-checkin', live: !!C },
    { label: 'Technicians Serving', value: Q ? compact(Q.kpis.inServiceNow) : DASH, icon: 'scissors', fg: T.orange, to: '/staff', live: !!Q },
    { label: 'Completed Checkouts', value: Pay ? compact(Pay.kpis.todayCount) : DASH, icon: 'cart', fg: T.purple, to: '/payments-transactions', live: !!Pay },
    { label: 'Today\u2019s Payment Volume', value: Pay ? money(Pay.kpis.todayVolumeCents) : DASH, icon: 'dollar', fg: T.green, to: '/payments-transactions', live: !!Pay },
    { label: 'Live Customer Queue', value: Q ? compact(Q.kpis.waitingNow) : DASH, icon: 'queue', fg: T.blue, to: '/queue-management', live: !!Q },

    { label: 'Monthly Card-Processing Volume', value: money(k.monthlyCardVolumeCents), icon: 'card', fg: T.orange, to: '/platform-reports', trend: tr('monthlyCardVolume'), trendVsYesterday: false, live: true },
    { label: 'Failed / Declined Payments', value: Pay ? compact(Pay.kpis.failedCount) : DASH, icon: 'alertpay', fg: T.red, to: '/payments-transactions', goodWhenUp: false, live: !!Pay },
    { label: 'Refunds & Chargebacks', value: Pay ? money(Pay.kpis.refundCentsMonth) : DASH, icon: 'refund', fg: T.red, to: '/payments-transactions', goodWhenUp: false, live: !!Pay },
    { label: 'Active Memberships', value: M ? compact(M.kpis.activeMembers) : DASH, icon: 'member', fg: T.purple, to: '/memberships', trend: M ? null : null, live: !!M },
    { label: 'Membership Revenue', value: M ? moneyM(M.kpis.membershipRevenueCents) : DASH, icon: 'revenue', fg: T.green, to: '/memberships', trend: M?.kpis.revenueDeltaPct ?? null, trendVsYesterday: false, live: !!M },
    { label: 'Loyalty Activity', value: L ? compact(L.kpis.pointsRedeemed) : DASH, icon: 'gift', fg: T.amber, to: '/loyalty-programs', live: !!L },

    { label: 'AI Receptionist Interactions', value: compact(p.aiInteractions), icon: 'ai', fg: T.blue, to: '/ai-insights', trend: tr('aiInteractions'), live: true },
    { label: 'AI Booking Activity', value: DASH, icon: 'calendar', fg: T.green, to: '/ai-reports', live: false },
    { label: 'Smart Reminder Activity', value: DASH, icon: 'reminder', fg: T.orange, to: '/smart-reminders', live: false },
    { label: 'Open Support Tickets', value: compact(k.openSupportTickets), icon: 'ticket', fg: T.red, to: '/support-access', trend: tr('openSupportTickets'), goodWhenUp: false, live: true },
    { label: 'Platform Uptime', value: `${k.systemHealthPercent}%`, icon: 'uptime', fg: T.green, to: '/system-health', sub: k.systemHealthLabel, live: true },
    { label: 'Avg Response Time', value: DASH, icon: 'clock', fg: T.amber, to: '/system-health', live: false },
  ];

  // ── Daily Operations Flow (real stage counts where sourced; conversions only where both ends are real) ──
  const booking = p.totalAppointments;
  const checkedIn = C?.kpis.sessionsToday ?? null;
  const queued = Q?.kpis.waitingNow ?? null;
  const serving = Q?.kpis.inServiceNow ?? null;
  const pct = (num: number | null, den: number | null): string | null => (num == null || den == null || den === 0 ? null : `${Math.round((num / den) * 1000) / 10}%`);
  const flow = [
    { icon: 'calendar', fg: T.red, label: 'Booking', value: compact(booking), conv: null as string | null },
    { icon: 'checkin', fg: T.blue, label: 'Check-In', value: checkedIn == null ? DASH : compact(checkedIn), conv: pct(checkedIn, booking) },
    { icon: 'queue', fg: T.amber, label: 'Queue', value: queued == null ? DASH : compact(queued), conv: pct(queued, checkedIn) },
    { icon: 'scissors', fg: T.orange, label: 'Serving', value: serving == null ? DASH : compact(serving), conv: pct(serving, queued) },
    { icon: 'check', fg: T.green, label: 'Service Done', value: completedServices == null ? DASH : compact(completedServices), conv: pct(completedServices, serving) },
    { icon: 'cart', fg: T.purple, label: 'Checkout', value: Pay ? compact(Pay.kpis.todayCount) : DASH, conv: pct(Pay ? Pay.kpis.todayCount : null, completedServices) },
  ];

  const tenantDonut = d.tenantsByStatus.map((s) => ({ label: s.label, value: s.count }));
  const tenantTotal = d.tenantsByStatus.reduce((a, s) => a + s.count, 0);
  const revTotal = d.monthlySalesVolume.reduce((a, s) => a + s.valueCents, 0);

  const quickActions = [
    { label: 'Open Live Operations', to: '/live-operations', icon: 'uptime' },
    { label: 'Booking Monitor', to: '/booking-checkin', icon: 'checkin' },
    { label: 'Queue Dashboard', to: '/queue-management', icon: 'queue' },
    { label: 'Technician Activity', to: '/staff', icon: 'tech' },
    { label: 'Membership Report', to: '/memberships', icon: 'member' },
    { label: 'Export Report', to: '/platform-reports', icon: 'clipboard' },
  ];

  const glance: { label: string; value: string; sub?: string; live: boolean }[] = [
    { label: 'Walk-ins', value: DASH, live: false },
    { label: 'Avg Wait Time', value: Q && Q.kpis.waitingNow > 0 ? fmtWait(Q.kpis.longestWaitMin) : DASH, sub: Q ? 'longest current' : '', live: !!Q },
    { label: 'No-Show Rate', value: noShowRate == null ? DASH : `${noShowRate}%`, live: noShowRate != null },
    { label: 'Customer Satisfaction', value: csat == null ? DASH : `${csat} / 5`, live: csat != null },
    { label: 'Active Techs', value: S ? compact(S.kpis.activeTechnicians) : DASH, live: !!S },
    { label: 'Tips Collected', value: Pay ? money(Pay.kpis.tipsCents) : DASH, live: !!Pay },
    { label: 'Utilization Rate', value: DASH, live: false },
  ];

  return (
    <div className="work">
      <div className="vh flex flex-col lg:flex-row justify-between gap-3" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}><h1>Overview <span style={{ color: 'var(--g7,#A96F22)' }}>★</span></h1><div className="sub">Real-time snapshot of your platform health, performance, and operations · {principal?.fullName || 'Super Admin'}</div>
          {scopedTenantId ? (
            <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 10px', borderRadius: 999, background: 'var(--g1,#F6EFE2)', border: '1px solid var(--g3,#E4D2AE)', fontSize: 12, color: 'var(--g7,#A96F22)', fontWeight: 700 }}>
              Scoped to {scopedTenantName} <span style={{ opacity: 0.7, fontWeight: 500 }}>· platform governance KPIs stay platform-wide</span>
            </div>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost" onClick={() => nav('/platform-reports')}>⬇ Export Report</button>
          <button className="btn" onClick={() => nav('/platform-reports')}>+ Add Widget</button>
        </div>
      </div>

      {/* 30 KPI cards — 6 per row */}
      <div className="kpis k6">{kpis.map((kp) => <KpiCard key={kp.label} kpi={kp} nav={nav} />)}</div>

      {/* Daily Operations Flow */}
      <section className="panel mt-[6px]">
        <div className="phead">
          <h2>Daily Operations Flow</h2>
          <span className="muted text-[11px]">
            Real-time flow of today's salon POS pipeline
          </span>
        </div>

        <div className="w-full overflow-x-auto">
          <div className="flex min-w-[900px] items-start justify-between gap-3 px-[2px] py-1.5">
            {flow.map((s, i) => (
              <Fragment key={s.label}>
                <FlowStage
                  icon={s.icon}
                  fg={s.fg}
                  label={s.label}
                  value={s.value}
                  conv={s.conv}
                />

                {i < flow.length - 1 && <Arrow />}
              </Fragment>
            ))}
          </div>
        </div>

        <div className="muted text-[10.5px]">
          Conversion % shown where both pipeline ends have live data.
        </div>
      </section>

      {/* Analytics row */}
      <div className=" grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 mt-[6px]">
        <section className="panel">
          <div className="phead"><h2>Revenue &amp; Transaction Trend</h2>
            <div className="seg">{(['day', 'week', 'month', 'year'] as Range[]).map((r) => (<button key={r} className={'segbtn' + (range === r ? ' on' : '')} onClick={() => setRange(r)}>{r[0].toUpperCase() + r.slice(1)}</button>))}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}><div style={{ fontFamily: "'Playfair Display',serif", fontSize: 20 }}>{money(revTotal)}</div><span className="muted" style={{ fontSize: 11 }}>revenue</span></div>
          {loading ? <div className="state">Loading…</div> : <AreaLine series={d.monthlySalesVolume} height={150} emptyHint="No sales volume in this range yet." />}
          <div className="muted" style={{ fontSize: 10.5, marginTop: 4 }}>Transaction-count overlay <NotConnected>wire next</NotConnected>.</div>
        </section>
        <section className="panel">
          <div className="phead"><h2>Appointments vs Customers</h2></div>
          <div className="state" style={{ padding: '34px 8px', textAlign: 'center' }}>Intraday appointment/customer time-series <NotConnected>not wired</NotConnected>.</div>
        </section>
        <section className="panel">
          <div className="phead"><h2>Tenants by Status</h2></div>
          {tenantTotal === 0 ? <div className="state">No tenants yet.</div> : <Donut data={tenantDonut} centerLabel={String(tenantTotal)} />}
        </section>
        <section className="panel">
          <div className="phead"><h2>Devices by Status</h2></div>
          {!Dv ? <div className="state" style={{ padding: '34px 8px', textAlign: 'center' }}>Loading…</div> : devTotal === 0 ? <div className="state">No devices yet.</div> : (
            <>
              <Donut data={deviceDonut} centerLabel={compact(devTotal)} />
              <div style={{ display: 'flex', justifyContent: 'center', gap: 14, marginTop: 6, fontSize: 11.5 }}>
                <span><span style={{ color: 'var(--ok)' }}>●</span> Online {compact(devOnline)} ({onlinePct}%)</span>
                <span><span style={{ color: 'var(--danger)' }}>●</span> Offline {compact(devOffline)} ({offlinePct}%)</span>
              </div>
            </>)}
        </section>
      </div>

      {/* Performance tables row */}
      <div className=" grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 mt-[6px]">
        <section className="panel">
          <div className="phead"><h2>Top-Performing Tenants</h2><button className="linkbtn" onClick={() => nav('/platform-reports?report=tenant-performance')}>View All</button></div>
          {d.topPerformingTenants.length === 0 ? <div className="state">No tenant performance yet.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5 }}><th style={{ padding: '4px 6px' }}>#</th><th style={{ padding: '4px 6px' }}>Tenant</th><th style={{ padding: '4px 6px' }}>Rev</th><th style={{ padding: '4px 6px' }}>Growth</th></tr></thead>
              <tbody>{d.topPerformingTenants.slice(0, 5).map((t) => (
                <tr key={t.tenantId} onClick={() => nav('/tenants')} style={{ cursor: 'pointer', borderTop: '1px solid var(--line)' }}>
                  <td style={{ padding: '5px 6px', color: 'var(--muted)' }}>{t.rank}</td>
                  <td style={{ padding: '5px 6px', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 110 }} title={t.name}>{t.name}</td>
                  <td style={{ padding: '5px 6px' }}>{moneyM(t.monthlyVolumeCents)}</td>
                  <td style={{ padding: '5px 6px', color: (t.growthPercent ?? 0) >= 0 ? 'var(--ok)' : 'var(--danger)' }}>{t.growthPercent == null ? DASH : `${t.growthPercent >= 0 ? '▲' : '▼'} ${Math.abs(t.growthPercent)}%`}</td>
                </tr>))}</tbody>
            </table>)}
        </section>
        <section className="panel">
          <div className="phead"><h2>Branch Performance</h2><button className="linkbtn" onClick={() => nav('/branches')}>View All</button></div>
          {!Br ? <div className="state" style={{ padding: '28px 8px', textAlign: 'center' }}>Loading…</div> : branchRows.length === 0 ? <div className="state">No branches yet.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5 }}><th style={{ padding: '4px 6px' }}>#</th><th style={{ padding: '4px 6px' }}>Branch</th><th style={{ padding: '4px 6px' }}>Appts</th><th style={{ padding: '4px 6px' }}>Rev</th><th style={{ padding: '4px 6px' }}>Status</th></tr></thead>
              <tbody>{branchRows.map((b, i) => (
                <tr key={b.id} onClick={() => nav('/branches')} style={{ cursor: 'pointer', borderTop: '1px solid var(--line)' }}>
                  <td style={{ padding: '5px 6px', color: 'var(--muted)' }}>{i + 1}</td>
                  <td style={{ padding: '5px 6px', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 100 }} title={`${b.name}${b.tenantName ? ' · ' + b.tenantName : ''}`}>{b.name}</td>
                  <td style={{ padding: '5px 6px' }}>{compact(b.todaysAppts)}</td>
                  <td style={{ padding: '5px 6px' }}>{moneyM(b.revenueMtdCents)}</td>
                  <td style={{ padding: '5px 6px' }}><span style={{ fontSize: 11, color: b.status === 'active' ? 'var(--ok)' : 'var(--muted)' }}>{b.status}</span></td>
                </tr>))}</tbody>
            </table>)}
        </section>
        <section className="panel">
          <div className="phead"><h2>Live Queue Monitor</h2><button className="linkbtn" onClick={() => nav('/queue-management')}>View All</button></div>
          {!Q ? <div className="state">Loading…</div> : Q.items.length === 0 ? <div className="state">No active queue.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5 }}><th style={{ padding: '4px 6px' }}>#</th><th style={{ padding: '4px 6px' }}>Customer</th><th style={{ padding: '4px 6px' }}>Salon</th><th style={{ padding: '4px 6px' }}>Wait</th></tr></thead>
              <tbody>{Q.items.slice(0, 5).map((it, i) => (
                <tr key={it.queueItemId} style={{ borderTop: '1px solid var(--line)' }}>
                  <td style={{ padding: '5px 6px', color: 'var(--muted)' }}>{i + 1}</td>
                  <td style={{ padding: '5px 6px', fontWeight: 700 }}>{it.customerName}{it.isVip && <span className="badge" style={{ marginLeft: 4, background: '#FFF6E5', color: '#B8862B', fontSize: 8 }}>VIP</span>}</td>
                  <td style={{ padding: '5px 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 90 }} title={it.tenantName || ''}>{it.tenantName || DASH}</td>
                  <td style={{ padding: '5px 6px', color: it.status === 'in_service' ? 'var(--muted)' : it.waitMinutes >= 30 ? 'var(--danger)' : 'inherit' }}>{it.status === 'in_service' ? 'serving' : fmtWait(it.waitMinutes)}</td>
                </tr>))}</tbody>
            </table>)}
        </section>
        <section className="panel">
          <div className="phead"><h2>Top Services</h2><button className="linkbtn" onClick={() => nav('/services')}>View All</button></div>
          {!Sv ? <div className="state" style={{ padding: '28px 8px', textAlign: 'center' }}>Loading…</div> : topSvcs.length === 0 ? <div className="state">No service bookings yet.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5 }}><th style={{ padding: '4px 6px' }}>#</th><th style={{ padding: '4px 6px' }}>Service</th><th style={{ padding: '4px 6px' }}>Bookings</th><th style={{ padding: '4px 6px' }}>Rev</th></tr></thead>
              <tbody>{topSvcs.map((sv, i) => (
                <tr key={sv.name + i} onClick={() => nav('/services')} style={{ cursor: 'pointer', borderTop: '1px solid var(--line)' }}>
                  <td style={{ padding: '5px 6px', color: 'var(--muted)' }}>{i + 1}</td>
                  <td style={{ padding: '5px 6px', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 110 }} title={sv.name}>{sv.name}</td>
                  <td style={{ padding: '5px 6px' }}>{compact(sv.bookings)}</td>
                  <td style={{ padding: '5px 6px' }}>{moneyM(sv.revenueCents)}</td>
                </tr>))}</tbody>
            </table>)}
        </section>
      </div>

      {/* Activity / alerts / appointments / devices row */}
      <div className=" grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 mt-[6px]">
        <section className="panel">
          <div className="phead"><h2>Recent Platform Activity</h2><button className="linkbtn" onClick={() => nav('/tenant-activity')}>View All</button></div>
          {d.recentActivity.length === 0 ? <div className="state">No recent activity.</div> : d.recentActivity.slice(0, 5).map((a) => (
            <div key={a.id} className="alertrow"><span className="sevdot" style={{ background: SEV[a.severity] }} />
              <div style={{ flex: 1, minWidth: 0 }}><div className="at">{a.title}</div><div className="am">{a.tenantName ? a.tenantName + ' · ' : ''}{a.message}</div></div>
              <div className="aage">{a.ageLabel}</div></div>))}
        </section>
        <section className="panel">
          <div className="phead"><h2>System Alerts</h2><button className="linkbtn" onClick={() => nav('/alerts')}>View All</button></div>
          {d.recentAlerts.length === 0 ? <div className="state">No alerts.</div> : d.recentAlerts.slice(0, 4).map((a) => { const b = sevBadge(a.severity); return (
            <div key={a.id} className="alertrow" onClick={() => nav(a.to)} style={{ cursor: 'pointer' }}>
              <span className="sevdot" style={{ background: SEV[a.severity] }} />
              <div style={{ flex: 1, minWidth: 0 }}><div className="at">{a.title}</div><div className="am">{a.message}</div></div>
              <span className="badge" style={{ background: b.background, color: b.color }}>{b.label}</span>
            </div>); })}
        </section>
        <section className="panel">
          <div className="phead"><h2>Upcoming Appointments</h2><button className="linkbtn" onClick={() => nav('/appointment-oversight')}>View All</button></div>
          {!Ap ? <div className="state" style={{ padding: '28px 8px', textAlign: 'center' }}>Loading…</div> : upcoming.length === 0 ? <div className="state">No upcoming appointments.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5 }}><th style={{ padding: '4px 6px' }}>Time</th><th style={{ padding: '4px 6px' }}>Customer</th><th style={{ padding: '4px 6px' }}>Service</th><th style={{ padding: '4px 6px' }}>Salon</th></tr></thead>
              <tbody>{upcoming.map((a) => (
                <tr key={a.id} style={{ borderTop: '1px solid var(--line)' }}>
                  <td style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>{apptTime(a.startTime)}</td>
                  <td style={{ padding: '5px 6px', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 80 }} title={a.customerName}>{a.customerName}</td>
                  <td style={{ padding: '5px 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 80 }} title={formatServicesList(a.services)}>{formatServiceName(a.services?.[0])}</td>
                  <td style={{ padding: '5px 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 80 }} title={a.tenantName || ''}>{a.tenantName || '—'}</td>
                </tr>))}</tbody>
            </table>)}
        </section>
        <section className="panel">
          <div className="phead"><h2>Device Status Overview</h2><button className="linkbtn" onClick={() => nav('/devices-management')}>View All</button></div>
          {!Dv ? <div className="state" style={{ padding: '28px 8px', textAlign: 'center' }}>Loading…</div> : devTotal === 0 ? <div className="state">No devices yet.</div> : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: '0 0 130px' }}><Donut data={deviceDonut} centerLabel={compact(devTotal)} /></div>
              <div style={{ fontSize: 12 }}>
                <div style={{ marginBottom: 6 }}><span style={{ color: 'var(--ok)' }}>●</span> Online <b>{compact(devOnline)}</b> <span className="muted">({onlinePct}%)</span></div>
                <div><span style={{ color: 'var(--danger)' }}>●</span> Offline <b>{compact(devOffline)}</b> <span className="muted">({offlinePct}%)</span></div>
              </div>
            </div>)}
        </section>
      </div>

      {/* Quick Actions */}
      <section className="panel" style={{ marginTop: 6 }}>
        <h2>Quick Actions</h2>
        <div className=" grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 mt-[6px]">
          {quickActions.map((q) => <button key={q.label} className="qbtn" onClick={() => nav(q.to)}>{q.label}</button>)}
          <button className="qbtn" style={{ background: 'var(--g7,#A96F22)', color: '#fff', borderColor: 'transparent' }} onClick={() => nav('/branches')}>+ Add Branch</button>
        </div>
      </section>

      {/* At-a-Glance Summary */}
      <section className="panel mt-[6px]">
        <div className="phead">
          <h2>At-a-Glance Summary (Today)</h2>
        </div>

        <div className="w-full overflow-x-auto">
          <div className="flex min-w-[1400px] items-start gap-2">
            {glance.map((g) => (
              <div
                key={g.label}
                className="min-w-[180px] shrink-0 text-center px-1 py-1.5"
              >
                <div className="muted text-[11px]">{g.label}</div>

                <div className="font-extrabold text-[18px] mt-0.5">
                  {g.value}
                </div>

                <div className="muted text-[10px]">
                  {g.value === DASH ? 'Not connected' : (g.sub || '')}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Honest "not yet wired" footer */}
      <section className="panel" style={{ marginTop: 6, borderColor: 'var(--gline,#E7DcC8)' }}>
        <h2>Not yet wired to live data</h2>
        <div className="am" style={{ padding: '2px 0' }}>KPIs still pending a source: AI booking, smart reminders, avg response time.</div>
        <div className="am" style={{ padding: '2px 0' }}>Widgets still pending: the Appointments-vs-Customers intraday chart (needs a time-series feed) and the Walk-ins / Utilization At-a-Glance metrics. Everything else — devices, payments, tips, branch performance, top services, upcoming appointments, completed services, the full operations flow, no-show rate, and CSAT — is now live.</div>
        {d.blockers.map((b) => (<div key={b.module} className="am" style={{ padding: '2px 0' }}><b>{b.module}</b> — {b.reason}</div>))}
      </section>
    </div>
  );
}
