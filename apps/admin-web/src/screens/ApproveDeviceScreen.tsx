// ApproveDeviceScreen — S-A13 (Security Deep Scan §29 / §136): the page a platform user opens from the one-time "approve a new
// device" email. Opening the page approves nothing (mail scanners pre-fetch links); pressing Approve POSTs the token. No
// session exists or is created here; afterwards the person signs in again from the approved device.
import { useState } from 'react';
import { authApi } from '../api/authApi';

export function ApproveDeviceScreen() {
  const token = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('token') ?? '' : '';
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const approve = async () => {
    setBusy(true); setErr(null);
    try { await authApi.approveDeviceByToken(token); setDone(true); }
    catch (e: any) { setErr(e?.message || 'This link is not valid.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="login-wrap" data-testid="approve-device" style={{ maxWidth: 440, margin: '60px auto' }}>
      <h2>Approve a new device</h2>
      {!token ? <p className="error">This link is incomplete. Sign in again from the device to get a new one.</p>
        : done ? <p role="status">Device approved. <a href="/">Sign in again</a> from it.</p>
        : (
          <>
            <p className="muted">Approve only if you just signed in to Super Admin from a new device yourself. If you did not, do not approve — change your password now.</p>
            <button className="btn" disabled={busy} onClick={approve}>{busy ? 'Approving…' : 'Approve this device'}</button>
          </>
        )}
      {err ? <div className="error" role="alert">{err}</div> : null}
    </div>
  );
}
