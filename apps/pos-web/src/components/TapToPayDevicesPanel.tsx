// TapToPayDevicesPanel.tsx — Secure Tap to Pay M6-4 (POS side): the salon's Tap to Pay phones on the Payment Terminals screen.
//   • Add Tap to Pay device: label + "Shared salon phone" → POST /mobile-checkout/devices/pairings (step-up) → a single-use,
//     5-minute code for THIS location, shown as a QR (qrPath — the repo's qrcode-generator, drawn here) with the code text
//     and a live countdown to expiresAt. Expired → it says so; nothing pretends the code still works.
//   • Per phone: status, user, locations, last seen; Rename (§15, Oct 26); Locations editor (POST devices/:id/branches — empty = only its home
//     location); Approve / Suspend / Revoke. Every one of these is a step-up route — useStepUp asks for the password once
//     and retries; Cancel changes nothing and shows nothing.
// The server enforces pos.devices.manage; the panel only hides controls the signed-in person cannot use.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { qrPath, useInlineAsk, useInlineConfirm } from '@aipowersalon/ui';
import { posMobilePaymentsApi, type TapToPayDevice, type TapToPayPairing, type TapToPayDeviceActivity } from '../api/posMobilePaymentsApi';
import { authApi, type BranchOption } from '../api/authApi';
import { useStepUp, isStepUpCancelled } from '../screens/access/accessUi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

import { statusLabel } from '../i18n/status-label';

// a status label from its catalogue key — a code the catalogue does not know yet shows its humanised words, never the raw key
const keyed = (key: string, code: string) => { const v = tx(key); return v === key ? statusLabel('paymentAttempt', code) : v; };
const STATUS_TONE: Record<string, string> = { active: 'var(--ok)', pending: 'var(--gold, #C9971B)', disabled: 'var(--muted)', revoked: 'var(--danger, #B42318)', compromised: 'var(--danger, #B42318)' };
const field: React.CSSProperties = { height: 32, padding: '0 8px', borderRadius: 8, border: '1px solid var(--line)', background: '#FFFDF8' };
const when = (s?: string | null) => (s ? new Date(s).toLocaleString() : '—');

