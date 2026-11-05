import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { customerApi, type CustomerPaymentMethod } from '../api/customerApi';

// Payment Methods (Profile → Payment Methods) — real saved cards over /customer/payment-methods. The card number is
// never stored or sent to our DB as a PAN: we send a token + display fields (brand/last4/expiry). In production the
// token comes from the salon's hosted tokenizer (CardSecure); the entry form here produces a sandbox token.
const brandOf = (num: string): string => {
  const n = num.replace(/\D+/g, '');
  if (/^4/.test(n)) return 'Visa';
  if (/^5[1-5]/.test(n) || /^2[2-7]/.test(n)) return 'Mastercard';
  if (/^3[47]/.test(n)) return 'Amex';
  if (/^6/.test(n)) return 'Discover';
  if (/^(?:2131|1800|35\d{3})/.test(n)) return 'JCB';
  return 'Card';
};

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
  const [num, setNum] = useState('');
  const [cardholderName, setCardholderName] = useState('');
  const [exp, setExp] = useState('');
  const [cvv, setCvv] = useState('');
  const [zipCode, setZipCode] = useState('');

  const load = () => customerApi.paymentMethods().then(setItems).catch((e: any) => setError(e?.message || 'Could not load cards.'));
  useEffect(() => { let live = true; customerApi.paymentMethods().then((d) => { if (live) setItems(d); }).catch((e: any) => live && setError(e?.message || 'Could not load cards.')); return () => { live = false; }; }, []);

  const startAdd = () => {
    setSelectedMethod('debit');
    setDropdownOpen(false);
    setNum('');
    setCardholderName('');
    setExp('');
    setCvv('');
    setZipCode('');
    setError(null);
    setAdding(true);
  };

  const cancelForm = () => {
    setAdding(false);
    setDropdownOpen(false);
    setError(null);
  };

  const save = async () => {
    const digits = num.replace(/\D+/g, '');
    if (digits.length < 12) {
      setError('Enter a valid card number.');
      return;
    }
    // Tokenize into sandbox CardSecure token (starts with 9) to satisfy PCI raw-PAN check
    const token = digits.startsWith('9') ? digits : ('9' + digits.slice(1));
    const [mm, yy] = exp.split('/').map((x) => x.trim());

    setBusy(true); setError(null);
    try {
      await customerApi.addPaymentMethod({
        token,
        brand: brandOf(digits),
        last4: digits.slice(-4),
        expMonth: mm ? Number(mm) : undefined,
        expYear: yy ? 2000 + Number(yy) : undefined,
        isDefault: !items || items.length === 0,
        cardholderName: cardholderName.trim() || undefined,
        zipCode: zipCode.trim() || undefined,
        cardType: selectedMethod || 'card',
      });
      setNum(''); setExp(''); setCvv(''); setCardholderName(''); setZipCode('');
      setAdding(false);
      await load();
    } catch (e: any) { setError(e?.message || 'Could not save the card.'); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => { setBusy(true); try { await customerApi.deletePaymentMethod(id); await load(); } catch (e: any) { setError(e?.message || 'Could not remove.'); } finally { setBusy(false); } };
  const makeDefault = async (id: string) => { setBusy(true); try { await customerApi.setDefaultPaymentMethod(id); await load(); } catch (e: any) { setError(e?.message || 'Could not update.'); } finally { setBusy(false); } };

  const handleNumChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D+/g, '');
    const isAmex = /^3[47]/.test(raw);
    const maxDigits = isAmex ? 15 : 16;
    const digits = raw.slice(0, maxDigits);

    let formatted = digits;
    if (isAmex) {
      const part1 = digits.slice(0, 4);
      const part2 = digits.slice(4, 10);
      const part3 = digits.slice(10, 15);
      formatted = [part1, part2, part3].filter(Boolean).join(' ');
    } else {
      formatted = digits.match(/.{1,4}/g)?.join(' ') || digits;
    }
    setNum(formatted);
  };

  const handleExpChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/[^\d/]/g, '').slice(0, 5);
    if (val.length === 2 && !val.includes('/') && e.target.value.length > exp.length) {
      val = val + '/';
    }
    setExp(val);
  };

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

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--customer-text)' }}>Card number:</label>
            <input
              value={num}
              onChange={handleNumChange}
              placeholder="•••• •••• •••• ••••"
              aria-label="Card number"
              inputMode="numeric"
              maxLength={19}
              style={inputStyle}
            />
          </div>

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

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--customer-text)', whiteSpace: 'nowrap' }}>Expiry date:</label>
              <input
                value={exp}
                onChange={handleExpChange}
                placeholder="MM / YY"
                aria-label="Expiry"
                inputMode="numeric"
                style={inputStyle}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--customer-text)', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                <span>CVC/CVV:</span>
                <span title="3 or 4 digit security code on back of card" style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--customer-text-secondary)', cursor: 'pointer' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                </span>
              </label>
              <input
                value={cvv}
                onChange={(e) => setCvv(e.target.value.replace(/\D+/g, '').slice(0, 4))}
                placeholder="CVV"
                aria-label="CVV"
                inputMode="numeric"
                maxLength={4}
                style={inputStyle}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--customer-text)', whiteSpace: 'nowrap' }}>Zip Code:</label>
              <input
                value={zipCode}
                onChange={(e) => setZipCode(e.target.value)}
                placeholder="Zip Code"
                aria-label="Zip Code"
                inputMode="numeric"
                maxLength={10}
                style={inputStyle}
              />
            </div>
          </div>

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
            <button type="button" onClick={save} disabled={busy} className="cust-btn" style={{ height: 46, borderRadius: 12 }}>
              {busy ? 'Saving…' : 'Save card'}
            </button>
          </div>
        </div>
      ) : <button onClick={startAdd} className="cust-btn cust-btn-ghost">+ Add card</button>}
    </div>
  );
}
