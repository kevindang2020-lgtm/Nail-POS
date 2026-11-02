// AuthSecurityPanels.tsx — Constitution 3 Step 8 (§66–67, §21–24, §88, §177): the three Security & Access cards the
// re-applied authentication work needed — recovery codes, devices, sign-in activity. Every action calls the server; this
// component decides nothing (trust needs an MFA-verified sign-in, the server says whether this session has one).
import { useEffect, useState } from 'react';
import { posSecurityApi, type AuthDeviceRow, type AuthActivityRow } from '../api/posSecurityApi';
import { AUTO_LOCK_DEFAULT, SALON_AUTO_LOCK_MINUTE_CHOICES, LOCKED_FULL_SIGN_IN_HOURS } from '@aipowersalon/api-contracts';
import { t as tx, enPlural } from '@aipowersalon/mobile-sdk/i18n';
import { useStepUp, isStepUpCancelled } from '../screens/access/accessUi';
import { codeLabel } from './codeLabel';
import { fmtInZone } from '../i18n/format';
import { errorTextOf } from '../i18n/error-text';

const card: React.CSSProperties = { background: 'var(--panel, #fff)', border: '1px solid var(--line)', borderRadius: 12, padding: 14 };
const head = (t: string, right?: React.ReactNode) => (<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}><div style={{ fontWeight: 800, fontSize: 13 }}>{t}</div>{right}</div>);
const when = (iso: string) => fmtInZone(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const errText = (e: any, d: string) => errorTextOf(e, d);   // §22
const STATE: Record<AuthDeviceRow['trustState'], { label: string; pill: string }> = {
  new: { get label() { return tx('pos.new'); }, pill: 'mut' }, recognized: { get label() { return tx('pos.recognized'); }, pill: 'mut' }, trusted: { get label() { return tx('pos.trusted'); }, pill: 'ok' },
  suspicious: { get label() { return tx('pos.suspicious'); }, pill: 'warn' }, blocked: { get label() { return tx('pos.blocked_2'); }, pill: 'bad' }, revoked: { get label() { return tx('pos.signed_out'); }, pill: 'mut' },
};
/** sign-in activity event type → label (ns/admin `admin.security.event.<TYPE>`; an unknown type is humanised, never raw) */
const eventLabel = (type: string) => codeLabel('admin.security.event', type);

export function RecoveryCodesCard({ mfaConfirmed }: { mfaConfirmed: boolean }) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [code, setCode] = useState(''); const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null); const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (mfaConfirmed) posSecurityApi.recoveryCodesRemaining().then((r) => setRemaining(r.remaining)).catch(() => setRemaining(null)); }, [mfaConfirmed]);
  const generate = async () => {
    setBusy(true); setMsg(null);
    try { const r = await posSecurityApi.generateRecoveryCodes(code.trim()); setCodes(r.codes); setRemaining(r.codes.length); setCode(''); }
    catch (e) { setMsg(errText(e, tx('admin.security.recovery.createFailed'))); } finally { setBusy(false); }
  };
  return (
    <section style={card} aria-label={tx('pos.recovery_codes')}>
      {head(tx('admin.security.recovery.title'), mfaConfirmed && remaining !== null ? <span className={'pill ' + (remaining > 2 ? 'ok' : 'warn')}>{remaining} {tx('pos.left')}</span> : null)}
      {!mfaConfirmed ? <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{tx('pos.turn_on_two_factor_authentication_first_5y7a')}</div> : codes ? (
        <div>
          <div style={{ fontSize: 11.5, marginBottom: 8 }}>{tx('pos.save_these_somewhere_safe_each_works_1smn')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, fontFamily: 'monospace', fontSize: 13 }} data-testid="recovery-codes">{codes.map((c) => <div key={c}>{c}</div>)}</div>
          <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => setCodes(null)}>{tx('pos.i_have_saved_them')}</button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input aria-label={tx('pos.authenticator_code_for_recovery_codes')} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder={tx('pos.authenticator_code')} inputMode="numeric" style={{ height: 34, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', width: 150 }} />
          <button className="btn" onClick={generate} disabled={busy || code.length !== 6}>{busy ? tx('pos.creating') : remaining ? tx('pos.create_new_codes') : tx('pos.create_recovery_codes')}</button>
        </div>
      )}
      {msg && <div className="err" style={{ fontSize: 11.5, marginTop: 6 }}>{msg}</div>}
    </section>
  );
}

