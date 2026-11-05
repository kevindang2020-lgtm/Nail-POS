import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NotConnected } from './_chartkit';
import { AddIntegrationWizard } from './AddIntegrationWizard';
import { ManagedConnections } from './ManagedConnections';
import {
  fetchIntegrationsOverview, listConnectedIntegrations, listWebhookEvents, listAuthAlerts, listErrorLogs,
  listTenantUsage, listMarketplace, disableConnection, exportIntegrationReport,
  type IntOverview, type IntConnection, type IntWebhookEvent, type IntAuthAlert, type IntErrorLog,
  type IntTenantUsage, type IntMarketplaceItem, type IntFilters,
} from '../api/superAdminIntegrationsApi';

// IntegrationsScreen — Super Admin › System Settings › Integrations.
// Full reference layout wired to GET /super-admin/integrations/* (real webhooks, deliveries, API keys, gateway
// events, booking flags). Connection / authentication / sync / webhook are SEPARATE controlled statuses; secrets
// and tokens are never fetched or shown. Money is integer cents. Cream/gold, Mac-fit. ?fixture=1 injects the
// reference values for layout parity. Deep write workflows (OAuth authorization, credential rotation, sync engine,
// live webhook reprocessing, marketplace onboarding wizard) are separate audited units; the safe disable action
// and the filter-aware, secret-free, audited export are wired live here.

const G7 = 'var(--g7)', OK = 'var(--ok)', WARN = 'var(--warn)', DANGER = 'var(--danger)', INFO = 'var(--info)', PURPLE = '#7C5CBF';
const big = (c: number | null | undefined) => (c ?? 0).toLocaleString();

function Ico({ path, tone }: { path: string; tone: string }) {
  return (<span style={{ display: 'inline-flex', width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', background: tone + '18', color: tone, flex: '0 0 auto' }} aria-hidden>
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{path.split('|').map((d, i) => <path key={i} d={d} />)}</svg></span>);
}

function Donut({ data, size = 96 }: { data: { label: string; value: number; color: string }[]; size?: number }) {
  const total = Math.max(1, data.reduce((a, b) => a + b.value, 0)); const r = size / 2 - 8; const c = 2 * Math.PI * r; let off = 0;
  return (<div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden><g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
      {data.map((d, i) => { const len = (d.value / total) * c; const seg = <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={d.color} strokeWidth={9} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-off} />; off += len; return seg; })}
    </g></svg>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11 }}>{data.map((d) => (<div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: d.color }} /><span style={{ color: 'var(--muted)' }}>{d.label}</span><b>{d.value}</b></div>))}</div>
  </div>);
}

