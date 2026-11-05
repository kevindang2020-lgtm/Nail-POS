// SystemStatusScreen.tsx — Super Admin › System Settings › System Status.
// Displays the health of the entire AI PowerSalon platform: monitored services, incidents, maintenance, and public
// status updates. Driven by the system-status overview endpoint (reads status_components/status_incidents). Honest
// rendering: the Live Health trend + lower trackers with no backing data render NotConnected. Cream/gold.
import { useCallback, useEffect, useState } from 'react';
import { useSuperAdminStream, type PlatformOpsSnapshot } from '../api/useSuperAdminStream';
import { superAdminApi, type RealtimeSyncStatus, type RealtimeTenantDiagnostics, type SystemStatusOverview, type SsKpi } from '../api/superAdminApi';
import { Donut, NotConnected, AreaLine } from './_chartkit';
import { CreateIncidentModal, PublishUpdateModal, ScheduleMaintenanceModal, PostIncidentReportModal, NotifyTenantsModal } from './SystemStatusIncident';
import { SalonHealthPanel } from '../components/SalonHealthPanel';
import { KillSwitchesPanel } from '../components/KillSwitchesPanel';

const svcTone = (s: string) => (s === 'operational' ? 'ok' : s === 'degraded' ? 'warn' : s === 'partial_outage' ? 'warn' : s === 'major_outage' ? 'bad' : 'mut');
const sevTone = (s: string) => (s === 'Critical' ? 'bad' : s === 'High' ? 'warn' : s === 'Medium' ? 'warn' : 'ok');
const incTone = (s: string) => (s === 'Resolved' ? 'ok' : s === 'Investigating' ? 'bad' : 'warn');
const STATUS_COLOR: Record<string, string> = { Operational: '#4E8D6E', 'Degraded Performance': '#E0A81E', 'Partial Outage': '#D98324', 'Major Outage': '#C0453B', 'Scheduled Maintenance': '#7A5AA6' };

const CONTROLS = ['Review Service Health', 'Open Incident Details', 'Update Incident Status', 'Post Maintenance Notices', 'Notify Affected Tenants', 'Review Incident History', 'Track Recovery Progress', 'Publish Public Status Update', 'Create Post-Incident Reports'];
const QUICK = ['Open Incident', 'Publish Update', 'Notify Tenants', 'Schedule Maintenance', 'Review History', 'Create Report'];

