// POSAIReceiptScannerScreen.tsx — AI Center → AI OCR Receipt Scanner (/tenant/ai/receipt-scanner). AI OCR Receipt Scanner
// guide (Nov 1 2026). The page kept its add-on header (name, finance, description, "Works in", price, usage, status, Cancel
// add-on) — now honest (see AiPackagePanel) — and the empty space below it becomes the scanner's dashboard, read from
// /pos/receipt-center/*:
//   • four cards with stated definitions: Scanned receipts (uploaded in the period) · Needs review (the current queue) ·
//     Potential duplicates (open holds) · Approved expenses (approved from a receipt in the period), plus what is stuck;
//   • the receipt history: search (vendor, receipt / invoice number, product or SKU, an exact amount, a document or expense
//     id), status groups, which date the range means, presets + From/To month calendar, sort, numbered pages, newest first;
//   • four separate status tracks per receipt — reading · expense · stock receiving · duplicate;
//   • a read-only detail; every change (correct, approve, post, receive) happens in Receipt Review, which this page links to;
//   • Check OCR System (read-only).
// A scanned receipt is evidence, not an expense: nothing here posts, pays, approves or changes stock.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posReceiptCenterApi as rc } from '../api/posReceiptCenterApi';
import { AiPackagePanel } from './POSAiPackageScreen';
import { errorTextOf } from '../i18n/error-text';
import { fmtNumber, fmtInZone } from '../i18n/format';
import { money } from './reportsCommon';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry } from '../components/FitKit';
import { RangeCalendar, isForbidden } from '../components/FinanceKit';

