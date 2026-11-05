import { useInlineConfirm } from '@aipowersalon/ui';
// SettingsScreen.tsx — Super Admin Settings, scoped to what the spec actually mandates (§22 security): account
// identity, TOTP MFA enrollment (the backend chain existed end-to-end — login gates on it, support-access steps up on
// it — this screen finally makes enrollment reachable), and self password change (≥10 chars, letters+numbers, current
// password verified, current TOTP required once enrolled; audited as user_password_changed). Platform-wide settings
// (branding, notification defaults, feature flags) remain an explicit scope decision — listed, not invented.
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { authApi } from '../api/authApi';
import { superAdminApi } from '../api/superAdminApi';
import { ProfileAvatarWithPreview } from '@aipowersalon/ui';

type Health = { ok?: boolean; database?: { ok: boolean; latencyMs?: number; counts?: { tenants: number; users: number; activeSubscriptions: number } } | null; process?: { uptimeSeconds: number; node: string; env: string } | null } | null;
const uptime = (s?: number) => { if (!s) return '—'; const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };

export function SettingsScreen() {
  const { principal, setPrincipal } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [mfa, setMfa] = useState<{ enrolled: boolean; confirmed: boolean } | null>(null);
  const [enroll, setEnroll] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirmPassword: '', mfaCode: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [health, setHealth] = useState<Health>(null);

  const loadMfa = () => authApi.mfaStatus().then(setMfa).catch(() => setMfa(null));
  useEffect(() => { loadMfa(); (superAdminApi.systemHealth() as Promise<Health>).then(setHealth).catch(() => setHealth(null)); }, []);

  const handleAvatarFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    setMsg(null);
    try {
      const res = await authApi.uploadAvatar(file);
      if (res.avatarUrl && principal) {
        setPrincipal({ ...principal, avatarUrl: res.avatarUrl });
      } else if (res.avatarUrl && !principal) {
        authApi.me().then(setPrincipal).catch(() => {});
      }
      setMsg({ kind: 'ok', text: 'Profile picture updated successfully.' });
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message || 'Failed to upload profile picture.' });
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const { confirm: confirmAction, confirmUi } = useInlineConfirm();
  const handleRemoveAvatar = () => confirmAction('Remove your profile picture?', () => { void doRemoveAvatar(); }, { confirmLabel: 'Remove', destructive: true });
  const doRemoveAvatar = async () => {
    setAvatarUploading(true);
    setMsg(null);
    try {
      await authApi.removeAvatar();
      if (principal) {
        setPrincipal({ ...principal, avatarUrl: null });
      }
      setMsg({ kind: 'ok', text: 'Profile picture removed.' });
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message || 'Failed to remove profile picture.' });
    } finally {
      setAvatarUploading(false);
    }
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setMsg(null);
    try { await fn(); } catch (e: any) { setMsg({ kind: 'err', text: e?.message || 'Action failed.' }); } finally { setBusy(null); }
  };
  const startEnroll = () => run('enroll', async () => {
    const r = await authApi.mfaEnroll();
    setEnroll({ secret: r.secret, otpauthUri: r.otpauthUri });
    setMsg({ kind: 'ok', text: 'Secret generated — add it to your authenticator, then confirm with the current code. It is shown once.' });
  });
  const doConfirm = () => run('confirm', async () => {
    await authApi.mfaConfirm(confirmCode.trim());
    setEnroll(null); setConfirmCode(''); await loadMfa();
    setMsg({ kind: 'ok', text: 'MFA confirmed. Login and Support Access now require your authenticator code.' });
  });
  const doChangePw = () => run('pw', async () => {
    await authApi.changePassword({ ...pw, mfaCode: pw.mfaCode || undefined });
    setPw({ currentPassword: '', newPassword: '', confirmPassword: '', mfaCode: '' });
    setMsg({ kind: 'ok', text: 'Password changed.' });
  });
  const copy = (text: string, what: string) => { navigator.clipboard?.writeText(text).then(() => setMsg({ kind: 'ok', text: `${what} copied.` })).catch(() => {}); };

  return (
    <div className="work" style={{ overflowY: 'auto', height: '100%' }}>
      {confirmUi}
      <div className="vh"><h1>Settings</h1><div className="sub">Super Admin account &amp; security (spec §22)</div></div>
      {msg ? <div className={msg.kind === 'err' ? 'err' : 'panel'} style={{ margin: '10px 0', padding: 12, fontSize: 13, ...(msg.kind === 'ok' ? { background: '#EEF7EF', borderColor: '#BFE3C6', color: '#2F6B41' } : {}) }} onClick={() => setMsg(null)}>{msg.text} — tap to dismiss</div> : null}

      <section className="panel" style={{ marginTop: 12 }}>
        <h2>Account</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap', margin: '12px 0' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <ProfileAvatarWithPreview
              name={principal?.fullName || 'Super Admin'}
              url={principal?.avatarUrl}
              size={72}
              type="superadmin"
              badgeLabel="Super Admin Profile"
              subtitle="Platform Super Admin"
              showPreview={true}
            />
            <span className="muted" style={{ fontSize: 11 }}>Click avatar to preview</span>
          </div>

          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="s" style={{ lineHeight: 1.9, marginBottom: 12 }}>
              <div><span className="muted">Name:</span> <b>{principal?.fullName || '—'}</b></div>
              <div><span className="muted">Role:</span> <b>{principal?.role || '—'}</b> <span className="muted">· platform scope (no tenant)</span></div>
              <div><span className="muted">MFA:</span> {mfa === null ? '…' : mfa.confirmed ? <span className="pill ok">Active</span> : mfa.enrolled ? <span className="pill warn">Pending confirmation</span> : <span className="pill">Not enrolled</span>}</div>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                style={{ display: 'none' }}
                onChange={handleAvatarFileSelect}
              />
              <button
                className="btn"
                disabled={avatarUploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {avatarUploading ? 'Uploading…' : principal?.avatarUrl ? 'Change Profile Photo' : 'Upload Profile Photo'}
              </button>
              {principal?.avatarUrl ? (
                <button
                  className="btn ghost"
                  disabled={avatarUploading}
                  onClick={handleRemoveAvatar}
                  style={{ color: '#D32F2F', borderColor: '#FFCDD2' }}
                >
                  Remove Photo
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="panel" style={{ marginTop: 14 }}>
        <h2>Two-factor authentication (TOTP)</h2>
        {mfa?.confirmed ? (
          <div className="s">MFA is active on this account. Login and Start Support Session require the current authenticator code; codes can never be reused (replay-guarded).</div>
        ) : enroll ? (
          <div>
            <div className="s" style={{ marginBottom: 10 }}>Add this account to your authenticator app (Google Authenticator, 1Password, Authy…), then enter the current 6-digit code:</div>
            <div className="fieldrow" style={{ marginBottom: 10 }}>
              <input readOnly value={enroll.secret} style={{ flex: 1, minWidth: 220, fontFamily: 'monospace' }} aria-label="TOTP secret" />
              <button className="btn ghost" onClick={() => copy(enroll.secret, 'Secret')}>Copy Secret</button>
              <button className="btn ghost" onClick={() => copy(enroll.otpauthUri, 'Setup link')}>Copy Setup Link</button>
            </div>
            <div className="fieldrow">
              <input inputMode="numeric" placeholder="6-digit code" value={confirmCode} onChange={(e) => setConfirmCode(e.target.value)} style={{ width: 150 }} />
              <button className="btn" disabled={confirmCode.trim().length < 6 || busy === 'confirm'} onClick={doConfirm}>{busy === 'confirm' ? 'Confirming…' : 'Confirm & Activate'}</button>
              <button className="btn ghost" onClick={() => { setEnroll(null); setConfirmCode(''); }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="fieldrow">
            <div className="s" style={{ flex: 1, minWidth: 260 }}>Protect this account with an authenticator app. Once active, login and Support Access step-up require the live code.</div>
            <button className="btn" disabled={busy === 'enroll'} onClick={startEnroll}>{busy === 'enroll' ? 'Generating…' : mfa?.enrolled ? 'Restart Enrollment' : 'Enroll MFA'}</button>
          </div>
        )}
      </section>

      <section className="panel" style={{ marginTop: 14 }}>
        <h2>Change password</h2>
        <div className="fieldrow" style={{ marginBottom: 10 }}>
          <input type="password" placeholder="Current password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} style={{ minWidth: 200 }} />
          <input type="password" placeholder="New password (min 10, letters + numbers)" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} style={{ minWidth: 250 }} />
          <input type="password" placeholder="Confirm new password" autoComplete="new-password" value={pw.confirmPassword} onChange={(e) => setPw({ ...pw, confirmPassword: e.target.value })} style={{ minWidth: 200 }} />
          {mfa?.confirmed ? <input inputMode="numeric" placeholder="MFA code" value={pw.mfaCode} onChange={(e) => setPw({ ...pw, mfaCode: e.target.value })} style={{ width: 120 }} /> : null}
          <button className="btn" disabled={busy === 'pw' || !pw.currentPassword || !pw.newPassword || !pw.confirmPassword || (mfa?.confirmed ? !pw.mfaCode : false)} onClick={doChangePw}>{busy === 'pw' ? 'Saving…' : 'Change Password'}</button>
        </div>
        <div className="s muted">Verified against your current password{mfa?.confirmed ? ' and your live MFA code (replay-guarded)' : ''}; the change is written to the audit log.</div>
      </section>

      <section className="panel" style={{ marginTop: 14 }}>
        <h2>Platform settings</h2>
        {health ? (
          <div className="s" style={{ lineHeight: 1.9, marginBottom: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
              <div><span className="muted">Environment:</span> <b style={{ textTransform: 'capitalize' }}>{health.process?.env || '—'}</b></div>
              <div><span className="muted">Node:</span> <b>{health.process?.node || '—'}</b></div>
              <div><span className="muted">Uptime:</span> <b>{uptime(health.process?.uptimeSeconds)}</b></div>
              <div><span className="muted">Database:</span> {health.database?.ok ? <span className="pill ok">Operational{health.database?.latencyMs != null ? ` · ${health.database.latencyMs}ms` : ''}</span> : <span className="pill warn">Unavailable</span>}</div>
              <div><span className="muted">Tenants:</span> <b>{health.database?.counts?.tenants ?? '—'}</b></div>
              <div><span className="muted">Users:</span> <b>{health.database?.counts?.users ?? '—'}</b></div>
              <div><span className="muted">Active subscriptions:</span> <b>{health.database?.counts?.activeSubscriptions ?? '—'}</b></div>
            </div>
          </div>
        ) : null}
        <div className="s muted">Configurable platform-wide options (branding, notification defaults, tenant feature-flag editor) are not built yet — they need a scope decision rather than invented controls. Everything security-mandated by the spec (§22) is live above; platform status shown is read-only.</div>
      </section>
    </div>
  );
}
