import { useEffect, useState, useCallback } from 'react';
import { useScopedQuery, useStreamInvalidation, OfflineStatus } from '@aipowersalon/mobile-sdk';
import { useCheckoutStream, useSentToThisPhone } from '../lib/useCheckoutStream';
import { mobileCheckoutApi, type MobileQueueItem, type ReadinessReport, type QueueFilter, type TapToPayCapabilityView } from '../api/mobileCheckoutApi';
import { formatCents, maskedPhone, titleCase } from '../util/format';
import { usePayNav } from '../shell/nav';
import { DEVICE_ID } from '../util/session';
import { useT } from '@aipowersalon/mobile-sdk';

// The checkout queue holds tickets READY FOR PAYMENT and later (a ticket still in service is not in it). The chips are the
// server's filters (wave 4: "In Service" / "Unpaid" sent in_service / unpaid, which the API refuses — 400 on every tap).
const FILTERS: { key: QueueFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'ready', label: 'Ready' },
  { key: 'in_progress', label: 'In Progress' },   // payment started: split / partial tender, or sent to the customer display
  { key: 'failed', label: 'Failed' },
];

function badgeClass(status: string): string {
  if (status === 'ready' || status === 'ready_for_payment') return 'ready';
  if (status === 'payment_failed' || status === 'unpaid' || status === 'partial') return 'unpaid';
  if (status === 'payment_in_progress' || status === 'in_service') return 'in_service';
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
    : r.overall === 'merchant_setup_required' ? 'The salon\'s merchant account is not set up yet.'
    : r.overall === 'authentication_required' ? 'Sign in again to take payments.'
    : r.overall === 'ready_with_warning' ? 'Ready, with a warning — check Account for details.'
    : 'Payments are not ready on this device.';
  const cls = r.overall === 'backend_unavailable' || r.overall === 'processor_unavailable' ? 'err' : 'warn';
  return <div className={`pay-readybanner ${cls}`}>⚠ {msg}</div>;
}

/** Mandate §28: the one Tap to Pay chip — Ready / Setup Required / Unavailable on This Device / Switched Off — from the
 *  real capability (provider + readiness), never assumed. */
function CapabilityChip({ c }: { c: TapToPayCapabilityView | null }) {
  const tr = useT();
  if (!c) return null;
  const label = c.state === 'ready' ? tr('pay.cap.ready') : c.state === 'setup_required' ? tr('pay.cap.setup') : c.state === 'disabled' ? tr('pay.cap.disabled') : tr('pay.cap.unavailable');
  return <div className={`pay-capchip ${c.state}`} role="status" title={c.reason || ''}>{label}</div>;
}

