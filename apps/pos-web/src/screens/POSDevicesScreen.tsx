import { useEffect, useMemo, useState } from 'react';
import { useInlineConfirm } from '@aipowersalon/ui';
import { useNavigate } from 'react-router-dom';
import { posDevicesApi, type DevicesOverview, type DeviceStatus, type FleetDevice } from '../api/posDevicesApi';
import { posAiApi, type PosAiPackage } from '../api/posAiApi';
import { posSettingsApi } from '../api/posSettingsApi';
import { posDeploymentsApi, type DeploymentsState } from '../api/posDeploymentsApi';
import { posCustomerDisplaysApi, type PosStationView } from '../api/posCustomerDisplaysApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { codeLabel, agoLabel } from '../components/codeLabel';
import { serverText } from '../i18n/server-text';
import { useStepUp, isStepUpCancelled } from './access/accessUi';
import { statusLabel } from '../i18n/status-label';

// POSDevicesScreen.tsx — Devices & Integrations (salon tenant command center), matched to the reference layout.
// Wiring is honest end-to-end: the device fleet, payment terminals, KPI counts and the two real charts (Device Status
// Mix, Devices by Branch) come from GET /pos/devices/overview; the processor block reuses GET /pos/payment-gateway/status;
// AI / Communication rows reuse GET /tenant/ai/packages. Blocks with no canonical backend source yet (Integration
// Center registry, Deployment & Update telemetry, Connection/Sync alerts, Integration-Health + Sync-Success charts,
// and four of the KPIs) render honest "—"/empty states and link out — they NEVER show the reference's fixture numbers.

const COMM_CODES = ['ai_phone_call_assistant', 'ai_booking_assistant', 'ai_review_reputation_assistant', 'ai_voice_transcription', 'ai_reception_copilot'];
const headStyle: React.CSSProperties = { fontWeight: 800, fontSize: 13.5, fontFamily: 'var(--aps-font-head, Playfair Display)' };
const panel: React.CSSProperties = { background: '#FFFCF6', border: '1px solid var(--line)', borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column' };
const dash = '—';

function statusTone(s: DeviceStatus): { cls: string; color?: string } {
  if (s === 'online') return { cls: 'ok', color: '#3F8F6B' };
  if (s === 'maintenance' || s === 'reconnecting') return { cls: 'warn' };
  if (s === 'revoked') return { cls: '', color: 'var(--danger, #B4673B)' };
  return { cls: '' };
}
function aiStatus(p: PosAiPackage): { label: string; tone: string } {
  const st = p.subscription?.status;
  if (st === 'active' || (p.accessible && st !== 'trialing')) return { label: tx('pos.active_3'), tone: 'ok' };
  if (st === 'trialing') return { label: tx('pos.trial'), tone: 'warn' };
  if (p.trialAvailable) return { label: tx('pos.available'), tone: '' };
  return { label: p.lockLabel || tx('pos.not_connected_2'), tone: 'warn' };
}

function Donut({ segments, total, centerTop, centerBottom }: { segments: Array<{ value: number; color: string }>; total: number; centerTop: string; centerBottom: string }) {
  const r = 52, c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg viewBox="0 0 140 140" width="120" height="120" role="img">
      <circle cx="70" cy="70" r={r} fill="none" stroke="#EFE6D6" strokeWidth="16" />
      {total > 0 && segments.map((s, i) => {
        const frac = s.value / total;
        const len = frac * c;
        const el = <circle key={i} cx="70" cy="70" r={r} fill="none" stroke={s.color} strokeWidth="16" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 70 70)" />;
        offset += len;
        return el;
      })}
      <text x="70" y="66" textAnchor="middle" fontSize="20" fontWeight="800" fill="var(--text)">{centerTop}</text>
      <text x="70" y="84" textAnchor="middle" fontSize="10" fill="#8A7A66">{centerBottom}</text>
    </svg>
  );
}

