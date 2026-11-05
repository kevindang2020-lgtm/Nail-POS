// PaymentGatewaysScreen.tsx — Super Admin → Payment Gateways command center (design parity, Mac-fit).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { superAdminApi, type PgState, type PgGateway, type PgEvent } from '../api/superAdminApi';
import { PaymentGatewayPanel } from '../components/PaymentGatewayPanel';

const num = (n?: number | null) => (n == null ? '—' : n.toLocaleString('en-US'));
const moneyM = (c?: number | null) => { const d = (c || 0) / 100; return d >= 1e6 ? '$' + (d / 1e6).toFixed(2) + 'M' : d >= 1e3 ? '$' + (d / 1e3).toFixed(1) + 'K' : '$' + d.toFixed(0); };
const money = (c?: number | null) => '$' + Math.round((c || 0) / 100).toLocaleString('en-US');
const timeAgo = (iso?: string | null): string => {
  if (!iso) return '—'; const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '—'; const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString();
};
const procLabel = (p?: string | null) => p ? p.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()) : '—';

type Badge = { t: string; bg: string; fg: string; ic?: string };
const statusBadge = (st: string): Badge => (({
  active: { t: 'Active', bg: '#E7F5EC', fg: '#1F9254' },
  pending: { t: 'Pending', bg: '#FBF0DC', fg: '#B7791F' },
  error: { t: 'Gateway Issue', bg: '#FBE7E4', fg: '#C0392B' },
  disabled: { t: 'Disabled', bg: '#F0EFF4', fg: '#6B7280' },
  paused: { t: 'On Hold', bg: '#FDF0E6', fg: '#D07A2A' },
  not_configured: { t: 'Needs Setup', bg: '#FDF0E6', fg: '#D07A2A' },
} as Record<string, Badge>)[st] || { t: st, bg: '#F0EFF4', fg: '#6B7280' });

const settleBadge = (st: string): Badge => (({
  settled: { t: 'Settled', bg: '#E7F5EC', fg: '#1F9254' },
  failed: { t: 'Failed', bg: '#FBE7E4', fg: '#C0392B' },
  pending: { t: 'Pending', bg: '#FBF0DC', fg: '#B7791F' },
  needs_review: { t: 'Needs Review', bg: '#FBF0DC', fg: '#B7791F' },
  not_applicable: { t: 'N/A', bg: '#F0EFF4', fg: '#6B7280' },
} as Record<string, Badge>)[st] || { t: st, bg: '#F0EFF4', fg: '#6B7280' });

const setupBadge = (stage: string, label: string): Badge => {
  const m = (({
    complete: { bg: '#E7F5EC', fg: '#1F9254', ic: '✓' },
    terminal_linked: { bg: '#FBF0DC', fg: '#B7791F', ic: '◷' },
    gateway_connected: { bg: '#EAF1FF', fg: '#2F6FED', ic: '◆' },
    application_submitted: { bg: '#FBF0DC', fg: '#B7791F', ic: '◷' },
    not_started: { bg: '#F0EFF4', fg: '#6B7280', ic: '○' },
  } as Record<string, { bg: string; fg: string; ic: string }>)[stage] || { bg: '#F0EFF4', fg: '#6B7280', ic: '○' });
  return { ...m, t: label };
};

const eventDot = (k: PgEvent['kind']) => ({ success: '#1F9254', warning: '#B7791F', error: '#C0392B', info: '#2F6FED' }[k] || '#8B5A18');
const STATUS_COLOR: Record<string, string> = { active: '#1F9254', pending: '#B7791F', not_configured: '#D07A2A', error: '#C0392B', disabled: '#6B7280' };

function donutBg(slices: { key: string; count: number }[]): string {
  const total = slices.reduce((a, s) => a + s.count, 0) || 1; let acc = 0; const stops: string[] = [];
  for (const s of slices) { const start = (acc / total) * 360; acc += s.count; const end = (acc / total) * 360; stops.push(`${STATUS_COLOR[s.key] || '#E2C686'} ${start}deg ${end}deg`); }
  return stops.length ? `conic-gradient(${stops.join(',')})` : 'conic-gradient(#E2C686 0deg 360deg)';
}

