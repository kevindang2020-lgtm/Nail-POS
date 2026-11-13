// Checkout Conflict Simulator (Extras backlog · Promotions Management 15): the staging fixtures — hypothetical tickets
// with coupons, deals, membership, loyalty, split card / cash / gift-card tenders and refunds — as the server's REAL
// pricing and refund engines settle them (GET pos/deals/conflict-simulator). This panel only renders what the server
// returns; it never re-derives a price, a conflict or a refund outcome. Read-only: nothing is charged, redeemed,
// refunded or saved, and no real ticket or customer is involved.
import { Fragment, useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posDealsApi, type CheckoutConflictCase } from '../../api/posDealsApi';
import { fmtMoney } from '../../i18n/format';
import { FitDialog, Empty } from '../../components/FitKit';
import { useLoad, StateBlock } from '../../components/FinanceKit';

const caseLabel = (name: string) => tx('promo.sim.case.' + name);
const refundLabel = (r: CheckoutConflictCase['refund']) => r === 'none' ? tx('promo.sim.refund.none') : r === 'whole_ticket' ? tx('promo.sim.refund.whole') : tx('promo.sim.refund.lines', { lines: r.join(', ') });

export function ConflictSimulatorDialog({ onClose }: { onClose: () => void }) {
  const d = useLoad(() => posDealsApi.conflictSimulator(), []);
  const cases = d.data?.cases ?? [];
  const [open, setOpen] = useState<string | null>(null);
  const withConflicts = cases.filter((c) => c.result.conflicts.length > 0).length;
  return (
    <FitDialog wide title={tx('promo.sim.title')} subtitle={tx('promo.sim.sub')} onClose={onClose} testId="dlg-conflict-simulator"
      footer={<button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.close')}</button>}>
      <div className="fk-hint" data-testid="sim-readonly">{tx('promo.sim.readOnly')}</div>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !d.data ? <div className="fk-loading">{tx('pos.loading')}</div> : cases.length === 0 ? <Empty title={tx('promo.sim.none')} /> : <>
        <div className="fk-muted" data-testid="sim-summary">{tx('promo.sim.summary', { n: cases.length, c: withConflicts })}</div>
        <table className="fk-table fn-table" data-testid="sim-table">
          <thead><tr><th>{tx('promo.sim.col.case')}</th><th>{tx('promo.sim.col.subtotal')}</th><th>{tx('promo.sim.col.discount')}</th><th>{tx('promo.sim.col.due')}</th><th>{tx('promo.sim.col.tendered')}</th><th>{tx('promo.sim.col.conflicts')}</th></tr></thead>
          <tbody>{cases.map((c) => <Fragment key={c.name}>
            <tr className="inv2-click" onClick={() => setOpen(open === c.name ? null : c.name)} data-testid="sim-row" aria-expanded={open === c.name}>
              <td>{caseLabel(c.name)}</td><td>{fmtMoney(c.result.subtotalCents)}</td><td>{fmtMoney(c.result.totalDiscountCents)}</td>
              <td>{fmtMoney(c.result.dueCents)}</td><td>{fmtMoney(c.result.tenderedCents)}</td>
              <td data-testid="sim-conflict-count">{c.result.conflicts.length ? <span className="fk-badge warn">{c.result.conflicts.length}</span> : <span className="fk-badge ok">{tx('promo.sim.clean')}</span>}</td>
            </tr>
            {open === c.name ? <tr data-testid="sim-detail"><td colSpan={6}>
              <div><b>{tx('promo.sim.offers')}</b> {c.offers.map((o) => o.description).join(' · ') || '—'}</div>
              <div><b>{tx('promo.sim.policy')}</b> {tx('promo.sim.mode.' + c.policy.mode)}{c.policy.priceFloorPercent ? ' · ' + tx('promo.sim.floor', { p: c.policy.priceFloorPercent }) : ''}</div>
              <div><b>{tx('promo.sim.tenders')}</b> {c.tenders.map((tn) => tx('promo.sim.tender.' + tn.kind) + ' ' + fmtMoney(tn.cents)).join(' + ') || '—'}</div>
              <div><b>{tx('promo.sim.refund')}</b> {refundLabel(c.refund)}</div>
              <div><b>{tx('promo.sim.applied')}</b> {c.result.applied.map((a) => `${a.description} −${fmtMoney(a.appliedCents)}`).join(' · ') || '—'}</div>
              <ul className="fk-list dense" data-testid="sim-conflicts">{c.result.conflicts.length === 0 ? <li className="fk-li">{tx('promo.sim.noConflicts')}</li>
                : c.result.conflicts.map((x, i) => <li key={i} className="fk-li" data-testid="sim-conflict">
                  {tx('promo.sim.code.' + x.code, { offer: x.offerId ?? '', cents: x.cents == null ? '—' : fmtMoney(x.cents) })}
                  {x.reason ? <span className="fk-muted"> — {tx('promo.sim.reason.' + x.reason)}</span> : null}
                </li>)}</ul>
            </td></tr> : null}
          </Fragment>)}</tbody>
        </table>
      </>}
    </FitDialog>
  );
}
