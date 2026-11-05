// SuperAdminCampaignsScreen.tsx — Super Admin › Business Management › Marketing & Campaigns.
// Platform-level campaign tools + tenant campaign OVERSIGHT. Driven by the marketing-overview endpoint. Platform
// announcements and tenant customer campaigns are kept clearly separated (owner grouping). Honest rendering:
// delivery rate, opt-out rate, compliance, delivery failures, and compliance alerts have no backing schema yet and
// render NotConnected. Cream/gold.
import { useCallback, useEffect, useMemo, useState, Fragment } from 'react';
import { useInlineAsk } from '@aipowersalon/ui';
import { superAdminApi, type MarketingOverview, type McRow } from '../api/superAdminApi';
import { Donut, MiniBars, NotConnected, money } from './_chartkit';
import { CreateAnnouncementModal } from './SuperAdminCampaignsCreate';
import { CampaignLimitsModal } from './SuperAdminCampaignsLimits';
import { CreateTemplateModal } from './SuperAdminCampaignsTemplate';
import { buildCampaignCsv, downloadCsv } from './SuperAdminCampaignsExport';

const cap = (s: string) => (s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const KICON: Record<string, string> = { active: '▶', scheduled: '📅', completed: '✓', sms: '💬', email: '✉', push: '🔔', audience: '👥', delivery_rate: '📈', open_rate: '👁', click_rate: '➚', bookings: '📆', revenue: '$', opt_out_rate: '⊘' };
const CHANNEL_ICON: Record<string, string> = { email: '✉', sms: '💬', push: '🔔', in_app: '📱' };
const statusTone = (s: string) => (s === 'completed' || s === 'active' || s === 'in_progress' ? 'ok' : s === 'cancelled' || s === 'failed' || s === 'rejected' ? 'bad' : 'warn');

const ACTIONS = [
  'Create Platform Announcements', 'Create Reusable Templates', 'Send Campaigns to Selected Tenants', 'Review Tenant Campaign Activity',
  'Monitor Messaging Compliance', 'Pause Abusive or Noncompliant Campaigns', 'Review Delivery Failures', 'Configure Campaign Limits',
];

export function SuperAdminCampaignsScreen() {
  const [data, setData] = useState<MarketingOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { ask, askUi } = useInlineAsk();
  const [bannerOpen, setBannerOpen] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showLimits, setShowLimits] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [selected, setSelected] = useState<McRow | null>(null);
  const [page, setPage] = useState(1);
  const [channel, setChannel] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [tenant, setTenant] = useState('');

  const load = useCallback(() => {
    setErr(null);
    superAdminApi.marketingOverview({ channel: channel || undefined, status: status || undefined, page, pageSize: 10 })
      .then((d) => { setData(d); setSelected((s) => s || d.directory.page[0] || null); })
      .catch((e: any) => setErr(e?.message || 'Failed to load Marketing & Campaigns.'));
  }, [channel, status, page]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    let r = data?.directory.page ?? [];
    if (search) { const q = search.toLowerCase(); r = r.filter((x) => x.name.toLowerCase().includes(q) || x.reference.toLowerCase().includes(q)); }
    if (tenant) r = r.filter((x) => x.tenant === tenant);
    return r;
  }, [data, search, tenant]);

  const tenantOpts = useMemo(() => [...new Set((data?.directory.tenant ?? []).map((r) => r.tenant))], [data]);
  const tenantPickOpts = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of data?.directory.tenant ?? []) if (r.tenantId) m.set(r.tenantId, r.tenant);
    return [...m.entries()].map(([id, name]) => ({ id, name }));
  }, [data]);

  const pauseSelected = async () => {
    if (!selected) { setNote('Select a campaign first to pause it.'); return; }
    ask(`Pause “${selected.name}”?\nThis records an audited compliance action (it does not delete the campaign).\nEnter a reason:`, (reason) => { void doPause(reason); });
  };
  const doPause = async (reason: string) => {
    if (!selected) return;
    try {
      const res = await superAdminApi.pauseCampaign({ subjectType: selected.ownerType === 'platform' ? 'platform_announcement' : 'tenant_campaign', subjectId: selected.id, subjectName: selected.name, tenantId: selected.tenantId, currentStatus: selected.status, reason: reason.trim() });
      if (!res.ok) { setNote((res.errors || ['Could not pause the campaign.']).join(' ')); return; }
      setNote(`“${selected.name}” paused — recorded as an audited compliance action. Compliance alerts updated.`); load();
    } catch (e: any) { setNote(e?.message || 'Request failed.'); }
  };

  const onAction = (a: string) => {
    if (a === 'Create Platform Announcements' || a === 'Send Campaigns to Selected Tenants') return setShowCreate(true);
    if (a === 'Configure Campaign Limits') return setShowLimits(true);
    if (a === 'Create Reusable Templates') return setShowTemplate(true);
    if (a === 'Pause Abusive or Noncompliant Campaigns') return void pauseSelected();
    if (a === 'Review Delivery Failures') return setNote(data?.deliveryFailures.available ? `Delivery Failures: ${(data.deliveryFailures.total ?? 0).toLocaleString()} recorded across ${(data.deliveryFailures.byCategory ?? []).length} categories. The queue exposes only masked destinations and provider status; permanent failures are never auto-retried.` : 'Delivery failures are not connected yet.');
    setNote(`${a}: this platform workflow is being built. Platform announcements target tenant users (never tenant customers); tenant campaigns remain oversight-only.`);
  };
  const reset = () => { setChannel(''); setStatus(''); setSearch(''); setTenant(''); setPage(1); };

  if (err) return <div className="screen"><div className="state">{err} <button className="linkbtn" onClick={load}>Retry</button></div></div>;
  if (!data) return <div className="screen"><div className="state">Loading Marketing & Campaigns…</div></div>;

  // Insert the tenant divider before the first tenant-owned row in the page.
  const firstTenantIdx = rows.findIndex((r) => r.ownerType === 'tenant');
  const selS: React.CSSProperties = { height: 34, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12.5 };
  const disS: React.CSSProperties = { ...selS, opacity: 0.55 };

  return (
    <div className="screen p-5">
      {/* HEADER */}
      <div className="flex flex-col lg:flex-row gap-3 " >
        <div style={{ flex: 1 }}>
          <div className="vh"><h1>Marketing &amp; Campaigns <span style={{ color: '#F0820B' }}>★</span></h1><div className="sub">Provides platform-level campaign tools and tenant campaign oversight.</div>
        </div>
        </div>
        <div className='self-baseline' style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost" onClick={() => {
            const all = [...(data.directory.platform ?? []), ...(data.directory.tenant ?? [])];
            const csv = buildCampaignCsv(all, { filters: { channel, status, tenant, search }, generatedAt: new Date().toISOString() });
            downloadCsv(`campaign-report-${new Date().toISOString().slice(0, 10)}.csv`, csv);
            setNote(`Exported ${all.length} campaigns (current filters, no customer-level data, formula-injection safe).`);
          }}>⬇ Export Campaign Reports</button>
          <button className="btn" onClick={() => setShowCreate(true)}>+ Create Campaign</button>
        </div>
      </div>

      {/* 13 KPI CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 mt-3">
        {data.kpis.slice(0, 7).map((k) => <Kpi key={k.key} k={k} />)}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 mt-2">
        {data.kpis.slice(7).map((k) => <Kpi key={k.key} k={k} />)}
      </div>

      {/* FILTER BAR */}
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <input className="inp" style={{ ...selS, gridColumn: 'span 1' }} placeholder="Search by name or ID…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search campaigns" />
        <select className="inp" style={disS} disabled aria-label="Campaign Type" title="Campaign type not modelled yet"><option>All Types (—)</option></select>
        <select className="inp" style={selS} value={tenant} onChange={(e) => setTenant(e.target.value)} aria-label="Tenant"><option value="">All Tenants</option>{tenantOpts.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        <select className="inp" style={disS} disabled aria-label="Branch" title="Branch filter follows tenant"><option>All Branches (—)</option></select>
        <select className="inp" style={selS} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status"><option value="">All Statuses</option>{['scheduled', 'in_progress', 'completed', 'cancelled', 'draft'].map((s) => <option key={s} value={s}>{cap(s)}</option>)}</select>
        <select className="inp" style={disS} disabled aria-label="Audience Segment" title="Segment filter not modelled yet"><option>All Segments (—)</option></select>
        <select className="inp" style={selS} value={channel} onChange={(e) => { setChannel(e.target.value); setPage(1); }} aria-label="Channel"><option value="">All Channels</option>{['email', 'sms', 'push', 'in_app'].map((c) => <option key={c} value={c}>{cap(c)}</option>)}</select>
        <select className="inp" style={disS} disabled aria-label="Date Range" title="Date range not applied to overview"><option>Date range (—)</option></select>
        <select className="inp" style={disS} disabled aria-label="Compliance Status" title="Compliance not modelled yet"><option>All Compliance (—)</option></select>
        <button className="btn ghost" onClick={reset}>Reset Filters</button>
        <button className="btn" onClick={load}>Apply Filters</button>
      </div>

      {note ? <div className="state" style={{ marginTop: 10 }}>{note} <button className="linkbtn" onClick={() => setNote(null)}>Dismiss</button></div> : null}

      {/* BLUE BOUNDARY BANNER */}
      {bannerOpen ? (
        <div role="note" style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, padding: '10px 12px', border: '1px solid #B6D4EC', background: '#EFF6FC', borderRadius: 10, fontSize: 12.5 }}>
          <span aria-hidden="true">ℹ️</span>
          <span style={{ flex: 1 }}>Platform campaigns and tenant customer campaigns remain clearly separated. Platform announcements are sent only to selected tenants.</span>
          <button className="linkbtn" onClick={() => setBannerOpen(false)} aria-label="Dismiss notice">✕</button>
        </div>
      ) : null}

      {/* MAIN GRID: table (left) + details/actions (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-3 mt-3 items-start">
        <section className="panel">
          <div className="phead"><h2>Campaigns <span className="muted">(Platform &amp; Tenant)</span></h2><span className="nbadge">{data.directoryTotal} Campaigns</span></div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tgrid" style={{ width: '100%', fontSize: 12, minWidth: 1000 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}>
                <th></th><th>Campaign ID</th><th>Name</th><th>Owner</th><th>Tenant</th><th>Branch</th><th>Ch</th><th>Audience</th><th>Delivery</th><th>Open</th><th>Click</th><th>Bookings</th><th>Revenue</th><th>Scheduled</th><th>Status</th><th></th>
              </tr></thead>
              <tbody>
                {rows.length === 0 ? <tr><td colSpan={16}><div className="state">No campaigns match these filters.</div></td></tr> :
                  rows.map((r, i) => (
                    <Fragment key={r.id}>
                      {i === firstTenantIdx && firstTenantIdx > -1 ? (
                        <tr><td colSpan={16} style={{ background: '#FBF6EE', fontSize: 11, fontWeight: 700, color: 'var(--g7,#A96F22)', padding: '6px 8px' }}>👥 Tenant Customer Campaigns (Visible for Oversight Only)</td></tr>
                      ) : null}
                      <tr onClick={() => setSelected(r)} style={{ cursor: 'pointer', background: selected?.id === r.id ? '#FDF0DF' : undefined }}>
                        <td><span aria-hidden="true" style={{ color: selected?.id === r.id ? 'var(--g7,#A96F22)' : 'var(--line)' }}>{selected?.id === r.id ? '◉' : '○'}</span></td>
                        <td className="muted">{r.reference}</td>
                        <td style={{ fontWeight: 600 }}>{r.name}</td>
                        <td><span className={'pill ' + (r.ownerType === 'platform' ? 'warn' : 'mut')}>{cap(r.ownerType)}</span></td>
                        <td className="muted">{r.tenant}</td><td className="muted">{r.branch}</td>
                        <td title={r.channel}>{CHANNEL_ICON[r.channel] || cap(r.channel)}</td>
                        <td>{r.audienceSize.toLocaleString()}</td>
                        <td>{r.deliveryRateAvailable ? `${r.deliveryRate}%` : <NotConnected />}</td>
                        <td>{r.openRate}%</td><td>{r.clickRate}%</td><td>{r.bookingConversions.toLocaleString()}</td>
                        <td>{money(r.revenueCents)}</td>
                        <td className="muted">{r.scheduledAt ? new Date(r.scheduledAt).toLocaleDateString() : '—'}</td>
                        <td><span className={'pill ' + statusTone(r.status)}>{cap(r.status)}</span></td>
                        <td><button className="linkbtn" onClick={(e) => { e.stopPropagation(); setSelected(r); }} aria-label={`Select ${r.name}`}>⋮</button></td>
                      </tr>
                    </Fragment>
                  ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 10, fontSize: 12 }}>
            <span className="muted">Showing {rows.length ? (data.pagination.page - 1) * data.pagination.pageSize + 1 : 0} to {(data.pagination.page - 1) * data.pagination.pageSize + rows.length} of {data.directoryTotal.toLocaleString()} campaigns</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              <button className="btn ghost" disabled={data.pagination.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</button>
              <span>Page {data.pagination.page} / {data.pagination.totalPages}</span>
              <button className="btn ghost" disabled={data.pagination.page >= data.pagination.totalPages} onClick={() => setPage((p) => p + 1)}>›</button>
            </div>
          </div>
        </section>

        {/* RIGHT: Selected Campaign Details + Super Admin Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <section className="panel">
            <div className="phead"><h2>Selected Campaign Details</h2>{selected ? <span className={'pill ' + (selected.ownerType === 'platform' ? 'warn' : 'mut')}>{selected.ownerType === 'platform' ? 'Platform Campaign' : 'Tenant Campaign'}</span> : null}</div>
            {!selected ? <div className="state">Select a campaign to view details.</div> : (
              <>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{selected.name}</div>
                {([
                  ['Campaign ID', selected.reference], ['Tenant', selected.tenant], ['Branch', selected.branch],
                  ['Channel', cap(selected.channel)], ['Scheduled Time', selected.scheduledAt ? new Date(selected.scheduledAt).toLocaleString() : '—'],
                  ['Delivery Rate', selected.deliveryRateAvailable ? `${selected.deliveryRate}%` : 'NotConnected'],
                  ['Open Rate', `${selected.openRate}%`], ['Click Rate', `${selected.clickRate}%`],
                  ['Bookings Converted', selected.bookingConversions.toLocaleString()], ['Revenue Attributed', money(selected.revenueCents)],
                  ['Opt-out Rate', 'NotConnected'], ['Compliance Review', selected.complianceAvailable ? selected.complianceStatus : 'NotConnected'],
                ] as [string, string][]).map(([label, val]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', borderBottom: '1px solid #F3ECE1' }}>
                    <span className="muted">{label}</span><span style={{ fontWeight: 600 }}>{val}</span>
                  </div>
                ))}
                <div className="panel" style={{ marginTop: 10, borderLeft: '4px solid var(--g7,#A96F22)', background: 'linear-gradient(90deg,#FBF3E6,#FFFDF8)', fontSize: 11.5 }}>
                  Platform campaigns are announcements sent to selected tenants. Tenant customer campaigns are managed by tenants and are for oversight only.
                </div>
              </>
            )}
          </section>

          <section className="panel">
            <div className="phead"><h2>Super Admin Actions</h2></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {ACTIONS.map((a) => <button key={a} className="qbtn" style={{ fontSize: 11.5 }} onClick={() => onAction(a)}>{a}</button>)}
            </div>
          </section>
        </div>
      </div>

      {/* ANALYTICS */}
      <div className="grid3" style={{ marginTop: 12 }}>
        <section className="panel">
          <div className="phead"><h2>Campaign Performance Trend</h2><span className="muted">This Week</span></div>
          {!data.performanceTrend.available || data.performanceTrend.points.length === 0 ? (
            <div className="state">Per-day delivery/open/click trend <NotConnected />.</div>
          ) : (
            <TrendChart points={data.performanceTrend.points} />
          )}
        </section>
        <section className="panel">
          <div className="phead"><h2>Channel Mix</h2></div>
          {data.channelMix.length ? <Donut data={data.channelMix.map((c) => ({ label: cap(c.channel), value: c.count }))} centerLabel={`${data.counts.total}\nCampaigns`} /> : <div className="state">No campaigns.</div>}
        </section>
        <section className="panel">
          <div className="phead"><h2>Revenue by Campaign</h2></div>
          <MiniBars data={data.revenueByCampaign.map((c) => ({ label: c.name.slice(0, 10), value: Math.round(c.revenueCents / 100), tip: `${c.name}: ${money(c.revenueCents)}` }))} emptyHint="No revenue yet." />
        </section>
        <section className="panel">
          <div className="phead"><h2>Recent Campaign Activity</h2></div>
          {(data.directory.page.length === 0) ? <div className="state">No recent activity.</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {data.directory.page.slice(0, 5).map((c) => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <span className={'pill ' + statusTone(c.status)}>{cap(c.status)}</span>
                  <span style={{ flex: 1 }}>{c.name}{c.ownerType === 'tenant' ? ` · ${c.tenant}` : ''}</span>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="panel">
          <div className="phead"><h2>Delivery Failures</h2>{data.deliveryFailures.available ? <span className="nbadge">{(data.deliveryFailures.total ?? 0).toLocaleString()}</span> : null}</div>
          {!data.deliveryFailures.available ? (
            <div className="state">Failure categories <NotConnected />.</div>
          ) : (data.deliveryFailures.total ?? 0) === 0 ? (
            <div className="state" style={{ borderLeft: '4px solid var(--ok,#4E8D6E)' }}>No delivery failures recorded.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(data.deliveryFailures.byCategory ?? []).map((c) => (
                <div key={c.category} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <span style={{ flex: 1 }}>{c.label}</span><span style={{ fontWeight: 700 }}>{c.count.toLocaleString()}</span><span className="muted" style={{ width: 48, textAlign: 'right' }}>{c.pct}%</span>
                </div>
              ))}
              <button className="linkbtn" style={{ marginTop: 4, textAlign: 'left' }} onClick={() => setNote('Review Delivery Failures: the failure queue exposes only safe masked destinations and provider status — never raw contact info or credentials. Permanent failures (invalid, opted-out, spam) are never auto-retried.')}>View Failures ›</button>
            </div>
          )}
        </section>
        <section className="panel">
          <div className="phead"><h2>Top Performing Campaigns</h2><span className="muted">by revenue</span></div>
          <table className="tgrid" style={{ width: '100%', fontSize: 11.5 }}><thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5 }}><th>Campaign</th><th>Open</th><th>Click</th><th>Bookings</th><th>Revenue</th></tr></thead>
            <tbody>{data.topCampaigns.map((c) => <tr key={c.id}><td style={{ fontWeight: 600 }}>{c.name}</td><td>{c.openRate}%</td><td>{c.clickRate}%</td><td>{c.bookings}</td><td>{money(c.revenueCents)}</td></tr>)}</tbody></table>
        </section>
      </div>
      <div className='pb-10' style={{ marginTop: 12 }}>
        <section className="panel">
          <div className="phead"><h2>Compliance Alerts</h2>{data.complianceAlerts.available && !data.complianceAlerts.allCompliant ? <span className="nbadge">{data.complianceAlerts.totalFlagged} flagged</span> : null}</div>
          {!data.complianceAlerts.available ? (
            <div className="state">Compliance alerts <NotConnected />.</div>
          ) : data.complianceAlerts.allCompliant ? (
            <div className="state" style={{ borderLeft: '4px solid var(--ok,#4E8D6E)' }}>All campaigns are compliant — no open flags.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(data.complianceAlerts.categories ?? []).map((c) => (
                <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '4px 8px', border: '1px solid #F0D9C4', background: '#FDF5EC', borderRadius: 8 }}>
                  <span aria-hidden="true">⚠️</span><span style={{ fontWeight: 700 }}>{c.count}</span><span>{c.count === 1 ? 'campaign' : 'campaigns'} {c.label}</span>
                </div>
              ))}
              <div className="muted" style={{ fontSize: 11.5 }}>Use “Pause Abusive or Noncompliant Campaigns” to action a selected campaign.</div>
            </div>
          )}
        </section>
      </div>

      {showCreate ? <CreateAnnouncementModal tenantOptions={tenantPickOpts} onClose={() => setShowCreate(false)} onCreated={(msg) => { setShowCreate(false); setNote(msg); setPage(1); load(); }} /> : null}
      {showLimits ? <CampaignLimitsModal onClose={() => setShowLimits(false)} onSaved={(msg) => { setShowLimits(false); setNote(msg); }} /> : null}
      {showTemplate ? <CreateTemplateModal onClose={() => setShowTemplate(false)} onCreated={(msg) => { setShowTemplate(false); setNote(msg); }} /> : null}
      {askUi}
    </div>
  );
}

