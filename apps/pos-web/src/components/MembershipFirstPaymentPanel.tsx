// MembershipFirstPaymentPanel — D6 Membership guide §16 (Nov 4 2026). A membership with a price and no trial starts PENDING;
// this collects its first payment (one period + the enrollment fee) and activates it only on a CONFIRMED payment:
// the customer's saved card through the salon's gateway, or a paid invoice of this customer that covers the amount.
// One Idempotency-Key per attempt: a double tap never charges twice.
import { useEffect, useRef, useState } from 'react';
import { createIntentKeys } from '@aipowersalon/api-client';
import { centsToUsd } from '@aipowersalon/money';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posMembershipEnrollApi } from '../api/posMembershipEnrollApi';

type State = Awaited<ReturnType<typeof posMembershipEnrollApi.firstPayment>>;
const GOLD = '#B8933D';

export function MembershipFirstPaymentPanel({ membershipId, customerName, onPaid, onLater }: { membershipId: string; customerName: string; onPaid: (msg: string) => void; onLater: (msg: string) => void }) {
  const [st, setSt] = useState<State | null>(null);
  const [invoiceId, setInvoiceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const keys = useRef(createIntentKeys());
  useEffect(() => {
    let alive = true;
    posMembershipEnrollApi.firstPayment(membershipId).then((s) => { if (alive) { setSt(s); if (s.invoices.length === 1) setInvoiceId(s.invoices[0].id); } })
      .catch((e: any) => { if (alive) setErr(e?.message || tx('pos.something_went_wrong')); });
    return () => { alive = false; };
  }, [membershipId]);
  const amount = centsToUsd(st?.amountDueCents ?? 0);
  const collect = async (body: { method: 'card_on_file' | 'invoice'; invoiceId?: string | null }) => {
    setBusy(true); setErr(null);
    try {
      const r = await posMembershipEnrollApi.collectFirstPayment(membershipId, body, keys.current.keyFor('first-payment', body));
      keys.current.done('first-payment');
      onPaid(tx('admin.membership.fp.paid', { name: customerName, amount: centsToUsd(r.amountCents) }));
    } catch (e: any) { setErr(e?.message || tx('pos.something_went_wrong')); setBusy(false); }
  };
  if (!st) return <div data-testid="fp-panel" style={{ marginTop: 12 }}>{err ? <div style={{ color: 'var(--danger,#A33B3B)', fontSize: 13 }}>{err}</div> : <div className="muted">{tx('pos.loading')}</div>}</div>;
  const cardReason = !st.cardBillingConfigured ? tx('admin.membership.fp.cardOff') : !st.cardOnFile ? tx('admin.membership.fp.noCard') : null;
  return (
    <div data-testid="fp-panel" style={{ marginTop: 12 }}>
      <h3 style={{ margin: '0 0 6px' }}>{tx('admin.membership.fp.title')}</h3>
      <p style={{ fontSize: 13, margin: '0 0 12px' }}>{tx('admin.membership.fp.pending', { name: customerName, amount })}</p>
      <div style={{ display: 'grid', gap: 10 }}>
        <div>
          <button className="btn" data-testid="fp-card" disabled={busy || !!cardReason} onClick={() => void collect({ method: 'card_on_file' })}
            style={{ background: cardReason ? undefined : GOLD, color: cardReason ? undefined : '#fff', border: cardReason ? undefined : 'none', fontWeight: 700 }}>{tx('admin.membership.fp.card')} · {amount}</button>
          {cardReason ? <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{cardReason}</div> : null}
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{tx('admin.membership.fp.invoice')}</div>
          {st.invoices.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>{tx('admin.membership.fp.noInvoice', { amount })}</div> : (
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} data-testid="fp-invoice" style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid var(--line,#E2D6C2)' }}>
                <option value="">{tx('admin.membership.fp.pickInvoice')}</option>
                {st.invoices.map((i) => <option key={i.id} value={i.id}>{i.number} · {centsToUsd(i.totalCents)}</option>)}
              </select>
              <button className="btn" data-testid="fp-use-invoice" disabled={busy || !invoiceId} onClick={() => void collect({ method: 'invoice', invoiceId })}>{tx('admin.membership.fp.useInvoice')}</button>
            </div>
          )}
        </div>
      </div>
      {err ? <div role="alert" style={{ color: 'var(--danger,#A33B3B)', fontSize: 12, marginTop: 10 }}>{err}</div> : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="btn" data-testid="fp-later" disabled={busy} onClick={() => onLater(tx('admin.membership.fp.stillPending', { name: customerName }))}>{tx('admin.membership.fp.later')}</button>
      </div>
    </div>
  );
}
