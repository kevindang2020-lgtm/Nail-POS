import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSuperAdminOverviewState, type Range } from '../api/superAdminOverviewApi';
import { useSuperAdminDashboard } from '../api/superAdminDashboardApi';
import { useAuth } from '../auth/AuthContext';

// PlatformDashboardScreen.tsx — S02 Super Admin › Dashboard. A platform command center that complements the Overview by
// foregrounding subscription economics (MRR + plan distribution + usage, from /super-admin/dashboard) and real system
// health (DB probe + process metrics, from /super-admin/system-health), alongside the shared platform KPIs, sales
// trend, tenant-status donut, top tenants and activity feed (from /super-admin/overview/state). Named micro-services
// without a real probe and a geographic growth map aren't wired to a source — those say so honestly.

const moneyM = (c: number) => '$' + (c / 100 >= 1_000_000 ? (c / 100_000_000).toFixed(2) + 'M' : (c / 100).toLocaleString('en-US', { maximumFractionDigits: 0 }));
const compact = (n: number) => (n >= 1_000_000 ? (n / 1_000_000).toFixed(2) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n));
const PALETTE = ['#3E8F57', '#D09A36', '#3C7FB6', '#7B5BB6', '#B85B4D', '#9C8B7F'];

function LineChart({ series }: { series: { label: string; valueCents: number }[] }) {
  if (!series.length) return <div className="state">No sales volume in this range yet.</div>;
  const W = 560, H = 150, pad = 28;
  const max = Math.max(1, ...series.map((s) => s.valueCents));
  const stepX = (W - pad * 2) / Math.max(1, series.length - 1);
  const pts = series.map((s, i) => `${pad + i * stepX},${H - 24 - (s.valueCents / max) * (H - 48)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 150 }}>
      <polyline points={pts} fill="none" stroke="var(--gold, #C77A2A)" strokeWidth="2" />
      {series.map((s, i) => i % Math.ceil(series.length / 10 || 1) === 0 ? (<text key={i} x={pad + i * stepX} y={H - 6} fontSize="9" fill="var(--muted)" textAnchor="middle">{s.label}</text>) : null)}
    </svg>
  );
}
function Donut({ slices }: { slices: { status: string; label: string; count: number; percent: number }[] }) {
  const total = slices.reduce((a, s) => a + s.count, 0);
  if (total === 0) return <div className="state">No tenants yet.</div>;
  let acc = 0; const R = 54, C = 2 * Math.PI * R;
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
      <svg viewBox="0 0 140 140" style={{ width: 120, height: 120, flex: 'none' }}>
        {slices.map((s, i) => { const dash = (s.count / total) * C; const seg = <circle key={i} cx="70" cy="70" r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="16" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" />; acc += dash; return seg; })}
        <text x="70" y="66" textAnchor="middle" fontSize="20" fontWeight="800" fill="var(--text,#2a2a2a)">{compact(total)}</text>
        <text x="70" y="84" textAnchor="middle" fontSize="9" fill="var(--muted)">Total Tenants</text>
      </svg>
      <div style={{ flex: 1 }}>{slices.map((s, i) => (<div key={i} className="legrow" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '2px 0' }}><span style={{ width: 9, height: 9, borderRadius: 2, background: PALETTE[i % PALETTE.length] }} /><span style={{ textTransform: 'capitalize' }}>{s.label || s.status}</span><span style={{ marginLeft: 'auto' }}>{s.count.toLocaleString()} <span className="muted">({s.percent}%)</span></span></div>))}</div>
    </div>
  );
}

export function PlatformDashboardScreen() {
  const nav = useNavigate();
  const { principal } = useAuth();
  const { data: d, loading, error, range, setRange } = useSuperAdminOverviewState('month');
  const { data: dash, health } = useSuperAdminDashboard();

  const planTotal = useMemo(() => (dash?.planDistribution || []).reduce((a, p) => a + p.count, 0), [dash]);

  if (error) return <div className="screen"><div className="state">{error}</div></div>;
  if (loading || !d) return <div className="screen"><div className="state">Loading platform dashboard…</div></div>;

  const k = d.kpis, p = d.platformKpis;
  const kpis = [
    { label: 'Total Tenants', value: k.totalTenants.toLocaleString(), to: '/tenants' },
    { label: 'Active Salons', value: k.activeSalons.toLocaleString(), to: '/tenants?status=active' },
    { label: 'Est. MRR', value: dash ? moneyM(dash.estimatedMrrCents) : '—', to: '/subscriptions' },
    { label: 'Monthly Card Volume', value: moneyM(k.monthlyCardVolumeCents), to: '/platform-reports' },
    { label: 'Open Tickets', value: k.openSupportTickets.toLocaleString(), to: '/support-access' },
    { label: 'System Health', value: `${k.systemHealthPercent}%`, sub: k.systemHealthLabel, to: '/system-health' },
    { label: 'Active Users', value: compact(p.activeUsers), to: '/users-roles' },
    { label: 'Locations', value: compact(p.totalLocations), to: '/branches' },
    { label: 'Technicians', value: compact(p.technicians), to: '/staff' },
    { label: 'Customers', value: compact(p.customers), to: '/customers' },
    { label: 'Appointments', value: compact(p.totalAppointments), to: '/appointments' },
    { label: 'AI Interactions', value: compact(p.aiInteractions), sub: p.aiInteractions === 0 ? 'no source yet' : undefined, to: '/ai-packages' },
  ];

  // Onboarding / action queue from real KPI counts
  const queue = [
    { l: 'Pending Tenant Approvals', v: k.pendingApplications, to: '/tenant-applications' },
    { l: 'Payment Setup Pending', v: k.paymentSetupNeeded, to: '/payment-gateways' },
    { l: 'Open Support Tickets', v: k.openSupportTickets, to: '/support-access' },
  ].filter((q) => q.v > 0);

  return (
    <div className="screen p-5" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="vh"><h1>Super Admin Dashboard</h1><div className="sub">Real-time system command center for all tenants · {principal?.fullName || 'Super Admin'}</div></div>

      <div className="kpis">{kpis.map((kp) => (<div className="kpi" key={kp.label} onClick={() => nav(kp.to)} style={{ cursor: 'pointer' }}><div className="l">{kp.label}</div><div className="v">{kp.value}</div>{(kp as any).sub ? <div className="d flat">{(kp as any).sub}</div> : null}</div>))}</div>

      <div className="grid3">
        <section className="panel">
          <div className="phead"><h2>Platform Performance <span className="muted">(All Tenants)</span></h2>
            <div className="seg">{(['day', 'week', 'month', 'year'] as Range[]).map((r) => (<button key={r} className={'segbtn' + (range === r ? ' on' : '')} onClick={() => setRange(r)}>{r[0].toUpperCase() + r.slice(1)}</button>))}</div>
          </div>
          <LineChart series={d.monthlySalesVolume} />
        </section>
        <section className="panel">
          <h2>Tenant Status Overview</h2>
          <Donut slices={d.tenantsByStatus} />
        </section>
        <section className="panel">
          <div className="phead"><h2>Subscription &amp; Usage</h2><button className="linkbtn" onClick={() => nav('/subscriptions')}>Manage</button></div>
          {!dash ? <div className="state">Loading…</div> : (
            <div>
              <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
                <div><div className="muted" style={{ fontSize: 11 }}>Est. MRR</div><div style={{ fontWeight: 800, fontSize: 18 }}>{moneyM(dash.estimatedMrrCents)}</div></div>
                <div><div className="muted" style={{ fontSize: 11 }}>Avg Usage</div><div style={{ fontWeight: 800, fontSize: 18 }}>{dash.averageUsagePercent}%</div></div>
                <div><div className="muted" style={{ fontSize: 11 }}>Over 80%</div><div style={{ fontWeight: 800, fontSize: 18 }}>{dash.tenantsOverUsage}</div></div>
              </div>
              {dash.planDistribution.length === 0 ? <div className="state">No plans yet.</div> : dash.planDistribution.map((pl) => (
                <div key={pl.planTier} style={{ marginBottom: 6 }}>
                  <div style={{ display: 'flex', fontSize: 12 }}><span>{pl.planTier}</span><span style={{ marginLeft: 'auto' }}>{pl.count} <span className="muted">({planTotal ? Math.round((pl.count / planTotal) * 100) : 0}%)</span></span></div>
                  <div style={{ height: 7, background: 'var(--line,#eee)', borderRadius: 4 }}><div style={{ width: `${planTotal ? Math.round((pl.count / planTotal) * 100) : 0}%`, height: 7, background: 'var(--gold,#C77A2A)', borderRadius: 4 }} /></div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="grid2">
        <section className="panel">
          <div className="phead"><h2>Top Tenants</h2><button className="linkbtn" onClick={() => nav('/platform-reports?report=tenant-performance')}>View All</button></div>
          {d.topPerformingTenants.length === 0 ? <div className="state">No tenant volume yet.</div> : (
            <table className="tgrid" style={{ width: '100%', fontSize: 12.5 }}><tbody>
              {d.topPerformingTenants.slice(0, 6).map((t) => (
                <tr key={t.tenantId} style={{ cursor: 'pointer' }} onClick={() => nav(`/tenants/${t.tenantId}`)}>
                  <td style={{ fontWeight: 600 }}>{t.name}</td>
                  <td className="muted">{[t.city, t.state].filter(Boolean).join(', ') || '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{moneyM(t.monthlyVolumeCents)}</td>
                  <td style={{ textAlign: 'right' }} className="muted">{t.growthPercent == null ? '—' : `${t.growthPercent > 0 ? '+' : ''}${t.growthPercent}%`}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </section>
        <section className="panel">
          <h2>System Health &amp; Services</h2>
          <div className="arow" style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 12.5 }}><span>Database</span><span className={'pill ' + ((health?.database?.ok ?? health?.ok) ? 'ok' : 'warn')}>{(health?.database?.ok ?? health?.ok) ? 'Operational' : health ? 'Degraded' : '—'}</span></div>
          {health?.database?.counts?.activeSubscriptions != null ? <div className="arow" style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 12.5 }}><span>Active Subscriptions</span><span>{health.database!.counts!.activeSubscriptions.toLocaleString()}</span></div> : null}
          <div className="arow" style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 12.5 }}><span>API Process</span><span className={'pill ok'}>Operational</span></div>
          {health?.process ? <div className="arow" style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 12.5 }}><span>Process Uptime</span><span className="muted">{Math.floor((health.process.uptimeSeconds || 0) / 60)}m · {health.process.env} · {health.process.memoryRssMb}MB</span></div> : null}
          <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>Named micro-services (AI Engine, Messaging, Payment Gateway, File Storage, Data Sync) don’t have individual probes wired — <span style={{ color: 'var(--danger,#B85B4D)' }}>not connected</span>.</div>
        </section>
      </div>

      <div className="grid3 pb-7">
        <section className="panel">
          <div className="phead"><h2>Onboarding / Action Queue</h2></div>
          {queue.length === 0 ? <div className="state">No items need action.</div> : queue.map((q) => (
            <div key={q.l} className="arow" style={{ display: 'flex', alignItems: 'center', padding: '6px 0', cursor: 'pointer' }} onClick={() => nav(q.to)}><span style={{ flex: 1, fontSize: 12.5 }}>{q.l}</span><span className="badge" style={{ background: '#FBF0E5', color: '#C77A2A' }}>{q.v}</span></div>
          ))}
        </section>
        <section className="panel">
          <div className="phead"><h2>Recent Platform Activity</h2><button className="linkbtn" onClick={() => nav('/tenant-activity')}>View All</button></div>
          {d.recentActivity.length === 0 ? <div className="state">No recent activity.</div> : d.recentActivity.slice(0, 6).map((a) => (
            <div key={a.id} className="arow" style={{ padding: '5px 0', fontSize: 12.5 }}><div style={{ fontWeight: 600 }}>{a.title}</div><div className="muted" style={{ fontSize: 11 }}>{[a.tenantName, a.ageLabel].filter(Boolean).join(' · ')}</div></div>
          ))}
        </section>
        <section className="panel">
          <h2>Quick Actions</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-2 gap-3">
            {[
              { l: 'Add Tenant', to: '/tenants' },
              { l: 'Manage Users', to: '/users-roles' },
              { l: 'View Reports', to: '/platform-reports' },
              { l: 'Open Tickets', to: '/support-access' },
              { l: 'Subscriptions', to: '/subscriptions' },
              { l: 'System Health', to: '/system-health' },
            ].map((q) => <button key={q.l} className="qbtn" onClick={() => nav(q.to)}>{q.l}</button>)}
          </div>
        </section>
      </div>
    </div>
  );
}
