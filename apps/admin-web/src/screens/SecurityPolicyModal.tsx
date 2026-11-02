import { useEffect, useState, useCallback } from 'react';
import { superAdminApi } from '../api/superAdminApi';

// Write-side UI for the security-policy engine (MFA / password / session). Loads the active policy, edits config, saves a
// new version, and shows the engine's live compliance verdict (Compliant / Review + the specific failing checks). A
// weak-but-valid policy still saves and is shown as Review with reasons — mirrors the server, no fabrication.

type Kind = 'mfa' | 'password' | 'session';
type GetResp = { kind: string; available: boolean; version?: number; config?: Record<string, unknown>; compliant?: boolean; complianceFailing?: string[]; note?: string };
type SetResp = { kind: string; version: number; compliant: boolean; complianceFailing: string[] };

type Field = { key: string; label: string; type: 'number' | 'bool' | 'multi'; options?: string[] };
const FIELDS: Record<Kind, Field[]> = {
  password: [
    { key: 'minLength', label: 'Min length', type: 'number' }, { key: 'maxLength', label: 'Max length', type: 'number' },
    { key: 'historyCount', label: 'History count', type: 'number' }, { key: 'lockoutThreshold', label: 'Lockout threshold', type: 'number' },
    { key: 'compromisedCheck', label: 'Compromised-password detection', type: 'bool' }, { key: 'commonRejection', label: 'Reject common passwords', type: 'bool' },
  ],
  session: [
    { key: 'idleMinutes', label: 'Idle timeout (min)', type: 'number' }, { key: 'absoluteHours', label: 'Absolute lifetime (h)', type: 'number' },
    { key: 'refreshDays', label: 'Refresh lifetime (days)', type: 'number' }, { key: 'privilegedIdleMinutes', label: 'Privileged idle (min)', type: 'number' },
    { key: 'concurrentLimit', label: 'Concurrent sessions', type: 'number' }, { key: 'reauthForSensitive', label: 'Step-up for sensitive actions', type: 'bool' },
  ],
  mfa: [
    { key: 'requiredRoles', label: 'Required roles', type: 'multi', options: ['SUPER_ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK', 'TECHNICIAN'] },
    { key: 'methods', label: 'Approved methods', type: 'multi', options: ['authenticator', 'passkey', 'sms'] },
    { key: 'graceDays', label: 'Grace period (days)', type: 'number' },
  ],
};
const TABS: [Kind, string][] = [['mfa', 'MFA'], ['password', 'Password'], ['session', 'Session']];

export function SecurityPolicyModal({ onClose, initialKind = 'mfa' }: { onClose: () => void; initialKind?: Kind }) {
  const [kind, setKind] = useState<Kind>(initialKind);
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [loaded, setLoaded] = useState<GetResp | null>(null);
  const [result, setResult] = useState<SetResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getFn = useCallback((k: Kind) => k === 'mfa' ? superAdminApi.securityMfaPolicy() : k === 'password' ? superAdminApi.securityPasswordPolicy() : superAdminApi.securitySessionPolicy(), []);
  const load = useCallback((k: Kind) => {
    setResult(null); setError(null); setLoaded(null);
    (getFn(k) as Promise<GetResp>).then((r) => { setLoaded(r); setConfig(r.available && r.config ? r.config : {}); }).catch((e: any) => setError(e?.message || 'Failed to load policy.'));
  }, [getFn]);
  useEffect(() => { load(kind); }, [kind, load]);

  const setField = (key: string, val: unknown) => { setConfig((c) => ({ ...c, [key]: val })); setResult(null); };
  const toggleMulti = (key: string, opt: string) => setConfig((c) => { const cur = Array.isArray(c[key]) ? (c[key] as string[]) : []; return { ...c, [key]: cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt] }; });

  const save = async () => {
    setBusy(true); setError(null);
    const setFn = kind === 'mfa' ? superAdminApi.securityMfaPolicySet : kind === 'password' ? superAdminApi.securityPasswordPolicySet : superAdminApi.securitySessionPolicySet;
    try { setResult((await setFn(config)) as SetResp); }
    catch (e: any) { setError(e?.message || 'Save failed.'); }
    finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.36)', zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 12px' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Security policies" style={{ width: 'min(620px, 96vw)', maxHeight: '92vh', overflow: 'auto', background: 'var(--card, #fff)', borderRadius: 10, boxShadow: '0 18px 48px rgba(0,0,0,0.24)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
          <b>Security Policies</b>
          <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ display: 'flex', gap: 4, padding: '8px 16px 0' }}>
          {TABS.map(([k, l]) => <button key={k} className={k === kind ? 'btn' : 'btn ghost'} style={{ height: 30, fontSize: 12 }} onClick={() => setKind(k)}>{l}</button>)}
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {error && <div role="alert" style={{ fontSize: 12, background: '#FBE7E4', border: '1px solid #E7B4AC', borderRadius: 8, padding: '8px 12px', color: '#8A2A1B' }}>{error}</div>}
          {loaded && !loaded.available && <div className="muted" style={{ fontSize: 11.5 }}>No active {kind} policy yet — configure and save to create version 1.</div>}
          {loaded && loaded.available && <div className="muted" style={{ fontSize: 11 }}>Active version {loaded.version} · {loaded.compliant ? 'Compliant' : 'Review'}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {FIELDS[kind].map((f) => (
              <div key={f.key} style={{ gridColumn: f.type === 'multi' ? '1 / -1' : 'auto' }}>
                {f.type === 'number' && (
                  <label style={{ fontSize: 10.5 }} className="muted">{f.label}
                    <input className="inp" type="number" style={{ width: '100%', height: 32, marginTop: 2 }} value={config[f.key] == null ? '' : String(config[f.key])} onChange={(e) => setField(f.key, e.target.value === '' ? '' : Number(e.target.value))} />
                  </label>
                )}
                {f.type === 'bool' && (
                  <label style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 6, marginTop: 16 }}>
                    <input type="checkbox" checked={config[f.key] === true} onChange={(e) => setField(f.key, e.target.checked)} aria-label={f.label} />{f.label}
                  </label>
                )}
                {f.type === 'multi' && (
                  <div><div style={{ fontSize: 10.5 }} className="muted">{f.label}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>{f.options!.map((opt) => {
                      const on = Array.isArray(config[f.key]) && (config[f.key] as string[]).includes(opt);
                      return <label key={opt} style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={on} onChange={() => toggleMulti(f.key, opt)} aria-label={`${f.label}: ${opt}`} />{opt}</label>;
                    })}</div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div><button className="btn" onClick={save} disabled={busy}>Save policy</button></div>

          {result && (
            <div role="status" style={{ border: `1px solid ${result.compliant ? '#B7E0C4' : '#F0D9A8'}`, background: result.compliant ? '#E7F5EC' : '#FBF0DC', borderRadius: 8, padding: 12, fontSize: 11.5 }}>
              <div style={{ fontWeight: 600, color: result.compliant ? '#1F6B41' : '#8A6D1B' }}>Saved v{result.version} — {result.compliant ? 'Compliant ✓' : 'Review'}</div>
              {!result.compliant && result.complianceFailing?.length > 0 && (
                <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: '#8A6D1B' }}>{result.complianceFailing.map((f, i) => <li key={i}>{f}</li>)}</ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
