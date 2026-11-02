// TapToPayAdminScreen.tsx — Super Admin → Tap to Pay (Owner & Manager Payment App mandate §5–§9, §34, §123, §145).
// Per tenant: the SAFE onboarding status — Apple Tap to Pay entitlement, the Fiserv Tap to Pay merchant enrollment, whether the
// platform's processor credentials are present (yes/no only — never the values) and whether Tap to Pay is live for the
// salon — plus the operator's record of that progress, and the salon's payment phones (trust state, health) with approve /
// revoke. The platform-wide and provider kill switches live in the Kill-Switch Centre (payments.tap_to_pay /
// payments.fiserv_tap_to_pay); this screen links there instead of duplicating them.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useInlineConfirm } from '@aipowersalon/ui';
import { superAdminApi } from '../api/superAdminApi';
import { tapToPayAdminApi, TTP_APPLE_STATUSES, TTP_PSP_STATUSES, type TtpOnboardingAdminView, type TtpDeviceAdminRow, type TtpAppleEntitlementStatus, type TtpPspEnrollmentStatus } from '../api/tapToPayAdminApi';

type TenantLite = { id: string; name?: string; displayName?: string; salonName?: string; tenantName?: string; salonCode?: string };
const tenantLabel = (t: TenantLite) => t.name || t.displayName || t.salonName || t.tenantName || t.salonCode || t.id;
const label = (s: string) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
const when = (iso?: string | null) => { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(); };
const badge = (s: string) => s === 'active' ? { bg: '#EAF5EE', fg: '#3E8F57' } : s === 'pending' || s === 'disabled' ? { bg: '#FFF6E5', fg: '#D09A36' } : { bg: '#FBEFE9', fg: '#B85B4D' };
const selectStyle = { height: 34, border: '1px solid var(--line)', borderRadius: 8, padding: '0 8px', fontFamily: 'inherit', background: '#FFFDF8' } as const;

