import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { customerApi, type CustomerPaymentMethod } from '../api/customerApi';
import { trustedTokenizerFrame, readTokenizerMessage, parseTokenizerExpiry, type TokenizerFrame } from '../payments/hostedTokenizer';

// Payment Methods (Profile → Payment Methods) — saved cards over /customer/payment-methods.
//
// Fiserv master build §4 / §8D (P0, Nov 4 2026): this screen NO LONGER has card-number, expiry or CVV inputs. The former
// version kept the PAN and CVV in React state and built a fake "token" by replacing the first digit with 9. Now:
//   • the card is typed into the salon's Fiserv-hosted CardSecure iFrame; this app only ever receives a token;
//   • the token message is accepted only from the tokenizer's exact origin AND our own iframe window;
//   • saving needs a separate, unchecked-by-default consent box; the server then has the provider verify the token for
//     the salon's merchant before anything is stored;
//   • if the salon has no usable tokenizer, the screen says card saving is unavailable and collects nothing.

const PAYMENT_OPTIONS = [
  {
    id: 'debit' as const,
    label: 'Debit Card',
    icon: (
      <svg width="24" height="17" viewBox="0 0 24 17" fill="none" style={{ borderRadius: 3, flexShrink: 0 }}>
        <rect width="24" height="17" rx="3" fill="#1E3A8A" />
        <rect x="3" y="4" width="5" height="4" rx="1" fill="#FCD34D" />
        <line x1="0" y1="10" x2="24" y2="10" stroke="#0F172A" strokeWidth="2" />
      </svg>
    ),
    subtitle: 'Pay directly from your checking account',
  },
  {
    id: 'credit' as const,
    label: 'Credit Card',
    icon: (
      <svg width="24" height="17" viewBox="0 0 24 17" fill="none" style={{ borderRadius: 3, flexShrink: 0 }}>
        <rect width="24" height="17" rx="3" fill="#0F2B66" />
        <rect x="3" y="4" width="5" height="4" rx="1" fill="#FCD34D" />
        <line x1="0" y1="10" x2="24" y2="10" stroke="#94A3B8" strokeWidth="2" />
      </svg>
    ),
    subtitle: 'Visa, Mastercard, Amex, Discover, JCB',
  },
];

