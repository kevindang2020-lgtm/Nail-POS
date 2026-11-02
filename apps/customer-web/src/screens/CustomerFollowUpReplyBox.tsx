import { useState } from 'react';

// Reply box on the follow-up detail. Only rendered when the salon allows replies. Sends through the backend, which sets
// the follow-up status to "replied". Honest disabled/error states.
export function CustomerFollowUpReplyBox({ onSend }: { onSend: (text: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const clean = text.trim();
    if (!clean) return;
    setBusy(true); setError(null);
    try { await onSend(clean); setSent(true); setText(''); }
    catch (e) { setError((e as { message?: string })?.message || 'Could not send your reply.'); }
    finally { setBusy(false); }
  };

  if (sent) return <div className="cust-sub" style={{ fontSize: 13 }}>Reply sent ✓</div>;
  return (
    <div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label="Reply to your technician"
        placeholder="Write a reply…"
        style={{ width: '100%', border: '1px solid var(--customer-border)', borderRadius: 14, padding: 12, fontFamily: 'inherit', fontSize: 14, resize: 'vertical', color: 'var(--customer-text)' }} />
      {error ? <div style={{ color: 'var(--customer-red)', fontSize: 12.5, marginTop: 6 }} role="alert">{error}</div> : null}
      <button className="cust-btn cust-btn-ghost" style={{ height: 44, marginTop: 8 }} disabled={busy || !text.trim()} onClick={send}>{busy ? 'Sending…' : 'Send reply'}</button>
    </div>
  );
}
