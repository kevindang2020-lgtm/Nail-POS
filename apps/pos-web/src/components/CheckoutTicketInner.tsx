// CheckoutTicketInner.tsx — the checkout ticket full-view content for the shared iPad Pro modal.
// Loads the REAL ticket (GET /pos/checkout/tickets/:ticketId → posCheckoutApi.detail) — never mock
// data. Shows customer, completed services (+ technician + price), technicians, the full money
// breakdown (subtotal, discount, tax, tip, surcharge, total due, payment method), quality summary,
// service notes, and available receipt delivery channels. Server enforces permission + tenant.
import { useCallback, useEffect, useRef, useState } from 'react';
import { posCheckoutApi } from '../api/posCheckoutApi';
import { ReviewTechnicianSplit } from './ReviewTechnicianSplit';
import { useRealtime } from '../realtime/useRealtime';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

import { statusLabel } from '../i18n/status-label';
const V = (n: string) => `var(--${n})`;

interface Totals { subtotalCents?: number; tipCents?: number; taxCents?: number; surchargeCents?: number; totalDueCents?: number; paymentMethod?: string }
export interface CheckoutTicketRow {
  ticketId: string; ticketNumber?: string; stationLabel?: string; finishedAt?: string; serviceNotes?: string;
  customer?: { fullName?: string; initials?: string; phone?: string; email?: string; isVip?: boolean; loyaltyTier?: string };
  completedServices?: { serviceLineId?: string; serviceName: string; technicianName?: string; priceCents?: number; qty?: number }[];
  promotion?: { code: string; amountCents: number } | null;
  technicians?: { primary?: { name: string }; helpers?: { name: string }[] };
  totals?: Totals;
  qualitySummary?: { serviceCompleted?: boolean; customerReady?: boolean; qualityChecked?: boolean; noOpenIssues?: boolean; approved?: boolean };
  receiptDeliveryOptions?: { sms?: boolean; email?: boolean; app?: boolean; print?: boolean };
}