export function PaymentGatewaysScreen() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [s, setS] = useState<PgState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selId, setSelId] = useState<string | null>(params.get('tenant') || null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number; id: string } | null>(null);
  const [configFor, setConfigFor] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState(''); const [sortDir, setSortDir] = useState<1 | -1>(1);

  // filters (URL-synced)
  const [search, setSearch] = useState(params.get('search') || '');
  const [statusF, setStatusF] = useState(params.get('status') || '');
  const [processorF, setProcessorF] = useState(params.get('processor') || '');
  const [setupF, setSetupF] = useState(params.get('setupStage') || '');
  const [settlementF, setSettlementF] = useState(params.get('settlementStatus') || '');
  const [dateFrom, setDateFrom] = useState(params.get('dateFrom') || '');
  const [dateTo, setDateTo] = useState(params.get('dateTo') || '');
  const [page, setPage] = useState(+(params.get('page') || 1) || 1);
  const limit = 10;

  const query = useMemo(() => ({
    search: search || undefined, status: statusF || undefined, processor: processorF || undefined,
    setupStage: setupF || undefined, settlementStatus: settlementF || undefined,
    dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, page, limit,
  }), [search, statusF, processorF, setupF, settlementF, dateFrom, dateTo, page]);

  useEffect(() => {
    const p = new URLSearchParams();
    if (search) p.set('search', search); if (statusF) p.set('status', statusF); if (processorF) p.set('processor', processorF);
    if (setupF) p.set('setupStage', setupF); if (settlementF) p.set('settlementStatus', settlementF);
    if (dateFrom) p.set('dateFrom', dateFrom); if (dateTo) p.set('dateTo', dateTo); if (page > 1) p.set('page', String(page));
    if (selId) p.set('tenant', selId);
    setParams(p, { replace: true });
  }, [search, statusF, processorF, setupF, settlementF, dateFrom, dateTo, page, selId, setParams]);

  const load = useCallback(() => {
    setLoading(true);
    return superAdminApi.paymentGatewaysState(query)
      .then((r) => { setS(r); setError(null); if (!selId && r.gateways[0]) setSelId(r.gateways[0].tenantId); })
      .catch((e: any) => setError(e?.message || 'Failed to load payment gateways.'))
      .finally(() => setLoading(false));
  }, [query, selId]);
  useEffect(() => { const t = setTimeout(load, search ? 250 : 0); return () => clearTimeout(t); }, [load, search]);

  const doRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };
  const applyStatus = (v: string) => { setStatusF(v); setPage(1); };
  const applySettlement = (v: string) => { setSettlementF(v); setPage(1); };
  const clearFilters = () => { setSearch(''); setStatusF(''); setProcessorF(''); setSetupF(''); setSettlementF(''); setDateFrom(''); setDateTo(''); setPage(1); };

  const doExport = async () => {
    setBusy('export');
    try {
      const r = await superAdminApi.paymentGatewaysExport(query);
      const blob = new Blob([r.csv || ''], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = r.filename || 'payment-gateways.csv';
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      setNote('Exported ' + (r.filename || 'payment-gateways.csv') + '.');
    } catch (e: any) { setNote(e?.message || 'Export failed.'); } finally { setBusy(null); }
  };
  const testConnection = async (id: string) => {
    setMenuId(null); setBusy(id + 'test'); setNote(null);
    try { const r: any = await superAdminApi.testGateway(id); setNote(r?.ok === false ? (r?.message || 'Connection test failed. Check credentials and processor URL.') : 'Connection test passed.'); }
    catch (e: any) { setNote(e?.message || 'Connection test failed.'); } finally { setBusy(null); }
  };
  const configure = (id: string | null) => {
    setMenuId(null);
    if (!id) { setNote('Select a tenant first, then Configure Gateway.'); return; }
    setSelId(id); setConfigFor(id);
  };
  const lifecycle = async (id: string, action: 'pause' | 'resume' | 'disable') => {
    setMenuId(null); setBusy(id + action); setNote(null);
    const fn = action === 'pause' ? superAdminApi.pauseGateway : action === 'resume' ? superAdminApi.resumeGateway : superAdminApi.disableGateway;
    try { const r: any = await fn(id); setNote(`Gateway ${action === 'pause' ? 'paused' : action === 'resume' ? 'resumed' : 'disabled'}${r?.status ? ` (now ${String(r.status).replace(/_/g, ' ')})` : ''}.`); await load(); }
    catch (e: any) { setNote(e?.message || `Could not ${action} the gateway.`); } finally { setBusy(null); }
  };

  const K = s?.kpis;
  const KPIS = [
    { l: 'Total Gateways', v: num(K?.totalGateways), ic: '🌐', bg: '#EAF1FF', fg: '#2F6FED', onClick: () => applyStatus(''), sub: 'all tenants' },
    { l: 'Active Merchant Accounts', v: num(K?.activeMerchantAccounts), ic: '👥', bg: '#E7F5EC', fg: '#1F9254', onClick: () => applyStatus('active'), sub: 'gateway active' },
    { l: 'Pending Payment Setup', v: num(K?.pendingPaymentSetup), ic: '📋', bg: '#FBF0DC', fg: '#B7791F', onClick: () => applyStatus('needs_setup'), sub: 'awaiting setup' },
    { l: 'Gateway Issues', v: num(K?.gatewayIssues), ic: '⚠️', bg: '#FBE7E4', fg: '#C0392B', onClick: () => applyStatus('error'), sub: 'needs attention' },
    { l: 'Monthly Processed Volume', v: moneyM(K?.monthlyProcessedVolumeCents), ic: '💲', bg: '#E7F5EC', fg: '#1F9254', onClick: () => nav('/platform-reports?report=tenant-performance&period=current-month&source=payment-gateways-volume'), sub: 'settled this month' },
    { l: 'Failed Settlements', v: num(K?.failedSettlements), ic: '🧾', bg: '#FBE7E4', fg: '#C0392B', onClick: () => applySettlement('failed'), sub: 'this month' },
    { l: 'Chargeback Alerts', v: K && !K.chargebacksTracked ? '—' : num(K?.chargebackAlerts), ic: '↩️', bg: '#FDF0E6', fg: '#D07A2A', onClick: () => { if (K && !K.chargebacksTracked) { setNote('Chargebacks are not tracked yet — no chargeback source feed is connected.'); return; } applySettlement(''); document.getElementById('pg-recent-events')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, sub: K && !K.chargebacksTracked ? 'not tracked yet' : 'open alerts' },
    { l: 'Connected Processors', v: num(K?.connectedProcessors), ic: '🏦', bg: '#F3ECFB', fg: '#7C3AED', onClick: () => { document.getElementById('pg-top-processors')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, sub: 'distinct in use' },
  ];

  const rows = useMemo(() => {
    const r = s?.gateways ? [...s.gateways] : [];
    if (!sortBy) return r;
    const get = (g: PgGateway) => sortBy === 'name' ? g.tenantName.toLowerCase() : sortBy === 'processor' ? (g.processor || '') : sortBy === 'status' ? g.gatewayStatus : sortBy === 'vol' ? g.monthlyVolumeCents : sortBy === 'sync' ? (g.lastSyncAt || '') : '';
    return r.sort((a, b) => { const x = get(a), y = get(b); return (x < y ? -1 : x > y ? 1 : 0) * sortDir; });
  }, [s, sortBy, sortDir]);
  const sortOn = (k: string) => { if (sortBy === k) setSortDir((d) => (d === 1 ? -1 : 1)); else { setSortBy(k); setSortDir(1); } };
  const sel = s?.gateways.find((g) => g.tenantId === selId) || null;
  const pag = s?.pagination;

  if (loading && !s) return <div className="work" style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}><div className="state">Loading payment gateways…</div></div>;
  if (error) return <div className="work" style={{ padding: 32 }}><div className="err" style={{ color: '#C0392B' }}>{error} <button className="btn ghost" onClick={load} style={{ marginLeft: 10 }}>Retry</button></div></div>;

  return (
    <div className="work tnt" style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', overflowY: 'auto' }}>
      {/* HEADER BAR */}
      <div className="vh" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 24, fontWeight: 700, color: 'var(--text)' }}>Payment Gateways</h1>
          <div className="sub" style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>Manage tenant merchant accounts, payment onboarding, gateway health, settlements, and transaction activity.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn ghost" onClick={doExport} disabled={busy === 'export'} style={{ height: 36, fontWeight: 700 }} title="Export filtered gateways to CSV">⤓ {busy === 'export' ? 'Exporting…' : 'Export'}</button>
          <button className="btn ghost" onClick={doRefresh} disabled={refreshing} style={{ height: 36, fontWeight: 700 }} title="Reload payment gateways">↻ {refreshing ? 'Refreshing…' : 'Refresh'}</button>
          <button className="btn" onClick={() => configure(selId)} style={{ height: 36, fontWeight: 800 }} title="Configure the selected tenant's gateway">⚙ Configure Gateway</button>
        </div>
      </div>

      {note ? <div style={{ padding: '9px 14px', borderRadius: 10, background: '#FFF9EF', color: '#8B5A18', border: '1px solid #E2C686', fontSize: 12.5 }} onClick={() => setNote(null)}>ℹ️ {note}</div> : null}

      {/* 8 LUXURY KPI CARDS */}
      <div className="kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        {KPIS.map((k) => (
          <div
            className="kpi"
            key={k.l}
            onClick={k.onClick}
            style={{
              background: '#FFFDF8',
              border: '1px solid var(--line)',
              borderRadius: 14,
              padding: '12px 14px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)',
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); k.onClick(); } }}
            title={`Drill down: ${k.l}`}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <span className="l" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>{k.l}</span>
              <span style={{ width: 26, height: 26, borderRadius: 7, background: k.bg, color: k.fg, display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700 }}>{k.ic}</span>
            </div>
            <div className="v" style={{ fontFamily: 'Playfair Display, serif', fontSize: 20, fontWeight: 700, color: 'var(--text)', marginTop: 6 }}>{k.v}</div>
            <div className="d flat" style={{ fontSize: 11, color: k.fg, marginTop: 4, fontWeight: 600 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* MAIN: table (left) + detail panel (right) */}
      <div
        className={`grid grid-cols-1 ${sel ? 'lg:grid-cols-[minmax(0,1fr)_350px]' : ''
          } gap-3.5 items-start`}
      >
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 2px 10px rgba(169, 111, 34, 0.04)' }}>
          {/* Filter Bar */}
          <div className="filters" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 14 }}>
            <input style={{ ...INPUT, gridColumn: 'span 2' }} placeholder="Search by salon name, owner, MID, email, gateway…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            <select style={INPUT} value={statusF} onChange={(e) => { setStatusF(e.target.value); setPage(1); }} aria-label="Status">
              <option value="">All Statuses</option><option value="active">Active</option><option value="pending">Pending</option><option value="needs_setup">Needs Setup</option><option value="error">Gateway Issue</option><option value="paused">On Hold</option><option value="disabled">Disabled</option>
            </select>
            <select style={INPUT} value={processorF} onChange={(e) => { setProcessorF(e.target.value); setPage(1); }} aria-label="Processor">
              <option value="">All Processors</option>{['fiserv', 'cardpointe', 'clover', 'none'].map((p) => <option key={p} value={p}>{procLabel(p)}</option>)}
            </select>
            <select style={INPUT} value={setupF} onChange={(e) => { setSetupF(e.target.value); setPage(1); }} aria-label="Setup Stage">
              <option value="">All Stages</option><option value="application_submitted">Application Submitted</option><option value="gateway_connected">Gateway Connected</option><option value="terminal_linked">Terminal Linked</option><option value="complete">Complete</option><option value="not_started">Not Started</option>
            </select>
            <select style={INPUT} value={settlementF} onChange={(e) => { setSettlementF(e.target.value); setPage(1); }} aria-label="Settlement Status">
              <option value="">All Settlements</option><option value="settled">Settled</option><option value="needs_review">Needs Review</option><option value="failed">Failed</option><option value="pending">Pending</option><option value="not_applicable">Not Applicable</option>
            </select>
            <input style={INPUT} type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} aria-label="Date from" title="Last sync from" />
            <input style={INPUT} type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} aria-label="Date to" title="Last sync to" />
            <button className="btn ghost sm" onClick={clearFilters} style={{ height: 36, fontWeight: 700 }}>⤺ Clear Filters</button>
          </div>

          <div style={{ overflowX: 'auto', width: '100%' }}>
            <table className="ttable" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 900 }}>
              <thead>
                <tr style={{ background: '#FFFBF2', borderBottom: '1px solid var(--line)', textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '10px 12px', cursor: 'pointer' }} onClick={() => sortOn('name')}>Tenant / Salon ⇅</th>
                  <th style={{ padding: '10px 12px' }}>Owner</th>
                  <th style={{ padding: '10px 12px' }}>City / State</th>
                  <th style={{ padding: '10px 12px', cursor: 'pointer' }} onClick={() => sortOn('processor')}>Processor ⇅</th>
                  <th style={{ padding: '10px 12px' }}>MID / Account ID</th>
                  <th style={{ padding: '10px 12px', cursor: 'pointer' }} onClick={() => sortOn('status')}>Gateway Status ⇅</th>
                  <th style={{ padding: '10px 12px' }}>Payment Setup</th>
                  <th style={{ padding: '10px 12px' }}>Settlement</th>
                  <th style={{ padding: '10px 12px', cursor: 'pointer' }} onClick={() => sortOn('vol')}>Monthly Volume ⇅</th>
                  <th style={{ padding: '10px 12px', cursor: 'pointer' }} onClick={() => sortOn('sync')}>Last Sync ⇅</th>
                  <th style={{ padding: '10px 8px', width: 32 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? <tr><td colSpan={11}><div style={{ padding: 28, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No gateways match these filters.</div></td></tr> :
                  rows.map((g, idx) => {
                    const sb = statusBadge(g.gatewayStatus); const pb = setupBadge(g.setupStage, g.paymentSetupLabel); const tb = settleBadge(g.settlementStatus);
                    const isSel = selId === g.tenantId;
                    return (
                      <tr
                        key={g.tenantId}
                        style={{
                          borderBottom: '1px solid var(--line)',
                          background: isSel ? '#FFF3E9' : idx % 2 === 1 ? '#FFFDF8' : '#FFFFFF',
                          cursor: 'pointer',
                          transition: 'background 0.15s ease',
                        }}
                        onClick={() => setSelId(g.tenantId)}
                        onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = '#FFF9EF'; }}
                        onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = idx % 2 === 1 ? '#FFFDF8' : '#FFFFFF'; }}
                      >
                        <td style={{ padding: '12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 28, height: 28, borderRadius: 8, background: '#FFF9EF', border: '1px solid #E2C686', display: 'grid', placeItems: 'center', fontSize: 12 }}>🏪</span>
                            <div>
                              <div style={{ fontWeight: 700, color: 'var(--text)' }}>{g.tenantName}</div>
                              <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10.5, color: 'var(--muted)' }}>{g.salonCode || '—'}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '12px' }}>{g.ownerName || '—'}</td>
                        <td style={{ padding: '12px', color: 'var(--muted)' }} title={g.branchCount > 1 ? g.branches.map((b) => [b.city, b.state].filter(Boolean).join(', ') || b.name).join(' · ') : undefined}>
                          {g.location || '—'}{g.branchCount > 1 ? <span style={{ marginLeft: 5, padding: '1px 5px', borderRadius: 4, background: '#F0EFF4', fontSize: 10.5, fontWeight: 700 }}>+{g.branchCount - 1}</span> : null}
                        </td>
                        <td style={{ padding: '12px', fontWeight: 600 }}>{procLabel(g.processor)}</td>
                        <td style={{ padding: '12px', fontFamily: 'ui-monospace, monospace', fontSize: 11.5, color: 'var(--muted)' }}>{g.merchantIdMasked || '—'}</td>
                        <td style={{ padding: '12px' }}><span className="badge" style={{ background: sb.bg, color: sb.fg, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{sb.t}</span></td>
                        <td style={{ padding: '12px' }}><span className="badge" style={{ background: pb.bg, color: pb.fg, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{pb.ic} {pb.t}</span></td>
                        <td style={{ padding: '12px' }}><span className="badge" style={{ background: tb.bg, color: tb.fg, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{tb.t}</span></td>
                        <td style={{ padding: '12px', fontWeight: 800, color: 'var(--text)' }}><b>{g.monthlyVolumeCents ? money(g.monthlyVolumeCents) : '$0'}</b></td>
                        <td style={{ padding: '12px', color: 'var(--muted)', fontSize: 11.5 }}>{timeAgo(g.lastSyncAt)}</td>
                        <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                          <button
                            className="btn ghost sm !w-10"
                            style={{ height: 24, padding: '0 6px' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (menuPos?.id === g.tenantId) {
                                setMenuPos(null);
                              } else {
                                const rect = e.currentTarget.getBoundingClientRect();
                                const spaceBelow = window.innerHeight - rect.bottom;
                                const top = spaceBelow < 340 ? Math.max(10, rect.top - 320) : rect.bottom + 4;
                                setMenuPos({ top, right: Math.max(12, window.innerWidth - rect.right), id: g.tenantId });
                              }
                            }}
                          >
                            ⋮
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          {/* FLOATING ACTION MENU (OUTSIDE TABLE OVERFLOW) */}
          {menuPos && (() => {
            const g = rows.find((item) => item.tenantId === menuPos.id);
            if (!g) return null;
            return (
              <>
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 998 }}
                  onClick={() => setMenuPos(null)}
                />
                <div
                  className="amenu"
                  style={{
                    position: 'fixed',
                    top: menuPos.top,
                    right: menuPos.right,
                    zIndex: 999,
                    background: '#FFFDF8',
                    border: '1px solid var(--line)',
                    borderRadius: 12,
                    padding: 6,
                    boxShadow: '0 12px 36px rgba(0,0,0,0.22), 0 2px 8px rgba(169, 111, 34, 0.12)',
                    minWidth: 175,
                    maxHeight: 'min(380px, calc(100vh - 40px))',
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button className="btn ghost sm" style={{ textAlign: 'left', width: '100%', fontSize: 11.5 }} onClick={() => { setSelId(g.tenantId); setMenuPos(null); }}>View Gateway</button>
                  <button className="btn ghost sm" style={{ textAlign: 'left', width: '100%', fontSize: 11.5 }} onClick={() => { setMenuPos(null); configure(g.tenantId); }}>Configure Gateway</button>
                  <button className="btn ghost sm" style={{ textAlign: 'left', width: '100%', fontSize: 11.5 }} onClick={() => { setMenuPos(null); testConnection(g.tenantId); }} disabled={busy === g.tenantId + 'test'}>Test Connection</button>
                  <button className="btn ghost sm" style={{ textAlign: 'left', width: '100%', fontSize: 11.5 }} onClick={() => { setMenuPos(null); nav('/platform-reports?report=tenant-performance&source=payment-gateways'); }}>View Transactions</button>
                  <button className="btn ghost sm" style={{ textAlign: 'left', width: '100%', fontSize: 11.5 }} onClick={() => { setMenuPos(null); nav('/platform-reports?report=tenant-performance&source=payment-gateways-settlements'); }}>View Settlements</button>
                  <button className="btn ghost sm" style={{ textAlign: 'left', width: '100%', fontSize: 11.5 }} onClick={() => { setMenuPos(null); nav('/subscriptions'); }}>Open Billing</button>
                  <button className="btn ghost sm" style={{ textAlign: 'left', width: '100%', fontSize: 11.5 }} onClick={() => { setMenuPos(null); nav('/platform-reports'); }}>Open Reports</button>
                  <button className="btn ghost sm" style={{ textAlign: 'left', width: '100%', fontSize: 11.5 }} onClick={() => { setMenuPos(null); nav('/audit-logs?tenantId=' + encodeURIComponent(g.tenantId)); }}>Audit Logs</button>
                  {g.gatewayStatus === 'active' || g.gatewayStatus === 'pending' || g.gatewayStatus === 'error' ? <button className="btn ghost sm" style={{ textAlign: 'left', width: '100%', fontSize: 11.5 }} onClick={() => { setMenuPos(null); lifecycle(g.tenantId, 'pause'); }} disabled={busy === g.tenantId + 'pause'}>Pause Gateway</button> : null}
                  {g.gatewayStatus === 'paused' || g.gatewayStatus === 'disabled' ? <button className="btn ghost sm" style={{ textAlign: 'left', width: '100%', fontSize: 11.5 }} onClick={() => { setMenuPos(null); lifecycle(g.tenantId, 'resume'); }} disabled={busy === g.tenantId + 'resume'}>Resume Gateway</button> : null}
                  {g.hasConfig && g.gatewayStatus !== 'disabled' ? <button className="btn ghost sm" style={{ textAlign: 'left', width: '100%', fontSize: 11.5, color: '#C0392B' }} onClick={() => { setMenuPos(null); lifecycle(g.tenantId, 'disable'); }} disabled={busy === g.tenantId + 'disable'}>Disable Gateway</button> : null}
                </div>
              </>
            );
          })()}

          {pag ? (
            <div className="pgbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>
              <span>Showing {pag.total === 0 ? 0 : (pag.page - 1) * pag.limit + 1} to {Math.min(pag.page * pag.limit, pag.total)} of {pag.total.toLocaleString()} gateways</span>
              <div className="pgnums" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹</button>
                {Array.from({ length: Math.min(5, pag.pages) }, (_, i) => i + 1).map((n) => (
                  <button key={n} className={n === page ? 'btn sm' : 'btn ghost sm'} style={{ height: 26, width: 26, padding: 0 }} onClick={() => setPage(n)}>{n}</button>
                ))}
                {pag.pages > 5 ? <><span>…</span><button className="btn ghost sm" onClick={() => setPage(pag.pages)}>{pag.pages}</button></> : null}
                <button className="btn ghost sm" disabled={page >= pag.pages} onClick={() => setPage((p) => p + 1)}>›</button>
              </div>
              <span>{limit} / page</span>
            </div>
          ) : null}
        </section>

        {/* DETAIL PANEL (RIGHT RAIL) */}
        {sel && (() => {
          const sb = statusBadge(sel.gatewayStatus);
          const steps = [
            { l: 'Application Submitted', done: sel.hasConfig || ['submitted', 'under_review', 'approved'].includes(sel.onboardingStatus) },
            { l: 'Underwriting Approved', done: sel.onboardingStatus === 'approved' },
            { l: 'Gateway Connected', done: sel.credentials.apiConfigured },
            { l: 'Terminal Linked', done: sel.pairedTerminals > 0 },
          ];
          const pct = Math.round((steps.filter((x) => x.done).length / steps.length) * 100);
          const methods = [
            ...(sel.hasConfig ? ['Cards', 'Manual Entry'] : []),
            ...(sel.pairedTerminals > 0 ? ['NFC', 'Tap to Pay'] : []),
          ];
          return (
            <aside className="panel detail" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 18, boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 34, height: 34, borderRadius: 10, background: '#FFF9EF', border: '1px solid #E2C686', display: 'grid', placeItems: 'center', fontSize: 16 }}>🏪</span>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{sel.tenantName}</h2>
                    <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'ui-monospace, monospace' }}>{sel.salonCode || '—'}</div>
                  </div>
                </div>
                <span className="badge" style={{ background: sb.bg, color: sb.fg, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{sb.t}</span>
              </div>

              <div style={{ display: 'grid', gap: 6, fontSize: 12 }}>
                <Row l="Owner" v={sel.ownerName || '—'} />
                <Row l="Location" v={sel.location || '—'} />
                <Row l="Processor" v={procLabel(sel.processor)} />
                <Row l="MID / Merchant Account" v={sel.merchantIdMasked || '—'} mono />
                <Row l="Environment" v={sel.environment || '—'} />
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span style={{ color: 'var(--muted)' }}>Gateway Connection</span>
                  <b style={{ color: sel.credentials.apiConfigured ? '#1F9254' : 'var(--muted)' }}>{sel.credentials.apiConfigured ? 'Connected' : 'Not connected'}</b>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span style={{ color: 'var(--muted)' }}>Underwriting</span>
                  <b style={{ color: sel.onboardingStatus === 'approved' ? '#1F9254' : sel.onboardingStatus === 'declined' ? '#C0392B' : '#B7791F' }}>{sel.onboardingLabel}</b>
                </div>
              </div>

              {sel.branchCount > 0 ? (
                <div style={{ background: '#FFFBF2', border: '1px solid var(--line)', borderRadius: 10, padding: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6 }}>
                    <span>Branches</span><span>{sel.branchCount}</span>
                  </div>
                  {sel.branches.map((b) => (
                    <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' }}>
                      <span>{b.name}</span><b style={{ fontWeight: 600 }}>{[b.city, b.state].filter(Boolean).join(', ') || '—'}</b>
                    </div>
                  ))}
                  {sel.branchCount > sel.branches.length ? <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>+{sel.branchCount - sel.branches.length} more</div> : null}
                </div>
              ) : null}

              {/* Payment Setup Progress */}
              <div className="rounded-xl border border-[var(--line)] bg-[#FFFBF2] p-3">
                <div className="mb-1.5 flex items-center justify-between text-xs font-bold text-[#2C2118]">
                  <span>Payment Setup Progress</span>
                  <span className="text-[#8B5A18]">{pct}%</span>
                </div>
                <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-[#E2C68640]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#D4AF37] to-[#A96F22]"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="grid grid-cols-1 gap-1.5 text-[11px] sm:grid-cols-2">
                  {steps.map((x) => (
                    <div
                      key={x.l}
                      role="img"
                      aria-label={`${x.l}: ${x.done ? 'done' : 'not done'}`}   /* Sep 2026 merge: the redesign conveyed done/not-done by colour only */
                      className={`flex items-center gap-1.5 ${x.done ? "text-[#1F9254]" : "text-[var(--muted)]"
                        }`}
                    >
                      <span
                        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold leading-none ${x.done
                            ? "border-[#1F9254] bg-[#1F9254] text-white"
                            : "border-[#B8AA97] bg-transparent"
                          }`}
                      >
                        {x.done ? "✓" : ""}
                      </span>
                      <span>{x.l}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Settlement Summary */}
              <div style={{ display: 'grid', gap: 6, fontSize: 12 }}>
                <div className="dkv" style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span style={{ color: 'var(--muted)' }}>Status</span>
                  <span className="badge" style={{ background: settleBadge(sel.settlementStatus).bg, color: settleBadge(sel.settlementStatus).fg, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{settleBadge(sel.settlementStatus).t}</span>
                </div>
                <Row l="Processed Today" v={`${money(sel.todayVolumeCents)}${sel.todayTxnCount > 0 ? ` · ${sel.todayTxnCount} txn` : ''}`} />
                <Row l="Month to Date (settled)" v={moneyM(sel.monthlyVolumeCents)} />
                <Row l="Paired Terminals" v={String(sel.pairedTerminals)} />
              </div>

              {/* Supported Payment Methods */}
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6 }}>Supported Methods</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {methods.length ? methods.map((m) => (
                    <span key={m} style={{ padding: '3px 8px', borderRadius: 6, background: '#FFF9EF', border: '1px solid #E2C686', fontSize: 11.5, fontWeight: 600, color: '#8B5A18' }}>{m}</span>
                  )) : <span style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>No methods configured yet.</span>}
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 4 }}>
                <button className="btn sm" onClick={() => configure(sel.tenantId)} style={{ gridColumn: 'span 2', fontWeight: 800 }}>⚙ Configure Gateway</button>
                <button className="btn ghost sm" onClick={() => testConnection(sel.tenantId)} disabled={busy === sel.tenantId + 'test'}>Test Connection</button>
                {sel.gatewayStatus === 'paused' || sel.gatewayStatus === 'disabled'
                  ? <button className="btn ghost sm" onClick={() => lifecycle(sel.tenantId, 'resume')} disabled={busy === sel.tenantId + 'resume'}>Resume Gateway</button>
                  : sel.hasConfig ? <button className="btn ghost sm" onClick={() => lifecycle(sel.tenantId, 'pause')} disabled={busy === sel.tenantId + 'pause'}>Pause Gateway</button> : null}
                <button className="btn ghost sm" onClick={() => nav('/subscriptions')}>Open Billing</button>
                <button className="btn ghost sm" onClick={() => nav('/platform-reports')}>Open Reports</button>
              </div>
            </aside>
          );
        })()}
      </div>

      {/* 4 ANALYTICS MODULES */}
      <div className="agrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, paddingBottom: 24 }}>
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Gateway Status Breakdown</h2>
          {!s ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>Loading…</div> : s.analytics.statusBreakdown.length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>No gateways yet.</div> : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ position: 'relative', width: 120, height: 120, flex: 'none' }}>
                <div style={{ width: 120, height: 120, borderRadius: '50%', background: donutBg(s.analytics.statusBreakdown) }} />
                <div style={{ position: 'absolute', inset: 18, borderRadius: '50%', background: '#FFFDF8', display: 'grid', placeItems: 'center', textAlign: 'center' }}>
                  <div><div style={{ fontFamily: 'Playfair Display, serif', fontSize: 20, fontWeight: 700 }}>{num(K?.totalGateways)}</div><div style={{ fontSize: 10, color: 'var(--muted)' }}>Total</div></div>
                </div>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {s.analytics.statusBreakdown.map((sl) => (
                  <div key={sl.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: STATUS_COLOR[sl.key] || '#E2C686' }} />{sl.label}</span>
                    <b>{sl.count.toLocaleString()} ({sl.pct}%)</b>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="panel" id="pg-top-processors" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Top Processors</h2>
          {!s ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>Loading…</div> : s.analytics.topProcessors.length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>No active gateways yet.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5, borderBottom: '1px solid var(--line)' }}><th style={{ padding: '4px 0' }}>#</th><th>Processor</th><th>Active Gateways</th><th>Monthly Volume</th></tr></thead>
              <tbody>
                {s.analytics.topProcessors.map((p) => (
                  <tr key={p.processor} style={{ borderBottom: '1px solid var(--line)' }}><td style={{ padding: '6px 0', color: 'var(--muted)' }}>{p.rank}</td><td><b>{procLabel(p.processor)}</b></td><td>{p.activeGateways.toLocaleString()}</td><td>{money(p.monthlyVolumeCents)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel" id="pg-recent-events" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Recent Payment Events</h2>
          {!s ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>Loading…</div> : s.analytics.recentEvents.length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>No events yet.</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 240, overflowY: 'auto' }}>
              {s.analytics.recentEvents.map((e) => (
                <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, paddingBottom: 4, borderBottom: '1px solid var(--line)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: eventDot(e.kind), flex: 'none' }} />
                  <div style={{ minWidth: 0, flex: 1 }}><div style={{ fontWeight: 600 }}>{e.label}</div><div style={{ fontSize: 11, color: 'var(--muted)' }}>{e.tenantName || 'Unknown tenant'}</div></div>
                  <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{timeAgo(e.at)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Recent Gateway Activity</h2>
          {!s ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>Loading…</div> : s.analytics.recentActivity.length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>No activity yet.</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 240, overflowY: 'auto' }}>
              {s.analytics.recentActivity.map((e) => (
                <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, paddingBottom: 4, borderBottom: '1px solid var(--line)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: eventDot(e.kind), flex: 'none' }} />
                  <div style={{ minWidth: 0, flex: 1 }}><div style={{ fontWeight: 600 }}>{e.label}</div><div style={{ fontSize: 11, color: 'var(--muted)' }}>{e.tenantName || 'Unknown tenant'}</div></div>
                  <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{timeAgo(e.at)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* CONFIGURE GATEWAY DRAWER */}
      {configFor ? (
        <div role="dialog" aria-label="Configure Gateway" onClick={() => setConfigFor(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(20, 16, 10, 0.65)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#FFFDF8', borderRadius: 16, padding: 24, width: 560, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 70px rgba(0,0,0,0.45)', border: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: 12, marginBottom: 14 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Configure Gateway {sel ? <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 400 }}>· {sel.tenantName} ({sel.salonCode || '—'})</span> : null}</h2>
              <button className="btn ghost sm" onClick={() => { setConfigFor(null); load(); }}>Close</button>
            </div>
            <PaymentGatewayPanel tenantId={configFor} branches={sel?.branches?.map((b) => ({ id: b.id, name: b.name }))} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Row({ l, v, mono }: { l: string; v: string; mono?: boolean }) {
  return (
    <div className="dkv" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '3px 0' }}>
      <span>{l}</span>
      <b style={{ fontFamily: mono ? 'ui-monospace, monospace' : 'inherit', fontSize: mono ? 11.5 : 12 }}>{v}</b>
    </div>
  );
}

const INPUT: React.CSSProperties = {
  height: 36,
  border: '1px solid var(--line)',
  borderRadius: 8,
  padding: '0 10px',
  background: '#FFFFFF',
  fontFamily: 'inherit',
  fontSize: 12.5,
  color: 'var(--text)',
  boxSizing: 'border-box',
};