export function DevicesCard() {
  const [data, setData] = useState<{ devices: AuthDeviceRow[]; canTrust: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null);
  const load = () => posSecurityApi.devices().then(setData).catch(() => setData({ devices: [], canTrust: false }));
  useEffect(() => { load(); }, []);
  const act = async (d: AuthDeviceRow, action: 'trust' | 'revoke' | 'block' | 'unblock') => {
    setBusy(d.id + action); setMsg(null);
    try { const r = await posSecurityApi.deviceAction(d.id, action); if (r.sessionsEnded) setMsg(tx('pos.sessionsended_session_plural_on_that_device_dbn5', { sessionsEnded: String(r.sessionsEnded), plural: String(r.sessionsEnded === 1 ? '' : 's') })); await load(); }
    catch (e) { setMsg(errText(e, tx('pos.that_did_not_work'))); } finally { setBusy(null); }
  };
  return (
    <section style={card} aria-label={tx('pos.devices')}>
      {head(tx('pos.devices'))}
      {data === null ? <div className="muted">{tx('pos.loading')}</div> : data.devices.length === 0 ? <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{tx('pos.no_devices_yet')}</div> : (
        <div className="list" style={{ maxHeight: 300 }}>
          {data.devices.map((d) => (
            <div className="row" key={d.id} style={{ alignItems: 'center', gap: 6 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 12 }}>{d.name || tx('pos.unnamed_device')}{d.current ? tx('pos.this_device') : ''}</div>
                <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{tx('pos.last_used')}{' '}{when(d.lastSeenAt)}{d.trustState === 'trusted' && d.trustedUntil ? tx('pos.trusted_until_trusteduntil', { trustedUntil: String(when(d.trustedUntil)) }) : ''}</div>
              </div>
              <span className={'pill ' + STATE[d.trustState].pill}>{STATE[d.trustState].label}</span>
              {d.trustState === 'blocked' ? <button className="btn ghost" onClick={() => act(d, 'unblock')} disabled={!!busy}>{tx('pos.unblock')}</button> : <>
                {data.canTrust && d.trustState !== 'trusted' && <button className="btn ghost" onClick={() => act(d, 'trust')} disabled={!!busy}>{tx('pos.trust')}</button>}
                {!d.current && <button className="btn ghost" onClick={() => act(d, 'revoke')} disabled={!!busy}>{tx('pos.sign_out')}</button>}
                {!d.current && <button className="btn ghost" onClick={() => act(d, 'block')} disabled={!!busy}>{tx('pos.block')}</button>}
              </>}
            </div>
          ))}
        </div>
      )}
      {data && !data.canTrust && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8 }}>{tx('pos.trusting_a_device_needs_a_sign_1ah1')}</div>}
      {msg && <div style={{ fontSize: 11.5, marginTop: 6 }}>{msg}</div>}
    </section>
  );
}

