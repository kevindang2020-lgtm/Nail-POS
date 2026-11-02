import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { customerApi, type CustomerPaymentMethod } from '../api/customerApi';

// Payment Methods (Profile → Payment Methods) — real saved cards over /customer/payment-methods. The card number is
// never typed into this app: the add-card form is the salon's CardSecure hosted iFrame tokenizer (Fiserv "Hosted iFrame
// Tokenizer"), served from the gateway's own host. The card number, expiry and CVV are entered THERE; only a token comes
// back (postMessage from that origin), and only the token + display fields (last4/expiry) are sent to our API (PCI SAQ A).
// The old form sent the raw card number as the "token" — the API now refuses that.

export function PaymentMethodsScreen() {
  const nav = useNavigate();
  const [items, setItems] = useState<CustomerPaymentMethod[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  // the salon's hosted tokenizer; null = still loading; available:false = the salon has no card gateway yet
  const [tok, setTok] = useState<{ available: boolean; url?: string; origin?: string } | null>(null);
  const [pending, setPending] = useState<{ token: string; expMonth?: number; expYear?: number } | null>(null);
  useEffect(() => {
    if (!adding || tok) return;
    customerApi.paymentTokenizer().then(setTok).catch(() => setTok({ available: false }));
  }, [adding, tok]);
  // CardSecure posts {"message": "<token>", "expiry": "YYYYMM", "validationError": "..."} to the parent window
  useEffect(() => {
    if (!adding || !tok?.available || !tok.origin) return;
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== tok.origin) return;                        // only the gateway's own page may hand us a token
      let d: any = e.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return; } }
      if (d?.validationError) { setError(String(d.validationError)); setPending(null); return; }
      const token = String(d?.message ?? ''); if (!/^9\d{12,18}$/.test(token)) return;   // a CardSecure token, never a card number
      const ex = String(d?.expiry ?? ''); const m = /^(\d{4})(\d{2})$/.exec(ex);
      setError(null); setPending({ token, ...(m ? { expYear: Number(m[1]), expMonth: Number(m[2]) } : {}) });
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [adding, tok]);

  const load = () => customerApi.paymentMethods().then(setItems).catch((e: any) => setError(e?.message || 'Could not load cards.'));
  useEffect(() => { let live = true; customerApi.paymentMethods().then((d) => { if (live) setItems(d); }).catch((e: any) => live && setError(e?.message || 'Could not load cards.')); return () => { live = false; }; }, []);

  const save = async () => {
    if (!pending) { setError('Enter your card in the secure form first.'); return; }
    setBusy(true); setError(null);
    try {
      await customerApi.addPaymentMethod({ token: pending.token, brand: 'Card', last4: pending.token.slice(-4), expMonth: pending.expMonth, expYear: pending.expYear, isDefault: (items?.length ?? 0) === 0 });
      setPending(null); setAdding(false); await load();
    } catch (e: any) { setError(e?.message || 'Could not add the card.'); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => { setBusy(true); try { await customerApi.deletePaymentMethod(id); await load(); } catch (e: any) { setError(e?.message || 'Could not remove.'); } finally { setBusy(false); } };
  const makeDefault = async (id: string) => { setBusy(true); try { await customerApi.setDefaultPaymentMethod(id); await load(); } catch (e: any) { setError(e?.message || 'Could not update.'); } finally { setBusy(false); } };


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
        <h1 className="cust-h1" style={{ fontSize: 20 }}>Payment Methods</h1>
      </div>
      {error ? <div className="cust-card" style={{ padding: 14, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{error}</div> : null}

      {!items ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[1, 2].map((i) => (
            <div key={i} className="cust-card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="cust-skel" style={{ width: 40, height: 28, borderRadius: 6 }} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="cust-skel" style={{ width: 120, height: 16 }} />
                <div className="cust-skel" style={{ width: 80, height: 14 }} />
              </div>
              <div className="cust-skel" style={{ width: 50, height: 16 }} />
            </div>
          ))}
        </div>
      )
        : items.length === 0 && !adding ? <div className="cust-card" style={{ padding: 24, textAlign: 'center' }}><div aria-hidden style={{ fontSize: 32 }}>💳</div><div className="cust-sub" style={{ marginTop: 8 }}>No saved cards yet.</div></div>
        : items.map((m) => (
            <div key={m.id} className="cust-card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
              <span aria-hidden style={{ width: 40, height: 28, borderRadius: 6, background: 'var(--customer-purple-100)', display: 'grid', placeItems: 'center', fontSize: 16 }}>💳</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{m.brand || 'Card'} •••• {m.last4 || '????'}</div>
                <div className="cust-sub" style={{ fontSize: 12 }}>{m.expMonth && m.expYear ? `Expires ${String(m.expMonth).padStart(2, '0')}/${String(m.expYear).slice(-2)}` : ''}{m.isDefault ? ' · Default' : ''}</div>
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                {!m.isDefault ? <button onClick={() => makeDefault(m.id)} disabled={busy} style={{ border: 0, background: 'none', color: 'var(--customer-primary)', fontWeight: 700, cursor: 'pointer', padding: 0 }}>Default</button> : null}
                <button onClick={() => remove(m.id)} disabled={busy} style={{ border: 0, background: 'none', color: 'var(--customer-red)', fontWeight: 700, cursor: 'pointer', padding: 0 }}>Remove</button>
              </div>
            </div>
          ))}

      {adding ? (
        <div className="cust-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontWeight: 700 }}>Add card</div>
          {tok === null ? <div className="cust-sub">Loading the secure card form…</div>
            : !tok.available ? <div className="cust-sub" role="status">Saving a card isn't available at this salon yet.</div>
            : <iframe title="Secure card entry" src={tok.url} sandbox="allow-scripts allow-same-origin allow-forms" style={{ width: '100%', height: 150, border: 0 }} />}
          {pending ? <div className="cust-sub" style={{ fontSize: 12 }}>Card ending {pending.token.slice(-4)} ready to save.</div> : null}
          <div className="cust-sub" style={{ fontSize: 11.5 }}>Stored securely as a token via your salon's payment provider. We never store your full card number.</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => { setAdding(false); setError(null); }} className="cust-btn cust-btn-ghost" style={{ height: 44 }}>Cancel</button>
            <button onClick={save} disabled={busy} className="cust-btn" style={{ height: 44 }}>{busy ? 'Saving…' : 'Save card'}</button>
          </div>
        </div>
      ) : <button onClick={() => setAdding(true)} className="cust-btn cust-btn-ghost">+ Add card</button>}
    </div>
  );
}
