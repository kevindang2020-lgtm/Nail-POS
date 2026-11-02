// CashPendingScreen.tsx — Skip-the-Line cash confirmation (Tech App). Lists cash the customer chose to pay this
// technician; Confirm closes the ticket, Did-Not-Pay routes it to the front desk. Server enforces tenant + assignment.
import { useCallback, useEffect, useState } from 'react';
import { techApi, type TechCashPendingItem } from '../api/techApi';
import { useTechNav } from '../shell/nav';
import { money2 } from '../lib/tech';
import { useTechStream } from '../lib/useTechStream';

const Back = () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>);

export function CashPendingScreen() {
  const nav = useTechNav();
  const [items, setItems] = useState<TechCashPendingItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => { try { const r = await techApi.cashPending(); setItems(r.items || []); setError(null); } catch (e: any) { setError(e?.message || 'Could not load cash payments.'); } }, []);
  useEffect(() => { load(); }, [load]);
  useTechStream(load);

  const confirm = async (it: TechCashPendingItem) => {
    setBusy(it.ticketId); setToast(null);
    try { const r = await techApi.confirmCashReceived(it.ticketId); setToast(`Confirmed ${money2(r.amountCents)} from ${it.customerName || 'customer'} — ticket closed.`); setItems((xs) => (xs || []).filter((x) => x.ticketId !== it.ticketId)); }
    catch (e: any) { setToast(e?.message || 'Could not confirm.'); }
    finally { setBusy(null); }
  };
  const reportNotPaid = async (it: TechCashPendingItem) => {
    setBusy(it.ticketId); setToast(null);
    try { await techApi.reportCashNotPaid(it.ticketId, note.trim() || undefined); setToast('Sent to the front desk.'); setItems((xs) => (xs || []).filter((x) => x.ticketId !== it.ticketId)); setNoteFor(null); setNote(''); }
    catch (e: any) { setToast(e?.message || 'Could not report.'); }
    finally { setBusy(null); }
  };

  return (
    <div style={{ paddingBottom: 90 }}>
      <div className="tech-topbar" style={{ marginBottom: 16, position: 'sticky' }}>
        <button className="tech-iconbtn" aria-label="Back" onClick={() => nav.back()}><Back /></button>
        <div className="tech-h-serif" style={{ fontSize: 18 }}>Cash Pending</div>
      </div>
      <div className="tech-main-2">

      {items && items.length > 0 ? (
        <div className="tech-card" style={{ padding: 16, marginBottom: 12, background: 'linear-gradient(180deg, #FBF1DD, #F6E7C6)', border: '1px solid var(--tech-gold-soft)' }}>
          <div className="tech-eyebrow" style={{ color: 'var(--tech-primary-dark)' }}>Cash to collect</div>
          <div style={{ fontWeight: 800, fontSize: 30, marginTop: 2 }}><span>{money2(items.reduce((s, i) => s + (i.amountCents || 0), 0))} ·</span> <span className="tech-muted" style={{ fontSize: 13, fontWeight: 600 }}>{items.length} payment{items.length > 1 ? 's' : ''}</span></div>
        </div>
      ) : null}

      {toast ? <div className="tech-card" style={{ padding: 12, marginBottom: 12, background: 'var(--tech-success-bg)', color: 'var(--tech-success)', border: 0 }} role="status">{toast}</div> : null}

      {error ? <div className="tech-card" style={{ padding: 14, color: 'var(--tech-danger)', background: 'var(--tech-danger-bg)', border: 0 }} role="alert">{error}</div>
        : !items ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[1, 2].map(i => (
              <div key={i} className="tech-card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <div className="tech-skel" style={{ width: 120, height: 20 }} />
                  <div className="tech-skel" style={{ width: 60, height: 20, borderRadius: 12 }} />
                </div>
                <div className="tech-skel" style={{ width: '70%', height: 16, marginTop: 8 }} />
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '14px 0' }}>
                  <div className="tech-skel" style={{ width: 60, height: 16 }} />
                  <div className="tech-skel" style={{ width: 80, height: 32 }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="tech-skel" style={{ width: '100%', height: 50, borderRadius: 10 }} />
                  <div className="tech-skel" style={{ width: '100%', height: 46, borderRadius: 10 }} />
                </div>
              </div>
            ))}
          </div>
        )
        : items.length === 0 ? (
          <div className="tech-card" style={{ padding: 28, textAlign: 'center' }}>
            <div style={{ fontSize: 32 }} aria-hidden>💵</div>
            <div className="tech-h-serif" style={{ marginTop: 8, fontSize: 17 }}>No cash payments waiting</div>
            <div className="tech-muted" style={{ marginTop: 4 }}>When a customer chooses to pay you in cash, it’ll appear here to confirm.</div>
          </div>
        ) : items.map((it) => (
          <div key={it.confirmationId} className="tech-card" style={{ padding: 16, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{it.customerName || 'Customer'}</div>
              <div className="tech-chip">{it.ticketNumber}</div>
            </div>
            <div className="tech-muted" style={{ marginTop: 4, fontSize: 13 }}>{it.services.map((s) => s.serviceName).join(' · ') || 'Services'}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '14px 0' }}>
              <span className="tech-muted" style={{ fontSize: 13 }}>Cash due</span>
              <span style={{ fontWeight: 800, fontSize: 26 }}>{money2(it.amountCents)}</span>
            </div>
            {noteFor === it.ticketId ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (optional)" aria-label="Reason"
                  style={{ height: 44, borderRadius: 10, border: '1px solid var(--tech-border)', padding: '0 12px', font: 'inherit', background: 'var(--tech-surface)', color: 'var(--tech-text)' }} />
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => { setNoteFor(null); setNote(''); }} className="tech-btn" style={{ background: 'var(--tech-surface-soft)', color: 'var(--tech-text)' }}>Cancel</button>
                  <button onClick={() => reportNotPaid(it)} disabled={busy === it.ticketId} className="tech-btn" style={{ background: 'var(--tech-danger)' }}>{busy === it.ticketId ? 'Sending…' : 'Confirm: not paid'}</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button onClick={() => confirm(it)} disabled={busy === it.ticketId} className="tech-btn" style={{ height: 50, background: 'var(--tech-success)' }}>{busy === it.ticketId ? 'Confirming…' : 'Confirm Cash Received'}</button>
                <button onClick={() => { setNoteFor(it.ticketId); setNote(''); }} disabled={busy === it.ticketId} className="tech-btn" style={{ height: 46, background: 'transparent', color: 'var(--tech-danger)', border: '1px solid var(--tech-danger)' }}>Customer Did Not Pay</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
