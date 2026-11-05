// TechCashHandoffScreen.tsx — End-of-Day cash hand-off (Tech App). Shows the cash this technician collected today
// (from confirmed Skip-the-Line cash payments) and lets them hand it to the front desk. After hand-off it reflects the
// front desk's count: reconciled (matched) or a discrepancy. All amounts are server-computed; the client sends no ids.
import { useCallback, useEffect, useState } from 'react';
import { techApi, type TechCashHandoff } from '../api/techApi';
import { useTechNav } from '../shell/nav';
import { money2, clock } from '../lib/tech';
import { useTechStream } from '../lib/useTechStream';

const Back = () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>);

// format the server's business date (YYYY-MM-DD) in local time, flagging today
function fmtBusinessDate(s: string): string {
  const [y, m, d] = (s || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  const dt = new Date(y, m - 1, d);
  const isToday = dt.toDateString() === new Date().toDateString();
  return (isToday ? 'Today · ' : '') + dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function TechCashHandoffScreen() {
  const nav = useTechNav();
  const [h, setH] = useState<TechCashHandoff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => { try { const r = await techApi.cashHandoff(); setH(r); setError(null); } catch (e: any) { setError(e?.message || 'Could not load your cash for today.'); } }, []);
  useEffect(() => { load(); }, [load]);
  useTechStream(load); // front-desk reconcile pushes an update -> refresh

  const submit = async () => {
    setBusy(true); setToast(null);
    try { const r = await techApi.submitCashHandoff(); setH(r); setToast('Handed off to the front desk.'); }
    catch (e: any) { setToast(e?.message || 'Could not hand off.'); }
    finally { setBusy(false); }
  };

  const status = h?.status ?? 'open';
  const variance = h?.varianceCents ?? 0;
  const over = variance > 0;

  return (
    <div style={{ paddingBottom: 90 }}>
      <div className="tech-topbar" style={{ marginBottom: 16, position: 'sticky' }}>
        <button className="tech-iconbtn" aria-label="Back" onClick={() => nav.back()}><Back /></button>
        <div className="tech-h-serif" style={{ fontSize: 18 }}>End-of-Day Cash</div>
      </div>
      <div className="tech-main-2">

      {toast ? <div className="tech-card" style={{ padding: 12, marginBottom: 12, background: 'var(--tech-success-bg)', color: 'var(--tech-success)', border: 0 }} role="status">{toast}</div> : null}

      {error ? <div className="tech-card" style={{ padding: 14, color: 'var(--tech-danger)', background: 'var(--tech-danger-bg)', border: 0 }} role="alert">{error}</div>
        : !h ? (
        <>
          <div className="tech-card" style={{ padding: 18, marginBottom: 12 }}>
            <div className="tech-skel" style={{ width: 120, height: 14, marginBottom: 6 }} />
            <div className="tech-skel" style={{ width: 150, height: 14, marginBottom: 6 }} />
            <div className="tech-skel" style={{ width: 100, height: 38, margin: '6px 0 2px' }} />
            <div className="tech-skel" style={{ width: 120, height: 14 }} />
            <div style={{ marginTop: 16 }}>
              <div className="tech-skel" style={{ width: '100%', height: 52, borderRadius: 8 }} />
            </div>
          </div>
          <div className="tech-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px' }}><div className="tech-skel" style={{ width: 120, height: 14 }} /></div>
            {[1, 2, 3].map(i => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--tech-border)' }}>
                <div style={{ flex: 1 }}>
                  <div className="tech-skel" style={{ width: '60%', height: 16, marginBottom: 4 }} />
                  <div className="tech-skel" style={{ width: '40%', height: 14 }} />
                </div>
                <div className="tech-skel" style={{ width: 60, height: 20 }} />
              </div>
            ))}
          </div>
        </>
        )
        : (
        <>
          <div className="tech-card" style={{ padding: 18, marginBottom: 12 }}>
            {fmtBusinessDate(h.businessDate) ? <div className="tech-eyebrow" style={{ color: 'var(--tech-primary-dark)', marginBottom: 6 }}>{fmtBusinessDate(h.businessDate)}</div> : null}
            <div className="tech-muted" style={{ fontSize: 13 }}>Cash you collected today</div>
            <div style={{ fontWeight: 800, fontSize: 38, lineHeight: 1.1, margin: '6px 0 2px' }}>{money2(h.expectedCents)}</div>
            <div className="tech-muted" style={{ fontSize: 13 }}>{h.paymentCount} cash {h.paymentCount === 1 ? 'payment' : 'payments'}</div>

            {/* status block */}
            <div style={{ marginTop: 16 }}>
              {status === 'open' && (
                h.expectedCents > 0
                  ? <button onClick={submit} disabled={busy} className="tech-btn" style={{ height: 52, width: '100%', background: 'var(--tech-success)' }}>{busy ? 'Handing off…' : 'Hand off to front desk'}</button>
                  : <div className="tech-card" style={{ padding: 14, textAlign: 'center', background: 'var(--tech-surface-soft)' }}><div className="tech-muted">No cash to hand off today.</div></div>
              )}
              {status === 'submitted' && (
                <div className="tech-card" style={{ padding: 14, border: 0, background: 'var(--tech-surface-soft)' }}>
                  <div style={{ fontWeight: 800 }}>Handed off ✓</div>
                  <div className="tech-muted" style={{ fontSize: 13, marginTop: 2 }}>Waiting for the front desk to count it.{h.submittedAt ? ` Sent ${clock(h.submittedAt)}.` : ''}</div>
                </div>
              )}
              {status === 'reconciled' && (
                <div className="tech-card" style={{ padding: 14, border: 0, background: 'var(--tech-success-bg)', color: 'var(--tech-success)' }}>
                  <div style={{ fontWeight: 800 }}>Reconciled ✓</div>
                  <div style={{ fontSize: 13, marginTop: 2 }}>Front desk counted {money2(h.countedCents)} — matched exactly.</div>
                </div>
              )}
              {status === 'discrepancy' && (
                <div className="tech-card" style={{ padding: 14, border: 0, background: 'var(--tech-danger-bg)', color: 'var(--tech-danger)' }}>
                  <div style={{ fontWeight: 800 }}>{over ? 'Over' : 'Short'} by {money2(Math.abs(variance))}</div>
                  <div style={{ fontSize: 13, marginTop: 2 }}>Counted {money2(h.countedCents)} against {money2(h.expectedCents)} expected.{h.notes ? ` Note: ${h.notes}` : ''}</div>
                </div>
              )}
            </div>
          </div>

          {/* line items */}
          <div className="tech-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', fontWeight: 800, fontSize: 13 }} className="tech-muted">CASH PAYMENTS</div>
            {h.lines.length === 0 ? (
              <div
                style={{
                  minHeight: 240,
                  padding: '36px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
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
                  💵
                </div>
                <div style={{ fontSize: 14, color: 'var(--tech-text-muted, #7A6F62)', maxWidth: 280, lineHeight: 1.45 }}>
                  No cash payments recorded today.
                </div>
              </div>
            ) : h.lines.map((l, i) => (
                <div key={l.ticketId + i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--tech-border)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.customerName || 'Customer'}</div>
                    <div className="tech-muted" style={{ fontSize: 12 }}>{l.ticketNumber}{l.confirmedAt ? ` · ${clock(l.confirmedAt)}` : ''}</div>
                  </div>
                  <div style={{ fontWeight: 800 }}>{money2(l.amountCents)}</div>
                </div>
              ))}
          </div>
        </>
      )}
      </div>
    </div>
  );
}
