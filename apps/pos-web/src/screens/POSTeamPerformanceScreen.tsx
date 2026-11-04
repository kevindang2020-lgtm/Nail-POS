// POSTeamPerformanceScreen.tsx — Team → Performance (/tenant/team/performance). Rebuild (Oct 30 2026), one vertical scroll,
// every original module kept (Overall Score · Avg Performance · Total Services · Performance Distribution with its four tiers ·
// Top Performers) plus the guide's additions.
//
// The scoring fix first: the photo's "5% / 5%" was the average customer review rating (1–5) printed with a "%" — a 5.0 of 5
// shown as 5%. The numbers are the same ratings; they now read "5.0 / 5" with how many reviews they rest on:
//   Overall Score    every verified review in the period counts once (salon-wide)
//   Avg Performance  each rated technician counts once (the mean of their averages)
//   Total Services   unique paid service lines (a shared line once; add-ons, retail and removed lines never)
// No reviews = Unrated (its own bar), never "Needs Improvement". Ranking puts technicians with at least the minimum sample
// first; fewer reviews are marked low sample. Tips, commission and pay are never part of a score.
//
// Added: Refresh · Reports · Export · Today / Week / Month / Year / Custom (month calendars) · ONE search (technician name /
// phone / id, or a service performed, customer or ticket) · the Technician Performance Directory (tier filter from the chart,
// sort, pages) · Technician Performance Details (Close / Esc): score and sample, rank, the previous period beside this one,
// completed services and verified reviews, each paged newest first, and links to the profile and appointments.
//
// Finish the Five (Oct 30 2026): F5 — the versioned 0–100 Overall Technician Performance Score (compositeScore.tsx) in a
// SEPARATE, separately labelled panel in comparison mode (Top Performers still ranks by the 0–5 rating and says so).
// F3 — the CSV is built and audited on the server (same columns and file name).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t as tx, getLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { ProfileAvatarWithPreview } from '@aipowersalon/ui';
import { posTeamPerformanceScreenApi } from '../api/posTeamScreensApi';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, useDebounced, downloadText, requestId } from '../components/FitKit';
import { CompositeComparison, CompositeDetails } from './compositeScore';
import { PeriodBar, periodQuery, periodText, useLoad, StateBlock, isForbidden, type PeriodState } from '../components/FinanceKit';
import { pageOf, whenTime } from './technicianScreenParts';
import { nf } from './teamShared';

const TIERS = ['excellent', 'very_good', 'good', 'needs', 'unrated'] as const;
const TIER_TONE: Record<string, string> = { excellent: 'ok', very_good: 'ok', good: 'warn', needs: 'bad', unrated: 'mut' };
const SORTS = ['score', 'services', 'name', 'recent', 'newest'];
const reviewsN = (n: number) => (n === 1 ? tx('tp.review1') : tx('tp.reviewsN', { n: nf(n) }));
const of5 = (v: number | null | undefined) => (v == null ? tx('tp.notRated') : tx('tp.of5', { v: v.toFixed(1) }));

