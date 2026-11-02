// PlatformStaffScreen — Constitution 7 §24–§26: the platform's own staff and their roles.
// A role change needs a reason and passes the server's rules (only a Platform Super Admin may change roles, never their
// own, never beyond their own permissions, and never the last active Platform Super Admin). The target's sessions are
// revoked so the new role applies on their next sign-in. The server is the authority; this screen shows its answer.
import { useCallback, useEffect, useState } from 'react';
import type { PlatformStaffList } from '@aipowersalon/api-contracts/platform';
import { superAdminApi } from '../api/superAdminApi';

export const PLATFORM_ROLE_LABELS: Record<string, string> = {
  PLATFORM_SUPER_ADMIN: 'Super Admin', PLATFORM_ADMIN: 'Admin', PLATFORM_SUPPORT: 'Support', PLATFORM_FINANCE: 'Finance',
  PLATFORM_SECURITY: 'Security', PLATFORM_OPERATIONS: 'Operations', PLATFORM_AUDITOR: 'Auditor (read-only)', PLATFORM_AI_ADMIN: 'AI Admin',
  PLATFORM_BILLING_ADMIN: 'Billing Admin', PLATFORM_ONBOARDING: 'Onboarding', PLATFORM_DEVELOPER_SUPPORT: 'Developer Support',
};

