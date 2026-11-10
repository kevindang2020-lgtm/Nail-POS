// PlansScreen.tsx — Super Admin → Plans & Feature Limits → All Plans (read-only). Wired to GET /super-admin/plans/overview.
// Cream/gold design system; matches the reference layout module-for-module. Honest rendering: values with no real data
// source yet render "—"/"Not connected yet" (never fabricated). Money is integer cents from the API, formatted here.
import { useMemo, useState, useEffect, type CSSProperties } from 'react';
import { usePlansOverview, superAdminPlansApi, type PlanDirectoryRow, type PlanUtilization } from '../api/superAdminPlansApi';
import { UnlinkedPlansPanel } from './UnlinkedPlansPanel';
import { AddPlanModal, ChangePricingModal, ChangePlanModal, ManageOffersModal, EntitlementsModal, ConfigureDefaultLimitsModal, ConfigureOveragePricingModal, GrandfatherModal, PlanUtilizationModal } from './PlanModals';

const fmt = (n: number) => n.toLocaleString('en-US');
const dollars = (cents: number) => '$' + Math.round(cents / 100).toLocaleString('en-US');
const perUnit = (cents: number) => '$' + (cents / 100).toFixed(2);

// The 13 configurable limits, in the reference column order. `card` = label used in the Configurable Limits cards.
const METRICS: { key: string; label: string; card: string }[] = [
  { key: 'branches', label: 'Branch Limit', card: 'Branches' },
  { key: 'users', label: 'User Limit', card: 'Users' },
  { key: 'technicians', label: 'Technician Limit', card: 'Technicians' },
  { key: 'customers', label: 'Customer Limit', card: 'Customers' },
  { key: 'appointments_monthly', label: 'Appt Limit (Mo.)', card: 'Appointments' },
  { key: 'sms_monthly', label: 'SMS Allowance', card: 'SMS Allowance' },
  { key: 'email_monthly', label: 'Email Allowance', card: 'Email Allowance' },
  { key: 'ai_minutes_monthly', label: 'AI Minutes (Mo.)', card: 'AI Minutes' },
  { key: 'ai_receptionist_calls_monthly', label: 'AI Recept. Calls', card: 'AI Receptionist Calls' },
  { key: 'storage_gb', label: 'Storage', card: 'Storage' },
  { key: 'devices', label: 'Devices', card: 'Devices' },
  { key: 'integrations', label: 'Integrations', card: 'Integrations' },
  { key: 'report_retention_days', label: 'Report Retention', card: 'Report Retention' },
];

const limitLabel = (metric: string, v: number | null | undefined): string => {
  if (v === null || v === undefined) return 'Unlimited';
  if (metric === 'storage_gb') return `${v} GB`;
  if (metric === 'report_retention_days') return `${v} days`;
  return fmt(v);
};

const statusTone = (s: string): { bg: string; fg: string; bd: string } => {
  const k = s.toLowerCase();
  if (k === 'active') return { bg: '#E8F5EC', fg: '#1F7A43', bd: '#BFE3CC' };
  if (k === 'draft' || k === 'scheduled') return { bg: '#EEF2F8', fg: '#3A557E', bd: '#CFDBEC' };
  if (k === 'archived' || k === 'deprecated' || k === 'inactive') return { bg: '#F3EDE6', fg: '#7A6A57', bd: '#E2D3BF' };
  return { bg: '#FBEFE0', fg: 'var(--g8)', bd: 'var(--gline)' };
};

// honest gap helpers
const Gap = ({ note = 'Not connected yet' }: { note?: string }) => (
  <div className="muted" style={{ fontSize: 12, padding: '14px 2px' }}>{note}</div>
);

function KpiCard({ label, value, note, tone, sub }: { label: string; value: string; note?: string; tone: string; sub?: string }) {
  return (
    <div tabIndex={0} aria-label={`${label}: ${note ? 'not connected' : value}`}
      style={{
        textAlign: 'left',
        background: '#FFFDF8',
        border: '1px solid var(--line)',
        borderRadius: 14,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)',
        minWidth: 0,
        height: '100%',
      }}
    >
      <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 20, fontWeight: 700, color: note ? '#B4A88E' : 'var(--text)', marginTop: 6, lineHeight: 1.2 }}>{value}</div>
      <div style={{ fontSize: 10.5, color: note ? '#B4A88E' : tone, marginTop: 4, fontWeight: 600 }}>{note || sub || '\u00A0'}</div>
    </div>
  );
}

