// POSCommissionReportScreen.tsx — Team → Commission Report (/tenant/reports/commission). Rebuild (Oct 30 2026), one vertical
// scroll, every original module kept (Today / This Week / This Month / This Year · Full View · the five KPIs · Payout by
// Technician with its seven columns · the explanatory note) plus what the guide asks for:
//   • Refresh and Export (CSV of every technician in the period) · Custom range with month calendars · the date basis shown
//   • ONE search — technician name / phone / id, or a line's ticket number, service, customer name or phone — over every
//     record of the period on the server; the table is one row per technician, sortable, paged
//   • Technician Commission Details (Close / Esc): service lines with the CAPTURED rate, tip shares (and mismatches),
//     adjustments (counted or not), recorded payouts — each paged, newest first
//   • Reconciliation: commission + tips = the period's payout OBLIGATION; Paid only from recorded payroll payouts; and a
//     cross-check against the payroll commission calculation (/pos/commission-report/state) for the same days
//   • Commission & Payout History (recorded payouts)
//   • F1/F2 (Finish the Five, Oct 30 2026): the PERSISTED Discrepancy Review (commissionReview.tsx) — Run Check, status,
//     assign / investigate / notes / resolve / dismiss / reopen with history; rate vs historical configuration and refund
//     reversal checks. F3: the CSV is built and audited on the server (same columns and file name); the export history.
// Read only. Nothing here moves money, edits an earning or changes who owns a tip.
import { useEffect, useState } from 'react';
import { t as tx, getLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { posCommissionScreenApi } from '../api/posTeamScreensApi';
import { posCommissionReportApi } from '../api/posCommissionReportApi';
import { useReportCadence, money } from './reportsCommon';
import { useIPadView } from '../components/IPadViewProvider';
import { reportRequest } from '../components/ipad-modules';
import { ProfileAvatarWithPreview } from '@aipowersalon/ui';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, useDebounced, downloadText, requestId } from '../components/FitKit';
import { DiscrepancyReviewPanel, ExportHistory } from './commissionReview';
import { PeriodBar, periodQuery, periodText, useLoad, StateBlock, isForbidden, type PeriodState } from '../components/FinanceKit';
import { codeLabel } from '../components/peopleLabels';
import { pageOf, whenTime } from './technicianScreenParts';
import { nf } from './teamShared';

const SORTS = ['commission', 'payout', 'services', 'name', 'recent'];
const signed = (c: number) => (c > 0 ? '+' : c < 0 ? '−' : '') + money(Math.abs(c));

