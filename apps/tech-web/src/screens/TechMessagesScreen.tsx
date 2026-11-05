// TechMessagesScreen — the technician's DM inbox. Lists threads; opening one shows the conversation with a reply box
// and block/report. Light polling keeps it fresh. Threads only exist for customers who booked with this technician.
import { useCallback, useEffect, useRef, useState } from 'react';
import { techApi, type TechDmThread, type TechDmMessage } from '../api/techApi';
import { useTechNav } from '../shell/nav';
const Back = () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>);
export function TechMessagesScreen() {
  const [threads, setThreads] = useState<TechDmThread[]>([]);
  const [open, setOpen] = useState<TechDmThread | null>(null);
  const [messages, setMessages] = useState<TechDmMessage[]>([]);
  const [status, setStatus] = useState('active');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
const { back } = useTechNav();
  const loadThreads = useCallback(async () => {
    try { setThreads((await techApi.dmThreads()).threads); } catch { /* ignore */ }
  }, []);
  const loadMessages = useCallback(async (threadId: string) => {
    try { const r = await techApi.dmMessages(threadId); setMessages(r.messages); setStatus(r.status); } catch { setErr('Conversation unavailable.'); }
  }, []);

  useEffect(() => { loadThreads(); const t = setInterval(loadThreads, 10000); return () => clearInterval(t); }, [loadThreads]);
  useEffect(() => { if (!open) return; loadMessages(open.threadId); const t = setInterval(() => loadMessages(open.threadId), 6000); return () => clearInterval(t); }, [open, loadMessages]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  const send = async () => {
    const body = draft.trim(); if (!body || busy || !open) return;
    setBusy(true);
    try { await techApi.dmSend(open.threadId, body); setDraft(''); await loadMessages(open.threadId); await loadThreads(); }
    catch { setErr('Message could not be sent.'); }
    finally { setBusy(false); }
  };

  if (!open) {
    return (
      <div style={{ paddingBottom: 90 }}>
        <div className="tech-topbar" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="tech-iconbtn" onClick={back} aria-label="Back" style={{ minWidth: 44 }}><Back /></button>
          <h1 className="t-title" style={{ margin: 0, fontSize: 19 }}>Messages</h1>
        </div>
        <div className="tech-main-2">
          <div className="tech-label" style={{ marginBottom: 10 }}>Messages</div>
          {threads.length === 0 ? (
            <div
              className="tech-card tech-state"
              style={{
                minHeight: 240,
                padding: '36px 16px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                boxShadow: 'none',
              }}
            >
              <div
                aria-hidden
                style={{
                  width: 58,
                  height: 58,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #FBF3E4 0%, #EFE1C9 100%)',
                  border: '1px solid #DBCAB0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 28,
                  marginBottom: 12,
                }}
              >
                💬
              </div>
              <div style={{ fontSize: 14, color: 'var(--tech-text-muted, #7A6F62)', maxWidth: 280, lineHeight: 1.45 }}>
                No conversations yet. Customers who've booked with you can start one from your profile.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {threads.map((t) => (
                <button key={t.threadId} onClick={() => { setErr(null); setOpen(t); }}
                  style={{ textAlign: 'left', border: '1px solid var(--tech-border)', borderRadius: 12, padding: 11, background: 'var(--tech-surface, #fff)', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t.customerName || 'Customer'}</div>
                    {t.technicianUnread > 0 ? <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: '#9B2C2C', borderRadius: 99, padding: '1px 7px' }}>{t.technicianUnread}</span> : null}
                    <span className="tech-muted" style={{ marginLeft: 'auto', fontSize: 11 }}>{t.lastMessageAt ? new Date(t.lastMessageAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}</span>
                  </div>
                  {t.lastMessagePreview ? <div className="tech-muted" style={{ fontSize: 12, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.lastMessagePreview}</div> : null}
                  {t.status !== 'active' ? <div className="tech-muted" style={{ fontSize: 11, marginTop: 2 }}>Closed</div> : null}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const blocked = status !== 'active';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '70vh' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid var(--tech-border)' }}>
        <button onClick={() => { setOpen(null); setMessages([]); loadThreads(); }} style={{ background: 'none', border: 'none', fontSize: 14, cursor: 'pointer' }}>← Inbox</button>
        <div style={{ fontWeight: 800, fontSize: 14 }}>{open.customerName || 'Customer'}</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          <button onClick={async () => { await techApi.dmReport(open.threadId); setErr('Reported. Thank you.'); }} style={{ background: 'none', border: 'none', fontSize: 12.5, cursor: 'pointer' }}>Report</button>
          {!blocked ? <button onClick={async () => { await techApi.dmBlock(open.threadId); await loadMessages(open.threadId); }} style={{ background: 'none', border: 'none', fontSize: 12.5, color: '#9B2C2C', cursor: 'pointer' }}>Block</button> : null}
        </div>
      </div>
      {err ? <div className="tech-muted" style={{ fontSize: 12, padding: '6px 12px', color: '#9B2C2C' }}>{err}</div> : null}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {messages.map((m) => (
          <div key={m.id} style={{ alignSelf: m.sender === 'technician' ? 'flex-end' : 'flex-start', maxWidth: '78%' }}>
            <div style={{ padding: '8px 11px', borderRadius: 14, fontSize: 13.5, background: m.sender === 'technician' ? 'var(--tech-accent, #2C5F9B)' : 'var(--tech-border)', color: m.sender === 'technician' ? '#fff' : 'inherit' }}>{m.body}</div>
            <div className="tech-muted" style={{ fontSize: 10, marginTop: 2, textAlign: m.sender === 'technician' ? 'right' : 'left' }}>{new Date(m.createdAt).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {blocked ? (
        <div className="tech-muted" style={{ fontSize: 12.5, padding: 12, textAlign: 'center', borderTop: '1px solid var(--tech-border)' }}>This conversation is closed.</div>
      ) : (
        <div style={{ display: 'flex', gap: 8, padding: 10, borderTop: '1px solid var(--tech-border)' }}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} placeholder="Reply…" maxLength={2000}
            style={{ flex: 1, fontSize: 14, padding: '9px 12px', borderRadius: 20, border: '1px solid var(--tech-border)' }} />
          <button className="tech-btn" onClick={send} disabled={busy || !draft.trim()} style={{ padding: '9px 16px', borderRadius: 20 }}>Send</button>
        </div>
      )}
    </div>
  );
}
