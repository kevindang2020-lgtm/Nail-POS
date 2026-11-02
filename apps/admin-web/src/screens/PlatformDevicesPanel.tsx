// PlatformDevicesPanel — S-A13 (Security Deep Scan §29 / §136): the devices this platform account signs in from. Super Admin
// sign-in is refused from a device not approved for platform use; from this (approved) device the account approves
// another one (the server asks for the password / authenticator again — step-up) or signs a device out.
import { useEffect, useState } from 'react';
import { authApi, type AuthDeviceRow } from '../api/authApi';

export function PlatformDevicesPanel() {
  const [rows, setRows] = useState<AuthDeviceRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => authApi.devices().then((r) => { setRows(r.devices ?? []); setErr(null); }).catch((e: any) => { setRows([]); setErr(e?.message || 'Could not load your devices.'); });
  useEffect(() => { void load(); }, []);
  const act = async (id: string, fn: (id: string) => Promise<unknown>) => {
    setBusy(id); setErr(null);
    try { await fn(id); await load(); } catch (e: any) { setErr(e?.message || 'That did not work.'); } finally { setBusy(null); }
  };
  return (
    <section className="panel" style={{ marginTop: 14 }} data-testid="platform-devices">
      <h2>Devices</h2>
      <div className="s muted" style={{ marginBottom: 10 }}>Super Admin sign-in works only from an approved device. A new device gets an approval email at sign-in, or you approve it here.</div>
      {rows === null ? <div className="s muted">Loading…</div> : rows.length === 0 ? <div className="s muted">No devices.</div> : (
        <table className="table">
          <thead><tr><th>Device</th><th>Last used</th><th>Super Admin</th><th /></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td>{d.name || 'Device'}{d.current ? <span className="pill ok" style={{ marginLeft: 6 }}>This device</span> : null}</td>
                <td>{new Date(d.lastSeenAt).toLocaleString()}</td>
                <td>{d.platformApprovedAt ? <span className="pill ok">Approved</span> : <span className="pill warn">Not approved</span>}</td>
                <td style={{ textAlign: 'right' }}>
                  {!d.platformApprovedAt ? <button className="btn" disabled={busy === d.id} onClick={() => act(d.id, authApi.approvePlatformDevice)}>Approve</button> : null}
                  {!d.current ? <button className="btn ghost" disabled={busy === d.id} onClick={() => act(d.id, authApi.revokeDevice)} style={{ marginLeft: 6 }}>Sign out</button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {err ? <div className="error" role="alert">{err}</div> : null}
    </section>
  );
}