export function PlansScreen() {
  const { data, loading, error, reload } = usePlansOverview();
  const [util, setUtil] = useState<PlanUtilization | null>(null);
  const [utilLoading, setUtilLoading] = useState(true);
  useEffect(() => {
    let live = true;
    superAdminPlansApi.planUtilization().then((u) => live && setUtil(u)).catch(() => live && setUtil(null)).finally(() => live && setUtilLoading(false));
    return () => { live = false; };
  }, []);
  // tenants at or approaching a limit, flattened to their offending metrics (near/over)
  const limitWarnings = useMemo(() => {
    if (!util) return [] as { name: string; metric: string; used: number; effective: number; pct: number; status: string }[];
    const out: { name: string; metric: string; used: number; effective: number; pct: number; status: string }[] = [];
    for (const t of util.tenants) for (const m of t.metrics) if (m.pct >= 90 || m.status === 'warning' || m.status === 'blocked' || m.status === 'overage') out.push({ name: t.name, metric: m.metric, used: m.used, effective: m.effective, pct: m.pct, status: m.status });
    return out.sort((a, b) => b.pct - a.pct);
  }, [util]);
  const [q, setQ] = useState('');
  const [planType, setPlanType] = useState('all');
  const [status, setStatus] = useState('all');
  const [modal, setModal] = useState<null | { kind: 'add' } | { kind: 'price'; planId?: string } | { kind: 'change' } | { kind: 'offers'; tab: 'addon' | 'trial' | 'promo' } | { kind: 'ent'; tab: 'limits' | 'features' } | { kind: 'defaults' } | { kind: 'overage' } | { kind: 'grandfather' } | { kind: 'utilization' }>(null);

  const plans = useMemo(() => data?.plans ?? [], [data]);
  const k = data?.kpis;

  const typeOptions = useMemo(() => Array.from(new Set(plans.map((p) => p.planType))).sort(), [plans]);
  const statusOptions = useMemo(() => Array.from(new Set(plans.map((p) => p.status))).sort(), [plans]);

  const filtered = useMemo(() => plans.filter((p) => {
    if (planType !== 'all' && p.planType !== planType) return false;
    if (status !== 'all' && p.status !== status) return false;
    if (q.trim()) {
      const hay = `${p.name} ${p.code} ${p.subtitle ?? ''} ${p.planType}`.toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  }), [plans, q, planType, status]);

  // Configurable Limits cards: the platform max across plans per metric (Unlimited if any plan is unlimited). Real.
  const configurable = useMemo(() => METRICS.map((m) => {
    if (plans.length === 0) return { ...m, display: '—' };
    let anyUnlimited = false; let max = 0;
    for (const p of plans) {
      const v = p.limits[m.key];
      if (v === null || v === undefined) { anyUnlimited = true; } else if (v > max) max = v;
    }
    return { ...m, display: anyUnlimited ? 'Unlimited' : limitLabel(m.key, max) };
  }), [plans]);

  const totalTenants = filtered.reduce((s, p) => s + p.tenantCount, 0);

  const exportCsv = () => {
    const head = ['Plan', 'Code', 'Tenants', 'Monthly Price', ...METRICS.map((m) => m.card), 'Status'];
    const lines = filtered.map((p) => [
      p.name, p.code, String(p.tenantCount), dollars(p.monthlyPriceCents),
      ...METRICS.map((m) => limitLabel(m.key, p.limits[m.key])), p.status,
    ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `plans-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const QUICK_ACTIONS = [
    'Create Subscription Plan', 'Change Pricing', 'Enable/Disable Features', 'Configure Default Limits',
    'Assign Custom Limits', 'Add Promotional Plan', 'Apply Trial Period', 'Create Grandfathered Plan',
    'Configure Overage Pricing', 'Upgrade/Downgrade Tenant', 'View Plan Utilization',
  ];

  if (loading) return <div className="work" aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', overflowY: 'auto' }}><div className="muted" style={{ padding: 24 }}>Loading plans…</div></div>;
  if (error) return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', overflowY: 'auto' }}><section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16 }}><div style={{ padding: 16 }}>
      <div style={{ color: 'var(--danger)', fontWeight: 600 }}>Couldn’t load plans</div>
      <div className="muted" style={{ fontSize: 12, margin: '6px 0 12px' }}>{error}</div>
      <button onClick={reload} style={btn()}>Retry</button>
    </div></section></div>
  );

  const kpiCards = [
    { label: 'Total Plans', value: fmt(k!.totalPlans), tone: 'var(--ok)', sub: `${k!.activePlans} active` },
    { label: 'Active Tenants on Plans', value: fmt(k!.activeTenantsOnPlans), tone: 'var(--info)', sub: k!.unmappedActiveSubscriptions ? `${k!.unmappedActiveSubscriptions} unmapped` : undefined },
    { label: 'Trial Tenants', value: '—', tone: 'var(--muted)', note: 'Not connected yet' },
    { label: 'Unlimited Packages', value: fmt(k!.unlimitedPackages), tone: '#7B5BB6' },
    { label: 'Monthly Plan Revenue', value: dollars(k!.monthlyPlanRevenueCents), tone: 'var(--ok)', sub: k!.mappedActiveTenants === 0 ? 'no mapped tenants' : undefined },
    { label: 'Add-On Revenue', value: '—', tone: 'var(--muted)', note: 'Not connected yet' },
    { label: 'Over-Limit Tenants', value: '—', tone: 'var(--muted)', note: 'Not connected yet' },
    { label: 'Avg Plan Utilization', value: '—', tone: 'var(--muted)', note: 'Not connected yet' },
    { label: 'AI Minutes Used (Mo.)', value: '—', tone: 'var(--muted)', note: 'Not connected yet' },
    { label: 'Active Promotional Plans', value: '—', tone: 'var(--muted)', note: 'Not connected yet' },
  ];

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', overflowY: 'auto' }}>
      {/* header */}
      <div className="vh flex flex-col xl:flex-row justify-between gap-3">
        <div>
          <h1 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 24, fontWeight: 700, color: 'var(--text)', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            Plans &amp; Feature Limits <span aria-hidden style={{ color: 'var(--g7)' }}>★</span>
          </h1>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
            Control subscription plans, usage limits, add-ons, and tenant-specific feature access across all tenants.
          </div>
        </div>
        <div className='items-baseline flex-wrap' style={{ display: 'flex', gap: 8 }}>
          <button onClick={exportCsv} className="btn ghost">Export Report</button>
          <button className="btn ghost" disabled title="Bulk actions arrive with the plan-management workflows" >Bulk Actions</button>
          <button className="btn " onClick={() => setModal({ kind: 'add' })} >+ Add Plan</button>
        </div>
      </div>

      {/* 10 KPI cards */}
      <div className=" grid  grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 mb-3 mt-3">
        {kpiCards.map((c) => <KpiCard key={c.label} {...c} />)}
      </div>

      {/* batch 8 decision 3: salons whose plan maps to no catalogue plan (their Features page is empty) */}
      <div className="mb-3"><UnlinkedPlansPanel /></div>

      {/* directory (left) + alert rails (right) */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-3.5 items-start">
        <section className="panel" aria-label="All Plans Directory" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 0, overflow: 'hidden', boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)', display: 'flex', flexDirection: 'column' }}>
          <div className="phead" style={{ background: '#FFF9EF', padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>All Plans Directory <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· {filtered.length} of {plans.length}</span></h2>
            <div style={{ display: 'flex', gap: 6 }}>
              <input aria-label="Search plans" placeholder="Search plans..." value={q} onChange={(e) => setQ(e.target.value)} style={inp(170)} />
              <select aria-label="Plan type" value={planType} onChange={(e) => setPlanType(e.target.value)} style={inp(140)}>
                <option value="all">All Plan Types</option>{typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} style={inp(120)}>
                <option value="all">All Statuses</option>{statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div style={{ overflow: 'auto', maxHeight: 360 }}>
            <table style={tbl()}>
              <thead>
                <tr>
                  <th style={th()}>Plan Name</th><th style={thR()}>Tenants</th><th style={thR()}>Monthly</th>
                  {METRICS.map((m) => <th key={m.key} style={thR()}>{m.label}</th>)}
                  <th style={th()}>Status</th><th style={th()}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => <PlanRow key={p.id} p={p} onPrice={(id) => setModal({ kind: 'price', planId: id })} />)}
                {filtered.length === 0 && <tr><td colSpan={18} className="muted" style={{ padding: 16, textAlign: 'center' }}>No plans match these filters.</td></tr>}
              </tbody>
              {filtered.length > 0 && (
                <tfoot>
                  <tr>
                    <td style={tdFoot()}>Total / Avg.</td><td style={{ ...tdFoot(), textAlign: 'right' }}>{fmt(totalTenants)}</td>
                    <td style={{ ...tdFoot(), textAlign: 'right' }}>—</td>
                    {METRICS.map((m) => <td key={m.key} style={{ ...tdFoot(), textAlign: 'right' }}>—</td>)}
                    <td style={tdFoot()}>—</td><td style={tdFoot()}>—</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>

        <div style={{ display: 'grid', gap: 14 }}>
          <section className="panel" aria-label="Plan Health & Alerts" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)' }}>
            <div className="phead"><h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Plan Health &amp; Alerts</h2></div>
            {utilLoading ? <div className="muted" style={{ fontSize: 12, padding: '6px 2px' }}>Loading…</div> : !util ? <Gap note="Utilization unavailable." /> : (
              <div style={{ display: 'grid', gap: 6, fontSize: 12.5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Tenants evaluated</span><strong>{fmt(util.summary.tenants)}</strong></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Over limit</span><strong style={{ color: util.summary.tenantsOverLimit ? '#9B2C2C' : 'var(--text)' }}>{fmt(util.summary.tenantsOverLimit)}</strong></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Approaching limit</span><strong style={{ color: util.summary.tenantsNearLimit ? '#8B5A18' : 'var(--text)' }}>{fmt(util.summary.tenantsNearLimit)}</strong></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Avg peak utilization</span><strong>{util.summary.avgMaxUtilizationPct}%</strong></div>
              </div>
            )}
          </section>
          <section className="panel" aria-label="Feature Limit Warnings" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)' }}>
            <div className="phead"><h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Feature Limit Warnings</h2></div>
            {utilLoading ? <div className="muted" style={{ fontSize: 12, padding: '6px 2px' }}>Loading…</div> : limitWarnings.length === 0 ? <Gap note={util ? 'No tenants near or over a limit.' : 'Utilization unavailable.'} /> : (
              <div style={{ display: 'grid', gap: 5, fontSize: 12 }}>
                {limitWarnings.slice(0, 8).map((w, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{w.name} · <span className="muted">{w.metric}</span></span>
                    <span style={badge(w.pct >= 100 ? '#FBEAEA' : '#FBEFE0', w.pct >= 100 ? '#9B2C2C' : '#8B5A18', w.pct >= 100 ? '#F0C9C9' : 'var(--gline)')}>{w.used}/{w.effective} · {w.pct}%</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* analytics row */}
      <div className=" grid  grid-cols-1 md:grid-cols-2  xl:grid-cols-3 2xl:grid-cols-4 gap-2.5 mt-3">
        <section className="panel" aria-label="Plan Distribution" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, height: 285, overflowY: 'auto', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)', display: 'flex', flexDirection: 'column' }}>
          <div className="phead"><h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, flex: '0 0 auto' }}>Plan Distribution</h2></div>
          <div style={{ fontSize: 12, flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{fmt(k!.mappedActiveTenants)} <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>mapped tenants</span></div>
            <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
              {data!.planDistribution.map((d) => (
                <li key={d.code} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span>{d.name}</span><span className="muted">{d.tenantCount}</span>
                </li>
              ))}
            </ul>
            {k!.mappedActiveTenants === 0 && <div className="muted" style={{ marginTop: 6, fontSize: 11 }}>No active subscriptions map to a catalog plan yet.</div>}
          </div>
        </section>
        <section className="panel" aria-label="Revenue by Plan" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, height: 285, overflowY: 'auto', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)', display: 'flex', flexDirection: 'column' }}>
          <div className="phead"><h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, flex: '0 0 auto' }}>Revenue by Plan</h2></div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {k!.monthlyPlanRevenueCents === 0 ? <Gap note="No mapped subscription revenue yet." /> : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 12 }}>
                {plans.map((p) => <li key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}><span>{p.name}</span><span className="muted">{dollars(p.monthlyPriceCents * p.tenantCount)}</span></li>)}
              </ul>
            )}
          </div>
        </section>
        <section className="panel" aria-label="Plan Utilization Trend" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, height: 285, overflowY: 'auto', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)', display: 'flex', flexDirection: 'column' }}>
          <div className="phead"><h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, flex: '0 0 auto' }}>Plan Utilization Trend</h2></div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            {data!.utilizationTrend.length === 0 ? <Gap note="No snapshots captured yet — a daily snapshot builds this series." /> : (
              <>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120, padding: '4px 0' }}>
                  {data!.utilizationTrend.map((p) => (
                    <div key={p.capturedOn} title={`${p.capturedOn}: avg peak ${p.avgMaxPct}%, ${p.tenantsOver} over / ${p.tenantsNear} near`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 3 }}>
                      <div style={{ width: '70%', height: `${Math.max(2, p.avgMaxPct)}%`, background: p.tenantsOver > 0 ? '#C2410C' : 'var(--g7)', borderRadius: '3px 3px 0 0' }} />
                      <div className="muted" style={{ fontSize: 9 }}>{p.capturedOn.slice(5)}</div>
                    </div>
                  ))}
                </div>
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Average peak utilization per snapshot; bars turn amber when any tenant is over a limit.</div>
              </>
            )}
          </div>
        </section>
        <section className="panel" aria-label="Feature Adoption Overview" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, height: 285, overflowY: 'auto', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)', display: 'flex', flexDirection: 'column' }}>
          <div className="phead"><h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, flex: '0 0 auto' }}>Feature Adoption Overview</h2></div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            {data!.featureAdoption.length === 0 ? <Gap note="No features defined." /> : (
              <div style={{ flex: 1, overflowY: 'auto', display: 'grid', gap: 6 }}>
              {data!.featureAdoption.map((f) => {
                const pct = plans.length ? Math.round((f.enabledPlans / plans.length) * 100) : 0;
                return (
                  <div key={f.featureKey} style={{ display: 'grid', gridTemplateColumns: '1.4fr 2fr 0.9fr', gap: 8, alignItems: 'center', fontSize: 11.5 }}>
                    <div>{f.featureKey}{f.tenantEnabled > 0 && <span className="muted"> · +{f.tenantEnabled} tenant</span>}</div>
                    <div style={{ height: 6, borderRadius: 4, background: 'var(--cream2)', overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: 'var(--g7)' }} /></div>
                    <div style={{ textAlign: 'right' }}>{f.enabledPlans}/{plans.length} <span className="muted">({pct}%)</span></div>
                  </div>
                );
              })}
              </div>
            )}
            <div className="muted" style={{ fontSize: 11, marginTop: 6, flex: '0 0 auto' }}>Plans that enable each feature (plus tenant-level overrides where present).</div>
          </div>
        </section>
      </div>

      {/* tables row */}
      <div className=" grid  grid-cols-1 md:grid-cols-2  xl:grid-cols-3 gap-2.5 mt-3">
        <section className="panel" aria-label="Add-On Performance" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 0, overflow: 'hidden', boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)', display: 'flex', flexDirection: 'column' }}>
          <div className="phead" style={{ background: '#FFF9EF', padding: '12px 16px', borderBottom: '1px solid var(--line)' }}><h2 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Add-On Performance</h2></div>
          <div style={{ overflowX: 'auto', flex: 1 }}>
            <table style={tbl()}>
              <thead><tr><th style={th()}>Add-On</th><th style={thR()}>Unit Price</th><th style={thR()}>Tenants</th><th style={thR()}>Revenue (Mo.)</th></tr></thead>
            <tbody>
              {data!.addOns.map((a) => (
                <tr key={a.code}>
                  <td style={td()}>{a.name}</td>
                  <td style={tdR()}>{dollars(a.unitPriceCents)}/mo</td>
                  <td style={tdR()}>{fmt(a.tenantCount)}</td>
                  <td style={tdR()}>{a.tenantCount > 0 ? dollars(a.monthlyRevenueCents) : '—'}</td>
                </tr>
              ))}
              {data!.addOns.length === 0 && <tr><td colSpan={4}><Gap note="No add-ons configured." /></td></tr>}
            </tbody>
          </table>
          </div>
          <div className="muted" style={{ fontSize: 11, padding: '8px 16px', borderTop: '1px solid var(--line)' }}>Tenant/revenue fill in as add-ons are subscribed.</div>
        </section>
        <section className="panel" aria-label="Overage Pricing Summary" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 0, overflow: 'hidden', boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)', display: 'flex', flexDirection: 'column' }}>
          <div className="phead" style={{ background: '#FFF9EF', padding: '12px 16px', borderBottom: '1px solid var(--line)' }}><h2 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Overage Pricing Summary</h2></div>
          <div style={{ overflowX: 'auto', flex: 1 }}>
            <table style={tbl()}>
              <thead><tr><th style={th()}>Overage Type</th><th style={thR()}>Unit Price</th><th style={thR()}>Tenants</th><th style={thR()}>Revenue (Mo.)</th></tr></thead>
            <tbody>
              {data!.overagePricing.map((o) => (
                <tr key={o.metric}>
                  <td style={td()}>{METRICS.find((m) => m.key === o.metric)?.card ?? o.metric}</td>
                  <td style={tdR()}>{perUnit(o.unitPriceCents)}</td>
                  <td style={tdR()} className={o.tenants ? undefined : 'muted'}>{o.tenants ? fmt(o.tenants) : '—'}</td>
                  <td style={tdR()} className={o.revenueCents ? undefined : 'muted'}>{o.revenueCents ? dollars(o.revenueCents) : '—'}</td>
                </tr>
              ))}
              {data!.overagePricing.length === 0 && <tr><td colSpan={4}><Gap note="No overage rules." /></td></tr>}
            </tbody>
            {data!.overagePricing.length > 0 && (
              <tfoot><tr>
                <td style={td()}><strong>Total Overage Revenue (Mo.)</strong></td><td style={tdR()} /><td style={tdR()} />
                <td style={tdR()}><strong>{data!.overageTotalRevenueCents ? dollars(data!.overageTotalRevenueCents) : '—'}</strong></td>
              </tr></tfoot>
            )}
          </table>
          </div>
          <div className="muted" style={{ fontSize: 11, padding: '8px 16px', borderTop: '1px solid var(--line)' }}>Tenant/revenue reflect the current billing period; run a recompute to refresh.</div>
        </section>
        <section className="panel" aria-label="Top Plans by Revenue" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)', display: 'flex', flexDirection: 'column' }}>
          <div className="phead"><h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Top Plans by Revenue</h2></div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {k!.monthlyPlanRevenueCents === 0 ? <Gap note="No mapped revenue to rank yet." /> : (
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
              {[...plans].sort((a, b) => b.monthlyPriceCents * b.tenantCount - a.monthlyPriceCents * a.tenantCount).map((p) => (
                <li key={p.id} style={{ padding: '2px 0' }}>{p.name} — {dollars(p.monthlyPriceCents * p.tenantCount)}</li>
              ))}
            </ol>
          )}
          </div>
        </section>
      </div>

      {/* trial/promo + tenant limit usage */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 14, alignItems: 'stretch' }}>
        <section className="panel" aria-label="Trial & Promotional Plans" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 0, overflow: 'hidden', boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)', display: 'flex', flexDirection: 'column' }}>
          <div className="phead" style={{ background: '#FFF9EF', padding: '12px 16px', borderBottom: '1px solid var(--line)' }}><h2 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Trial &amp; Promotional Plans</h2></div>
          <div style={{ overflowX: 'auto', flex: 1 }}>
            <table style={tbl()}>
              <thead><tr><th style={th()}>Plan / Promotion</th><th style={th()}>Type</th><th style={thR()}>Tenants</th><th style={th()}>Ends On</th></tr></thead>
            <tbody>
              {data!.trialsPromotions.map((x) => (
                <tr key={x.kind + x.code}>
                  <td style={td()}>{x.name}</td>
                  <td style={td()}><span style={badge(x.kind === 'trial' ? '#EEF2F8' : '#FBEFE0', x.kind === 'trial' ? '#3A557E' : 'var(--g8)', x.kind === 'trial' ? '#CFDBEC' : 'var(--gline)')}>{x.detail ?? x.kind}</span></td>
                  <td style={tdR()}>{fmt(x.tenantCount)}</td>
                  <td style={td()}>{x.endsOn ? new Date(x.endsOn).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
              {data!.trialsPromotions.length === 0 && <tr><td colSpan={4}><Gap note="No active trials or promotions." /></td></tr>}
            </tbody>
          </table>
          </div>
        </section>
        <section className="panel" aria-label="Tenant Limit Usage Overview" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 0, overflow: 'hidden', boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)', display: 'flex', flexDirection: 'column' }}>
          <div className="phead" style={{ background: '#FFF9EF', padding: '12px 16px', borderBottom: '1px solid var(--line)' }}><h2 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Tenant Limit Usage Overview</h2></div>
          <div style={{ overflowX: 'auto', flex: 1 }}>
            {utilLoading ? <div className="muted" style={{ fontSize: 12, padding: '16px' }}>Loading…</div> : !util || util.tenants.length === 0 ? <Gap note="No tenant usage to display yet." /> : (
              <table style={tbl()}>
                <thead><tr><th style={th()}>Tenant</th><th style={th()}>Plan</th><th style={thR()}>Peak</th><th style={th()}>Status</th></tr></thead>
              <tbody>
                {util.tenants.map((t) => (
                  <tr key={t.tenantId}>
                    <td style={td()}>{t.name}</td>
                    <td style={td()}>{t.planText ?? '—'}</td>
                    <td style={tdR()}>{t.metrics.length ? `${t.maxPct}%` : '—'}</td>
                    <td style={td()}>{t.metrics.length === 0 ? <span className="muted">no metered limits</span>
                      : <span style={badge(t.worstStatus === 'over' ? '#FBEAEA' : t.worstStatus === 'near' ? '#FBEFE0' : '#E7F2EA', t.worstStatus === 'over' ? '#9B2C2C' : t.worstStatus === 'near' ? '#8B5A18' : '#2F6B43', t.worstStatus === 'over' ? '#F0C9C9' : t.worstStatus === 'near' ? 'var(--gline)' : '#BFE0CB')}>{t.worstStatus === 'over' ? 'Over' : t.worstStatus === 'near' ? 'Near' : 'Healthy'}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          </div>
        </section>
      </div>

      {/* configurable limits */}
      <section className="panel" aria-label="Configurable Limits" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)' }}>
        <div className="phead"><h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Configurable Limits <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>(Per Plan)</span></h2></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
          {configurable.map((c) => (
            <div key={c.key} style={limCard()}>
              <div className="muted" style={{ fontSize: 11 }}>{c.card}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>Up to</div>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{c.display}</div>
            </div>
          ))}
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Limits can be configured per plan or customized per tenant as needed.</div>
      </section>

      {/* recommended defaults + recent activity */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, alignItems: 'stretch' }}>
        <section className="panel" aria-label="Recommended Default Limits" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)', display: 'flex', flexDirection: 'column' }}>
          <div className="phead"><h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Recommended Default Limits</h2></div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 12.5, display: 'grid', gap: 8, flex: 1 }}>
            <li><b>2,500 Customers</b> <span className="muted">— Recommended for most salons</span></li>
            <li><b>10 Technicians</b> <span className="muted">— Ideal for growing teams</span></li>
            <li><b>Optional Unlimited Package</b> <span className="muted">— For high-growth enterprises</span></li>
            <li><b>Custom Monthly Pricing</b> <span className="muted">— Flexible pricing for every market</span></li>
          </ul>
          <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Recommendations are editable by an authorized Super Admin.</div>
        </section>
        <section className="panel" aria-label="Recent Plan Activity" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)', display: 'flex', flexDirection: 'column' }}>
          <div className="phead"><h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Recent Plan Activity</h2></div>
          <Gap note="Plan activity log connects with the plan-management workflows." />
        </section>
      </div>

      {/* quick actions */}
      <section className="panel" aria-label="Quick Actions" style={{ marginBottom: 8, background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)' }}>
        <div className="phead"><h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Quick Actions</h2></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
          {QUICK_ACTIONS.map((a) => {
            const handler = a === 'Create Subscription Plan' ? () => setModal({ kind: 'add' })
              : a === 'Change Pricing' ? () => setModal({ kind: 'price' })
              : a === 'Upgrade/Downgrade Tenant' ? () => setModal({ kind: 'change' })
              : a === 'Add Promotional Plan' ? () => setModal({ kind: 'offers', tab: 'promo' })
              : a === 'Apply Trial Period' ? () => setModal({ kind: 'offers', tab: 'trial' })
              : a === 'Assign Custom Limits' ? () => setModal({ kind: 'ent', tab: 'limits' })
              : a === 'Enable/Disable Features' ? () => setModal({ kind: 'ent', tab: 'features' })
              : a === 'Configure Default Limits' ? () => setModal({ kind: 'defaults' })
              : a === 'Configure Overage Pricing' ? () => setModal({ kind: 'overage' })
              : a === 'Create Grandfathered Plan' ? () => setModal({ kind: 'grandfather' })
              : a === 'View Plan Utilization' ? () => setModal({ kind: 'utilization' })
              : undefined;
            return (
              <button key={a} onClick={handler} disabled={!handler}
                title={handler ? a : 'This workflow arrives in a later unit'}
                style={{ ...btn(!handler), justifyContent: 'flex-start', height: 38 }}>{a}</button>
            );
          })}
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>All quick actions are live.</div>
      </section>

      {modal?.kind === 'add' && (
        <AddPlanModal onClose={() => setModal(null)} onCreated={() => { setModal(null); reload(); }} />
      )}
      {modal?.kind === 'price' && plans.length > 0 && (
        <ChangePricingModal plans={plans} initialPlanId={modal.planId} onClose={() => setModal(null)} onChanged={() => { setModal(null); reload(); }} />
      )}
      {modal?.kind === 'change' && (
        <ChangePlanModal tenants={data!.tenantSubscriptions} plans={plans} onClose={() => setModal(null)} onChanged={() => { setModal(null); reload(); }} />
      )}
      {modal?.kind === 'offers' && (
        <ManageOffersModal
          tenants={data!.tenantSubscriptions}
          addOns={data!.addOns.map((a) => ({ code: a.code, name: a.name, unitPriceCents: a.unitPriceCents }))}
          offers={data!.trialsPromotions.map((o) => ({ kind: o.kind, code: o.code, name: o.name }))}
          initialTab={modal.tab}
          onClose={() => setModal(null)} onChanged={() => reload()} />
      )}
      {modal?.kind === 'ent' && (
        <EntitlementsModal tenants={data!.tenantSubscriptions} initialTab={modal.tab} onClose={() => setModal(null)} onChanged={() => reload()} />
      )}
      {modal?.kind === 'defaults' && plans.length > 0 && (
        <ConfigureDefaultLimitsModal plans={plans} onClose={() => setModal(null)} onChanged={() => { setModal(null); reload(); }} />
      )}
      {modal?.kind === 'overage' && (
        <ConfigureOveragePricingModal onClose={() => setModal(null)} onChanged={() => reload()} />
      )}
      {modal?.kind === 'grandfather' && plans.length > 0 && (
        <GrandfatherModal tenants={data!.tenantSubscriptions} plans={plans} onClose={() => setModal(null)} onChanged={() => reload()} />
      )}
      {modal?.kind === 'utilization' && (
        <PlanUtilizationModal onClose={() => setModal(null)} />
      )}
    </div>
  );
}

function PlanRow({ p, onPrice }: { p: PlanDirectoryRow; onPrice: (id: string) => void }) {
  const st = statusTone(p.status);
  return (
    <tr>
      <td style={td()}>
        <div style={{ fontWeight: 600 }}>{p.name}</div>
        <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
          {p.subtitle && <span className="muted" style={{ fontSize: 10.5 }}>{p.subtitle}</span>}
          {p.isRecommended && <span style={badge('#FBEFE0', 'var(--g8)', 'var(--gline)')}>Most Popular</span>}
        </div>
      </td>
      <td style={tdR()}>{fmt(p.tenantCount)}</td>
      <td style={tdR()}>{dollars(p.monthlyPriceCents)}</td>
      {METRICS.map((m) => <td key={m.key} style={tdR()}>{limitLabel(m.key, p.limits[m.key])}</td>)}
      <td style={td()}><span style={badge(st.bg, st.fg, st.bd)}>{p.status}</span></td>
      <td style={td()}><button onClick={() => onPrice(p.id)} title="Change pricing" aria-label={`Change pricing for ${p.name}`} style={btn()}>⋯</button></td>
    </tr>
  );
}

// ---- inline cream/gold style helpers (kept local; mirror the design tokens) ----
function btn(disabled = false, primary = false): CSSProperties {
  return {
    height: 34, padding: '0 12px', borderRadius: 9, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
    border: '1px solid ' + (primary ? 'var(--g7)' : 'var(--line)'),
    background: disabled ? '#F3EDE3' : primary ? 'var(--g7)' : '#FFFDF8',
    color: disabled ? 'var(--muted)' : primary ? '#fff' : 'var(--text)', opacity: disabled ? 0.85 : 1,
  };
}
const inp = (w: number): CSSProperties => ({ height: 32, width: w, border: '1px solid var(--line)', borderRadius: 9, background: '#FFFDF8', padding: '0 10px', fontFamily: 'inherit', fontSize: 12 });
const tbl = (): CSSProperties => ({ width: '100%', borderCollapse: 'collapse', fontSize: 12 });
const th = (): CSSProperties => ({ textAlign: 'left', padding: '8px 8px', position: 'sticky', top: 0, background: 'var(--card)', borderBottom: '1px solid var(--line)', fontSize: 11, color: 'var(--soft)', whiteSpace: 'nowrap' });
const thR = (): CSSProperties => ({ ...th(), textAlign: 'right' });
const td = (): CSSProperties => ({ padding: '8px 8px', borderBottom: '1px solid var(--cream2)', verticalAlign: 'top', whiteSpace: 'nowrap' });
const tdR = (): CSSProperties => ({ ...td(), textAlign: 'right' });
const tdFoot = (): CSSProperties => ({ padding: '8px', borderTop: '1px solid var(--line)', fontWeight: 600, fontSize: 11.5, color: 'var(--soft)', whiteSpace: 'nowrap' });
const limCard = (): CSSProperties => ({ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', background: '#FFFDF8' });
const badge = (bg: string, fg: string, bd: string): CSSProperties => ({ display: 'inline-block', padding: '1px 7px', borderRadius: 999, fontSize: 10.5, fontWeight: 600, background: bg, color: fg, border: '1px solid ' + bd });
