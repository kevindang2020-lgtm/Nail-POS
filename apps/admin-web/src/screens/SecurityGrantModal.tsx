import { useEffect, useState, useCallback } from 'react';
import { useInlineAsk } from '@aipowersalon/ui';
import { superAdminApi } from '../api/superAdminApi';

// Write-side UI for the privileged-access engine. Request a time-boxed elevation → approve (separation of duties: you
// cannot approve your own request; the server enforces it and this surfaces the 403) → revoke. Expiry is mandatory and
// bounded — the request form requires a future expiry, mirroring the server.

type GrantRow = { id: string; grantRef: string; userId: string; privilege: string; scope: string; status: string; expiresAt: string | null };
const PRIVILEGES = ['super_admin', 'owner', 'manager_override', 'billing_admin', 'security_admin', 'support_elevated'];
const SCOPES = [['platform', 'Platform'], ['tenant', 'Tenant']] as const;
const cap = (s: string) => s ? s.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : s;
const fmt = (s: string | null) => { if (!s) return '—'; try { return new Date(s).toLocaleString(); } catch { return '—'; } };

export function SecurityGrantModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<GrantRow[] | null>(null);
  const [userId, setUserId] = useState('');
  const [privilege, setPrivilege] = useState('security_admin');
  const { ask, askUi } = useInlineAsk();
  const [scope, setScope] = useState('platform');
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => { (superAdminApi.securityPrivilegedGrants() as Promise<GrantRow[]>).then(setRows).catch((e: any) => setError(e?.message || 'Failed to load grants.')); }, []);
  useEffect(() => { load(); }, [load]);

  const targetNeeded = scope === 'tenant';
  const futureExpiry = !!expiresAt && new Date(expiresAt).getTime() > Date.now();
  const canRequest = !!userId.trim() && !!reason.trim() && futureExpiry && (!targetNeeded || !!target.trim());

  const doRequest = async () => {
    setBusy(true); setError(null);
    try { await superAdminApi.securityPrivilegedGrantRequest({ userId, privilege, scope, target: targetNeeded ? target : null, reason, expiresAt: new Date(expiresAt).toISOString() }); setUserId(''); setReason(''); setExpiresAt(''); setTarget(''); load(); }
    catch (e: any) { setError(e?.message || 'Request failed.'); }
    finally { setBusy(false); }
  };
  const doApprove = async (id: string) => {
    setBusy(true); setError(null);
    try { await superAdminApi.securityPrivilegedGrantApprove(id); load(); }
    catch (e: any) { setError(e?.message || 'Approve failed (note: you cannot approve your own request).'); }
    finally { setBusy(false); }
  };
  const doRevoke = async (id: string) => {
    ask('Reason for revoking this elevation:', (why) => { void doRevokeNow(id, why); });
  };
  const doRevokeNow = async (id: string, why: string) => {
    setBusy(true); setError(null);
    try { await superAdminApi.securityPrivilegedGrantRevoke(id, { reason: why }); load(); }
    catch (e: any) { setError(e?.message || 'Revoke failed.'); }
    finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.36)', zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 12px' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Privileged access grants" style={{ width: 'min(720px, 96vw)', maxHeight: '92vh', overflow: 'auto', background: 'var(--card, #fff)', borderRadius: 10, boxShadow: '0 18px 48px rgba(0,0,0,0.24)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
          <b>Privileged Access Grants</b>
          <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {error && <div role="alert" style={{ fontSize: 12, background: '#FBE7E4', border: '1px solid #E7B4AC', borderRadius: 8, padding: '8px 12px', color: '#8A2A1B' }}>{error}</div>}

          <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Request a time-boxed elevation</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ fontSize: 10.5 }} className="muted">User id
                <input className="inp" style={{ width: '100%', height: 32, marginTop: 2 }} value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="user to elevate" />
              </label>
              <label style={{ fontSize: 10.5 }} className="muted">Privilege
                <select className="inp" style={{ width: '100%', height: 32, marginTop: 2 }} value={privilege} onChange={(e) => setPrivilege(e.target.value)}>{PRIVILEGES.map((p) => <option key={p} value={p}>{cap(p)}</option>)}</select>
              </label>
              <label style={{ fontSize: 10.5 }} className="muted">Scope
                <select className="inp" style={{ width: '100%', height: 32, marginTop: 2 }} value={scope} onChange={(e) => setScope(e.target.value)}>{SCOPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </label>
              {targetNeeded && (
                <label style={{ fontSize: 10.5 }} className="muted">Tenant id
                  <input className="inp" style={{ width: '100%', height: 32, marginTop: 2 }} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="target tenant" />
                </label>
              )}
              <label style={{ fontSize: 10.5 }} className="muted">Expires at (required)
                <input className="inp" type="datetime-local" style={{ width: '100%', height: 32, marginTop: 2 }} value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} aria-label="expires at" />
              </label>
              <label style={{ fontSize: 10.5 }} className="muted">Reason / justification
                <input className="inp" style={{ width: '100%', height: 32, marginTop: 2 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="why this elevation is needed" />
              </label>
            </div>
            {expiresAt && !futureExpiry && <div style={{ fontSize: 10.5, color: '#C0392B', marginTop: 4 }}>Expiry must be in the future (grants are always time-boxed).</div>}
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
              <button className="btn" onClick={doRequest} disabled={busy || !canRequest}>Request elevation</button>
              <span className="muted" style={{ fontSize: 10 }}>Separation of duties: a different admin must approve.</span>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Grants</div>
            {rows === null ? <div className="muted" style={{ fontSize: 12 }}>Loading…</div>
              : rows.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No grants recorded.</div>
              : (
                <table className="tgrid" style={{ width: '100%', fontSize: 11.5 }}>
                  <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10 }}><th>Ref</th><th>User</th><th>Privilege</th><th>Status</th><th>Expires</th><th></th></tr></thead>
                  <tbody>{rows.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontFamily: 'monospace', fontSize: 10 }}>{r.grantRef}</td>
                      <td className="muted" style={{ fontSize: 10.5 }}>{r.userId}</td>
                      <td>{cap(r.privilege)}</td>
                      <td><span style={{ fontWeight: 600, color: r.status === 'active' ? '#1F9254' : r.status === 'pending' ? '#B7791F' : '#6B7280' }}>{cap(r.status)}</span></td>
                      <td className="muted" style={{ fontSize: 10 }}>{fmt(r.expiresAt)}</td>
                      <td>
                        {r.status === 'pending' ? <button className="linkbtn" style={{ fontSize: 10.5 }} disabled={busy} onClick={() => doApprove(r.id)}>Approve</button>
                          : r.status === 'active' ? <button className="linkbtn" style={{ fontSize: 10.5, color: '#C0392B' }} disabled={busy} onClick={() => doRevoke(r.id)}>Revoke</button>
                          : <span className="muted" style={{ fontSize: 10 }}>—</span>}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
          </div>
        </div>
      </div>
      {askUi}
    </div>
  );
}
