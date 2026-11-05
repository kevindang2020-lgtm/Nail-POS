import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useScope } from '../shell/ScopeContext';
import { useAnalytics, isGap, analyticsApi, downloadExport, type AnalyticsRange, type CompareMode, type ExportFormat, type Kpi } from '../api/superAdminAnalyticsApi';
import { Donut, MiniBars, AreaLine, NotConnected, PALETTE, money, moneyK } from './_chartkit';

// AnalyticsScreen.tsx — S03 Super Admin › Analytics. Platform-level business intelligence across every
// tenant/branch, composed by GET /super-admin/analytics (one request, scope-aware). Layout/order/density
// match the reference 1:1, rendered in the app's existing cream/gold system (per the project design rule).
// Honest-only: sections without an event source render NotConnected rather than inventing numbers.

const RANGES: { v: AnalyticsRange; label: string }[] = [
  { v: '7d', label: 'Last 7 Days' }, { v: '30d', label: 'Last 30 Days' }, { v: '90d', label: 'Last Quarter' },
  { v: '6m', label: 'Last 6 Months' }, { v: '12m', label: 'Last 12 Months' },
];
const fmtKpi = (k: Kpi) => k.format === 'money' ? money(k.valueCents ?? 0) : (k.value ?? 0).toLocaleString();

const COMPARES: { v: CompareMode; label: string }[] = [
  { v: 'previous_period', label: 'Previous period' }, { v: 'previous_month', label: 'Previous month' },
  { v: 'previous_quarter', label: 'Previous quarter' }, { v: 'previous_year', label: 'Previous year' }, { v: 'none', label: 'No comparison' },
];
const FORMATS: { v: ExportFormat; label: string }[] = [{ v: 'csv', label: 'CSV' }, { v: 'xlsx', label: 'Excel (XLSX)' }, { v: 'pdf', label: 'PDF' }];

function Delta({ k, cmpLabel }: { k: Kpi; cmpLabel: string }) {
  if (k.deltaPct == null) return <div className="d flat">— no prior data</div>;
  const favorable = k.lowerIsBetter ? k.deltaPct < 0 : k.deltaPct >= 0;
  return <div className={`d ${favorable ? 'up' : 'down'}`}>{k.deltaPct >= 0 ? '▲' : '▼'} {Math.abs(k.deltaPct)}% vs {cmpLabel}</div>;
}

const GapNote = ({ reason }: { reason: string }) => (
  <div className="state" style={{ padding: '18px 0', fontSize: 12 }}><NotConnected /> <div className="muted" style={{ marginTop: 4, fontSize: 11 }}>{reason}</div></div>
);

function PanelHead({ n, title, right }: { n: number; title: string; right?: React.ReactNode }) {
  return <div className="phead" style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
    <h2 style={{ fontSize: 13.5 }}>{n}. {title}</h2><div style={{ marginLeft: 'auto' }}>{right}</div></div>;
}

