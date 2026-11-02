import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInlineAsk } from '@aipowersalon/ui';
import {
  superAdminQueueApi, lqTechConnected,
  type LiveQueueOverview, type LiveQueueQuery, type LQRow, type LQThresholdFlag,
} from '../api/superAdminQueueApi';

// QueueManagementScreen — Super Admin → Operations Oversight → Live Queue Monitor. Platform-wide (cross-tenant)
// real-time monitor over /super-admin/queue/live-overview (pos_queue_items + technicians.status + device heartbeat).
// READ-ONLY oversight: there are deliberately NO reorder / assign / start / complete / checkout controls — those live
// in each salon's POS. Modules with no canonical source (per-item sync, full timelines) render NotConnected, never
// faked. Cream/gold design system, Mac-fit (the .screen scrolls internally; tables scroll inside their panels).

const GOLD = 'var(--g7,#A96F22)';
const titleCase = (s: string): string => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const fmtWait = (m: number): string => (m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`);
const fmtClock = (d: Date): string => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const fmtTime = (iso: string): string => { const d = new Date(iso); return isNaN(+d) ? '—' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
const num = (v: number | null): string => (v == null ? '—' : v.toLocaleString());
const pct = (v: number | null): string => (v == null ? 'NotConnected' : `${v.toFixed(1)}%`);
const scrollTo = (el: HTMLElement | null | undefined) => { if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

export type LiveQueueView = 'all' | 'timelines' | 'stuck' | 'sync' | 'wait-times';

const VIEW_TITLE: Record<LiveQueueView, string> = {
  all: 'All Queues', timelines: 'Queue Timelines', stuck: 'Stuck Records', sync: 'Sync Status', 'wait-times': 'Wait-Time Analytics',
};

const STATUS_COLOR: Record<string, string> = { waiting: '#D09A36', called: '#3C7FB6', assigned: '#A96F22', in_service: '#3E8F57', unassigned: '#B85B4D', cancelled: '#9B8B78', removed: '#9B8B78' };
const BUCKET_COLOR: Record<string, string> = { in_service: '#3E8F57', waiting: '#D09A36', assigned: '#A96F22', unassigned: '#B85B4D', other: '#9B8B78' };
const FLAG_COLOR: Record<LQThresholdFlag, string> = { none: '#9B8B78', warning: '#D09A36', alert: '#C9772E', critical: '#B85B4D' };

const ICON = {
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  scissors: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12',
  gauge: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 12l4-4',
  hourglass: 'M5 22h14M5 2h14M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2',
  userx: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17 8l5 5M22 8l-5 5',
  sync: 'M21 2v6h-6M3 22v-6h6M3.51 9a9 9 0 0 1 14.13-3.36L21 8M3 16l3.36 2.36A9 9 0 0 0 20.49 15',
  alert: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 8v4M12 16h.01',
  device: 'M4 4h16v12H4zM2 20h20M9 16v4h6v-4',
  flag: 'M4 22V4M4 4h12l-2 4 2 4H4',
  building: 'M3 21h18M5 21V7l8-4v18M19 21V11l-6-3',
  star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  ticket: 'M3 9a3 3 0 0 0 0 6v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3a3 3 0 0 1 0-6V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2z',
  plus: 'M12 5v14M5 12h14',
  dots: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  shield: 'M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6l8-4z',
  filter: 'M22 3H2l8 9.46V19l4 2v-8.54L22 3z',
  chevR: 'M9 18l6-6-6-6',
};

function IconTile({ bg, fg, path, size = 38 }: { bg: string; fg: string; path: string; size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: 11, background: bg, display: 'grid', placeItems: 'center', flex: 'none' }}>
      <svg width={size * 0.53} height={size * 0.53} viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>
    </div>
  );
}
function Glyph({ path, c = 'currentColor', s = 15 }: { path: string; c?: string; s?: number }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><path d={path} /></svg>;
}

// --- lightweight dependency-free SVG charts -------------------------------------------------------------------------
function Donut({ data, total, centerTop, centerBottom }: { data: { label: string; count: number; color: string }[]; total: number; centerTop: string; centerBottom: string }) {
  const r = 52, c = 2 * Math.PI * r, cx = 70, cy = 70;
  let acc = 0;
  const segs = total > 0 ? data.filter((d) => d.count > 0) : [];
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width="140" height="140" viewBox="0 0 140 140" style={{ flex: 'none' }} role="img" aria-label={`${centerTop} ${centerBottom}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--line)" strokeWidth="14" />
        {segs.map((d, i) => {
          const frac = d.count / total; const dash = frac * c; const off = -acc * c; acc += frac;
          return <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={d.color} strokeWidth="14" strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={off} transform={`rotate(-90 ${cx} ${cy})`} strokeLinecap="butt" />;
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" style={{ fontFamily: 'Playfair Display, serif', fontSize: 22, fill: 'var(--ink,#2A2118)' }}>{centerTop}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" style={{ fontSize: 10.5, fill: 'var(--muted)' }}>{centerBottom}</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 }}>
        {data.map((d) => (
          <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: d.color, flex: 'none' }} />
            <span style={{ flex: 1, color: 'var(--muted)' }}>{d.label}</span>
            <span style={{ fontWeight: 800 }}>{d.count.toLocaleString()}</span>
            <span style={{ color: 'var(--muted)', fontSize: 11, width: 44, textAlign: 'right' }}>{total > 0 ? `${((d.count / total) * 100).toFixed(1)}%` : '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
function VBars({ data, unit, onPick }: { data: { label: string; value: number }[]; unit: string; onPick?: (i: number) => void }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', height: 150, padding: '6px 2px' }}>
      {data.map((d, i) => (
        <button key={d.label} onClick={() => onPick?.(i)} title={`${d.label}: ${d.value} ${unit}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: onPick ? 'pointer' : 'default', minWidth: 0 }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--muted)' }}>{d.value}</span>
          <span style={{ width: '78%', maxWidth: 34, height: `${Math.max(4, (d.value / max) * 110)}px`, background: 'linear-gradient(180deg,#4F9BD0,#3C7FB6)', borderRadius: '6px 6px 0 0' }} />
          <span style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{d.label}</span>
        </button>
      ))}
    </div>
  );
}
function HBars({ data, onPick }: { data: { label: string; value: number }[]; onPick?: (i: number) => void }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {data.map((d, i) => (
        <button key={d.label} onClick={() => onPick?.(i)} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', padding: 0, cursor: onPick ? 'pointer' : 'default', textAlign: 'left' }}>
          <span style={{ width: 78, fontSize: 11.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 'none' }}>{d.label}</span>
          <span style={{ flex: 1, height: 12, background: 'var(--line)', borderRadius: 999, overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${(d.value / max) * 100}%`, background: `linear-gradient(90deg,#E08A3C,${GOLD})`, borderRadius: 999 }} /></span>
          <span style={{ width: 30, textAlign: 'right', fontWeight: 800, fontSize: 12, flex: 'none' }}>{d.value}</span>
        </button>
      ))}
    </div>
  );
}
function LineTrend({ points }: { points: { hour: number; count: number }[] }) {
  const W = 320, H = 130, pad = 22;
  const byHour = new Map(points.map((p) => [p.hour, p.count]));
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: byHour.get(h) ?? 0 }));
  const max = Math.max(1, ...hours.map((h) => h.count));
  const x = (h: number) => pad + (h / 23) * (W - pad * 2);
  const y = (cnt: number) => H - pad - (cnt / max) * (H - pad * 2);
  const path = hours.map((h, i) => `${i === 0 ? 'M' : 'L'}${x(h.hour).toFixed(1)},${y(h.count).toFixed(1)}`).join(' ');
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Queue entries created per hour today" style={{ display: 'block' }}>
      {[0, max].map((g) => <line key={g} x1={pad} x2={W - pad} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeWidth="1" />)}
      <path d={path} fill="none" stroke={GOLD} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {hours.filter((h) => h.hour % 4 === 0).map((h) => <circle key={h.hour} cx={x(h.hour)} cy={y(h.count)} r="2.6" fill={GOLD} />)}
      {['12 AM', '4 AM', '8 AM', '12 PM', '4 PM', '8 PM'].map((lbl, i) => <text key={lbl} x={x(i * 4)} y={H - 6} textAnchor="middle" style={{ fontSize: 9, fill: 'var(--muted)' }}>{lbl}</text>)}
    </svg>
  );
}