export function POSTeamPerformanceScreen() {
  const nav = useNavigate();
  const [period, setPeriod] = useState<PeriodState>({ preset: 'month' });
  const [search, setSearch] = useState(''); const q = useDebounced(search.trim(), 300);
  const [tier, setTier] = useState('all'); const [sort, setSort] = useState('score'); const [page, setPage] = useState(1);
  const [tick, setTick] = useState(0); const [sel, setSel] = useState<string | null>(null); const [exporting, setExporting] = useState(false);
  const [comp, setComp] = useState<string | null>(null); const [exportErr, setExportErr] = useState<string | null>(null);
  const pq = periodQuery(period); const pk = JSON.stringify(pq);
  useEffect(() => setPage(1), [pk, q, tier, sort]);
  const dash = useLoad(() => posTeamPerformanceScreenApi.dashboard(pq), [pk, tick]);
  const dir = useLoad(() => posTeamPerformanceScreenApi.directory({ ...pq, q: q || undefined, tier, sort, page, pageSize: 8 }), [pk, q, tier, sort, page, tick]);
  const k = dash.data?.kpis; const dist = dash.data?.distribution; const min = dash.data?.minSample ?? 3;
  const maxDist = Math.max(1, ...TIERS.map((t) => dist?.[t] ?? 0));
  const pickTier = (t: string) => { setTier((cur) => (cur === t ? 'all' : t)); document.querySelector('[data-testid="directory"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  // F3: built and audited on the server (requested → succeeded / failed; denied; 503 when the audit store is down → no file)
  const doExport = async () => {
    setExporting(true); setExportErr(null);
    try {
      const csv = await posTeamPerformanceScreenApi.exportCsv({ ...pq, q: q || undefined, tier, sort, lang: getLanguage() === 'vi' ? 'vi' : 'en', requestId: requestId() });
      downloadText(`team-performance-${dash.data?.period?.from ?? 'all'}-${dash.data?.period?.to ?? 'all'}.csv`, String(csv ?? ''));
    } catch (e) {
      const x = e as { status?: number };
      setExportErr(x?.status === 403 ? tx('cm.ex.denied') : x?.status === 503 ? tx('cm.ex.auditDown') : tx('cm.ex.failed'));
    } finally { setExporting(false); }
  };

  if (isForbidden(dash.error)) return <div className="work mos tps" data-testid="team-performance-screen"><h1>{tx('pos.team_performance')}</h1><StateBlock error={dash.error} onRetry={dash.reload} /></div>;
  return (
    <div className="work mos tps" data-testid="team-performance-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.team_performance')}</h1><div className="sub">{tx('tp.sub')}</div></div>
        <div className="fk-head-actions">
          <button type="button" className="fk-btn" onClick={() => setTick((n) => n + 1)} data-testid="refresh">{tx('finance.refresh')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => nav('/tenant/reports/technicians')} data-testid="reports">{tx('tp.reports')}</button>
          <button type="button" className="fk-btn ghost" disabled={!dir.data || exporting} onClick={doExport} data-testid="export">{exporting ? tx('cm.exporting') : tx('cm.export')}</button>
        </div>
      </header>
      {exportErr ? <div className="fk-note bad" role="alert" data-testid="export-error"><span>{exportErr}</span></div> : null}
      <div className="mos-tools" data-testid="toolbar">
        <div className="fn-search mos-search"><input className="fk-search wide" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx('tp.searchPh')} aria-label={tx('tp.searchPh')} data-testid="search" />
          {search ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setSearch('')} data-testid="search-clear">✕</button> : null}</div>
        <select className="fk-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={tx('cg.sort')} data-testid="sort">{SORTS.map((s) => <option key={s} value={s}>{tx('tp.sort.' + s)}</option>)}</select>
      </div>
      <div className="fn-tabsrow dsc-periodrow">
        <PeriodBar value={period} onChange={setPeriod} server={dash.data?.period} allowAll compact /><span className="fk-hint" data-testid="basis">{tx('tp.basis')}</span>
      </div>

      <div className="fk-kpis three cg-kpis" data-testid="kpis">
        {dash.error ? <StateBlock error={dash.error} onRetry={dash.reload} /> : <>
          <KpiCard testId="kpi-overall" label={tx('pos.overall_score')} loading={!k} value={k ? of5(k.overallScore) : ''} sub={k ? tx('tp.k.overall', { n: reviewsN(k.overallReviews) }) : ''} />
          <KpiCard testId="kpi-avg" label={tx('pos.avg_performance')} loading={!k} value={k ? of5(k.avgPerformance) : ''} sub={k ? tx('tp.k.avg', { n: nf(k.ratedTechnicians), t: nf(k.technicians) }) : ''} />
          <KpiCard testId="kpi-services" label={tx('pos.total_services')} loading={!k} value={k ? nf(k.totalServices) : ''} sub={k ? tx('tp.k.services', { c: nf(k.serviceContributions), t: nf(k.tickets) }) : ''} />
        </>}
      </div>
      <p className="fk-hint" data-testid="score-rule">{tx('tp.scoreRule')}</p>

      <div className="mos-row tpf-row">
        <FitPanel testId="distribution" title={tx('pos.performance_distribution')}>
          {!dist ? <div className="fk-loading">{tx('pos.loading')}</div> : <div className="tpf-bars" role="group" aria-label={tx('pos.performance_distribution_2')}>
            {TIERS.map((t) => <button key={t} type="button" className={'tpf-bar-c' + (tier === t ? ' on' : '')} onClick={() => pickTier(t)} data-testid={'tier-' + t} aria-pressed={tier === t} title={tx('tp.tierFilter')}>
              <span className="tpf-n">{nf(dist[t] ?? 0)}</span><span className={'tpf-bar ' + TIER_TONE[t]} style={{ height: `${Math.max(4, Math.round(((dist[t] ?? 0) / maxDist) * 140))}px` }} /><span className="tpf-bar-l">{tx('tp.tier.' + t)}</span></button>)}
          </div>}
          <p className="fk-hint">{tx('tp.distRule')}</p>
        </FitPanel>
        <FitPanel testId="top-performers" title={<>{tx('pos.top_performers')}<span className="fk-chip mut" data-testid="ranked-by">{tx('cs.rankedBy')}</span></>}>
          {!dash.data ? <div className="fk-loading">{tx('pos.loading')}</div> : !dash.data.topPerformers.length ? <Empty title={tx('pos.no_performers_yet')} />
            : <table className="fk-table fn-table cg-table" data-testid="top-table"><thead><tr><th>#</th><th>{tx('pos.name')}</th><th className="num">{tx('pos.score')}</th><th className="num">{tx('tp.col.reviews')}</th></tr></thead>
              <tbody>{dash.data.topPerformers.map((p: any) => <tr key={p.technicianId} className="inv2-click" onClick={() => setSel(p.technicianId)} data-testid="top-row">
                <td className="fk-muted">{p.rank}</td><td><span className="tq-who"><ProfileAvatarWithPreview name={p.name} url={p.avatarUrl} size={26} type="technician" /><b>{p.name}</b></span></td>
                <td className="num"><b>{of5(p.score)}</b></td><td className="num">{nf(p.reviews)}{p.lowSample ? <span className="fk-chip warn">{tx('tp.lowSample')}</span> : null}</td></tr>)}</tbody></table>}
          <p className="fk-hint">{tx('tp.rankRule', { n: String(min) })}</p>
        </FitPanel>
      </div>

      <CompositeComparison pq={pq} onOpen={setComp} />

      <FitPanel testId="directory" title={<>{tx('tp.directory')}{dir.data ? <span className="fk-muted"> · {tx('cg.matching', { n: nf(dir.data.totalItems) })}</span> : null}{tier !== 'all' ? <> · <button type="button" className="fk-link" onClick={() => setTier('all')} data-testid="tier-clear">{tx('tp.tier.' + tier)} ✕</button></> : null}</>}
        footer={<Pager info={pageOf(dir.data)} onPage={setPage} label={tx('tp.directory')} />}>
        {dir.error ? <StateBlock error={dir.error} onRetry={dir.reload} /> : !dir.data ? <div className="fk-loading">{tx('pos.loading')}</div>
          : dir.data.items.length === 0 ? <Empty title={q ? tx('cg.noMatchSearch', { q }) : tx('tp.noTechs')}>{q || tier !== 'all' ? <button type="button" className="fk-btn" onClick={() => { setSearch(''); setTier('all'); }}>{tx('finance.clearFilters')}</button> : null}</Empty>
          : <div className="tq-scroll"><table className="fk-table fn-table cg-table tpf-table" data-testid="directory-table">
            <thead><tr><th>{tx('pos.technician')}</th><th className="t-opt">{tx('tp.col.branch')}</th><th className="num">{tx('tp.col.services')}</th><th className="num">{tx('tp.col.rating')}</th><th>{tx('tp.col.tier')}</th><th className="t-opt">{tx('tp.col.lastService')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
            <tbody>{dir.data.items.map((r: any) => <tr key={r.technicianId} className="inv2-click" onClick={() => setSel(r.technicianId)} data-testid="dir-row">
              <td><span className="tq-who"><ProfileAvatarWithPreview name={r.name} url={r.avatarUrl} size={26} type="technician" /><b>{r.name}</b>{!r.active ? <span className="fk-chip mut">{tx('cm.inactive')}</span> : null}</span>{r.matchedVia ? <span className="fk-li-s">{tx('tp.via.' + r.matchedVia)}</span> : null}</td>
              <td className="t-opt">{r.branch ?? '—'}</td><td className="num">{nf(r.services)}</td>
              <td className="num">{of5(r.rating)}<span className="fk-li-s">{reviewsN(r.reviews)}{r.lowSample ? ` · ${tx('tp.lowSample')}` : ''}</span></td>
              <td><span className={'fk-chip ' + TIER_TONE[r.tier]}>{tx('tp.tier.' + r.tier)}</span></td><td className="t-opt">{r.lastServiceAt ? whenTime(r.lastServiceAt) : '—'}</td>
              <td className="fn-acts"><button type="button" className="fk-btn ghost sm" onClick={(e) => { e.stopPropagation(); setSel(r.technicianId); }} data-testid="dir-open">{tx('tp.view')}</button></td></tr>)}</tbody></table></div>}
      </FitPanel>

      {sel ? <PerformanceDetails id={sel} pq={pq} periodLabel={periodText(dash.data?.period)} onClose={() => setSel(null)} onComposite={() => { setComp(sel); setSel(null); }} /> : null}
      {comp ? <CompositeDetails id={comp} pq={pq} onClose={() => setComp(null)} /> : null}
    </div>
  );
}

/** Technician Performance Details — the central drill-down (Close / Esc) */
function PerformanceDetails({ id, pq, periodLabel, onClose, onComposite }: { id: string; pq: Record<string, unknown>; periodLabel: string; onClose: () => void; onComposite: () => void }) {
  const nav = useNavigate();
  const [tab, setTab] = useState<'services' | 'reviews'>('services'); const [pg, setPg] = useState(1); const [sq, setSq] = useState(''); const sqq = useDebounced(sq.trim(), 300);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  useEffect(() => setPg(1), [tab, sqq]);
  const d = useLoad(() => posTeamPerformanceScreenApi.technician(id, pq), [id, JSON.stringify(pq)]);
  // each answer carries the tab it was read for: right after a tab switch the previous tab's rows are never drawn in the new
  // tab's layout (a services row shown as a review read "No comment")
  const list0 = useLoad(() => (tab === 'services' ? posTeamPerformanceScreenApi.services(id, { ...pq, q: sqq || undefined, page: pg, pageSize: 8 }) : posTeamPerformanceScreenApi.reviews(id, { ...pq, page: pg, pageSize: 6 })).then((d: any) => (d ? { ...d, forTab: tab } : d)), [id, tab, pg, sqq, JSON.stringify(pq)]);
  const list = { ...list0, data: list0.data && (list0.data as any).forTab === tab ? list0.data : null };
  const x: any = d.data;
  return (
    <FitDialog wide title={x?.name ?? tx('tp.details')} subtitle={x ? <>{[x.role, x.branch].filter(Boolean).join(' · ')} · {periodLabel}</> : undefined} onClose={onClose} testId="dlg-performance"
      footer={<><button type="button" className="fk-btn ghost" onClick={() => nav(`/technicians/${encodeURIComponent(id)}`)} data-testid="open-profile">{tx('tq.profile')}</button>
        <button type="button" className="fk-btn ghost" onClick={() => nav('/tech-appointments')}>{tx('ls.appointments')}</button>
        <button type="button" className="fk-btn ghost" onClick={onComposite} data-testid="open-composite">{tx('cs.title')}</button>
        <button type="button" className="fk-btn primary" onClick={onClose} data-testid="performance-close">{tx('pos.close')}</button></>}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !x ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="tm-card-h"><ProfileAvatarWithPreview name={x.name ?? '?'} url={x.avatarUrl} size={48} type="technician" /><span><b>{x.name}</b><span className={'fk-chip ' + TIER_TONE[x.score.tier]}>{tx('tp.tier.' + x.score.tier)}</span>{!x.active ? <span className="fk-chip mut">{tx('cm.inactive')}</span> : null}</span></div>
        <dl className="fk-dl mo-dl" data-testid="performance-summary">
          <dt>{tx('pos.score')}</dt><dd><b>{of5(x.score.rating)}</b> · {reviewsN(x.score.reviews)}{x.score.lowSample ? ` · ${tx('tp.lowSample')}` : ''}</dd>
          <dt>{tx('tp.allTime')}</dt><dd>{of5(x.score.allTimeRating)} · {reviewsN(x.score.allTimeReviews)}</dd>
          <dt>{tx('tp.rank')}</dt><dd>{x.rank ? tx('tp.rankV', { p: nf(x.rank.position), n: nf(x.rank.of) }) : tx('tp.notRanked')}</dd>
          <dt>{tx('tp.col.services')}</dt><dd>{nf(x.services)}{x.lastServiceAt ? ` · ${tx('tp.last', { t: whenTime(x.lastServiceAt) })}` : ''}</dd>
          <dt>{tx('tp.source')}</dt><dd>{tx('tp.sourceV')}</dd>
          <dt>{tx('tq.qualified')}</dt><dd>{x.qualifiedServices.length ? x.qualifiedServices.join(', ') : tx('tq.noQualified')}</dd>
        </dl>
        {x.previous ? <div className={'fk-note ' + (x.comparable ? 'info' : 'warn')} data-testid="comparison"><span>{x.comparable
          ? tx('tp.compare', { r: of5(x.score.rating), pr: of5(x.previous.rating), s: nf(x.services), ps: nf(x.previous.services) })
          : tx('tp.noCompare', { n: String(x.minSample), s: nf(x.services), ps: nf(x.previous.services) })}</span></div> : null}
        <div className="fk-tabs" role="tablist" aria-label={tx('tp.details')}>{(['services', 'reviews'] as const).map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} data-testid={'ptab-' + t}>{tx('tp.tab.' + t)}</button>)}</div>
        {tab === 'services' ? <div className="mos-tools"><div className="fn-search mos-search"><input className="fk-search" type="search" value={sq} onChange={(e) => setSq(e.target.value)} placeholder={tx('cm.linePh')} aria-label={tx('cm.linePh')} data-testid="service-search" /></div></div> : null}
        {list.error ? <StateBlock error={list.error} onRetry={list.reload} /> : !list.data ? <div className="fk-loading">{tx('pos.loading')}</div> : !list.data.items?.length ? <Empty title={tab === 'services' ? tx('tp.noServices') : tx('tp.noReviews')} />
          : tab === 'services' ? <table className="fk-table fn-table cg-table" data-testid="services-table"><thead><tr><th>{tx('tm.col.when')}</th><th>{tx('cm.l.service')}</th><th>{tx('cm.l.ticket')}</th><th className="num">{tx('tm.minutes')}</th><th className="num">{tx('tp.col.rating')}</th></tr></thead>
            <tbody>{list.data.items.map((s: any) => <tr key={s.id} data-testid="service-row"><td>{whenTime(s.at)}</td><td>{s.service ?? '—'}{s.techsOnTicket > 1 ? <span className="fk-li-s">{tx('cm.shared', { n: nf(s.techsOnTicket) })}</span> : null}</td>
              <td>{s.ticketNumber ?? '—'}{s.customer ? <span className="fk-li-s">{s.customer}</span> : null}</td><td className="num">{s.minutes ?? '—'}</td><td className="num">{s.rating != null ? of5(s.rating) : '—'}</td></tr>)}</tbody></table>
          : <ul className="fk-list tpf-reviews" data-testid="reviews-list">{list.data.items.map((r: any) => <li key={r.id} className="fk-li" data-testid="review-row"><span className="tpf-stars" aria-label={of5(r.rating)}>{'★'.repeat(Math.round(r.rating))}<span className="fk-muted">{'★'.repeat(5 - Math.round(r.rating))}</span></span>
            <span className="fk-li-t">{r.comment || <span className="fk-muted">{tx('tp.noComment')}</span>}<span className="fk-li-s">{whenTime(r.at)}</span></span></li>)}</ul>}
        <Pager info={pageOf(list.data)} onPage={setPg} compact />
      </>}
    </FitDialog>
  );
}
