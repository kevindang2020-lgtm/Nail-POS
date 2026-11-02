import { useCallback, useEffect, useState } from 'react';
import { useInlineAsk } from '@aipowersalon/ui';
import { ownerPaymentDevicesApi, type MobilePayDeviceView, type PaymentDeviceSecuritySummary } from '../api/ownerPaymentDevicesApi';
import { useOwnerNav } from '../shell/nav';
import { useOwnerStream } from '../api/useOwnerStream';

// PaymentDevicesScreen — Owner App, Payment Device Health (Owner & Manager Payment App mandate §12–§17, §137–§145).
// Every phone registered to take Tap to Pay payments for this salon: trust state (pending / active / disabled / revoked /
// compromised), the person it is bound to, online, app version, last payment, last error. The owner approves a phone, or
// switches it off / revokes it / marks it compromised with a reason (audited; a revoked or compromised phone loses payment
// authority at once, server-side). A compromised phone is never re-activated in place — it is revoked and re-registered.
const Back = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--owner-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>;
const tone: Record<string, string> = { active: '#2e7d32', pending: '#b8860b', disabled: '#7a7a7a', revoked: '#c0392b', compromised: '#c0392b' };
const when = (iso?: string | null) => { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const ASK: Record<string, string> = {
  disable: 'Reason for switching this phone off?',
  revoke: 'Reason for revoking this phone (e.g. lost phone, staff left)?',
  compromised: 'What happened to this phone? It will be revoked and must be registered again.',
};

/** Secure Tap to Pay §51 (Oct 27 2026): the salon's payment-phone security counts above the list — new phones, revocations,
 *  claim conflicts, the security alerts (a revoked phone still calling, a failed device signature, a replay, an unusual
 *  number of new phones) and the app versions in use. Last 30 days; the alerts are deduplicated incidents, not raw attempts. */
const ALERTS: Array<[keyof PaymentDeviceSecuritySummary['signals'], string]> = [
  ['unusual_registration', 'Unusual new-phone registrations'], ['key_mismatch', 'Failed device signatures'], ['revoked_device_attempt', 'Revoked phone still trying'],
  ['request_replayed', 'Replayed requests'], ['app_version_refused', 'Outdated app refused'], ['attestation_failed', 'Failed integrity checks'],
];
export function DeviceSecurityCard({ s }: { s: PaymentDeviceSecuritySummary }) {
  const alerts = ALERTS.filter(([k]) => (s.signals?.[k] ?? 0) > 0);
  const tile = (label: string, value: number | string, warn = false) => (
    <div><div className="muted" style={{ fontSize: 11 }}>{label}</div><div style={{ fontWeight: 700, fontSize: 18, color: warn ? '#c0392b' : 'inherit' }}>{value}</div></div>
  );
  return (
    <div className="owner-chartcard" style={{ margin: '8px 0', padding: 14 }} aria-label="Payment phone security" data-testid="device-security-card">
      <div style={{ fontWeight: 700 }}>Payment phone security <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· last {s.windowDays} days</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 8 }}>
        {tile('New phones (24 h)', s.registrations.last24h, (s.signals?.unusual_registration ?? 0) > 0)}
        {tile('New phones', s.registrations.window)}
        {tile('Revoked', s.revocations)}
        {tile('Claim conflicts', s.claimConflicts)}
      </div>
      <div style={{ marginTop: 8, fontSize: 12.5 }}>
        {alerts.length === 0 ? <span className="muted">No security alerts.</span>
          : alerts.map(([k, label]) => <div key={k} style={{ color: '#c0392b' }} data-testid={`device-alert-${k}`}>{label}: {s.signals[k]}</div>)}
      </div>
      {s.appVersions.length ? <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>App versions: {s.appVersions.map((v) => `v${v.version} (${v.devices})`).join(' · ')}</div> : null}
    </div>
  );
}

