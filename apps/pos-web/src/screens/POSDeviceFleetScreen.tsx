// POSDeviceFleetScreen.tsx — one shared screen for the Devices sub-views (reception POS, check-in kiosk,
// tablets, receipt devices, assignments, health). All read the same real fleet overview
// (posDevicesApi.overview -> GET /pos/devices/overview: customer_display_devices + payment terminals). A
// `view` prop selects a type-filtered fleet, the assignment map, or the health dashboard. Unsourced fleet
// metrics render as "—" (the backend flags them via dataQuality) — never invented. Distinct from the
// existing POSDevicesScreen command center at /tenant/devices/overview; this backs the granular sub-items.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { posDevicesApi, type DevicesOverview, type FleetDevice, type DeviceStatus } from '../api/posDevicesApi';
import { reportError } from './reportsCommon';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

import { codeLabel, agoLabel } from '../components/codeLabel';
export type DeviceView = 'health' | 'assignments' | 'reception-pos' | 'check-in-kiosk' | 'tablets' | 'receipt-devices';
const TYPE_VIEWS: Record<string, { title: string; types: string[]; noun: string }> = {
  'reception-pos': { get title() { return tx('pos.reception_pos'); }, types: ['reception_pos'], get noun() { return tx('admin.devices.noun.receptionPos'); } },
  'check-in-kiosk': { get title() { return tx('pos.check_in_kiosks'); }, types: ['check_in_kiosk'], get noun() { return tx('admin.devices.noun.kiosk'); } },
  'tablets': { get title() { return tx('pos.tablets'); }, types: ['owner_mobile', 'technician_mobile', 'customer_display'], get noun() { return tx('admin.devices.noun.tablet'); } },
  'receipt-devices': { get title() { return tx('pos.receipt_devices'); }, types: ['printer'], get noun() { return tx('admin.devices.noun.printer'); } },
};
const typeLabel = (t: string) => (t && t !== '—' ? codeLabel('admin.devices.type', t, 'deviceType') : '—');
const statusColor = (s: DeviceStatus | string) => s === 'online' ? '#2E9E54' : (s === 'maintenance' || s === 'reconnecting') ? '#B5651D' : (s === 'unknown') ? '#9A9A9A' : '#C0392B';
const statusDot = (s: DeviceStatus | string) => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 4, background: statusColor(s), display: 'inline-block' }} />{codeLabel('admin.devices.status', String(s))}</span>;