// CSV with formula-injection guard (mirrors the onboarding export pattern)
const csvCell = (v: unknown): string => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
};
function downloadCsv(filename: string, headers: string[], rows: (string | number | null)[][]) {
  const body = [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n');
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Banner({ text }: { text: string }) {
  return <div role="status" style={{ fontSize: 12, color: GOLD, background: 'var(--cream,#FBF6EC)', border: '1px solid var(--gline,#E7D6B8)', borderRadius: 10, padding: '7px 12px', marginBottom: 10 }}>{text}</div>;
}

// Business-semantic trend chip: green when the change is favorable for operations, red when unfavorable, neutral when
// flat. Renders nothing when there's no comparison snapshot yet (honest — no fabricated "vs yesterday").
function TrendChip({ t }: { t?: import('../api/superAdminQueueApi').LQMetricTrend }) {
  if (!t) return null;
  const color = t.favorable == null ? 'var(--muted)' : t.favorable ? '#3E8F57' : '#B85B4D';
  const arrow = t.delta > 0 ? '▲' : t.delta < 0 ? '▼' : '•';
  const mag = t.pct != null ? `${Math.abs(t.pct).toFixed(1)}%` : `${Math.abs(t.delta)}`;
  return <div style={{ fontSize: 10.5, fontWeight: 700, color, marginTop: 1 }} aria-label={`${t.favorable == null ? 'no change' : t.favorable ? 'favorable' : 'unfavorable'} ${arrow} ${mag}`}>{arrow} {mag} vs prior</div>;
}

const OVERSIGHT_ACTIONS: { key: string; label: string; icon: string }[] = [
  { key: 'filter', label: 'Filter queues by tenant or branch', icon: ICON.filter },
  { key: 'timelines', label: 'Review queue timelines', icon: ICON.clock },
  { key: 'stuck', label: 'Investigate stuck records', icon: ICON.alert },
  { key: 'sync', label: 'Retry synchronization', icon: ICON.sync },
  { key: 'notify', label: 'Notify branch manager', icon: ICON.users },
  { key: 'incident', label: 'Open support incident', icon: ICON.ticket },
  { key: 'history', label: 'View queue history', icon: ICON.gauge },
  { key: 'export', label: 'Export wait-time analytics', icon: ICON.download },
];

const SUPPORT_MODE_ACTION = 'Support mode: show this salon\'s names';
const ROW_ACTIONS = ['View queue record', 'Review queue timeline', 'Review queue history', 'Investigate stuck record', 'Notify branch manager', 'Open support incident', SUPPORT_MODE_ACTION, 'Acknowledge alert'];

export default function QueueManagementScreen({ view = 'all' }: { view?: LiveQueueView } = {}) {
  const nav = useNavigate();
  const [data, setData] = useState<LiveQueueOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [asOf, setAsOf] = useState<Date | null>(null);
  const [q, setQ] = useState<LiveQueueQuery>({ page: 1, pageSize: 10, sort: 'wait', direction: 'desc' });
  const [searchInput, setSearchInput] = useState('');
  const [menuRow, setMenuRow] = useState<string | null>(null);
  const [incident, setIncident] = useState<{ tenantId: string; branchId: string | null; tenantName: string | null; branchName: string | null; queueId: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { ask, askUi } = useInlineAsk();
  const liveRef = useRef<HTMLDivElement | null>(null);
  const syncRef = useRef<HTMLDivElement | null>(null);
  const waitRef = useRef<HTMLDivElement | null>(null);
  const eventsRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback((opts?: { silent?: boolean }) => {
    if (opts?.silent) setRefreshing(true);
    setError(null);
    superAdminQueueApi.liveOverview(q)
      .then((res) => { setData(res); setAsOf(new Date()); })
      .catch((e: any) => setError(e?.message || 'Couldn’t load the Live Queue Monitor. Retry, or check the platform API.'))
      .finally(() => setRefreshing(false));
  }, [q]);

  // debounce search → filter
  useEffect(() => { const t = setTimeout(() => setQ((p) => ({ ...p, search: searchInput.trim() || undefined, page: 1 })), 300); return () => clearTimeout(t); }, [searchInput]);
  useEffect(() => { load(); }, [load]);
  // background refresh every 15s, paused when the tab is hidden (preserves last good data on failure)
  useEffect(() => {
    const tick = () => { if (!document.hidden) load({ silent: true }); };
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, [load]);
  // view-driven focus
  useEffect(() => {
    const map: Record<LiveQueueView, React.RefObject<HTMLDivElement | null>> = { all: liveRef, stuck: liveRef, sync: syncRef, 'wait-times': waitRef, timelines: eventsRef };
    const el = map[view]?.current; scrollTo(el);
  }, [view, data]);

  const setSort = (col: string) => setQ((p) => ({ ...p, sort: col, direction: p.sort === col && p.direction === 'desc' ? 'asc' : 'desc', page: 1 }));
  const setStatus = (status?: string) => setQ((p) => ({ ...p, status, page: 1 }));
  const flash = (m: string) => { setNotice(m); setTimeout(() => setNotice(null), 4000); };

  const rows = useMemo(() => {
    const all = data?.queues.rows ?? [];
    return view === 'stuck' ? all.filter((r) => r.stuck) : all;
  }, [data, view]);

  const onExport = useCallback(async () => {
    try {
      const csv = await superAdminQueueApi.exportCsv({ search: q.search, status: q.status, tenantId: q.tenantId, branchId: q.branchId, sort: q.sort, direction: q.direction, supportTenantId: q.supportTenantId });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `live-queue-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      flash('Exported the current queue view — built and audited server-side.');
    } catch {
      // honest fallback: build locally from the rows already on screen
      const rs = data?.queues.rows ?? [];
      downloadCsv(`live-queue-${new Date().toISOString().slice(0, 10)}.csv`,
        ['Queue ID', 'Customer', 'Tenant', 'Branch', 'Status', 'Wait (min)', 'Technician', 'Service', 'Device', 'Sync', 'Threshold', 'Stuck'],
        rs.map((r) => [r.queueId, r.customer, r.tenantName, r.branchName, titleCase(r.status), r.waitMin, r.technicianName ?? 'Unassigned', r.service ?? '', r.deviceStatus, r.syncStatus, r.thresholdFlag, r.stuck ? 'yes' : 'no']));
      flash('Server export was unavailable — exported the on-screen rows locally instead.');
    }
  }, [q, data]);

  const onExportXlsx = useCallback(async () => {
    try {
      const blob = await superAdminQueueApi.exportXlsx({ search: q.search, status: q.status, tenantId: q.tenantId, branchId: q.branchId, sort: q.sort, direction: q.direction, supportTenantId: q.supportTenantId });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `live-queue-${new Date().toISOString().slice(0, 10)}.xlsx`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      flash('Exported the current queue view to Excel — built and audited server-side.');
    } catch {
      flash('Excel export was unavailable — try CSV, which can also build from on-screen rows.');
    }
  }, [q]);

  const onExportPdf = useCallback(async () => {
    try {
      const blob = await superAdminQueueApi.exportPdf({ search: q.search, status: q.status, tenantId: q.tenantId, branchId: q.branchId, sort: q.sort, direction: q.direction, supportTenantId: q.supportTenantId });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `live-queue-${new Date().toISOString().slice(0, 10)}.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      flash('Exported the current queue view to PDF — built and audited server-side.');
    } catch {
      flash('PDF export was unavailable — try CSV or XLSX instead.');
    }
  }, [q]);

  const firstRow = data?.queues.rows[0];
  const onAction = (key: string, row?: LQRow) => {
    setMenuRow(null);
    const ctxRow = row ?? firstRow;
    switch (key) {
      case 'filter': scrollTo(liveRef.current); break;
      case 'timelines': case 'Review queue timeline': nav('/queue-management/timelines'); break;
      case 'stuck': case 'Investigate stuck records': case 'Investigate stuck record': nav('/queue-management/stuck'); break;
      case 'sync': case 'Retry synchronization': nav('/queue-management/sync'); break;
      case 'history': case 'Review queue history': nav('/queue-management/timelines'); break;
      case 'export': onExport(); break;
      case 'View queue record': flash(`Queue ${ctxRow ? ctxRow.queueId.slice(0, 8) : ''} — full record drawer opens here.`); break;
      case 'notify': case 'Notify branch manager': {
        if (!ctxRow) { flash('Select a queue row (or filter to a tenant) to notify its branch manager.'); break; }
        superAdminQueueApi.notifyBranch({ tenantId: ctxRow.tenantId, branchId: ctxRow.branchId ?? undefined, queueIds: [ctxRow.queueId], severity: ctxRow.thresholdFlag === 'critical' ? 'critical' : 'high', message: `Queue issue at ${ctxRow.branchName ?? 'branch'} — ${ctxRow.customer} waiting ${ctxRow.waitMin} min.` })
          .then((r) => flash(r.ok ? (r.reason ?? 'Branch manager notification recorded and audited.') : `Couldn’t notify: ${r.error}`))
          .catch((e: any) => flash(e?.message ?? 'Notify failed.'));
        break;
      }
      case 'incident': case 'Open support incident':
        if (!ctxRow) { flash('Select a queue row (or filter to a tenant) to open an incident with its context.'); break; }
        setIncident({ tenantId: ctxRow.tenantId, branchId: ctxRow.branchId, tenantName: ctxRow.tenantName, branchName: ctxRow.branchName, queueId: ctxRow.queueId });
        break;
      case SUPPORT_MODE_ACTION: {
        // Customer names are masked platform-wide (server-side). Support mode opens an audited controlled-support session
        // for ONE salon (reason required); the server unmasks only that salon's rows while the session is live.
        if (!ctxRow) { flash('Select a queue row first.'); break; }
        const row = ctxRow;
        ask(`Why do you need to see ${row.tenantName ?? 'this salon'}'s customer names? (recorded in the audit log)`, (reason) => {
          superAdminQueueApi.supportSession({ tenantId: row.tenantId, branchId: row.branchId ?? undefined, reason })
            .then((r) => { if (r.ok) { setQ((p) => ({ ...p, supportTenantId: row.tenantId })); flash(`Support session opened for ${row.tenantName ?? 'this salon'}.`); } else flash(`Couldn’t open support mode: ${r.error ?? 'refused'}`); })
            .catch((e: any) => flash(e?.message ?? 'Support mode failed.'));
        }, { confirmLabel: 'Open support session', inputLabel: 'Reason', minLength: 5 });
        break;
      }
      case 'Acknowledge alert': flash('Alert acknowledged for this session.'); break;
      default: flash('Opening record…');
    }
  };

  if (error && !data) return (
    <div className="screen"><div className="vh"><h1>Live Queue Monitor</h1></div>
      <div className="panel state" style={{ padding: 28, textAlign: 'center' }}><div style={{ color: 'var(--danger,#B85B4D)', fontWeight: 700, marginBottom: 6 }}>{error}</div><button className="linkbtn" onClick={() => load()}>Retry</button></div>
    </div>
  );
  if (!data) return <div className="screen"><div className="vh"><h1>Live Queue Monitor</h1></div><div className="state" style={{ padding: 28 }}>Loading…</div></div>;

  const k = data.kpis;
  const kpis = [
    { l: 'Customers Waiting', m: 'customersWaiting', v: num(k.customersWaiting), tile: { bg: '#FBF1DC', fg: '#D09A36', path: ICON.users }, onClick: () => setStatus('waiting') },
    { l: 'Technicians Available', m: 'techniciansAvailable', v: num(k.techniciansAvailable), tile: { bg: '#ECEAF7', fg: '#6C5CC4', path: ICON.users }, onClick: () => nav('/staff') },
    { l: 'Customers Being Served', m: 'customersInService', v: num(k.customersInService), tile: { bg: '#E4F0E8', fg: '#3E8F57', path: ICON.scissors }, onClick: () => setStatus('in_service') },
    { l: 'Average Wait Time', m: 'avgWaitMin', v: k.customersWaiting ? fmtWait(k.avgWaitMin) : '—', tile: { bg: '#E2EEF7', fg: '#3C7FB6', path: ICON.clock }, onClick: () => nav('/queue-management/wait-times') },
    { l: 'Longest Wait Time', m: 'longestWaitMin', v: k.customersWaiting ? fmtWait(k.longestWaitMin) : '—', tile: { bg: '#F7E9E4', fg: '#B85B4D', path: ICON.hourglass }, onClick: () => nav('/queue-management/wait-times') },
    { l: 'Unassigned Customers', m: 'unassignedCustomers', v: num(k.unassignedCustomers), tile: { bg: '#F7E9E4', fg: '#B85B4D', path: ICON.userx }, onClick: () => setStatus('unassigned') },
    { l: 'Queue Sync Status', m: 'queueSyncPct', v: pct(k.queueSyncPct), tile: { bg: '#E4F0E8', fg: '#3E8F57', path: ICON.sync }, onClick: () => nav('/queue-management/sync') },
    { l: 'Stuck Queue Records', m: 'stuckRecords', v: num(k.stuckRecords), tile: { bg: '#F7E9E4', fg: '#B85B4D', path: ICON.alert }, onClick: () => nav('/queue-management/stuck') },
    { l: 'Offline Queue Devices', m: 'offlineDevices', v: num(k.offlineDevices), tile: { bg: '#EEEDF0', fg: '#6B6B72', path: ICON.device }, onClick: () => nav('/devices-management') },
    { l: 'Customers Over Threshold', m: 'customersOverThreshold', v: num(k.customersOverThreshold), tile: { bg: '#F7E9E4', fg: '#C9772E', path: ICON.flag }, onClick: () => nav('/queue-management/wait-times') },
    { l: 'Congested Branches', m: 'congestedBranches', v: num(k.congestedBranches), tile: { bg: '#F7E9E4', fg: '#B85B4D', path: ICON.building }, onClick: () => nav('/queue-management/wait-times') },
  ];

  const dist = data.liveStatusDistribution;
  const distData = dist.slices.map((s) => ({ label: titleCase(s.bucket), count: s.count, color: BUCKET_COLOR[s.bucket] || '#9B8B78' }));
  const tech = data.technicianAvailability;
  const health = [
    { label: 'Congested Branches', count: data.healthAlerts.congestedBranches, sub: 'Queues above normal capacity', color: '#B85B4D', icon: ICON.building, to: '/queue-management/wait-times' },
    { label: 'Offline Queue Devices', count: data.healthAlerts.offlineDevices, sub: 'Not syncing with the platform', color: '#6B6B72', icon: ICON.device, to: '/devices-management' },
    { label: 'Customers Over Threshold', count: data.healthAlerts.customersOverThreshold, sub: 'Waiting beyond threshold time', color: '#C9772E', icon: ICON.flag, to: '/queue-management/wait-times' },
    { label: 'Stuck Queue Records', count: data.healthAlerts.stuckRecords, sub: 'Require manual intervention', color: '#B85B4D', icon: ICON.alert, to: '/queue-management/stuck' },
  ];
  const ts = data.todaySummary;
  const glance = [
    { l: 'Total Queues', m: 'totalQueues', v: num(ts.totalQueues) }, { l: 'Total Customers', m: 'totalCustomers', v: num(ts.totalCustomers) },
    { l: 'Average Wait Time', m: 'avgWaitMin', v: ts.totalQueues ? fmtWait(ts.avgWaitMin) : '—' }, { l: 'Longest Wait Time', m: 'longestWaitMin', v: ts.totalQueues ? fmtWait(ts.longestWaitMin) : '—' },
    { l: 'Completed Services', m: 'completedServices', v: num(ts.completedServices) }, { l: 'Threshold Breaches', m: 'customersOverThreshold', v: num(ts.thresholdBreaches) },
    { l: 'Sync Success Rate', m: 'queueSyncPct', v: pct(ts.syncSuccessPct) }, { l: 'Stuck Records', m: 'stuckRecords', v: num(ts.stuckRecords) }, { l: 'Offline Devices', m: 'offlineDevices', v: num(ts.offlineDevices) },
  ];

  const SortTh = ({ col, children }: { col: string; children: React.ReactNode }) => (
    <th onClick={() => setSort(col)} style={{ padding: '7px 8px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }} title="Sort">
      {children}{q.sort === col ? <span style={{ color: GOLD }}>{q.direction === 'desc' ? ' ↓' : ' ↑'}</span> : ''}
    </th>
  );

  return (
    <div className="screen p-5" style={{ display: 'flex', flexDirection: 'column', gap: 4 }} onClick={() => setMenuRow(null)}>
      {askUi}
      {/* privacy: names are masked unless the SERVER confirms support mode for one salon (audited) */}
      <div className="sub" role="note" style={{ fontSize: 12 }}>
        {data.supportMode
          ? <>Support mode: customer names visible for one salon only (audited). <button className="linkbtn" onClick={(e) => { e.stopPropagation(); setQ((p) => ({ ...p, supportTenantId: undefined })); }}>End support mode</button></>
          : q.supportTenantId
            ? <>Support mode was not granted for this salon — names stay masked. <button className="linkbtn" onClick={(e) => { e.stopPropagation(); setQ((p) => ({ ...p, supportTenantId: undefined })); }}>Clear</button></>
            : 'Customer names are masked. Open a row menu → “Support mode” to see one salon’s names during a support session.'}
      </div>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div className="vh" style={{ flex: 1, minWidth: 240 }}>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>Live Queue Monitor <Glyph path={ICON.star} c={GOLD} s={16} /></h1>
          <div className="sub">Shows real-time queues across all active branches.{asOf ? ` · as of ${fmtClock(asOf)}` : ''}{data.trendsSince ? ` · trends vs ${fmtClock(new Date(data.trendsSince))}` : ''}{refreshing ? ' · refreshing…' : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="linkbtn flex items-center justify-center gap-1" onClick={onExport}><Glyph path={ICON.download} s={13} /> Export Report</button>
          <button className="linkbtn flex items-center justify-center gap-1" onClick={onExportXlsx}><Glyph path={ICON.download} s={13} /> Export (XLSX)</button>
          <button className="linkbtn flex items-center justify-center gap-1" onClick={onExportPdf}><Glyph path={ICON.download} s={13} /> Export (PDF)</button>
          <button className="linkbtn flex items-center justify-center gap-1" onClick={() => onAction('incident')}><Glyph path={ICON.ticket} s={13} /> Open Support Incident</button>
          <button className="btn-gold" onClick={() => flash('Add Widget uses your saved widget preferences (per-user persistence wired next).')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Glyph path={ICON.plus} s={13} c="#fff" /> Add Widget</button>
        </div>
      </div>

      {notice ? <Banner text={notice} /> : null}
      {view !== 'all' ? <Banner text={`${VIEW_TITLE[view]} — a focused view of the Live Queue Monitor. All monitoring modules remain below.`} /> : null}
      {error ? <Banner text={`Showing last good data — ${error}`} /> : null}

      {/* KPI grid (6 + 5 at reference width) */}
      <div className="kpis">
        {kpis.map((c) => (
          <button key={c.l} className="kpi" onClick={c.onClick} style={{ display: 'flex', gap: 11, alignItems: 'center', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}>
            <IconTile {...c.tile} /><div style={{ minWidth: 0 }}><div className="l">{c.l}</div><div className=" text-base">{c.v}</div><TrendChip t={data.trends[c.m]} /></div>
          </button>
        ))}
      </div>

      {/* directory (2fr) + Health & Alerts / Oversight Actions (1fr) */}
      {view === 'stuck' ? <StuckRecordsPanel records={data.stuckRecords} /> : null}
      {view === 'wait-times' ? <WaitAnalyticsPanel a={data.waitAnalytics} /> : null}
      {view === 'timelines' ? <TimelinesPanel timelines={data.queueTimelines} /> : null}
      <div className="grid mb-5 grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-3.5 items-start" ref={liveRef}>
        <section className="panel" style={{ minWidth: 0 }}>
          <div className="phead"><h2>All Live Queues</h2><span className="muted" style={{ fontSize: 11 }}>{data.meta.scope === 'platform' ? 'All tenants' : 'Scoped'}</span></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <select value={q.status ?? ''} onChange={(e) => setStatus(e.target.value || undefined)} className="qf" aria-label="Filter by status"><option value="">All Statuses</option>{['waiting', 'called', 'assigned', 'in_service', 'unassigned'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</select>
            <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search queues..." className="qf" aria-label="Search queues" style={{ flex: 1, minWidth: 160 }} />
            <button className="qf" title="More filters" aria-label="More filters" onClick={() => flash('Advanced filters (date/time, technician, service, device, sync) attach here.')} style={{ cursor: 'pointer', width: 34, display: 'grid', placeItems: 'center' }}><Glyph path={ICON.filter} s={14} /></button>
          </div>
          {rows.length === 0 ? (
            <div className="state" style={{ padding: 24 }}>{view === 'stuck' ? 'No stuck records in the current view.' : 'No queue items match those filters.'}</div>
          ) : (
            <div style={{ overflow: 'auto', maxHeight: 420 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11, position: 'sticky', top: 0, background: 'var(--card)' }}>
                  <SortTh col="queueId">Queue ID</SortTh><SortTh col="customer">Customer</SortTh><SortTh col="tenant">Tenant</SortTh><SortTh col="branch">Branch</SortTh>
                  <SortTh col="status">Status</SortTh><SortTh col="wait">Wait</SortTh><SortTh col="technician">Technician</SortTh><SortTh col="service">Service</SortTh>
                  <th style={{ padding: '7px 8px', fontWeight: 700 }}>Device</th><th style={{ padding: '7px 8px', fontWeight: 700 }}>Sync</th><th style={{ padding: '7px 8px', fontWeight: 700 }}>Threshold</th><th style={{ padding: '7px 8px', fontWeight: 700, width: 36 }} />
                </tr></thead>
                <tbody>
                  {rows.map((r) => <QueueRowView key={r.queueId} r={r} open={menuRow === r.queueId} onToggle={(e) => { e.stopPropagation(); setMenuRow(menuRow === r.queueId ? null : r.queueId); }} onAction={onAction} />)}
                </tbody>
              </table>
            </div>
          )}
          {/* pagination */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, fontSize: 12 }}>
            <span className="muted">Showing {data.queues.total === 0 ? 0 : (data.queues.page - 1) * data.queues.pageSize + 1} to {Math.min(data.queues.page * data.queues.pageSize, data.queues.total)} of {data.queues.total.toLocaleString()} queues</span>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <button className="pgbtn" disabled={data.queues.page <= 1} aria-label="Previous page" onClick={() => setQ((p) => ({ ...p, page: Math.max(1, (p.page ?? 1) - 1) }))}>‹</button>
              <span style={{ padding: '0 8px', fontWeight: 700 }}>{data.queues.page} / {data.queues.totalPages}</span>
              <button className="pgbtn" disabled={data.queues.page >= data.queues.totalPages} aria-label="Next page" onClick={() => setQ((p) => ({ ...p, page: (p.page ?? 1) + 1 }))}>›</button>
            </div>
          </div>
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <section className="panel">
            <div className="phead"><h2>Queue Health &amp; Alerts</h2></div>
            {health.map((h) => (
              <button key={h.label} onClick={() => nav(h.to)} style={{ display: 'flex', gap: 10, alignItems: 'center', width: '100%', background: 'none', border: 'none', borderTop: '1px solid var(--line)', padding: '9px 2px', cursor: 'pointer', textAlign: 'left' }}>
                <IconTile bg={`${h.color}1A`} fg={h.color} path={h.icon} size={34} />
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 12.5 }}>{h.label}</div><div className="muted" style={{ fontSize: 11 }}>{h.sub}</div></div>
                <div style={{ fontWeight: 800, fontSize: 16, color: h.color }}>{num(h.count)}</div>
              </button>
            ))}
            <button className="linkbtn" style={{ marginTop: 8 }} onClick={() => nav('/alerts')}>View All Alerts</button>
          </section>
          <section className="panel">
            <div className="phead"><h2>Oversight Actions</h2></div>
            {OVERSIGHT_ACTIONS.map((a) => (
              <button key={a.key} onClick={() => onAction(a.key)} style={{ display: 'flex', gap: 9, alignItems: 'center', width: '100%', background: 'none', border: 'none', padding: '7px 2px', cursor: 'pointer', textAlign: 'left', fontSize: 12.5 }}>
                <Glyph path={a.icon} c={GOLD} s={15} /><span style={{ flex: 1 }}>{a.label}</span><Glyph path={ICON.chevR} c="var(--muted)" s={14} />
              </button>
            ))}
          </section>
        </div>
      </div>

      {/* four charts */}
      <div className="grid2 lq4" ref={waitRef}>
        <section className="panel"><div className="phead"><h2>Queue Volume Trend</h2><span className="muted" style={{ fontSize: 11 }}>Today</span></div><LineTrend points={data.queueVolumeTrend} /><div className="muted" style={{ fontSize: 10.5, marginTop: 4 }}>Queue entries created per hour</div></section>
        <section className="panel"><div className="phead"><h2>Avg Wait by Branch</h2><span className="muted" style={{ fontSize: 11 }}>Today</span></div>{data.waitTimeByBranch.length ? <VBars unit="min" data={data.waitTimeByBranch.slice(0, 6).map((b) => ({ label: b.branch ?? '—', value: b.avgWaitMin }))} onPick={(i) => setQ((p) => ({ ...p, branchId: data.waitTimeByBranch[i].branchId, page: 1 }))} /> : <div className="state" style={{ padding: 18 }}>No waiting customers right now.</div>}</section>
        <section className="panel"><div className="phead"><h2>Live Status Distribution</h2><span className="muted" style={{ fontSize: 11 }}>Today</span></div>{dist.total ? <Donut data={distData} total={dist.total} centerTop={dist.total.toLocaleString()} centerBottom="Total Queues" /> : <div className="state" style={{ padding: 18 }}>No active queues.</div>}</section>
        <section className="panel"><div className="phead"><h2>Top Branches by Queue Size</h2><span className="muted" style={{ fontSize: 11 }}>Today</span></div>{data.topBranches.length ? <HBars data={data.topBranches.slice(0, 5).map((b) => ({ label: b.branch ?? '—', value: b.activeCount }))} onPick={(i) => setQ((p) => ({ ...p, branchId: data.topBranches[i].branchId, page: 1 }))} /> : <div className="state" style={{ padding: 18 }}>—</div>}</section>
      </div>

      {/* four lower modules */}
      <div className="grid2 lq4">
        <section className="panel" ref={syncRef}>
          <div className="phead"><h2>Queue Synchronization Status</h2><span className="muted" style={{ fontSize: 11 }}>Today</span></div>
          <div className="state" style={{ padding: 20, textAlign: 'center' }}>
            <div style={{ fontWeight: 800, color: GOLD, marginBottom: 4 }}>NotConnected</div>
            <div className="muted" style={{ fontSize: 11.5 }}>{data.synchronizationStatus.reason}. No per-queue sync source is connected, so this is shown honestly rather than estimated.</div>
          </div>
        </section>
        <section className="panel" ref={eventsRef}>
          <div className="phead"><h2>Recent Queue Events</h2></div>
          {data.recentEvents.length === 0 ? <div className="state" style={{ padding: 18 }}>No recent events.</div> : data.recentEvents.slice(0, 6).map((e, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 2px', borderTop: i ? '1px solid var(--line)' : 'none' }}>
              <span className="muted" style={{ fontSize: 10.5, width: 52, flex: 'none' }}>{fmtTime(e.at)}</span>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12 }}>{e.summary}</div><div className="muted" style={{ fontSize: 10.5 }}>{e.branch ?? '—'}{e.tenantName ? ` · ${e.tenantName}` : ''}</div></div>
              <span style={{ fontSize: 9.5, fontWeight: 800, color: STATUS_COLOR[e.newState] || GOLD, background: `${STATUS_COLOR[e.newState] || GOLD}1A`, borderRadius: 999, padding: '1px 7px', flex: 'none' }}>{titleCase(e.newState)}</span>
            </div>
          ))}
          <button className="linkbtn" style={{ marginTop: 8 }} onClick={() => nav('/queue-management/timelines')}>View All Events</button>
        </section>
        <section className="panel">
          <div className="phead"><h2>Branches Over Threshold</h2></div>
          {data.branchesOverThreshold.length === 0 ? <div className="state" style={{ padding: 18 }}>No branches over threshold.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5 }}><th style={{ padding: '4px 2px', fontWeight: 700 }}>Branch</th><th style={{ padding: '4px 2px', fontWeight: 700 }}>Over</th><th style={{ padding: '4px 2px', fontWeight: 700 }}>Longest</th></tr></thead>
              <tbody>{data.branchesOverThreshold.slice(0, 5).map((b) => (
                <tr key={b.branchId} style={{ borderTop: '1px solid var(--line)' }}><td style={{ padding: '5px 2px' }}>{b.branch ?? '—'}</td><td style={{ padding: '5px 2px', fontWeight: 700, color: '#C9772E' }}>{b.overThreshold}</td><td style={{ padding: '5px 2px' }}>{fmtWait(b.longestWaitMin)}</td></tr>
              ))}</tbody>
            </table>
          )}
          <button className="linkbtn" style={{ marginTop: 8 }} onClick={() => nav('/branches')}>View All Branches</button>
        </section>
        <section className="panel">
          <div className="phead"><h2>Technician Availability</h2><span className="muted" style={{ fontSize: 11 }}>Today</span></div>
          {lqTechConnected(tech) ? (
            <Donut total={tech.total} centerTop={tech.total.toLocaleString()} centerBottom="Total Techs"
              data={tech.slices.map((s) => ({ label: s.label, count: s.count, color: s.label === 'Available' ? '#3E8F57' : s.label === 'Busy' ? '#C9772E' : s.label === 'On Break' ? '#D09A36' : '#9B8B78' }))} />
          ) : <div className="state" style={{ padding: 20, textAlign: 'center' }}><div style={{ fontWeight: 800, color: GOLD, marginBottom: 4 }}>NotConnected</div><div className="muted" style={{ fontSize: 11.5 }}>{tech.reason}.</div></div>}
        </section>
      </div>

      {/* At-a-Glance */}
      <section className="panel">
        <div className="phead"><h2>At-a-Glance Summary (Today)</h2><span className="muted" style={{ fontSize: 11 }}>Today</span></div>
        <div className="lqglance">
          {glance.map((g) => (
            <div key={g.l} style={{ minWidth: 0 }}><div className="l" style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em' }}>{g.l}</div><div style={{ fontFamily: 'Playfair Display, serif', fontSize: 18, marginTop: 3 }}>{g.v}</div><TrendChip t={data.trends[g.m]} /></div>
          ))}
        </div>
      </section>

      {/* monitoring boundary */}
      <section className="panel mt-5 pb-7" style={{ borderColor: 'var(--gline,#E7D6B8)', background: 'var(--cream,#FBF6EC)' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <IconTile bg="#F3E7D2" fg={GOLD} path={ICON.shield} size={34} />
          <div>
            <div style={{ fontWeight: 800, color: GOLD, fontSize: 13 }}>SUPER ADMIN MONITORING BOUNDARY</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>The Super Admin monitors queues and supports issue resolution, but should not normally drag customers between technicians or reorder the salon queue. Those actions remain tenant-management and branch-POS responsibilities — and are enforced server-side, not just hidden here.</div>
          </div>
        </div>
      </section>

      {incident ? <IncidentModal ctx={incident} onClose={() => setIncident(null)} onDone={(msg) => { setIncident(null); flash(msg); }} /> : null}

      <style>{`
        .qf { font-size: 12.5px; padding: 6px 9px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); }
        .pgbtn { width: 28px; height: 26px; border: 1px solid var(--line); background: var(--card); border-radius: 7px; cursor: pointer; }
        .pgbtn:disabled { opacity: .4; cursor: default; }
        .btn-gold { background: ${GOLD}; color: #fff; border: none; border-radius: 9px; padding: 7px 12px; font-weight: 700; cursor: pointer; }
        .lq4 { grid-template-columns: 1fr 1fr 1fr 1fr; }
        .lqglance { display: grid; grid-template-columns: repeat(9, 1fr); gap: 10px; }
        @media (max-width: 1400px) { .lq4 { grid-template-columns: 1fr 1fr; } .lqglance { grid-template-columns: repeat(5, 1fr); } }
        @media (max-width: 900px) { .lq4 { grid-template-columns: 1fr; } .lqglance { grid-template-columns: repeat(3, 1fr); } }
      `}</style>
    </div>
  );
}

function QueueRowView({ r, open, onToggle, onAction }: { r: LQRow; open: boolean; onToggle: (e: React.MouseEvent) => void; onAction: (k: string, row?: LQRow) => void }) {
  const flag = r.thresholdFlag;
  return (
    <tr style={{ borderTop: '1px solid var(--line)', background: r.stuck ? '#FBF1F0' : undefined }}>
      <td style={{ padding: '7px 8px', fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }}>{r.queueId.slice(0, 8)}</td>
      <td style={{ padding: '7px 8px' }}><span style={{ fontWeight: 700 }}>{r.customer || '—'}</span>{r.isVip ? <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 800, color: GOLD, background: '#F3E7D2', borderRadius: 999, padding: '1px 6px' }}>VIP</span> : null}</td>
      <td style={{ padding: '7px 8px' }}>{r.tenantName || '—'}</td>
      <td style={{ padding: '7px 8px' }}>{r.branchName || '—'}</td>
      <td style={{ padding: '7px 8px' }}><span style={{ fontSize: 11, fontWeight: 700, color: STATUS_COLOR[r.bucket] || STATUS_COLOR[r.status] || '#9B8B78', background: `${STATUS_COLOR[r.bucket] || STATUS_COLOR[r.status] || '#9B8B78'}1A`, borderRadius: 999, padding: '1px 9px' }}>{titleCase(r.bucket === 'unassigned' ? 'unassigned' : r.status)}</span></td>
      <td style={{ padding: '7px 8px', whiteSpace: 'nowrap', fontWeight: 700, color: r.bucket === 'in_service' ? 'var(--muted)' : flag === 'critical' || flag === 'alert' ? '#B85B4D' : 'inherit' }}>{r.bucket === 'in_service' ? '—' : fmtWait(r.waitMin)}</td>
      <td style={{ padding: '7px 8px' }}>{r.technicianName || <span className="muted">Unassigned</span>}</td>
      <td style={{ padding: '7px 8px' }}>{r.service || '—'}</td>
      <td style={{ padding: '7px 8px' }}><span className="muted" style={{ fontSize: 11 }}>—</span></td>
      <td style={{ padding: '7px 8px' }}><span className="muted" style={{ fontSize: 11 }}>—</span></td>
      <td style={{ padding: '7px 8px' }}>{flag === 'none' ? <span className="muted">—</span> : <span style={{ fontSize: 10.5, fontWeight: 800, color: FLAG_COLOR[flag], background: `${FLAG_COLOR[flag]}1A`, borderRadius: 999, padding: '1px 8px' }}>{titleCase(flag)}</span>}</td>
      <td style={{ padding: '7px 4px', position: 'relative' }}>
        <button onClick={onToggle} aria-label="Row actions" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><Glyph path={ICON.dots} c="var(--muted)" s={16} /></button>
        {open ? (
          <div role="menu" onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', right: 6, top: 28, zIndex: 20, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)', padding: 6, width: 210 }}>
            {ROW_ACTIONS.map((a) => <button key={a} role="menuitem" onClick={() => onAction(a, r)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '6px 8px', fontSize: 12, cursor: 'pointer', borderRadius: 6 }}>{a}</button>)}
          </div>
        ) : null}
      </td>
    </tr>
  );
}

