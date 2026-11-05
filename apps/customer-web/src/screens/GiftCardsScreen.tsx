import { useEffect, useState, type CSSProperties } from 'react';
import { useInlineConfirm } from '../components/InlineConfirm';
import { customerApi, type CustomerGiftCardsState } from '../api/customerApi';
import { money2 } from '../lib/appt';

// Gift Cards — the customer's own gift cards (balance + status). Only the masked reference is shown; paying with a
// card at the salon uses a fresh short-lived code each time, never the number below.
const STATUS_LABEL: Record<string, string> = { active: 'Active', partially_redeemed: 'Active', redeemed: 'Used up', frozen: 'Frozen', suspended: 'On hold', lost_stolen: 'Reported lost', expired: 'Expired', canceled: 'Canceled', refunded: 'Refunded' };
const fmtDate = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
const MUTED = 'var(--customer-muted, #7A6C57)';

export function GiftCardsScreen() {
  const [s, setS] = useState<CustomerGiftCardsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sendingCardId, setSendingCardId] = useState<string | null>(null);
  const [lostBusyId, setLostBusyId] = useState<string | null>(null);

  const load = () => customerApi.giftCards().then(setS).catch((e: any) => setError(e?.message || 'Could not load your gift cards.'));

  useEffect(() => {
    let live = true;
    customerApi.giftCards().then((v) => { if (live) setS(v); }).catch((e: any) => live && setError(e?.message || 'Could not load your gift cards.'));
    return () => { live = false; };
  }, []);

  const { confirm: askConfirm, confirmUi } = useInlineConfirm();
  const reportLost = (id: string) => askConfirm('Report this card lost? It will be frozen and its barcode disabled right away. Visit the salon to get a replacement card with your remaining balance.', () => { void doReportLost(id); }, { confirmLabel: 'Freeze this card' });
  const doReportLost = async (id: string) => {
    setLostBusyId(id);
    try { await customerApi.reportLostGiftCard(id); await load(); }
    catch (e: any) { setError(e?.message || 'Could not report this card lost. Please try again.'); }
    finally { setLostBusyId(null); }
  };

  return (
    <div className="cust-page" style={{paddingInline:20,paddingTop:16}}>
      {confirmUi}
      <h1 className="cust-h1 " style={{fontWeight:500,marginBottom:10}}>Gift Cards</h1>
      {error ? (
        <div className="cust-card" style={{ padding: 16, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{error}</div>
      ) : !s ? (
        <>
          <div className="cust-hero" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="cust-skel" style={{ width: 120, height: 16 }} />
            <div className="cust-skel" style={{ width: 100, height: 32 }} />
            <div className="cust-skel" style={{ width: 60, height: 14 }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            {[1, 2].map((i) => (
              <div key={i} className="cust-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div className="cust-skel" style={{ width: 80, height: 18 }} />
                  <div className="cust-skel" style={{ width: 60, height: 22 }} />
                </div>
                <div className="cust-skel" style={{ width: 140, height: 16 }} />
                <div className="cust-skel" style={{ width: 180, height: 14 }} />
                {i === 1 && (
                  <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                    <div className="cust-skel" style={{ width: 120, height: 34, borderRadius: 10 }} />
                    <div className="cust-skel" style={{ width: 80, height: 34 }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="cust-hero" style={{ background: 'linear-gradient(135deg, #2A2118, #5A4326 55%, #A96F22)' }}>
            <div style={{ fontSize: 13, opacity: 0.85 }}>Gift card balance</div>
            <div style={{ fontSize: 30, fontWeight: 800, marginTop: 2 }}>{money2(s.totalBalanceCents)}</div>
            <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>{s.cards.filter((c) => c.status === 'active' || c.status === 'partially_redeemed').length} active</div>
          </div>
          {s.cards.length === 0 ? (
            <div
              className="cust-card"
              style={{
                minHeight: 220,
                padding: '36px 20px',
                marginTop: 12,
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
                🎁
              </div>
              <div className="cust-sub" style={{ fontSize: 14, maxWidth: 320, lineHeight: 1.45 }}>
                No gift cards yet. When someone sends you one — or you buy one — it shows up here.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
              {s.cards.map((c) => {
                const spent = c.status === 'redeemed' || c.status === 'canceled' || c.status === 'expired';
                return (
                  <div key={c.id} className="cust-card" style={{ padding: 16, opacity: spent ? 0.6 : 1 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <div style={{ fontWeight: 800, letterSpacing: 1 }}>{c.reference}</div>
                      <div style={{ marginLeft: 'auto', fontSize: 20, fontWeight: 800 }}>{money2(c.balanceCents)}</div>
                    </div>
                    {c.cardNumberMasked && <div style={{ fontSize: 13, color: MUTED, marginTop: 3, fontFamily: 'ui-monospace, monospace', letterSpacing: 0.5 }}>{c.cardNumberMasked}</div>}
                    <div style={{ fontSize: 12.5, color: MUTED, marginTop: 4 }}>
                      {STATUS_LABEL[c.status] || c.status}
                      {c.promoCents > 0 ? ` · includes ${money2(c.promoCents)} bonus` : ''}
                      {' · added '}{fmtDate(c.createdAt)}
                      {c.expiresAt ? ` · expires ${fmtDate(c.expiresAt)}` : ''}
                    </div>
                    {(c.status === 'active' || c.status === 'partially_redeemed') && c.balanceCents > 0 && (
                      sendingCardId === c.id
                        ? <SendGiftCardForm cardId={c.id} onClose={() => setSendingCardId(null)} />
                        : (
                          <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                            <button onClick={() => setSendingCardId(c.id)} style={{ background: 'none', border: '1px solid var(--customer-line, #E7DECF)', color: 'var(--customer-ink, #2A2118)', borderRadius: 10, padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Send to a friend →</button>
                            <button onClick={() => reportLost(c.id)} disabled={lostBusyId === c.id} style={{ background: 'none', border: 0, color: MUTED, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>{lostBusyId === c.id ? 'Reporting…' : 'Report lost'}</button>
                          </div>
                        )
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <p style={{ fontSize: 12, color: MUTED, marginTop: 14, textAlign: 'center' }}>To pay with a gift card, show it at the salon — a fresh code is generated each time, so this number stays private.</p>
        </>
      )}
    </div>
  );
}

// Inline form to gift a card to a friend: collects a recipient contact + optional note, creates a single-use claim
// link (valid 30 days), and lets the sender copy it to share. Delivery over SMS/email is a later phase.
function SendGiftCardForm({ cardId, onClose }: { cardId: string; onClose: () => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<{ channel: string; status: string } | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  const inputStyle: CSSProperties = { width: '100%', padding: '9px 11px', borderRadius: 10, border: '1px solid var(--customer-line, #E7DECF)', fontSize: 14, marginTop: 6, boxSizing: 'border-box' };
  const panelStyle: CSSProperties = { marginTop: 12, padding: 12, borderRadius: 12, background: 'var(--customer-tint, #FBF7EF)', border: '1px solid var(--customer-line, #E7DECF)' };

  const submit = async () => {
    setErr(null);
    if (!phone.trim() && !email.trim()) { setErr('Enter your friend\u2019s phone number or email.'); return; }
    setBusy(true);
    try {
      const res = await customerApi.sendGiftCard(cardId, { name: name.trim() || undefined, phone: phone.trim() || undefined, email: email.trim() || undefined, message: message.trim() || undefined });
      setDelivery(res.delivery);
      setLink(res.claimUrl || `${window.location.origin}/gift-cards/claim?token=${encodeURIComponent(res.claimToken)}`);
    } catch (e: any) { setErr(e?.message || 'Could not create the gift link. Please try again.'); }
    finally { setBusy(false); }
  };

  const copy = async () => { if (!link) return; try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard may be unavailable */ } };

  if (link) {
    return (
      <div style={panelStyle}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{delivery?.status === 'sent' ? 'Gift sent!' : 'Gift link ready'}</div>
        {delivery?.status === 'sent' && (
          <div style={{ fontSize: 12.5, color: 'var(--customer-accent, #A96F22)', fontWeight: 600, marginTop: 4 }}>\u2713 We {delivery.channel === 'email' ? 'emailed' : 'texted'} the link to {(delivery.channel === 'email' ? email.trim() : phone.trim()) || 'your friend'}. You can also share it directly below.</div>
        )}
        <div style={{ fontSize: 12.5, color: MUTED, marginTop: 3 }}>Share this private link with {name.trim() || 'your friend'}. They can claim the card into their own account \u2014 it works once and expires in 30 days.</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} style={{ ...inputStyle, marginTop: 0, fontSize: 12 }} />
          <button onClick={copy} style={{ background: 'var(--customer-accent, #A96F22)', color: '#fff', border: 0, borderRadius: 10, padding: '0 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
        <button onClick={onClose} style={{ marginTop: 10, background: 'none', border: 0, color: MUTED, fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}>Done</button>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <div style={{ fontWeight: 700, fontSize: 14 }}>Send this card to a friend</div>
      <input placeholder="Their name (optional)" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
      <input placeholder="Their phone number" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" style={inputStyle} />
      <input placeholder="\u2026or their email" value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" style={inputStyle} />
      <textarea placeholder="Add a message (optional)" value={message} onChange={(e) => setMessage(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
      {err && <div style={{ color: 'var(--customer-red, #B4342B)', fontSize: 12.5, marginTop: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
        <button onClick={submit} disabled={busy} style={{ background: 'var(--customer-accent, #A96F22)', color: '#fff', border: 0, borderRadius: 10, padding: '9px 16px', fontWeight: 700, fontSize: 14, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1 }}>{busy ? 'Creating\u2026' : 'Create gift link'}</button>
        <button onClick={onClose} disabled={busy} style={{ background: 'none', border: 0, color: MUTED, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
      </div>
    </div>
  );
}