function TrendChart({ points }: { points: { date: string; deliveryRate: number | null; openRate: number | null; clickRate: number | null }[] }) {
  const W = 320, H = 140, pad = 24;
  const stepX = points.length > 1 ? (W - pad * 2) / (points.length - 1) : 0;
  const y = (v: number) => H - pad - (Math.max(0, Math.min(100, v)) / 100) * (H - pad * 2);
  const line = (key: 'deliveryRate' | 'openRate' | 'clickRate') => points.map((p, i) => {
    const v = p[key]; if (v == null) return null;
    return `${i ? 'L' : 'M'}${(pad + i * stepX).toFixed(1)} ${y(v).toFixed(1)}`;
  }).filter(Boolean).join(' ');
  const series: { key: 'deliveryRate' | 'openRate' | 'clickRate'; label: string; color: string }[] = [
    { key: 'deliveryRate', label: 'Delivery', color: '#3B82C4' }, { key: 'openRate', label: 'Open', color: '#7A5AA6' }, { key: 'clickRate', label: 'Click', color: '#4E8D6E' },
  ];
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, fontSize: 11, marginBottom: 4 }}>
        {series.map((s) => <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 3, background: s.color, display: 'inline-block' }} />{s.label}</span>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Campaign performance trend: delivery, open and click rates over the week">
        {[0, 25, 50, 75, 100].map((g) => <line key={g} x1={pad} x2={W - pad} y1={y(g)} y2={y(g)} stroke="#F0E7DA" strokeWidth={1} />)}
        {series.map((s) => <path key={s.key} d={line(s.key)} fill="none" stroke={s.color} strokeWidth={1.6} />)}
        {points.map((p, i) => <text key={i} x={pad + i * stepX} y={H - 6} fontSize={8} textAnchor="middle" fill="var(--muted)">{new Date(p.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</text>)}
      </svg>
    </div>
  );
}

function Kpi({ k }: { k: import('../api/superAdminApi').McKpi }) {
  return (
    <div className="kpi" style={{ border: '1px solid var(--line)', background: '#fff' }} aria-label={`${k.label}: ${k.available ? k.value : 'not connected'}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: '50%', background: '#FBF1E2', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9 }}>{KICON[k.key] || '•'}</span>
        <span className="l" style={{ fontSize: 10 }}>{k.label}</span>
      </div>
      <div className="v" style={{ fontSize: 16 }}>{k.available ? k.value : <NotConnected />}</div>
      <div className="d flat" style={{ fontSize: 10 }}>{k.available ? (k.supporting || '\u00A0') : 'NotConnected'}</div>
    </div>
  );
}
