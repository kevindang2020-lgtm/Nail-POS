// CommissionImpactPanel.tsx — Extras · Deals & Offers 12 "Commission Impact Review": deals whose commission impact has not
// been approved before production. Everything shown is the server's answer (GET /owner/compensation/deal-reviews): the
// funding allocation checkout applies to a deal discount today, a worked sample by the compensation engine, the latest
// approval and the flag. Approve writes one append-only review row for the deal's current version — it never edits the
// deal, a ticket or anyone's pay, and it never blocks activation.
import { useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posDealsOffersApi } from '../../api/posDealsOffersApi';
import { fmtMoney, fmtNumber } from '../../i18n/format';
import { FitPanel, Pager, Empty } from '../../components/FitKit';
import { useLoad, StateBlock } from '../../components/FinanceKit';
import { errorTextOf } from '../../i18n/error-text';
import { codeLabel } from '../../components/codeLabel';

type ImpactSample = { serviceName: string; priceCents: number; discountCents: number; technicians: number; earningsFullMinCents: number; earningsFullMaxCents: number;
  earningsDiscountedMinCents: number; earningsDiscountedMaxCents: number; changeMinCents: number; changeMaxCents: number };
type ImpactRow = { dealId: string; title: string; status: string; ownerType: string; technicianName: string | null; version: number; fundingNow: string;
  sample: ImpactSample | null; review: { reviewedAt: string; reviewedBy: string | null; version: number; funding: string; note: string | null } | null; flag: string | null };
const range = (a: number, b: number) => (a === b ? fmtMoney(a) : `${fmtMoney(a)} – ${fmtMoney(b)}`);

export function CommissionImpactPanel({ canApprove }: { canApprove: boolean }) {
  const [page, setPage] = useState(1); const [onlyFlagged, setOnlyFlagged] = useState(true); const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  const list = useLoad(() => posDealsOffersApi.commissionReviews({ flagged: onlyFlagged, page, pageSize: 10 }), [onlyFlagged, page, tick]);
  const approve = async (r: ImpactRow) => {
    setBusy(r.dealId); setErr(null);
    try { await posDealsOffersApi.approveCommission(r.dealId, null); setTick((n) => n + 1); }
    catch (e) { setErr(errorTextOf(e)); }
    finally { setBusy(null); }
  };
  const d = list.data;
  return (
    <FitPanel testId="commission-impact" title={<>{tx('do.ci.title')}{d ? <span className="fk-muted"> · {tx('do.ci.flagged', { n: fmtNumber(d.flaggedTotal) })}</span> : null}</>}
      footer={<div className="cp-foot"><Pager info={d ? { page: d.page, totalPages: d.totalPages, totalItems: d.totalItems, pageSize: d.pageSize } : null} onPage={setPage} label={tx('do.ci.title')} /></div>}>
      <div className="fk-hint" data-testid="ci-funding">{d ? tx('do.ci.funding', { f: codeLabel('do.ci.fund', d.fundingNow) }) : '—'}</div>
      <label className="fk-check"><input type="checkbox" checked={onlyFlagged} onChange={(e) => { setOnlyFlagged(e.target.checked); setPage(1); }} data-testid="ci-only-flagged" /> {tx('do.ci.onlyFlagged')}</label>
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
      {list.error ? <StateBlock error={list.error} onRetry={list.reload} /> : !d ? <div className="fk-loading">{tx('pos.loading')}</div>
        : d.items.length === 0 ? <Empty title={tx('do.ci.none')} />
        : <table className="fk-table fn-table dsc-table" data-testid="ci-table">
          <thead><tr><th>{tx('do.col.proposal')}</th><th>{tx('do.ci.sample')}</th><th>{tx('do.ci.review')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
          <tbody>{(d.items as ImpactRow[]).map((r) => <tr key={r.dealId} data-testid="ci-row">
            <td><span className="fk-li-t">{r.title}</span><span className="fk-li-s">{r.ownerType === 'technician' ? tx('do.byTech', { t: r.technicianName ?? '—' }) : tx('pos.salon_deal')} · {codeLabel('do.ci.st', r.status)}</span></td>
            <td>{r.sample ? <><span className="fk-li-t">{tx('do.ci.sampleLine', { s: r.sample.serviceName, p: fmtMoney(r.sample.priceCents), d: fmtMoney(r.sample.discountCents) })}</span>
              <span className="fk-li-s" data-testid="ci-earn">{tx('do.ci.earn', { a: range(r.sample.earningsFullMinCents, r.sample.earningsFullMaxCents), b: range(r.sample.earningsDiscountedMinCents, r.sample.earningsDiscountedMaxCents), n: fmtNumber(r.sample.technicians) })}</span></>
              : <span className="fk-muted">—</span>}</td>
            <td>{r.flag ? <span className="fk-chip warn" data-testid="ci-flag">{codeLabel('do.ci.flag', r.flag)}</span> : <span className="fk-chip ok">{tx('do.ci.approved')}</span>}
              {r.review ? <span className="fk-li-s">{tx('do.ci.reviewedBy', { who: r.review.reviewedBy ?? '—', v: String(r.review.version) })}</span> : null}</td>
            <td className="fn-acts">{canApprove && r.flag ? <button type="button" className="fk-btn primary sm" disabled={busy === r.dealId} onClick={() => approve(r)} data-testid="ci-approve">{tx('do.ci.approve')}</button> : null}</td>
          </tr>)}</tbody>
        </table>}
    </FitPanel>
  );
}
