// Low-Stock Cause Explanation (Extras backlog · Stock Alerts 12): why this product is where it is — the last 30 days of
// measured movements by kind, open purchase orders (overdue or not), the last receipt, and whether the movement ledger
// agrees with on-hand. Each line is a measured fact from the server; nothing is guessed.
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posInventoryAlertsApi } from '../../api/posInventoryAlertsApi';
import { useLoad, StateBlock, fmtYmdSafe } from '../../components/FinanceKit';
import { fmtNumber, fmtInZone } from '../../i18n/format';

export function LowStockCause({ productId, tick }: { productId: string; tick: number }) {
  const d = useLoad(() => posInventoryAlertsApi.cause(productId), [productId, tick]);
  const c = d.data; const n = (v: number) => fmtNumber(Math.abs(v));
  if (d.error) return <StateBlock error={d.error} onRetry={d.reload} />;
  if (!c) return <div className="fk-loading">{tx('pos.loading')}</div>;
  const line = (k: string) => {
    switch (k) {
      case 'usage': return tx('sa.cause.usage', { n: n(c.buckets.usage), d: c.days });
      case 'losses': return tx('sa.cause.losses', { n: n(c.buckets.losses), d: c.days });
      case 'no_receiving': return tx('sa.cause.noReceiving', { d: c.days, last: c.lastReceivedAt ? fmtInZone(c.lastReceivedAt, { month: 'short', day: 'numeric', year: 'numeric' }) : tx('sa.cause.never') });
      case 'receiving_delayed': return tx('sa.cause.delayed', { n: n(c.openOrders.quantity), date: c.openOrders.expectedDate ? fmtYmdSafe(c.openOrders.expectedDate) : '—' });
      case 'corrections': return tx('sa.cause.corrections', { n: n(c.buckets.corrections) });
      case 'inconsistent': return tx('sa.cause.inconsistent', { a: fmtNumber(c.ledgerAfter ?? 0), b: fmtNumber(c.product.onHand) });
      default: return tx('sa.cause.none', { d: c.days });
    }
  };
  return (
    <section data-testid="low-cause"><h3 className="fk-h3">{tx(c.product.low ? 'sa.cause.titleLow' : 'sa.cause.title')}</h3>
      <ul className="fk-checks">{(c.causes.length ? c.causes : ['none']).map((k) => <li key={k} className={k === 'inconsistent' || k === 'receiving_delayed' ? 'bad' : 'warn'} data-testid={'cause-' + k}>{line(k)}</li>)}
        {c.openOrders.quantity > 0 && !c.causes.includes('receiving_delayed') ? <li className="ok" data-testid="cause-on-order">{tx('sa.cause.onOrder', { n: n(c.openOrders.quantity), date: c.openOrders.expectedDate ? fmtYmdSafe(c.openOrders.expectedDate) : '—' })}</li> : null}
      </ul>
      <div className="fk-note" data-testid="reorder-recon">{c.reorder.suggested > 0 ? tx('sa.recon.suggest', { n: fmtNumber(c.reorder.suggested), o: fmtNumber(c.reorder.onOrder) }) : c.product.low ? tx('sa.recon.covered', { o: fmtNumber(c.reorder.onOrder) }) : tx('sa.recon.notLow')}
        {c.reorder.partlyReceivedLines ? <span className="fk-li-s" data-testid="reorder-partial">{tx('sa.recon.partial', { n: fmtNumber(c.reorder.partlyReceivedLines) })}</span> : null}
        {c.reorder.lastReceiptQuantity != null ? <span className="fk-li-s">{tx('sa.recon.lastReceipt', { n: fmtNumber(c.reorder.lastReceiptQuantity) })}</span> : null}</div>
      <div className="fk-hint" data-testid="cause-buckets">{tx('sa.cause.buckets', { d: c.days, u: fmtNumber(c.buckets.usage), r: fmtNumber(c.buckets.received), l: fmtNumber(c.buckets.losses), c: fmtNumber(c.buckets.corrections) })}</div>
    </section>
  );
}
