import { useState } from 'react';
import { superAdminApi } from '../api/superAdminApi';

// Write-side UI for the session-revocation engine. Preview (impact + self-preservation) → confirm revoke. Broad scopes
// (user/tenant/role) require a reason before preview/revoke, mirroring the server. The preview surfaces that the acting
// admin's own session is preserved and that refresh tokens are revoked with sessions.

type Preview = { scope: string; target: string; sessionsToRevoke: number; alreadyRevoked: number; refreshTokensToRevoke: number; protectedSession: boolean; message: string };
type Result = { revokedSessions: number; revokedRefreshTokens: number; message: string };
const SCOPES = [['session', 'Single session (by id)'], ['user', 'All sessions for a user'], ['tenant', 'All sessions in a tenant'], ['role', 'All sessions for a role']] as const;

export function SecuritySessionRevokeModal({ onClose }: { onClose: () => void }) {
  const [scope, setScope] = useState<string>('session');
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reasonRequired = scope !== 'session';
  const canPreview = !!target.trim() && (!reasonRequired || !!reason.trim());

  const reset = () => { setPreview(null); setResult(null); setError(null); };
  const doPreview = async () => {
    reset();
    try { setPreview((await superAdminApi.securitySessionRevokePreview({ scope, target, reason })) as Preview); }
    catch (e: any) { setError(e?.message || 'Preview failed.'); }
  };
  const doRevoke = async () => {
    if (!preview) return;
    setBusy(true); setError(null);
    try { setResult((await superAdminApi.securitySessionRevoke({ scope, target, reason })) as Result); setPreview(null); }
    catch (e: any) { setError(e?.message || 'Revoke failed.'); }
    finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.36)', zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 12px' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Revoke active sessions" style={{ width: 'min(600px, 96vw)', maxHeight: '92vh', overflow: 'auto', background: 'var(--card, #fff)', borderRadius: 10, boxShadow: '0 18px 48px rgba(0,0,0,0.24)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
          <b>Revoke Active Sessions</b>
          <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {error && <div role="alert" style={{ fontSize: 12, background: '#FBE7E4', border: '1px solid #E7B4AC', borderRadius: 8, padding: '8px 12px', color: '#8A2A1B' }}>{error}</div>}

          <label style={{ fontSize: 10.5 }} className="muted">Scope
            <select className="inp" style={{ width: '100%', height: 32, marginTop: 2 }} value={scope} onChange={(e) => { setScope(e.target.value); reset(); }}>{SCOPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label style={{ fontSize: 10.5 }} className="muted">{scope === 'session' ? 'Session id' : scope === 'user' ? 'User id' : scope === 'tenant' ? 'Tenant id' : 'Role'}
            <input className="inp" style={{ width: '100%', height: 32, marginTop: 2 }} value={target} onChange={(e) => { setTarget(e.target.value); reset(); }} placeholder="target identifier" />
          </label>
          <label style={{ fontSize: 10.5 }} className="muted">Reason{reasonRequired ? ' (required for broad scopes)' : ' (optional)'}
            <input className="inp" style={{ width: '100%', height: 32, marginTop: 2 }} value={reason} onChange={(e) => { setReason(e.target.value); reset(); }} placeholder={reasonRequired ? 'why these sessions are being revoked' : 'optional note'} />
          </label>

          <div><button className="btn ghost" onClick={doPreview} disabled={!canPreview}>Preview impact</button></div>

          {preview && (
            <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, fontSize: 11.5 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{preview.message}</div>
              <div className="muted">Sessions: {preview.sessionsToRevoke} · Refresh tokens: {preview.refreshTokensToRevoke}{preview.alreadyRevoked ? ` · Already revoked: ${preview.alreadyRevoked}` : ''}</div>
              {preview.protectedSession && <div style={{ color: '#1F9254', marginTop: 4 }}>✓ Your current session is preserved.</div>}
              <div style={{ marginTop: 10 }}><button className="btn" onClick={doRevoke} disabled={busy} style={{ background: '#C0392B', borderColor: '#C0392B' }}>Revoke {preview.sessionsToRevoke} session(s)</button></div>
            </div>
          )}

          {result && (
            <div role="status" style={{ border: '1px solid #B7E0C4', background: '#E7F5EC', borderRadius: 8, padding: 12, fontSize: 11.5, color: '#1F6B41' }}>
              {result.message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
