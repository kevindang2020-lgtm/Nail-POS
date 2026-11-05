// PlatformReportsScreen.tsx — Platform Reports (spec §16). Every number comes from GET /super-admin/platform/reports,
// which derives strictly from real tables (approved payments only; declined excluded).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { superAdminApi } from '../api/superAdminApi';

const money = (c: number) => '$' + (c / 100).toLocaleString('en-US', { maximumFractionDigits: 0 });
const label = (s: string) => s.replace(/_/g, ' ');
const initials = (n: string) => (n || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

type Perf = { rank: number; tenantId: string; tenantName: string; city: string | null; state: string | null; plan: string | null; status: string | null; monthlyCardVolumeCents: number; priorMonthVolumeCents: number; growthPercent: number | null; transactionCount: number; averageTicketCents: number };

function GrowthCell({ g }: { g: number | null }) {
  if (g == null) return <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>New</span>;
  const isPos = g >= 0;
  return (
    <span style={{ color: isPos ? '#1F9254' : '#C0392B', fontWeight: 700, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      {isPos ? '▲' : '▼'} {Math.abs(g)}%
    </span>
  );
}

function TenantPerformance({ rows, highlighted }: { rows: Perf[]; highlighted: boolean }) {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => { if (highlighted && ref.current) ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [highlighted]);

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [stateF, setStateF] = useState('');
  const [statusF, setStatusF] = useState('');
  const [planF, setPlanF] = useState('');
  const [growthF, setGrowthF] = useState('');
  const [sortBy, setSortBy] = useState<string>(sp.get('sortBy') || 'monthlyCardVolume');
  const [dir, setDir] = useState<'asc' | 'desc'>(sp.get('sortDirection') === 'asc' ? 'asc' : 'desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number; id: string } | null>(null);
  const [data, setData] = useState<Awaited<ReturnType<typeof superAdminApi.tenantPerformanceReport>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { const t = setTimeout(() => { setDebounced(search); setPage(1); }, 250); return () => clearTimeout(t); }, [search]);

  const load = () => {
    setLoading(true);
    superAdminApi.tenantPerformanceReport({ search: debounced, state: stateF, status: statusF, plan: planF, growthDirection: growthF, sortBy, sortDirection: dir, page, limit: pageSize })
      .then((d) => { setData(d); setErr(null); })
      .catch((e: any) => setErr(e?.message || 'Unable to load tenant performance report.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [debounced, stateF, statusF, planF, growthF, sortBy, dir, page, pageSize]);

  const sortOn = (k: string) => { if (sortBy === k) setDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSortBy(k); setDir('desc'); } setPage(1); };
  const arrow = (k: string) => sortBy === k ? (dir === 'asc' ? ' ▲' : ' ▼') : '';

  const fallback = useMemo(() => {
    const cur = rows.reduce((a, r) => a + r.monthlyCardVolumeCents, 0), prior = rows.reduce((a, r) => a + r.priorMonthVolumeCents, 0);
    const txn = rows.reduce((a, r) => a + r.transactionCount, 0), withVol = rows.filter((r) => r.monthlyCardVolumeCents > 0);
    return { totalVolumeCents: cur, totalTransactions: txn, averageTenantVolumeCents: withVol.length ? Math.round(cur / withVol.length) : 0, topTenantVolumeCents: rows[0]?.monthlyCardVolumeCents ?? 0, momGrowthPercent: prior > 0 ? Math.round(((cur - prior) / prior) * 1000) / 10 : null, activeTenantsIncluded: withVol.length };
  }, [rows]);
  const stateOpts = useMemo(() => Array.from(new Set(rows.map((r) => r.state).filter(Boolean))).sort() as string[], [rows]);

  const sum = data?.summary ?? fallback;
  const pageRows = (data?.rows ?? rows.slice(0, pageSize)) as Perf[];
  const total = data?.total ?? rows.length;
  const totalPages = data?.totalPages ?? Math.max(1, Math.ceil(total / pageSize));
  const curPage = data?.page ?? page;

  return (
    <section className="panel" ref={ref} style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 18, boxShadow: highlighted ? '0 0 0 2px var(--aps-orange, #A96F22), 0 4px 20px rgba(169, 111, 34, 0.08)' : '0 2px 10px rgba(169, 111, 34, 0.04)' }}>
      {/* HEADER & SEARCH */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, borderBottom: '1px solid var(--line)', paddingBottom: 12, marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>
            Tenant Performance Report
          </h2>
          <div className="sub" style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            Compare tenant card volume, growth, transactions, and platform activity
          </div>
        </div>
        <input
          placeholder="Search salon, city, state…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...INPUT, width: 240, height: 36, fontSize: 12.5 }}
        />
      </div>

      {/* FILTERS */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <select value={stateF} onChange={(e) => { setStateF(e.target.value); setPage(1); }} style={{ ...INPUT, width: 'auto', height: 34, fontSize: 12 }}><option value="">All States</option>{stateOpts.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select value={statusF} onChange={(e) => { setStatusF(e.target.value); setPage(1); }} style={{ ...INPUT, width: 'auto', height: 34, fontSize: 12 }}><option value="">All Statuses</option>{['active', 'paused', 'trial', 'pending', 'suspended', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select value={planF} onChange={(e) => { setPlanF(e.target.value); setPage(1); }} style={{ ...INPUT, width: 'auto', height: 34, fontSize: 12 }}><option value="">All Plans</option>{['Starter', 'Professional', 'Enterprise', 'Custom'].map((p) => <option key={p} value={p}>{p}</option>)}</select>
        <select value={growthF} onChange={(e) => { setGrowthF(e.target.value); setPage(1); }} style={{ ...INPUT, width: 'auto', height: 34, fontSize: 12 }}><option value="">All Growth</option><option value="positive">Positive</option><option value="negative">Negative</option><option value="new">New</option></select>
        {loading ? <span style={{ fontSize: 11.5, color: 'var(--muted)', marginLeft: 4 }}>Loading…</span> : null}
      </div>

      {/* 6 TOP SUMMARY KPIS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 14 }}>
        {[
          { l: 'Total Card Volume', v: money(sum.totalVolumeCents), bg: '#EAF1FF', fg: '#2F6FED', icon: '💳' },
          { l: 'Transactions', v: sum.totalTransactions.toLocaleString(), bg: '#F3ECFB', fg: '#7C3AED', icon: '🧾' },
          { l: 'Avg Tenant Volume', v: money(sum.averageTenantVolumeCents), bg: '#FBF0DC', fg: '#B7791F', icon: '📊' },
          { l: 'Top Tenant Volume', v: money(sum.topTenantVolumeCents), bg: '#E7F5EC', fg: '#1F9254', icon: '🏆' },
          { l: 'MoM Growth', v: sum.momGrowthPercent == null ? '—' : <GrowthCell g={sum.momGrowthPercent} />, bg: '#FDF0E6', fg: '#D07A2A', icon: '📈' },
          { l: 'Active Tenants', v: sum.activeTenantsIncluded, bg: '#EAF1FF', fg: '#2F6FED', icon: '🏪' },
        ].map((k) => (
          <div key={k.l} className="kpi" style={{ background: '#FFFFFF', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="l" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>{k.l}</span>
              <span style={{ fontSize: 11, width: 22, height: 22, borderRadius: 6, background: k.bg, color: k.fg, display: 'grid', placeItems: 'center' }}>{k.icon}</span>
            </div>
            <div className="v" style={{ fontFamily: 'Playfair Display, serif', fontSize: 18, fontWeight: 700, color: 'var(--text)', marginTop: 4 }}>
              {k.v}
            </div>
          </div>
        ))}
      </div>

      {err ? (
        <div style={{ padding: 20, textAlign: 'center', color: '#C0392B' }}>
          {err} <button className="btn ghost sm" onClick={load} style={{ marginLeft: 6 }}>Retry</button>
        </div>
      ) : total === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontSize: 13, background: '#FFFBF2', borderRadius: 10, border: '1px dashed var(--line)' }}>
          No approved card volume yet. Tenant performance appears once payments are processed.
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto', width: '100%' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5,minWidth: 1100 }}>
              <thead>
                <tr className='whitespace-nowrap' style={{ background: '#FFFBF2', borderBottom: '1px solid var(--line)', textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '10px 12px', width: 36 }}>#</th>
                  <th style={{ padding: '10px 12px' }}>Tenant / Salon</th>
                  <th style={{ padding: '10px 12px' }}>City, State</th>
                  <th style={{ padding: '10px 12px' }}>Plan</th>
                  <th style={{ padding: '10px 12px' }}>Status</th>
                  <th role="columnheader" style={{ padding: '10px 12px', cursor: 'pointer', fontWeight: 700 }} onClick={() => sortOn('monthlyCardVolume')}>Monthly Volume{arrow('monthlyCardVolume')}</th>
                  <th role="columnheader" style={{ padding: '10px 12px', cursor: 'pointer', fontWeight: 700 }} onClick={() => sortOn('transactionCount')}>Txns{arrow('transactionCount')}</th>
                  <th role="columnheader" style={{ padding: '10px 12px', cursor: 'pointer', fontWeight: 700 }} onClick={() => sortOn('averageTicket')}>Avg Ticket{arrow('averageTicket')}</th>
                  <th role="columnheader" style={{ padding: '10px 12px', cursor: 'pointer', fontWeight: 700 }} onClick={() => sortOn('growth')}>Growth{arrow('growth')}</th>
                  <th style={{ padding: '10px 8px', width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((p, idx) => (
                  <tr
                    key={p.tenantId}
                    style={{
                      borderBottom: '1px solid var(--line)',
                      background: idx % 2 === 1 ? '#FFFDF8' : '#FFFFFF',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#FFF9EF'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = idx % 2 === 1 ? '#FFFDF8' : '#FFFFFF'; }}
                  >
                    <td style={{ padding: '12px', fontWeight: 800, color: 'var(--muted)' }}>{p.rank}</td>
                    <td style={{ padding: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 28, height: 28, borderRadius: 8, background: '#FFF9EF', border: '1px solid #E2C686', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800, color: '#8B5A18' }}>
                          {initials(p.tenantName)}
                        </span>
                        <span style={{ fontWeight: 700, color: 'var(--text)' }}>{p.tenantName}</span>
                      </div>
                    </td>
                    <td style={{ padding: '12px', color: 'var(--muted)' }}>{[p.city, p.state].filter(Boolean).join(', ') || '—'}</td>
                    <td style={{ padding: '12px' }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: '#F0EFF4', color: '#4B5563' }}>
                        {p.plan || '—'}
                      </span>
                    </td>
                    <td style={{ padding: '12px' }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: p.status === 'active' ? '#E7F5EC' : '#FBF0DC', color: p.status === 'active' ? '#1F9254' : '#B7791F' }}>
                        {p.status || '—'}
                      </span>
                    </td>
                    <td style={{ padding: '12px', fontWeight: 800, color: 'var(--text)' }}>{money(p.monthlyCardVolumeCents)}</td>
                    <td style={{ padding: '12px', color: 'var(--muted)' }}>{p.transactionCount.toLocaleString()}</td>
                    <td style={{ padding: '12px', color: 'var(--text)', fontWeight: 600 }}>{money(p.averageTicketCents)}</td>
                    <td style={{ padding: '12px' }}><GrowthCell g={p.growthPercent} /></td>
                    <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                      <button
                        className="btn ghost sm !w-10"
                        style={{ height: 24, padding: '0 6px' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (menuPos?.id === p.tenantId) {
                            setMenuPos(null);
                          } else {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const spaceBelow = window.innerHeight - rect.bottom;
                            const top = spaceBelow < 280 ? Math.max(10, rect.top - 260) : rect.bottom + 4;
                            setMenuPos({ top, right: Math.max(12, window.innerWidth - rect.right), id: p.tenantId });
                          }
                        }}
                      >
                        ⋮
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* FLOATING ACTION MENU (OUTSIDE TABLE OVERFLOW) */}
          {menuPos && (() => {
            const p = pageRows.find((item) => item.tenantId === menuPos.id);
            if (!p) return null;
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
                    minWidth: 165,
                    maxHeight: 'min(380px, calc(100vh - 40px))',
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button className="btn ghost sm" style={{ textAlign: 'left', width: '100%', fontSize: 11.5 }} onClick={() => { setMenuPos(null); nav(`/tenants?focus=${encodeURIComponent(p.tenantId)}`); }}>View Tenant</button>
                  <button className="btn ghost sm" style={{ textAlign: 'left', width: '100%', fontSize: 11.5 }} onClick={() => { setMenuPos(null); nav(`/subscriptions?tenant=${encodeURIComponent(p.tenantId)}`); }}>Open Billing</button>
                  <button className="btn ghost sm" style={{ textAlign: 'left', width: '100%', fontSize: 11.5 }} onClick={() => { setMenuPos(null); nav(`/platform-reports?report=tenant-performance&tenantId=${encodeURIComponent(p.tenantId)}`); }}>Open Reports</button>
                  <button className="btn ghost sm" style={{ textAlign: 'left', width: '100%', fontSize: 11.5 }} onClick={() => { setMenuPos(null); nav(`/payment-gateways?tenant=${encodeURIComponent(p.tenantId)}`); }}>Payment Gateway</button>
                  <button className="btn ghost sm" style={{ textAlign: 'left', width: '100%', fontSize: 11.5 }} onClick={() => { setMenuPos(null); nav(`/hardware-packages?tenantId=${encodeURIComponent(p.tenantId)}`); }}>Hardware</button>
                </div>
              </>
            );
          })()}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>
            <span>Showing {total ? (curPage - 1) * pageSize + 1 : 0}–{Math.min(curPage * pageSize, total)} of {total}</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select value={pageSize} onChange={(e) => { setPageSize(+e.target.value); setPage(1); }} style={{ ...INPUT, height: 28, width: 80, padding: '0 6px', fontSize: 11.5 }}>
                {[10, 25, 50].map((n) => <option key={n} value={n}>{n}/page</option>)}
              </select>
              <button className="btn ghost sm" style={{ height: 28 }} disabled={curPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
              <span>Page {curPage} / {totalPages}</span>
              <button className="btn ghost sm" style={{ height: 28 }} disabled={curPage >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function Bars({ title, rows, fmt }: { title: string; rows: { k: string; v: number }[]; fmt?: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.v));
  return (
    <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
      <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{title}</h3>
      {rows.length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>No data yet.</div> : rows.map((r) => (
        <div key={r.k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
          <span style={{ width: 110, flex: 'none', fontSize: 12, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.k}</span>
          <div style={{ flex: 1, height: 16, background: '#FFF9EF', borderRadius: 8, overflow: 'hidden', border: '1px solid #E2C686' }}>
            <div style={{ width: `${Math.round((r.v / max) * 100)}%`, height: '100%', background: 'linear-gradient(90deg, #D4AF37, #A96F22)', borderRadius: 8 }} />
          </div>
          <span style={{ width: 80, flex: 'none', textAlign: 'right', fontWeight: 700, fontSize: 12, color: 'var(--text)' }}>{fmt ? fmt(r.v) : r.v}</span>
        </div>
      ))}
    </section>
  );
}

export function PlatformReportsScreen() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const report = params.get('report');
  const [r, setR] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const fetchReports = () => superAdminApi.reports().then((x: any) => { setR(x); setErr(null); }).catch((e: any) => setErr(e?.message || 'Failed to load reports.'));
  useEffect(() => { fetchReports(); }, []);

  if (err) return <div className="work"><div className="vh"><h1>Platform Reports</h1></div><div className="err" style={{ marginTop: 12, color: '#C0392B' }}>{err} <button className="btn ghost" onClick={fetchReports} style={{ marginLeft: 8 }}>Retry</button></div></div>;
  if (!r) return <div className="work"><div className="vh"><h1>Platform Reports</h1></div><div className="state" style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div></div>;

  const statusRows = (o: Record<string, number>) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ k: label(k), v: Number(v) }));
  const t = r.totals;
  const tenantPerf = (r.tenantPerformance || []) as Perf[];

  return (
    <div className="work" style={{ overflowY: 'auto', height: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="vh" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 24, fontWeight: 700, color: 'var(--text)' }}>Platform Reports</h1>
          <div className="sub" style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>Real platform data — approved payment volume only; declined transactions excluded</div>
        </div>
      </div>

      {/* Tenant Performance Report */}
      <div><TenantPerformance rows={tenantPerf} highlighted={report === 'tenant-performance'} /></div>

      {/* 6 GLOBAL KPI CARDS */}
      <div className="kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        {[
          { l: 'Total Tenants', v: t.totalTenants, onClick: () => nav('/tenants'), icon: '🏪', bg: '#EAF1FF', fg: '#2F6FED' },
          { l: 'Active Salons', v: t.activeTenants, icon: '✓', bg: '#E7F5EC', fg: '#1F9254' },
          { l: 'Platform Volume', v: money(t.platformVolumeCents), icon: '💵', bg: '#FBF0DC', fg: '#B7791F' },
          { l: 'AI Calls Used', v: t.aiCallsUsed.toLocaleString(), icon: '🤖', bg: '#F3ECFB', fg: '#7C3AED' },
          { l: 'Support Sessions (30d)', v: t.supportSessions30d, onClick: () => nav('/support-access'), icon: '🎧', bg: '#EAF1FF', fg: '#2F6FED' },
          { l: 'Gateway Errors', v: t.gatewayErrorTenants, onClick: () => nav('/payment-gateways'), icon: '⚠️', bg: t.gatewayErrorTenants > 0 ? '#FBE7E4' : '#E7F5EC', fg: t.gatewayErrorTenants > 0 ? '#C0392B' : '#1F9254' },
        ].map((k) => (
          <div
            key={k.l}
            className="kpi"
            style={{
              background: '#FFFDF8',
              border: '1px solid var(--line)',
              borderRadius: 14,
              padding: '12px 14px',
              cursor: k.onClick ? 'pointer' : 'default',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)',
            }}
            onClick={k.onClick}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="l" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>{k.l}</span>
              <span style={{ width: 24, height: 24, borderRadius: 6, background: k.bg, color: k.fg, display: 'grid', placeItems: 'center', fontSize: 12 }}>{k.icon}</span>
            </div>
            <div className="v" style={{ fontFamily: 'Playfair Display, serif', fontSize: 20, fontWeight: 700, color: k.l === 'Gateway Errors' && t.gatewayErrorTenants > 0 ? '#C0392B' : 'var(--text)', marginTop: 6 }}>
              {k.v}
            </div>
          </div>
        ))}
      </div>

      {/* 2-COL CHARTS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <Bars title="Monthly Tenant Growth (12 mo)" rows={(r.monthlyTenantGrowth || []).map((m: any) => ({ k: m.month, v: m.count }))} />
        <Bars title="Monthly Payment Volume (12 mo)" rows={(r.monthlyPaymentVolume || []).map((m: any) => ({ k: m.month, v: m.amountCents }))} fmt={money} />
      </div>

      {/* 3-COL CHARTS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
        <Bars title="Lead Funnel" rows={statusRows(r.leadFunnel)} />
        <Bars title="Application Pipeline" rows={statusRows(r.applicationPipeline)} />
        <Bars title="Hardware Packages" rows={statusRows(r.hardwareByStatus)} />
      </div>

      {/* 3-COL CHARTS BOTTOM */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, paddingBottom: 24 }}>
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Top Tenants by Volume</h3>
          {(r.topTenantsByVolume || []).length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>No approved payments yet.</div> : (r.topTenantsByVolume as any[]).map((x, i) => (
            <div key={x.tenantId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 20, fontWeight: 800, color: 'var(--muted)' }}>{i + 1}</span>
                <span style={{ fontWeight: 600 }}>🏪 {x.tenantName}</span>
              </div>
              <strong style={{ color: '#1F9254' }}>{money(x.amountCents)}</strong>
            </div>
          ))}
        </section>
        <Bars title="Tenants by State" rows={(r.tenantsByState || []).map((x: any) => ({ k: x.state, v: x.tenants }))} />
        <Bars title="Subscriptions by Plan (active + trialing)" rows={statusRows(r.subscriptionsByPlan)} />
      </div>
    </div>
  );
}

const INPUT: React.CSSProperties = {
  height: 34,
  border: '1px solid var(--line)',
  borderRadius: 8,
  padding: '0 10px',
  background: '#FFFFFF',
  fontFamily: 'inherit',
  fontSize: 12.5,
  color: 'var(--text)',
  boxSizing: 'border-box',
};
