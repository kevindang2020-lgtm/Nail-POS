// DevicesScreen.tsx — Super Admin › System Settings › Device Management.
// Manages POS devices, kiosks, terminals, printers, caller-ID equipment, and mobile devices. Driven by the
// device-management overview endpoint. Online/offline honors the heartbeat threshold (server-derived). Honest
// rendering: the 7-day connection trend + merchant-terminal connectivity render NotConnected (need historical
// heartbeat aggregates). No device secret/token is ever shown. Cream/gold.
import { useCallback, useEffect, useState } from 'react';
import { superAdminApi, type DeviceMgmtOverview, type DmKpi } from '../api/superAdminApi';
import { Donut, NotConnected } from './_chartkit';
import { DeviceDetailDrawer } from './DeviceDetail';

const statusTone = (s: string) => (s === 'Online' ? 'ok' : s === 'Offline' ? 'bad' : s === 'Maintenance' ? 'warn' : s === 'Locked' || s === 'Revoked' ? 'bad' : 'warn');
const secTone = (s: string) => (s === 'Compliant' ? 'ok' : s === 'Compromised' || s === 'Non-Compliant' ? 'bad' : 'warn');
const updTone = (s: string) => (s === 'Up To Date' ? 'ok' : s === 'Update Required' || s === 'Update Failed' ? 'bad' : 'warn');
const sevTone = (s: string) => (s === 'Critical' ? 'bad' : s === 'High' ? 'warn' : s === 'Medium' ? 'warn' : 'ok');

const CONTROLS = [
  'Register Devices', 'Assign to Branches', 'Unassign Devices', 'Activate / Deactivate', 'Lock Lost Devices', 'Revoke Sessions',
  'Push Configuration', 'Require App Updates', 'Review Logs', 'Track Shipments', 'Maintenance Mode',
];
const QUICK = ['Add Device', 'Push Config', 'Lock Device', 'Revoke Session', 'Require Update', 'View Logs', 'Branch Profile'];

