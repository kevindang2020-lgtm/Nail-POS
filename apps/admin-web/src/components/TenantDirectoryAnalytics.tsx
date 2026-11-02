import type { DirectoryOverview, DirectorySlice } from '../api/superAdminApi';

// Tenant directory analytics surface (reference §7 KPIs, §13 health, §14 plan, §15 growth, §17 onboarding,
// §18 status, §21 renewals). Pure + presentational: consumes the directory-overview payload and emits navigation
// intents via callbacks. Cream/gold, reusing the existing .kpi/.panel/.legrow classes. Honest by design: null
// KPIs render "—" (NotConnected) and unavailable modules say so rather than showing fabricated numbers.

const moneyM = (c: number) => { const d = (c || 0) / 100; return d >= 1e6 ? '$' + (d / 1e6).toFixed(2) + 'M' : d >= 1e3 ? '$' + (d / 1e3).toFixed(1) + 'K' : '$' + d.toFixed(0); };
const n = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('en-US'));

// Cream/gold-compatible categorical palette for donut slices + legends.
const PALETTE = ['#A96F22', '#3E8F57', '#3C7FB6', '#7B5BB6', '#D09A36', '#B85B4D', '#4B9C8E', '#9B8B78'];

// A month-over-month display badge (text + tone) — CLIENT-only, not an API contract (Constitution 13 §15).
export type TrendBadge = { d: string; good: boolean };
export interface TenantDirectoryAnalyticsProps {
  data: DirectoryOverview;
  trends?: Record<string, TrendBadge>;          // optional MoM deltas (sourced from the overview snapshot by the parent)
  openSupportTickets?: number | null;       // platform governance KPI, sourced by the parent from overview state
  activeKpi?: string;                       // active filter key for visual highlight
  onKpi?: (key: string) => void;            // KPI / legend / alert click-through
}

function Donut({ slices, centerTop, centerSub, onSlice }: {
  slices: DirectorySlice[]; centerTop: string; centerSub: string; onSlice?: (key: string) => void;
}) {
  const R = 54, C = 2 * Math.PI * R;
  let off = 0;
  const sum = slices.reduce((a, s) => a + s.count, 0) || 1;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <svg viewBox="0 0 140 140" width="130" height="130" role="img" aria-label="distribution chart">
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--line)" strokeWidth="16" />
        {slices.map((s, i) => {
          const len = (s.count / sum) * C;
          const el = (
            <circle key={s.key} cx="70" cy="70" r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="16"
              strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} transform="rotate(-90 70 70)"
              style={{ cursor: onSlice ? 'pointer' : 'default' }} onClick={() => onSlice?.(s.key)} />
          );
          off += len; return el;
        })}
        <text x="70" y="66" textAnchor="middle" style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, fill: 'var(--text)' }}>{centerTop}</text>
        <text x="70" y="84" textAnchor="middle" style={{ fontSize: 9, fill: 'var(--muted)' }}>{centerSub}</text>
      </svg>
      <div style={{ flex: 1, minWidth: 0 }}>
        {slices.map((s, i) => (
          <div className="legrow" key={s.key} style={{ cursor: onSlice ? 'pointer' : 'default' }} onClick={() => onSlice?.(s.key)}>
            <span className="legdot" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="legl">{s.label}</span>
            <span className="legv">{s.count.toLocaleString('en-US')} ({s.pct}%)</span>
          </div>
        ))}
        {slices.length === 0 ? <div className="state">No data yet.</div> : null}
      </div>
    </div>
  );
}

function GrowthLine({ points }: { points: DirectoryOverview['growthTrend'] }) {
  const W = 320, H = 120, pad = 8;
  const vals = points.map((p) => p.totalTenants);
  const max = Math.max(1, ...vals), min = Math.min(...vals, 0);
  const x = (i: number) => pad + (i * (W - 2 * pad)) / Math.max(1, points.length - 1);
  const y = (v: number) => H - pad - ((v - min) / Math.max(1, max - min)) * (H - 2 * pad);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.totalTenants).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="tenant growth trend">
      <path d={d} fill="none" stroke="var(--g7)" strokeWidth="2" />
      {points.map((p, i) => <circle key={p.month} cx={x(i)} cy={y(p.totalTenants)} r="2.5" fill="var(--g7)"><title>{`${p.label}: ${p.totalTenants.toLocaleString('en-US')}`}</title></circle>)}
      {points.map((p, i) => <text key={p.month + 'l'} x={x(i)} y={H - 1} textAnchor="middle" style={{ fontSize: 8, fill: 'var(--muted)' }}>{p.label}</text>)}
    </svg>
  );
}