export function TapToPayAdminScreen() {
  const [params, setParams] = useSearchParams();
  const tenantId = params.get('tenantId') || '';
  const { confirm, confirmUi } = useInlineConfirm();
  const [tenants, setTenants] = useState<TenantLite[] | null>(null);
  const [tenantsErr, setTenantsErr] = useState(false);
  const [ob, setOb] = useState<TtpOnboardingAdminView | null>(null);
  const [devices, setDevices] = useState<TtpDeviceAdminRow[]>([]);
  const [form, setForm] = useState<{ apple: TtpAppleEntitlementStatus; psp: TtpPspEnrollmentStatus; notes: string }>({ apple: 'not_started', psp: 'not_started', notes: '' });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    (superAdminApi.state() as Promise<{ tenants: TenantLite[] }>)
      .then((r) => { setTenants(r.tenants || []); setTenantsErr(false); })
      .catch(() => setTenantsErr(true));
  }, []);
  const selected = useMemo(() => tenants?.find((t) => t.id === tenantId) || null, [tenants, tenantId]);

  const load = useCallback(() => {
    if (!tenantId) { setOb(null); setDevices([]); return; }
    setLoading(true); setErr(null);
    Promise.all([tapToPayAdminApi.onboarding(tenantId), tapToPayAdminApi.devices(tenantId)])
      .then(([o, d]) => { setOb(o); setDevices(Array.isArray(d) ? d : []); setForm({ apple: o.appleEntitlementStatus, psp: o.pspEnrollmentStatus, notes: o.notes || '' }); })
      .catch((e: any) => setErr(e?.message || 'Failed to load Tap to Pay status.'))
      .finally(() => setLoading(false));
  }, [tenantId]);
  useEffect(load, [load]);

  const pickTenant = (id: string) => { const p = new URLSearchParams(params); if (id) p.set('tenantId', id); else p.delete('tenantId'); setParams(p, { replace: true }); };
  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key); setErr(null); setNote(null);
    try { await fn(); setNote(ok); load(); } catch (e: any) { setErr(e?.message || 'Action failed.'); } finally { setBusy(null); }
  };
  const saveOnboarding = () => act('ob', () => tapToPayAdminApi.setOnboarding(tenantId, { appleEntitlementStatus: form.apple, pspEnrollmentStatus: form.psp, notes: form.notes.trim() || undefined }), 'Onboarding status recorded.');

  return (
    <div className="work">
      <div className="flex flex-col md:flex-row justify-between gap-3 mb-3">
        <div className="vh"><h1>Tap to Pay</h1><div className="sub">Owner &amp; Manager Payment App — onboarding status and payment phones per salon. Status only: no credential is shown here.</div></div>
        <div className="flex flex-wrap gap-3 items-baseline">
          <select value={tenantId} onChange={(e) => pickTenant(e.target.value)} aria-label="Tenant" style={{ ...selectStyle, minWidth: 240, height: 36 }}>
            <option value="">{tenantsErr ? 'Could not load tenants' : tenants ? 'Select a tenant…' : 'Loading tenants…'}</option>
            {(tenants || []).map((t) => <option key={t.id} value={t.id}>{tenantLabel(t)}</option>)}
          </select>
          {tenantId ? <button className="btn ghost" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button> : null}
        </div>
      </div>

      {note ? <div className="toast" role="status" style={{ background: '#EAF5EE', color: '#2F6B43', marginBottom: 10 }}>{note}</div> : null}
      {err ? <div className="toast" role="alert" style={{ background: '#FBEFE9', color: '#9A4436', marginBottom: 10 }}>{err}</div> : null}
      {confirmUi}

      {!tenantId ? (
        <div className="panel" style={{ padding: 20, color: 'var(--muted)' }}>Pick a tenant to see its Tap to Pay onboarding and payment phones. Platform and provider kill switches are in the <Link to="/system-status">Kill-Switch Centre (System Status)</Link>.</div>
      ) : loading && !ob ? (
        <div className="panel" style={{ padding: 20, color: 'var(--muted)' }}>Loading Tap to Pay status…</div>
      ) : ob ? (
        <>
          <div className="panel" style={{ padding: 16, marginBottom: 12 }} aria-label="Onboarding status">
            <h3 style={{ marginTop: 0 }}>{selected ? tenantLabel(selected) : 'Salon'} — {ob.onboarded ? 'Tap to Pay live' : 'Tap to Pay not live'}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 12 }}>
              <div><div className="sub">Apple entitlement</div><b>{label(ob.appleEntitlementStatus)}</b></div>
              <div><div className="sub">Fiserv Tap to Pay enrollment</div><b>{label(ob.pspEnrollmentStatus)}</b></div>
              <div><div className="sub">Platform credentials</div><b>{ob.credentialsPresent ? 'Present' : 'Missing'}</b></div>
              <div><div className="sub">Last updated</div><b>{when(ob.updatedAt)}</b></div>
            </div>
            {!ob.onboarded && <div className="sub" style={{ marginBottom: 10 }}>Live requires Apple entitlement <b>Approved</b>, Fiserv enrollment <b>Active</b> and the platform credentials present. Until then the app shows “Tap to Pay · Setup Required” and takes no card.</div>}
            <div className="flex flex-wrap gap-3 items-center">
              <label className="sub">Apple <select aria-label="Apple entitlement status" value={form.apple} onChange={(e) => setForm({ ...form, apple: e.target.value as TtpAppleEntitlementStatus })} style={selectStyle}>{TTP_APPLE_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></label>
              <label className="sub">Fiserv enrollment <select aria-label="Fiserv enrollment status" value={form.psp} onChange={(e) => setForm({ ...form, psp: e.target.value as TtpPspEnrollmentStatus })} style={selectStyle}>{TTP_PSP_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></label>
              <input aria-label="Onboarding notes" placeholder="Notes (no credentials)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={{ ...selectStyle, minWidth: 220 }} />
              <button className="btn" disabled={busy === 'ob'} onClick={saveOnboarding}>{busy === 'ob' ? 'Saving…' : 'Record status'}</button>
            </div>
          </div>

          <div className="panel" style={{ padding: 16 }} aria-label="Payment phones">
            <h3 style={{ marginTop: 0 }}>Payment phones ({devices.length})</h3>
            {devices.length === 0 ? <div className="sub">No phones registered for this salon yet.</div> : (
              <table className="tbl" style={{ width: '100%' }}>
                <thead><tr><th>Phone</th><th>Status</th><th>App</th><th>Last seen</th><th>Last payment</th><th>Last error</th><th /></tr></thead>
                <tbody>
                  {devices.map((d) => {
                    const b = badge(d.status);
                    return (
                      <tr key={d.deviceId}>
                        <td>{d.label || d.deviceId.slice(0, 8)}<div className="sub">{label(d.platform)}{d.tapToPayCapable ? ' · Tap to Pay capable' : ''}</div></td>
                        <td><span style={{ background: b.bg, color: b.fg, borderRadius: 999, padding: '2px 8px', fontWeight: 700, fontSize: 12 }}>{label(d.status)}</span>{d.revokeReason ? <div className="sub">{d.revokeReason}</div> : null}</td>
                        <td>{d.appVersion ? `v${d.appVersion}` : '—'}</td>
                        <td>{when(d.lastSeenAt)}</td>
                        <td>{when(d.lastPaymentAt)}</td>
                        <td>{d.lastErrorCode ? `${d.lastErrorCode} · ${when(d.lastErrorAt)}` : '—'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {(d.status === 'pending' || d.status === 'disabled') && <button className="btn ghost" disabled={busy === d.deviceId} onClick={() => act(d.deviceId, () => tapToPayAdminApi.approve(tenantId, d.deviceId), `${d.label || 'Phone'} approved.`)}>Approve</button>}
                          {d.status !== 'revoked' && <button className="btn ghost" disabled={busy === d.deviceId} onClick={() => confirm(`Revoke ${d.label || 'this phone'}? It stops taking payments immediately.`, () => void act(d.deviceId, () => tapToPayAdminApi.revoke(tenantId, d.deviceId), `${d.label || 'Phone'} revoked.`))}>Revoke</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
