// DeviceScreens.tsx — Secure Tap to Pay M6-4: what the person holding the phone sees about THIS phone's standing.
//   DeviceRemovedScreen  — DEVICE_REVOKED: the whole app is locked to "This phone was removed from the salon" (its key and
//                          id were already wiped). Leaving it is a staff action: set the phone up again (a NEW device the
//                          owner must approve, or a fresh POS pairing code) or sign out.
//   DeviceStandingBanner — pending (waiting for the owner) / suspended, never shown while the customer holds the phone.
//   PairDeviceCard       — paste the code from the POS "Add Tap to Pay device" QR (a scanned/opened link fills it in).
import { useState } from 'react';
import { useT } from '@aipowersalon/mobile-sdk';
import { useDeviceStanding, clearRemoved } from '../device/deviceState';
import { parsePairingInput, usePendingPairingCode, takePendingPairingCode, usePairingError, setPairingError } from '../device/pairing';
import { enrollDevice } from '../device/enroll';
import { wipeDeviceIdentity } from '../device/deviceKeys';
import { usePayNav } from '../shell/nav';

export function DeviceRemovedScreen({ onSetUpAgain, onSignOut }: { onSetUpAgain: () => void; onSignOut?: () => void }) {
  const tr = useT();
  return (
    <div className="pay-app pay-handoff" data-locked="true">
      <div className="pay-scroll">
        <div className="pay-state" role="alert" data-testid="device-removed">
          <div className="big">{tr('pay.device.removed')}</div>
          <div className="muted">{tr('pay.device.removedHint')}</div>
        </div>
        <button className="pay-btn" onClick={() => { clearRemoved(); onSetUpAgain(); }}>{tr('pay.device.setupAgain')}</button>
        {onSignOut && <button className="pay-linkbtn" style={{ marginTop: 12 }} onClick={onSignOut}>{tr('pay.account.signOut')}</button>}
      </div>
    </div>
  );
}

export function DeviceStandingBanner() {
  const tr = useT();
  const nav = usePayNav();
  const standing = useDeviceStanding();
  const pairErr = usePairingError();
  if (nav.locked) return null;   // the customer holds the phone — staff messages stay off the customer screen
  return (
    <>
      {pairErr ? (
        <div className="pay-note" role="alert" data-testid="pairing-error" style={{ marginBottom: 12 }}>
          <div>{pairErr || tr('pay.device.pairingInvalid')}</div>
          <button className="pay-linkbtn" onClick={() => setPairingError(null)}>{tr('pay.stepUp.cancel')}</button>
        </div>
      ) : null}
      {standing === 'pending' || standing === 'suspended' ? (
        <div className="pay-note" role="status" data-testid={`device-${standing}`} style={{ marginBottom: 12 }}>
          <strong>{tr(standing === 'pending' ? 'pay.device.pendingTitle' : 'pay.device.suspendedTitle')}</strong>
          <div>{tr(standing === 'pending' ? 'pay.device.pending' : 'pay.device.suspended')}</div>
        </div>
      ) : null}
    </>
  );
}

export function PairDeviceCard() {
  const tr = useT();
  const standing = useDeviceStanding();
  const pending = usePendingPairingCode();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const code = parsePairingInput(value) ?? pending;
  const submit = async () => {
    if (!code) { setMsg({ ok: false, text: tr('pay.device.pairingInvalid') }); return; }
    if (code === pending) takePendingPairingCode();
    setBusy(true); setMsg(null);
    // a pairing code is for a NEW phone (the server refuses it for an id it already knows): this phone takes a fresh id +
    // key first — any earlier pending registration is simply left for the owner to remove
    try { await wipeDeviceIdentity(); await enrollDevice({ pairingCode: code }); setValue(''); setMsg({ ok: true, text: tr('pay.device.paired') }); }
    catch (e: any) { setMsg({ ok: false, text: String(e?.message || tr('pay.device.pairingInvalid')) }); }
    finally { setBusy(false); }
  };
  if (standing === 'active' && !msg) return null;   // an approved phone has nothing to pair
  return (
    <div className="pay-infocard" data-testid="pair-device">
      <div className="pay-inforow"><span className="k">{tr('pay.device.pair')}</span></div>
      <div className="pay-inforow"><span className="k muted">{pending ? tr('pay.device.pairFound') : tr('pay.device.pairHint')}</span></div>
      <div className="pay-inforow" style={{ gap: 8 }}>
        <input className="pay-reasoninput" style={{ flex: 1 }} aria-label={tr('pay.device.pairPlaceholder')} placeholder={tr('pay.device.pairPlaceholder')} value={value} autoCapitalize="off" autoCorrect="off" spellCheck={false}
          onChange={(e) => setValue(e.target.value.trim())} />
        <button className="pay-chip" disabled={busy || !code} onClick={() => { void submit(); }}>{busy ? tr('pay.device.pairing') : tr('pay.device.pairSubmit')}</button>
      </div>
      {msg ? <div className={`pay-status-msg ${msg.ok ? 'ok' : 'err'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div> : null}
    </div>
  );
}