/** mm:ss until `iso` (0:00 once passed). */
export function countdownLabel(iso: string, now: number): { left: number; text: string } {
  const left = Math.max(0, Math.floor((Date.parse(iso) - now) / 1000));
  return { left, text: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` };
}

export function PairingQr({ pairing, onDone }: { pairing: TapToPayPairing; onDone: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const cd = countdownLabel(pairing.expiresAt, now);
  const qr = useMemo(() => qrPath(pairing.qrPayload), [pairing.qrPayload]);
  return (
    <div data-testid="ttp-pairing" style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', marginTop: 10 }}>
      {cd.left > 0 ? (
        qr ? (
          <svg role="img" aria-label={tx('pos.ttp_pairing_qr')} viewBox={`0 0 ${qr.size} ${qr.size}`} width={200} height={200} style={{ background: '#fff', borderRadius: 8, border: '1px solid var(--line)' }} shapeRendering="crispEdges">
            <path d={qr.d} fill="#000" />
          </svg>
        ) : <div className="muted">{tx('pos.ttp_qr_unavailable')}</div>
      ) : null}
      <div style={{ flex: 1, minWidth: 220 }}>
        {cd.left > 0 ? (
          <>
            <div className="s" style={{ marginBottom: 6 }}>{tx('pos.ttp_scan_hint')}</div>
            <div className="s" style={{ fontWeight: 700 }}>{tx('pos.ttp_pairing_code')}</div>
            <code data-testid="ttp-code" style={{ display: 'block', wordBreak: 'break-all', userSelect: 'all', padding: '6px 8px', background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 8, margin: '4px 0 8px' }}>{pairing.pairingCode}</code>
            <div data-testid="ttp-countdown" style={{ fontWeight: 700 }} aria-live="polite">{tx('pos.ttp_expires_in', { time: cd.text })}</div>
            {pairing.shared ? <div className="s muted" style={{ marginTop: 4 }}>{tx('pos.ttp_shared_phone')}</div> : null}
          </>
        ) : <div role="alert" data-testid="ttp-expired" style={{ fontWeight: 700, color: 'var(--danger, #B42318)' }}>{tx('pos.ttp_expired')}</div>}
        <button className="btn ghost" style={{ marginTop: 10 }} onClick={onDone}>{tx('pos.ttp_done')}</button>
      </div>
    </div>
  );
}

function BranchEditor({ device, branches, busy, onSave, onCancel }: { device: TapToPayDevice; branches: BranchOption[]; busy: boolean; onSave: (ids: string[]) => void; onCancel: () => void }) {
  const [sel, setSel] = useState<string[]>(device.allowedBranchIds ?? []);
  const home = branches.find((b) => b.id === device.branchId);
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <div data-testid={`ttp-branches-${device.deviceId}`} style={{ padding: 10, border: '1px dashed var(--line)', borderRadius: 10, marginTop: 6 }}>
      <div className="s" style={{ fontWeight: 700, marginBottom: 6 }}>{tx('pos.ttp_locations_title')}</div>
      {branches.map((b) => (
        <label key={b.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, marginBottom: 4 }}>
          <input type="checkbox" checked={sel.includes(b.id)} onChange={() => toggle(b.id)} />{b.name || b.city || b.id.slice(0, 8)}
        </label>
      ))}
      {sel.length === 0 ? <div className="s muted">{tx('pos.ttp_locations_none_selected', { home: home?.name || '—' })}</div> : null}
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button className="btn" disabled={busy} onClick={() => onSave(sel)}>{busy ? '…' : tx('pos.ttp_save_locations')}</button>
        <button className="btn ghost" onClick={onCancel}>{tx('pos.cancel')}</button>
      </div>
    </div>
  );
}

/** Secure Tap to Pay M6-6 (§15 / §62): one phone's sign-ins and audit history, loaded when the owner opens it. */
export function DeviceActivityView({ deviceId, branchName }: { deviceId: string; branchName: (id: string) => string }) {
  const [a, setA] = useState<TapToPayDeviceActivity | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    posMobilePaymentsApi.activity(deviceId).then((r) => { if (live) setA(r); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [deviceId]);
  if (failed) return <div role="alert" className="err" data-testid={`ttp-activity-failed-${deviceId}`}>{tx('pos.ttp_activity_failed')}</div>;
  if (!a) return <div className="state">{tx('pos.ttp_activity_loading')}</div>;
  return (
    <div data-testid={`ttp-activity-${deviceId}`} style={{ padding: 10, border: '1px dashed var(--line)', borderRadius: 10, marginTop: 6 }}>
      <div className="s" style={{ fontWeight: 700, marginBottom: 4 }}>{tx('pos.ttp_sessions_title')}</div>
      {a.sessions.length === 0 ? <div className="s muted">{tx('pos.ttp_sessions_none')}</div> : (
        <table className="tbl w-full" style={{ marginBottom: 8 }}>
          <thead><tr><th>{tx('pos.ttp_session_employee')}</th><th>{tx('pos.ttp_session_signed_in')}</th><th>{tx('pos.ttp_session_last_active')}</th><th>{tx('pos.ttp_session_state')}</th></tr></thead>
          <tbody>
            {a.sessions.map((s) => (
              <tr key={s.ref + s.signedInAt}>
                <td>{s.userName || s.userId.slice(0, 8)}{s.branchId ? <div className="s muted">{branchName(s.branchId)}</div> : null}</td>
                <td>{when(s.signedInAt)}</td>
                <td>{when(s.lastActiveAt)}</td>
                <td style={{ fontWeight: s.state === 'active' ? 700 : 400 }}>{keyed(`pos.ttp_session_state_${s.state}`, s.state)} <span className="s muted">#{s.ref}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="s" style={{ fontWeight: 700, marginBottom: 4 }}>{tx('pos.ttp_audit_title')}</div>
      {a.audit.length === 0 ? <div className="s muted">{tx('pos.ttp_audit_none')}</div> : (
        <table className="tbl w-full">
          <thead><tr><th>{tx('pos.ttp_audit_when')}</th><th>{tx('pos.ttp_audit_what')}</th><th>{tx('pos.ttp_audit_who')}</th></tr></thead>
          <tbody>
            {a.audit.map((e, i) => (
              <tr key={e.at + e.action + i}>
                <td>{when(e.at)}</td>
                <td>{e.summary || statusLabel('tapToPayEvent', e.action)}{e.reason ? <div className="s muted">{e.reason}</div> : null}{e.ticketId ? <div className="s muted">#{e.ticketId.slice(0, 8)}</div> : null}</td>
                <td>{e.actorName || (e.actorUserId ? e.actorUserId.slice(0, 8) : '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function TapToPayDevicesPanel({ canManage }: { canManage: boolean }) {
  const [devices, setDevices] = useState<TapToPayDevice[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [shared, setShared] = useState(false);
  const [pairing, setPairing] = useState<TapToPayPairing | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [history, setHistory] = useState<string | null>(null);   // M6-6: the phone whose sign-ins / history are open
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const { ask, askUi } = useInlineAsk();
  const { confirm, confirmUi } = useInlineConfirm();
  const stepUp = useStepUp(tx('pos.ttp_stepup_needs_password'));

  const load = useCallback(async () => {
    setLoadErr(false);
    try { setDevices(await posMobilePaymentsApi.devices()); } catch { setLoadErr(true); setDevices([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void authApi.branches().then((r) => setBranches(Array.isArray(r?.branches) ? r.branches : [])).catch(() => setBranches([])); }, []);
  const branchName = (id: string) => { const b = branches.find((x) => x.id === id); return b ? b.name || b.city || id.slice(0, 8) : id.slice(0, 8); };

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key); setMsg(null);
    try { await stepUp.run(fn); setMsg({ tone: 'ok', text: ok }); await load(); return true; }
    catch (e: any) { if (!isStepUpCancelled(e)) setMsg({ tone: 'err', text: e?.message || tx('pos.ttp_action_failed') }); return false; }
    finally { setBusy(null); }
  };
  const createPairing = async () => {
    setBusy('pair'); setMsg(null);
    try { setPairing(await stepUp.run(() => posMobilePaymentsApi.createPairing({ label: label.trim() || undefined, shared }))); }
    catch (e: any) { if (!isStepUpCancelled(e)) setMsg({ tone: 'err', text: e?.message || tx('pos.ttp_action_failed') }); }
    finally { setBusy(null); }
  };
  const name = (d: TapToPayDevice) => d.label || d.deviceId.slice(0, 8);
  // §15: the owner's name for the phone (the server cleans it and keeps it ≤ 80 characters); a step-up route like the rest
  const rename = (d: TapToPayDevice) => ask(tx('pos.ttp_rename_q', { name: name(d) }), (label) => { void act('n' + d.deviceId, () => posMobilePaymentsApi.rename(d.deviceId, label.trim()), tx('pos.ttp_renamed_ok', { name: label.trim() })); }, { defaultValue: d.label ?? '', confirmLabel: tx('pos.ttp_rename') });
  const suspend = (d: TapToPayDevice) => ask(tx('pos.ttp_suspend_reason_q', { name: name(d) }), (reason) => { void act('s' + d.deviceId, () => posMobilePaymentsApi.suspend(d.deviceId, reason.trim()), tx('pos.ttp_suspended_ok', { name: name(d) })); }, { minLength: 2, confirmLabel: tx('pos.ttp_suspend') });
  const revoke = (d: TapToPayDevice) => ask(tx('pos.ttp_revoke_reason_q', { name: name(d) }), (reason) => {
    confirm(tx('pos.ttp_revoke_confirm', { name: name(d) }), () => { void act('r' + d.deviceId, () => posMobilePaymentsApi.revoke(d.deviceId, reason.trim()), tx('pos.ttp_revoked_ok', { name: name(d) })); }, { confirmLabel: tx('pos.revoke') });
  }, { minLength: 2, confirmLabel: tx('pos.revoke') });

  return (
    <section className="panel mb-3" data-testid="ttp-panel" style={{ padding: 16 }}>
      {askUi}{confirmUi}{stepUp.prompt}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>{tx('pos.ttp_phones')}</div>
        {devices ? <span className="pill">{devices.length}</span> : null}
        {canManage && !addOpen ? <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={() => { setAddOpen(true); setPairing(null); }}>{tx('pos.ttp_add_device')}</button> : null}
      </div>
      <div className="s muted" style={{ marginBottom: 8 }}>{tx('pos.ttp_phones_hint')}</div>
      {msg ? <div role={msg.tone === 'err' ? 'alert' : 'status'} style={{ padding: '6px 10px', borderRadius: 8, marginBottom: 8, background: msg.tone === 'err' ? '#FBEDE7' : '#EAF5EE', color: msg.tone === 'err' ? '#B4673B' : 'var(--text)' }}>{msg.text}</div> : null}

      {addOpen ? (
        <div data-testid="ttp-add-form" style={{ padding: 12, border: '1.5px solid var(--gold, #C9971B)', borderRadius: 12, marginBottom: 10, background: '#FFFCF6' }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>{tx('pos.ttp_add_device')}</div>
          {!pairing ? (
            <>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <input aria-label={tx('pos.ttp_phone_label')} placeholder={tx('pos.ttp_phone_label_placeholder')} value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} style={{ ...field, minWidth: 220 }} />
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                  <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />{tx('pos.ttp_shared_phone')}
                </label>
              </div>
              <div className="s muted" style={{ marginTop: 4 }}>{tx('pos.ttp_shared_hint')}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <button className="btn primary" disabled={busy === 'pair'} onClick={() => { void createPairing(); }}>{busy === 'pair' ? tx('pos.ttp_creating') : tx('pos.ttp_create_code')}</button>
                <button className="btn ghost" onClick={() => setAddOpen(false)}>{tx('pos.cancel')}</button>
              </div>
            </>
          ) : <PairingQr pairing={pairing} onDone={() => { setPairing(null); setAddOpen(false); setLabel(''); setShared(false); void load(); }} />}
        </div>
      ) : null}

      {devices === null ? <div className="state">{tx('pos.ttp_loading')}</div>
        : loadErr ? <div className="err">{tx('pos.ttp_load_failed')}{' '}<button className="btn ghost" onClick={() => { void load(); }}>{tx('pos.retry')}</button></div>
        : devices.length === 0 ? <div className="muted">{tx('pos.ttp_no_phones')}</div> : (
          <div className="overflow-x-auto w-full">
            <table className="tbl w-full">
              <thead><tr><th>{tx('pos.ttp_phone')}</th><th>{tx('pos.status')}</th><th>{tx('pos.ttp_locations')}</th><th>{tx('pos.last_seen')}</th>{canManage ? <th>{tx('pos.actions')}</th> : null}</tr></thead>
              <tbody>
                {devices.map((d) => {
                  const final = d.status === 'revoked' || d.status === 'compromised';
                  const locs = (d.allowedBranchIds ?? []).length ? (d.allowedBranchIds ?? []).map(branchName).join(', ') : (d.branchId ? tx('pos.ttp_home_location', { name: branchName(d.branchId) }) : '—');
                  return (
                    <tr key={d.deviceId} data-testid={`ttp-row-${d.deviceId}`}>
                      <td><div style={{ fontWeight: 600 }}>{name(d)}</div><div className="s muted">{[d.boundUserName, d.shared ? tx('pos.ttp_shared_phone') : null, d.platform, d.appVersion ? `v${d.appVersion}` : null].filter(Boolean).join(' · ')}</div></td>
                      <td style={{ fontWeight: 700, color: STATUS_TONE[d.status] || 'var(--muted)' }}>{keyed(`pos.ttp_status_${d.status}`, d.status)}{d.status === 'active' ? <div className="s muted" style={{ fontWeight: 400 }}>{d.online ? tx('pos.online') : tx('pos.ttp_offline')}</div> : null}</td>
                      <td>{locs}{editing === d.deviceId ? <BranchEditor device={d} branches={branches} busy={busy === 'b' + d.deviceId}
                        onSave={(ids) => { void act('b' + d.deviceId, () => posMobilePaymentsApi.setBranches(d.deviceId, ids), tx('pos.ttp_locations_saved', { name: name(d) })).then((ok) => { if (ok) setEditing(null); }); }}
                        onCancel={() => setEditing(null)} /> : null}</td>
                      <td>{when(d.lastSeenAt)}{canManage ? <div><button className="btn ghost" style={{ padding: '2px 6px', fontSize: 11 }} data-testid={`ttp-history-${d.deviceId}`} onClick={() => setHistory(history === d.deviceId ? null : d.deviceId)}>{history === d.deviceId ? tx('pos.ttp_activity_hide') : tx('pos.ttp_activity')}</button></div> : null}
                        {history === d.deviceId ? <DeviceActivityView deviceId={d.deviceId} branchName={branchName} /> : null}</td>
                      {canManage ? (
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {!final ? <button className="btn ghost" style={{ padding: '2px 6px', fontSize: 11 }} data-testid={`ttp-rename-${d.deviceId}`} disabled={busy === 'n' + d.deviceId} onClick={() => rename(d)}>{tx('pos.ttp_rename')}</button> : null}{' '}
                          {!final && editing !== d.deviceId ? <button className="btn ghost" style={{ padding: '2px 6px', fontSize: 11 }} onClick={() => setEditing(d.deviceId)}>{tx('pos.ttp_edit_locations')}</button> : null}{' '}
                          {d.status === 'pending' || d.status === 'disabled' ? <button className="btn ghost" style={{ padding: '2px 6px', fontSize: 11 }} disabled={busy === 'a' + d.deviceId} onClick={() => { void act('a' + d.deviceId, () => posMobilePaymentsApi.approve(d.deviceId), tx('pos.ttp_approved_ok', { name: name(d) })); }}>{tx('pos.approve')}</button> : null}{' '}
                          {d.status === 'active' ? <button className="btn ghost" style={{ padding: '2px 6px', fontSize: 11 }} disabled={busy === 's' + d.deviceId} onClick={() => suspend(d)}>{tx('pos.ttp_suspend')}</button> : null}{' '}
                          {!final ? <button className="btn ghost" style={{ padding: '2px 6px', fontSize: 11, color: 'var(--danger, #B42318)' }} disabled={busy === 'r' + d.deviceId} onClick={() => revoke(d)}>{tx('pos.revoke')}</button> : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
    </section>
  );
}