const KPIS: { key: keyof NonNullable<IntOverview['kpis']>; label: string; tone: string; icon: string; fmt?: (o: NonNullable<IntOverview['kpis']>) => string; sub?: (o: NonNullable<IntOverview['kpis']>) => string; bad?: boolean }[] = [
  { key: 'totalActiveIntegrations', label: 'Total Active Integrations', tone: G7, icon: 'M4 4h16v16H4z|M9 9h6v6H9z' },
  { key: 'connectedTenants', label: 'Connected Tenants', tone: INFO, icon: 'M3 21h18|M5 21V7l7-4 7 4v14|M9 9h.01|M15 9h.01' },
  { key: 'healthyConnections', label: 'Healthy Connections', tone: OK, icon: 'M12 2 4 5v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V5l-8-3z|M9 12l2 2 4-4', sub: (o) => `${o.healthyPct}% of total` },
  { key: 'failedSynchronizations', label: 'Failed Synchronizations', tone: DANGER, icon: 'M3 12a9 9 0 109-9|M3 4v5h5|M12 8v4l2 2', bad: true, sub: (o) => `+${o.failedSync24h} (24h)` },
  { key: 'expiredAuthTokens', label: 'Expired Auth Tokens', tone: WARN, icon: 'M7 11V7a5 5 0 019.9-1|M5 11h14v10H5z', sub: () => 'Requires attention' },
  { key: 'webhookErrors', label: 'Webhook Errors', tone: PURPLE, icon: 'M12 2a10 10 0 100 20 10 10 0 000-20z|M15 9l-6 6|M9 9l6 6', bad: true },
  { key: 'apiUsageToday', label: 'API Usage Today', tone: INFO, icon: 'M3 3v18h18|M7 14l4-4 4 4 4-6' },
  { key: 'integrationsRequiringAttention', label: 'Requiring Attention', tone: WARN, icon: 'M10.3 3.9 1.8 18a2 2 0 001.7 3h16.9a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z|M12 9v4|M12 17h.01', sub: () => 'View details' },
  { key: 'successfulSyncs24h', label: 'Last 24h Successful Syncs', tone: OK, icon: 'M23 4v6h-6|M1 20v-6h6|M3.5 9a9 9 0 0114.9-3.4L23 10|M1 14l4.6 4.4A9 9 0 0020.5 15' },
  { key: 'disabledConnections', label: 'Disabled Connections', tone: 'var(--muted)', icon: 'M12 2a10 10 0 100 20 10 10 0 000-20z|M4.9 4.9l14.2 14.2', sub: () => 'View disabled' },
];

