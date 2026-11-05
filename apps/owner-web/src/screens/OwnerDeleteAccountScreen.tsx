import { useState } from 'react';
import { useOwnerNav } from '../shell/nav';
import { ownerAccountApi, type OwnerAccountRequestResult } from '../api/ownerApi';

// Account deactivation request (Apple-required). Owners deactivate rather than hard-delete: business/financial records
// must be retained. Records a request via /owner/me/delete-account-request and explains retain vs remove.
export function OwnerDeleteAccountScreen() {
  const { back } = useOwnerNav();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OwnerAccountRequestResult | null>(null);

  const submit = async () => {
    setBusy(true); setError(null);
    try { setResult(await ownerAccountApi.requestDeactivation(reason.trim() || undefined)); }
    catch (e: any) { setError(e?.message || 'Could not submit your request.'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <header className="owner-header">
        <button className="owner-back" aria-label="Back" onClick={back}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--owner-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg></button>
        <div className="owner-greet" style={{ textAlign: 'center' }}><div className="n owner-serif" style={{ cursor: 'default', justifyContent: 'center' }}>Account Deactivation</div></div>
        <div style={{ width: 40 }} />
      </header>
      <div style={{ padding: '4px 14px 18px', display: 'grid', gap: 12 }}>
        {result ? (
          <>
            <div className="owner-chartcard" style={{ borderLeft: '4px solid var(--gold-700, #A96F22)' }}><div className="owner-serif" style={{ fontWeight: 700, marginBottom: 6 }}>Request received</div><div className="muted" style={{ fontSize: 13.5, lineHeight: 1.5 }}>{result.message}</div></div>
            <div className="owner-chartcard"><div className="owner-serif" style={{ fontWeight: 700, marginBottom: 6 }}>What will be removed</div><ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 13.5 }}>{result.willRemove.map((x) => <li key={x} style={{ marginBottom: 4 }}>{x}</li>)}</ul></div>
            <div className="owner-chartcard"><div className="owner-serif" style={{ fontWeight: 700, marginBottom: 6 }}>What we must keep</div><ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 13.5 }}>{result.willRetain.map((x) => <li key={x} style={{ marginBottom: 4 }}>{x}</li>)}</ul></div>
            <button onClick={back} className="owner-menurow" style={{ justifyContent: 'center' }}>Back to More</button>
          </>
        ) : (
          <>
            <div className="owner-chartcard"><div className="muted" style={{ fontSize: 13.5, lineHeight: 1.5 }}>Deactivating disables your sign-in and removes personal contact details from your profile. Tickets, commissions, and financial records tied to your business are retained as required by law. We’ll confirm by email.</div></div>
            <label className="muted" style={{ fontSize: 12, fontWeight: 700 }} htmlFor="reason">Reason (optional)</label>
            <textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Optional" className="owner-chartcard" style={{ padding: 12, fontFamily: 'inherit', fontSize: 13.5, resize: 'vertical' }} />
            {error ? <div className="muted" style={{ color: '#b3261e', fontSize: 13 }}>{error}</div> : null}
            <button onClick={submit} disabled={busy} className="owner-menurow danger" style={{ justifyContent: 'center', fontWeight: 700 }}>{busy ? 'Submitting…' : 'Request account deactivation'}</button>
            <button onClick={back} className="owner-menurow" style={{ justifyContent: 'center' }}>Cancel</button>
          </>
        )}
      </div>
    </>
  );
}