const money = (c?: number | null) => '$' + ((c ?? 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function CheckoutTicketInner({ ticketId, initial }: { ticketId: string; initial?: CheckoutTicketRow }) {
  const [row, setRow] = useState<CheckoutTicketRow | null>(initial || null);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const d = await posCheckoutApi.detail(ticketId); if (alive.current) setRow(d as CheckoutTicketRow); }
    catch (e: any) { if (alive.current) setError(e?.message || tx('pos.could_not_load_this_ticket')); }
    finally { if (alive.current) setLoading(false); }
  }, [ticketId]);
  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; }; }, [load]);
  // Live refresh: re-fetch when a realtime checkout event changes the underlying record.
  useRealtime('checkout', load);

  if (loading && !row) return <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: V('muted'), fontSize: 13 }} aria-busy="true">{tx('pos.loading_ticket')}</div>;
  if (error && !row) return <div role="alert" style={{ flex: 1, display: 'grid', placeItems: 'center', textAlign: 'center', padding: 40 }}><div><div style={{ fontSize: 24 }}>⚠️</div><div style={{ color: V('danger'), fontWeight: 700, marginTop: 6 }}>{error}</div></div></div>;
  if (!row) return null;

  const t = row.totals || {};
  const services = row.completedServices || [];
  const helpers = row.technicians?.helpers || [];
  const card: React.CSSProperties = { background: V('card'), border: `1px solid ${V('line')}`, borderRadius: 12, padding: 14 };
  const head: React.CSSProperties = { fontSize: 11, color: V('muted'), fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 };
  const line = (l: string, v: React.ReactNode, strong?: boolean, tone?: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: strong ? 15 : 13, fontWeight: strong ? 800 : 500, color: tone || 'inherit' }}><span>{l}</span><span>{v}</span></div>
  );

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 18px', display: 'grid', gap: 14, alignContent: 'start' }}>
      {/* customer + technicians */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 14 }}>
        <div style={card}>
          <div style={head}>{tx('pos.customer')}</div>
          <div style={{ fontSize: 15, fontWeight: 800 }}>{row.customer?.fullName || '—'}{row.customer?.isVip ? <span style={{ marginLeft: 6, fontSize: 11, color: V('gold'), fontWeight: 800 }}>{tx('pos.vip')}</span> : null}</div>
          <div style={{ fontSize: 12.5, color: V('muted'), marginTop: 3 }}>{row.customer?.phone || row.customer?.email || '—'}{row.customer?.loyaltyTier ? ` · ${row.customer.loyaltyTier}` : ''}</div>
        </div>
        <div style={card}>
          <div style={head}>{tx('pos.technicians')}</div>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{row.technicians?.primary?.name || services[0]?.technicianName || '—'}</div>
          {helpers.length > 0 && <div style={{ fontSize: 12, color: V('muted'), marginTop: 2 }}>+ {helpers.map((h) => h.name).join(', ')}</div>}
        </div>
      </div>

      {/* completed services */}
      <div style={card}>
        <div style={head}>{tx('pos.completed_services')}{row.ticketNumber ? tx('pos.ticket_ticketnumber', { ticketNumber: String(row.ticketNumber) }) : ''}</div>
        {services.length === 0 ? <div style={{ fontSize: 12.5, color: V('muted') }}>{tx('pos.no_completed_services')}</div> : services.map((s, i) => (
          <div key={s.serviceLineId || i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', borderBottom: i < services.length - 1 ? `1px solid #F4EEE1` : 'none', fontSize: 13 }}>
            <span style={{ minWidth: 0 }}><b>{s.serviceName}</b>{s.qty && s.qty > 1 ? ` ×${s.qty}` : ''}{s.technicianName ? <span style={{ color: V('muted'), fontWeight: 500 }}> · {s.technicianName}</span> : null}</span>
            <b style={{ flexShrink: 0 }}>{money(s.priceCents)}</b>
          </div>
        ))}
      </div>

      {/* review technician split — only renders when >2 technicians performed services */}
      <ReviewTechnicianSplit ticketId={ticketId} />

      {/* money breakdown */}
      <div style={card}>
        <div style={head}>{tx('pos.payment')}</div>
        {line(tx('glossary.checkout.subtotal'), money(t.subtotalCents))}
        {row.promotion ? line(row.promotion.code ? tx('payment.totals.discountCode', { code: row.promotion.code }) : tx('glossary.checkout.discount'), `−${money(row.promotion.amountCents)}`, false, V('ok')) : null}
        {line(tx('glossary.checkout.tax'), money(t.taxCents))}
        {line(tx('glossary.checkout.tip'), money(t.tipCents))}
        {(t.surchargeCents ?? 0) > 0 ? line(tx('payment.totals.cardSurcharge'), money(t.surchargeCents)) : null}
        <div style={{ borderTop: `1.5px solid ${V('gold')}`, marginTop: 6, paddingTop: 4 }}>
          {line(tx('payment.totals.totalDue'), money(t.totalDueCents), true)}
        </div>
        {t.paymentMethod && <div style={{ marginTop: 6, fontSize: 12, color: V('muted') }}>{tx('pos.payment_method')}{' '}<b style={{ color: V('ink') }}>{statusLabel('paymentMethod', t.paymentMethod)}</b></div>}
      </div>

      {row.serviceNotes && (
        <div style={{ ...card, background: V('page') }}>
          <div style={head}>{tx('pos.service_notes')}</div>
          <div style={{ fontSize: 13, lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{row.serviceNotes}</div>
        </div>
      )}

      {/* receipt channels */}
      {row.receiptDeliveryOptions && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 10.5, color: V('muted'), fontWeight: 700 }}>{tx('pos.receipt')}</span>
          {(['sms', 'email', 'app', 'print'] as const).map((k) => {
            const on = (row.receiptDeliveryOptions as any)?.[k];
            return <span key={k} style={{ fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: '3px 10px', background: on ? V('ok-bg') : '#F1ECE4', color: on ? V('ok') : V('muted') }}>{tx(`payment.channel.${k}`).toUpperCase()} {on ? '✓' : '✕'}</span>;
          })}
        </div>
      )}
    </div>
  );
}
