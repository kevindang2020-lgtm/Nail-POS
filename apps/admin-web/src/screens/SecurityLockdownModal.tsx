import { useEffect, useState, useCallback } from 'react';
import { useInlineAsk } from '@aipowersalon/ui';
import { superAdminApi } from '../api/superAdminApi';

// Write-side UI for the emergency-lockdown engine. A deliberate, multi-step wizard — NEVER one-click: propose → confirm
// (step-up re-auth + EXACT typed phrase) → execute → lift. The client mirrors the server's two-factor gate (Confirm is
// disabled until both the step-up box is checked AND the typed phrase matches). The initiator is never locked out.

type LockdownRow = { id: string; lockdownRef: string; scope: string; target: string | null; status: string };
type Proposed = { lockdown: LockdownRow; confirmationPhrase: string };
const SCOPES = [['account', 'Single account'], ['tenant', 'Tenant'], ['platform', 'Platform-wide']] as const;
const cap = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

export function SecurityLockdownModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<LockdownRow[] | null>(null);
  const [step, setStep] = useState<'propose' | 'confirm' | 'execute'>('propose');
  const [scope, setScope] = useState('account');
  const { ask, askUi } = useInlineAsk();
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [proposed, setProposed] = useState<Proposed | null>(null);
  const [typedPhrase, setTypedPhrase] = useState('');
  const [stepUp, setStepUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(() => { (superAdminApi.securityLockdowns() as Promise<LockdownRow[]>).then(setRows).catch((e: any) => setError(e?.message || 'Failed to load lockdowns.')); }, []);
  useEffect(() => { load(); }, [load]);

  const targetNeeded = scope === 'account' || scope === 'tenant';
  const canPropose = (!targetNeeded || !!target.trim()) && !!reason.trim();
  const phraseMatches = proposed ? typedPhrase === proposed.confirmationPhrase : false;

  const doPropose = async () => {
    setBusy(true); setError(null);
    try { const p = (await superAdminApi.securityLockdownPropose({ scope, target: targetNeeded ? target : null, reason })) as Proposed; setProposed(p); setStep('confirm'); }
    catch (e: any) { setError(e?.message || 'Proposal failed.'); }
    finally { setBusy(false); }
  };
  const doConfirm = async () => {
    if (!proposed || !phraseMatches || !stepUp) return;
    setBusy(true); setError(null);
    try { await superAdminApi.securityLockdownConfirm(proposed.lockdown.id, { confirmationPhrase: typedPhrase, stepUpVerified: true }); setStep('execute'); }
    catch (e: any) { setError(e?.message || 'Confirmation failed.'); }
    finally { setBusy(false); }
  };
  const doExecute = async () => {
    if (!proposed) return;
    setBusy(true); setError(null);
    try { await superAdminApi.securityLockdownExecute(proposed.lockdown.id); setDone(`Lockdown ${proposed.lockdown.lockdownRef} is active.`); setStep('propose'); setProposed(null); setTypedPhrase(''); setStepUp(false); setTarget(''); setReason(''); load(); }
    catch (e: any) { setError(e?.message || 'Execution failed.'); }
    finally { setBusy(false); }
  };
  const doLift = async (id: string) => {
    ask('Reason for lifting this lockdown:', (why) => { void doLiftNow(id, why); });
  };
  const doLiftNow = async (id: string, why: string) => {
    setBusy(true); setError(null);
    try { await superAdminApi.securityLockdownLift(id, { reason: why }); load(); }
    catch (e: any) { setError(e?.message || 'Lift failed.'); }
    finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.4)', zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 12px' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Emergency lockdown" style={{ width: 'min(600px, 96vw)', maxHeight: '92vh', overflow: 'auto', background: 'var(--card, #fff)', borderRadius: 10, boxShadow: '0 18px 48px rgba(0,0,0,0.24)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--line)', background: '#FBE7E4' }}>
          <b style={{ color: '#8A2A1B' }}>🔒 Emergency Lockdown</b>
          <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {error && <div role="alert" style={{ fontSize: 12, background: '#FBE7E4', border: '1px solid #E7B4AC', borderRadius: 8, padding: '8px 12px', color: '#8A2A1B' }}>{error}</div>}
          {done && <div role="status" style={{ fontSize: 12, background: '#E7F5EC', border: '1px solid #B7E0C4', borderRadius: 8, padding: '8px 12px', color: '#1F6B41' }}>{done}</div>}

          <div className="muted" style={{ fontSize: 11 }}>Step {step === 'propose' ? '1 of 3 — Propose' : step === 'confirm' ? '2 of 3 — Confirm (step-up + phrase)' : '3 of 3 — Execute'}. This is intentionally never one-click; you are never locked out of your own session.</div>

          {step === 'propose' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 10.5 }} className="muted">Scope
                <select className="inp" style={{ width: '100%', height: 32, marginTop: 2 }} value={scope} onChange={(e) => setScope(e.target.value)}>{SCOPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </label>
              {targetNeeded && (
                <label style={{ fontSize: 10.5 }} className="muted">{scope === 'account' ? 'User id' : 'Tenant id'}
                  <input className="inp" style={{ width: '100%', height: 32, marginTop: 2 }} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="target identifier" />
                </label>
              )}
              <label style={{ fontSize: 10.5 }} className="muted">Reason (required)
                <input className="inp" style={{ width: '100%', height: 32, marginTop: 2 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="why the lockdown is being initiated" />
              </label>
              <div><button className="btn" onClick={doPropose} disabled={busy || !canPropose} style={{ background: '#C0392B', borderColor: '#C0392B' }}>Propose lockdown</button></div>
            </div>
          )}

          {step === 'confirm' && proposed && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11.5 }}>Type this exact phrase to confirm: <b style={{ fontFamily: 'monospace' }}>{proposed.confirmationPhrase}</b></div>
              <input className="inp" style={{ width: '100%', height: 32 }} value={typedPhrase} onChange={(e) => setTypedPhrase(e.target.value)} placeholder="type the confirmation phrase" aria-label="confirmation phrase" />
              <label style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={stepUp} onChange={(e) => setStepUp(e.target.checked)} aria-label="step-up re-authentication verified" />I have completed step-up re-authentication</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn" onClick={doConfirm} disabled={busy || !phraseMatches || !stepUp} style={{ background: '#C0392B', borderColor: '#C0392B' }}>Confirm</button>
                <button className="btn ghost" onClick={() => { setStep('propose'); setProposed(null); }}>Cancel</button>
              </div>
            </div>
          )}

          {step === 'execute' && proposed && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11.5 }}>Confirmed. Executing will revoke in-scope sessions (your session preserved) and activate the lockdown.</div>
              <div><button className="btn" onClick={doExecute} disabled={busy} style={{ background: '#C0392B', borderColor: '#C0392B' }}>Execute lockdown</button></div>
            </div>
          )}

          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Recent lockdowns</div>
            {rows === null ? <div className="muted" style={{ fontSize: 12 }}>Loading…</div>
              : rows.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No lockdowns recorded.</div>
              : (
                <table className="tgrid" style={{ width: '100%', fontSize: 11.5 }}>
                  <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10 }}><th>Ref</th><th>Scope</th><th>Status</th><th></th></tr></thead>
                  <tbody>{rows.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontFamily: 'monospace', fontSize: 10.5 }}>{r.lockdownRef}</td>
                      <td>{cap(r.scope)}</td>
                      <td><span style={{ fontWeight: 600, color: r.status === 'active' ? '#C0392B' : '#6B7280' }}>{cap(r.status)}</span></td>
                      <td>{r.status === 'active' ? <button className="linkbtn" style={{ fontSize: 10.5 }} disabled={busy} onClick={() => doLift(r.id)}>Lift</button> : null}</td>
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