export function POSCommissionReportScreen() {
  const { reloadKey } = useReportCadence();
  const { open: openIPad } = useIPadView();
  const [period, setPeriod] = useState<PeriodState>({ preset: 'month' });
  const [search, setSearch] = useState(''); const q = useDebounced(search.trim(), 300);
  const [sort, setSort] = useState('commission'); const [page, setPage] = useState(1);
  const [pp, setPp] = useState(1); const [exportErr, setExportErr] = useState<string | null>(null); const [exTick, setExTick] = useState(0);
  const [tick, setTick] = useState(0); const [detail, setDetail] = useState<any | null>(null); const [exporting, setExporting] = useState(false);
  const pq = periodQuery(period); const pk = JSON.stringify(pq);
  useEffect(() => { setPage(1); setPp(1); }, [pk, q, sort]);
  const sum = useLoad(() => posCommissionScreenApi.summary(pq), [pk, tick, reloadKey]);
  const list = useLoad(() => posCommissionScreenApi.technicians({ ...pq, q: q || undefined, sort, page, pageSize: 10 }), [pk, q, sort, page, tick, reloadKey]);
  const pays = useLoad(() => posCommissionScreenApi.payouts({ ...pq, q: q || undefined, page: pp, pageSize: 6 }), [pk, q, pp, tick, reloadKey]);
  // the payroll commission calculation for the same days (a preset only): shown as a cross-check, never mixed in
  const check = useLoad(() => (period.preset !== 'custom' && period.preset !== 'all' ? posCommissionReportApi.state(period.preset) : Promise.resolve(null)), [period.preset, tick, reloadKey]);
  const k = sum.data?.kpis; const per = sum.data?.period;
  const rows: any[] = list.data?.items ?? [];
  type PayrollCalc = { from?: string; to?: string; kpis?: { totalCommissionCents: number; totalTipsCents: number; totalServiceRevenueCents: number } };
  const pc = check.data as PayrollCalc | null;
  const sameDays = !!(pc && per && pc.from === per.from && pc.to === per.to);
  const ck = sameDays && pc?.kpis ? pc.kpis : null;
  const diff = ck && k ? { comm: k.commissionCents - ck.totalCommissionCents, tips: k.tipsCents - ck.totalTipsCents, rev: k.serviceRevenueCents - ck.totalServiceRevenueCents } : null;
  const allRows = async () => { const out: any[] = []; for (let p = 1; p <= 20; p++) { const r = await posCommissionScreenApi.technicians({ ...pq, q: q || undefined, sort, page: p, pageSize: 100 }); out.push(...(r.items ?? [])); if (p >= (r.totalPages ?? 1)) break; } return out; };
  // F3: the server builds the CSV and audits the attempt (requested → succeeded / failed; denied without permission; 503
  // when the audit store is down — then no file). Same columns and file name as before; one request id per click.
  const doExport = async () => {
    setExporting(true); setExportErr(null);
    try {
      const csv = await posCommissionScreenApi.exportCsv({ ...pq, q: q || undefined, sort, lang: getLanguage() === 'vi' ? 'vi' : 'en', requestId: requestId() });
      downloadText(`commission-${per?.from ?? 'all'}-${per?.to ?? 'all'}.csv`, String(csv ?? ''));
    } catch (e) {
      const x = e as { status?: number };
      setExportErr(x?.status === 403 ? tx('cm.ex.denied') : x?.status === 503 ? tx('cm.ex.auditDown') : tx('cm.ex.failed'));
    } finally { setExporting(false); setExTick((n) => n + 1); }
  };
  const fullView = async () => {
    const all = await allRows();
    openIPad(reportRequest(tx('pos.commission_report'), { kpis: [{ label: tx('pos.technicians'), value: k?.technicianCount ?? 0 }, { label: tx('pos.revenue'), value: money(k?.serviceRevenueCents ?? 0) }, { label: tx('pos.commission'), value: money(k?.commissionCents ?? 0) }, { label: tx('pos.payout'), value: money(k?.payoutCents ?? 0) }],
      columns: [tx('glossary.people.technician'), tx('pos.services'), tx('pos.revenue'), tx('pos.commission'), tx('pos.tips'), tx('pos.payout'), tx('pos.rate')],
      rows: all.map((r) => [r.technicianName || '—', r.serviceCount, money(r.serviceRevenueCents), money(r.commissionCents), money(r.tipsCents), money(r.payoutCents), r.effectiveRatePercent + '%']), periodLabel: periodText(per) }));
  };

  if (isForbidden(sum.error)) return <div className="work mos cms" data-testid="commission-screen"><h1>{tx('pos.commission_report')}</h1><StateBlock error={sum.error} onRetry={sum.reload} /></div>;
  return (
    <div className="work mos cms" data-testid="commission-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.commission_report')}</h1><div className="sub">{tx('pos.per_technician_commission_and_tips_from_os3g')}</div></div>
        <div className="fk-head-actions">
          <button type="button" className="fk-btn" onClick={() => setTick((n) => n + 1)} data-testid="refresh">{tx('finance.refresh')}</button>
          <button type="button" className="fk-btn ghost" disabled={!k || exporting} onClick={doExport} data-testid="export">{exporting ? tx('cm.exporting') : tx('cm.export')}</button>
          <button type="button" className="fk-btn ghost" disabled={!k} onClick={fullView} title={tx('pos.open_full_ipad_view')} data-testid="full-view">{tx('pos.full_view')}</button>
        </div>
      </header>
      {exportErr ? <div className="fk-note bad" role="alert" data-testid="export-error"><span>{exportErr}</span></div> : null}

      <div className="mos-tools" data-testid="toolbar">
        <div className="fn-search mos-search"><input className="fk-search wide" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx('cm.searchPh')} aria-label={tx('cm.searchPh')} data-testid="search" />
          {search ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setSearch('')} data-testid="search-clear">✕</button> : null}</div>
        <select className="fk-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={tx('cg.sort')} data-testid="sort">{SORTS.map((x) => <option key={x} value={x}>{tx('cm.sort.' + x)}</option>)}</select>
      </div>
      <div className="fn-tabsrow dsc-periodrow">
        <PeriodBar value={period} onChange={setPeriod} server={per} compact /><span className="fk-hint">{tx('cm.basis.checkout')}</span>
      </div>
      <p className="fk-hint" data-testid="basis">{tx('cm.basisRule')}</p>

      <div className="fk-kpis five cg-kpis" data-testid="kpis">
        {sum.error ? <StateBlock error={sum.error} onRetry={sum.reload} /> : <>
          <KpiCard testId="kpi-techs" label={tx('pos.technicians')} loading={!k} value={k ? nf(k.technicianCount) : ''} sub={tx('cm.k.techs')} />
          <KpiCard testId="kpi-revenue" label={tx('pos.service_revenue')} loading={!k} value={k ? money(k.serviceRevenueCents) : ''} sub={k ? tx('cm.k.revenue', { n: nf(k.lineCount), d: money(k.discountCents) }) : ''} />
          <KpiCard testId="kpi-commission" label={tx('pos.commission')} loading={!k} value={k ? money(k.commissionCents) : ''} sub={k ? (k.commissionAdjustmentCents ? tx('cm.k.commissionAdj', { a: signed(k.commissionAdjustmentCents) }) : tx('cm.k.commission')) : ''} />
          <KpiCard testId="kpi-tips" label={tx('pos.tips')} loading={!k} value={k ? money(k.tipsCents) : ''} sub={tx('cm.k.tips')} />
          <KpiCard testId="kpi-payout" tone="gold" label={tx('pos.total_payout')} loading={!k} value={k ? money(k.payoutCents) : ''} sub={k ? tx('cm.k.payout', { r: String(k.averageRatePercent) }) : ''} />
        </>}
      </div>

      <FitPanel testId="payout-table" title={<>{tx('pos.payout_by_technician')}{list.data ? <span className="fk-muted"> · {tx('cg.matching', { n: nf(list.data.totalItems) })}</span> : null}</>} footer={<Pager info={pageOf(list.data)} onPage={setPage} label={tx('pos.payout_by_technician')} />}>
        {list.error ? <StateBlock error={list.error} onRetry={list.reload} /> : !list.data ? <div className="fk-loading">{tx('pos.loading_commission_report')}</div>
          : rows.length === 0 ? (q ? <Empty title={tx('cg.noMatchSearch', { q })}><button type="button" className="fk-btn" onClick={() => setSearch('')}>{tx('finance.clearFilters')}</button></Empty> : <Empty title={tx('pos.no_commissionable_activity_in_this_period')} />)
          : <div className="tq-scroll"><table className="fk-table fn-table cg-table cm-table" data-testid="payout-rows">
            <thead><tr><th>{tx('pos.technician')}</th><th className="num">{tx('pos.services')}</th><th className="num">{tx('pos.service_revenue')}</th><th className="num">{tx('pos.commission')}</th><th className="num" title={tx('cm.rateTitle')}>{tx('cm.effRate')}</th><th className="num">{tx('pos.tips')}</th><th className="num">{tx('pos.payout')}</th><th className="t-opt">{tx('cm.paidInPeriod')}</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.technicianId} className="inv2-click" onClick={() => setDetail(r)} data-testid="payout-row">
              <td><span className="tq-who"><ProfileAvatarWithPreview name={r.technicianName ?? '?'} url={r.avatarUrl} size={26} type="technician" /><b>{r.technicianName ?? tx('pos.unknown')}</b>{r.inactive ? <span className="fk-chip mut">{tx('cm.inactive')}</span> : null}</span>
                {r.matchedVia ? <span className="fk-li-s">{tx('cm.via.' + r.matchedVia)}</span> : null}</td>
              <td className="num">{nf(r.serviceCount)}</td><td className="num">{money(r.serviceRevenueCents)}</td>
              <td className="num">{money(r.commissionCents)}{r.commissionAdjustmentCents ? <span className="fk-li-s">{tx('cm.adjIncl', { a: signed(r.commissionAdjustmentCents) })}</span> : null}</td>
              <td className="num">{r.effectiveRatePercent}%</td><td className="num">{money(r.tipsCents)}</td><td className="num"><b>{money(r.payoutCents)}</b></td>
              <td className="t-opt">{r.paidCents ? money(r.paidCents) : '—'}{r.pendingCents ? <span className="fk-li-s">{tx('cm.pendingV', { v: money(r.pendingCents) })}</span> : null}</td></tr>)}</tbody>
            {k && !q && list.data.totalPages === 1 ? <tfoot><tr data-testid="payout-total"><td><b>{tx('pos.total')}</b></td><td className="num"><b>{nf(k.lineCount)}</b></td><td className="num"><b>{money(k.serviceRevenueCents)}</b></td><td className="num"><b>{money(k.commissionCents)}</b></td>
              <td className="num">{k.averageRatePercent}%</td><td className="num"><b>{money(k.tipsCents)}</b></td><td className="num"><b>{money(k.payoutCents)}</b></td><td className="t-opt">{k.paidCents ? money(k.paidCents) : '—'}</td></tr></tfoot> : null}
          </table></div>}
        <p className="fk-hint" data-testid="note">{tx('cm.note')}</p>
      </FitPanel>

      <div className="mos-row two cg-row">
        <FitPanel testId="reconciliation" title={tx('cm.recon')}>
          {!k ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
            <dl className="fk-dl mo-dl cm-recon" data-testid="recon">
              <dt>{tx('cm.r.commission')}</dt><dd>{money(k.commissionCents - k.commissionAdjustmentCents)}</dd>
              <dt>{tx('cm.r.adjustments')}</dt><dd>{signed(k.commissionAdjustmentCents + k.tipAdjustmentCents)}</dd>
              <dt>{tx('cm.r.tips')}</dt><dd>{money(k.tipsCents - k.tipAdjustmentCents)}</dd>
              <dt><b>{tx('cm.r.payable')}</b></dt><dd><b>{money(k.payoutCents)}</b></dd>
              <dt>{tx('cm.r.paid')}</dt><dd>{money(k.paidCents)}{k.pendingCents ? ` · ${tx('cm.pendingV', { v: money(k.pendingCents) })}` : ''}</dd>
              <dt>{tx('cm.r.diff')}</dt><dd>{signed(k.payoutCents - k.paidCents)}</dd>
            </dl>
            <p className="fk-hint">{tx('cm.reconRule')}</p>
            {period.preset === 'custom' || period.preset === 'all' ? <p className="fk-hint">{tx('cm.checkPresetOnly')}</p>
              : check.error ? <p className="fk-hint">{tx('cm.checkUnavailable')}</p> : !check.data ? null : !sameDays ? <p className="fk-hint">{tx('cm.checkOtherDays')}</p>
              : diff && !diff.comm && !diff.tips && !diff.rev ? <div className="fk-note ok" data-testid="check-ok"><span>{tx('cm.checkOk')}</span></div>
              : diff ? <div className="fk-note warn" data-testid="check-diff"><span>{tx('cm.checkDiff', { c: signed(diff.comm), t: signed(diff.tips), r: signed(diff.rev) })}</span></div> : null}
          </>}
        </FitPanel>
        <FitPanel testId="payout-history" title={<>{tx('cm.history')}{pays.data ? <span className="fk-muted"> · {tx('cg.matching', { n: nf(pays.data.totalItems) })}</span> : null}</>} footer={<Pager info={pageOf(pays.data)} onPage={setPp} label={tx('cm.history')} />}>
          <PayoutTable p={pays} showTech />
          <p className="fk-hint">{tx('cm.historyRule')}</p>
        </FitPanel>
      </div>

      <DiscrepancyReviewPanel pq={pq} onOpenTech={(t) => setDetail(t)} />
      <ExportHistory load={posCommissionScreenApi.exportHistory} tick={exTick} />

      {detail ? <TechCommissionDetails row={detail} pq={pq} periodLabel={periodText(per)} onClose={() => setDetail(null)} /> : null}
    </div>
  );
}

