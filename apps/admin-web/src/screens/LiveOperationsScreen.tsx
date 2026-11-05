import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOverviewAggregate, type Range } from '../api/superAdminOverviewApi';

function formatServiceName(service: any): string {
  if (!service) return '—';
  if (typeof service === 'string') return service || '—';
  if (typeof service === 'object' && service !== null) {
    return service.serviceName || service.name || service.title || service.label || '—';
  }
  return String(service);
}
import { useSuperAdminDashboard } from '../api/superAdminDashboardApi';
import { useScope } from '../shell/ScopeContext';
import { useAuth } from '../auth/AuthContext';
import { ProfileAvatarWithPreview } from '@aipowersalon/ui';

function formatApptTime(startTime: any, apptDate?: any): string {
  if (!startTime) return '—';
  const str = String(startTime).trim();
  if (!str || str === 'Invalid Date') return '—';

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(str)) {
    const [h, m] = str.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  if (apptDate) {
    const dStr = String(apptDate).split('T')[0];
    const combined = new Date(`${dStr}T${str}`);
    if (!isNaN(combined.getTime())) {
      return combined.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
  }

  return str;
}

// LiveOperationsScreen.tsx — S01 Super Admin › Platform Overview › Live Operations.
// A platform-level, READ-ONLY monitoring center for every authorized tenant/branch/device/queue/technician.
// It composes the existing one-request aggregate (GET /super-admin/overview/aggregate — scoped by the top-bar
// selector) plus the real DB/process health probe (GET /super-admin/system-health). It adds NO new backend and NO
// new cross-tenant SQL; per-tenant facts with no existing source render "—"/NotConnected rather than fabricated.
// It deliberately exposes NO salon-workflow mutations (no check-in / assign / start / complete / checkout / pay).

// ---------- money + number helpers (money is integer cents everywhere; never a float source of truth) ----------
const dollars = (cents: number) => '$' + Math.round(cents / 100).toLocaleString('en-US');
const moneyM = (cents: number) =>
  cents / 100 >= 1_000_000 ? '$' + (cents / 100_000_000).toFixed(2) + 'M' : dollars(cents);
const compact = (n: number) => (n >= 1_000_000 ? (n / 1_000_000).toFixed(2) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n));
const pctStr = (n: number | null | undefined) => (n == null ? null : `${n > 0 ? '+' : ''}${n}%`);

// ---------- minimal inline icon set (avoids adding an icon dependency; matches the soft tinted-circle look) ----------
type IconKey = 'tenant' | 'branch' | 'deviceOn' | 'deviceOff' | 'checkin' | 'queue' | 'tech' | 'done' | 'cart' | 'calendar' | 'card' | 'revenue';
const ICON_PATH: Record<IconKey, string> = {
  tenant: 'M3 21V7l6-4 6 4v14M9 21v-5h2v5M3 11h2M3 15h2M13 11h2M13 15h2',
  branch: 'M4 21V8l8-5 8 5v13M9 21v-6h6v6',
  deviceOn: 'M7 3h10v18H7zM10 18h4',
  deviceOff: 'M7 3h10v18H7zM10 18h4M3 3l18 18',
  checkin: 'M9 11l3 3 8-8M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  queue: 'M6 4h12M6 9h12M6 14h8M6 19h6',
  tech: 'M6 4l6 8 6-8M9 14h6M12 14v6',
  done: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3',
  cart: 'M6 6h15l-1.5 9h-12zM6 6 5 3H2M9 20h.01M17 20h.01',
  calendar: 'M3 9h18M7 3v4M17 3v4M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  card: 'M2 7h20v10H2zM2 11h20',
  revenue: 'M3 17l6-6 4 4 7-7M14 8h7v7',
};
function Glyph({ icon, color }: { icon: IconKey; color: string }) {
  return (
    <span aria-hidden="true" style={{ width: 30, height: 30, borderRadius: '50%', background: color + '1F', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ICON_PATH[icon]} /></svg>
    </span>
  );
}

// trend coloring carries business meaning, not raw sign (e.g. fewer offline devices is favorable → green)
type Trend = { text: string; favorable: boolean } | null;
function trend(deltaPct: number | null | undefined, lowerIsBetter = false): Trend {
  const s = pctStr(deltaPct);
  if (!s || deltaPct == null) return null;
  const favorable = lowerIsBetter ? deltaPct <= 0 : deltaPct >= 0;
  return { text: `${s} vs yesterday`, favorable };
}

type Kpi = { key: IconKey; label: string; value: string; tone: string; trend: Trend; to?: string; note?: string };

function KpiCard({ k, onGo }: { k: Kpi; onGo: (to?: string) => void }) {
  const clickable = !!k.to;
  return (
    <div
      className="kpi"
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={`${k.label}: ${k.value}${k.trend ? ', ' + k.trend.text : ''}`}
      onClick={clickable ? () => onGo(k.to) : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onGo(k.to); } } : undefined}
      style={{ cursor: clickable ? 'pointer' : 'default', display: 'flex', gap: 11, alignItems: 'flex-start' }}
    >
      <Glyph icon={k.key} color={k.tone} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="l" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.label}</span>
          {clickable ? <span aria-hidden="true" style={{ marginLeft: 'auto', color: 'var(--muted)' }}>›</span> : null}
        </div>
        <div className="v">{k.value}</div>
        {k.trend ? <div className="d" style={{ color: k.trend.favorable ? 'var(--ok)' : 'var(--danger)' }}>{k.trend.favorable ? '↑' : '↓'} {k.trend.text}</div>
          : <div className="d flat">{k.note || 'no day-over-day source'}</div>}
      </div>
    </div>
  );
}

const SEVERITY_TONE: Record<string, { bg: string; fg: string; label: string }> = {
  error: { bg: '#FBEBE8', fg: '#B85B4D', label: 'High' },
  warning: { bg: 'var(--warn-bg)', fg: 'var(--warn)', label: 'Medium' },
  success: { bg: 'var(--ok-bg)', fg: 'var(--ok)', label: 'Low' },
  info: { bg: '#EAF2F8', fg: 'var(--info)', label: 'Info' },
};