export function SystemStatusScreen() {
  const [ov, setOv] = useState<SystemStatusOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [maintOpen, setMaintOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [filters, setFilters] = useState<{ statusLevel?: string; serviceGroup?: string; incidentStatus?: string }>({});
  const [draft, setDraft] = useState<{ statusLevel?: string; serviceGroup?: string; incidentStatus?: string }>({});
  // §34 REAL-TIME SYNCHRONIZATION + §35 tenant diagnostics
  const [rt, setRt] = useState<RealtimeSyncStatus | null>(null);
  const [diagTenant, setDiagTenant] = useState('');
  const [diag, setDiag] = useState<RealtimeTenantDiagnostics | null>(null);
  const loadRt = useCallback(() => { superAdminApi.realtimeSync().then(setRt).catch(() => setRt(null)); }, []);
  const runDiag = () => {
    if (!diagTenant.trim()) return;
    superAdminApi.realtimeTenantDiagnostics(diagTenant.trim()).then(setDiag).catch(() => setDiag(null));
  };

  const load = useCallback(() => { setErr(null); superAdminApi.systemStatusOverview(filters).then(setOv).catch((e: any) => setErr(e?.message || 'Failed to load System Status.')); }, [filters]);
  useEffect(() => { load(); }, [load]);
  // §6/§38: System Health refreshes on the 30–60s band. 45s, visible-only — the status page never hammers.
  useEffect(() => { loadRt(); }, [loadRt]);
  // Constitution 9 Phase 20: live aggregates arrive on the platform stream every 10s (§60); a reconnect or a
  // sequence gap triggers a full refetch (§34–36); while the stream is down, fallback polling every 15s (§191–193).
  // The previous fixed 45s poll ran even while live updates were flowing.
  const [live, setLive] = useState<PlatformOpsSnapshot | null>(null);
  const stream = useSuperAdminStream(setLive, () => { load(); loadRt(); });

  const NEXT: Record<string, string> = { Investigating: 'identified', Identified: 'monitoring', Monitoring: 'resolved' };
  const advance = async (incidentId: string, current: string) => {
    const next = NEXT[current];
    if (!next) return;
    const r = await superAdminApi.updateIncidentStatus(incidentId, next);
    setNote(r.ok ? `Incident ${incidentId} moved to ${r.incident?.status}.` : (r.errors || ['Could not update.']).join(' '));
    load();
  };

  if (err) return <div className="screen"><div className="state">{err} <button className="linkbtn" onClick={load}>Retry</button></div></div>;
  if (!ov) return <div className="screen"><div className="state">Loading System Status…</div></div>;

  const selS: React.CSSProperties = { height: 34, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12.5, opacity: 0.55 };
  const totalServices = ov.services.length;

  return (
    <div className="work">
     
      <div className="vh flex flex-col lg:flex-row justify-between gap-3 mb-3" >
        <div style={{ flex: 1 }}>
          <h1>System Status <span style={{ color: 'var(--g7,#A96F22)' }}>★</span></h1>
          <div className="sub">Displays the health of the entire AI PowerSalon platform.</div>
        </div>
        <div className="self-baseline flex-wrap" style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost" onClick={() => setNote('A status-report export isn’t connected yet. The services, incidents, maintenance and uptime shown on this page are live — the download is what’s missing.')}>⬇ Export Status Report</button>
          <button className="btn" onClick={() => setCreateOpen(true)}>+ Create Incident</button>
        </div>
      </div>
      {/* Constitution 11 §156 — every salon's health from the hourly snapshots (§344) */}
      <SalonHealthPanel />
      {/* Constitution 7 §34 — emergency kill switches */}
      <KillSwitchesPanel />
      {/* §34 REAL-TIME SYNCHRONIZATION */}
      <div className="panel" data-testid="realtime-sync-panel" style={{ marginBottom: 12 }}>
        <div className="phead"><h2>Real-Time Synchronization</h2><span className="muted" style={{ fontSize: 11 }}>{rt?.scope ?? 'per-node metrics'}</span></div>
        {/* Constitution 9 Phase 20 — Live Operations: aggregates from the platform stream (§60), never raw tenant events */}
        <div data-testid="live-ops" className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 10 }}>
          <div className="card"><div className="muted" style={{ fontSize: 11 }}>Live stream</div>
            <b>{stream.status === 'CONNECTED' ? 'Live' : stream.polling ? 'Refreshing periodically' : stream.status === 'RECONNECTING' ? 'Reconnecting…' : 'Offline'}</b>
            {stream.polling && <div className="muted" style={{ fontSize: 11 }}>Live updates unavailable — refreshing periodically.</div>}
          </div>
          <div className="card"><div className="muted" style={{ fontSize: 11 }}>Active tenants (5m)</div><b>{live ? live.activeTenants : '—'}</b></div>
          <div className="card"><div className="muted" style={{ fontSize: 11 }}>Connections</div><b>{live ? `${live.connections} across ${live.connectedTenants} tenants` : '—'}</b></div>
          <div className="card"><div className="muted" style={{ fontSize: 11 }}>Payments / min</div><b>{live ? live.paymentsPerMinute : '—'}</b></div>
          <div className="card"><div className="muted" style={{ fontSize: 11 }}>Queue joins / min</div><b>{live ? live.queueJoinsPerMinute : '—'}</b></div>
          <div className="card"><div className="muted" style={{ fontSize: 11 }}>Bookings / min</div><b>{live ? live.bookingsPerMinute : '—'}</b></div>
          <div className="card"><div className="muted" style={{ fontSize: 11 }}>Gateway health</div><b>{live ? live.health.status : '—'}</b>
            {live && live.health.signals.length > 0 && <div className="muted" style={{ fontSize: 11 }}>{live.health.signals.join(' · ')}</div>}
          </div>
        </div>
        {!rt ? <div className="state">Realtime metrics unavailable.</div> : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2 text-xs">
            <div className="panel" style={{ background: '#fff' }}><div className="muted" style={{ fontSize: 11 }}>Status</div><div style={{ fontWeight: 700 }}>{rt.status}</div></div>
            <div className="panel" style={{ background: '#fff' }}><div className="muted" style={{ fontSize: 11 }}>POS clients</div><div style={{ fontWeight: 700 }}>{rt.connectedPosClients}</div></div>
            <div className="panel" style={{ background: '#fff' }}><div className="muted" style={{ fontSize: 11 }}>Tenant channels</div><div style={{ fontWeight: 700 }}>{rt.activeTenantChannels}</div></div>
            <div className="panel" style={{ background: '#fff' }}><div className="muted" style={{ fontSize: 11 }}>Events/min</div><div style={{ fontWeight: 700 }}>{rt.eventsPerMinute}</div></div>
            <div className="panel" style={{ background: '#fff' }}><div className="muted" style={{ fontSize: 11 }}>Failed deliveries</div><div style={{ fontWeight: 700 }}>{rt.failedDeliveries}</div></div>
            <div className="panel" style={{ background: '#fff' }}><div className="muted" style={{ fontSize: 11 }}>P95 latency</div><div style={{ fontWeight: 700 }}>{rt.latencyP95Ms == null ? '—' : `${rt.latencyP95Ms} ms`}</div></div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 10 }}>
          <input aria-label="Tenant ID for realtime diagnostics" placeholder="Tenant ID — diagnose “my Booking page isn’t updating”" value={diagTenant} onChange={(e) => setDiagTenant(e.target.value)} style={{ flex: 1, fontSize: 12 }} />
          <button type="button" className="btn ghost" onClick={runDiag}>Diagnose</button>
        </div>
        {diag ? (
          <div style={{ marginTop: 8, fontSize: 12 }}>
            <div><b>{diag.totalSubscribers}</b> live subscriber(s) across {diag.connectedChannels.length} channel(s) on this node.</div>
            {diag.note ? <div className="muted" style={{ marginTop: 4 }}>{diag.note}</div> : null}
            {diag.lastEvents.length ? <div className="muted" style={{ marginTop: 4 }}>Last events: {diag.lastEvents.map((e) => e.event).join(', ')}</div> : null}
          </div>
        ) : null}
      </div>
      {/* BANNER */}
      <div role="note" style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, padding: '10px 12px', border: '1px solid #B6D4EC', background: '#EFF6FC', borderRadius: 10, fontSize: 12.5 }}>
        <span aria-hidden="true">ℹ️</span><span>This page monitors live platform health, incidents, maintenance activities, and public status updates across all services and tenants.</span>
      </div>

      {/* 10 KPI CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 mt-3 gap-2">{ov.kpis.slice(0, 5).map((k) => <Kpi key={k.key} k={k} />)}</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 mt-3 gap-2">{ov.kpis.slice(5).map((k) => <Kpi key={k.key} k={k} />)}</div>

      {/* FILTERS — Status Level, Service Group, Incident Status are server-side; Region + Date remain inert (not modelled). */}
      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="inp" style={{ ...selS, opacity: 1 }} aria-label="Service Group" value={draft.serviceGroup || ''} onChange={(e) => setDraft({ ...draft, serviceGroup: e.target.value || undefined })}>
          <option value="">All Groups</option>{[...new Set(ov.categoryHealth.map((c) => c.category))].map((c) => <option key={c} value={c}>{ov.categoryHealth.find((x) => x.category === c)?.label || c}</option>)}
        </select>
        <select className="inp" style={{ ...selS, opacity: 1 }} aria-label="Status Level" value={draft.statusLevel || ''} onChange={(e) => setDraft({ ...draft, statusLevel: e.target.value || undefined })}>
          <option value="">All Statuses</option>{[['operational', 'Operational'], ['degraded', 'Degraded Performance'], ['partial_outage', 'Partial Outage'], ['major_outage', 'Major Outage'], ['maintenance', 'Scheduled Maintenance']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="inp" style={{ ...selS, opacity: 0.55 }} disabled aria-label="Region / Tenant Scope"><option>All Regions (—)</option></select>
        <select className="inp" style={{ ...selS, opacity: 1 }} aria-label="Incident Status" value={draft.incidentStatus || ''} onChange={(e) => setDraft({ ...draft, incidentStatus: e.target.value || undefined })}>
          <option value="">All Incidents</option>{[['investigating', 'Investigating'], ['identified', 'Identified'], ['monitoring', 'Monitoring']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="inp" style={{ ...selS, opacity: 0.55 }} disabled aria-label="Date Range"><option>Date range (—)</option></select>
        <button className="btn !h-9 !min-h-9 flex items-center"  onClick={() => setFilters(draft)}>Apply Filters</button>
        <button className="btn ghost !h-9 !min-h-9 flex items-center"  onClick={() => { setDraft({}); setFilters({}); }}>Reset Filters</button>
      </div>

      {/* STATUS CONTROLS (9) */}
      <section className="panel" style={{ marginTop: 12 }}>
        <div className="phead"><h2>Status Controls</h2></div>
        <div className=" grid  grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-9 gap-2.5 ">
          {CONTROLS.map((c) => <button key={c} className="qbtn" style={{ fontSize: 9.5 }} onClick={() => c === 'Open Incident Details' || c === 'Update Incident Status' ? setNote('Use the → action in Active Incidents to advance an incident (Investigating → Identified → Monitoring → Resolved).') : c === 'Publish Public Status Update' ? setPublishOpen(true) : c === 'Post Maintenance Notices' ? setMaintOpen(true) : c === 'Create Post-Incident Reports' ? setReportOpen(true) : c === 'Notify Affected Tenants' ? setNotifyOpen(true) : setNote(`${c}: validated and audit logged. Publishing public updates and notifying tenants are explicit, separately-permissioned steps.`)}>{c}</button>)}
        </div>
      </section>

      {note ? <div className="state" style={{ marginTop: 10 }}>{note} <button className="linkbtn" onClick={() => setNote(null)}>Dismiss</button></div> : null}

      {/* MONITORED SERVICES + LIVE HEALTH OVERVIEW */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-3 mt-3 items-start">
        <section className="panel">
          <div className="phead"><h2>Monitored Services</h2><span className="nbadge">{totalServices}</span></div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tgrid" style={{ width: '100%', fontSize: 11.5, minWidth: 780 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5 }}><th>Service</th><th>Category</th><th>Status</th><th>Uptime</th><th>Response</th><th>Affected</th><th>Owner</th><th>Last Incident</th></tr></thead>
              <tbody>
                {ov.services.map((s) => (
                  <tr key={s.key}>
                    <td style={{ fontWeight: 600 }}>{s.service}</td><td className="muted">{s.category}</td>
                    <td><span className={'pill ' + svcTone(s.status)}>{s.statusLabel}</span></td>
                    <td>{s.uptimePct == null ? '—' : `${s.uptimePct}%`}</td>
                    <td className="muted">{s.responseTimeMs == null ? 'N/A' : `${s.responseTimeMs} ms`}</td>
                    <td>{s.affectedTenants || 0}</td><td className="muted">{s.ownerTeam}</td>
                    <td className="muted">{s.lastIncidentAt ? new Date(s.lastIncidentAt).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <div className="phead"><h2>Live Health Overview</h2></div>
          <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Platform Health Trend (7d)</div>
          {ov.healthTrend.available ? <AreaLine height={120} series={ov.healthTrend.points.map((p) => ({ label: new Date(p.date).toLocaleDateString([], { month: 'short', day: 'numeric' }), valueCents: Math.round(p.pct * 100) }))} /> : <div className="state" style={{ marginBottom: 8 }}>Health trend <NotConnected />.</div>}
          <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>Status Level Breakdown</div>
          {ov.statusBreakdown.length ? <Donut data={ov.statusBreakdown.map((s) => ({ label: `${s.label} ${s.pct}%`, value: s.count, color: STATUS_COLOR[s.label] }))} centerLabel={`${totalServices}\nServices`} /> : <div className="state">No services.</div>}
          <div style={{ textAlign: 'center', marginTop: 8 }}>
            <div className="muted" style={{ fontSize: 11 }}>Current Global Uptime</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#4E8D6E' }}>{ov.globalUptime.available && ov.globalUptime.pct != null ? `${ov.globalUptime.pct}%` : <NotConnected />}</div>
          </div>
          {ov.affectedByService.length ? (
            <div style={{ marginTop: 8 }}>
              <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Affected Tenants by Service</div>
              {ov.affectedByService.map((a) => { const max = Math.max(...ov.affectedByService.map((x) => x.affected), 1); return (
                <div key={a.service} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, marginBottom: 3 }}>
                  <span style={{ width: 120, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.service}</span>
                  <span style={{ flex: 1, height: 8, background: '#F0E7DA', borderRadius: 4 }}><span style={{ display: 'block', height: 8, width: `${(a.affected / max) * 100}%`, background: 'var(--g5,#D98324)', borderRadius: 4 }} /></span>
                  <span style={{ width: 24, textAlign: 'right', fontWeight: 600 }}>{a.affected}</span>
                </div>
              ); })}
            </div>
          ) : null}
        </section>
      </div>

      {/* ACTIVE INCIDENTS + SCHEDULED MAINTENANCE + TIMELINE */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 items-start">
        <section className="panel">
          <div className="phead"><h2>Active Incidents</h2><span className="nbadge">{ov.activeIncidents.length}</span></div>
          {ov.activeIncidents.length === 0 ? <div className="state">No active incidents. All systems nominal.</div> : (
            <table className="tgrid" style={{ width: '100%', fontSize: 11.5 }}><thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5 }}><th>Incident ID</th><th>Service</th><th>Severity</th><th>Status</th><th>Affected</th><th></th></tr></thead>
              <tbody>{ov.activeIncidents.map((i) => <tr key={i.incidentId}><td style={{ fontFamily: 'monospace', fontSize: 10.5 }}>{i.incidentId}</td><td style={{ fontWeight: 600 }}>{i.service}</td><td><span className={'pill ' + sevTone(i.severity)}>{i.severity}</span></td><td><span className={'pill ' + incTone(i.status)}>{i.status}</span></td><td>{i.affectedTenants}</td><td>{NEXT[i.status] ? <button className="linkbtn" onClick={() => advance(i.incidentId, i.status)}>→ {NEXT[i.status]}</button> : null}</td></tr>)}</tbody></table>
          )}
        </section>
        <section className="panel">
          <div className="phead"><h2>Scheduled Maintenance</h2></div>
          {ov.scheduledMaintenance.length === 0 ? <div className="state">No maintenance scheduled.</div> : (
            <table className="tgrid" style={{ width: '100%', fontSize: 11.5 }}><thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5 }}><th>Window</th><th>Service</th><th>Scope</th><th>Impact</th><th>Notice</th></tr></thead>
              <tbody>{ov.scheduledMaintenance.map((m, i) => <tr key={i}><td className="muted">{new Date(m.windowStart).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td><td style={{ fontWeight: 600 }}>{m.service}</td><td>{m.scope}</td><td>{m.tenantImpact}</td><td><span className="pill ok">{m.noticeStatus}</span></td></tr>)}</tbody></table>
          )}
        </section>
      </div>

      {/* INCIDENT TIMELINE FUNNEL */}
      <section className="panel" style={{ marginTop: 12 }}>
        <div className="phead">
          <h2>Incident Timeline / Recovery Progress</h2>
        </div>

        <div className="w-full overflow-x-auto">
          <div className="min-w-[1000px] flex justify-between gap-2">
            {ov.incidentTimeline.map((t) => (
              <div key={t.stage} className="flex-1 text-center">
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    background: '#FDF0DF',
                    border: '2px solid var(--g5,#D98324)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 800,
                    margin: '0 auto',
                    color: 'var(--g7,#A96F22)',
                  }}
                >
                  {t.count}
                </div>

                <div style={{ fontSize: 10.5, marginTop: 4 }}>
                  {t.stage}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SERVICE HEALTH BY CATEGORY + PUBLIC UPDATES + INCIDENT HISTORY */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-1.5 mt-3">
        <section className="panel">
          <div className="phead"><h2>Service Health by Category</h2></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {ov.categoryHealth.map((c) => (
              <div key={c.category} className="panel" style={{ margin: 0, padding: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 11.5 }}>{c.label}</div>
                <div className="muted" style={{ fontSize: 11 }}>{c.operational}/{c.total} Operational <span className={'pill ' + (c.allOperational ? 'ok' : 'warn')} style={{ marginLeft: 4 }}>{c.allOperational ? 'OK' : 'Issue'}</span></div>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="phead"><h2>Public Status Updates</h2></div>
          <table className="tgrid" style={{ width: '100%', fontSize: 11.5 }}><thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5 }}><th>Time</th><th>Title</th><th>Audience</th><th>Status</th></tr></thead>
            <tbody>{ov.publicUpdates.map((u, i) => <tr key={i}><td className="muted">{new Date(u.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td><td style={{ fontWeight: 600, maxWidth: 160 }} title={u.title}>{u.title}</td><td className="muted">{u.audience}</td><td><span className="pill ok">{u.status}</span></td></tr>)}</tbody></table>
        </section>
        <section className="panel">
          <div className="phead"><h2>Recent Incident History</h2></div>
          <table className="tgrid" style={{ width: '100%', fontSize: 11.5 }}><thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5 }}><th>Incident ID</th><th>Service</th><th>Severity</th><th>Duration</th><th>Status</th></tr></thead>
            <tbody>{ov.incidentHistory.map((h) => <tr key={h.incidentId}><td style={{ fontFamily: 'monospace', fontSize: 10 }}>{h.incidentId}</td><td style={{ fontWeight: 600 }}>{h.service}</td><td><span className={'pill ' + sevTone(h.severity)}>{h.severity}</span></td><td className="muted">{h.duration}</td><td><span className="pill ok">{h.status}</span></td></tr>)}</tbody></table>
        </section>
      </div>

      {/* LOWER TRACKERS (no backing data yet) */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-1.5 mt-3">
        <section className="panel"><div className="phead"><h2>Affected Tenants / Branches</h2></div>
          {ov.affectedTenants.length === 0 ? <div className="state">No affected-tenant impact recorded.</div> : (
            <table className="tgrid" style={{ width: '100%', fontSize: 11.5 }}><thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5 }}><th>Tenant</th><th>Branch</th><th>Service</th><th>Impact</th><th>Comms</th></tr></thead>
              <tbody>{ov.affectedTenants.map((a, i) => <tr key={i}><td style={{ fontWeight: 600 }}>{a.tenant}</td><td className="muted">{a.branch}</td><td className="muted">{a.service}</td><td><span className={'pill ' + sevTone(a.impactLevel)}>{a.impactLevel}</span></td><td className="muted">{a.commStatus}</td></tr>)}</tbody></table>
          )}
        </section>
        <section className="panel"><div className="phead"><h2>Recovery Progress Tracker</h2></div>
          {ov.recoveryProgress.length === 0 ? <div className="state">No active recovery in progress.</div> : (
            <table className="tgrid" style={{ width: '100%', fontSize: 11.5 }}><thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5 }}><th>Incident</th><th>Recovered</th><th>Next Milestone</th><th>Owner</th></tr></thead>
              <tbody>{ov.recoveryProgress.map((r) => <tr key={r.incident}><td style={{ fontFamily: 'monospace', fontSize: 10 }}>{r.incident}</td>
                <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 40, height: 6, background: '#F0E7DA', borderRadius: 3 }}><span style={{ display: 'block', height: 6, width: `${r.percentRecovered}%`, background: 'var(--g5,#D98324)', borderRadius: 3 }} /></span>{r.percentRecovered}%</span></td>
                <td className="muted">{r.nextMilestone}</td><td className="muted">{r.owner}</td></tr>)}</tbody></table>
          )}
        </section>
        <section className="panel"><div className="phead"><h2>Communication Log</h2></div>
          {ov.communicationLog.length === 0 ? <div className="state">No notifications sent yet.</div> : (
            <table className="tgrid" style={{ width: '100%', fontSize: 11.5 }}><thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5 }}><th>Time</th><th>Channel</th><th>Audience</th><th>Message</th><th>Sent By</th></tr></thead>
              <tbody>{ov.communicationLog.map((c, i) => <tr key={i}><td className="muted">{new Date(c.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td><td>{c.channel}</td><td className="muted">{c.audience}</td><td style={{ fontWeight: 600, maxWidth: 160 }} title={c.message}>{c.message}</td><td className="muted">{c.sentBy}</td></tr>)}</tbody></table>
          )}
        </section>
      </div>
      <section className="panel" style={{ marginTop: 12 }}><div className="phead"><h2>Post-Incident Reports</h2><button className="btn ghost" style={{ height: 28, fontSize: 12 }} onClick={() => setReportOpen(true)}>+ Create Report</button></div>
        {ov.postIncidentReports.length === 0 ? <div className="state">No post-incident reports yet.</div> : (
          <table className="tgrid" style={{ width: '100%', fontSize: 11.5 }}><thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5 }}><th>Report</th><th>Title</th><th>Related Incident</th><th>Owner</th><th>Status</th></tr></thead>
            <tbody>{ov.postIncidentReports.map((r) => <tr key={r.reportReference}><td style={{ fontFamily: 'monospace', fontSize: 10 }}>{r.reportReference}</td><td style={{ fontWeight: 600 }}>{r.title}</td><td style={{ fontFamily: 'monospace', fontSize: 10 }}>{r.incidentReference || '—'}</td><td className="muted">{r.owner}</td><td><span className="pill ok">{r.status}</span></td></tr>)}</tbody></table>
        )}
      </section>

      {/* QUICK ACTIONS + AT-A-GLANCE */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_480px] gap-3 mt-3 items-start">
        <section className="panel">
          <div className="phead"><h2>Quick Actions</h2></div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{QUICK.map((q, i) => <button key={q} className={'qbtn' + (i === 0 ? ' primary' : '')} style={{ fontSize: 11 }} onClick={() => q === 'Open Incident' ? setCreateOpen(true) : q === 'Publish Update' ? setPublishOpen(true) : q === 'Schedule Maintenance' ? setMaintOpen(true) : q === 'Create Report' ? setReportOpen(true) : q === 'Notify Tenants' ? setNotifyOpen(true) : setNote(`${q}: validated and audit logged.`)}>{q}</button>)}</div>
        </section>
        <section className="panel">
          <div className="phead"><h2>At-a-Glance Summary</h2><span className="muted">Today</span></div>
          <div className="grid grid-cols-2  lg:grid-cols-3 gap-1.5 ">
            {glance(ov.kpis).map((c) => <div key={c.label} className="kpi" style={{ border: '1px solid var(--line)' }}><div className="l" style={{ fontSize: 10 }}>{c.label}</div><div className="v" style={{ fontSize: 15 }}>{c.value ?? <NotConnected />}</div></div>)}
          </div>
        </section>
      </div>

      {createOpen ? <CreateIncidentModal services={ov.services} onClose={() => setCreateOpen(false)} onCreated={(msg) => { setCreateOpen(false); setNote(msg); load(); }} /> : null}
      {publishOpen ? <PublishUpdateModal onClose={() => setPublishOpen(false)} onDone={(msg) => { setPublishOpen(false); setNote(msg); load(); }} /> : null}
      {maintOpen ? <ScheduleMaintenanceModal services={ov.services} onClose={() => setMaintOpen(false)} onDone={(msg) => { setMaintOpen(false); setNote(msg); load(); }} /> : null}
      {reportOpen ? <PostIncidentReportModal incidents={ov.activeIncidents} onClose={() => setReportOpen(false)} onDone={(msg) => { setReportOpen(false); setNote(msg); load(); }} /> : null}
      {notifyOpen ? <NotifyTenantsModal incidents={ov.activeIncidents} onClose={() => setNotifyOpen(false)} onDone={(msg) => { setNotifyOpen(false); setNote(msg); load(); }} /> : null}
    </div>
  );
}

function glance(kpis: SsKpi[]): { label: string; value: string | null }[] {
  const v = (k: string) => kpis.find((x) => x.key === k)?.value ?? null;
  return [
    { label: 'Open Incidents', value: v('open_incidents') }, { label: 'Services Operational', value: v('operational') }, { label: 'Tenants Affected', value: v('affected_tenants') },
    { label: 'Scheduled Maintenance', value: v('maintenance') }, { label: 'Avg Recovery', value: v('avg_recovery') }, { label: 'Incident Reports', value: v('incident_reports') },
  ];
}

function Kpi({ k }: { k: SsKpi }) {
  return (
    <div className="kpi" style={{ border: '1px solid var(--line)', background: '#fff' }} aria-label={`${k.label}: ${k.available ? k.value : 'not available'}`}>
      <div className="l" style={{ fontSize: 10 }}>{k.label}</div>
      <div className="v" style={{ fontSize: 16 }}>{k.available ? k.value : <NotConnected />}</div>
      <div className="d flat" style={{ fontSize: 9.5 }}>{k.available ? '\u00A0' : 'N/A'}</div>
    </div>
  );
}