export function CheckoutQueueScreen() {
  const nav = usePayNav();
  const tr = useT();
  const [readiness, setReadiness] = useState<ReadinessReport | null>(null);
  const [capability, setCapability] = useState<TapToPayCapabilityView | null>(null);
  // §45–§46: tickets another device / the POS is processing right now (ids only; the row shows the claim)
  const [claimed, setClaimed] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<QueueFilter>('all');
  const [search, setSearch] = useState('');
  // BUILD_PLAN Phase 13: the queue through the query layer — scoped key per filter + (debounced) search, memory only
  // (a money app keeps nothing on the device), refetched on every stream event. A live refresh never blanks the list.
  const [args, setArgs] = useState(() => ({ filter, search: search.trim() }));
  useEffect(() => { const id = setTimeout(() => setArgs({ filter, search: search.trim() }), 150); return () => clearTimeout(id); }, [filter, search]);
  const qq = useScopedQuery<{ items: MobileQueueItem[] }>({ key: ['pay', 'queue', args.filter, args.search], fn: () => mobileCheckoutApi.queue({ filter: args.filter, search: args.search || undefined }) });
  const pendingArgs = args.filter !== filter || args.search !== search.trim();
  const items: MobileQueueItem[] | null = pendingArgs ? null : qq.data ? qq.data.items : qq.isError ? [] : null;
  const error = !qq.data && qq.isError && !pendingArgs ? ((qq.error as any)?.message || 'Could not load the checkout queue.') : null;
  const refetch = qq.refetch;
  const load = useCallback(async () => { await refetch(); }, [refetch]);

  useEffect(() => {
    mobileCheckoutApi.readiness(DEVICE_ID).then(setReadiness).catch(() => setReadiness(null));
    mobileCheckoutApi.capability?.(DEVICE_ID)?.then(setCapability).catch(() => setCapability(null));
  }, []);
  const loadClaims = useCallback(() => {
    mobileCheckoutApi.claims?.()?.then((rows) => setClaimed(Object.fromEntries(rows.map((r) => [r.ticketId, r.deviceLabel || r.userName || 'another device'])))).catch(() => {});
  }, []);
  useEffect(() => { loadClaims(); }, [loadClaims]);

  // Constitution 9: a checkout queue that only loads on mount goes stale the moment the front desk takes a
  // payment on the POS — the manager could tap a ticket that is already paid. Every stream event invalidates it.
  const invalidateQueue = useStreamInvalidation([['pay', 'queue']]);
  useCheckoutStream(useCallback(() => { invalidateQueue('reconcile'); loadClaims(); }, [invalidateQueue, loadClaims]));
  // Secure Tap to Pay M6-6 (§150): the front desk sent a ticket to THIS phone (its own realtime room) — say so, one tap opens it
  const [sentTo, setSentTo] = useState<{ ticketId: string } | null>(null);
  useSentToThisPhone(DEVICE_ID, useCallback((ticketId: string) => setSentTo({ ticketId }), []));
  const sentItem = sentTo ? (items ?? []).find((it) => it.ticketId === sentTo.ticketId) : undefined;
  const readyCount = (items ?? []).filter((it) => it.status === 'ready_for_payment' || it.status === 'ready').length;

  return (
    <>
      <div className="pay-sechead">
        <div className="t pay-serif">{tr('pay.queue.title')}</div>
        <div className="d">{items ? (readyCount > 0 ? tr('pay.queue.readyCount', { n: readyCount }) : `${items.length} ticket${items.length === 1 ? '' : 's'}`) : ''}<span className="pay-synced"> · {tr('pay.queue.synced')}</span></div>
      </div>

      <CapabilityChip c={capability} />
      <ReadinessBanner r={readiness} />
      <OfflineStatus failed={qq.isError && !!qq.data} />
      {sentTo && (
        <div className="pay-readybanner ok" role="status">
          {tr('pay.queue.sentToPhone', { n: sentItem?.ticketNumber ?? '' })}{' '}
          <button className="pay-chip active" onClick={() => { const id = sentTo.ticketId; setSentTo(null); nav.openTicket(id); }}>{tr('pay.queue.sentToPhoneOpen')}</button>
        </div>
      )}

      <div className="pay-searchwrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
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
        <div className="pay-state"><div className="icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="3" /><line x1="2" y1="10" x2="22" y2="10" /></svg></div><div className="big">No tickets to check out</div><div className="muted">Completed tickets ready for payment will appear here.</div></div>
      )}

      {items !== null && !error && items.length > 0 && (
        <div className="pay-queuelist">
          {items.map((it) => (
            <button key={it.ticketId} className="pay-queuecard" onClick={() => nav.openTicket(it.ticketId)}>
              <span className="nm">{it.customerName || 'Walk-in'}</span>
              <span className="amt">{formatCents(it.totalDueCents)}</span>
              <span className="svc">{it.servicesLabel || '—'}{it.ticketNumber ? ` · #${it.ticketNumber}` : ''}</span>
              <span className="meta">
                <span className="tech">{it.technicianName || maskedPhone(it.customerPhoneLast4)}</span>
                {claimed[it.ticketId]
                  ? <span className="pay-badge in_service" title={claimed[it.ticketId]}>{tr('pay.queue.claimedElsewhere')}</span>
                  : <span className={`pay-badge ${badgeClass(it.status)}`}>{titleCase(it.status)}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
