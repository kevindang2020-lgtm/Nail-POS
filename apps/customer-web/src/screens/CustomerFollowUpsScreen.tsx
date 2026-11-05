import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { customerFollowUpApi, type CustomerFollowUp } from '../api/customerFollowUpApi';
import { useCustomerStream } from '../api/useCustomerStream';
import { CustomerFollowUpCard } from './CustomerFollowUpCard';

// Service Follow-Up inbox — the customer's follow-ups from their technicians (/customer/follow-ups, server-scoped to
// this customer; only messages actually sent appear). Tap a card to read it, reply, or rebook. Honest empty/error
// states — never fabricated.
export function CustomerFollowUpsScreen() {
  const nav = useNavigate();
  const [items, setItems] = useState<CustomerFollowUp[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    customerFollowUpApi.list().then(setItems).catch((e: { message?: string }) => setError(e?.message || 'Could not load your follow-ups.'));
  }, []);
  useEffect(() => { load(); }, [load]);
  // Live updates: the inbox refetches the moment a technician sends a new follow-up to this customer.
  useCustomerStream((ev) => { if (ev === 'customer_follow_up_received' || ev === 'follow_up_task_updated') load(); });

  return (
    <div style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
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
        <h1 className="cust-h1" style={{ fontSize: 20 }}>Service Follow-Ups</h1>
      </div>

      {error ? <div className="cust-card" style={{ padding: 16, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{error}</div>
        : !items ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            {[1, 2, 3].map((i) => (
              <div key={i} className="cust-card" style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div className="cust-skel" style={{ width: 38, height: 38, borderRadius: 12 }} />
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="cust-skel" style={{ width: '80%', height: 16 }} />
                  <div className="cust-skel" style={{ width: '60%', height: 14 }} />
                  <div className="cust-skel" style={{ width: '100%', height: 14, marginTop: 4 }} />
                  <div className="cust-skel" style={{ width: '90%', height: 14 }} />
                </div>
              </div>
            ))}
          </div>
        )
        : items.length === 0 ? (
          <div className="cust-card" style={{ padding: 24, textAlign: 'center', marginTop: 12 }}>
            <div aria-hidden style={{ fontSize: 34 }}>💬</div>
            <h2 className="cust-h2" style={{ marginTop: 8 }}>No follow-ups yet</h2>
            <div className="cust-sub" style={{ marginTop: 4 }}>After your next visit, your technician may send you a follow-up here.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            {items.map((it) => <CustomerFollowUpCard key={it.id} item={it} onOpen={(id) => nav(`/follow-ups/${id}`)} />)}
          </div>
        )}
    </div>
  );
}
