import { useState } from 'react';
import { useTechNav } from '../shell/nav';
import { techAccountApi, type TechAccountRequestResult } from '../api/techApi';
const Back = () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>);

// Account deactivation request (Apple-required). Technicians deactivate rather than hard-delete: work/financial records
// must be retained. Records a request via /tech/me/delete-account-request and explains retain vs remove.
export function TechDeleteAccountScreen() {
  const nav = useTechNav();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TechAccountRequestResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const submit = async () => {
    setBusy(true); setError(null);
    try { setResult(await techAccountApi.requestDeactivation(reason.trim() || undefined)); }
    catch (e: any) { setError(e?.message || 'Could not submit your request.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ paddingBottom: 90 }}>
      <div className="tech-topbar" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
        <button onClick={nav.back} aria-label="Back" className="tech-iconbtn"><Back /></button>
        <div style={{ margin: 0, fontSize: 19 }}>Account Deactivation</div>
      </div>
      <div className="tech-main-2">
        {result ? (
          <>
            <div className="tech-card" style={{ marginBottom: 10, padding: 14, borderLeft: '4px solid var(--tech-accent, #A96F22)' }}><div className="tech-h-serif" style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Request received</div><div style={{ fontSize: 13.5, lineHeight: 1.5, opacity: 0.85 }}>{result.message}</div>{result.contactEmail ? <div className="tech-muted" style={{ fontSize: 12.5, marginTop: 6 }}>We’ll email confirmation to {result.contactEmail}.</div> : null}</div>
            <div className="tech-card" style={{ marginBottom: 10, padding: 14 }}><div className="tech-h-serif" style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>What will be removed</div><ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, opacity: 0.85 }}>{result.willRemove.map((x) => <li key={x} style={{ marginBottom: 4 }}>{x}</li>)}</ul></div>
            <div className="tech-card" style={{ marginBottom: 10, padding: 14 }}><div className="tech-h-serif" style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>What we must keep</div><ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, opacity: 0.85 }}>{result.willRetain.map((x) => <li key={x} style={{ marginBottom: 4 }}>{x}</li>)}</ul></div>
            <button className="tech-btn outline" onClick={nav.back}>Back to More</button>
          </>
        ) : (
          <>
            <div className="tech-card" style={{ marginBottom: 10, padding: 14, fontSize: 13.5, lineHeight: 1.5, opacity: 0.85 }}>Deactivating disables your sign-in and removes personal contact details from your profile. Tickets, commissions, and financial records tied to your work are retained as required by law. We’ll confirm by email.</div>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Reason (optional)" className="tech-card" style={{ width: '100%', boxSizing: 'border-box', padding: 12, fontFamily: 'inherit', fontSize: 13.5, resize: 'vertical', marginBottom: 10 }} />
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, lineHeight: 1.4, margin: '0 0 10px', cursor: 'pointer' }}>
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} style={{ marginTop: 2, flex: '0 0 auto' }} aria-label="I understand" />
              <span>I understand my sign-in will be disabled and my contact details removed. Tickets, commissions, and financial records tied to my work are retained as required.</span>
            </label>
            {error ? <div className="tech-muted" style={{ color: 'var(--tech-danger)', fontSize: 13, marginBottom: 8 }}>{error}</div> : null}
            <button className="tech-btn danger-outline" disabled={busy || !confirmed} onClick={submit}>{busy ? 'Submitting…' : 'Request account deactivation'}</button>
            <button className="tech-btn outline" style={{ marginTop: 8 }} onClick={nav.back}>Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}
