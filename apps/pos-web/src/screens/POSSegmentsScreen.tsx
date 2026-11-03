// POSSegmentsScreen.tsx — Marketing & Growth → Customer Segments (/tenant/marketing/segments). Customer Segments Complete
// Build Guide (Oct 30 2026). Keeps the original page (title, New / Returning / VIP tabs, the Customer · Visits · Tier · Last
// Visit · Lifetime Spend columns) and repairs it in place:
//   header     title · last updated · Refresh · As of date · Data health · Create Campaign
//   KPI cards  Total · New · Returning · VIP (+ Never Visited · Inactive) — server counts (segments-v1), VIP overlap noted
//   tabs       New | Returning | VIP | Never Visited | Inactive | All  (New = exactly 1 settled visit; 0 = Never Visited)
//   toolbar    server search (name / phone / e-mail / customer id / visit history) · branch activity · From/To month calendar
//              with presets + date basis · visits / spend range · tier · service · SMS / e-mail eligibility · sort · Clear all
//   results    checkbox · Customer · Visits · Tier · Last Visit (salon time) · Lifetime Spend · Segments · Why this segment?
//   footer     10 / 20 / 50 rows · Previous 1 2 3 Next · exact filtered count
//   overlays   Why This Segment? · Customer History & Marketing (masked; Close; Open Booking with the customer preselected)
//              · Audience Builder (draft only — consent checked; Campaign Center approves and sends) · As of date · Data health
// View state (segment, filters, dates, sort, page, page size) lives in the URL; the search text never does (no PII in URLs).
import { parseDollarsToCents } from '@aipowersalon/money';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { SYNC_POLICY } from '@aipowersalon/realtime-client';
import { posSegmentsApi, type SegmentQuery } from '../api/posSegmentsApi';
import { posCampaignsApi } from '../api/posCampaignsApi';
import { useCan } from '../components/usePermissions';
import { useRealtime } from '../realtime/useRealtime';
import { errorTextOf } from '../i18n/error-text';
import { fmtMoney, fmtNumber, fmtInZone } from '../i18n/format';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry, useDebounced, requestId } from '../components/FitKit';
import { PeriodBar, periodQuery, type PeriodState, type ServerPeriod } from '../components/FinanceKit';
import { deviceToday } from '../lib/deviceToday';

type Seg = 'new' | 'returning' | 'vip' | 'never' | 'inactive' | 'all';
const TABS: Seg[] = ['new', 'returning', 'vip', 'never', 'inactive', 'all'];
const SORTS = ['created_desc', 'recent_visit', 'visits', 'spend', 'name_asc', 'name_desc'] as const;
const BASES = ['none', 'created', 'first_visit', 'last_visit', 'visit_in_range'] as const;
const SIZES = [10, 20, 50] as const;
type Row = { customerId: string; customerName: string; maskedPhone: string | null; maskedEmail: string | null; visits: number; visitClass: string; isVip: boolean; inactive: boolean;
  loyaltyTier: string; lastVisitAt: string | null; firstVisitAt: string | null; lifetimeSpendCents: number; createdAt: string | null; smsStatus: string; emailStatus: string; segments: string[] };
type Summary = { ruleset: string; settingsVersion: number; timeZone: string; today: string; inactiveDays: number; evaluatedAt: string;
  period: { preset: string; from: string; to: string; today: string; timeZone: string }; scope: { branches: { branchId: string; name: string }[]; selectedBranchId: string | null; label: string };
  counts: Record<Seg, number>; overlaps: { vipReturning: number; vipNew: number; vipNever: number; vipInactive: number };
  vipRule: { text: string }; health: { unknownBranchVisits: number; walkInVisitsWithoutCustomer: number; sharedPhoneGroups: number; lastVisitRecordedAt: string | null;
    lastSnapshot: { date: string; status: string; coverage: string | null } | null } };
type ListResp = { items: Row[]; page: number; pageSize: number; totalItems: number; totalPages: number; sort: string; segment: Seg;
  period: { preset: string; from: string; to: string; today: string; timeZone: string }; filters: { basis: string } };
type Flt = { basis: string; minVisits: string; maxVisits: string; minSpend: string; maxSpend: string; tier: string; service: string; sms: string; email: string };
const NO_FLT: Flt = { basis: 'none', minVisits: '', maxVisits: '', minSpend: '', maxSpend: '', tier: '', service: '', sms: '', email: '' };
const nf = (n: number) => fmtNumber(n || 0);
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric' }) || '—' : '—');
const whenTime = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) || '—' : '—');
const segLabel = (s: string) => tx('sg.seg.' + s);
const reasonLabel = (s: string) => tx('sg.reason.' + s);
const cents = (dollars: string) => (dollars.trim() === '' ? undefined : parseDollarsToCents(dollars) ?? undefined);   // exact digits, never float math (19.99 × 100 ≠ 1999)
const whole = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? undefined : Math.max(0, Math.trunc(Number(v))));
const SEG_TONE: Record<string, string> = { new: 'info', returning: 'ok', never_visited: 'mut', vip: 'gold', inactive: 'warn' };

