import { useEffect, useState } from 'react';
import { parseDollarsToCents } from '../lib/money-input';
import { useNavigate } from 'react-router-dom';
import { customerApi, type CustomerWalletState, type CustomerLoyaltySummary, type CustomerPaymentMethod } from '../api/customerApi';
import { money2 } from '../lib/appt';
import { isGuest, exitGuestMode } from '../auth/guest';

// Wallet & Rewards (reference panel 7) — real store-credit balance + loyalty + transactions. Top Up charges a saved
// card through the salon's payment gateway and credits the ledger (idempotent on the processor retref).
const TYPE_LABEL: Record<string, string> = { top_up: 'Top Up', refund: 'Refund', payment: 'Payment', adjustment: 'Adjustment', reversal: 'Reversal', promo: 'Promo' };
const fmtDate = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
const signed = (c: number) => (c >= 0 ? '+' : '−') + money2(Math.abs(c));
const PRESETS = [2500, 5000, 10000];

export function WalletScreen() {
  const nav = useNavigate();
  const guest = isGuest();
  const [w, setW] = useState<CustomerWalletState | null>(null);
  const [l, setL] = useState<CustomerLoyaltySummary | null>(null);
  const [methods, setMethods] = useState<CustomerPaymentMethod[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [amountCents, setAmountCents] = useState(5000);
  const [custom, setCustom] = useState('');
  const [methodId, setMethodId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadWallet = () => customerApi.wallet().then(setW).catch(() => {});
  useEffect(() => {
    if (guest) return;
    let live = true;
    Promise.all([customerApi.wallet(), customerApi.loyalty()]).then(([wv, lv]) => { if (live) { setW(wv); setL(lv); } }).catch((e: any) => live && setError(e?.message || 'Could not load your wallet.'));
    customerApi.paymentMethods().then((m) => { if (live) { setMethods(m); setMethodId((m.find((x) => x.isDefault) || m[0])?.id || ''); } }).catch(() => {});
    return () => { live = false; };
  }, [guest]);

  const effectiveAmount = custom.trim() ? (parseDollarsToCents(custom) ?? NaN) : amountCents;   // invalid → isFinite guard
  const confirm = async () => {
    setMsg(null);
    if (!Number.isFinite(effectiveAmount) || effectiveAmount <= 0) { setMsg('Enter an amount.'); return; }
    if (!methodId) { setMsg('Select a card.'); return; }
    setBusy(true);
    try {
      const r = await customerApi.topUp(effectiveAmount, methodId);
      if (r.ok) { await loadWallet(); setOpen(false); setCustom(''); }
      else setMsg(r.message || 'Top-up failed.');
    } catch (e: any) { setMsg(e?.message || 'Top-up failed.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ padding: '18px 18px 28px', display: 'flex', flexDirection: 'column', gap: 16, width: '100%', minHeight: 'calc(100vh - 120px)', flex: 1, boxSizing: 'border-box' }}>
      <h1 className="cust-h1">Wallet &amp; Rewards</h1>

      {guest ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="cust-hero" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '22px 20px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ opacity: 0.85, fontSize: 13, fontWeight: 600 }}>Guest Wallet</div>
              <div style={{ fontSize: 32, fontWeight: 800, marginTop: 2, letterSpacing: '-0.02em' }}>$0.00</div>
              <div style={{ opacity: 0.85, fontSize: 12.5 }}>Available Balance</div>
            </div>
            <button
              onClick={() => exitGuestMode()}
              style={{
                height: 42,
                padding: '0 20px',
                borderRadius: 12,
                border: 0,
                background: 'rgba(255,255,255,0.95)',
                color: 'var(--customer-primary)',
                fontWeight: 800,
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              }}
            >
              Sign In
            </button>
          </div>

          <div className="cust-card" style={{ padding: '24px 20px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 62, height: 62, borderRadius: '50%', background: 'linear-gradient(135deg, #FBF3E4 0%, #EFE1C9 100%)', display: 'grid', placeItems: 'center', fontSize: 28, border: '1px solid #DBCAB0' }} aria-hidden>
              💳
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 17, color: '#2A2118', fontFamily: 'Georgia, serif' }}>
                Join AI PowerSalon Rewards
              </div>
              <div className="cust-sub" style={{ marginTop: 6, maxWidth: 320, fontSize: 13.5, lineHeight: 1.5 }}>
                Sign in or register to load store credit, receive digital gift cards, and earn loyalty points on every salon visit.
              </div>
            </div>

            <button
              onClick={() => exitGuestMode()}
              className="cust-btn"
              style={{
                width: '100%',
                maxWidth: 240,
                height: 46,
                fontSize: 15,
                background: 'linear-gradient(180deg, #C9971B 0%, #A96F22 100%)',
                color: '#fff',
                fontWeight: 700,
                boxShadow: '0 4px 14px rgba(169,111,34,.3)',
              }}
            >
              Sign In or Register
            </button>
          </div>
        </div>
      ) : error ? <div className="cust-card" style={{ padding: 16, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{error}</div>
        : !w || !l ? (
          <>
            <div className="cust-card" style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="cust-skel" style={{ width: 80, height: 16 }} />
                <div className="cust-skel" style={{ width: 140, height: 32 }} />
                <div className="cust-skel" style={{ width: 100, height: 14 }} />
              </div>
              <div className="cust-skel" style={{ width: 80, height: 38, borderRadius: 11 }} />
            </div>
            <div className="cust-card" style={{ width: '100%', padding: '14px 16px' }}>
              <div className="cust-skel" style={{ width: '100%', height: 20 }} />
            </div>
            <div className="cust-card" style={{ padding: 20, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="cust-skel" style={{ width: 100, height: 16 }} />
                <div className="cust-skel" style={{ width: 160, height: 32 }} />
                <div className="cust-skel" style={{ width: 120, height: 16 }} />
                <div className="cust-skel" style={{ width: '100%', height: 6, marginTop: 8 }} />
              </div>
            </div>
          </>
        )
        : (<>
          <div className="cust-hero" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '20px 22px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ opacity: 0.85, fontSize: 13, fontWeight: 600 }}>My Wallet</div>
              <div style={{ fontSize: 32, fontWeight: 800, marginTop: 2, letterSpacing: '-0.02em' }}>{money2(w.balanceCents)}</div>
              <div style={{ opacity: 0.85, fontSize: 12.5 }}>Available Balance</div>
            </div>
            <button onClick={() => { setOpen(true); setMsg(null); }} style={{ height: 42, padding: '0 20px', borderRadius: 12, border: 0, background: 'rgba(255,255,255,0.95)', color: 'var(--customer-primary)', fontWeight: 800, cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>Top Up</button>
          </div>

          <button onClick={() => nav('/gift-cards')} className="cust-card" style={{ width: '100%', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 10, border: 0, cursor: 'pointer', textAlign: 'left', font: 'inherit' }}>
            <span style={{ fontSize: 20 }} aria-hidden>🎁</span>
            <span style={{ fontWeight: 700, fontSize: 15 }}>Gift Cards</span>
            <span style={{ marginLeft: 'auto', color: 'var(--customer-primary)', fontWeight: 700 }}>View →</span>
          </button>

          <div className="cust-hero" style={{ background: 'linear-gradient(135deg, #2A2118, #5A4326 55%, #A96F22)', padding: '20px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ opacity: 0.85, fontSize: 13, fontWeight: 600 }}>Loyalty Points</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 2 }}><span style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em' }}>{l.points.toLocaleString('en-US')}</span><span style={{ opacity: 0.85 }}>pts</span></div>
                <div style={{ fontWeight: 700, marginTop: 2 }}>{l.tier} Member</div>
                <div style={{ opacity: 0.9, fontSize: 12, marginTop: 4 }}>{l.nextTier ? `${l.pointsToNextTier.toLocaleString('en-US')} pts to ${l.nextTier}` : 'Top tier reached 🎉'}</div>
              </div>
              <button onClick={() => nav('/rewards')} style={{ height: 40, padding: '0 18px', borderRadius: 12, border: 0, background: 'rgba(255,255,255,0.92)', color: 'var(--customer-primary)', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>View Rewards</button>
            </div>
            {l.nextTier ? (
              <div style={{ marginTop: 14 }} aria-label={`${Math.round(l.progressPercent)}% to ${l.nextTier}`}>
                <div style={{ height: 8, borderRadius: 999, background: 'rgba(255,255,255,0.25)', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.max(0, Math.min(100, l.progressPercent))}%`, height: '100%', background: '#fff', borderRadius: 999 }} />
                </div>
              </div>
            ) : null}
          </div>

          <div className="cust-card" style={{ padding: '8px 18px 16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '12px 0' }}>
              <h2 className="cust-h2" style={{ flex: 1, fontSize: 17 }}>Recent Transactions</h2>
              <button onClick={() => nav('/transactions')} style={{ border: 0, background: 'none', color: 'var(--customer-primary)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>See All</button>
            </div>
            {w.transactions.length === 0 ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '28px 16px', textAlign: 'center', gap: 6 }}>
                <span style={{ fontSize: 28, opacity: 0.5 }} aria-hidden>🧾</span>
                <div className="cust-sub" style={{ padding: '0 0 4px' }}>No wallet transactions yet.</div>
              </div>
            ) : (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                {w.transactions.map((t) => (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: '1px solid var(--customer-border)' }}>
                    <span style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', fontSize: 16, background: t.amountCents >= 0 ? 'var(--customer-green-light)' : 'var(--customer-purple-100)' }} aria-hidden>{t.amountCents >= 0 ? '↓' : '↑'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700 }}>{TYPE_LABEL[t.type] || t.type}</div>
                      <div className="cust-sub" style={{ fontSize: 12 }}>{fmtDate(t.createdAt)}</div>
                    </div>
                    <div style={{ fontWeight: 800, color: t.amountCents >= 0 ? '#0E8A63' : 'var(--customer-red)' }}>{signed(t.amountCents)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>)}

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Top up wallet"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 200,
            background: 'rgba(28, 20, 14, 0.65)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            display: 'grid',
            placeItems: 'center',
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setOpen(false);
              setMsg(null);
            }
          }}
        >
          <div
            style={{
              width: 'min(440px, 92vw)',
              background: '#FFFFFF',
              borderRadius: 24,
              padding: '24px 22px 20px',
              boxShadow: '0 25px 60px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(212, 175, 55, 0.2)',
              border: '1px solid #DFC37B',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              position: 'relative',
            }}
          >
            {/* Header Icon Badge */}
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                background: '#F4E3BF',
                color: '#8B5A18',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 2px',
                border: '1px solid #DFC37B',
                fontSize: 24,
              }}
            >
              💳
            </div>

            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 800, fontSize: 19, color: '#1F2937' }}>Top up your wallet</div>
              <div className="cust-sub" style={{ fontSize: 13, marginTop: 4 }}>Add funds to your salon balance for instant checkouts</div>
            </div>

            {/* Presets */}
            <div style={{ display: 'flex', gap: 8 }}>
              {PRESETS.map((p) => {
                const on = !custom.trim() && amountCents === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => { setAmountCents(p); setCustom(''); }}
                    style={{
                      flex: 1,
                      height: 44,
                      borderRadius: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                      border: on ? 'none' : '1px solid #E5E7EB',
                      background: on ? 'linear-gradient(135deg, #D97706, #B45309)' : '#F9FAFB',
                      color: on ? '#FFFFFF' : '#374151',
                      boxShadow: on ? '0 4px 12px rgba(217, 119, 6, 0.25)' : 'none',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {money2(p)}
                  </button>
                );
              })}
            </div>

            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Custom amount ($)"
              inputMode="decimal"
              aria-label="Custom amount"
              style={{
                width: '100%',
                height: 44,
                borderRadius: 12,
                border: '1px solid #D1D5DB',
                padding: '0 14px',
                font: 'inherit',
                background: '#FFFFFF',
                fontSize: 14,
                color: '#1F2937',
              }}
            />

            <div>
              <div className="cust-label" style={{ marginBottom: 6, fontWeight: 700, fontSize: 12.5, color: '#4B5563', textTransform: 'uppercase', letterSpacing: 0.5 }}>Pay with</div>
              {methods.length === 0 ? (
                <button onClick={() => nav('/profile/payment-methods')} className="cust-btn cust-btn-ghost" style={{ height: 44, width: '100%', borderRadius: 12 }}>+ Add a card</button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {methods.map((m) => {
                    const on = methodId === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setMethodId(m.id)}
                        aria-pressed={on}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          height: 48,
                          padding: '0 14px',
                          borderRadius: 12,
                          cursor: 'pointer',
                          textAlign: 'left',
                          border: on ? '2px solid #D97706' : '1px solid #E5E7EB',
                          background: on ? '#FFFDF9' : '#FFFFFF',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <span aria-hidden style={{ fontSize: 18 }}>💳</span>
                        <span style={{ flex: 1, fontWeight: 600, fontSize: 13.5, color: '#1F2937' }}>{m.brand || 'Card'} •••• {m.last4 || '????'}</span>
                        {on ? <span aria-hidden style={{ color: '#D97706', fontWeight: 900, fontSize: 16 }}>✓</span> : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {msg && <div className="cust-sub" style={{ color: 'var(--customer-red)', textAlign: 'center', fontWeight: 600 }}>{msg}</div>}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <button
                type="button"
                onClick={() => { setOpen(false); setMsg(null); }}
                className="cust-btn cust-btn-ghost"
                style={{ height: 46, flex: 1, borderRadius: 12, border: '1px solid #E5E7EB', color: '#4B5563', fontWeight: 700 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={busy || methods.length === 0}
                className="cust-btn"
                style={{
                  height: 46,
                  flex: 1.3,
                  borderRadius: 12,
                  background: 'linear-gradient(135deg, #D97706, #B45309)',
                  color: '#FFFFFF',
                  fontWeight: 800,
                  boxShadow: '0 4px 14px rgba(217, 119, 6, 0.3)',
                  border: 'none',
                }}
              >
                {busy ? 'Processing…' : `Add ${money2(effectiveAmount > 0 ? effectiveAmount : 0)}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
