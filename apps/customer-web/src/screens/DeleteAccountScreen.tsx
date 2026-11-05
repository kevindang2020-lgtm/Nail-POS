import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { customerApi, type AccountDeletionResult } from '../api/customerApi';

// Delete Account (Apple-required where accounts exist). Records a deletion REQUEST via the backend — it explains what is
// removed and what must be retained by law, then confirms. It never silently wipes financial/audit records.
export function DeleteAccountScreen() {
  const nav = useNavigate();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AccountDeletionResult | null>(null);

  const submit = async () => {
    setBusy(true); setError(null);
    try { setResult(await customerApi.requestAccountDeletion(reason.trim() || undefined)); }
    catch (e: any) { setError(e?.message || 'Could not submit your request. Please try again.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <button
          onClick={() => nav(-1)}
          aria-label="Back"
          className='customer-back'
        
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1 className="cust-h1" style={{ fontSize: 20 }}>Delete Account</h1>
      </div>

      {result ? (
        <>
          <div className="cust-card" style={{ padding: 16, borderLeft: '4px solid var(--customer-primary)' }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Request received</div>
            <div className="cust-sub" style={{ fontSize: 14, lineHeight: 1.5 }}>{result.message}</div>
          </div>
          <div className="cust-card" style={{ padding: 16 }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>What will be removed</div>
            <ul style={{ margin: 0, paddingLeft: 18 }} className="cust-sub">{result.willRemove.map((x) => <li key={x} style={{ marginBottom: 4 }}>{x}</li>)}</ul>
          </div>
          <div className="cust-card" style={{ padding: 16 }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>What we must keep</div>
            <ul style={{ margin: 0, paddingLeft: 18 }} className="cust-sub">{result.willRetain.map((x) => <li key={x} style={{ marginBottom: 4 }}>{x}</li>)}</ul>
          </div>
          <button onClick={() => nav('/profile')} className="cust-btn cust-btn-ghost" style={{ height: 48 }}>Back to Profile</button>
        </>
      ) : (
        <>
          <div className="cust-card" style={{ padding: 16 }}>
            <div className="cust-sub" style={{ fontSize: 14, lineHeight: 1.5 }}>
              Requesting account deletion will remove your profile, saved details, preferences, and loyalty profile.
              Completed payment and receipt records are retained as required by law. We’ll confirm by email and process
              your request.
            </div>
          </div>
          <label className="cust-label" htmlFor="reason">Reason (optional)</label>
          <textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Tell us why you’re leaving (optional)"
            className="cust-card" style={{ padding: 12, fontFamily: 'inherit', fontSize: 14, resize: 'vertical', border: '1px solid var(--customer-border)' }} />
          {error ? <div className="cust-sub" style={{ color: 'var(--customer-red)' }}>{error}</div> : null}
          <button onClick={submit} disabled={busy} className="cust-btn" style={{ height: 50, background: 'var(--customer-red)' }}>
            {busy ? 'Submitting…' : 'Request account deletion'}
          </button>
          <button onClick={() => nav(-1)} className="cust-btn cust-btn-ghost" style={{ height: 48 }}>Cancel</button>
          <div className="cust-sub" style={{ fontSize: 12, textAlign: 'center' }}>You can also request a copy of your data from Profile → Settings.</div>
        </>
      )}
    </div>
  );
}