export function AnalyticsScreen() {
  const nav = useNavigate();
  const { tenantId, tenantName } = useScope();
  const [params, setParams] = useSearchParams();
  const urlRange = (params.get('range') as AnalyticsRange) || '30d';
  const urlCompare = (params.get('compareTo') as CompareMode) || 'previous_period';
  const { data, loading, error, range, setRange, compareTo, setCompareTo } = useAnalytics(urlRange, tenantId, urlCompare);
  const [cmpOpen, setCmpOpen] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [hidden, setHidden] = useState<Record<number, boolean>>({});

  const m = data?.modules;
  const show = (id: number) => !hidden[id];
  const toggle = (id: number) => setHidden((h) => ({ ...h, [id]: !h[id] }));
  const closeMenus = () => { setCmpOpen(false); setRangeOpen(false); setExportOpen(false); setWidgetOpen(false); };

  // URL-sync: range + comparison live in the query string (shareable, survives refresh).
  const syncUrl = (next: Record<string, string>) => { const p = new URLSearchParams(params); for (const [k, v] of Object.entries(next)) p.set(k, v); setParams(p, { replace: true }); };
  const pickRange = (r: AnalyticsRange) => { setRange(r); syncUrl({ range: r }); setRangeOpen(false); };
  const pickCompare = (c: CompareMode) => { setCompareTo(c); syncUrl({ compareTo: c }); setCmpOpen(false); };

  const runExport = async (format: ExportFormat) => {
    setExportOpen(false); setExporting(true);
    try { downloadExport(await analyticsApi.export(format, range, tenantId, compareTo)); }
    catch { /* surfaced via the disabled state; a toast system is out of scope for this unit */ }
    finally { setExporting(false); }
  };

  const moduleNames: [number, string][] = [[1, 'Revenue & Transactions'], [2, 'Appointments vs Walk-ins'], [3, 'Tenant Growth & Churn'], [4, 'Payment Methods'], [5, 'Top Tenants'], [6, 'Branch Performance'], [7, 'Service Category Mix'], [8, 'Customer Retention'], [9, 'Peak Hours'], [10, 'Device Status'], [11, 'AI Receptionist'], [12, 'Regional Performance'], [13, 'AI Insights'], [14, 'System Health']];

  if (error) return <div className="work"><div className="state">{error}</div></div>;
  if (loading || !data || !m) return <div className="work"><div className="state">Loading analytics…</div></div>;
  const cmpLabel = data.metadata.compare.label;

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div className="vh" style={{ flex: 1, minWidth: 280 }}>
          <h1>Analytics <span aria-hidden style={{ color: 'var(--g7)' }}>★</span></h1>
          <div className="sub">Cross-tenant business intelligence, performance insights, and platform analytics.{tenantId ? ` · Scoped to ${tenantName ?? 'salon'}` : ''}</div>
          <div style={{ position: 'relative', display: 'inline-block', marginTop: 6 }}>
            <button className="btn ghost sm" aria-haspopup="listbox" aria-expanded={rangeOpen} onClick={() => { closeMenus(); setRangeOpen((o) => !o); }}>🗓 {RANGES.find((r) => r.v === range)?.label} ▾</button>
            {rangeOpen && <div className="pop" role="listbox" style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 30, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 11, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 6, minWidth: 168, display: 'flex', flexDirection: 'column' }}>{RANGES.map((r) => (
              <button key={r.v} role="option" aria-selected={r.v === range} style={{ textAlign: 'left', background: 'none', border: 'none', padding: '8px 10px', borderRadius: 8, fontSize: 12, color: 'var(--text)', cursor: 'pointer' }} onClick={() => pickRange(r.v)}>{r.label}</button>
            ))}</div>}
          </div>
        </div>
        <div className="hactions" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <button className="btn ghost" aria-haspopup="menu" aria-expanded={exportOpen} disabled={exporting} onClick={() => { closeMenus(); setExportOpen((o) => !o); }}>⤓ {exporting ? 'Exporting…' : 'Export Report'}</button>
            {exportOpen && <div className="pop" role="menu" style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 30, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 11, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 6, minWidth: 168, display: 'flex', flexDirection: 'column' }}>{FORMATS.map((f) => (
              <button key={f.v} role="menuitem" style={{ textAlign: 'left', background: 'none', border: 'none', padding: '8px 10px', borderRadius: 8, fontSize: 12, color: 'var(--text)', cursor: 'pointer' }} onClick={() => runExport(f.v)}>{f.label}</button>
            ))}</div>}
          </div>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <button className="btn ghost" aria-haspopup="listbox" aria-expanded={cmpOpen} onClick={() => { closeMenus(); setCmpOpen((o) => !o); }}>🗓 Compare: {cmpLabel}</button>
            {cmpOpen && <div className="pop" role="listbox" style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 30, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 11, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 6, minWidth: 168, display: 'flex', flexDirection: 'column' }}>{COMPARES.map((c) => (
              <button key={c.v} role="option" aria-selected={c.v === compareTo} style={{ textAlign: 'left', background: 'none', border: 'none', padding: '8px 10px', borderRadius: 8, fontSize: 12, color: 'var(--text)', cursor: 'pointer' }} onClick={() => pickCompare(c.v)}>{c.label}</button>
            ))}</div>}
          </div>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <button className="btn" aria-haspopup="menu" aria-expanded={widgetOpen} onClick={() => { closeMenus(); setWidgetOpen((o) => !o); }}>+ Add Widget</button>
            {widgetOpen && <div className="pop" role="menu" style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 30, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 11, boxShadow: '0 8px 24px rgba(0,0,0,0.14)', padding: 8, minWidth: 230, maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div className="muted" style={{ fontSize: 10.5, padding: '4px 6px', color: 'var(--muted)', fontWeight: 600 }}>Show / hide widgets (this session)</div>
              {moduleNames.map(([id, label]) => (
                <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', fontSize: 12, cursor: 'pointer', borderRadius: 6 }}><input type="checkbox" checked={show(id)} onChange={() => toggle(id)} /> {id}. {label}</label>
              ))}
            </div>}
          </div>
        </div>
      </div>

      {/* 8 KPI cards */}
      <div className="kpis k8" style={{ margin: 0 }}>
        {data.kpis.map((k) => (
          <div className="kpi click" key={k.key} role="button" tabIndex={0} aria-label={`${k.label}: ${fmtKpi(k)}`}
            onClick={() => nav(k.to)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') nav(k.to); }}>
            <div className="l">{k.label}</div>
            <div className="v" style={{ fontSize: 19 }}>{fmtKpi(k)}</div>
            <Delta k={k} cmpLabel={cmpLabel} />
          </div>
        ))}
      </div>

      {/* Row: 1 · 2 · 3 */}
      <div className="grid3">
        {show(1) && <section className="panel">
          <PanelHead n={1} title="Revenue & Transactions Trend" right={<span className="muted" style={{ fontSize: 11 }}>{!isGap(m.revenueTransactionsTrend) ? 'Monthly' : ''}</span>} />
          {isGap(m.revenueTransactionsTrend) ? <GapNote reason={m.revenueTransactionsTrend.reason} /> : <>
            <AreaLine series={m.revenueTransactionsTrend.series.map((p) => ({ label: p.label.slice(5), valueCents: p.revenueCents }))} height={150} />
            {m.revenueTransactionsTrend.dailyAvailable && m.revenueTransactionsTrend.daily.length > 0 && <div style={{ marginTop: 8 }}>
              <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>Daily (last 7 days)</div>
              <AreaLine series={m.revenueTransactionsTrend.daily.map((p) => ({ label: p.label.slice(5), valueCents: p.revenueCents }))} height={70} />
            </div>}
            {(() => { const last = m.revenueTransactionsTrend.series[m.revenueTransactionsTrend.series.length - 1]; return <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Latest: {money(last?.revenueCents ?? 0)} · {(last?.transactions ?? 0).toLocaleString()} txns.{!m.revenueTransactionsTrend.dailyAvailable && <> Daily 7-day series <NotConnected>pending</NotConnected>.</>}</div>; })()}
          </>}
        </section>}
        {show(2) && <section className="panel">
          <PanelHead n={2} title="Appointments vs Walk-ins vs Check-ins" />
          {isGap(m.appointmentActivity) ? <GapNote reason={m.appointmentActivity.reason} /> : <>
            <MiniBars data={m.appointmentActivity.statusMix.map((s) => ({ label: s.status, value: s.count }))} emptyHint="No appointments yet." />
            {m.appointmentActivity.sourceMix.length > 0 && <div className="legend" style={{ marginTop: 6 }}>
              {m.appointmentActivity.sourceMix.map((s) => <div key={s.source} className="li"><span>{s.source.replace(/_/g, ' ')}</span><span className="va">{s.count.toLocaleString()}</span></div>)}
            </div>}
            <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Total {m.appointmentActivity.total.toLocaleString()}.{m.appointmentActivity.sourceMix.length === 0 && <> Source split <NotConnected>pending</NotConnected>.</>} Daily time-series <NotConnected>pending</NotConnected>.</div>
          </>}
        </section>}
        {show(3) && <section className="panel">
          <PanelHead n={3} title="Tenant Growth & Churn" />
          {isGap(m.tenantGrowth) ? <GapNote reason={m.tenantGrowth.reason} /> : <>
            <MiniBars data={m.tenantGrowth.newByMonth.map((g) => ({ label: g.month.slice(2), value: g.count }))} emptyHint="No tenant history." />
            <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Total tenants {m.tenantGrowth.totalTenants.toLocaleString()} · New per month (green). {m.tenantGrowth.churn.available ? <>Churn (last {m.tenantGrowth.churn.windowDays}d): <strong>{m.tenantGrowth.churn.churnRatePct}%</strong> · {m.tenantGrowth.churn.suspendedWindow.toLocaleString()} suspended.</> : <>Churn <NotConnected>{m.tenantGrowth.churn.reason}</NotConnected></>}</div>
          </>}
        </section>}
      </div>

      {/* Row: 4 · 5 · 6 · 7 */}
      <div className="grid4 ">
        {show(4) && <section className="panel ">
          <PanelHead n={4} title="Payment Methods" />
          {isGap(m.paymentMethods) ? <GapNote reason={m.paymentMethods.reason} /> : (() => {
            const tot = m.paymentMethods.totalCents || m.paymentMethods.byMethod.reduce((a, s) => a + s.cents, 0);
            return <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <Donut hideLegend data={m.paymentMethods.byMethod.map((s) => ({ label: s.method, value: s.cents }))} centerLabel={moneyK(tot)} />
              <div className="legend" style={{ flex: 1 }}>{m.paymentMethods.byMethod.map((s, i) => (
                <div className="li" key={s.method}><span className="sw" style={{ background: PALETTE[i % PALETTE.length] }} /><span style={{ textTransform: 'capitalize' }}>{s.method}</span><span className="va">{tot ? ((s.cents / tot) * 100).toFixed(1) : '0'}%</span></div>
              ))}</div>
            </div>;
          })()}
        </section>}
        {show(5) && <section className="panel mt-3">
          <PanelHead n={5} title="Top Performing Tenants" />
          {isGap(m.topTenants) ? <GapNote reason={m.topTenants.reason} /> : <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}><tbody>
            {m.topTenants.rows.slice(0, 5).map((t, i) => {
              const name = t.tenantName ?? t.name ?? t.salonName ?? t.tenantId ?? '—';
              const cents = t.amountCents ?? t.revenueCents ?? t.monthlyCardVolume ?? 0;
              return <tr key={t.tenantId ?? name} style={{ cursor: t.tenantId ? 'pointer' : 'default' }} onClick={() => t.tenantId && nav(`/tenants/${t.tenantId}`)}>
                <td className="muted" style={{ width: 20 }}>{i + 1}</td><td style={{ fontWeight: 600 }}>{name}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{money(cents)}</td>
              </tr>;
            })}
          </tbody></table>}
          <button className="linkbtn" style={{ marginTop: 8 }} onClick={() => nav('/tenants')}>View All Tenants</button>
        </section>}
        {show(6) && <section className="panel mt-3">
          <PanelHead n={6} title="Branch Performance" right={<span className="muted" style={{ fontSize: 11 }}>Revenue</span>} />
          {isGap(m.branchComparison) ? <GapNote reason={m.branchComparison.reason} /> :
            <MiniBars data={m.branchComparison.rows.slice(0, 8).map((b) => ({ label: b.branch, value: b.volumeCents, tip: money(b.volumeCents) }))} emptyHint="No branch revenue yet." />}
        </section>}
        {show(7) && <section className="panel mt-3">
          <PanelHead n={7} title="Service Category Mix" right={<span className="muted" style={{ fontSize: 11 }}>{!isGap(m.serviceCategoryMix) ? 'Revenue' : ''}</span>} />
          {isGap(m.serviceCategoryMix) ? <GapNote reason={m.serviceCategoryMix.reason} /> : <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <Donut hideLegend data={m.serviceCategoryMix.byCategory.map((c) => ({ label: c.category, value: c.revenueCents }))} centerLabel={moneyK(m.serviceCategoryMix.totalCents)} />
              <div className="legend" style={{ flex: 1 }}>
                {m.serviceCategoryMix.byCategory.slice(0, 6).map((c) => (
                  <div key={c.category} className="li"><span>{c.category}</span><span className="va">{money(c.revenueCents)}</span></div>
                ))}
              </div>
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Billed service-line revenue by category.</div>
          </>}
        </section>}
      </div>

      {/* Row: 8 · 9 · 10 · 11 */}
      <div className="grid4">
        {show(8) && <section className="panel">
          <PanelHead n={8} title="Customer Retention" />
          {isGap(m.customerRetention) ? <GapNote reason={m.customerRetention.reason} /> : <>
            <div className="legend">
              <div className="li"><span>Total customers</span><span className="va">{m.customerRetention.totalCustomers.toLocaleString()}</span></div>
              <div className="li"><span>Active</span><span className="va">{m.customerRetention.activeCustomers.toLocaleString()}</span></div>
              <div className="li"><span>New this month</span><span className="va">{m.customerRetention.newThisMonth.toLocaleString()}</span></div>
            </div>
            {m.customerRetention.newVsReturning.available ? <div style={{ marginTop: 8 }}>
              <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>New vs returning (last {m.customerRetention.newVsReturning.windowDays}d)</div>
              <div className="legend">
                <div className="li"><span>New</span><span className="va">{m.customerRetention.newVsReturning.newCount.toLocaleString()}</span></div>
                <div className="li"><span>Returning</span><span className="va">{m.customerRetention.newVsReturning.returningCount.toLocaleString()}</span></div>
              </div>
            </div> : <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Daily new-vs-returning split <NotConnected>{m.customerRetention.newVsReturning.reason}</NotConnected></div>}
          </>}
        </section>}
        {show(9) && <section className="panel mt-3">
          <PanelHead n={9} title="Peak Hours (Demand)" />
          {isGap(m.peakHours) ? <GapNote reason={m.peakHours.reason} /> : (() => {
            const max = Math.max(1, ...m.peakHours.byHour.map((h) => h.count));
            return <>
              <div className="heatrow">{m.peakHours.byHour.map((h) => {
                const t = h.count / max; return <div key={h.hour} className="cell" title={`${h.hour}:00 — ${h.count}`} style={{ height: `${Math.max(6, t * 70)}%`, background: `rgba(169,111,34,${0.12 + t * 0.78})` }} />;
              })}</div>
              {m.peakHours.matrixAvailable && m.peakHours.matrix.length > 0 ? (() => {
                const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                const lut = new Map<string, number>(); let mx = 1;
                for (const c of m.peakHours.matrix) { lut.set(`${c.dow}:${c.hour}`, c.count); if (c.count > mx) mx = c.count; }
                return <div style={{ marginTop: 10 }}>
                  <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Day × hour demand (approved txns)</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {DOW.map((d, dow) => <div key={dow} style={{ display: 'grid', gridTemplateColumns: '28px repeat(24, 1fr)', gap: 1, alignItems: 'center' }}>
                      <div className="muted" style={{ fontSize: 9 }}>{d}</div>
                      {Array.from({ length: 24 }, (_, h) => { const v = lut.get(`${dow}:${h}`) || 0; const t = v / mx; return <div key={h} title={`${d} ${h}:00 — ${v}`} style={{ height: 12, borderRadius: 1, background: v ? `rgba(169,111,34,${0.15 + t * 0.75})` : 'var(--line)' }} />; })}
                    </div>)}
                  </div>
                </div>;
              })() : <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Payments by hour-of-day. Day×hour matrix <NotConnected>pending</NotConnected>.</div>}
            </>;
          })()}
        </section>}
        {show(10) && <section className="panel mt-3">
          <PanelHead n={10} title="Device Status" />
          {isGap(m.deviceStatus) ? <GapNote reason={m.deviceStatus.reason} /> : <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Donut hideLegend data={[{ label: 'Online', value: m.deviceStatus.online }, { label: 'Offline', value: m.deviceStatus.offline }]} centerLabel={m.deviceStatus.total.toLocaleString()} />
            <div className="legend" style={{ flex: 1 }}>
              <div className="li"><span className="sw" style={{ background: PALETTE[2] }} /><span>Online</span><span className="va">{m.deviceStatus.online.toLocaleString()}</span></div>
              <div className="li"><span className="sw" style={{ background: PALETTE[5] }} /><span>Offline</span><span className="va">{m.deviceStatus.offline.toLocaleString()}</span></div>
            </div>
          </div>}
        </section>}
        {show(11) && <section className="panel mt-3">
          <PanelHead n={11} title="AI Receptionist & Booking" />
          {!isGap(m.aiReceptionist.bookings) && <div className="legend">
            <div className="li"><span>AI bookings</span><span className="va">{m.aiReceptionist.bookings.aiBookings.toLocaleString()}</span></div>
            <div className="li"><span>Automation rate</span><span className="va">{m.aiReceptionist.bookings.automationRatePct}%</span></div>
          </div>}
          {!isGap(m.aiReceptionist.reminders) && <div className="legend" style={{ marginTop: 6 }}>
            <div className="li"><span>Reminders sent</span><span className="va">{m.aiReceptionist.reminders.sent.toLocaleString()}</span></div>
            <div className="li"><span>Delivered</span><span className="va">{m.aiReceptionist.reminders.delivered.toLocaleString()}</span></div>
            <div className="li"><span>Delivery rate</span><span className="va">{m.aiReceptionist.reminders.deliveryRatePct}%</span></div>
            <div className="li"><span>Failed</span><span className="va">{m.aiReceptionist.reminders.failed.toLocaleString()}</span></div>
          </div>}
          <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>AI bookings &amp; reminder delivery are live. AI call volume (voice) <NotConnected>{m.aiReceptionist.reason}</NotConnected></div>
        </section>}
      </div>

      {/* Row: 12 · 13 · 14 */}
      <div className="grid3">
        {show(12) && <section className="panel">
          <PanelHead n={12} title="Regional Performance (US State)" />
          {isGap(m.regionalPerformance) ? <GapNote reason={m.regionalPerformance.reason} /> : <>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}><tbody>
              {m.regionalPerformance.byState.slice(0, 6).map((s) => (
                <tr key={s.state}><td style={{ fontWeight: 600 }}>{s.state}</td><td style={{ textAlign: 'right' }}>{s.tenants.toLocaleString()} tenants</td></tr>
              ))}
            </tbody></table>
            {m.regionalPerformance.revenueByRegion.available ? <div style={{ marginTop: 8 }}>
              <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>Revenue by state</div>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}><tbody>
                {m.regionalPerformance.revenueByRegion.byState.slice(0, 6).map((s) => (
                  <tr key={s.state}><td style={{ fontWeight: 600 }}>{s.state}</td><td style={{ textAlign: 'right' }}>{money(s.revenueCents)}</td></tr>
                ))}
              </tbody></table>
            </div> : <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Revenue-by-region <NotConnected>{m.regionalPerformance.revenueByRegion.reason}</NotConnected></div>}
          </>}
        </section>}
        {show(13) && <section className="panel">
          <PanelHead n={13} title="AI Insights & Recommendations" />
          {m.recommendations.items.length === 0 ? <div className="state" style={{ fontSize: 12 }}>No flagged signals right now.</div> :
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{m.recommendations.items.map((r, i) => (
              <div key={i} className="row" style={{ alignItems: 'flex-start', cursor: 'pointer' }} onClick={() => nav(r.to)}>
                <span className={`pill ${r.severity === 'critical' ? 'warn' : r.severity === 'warning' ? 'warn' : 'ok'}`} style={{ flex: 'none' }}>{r.severity}</span>
                <div><div style={{ fontSize: 12 }}>{r.message}</div><div className="s">{r.action} · <span className="muted">rule-based</span></div></div>
              </div>
            ))}</div>}
        </section>}
        {show(14) && <section className="panel">
          <PanelHead n={14} title="System Health" />
          {isGap(m.systemHealth.metrics)
            ? <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>Uptime · API success · response time <NotConnected>{m.systemHealth.metrics.reason}</NotConnected></div>
            : <div style={{ marginBottom: 8 }}>
                <div className="legend">
                  <div className="li"><span>API success ({m.systemHealth.metrics.windowMinutes}m)</span><span className="va">{m.systemHealth.metrics.apiSuccessPct}%</span></div>
                  <div className="li"><span>Latency p50 · p95</span><span className="va">{m.systemHealth.metrics.p50LatencyMs} · {m.systemHealth.metrics.p95LatencyMs} ms</span></div>
                  <div className="li"><span>Server errors / requests</span><span className="va">{m.systemHealth.metrics.serverErrors.toLocaleString()} / {m.systemHealth.metrics.sampleCount.toLocaleString()}</span></div>
                </div>
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Uptime <NotConnected>needs heartbeat monitoring</NotConnected></div>
              </div>}
          <div className="legend">
            <div className="li"><span className="sw" style={{ background: 'var(--danger)' }} /><span>Critical</span><span className="va">{m.systemHealth.alerts.critical}</span></div>
            <div className="li"><span className="sw" style={{ background: 'var(--warn)' }} /><span>Warning</span><span className="va">{m.systemHealth.alerts.warning}</span></div>
            <div className="li"><span className="sw" style={{ background: 'var(--info)' }} /><span>Info</span><span className="va">{m.systemHealth.alerts.info}</span></div>
          </div>
          <button className="linkbtn" style={{ marginTop: 8 }} onClick={() => nav('/alerts')}>View All Alerts</button>
        </section>}
      </div>

      {/* Quick Actions */}
      <section className="panel">
        <h2 style={{ fontSize: 13.5, marginBottom: 8 }}>Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-3">
          {[
            { l: 'Open Dashboard', fn: () => nav('/dashboard') },
            { l: 'Revenue Report', fn: () => nav('/platform-reports') },
            { l: 'Tenant Ranking', fn: () => nav('/platform-reports?report=tenant-performance') },
            { l: 'Device Analytics', fn: () => nav('/devices-management') },
            { l: 'Membership Report', fn: () => nav('/memberships') },
            { l: 'AI Insights Report', fn: () => nav('/ai-reports') },
            { l: 'Export Data', fn: () => runExport('csv') },
            { l: '+ Add Branch', fn: () => nav('/branches?action=new') },
          ].map((q) => <button key={q.l} className="qbtn" onClick={q.fn}>{q.l}</button>)}
        </div>
      </section>
    </div>
  );
}
