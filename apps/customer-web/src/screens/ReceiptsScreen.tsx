import { useEffect, useState } from 'react';
import { customerApi, type CustomerReceiptItem } from '../api/customerApi';
const money = (c?: number) => '$' + ((c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ReceiptsScreen() {
  const [items, setItems] = useState<CustomerReceiptItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => { customerApi.receipts().then(setItems).catch((e: any) => setError(e?.message || 'Could not load receipts.')); }, []);

  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h1 className="cust-h1" style={{ fontSize: 22 }}>Receipts</h1>
      
      {error ? (
        <div className="cust-card" style={{ padding: 16, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>
          {error}
        </div>
      ) : !items ? (
        <div className="cust-card" style={{ padding: '4px 16px' }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '12px 0', borderTop: i > 1 ? '1px solid var(--customer-border)' : 'none' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="cust-skel" style={{ width: 100, height: 16 }} />
                <div className="cust-skel" style={{ width: 60, height: 14 }} />
              </div>
              <div className="cust-skel" style={{ width: 50, height: 16 }} />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="cust-card" style={{ padding: 24, textAlign: 'center' }}>
          <div aria-hidden style={{ fontSize: 32 }}>🧾</div>
          <div className="cust-sub" style={{ marginTop: 8 }}>No receipts yet.</div>
        </div>
      ) : (
        <div className="cust-card" style={{ padding: '4px 16px' }}>
          {items.map((r, i) => (
            <div key={r.receiptId} style={{ display: 'flex', alignItems: 'center', padding: '12px 0', borderTop: i > 0 ? '1px solid var(--customer-border)' : 'none' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{r.date ? new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown Date'}</div>
                {r.channel ? <div className="cust-sub" style={{ fontSize: 12, marginTop: 2 }}>{r.channel}</div> : null}
              </div>
              <div style={{ fontWeight: 800 }}>{money(r.totalCents)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