export function DevicesScreen() {
  const [ov, setOv] = useState<DeviceMgmtOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [deviceType, setDeviceType] = useState('');
  const [status, setStatus] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(() => { setErr(null); superAdminApi.deviceMgmtOverview().then(setOv).catch((e: any) => setErr(e?.message || 'Failed to load Device Management.')); }, []);
  useEffect(() => { load(); }, [load]);

  if (err) return <div className="screen"><div className="state">{err} <button className="linkbtn" onClick={load}>Retry</button></div></div>;
  if (!ov) return <div className="screen"><div className="state">Loading Device Management…</div></div>;

  const selS: React.CSSProperties = { height: 34, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12.5 };
  const filtered = ov.devices.filter((d) => (!deviceType || d.type === deviceType) && (!status || d.status === status));
  const sensitive = (label: string) => setNote(`${label}: sensitive action — requires the matching permission, confirmation, and is audit logged. Device secrets/tokens are never shown.`);

  return (
    <div className="screen">
      {/* HEADER */}
      <div className="vh flex flex-col lg:flex-row justify-between gap-3" >
        <div style={{ flex: 1 }}>
          <h1>Device Management <span style={{ color: 'var(--g7,#A96F22)' }}>★</span></h1>
          <div className="sub">Manages POS devices, kiosks, terminals, printers, caller-ID equipment, and mobile devices.</div>
        </div>
        <div className="self-baseline" style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost" onClick={() => setNote('A device-report export isn\u2019t connected yet \u2014 the filtered list on this page is the current view. (When built it will exclude credentials, tokens, and private keys, and be audit logged.)')}>⬇ Export Device Report</button>
          <button className="btn" onClick={() => sensitive('Register Device')}>+ Register Device</button>
        </div>
      </div>

      {/* 10 KPI CARDS */}
      <div className=" grid  grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 mb-3 mt-3">{ov.kpis.slice(0, 5).map((k) => <Kpi key={k.key} k={k} />)}</div>
      <div className=" grid  grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 mb-3 mt-3">{ov.kpis.slice(5).map((k) => <Kpi key={k.key} k={k} />)}</div>

      {/* FILTERS */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="inp" style={selS} value={deviceType} onChange={(e) => setDeviceType(e.target.value)} aria-label="Device Type"><option value="">All Types</option>{ov.byType.map((t) => <option key={t.label} value={t.label}>{t.label}</option>)}</select>
        <select className="inp" style={{ ...selS, opacity: 0.55 }} disabled aria-label="Tenant"><option>All Tenants (—)</option></select>
        <select className="inp" style={{ ...selS, opacity: 0.55 }} disabled aria-label="Branch"><option>All Branches (—)</option></select>
        <select className="inp" style={selS} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All Statuses</option>{['Online', 'Offline', 'Maintenance', 'Warning', 'Locked', 'Revoked', 'Inactive'].map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select className="inp" style={{ ...selS, opacity: 0.55 }} disabled aria-label="Security Status"><option>Security: All (—)</option></select>
        <select className="inp" style={{ ...selS, opacity: 0.55 }} disabled aria-label="Update Status"><option>Update: All (—)</option></select>
        <select className="inp" style={{ ...selS, opacity: 0.55 }} disabled aria-label="Date Range"><option>Date range (—)</option></select>
        <button className="btn" style={{ height: 34 }} onClick={() => setNote(`Showing ${filtered.length} device(s).`)}>Apply Filters</button>
        <button className="btn ghost" style={{ height: 34 }} onClick={() => { setDeviceType(''); setStatus(''); }}>Reset Filters</button>
      </div>

      {/* DEVICE CONTROLS (11) */}
      <section className="panel" style={{ marginTop: 12 }}>
        <div className="phead"><h2>Device Controls</h2></div>
        <div className=" grid  grid-cols-2 md:grid-cols-3 lg:grid-cols-4  xl:grid-cols-5 2xl:grid-cols-7 gap-3">
          {CONTROLS.map((c) => <button key={c} className="qbtn" style={{ fontSize: 10.5 }} onClick={() => sensitive(c)}>{c}</button>)}
        </div>
      </section>

      {note ? <div className="state" style={{ marginTop: 10 }}>{note} <button className="linkbtn" onClick={() => setNote(null)}>Dismiss</button></div> : null}

      {/* MANAGED DEVICES + CONNECTION HEALTH */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-3 mt-3 items-start">
        <section className="panel">
          <div className="phead"><h2>Managed Devices</h2><span className="nbadge">{filtered.length}</span></div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tgrid" style={{ width: '100%', fontSize: 11.5, minWidth: 1000 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5 }}><th>Device</th><th>Type</th><th>Branch</th><th>Serial</th><th>OS</th><th>App</th><th>Last Conn.</th><th>Status</th><th>User</th><th>Terminal</th><th>Security</th><th>Update</th></tr></thead>
              <tbody>
                {filtered.length === 0 ? <tr><td colSpan={12}><div className="state">No devices match these filters.</div></td></tr> :
                  filtered.map((d) => (
                    <tr key={d.id}>
                      <td style={{ fontWeight: 600 }}><button className="linkbtn" style={{ textAlign: 'left', fontWeight: 600 }} onClick={() => setDetailId(d.id)}>{d.name}</button></td><td className="muted">{d.type}</td><td className="muted">{d.branch}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 10.5 }}>{d.serial}</td><td className="muted">{d.os}</td><td>{d.appVersion}</td><td className="muted">{d.lastConnection}</td>
                      <td><span className={'pill ' + statusTone(d.status)}>{d.status}</span></td>
                      <td className="muted">{d.assignedUser}</td><td style={{ fontFamily: 'monospace', fontSize: 10.5 }}>{d.merchantTerminalId}</td>
                      <td><span className={'pill ' + secTone(d.securityStatus)}>{d.securityStatus}</span></td>
                      <td><span className={'pill ' + updTone(d.updateStatus)}>{d.updateStatus}</span></td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <div className="phead"><h2>Connection Status &amp; Health</h2><span className="muted">7d</span></div>
          <div className="state">Online/offline/total 7-day trend <NotConnected />. Historical heartbeat aggregation isn't modelled yet.</div>
        </section>
      </div>

      {/* THREE DONUTS + MERCHANT TERMINAL CONNECTIVITY */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 mt-3">
        <section className="panel"><div className="phead"><h2>Devices by Type</h2></div>{ov.byType.length ? <Donut data={ov.byType.map((s) => ({ label: `${s.label} ${s.pct}%`, value: s.value }))} centerLabel={`${ov.devices.length}\nTotal`} /> : <div className="state">No devices.</div>}</section>
        <section className="panel"><div className="phead"><h2>Online vs Offline Status</h2></div>{ov.byStatus.length ? <Donut data={ov.byStatus.map((s) => ({ label: `${s.label} ${s.pct}%`, value: s.value }))} centerLabel={`${ov.devices.length}\nTotal`} /> : <div className="state">No devices.</div>}</section>
        <section className="panel"><div className="phead"><h2>Update Compliance</h2></div>{ov.byUpdate.length ? <Donut data={ov.byUpdate.map((s) => ({ label: `${s.label} ${s.pct}%`, value: s.value }))} centerLabel={`${ov.devices.length}\nTotal`} /> : <div className="state">No devices.</div>}</section>
        <section className="panel"><div className="phead"><h2>Merchant Terminal Connectivity</h2></div><div className="state">7-day terminal connectivity <NotConnected />.</div></section>
      </div>

      {/* LOWER TABLES */}
      <div className="grid grid-cols-1  md:grid-cols-2 xl:grid-cols-3 gap-3 mt-3" style={{ marginTop: 12 }}>
        <section className="panel">
          <div className="phead"><h2>Tenant Device Usage Overview</h2></div>
          <table className="tgrid" style={{ width: '100%', fontSize: 11.5 }}><thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5 }}><th>Tenant</th><th>Total</th><th>Online</th><th>Offline</th><th>Users</th><th>Last Sync</th></tr></thead>
            <tbody>{ov.tenantUsage.map((t) => <tr key={t.tenant}><td style={{ fontWeight: 600 }}>{t.tenant}</td><td>{t.total}</td><td>{t.online}</td><td>{t.offline}</td><td>{t.assignedUsers}</td><td className="muted">{t.lastSync ? new Date(t.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</td></tr>)}</tbody></table>
        </section>
        <section className="panel">
          <div className="phead"><h2>Recent Connection Logs</h2></div>
          <table className="tgrid" style={{ width: '100%', fontSize: 11.5 }}><thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5 }}><th>Time</th><th>Device</th><th>Event</th><th>Result</th></tr></thead>
            <tbody>{ov.connectionLogs.map((l, i) => <tr key={i}><td className="muted">{new Date(l.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td><td style={{ fontWeight: 600 }}>{l.device}</td><td className="muted">{l.event}</td><td><span className={'pill ' + (l.result === 'Success' ? 'ok' : l.result === 'Failed' ? 'bad' : 'warn')}>{l.result}</span></td></tr>)}</tbody></table>
        </section>
        <section className="panel">
          <div className="phead"><h2>Security &amp; Session Alerts</h2></div>
          <table className="tgrid" style={{ width: '100%', fontSize: 11.5 }}><thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5 }}><th>Device</th><th>Issue</th><th>Severity</th></tr></thead>
            <tbody>{ov.securityAlerts.map((a, i) => <tr key={i}><td style={{ fontWeight: 600 }}>{a.device}</td><td className="muted" title={a.issue}>{a.issue}</td><td><span className={'pill ' + sevTone(a.severity)}>{a.severity}</span></td></tr>)}</tbody></table>
        </section>
      </div>

      {/* HARDWARE SHIPMENTS & MAINTENANCE */}
      <section className="panel" style={{ marginTop: 12 }}>
        <div className="phead"><h2>Hardware Shipments &amp; Maintenance</h2></div>
        <table className="tgrid" style={{ width: '100%', fontSize: 11.5 }}><thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5 }}><th>Shipment / Ticket ID</th><th>Device</th><th>Destination Branch</th><th>Status</th><th>ETA / Window</th></tr></thead>
          <tbody>{ov.shipmentsMaintenance.map((s) => <tr key={s.reference}><td style={{ fontFamily: 'monospace' }}>{s.reference}</td><td style={{ fontWeight: 600 }}>{s.device}</td><td className="muted">{s.branch}</td><td><span className={'pill ' + (s.status === 'Delivered' ? 'ok' : s.status === 'Delayed' ? 'bad' : 'warn')}>{s.status}</span></td><td className="muted">{s.eta || '—'}</td></tr>)}</tbody></table>
      </section>

      {/* DEVICE TYPE CATALOG */}
      <section className="panel" style={{ marginTop: 12 }}>
        <div className="phead"><h2>Device Type Catalog / Available Hardware</h2></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 8 }}>
          {ov.catalog.map((c) => (
            <button key={c.deviceType} className="qbtn" style={{ flexDirection: 'column', alignItems: 'center', gap: 2, padding: '10px 6px' }} onClick={() => setDeviceType(c.displayName)}>
              <span style={{ fontWeight: 600, fontSize: 11, textAlign: 'center' }}>{c.displayName}</span>
              <span className="muted" style={{ fontSize: 10 }}>{c.modelCount} Models</span>
            </button>
          ))}
        </div>
      </section>

      {/* QUICK ACTIONS + AT-A-GLANCE */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_520px] gap-3 mt-3 items-start">
        <section className="panel">
          <div className="phead"><h2>Quick Actions</h2></div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {QUICK.map((q, i) => <button key={q} className={'qbtn' + (i === 0 ? ' primary' : '')} style={{ fontSize: 11 }} onClick={() => sensitive(q)}>{q}</button>)}
          </div>
        </section>
        <section className="panel">
          <div className="phead"><h2>At-a-Glance Summary</h2><span className="muted">Today</span></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {glance(ov.kpis).map((c) => <div key={c.label} className="kpi" style={{ border: '1px solid var(--line)' }}><div className="l" style={{ fontSize: 10 }}>{c.label}</div><div className="v" style={{ fontSize: 15 }}>{c.value ?? <NotConnected />}</div></div>)}
          </div>
        </section>
      </div>

      {detailId ? <DeviceDetailDrawer id={detailId} onClose={() => setDetailId(null)} /> : null}
    </div>
  );
}

function glance(kpis: DmKpi[]): { label: string; value: string | null }[] {
  const v = (k: string) => kpis.find((x) => x.key === k)?.value ?? null;
  return [
    { label: 'Devices Online Today', value: v('online') }, { label: 'Total Devices', value: v('total') }, { label: 'Offline', value: v('offline') },
    { label: 'Updates Required', value: v('updates_required') }, { label: 'Maintenance', value: v('maintenance') }, { label: 'Shipments Pending', value: v('shipments_pending') },
  ];
}

function Kpi({ k }: { k: DmKpi }) {
  return (
    <div className="kpi" style={{ border: '1px solid var(--line)', background: '#fff' }} aria-label={`${k.label}: ${k.available ? k.value : 'not available'}`}>
      <div className="l" style={{ fontSize: 10 }}>{k.label}</div>
      <div className="v" style={{ fontSize: 16 }}>{k.available ? k.value : <NotConnected />}</div>
      <div className="d flat" style={{ fontSize: 9.5 }}>{k.available ? '\u00A0' : 'N/A'}</div>
    </div>
  );
}