export function SignInActivityCard() {
  const [events, setEvents] = useState<AuthActivityRow[] | null>(null);
  useEffect(() => { posSecurityApi.activity().then((r) => setEvents(r.events)).catch(() => setEvents([])); }, []);
  return (
    <section style={card} aria-label={tx('pos.sign_in_activity')}>
      {head(tx('admin.security.activity.title'))}
      {events === null ? <div className="muted">{tx('pos.loading')}</div> : events.length === 0 ? <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{tx('pos.no_sign_in_activity_yet')}</div> : (
        <div className="list" style={{ maxHeight: 300 }}>
          {events.map((e, i) => (
            <div className="row" key={i}>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 12 }}>{eventLabel(e.type)}</div><div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{when(e.occurredAt)}{e.ip ? ` · ${e.ip}` : ''}</div></div>
              <span className={'pill ' + (e.outcome === 'failure' ? 'bad' : e.outcome === 'success' ? 'ok' : 'mut')}>{e.outcome === 'failure' ? tx('pos.failed_2') : e.outcome === 'success' ? tx('admin.security.outcome.ok') : tx('admin.security.outcome.info')}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Constitution 3 Step 9 — the salon's sign-in policy (owners: settings.edit). Each switch is ENFORCED by the server. */
export function SignInPolicyCard() {
  const [p, setP] = useState<import('../api/posSecurityApi').SignInPolicy | null>(null);
  const [busy, setBusy] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null);
  // Security Deep Scan C7: PATCH /pos/settings/security is a step-up route (password prompt → one retry; Cancel → no error)
  const stepUp = useStepUp(tx('pos.stepup_settings_needs_password'));
  useEffect(() => { posSecurityApi.signInPolicy().then(setP).catch(() => setP(null)); }, []);
  if (!p) return null;
  const ROWS: { key: 'mfaForOwner' | 'rememberTrustedDevices' | 'passkeyEnabled' | 'pinLogin'; label: string; help: string }[] = [
    { key: 'mfaForOwner', label: tx('pos.require_two_factor_for_owners_and_zaq6'), help: tx('pos.they_sign_in_with_their_authenticator_1ssh') },
    { key: 'rememberTrustedDevices', label: tx('pos.allow_trusted_devices'), help: tx('pos.staff_may_mark_a_device_as_6ax0') },
    { key: 'passkeyEnabled', label: tx('pos.allow_face_id_passkey_sign_in'), help: tx('pos.off_everyone_signs_in_with_their_lxi9') },
    { key: 'pinLogin', label: tx('pos.allow_pin_to_unlock_a_locked_1bzf'), help: tx('pos.off_a_locked_pos_needs_a_1lmt') },
  ];
  const toggle = async (key: (typeof ROWS)[number]['key']) => {
    setBusy(key); setMsg(null);
    try { setP(await stepUp.run(() => posSecurityApi.saveSignInPolicy({ ...p, [key]: !p[key] }))); setMsg(tx('pos.saved_it_applies_to_new_sign_gfhj')); }
    catch (e) { if (!isStepUpCancelled(e)) setMsg(errText(e, tx('pos.could_not_save_2'))); } finally { setBusy(null); }
  };
  // Kevin, Oct 12 2026: the POS auto-lock — on by default at 60 minutes, enforced by the server on every POS of the salon.
  const lockOn = p.autoLockEnabled ?? AUTO_LOCK_DEFAULT.enabled;
  const lockMin = p.autoLockMinutes ?? AUTO_LOCK_DEFAULT.minutes;
  const saveLock = async (next: { autoLockEnabled: boolean; autoLockMinutes: number }) => {
    setBusy('autoLock'); setMsg(null);
    try { setP(await stepUp.run(() => posSecurityApi.saveSignInPolicy({ ...p, ...next }))); setMsg(tx('pos.saved_every_pos_follows_it_within_iot5')); }
    catch (e) { if (!isStepUpCancelled(e)) setMsg(errText(e, tx('pos.could_not_save_2'))); } finally { setBusy(null); }
  };
  return (
    <section style={card} aria-label={tx('pos.sign_in_policy')}>
      {head(tx('admin.security.policy.title'))}
      {stepUp.prompt}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '6px 0' }}>
        <input type="checkbox" aria-label={tx('pos.lock_pos_devices_automatically')} checked={lockOn} disabled={busy !== null} onChange={() => saveLock({ autoLockEnabled: !lockOn, autoLockMinutes: lockMin })} />
        <span><span style={{ fontWeight: 700, fontSize: 12 }}>{tx('pos.lock_pos_devices_automatically_after')}
          <select aria-label={tx('pos.lock_pos_devices_after')} value={lockMin} disabled={busy !== null || !lockOn} onChange={(e) => saveLock({ autoLockEnabled: lockOn, autoLockMinutes: Number(e.target.value) })} style={{ margin: '0 6px', fontSize: 12 }}>
            {SALON_AUTO_LOCK_MINUTE_CHOICES.map((m) => <option key={m} value={m}>{m} {tx('pos.minutes')}</option>)}
          </select>{tx('pos.without_use')}</span>
          <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{tx('pos.enforced_by_the_server_on_every_zncl')}{' '}{LOCKED_FULL_SIGN_IN_HOURS} {tx('pos.hours_locked_a_full_sign_in')}</div></span>
      </div>
      {ROWS.map((r) => (
        <label key={r.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '6px 0' }}>
          <input type="checkbox" aria-label={r.label} checked={p[r.key]} disabled={busy !== null} onChange={() => toggle(r.key)} />
          <span><span style={{ fontWeight: 700, fontSize: 12 }}>{r.label}</span><div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{r.help}</div></span>
        </label>
      ))}
      {msg && <div style={{ fontSize: 11.5, marginTop: 6 }}>{msg}</div>}
    </section>
  );
}

/** Constitution 3 Step 10d — the salon's connected apps (OAuth). Owners only; disconnecting ends the app's access at once. */
export function ConnectedAppsCard() {
  const [apps, setApps] = useState<{ id: string; name: string; scopes: string[]; connectedAt: string }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => posSecurityApi.connectedApps().then((r) => setApps(r.apps)).catch(() => setApps([]));
  useEffect(() => { load(); }, []);
  const disconnect = async (id: string) => { setBusy(id); try { await posSecurityApi.disconnectApp(id); await load(); } finally { setBusy(null); } };
  return (
    <section style={card} aria-label={tx('pos.connected_apps')}>
      {head(tx('pos.connected_apps_2'))}
      {apps === null ? <div className="muted">{tx('pos.loading')}</div> : apps.length === 0 ? <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{tx('pos.no_apps_are_connected_to_your_6n3c')}</div> : (
        <div className="list">{apps.map((a) => (
          <div className="row" key={a.id} style={{ alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 12 }}>{a.name}</div><div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{tx('pos.read_only')}{' '}{a.scopes.length} {tx('pos.permission')}{enPlural(a.scopes.length === 1 ? '' : 's')} {tx('pos.since')}{' '}{when(a.connectedAt)}</div></div>
            <button className="btn ghost" onClick={() => disconnect(a.id)} disabled={busy !== null}>{busy === a.id ? '…' : tx('pos.disconnect')}</button>
          </div>
        ))}</div>
      )}
    </section>
  );
}