const CONTROLS = [
  ['Enable Integrations', 'Enable or reactivate integrations.', 'M5 12h14|M12 5v14'],
  ['Configure Credentials', 'Add or update integration credentials.', 'M7 11V7a5 5 0 0110 0v4|M5 11h14v10H5z'],
  ['Test Connections', 'Test connectivity and validate endpoints.', 'M22 12h-4l-3 9L9 3l-3 9H2'],
  ['Refresh Authentication', 'Refresh expired or expiring authentication.', 'M23 4v6h-6|M1 20v-6h6|M3.5 9a9 9 0 0114.9-3.4L23 10'],
  ['Retry Synchronization', 'Retry failed or missed synchronizations.', 'M3 12a9 9 0 109-9|M3 4v5h5'],
  ['Review Webhook Events', 'Monitor and review webhook deliveries.', 'M22 12h-4l-3 9L9 3l-3 9H2'],
  ['Disable Compromised Connections', 'Disable suspicious or compromised links.', 'M18.36 6.64A9 9 0 1120 12|M12 2v10'],
  ['Configure Tenant Access', 'Manage tenant-level integration access.', 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2|M9 7a4 4 0 100 8 4 4 0 000-8z'],
  ['Review API Health', 'Monitor API performance and response times.', 'M3 3v18h18|M7 14l3-3 3 3 4-5'],
];

const QUICK = [
  ['Add Integration', 'M12 5v14|M5 12h14'], ['Test Connection', 'M22 12h-4l-3 9L9 3l-3 9H2'], ['Refresh Auth', 'M23 4v6h-6|M3.5 9a9 9 0 0114.9-3.4L23 10'],
  ['Retry Sync', 'M3 12a9 9 0 109-9|M3 4v5h5'], ['View Webhooks', 'M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9'], ['View Error Logs', 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z'],
  ['Export Report', 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4|M7 10l5 5 5-5|M12 15V3'], ['Open Tenant Access', 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2|M9 7a4 4 0 100 8 4 4 0 000-8z'],
];

const statusTone = (s: string) => /active|healthy|valid|delivered|processed/i.test(s) ? OK : /warn|expir|delay|degrad|pending/i.test(s) ? WARN : /fail|expired|invalid|disabled|critical|reject|dead/i.test(s) ? DANGER : /not.?supported|no.?webhook|not.?configured/i.test(s) ? 'var(--muted)' : INFO;
const Badge = ({ v }: { v: string }) => <span style={{ fontSize: 10, fontWeight: 700, color: statusTone(v), background: statusTone(v) + '18', borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap' }}>{v}</span>;

const FIXTURE: IntOverview = {
  available: true,
  kpis: { totalActiveIntegrations: 84, connectedTenants: 146, healthyConnections: 76, healthyPct: 90.5, failedSynchronizations: 12, failedSync24h: 3, expiredAuthTokens: 7, webhookErrors: 18, apiUsageToday: 245876, integrationsRequiringAttention: 11, successfulSyncs24h: 1932, disabledConnections: 6 },
  syncTrend: ['Apr 30', 'May 1', 'May 2', 'May 3', 'May 4', 'May 5', 'May 6'].map((label, i) => ({ label, date: label, successPct: [96, 93, 95, 92, 97, 94, 98][i], total: 300 })),
  apiUsageByIntegration: [{ integration: 'Email Providers', calls: 31200 }, { integration: 'Payment Gateways', calls: 26900 }, { integration: 'Google Services', calls: 22200 }, { integration: 'Fiserv', calls: 18500 }, { integration: 'Twilio', calls: 12400 }, { integration: 'Others', calls: 34700 }],
  statusBreakdown: [{ status: 'Active', count: 76 }, { status: 'Warning', count: 5 }, { status: 'Failed', count: 4 }, { status: 'Disabled', count: 6 }, { status: 'Unknown', count: 21 }],
  webhookHealth: [{ status: 'Healthy', count: 62 }, { status: 'Warning', count: 8 }, { status: 'Failed', count: 18 }, { status: 'No Webhook', count: 24 }],
};

export function IntegrationsScreen() {
  const fixture = import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('fixture') === '1';   // dev-server aid only (SCAN, Oct 12)
  const [ov, setOv] = useState<IntOverview | null>(fixture ? FIXTURE : null);
  const [conns, setConns] = useState<IntConnection[] | null>(null);
  const [events, setEvents] = useState<IntWebhookEvent[] | null>(null);
  const [alerts, setAlerts] = useState<IntAuthAlert[] | null>(null);
  const [errors, setErrors] = useState<IntErrorLog[] | null>(null);
  const [tenants, setTenants] = useState<IntTenantUsage[] | null>(null);
  const [market, setMarket] = useState<IntMarketplaceItem[] | null>(null);
  const [filters, setFilters] = useState<IntFilters>({});
  const [draft, setDraft] = useState<IntFilters>({});
  const [format, setFormat] = useState<'csv' | 'xlsx' | 'pdf'>('csv');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wizard, setWizard] = useState<{ open: boolean; preselect?: string }>({ open: false });
  const [connReload, setConnReload] = useState(0);
  const openWizard = (preselect?: string) => setWizard({ open: true, preselect });
  const refs = { conns: useRef<HTMLDivElement>(null), events: useRef<HTMLDivElement>(null), alerts: useRef<HTMLDivElement>(null), errors: useRef<HTMLDivElement>(null), tenants: useRef<HTMLDivElement>(null), market: useRef<HTMLDivElement>(null), api: useRef<HTMLDivElement>(null) };

  const loadAll = useCallback((f: IntFilters) => {
    if (fixture) return;
    fetchIntegrationsOverview(f).then(setOv).catch(() => setOv({ available: false }));
    listConnectedIntegrations(f).then((r) => setConns(r.integrations)).catch(() => setConns([]));
    listWebhookEvents(f).then((r) => setEvents(r.events)).catch(() => setEvents([]));
    listAuthAlerts(f).then((r) => setAlerts(r.alerts)).catch(() => setAlerts([]));
    listErrorLogs(f).then((r) => setErrors(r.errors)).catch(() => setErrors([]));
    listTenantUsage(f).then((r) => setTenants(r.tenants)).catch(() => setTenants([]));
    listMarketplace().then((r) => setMarket(r.services)).catch(() => setMarket([]));
  }, [fixture]);
  useEffect(() => { loadAll(filters); }, [filters, loadAll]);

  const scrollTo = (r: React.RefObject<HTMLDivElement>, note: string) => { r.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setMsg(note); };
  async function doExport() {
    setMsg(`Preparing ${format.toUpperCase()} report…`);
    try { const r = await exportIntegrationReport({ ...filters, format }); setMsg(`Exported ${r.rowCount} integration row(s) to ${r.filename}. Filter-aware, secrets excluded, audited.`); }
    catch (e: any) { setMsg(e?.message ?? 'Export failed.'); }
  }
  async function disableFirstActive() {
    const target = (conns ?? []).find((c) => c.status === 'active' && c.webhookStatus !== 'not_supported');
    if (!target) { setMsg('No active webhook-backed connection is available to disable from this view.'); return; }
    setBusy(true); setMsg(null);
    try { await disableConnection(target.key, 'Disabled from Super Admin console'); setMsg(`Disable requested for ${target.name}. Status management only — new deliveries stop; history is preserved; audited.`); loadAll(filters); }
    catch (e: any) { setMsg(e?.message ?? 'Could not disable the connection.'); } finally { setBusy(false); }
  }

  const controlHandlers: Record<number, () => void> = {
    0: () => openWizard(),
    1: () => setMsg('Credential configuration opens a secure, permission-gated workflow (blank means keep existing). Wired next unit; secrets are never shown.'),
    2: () => setMsg('Connection tests run a non-destructive provider health check via the connection detail (next unit).'),
    3: () => scrollTo(refs.alerts, 'Authentication & token alerts — refresh the flagged credentials here.'),
    4: () => scrollTo(refs.errors, 'Retry failed or missed synchronizations from the error log.'),
    5: () => scrollTo(refs.events, 'Recent webhook events.'),
    6: disableFirstActive,
    7: () => scrollTo(refs.tenants, 'Tenant integration usage — configure tenant access here.'),
    8: () => scrollTo(refs.api, 'API usage & health by integration.'),
  };
  const quickHandlers: Record<number, () => void> = {
    0: () => openWizard(), 1: controlHandlers[2], 2: () => scrollTo(refs.alerts, 'Refresh authentication.'),
    3: () => scrollTo(refs.errors, 'Retry synchronization.'), 4: () => scrollTo(refs.events, 'Webhook events.'), 5: () => scrollTo(refs.errors, 'Error logs.'),
    6: doExport, 7: () => scrollTo(refs.tenants, 'Tenant access.'),
  };

  const k = ov?.kpis;
  const maxUsage = useMemo(() => Math.max(1, ...((ov?.apiUsageByIntegration ?? []).map((r) => r.calls))), [ov]);
  const summary = k ? [
    { l: 'Successful Syncs Today', v: big(k.successfulSyncs24h), t: OK, i: 'M20 6 9 17l-5-5' },
    { l: 'Failed Syncs Today', v: big(k.failedSynchronizations), t: DANGER, i: 'M18 6 6 18|M6 6l12 12', bad: true },
    { l: 'Webhook Deliveries', v: big((ov?.webhookHealth ?? []).reduce((a, b) => a + b.count, 0)), t: PURPLE, i: 'M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9' },
    { l: 'API Calls Today', v: big(k.apiUsageToday), t: INFO, i: 'M3 3v18h18|M7 14l4-4 4 4 4-6' },
    { l: 'Connections at Risk', v: big(k.integrationsRequiringAttention), t: WARN, i: 'M10.3 3.9 1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z' },
    { l: 'Active Tenants Using Integrations', v: big(k.connectedTenants), t: G7, i: 'M3 21h18|M5 21V7l7-4 7 4v14' },
  ] : [];

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, fontSize: 22 }}>Integrations
            <svg width="18" height="18" viewBox="0 0 24 24" fill={G7} stroke={G7} aria-hidden><path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.8 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z" /></svg>
          </h1>
          <div className="sub" style={{ color: 'var(--soft)', fontSize: 12.5 }}>Manages external services connected to AI PowerSalon.</div>
        </div>
        <div className='flex-wrap' style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select className="inp" aria-label="Export format" value={format} onChange={(e) => setFormat(e.target.value as any)} style={{ padding: '4px 6px', fontSize: 12 }}><option value="csv">CSV</option><option value="xlsx">XLSX</option><option value="pdf">PDF</option></select>
          <button className="btn" onClick={doExport}>⬇ Export Integration Report</button>
          <button className="btn primary" onClick={() => openWizard()}>+ Add Integration</button>
        </div>
      </div>

      <div className="panel" style={{ fontSize: 12, border: '1px solid var(--info)', background: 'color-mix(in srgb, var(--info) 10%, transparent)', display: 'flex', gap: 8, alignItems: 'center' }} role="note">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={INFO} strokeWidth="2" aria-hidden><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
        This module allows you to manage third-party service connections, monitor sync health, handle authentication, and control tenant access.
      </div>
      {msg && <div className="panel" style={{ fontSize: 12, border: '1px solid var(--ok)', background: 'color-mix(in srgb, var(--ok) 12%, transparent)' }}>{msg}</div>}

      {/* 10 KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10 gap-2">
        {KPIS.map((kp) => (
          <div key={kp.key} className="card" style={{ padding: 9, display: 'flex', flexDirection: 'column', gap: 4 }} tabIndex={0}>
            <Ico path={kp.icon} tone={kp.tone} />
            <div style={{ fontSize: 9.5, color: 'var(--soft)', lineHeight: 1.1 }}>{kp.label}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: kp.bad && k && (k[kp.key] as number) > 0 ? DANGER : 'var(--text)' }}>{k ? (kp.fmt ? kp.fmt(k) : big(k[kp.key] as number)) : '—'}</div>
            <div style={{ fontSize: 9, color: 'var(--muted)' }}>{k && kp.sub ? kp.sub(k) : ''}</div>
          </div>
        ))}
      </div>

      {/* filters */}
      <div className="items-center" style={{ padding: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {([['integrationType', 'Integration Type', ['All Types', 'Payment Gateway', 'Communication', 'AI & Voice', 'Accounting', 'HR & Payroll', 'Productivity', 'Platform Services', 'Data Import', 'Hardware']],
          ['tenantId', 'Tenant', ['All Tenants']], ['status', 'Status', ['All Statuses', 'active', 'warning', 'failed', 'disabled', 'pending_setup', 'degraded']],
          ['authStatus', 'Authentication', ['All Auth Statuses', 'valid', 'expiring_soon', 'expired', 'invalid', 'not_configured']],
          ['syncState', 'Sync State', ['All Sync States', 'successful', 'partial', 'delayed', 'failed', 'paused']]] as [keyof IntFilters, string, string[]][]).map(([key, label, opts]) => (
            <label className='border border-[var(--line)] p-2 rounded-lg' key={key} style={{ display: 'flex',  gap: 3, fontSize: 11, color: 'var(--muted)' }}>{label}
            <select className="inp" value={(draft[key] as string) ?? opts[0]} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value.startsWith('All') ? undefined : e.target.value }))}>{opts.map((o) => <option key={o}>{o}</option>)}</select></label>
        ))}
        <label className='border border-[var(--line)] p-2 rounded-lg' style={{ display: 'flex',  gap: 3, fontSize: 11, color: 'var(--muted)' }}>Date Range
          <input className="inp" type="date" onChange={(e) => setDraft((d) => ({ ...d, dateFrom: e.target.value || undefined }))} /></label>
        <button className="btn primary !min-h-9 !h-9 flex items-center" onClick={() => setFilters(draft)}> Apply Filters</button>
        <button className="btn !min-h-9 !h-9 flex items-center" onClick={() => { setDraft({}); setFilters({}); }}>Reset Filters</button>
      </div>

      {/* Integration Controls — 9 */}
      <div className="panel"><div className="phead"><h2 style={{ fontSize: 14 }}>Integration Controls</h2></div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-9 gap-2">
          {CONTROLS.map(([label, desc, icon], i) => (
            <button key={label} onClick={controlHandlers[i]} disabled={busy && i === 6} className="card" style={{ padding: 9, textAlign: 'left', cursor: 'pointer', background: 'var(--card)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 5 }}>
              <Ico path={icon} tone={i === 6 ? DANGER : G7} /><div style={{ fontSize: 10.5, fontWeight: 600 }}>{label}</div><div style={{ fontSize: 9, color: 'var(--muted)', lineHeight: 1.2 }}>{desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Connected Integrations + Connection Status & Health */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.55fr_1fr] gap-3 items-start">
        <div className="panel" ref={refs.conns}><div className="phead"><h2 style={{ fontSize: 14 }}>Connected Integrations</h2></div>
          <div style={{ overflow: 'auto', maxHeight: '44vh' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 9.5, position: 'sticky', top: 0, background: 'var(--card)' }}>
                {['Integration', 'Category', 'Status', 'Tenants', 'Auth', 'Last Sync', 'Failed', 'API (Today)', 'Webhook', 'Errors'].map((h) => <th key={h} style={{ padding: '6px 5px', fontWeight: 600 }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {!conns && !fixture ? <tr><td colSpan={10} style={{ padding: 14 }}><NotConnected>Loading integrations…</NotConnected></td></tr>
                  : (conns ?? []).length === 0 ? <tr><td colSpan={10} style={{ padding: 14 }}><NotConnected>No integrations match these filters.</NotConnected></td></tr>
                    : (conns ?? []).map((r) => (
                      <tr key={r.key} style={{ borderTop: '1px solid var(--line)' }}>
                        <td style={{ padding: '6px 5px', fontWeight: 600 }}>{r.name}</td><td style={{ padding: '6px 5px', color: 'var(--muted)' }}>{r.category}</td>
                        <td style={{ padding: '6px 5px' }}><Badge v={r.status} /></td><td style={{ padding: '6px 5px' }}>{r.tenantsUsing}</td>
                        <td style={{ padding: '6px 5px' }}><Badge v={r.authStatus} /></td><td style={{ padding: '6px 5px', whiteSpace: 'nowrap', color: 'var(--muted)' }}>{r.lastSuccessfulSync ? r.lastSuccessfulSync.slice(0, 10) : '—'}</td>
                        <td style={{ padding: '6px 5px', color: r.failedSyncs ? DANGER : undefined }}>{r.failedSyncs}</td><td style={{ padding: '6px 5px' }}>{big(r.apiUsageToday)}</td>
                        <td style={{ padding: '6px 5px' }}><Badge v={r.webhookStatus} /></td><td style={{ padding: '6px 5px' }}>{r.errorLogs}</td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel"><div className="phead"><h2 style={{ fontSize: 14 }}>Connection Status &amp; Health</h2></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} ref={refs.api}>
            <div><div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 4 }}>Sync Success Trend (Last 7 Days)</div>
              {ov?.syncTrend && ov.syncTrend.length > 0 ? (() => { const pts = ov.syncTrend; const w = 300, h = 70, max = 100; const step = w / Math.max(1, pts.length - 1);
                const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - (p.successPct / max) * h).toFixed(1)}`).join(' ');
                return <svg viewBox={`0 0 ${w} ${h + 14}`} width="100%" height="84" aria-label="Sync success trend"><path d={d} fill="none" stroke={G7} strokeWidth="2" />{pts.map((p, i) => <circle key={i} cx={i * step} cy={h - (p.successPct / max) * h} r="2.5" fill={G7} />)}{pts.map((p, i) => <text key={'t' + i} x={i * step} y={h + 12} fontSize="7" fill="var(--muted)" textAnchor="middle">{p.label}</text>)}</svg>; })()
                : <NotConnected>—</NotConnected>}
            </div>
            <div><div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 4 }}>API Usage by Integration (Today)</div>
              {ov?.apiUsageByIntegration && ov.apiUsageByIntegration.length > 0 ? <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10.5 }}>{ov.apiUsageByIntegration.map((r) => (<div key={r.integration} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 96, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.integration}</span><span style={{ flex: 1, height: 8, background: 'var(--line)', borderRadius: 4, overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${Math.max(3, (r.calls / maxUsage) * 100)}%`, background: G7 }} /></span><span style={{ width: 46, textAlign: 'right', fontWeight: 600 }}>{r.calls >= 1000 ? (r.calls / 1000).toFixed(1) + 'K' : r.calls}</span></div>))}</div> : <NotConnected>—</NotConnected>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div><div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 4 }}>Integration Status</div>{ov?.statusBreakdown ? <Donut size={84} data={ov.statusBreakdown.map((s) => ({ label: s.status, value: s.count, color: statusTone(s.status) === INFO ? PURPLE : statusTone(s.status) }))} /> : <NotConnected>—</NotConnected>}</div>
              <div><div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 4 }}>Webhook Health</div>{ov?.webhookHealth ? <Donut size={84} data={ov.webhookHealth.map((s) => ({ label: s.status, value: s.count, color: statusTone(s.status) }))} /> : <NotConnected>—</NotConnected>}</div>
            </div>
          </div>
        </div>
      </div>

      <ManagedConnections reloadKey={connReload} />

      {wizard.open && <AddIntegrationWizard preselect={wizard.preselect} onClose={() => setWizard({ open: false })} onActivated={() => { setConnReload((k) => k + 1); setMsg('Connection activated — see Managed Connections.'); }} />}

      {/* four middle tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="panel" ref={refs.tenants}><div className="phead"><h2 style={{ fontSize: 14 }}>Tenant Integration Usage Overview</h2></div>
          <MiniTable head={['Tenant', 'Integrations', 'Status', 'API Calls (Today)', 'Last Sync']} rows={(tenants ?? []).map((t) => [t.tenantName, String(t.integrations), <Badge v={t.status} key="s" />, big(t.apiCallsToday), t.lastSync ? t.lastSync.slice(0, 10) : '—'])} empty={!tenants && !fixture ? 'Loading…' : 'No tenant integration usage.'} foot="View all tenants →" />
        </div>
        <div className="panel" ref={refs.events}><div className="phead"><h2 style={{ fontSize: 14 }}>Recent Webhook Events</h2></div>
          <MiniTable head={['Event Source', 'Tenant', 'Result', 'Retries', 'Timestamp']} rows={(events ?? []).map((e) => [e.eventSource, e.tenantName ?? '—', <Badge v={e.result} key="r" />, String(e.retries), e.timestamp ? e.timestamp.slice(5, 16).replace('T', ' ') : '—'])} empty={!events && !fixture ? 'Loading…' : 'No webhook events.'} foot="View all events →" />
        </div>
        <div className="panel" ref={refs.alerts}><div className="phead"><h2 style={{ fontSize: 14 }}>Authentication &amp; Token Alerts</h2></div>
          <MiniTable head={['Integration', 'Tenant', 'Issue', 'Expires On']} rows={(alerts ?? []).map((a) => [a.integration, a.tenantName ?? '—', a.issue, a.expiresOn ?? '—'])} empty={!alerts && !fixture ? 'Loading…' : 'No authentication alerts.'} foot="View all alerts →" />
        </div>
        <div className="panel" ref={refs.errors}><div className="phead"><h2 style={{ fontSize: 14 }}>Error Logs &amp; Failed Synchronizations</h2></div>
          <MiniTable head={['Integration', 'Tenant', 'Error Type', 'Severity', 'Last Attempt', 'Next Action']} rows={(errors ?? []).map((e) => [e.integration, e.tenantName ?? '—', e.errorType, <Badge v={e.severity} key="s" />, e.lastAttempt ? e.lastAttempt.slice(5, 16).replace('T', ' ') : '—', e.nextAction])} empty={!errors && !fixture ? 'Loading…' : 'No integration errors.'} foot="View all errors →" />
        </div>
      </div>

      {/* Marketplace + Quick Actions */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.55fr_1fr] gap-3 items-start">
        <div className="panel" ref={refs.market}><div className="phead"><h2 style={{ fontSize: 14 }}>Integration Marketplace / Available Services</h2></div>
          <div className="grid grid-cols-2  md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
            {(market ?? (fixture ? [{ key: 'fiserv', name: 'Fiserv', category: 'Payment Gateway' }, { key: 'twilio', name: 'Twilio', category: 'Communication' }, { key: 'retell_ai', name: 'Retell AI', category: 'AI & Voice' }, { key: 'quickbooks', name: 'QuickBooks', category: 'Accounting' }, { key: 'xero', name: 'Xero', category: 'Accounting' }, { key: 'google_calendar', name: 'Google Calendar', category: 'Productivity' }, { key: 'gmail', name: 'Gmail', category: 'Email' }, { key: 'outlook', name: 'Outlook', category: 'Email' }, { key: 'clover', name: 'Clover', category: 'Payments' }, { key: 'hardware_connectors', name: 'Hardware Connectors', category: 'Hardware' }] : []) as IntMarketplaceItem[]).map((m) => (
              <div key={m.key} className="card" style={{ padding: 9, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                <Ico path="M4 4h16v16H4z|M9 9h6v6H9z" tone={G7} /><div style={{ fontSize: 10.5, fontWeight: 600 }}>{m.name}</div><div style={{ fontSize: 9, color: 'var(--muted)' }}>{m.category}</div>
                <button className="btn" style={{ padding: '2px 8px', fontSize: 10.5 }} onClick={() => openWizard(m.key)}>Connect</button>
              </div>
            ))}
          </div>
        </div>
        <div className="panel"><div className="phead"><h2 style={{ fontSize: 14 }}>Quick Actions</h2></div>
          <div className="grid grid-cols-2  md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-2">
            {QUICK.map(([label, icon], i) => (
              <button key={label} onClick={quickHandlers[i]} className="card" style={{ padding: 9, cursor: 'pointer', background: 'var(--card)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-start' }}>
                <Ico path={icon} tone={G7} /><div style={{ fontSize: 10, fontWeight: 600 }}>{label}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* At-a-Glance Summary — 6 */}
      <div className="panel"><div className="phead"><h2 style={{ fontSize: 14 }}>At-a-Glance Summary (Today)</h2></div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
          {summary.length === 0 ? <NotConnected>—</NotConnected> : summary.map((s) => (
            <div key={s.l} className="card" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Ico path={s.i} tone={s.t} /><div style={{ fontSize: 9.5, color: 'var(--soft)', lineHeight: 1.1 }}>{s.l}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: (s as any).bad ? DANGER : 'var(--text)' }}>{s.v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MiniTable({ head, rows, empty, foot }: { head: string[]; rows: (React.ReactNode)[][]; empty: string; foot: string }) {
  return (<>
    <div style={{ overflow: 'auto', maxHeight: '30vh' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 9.5 }}>{head.map((h) => <th key={h} style={{ padding: '5px 5px', fontWeight: 600 }}>{h}</th>)}</tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={head.length} style={{ padding: 12 }}><NotConnected>{empty}</NotConnected></td></tr>
          : rows.map((r, i) => <tr key={i} style={{ borderTop: '1px solid var(--line)' }}>{r.map((c, j) => <td key={j} style={{ padding: '5px 5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
    <div style={{ marginTop: 6 }}><span style={{ fontSize: 11, color: G7, fontWeight: 600 }}>{foot}</span></div>
  </>);
}