function PayoutTable({ p, showTech }: { p: { data: any; error: unknown; reload: () => void }; showTech?: boolean }) {
  if (p.error) return <StateBlock error={p.error} onRetry={p.reload} />;
  if (!p.data) return <div className="fk-loading">{tx('pos.loading')}</div>;
  if (!p.data.items?.length) return <Empty title={tx('cm.noPayouts')} />;
  return <table className="fk-table fn-table cg-table" data-testid="payouts-table"><thead><tr><th>{tx('tm.col.when')}</th>{showTech ? <th>{tx('pos.technician')}</th> : null}<th>{tx('cm.p.period')}</th><th>{tx('cm.p.method')}</th><th>{tx('pos.status')}</th><th className="num">{tx('cm.p.amount')}</th></tr></thead>
    <tbody>{p.data.items.map((x: any) => <tr key={x.id} data-testid="payout-history-row"><td>{whenTime(x.paidAt ?? x.createdAt)}</td>{showTech ? <td>{x.technician ?? '—'}</td> : null}<td>{x.payrollPeriod ?? '—'}{x.reference ? <span className="fk-li-s">{x.reference}</span> : null}</td>
      <td>{codeLabel('cm.m.' + x.method, x.method)}</td><td><span className={'fk-chip ' + (x.status === 'paid' ? 'ok' : x.status === 'failed' || x.status === 'canceled' ? 'bad' : 'warn')}>{codeLabel('cm.s.' + x.status, x.status)}</span></td><td className="num"><b>{money(x.amountCents)}</b></td></tr>)}</tbody></table>;
}