export function PlatformStaffScreen() {
  const [data, setData] = useState<PlatformStaffList | 'error' | null>(null);
  const [edit, setEdit] = useState<{ userId: string; role: string; reason: string } | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // §24: suspend / reactivate and the sessions panel
  const [act, setAct] = useState<{ userId: string; kind: 'status' | 'revoke' | 'mfa'; to?: 'active' | 'suspended'; reason: string } | null>(null);
  const [recovery, setRecovery] = useState<{ link: string; expiresAt: string } | null>(null);
  const [sess, setSess] = useState<{ userId: string; rows: any[] } | null>(null);
  const openSessions = async (userId: string) => { try { const r = await superAdminApi.platformUserSessions(userId); setSess({ userId, rows: r.rows }); } catch (e: any) { setMsg({ tone: 'err', text: e?.message || 'Sessions could not be loaded.' }); } };
  const runAct = async () => {
    if (!act) return;
    setBusy(true); setMsg(null);
    try {
      if (act.kind === 'status') { await superAdminApi.setPlatformUserStatus(act.userId, act.to!, act.reason.trim()); setMsg({ tone: 'ok', text: act.to === 'suspended' ? 'Account suspended and signed out everywhere.' : 'Account reactivated.' }); }
      else if (act.kind === 'mfa') { const r = await superAdminApi.resetPlatformUserMfa(act.userId, act.reason.trim()); setRecovery({ link: `${window.location.origin}${r.recoveryPath}`, expiresAt: r.expiresAt }); setMsg({ tone: 'ok', text: 'MFA reset. Their sessions were signed out. Send them the one-time link below, privately.' }); }
      else { const r = await superAdminApi.revokePlatformUserSessions(act.userId, act.reason.trim()); setMsg({ tone: 'ok', text: `${r.revoked} session(s) signed out.` }); if (sess?.userId === act.userId) openSessions(act.userId); }
      setAct(null); load();
    } catch (e: any) { setMsg({ tone: 'err', text: e?.message || 'That change could not be made.' }); } finally { setBusy(false); }
  };
  const load = useCallback(() => { superAdminApi.platformStaff().then(setData).catch(() => setData('error')); }, []);
  useEffect(load, [load]);

  const save = async () => {
    if (!edit) return;
    setBusy(true); setMsg(null);
    try {
      const r = await superAdminApi.changePlatformRole(edit.userId, edit.role, edit.reason);
      setMsg({ tone: 'ok', text: `Role changed to ${PLATFORM_ROLE_LABELS[r.to] ?? r.to}. Their sessions were signed out so it applies on next sign-in.` });
      setEdit(null); load();
    } catch (e: any) {
      setMsg({ tone: 'err', text: e?.message || 'The role could not be changed.' });   // the server's own reason (e.g. last Super Admin)
    } finally { setBusy(false); }
  };

  return (
    <div className="screen">
      <div className="panel" data-testid="platform-staff">
        <div className="phead"><h2>Platform Staff</h2><span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>AI PowerSalon team accounts and their platform roles</span></div>
        {msg ? <div className={msg.tone === 'ok' ? 'notice' : 'error'} role="status" style={{ marginBottom: 8 }}>{msg.text}</div> : null}
        {data === null ? <div className="state">Loading platform staff…</div>
          : data === 'error' ? <div className="state">Platform staff could not be loaded.</div>
          : data.rows.length === 0 ? <div className="state">No platform accounts.</div>
          : (
            <table className="table">
              <thead><tr><th>Account</th><th>Role</th><th>Status</th><th>Last sign-in</th><th /></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.userId}>
                    <td>{r.fullName || r.email || r.userId}{r.fullName && r.email ? <div className="muted" style={{ fontSize: 11 }}>{r.email}</div> : null}</td>
                    <td>{r.platformRole ? (PLATFORM_ROLE_LABELS[r.platformRole] ?? r.platformRole) : <span className="muted">Not set (read-only)</span>}</td>
                    <td>{r.status}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{r.lastLoginAt ? new Date(r.lastLoginAt).toLocaleString() : '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn ghost" onClick={() => { setMsg(null); setEdit({ userId: r.userId, role: r.platformRole || 'PLATFORM_AUDITOR', reason: '' }); }}>Change role</button>
                      <button className="btn ghost" onClick={() => { setMsg(null); setAct({ userId: r.userId, kind: 'status', to: r.status === 'suspended' ? 'active' : 'suspended', reason: '' }); }}>{r.status === 'suspended' ? 'Reactivate' : 'Suspend'}</button>
                      <button className="btn ghost" onClick={() => openSessions(r.userId)}>Sessions</button>
                      <button className="btn ghost" onClick={() => { setMsg(null); setRecovery(null); setAct({ userId: r.userId, kind: 'mfa', reason: '' }); }}>Reset MFA</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        {act ? (
          <div className="panel" data-testid="staff-action" style={{ marginTop: 10 }}>
            <b>{act.kind === 'mfa' ? 'Reset MFA (removes their authenticator; they re-enrol with a one-time link + their password)' : act.kind === 'revoke' ? 'Sign out all sessions' : act.to === 'suspended' ? 'Suspend account (signs them out everywhere)' : 'Reactivate account'}</b>
            <label style={{ display: 'block', marginTop: 8 }}>Reason (required)
              <input aria-label="Action reason" value={act.reason} onChange={(e) => setAct({ ...act, reason: e.target.value })} style={{ width: '100%' }} />
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn" disabled={busy || act.reason.trim().length < 10} onClick={runAct}>Confirm</button>
              <button className="btn ghost" onClick={() => setAct(null)}>Cancel</button>
            </div>
          </div>
        ) : null}
        {recovery ? (
          <div className="panel" data-testid="mfa-recovery-link" style={{ marginTop: 10 }}>
            <b>One-time recovery link</b> <span className="muted" style={{ fontSize: 12 }}>(expires {new Date(recovery.expiresAt).toLocaleString()}; shown once)</span>
            <input aria-label="Recovery link" readOnly value={recovery.link} style={{ width: '100%', marginTop: 6 }} onFocus={(e) => e.currentTarget.select()} />
          </div>
        ) : null}
        {sess ? (
          <div className="panel" data-testid="staff-sessions" style={{ marginTop: 10 }}>
            <div className="phead"><h2>Sessions</h2><button className="linkbtn" onClick={() => setSess(null)}>Close</button></div>
            {sess.rows.length === 0 ? <div className="state">No sessions.</div> : (
              <table className="table"><thead><tr><th>Started</th><th>Last seen</th><th>Device</th><th>IP</th><th>State</th></tr></thead>
                <tbody>{sess.rows.map((x) => (
                  <tr key={x.id}><td>{new Date(x.createdAt).toLocaleString()}</td><td>{x.lastSeenAt ? new Date(x.lastSeenAt).toLocaleString() : '—'}</td>
                    <td>{x.device || x.userAgent || '—'}</td><td>{x.ip || '—'}</td><td>{x.revokedAt ? 'Signed out' : x.status}</td></tr>
                ))}</tbody></table>
            )}
            <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setAct({ userId: sess.userId, kind: 'revoke', reason: '' })}>Sign out all sessions</button>
          </div>
        ) : null}
        {edit ? (
          <div className="panel" data-testid="role-editor" style={{ marginTop: 10 }}>
            <label>New role{' '}
              <select aria-label="New role" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
                {Object.entries(PLATFORM_ROLE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label style={{ display: 'block', marginTop: 8 }}>Reason (required)
              <input aria-label="Reason" value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} style={{ width: '100%' }} />
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn" disabled={busy || edit.reason.trim().length < 10} onClick={save}>{busy ? 'Saving…' : 'Change role'}</button>
              <button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
