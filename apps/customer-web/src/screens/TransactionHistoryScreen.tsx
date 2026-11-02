import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { customerApi, type CustomerWalletState } from '../api/customerApi';
import { money2 } from '../lib/appt';
import { fmtDate as fmtBranchDate } from '@aipowersalon/mobile-sdk';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display

// Transactions (Wallet → See All) — the full wallet ledger for the signed-in customer. Real signed amounts; no mock rows.
const TYPE_LABEL: Record<string, string> = { top_up: 'Top Up', refund: 'Refund', payment: 'Payment', adjustment: 'Adjustment', reversal: 'Reversal', promo: 'Promo' };
const fmtDate = (iso: string) => fmtBranchDate(iso);
const signed = (c: number) => (c >= 0 ? '+' : '−') + money2(Math.abs(c));

export function TransactionHistoryScreen() {
  const nav = useNavigate();
  const [w, setW] = useState<CustomerWalletState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let live = true; customerApi.wallet().then((d) => { if (live) setW(d); }).catch((e: any) => live && setError(e?.message || 'Could not load transactions.')); return () => { live = false; }; }, []);

  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => nav(-1)} aria-label="Back" style={{ border: 0, background: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--customer-text)' }}>‹</button>
        <h1 className="cust-h1" style={{ fontSize: 20 }}>Transactions</h1>
      </div>
      {error ? <div className="cust-card" style={{ padding: 14, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{error}</div>
        : !w ? (
          <div className="cust-card" style={{ padding: '4px 16px' }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: i > 1 ? '1px solid var(--customer-border)' : 'none' }}>
                <div className="cust-skel" style={{ width: 36, height: 36, borderRadius: 10 }} />
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="cust-skel" style={{ width: 100, height: 14 }} />
                  <div className="cust-skel" style={{ width: 60, height: 12 }} />
                </div>
                <div className="cust-skel" style={{ width: 40, height: 16 }} />
              </div>
            ))}
          </div>
        )
        : w.transactions.length === 0 ? <div className="cust-card" style={{ padding: 24, textAlign: 'center' }}><div aria-hidden style={{ fontSize: 32 }}>🧾</div><div className="cust-sub" style={{ marginTop: 8 }}>No wallet transactions yet.</div></div>
        : (
          <div className="cust-card" style={{ padding: '4px 16px' }}>
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
  );
}