function FleetTable({ devices }: { devices: FleetDevice[] }) {
  return (
    <div className="overflow-x-auto w-full"><table className="tbl w-full min-w-max">
      <thead><tr><th>{tx('pos.device')}</th><th>{tx('pos.type')}</th><th>{tx('pos.branch')}</th><th>{tx('pos.station')}</th><th>{tx('pos.status')}</th><th>{tx('pos.last_sync')}</th></tr></thead>
      <tbody>{devices.map((d) => (
        <tr key={d.id}>
          <td style={{ fontWeight: 700 }}>{d.name}</td>
          <td className="sub" style={{ fontSize: 12.5 }}>{typeLabel(d.type)}</td>
          <td>{d.branch}</td>
          <td>{d.station || <span style={{ color: 'var(--muted)' }}>{tx('pos.unassigned')}</span>}</td>
          <td>{statusDot(d.status)}</td>
          <td className="sub" style={{ fontSize: 12.5 }}>{d.lastSyncIso ? agoLabel(d.lastSyncIso) : (d.lastSyncLabel || '—')}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

export function POSDeviceFleetScreen({ view }: { view: DeviceView }) {
  const [o, setO] = useState<DevicesOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setO(await posDevicesApi.overview()); }
    catch (e: any) { setError(reportError(e, 'devices')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const cfg = TYPE_VIEWS[view];
  const filtered = useMemo(() => {
    if (!o) return [];
    if (!cfg) return o.fleet;
    return o.fleet.filter((d) => cfg.types.includes((d.type || '').toLowerCase()));
  }, [o, cfg]);

  if (loading) return <div className="work"><div className="state">{tx('pos.loading_devices')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!o) return <div className="work"><div className="state">{tx('pos.no_data')}</div></div>;

  if (cfg) {
    return (
      <div className="work">
        <div className="vh "><h1>{cfg.title}</h1><div className="sub mb-3">{filtered.length} {tx('pos.connected')}</div></div>
        <section className="panel mb-3" style={{ padding: 0, overflow: "hidden" }}>
          {filtered.length === 0 ? <div className="state" style={{ padding: 16 }}>{tx('admin.devices.noneConnected', { noun: cfg.noun })}</div> : <FleetTable devices={filtered} />}
        </section>
      </div>
    );
  }

  if (view === 'assignments') {
    const byBranch = new Map<string, FleetDevice[]>();
    o.fleet.forEach((d) => { const k = d.branch || '—'; byBranch.set(k, [...(byBranch.get(k) || []), d]); });
    return (
      <div className="work">
        <div className="vh "><h1>{tx('pos.device_assignments')}</h1><div className="sub mb-3">{tx('pos.which_device_is_where_and_on_1j50')}</div></div>
        {o.fleet.length === 0 ? <div className="state" style={{ marginTop: 12 }}>{tx('pos.no_devices_connected_yet')}</div> : [...byBranch.entries()].map(([branch, devices]) => (
          <section key={branch} className="panel mb-3" style={{ padding: 0, overflow: "hidden" }}>
            <div className="p-h" style={{ padding: '12px 14px 0' }}>{branch}</div>
            <FleetTable devices={devices} />
          </section>
        ))}
      </div>
    );
  }

  // health (default)
  const mix = o.charts?.statusMix || { online: 0, offline: 0, maintenance: 0 };
  return (
    <div className="work">
      <div className="vh "><h1>{tx('pos.device_health')}</h1><div className="sub mb-3">{tx('pos.fleet_status_across_your_locations')}</div></div>
      <div className="kpis">
        <div className="kpi"><div className="l">{tx('pos.connected_devices')}</div><div className="v">{o.kpis.connectedDevices}</div></div>
        <div className="kpi"><div className="l">{tx('pos.online')}</div><div className="v" style={{ color: '#2E9E54' }}>{o.kpis.onlineDevices}{o.kpis.onlinePct != null ? <span className="sub" style={{ fontSize: 13, fontWeight: 400 }}> · {o.kpis.onlinePct}%</span> : ''}</div></div>
        <div className="kpi"><div className="l">{tx('pos.payment_terminals')}</div><div className="v">{o.kpis.paymentTerminals}</div></div>
        <div className="kpi"><div className="l">{tx('pos.locations')}</div><div className="v">{o.kpis.locationsConnected}</div></div>
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5 }}><b style={{ color: '#2E9E54' }}>{mix.online}</b> {tx('pos.online_2')}</span>
        <span style={{ fontSize: 12.5 }}><b style={{ color: '#C0392B' }}>{mix.offline}</b> {tx('pos.offline')}</span>
        <span style={{ fontSize: 12.5 }}><b style={{ color: '#B5651D' }}>{mix.maintenance}</b> {tx('pos.maintenance')}</span>
      </div>
      <section className="panel mb-3" style={{ padding: 0, overflow: "hidden" }}>
        <div className="p-h" style={{ padding: '14px 14px 0' }}>{tx('pos.all_devices')}</div>
        {o.fleet.length === 0 ? <div className="state" style={{ padding: 16 }}>{tx('pos.no_devices_connected_yet')}</div> : <FleetTable devices={o.fleet} />}
      </section>
      <div className="sub" style={{ fontSize: 12, marginTop: 10 }}>{tx('pos.status_reflects_the_last_time_each_ia38')}</div>
    </div>
  );
}
