// CheckInDevicesScreen.tsx — Super Admin → Check-In Devices. Ports the standalone go-check-in-admin app into admin-web so
// kiosks are managed in the same console as everything else. Per-tenant: master enable, device list + lifecycle
// (activate / deactivate / regenerate token / disable), create device (token shown ONCE), feature toggles, recent logs.
// Wired to checkInDevicesApi (real SuperAdminGuard routes). Cream/gold tokens; Mac-fit; shared classes + light inline CSS.
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import { superAdminApi } from '../api/superAdminApi';
import { checkInDevicesApi, type GoCheckInDevicesState, type GoCheckInDeviceView, type GoCheckInDeviceStatus, type CheckInLog, type CreatedDevice } from '../api/checkInDevicesApi';

type TenantLite = { id: string; name?: string; displayName?: string; salonName?: string; tenantName?: string; salonCode?: string; branches?: { id: string; name: string }[] };
const tenantLabel = (t: TenantLite) => t.name || t.displayName || t.salonName || t.tenantName || t.salonCode || t.id;

const DEVICE_TYPES = ['ipad_display', 'tablet_kiosk', 'browser_kiosk', 'front_desk_shared', 'qr_code'];
const label = (s: string) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
const statusBadge = (s: string): { bg: string; fg: string } => {
  const v = (s || '').toLowerCase();
  if (v === 'active') return { bg: '#EAF5EE', fg: '#3E8F57' };
  if (v === 'inactive') return { bg: '#FFF6E5', fg: '#D09A36' };
  if (v === 'expired') return { bg: '#FBF0E5', fg: '#C77A2A' };
  return { bg: '#FBEFE9', fg: '#B85B4D' }; // disabled / revoked
};
const timeAgo = (iso: string | null): string => {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms)) return '—';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};
// Pairing-token expiry, relative + a warn flag (expired, or within 7 days).
const expiryLabel = (iso: string | null): { t: string; warn: boolean } => {
  if (!iso) return { t: 'Never', warn: false };
  const ms = new Date(iso).getTime() - Date.now();
  if (!isFinite(ms)) return { t: '—', warn: false };
  if (ms <= 0) return { t: 'Expired', warn: true };
  const d = Math.floor(ms / 86400000);
  if (d < 1) return { t: `in ${Math.max(1, Math.floor(ms / 3600000))}h`, warn: true };
  return { t: `in ${d}d`, warn: d <= 7 };
};
const copy = (text: string) => { try { (navigator as any)?.clipboard?.writeText?.(text); } catch { /* clipboard unavailable */ } };

// The feature toggles, in display order (label → settings key). The master `enabled` is handled separately above.
const TOGGLES: { key: keyof GoCheckInDevicesState['settings']; label: string; hint?: string }[] = [
  { key: 'appointmentCheckinEnabled', label: 'Appointment check-in' },
  { key: 'walkinCheckinEnabled', label: 'Walk-in check-in' },
  { key: 'newCustomerEnabled', label: 'New customer creation' },
  { key: 'serviceSelectionEnabled', label: 'Service selection' },
  { key: 'technicianPreferenceEnabled', label: 'Technician preference' },
  { key: 'tenantPhoneLookupEnabled', label: 'Tenant phone lookup' },
  { key: 'centralLookupEnabled', label: 'Central (cross-tenant) lookup' },
  { key: 'customerLinkingEnabled', label: 'Customer linking' },
  { key: 'showWaitEstimate', label: 'Show wait estimate' },
  { key: 'autoSendToQueue', label: 'Auto-send to queue' },
  { key: 'requireFrontDeskApproval', label: 'Require front-desk approval' },
];

