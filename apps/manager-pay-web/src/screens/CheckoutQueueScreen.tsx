import { useEffect, useState, useCallback } from 'react';
import { mobileCheckoutApi, type MobileQueueItem, type ReadinessReport, type QueueFilter } from '../api/mobileCheckoutApi';
import { formatCents, maskedPhone, titleCase } from '../util/format';
import { usePayNav } from '../shell/nav';
import { DEVICE_ID } from '../util/session';

const FILTERS: { key: QueueFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'ready', label: 'Ready' },
  { key: 'in_service', label: 'In Service' },
  { key: 'unpaid', label: 'Unpaid' },
];

function badgeClass(status: string): string {
  if (status === 'ready' || status === 'ready_for_payment') return 'ready';
  if (status === 'unpaid' || status === 'partial') return 'unpaid';
  if (status === 'in_service') return 'in_service';
  return 'neutral';
}

// Readiness banner — honest about whether this device can actually take a payment right now.
function ReadinessBanner({ r }: { r: ReadinessReport | null }) {
  if (!r) return null;
  if (r.canTakePayment) return <div className="pay-readybanner ok">✓ Ready to take payments</div>;
  const msg =
    r.overall === 'tap_to_pay_setup_required' ? 'Tap to Pay is not set up on this device yet.'
    : r.overall === 'backend_unavailable' ? 'Cannot reach the salon backend.'
    : r.overall === 'update_required' ? 'A required app update is available.'
    : r.overall === 'processor_unavailable' ? 'The card processor is unavailable.'
    : r.overall === 'device_unsupported' ? 'This device does not support Tap to Pay.'
    : 'Payments are not ready on this device.';
  const cls = r.overall === 'backend_unavailable' || r.overall === 'processor_unavailable' ? 'err' : 'warn';
  return <div className={`pay-readybanner ${cls}`}>⚠ {msg}</div>;
}

export function CheckoutQueueScreen() {
  const nav = usePayNav();
  const [readiness, setReadiness] = useState<ReadinessReport | null>(null);
  const [items, setItems] = useState<MobileQueueItem[] | null>(null);
  const [filter, setFilter] = useState<QueueFilter>('all');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await mobileCheckoutApi.queue({ filter, search: search.trim() || undefined });
      setItems(res.items);
    } catch (e: any) {
      setItems([]);
      setError(e?.message || 'Could not load the checkout queue.');
    }
  }, [filter, search]);

  useEffect(() => { mobileCheckoutApi.readiness(DEVICE_ID).then(setReadiness).catch(() => setReadiness(null)); }, []);
  useEffect(() => { setItems(null); const id = setTimeout(load, 150); return () => clearTimeout(id); }, [load]);

  return (
    <>
      <div className="pay-sechead">
        <div className="t pay-serif">Checkout</div>
        <div className="d">{items ? `${items.length} ticket${items.length === 1 ? '' : 's'}` : ''}</div>
      </div>

      <ReadinessBanner r={readiness} />

      <div className="pay-searchwrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input className="pay-search" placeholder="Search name or ticket #" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="pay-chips">
        {FILTERS.map((f) => (
          <button key={f.key} className={`pay-chip ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>{f.label}</button>
        ))}
      </div>

      {items === null && (
        <div className="pay-queuelist">
          {[0, 1, 2, 3].map((i) => <div key={i} className="pay-skel" style={{ height: 92 }} />)}
        </div>
      )}

      {items !== null && error && (
        <div className="pay-state"><div className="big">Couldn’t load the queue</div><div className="muted">{error}</div><button className="pay-btn ghost" style={{ marginTop: 16 }} onClick={load}>Try again</button></div>
      )}

      {items !== null && !error && items.length === 0 && (
        <div className="pay-state">
          <div className="icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="5" width="20" height="14" rx="3" />
              <line x1="2" y1="10" x2="22" y2="10" />
            </svg>
          </div>
          <div className="big">No tickets to check out</div>
          <div className="muted">Completed tickets ready for payment will appear here automatically.</div>
        </div>
      )}

      {items !== null && !error && items.length > 0 && (
        <div className="pay-queuelist">
          {items.map((it) => (
            <button key={it.ticketId} className="pay-queuecard" onClick={() => nav.openTicket(it.ticketId)}>
              <span className="nm">{it.customerName || 'Walk-in'}</span>
              <span className="amt">{formatCents(it.totalDueCents)}</span>
              <span className="svc">{it.servicesLabel || '—'}{it.ticketNumber ? ` · #${it.ticketNumber.replace(/^#+/, '')}` : ''}</span>
              <span className="meta">
                <span className="tech">{it.technicianName || maskedPhone(it.customerPhoneLast4)}</span>
                <span className={`pay-badge ${badgeClass(it.status)}`}>{titleCase(it.status)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