export function POSSegmentsScreen() {
  const nav = useNavigate();
  const can = useCan();
  const canMarketing = can('marketing.manage');
  const canCampaigns = can('marketing.view');
  const [sp, setSp] = useSearchParams();
  const seg = (TABS as string[]).includes(sp.get('segment') ?? '') ? (sp.get('segment') as Seg) : 'returning';
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const pageSize = (SIZES as readonly number[]).includes(Number(sp.get('size'))) ? Number(sp.get('size')) : 10;
  const sort = (SORTS as readonly string[]).includes(sp.get('sort') ?? '') ? String(sp.get('sort')) : '';
  const branch = sp.get('branch') ?? '';
  const period: PeriodState = sp.get('preset') === 'custom' && sp.get('from') && sp.get('to') ? { preset: 'custom', from: sp.get('from')!, to: sp.get('to')! } as PeriodState
    : { preset: (['today', 'week', 'month', 'year'].includes(sp.get('preset') ?? '') ? sp.get('preset') : 'month') as PeriodState['preset'] } as PeriodState;
  const flt: Flt = { ...NO_FLT, ...Object.fromEntries(Object.keys(NO_FLT).filter((k) => sp.get(k)).map((k) => [k, sp.get(k)!])) };
  const setView = (patch: Record<string, string | number | null>, resetPage = true) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === '' || v === undefined) next.delete(k); else next.set(k, String(v)); }
    if (resetPage && !('page' in patch)) next.delete('page');
    setSp(next, { replace: true });
  };
  const [search, setSearch] = useState(''); const q = useDebounced(search, 300);
  useEffect(() => { if (sp.get('page')) setView({}, true); /* a new search starts on page 1 */ }, [q]);   // eslint-disable-line react-hooks/exhaustive-deps

  const pq = { ...periodQuery(period), ...(branch ? { branch } : {}) };
  const pKey = JSON.stringify(pq);
  const [sum, setSum] = useState<Summary | null>(null); const [sumErr, setSumErr] = useState<string | null>(null);
  const sumSeq = useRef(0);
  const loadSummary = useCallback(() => {
    const my = ++sumSeq.current; setSumErr(null);
    posSegmentsApi.summary(JSON.parse(pKey)).then((d) => { if (my === sumSeq.current) setSum(d); }).catch((e) => { if (my === sumSeq.current) setSumErr(errorTextOf(e, tx('pos.loading'))); });
  }, [pKey]);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  const query: SegmentQuery = useMemo(() => ({ segment: seg, ...JSON.parse(pKey), q: q.trim() || undefined, sort: sort || undefined, basis: flt.basis !== 'none' ? flt.basis : undefined,
    minVisits: whole(flt.minVisits), maxVisits: whole(flt.maxVisits), minSpend: cents(flt.minSpend), maxSpend: cents(flt.maxSpend), tier: flt.tier || undefined, service: flt.service || undefined,
    sms: flt.sms || undefined, email: flt.email || undefined }), [seg, pKey, q, sort, JSON.stringify(flt)]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [list, setList] = useState<ListResp | null>(null); const [listErr, setListErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    const my = ++seq.current; setListErr(null);
    posSegmentsApi.members({ ...query, page, pageSize })
      .then((d: ListResp) => { if (my !== seq.current) return; setList(d); if (d.page !== page) setView({ page: d.page > 1 ? d.page : null }, false); })
      .catch((e) => { if (my === seq.current) setListErr(errorTextOf(e, tx('pos.loading'))); });
  }, [query, page, pageSize, reload]);   // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => { loadSummary(); setReload((n) => n + 1); };
  // a settled visit or a customer change elsewhere refreshes the counts and the page (polling fallback built in)
  useRealtime(['customers', 'checkout'], () => refresh(), { intervalMs: SYNC_POLICY.detailMs });

  const [sel, setSel] = useState<Map<string, Row>>(new Map());
  useEffect(() => { setSel(new Map()); }, [seg, pKey, JSON.stringify(flt), q]);   // eslint-disable-line react-hooks/exhaustive-deps
  const rows = list?.items ?? [];
  const pageAllOn = rows.length > 0 && rows.every((r) => sel.has(r.customerId));
  const togglePage = () => { const m = new Map(sel); if (pageAllOn) rows.forEach((r) => m.delete(r.customerId)); else rows.forEach((r) => m.set(r.customerId, r)); setSel(m); };
  const toggle = (r: Row) => { const m = new Map(sel); if (m.has(r.customerId)) m.delete(r.customerId); else m.set(r.customerId, r); setSel(m); };

  const [dlg, setDlg] = useState<null | { kind: 'why'; id: string } | { kind: 'customer'; id: string } | { kind: 'audience' } | { kind: 'history' } | { kind: 'health' }>(null);
  const book = (id: string) => nav(`/booking/new?customerId=${encodeURIComponent(id)}&from=segments`);
  const c = sum?.counts; const per = list?.period ?? sum?.period ?? null;
  const server: ServerPeriod | null = per ? { preset: per.preset as ServerPeriod['preset'], from: per.from, to: per.to, tz: per.timeZone, today: per.today } : null;
  const anyFilter = flt.basis !== 'none' || Object.entries(flt).some(([k, v]) => k !== 'basis' && v) || !!search;
  const hint = seg === 'inactive' ? tx('sg.hint.inactive', { d: String(sum?.inactiveDays ?? 60) }) : tx('sg.hint.' + seg);

  return (
    <div className="work rt rt2 sg" data-testid="segments-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.customer_segments')}</h1>
          <div className="sub">{tx('sg.subtitle')}{sum ? <span className="fk-muted" data-testid="sg-updated"> · {tx('sg.lastUpdated', { time: whenTime(sum.evaluatedAt) })}</span> : null}</div></div>
        <div className="fk-head-actions">
          <button type="button" className="fk-btn ghost" onClick={refresh} data-testid="sg-refresh">{tx('sg.refresh')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => setDlg({ kind: 'history' })} data-testid="sg-open-history">{tx('sg.history')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => setDlg({ kind: 'health' })} data-testid="sg-open-health">{tx('sg.health')}</button>
          <button type="button" className="fk-btn primary" onClick={() => setDlg({ kind: 'audience' })} disabled={!canMarketing} title={!canMarketing ? tx('sg.aud.noPermission') : undefined} data-testid="sg-create-campaign">{tx('sg.createCampaign')}</button>
        </div>
      </header>

      <div className="fk-kpis six" data-testid="sg-kpis">
        {sumErr ? <ErrorRetry message={sumErr} onRetry={loadSummary} /> : <>
          <KpiCard testId="kpi-total" label={tx('sg.kpi.total')} loading={!c} value={c ? nf(c.all) : ''} sub={tx('sg.kpi.totalSub')} onClick={() => setView({ segment: 'all' })} />
          <KpiCard testId="kpi-new" label={tx('sg.kpi.new')} loading={!c} value={c ? nf(c.new) : ''} sub={tx('sg.kpi.newSub')} onClick={() => setView({ segment: 'new' })} />
          <KpiCard testId="kpi-returning" label={tx('sg.kpi.returning')} loading={!c} tone="gold" value={c ? nf(c.returning) : ''} sub={tx('sg.kpi.returningSub')} onClick={() => setView({ segment: 'returning' })} />
          <KpiCard testId="kpi-vip" label={tx('sg.kpi.vip')} loading={!c} value={c ? nf(c.vip) : ''} sub={sum ? tx('sg.kpi.vipSub', { n: nf(sum.overlaps.vipReturning) }) : ''} onClick={() => setView({ segment: 'vip' })} />
          <KpiCard testId="kpi-never" label={tx('sg.kpi.never')} loading={!c} value={c ? nf(c.never) : ''} sub={tx('sg.kpi.neverSub')} onClick={() => setView({ segment: 'never' })} />
          <KpiCard testId="kpi-inactive" label={tx('sg.kpi.inactive')} loading={!c} tone={c && c.inactive > 0 ? 'warn' : undefined} value={c ? nf(c.inactive) : ''} sub={tx('sg.kpi.inactiveSub', { d: String(sum?.inactiveDays ?? 60) })} onClick={() => setView({ segment: 'inactive' })} />
        </>}
      </div>

      <div className="rt-filters" role="tablist" aria-label={tx('pos.customer_segments')}>
        <div className="rt-chips">
          {TABS.map((s) => (
            <button type="button" role="tab" key={s} className={'rt-chip' + (seg === s ? ' on' : '')} aria-selected={seg === s} onClick={() => setView({ segment: s })} data-testid={'sg-tab-' + s}>
              {segLabel(s)} <span className="rt-chip-n">{c ? nf(c[s]) : '…'}</span>
            </button>
          ))}
        </div>
        <span className="sub sg-hint" data-testid="sg-hint">{hint}</span>
      </div>

      <div className="rt-filters rt-periodrow sg-tools" role="toolbar" aria-label={tx('sg.filters')}>
        <input type="search" className="fk-search sg-search" aria-label={tx('sg.search')} placeholder={tx('sg.search')} value={search} onChange={(e) => setSearch(e.target.value)} data-testid="sg-search" />
        <PeriodBar compact value={period} onChange={(p) => setView(p.preset === 'custom' ? { preset: 'custom', from: p.from ?? null, to: p.to ?? null } : { preset: p.preset, from: null, to: null })} server={server}
          basis={flt.basis} onBasis={(b) => setView({ basis: b === 'none' ? null : b })} basisOptions={BASES.map((b) => ({ value: b, label: tx('sg.basis.' + b) }))} />
        <select className="fk-select" aria-label={tx('sg.branch.label')} value={branch} onChange={(e) => setView({ branch: e.target.value || null })} data-testid="sg-branch">
          <option value="">{tx('sg.branch.all')}</option>
          {(sum?.scope.branches ?? []).map((b) => <option key={b.branchId} value={b.branchId}>{b.name}</option>)}
        </select>
        <input className="fk-input sg-num" inputMode="numeric" aria-label={tx('sg.visits.min')} placeholder={tx('sg.visits.min')} value={flt.minVisits} onChange={(e) => setView({ minVisits: e.target.value })} data-testid="sg-min-visits" />
        <input className="fk-input sg-num" inputMode="numeric" aria-label={tx('sg.visits.max')} placeholder={tx('sg.visits.max')} value={flt.maxVisits} onChange={(e) => setView({ maxVisits: e.target.value })} />
        <input className="fk-input sg-num" inputMode="decimal" aria-label={tx('sg.spend.min')} placeholder={tx('sg.spend.min')} value={flt.minSpend} onChange={(e) => setView({ minSpend: e.target.value })} />
        <input className="fk-input sg-num" inputMode="decimal" aria-label={tx('sg.spend.max')} placeholder={tx('sg.spend.max')} value={flt.maxSpend} onChange={(e) => setView({ maxSpend: e.target.value })} />
        <input className="fk-input sg-num" aria-label={tx('sg.tier')} placeholder={tx('sg.tier')} value={flt.tier} onChange={(e) => setView({ tier: e.target.value })} />
        <input className="fk-input sg-num" aria-label={tx('sg.service')} placeholder={tx('sg.service')} value={flt.service} onChange={(e) => setView({ service: e.target.value })} />
        <select className="fk-select" aria-label={tx('sg.sms.any')} value={flt.sms} onChange={(e) => setView({ sms: e.target.value || null })}>
          <option value="">{tx('sg.sms.any')}</option><option value="eligible">{tx('sg.sms.eligible')}</option><option value="not_eligible">{tx('sg.sms.not')}</option>
        </select>
        <select className="fk-select" aria-label={tx('sg.email.any')} value={flt.email} onChange={(e) => setView({ email: e.target.value || null })}>
          <option value="">{tx('sg.email.any')}</option><option value="eligible">{tx('sg.email.eligible')}</option><option value="not_eligible">{tx('sg.email.not')}</option>
        </select>
        <select className="fk-select" aria-label={tx('sg.sort.created_desc')} value={sort} onChange={(e) => setView({ sort: e.target.value || null })} data-testid="sg-sort">
          {SORTS.map((s) => <option key={s} value={s === 'created_desc' ? '' : s}>{tx('sg.sort.' + s)}</option>)}
        </select>
        {anyFilter ? <button type="button" className="fk-link" onClick={() => { setSearch(''); setView(Object.fromEntries([...Object.keys(NO_FLT), 'preset', 'from', 'to', 'branch', 'sort'].map((k) => [k, null]))); }} data-testid="sg-clear">{tx('sg.clearAll')}</button> : null}
      </div>
      {list && list.filters.basis !== 'none' && per ? <div className="fk-hint sg-basis" data-testid="sg-basis-active">{tx('sg.basisActive', { basis: tx('sg.basis.' + list.filters.basis), from: per.from, to: per.to })}</div> : null}

      <section className="fk-panel sg-panel" data-testid="sg-results">
        <div className="sg-table-wrap">
          {listErr ? <ErrorRetry message={listErr} onRetry={() => setReload((n) => n + 1)} /> : !list ? <div className="fk-loading">{tx('pos.loading')}</div> : rows.length === 0 ? (
            anyFilter ? <Empty title={tx('sg.empty.noMatch')}><button type="button" className="fk-btn ghost" onClick={() => { setSearch(''); setView(Object.fromEntries(Object.keys(NO_FLT).map((k) => [k, null]))); }}>{tx('sg.clearAll')}</button></Empty>
              : <Empty title={tx('sg.empty.segment')} />
          ) : (
            <table className="fk-table rt-table sg-table">
              <thead><tr>
                <th style={{ width: 44 }}><label className="rt-cbwrap"><input type="checkbox" className="rt-cb" aria-label={tx('sg.selectPage')} checked={pageAllOn} onChange={togglePage} data-testid="sg-select-page" /></label></th>
                <th>{tx('pos.customer')}</th><th className="num">{tx('pos.visits')}</th><th>{tx('pos.tier')}</th><th>{tx('pos.last_visit_3')}</th><th className="num">{tx('pos.lifetime_spend')}</th>
                <th>{tx('sg.col.segments')}</th><th>{tx('sg.col.why')}</th>
              </tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.customerId} className={sel.has(r.customerId) ? 'sel' : ''} data-testid="sg-row">
                  <td><label className="rt-cbwrap"><input type="checkbox" className="rt-cb" checked={sel.has(r.customerId)} onChange={() => toggle(r)} aria-label={r.customerName || '—'} /></label></td>
                  <td><button type="button" className="fk-li-t link sg-name" onClick={() => setDlg({ kind: 'customer', id: r.customerId })} data-testid="sg-open-customer">{r.customerName || '—'}</button>
                    <div className="fk-muted sg-contact">{r.maskedPhone ?? r.maskedEmail ?? '—'}</div></td>
                  <td className="num">{nf(r.visits)}</td>
                  <td>{r.loyaltyTier || '—'}</td>
                  <td>{r.lastVisitAt ? when(r.lastVisitAt) : <span className="fk-muted">{tx('sg.seg.never_visited')}</span>}</td>
                  <td className="num">{fmtMoney(r.lifetimeSpendCents)}</td>
                  <td><span className="sg-tags">{r.segments.map((s) => <span key={s} className={'fk-chip ' + (SEG_TONE[s] ?? 'mut')}>{segLabel(s)}</span>)}</span></td>
                  <td><button type="button" className="fk-btn ghost sg-why" onClick={() => setDlg({ kind: 'why', id: r.customerId })} data-testid="sg-why">{tx('sg.why')}</button></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
        <footer className="sg-foot">
          <select className="fk-select" aria-label={tx('sg.rows', { n: String(pageSize) })} value={pageSize} onChange={(e) => setView({ size: Number(e.target.value) === 10 ? null : e.target.value })} data-testid="sg-size">
            {SIZES.map((n) => <option key={n} value={n}>{tx('sg.rows', { n: String(n) })}</option>)}
          </select>
          <Pager info={list} onPage={(p) => setView({ page: p > 1 ? p : null }, false)} />
        </footer>
      </section>

      <div className="rt-selbar" data-testid="sg-selection-bar" aria-live="polite">
        <button type="button" className="fk-btn ghost" onClick={togglePage} disabled={!rows.length}>{pageAllOn ? tx('sg.unselectPage') : tx('sg.selectPage')}</button>
        <span className="rt-selcount">{tx('sg.selected', { n: nf(sel.size) })}</span>
        {sel.size ? <button type="button" className="fk-link" onClick={() => setSel(new Map())}>{tx('sg.clearSel')}</button> : null}
        <span className="rt-selspace" />
        {sum && (sum.overlaps.vipReturning || sum.overlaps.vipNew) ? <span className="fk-hint">{tx('sg.overlap')}</span> : null}
        <button type="button" className="fk-btn primary" disabled={!canMarketing} onClick={() => setDlg({ kind: 'audience' })} data-testid="sg-build-audience">{tx('sg.createCampaign')}</button>
      </div>

      {dlg?.kind === 'why' ? <WhyDialog id={dlg.id} onClose={() => setDlg(null)} /> : null}
      {dlg?.kind === 'customer' ? <CustomerDialog id={dlg.id} onClose={() => setDlg(null)} book={book}
        openProfile={(id, name) => nav(`/customers?customerId=${encodeURIComponent(id)}&q=${encodeURIComponent(name)}`)}
        openComms={() => nav('/tenant/communications/inbox')} /> : null}
      {dlg?.kind === 'audience' ? <AudienceDialog onClose={() => setDlg(null)} query={query} seg={seg} pageRows={rows} selected={[...sel.values()]} total={list?.totalItems ?? 0}
        canCampaigns={canCampaigns} openCampaigns={() => nav('/tenant/marketing/campaigns')} /> : null}
      {dlg?.kind === 'history' ? <HistoryDialog today={sum?.today ?? ''} onClose={() => setDlg(null)} /> : null}
      {dlg?.kind === 'health' && sum ? <HealthDialog sum={sum} onClose={() => setDlg(null)} /> : null}
    </div>
  );
}

function WhyDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { posSegmentsApi.qualification(id).then(setD).catch((e) => setErr(errorTextOf(e, tx('pos.loading')))); }, [id]);
  return (
    <FitDialog title={tx('sg.why.title')} subtitle={d?.customerName} onClose={onClose} testId="sg-why-dialog"
      footer={<button type="button" className="fk-btn primary" onClick={onClose} data-testid="sg-why-close">{tx('pos.close')}</button>}>
      {err ? <div className="err">{err}</div> : !d ? <div className="fk-loading">{tx('pos.loading')}</div> : <Qualification d={d} />}
    </FitDialog>
  );
}
/** the localized explanation line (the server's facts; the English text is the API's) */
function reasonText(segment: string, d: any): string {
  const v = d.facts.qualifyingVisits as number;
  if (segment === 'vip') return d.isVip ? (d.vipSince ? tx('sg.reasonText.vipSince', { date: when(d.vipSince), tier: d.loyaltyTier }) : tx('sg.reasonText.vipTier', { tier: d.loyaltyTier })) : tx('sg.reasonText.notVip', { tier: d.loyaltyTier });
  if (segment === 'inactive') return v === 0 ? tx('sg.reasonText.neverNotInactive') : tx('sg.reasonText.daysAway', { n: nf(d.facts.daysAway ?? 0), d: String(d.thresholds.inactiveDays) });
  return tx('sg.reasonText.visits', { v: nf(v) });
}
function Qualification({ d }: { d: any }) {
  return (<>
    <p className="rt-p" data-testid="sg-why-facts">{tx('sg.why.facts', { v: nf(d.facts.qualifyingVisits), first: when(d.facts.firstVisitAt), last: when(d.facts.lastVisitAt), spend: fmtMoney(d.facts.lifetimeSpendCents), refunds: fmtMoney(d.facts.refundedCents) })}</p>
    <ul className="sg-reasons">
      {d.reasons.map((r: any) => (
        <li key={r.segment} className={r.met ? 'met' : ''} data-testid={'sg-why-' + r.segment}>
          <span className={'fk-chip ' + (r.met ? 'ok' : 'mut')}>{r.met ? tx('sg.why.met') : tx('sg.why.notMet')}</span> <b>{segLabel(r.segment)}</b> — <span className="fk-muted">{tx('sg.rule.' + r.segment, { d: String(d.thresholds.inactiveDays) })}</span>
          <div>{reasonText(r.segment, d)}</div>
        </li>
      ))}
    </ul>
    <p className="fk-hint">{tx('sg.why.ruleset', { ruleset: d.ruleset, v: String(d.settingsVersion), time: whenTime(d.evaluatedAt) })}</p>
  </>);
}