export function PaymentDevicesScreen() {
  const { back } = useOwnerNav();
  const { ask, askUi } = useInlineAsk();
  const [rows, setRows] = useState<MobilePayDeviceView[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [security, setSecurity] = useState<PaymentDeviceSecuritySummary | null>(null);

  const load = useCallback(() => {
    ownerPaymentDevicesApi.list().then((r) => { setRows(Array.isArray(r) ? r : []); setErr(null); })
      .catch((e: any) => { setRows([]); setErr(e?.status === 403 ? 'You do not have access to payment devices.' : (e?.message || 'Could not load payment devices.')); });
    // §51: the counts are owner-only; a manager without pos.devices.manage simply does not see the card
    Promise.resolve().then(() => ownerPaymentDevicesApi.securitySummary()).then((s) => setSecurity(s && typeof s === 'object' ? s : null)).catch(() => setSecurity(null));
  }, []);
  useEffect(load, [load]);
  useOwnerStream(load);   // mobile_pay_device_updated / heartbeat-driven changes refresh in place

  const act = (d: MobilePayDeviceView, action: 'approve' | 'disable' | 'revoke' | 'compromised') => {
    const run = async (reason?: string) => {
      setBusy(d.deviceId); setNote(null); setErr(null);
      try { const r = await ownerPaymentDevicesApi.act(d.deviceId, action, reason); setNote(`${d.label || d.deviceId.slice(0, 8)} is now ${r.status}.`); load(); }
      catch (e: any) { setErr(e?.message || 'That change could not be made.'); }
      finally { setBusy(null); }
    };
    if (action === 'approve') void run();
    else ask(ASK[action], (reason) => { void run(reason.trim()); }, { minLength: 2 });
  };

  return (
    <>
      <header className="owner-header">
        <button className="owner-back" aria-label="Back" onClick={back}><Back /></button>
        <div className="owner-greet" style={{ textAlign: 'center' }}><div className="n owner-serif" style={{ cursor: 'default', justifyContent: 'center' }}>Payment Devices</div></div>
        <div style={{ width: 40 }} />
      </header>

      {err ? <div className="owner-chartcard" role="alert" style={{ margin: '8px 0', padding: 12, color: '#c0392b' }}>{err}</div> : null}
      {note ? <div className="owner-chartcard" role="status" style={{ margin: '8px 0', padding: 12, color: '#2e7d32' }}>{note}</div> : null}
      {askUi}
      {security ? <DeviceSecurityCard s={security} /> : null}

      {rows === null ? <div className="owner-state"><div className="big owner-serif">Loading…</div></div>
        : rows.length === 0 && !err ? (
          <div className="owner-state"><div className="big owner-serif">No payment phones yet</div><div className="muted">A manager's iPhone appears here after they sign in to the AIPowerSalon Pay app. Approve it to let it take payments.</div></div>
        ) : rows.map((d) => (
          <div key={d.deviceId} className="owner-chartcard" style={{ margin: '8px 0', padding: 14 }} aria-label={`Payment device ${d.label || d.deviceId.slice(0, 8)}`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span aria-hidden style={{ width: 9, height: 9, borderRadius: 5, background: d.online ? '#2e7d32' : '#b0b0b0', display: 'inline-block' }} />
              <div style={{ fontWeight: 700, flex: 1 }}>{d.label || d.deviceId.slice(0, 8)}</div>
              <span style={{ color: tone[d.status] || 'inherit', fontWeight: 700, textTransform: 'capitalize' }}>{d.status}</span>
            </div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
              {d.boundUserName || 'Not bound to a person'} · {d.online ? 'Online' : 'Offline'}{d.appVersion ? ` · v${d.appVersion}` : ''}{d.tapToPayCapable ? ' · Tap to Pay capable' : ' · No Tap to Pay'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12.5, marginTop: 8 }}>
              <div><div className="muted" style={{ fontSize: 11 }}>Last seen</div>{when(d.lastSeenAt)}</div>
              <div><div className="muted" style={{ fontSize: 11 }}>Last payment</div>{when(d.lastPaymentAt)}</div>
              <div><div className="muted" style={{ fontSize: 11 }}>Last error</div>{d.lastErrorCode ? `${d.lastErrorCode} · ${when(d.lastErrorAt)}` : '—'}</div>
              <div><div className="muted" style={{ fontSize: 11 }}>{d.status === 'revoked' || d.status === 'compromised' ? 'Revoked' : 'Approved'}</div>{d.status === 'revoked' || d.status === 'compromised' ? `${when(d.revokedAt)}${d.revokeReason ? ` · ${d.revokeReason}` : ''}` : when(d.approvedAt)}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              {(d.status === 'pending' || d.status === 'disabled') && <button className="owner-pill" disabled={busy === d.deviceId} onClick={() => act(d, 'approve')}>Approve</button>}
              {d.status === 'active' && <button className="owner-pill" disabled={busy === d.deviceId} onClick={() => act(d, 'disable')}>Switch off</button>}
              {d.status !== 'revoked' && d.status !== 'compromised' && <button className="owner-pill" disabled={busy === d.deviceId} onClick={() => act(d, 'revoke')}>Revoke</button>}
              {d.status !== 'compromised' && d.status !== 'revoked' && <button className="owner-pill" disabled={busy === d.deviceId} onClick={() => act(d, 'compromised')}>Mark compromised</button>}
            </div>
          </div>
        ))}
    </>
  );
}
