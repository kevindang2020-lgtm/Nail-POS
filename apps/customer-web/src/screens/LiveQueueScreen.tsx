import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { customerApi, type CustomerQueueState } from '../api/customerApi';
import { useCustomerStream } from '../api/useCustomerStream';

// Live Queue — the customer's real position + ETA from /customer/queue (computed with the same ranking + wait estimate
// the POS uses). Polls every 15s as the safe fallback for live updates. Other customers' identities are never shown.
export function LiveQueueScreen() {
  const nav = useNavigate();
  const [q, setQ] = useState<CustomerQueueState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const mounted = useRef(true);
  const load = useCallback((first: boolean) => {
    if (first) setLoading(true);
    customerApi.queue().then((d) => { if (mounted.current) { setQ(d); setError(null); } }).catch((e: any) => { if (mounted.current && first) setError(e?.message || 'Could not load the queue.'); }).finally(() => { if (mounted.current && first) setLoading(false); });
  }, []);
  useEffect(() => {
    mounted.current = true;
    load(true);
    const t = setInterval(() => load(false), 30000); // fallback; SSE pushes instant updates below
    return () => { mounted.current = false; clearInterval(t); };
  }, [load]);
  // Realtime: refetch the moment the salon's queue/service state changes (event name only — no other customer's data).
  useCustomerStream((ev) => { if (['queue_updated', 'customer_checked_in', 'ticket_assigned', 'service_started', 'service_done'].includes(ev)) load(false); });

  const Header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
      <button onClick={() => nav(-1)} aria-label="Back" style={{ border: 0, background: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--customer-text)' }}>‹</button>
      <h1 className="cust-h1" style={{ fontSize: 20 }}>Live Queue</h1>
    </div>
  );

  if (loading) return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 18 }}>
      {Header}
      <div style={{ textAlign: 'center', marginTop: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <div className="cust-skel" style={{ width: 80, height: 16 }} />
        <div className="cust-skel" style={{ width: 100, height: 60, borderRadius: 8 }} />
        <div className="cust-skel" style={{ width: 120, height: 16 }} />
      </div>
      <div className="cust-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <div className="cust-skel" style={{ width: 140, height: 14 }} />
        <div className="cust-skel" style={{ width: 100, height: 26 }} />
      </div>
    </div>
  );
  if (error) return <div style={{ padding: 18 }}>{Header}<div className="cust-card" style={{ padding: 16, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{error}</div></div>;

  if (!q?.inQueue) {
    return (
      <div style={{ padding: 18 }}>{Header}
        <div
          className="cust-card"
          style={{
            minHeight: 320,
            padding: '40px 20px',
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
            🪑
          </div>
          <h2 className="cust-h2" style={{ margin: '0 0 6px' }}>You’re not in line right now</h2>
          <div className="cust-sub" style={{ fontSize: 14, maxWidth: 320, lineHeight: 1.45 }}>
            Check in at the salon to join the queue, then your live position and wait time will appear here.
          </div>
        </div>
      </div>
    );
  }

  const pos = q.position || 1;
  const start = Math.max(1, pos - 2);
  const circles = [] as number[];
  for (let n = start; n <= pos + 1; n++) circles.push(n);

  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 18 }}>{Header}
      <div style={{ textAlign: 'center', marginTop: 8 }} aria-label={`You are number ${pos} in line`}>
        <div className="cust-sub" style={{ fontSize: 15 }}>You are</div>
        <div style={{ fontSize: 64, fontWeight: 800, color: 'var(--customer-primary)', lineHeight: 1 }}>#{pos}</div>
        <div className="cust-sub" style={{ fontSize: 15 }}>{pos === 1 ? 'You’re next!' : `in line${q.totalWaiting ? ` of ${q.totalWaiting} waiting` : ''}`}</div>
      </div>

      {/* visual queue progress (the customer highlighted; no other guests' info shown) */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0 }}>
        {circles.map((n, i) => {
          const you = n === pos;
          return (
            <div key={n} style={{ display: 'flex', alignItems: 'center' }}>
              {i > 0 && <div style={{ width: 22, height: 2, background: 'var(--customer-border)' }} />}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div style={{ width: you ? 46 : 36, height: you ? 46 : 36, borderRadius: 999, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: you ? 15 : 13,
                  background: you ? 'var(--customer-primary)' : 'var(--customer-purple-100)', color: you ? '#fff' : 'var(--customer-text-secondary)', border: you ? '0' : '1px solid var(--customer-border)' }}>{n}</div>
                <span className="cust-sub" style={{ fontSize: 10.5, fontWeight: you ? 800 : 600, color: you ? 'var(--customer-primary)' : 'var(--customer-text-secondary)' }}>{you ? 'You' : `#${n}`}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="cust-card" style={{ padding: 18, textAlign: 'center' }}>
        <div className="cust-sub" style={{ fontSize: 13 }}>Estimated wait time</div>
        <div style={{ fontWeight: 800, fontSize: 26, marginTop: 2 }}>{q.estimatedWaitMinMinutes}–{q.estimatedWaitMaxMinutes} mins</div>
      </div>

      {pos === 1 ? (
        <div className="cust-card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 10, background: 'var(--customer-primary)', color: '#fff', border: 0 }}>
          <span aria-hidden style={{ fontSize: 20 }}>🎉</span>
          <span style={{ fontWeight: 800, fontSize: 14.5 }}>You’re next! Please be ready — we’ll call you any moment.</span>
        </div>
      ) : (
        <div className="cust-card" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 10, background: 'var(--customer-purple-100)' }}>
          <span aria-hidden style={{ fontSize: 18 }}>🔔</span>
          <span style={{ fontWeight: 600, fontSize: 14 }}>We’ll notify you when it’s your turn.</span>
        </div>
      )}
    </div>
  );
}