const WIDGETS = [
  'kpis', 'tenants', 'health', 'alerts', 'revenue', 'pipeline', 'queueByBranch', 'devices',
  'topTenants', 'activity', 'appointments', 'technicians', 'branches', 'quickActions',
] as const;
type WidgetId = (typeof WIDGETS)[number];
const WIDGET_LABELS: Record<WidgetId, string> = {
  kpis: 'Live KPIs', tenants: 'All Tenants Live Monitor', health: 'System Health', alerts: 'Live Alerts',
  revenue: 'Live Revenue Monitor', pipeline: 'Daily Service Pipeline', queueByBranch: 'Queue Monitor by Branch',
  devices: 'Active POS Devices', topTenants: 'Top Performing Tenants', activity: 'Recent Platform Activity',
  appointments: 'Upcoming Appointments', technicians: 'Technician Activity', branches: 'Branch Performance', quickActions: 'Quick Actions',
};
const HIDDEN_KEY = 'aps.liveops.hiddenWidgets';
function loadHidden(): Set<WidgetId> {
  try { const raw = localStorage.getItem(HIDDEN_KEY); if (raw) return new Set(JSON.parse(raw) as WidgetId[]); } catch { /* ignore */ }
  return new Set();
}

export function LiveOperationsScreen() {
  const nav = useNavigate();
  const { principal } = useAuth();
  const { tenantId: scopedTenantId, tenantName: scopedTenantName } = useScope();
  const { data: state, mods, loading, error, range, setRange, reload } = useOverviewAggregate('day', scopedTenantId);
  const { health } = useSuperAdminDashboard();

  const [auto, setAuto] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [hidden, setHidden] = useState<Set<WidgetId>>(loadHidden);
  const [showWidgetMenu, setShowWidgetMenu] = useState(false);
  const [planFilter, setPlanFilter] = useState('all');
  const [tenantSearch, setTenantSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const inFlight = useRef(false);

  const go = useCallback((to?: string) => { if (to) nav(to); }, [nav]);

  // mark a successful load (preserve last good data on error — the hook keeps prior data)
  useEffect(() => { if (!loading && !error) setLastUpdated(Date.now()); }, [loading, error, state]);

  // a single de-duplicated refresh; never fire while one is in flight
  const refresh = useCallback(() => { if (inFlight.current || loading) return; inFlight.current = true; reload(); }, [reload, loading]);
  useEffect(() => { if (!loading) inFlight.current = false; }, [loading]);

  // 10s auto-refresh, paused while the tab is hidden, resumes cleanly on visibility
  useEffect(() => {
    if (!auto) return;
    const tick = () => { if (document.visibilityState === 'visible') refresh(); };
    const id = window.setInterval(tick, 10_000);
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [auto, refresh]);
  // clock for the "updated Ns ago" stale indicator
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, []);

  const persistHidden = (next: Set<WidgetId>) => { setHidden(new Set(next)); try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next])); } catch { /* ignore */ } };
  const visible = (id: WidgetId) => !hidden.has(id);

  const perms = state?.quickActionsPermissions || {};
  const k = state?.kpis;
  const p = state?.platformKpis;
  const dev = mods.devices?.kpis;
  const pay = mods.payments?.kpis;
  const queue = mods.queue;
  const checkin = mods.checkin;
  const staff = mods.staff;
  const appts = mods.appts;

  const apptStatusCount = (s: string) => appts?.byStatus.find((b) => b.status.toLowerCase() === s)?.count ?? null;
  const t = (key: string, lowerIsBetter = false) => trend((k?.trends as Record<string, number | null> | undefined)?.[key] ?? null, lowerIsBetter);

  // ---- 12 live KPIs (governance counts stay platform-wide; operational counts follow scope) ----
  const kpis: Kpi[] = useMemo(() => {
    if (!state) return [];
    const activeBranches = mods.branches?.directory.filter((b) => (b.status || '').toLowerCase() === 'active').length;
    const todayRevenueCents = mods.revenueHourly?.today ? mods.revenueHourly.today.reduce((a, b) => a + b, 0) : null;
    return [
      { key: 'tenant', label: 'Total Tenants', value: compact(k!.totalTenants), tone: 'var(--info)', trend: t('totalTenants'), to: '/tenants' },
      { key: 'branch', label: 'Active Branches', value: activeBranches != null ? compact(activeBranches) : compact(k!.activeSalons), tone: 'var(--ok)', trend: t('activeSalons'), to: '/branches' },
      { key: 'deviceOn', label: 'Online POS Devices', value: dev ? compact(dev.online) : '—', tone: 'var(--ok)', trend: t('devicesOnline'), to: '/devices-management', note: dev ? undefined : 'NotConnected' },
      { key: 'deviceOff', label: 'Offline POS Devices', value: dev ? compact(dev.offline) : '—', tone: 'var(--danger)', trend: t('devicesOffline', true), to: '/devices-management', note: dev ? undefined : 'NotConnected' },
      { key: 'checkin', label: 'Customers Checked In', value: checkin ? compact(checkin.kpis.sessionsToday) : '—', tone: 'var(--info)', trend: t('checkedIn'), to: '/booking-checkin', note: checkin ? undefined : 'NotConnected' },
      { key: 'queue', label: 'Live Queue', value: queue ? compact(queue.kpis.waitingNow) : '—', tone: 'var(--warn)', trend: t('queue'), to: '/queue-management', note: queue ? undefined : 'NotConnected' },
      { key: 'tech', label: 'Technicians Serving', value: queue ? compact(queue.kpis.inServiceNow) : '—', tone: '#7B5BB6', trend: t('serving'), to: '/staff', note: queue ? undefined : 'NotConnected' },
      { key: 'done', label: 'Service Done', value: apptStatusCount('completed') != null ? compact(apptStatusCount('completed')!) : '—', tone: 'var(--ok)', trend: t('serviceDone'), to: '/appointment-oversight', note: apptStatusCount('completed') == null ? 'NotConnected' : undefined },
      { key: 'cart', label: 'Checkouts Completed', value: pay ? compact(pay.todayCount) : '—', tone: 'var(--info)', trend: t('checkouts'), to: '/payments-transactions', note: pay ? undefined : 'NotConnected' },
      { key: 'calendar', label: "Today's Appointments", value: p ? compact(p.totalAppointments) : '—', tone: 'var(--warn)', trend: t('appointments'), to: '/appointment-oversight' },
      { key: 'card', label: "Today's Payment Volume", value: pay ? moneyM(pay.todayVolumeCents) : '—', tone: 'var(--ok)', trend: t('paymentVolume'), to: '/payments-transactions', note: pay ? undefined : 'NotConnected' },
      { key: 'revenue', label: "Today's Revenue", value: todayRevenueCents != null ? moneyM(todayRevenueCents) : '—', tone: '#7B5BB6', trend: null, to: '/platform-reports', note: todayRevenueCents != null ? undefined : 'NotConnected' },
    ];
  }, [state, mods, k, p, dev, pay, queue, checkin]);  

  // ---- All Tenants Live Monitor: join the per-tenant breakdowns the aggregate already returns ----
  type TenantMonitorRow = {
    tenantId: string; name: string; ownerName: string | null; ownerAvatarUrl?: string | null; plan: string | null;
    branchCount: number | null; checkin: number | null; queue: number | null; serving: number | null;
    serviceDone: number | null; checkout: number | null; revenueTodayCents: number | null;
    revenueMonthCents: number | null; growth: number | null; deviceOnline: number | null;
    deviceTotal: number | null; live: 'live' | 'idle' | 'offline';
  };
  const monitorRows: TenantMonitorRow[] = useMemo(() => {
    const byId = new Map<string, TenantMonitorRow>();
    const ensure = (tenantId: string, name: string | null) => {
      let r = byId.get(tenantId);
      if (!r) { r = { tenantId, name: name || 'Unknown', ownerName: null, ownerAvatarUrl: null, plan: null, branchCount: null, checkin: null, queue: null, serving: null, serviceDone: null, checkout: null, revenueTodayCents: null, revenueMonthCents: null, growth: null, deviceOnline: null, deviceTotal: null, live: 'offline' }; byId.set(tenantId, r); }
      else if (name && r.name === 'Unknown') r.name = name;
      return r;
    };
    checkin?.tenants.forEach((c) => { const r = ensure(c.tenantId, c.tenantName); r.checkin = c.activeCount; if (c.activeCount > 0) r.live = 'live'; });
    queue?.tenants.forEach((q) => { const r = ensure(q.tenantId, q.tenantName); r.queue = q.waitingCount; r.serving = q.servingCount; if (q.waitingCount + q.servingCount > 0) r.live = 'live'; });
    staff?.tenants.forEach((s) => { const r = ensure(s.tenantId, s.tenantName); if (r.serving == null) r.serving = s.activeCount; });
    state?.topPerformingTenants.forEach((tp) => { const r = ensure(tp.tenantId, tp.name); r.revenueMonthCents = tp.monthlyVolumeCents; r.growth = tp.growthPercent; });
    mods.tenantsLive?.forEach((tl) => { const r = ensure(tl.tenantId, null); r.ownerName = tl.ownerName; (r as any).ownerAvatarUrl = (tl as any).ownerAvatarUrl; r.plan = tl.plan; r.branchCount = tl.branchCount; r.serviceDone = tl.serviceDone; r.checkout = tl.checkout; r.revenueTodayCents = tl.revenueTodayCents; r.deviceOnline = tl.deviceOnline; r.deviceTotal = tl.deviceTotal; if (tl.checkout > 0 || tl.serviceDone > 0 || tl.deviceOnline > 0) r.live = 'live'; });
    return [...byId.values()].sort((a, b) => (b.revenueTodayCents ?? b.revenueMonthCents ?? 0) - (a.revenueTodayCents ?? a.revenueMonthCents ?? 0));
  }, [checkin, queue, staff, state, mods.tenantsLive]);

  const planOptions = useMemo(() => [...new Set(monitorRows.map((r) => r.plan).filter((p): p is string => !!p))].sort(), [monitorRows]);
  const filteredRows = useMemo(() => monitorRows.filter((r) => {
    if (tenantSearch && !r.name.toLowerCase().includes(tenantSearch.toLowerCase())) return false;
    if (planFilter !== 'all' && (r.plan || '').toLowerCase() !== planFilter.toLowerCase()) return false;
    return true;
  }), [monitorRows, tenantSearch, planFilter]);
  useEffect(() => { setPage(1); }, [tenantSearch, planFilter, pageSize]);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const pageRows = filteredRows.slice((page - 1) * pageSize, page * pageSize);

  // ---- queue-by-branch + technician activity from queue.items (already returned, scope-synced) ----
  const queueByBranch = useMemo(() => {
    const m = new Map<string, number>();
    queue?.items.forEach((it) => { const key = [it.tenantName, it.branchName].filter(Boolean).join(' - ') || it.branchName || it.tenantName || 'Branch'; m.set(key, (m.get(key) || 0) + 1); });
    return [...m.entries()].map(([branch, count]) => ({ branch, count })).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [queue]);
  const technicians = useMemo(() => {
    const m = new Map<string, { name: string; service: string | null; serving: number; photoUrl?: string | null }>();
    queue?.items.forEach((it) => {
      if (!it.technicianName) return;
      const cur = m.get(it.technicianName) || { name: it.technicianName, service: it.station, serving: 0, photoUrl: (it as any).technicianPhotoUrl || null };
      cur.serving += 1;
      m.set(it.technicianName, cur);
    });
    const arr = [...m.values()].sort((a, b) => b.serving - a.serving).slice(0, 6);
    const max = Math.max(1, ...arr.map((a) => a.serving));
    return arr.map((a) => ({ ...a, ratio: a.serving / max }));
  }, [queue]);

  // ---- service pipeline (counts from real KPIs; honest "—" where no source) ----
  const pipeline = useMemo(() => ([
    { key: 'calendar' as IconKey, label: 'Booking', value: p ? compact(p.totalAppointments) : '—', to: '/appointment-oversight' },
    { key: 'checkin' as IconKey, label: 'Check-In', value: checkin ? compact(checkin.kpis.sessionsToday) : '—', to: '/booking-checkin' },
    { key: 'queue' as IconKey, label: 'Queue', value: queue ? compact(queue.kpis.waitingNow) : '—', to: '/queue-management' },
    { key: 'tech' as IconKey, label: 'Serving', value: queue ? compact(queue.kpis.inServiceNow) : '—', to: '/staff' },
    { key: 'done' as IconKey, label: 'Service Done', value: apptStatusCount('completed') != null ? compact(apptStatusCount('completed')!) : '—', to: '/appointment-oversight' },
    { key: 'cart' as IconKey, label: 'Checkout', value: pay ? compact(pay.todayCount) : '—', to: '/payments-transactions' },
  ]), [p, checkin, queue, pay, appts]);  

  // ---- CSV export of the current (scoped, filtered) live data — real client-side download, formula-injection safe ----
  const csvCell = (v: string | number) => { const s = String(v); const safe = /^[=+\-@]/.test(s) ? "'" + s : s; return '"' + safe.replace(/"/g, '""') + '"'; };
  const exportCsv = () => {
    const head = ['Tenant', 'Owner', 'Plan', 'Branches', 'Check-In', 'Queue', 'Serving', 'Service Done', 'Checkout', 'Revenue Today', 'Devices Online', 'Devices Total', 'Growth %', 'Live'];
    const lines = [head.map(csvCell).join(',')];
    filteredRows.forEach((r) => lines.push([r.name, r.ownerName ?? '', r.plan ?? '', r.branchCount ?? '', r.checkin ?? '', r.queue ?? '', r.serving ?? '', r.serviceDone ?? '', r.checkout ?? '', r.revenueTodayCents != null ? (r.revenueTodayCents / 100).toFixed(2) : '', r.deviceOnline ?? '', r.deviceTotal ?? '', r.growth ?? '', r.live].map(csvCell).join(',')));
    const meta = `# Live Operations export · scope=${scopedTenantName || 'All Branches'} · by=${principal?.fullName || 'Super Admin'} · ${new Date().toISOString()}`;
    const blob = new Blob([meta + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = `live-operations-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const quickActions: { label: string; run: () => void; permKey?: string }[] = [
    { label: 'Broadcast Message', run: () => nav('/communications'), permKey: 'communications' },
    { label: 'Add Announcement', run: () => nav('/communications'), permKey: 'communications' },
    { label: 'Force POS Sync', run: () => nav('/devices-management'), permKey: 'devices' },
    { label: 'Refresh All Data', run: () => refresh() },
    { label: 'View All Queues', run: () => nav('/queue-management') },
    { label: 'System Diagnostics', run: () => nav('/system-health') },
    { label: 'Export Live Data', run: exportCsv, permKey: 'export' },
    { label: '+ Add Tenant', run: () => nav('/tenants'), permKey: 'createTenant' },
  ];
  const actionEnabled = (permKey?: string) => (permKey && perms[permKey] === false ? false : true);

  // system health: real DB + process probe; other named services have no individual probe → honest "Not connected"
  const dbOk = health?.database?.ok ?? health?.ok ?? null;
  const healthRows = [
    { name: 'Database', ok: dbOk, detail: dbOk == null ? 'Not connected' : dbOk ? `${health?.database?.latencyMs ?? ''}ms` : 'Degraded' },
    { name: 'API Process', ok: health?.process ? true : null, detail: health?.process ? `${health.process.env} · ${health.process.memoryRssMb}MB` : 'Not connected' },
    { name: 'POS Sync', ok: null, detail: 'No probe wired' },
    { name: 'Booking System', ok: null, detail: 'No probe wired' },
    { name: 'Payment Gateway', ok: health?.gateway ? health.gateway.ok : null, detail: health?.gateway ? (health.gateway.ok ? `Healthy · ${health.gateway.configured} configured` : `${health.gateway.errors24h} error(s) in 24h`) : 'No probe wired' },
    { name: 'AI Receptionist', ok: null, detail: 'No probe wired' },
    { name: 'Messaging System', ok: null, detail: 'No probe wired' },
    { name: 'Inventory Sync', ok: null, detail: 'No probe wired' },
  ];
  const allHealthy = healthRows.every((r) => r.ok === true);
  const anyDegraded = healthRows.some((r) => r.ok === false);
  const healthLabel = anyDegraded ? 'Degraded' : allHealthy ? 'All Systems Operational' : 'Partially Monitored';

  if (error && !state) return <div className="screen"><div className="state">{error} <button className="linkbtn" onClick={refresh} style={{ marginLeft: 8 }}>Retry</button></div></div>;
  if (loading && !state) return <div className="screen"><div className="state">Loading Live Operations…</div></div>;

  const staleSeconds = lastUpdated ? Math.floor((now - lastUpdated) / 1000) : null;
  const stale = staleSeconds != null && staleSeconds > 30;

  return (
    <div className="screen p-5" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="flex flex-col xl:flex-row justify-between gap-3" >
        <div className="vh">
          <h1 style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            Live Operations
            <span className="pill ok" aria-label="Live">● Live</span>
            <span className="pill" style={{ background: anyDegraded ? 'var(--warn-bg)' : 'var(--ok-bg)', color: anyDegraded ? 'var(--warn)' : 'var(--ok)', borderColor: anyDegraded ? '#F0D79A' : '#BFE3C6' }}>{healthLabel}</span>
          </h1>
          <div className="sub">Real-time control center for all tenants across the AI PowerSalon platform.</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: stale ? 'var(--warn)' : 'var(--muted)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: stale ? 'var(--warn)' : 'var(--ok)' }} />
            {staleSeconds == null ? 'live' : stale ? `data ${staleSeconds}s old` : `updated ${staleSeconds}s ago`}
          </span>
          <button className="btn ghost"  aria-pressed={auto} onClick={() => setAuto((a) => !a)} title="Toggle 10-second auto refresh">
            Auto Refresh: {auto ? '10s' : 'off'}
          </button>
          <button className="btn ghost"  aria-label="Refresh now" onClick={refresh} disabled={loading}>{loading ? '↻ …' : '↻'}</button>
          <button className="btn ghost" onClick={exportCsv} aria-label="Export report">⬇ Export Report</button>
          <div style={{ position: 'relative' }}>
            <button className="btn " onClick={() => setShowWidgetMenu((s) => !s)} aria-haspopup="true" aria-expanded={showWidgetMenu}>+ Add Widget</button>
            {showWidgetMenu ? (
              <div role="menu" style={{ position: 'absolute', right: 0, top: '110%', zIndex: 20, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: 10, width: 240, boxShadow: '0 8px 24px rgba(0,0,0,.08)' }}>
                <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>Show / hide widgets</div>
                {WIDGETS.map((w) => (
                  <label key={w} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px', fontSize: 12.5 }}>
                    <input type="checkbox" checked={visible(w)} onChange={() => { const next = new Set(hidden); if (next.has(w)) next.delete(w); else next.add(w); persistHidden(next); }} />
                    {WIDGET_LABELS[w]}
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {scopedTenantId ? (
        <div className="pill" style={{ alignSelf: 'flex-start', background: 'var(--warn-bg)', color: 'var(--g7)', borderColor: '#F0D79A' }}>
          Scoped to {scopedTenantName} <span style={{ opacity: 0.7, fontWeight: 500 }}>· governance KPIs stay platform-wide</span>
        </div>
      ) : null}

      {visible('kpis') ? <div className=" grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2.5">{kpis.map((kp) => <KpiCard key={kp.label} k={kp} onGo={go} />)}</div> : null}

      {/* ---- main grid: tenant live monitor (left) + health & alerts (right) ---- */}
      <div className="grid grid-cols-1  xl:grid-cols-[minmax(0,1fr)_380px] gap-3">
        {visible('tenants') ? (
          <section className="panel min-w-0" aria-label="All Tenants Live Monitor">
            <div className="phead">
              <h2 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>All Tenants Live Monitor <span className="pill" style={{ background: '#EAF2F8', color: 'var(--info)', borderColor: '#CFE0EF' }}>Live Data</span></h2>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <select aria-label="Filter by plan" value={planFilter} onChange={(e) => setPlanFilter(e.target.value)} style={{ height: 32, border: '1px solid var(--line)', borderRadius: 9, background: '#FFFDF8', fontFamily: 'inherit', fontSize: 12 }}>
                  <option value="all">All Plans</option>{planOptions.map((pl) => <option key={pl} value={pl}>{pl}</option>)}
                </select>
                <input aria-label="Search tenant" placeholder="Search tenant..." value={tenantSearch} onChange={(e) => setTenantSearch(e.target.value)} style={{ height: 32, border: '1px solid var(--line)', borderRadius: 9, background: '#FFFDF8', padding: '0 10px', fontFamily: 'inherit', fontSize: 12 }} />
              </div>
            </div>
            <div className="sub" style={{ marginTop: -4, marginBottom: 6 }}>Real-time operations across all tenants</div>
            <div className="w-full min-w-0 overflow-auto">
              <table className="w-full min-w-[900px] border-collapse text-xs">
                <thead><tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                  {['Tenant / Owner', 'Plan', 'Branches', 'Check-In', 'Queue', 'Serving', 'Done', 'Checkout', 'Revenue Today', 'Devices', 'Live', 'Action'].map((h) => <th key={h} scope="col" style={{ padding: '6px 8px', position: 'sticky', top: 0, background: 'var(--card)' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {pageRows.length === 0 ? <tr><td colSpan={12} className="state">No tenants match.</td></tr> : pageRows.map((r) => (
                    <tr key={r.tenantId} style={{ borderTop: '1px solid var(--line)' }}>
                      <td style={{ padding: '7px 8px', fontWeight: 600 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                          <ProfileAvatarWithPreview
                            name={r.ownerName || r.name}
                            url={r.ownerAvatarUrl}
                            size={32}
                            type="admin"
                            badgeLabel="Owner / Tenant Profile"
                            subtitle={r.name}
                            showPreview={true}
                          />
                          <div>
                            <div>{r.name}</div>
                            <div className="muted" style={{ fontSize: 10.5, fontWeight: 400 }}>{r.ownerName || '—'}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '7px 8px' }}>{r.plan ? <span className="pill" style={{ background: 'var(--warn-bg)', color: 'var(--g7)', borderColor: '#F0D79A' }}>{r.plan}</span> : <span className="muted">—</span>}</td>
                      <td style={{ padding: '7px 8px' }} className={r.branchCount == null ? 'muted' : ''}>{r.branchCount ?? '—'}</td>
                      <td style={{ padding: '7px 8px' }}>{r.checkin ?? '—'}</td>
                      <td style={{ padding: '7px 8px' }}>{r.queue ?? '—'}</td>
                      <td style={{ padding: '7px 8px' }}>{r.serving ?? '—'}</td>
                      <td style={{ padding: '7px 8px' }} className={r.serviceDone == null ? 'muted' : ''}>{r.serviceDone ?? '—'}</td>
                      <td style={{ padding: '7px 8px' }} className={r.checkout == null ? 'muted' : ''}>{r.checkout ?? '—'}</td>
                      <td style={{ padding: '7px 8px', fontWeight: 600 }}>{r.revenueTodayCents != null ? moneyM(r.revenueTodayCents) : '—'} {r.growth != null ? <span style={{ color: r.growth >= 0 ? 'var(--ok)' : 'var(--danger)', fontWeight: 700 }}>{pctStr(r.growth)}</span> : null}</td>
                      <td style={{ padding: '7px 8px' }} className={r.deviceTotal == null ? 'muted' : ''}>{r.deviceTotal == null ? '—' : <span><span style={{ color: (r.deviceOnline ?? 0) > 0 ? 'var(--ok)' : 'var(--muted)', fontWeight: 600 }}>{r.deviceOnline}</span>/{r.deviceTotal}</span>}</td>
                      <td style={{ padding: '7px 8px' }}><span className="pill" style={{ background: r.live === 'live' ? 'var(--ok-bg)' : '#FBEBE8', color: r.live === 'live' ? 'var(--ok)' : 'var(--danger)', borderColor: r.live === 'live' ? '#BFE3C6' : '#E8C3BC' }}>{r.live === 'live' ? 'Live' : 'Offline'}</span></td>
                      <td style={{ padding: '7px 8px' }}><button className="linkbtn" aria-label={`View ${r.name} monitoring detail`} onClick={() => nav(`/tenants?focus=${encodeURIComponent(r.tenantId)}`)}>View</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 11.5 }}>
              <span className="muted">Showing {filteredRows.length === 0 ? 0 : (page - 1) * pageSize + 1} to {Math.min(page * pageSize, filteredRows.length)} of {filteredRows.length} tenants</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                <button className="linkbtn" disabled={page <= 1} onClick={() => setPage((x) => x - 1)} aria-label="Previous page">‹</button>
                <span>{page} / {pageCount}</span>
                <button className="linkbtn" disabled={page >= pageCount} onClick={() => setPage((x) => x + 1)} aria-label="Next page">›</button>
                <select aria-label="Rows per page" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} style={{ height: 28, border: '1px solid var(--line)', borderRadius: 8, background: '#FFFDF8', fontFamily: 'inherit', fontSize: 11.5 }}>
                  {[10, 25, 50].map((n) => <option key={n} value={n}>{n}/page</option>)}
                </select>
              </div>
            </div>
          </section>
        ) : null}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {visible('health') ? (
            <section className="panel" aria-label="System Health">
              <div className="phead"><h2>System Health</h2><span className="muted" style={{ fontSize: 11 }}>{healthLabel}</span></div>
              {healthRows.map((r) => (
                <div key={r.name} className="arow" style={{ display: 'flex', alignItems: 'center', padding: '5px 0', fontSize: 12.5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: r.ok === true ? 'var(--ok)' : r.ok === false ? 'var(--danger)' : 'var(--muted)', marginRight: 8 }} />
                  <span>{r.name}</span>
                  <span style={{ marginLeft: 'auto' }} className={r.ok === true ? '' : 'muted'}>{r.ok === true ? 'Healthy' : r.ok === false ? 'Degraded' : 'Unknown'} <span className="muted" style={{ fontSize: 10.5 }}>· {r.detail}</span></span>
                </div>
              ))}
              <button className="linkbtn" style={{ marginTop: 6 }} onClick={() => nav('/system-health')}>View System Status →</button>
            </section>
          ) : null}
          {visible('alerts') ? (
            <section className="panel" aria-label="Live Alerts">
              <div className="phead"><h2 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>Live Alerts {state && state.recentAlerts.length ? <span className="pill" style={{ background: '#FBEBE8', color: 'var(--danger)', borderColor: '#E8C3BC' }}>{state.recentAlerts.length}</span> : null}</h2><button className="linkbtn" onClick={() => nav('/alerts')}>View All</button></div>
              {!state || state.recentAlerts.length === 0 ? <div className="state" style={{ padding: '18px 0' }}>No active alerts.</div> : state.recentAlerts.slice(0, 6).map((a) => {
                const tone = SEVERITY_TONE[a.severity] || SEVERITY_TONE.info;
                return (
                  <div key={a.id} className="alertrow" onClick={() => a.to && nav(a.to)} style={{ cursor: a.to ? 'pointer' : 'default' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: tone.fg, flex: 'none' }} />
                    <div style={{ minWidth: 0, flex: 1 }}><div className="at" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.title}</div></div>
                    <span className="pill" style={{ background: tone.bg, color: tone.fg, borderColor: 'transparent' }}>{tone.label}</span>
                    <span className="aage">{a.ageLabel}</span>
                  </div>
                );
              })}
              <button className="linkbtn" style={{ marginTop: 6 }} onClick={() => nav('/alerts')}>View All Alerts →</button>
            </section>
          ) : null}
        </div>
      </div>

      {/* ---- revenue / pipeline+queue / devices / top tenants ---- */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[0.8fr_1.2fr_0.7fr] gap-3">
        {visible('revenue') ? (
          <section className="panel" aria-label="Live Revenue Monitor">
            <div className="phead"><h2>Live Revenue Monitor</h2>
              <div className="seg">{(['day', 'week', 'month'] as Range[]).map((r) => <button key={r} className={'segbtn' + (range === r ? ' on' : '')} onClick={() => setRange(r)}>{r[0].toUpperCase() + r.slice(1)}</button>)}</div>
            </div>
            <div className="sub" style={{ marginTop: -4, marginBottom: 6 }}>Hourly collected revenue — today vs. yesterday, across all tenants</div>
            <RevenueChart today={mods.revenueHourly?.today} yesterday={mods.revenueHourly?.yesterday} />
          </section>
        ) : null}
        {visible('pipeline') ? (
          <section className="panel" aria-label="Daily Service Pipeline">
            <div className="phead"><h2>Daily Service Pipeline</h2></div>
            <div style={{ display: 'flex', alignItems: 'stretch', gap: 4, overflowX: 'auto' }}>
              {pipeline.map((s, i) => (
                <div key={s.label} style={{ display: 'flex', alignItems: 'center' }}>
                  <button className="qbtn" style={{ minWidth: 78, minHeight: 64, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }} onClick={() => nav(s.to)} aria-label={`${s.label}: ${s.value} — open monitor`}>
                    <Glyph icon={s.key} color="var(--g7)" />
                    <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 16 }}>{s.value}</span>
                    <span style={{ fontSize: 9.5 }} className="muted">{s.label}</span>
                  </button>
                  {i < pipeline.length - 1 ? <span aria-hidden="true" style={{ color: 'var(--muted)', padding: '0 1px' }}>›</span> : null}
                </div>
              ))}
            </div>
            {visible('queueByBranch') ? (
              <div style={{ marginTop: 12 }}>
                <h2 style={{ fontSize: 13 }}>Live Queue Monitor by Branch</h2>
                {queueByBranch.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No active queues.</div> : (() => { const max = Math.max(1, ...queueByBranch.map((b) => b.count)); return queueByBranch.map((b, i) => (
                  <div key={b.branch} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0', cursor: 'pointer' }} onClick={() => nav('/queue-management')}>
                    <span style={{ fontSize: 11, width: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i + 1}. {b.branch}</span>
                    <span style={{ flex: 1, height: 9, background: 'var(--line)', borderRadius: 5 }}><span style={{ display: 'block', width: `${(b.count / max) * 100}%`, height: 9, background: b.count >= max * 0.75 ? 'var(--danger)' : b.count >= max * 0.4 ? 'var(--warn)' : 'var(--ok)', borderRadius: 5 }} /></span>
                    <span style={{ fontSize: 11, fontWeight: 700, width: 20, textAlign: 'right' }}>{b.count}</span>
                  </div>
                )); })()}
              </div>
            ) : null}
          </section>
        ) : null}
        {visible('devices') ? (
          <section className="panel" aria-label="Active POS Devices">
            <div className="phead"><h2>Active POS Devices</h2></div>
            {!dev ? <div className="state">Device data NotConnected.</div> : <DeviceDonut online={dev.online} offline={dev.offline} onGo={(f) => nav(`/devices-management?status=${f}`)} />}
          </section>
        ) : null}
      </div>

      {visible('topTenants') ? (
        <section className="panel" aria-label="Top Performing Tenants">
          <div className="phead"><h2>Top Performing Tenants</h2><button className="linkbtn" onClick={() => nav('/platform-reports?report=tenant-performance')}>View All Tenants</button></div>
          {!state || state.topPerformingTenants.length === 0 ? <div className="state">No tenant volume yet.</div> : (
            <table className="tgrid" style={{ width: '100%', fontSize: 12.5 }}><tbody>
              {state.topPerformingTenants.slice(0, 5).map((tp) => (
                <tr key={tp.tenantId} style={{ cursor: 'pointer', borderTop: '1px solid var(--line)' }} onClick={() => nav(`/tenants?focus=${encodeURIComponent(tp.tenantId)}`)}>
                  <td style={{ padding: '6px 4px', color: 'var(--muted)' }}>{tp.rank}</td>
                  <td style={{ padding: '6px 4px', fontWeight: 600 }}>{tp.name}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: 700 }}>{moneyM(tp.monthlyVolumeCents)}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }} className="muted">{tp.growthPercent == null ? '—' : <span style={{ color: tp.growthPercent >= 0 ? 'var(--ok)' : 'var(--danger)' }}>{pctStr(tp.growthPercent)}</span>}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </section>
      ) : null}

      {/* ---- activity / appointments / technicians / branch performance ---- */}
      <div className="grid3">
        {visible('activity') ? (
          <section className="panel" aria-label="Recent Platform Activity">
            <div className="phead"><h2>Recent Platform Activity</h2><button className="linkbtn" onClick={() => nav('/tenant-activity')}>View All Activity</button></div>
            {!state || state.recentActivity.length === 0 ? <div className="state">No recent activity.</div> : state.recentActivity.slice(0, 6).map((a) => (
              <div key={a.id} style={{ padding: '5px 0', fontSize: 12.5, borderBottom: '1px solid var(--line)' }}><div style={{ fontWeight: 600 }}>{a.title}</div><div className="muted" style={{ fontSize: 11 }}>{[a.tenantName, a.ageLabel].filter(Boolean).join(' · ')}</div></div>
            ))}
          </section>
        ) : null}
        {visible('appointments') ? (
          <section className="panel" aria-label="Upcoming Appointments">
            <div className="phead"><h2>Upcoming Appointments</h2><button className="linkbtn" onClick={() => nav('/appointment-oversight')}>View All</button></div>
            {!appts || appts.rows.length === 0 ? <div className="state">No upcoming appointments.</div> : appts.rows.slice(0, 6).map((a) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', fontSize: 12, borderBottom: '1px solid var(--line)' }}>
                <span style={{ fontWeight: 700, width: 68, flex: 'none', color: 'var(--text)' }}>
                  {formatApptTime(a.startTime || (a as any).start_time, (a as any).apptDate || (a as any).appt_date)}
                </span>
                <ProfileAvatarWithPreview
                  name={a.customerName || 'Customer'}
                  url={(a as any).customerAvatarUrl}
                  size={32}
                  type="customer"
                  badgeLabel="Customer Profile"
                  showPreview={true}
                />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.customerName}</div>
                  <div className="muted" style={{ fontSize: 10.5 }}>{formatServiceName(a.services?.[0])} · {a.tenantName || '—'}</div>
                </span>
              </div>
            ))}
          </section>
        ) : null}
        {visible('technicians') ? (
          <section className="panel" aria-label="Technician Activity">
            <div className="phead"><h2>Technician Activity <span className="pill ok" style={{ fontSize: 9 }}>Live</span></h2><button className="linkbtn" onClick={() => nav('/staff')}>View All</button></div>
            {technicians.length === 0 ? <div className="state">No technicians actively serving.</div> : technicians.map((te) => (
              <div key={te.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', fontSize: 12 }}>
                <ProfileAvatarWithPreview
                  name={te.name}
                  url={te.photoUrl}
                  size={32}
                  type="technician"
                  badgeLabel="Technician Profile"
                  subtitle={te.service || 'In service'}
                  showPreview={true}
                />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{te.name}</div>
                  <div className="muted" style={{ fontSize: 10.5 }}>{te.service || 'In service'}</div>
                </span>
                <span style={{ width: 80, height: 7, background: 'var(--line)', borderRadius: 4, flex: 'none' }}>
                  <span style={{ display: 'block', width: `${te.ratio * 100}%`, height: 7, background: 'var(--g7)', borderRadius: 4 }} />
                </span>
                <span style={{ width: 56, textAlign: 'right' }} className="muted">{te.serving} · <span title="capacity not connected">—%</span></span>
              </div>
            ))}
          </section>
        ) : null}
      </div>

      {visible('branches') ? (
        <section className="panel" aria-label="Branch Performance Overview">
          <div className="phead"><h2>Branch Performance Overview</h2><button className="linkbtn" onClick={() => nav('/branches')}>View All Branches</button></div>
          {!mods.branches || mods.branches.directory.length === 0 ? <div className="state">No branch data.</div> : (
            <table className="tgrid" style={{ width: '100%', fontSize: 12.5 }}><tbody>
              {[...mods.branches.directory].sort((a, b) => b.revenueMtdCents - a.revenueMtdCents).slice(0, 5).map((b, i) => (
                <tr key={b.id} style={{ cursor: 'pointer', borderTop: '1px solid var(--line)' }} onClick={() => nav('/branches')}>
                  <td style={{ padding: '6px 4px', color: 'var(--muted)' }}>{i + 1}</td>
                  <td style={{ padding: '6px 4px', fontWeight: 600 }}>{b.name}<span className="muted" style={{ fontWeight: 400 }}> · {b.tenantName || '—'}</span></td>
                  <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: 700 }}>{moneyM(b.revenueMtdCents)}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }} className="muted">{b.todaysAppts} appts</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </section>
      ) : null}

      {visible('quickActions') ? (
        <section className="panel" aria-label="Quick Actions">
          <div className="phead"><h2>Quick Actions</h2></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
            {quickActions.map((a) => {
              const enabled = actionEnabled(a.permKey);
              return <button key={a.label} className="qbtn" disabled={!enabled} title={enabled ? undefined : 'You do not have permission for this action'} onClick={a.run}>{a.label}</button>;
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

// today vs. yesterday intraday revenue — two real lines from hourly tickets.paid_at (cents per hour, index 0..23)
function RevenueChart({ today, yesterday }: { today?: number[]; yesterday?: number[] }) {
  const td = today && today.length === 24 ? today : null;
  const yd = yesterday && yesterday.length === 24 ? yesterday : null;
  if (!td && !yd) return <div className="state">Hourly revenue NotConnected.</div>;
  const tArr = td ?? Array.from({ length: 24 }, () => 0);
  const yArr = yd ?? Array.from({ length: 24 }, () => 0);
  if (tArr.every((v) => v === 0) && yArr.every((v) => v === 0)) return <div className="state">No revenue today or yesterday yet.</div>;
  const W = 520, H = 160, pad = 30;
  const max = Math.max(1, ...tArr, ...yArr);
  const stepX = (W - pad * 2) / 23;
  const y = (v: number) => H - 28 - (v / max) * (H - 50);
  const line = (arr: number[]) => arr.map((v, i) => `${pad + i * stepX},${y(v)}`).join(' ');
  const hourLabel = (h: number) => `${(h % 12) || 12}${h < 12 ? 'a' : 'p'}`;
  const tTotal = tArr.reduce((a, b) => a + b, 0);
  const yTotal = yArr.reduce((a, b) => a + b, 0);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 160 }} role="img" aria-label={`Hourly revenue, today peak ${dollars(Math.max(0, ...tArr))}, yesterday peak ${dollars(Math.max(0, ...yArr))}`}>
        <title>Hourly revenue — today vs. yesterday</title>
        {yd ? <polyline points={line(yArr)} fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.8" /> : null}
        {td ? <polyline points={line(tArr)} fill="none" stroke="var(--g7)" strokeWidth="2" /> : null}
        {Array.from({ length: 24 }, (_, i) => i).map((h) => h % 3 === 0 ? <text key={h} x={pad + h * stepX} y={H - 8} fontSize="9" fill="var(--muted)" textAnchor="middle">{hourLabel(h)}</text> : null)}
      </svg>
      <div className="muted" style={{ fontSize: 11, marginTop: 4, display: 'flex', gap: 16 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 14, height: 2, background: 'var(--g7)', display: 'inline-block' }} />Today <strong style={{ color: 'var(--text)' }}>{dollars(tTotal)}</strong></span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 14, height: 0, borderTop: '2px dashed var(--muted)', display: 'inline-block' }} />Yesterday <strong style={{ color: 'var(--text)' }}>{dollars(yTotal)}</strong></span>
      </div>
    </div>
  );
}

function DeviceDonut({ online, offline, onGo }: { online: number; offline: number; onGo: (f: 'online' | 'offline') => void }) {
  const total = online + offline;
  if (total === 0) return <div className="state">No devices registered.</div>;
  const R = 54, C = 2 * Math.PI * R;
  const onDash = (online / total) * C;
  const onlinePct = ((online / total) * 100).toFixed(1);
  const offlinePct = ((offline / total) * 100).toFixed(1);
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
      <svg viewBox="0 0 140 140" style={{ width: 120, height: 120, flex: 'none' }} role="img" aria-label={`${online} online, ${offline} offline of ${total} devices`}>
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--danger)" strokeWidth="16" />
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--ok)" strokeWidth="16" strokeDasharray={`${onDash} ${C - onDash}`} transform="rotate(-90 70 70)" />
        <text x="70" y="66" textAnchor="middle" fontSize="20" fontWeight="800" fill="var(--text)">{compact(total)}</text>
        <text x="70" y="84" textAnchor="middle" fontSize="9" fill="var(--muted)">Total Devices</text>
      </svg>
      <div style={{ flex: 1, fontSize: 12.5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', cursor: 'pointer' }} onClick={() => onGo('online')}><span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--ok)' }} />Online<span style={{ marginLeft: 'auto', fontWeight: 700 }}>{online.toLocaleString()} <span className="muted">({onlinePct}%)</span></span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', cursor: 'pointer' }} onClick={() => onGo('offline')}><span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--danger)' }} />Offline<span style={{ marginLeft: 'auto', fontWeight: 700 }}>{offline.toLocaleString()} <span className="muted">({offlinePct}%)</span></span></div>
      </div>
    </div>
  );
}

export default LiveOperationsScreen;
