import { useEffect, useState } from 'react';
import { mobileCheckoutApi, type MobilePaymentHistoryRow } from '../api/mobileCheckoutApi';
import { formatCents, titleCase } from '../util/format';
import { fmtTime, fmtInZone, useT } from '@aipowersalon/mobile-sdk';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display
import { useCheckoutStream } from '../lib/useCheckoutStream';

// Payment History (mandate §103–§106): rows come from the CANONICAL payments table (every sale this location took, any
// surface — the POS, the terminal, the customer display, this phone), never from a second ledger. Filters: Today /
// Yesterday / Week / Custom range, status, method, device. Each row: time · customer safe name · amount · method ·
// last4 where safe · status (PAID / PARTIALLY_REFUNDED / REFUNDED / VOIDED / UNKNOWN / DECLINED / FAILED).
type Range = 'today' | 'yesterday' | 'week' | 'custom';
const STATUSES = ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOIDED', 'UNKNOWN', 'DECLINED'];
const METHODS = ['card', 'cash', 'gift_card'];

function rangeBounds(r: Range, from: string, to: string): { from?: string; to?: string } {
  const start = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const end = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
  const now = new Date();
  if (r === 'today') return { from: start(now).toISOString(), to: end(now).toISOString() };
  if (r === 'yesterday') { const y = new Date(now); y.setDate(now.getDate() - 1); return { from: start(y).toISOString(), to: end(y).toISOString() }; }
  if (r === 'week') { const w = new Date(now); w.setDate(now.getDate() - 6); return { from: start(w).toISOString(), to: end(now).toISOString() }; }
  return { from: from ? start(new Date(from)).toISOString() : undefined, to: to ? end(new Date(to)).toISOString() : undefined };
}
function statusKind(status: string): 'ok' | 'warn' | 'bad' | 'neutral' {
  if (status === 'PAID') return 'ok';
  if (status === 'PARTIALLY_REFUNDED' || status === 'REFUNDED' || status === 'VOIDED') return 'warn';
  if (status === 'DECLINED' || status === 'FAILED') return 'bad';
  return 'neutral';
}
function dayKey(iso: string, tr: (k: string) => string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Earlier';
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return tr('pay.history.today');
  if (same(d, yest)) return tr('pay.history.yesterday');
  return fmtInZone(d, { weekday: 'short', month: 'short', day: 'numeric' });
}
const timeLabel = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : fmtTime(d); };

export function HistoryScreen() {
  const tr = useT();
  const [range, setRange] = useState<Range>('today');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [status, setStatus] = useState(''); const [method, setMethod] = useState(''); const [device, setDevice] = useState('');
  const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [items, setItems] = useState<MobilePaymentHistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => { mobileCheckoutApi.myDevices?.()?.then((d) => setDevices((d || []).map((x) => ({ deviceId: x.deviceId, label: x.label || x.deviceId.slice(0, 8) })))).catch(() => {}); }, []);
  useEffect(() => {
    let active = true;
    setItems(null); setError(null);
    const b = rangeBounds(range, from, to);
    mobileCheckoutApi.payments({ ...b, status: status || undefined, method: method || undefined, deviceId: device || undefined, limit: 200 })
      .then((r) => { if (active) setItems(r.items); })
      .catch((e: any) => { if (active) { setItems([]); setError(e?.message || 'Could not load history.'); } });
    return () => { active = false; };
  }, [range, from, to, status, method, device, tick]);
  // §168: a payment taken anywhere in the salon shows up here without a reload
  useCheckoutStream(() => setTick((t) => t + 1));

  const groups: { day: string; rows: MobilePaymentHistoryRow[] }[] = [];
  for (const it of items || []) {
    const day = dayKey(it.createdAt, tr);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(it); else groups.push({ day, rows: [it] });
  }

  return (
    <>
      <div className="pay-sechead"><div className="t pay-serif">{tr('pay.history.title')}</div></div>

      <div className="pay-chips">
        {(['today', 'yesterday', 'week', 'custom'] as Range[]).map((r) => (
          <button key={r} className={`pay-chip ${range === r ? 'active' : ''}`} onClick={() => setRange(r)}>{tr(`pay.history.${r}`)}</button>
        ))}
      </div>
      {range === 'custom' && (
        <div className="pay-rangerow">
          <input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span>–</span>
          <input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      )}
      <div className="pay-filterrow">
        <select aria-label={tr('pay.history.filterStatus')} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{tr('pay.history.filterStatus')}: {tr('pay.history.all')}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{titleCase(s.toLowerCase())}</option>)}
        </select>
        <select aria-label={tr('pay.history.filterMethod')} value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="">{tr('pay.history.filterMethod')}: {tr('pay.history.all')}</option>
          {METHODS.map((m) => <option key={m} value={m}>{titleCase(m)}</option>)}
        </select>
        {devices.length > 0 && (
          <select aria-label={tr('pay.history.filterDevice')} value={device} onChange={(e) => setDevice(e.target.value)}>
            <option value="">{tr('pay.history.filterDevice')}: {tr('pay.history.all')}</option>
            {devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
          </select>
        )}
      </div>

      {items === null && <div className="pay-queuelist">{[0, 1, 2].map((i) => <div key={i} className="pay-skel" style={{ height: 62 }} />)}</div>}

      {items !== null && error && (
        <div className="pay-state">
          <div className="icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg></div>
          <div className="big">Couldn’t load history</div><div className="muted">{error}</div>
          <button className="pay-chip" style={{ marginTop: 14, padding: '7px 18px', fontSize: 13 }} onClick={() => setTick((t) => t + 1)}>Try again</button>
        </div>
      )}

      {items !== null && !error && items.length === 0 && (
        <div className="pay-state"><div className="icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16l3-1.5 3 1.5 3-1.5 3 1.5 3-1.5 3 1.5V8z" /><path d="M14 2v6h6" /></svg></div><div className="big">{tr('pay.history.empty')}</div><div className="muted">{tr('pay.history.emptyHint')}</div></div>
      )}

      {groups.map((g) => (
        <div className="pay-daygroup" key={g.day}>
          <div className="pay-daylabel">{g.day}</div>
          {g.rows.map((it) => {
            const kind = statusKind(it.status);
            return (
              <div className="pay-histrow" key={it.paymentId}>
                <span className={`pay-histicon ${kind === 'ok' ? 'ready' : kind === 'bad' ? 'failed' : kind === 'warn' ? 'canceled' : 'created'}`}>{kind === 'ok' ? '✓' : kind === 'bad' ? '!' : kind === 'warn' ? '↩' : '…'}</span>
                <div>
                  <div className="amt">{formatCents(it.amountCents)}{it.refundedCents > 0 ? <span className="muted"> · −{formatCents(it.refundedCents)}</span> : null}</div>
                  <div className="time">{timeLabel(it.createdAt)} · {it.customerName}{it.ticketNumber ? ` · #${it.ticketNumber}` : ''}</div>
                  <div className="time">{titleCase(it.method)}{it.cardBrand ? ` · ${titleCase(it.cardBrand)}` : ''}{it.cardLast4 ? ` •••• ${it.cardLast4}` : ''}{it.paymentSurface === 'tap_to_pay_iphone' ? ' · Tap to Pay' : ''}{it.deviceLabel ? ` · ${it.deviceLabel}` : ''}</div>
                </div>
                <div className="rt"><span className={`pay-badge ${kind === 'ok' ? 'ready' : kind === 'neutral' ? 'neutral' : 'unpaid'}`}>{titleCase(it.status.toLowerCase())}</span></div>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