function Toggle({ on, busy, onClick }: { on: boolean; busy: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={busy} aria-pressed={on} role="switch" style={{
      width: 44, height: 24, borderRadius: 999, border: '1px solid var(--line)', cursor: busy ? 'default' : 'pointer',
      background: on ? 'var(--ok)' : '#E7E1D6', position: 'relative', transition: 'background .15s', flex: '0 0 auto', opacity: busy ? 0.6 : 1,
    }}>
      <span style={{ position: 'absolute', top: 2, left: on ? 22 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .15s', boxShadow: '0 1px 2px rgba(0,0,0,.2)' }} />
    </button>
  );
}

export function CheckInDevicesScreen() {
  const [params, setParams] = useSearchParams();
  const tenantId = params.get('tenantId') || '';
  const [tenants, setTenants] = useState<TenantLite[] | null>(null);
  const [tenantsErr, setTenantsErr] = useState(false);
  const [state, setState] = useState<GoCheckInDevicesState | null>(null);
  const [logs, setLogs] = useState<CheckInLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedDevice | null>(null);          // one-time token reveal
  const [revealed, setRevealed] = useState<{ deviceId: string; token: string } | null>(null); // regenerated token reveal
  const [form, setForm] = useState({ deviceName: '', deviceType: 'ipad_display', branchId: '', baseUrl: '', allowedBranchIds: [] as string[] });
  const [branchEditId, setBranchEditId] = useState<string | null>(null);                         // device whose branches are being edited
  const [branchEdit, setBranchEdit] = useState<{ branchId: string; allowedBranchIds: string[] }>({ branchId: '', allowedBranchIds: [] });

  // Tenant list for the picker (reuses the Super Admin tenants state endpoint).
  useEffect(() => {
    (superAdminApi.state() as Promise<{ tenants: TenantLite[] }>)
      .then((r) => { setTenants(r.tenants || []); setTenantsErr(false); })
      .catch(() => setTenantsErr(true));
  }, []);

  const selectedTenant = useMemo(() => tenants?.find((t) => t.id === tenantId) || null, [tenants, tenantId]);
  const branches = selectedTenant?.branches || [];

  const load = useCallback(() => {
    if (!tenantId) { setState(null); setLogs([]); return; }
    setLoading(true); setErr(null);
    Promise.all([checkInDevicesApi.state(tenantId), checkInDevicesApi.logs(tenantId, 50)])
      .then(([s, l]) => { setState(s); setLogs(l.logs || []); })
      .catch((e: any) => setErr(e?.message || 'Failed to load check-in devices.'))
      .finally(() => setLoading(false));
  }, [tenantId]);
  useEffect(() => { load(); setCreated(null); setRevealed(null); }, [load]);

  const pickTenant = (id: string) => { const p = new URLSearchParams(params); if (id) p.set('tenantId', id); else p.delete('tenantId'); setParams(p, { replace: true }); };

  // Run an action with busy/error handling; reload after.
  const act = async (key: string, fn: () => Promise<any>, ok?: string) => {
    setBusy(key); setErr(null); setNote(null);
    try { await fn(); if (ok) setNote(ok); load(); } catch (e: any) { setErr(e?.message || 'Action failed.'); } finally { setBusy(null); }
  };

  const setStatus = (d: GoCheckInDeviceView, status: GoCheckInDeviceStatus) =>
    act(d.deviceId + status, () => checkInDevicesApi.setStatus(tenantId, d.deviceId, status), `${d.deviceName} is now ${label(status)}.`);
  const disable = (d: GoCheckInDeviceView) => act(d.deviceId + 'disable', () => checkInDevicesApi.disableDevice(tenantId, d.deviceId), `${d.deviceName} disabled.`);
  const regenerate = async (d: GoCheckInDeviceView) => {
    setBusy(d.deviceId + 'regen'); setErr(null); setNote(null);
    try { const r = await checkInDevicesApi.regenerateToken(tenantId, d.deviceId); setRevealed({ deviceId: d.deviceId, token: r.deviceToken }); setNote(`New token issued for ${d.deviceName} — copy it now, it won't be shown again.`); load(); }
    catch (e: any) { setErr(e?.message || 'Could not regenerate the token.'); } finally { setBusy(null); }
  };
  const toggleSetting = (key: keyof GoCheckInDevicesState['settings']) => {
    if (!state) return;
    const next = !state.settings[key];
    setState({ ...state, settings: { ...state.settings, [key]: next } }); // optimistic
    act('set:' + key, () => checkInDevicesApi.updateSettings(tenantId, { [key]: next }));
  };
  const createDevice = async () => {
    if (!form.deviceName.trim()) { setErr('Device name is required.'); return; }
    setBusy('create'); setErr(null); setNote(null); setCreated(null);
    try {
      const r = await checkInDevicesApi.createDevice(tenantId, {
        deviceName: form.deviceName.trim(), deviceType: form.deviceType,
        branchId: form.branchId || null, baseUrl: form.baseUrl.trim() || undefined,
      });
      setCreated(r); setForm({ deviceName: '', deviceType: 'ipad_display', branchId: '', baseUrl: '', allowedBranchIds: [] });
      load();
    } catch (e: any) { setErr(e?.message || 'Could not create the device.'); } finally { setBusy(null); }
  };
  const branchName = (id: string | null) => (id ? (branches.find((b) => b.id === id)?.name || 'Branch') : '');
  const openBranchEditor = (d: GoCheckInDeviceView) => { setBranchEditId(d.deviceId); setBranchEdit({ branchId: d.branchId || '', allowedBranchIds: d.allowedBranchIds || [] }); };
  const saveBranches = (deviceId: string) =>
    act('branches:' + deviceId, () => checkInDevicesApi.setBranches(tenantId, deviceId, { branchId: branchEdit.branchId || null, allowedBranchIds: branchEdit.allowedBranchIds }).then(() => setBranchEditId(null)), 'Branches updated.');

  const devices = state?.devices || [];
  const activeCount = devices.filter((d) => d.status === 'active').length;

  return (
    <div className="work">
      <div className="flex flex-col md:flex-row justify-between gap-3 mb-3" >
        <div className="vh"><h1>Check-In Devices<span style={{ color: '#DCB056' }}>★</span></h1><div className="sub">The central security-management area.</div></div>

        <div className="flex flex-wrap gap-3 items-baseline">
          <select value={tenantId} onChange={(e) => pickTenant(e.target.value)} aria-label="Tenant" style={{ minWidth: 240, height: 36, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', fontFamily: 'inherit', background: '#FFFDF8' }}>
            <option value="">{tenantsErr ? 'Could not load tenants' : tenants ? 'Select a tenant…' : 'Loading tenants…'}</option>
            {(tenants || []).map((t) => <option key={t.id} value={t.id}>{tenantLabel(t)}</option>)}
          </select>
          {tenantId ? <button className="btn ghost !h-9 !min-h-9 flex items-center !rounded-lg" style={{ marginLeft: 'auto' }} onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button> : null}
        </div>
      </div>
     

      {note ? <div className="toast" style={{ background: '#EAF5EE', color: '#2F6B43', marginBottom: 10 }}>{note}</div> : null}
      {err ? <div className="toast" style={{ background: '#FBEFE9', color: '#9A4436', marginBottom: 10 }}>{err}</div> : null}

      {!tenantId ? (
        <div className="panel" style={{ padding: 20, color: 'var(--muted)' }}>Pick a tenant to manage its Go Check-In kiosks, feature toggles, and recent activity.</div>
      ) : loading && !state ? (
        <div className="panel" style={{ padding: 20, color: 'var(--muted)' }}>Loading check-in devices…</div>
      ) : state ? (
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-3.5 items-start">
          {/* LEFT: master state, devices, create */}
          <div style={{ display: 'grid', gap: 14 }}>
            {/* Master enable */}
            <div className="panel" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>Go Check-In is {state.settings.enabled ? 'ON' : 'OFF'} for {selectedTenant ? tenantLabel(selectedTenant) : 'this tenant'}</div>
                <div className="mut" style={{ fontSize: 12 }}>{state.settings.enabled ? 'Kiosks can run check-in sessions.' : 'All kiosks are paused until this is turned on.'}</div>
              </div>
              <span className="badge" style={{ background: state.settings.enabled ? '#EAF5EE' : '#EEF0F2', color: state.settings.enabled ? '#3E8F57' : '#6B7280' }}>{state.settings.enabled ? 'Enabled' : 'Disabled'}</span>
              <Toggle on={state.settings.enabled} busy={busy === 'set:enabled'} onClick={() => toggleSetting('enabled')} />
            </div>

            {/* One-time token reveal (create) */}
            {created ? (
              <div className="panel" style={{ padding: 14, border: '1px solid var(--ok)', background: '#F4FAF6' }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Device created — copy the token now (shown once)</div>
                <div className="dkv"><span>Pairing token</span><b style={{ fontFamily: 'monospace' }}>{created.deviceToken}</b></div>
                <div className="dkv"><span>Kiosk URL</span><b style={{ wordBreak: 'break-all' }}>{created.publicUrl || `…/go-check-in/${created.checkinSlug}`}</b></div>
                <div className="dkv"><span>Token expires</span><b>{created.tokenExpiresAt ? new Date(created.tokenExpiresAt).toLocaleDateString() : 'Never'}</b></div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="btn" onClick={() => copy(created.deviceToken)}>Copy token</button>
                  <button className="btn ghost" onClick={() => copy(created.publicUrl || created.checkinSlug)}>Copy URL</button>
                  <button className="btn ghost" onClick={() => setCreated(null)} style={{ marginLeft: 'auto' }}>Done</button>
                </div>
              </div>
            ) : null}

            {/* Devices */}
            <div className="panel" style={{ padding: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
                <div style={{ fontWeight: 700 }}>Devices</div>
                <div className="mut" style={{ marginLeft: 8, fontSize: 12 }}>{activeCount} active · {devices.length} total</div>
              </div>
              {devices.length === 0 ? (
                <div style={{ padding: 16, color: 'var(--muted)' }}>No devices yet. Add one below to generate a kiosk URL + pairing token.</div>
              ) : (
                <table className="ttable" style={{ width: '100%' }}>
                  <thead><tr><th>Device</th><th>Type</th><th>Branch</th><th>Status</th><th>Token</th><th>Last seen</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
                  <tbody>
                    {devices.map((d) => {
                      const sb = statusBadge(d.status);
                      const isRevealed = revealed?.deviceId === d.deviceId;
                      return (
                        <Fragment key={d.deviceId}>
                        <tr>
                          <td>
                            <div style={{ fontWeight: 600 }}>{d.deviceName}</div>
                            <div className="mut" style={{ fontSize: 11, wordBreak: 'break-all' }}>
                              {d.publicUrl || `…/go-check-in/${d.checkinSlug}`}{' '}
                              <button onClick={() => copy(d.publicUrl || d.checkinSlug)} style={{ border: 'none', background: 'none', color: 'var(--gold)', cursor: 'pointer', padding: 0, fontSize: 11 }}>copy</button>
                            </div>
                            {isRevealed ? <div style={{ fontSize: 11, marginTop: 3 }}>New token: <b style={{ fontFamily: 'monospace' }}>{revealed!.token}</b> <button onClick={() => copy(revealed!.token)} style={{ border: 'none', background: 'none', color: 'var(--gold)', cursor: 'pointer', padding: 0, fontSize: 11 }}>copy</button></div> : null}
                          </td>
                          <td>{label(d.deviceType)}</td>
                          <td>
                            {d.branchId ? branchName(d.branchId) : <span className="mut">All</span>}
                            {d.allowedBranchIds?.length ? <span className="mut" style={{ fontSize: 11 }} title={d.allowedBranchIds.map(branchName).join(', ')}> +{d.allowedBranchIds.length}</span> : null}
                            {branches.length > 1 ? <button onClick={() => openBranchEditor(d)} style={{ border: 'none', background: 'none', color: 'var(--gold)', cursor: 'pointer', padding: 0, fontSize: 11, marginLeft: 4 }}>edit</button> : null}
                          </td>
                          <td><span className="badge" style={{ background: sb.bg, color: sb.fg }}>{label(d.status)}</span></td>
                          <td>{(() => { const e = expiryLabel(d.tokenExpiresAt); return <span style={{ color: e.warn ? 'var(--danger)' : 'var(--muted)', fontSize: 12, fontWeight: e.warn ? 700 : 400 }}>{e.t}</span>; })()}</td>
                          <td className="mut">{timeAgo(d.lastSeenAt)}</td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {d.status === 'active'
                              ? <button className="btn ghost sm" onClick={() => setStatus(d, 'inactive')} disabled={busy === d.deviceId + 'inactive'}>Deactivate</button>
                              : (d.status === 'inactive' ? <button className="btn ghost sm" onClick={() => setStatus(d, 'active')} disabled={busy === d.deviceId + 'active'}>Activate</button> : null)}
                            <button className="btn ghost sm" onClick={() => regenerate(d)} disabled={busy === d.deviceId + 'regen'} style={{ marginLeft: 6 }}>Regenerate</button>
                            {d.status !== 'disabled' && d.status !== 'revoked' ? <button className="btn ghost sm" onClick={() => disable(d)} disabled={busy === d.deviceId + 'disable'} style={{ marginLeft: 6, color: 'var(--danger)' }}>Disable</button> : null}
                          </td>
                        </tr>
                        {branchEditId === d.deviceId ? (
                          <tr><td colSpan={7} style={{ background: '#FBF7EF' }}>
                            <div style={{ padding: '8px 4px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                              <span style={{ fontSize: 11, color: 'var(--soft)' }}>Default</span>
                              <select aria-label="Default branch" value={branchEdit.branchId} onChange={(e) => setBranchEdit({ branchId: e.target.value, allowedBranchIds: branchEdit.allowedBranchIds.filter((id) => id !== e.target.value) })} style={{ ...fieldStyle, width: 160, marginTop: 0 }}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                              <span style={{ fontSize: 11, color: 'var(--soft)' }}>Also serves</span>
                              {branches.filter((b) => b.id !== branchEdit.branchId).map((b) => { const on = branchEdit.allowedBranchIds.includes(b.id); return <label key={b.id} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}><input type="checkbox" checked={on} onChange={() => setBranchEdit({ ...branchEdit, allowedBranchIds: on ? branchEdit.allowedBranchIds.filter((id) => id !== b.id) : [...branchEdit.allowedBranchIds, b.id] })} />{b.name}</label>; })}
                              <button className="btn sm" onClick={() => saveBranches(d.deviceId)} disabled={busy === 'branches:' + d.deviceId}>Save</button>
                              <button className="btn ghost sm" onClick={() => setBranchEditId(null)}>Cancel</button>
                            </div>
                          </td></tr>
                        ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Create device */}
            <div className="panel" style={{ padding: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>Add a device</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                <label style={{ fontSize: 11, color: 'var(--soft)' }}>Device name
                  <input value={form.deviceName} onChange={(e) => setForm({ ...form, deviceName: e.target.value })} placeholder="Front desk iPad" style={fieldStyle} />
                </label>
                <label style={{ fontSize: 11, color: 'var(--soft)' }}>Type
                  <select value={form.deviceType} onChange={(e) => setForm({ ...form, deviceType: e.target.value })} style={fieldStyle}>{DEVICE_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</select>
                </label>
                {branches.length ? (
                  <label style={{ fontSize: 11, color: 'var(--soft)' }}>Default branch
                    <select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value, allowedBranchIds: form.allowedBranchIds.filter((id) => id !== e.target.value) })} style={fieldStyle}><option value="">All branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                  </label>
                ) : null}
                <label style={{ fontSize: 11, color: 'var(--soft)' }}>Kiosk base URL
                  <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://checkin.aipowersalon.com" style={fieldStyle} />
                </label>
              </div>
              {branches.length > 1 && form.branchId ? (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: 'var(--soft)', marginBottom: 4 }}>Also serves (a shared kiosk can check in to these branches too)</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {branches.filter((b) => b.id !== form.branchId).map((b) => {
                      const on = form.allowedBranchIds.includes(b.id);
                      return <label key={b.id} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                        <input type="checkbox" checked={on} onChange={() => setForm({ ...form, allowedBranchIds: on ? form.allowedBranchIds.filter((id) => id !== b.id) : [...form.allowedBranchIds, b.id] })} />{b.name}
                      </label>;
                    })}
                  </div>
                </div>
              ) : null}
              <button className="btn" onClick={createDevice} disabled={busy === 'create'} style={{ marginTop: 10 }}>{busy === 'create' ? 'Creating…' : 'Create device'}</button>
            </div>
          </div>

          {/* RIGHT: settings + logs */}
          <div style={{ display: 'grid', gap: 14 }}>
            <div className="panel" style={{ padding: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Check-In features</div>
              <div className="mut" style={{ fontSize: 11, marginBottom: 10 }}>What the kiosk offers customers. The master switch is above.</div>
              <div style={{ display: 'grid', gap: 10 }}>
                {TOGGLES.map((t) => (
                  <div key={String(t.key)} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, fontSize: 13 }}>{t.label}</div>
                    <Toggle on={!!state.settings[t.key]} busy={busy === 'set:' + String(t.key)} onClick={() => toggleSetting(t.key)} />
                  </div>
                ))}
              </div>
            </div>

            <div className="panel" style={{ padding: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Recent activity</div>
              {logs.length === 0 ? <div className="mut" style={{ fontSize: 12 }}>No activity yet.</div> : (
                <div style={{ display: 'grid', gap: 8, maxHeight: 360, overflow: 'auto' }}>
                  {logs.map((l) => (
                    <div key={l.id} style={{ fontSize: 12, borderBottom: '1px solid var(--line)', paddingBottom: 6 }}>
                      <div style={{ fontWeight: 600 }}>{label(l.eventType)}</div>
                      {l.safeMessage ? <div className="mut">{l.safeMessage}</div> : null}
                      <div className="mut" style={{ fontSize: 11 }}>{timeAgo(l.createdAt)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const fieldStyle: CSSProperties = { display: 'block', marginTop: 3, height: 34, width: '100%', boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', fontFamily: 'inherit', fontSize: 13, background: '#FFFDF8' };