/** Technician Commission Details: the period's money and the records behind every figure (Close / Esc) */
function TechCommissionDetails({ row, pq, periodLabel, onClose }: { row: any; pq: Record<string, unknown>; periodLabel: string; onClose: () => void }) {
  const [tab, setTab] = useState<'lines' | 'tips' | 'adjustments' | 'payouts'>('lines');
  const [lq, setLq] = useState(row.focus ?? ''); const lqq = useDebounced(lq.trim(), 300); const [pg, setPg] = useState(1);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  useEffect(() => setPg(1), [tab, lqq]);
  const id = row.technicianId as string;
  const d = useLoad(() => (tab === 'lines' ? posCommissionScreenApi.lines(id, { ...pq, q: lqq || undefined, page: pg, pageSize: 8 }) : tab === 'tips' ? posCommissionScreenApi.tips(id, { ...pq, page: pg, pageSize: 8 })
    : tab === 'adjustments' ? posCommissionScreenApi.adjustments(id, { ...pq, page: pg, pageSize: 8 }) : posCommissionScreenApi.payouts({ ...pq, technicianId: id, page: pg, pageSize: 8 })), [tab, lqq, pg, id, JSON.stringify(pq)]);
  const x: any = d.data;
  return (
    <FitDialog wide title={row.technicianName ?? tx('cm.details')} subtitle={<>{periodLabel} · {tx('cm.basis.checkout')}</>} onClose={onClose} testId="dlg-commission"
      footer={<button type="button" className="fk-btn primary" onClick={onClose} data-testid="commission-close">{tx('pos.close')}</button>}>
      {row.serviceRevenueCents != null ? <dl className="fk-dl mo-dl" data-testid="commission-summary">
        <dt>{tx('pos.services')}</dt><dd>{nf(row.serviceCount)} · {money(row.serviceRevenueCents)} · {tx('cm.discountV', { v: money(row.discountCents) })}</dd>
        <dt>{tx('cm.base')}</dt><dd>{money(row.commissionableCents)}</dd>
        <dt>{tx('pos.commission')}</dt><dd>{money(row.commissionCents)} · {tx('cm.effRate')} {row.effectiveRatePercent}%{row.commissionAdjustmentCents ? ` · ${tx('cm.adjIncl', { a: signed(row.commissionAdjustmentCents) })}` : ''}</dd>
        <dt>{tx('pos.tips')}</dt><dd>{money(row.tipsCents)}{row.tipAdjustmentCents ? ` · ${tx('cm.adjIncl', { a: signed(row.tipAdjustmentCents) })}` : ''}</dd>
        <dt><b>{tx('cm.r.payable')}</b></dt><dd><b>{money(row.payoutCents)}</b></dd>
        <dt>{tx('cm.r.paid')}</dt><dd>{money(row.paidCents)}{row.pendingCents ? ` · ${tx('cm.pendingV', { v: money(row.pendingCents) })}` : ''} <span className={'fk-chip ' + (row.paidCents >= row.payoutCents && row.payoutCents > 0 ? 'ok' : row.paidCents > 0 ? 'warn' : 'mut')}>{tx(row.paidCents >= row.payoutCents && row.payoutCents > 0 ? 'cm.badge.paid' : row.paidCents > 0 ? 'cm.badge.part' : 'cm.badge.none')}</span></dd>
      </dl> : null}
      <div className="fk-tabs" role="tablist" aria-label={tx('cm.details')}>{(['lines', 'tips', 'adjustments', 'payouts'] as const).map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} data-testid={'ctab-' + t}>{tx('cm.tab.' + t)}</button>)}</div>
      {tab === 'lines' ? <div className="mos-tools"><div className="fn-search mos-search"><input className="fk-search" type="search" value={lq} onChange={(e) => setLq(e.target.value)} placeholder={tx('cm.linePh')} aria-label={tx('cm.linePh')} data-testid="line-search" /></div></div> : null}
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !x ? <div className="fk-loading">{tx('pos.loading')}</div> : !x.items?.length ? <Empty title={tx('cm.noRecords')} />
        : tab === 'lines' ? <div className="tq-scroll"><table className="fk-table fn-table cg-table cm-table" data-testid="lines-table"><thead><tr><th>{tx('cm.l.at')}</th><th>{tx('cm.l.ticket')}</th><th>{tx('cm.l.service')}</th><th className="num">{tx('pos.revenue')}</th><th className="num">{tx('cm.discount')}</th><th className="num">{tx('cm.base')}</th><th className="num">{tx('cm.l.rate')}</th><th className="num">{tx('pos.commission')}</th><th className="num">{tx('pos.tips')}</th></tr></thead>
          <tbody>{x.items.map((l: any) => <tr key={l.id} data-testid="line-row"><td>{whenTime(l.at)}</td><td>{l.ticketNumber ?? '—'}{l.customer ? <span className="fk-li-s">{l.customer}</span> : null}</td>
            <td>{l.service ?? '—'}{l.techsOnTicket > 1 ? <span className="fk-li-s">{tx('cm.shared', { n: nf(l.techsOnTicket) })}</span> : null}{l.kind !== 'service' ? <span className="fk-li-s">{codeLabel('cm.kind.' + l.kind, l.kind)}</span> : null}</td>
            <td className="num">{money(l.grossCents)}</td><td className="num">{l.discountCents ? money(l.discountCents) : '—'}</td><td className="num">{money(l.commissionableCents)}</td>
            <td className="num">{l.rateValue == null ? '—' : l.rateType === 'percent' || l.rateType === 'percentage' ? `${l.rateValue}%` : money(Math.round(l.rateValue))}<span className="fk-li-s">{tx('cm.captured')}</span></td>
            <td className="num"><b>{money(l.earnedCents)}</b></td><td className="num">{l.tipsCents ? money(l.tipsCents) : '—'}</td></tr>)}</tbody></table></div>
        : tab === 'tips' ? <table className="fk-table fn-table cg-table" data-testid="tips-table"><thead><tr><th>{tx('cm.l.at')}</th><th>{tx('cm.l.ticket')}</th><th className="num">{tx('cm.t.hers')}</th><th className="num">{tx('cm.t.ticket')}</th><th>{tx('cm.t.split')}</th></tr></thead>
          <tbody>{x.items.map((t: any) => <tr key={t.id} data-testid="tip-row"><td>{whenTime(t.at)}</td><td>{t.ticketNumber ?? '—'}</td><td className="num"><b>{money(t.tipCents)}</b></td><td className="num">{money(t.ticketTipCents)}</td>
            <td>{t.shares > 1 ? tx('cm.t.shared', { n: nf(t.shares) }) : tx('cm.t.single')}{t.mismatch ? <span className="fk-chip bad">{tx('cm.t.mismatch', { a: money(t.allocatedCents) })}</span> : null}</td></tr>)}</tbody></table>
        : tab === 'adjustments' ? <table className="fk-table fn-table cg-table" data-testid="adj-table"><thead><tr><th>{tx('cm.l.at')}</th><th>{tx('cm.a.category')}</th><th className="num">{tx('cm.p.amount')}</th><th>{tx('pos.status')}</th><th>{tx('cm.a.reason')}</th><th className="t-opt">{tx('cm.a.by')}</th></tr></thead>
          <tbody>{x.items.map((a: any) => <tr key={a.id} data-testid="adj-row"><td>{whenTime(a.at)}</td><td>{codeLabel('cm.c.' + a.category, a.category)}</td><td className="num"><b>{signed(a.amountCents)}</b></td>
            <td><span className={'fk-chip ' + (a.counted ? 'ok' : 'mut')}>{codeLabel('cm.as.' + a.status, a.status)}</span>{!a.counted ? <span className="fk-li-s">{tx('cm.notCounted')}</span> : null}</td><td>{a.reason ?? '—'}</td><td className="t-opt">{[a.requestedBy, a.approvedBy].filter(Boolean).join(' → ') || '—'}</td></tr>)}</tbody></table>
        : <PayoutTable p={d} />}
      <Pager info={pageOf(x)} onPage={setPg} compact />
    </FitDialog>
  );
}