export function POSDevicesScreen() {
  const nav = useNavigate();
  const [ov, setOv] = useState<DevicesOverview | null>(null);
  const [ovErr, setOvErr] = useState(false);
  const [pkgs, setPkgs] = useState<PosAiPackage[] | null>(null);
  const [gw, setGw] = useState<Record<string, unknown> | null>(null);
  const [dep, setDep] = useState<DeploymentsState | null>(null);
  const [registers, setRegisters] = useState<PosStationView[]>([]);   // this location's registers — a terminal is tied to one (Oct 6 2026)

  useEffect(() => {
    posDevicesApi.overview().then((d) => setOv(d)).catch(() => setOvErr(true));
    posAiApi.packages().then((d) => setPkgs(d?.packages || [])).catch(() => setPkgs([]));
    (posSettingsApi.gatewayStatus() as Promise<unknown>).then((r) => setGw(r && typeof r === 'object' ? (r as Record<string, unknown>) : {})).catch(() => setGw({}));
    posDeploymentsApi.state().then((d) => setDep(d)).catch(() => setDep(null));
    posCustomerDisplaysApi.state().then((d) => setRegisters(d?.stations ?? [])).catch(() => setRegisters([]));
  }, []);

  const k = ov?.kpis;
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [pairOpen, setPairOpen] = useState(false);
  const [pf, setPf] = useState({ code: '', label: '', station: '', hsn: '' });
  const reloadOverview = () => posDevicesApi.overview().then(setOv).catch(() => setOvErr(true));
  const reloadDep = () => posDeploymentsApi.state().then(setDep).catch(() => {});
  const startUpdate = (id: string, component: string) => askConfirm(tx('admin.devices.confirm.rollout', { component }), () => { void doStartUpdate(id, component); }, { confirmLabel: tx('pos.start_rollout'), destructive: false });
  const doStartUpdate = async (id: string, component: string) => {
    setBusy('dep' + id); setMsg(null);
    try { await posDeploymentsApi.advance(id, 'start'); setMsg({ tone: 'ok', text: tx('pos.component_rollout_started', { component: String(component) }) }); reloadDep(); }
    catch (e: any) { setMsg({ tone: 'err', text: e?.message || tx('pos.update_failed') }); } finally { setBusy(null); }
  };
  const { confirm: askConfirm, confirmUi } = useInlineConfirm();
  // Security Deep Scan C7: terminal pair / unpair / register are step-up routes (password prompt → one retry; Cancel → no error)
  const stepUp = useStepUp(tx('pos.stepup_terminals_needs_password'));

  // a customer display's real check: ask it to refresh — the answer says whether it is connected to hear it (§82)
  const refreshDevice = async (id: string, name: string) => {
    setBusy('td' + id); setMsg(null);
    try { const r = await posDevicesApi.refreshDevice(id); setMsg(r.online ? { tone: 'ok', text: tx('pos.name_is_connected_and_refreshing', { name: String(name) }) } : { tone: 'warn', text: tx('pos.name_is_offline_it_loads_fresh_1eyo', { name: String(name) }) }); }
    catch (e: any) { setMsg({ tone: 'err', text: e?.message || tx('pos.refresh_failed') }); } finally { setBusy(null); }
  };
  const revokeDevice = (id: string, name: string) => askConfirm(tx('admin.devices.confirm.revoke', { name }), () => { void doRevokeDevice(id, name); }, { confirmLabel: tx('pos.revoke_access') });
  const doRevokeDevice = async (id: string, name: string) => {
    setBusy('rd' + id); setMsg(null);
    try { await posDevicesApi.revokeDevice(id); setMsg({ tone: 'ok', text: tx('pos.name_access_revoked', { name: String(name) }) }); reloadOverview(); }
    catch (e: any) { setMsg({ tone: 'err', text: e?.message || tx('pos.revoke_failed') }); } finally { setBusy(null); }
  };
  // a customer display pairs itself: it shows a code, the owner enters it in Devices → Customer Displays (§8–§12)
  const addDeviceCode = () => nav('/tenant/devices/customer-displays');
  const testTerminal = async (id: string, label: string) => {
    setBusy('tt' + id); setMsg(null);
    try { const r: any = await posDevicesApi.testTerminal(id); setMsg({ tone: r?.reachable ? 'ok' : 'warn', text: `${label}: ${r?.detail ? serverText(r.detail) : r?.reachable ? tx('admin.devices.reachable') : tx('pos.not_reachable')}` }); }
    catch (e: any) { setMsg({ tone: 'err', text: e?.message || tx('pos.terminal_test_failed') }); } finally { setBusy(null); }
  };
  const unpairTerminal = (id: string, label: string) => askConfirm(tx('admin.devices.confirm.unpair', { label }), () => { void doUnpairTerminal(id, label); }, { confirmLabel: tx('pos.unpair_terminal') });
  const doUnpairTerminal = async (id: string, label: string) => {
    setBusy('ut' + id); setMsg(null);
    try { await stepUp.run(() => posDevicesApi.unpairTerminal(id)); setMsg({ tone: 'ok', text: tx('pos.label_unpaired', { label: String(label) }) }); reloadOverview(); }
    catch (e: any) { if (!isStepUpCancelled(e)) setMsg({ tone: 'err', text: e?.message || tx('pos.unpair_failed') }); } finally { setBusy(null); }
  };
  const setTerminalRegister = async (id: string, label: string, stationId: string) => {
    setBusy('tr' + id); setMsg(null);
    try { const t = await stepUp.run(() => posDevicesApi.setTerminalRegister(id, stationId || null)); setMsg({ tone: 'ok', text: t?.registerName ? tx('pos.label_now_serves_registername', { label: String(label), registerName: String(t.registerName) }) : tx('pos.label_serves_no_register', { label: String(label) }) }); reloadOverview(); }
    catch (e: any) { if (!isStepUpCancelled(e)) setMsg({ tone: 'err', text: e?.message || tx('pos.could_not_change_the_register') }); } finally { setBusy(null); }
  };
  const submitPair = async () => {
    if (!/^\d{6}$/.test(pf.code.trim())) { setMsg({ tone: 'warn', text: tx('pos.pairing_code_must_be_6_digits') }); return; }
    setBusy('pair'); setMsg(null);
    try { await stepUp.run(() => posDevicesApi.pairTerminal({ code: pf.code.trim(), label: pf.label.trim() || tx('admin.devices.defaultStation'), stationId: pf.station.trim() || undefined, hsn: pf.hsn.trim() || undefined })); setMsg({ tone: 'ok', text: tx('pos.terminal_paired') }); setPairOpen(false); setPf({ code: '', label: '', station: '', hsn: '' }); reloadOverview(); }
    catch (e: any) { if (!isStepUpCancelled(e)) setMsg({ tone: 'err', text: e?.message || tx('pos.pair_failed') }); } finally { setBusy(null); }
  };
  const fieldStyle: React.CSSProperties = { height: 30, border: '1px solid var(--line)', borderRadius: 8, padding: '0 8px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 12, color: 'var(--text)' };
  const isNetworkType = (type: string) => /router|network|switch|firewall|access point|modem/i.test(type);
  const gwStatus = typeof gw?.status === 'string' ? (gw.status as string) : undefined;
  const gwConnected = gwStatus === 'active' || gw?.configured === true;
  const processorName = (typeof gw?.processorType === 'string' && gw.processorType) || tx('pos.payment_processor');
  const merchantMasked = typeof gw?.merchantIdMasked === 'string' ? (gw.merchantIdMasked as string) : dash;

  const comm = (pkgs || []).filter((p) => COMM_CODES.includes(p.code));
  const aiActive = (pkgs || []).filter((p) => p.subscription?.status === 'active' || (p.accessible && p.subscription?.status !== 'trialing')).length;

  const mix = ov?.charts.statusMix;
  const byBranch = useMemo(() => ov?.charts.devicesByBranch || [], [ov]);
  const branchMax = useMemo(() => Math.max(1, ...byBranch.map((b) => b.count)), [byBranch]);

  const kpis: Array<{ l: string; v: string; sub?: string; tone?: string; route: string }> = [
    { l: tx('pos.connected_devices'), v: k ? String(k.connectedDevices) : dash, sub: 'registered', route: '/tenant/devices/health' },
    { l: tx('pos.online_devices'), v: k ? String(k.onlineDevices) : dash, sub: k?.onlinePct != null ? tx('pos.onlinepct_online', { onlinePct: String(k.onlinePct) }) : tx('pos.live_heartbeat'), tone: 'ok', route: '/tenant/devices/health' },
    { l: tx('pos.payment_terminals'), v: k ? String(k.paymentTerminals) : dash, sub: k ? (k.terminalsAllConnected ? tx('pos.all_connected') : tx('pos.check_status')) : '', route: '/tenant/devices/payment-terminals' },
    { l: tx('pos.integration_health'), v: k?.integrationHealthPct != null ? `${k.integrationHealthPct}%` : dash, sub: k?.integrationHealthPct != null ? 'stable' : tx('pos.no_registry_yet'), route: '/tenant/integrations/apps' },
    { l: tx('pos.api_calls_today'), v: k?.apiCallsToday != null ? k.apiCallsToday.toLocaleString() : dash, sub: k?.apiCallsToday != null ? 'metered' : tx('pos.no_metering_yet'), route: '/tenant/integrations/apps' },
    { l: tx('pos.sync_success_rate'), v: k?.syncSuccessRate != null ? `${k.syncSuccessRate}%` : dash, sub: k?.syncSuccessRate != null ? tx('pos.last_24h') : tx('pos.no_sync_log_yet'), route: '/tenant/devices/health' },
    { l: tx('pos.pending_updates'), v: dep ? String(dep.summary.pending) : (k?.pendingUpdates != null ? String(k.pendingUpdates) : dash), sub: dep ? (dep.summary.pending ? tx('pos.view_updates') : tx('pos.up_to_date')) : (k?.pendingUpdates != null ? tx('pos.view_details_2') : tx('pos.no_update_feed_yet')), tone: dep && dep.summary.pending ? 'coral' : undefined, route: '/tenant/devices/assignments' },
    { l: tx('pos.locations_connected'), v: k ? String(k.locationsConnected) : dash, sub: tx('pos.all_branches'), tone: 'purple', route: '/tenant/management/locations' },
  ];

  const quickActions: Array<[string, () => void]> = [
    [tx('admin.devices.qa.addDevice'), addDeviceCode],
    [tx('admin.devices.qa.pairTerminal'), () => setPairOpen(true)],
    [tx('admin.devices.qa.configureKiosk'), () => nav('/tenant/devices/check-in-kiosk')],
    [tx('admin.devices.qa.manageIntegrations'), () => nav('/tenant/integrations/api-webhooks')],
    [tx('admin.devices.qa.pushUpdate'), () => nav('/tenant/devices/assignments')],
    [tx('admin.devices.qa.testSync'), () => nav('/tenant/devices/health')],
    [tx('admin.devices.qa.viewLogs'), () => nav('/tenant/devices/logs')],
    [tx('admin.devices.qa.networkTest'), () => nav('/tenant/devices/health')],
    [tx('admin.devices.qa.exportReport'), () => nav('/reports')],
  ];

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {confirmUi}{stepUp.prompt}
      <div className="vh "><h1>{tx('pos.devices_integrations')}</h1><div className="sub mb-3">{tx('pos.manage_salon_hardware_payment_devices_kiosks_1e9a')}</div></div>

      {ovErr ? <div className="err">{tx('pos.couldn_t_load_the_device_overview')}{' '}<button className="btn ghost whitespace-nowrap w-fit" style={{ padding: '2px 8px', marginLeft: 6 }} onClick={() => { setOvErr(false); posDevicesApi.overview().then(setOv).catch(() => setOvErr(true)); }}>{tx('pos.retry')}</button></div> : null}

      {msg ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, fontSize: 12.5, border: '1px solid var(--line)', background: msg.tone === 'err' ? '#FBEDE7' : msg.tone === 'warn' ? '#FBF4E2' : '#EAF5EE', color: msg.tone === 'err' ? '#B4673B' : 'var(--text)' }}>
          <span style={{ flex: 1 }}>{msg.text}</span>
          <button className="btn ghost whitespace-nowrap w-fit" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setMsg(null)}>{tx('pos.dismiss')}</button>
        </div>
      ) : null}

      <div className="kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        {kpis.map((c) => (
          <div className="kpi" key={c.l} style={{ cursor: 'pointer' }} onClick={() => nav(c.route)}>
            <div className="l">{c.l}</div>
            <div className="v" style={c.v === dash ? { color: '#8A7A66' } : c.tone === 'ok' ? { color: '#3F8F6B' } : c.tone === 'purple' ? { color: '#7A5AA8' } : c.tone === 'coral' ? { color: '#C2603A' } : undefined}>{c.v}</div>
            {c.sub ? <div className="s" style={{ color: '#8A7A66', marginTop: 2 }}>{c.sub}</div> : null}
          </div>
        ))}
      </div>

      {/* Row 1: Device Fleet · Payment & POS Hardware · Integration Center */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mb-3">
        <section style={panel}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}><span style={headStyle}>{tx('pos.device_fleet_overview')}</span>{ov ? <span className="pill">{ov.fleet.length} {tx('pos.devices')}</span> : null}</div>
          {!ov && !ovErr ? <div className="state">{tx('pos.loading_devices')}</div> : ov && ov.fleet.length === 0 ? (
            <div className="muted">{tx('pos.no_devices_registered_yet_pair_a_1ma0')}</div>
          ) : (
            <div className="overflow-x-auto w-full">
              <div className="list w-full min-w-max" style={{ maxHeight: 280 }}>
                <div className="row" style={{ fontSize: 10.5, color: '#8A7A66', fontWeight: 700, textTransform: 'uppercase' }}>
                <div style={{ flex: 1, minWidth: 140 }}>{tx('pos.device')}</div><div style={{ width: 120 }}>{tx('pos.type')}</div><div style={{ width: 120 }}>{tx('pos.branch')}</div><div style={{ width: 80 }}>{tx('pos.status')}</div><div style={{ width: 78 }}>{tx('pos.last_sync')}</div><div style={{ width: 110 }}>{tx('pos.station')}</div><div style={{ width: 116 }}>{tx('pos.actions')}</div>
              </div>
              {(ov?.fleet || []).map((d: FleetDevice) => {
                const t = statusTone(d.status);
                return (
                  <div className="row" key={d.id}>
                    <div className="t" style={{ flex: 1, minWidth: 140 }}>{d.name}</div>
                    <div className="s" style={{ width: 120 }}>{codeLabel('admin.devices.type', d.type)}</div>
                    <div className="s" style={{ width: 120 }}>{d.branch}</div>
                    <div style={{ width: 80 }}><span className={'pill ' + t.cls} style={t.color ? { color: t.color } : undefined}>{codeLabel('admin.devices.status', d.status)}</span></div>
                    <div className="s" style={{ width: 78 }}>{d.lastSyncIso ? agoLabel(d.lastSyncIso) : '—'}</div>
                    <div className="s" style={{ width: 110 }}>{d.station || dash}</div>
                    <div style={{ width: 116, display: 'flex', gap: 4 }}>
                      {d.status !== 'revoked' ? <button className="btn ghost whitespace-nowrap w-fit" style={{ padding: '2px 6px', fontSize: 11 }} disabled={busy === 'td' + d.id} onClick={() => refreshDevice(d.id, d.name)}>{busy === 'td' + d.id ? '…' : tx('pos.refresh')}</button> : null}
                      {!isNetworkType(d.type) && d.status !== 'revoked' ? <button className="btn ghost whitespace-nowrap w-fit" style={{ padding: '2px 6px', fontSize: 11 }} disabled={busy === 'rd' + d.id} onClick={() => revokeDevice(d.id, d.name)}>{busy === 'rd' + d.id ? '…' : tx('pos.revoke')}</button> : null}
                    </div>
                  </div>
                );
              })}
              </div>
            </div>
          )}
          <button className="btn ghost whitespace-nowrap w-fit" style={{ alignSelf: 'center', marginTop: 8 }} onClick={() => nav('/tenant/devices/health')}>{tx('pos.view_all_devices')}</button>
        </section>

        <section style={panel}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}><span style={headStyle}>{tx('pos.payment_pos_hardware')}</span><span className={'pill ' + (gwConnected ? 'ok' : '')} style={{ marginLeft: 'auto' }}>{gwConnected ? tx('pos.healthy') : gwStatus ? statusLabel('gateway', gwStatus) : tx('admin.devices.check')}</span></div>
          <div className="list">
            <div className="row"><div className="t" style={{ flex: 1 }}>{processorName}</div><span className={'pill ' + (gwConnected ? 'ok' : 'warn')}>{gwConnected ? tx('pos.connected_2') : gwStatus ? statusLabel('gateway', gwStatus) : tx('admin.devices.setup')}</span></div>
            <div className="row"><span className="muted" style={{ flex: 1 }}>{tx('pos.merchant_id')}</span><span>{merchantMasked}</span></div>
            <div className="row"><span className="muted" style={{ flex: 1 }}>{tx('pos.nfc_tap_to_pay')}</span><span>{dash}</span></div>
            <div className="row"><span className="muted" style={{ flex: 1 }}>{tx('pos.settlement_sync')}</span><span>{dash}</span></div>
          </div>
          <div className="s" style={{ fontWeight: 700, margin: '10px 0 4px' }}>{tx('pos.paired_terminals')}{' '}<span style={{ color: '#8A7A66' }}>· {ov?.terminals.length ?? 0}</span></div>
          {ov && ov.terminals.length > 0 ? (
            <div className="overflow-x-auto w-full">
              <div className="list w-full min-w-max" style={{ maxHeight: 150 }}>
                {ov.terminals.map((t) => (<div className="row" key={t.id}><div className="t" style={{ flex: 1 }}>{t.label}</div><select aria-label={tx('pos.register_for_label', { label: String(t.label) })} disabled={busy === 'tr' + t.id} value={registers.find((r) => r.name === t.station)?.id ?? ''} onChange={(e) => setTerminalRegister(t.id, t.label, e.target.value)} style={{ ...fieldStyle, height: 24, marginRight: 8 }}><option value="">{t.station && !registers.some((r) => r.name === t.station) ? tx('pos.station_not_a_register', { station: String(t.station) }) : tx('pos.no_register')}</option>{registers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select><span className={'pill ' + (t.operationalStatus === 'ONLINE' ? 'ok' : '')} title={t.operationalStatus}>{t.operationalLabel ?? ((t.status || '').toLowerCase() === 'paired' ? tx('pos.not_tested_yet') : t.status)}</span><span style={{ display: 'flex', gap: 4, marginLeft: 8 }}><button className="btn ghost whitespace-nowrap w-fit" style={{ padding: '2px 6px', fontSize: 11 }} disabled={busy === 'tt' + t.id} onClick={() => testTerminal(t.id, t.label)}>{busy === 'tt' + t.id ? '…' : tx('pos.test_2')}</button><button className="btn ghost whitespace-nowrap w-fit" style={{ padding: '2px 6px', fontSize: 11 }} disabled={busy === 'ut' + t.id} onClick={() => unpairTerminal(t.id, t.label)}>{busy === 'ut' + t.id ? '…' : tx('pos.unpair')}</button></span></div>))}
              </div>
            </div>
          ) : <div className="muted">{tx('pos.no_terminals_paired')}</div>}
          {pairOpen ? (
            <div style={{ marginTop: 8, padding: 8, border: '1px dashed var(--line)', borderRadius: 10 }}>
              <div className="s" style={{ fontWeight: 700, marginBottom: 6 }}>{tx('pos.pair_a_terminal')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <input value={pf.code} onChange={(e) => setPf({ ...pf, code: e.target.value })} placeholder={tx('pos.6_digit_code')} inputMode="numeric" style={fieldStyle} />
                <input value={pf.label} onChange={(e) => setPf({ ...pf, label: e.target.value })} placeholder={tx('pos.label')} style={fieldStyle} />
                <select aria-label={tx('pos.register')} value={pf.station} onChange={(e) => setPf({ ...pf, station: e.target.value })} style={fieldStyle}>
                  <option value="">{tx('pos.no_register')}</option>
                  {registers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <input value={pf.hsn} onChange={(e) => setPf({ ...pf, hsn: e.target.value })} placeholder={tx('pos.terminal_hsn_cardpointe_device_serial_optional_19fy')} style={fieldStyle} />
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button className="btn" disabled={busy === 'pair'} onClick={submitPair}>{busy === 'pair' ? tx('pos.pairing_2') : tx('pos.pair')}</button>
                <button className="btn ghost whitespace-nowrap w-fit" onClick={() => { setPairOpen(false); setPf({ code: '', label: '', station: '', hsn: '' }); }}>{tx('pos.cancel')}</button>
              </div>
            </div>
          ) : null}
          <button className="btn ghost whitespace-nowrap w-fit" style={{ alignSelf: 'center', marginTop: 8 }} onClick={() => nav('/tenant/devices/payment-terminals')}>{tx('pos.manage_payment_hardware')}</button>
        </section>

        <section style={panel}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}><span style={headStyle}>{tx('pos.integration_center')}</span><button className="btn ghost whitespace-nowrap w-fit" style={{ marginLeft: 'auto', padding: '3px 9px', fontSize: 11.5 }} onClick={() => nav('/tenant/integrations/api-webhooks')}>{tx('pos.manage_all')}</button></div>
          <div className="list">
            <div className="row"><div className="t" style={{ flex: 1 }}>{tx('pos.payment_gateway_fiserv_clover')}</div><span className={'pill ' + (gwConnected ? 'ok' : 'warn')}>{gwConnected ? tx('pos.connected_2') : gwStatus ? statusLabel('gateway', gwStatus) : tx('admin.devices.check')}</span></div>
            <div className="row"><div className="t" style={{ flex: 1 }}>{tx('pos.ai_assistants')}</div><span className="pill ok">{pkgs ? tx('pos.aiactive_active', { aiActive: String(aiActive) }) : dash}</span></div>
            <div className="row"><div className="t" style={{ flex: 1 }}>{tx('pos.booking_sync')}</div><span className="pill ok">{tx('pos.connected_2')}</span></div>
          </div>
          <div className="s" style={{ color: '#8A7A66', marginTop: 8 }}>{tx('pos.a_full_connector_registry_twilio_sendgrid_1ixc')}{' '}<span style={{ color: 'var(--danger, #B4673B)' }}>{tx('pos.not_connected')}</span></div>
        </section>
      </div>

      {/* Row 2: AI/Comm · Deployment · Connection/Sync Insights */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mb-3">
        <section style={panel}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}><span style={headStyle}>{tx('pos.ai_communication_integrations')}</span><span className="s" style={{ marginLeft: 'auto', color: '#8A7A66' }}>{comm.length}</span></div>
          {!pkgs ? <div className="state">{tx('pos.loading')}</div> : comm.length === 0 ? <div className="muted">{tx('pos.no_ai_communication_assistants_available')}</div> : (
            <div className="list">
              {comm.map((p) => { const st = aiStatus(p); return (
                <div className="row" key={p.code}><div className="t" style={{ flex: 1 }}>{p.name}</div><span className={'pill ' + st.tone} style={{ marginRight: 8 }}>{st.label}</span><button className="btn ghost whitespace-nowrap w-fit" style={{ padding: '3px 9px', fontSize: 11.5 }} onClick={() => nav('/tenant/ai/command-center')}>{tx('pos.manage')}</button></div>
              ); })}
            </div>
          )}
          <button className="btn ghost whitespace-nowrap w-fit" style={{ alignSelf: 'center', marginTop: 8 }} onClick={() => nav('/tenant/ai/command-center')}>{tx('pos.configure_ai_communication')}</button>
        </section>

        <section style={panel}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}><span style={headStyle}>{tx('pos.deployment_update_control')}</span>{dep && dep.summary.pending ? <span className="pill warn" style={{ marginLeft: 8 }}>{dep.summary.pending} {tx('pos.pending')}</span> : null}</div>
          {!dep ? <div className="state">{tx('pos.loading')}</div> : dep.deployments.length === 0 ? <div className="muted">{tx('pos.no_components_tracked_yet')}</div> : (
            <div className="overflow-x-auto w-full">
              <div className="list w-full min-w-max" style={{ maxHeight: 200 }}>
                {dep.deployments.map((d) => (
                <div className="row" key={d.id}>
                  <div style={{ flex: 1, minWidth: 120 }}><div className="t">{d.component}</div><div className="s">{(d.installedVersion || '—')} → {(d.latestVersion || '—')}{d.targetCount ? tx('pos.targetcount_device_plural', { targetCount: String(d.targetCount), plural: String(d.targetCount === 1 ? '' : 's') }) : ''}</div></div>
                  {d.updateAvailable && (d.status === 'available' || d.status === 'scheduled' || d.status === 'deferred')
                    ? <button className="btn ghost whitespace-nowrap w-fit" style={{ padding: '2px 8px', fontSize: 11 }} disabled={busy === 'dep' + d.id} onClick={() => startUpdate(d.id, d.component)}>{busy === 'dep' + d.id ? '…' : tx('pos.update')}</button>
                    : <span className={'pill ' + (d.status === 'up_to_date' || d.status === 'completed' ? 'ok' : d.status === 'in_progress' || d.status === 'scheduled' ? 'warn' : '')}>{d.status === 'up_to_date' ? tx('pos.up_to_date') : statusLabel('deviceUpdate', d.status)}</span>}
                </div>
              ))}
              </div>
            </div>
          )}
          <button className="btn ghost whitespace-nowrap w-fit" style={{ alignSelf: 'center', marginTop: 'auto' }} onClick={() => nav('/tenant/devices/assignments')}>{tx('pos.manage_updates_rollouts')}</button>
        </section>

        <section style={panel}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}><span style={headStyle}>{tx('pos.connection_sync_insights')}</span></div>
          <div className="muted">{tx('pos.per_device_wi_fi_firmware_re_1cik')}{' '}<span style={{ color: 'var(--danger, #B4673B)' }}>{tx('pos.not_connected')}</span></div>
          <button className="btn ghost whitespace-nowrap w-fit" style={{ alignSelf: 'center', marginTop: 'auto' }} onClick={() => nav('/tenant/devices/logs')}>{tx('pos.view_all_insights')}</button>
        </section>
      </div>

      {/* Row 3: charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-3">
        <section style={panel}>
          <div style={headStyle}>{tx('pos.device_status_mix')}</div>
          <div className="s" style={{ color: '#8A7A66', marginBottom: 6 }}>{ov ? tx('pos.length_total_devices', { length: String(ov.fleet.length) }) : dash}</div>
          {mix ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Donut total={mix.online + mix.offline + mix.maintenance} centerTop={String(mix.online + mix.offline + mix.maintenance)} centerBottom="devices" segments={[{ value: mix.online, color: '#3F8F6B' }, { value: mix.offline, color: '#C9971B' }, { value: mix.maintenance, color: '#7A5AA8' }]} />
              <div className="list" style={{ flex: 1 }}>
                <div className="row"><span style={{ flex: 1 }}>{tx('pos.online_3')}</span><span>{mix.online}</span></div>
                <div className="row"><span style={{ flex: 1 }}>{tx('pos.offline_2')}</span><span>{mix.offline}</span></div>
                <div className="row"><span style={{ flex: 1 }}>{tx('pos.maintenance_2')}</span><span>{mix.maintenance}</span></div>
              </div>
            </div>
          ) : <div className="state">{tx('pos.loading')}</div>}
        </section>

        <section style={panel}>
          <div style={headStyle}>{tx('pos.integration_health')}</div>
          <div className="muted" style={{ marginTop: 6 }}>{tx('pos.needs_a_connector_registry')}{' '}<span style={{ color: 'var(--danger, #B4673B)' }}>{dash}</span></div>
        </section>

        <section style={panel}>
          <div style={headStyle}>{tx('pos.sync_success_rate_7_days')}</div>
          <div className="muted" style={{ marginTop: 6 }}>{tx('pos.no_sync_operation_log_yet')}{' '}<span style={{ color: 'var(--danger, #B4673B)' }}>{dash}</span></div>
        </section>

        <section style={panel}>
          <div style={headStyle}>{tx('pos.devices_by_branch')}</div>
          <div className="s" style={{ color: '#8A7A66', marginBottom: 6 }}>{ov ? tx('pos.length_total', { length: String(ov.fleet.length) }) : dash}</div>
          {byBranch.length === 0 ? <div className="muted">{tx('pos.no_devices_yet')}</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {byBranch.map((b) => (
                <div key={b.branchId || b.branch} style={{ cursor: 'pointer' }} onClick={() => nav('/tenant/devices/health')}>
                  <div className="s" style={{ display: 'flex', justifyContent: 'space-between' }}><span>{b.branch}</span><span style={{ fontWeight: 700 }}>{b.count}</span></div>
                  <div style={{ height: 8, background: '#EFE6D6', borderRadius: 5, overflow: 'hidden' }}><div style={{ width: `${(b.count / branchMax) * 100}%`, height: '100%', background: '#C9971B' }} /></div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section style={panel}>
        <div style={{ ...headStyle, marginBottom: 8 }}>{tx('pos.quick_actions_2')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {quickActions.map(([label, fn]) => <button key={label} className="btn ghost whitespace-nowrap w-fit" onClick={fn}>{label}</button>)}
        </div>
      </section>
    </div>
  );
}
