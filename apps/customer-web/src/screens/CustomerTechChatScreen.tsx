// CustomerTechChatScreen — a customer's DM thread with a technician. Loads on mount + light polling, sends messages,
// and offers block/report. The booked-only gate + accepts-messages switch are enforced server-side; this screen only
// opens threads the customer is allowed to have.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { customerApi, type TechDmMessage } from '../api/customerApi';

export function CustomerTechChatScreen() {
  const { threadId = '' } = useParams();
  const nav = useNavigate();
  const [messages, setMessages] = useState<TechDmMessage[]>([]);
  const [status, setStatus] = useState<string>('active');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try { const r = await customerApi.techMessageList(threadId); setMessages(r.messages); setStatus(r.status); setError(null); }
    catch { setError('This conversation is unavailable.'); }
  }, [threadId]);

  useEffect(() => { load(); const t = setInterval(load, 6000); return () => clearInterval(t); }, [load]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  const send = async () => {
    const body = draft.trim(); if (!body || busy) return;
    setBusy(true);
    try { await customerApi.techMessageSend(threadId, body); setDraft(''); await load(); }
    catch { setError('Message could not be sent.'); }
    finally { setBusy(false); }
  };

  const blocked = status !== 'active';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '70vh' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid var(--customer-border)' }}>
        <button className="cust-link" onClick={() => nav(-1)} style={{ background: 'none', border: 'none', fontSize: 14, cursor: 'pointer' }}>← Back</button>
        <div style={{ fontWeight: 800, fontSize: 15 }}>Messages</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          <button className="cust-link" onClick={async () => { await customerApi.techMessageReport(threadId); setError('Reported. Thank you.'); }} style={{ background: 'none', border: 'none', fontSize: 12.5, cursor: 'pointer' }}>Report</button>
          {!blocked ? <button className="cust-link" onClick={async () => { await customerApi.techMessageBlock(threadId); await load(); }} style={{ background: 'none', border: 'none', fontSize: 12.5, color: '#9B2C2C', cursor: 'pointer' }}>Block</button> : null}
        </div>
      </div>

      {error ? <div className="cust-sub" style={{ fontSize: 12, padding: '6px 12px', color: '#9B2C2C' }}>{error}</div> : null}

      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {messages.length === 0 ? <div className="cust-sub" style={{ fontSize: 12.5 }}>Say hello 👋</div> : null}
        {messages.map((m) => (
          <div key={m.id} style={{ alignSelf: m.sender === 'customer' ? 'flex-end' : 'flex-start', maxWidth: '78%' }}>
            <div style={{ padding: '8px 11px', borderRadius: 14, fontSize: 13.5, background: m.sender === 'customer' ? 'var(--customer-accent, #A96F22)' : 'var(--customer-border)', color: m.sender === 'customer' ? '#fff' : 'inherit' }}>{m.body}</div>
            <div className="cust-sub" style={{ fontSize: 10, marginTop: 2, textAlign: m.sender === 'customer' ? 'right' : 'left' }}>{new Date(m.createdAt).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {blocked ? (
        <div className="cust-sub" style={{ fontSize: 12.5, padding: 12, textAlign: 'center', borderTop: '1px solid var(--customer-border)' }}>This conversation is closed.</div>
      ) : (
        <div style={{ display: 'flex', gap: 8, padding: 10, borderTop: '1px solid var(--customer-border)' }}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} placeholder="Type a message…" maxLength={2000}
            style={{ flex: 1, fontSize: 14, padding: '9px 12px', borderRadius: 20, border: '1px solid var(--customer-border)' }} />
          <button className="cust-btn" onClick={send} disabled={busy || !draft.trim()} style={{ padding: '9px 16px', borderRadius: 20 }}>Send</button>
        </div>
      )}
    </div>
  );
}