export function PaymentMethodsScreen() {
  const nav = useNavigate();
  const [items, setItems] = useState<CustomerPaymentMethod[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<'debit' | 'credit'>('debit');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [cardholderName, setCardholderName] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [consent, setConsent] = useState(false);
  const [frame, setFrame] = useState<TokenizerFrame | null>(null);
  const [consentVersion, setConsentVersion] = useState<string>('');
  const [tokenizerState, setTokenizerState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
  const [cardToken, setCardToken] = useState<{ token: string; expiry?: string } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const load = () => customerApi.paymentMethods().then(setItems).catch((e: any) => setError(e?.message || 'Could not load cards.'));
  useEffect(() => { let live = true; customerApi.paymentMethods().then((d) => { if (live) setItems(d); }).catch((e: any) => live && setError(e?.message || 'Could not load cards.')); return () => { live = false; }; }, []);

  // Token messages from the hosted iFrame — exact origin + our own iframe window only.
  useEffect(() => {
    if (!adding || !frame) return;
    const onMessage = (ev: MessageEvent) => {
      const m = readTokenizerMessage(ev, frame, iframeRef.current?.contentWindow ?? null);
      if (m.kind === 'token') { setCardToken({ token: m.token, expiry: m.expiry }); setError(null); }
      else if (m.kind === 'error') { setCardToken(null); setError(m.message); }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [adding, frame]);

  const startAdd = async () => {
    setSelectedMethod('debit');
    setDropdownOpen(false);
    setCardholderName('');
    setZipCode('');
    setConsent(false);
    setCardToken(null);
    setError(null);
    setAdding(true);
    setTokenizerState('loading');
    try {
      const cfg = await customerApi.cardTokenizer();
      const f = trustedTokenizerFrame(cfg);
      setFrame(f);
      setConsentVersion(cfg?.consentVersion || '');
      setTokenizerState(f && cfg?.consentVersion ? 'ready' : 'unavailable');
    } catch { setFrame(null); setTokenizerState('unavailable'); }
  };

  const cancelForm = () => {
    setAdding(false);
    setDropdownOpen(false);
    setCardToken(null);
    setFrame(null);
    setError(null);
  };

  const save = async () => {
    if (!cardToken) { setError('Enter your card in the secure card form first.'); return; }
    if (!consent) { setError('Please agree to save this card for future payments.'); return; }
    const { expMonth, expYear } = parseTokenizerExpiry(cardToken.expiry);
    setBusy(true); setError(null);
    try {
      await customerApi.addPaymentMethod({
        token: cardToken.token,
        last4: cardToken.token.slice(-4),
        expMonth,
        expYear,
        isDefault: !items || items.length === 0,
        cardholderName: cardholderName.trim() || undefined,
        zipCode: zipCode.trim() || undefined,
        cardType: selectedMethod || 'card',
        consent: true,
        consentVersion,
      });
      setCardToken(null); setCardholderName(''); setZipCode(''); setConsent(false);
      setAdding(false);
      await load();
    } catch (e: any) { setError(e?.message || 'Could not save the card.'); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => { setBusy(true); try { await customerApi.deletePaymentMethod(id); await load(); } catch (e: any) { setError(e?.message || 'Could not remove.'); } finally { setBusy(false); } };
  const makeDefault = async (id: string) => { setBusy(true); try { await customerApi.setDefaultPaymentMethod(id); await load(); } catch (e: any) { setError(e?.message || 'Could not update.'); } finally { setBusy(false); } };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    height: 44,
    borderRadius: 10,
    border: '1px solid var(--customer-border)',
    padding: '0 12px',
    font: 'inherit',
    fontSize: 14,
    background: '#fff',
    color: 'var(--customer-text)',
    boxSizing: 'border-box',
    outline: 'none',
  };

  const currOpt = PAYMENT_OPTIONS.find((o) => o.id === selectedMethod) || PAYMENT_OPTIONS[0];
  const currentHeaderLabel = currOpt.label;
  const currentHeaderIcon = currOpt.icon;

  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={() => nav(-1)}
          aria-label="Back"
          className="customer-back"
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
                <div style={{ fontWeight: 700 }}>
                  {m.brand || 'Card'} •••• {m.last4 || '????'}
                  {m.cardholderName ? ` · ${m.cardholderName}` : ''}
                </div>
                <div className="cust-sub" style={{ fontSize: 12 }}>
                  {m.expMonth && m.expYear ? `Expires ${String(m.expMonth).padStart(2, '0')}/${String(m.expYear).slice(-2)}` : ''}
                  {m.cardType ? ` · ${m.cardType === 'debit' ? 'Debit' : m.cardType === 'credit' ? 'Credit' : ''}` : ''}
                  {m.zipCode ? ` · ${m.zipCode}` : ''}
                  {m.isDefault ? ' · Default' : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                {!m.isDefault ? (
                  <button
                    type="button"
                    onClick={() => makeDefault(m.id)}
                    disabled={busy}
                    style={{ border: 0, background: 'none', color: 'var(--customer-primary)', fontWeight: 700, cursor: 'pointer', padding: 0 }}
                  >
                    Default
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => remove(m.id)}
                  disabled={busy}
                  style={{ border: 0, background: 'none', color: 'var(--customer-red)', fontWeight: 700, cursor: 'pointer', padding: 0 }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}

      {adding ? (
        <div className="cust-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Header row: Debit Card / Credit Card interactive dropdown selector */}
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              aria-haspopup="listbox"
              aria-expanded={dropdownOpen}
              onClick={() => setDropdownOpen((prev) => !prev)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderRadius: 10,
                border: '1px solid var(--customer-border)',
                background: '#fff',
                cursor: 'pointer',
                textAlign: 'left',
                boxSizing: 'border-box',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {currentHeaderIcon}
                <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--customer-text)' }}>
                  {currentHeaderLabel}
                </span>
              </div>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--customer-text-secondary)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  transform: dropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s ease',
                }}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {dropdownOpen && (
              <div
                role="listbox"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  left: 0,
                  right: 0,
                  zIndex: 30,
                  borderRadius: 10,
                  border: '1px solid var(--customer-border)',
                  background: '#fff',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                {PAYMENT_OPTIONS.map((opt, idx) => {
                  const isSelected = selectedMethod === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        setSelectedMethod(opt.id);
                        setDropdownOpen(false);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 14px',
                        border: 0,
                        borderBottom: idx === PAYMENT_OPTIONS.length - 1 ? 0 : '1px solid #f1f5f9',
                        background: isSelected ? 'var(--customer-purple-50, #f8fafc)' : '#fff',
                        cursor: 'pointer',
                        textAlign: 'left',
                        font: 'inherit',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {opt.icon}
                        <div>
                          <div style={{ fontSize: 14, fontWeight: isSelected ? 700 : 500, color: 'var(--customer-text)' }}>
                            {idx + 1}. {opt.label}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--customer-text-secondary)' }}>
                            {opt.subtitle}
                          </div>
                        </div>
                      </div>
                      {isSelected ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--customer-primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {tokenizerState === 'unavailable' ? (
            <div role="status" className="cust-card" style={{ padding: 14, background: 'var(--customer-purple-50, #f8fafc)', border: 0, fontSize: 13.5 }}>
              Card saving is not available at this salon yet. You can still pay at the front desk.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--customer-text)' }}>Card details:</label>
              {frame ? (
                <iframe
                  ref={iframeRef}
                  title="Secure card entry"
                  src={frame.url}
                  // Fiserv CardSecure page: card number, expiry and CVV live here — this app never sees them.
                  sandbox="allow-scripts allow-same-origin allow-forms"
                  referrerPolicy="no-referrer"
                  style={{ width: '100%', height: 160, border: '1px solid var(--customer-border)', borderRadius: 10, background: '#fff' }}
                />
              ) : <div className="cust-skel" style={{ width: '100%', height: 160, borderRadius: 10 }} aria-label="Loading secure card form" />}
              {cardToken ? <div className="cust-sub" style={{ fontSize: 12 }}>Card ready •••• {cardToken.token.slice(-4)}</div> : null}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--customer-text)' }}>Cardholder name:</label>
            <input
              value={cardholderName}
              onChange={(e) => setCardholderName(e.target.value)}
              placeholder="Name on card"
              aria-label="Cardholder name"
              autoCapitalize="words"
              style={inputStyle}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--customer-text)', whiteSpace: 'nowrap' }}>Billing Zip Code:</label>
            <input
              value={zipCode}
              onChange={(e) => setZipCode(e.target.value.replace(/[^\d-]/g, '').slice(0, 10))}
              placeholder="Zip Code"
              aria-label="Zip Code"
              inputMode="numeric"
              maxLength={10}
              style={inputStyle}
            />
          </div>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, lineHeight: 1.4, color: 'var(--customer-text)' }}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} aria-label="Save this card for future payments" style={{ marginTop: 2 }} />
            <span>Save this card with this salon's payment provider so I can choose it for future payments I make in the app. I can remove it at any time. The salon will not charge it unless I press Pay.</span>
          </label>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
            <div style={{ width: 44, height: 26, background: '#1A1F71', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(0,0,0,0.08)' }} title="Visa">
              <span style={{ color: '#fff', fontWeight: 900, fontStyle: 'italic', fontSize: 12, letterSpacing: 0.5, fontFamily: 'Arial, sans-serif' }}>VISA</span>
            </div>
            <div style={{ width: 44, height: 26, background: '#111827', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(0,0,0,0.08)' }} title="Mastercard">
              <svg width="26" height="16" viewBox="0 0 28 18">
                <circle cx="10" cy="9" r="7" fill="#EB001B" />
                <circle cx="18" cy="9" r="7" fill="#F79E1B" fillOpacity="0.88" />
              </svg>
            </div>
            <div style={{ width: 44, height: 26, background: '#006FCF', borderRadius: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 2px', border: '1px solid rgba(0,0,0,0.08)' }} title="American Express">
              <span style={{ color: '#fff', fontWeight: 800, fontSize: 5.5, letterSpacing: 0.2, lineHeight: 1.1, fontFamily: 'Arial, sans-serif' }}>AMERICAN</span>
              <span style={{ color: '#fff', fontWeight: 800, fontSize: 5.5, letterSpacing: 0.2, lineHeight: 1.1, fontFamily: 'Arial, sans-serif' }}>EXPRESS</span>
            </div>
            <div style={{ width: 44, height: 26, background: '#0F2B66', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(0,0,0,0.08)' }} title="JCB">
              <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <span style={{ color: '#0079C1', fontWeight: 900, fontSize: 11, fontFamily: 'Arial, sans-serif' }}>J</span>
                <span style={{ color: '#E60012', fontWeight: 900, fontSize: 11, fontFamily: 'Arial, sans-serif' }}>C</span>
                <span style={{ color: '#1EB53A', fontWeight: 900, fontSize: 11, fontFamily: 'Arial, sans-serif' }}>B</span>
              </div>
            </div>
          </div>

          <div className="cust-sub" style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--customer-text-secondary)', marginTop: 2 }}>
            Stored securely as a token via your salon's payment provider. We never store your full card number.
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button type="button" onClick={cancelForm} className="cust-btn cust-btn-ghost" style={{ height: 46, borderRadius: 12 }}>Cancel</button>
            <button type="button" onClick={save} disabled={busy || tokenizerState !== 'ready' || !cardToken || !consent} className="cust-btn" style={{ height: 46, borderRadius: 12 }}>
              {busy ? 'Saving…' : 'Save card'}
            </button>
          </div>
        </div>
      ) : <button onClick={() => void startAdd()} className="cust-btn cust-btn-ghost">+ Add card</button>}
    </div>
  );
}