function IncidentModal({ ctx, onClose, onDone }: { ctx: { tenantId: string; branchId: string | null; tenantName: string | null; branchName: string | null; queueId: string }; onClose: () => void; onDone: (msg: string) => void }) {
  const [severity, setSeverity] = useState('high');
  const [category, setCategory] = useState('queue');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    setBusy(true); setErr(null);
    superAdminQueueApi.openIncident({ tenantId: ctx.tenantId, branchId: ctx.branchId ?? undefined, queueIds: [ctx.queueId], category, severity, description: description.trim() || `Queue issue at ${ctx.branchName ?? 'branch'} (${ctx.tenantName ?? 'tenant'}).`, idempotencyKey: `lqm-${ctx.queueId}-${Date.now()}` })
      .then((r) => { if (r.ok) onDone(`Support incident ${r.ticketNumber} opened with queue/branch context.`); else { setErr(r.error ?? 'Could not create the incident.'); setBusy(false); } })
      .catch((e: any) => { setErr(e?.message ?? 'Could not create the incident.'); setBusy(false); });
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Open Support Incident" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,.38)', display: 'grid', placeItems: 'center', zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} className="panel" style={{ width: 'min(460px, 92vw)', background: 'var(--card)' }}>
        <div className="phead"><h2>Open Support Incident</h2><button className="linkbtn" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>{ctx.tenantName ?? 'Tenant'}{ctx.branchName ? ` · ${ctx.branchName}` : ''} · Queue {ctx.queueId.slice(0, 8)}</div>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>SEVERITY</label>
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="qf" style={{ width: '100%', marginBottom: 10 }}>{['low', 'normal', 'high', 'critical'].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>CATEGORY</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="qf" style={{ width: '100%', marginBottom: 10 }}>{['queue', 'sync', 'device', 'congestion', 'threshold'].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>DESCRIPTION</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's happening with this queue?" rows={3} className="qf" style={{ width: '100%', resize: 'vertical', marginBottom: 10 }} />
        {err ? <div style={{ color: 'var(--danger,#B85B4D)', fontSize: 12, marginBottom: 8 }}>{err}</div> : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="linkbtn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-gold" onClick={submit} disabled={busy}>{busy ? 'Opening…' : 'Open Incident'}</button>
        </div>
      </div>
    </div>
  );
}

function StuckRecordsPanel({ records }: { records: import('../api/superAdminQueueApi').LQStuckRecord[] }) {
  const REASON: Record<string, string> = { assigned_no_service_start: 'Assigned but service never started', called_not_progressed: 'Called but not progressed', waiting_no_change: 'Waiting with no change', handoff_stale: 'Tech hand-off stale' };
  return (
    <section className="panel">
      <div className="phead"><h2>Stuck Records</h2><span className="muted" style={{ fontSize: 11 }}>{records.length} record{records.length === 1 ? '' : 's'} · derived from lifecycle staleness (no state changed)</span></div>
      {records.length === 0 ? <div className="state" style={{ padding: 20 }}>No stuck records — every active queue item is progressing within its expected window.</div> : (
        <div style={{ overflow: 'auto', maxHeight: 360 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11, position: 'sticky', top: 0, background: 'var(--card)' }}>
              {['Queue ID', 'Customer', 'Tenant', 'Branch', 'Current State', 'Reason', 'Stuck For', 'Wait'].map((h) => <th key={h} style={{ padding: '7px 8px', fontWeight: 700 }}>{h}</th>)}
            </tr></thead>
            <tbody>{records.map((r) => (
              <tr key={r.queueId} style={{ borderTop: '1px solid var(--line)', background: '#FBF1F0' }}>
                <td style={{ padding: '7px 8px', fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }}>{r.queueId.slice(0, 8)}</td>
                <td style={{ padding: '7px 8px', fontWeight: 700 }}>{r.customer || '—'}</td>
                <td style={{ padding: '7px 8px' }}>{r.tenantName || '—'}</td>
                <td style={{ padding: '7px 8px' }}>{r.branchName || '—'}</td>
                <td style={{ padding: '7px 8px' }}>{titleCase(r.status)}</td>
                <td style={{ padding: '7px 8px' }}>{r.reason ? (REASON[r.reason] ?? titleCase(r.reason)) : '—'}</td>
                <td style={{ padding: '7px 8px', fontWeight: 700, color: '#B85B4D' }}>{fmtWait(r.stuckMin)}</td>
                <td style={{ padding: '7px 8px' }}>{fmtWait(r.waitMin)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <div className="muted" style={{ fontSize: 10.5, marginTop: 6 }}>Stuck detection flags records for investigation only — it never changes a customer's queue or service state.</div>
    </section>
  );
}

function WaitAnalyticsPanel({ a }: { a: import('../api/superAdminQueueApi').LQWaitAnalytics }) {
  const stat = (label: string, v: number, unit = true) => (
    <div style={{ minWidth: 0 }}><div className="l" style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em' }}>{label}</div><div style={{ fontFamily: 'Playfair Display, serif', fontSize: 20, marginTop: 3 }}>{a.overall.count === 0 ? '—' : unit ? fmtWait(v) : v}</div></div>
  );
  return (
    <section className="panel">
      <div className="phead"><h2>Wait-Time Analytics</h2><span className="muted" style={{ fontSize: 11 }}>Thresholds — warning {a.thresholds.warningMin}m · alert {a.thresholds.alertMin}m · critical {a.thresholds.criticalMin}m</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 12 }}>
        {stat('Waiting', a.overall.count, false)}
        {stat('Average', a.overall.avgMin)}
        {stat('Median', a.overall.medianMin)}
        {stat('90th pct', a.overall.p90Min)}
        {stat('Longest', a.overall.longestMin)}
        {stat('Over Threshold', a.overThreshold, false)}
      </div>
      {a.byBranch.length === 0 ? <div className="state" style={{ padding: 18 }}>No customers are currently waiting.</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}>
            {['Branch', 'Waiting', 'Avg', 'Median', 'P90', 'Longest', 'Over Threshold'].map((h) => <th key={h} style={{ padding: '6px 8px', fontWeight: 700 }}>{h}</th>)}
          </tr></thead>
          <tbody>{a.byBranch.map((b) => (
            <tr key={b.branchId} style={{ borderTop: '1px solid var(--line)' }}>
              <td style={{ padding: '6px 8px', fontWeight: 700 }}>{b.branch || '—'}</td>
              <td style={{ padding: '6px 8px' }}>{b.waiting}</td>
              <td style={{ padding: '6px 8px' }}>{fmtWait(b.avgMin)}</td>
              <td style={{ padding: '6px 8px' }}>{fmtWait(b.medianMin)}</td>
              <td style={{ padding: '6px 8px' }}>{fmtWait(b.p90Min)}</td>
              <td style={{ padding: '6px 8px' }}>{fmtWait(b.longestMin)}</td>
              <td style={{ padding: '6px 8px', fontWeight: 700, color: b.overThreshold > 0 ? '#C9772E' : 'inherit' }}>{b.overThreshold}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <div className="muted" style={{ fontSize: 10.5, marginTop: 6 }}>Current-wait metrics over customers still waiting (now − check-in). Median and P90 use nearest-rank.</div>
    </section>
  );
}

function TimelinesPanel({ timelines }: { timelines: import('../api/superAdminQueueApi').LQQueueTimeline[] }) {
  const DOT: Record<string, string> = { queued: '#D09A36', called: '#3C7FB6', assigned: '#A96F22', service_started: '#3E8F57', threshold: '#C9772E', stuck: '#B85B4D' };
  return (
    <section className="panel">
      <div className="phead"><h2>Queue Timelines</h2><span className="muted" style={{ fontSize: 11 }}>{timelines.length} active queue{timelines.length === 1 ? '' : 's'} · reconstructed from lifecycle timestamps</span></div>
      {timelines.length === 0 ? <div className="state" style={{ padding: 20 }}>No active queues to show a timeline for.</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12, maxHeight: 460, overflow: 'auto' }}>
          {timelines.map((tl) => (
            <div key={tl.queueId} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11.5, color: 'var(--muted)' }}>{tl.queueId.slice(0, 8)}</span>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{tl.customer || '—'}</span>
                <span className="muted" style={{ fontSize: 10.5, marginLeft: 'auto' }}>{tl.branchName ?? '—'}{tl.tenantName ? ` · ${tl.tenantName}` : ''}</span>
              </div>
              <ol style={{ listStyle: 'none', margin: 0, padding: 0, position: 'relative' }}>
                {tl.events.map((e, i) => (
                  <li key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', paddingBottom: i < tl.events.length - 1 ? 10 : 0, position: 'relative' }}>
                    <span aria-hidden style={{ width: 9, height: 9, borderRadius: '50%', background: DOT[e.kind] ?? 'var(--muted)', marginTop: 3, flex: 'none', boxShadow: i < tl.events.length - 1 ? `0 14px 0 -7.5px var(--line)` : 'none' }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12 }}>{e.label}</div>
                      <div className="muted" style={{ fontSize: 10.5 }}>{fmtTime(e.at)} · <span style={{ color: DOT[e.kind] ?? 'inherit', fontWeight: 700 }}>{titleCase(e.state)}</span></div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
      <div className="muted" style={{ fontSize: 10.5, marginTop: 6 }}>Reconstructed from real check-in / called / service-start timestamps plus threshold &amp; stuck signals — read-only, never overwritten. A tamper-evident append-only event log would require its own store.</div>
    </section>
  );
}