const OV_TABS = ['overview', 'visits', 'appointments', 'spending', 'loyalty', 'qualification', 'marketing', 'contact'] as const;
function CustomerDialog({ id, onClose, book, openProfile, openComms }: { id: string; onClose: () => void; book: (id: string) => void; openProfile: (id: string, name: string) => void; openComms: () => void }) {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof OV_TABS)[number]>('overview');
  useEffect(() => { posSegmentsApi.overlay(id).then(setD).catch((e) => setErr(errorTextOf(e, tx('pos.loading')))); }, [id]);
  const none = <p className="fk-muted">{tx('sg.ov.none')}</p>;
  return (
    <FitDialog wide title={tx('sg.ov.title')} subtitle={d?.customerName} onClose={onClose} testId="sg-customer-dialog"
      footer={<>
        <button type="button" className="fk-btn ghost" onClick={openComms} disabled={!d}>{tx('sg.ov.comms')}</button>
        <button type="button" className="fk-btn ghost" onClick={() => d && openProfile(id, d.customerName)} disabled={!d}>{tx('sg.ov.profile')}</button>
        <button type="button" className="fk-btn ghost" onClick={() => book(id)} data-testid="sg-ov-book">{tx('sg.ov.book')}</button>
        <button type="button" className="fk-btn primary" onClick={onClose} data-testid="sg-ov-close">{tx('pos.close')}</button>
      </>}>
      {err ? <div className="err">{err}</div> : !d ? <div className="fk-loading">{tx('pos.loading')}</div> : (<>
        <div className="rt-chips sg-ovtabs" role="tablist">
          {OV_TABS.map((t) => <button type="button" role="tab" key={t} className={'rt-chip' + (tab === t ? ' on' : '')} aria-selected={tab === t} onClick={() => setTab(t)} data-testid={'sg-ov-' + t}>{tx('sg.ov.' + t)}</button>)}
        </div>
        <div className="sg-ovbody">
          {tab === 'overview' ? (<>
            <p className="rt-p"><b>{d.customerName}</b> · {d.contact.maskedPhone ?? '—'} · {d.contact.maskedEmail ?? '—'} · {d.customerId.slice(0, 8)}</p>
            <p className="rt-p">{tx('sg.ov.since', { date: when(d.contact.customerSince) })}</p>
            <p className="rt-p"><span className="sg-tags">{d.segments.map((s: string) => <span key={s} className={'fk-chip ' + (SEG_TONE[s] ?? 'mut')}>{segLabel(s)}</span>)}</span> · {tx('sg.ov.points', { n: nf(d.loyalty.pointsBalance), tier: d.loyalty.tier })}</p>
            <p className="rt-p">{tx('sg.why.facts', { v: nf(d.facts.qualifyingVisits), first: when(d.facts.firstVisitAt), last: when(d.facts.lastVisitAt), spend: fmtMoney(d.facts.lifetimeSpendCents), refunds: fmtMoney(d.facts.refundedCents) })}</p>
            <p className="fk-hint">{tx('sg.ov.masked')}</p>
          </>) : null}
          {tab === 'visits' ? (d.visits.length ? <ul className="sg-list">{d.visits.map((v: any) => <li key={v.ticketId}>{whenTime(v.at)} · #{v.ticketNumber ?? '—'} · {fmtMoney(v.totalCents)} · {v.services || '—'}</li>)}</ul> : none) : null}
          {tab === 'appointments' ? (d.appointments.length ? <ul className="sg-list">{d.appointments.map((a: any) => <li key={a.appointmentId}>{a.date ?? '—'} {a.startTime ?? ''} · {a.status}</li>)}</ul> : none) : null}
          {tab === 'spending' ? (<>
            <p className="rt-p">{fmtMoney(d.facts.lifetimeSpendCents)} — {tx('sg.spendDef')}</p>
            {d.refunds.length ? <ul className="sg-list">{d.refunds.map((r: any) => <li key={r.refundId}>{whenTime(r.at)} · #{r.ticketNumber ?? '—'} · −{fmtMoney(r.amountCents)} · {r.status}</li>)}</ul> : none}
          </>) : null}
          {tab === 'loyalty' ? <p className="rt-p">{tx('sg.ov.points', { n: nf(d.loyalty.pointsBalance), tier: d.loyalty.tier })}{d.vipSince ? ` · VIP ${when(d.vipSince)}` : ''}</p> : null}
          {tab === 'qualification' ? <Qualification d={d} /> : null}
          {tab === 'marketing' ? (d.marketingHistory.retentionOutreach.length || d.marketingHistory.audienceDrafts.length ? <ul className="sg-list">
            {d.marketingHistory.retentionOutreach.map((o: any, i: number) => <li key={'o' + i}>{whenTime(o.at)} · {o.label ?? tx('pos.customer_retention')} · {o.status}</li>)}
            {d.marketingHistory.audienceDrafts.map((a: any) => <li key={a.draftId}>{whenTime(a.at)} · {a.channel.toUpperCase()} · {segLabel(a.segment)} · {reasonLabel(a.eligibility)} · {a.status}</li>)}
          </ul> : none) : null}
          {tab === 'contact' ? (<ul className="sg-list">
            <li>{tx('sg.ov.smsConsent')}: {d.preferences.smsMarketingConsent ? tx('sg.ov.yes') : tx('sg.ov.no')}{d.preferences.smsOptedOut ? ` · ${tx('sg.ov.optedOut')}` : ''}</li>
            <li>{tx('sg.ov.emailConsent')}: {d.preferences.emailMarketingConsent ? tx('sg.ov.yes') : tx('sg.ov.no')}{d.preferences.emailOptedOut ? ` · ${tx('sg.ov.optedOut')}` : ''}</li>
          </ul>) : null}
        </div>
      </>)}
    </FitDialog>
  );
}

function AudienceDialog({ onClose, query, seg, pageRows, selected, total, canCampaigns, openCampaigns }: { onClose: () => void; query: SegmentQuery; seg: Seg; pageRows: Row[]; selected: Row[]; total: number; canCampaigns: boolean; openCampaigns: () => void }) {
  const [channel, setChannel] = useState<'sms' | 'email'>('sms');
  const [purpose, setPurpose] = useState<'general' | 'win_back'>(seg === 'inactive' ? 'win_back' : 'general');
  const [mode, setMode] = useState<'page' | 'selected' | 'all_matching'>(selected.length ? 'selected' : 'all_matching');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<any>(null); const [check, setCheck] = useState<any>(null);
  const key = useRef(requestId());
  const build = async () => {
    setBusy(true); setErr(null);
    try {
      const ids = mode === 'page' ? pageRows.map((r) => r.customerId) : mode === 'selected' ? selected.map((r) => r.customerId) : null;
      const d = await posSegmentsApi.createDraft({ channel, purpose, selectionMode: mode, customerIds: ids, filters: query, message: message.trim() || null, idempotencyKey: 'seg-' + key.current });
      setDraft(d);
    } catch (e) { setErr(errorTextOf(e, tx('pos.loading'))); } finally { setBusy(false); }
  };
  const toCampaign = async () => {
    setBusy(true); setErr(null);
    try {
      const c = await posCampaignsApi.create({ name: `${segLabel(seg)} · ${deviceToday()}`, channel, audienceLabel: `${tx('pos.customer_segments')}: ${segLabel(seg)} (draft ${String(draft.draftId).slice(0, 8)})`, audienceSize: draft.eligible, offer: draft.messagePreview ?? undefined });
      const cid = c?.id;
      setDraft(await posSegmentsApi.linkCampaign(draft.draftId, String(cid)));
    } catch (e) { setErr(errorTextOf(e, tx('pos.loading'))); } finally { setBusy(false); }
  };
  const recheck = async () => { setBusy(true); try { setCheck(await posSegmentsApi.recheck(draft.draftId)); } catch (e) { setErr(errorTextOf(e, tx('pos.loading'))); } finally { setBusy(false); } };
  const discard = async () => { setBusy(true); try { setDraft(await posSegmentsApi.discard(draft.draftId)); } catch (e) { setErr(errorTextOf(e, tx('pos.loading'))); } finally { setBusy(false); } };
  return (
    <FitDialog wide title={tx('sg.aud.title')} subtitle={segLabel(seg)} onClose={onClose} busy={busy} testId="sg-audience-dialog"
      footer={!draft ? <>
        <button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.cancel')}</button>
        <button type="button" className="fk-btn primary" onClick={build} disabled={busy || (mode === 'selected' && !selected.length) || (mode === 'page' && !pageRows.length)} data-testid="sg-aud-build">{tx('sg.aud.build')}</button>
      </> : <>
        {draft.status === 'draft' ? <button type="button" className="fk-btn ghost" onClick={discard} disabled={busy} data-testid="sg-aud-discard">{tx('sg.aud.discard')}</button> : null}
        {draft.status === 'draft' ? <button type="button" className="fk-btn ghost" onClick={recheck} disabled={busy} data-testid="sg-aud-recheck">{tx('sg.aud.recheck')}</button> : null}
        {draft.status === 'draft' && !draft.campaignId && canCampaigns ? <button type="button" className="fk-btn primary" onClick={toCampaign} disabled={busy || !draft.eligible} data-testid="sg-aud-campaign">{tx('sg.aud.toCampaign')}</button> : null}
        {draft.campaignId ? <button type="button" className="fk-btn primary" onClick={openCampaigns}>{tx('sg.aud.openCampaigns')}</button> : null}
        <button type="button" className="fk-btn ghost" onClick={onClose} data-testid="sg-aud-close">{tx('pos.close')}</button>
      </>}>
      <p className="fk-note ok" role="note" data-testid="sg-aud-nosend">{tx('sg.aud.noSend')}</p>
      {err ? <div className="err">{err}</div> : null}
      {!draft ? (
        <div className="sg-form">
          <label>{tx('sg.aud.channel')} <select className="fk-select" value={channel} onChange={(e) => setChannel(e.target.value as 'sms' | 'email')} data-testid="sg-aud-channel"><option value="sms">SMS</option><option value="email">Email</option></select></label>
          <label>{tx('sg.aud.purpose')} <select className="fk-select" value={purpose} onChange={(e) => setPurpose(e.target.value as 'general' | 'win_back')}><option value="general">{tx('sg.aud.general')}</option><option value="win_back">{tx('sg.aud.winback')}</option></select></label>
          <fieldset className="sg-scope"><legend>{tx('sg.aud.scope')}</legend>
            <label><input type="radio" name="sg-mode" checked={mode === 'page'} onChange={() => setMode('page')} /> {tx('sg.aud.page', { n: nf(pageRows.length) })}</label>
            <label><input type="radio" name="sg-mode" checked={mode === 'selected'} disabled={!selected.length} onChange={() => setMode('selected')} /> {tx('sg.aud.selected', { n: nf(selected.length) })}</label>
            <label><input type="radio" name="sg-mode" checked={mode === 'all_matching'} onChange={() => setMode('all_matching')} data-testid="sg-aud-all" /> {tx('sg.aud.all', { n: nf(total) })}</label>
          </fieldset>
          <label className="sg-msg">{tx('sg.aud.message')}<textarea className="fk-input" rows={3} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} /></label>
        </div>
      ) : (
        <div data-testid="sg-aud-result">
          <p className="rt-p"><b>{tx('sg.aud.result', { e: nf(draft.eligible), s: nf(draft.selected), x: nf(draft.excluded) })}</b> · {draft.channel.toUpperCase()} · {draft.status}</p>
          {Object.keys(draft.excludedReasons || {}).length ? <ul className="sg-list">{Object.entries(draft.excludedReasons).map(([k, v]) => <li key={k}>{reasonLabel(k)}: {nf(Number(v))}</li>)}</ul> : null}
          {draft.channel === 'sms' && draft.messagePreview ? <p className="fk-hint">{draft.estimatedCostCents == null ? tx('sg.aud.costUnknown') : tx('sg.aud.cost', { c: fmtMoney(draft.estimatedCostCents) })}</p> : null}
          {draft.campaignId ? <p className="fk-note ok">{tx('sg.aud.linked')}</p> : null}
          {check ? <p className="fk-hint" data-testid="sg-aud-recheck-result">{tx('sg.aud.recheckResult', { n: nf(check.eligibleNow), was: nf(check.eligibleAtCreation), c: nf(check.changedCount) })}</p> : null}
          <p className="fk-hint">{tx('sg.aud.expires', { time: whenTime(draft.expiresAt) })}</p>
          <ul className="sg-list sg-members">{draft.members.slice(0, 20).map((m: any) => <li key={m.customerId}>{m.customerName || '—'} · {m.maskedDestination ?? '—'} · <span className={'fk-chip ' + (m.eligibility === 'eligible' ? 'ok' : 'mut')}>{reasonLabel(m.eligibility)}</span></li>)}</ul>
        </div>
      )}
    </FitDialog>
  );
}

function HistoryDialog({ today, onClose }: { today: string; onClose: () => void }) {
  const [date, setDate] = useState(''); const [d, setD] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  const load = () => { if (!date) return; setErr(null); posSegmentsApi.snapshotDay(date).then(setD).catch((e) => setErr(errorTextOf(e, tx('pos.loading')))); };
  return (
    <FitDialog title={tx('sg.snap.title')} onClose={onClose} testId="sg-history-dialog" footer={<button type="button" className="fk-btn primary" onClick={onClose}>{tx('pos.close')}</button>}>
      <div className="sg-form"><label>{tx('sg.snap.date')} <input type="date" className="fk-input" max={today || undefined} value={date} onChange={(e) => setDate(e.target.value)} data-testid="sg-snap-date" /></label>
        <button type="button" className="fk-btn ghost" onClick={load} disabled={!date} data-testid="sg-snap-load">{tx('sg.snap.load')}</button></div>
      {err ? <div className="err">{err}</div> : null}
      {d ? <div data-testid="sg-snap-result">
        <p className="rt-p"><b>{tx('sg.snap.state.' + d.state)}</b>{d.run ? ` · ${d.run.definitionVersion} · ${d.ruleset}` : ''}</p>
        {d.counts ? <ul className="sg-list">{(['all', 'never', 'new', 'returning', 'inactive', 'vip'] as const).map((k) => <li key={k}>{segLabel(k)}: {d.counts[k] == null ? '—' : nf(d.counts[k])}</li>)}</ul> : null}
        {d.vipUnrecorded ? <p className="fk-hint">{tx('sg.snap.vipUnrecorded')}</p> : null}
      </div> : null}
      <p className="fk-hint">{tx('sg.snap.note')}</p>
    </FitDialog>
  );
}

function HealthDialog({ sum, onClose }: { sum: Summary; onClose: () => void }) {
  const h = sum.health;
  return (
    <FitDialog title={tx('sg.health.title')} onClose={onClose} testId="sg-health-dialog" footer={<button type="button" className="fk-btn primary" onClick={onClose}>{tx('pos.close')}</button>}>
      <ul className="sg-list">
        <li>{tx('sg.lastUpdated', { time: whenTime(sum.evaluatedAt) })} · {sum.ruleset} · v{sum.settingsVersion}</li>
        <li>{tx('sg.health.lastVisit', { time: whenTime(h.lastVisitRecordedAt) })}</li>
        {h.unknownBranchVisits ? <li>{tx('sg.unknownBranch', { n: nf(h.unknownBranchVisits) })}</li> : null}
        {h.walkInVisitsWithoutCustomer ? <li>{tx('sg.health.walkIn', { n: nf(h.walkInVisitsWithoutCustomer) })}</li> : null}
        {h.sharedPhoneGroups ? <li>{tx('sg.health.shared', { n: nf(h.sharedPhoneGroups) })}</li> : null}
        <li>{h.lastSnapshot ? tx('sg.health.snapshot', { date: h.lastSnapshot.date, status: h.lastSnapshot.coverage ?? h.lastSnapshot.status }) : tx('sg.health.noSnapshot')}</li>
        <li><b>{tx('sg.health.vipRule')}:</b> {tx('sg.vipRuleText')}</li>
        <li>{tx('sg.overlap')}</li>
      </ul>
    </FitDialog>
  );
}
