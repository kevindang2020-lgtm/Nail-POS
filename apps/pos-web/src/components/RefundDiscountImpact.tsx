// Refund Impact Preview (Extras backlog · Discounts 11): before an authorized refund, each discount / coupon on the ticket
// with what the refund would do to it under the existing policy — the server's ONE refund rule (deals engine
// refund-outcome.ts). An amount refund with no services keeps the discounts (the visit happened), so that case is said
// here without asking the server to guess. Read-only: nothing is reversed until the refund itself is made.
import { useEffect, useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import type { DiscountRefundImpact } from '@aipowersalon/api-contracts/tenant';
import { posDiscountsApi } from '../api/posDiscountsApi';
import { fmtMoney } from '../i18n/format';

export function RefundDiscountImpact({ ticketId, lineIds, whole }: { ticketId: string; lineIds: string[]; whole: boolean }) {
  const [d, setD] = useState<DiscountRefundImpact | null>(null); const [failed, setFailed] = useState(false);
  const amountOnly = !lineIds.length && !whole;
  const key = whole ? 'whole' : lineIds.join(',');
  useEffect(() => { let alive = true; setD(null); setFailed(false);
    posDiscountsApi.refundImpact(ticketId, whole || amountOnly ? null : lineIds).then((r) => { if (alive) setD(r); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; }; }, [ticketId, key, amountOnly]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (failed) return <div className="s muted" data-testid="refund-discounts-na">{tx('rv.disc.na')}</div>;
  if (!d || !d.items.length) return null;
  const outcome = (o: DiscountRefundImpact['items'][number]) => (amountOnly ? tx('rv.disc.keptAmount')
    : o.outcome === 'reverse' ? tx('rv.disc.reverse', { v: fmtMoney(o.reverseCents) }) : o.outcome === 'partial' ? tx('rv.disc.partial', { v: fmtMoney(o.reverseCents) })
    : o.outcome === 'release' ? tx('rv.disc.release') : o.outcome === 'keep' ? tx('rv.disc.keep') : tx('rv.disc.none'));
  return (
    <div data-testid="refund-discounts" style={{ marginTop: 8 }}>
      <div className="s" style={{ fontWeight: 700 }}>{tx('rv.disc.title')}</div>
      <ul style={{ margin: '4px 0 0 18px' }}>{d.items.map((o) => (
        <li key={o.redemptionId} data-testid="refund-discount">{o.code ? `${o.code} · ` : ''}{o.dealName} — {fmtMoney(o.discountCents)}{o.lines.length > 1 ? ` (${o.lines.map((l) => fmtMoney(l.cents)).join(' + ')})` : ''}
          <div className="s muted">{outcome(o)}{!amountOnly && o.placeReturned ? ` ${tx('rv.disc.placeBack')}` : ''}</div></li>))}</ul>
    </div>
  );
}