const t = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const when = (iso?: string | null, time = true) => (iso ? fmtInZone(iso, time ? { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const cents = (n: number | null | undefined) => (n == null ? t('rcsx.unknown') : money(n));
const GROUPS = ['all', 'processing', 'needs_review', 'duplicates', 'approved', 'posted', 'failed', 'rejected', 'quarantined'] as const;
const PRESETS = ['today', 'yesterday', 'week', 'last_7', 'month', 'last_month', 'last_30', 'last_90', 'year'] as const;
const DATE_FIELDS = ['uploaded', 'purchase', 'posted'] as const;
const SORTS = ['newest', 'oldest', 'purchase_date', 'total_high', 'total_low', 'vendor'] as const;
const STATE_TONE: Record<string, string> = { PASSED: 'ok', WARNING: 'warn', FAILED: 'bad', INSUFFICIENT_DATA: '', UNAVAILABLE: 'bad' };
const TRACK_TONE: Record<string, string> = { failed: 'bad', quarantined: 'bad', posting_failed: 'bad', receiving_failed: 'bad', exact: 'bad', likely: 'warn', possible: 'warn',
  processing: 'warn', awaiting_review: 'gold', approved_not_posted: 'gold', expense_approved: 'ok', received: 'ok', read: 'ok' };
const REVIEW = '/tenant/ai/ocr-receipt';
const FIELDS = ['vendor', 'total', 'subtotal', 'tax', 'document_date', 'document_number', 'discount', 'fees', 'tip', 'due_date', 'payment_terms', 'po_number', 'vendor_address', 'vendor_phone', 'document_time', 'account_number'];
function errText(e: any, fallbackKey: string) {
  const code = e?.body?.code ?? e?.code;
  if (code === 'RC_INVALID_PERIOD' || code === 'RC_NOT_FOUND') return t('rcsx.err.' + code);
  if (isForbidden(e)) return t('rcsx.err.PERMISSION_DENIED');
  return errorTextOf(e, t(fallbackKey));
}
type Period = { preset?: string; from?: string; to?: string };

export function POSAIReceiptScannerScreen() {
  const [health, setHealth] = useState<any | 'loading' | null>(null);
  const [tick, setTick] = useState(0);
  const runCheck = () => { setHealth('loading'); rc.check().then(setHealth).catch((e) => setHealth({ error: errText(e, 'rcsx.loadFailed') })); };
  return (
    <AiPackagePanel code="ai_ocr_receipt_scanner" title={t('pos.ai_receipt_scanner')} actionsSlot={<>
      <button className="btn ghost" data-testid="rcsx-refresh" onClick={() => setTick((n) => n + 1)}>{t('rcsx.refresh')}</button>
      <button className="btn ghost" data-testid="rcsx-check" onClick={runCheck}>{t('rcsx.check')}</button>
      <Link className="btn" to={REVIEW} data-testid="rcsx-open-review">{t('rcsx.openReview')}</Link>
    </>}>
      <ReceiptDashboard key={tick} />
      {health ? <HealthDialog data={health} onClose={() => setHealth(null)} /> : null}
    </AiPackagePanel>
  );
}

function ReceiptDashboard() {
  const [period, setPeriod] = useState<Period>({ preset: 'month' });
  const [sum, setSum] = useState<any>(null);
  const [sumErr, setSumErr] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [f, setF] = useState<{ q?: string; group: string; dateField: string; sort: string; page: number; pageSize: number }>({ group: 'all', dateField: 'uploaded', sort: 'newest', page: 1, pageSize: 25 });
  const [list, setList] = useState<any>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [cal, setCal] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const loadSum = useCallback(() => { setSumErr(null); rc.summary(period).then(setSum).catch((e) => setSumErr(errText(e, 'rcsx.loadFailed'))); }, [period]);
  useEffect(() => { loadSum(); }, [loadSum]);
  const loadList = useCallback(() => { setListErr(null); rc.documents({ ...f, ...period, q: f.q }).then(setList).catch((e) => setListErr(errText(e, 'rcsx.loadFailed'))); }, [f, period]);
  useEffect(() => { loadList(); }, [loadList]);
  const set = (p: Partial<typeof f>, keepPage = false) => setF((x) => ({ ...x, ...p, page: keepPage ? (p.page ?? x.page) : 1 }));
  const setPer = (p: Period) => { setPeriod(p); setF((x) => ({ ...x, page: 1 })); };
  const c = sum?.cards; const pl = sum?.pipeline;
  const any = !!(f.q || f.group !== 'all');

  return (
    <div data-testid="rcsx-dashboard" style={{ marginTop: 18 }}>
      <p className="sub" data-testid="rcsx-safety">{t('rcsx.safety')}</p>
      {sumErr ? <ErrorRetry message={sumErr} onRetry={loadSum} /> : null}
      <div className="rvw-kpis" data-testid="rcsx-kpis">
        <KpiCard testId="kpi-scanned" label={t('rcsx.kpi.scanned')} value={c ? fmtNumber(c.scanned) : '—'} loading={!sum && !sumErr} onClick={() => set({ group: 'all' })} />
        <KpiCard testId="kpi-review" label={t('rcsx.kpi.needsReview')} value={c ? fmtNumber(c.needsReview) : '—'} loading={!sum && !sumErr} tone={c?.needsReview ? 'gold' : undefined} onClick={() => set({ group: 'needs_review' })} />
        <KpiCard testId="kpi-dupes" label={t('rcsx.kpi.duplicates')} value={c ? fmtNumber(c.duplicates) : '—'} loading={!sum && !sumErr} tone={c?.duplicates ? 'warn' : undefined} onClick={() => set({ group: 'duplicates' })} />
        <KpiCard testId="kpi-approved" label={t('rcsx.kpi.approved')} value={c ? fmtNumber(c.approvedExpenses) : '—'} loading={!sum && !sumErr} onClick={() => set({ group: 'posted' })} />
      </div>
      {sum ? <p className="sub" data-testid="rcsx-defs">{t('rcsx.defs', { amount: money(c.approvedExpenseCents) })}</p> : null}
      {pl && (pl.failed || pl.quarantined || pl.processing || pl.approvedNotPosted) ? <div className="panel" style={{ padding: 10 }} data-testid="rcsx-pipeline">
        {pl.processing ? <span className="chip warn">{t('rcsx.pl.processing', { n: fmtNumber(pl.processing), at: when(pl.oldestProcessingAt) })}</span> : null}{' '}
        {pl.failed ? <button className="chip bad" onClick={() => set({ group: 'failed' })}>{t('rcsx.pl.failed', { n: fmtNumber(pl.failed) })}</button> : null}{' '}
        {pl.quarantined ? <button className="chip bad" onClick={() => set({ group: 'quarantined' })}>{t('rcsx.pl.quarantined', { n: fmtNumber(pl.quarantined) })}</button> : null}{' '}
        {pl.approvedNotPosted ? <button className="chip gold" onClick={() => set({ group: 'approved' })}>{t('rcsx.pl.approved', { n: fmtNumber(pl.approvedNotPosted) })}</button> : null}
      </div> : null}

      <section className="panel rvw-feed" data-testid="rcsx-history" style={{ marginTop: 12 }}>
        <div className="p-h">{t('rcsx.history')} <span className="sub">· {t('rcsx.newestFirst')}</span></div>
        <form className="rvw-filters" onSubmit={(e) => { e.preventDefault(); set({ q: draft.trim() || undefined }); }}>
          <input className="rvw-search" data-testid="rcsx-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('rcsx.searchPh')} aria-label={t('rcsx.searchPh')} />
          <button className="btn" type="submit">{t('rcsx.search')}</button>
          <select data-testid="rcsx-group" aria-label={t('rcsx.statusLabel')} value={f.group} onChange={(e) => set({ group: e.target.value })}>{GROUPS.map((g) => <option key={g} value={g}>{t('rcsx.group.' + g)}</option>)}</select>
          <select data-testid="rcsx-datefield" aria-label={t('rcsx.dateLabel')} value={f.dateField} onChange={(e) => set({ dateField: e.target.value })}>{DATE_FIELDS.map((d) => <option key={d} value={d}>{t('rcsx.date.' + d)}</option>)}</select>
          <select data-testid="rcsx-sort" aria-label={t('rcsx.sortLabel')} value={f.sort} onChange={(e) => set({ sort: e.target.value })}>{SORTS.map((s) => <option key={s} value={s}>{t('rcsx.sort.' + s)}</option>)}</select>
          {any ? <button className="btn ghost" type="button" onClick={() => { setDraft(''); set({ q: undefined, group: 'all' }); }}>{t('rcsx.clear')}</button> : null}
        </form>
        <div className="rvw-dates">
          <button className={'btn ghost' + (!period.preset ? ' on' : '')} onClick={() => setPer({})}>{t('rcsx.preset.all')}</button>
          {PRESETS.map((p) => <button key={p} className={'btn ghost' + (period.preset === p ? ' on' : '')} data-testid={`preset-${p}`} onClick={() => setPer({ preset: p })}>{t('rcsx.preset.' + p)}</button>)}
          <button className={'btn ghost' + (period.preset === 'custom' ? ' on' : '')} data-testid="preset-custom" onClick={() => setCal(true)}>{period.preset === 'custom' ? `${period.from} → ${period.to}` : t('rcsx.preset.custom')}</button>
        </div>
        {cal ? <div className="rvw-cal"><RangeCalendar initial={{ from: period.from, to: period.to }} today={list?.period?.today ?? new Date().toISOString().slice(0, 10)}
          onApply={(r) => { setPer({ preset: 'custom', from: r.from, to: r.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { setPer({}); setCal(false); }} /></div> : null}
        <p className="sub">{t('rcsx.dateNote.' + f.dateField)}</p>
        {listErr ? <ErrorRetry message={listErr} onRetry={loadList} /> : !list ? <div className="state">{t('rcsx.loading')}</div> : list.items.length === 0 ? <Empty title={any || period.preset ? t('rcsx.noMatch') : t('rcsx.noReceipts')} /> : (
          <div className="rvw-table-wrap"><table className="tbl rvw-table"><thead><tr><th>{t('rcsx.col.vendor')}</th><th>{t('rcsx.col.purchase')}</th><th>{t('rcsx.col.uploaded')}</th><th style={{ textAlign: 'right' }}>{t('rcsx.col.total')}</th>
            <th>{t('rcsx.col.reading')}</th><th>{t('rcsx.col.expense')}</th><th>{t('rcsx.col.receiving')}</th><th>{t('rcsx.col.duplicate')}</th><th /></tr></thead>
            <tbody>{list.items.map((r: any) => <tr key={r.id} data-testid="rcsx-row" tabIndex={0} onClick={() => setOpen(r.id)} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(r.id); }}>
              <td>{r.vendor ?? <span className="sub">{t('rcsx.noVendor')}</span>}{r.number ? <div className="sub">#{r.number}</div> : null}{r.branch ? <div className="sub">{r.branch}</div> : null}</td>
              <td className="nowrap">{r.purchaseDate ?? '—'}</td><td className="nowrap">{when(r.uploadedAt)}</td><td className="num">{cents(r.totalCents)}</td>
              {(['reading', 'expense', 'receiving', 'duplicate'] as const).map((k) => <td key={k}><span className={'chip ' + (TRACK_TONE[r.tracks[k]] ?? '')} data-testid={`trk-${k}`}>{t(`rcsx.trk.${k}.${r.tracks[k]}`)}</span></td>)}
              <td><button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); setOpen(r.id); }}>{t('rcsx.view')}</button></td></tr>)}</tbody></table></div>)}
        <div className="rvw-pager">
          <Pager info={list ? { page: list.page, pageSize: list.pageSize, totalItems: list.total, totalPages: list.totalPages } : null} onPage={(p) => set({ page: p }, true)} />
          <label className="rvw-f"><span>{t('rcsx.rows')}</span><select value={String(f.pageSize)} onChange={(e) => set({ pageSize: Number(e.target.value) })}>{['10', '25', '50', '100'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
        </div>
      </section>
      {open ? <ReceiptOverlay id={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function ReceiptOverlay({ id, onClose }: { id: string; onClose: () => void }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { rc.document(id).then(setD).catch((e) => setErr(errText(e, 'rcsx.loadFailed'))); }, [id]);
  const a = d?.amounts;
  return (
    <FitDialog wide testId="rcsx-overlay" title={t('rcsx.ov.title')} subtitle={d ? `${d.vendor ?? t('rcsx.noVendor')} · ${d.purchaseDate ?? '—'}` : undefined} onClose={onClose}
      footer={<div className="rvw-ov-foot"><Link className="btn" to={`${REVIEW}?doc=${encodeURIComponent(id)}`} data-testid="rcsx-review-link">{t('rcsx.ov.openInReview')}</Link>
        {d?.expense ? <Link className="btn ghost" to="/tenant/payments/expenses" data-testid="rcsx-expense-link">{t('rcsx.ov.openExpenses')}</Link> : null}
        <button className="btn ghost" data-testid="rcsx-close" onClick={onClose}>{t('rcsx.close')}</button></div>}>
      {err ? <div className="err">{err}</div> : !d ? <div className="state">{t('rcsx.loading')}</div> : <>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }} data-testid="rcsx-tracks">
          {(['reading', 'expense', 'receiving', 'duplicate'] as const).map((k) => <span key={k} className={'chip ' + (TRACK_TONE[d.tracks[k]] ?? '')}>{t('rcsx.col.' + k)}: {t(`rcsx.trk.${k}.${d.tracks[k]}`)}</span>)}
        </div>
        <dl className="rvw-dl">
          <dt>{t('rcsx.ov.number')}</dt><dd>{d.number ?? '—'}</dd>
          <dt>{t('rcsx.col.purchase')}</dt><dd>{d.purchaseDate ?? '—'}{d.dateAmbiguous ? <span className="sub warn"> · {t('rcsx.ov.dateAmbiguous')}</span> : null}</dd>
          <dt>{t('rcsx.col.uploaded')}</dt><dd>{when(d.uploadedAt)}{d.uploader ? ` · ${d.uploader}` : ''}{d.branch ? ` · ${d.branch}` : ''}</dd>
          <dt>{t('rcsx.ov.amounts')}</dt><dd data-testid="rcsx-amounts">{t('rcsx.ov.subtotal')} {cents(a.subtotalCents)} · {t('rcsx.ov.tax')} {cents(a.taxCents)} · {t('rcsx.ov.fees')} {cents(a.feesCents)} · <b>{t('rcsx.col.total')} {cents(a.totalCents)}</b> {d.currency}</dd>
          {d.category ? <><dt>{t('rcsx.ov.category')}</dt><dd>{d.category.name ?? '—'} <span className="sub">({t(d.category.confirmed ? 'rcsx.ov.confirmed' : 'rcsx.ov.suggested')})</span></dd></> : null}
        </dl>
        {d.checks ? <><h4>{t('rcsx.ov.checks')} <span className={'chip ' + (d.checks.blocksPosting ? 'bad' : d.checks.status === 'valid' ? 'ok' : 'warn')}>{t('rcsx.check.' + (d.checks.status ?? 'pending'))}</span></h4>
          {d.checks.missing.length ? <p className="sub">{t('rcsx.ov.missing', { f: d.checks.missing.join(', ') })}</p> : null}</> : null}
        <h4>{t('rcsx.ov.fields')}</h4>
        {d.fields.length === 0 ? <p className="sub">{t('rcsx.ov.noFields')}</p> : <table className="tbl w-full"><tbody>{d.fields.map((x: any) => <tr key={x.key}>
          <td>{t('rcsx.field.' + (FIELDS.includes(x.key) ? x.key : 'other'))}</td><td>{x.cents != null ? cents(x.cents) : (x.value ?? '—')}</td><td className="sub">{t('rcsx.fstate.' + x.state)}{x.confidence == null ? '' : ` · ${Math.round(x.confidence * 100)}%`}{x.corrected ? ` · ${t('rcsx.ov.corrected')}` : ''}</td></tr>)}</tbody></table>}
        {d.lines.length ? <><h4>{t('rcsx.ov.lines')}</h4><table className="tbl w-full" data-testid="rcsx-lines"><tbody>{d.lines.map((x: any) => <tr key={x.n}>
          <td>{x.description ?? '—'}{x.sku ? <div className="sub">{x.sku}</div> : null}</td><td className="num">{x.quantity ?? '—'} {x.unit ?? ''}</td><td className="num">{cents(x.unitCents)}</td><td className="num">{cents(x.totalCents)}</td>
          <td>{x.reconciles === false ? <span className="chip warn">{t('rcsx.ov.lineMismatch')}</span> : null}</td></tr>)}</tbody></table></> : null}
        {d.duplicates.length ? <><h4>{t('rcsx.ov.duplicates')}</h4>{d.duplicates.map((x: any) => <div key={x.documentId} className="rvw-ev" data-testid="rcsx-dupe">
          <span className="chip warn">{t('rcsx.trk.duplicate.' + x.status)}</span> {x.vendor ?? '—'} · {cents(x.totalCents)} · {x.purchaseDate ?? '—'}{x.dismissed ? ` · ${t('rcsx.ov.dismissed')}` : ''}</div>)}</> : null}
        <h4>{t('rcsx.ov.links')}</h4>
        <ul data-testid="rcsx-links">
          <li>{d.expense ? t('rcsx.ov.expense', { s: t('rcsx.trk.expense.expense_' + d.expense.status), a: cents(d.expense.amountCents) }) : t('rcsx.ov.noExpense')}</li>
          {d.postings.map((p: any, i: number) => <li key={i}>{t('rcsx.ov.posting', { d: t('rcsx.dest.' + p.destination), s: t('rcsx.pstatus.' + p.status) })}{p.postedAt ? ` · ${when(p.postedAt)}` : ''}</li>)}
        </ul>
        {d.trail.length ? <><h4>{t('rcsx.ov.trail')}</h4>{d.trail.map((x: any, i: number) => <div key={i} className="rvw-ev">{when(x.at)} · <b>{t('rcsx.act.' + x.action)}</b>{x.by ? ` · ${x.by}` : ''}{x.reason ? ` · ${x.reason}` : ''}</div>)}</> : null}
        <p className="sub">{t('rcsx.ov.readOnly')}</p>
      </>}
    </FitDialog>
  );
}

function HealthDialog({ data, onClose }: { data: any; onClose: () => void }) {
  return (
    <FitDialog wide testId="rcsx-health" title={t('rcsx.check')} subtitle={data && data !== 'loading' && !data.error ? t('rcsx.health.overall', { s: t('rcsx.health.' + data.overall), at: when(data.checkedAt) }) : undefined} onClose={onClose}
      footer={<button className="btn ghost" onClick={onClose}>{t('rcsx.close')}</button>}>
      {data === 'loading' ? <div className="state">{t('rcsx.health.running')}</div> : data.error ? <div className="err">{data.error}</div> : <>
        <p className="sub">{t('rcsx.health.readOnly')}{data.reused ? ` ${t('rcsx.health.recent')}` : ''}</p>
        {data.checks.map((x: any) => (
          <div key={x.key} className="rvw-check" data-testid={`chk-${x.key}`}>
            <div><span className={'chip ' + (STATE_TONE[x.state] ?? '')}>{t('rcsx.health.' + x.state)}</span> <b>{t('rcsx.health.k.' + x.key)}</b>{x.count ? <span className="sub"> · {fmtNumber(x.count)}</span> : null}</div>
            <div className="sub">{t('rcsx.health.d.' + x.key + '.' + x.state)}</div>
          </div>
        ))}
      </>}
    </FitDialog>
  );
}