export function TenantDirectoryAnalytics({ data, trends = {}, openSupportTickets, activeKpi, onKpi }: TenantDirectoryAnalyticsProps) {
  const k = data.kpis;
  const supportTickets = openSupportTickets ?? k.openSupportTickets;
  const KPIS = [
    { key: 'all', l: 'Total Tenants', v: n(k.totalTenants), ic: '🏢', bg: '#EAF2FB', fg: '#3C7FB6' },
    { key: 'active', l: 'Active Tenants', v: n(k.activeTenants), ic: '🛍️', bg: '#EAF5EE', fg: '#3E8F57' },
    { key: 'pending', l: 'Pending Approvals', v: n(k.pendingApprovals), ic: '📋', bg: '#FFF6E5', fg: '#D09A36' },
    { key: 'suspended', l: 'Suspended Tenants', v: n(k.suspendedTenants), ic: '⛔', bg: '#FBEFE9', fg: '#B85B4D' },
    { key: 'trial', l: 'Trial Tenants', v: n(k.trialTenants), ic: '⏳', bg: '#EFE9FB', fg: '#7B5BB6' },
    { key: 'enterprise', l: 'Enterprise Tenants', v: n(k.enterpriseTenants), ic: '🏛️', bg: '#EAF2FB', fg: '#3C7FB6' },
    { key: 'branches', l: 'Total Branches', v: n(k.totalBranches), ic: '🏪', bg: '#EAF5EE', fg: '#3E8F57' },
    { key: 'devices', l: 'Active POS Devices', v: n(k.activePosDevices), ic: '🖥️', bg: '#EAF2FB', fg: '#3C7FB6' },
    { key: 'customers', l: 'Total Customers', v: n(k.totalCustomers), ic: '👥', bg: '#EFE9FB', fg: '#7B5BB6' },
    { key: 'revenue', l: 'Monthly Revenue', v: moneyM(k.monthlyRevenueCents), ic: '💲', bg: '#EAF5EE', fg: '#3E8F57' },
    { key: 'support', l: 'Open Support Tickets', v: n(supportTickets), ic: '🎫', bg: '#FBEFE9', fg: '#B85B4D' },
    { key: 'churn', l: 'Churn Risk (High)', v: n(k.churnRiskHigh), ic: '⚠️', bg: '#FFF6E5', fg: '#D09A36' },
  ];

  return (
    <>
      {/* 12 KPI CARDS (2 rows of 6) */}
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5">
        {KPIS.map((c) => {
          const t = trends[c.key];
          const isActive = activeKpi === c.key;
          return (
            <button
              key={c.key}
              onClick={() => onKpi?.(c.key)}
              title={`Filter by ${c.l}`}
              style={{
                textAlign: 'left',
                background: isActive ? '#FFFBF2' : '#FFFDF8',
                border: isActive ? '2px solid var(--g7, #A96F22)' : '1px solid var(--line)',
                borderRadius: 14,
                padding: '12px 14px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                boxShadow: isActive ? '0 4px 14px rgba(169, 111, 34, 0.16)' : '0 2px 8px rgba(169, 111, 34, 0.04)',
                minWidth: 0,
                font: 'inherit',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.borderColor = 'var(--g7, #A96F22)';
                  e.currentTarget.style.boxShadow = '0 4px 14px rgba(169, 111, 34, 0.12)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.transform = 'none';
                  e.currentTarget.style.borderColor = 'var(--line)';
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(169, 111, 34, 0.04)';
                }
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <span style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.l}
                </span>
                <span style={{ width: 26, height: 26, borderRadius: 7, background: c.bg, color: c.fg, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flex: 'none' }}>
                  {c.ic}
                </span>
              </div>
              <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 21, fontWeight: 700, color: 'var(--text)', marginTop: 6, lineHeight: 1.2 }}>
                {c.v}
              </div>
              <div style={{ fontSize: 10.5, color: t ? (t.good ? 'var(--ok,#3E8F57)' : 'var(--danger,#B85B4D)') : 'var(--muted)', marginTop: 4, fontWeight: 600 }}>
                {t ? t.d : 'vs last month'}
              </div>
            </button>
          );
        })}
      </div>

      {/* HEALTH & ALERTS + PLAN + STATUS row */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" style={{ marginTop: 14, alignItems: 'stretch' }}>
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, minHeight: 250, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <div>
            <div className="phead" style={{ marginBottom: 8 }}><h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 15 }}>Tenant Health &amp; Alerts</h2><button className="linkbtn" onClick={() => onKpi?.('health')}>View All</button></div>
            {data.healthDistribution.map((s, i) => (
              <div className="legrow" key={s.key} style={{ padding: '3px 0', fontSize: 12 }}>
                <span className="legdot" style={{ background: PALETTE[i % PALETTE.length] }} />
                <span className="legl">{s.label}</span><span className="legv">{s.count.toLocaleString('en-US')} ({s.pct}%)</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
            {data.healthAlerts.map((a) => (
              <div className="arow" key={a.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', fontSize: 11.5 }}>
                <span className="am" style={{ color: 'var(--text)', fontWeight: 500 }}>{a.available ? `${a.count.toLocaleString('en-US')} ${a.label}` : `${a.label} — NotConnected`}</span>
                {a.available ? <button className="linkbtn" style={{ padding: '2px 8px', fontSize: 10.5 }} onClick={() => onKpi?.('alert:' + a.key)}>View</button> : null}
              </div>
            ))}
          </div>
        </section>

        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, minHeight: 250, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <div className="phead" style={{ marginBottom: 8 }}><h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 15 }}>Plan Distribution</h2><button className="linkbtn" onClick={() => onKpi?.('plans')}>View Report</button></div>
          <Donut slices={data.planDistribution} centerTop={k.totalTenants.toLocaleString('en-US')} centerSub="Total Tenants" onSlice={(key) => onKpi?.('plan:' + key)} />
        </section>

        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, minHeight: 250, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <div className="phead" style={{ marginBottom: 8 }}><h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 15 }}>Tenant Status Overview</h2><button className="linkbtn" onClick={() => onKpi?.('all')}>View All</button></div>
          <Donut slices={data.statusDistribution} centerTop={k.totalTenants.toLocaleString('en-US')} centerSub="Total Tenants" onSlice={(key) => onKpi?.(key)} />
        </section>
      </div>

      {/* GROWTH + ONBOARDING + RENEWALS row — FIXED HEIGHTS */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-3" style={{ marginTop: 14, alignItems: 'stretch' }}>
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, height: 285, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <div className="phead"><h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 15 }}>Tenant Growth Trend</h2><span className="pill" style={{ background: '#FFF9EF', borderColor: 'var(--line)' }}>This Year</span></div>
          <GrowthLine points={data.growthTrend} />
          <div className="muted" style={{ fontSize: 10.5, marginTop: 4 }} title={data.meta.growthDefinition}>{data.meta.growthDefinition}</div>
        </section>

        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, height: 285, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <div className="phead"><h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 15 }}>Onboarding Pipeline</h2><span className="pill" style={{ background: '#FFF9EF', borderColor: 'var(--line)' }}>This Month</span></div>
          {!data.onboardingPipeline.available ? <div className="state">Onboarding source not connected.</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, justifyContent: 'center' }}>
              {data.onboardingPipeline.stages.map((st) => {
                const top = data.onboardingPipeline.stages[0]?.count || 1;
                return (
                  <div key={st.key} className="legrow" style={{ cursor: 'pointer', padding: '3px 0', fontSize: 12 }} onClick={() => onKpi?.('onboarding:' + st.key)}>
                    <span className="legl" style={{ flex: '0 0 140px' }}>{st.label}</span>
                    <span className="pgbar" style={{ flex: 1, height: 6, background: '#F3E7D2', borderRadius: 999, overflow: 'hidden', margin: '0 8px' }}>
                      <span style={{ display: 'block', height: '100%', width: `${Math.round((st.count / top) * 100)}%`, background: 'var(--g7, #A96F22)', borderRadius: 999 }} />
                    </span>
                    <span className="legv" style={{ fontWeight: 700 }}>{st.count}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="muted" style={{ fontSize: 11, marginTop: 'auto', paddingTop: 6, borderTop: '1px solid var(--line)' }}>
            Conversion Rate: <b>{data.onboardingPipeline.conversionRatePct}%</b>
          </div>
        </section>

        {/* Card 3: Upcoming Renewals — Scrollable list */}
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, height: 285, display: 'flex', flexDirection: 'column', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <div className="phead" style={{ marginBottom: 6 }}><h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 15 }}>Upcoming Renewals</h2><button className="linkbtn" onClick={() => onKpi?.('renewals')}>View All</button></div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
            {!data.upcomingRenewals.available ? <div className="state" style={{ padding: '20px 0' }}>Renewal source not connected.</div>
              : data.upcomingRenewals.rows.length === 0 ? <div className="state" style={{ padding: '20px 0' }}>No upcoming renewals.</div>
              : data.upcomingRenewals.rows.map((r) => (
                <div className="arow" key={r.tenantId} style={{ cursor: 'pointer', padding: '6px 0', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--line,#eee)' }} onClick={() => onKpi?.('tenant:' + r.tenantId)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.tenantName || r.tenantId}</div>
                    <div className="muted" style={{ fontSize: 10.5 }}>{r.plan || '—'} · {new Date(r.renewalDate).toLocaleDateString()}</div>
                  </div>
                  <span className="badge" style={r.warning === 'past_due' ? { background: '#FBEFE9', color: '#B85B4D', fontSize: 10.5 } : r.warning === 'renewal_approaching' ? { background: '#FFF6E5', color: '#D09A36', fontSize: 10.5 } : { background: '#EEF0F2', color: '#6B7280', fontSize: 10.5 }}>
                    {r.daysRemaining < 0 ? `${Math.abs(r.daysRemaining)}d overdue` : `in ${r.daysRemaining}d`}
                  </span>
                </div>
              ))}
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 'auto', paddingTop: 6, borderTop: '1px solid var(--line)' }}>
            Subscription Renewal Monitor
          </div>
        </section>
      </div>
    </>
  );
}
