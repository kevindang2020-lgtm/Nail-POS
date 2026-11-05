import { useEffect, useState } from 'react';
import { mobileCheckoutApi, type PaymentAttempt } from '../api/mobileCheckoutApi';
import { formatCents, titleCase } from '../util/format';
import { SelectDateModal, type DateRangeResult } from '../components/SelectDateModal';

// Honest labels for the attempt states this build actually produces. No invented "paid" — a real capture is what would
// yield a settled/confirmed row, and that requires the native Tap-to-Pay leg.
function statusKind(status: string): 'ready' | 'failed' | 'canceled' | 'created' {
  if (status === 'ready') return 'ready';
  if (status === 'failed') return 'failed';
  if (status === 'canceled') return 'canceled';
  if (status === 'confirmed') return 'ready';
  return 'created';
}
function statusIcon(kind: string): string {
  return kind === 'ready' ? '✓' : kind === 'failed' ? '!' : kind === 'canceled' ? '✕' : '…';
}
function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Earlier';
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, yest)) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function timeLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function HistoryScreen() {
  const [items, setItems] = useState<PaymentAttempt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customRange, setCustomRange] = useState<DateRangeResult | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const fetchHistory = () => {
    setItems(null);
    setError(null);
    const dateParams = customRange
      ? { startDate: customRange.startDate, endDate: customRange.endDate }
      : undefined;

    mobileCheckoutApi.recentAttempts(50, dateParams)
      .then((rows) => { setItems(rows || []); })
      .catch((e: any) => {
        setItems([]);
        const msg = String(e?.message || '');
        if (msg.includes('Cannot GET')) {
          setError('Payment history is currently unavailable. Tap below to retry.');
        } else {
          setError(msg || 'Could not load payment history.');
        }
      });
  };

  useEffect(() => {
    fetchHistory();
  }, [customRange]);

  // Group newest-first into day buckets while preserving order.
  const groups: { day: string; rows: PaymentAttempt[] }[] = [];
  for (const it of items || []) {
    const day = dayKey(it.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(it);
    else groups.push({ day, rows: [it] });
  }

  return (
    <>
      <div className="pay-sechead" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="t pay-serif">History</div>
        <button
          className={`pay-iconbtn ${customRange ? 'active' : ''}`}
          onClick={() => setModalOpen(true)}
          aria-label="Select Date Range"
          title="Select Date Range"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="3" />
            <path d="M3 9h18M8 2v4M16 2v4" />
          </svg>
        </button>
      </div>

      {customRange && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button
            className="pay-chip active"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            onClick={() => setModalOpen(true)}
          >
            <span>{customRange.label}</span>
            <span
              role="button"
              aria-label="Clear date filter"
              onClick={(e) => {
                e.stopPropagation();
                setCustomRange(null);
              }}
              style={{ fontWeight: 800, fontSize: 13, marginLeft: 2 }}
            >
              ✕
            </span>
          </button>
        </div>
      )}

      {items === null && <div className="pay-queuelist">{[0, 1, 2].map((i) => <div key={i} className="pay-skel" style={{ height: 62 }} />)}</div>}

      {items !== null && error && (
        <div className="pay-state">
          <div className="icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div className="big">Unable to load history</div>
          <div className="muted">{error}</div>
          <button className="pay-chip" style={{ marginTop: 14, padding: '7px 18px', fontSize: 13 }} onClick={fetchHistory}>
            Try Again
          </button>
        </div>
      )}


      {items !== null && !error && items.length === 0 && (
        <div className="pay-state">
          <div className="icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16l3-1.5 3 1.5 3-1.5 3 1.5 3-1.5 3 1.5V8z" />
              <path d="M14 2v6h6" />
            </svg>
          </div>
          <div className="big">{customRange ? 'No activity in this period' : 'No checkout activity yet'}</div>
          <div className="muted">{customRange ? 'Try selecting a different date range or clear the filter.' : 'Payment attempts you start here will appear in this list.'}</div>
          {customRange && (
            <button className="pay-chip" style={{ marginTop: 14, padding: '7px 18px', fontSize: 13 }} onClick={() => setCustomRange(null)}>
              Clear Filter
            </button>
          )}
        </div>
      )}

      {groups.map((g) => (
        <div className="pay-daygroup" key={g.day}>
          <div className="pay-daylabel">{g.day}</div>
          {g.rows.map((it) => {
            const kind = statusKind(it.status);
            return (
              <div className="pay-histrow" key={it.id}>
                <span className={`pay-histicon ${kind}`}>{statusIcon(kind)}</span>
                <div>
                  <div className="amt">{formatCents(it.amountCents)}</div>
                  <div className="time">{timeLabel(it.createdAt)} · Ticket {it.ticketId.slice(0, 8)}</div>
                </div>
                <div className="rt"><span className={`pay-badge ${kind === 'ready' ? 'ready' : kind === 'created' ? 'neutral' : 'unpaid'}`}>{titleCase(it.status)}</span></div>
              </div>
            );
          })}
        </div>
      ))}

      <SelectDateModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        activeType={customRange?.type}
        initialFrom={customRange?.customFrom}
        initialTo={customRange?.customTo}
        onSelect={(range) => setCustomRange(range)}
      />
    </>
  );
}
