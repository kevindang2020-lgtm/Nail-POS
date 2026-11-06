// POSReferralsScreen.tsx — Marketing & Growth → Referrals (/tenant/marketing/referrals). Referral Program guide (Oct 30 2026),
// rebuilt IN PLACE on the existing route: the four original KPI cards (Referral Codes · Total Referrals · Pending Reward · Rewards
// Paid) plus Qualified and Associated Revenue, the Record a Referral form (code + new-customer search + Record), Check Referral
// Eligibility (read-only), Pending Reward Reviews (oldest first), the searchable / filterable / paginated Referral History
// (newest first) with a month calendar and an explicit date basis, the referral overlay (Close / Escape) with Booking, the codes
// list, the reward policy, Check Referral System and the AI Referral Growth Assistant (an UNSENT audience — nothing sends here).
// "Rewards Paid" is CASH with settlement evidence only — there is no approved payout provider, so it reads $0.00 and says why.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posReferralProgramApi, type ReferralQuery } from '../api/posReferralProgramApi';
import { posCustomersApi } from '../api/posCustomersApi';
import { useCan } from '../components/usePermissions';
import { errorTextOf } from '../i18n/error-text';
import { fmtMoney, fmtNumber, fmtInZone, fmtDateTime } from '../i18n/format';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry, useDebounced, requestId } from '../components/FitKit';
import { RangeCalendar } from '../components/FinanceKit';
import { deviceToday } from '../lib/deviceToday';
import { statusLabel } from '../i18n/status-label';   // the code stays the truth; only its label is translated

const TABS = ['all', 'pending', 'qualified', 'review', 'approved', 'issued', 'rejected', 'reversed'] as const;
const PRESETS = ['today', 'week', 'month', 'year'] as const;
const BASES = ['recorded', 'qualified', 'decided', 'issued', 'transaction'] as const;
const SORTS = ['newest', 'oldest', 'name_asc', 'name_desc'] as const;
const SIZES = [10, 20, 50];
const GOALS = ['first_time_customers', 'existing_refer_friends', 'low_demand_weekdays', 'review_performance'] as const;
const nf = (n: number | null | undefined) => (n == null ? '—' : fmtNumber(n));
const when = (v: string | null | undefined) => (v ? fmtInZone(v, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : null);
const stLabel = (s: string | null | undefined) => (s ? (tx('rfp.state.' + s) !== 'rfp.state.' + s ? tx('rfp.state.' + s) : statusLabel('state', s)) : '—');
const tone = (s: string) => (['REWARD_ISSUED', 'ISSUED', 'APPROVED', 'QUALIFIED'].includes(s) ? 'ok' : ['UNDER_REVIEW', 'REWARD_PENDING_APPROVAL', 'PENDING_APPROVAL', 'BLOCKED_EXTERNAL', 'FAILED'].includes(s) ? 'warn' : ['REJECTED', 'REVERSED', 'EXPIRED', 'CANCELLED'].includes(s) ? 'mut' : '');
const rewardText = (r: any) => (!r ? '—' : r.type === 'loyalty_points' ? tx('rfp.reward.points', { n: nf(r.points) }) : tx('rfp.reward.cash', { amount: fmtMoney(r.amountCents) }));

type Dlg = { kind: 'referral'; id: string } | { kind: 'health' } | { kind: 'policy' } | { kind: 'assistant' } | { kind: 'codes' } | null;

export function POSReferralsScreen() {
  const nav = useNavigate();
  const can = useCan();
  const canManage = can('marketing.manage');
  const [tab, setTab] = useState<string>('all');
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 300);
  const [rewardType, setRewardType] = useState('');
  // A18 Nov 6: branch / risk / creator / reviewer filters (people and branches from real rows)
  const [xf, setXf] = useState<{ branch?: string; eligibility?: string; creator?: string; reviewer?: string }>({});
  const [fo, setFo] = useState<{ creators: { id: string; name: string }[]; reviewers: { id: string; name: string }[]; branches: { id: string; name: string }[] } | null>(null);
  useEffect(() => { posReferralProgramApi.filterOptions().then(setFo).catch(() => setFo(null)); }, []);
  const [basis, setBasis] = useState<string>('recorded');
  const [preset, setPreset] = useState<string>('');
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [calOpen, setCalOpen] = useState(false);
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [apPage, setApPage] = useState(1);
  const [sum, setSum] = useState<any | null>(null);
  const [list, setList] = useState<any | null>(null);
  const [aps, setAps] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [reload, setReload] = useState(0);
  const [dlg, setDlg] = useState<Dlg>(null);

  const rangeQ = useMemo(() => (preset === 'custom' && range ? { preset: 'custom', from: range.from, to: range.to } : preset ? { preset } : {}), [preset, range]);
  const query: ReferralQuery = useMemo(() => ({ tab, q: q || undefined, rewardType: rewardType || undefined, ...xf, basis: preset ? basis : undefined, ...rangeQ, sort, page, pageSize }), [tab, q, rewardType, xf, basis, preset, rangeQ, sort, page, pageSize]);
  useEffect(() => { setPage(1); }, [tab, q, rewardType, xf, basis, preset, range, sort, pageSize]);   // any filter change → page 1

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [s, l, a] = await Promise.all([posReferralProgramApi.summary(), posReferralProgramApi.referrals(query), posReferralProgramApi.approvals({ page: apPage, pageSize: 10 })]);
      setSum(s); setList(l); setAps(a);
    } catch (e: any) {
      if (e?.status === 403 || e?.code === 'PERMISSION_DENIED') setForbidden(true);
      setErr(errorTextOf(e, tx('rfp.loading')));
    }
  }, [query, apPage]);
  useEffect(() => { void load(); }, [load, reload]);
  // live-ish: a 45 s refresh while the page is open (no realtime channel carries referral events yet)
  useEffect(() => { const t = setInterval(() => setReload((n) => n + 1), 45000); return () => clearInterval(t); }, []);

  const anyFilter = tab !== 'all' || !!search || !!rewardType || !!preset || sort !== 'newest';
  const clearAll = () => { setTab('all'); setSearch(''); setRewardType(''); setPreset(''); setRange(null); setBasis('recorded'); setSort('newest'); };
  const rangeText = range ? `${range.from} → ${range.to}` : '';
  const rows: any[] = list?.items ?? [];
  if (forbidden) return <div className="work"><div className="vh"><h1>{tx('rfp.title')}</h1></div><Empty title={tx('rfp.forbidden')} /></div>;
  const k = sum;

  return (
    <div className="work rfp" data-testid="rfp-page">
      <div className="vh rfp-head">
        <div><h1>{tx('rfp.title')}</h1><div className="sub">{tx('rfp.subtitle')}</div>
          {k ? <div className="fk-muted rfp-updated" data-testid="rfp-updated">{tx('rfp.updated', { time: when(k.lastUpdated) ?? '' })}</div> : null}</div>
        <div className="rfp-actions">
          <button type="button" className="fk-btn ghost" onClick={() => setReload((n) => n + 1)} data-testid="rfp-refresh">{tx('rfp.refresh')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => setDlg({ kind: 'health' })} data-testid="rfp-health">{tx('rfp.health')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => setDlg({ kind: 'codes' })} data-testid="rfp-codes">{tx('rfp.codes')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => setDlg({ kind: 'policy' })} data-testid="rfp-policy">{tx('rfp.policy')}</button>
          {canManage ? <button type="button" className="fk-btn" onClick={() => setDlg({ kind: 'assistant' })} data-testid="rfp-assistant">{tx('rfp.assistant')}</button> : null}
        </div>
      </div>

      {k?.budget ? <div className={`fk-hint${k.budget.exhausted || k.budget.warn ? ' warn' : ''}`} data-testid="rfp-budget">{k.budget.exhausted ? tx('rfp.budget.exhausted') : tx('rfp.budget.line', { used: fmtMoney(k.budget.committedCents), total: fmtMoney(k.budget.totalCents ?? 0), left: fmtMoney(k.budget.remainingCents ?? 0), redeemed: fmtMoney(k.budget.redeemedCents) })}</div> : null}
      <div className="fk-kpis six" data-testid="rfp-kpis">
        <KpiCard label={tx('rfp.kpi.codes')} value={nf(k?.codes)} sub={k ? tx('rfp.kpi.codesSub', { n: nf(k.codesActive) }) : undefined} loading={!k} onClick={() => setDlg({ kind: 'codes' })} testId="rfp-kpi-codes" />
        <KpiCard label={tx('rfp.kpi.total')} value={nf(k?.totalReferrals)} sub={k ? tx('rfp.kpi.totalSub', { n: nf(k.waitingForVisit) }) : undefined} loading={!k} onClick={() => setTab('all')} testId="rfp-kpi-total" />
        <KpiCard label={tx('rfp.kpi.pending')} value={nf(k?.pendingReward)} sub={k ? tx('rfp.kpi.pendingSub', { n: nf(k.pendingApproval) }) : undefined} tone={k?.pendingReward ? 'warn' : undefined} loading={!k} onClick={() => setTab('review')} testId="rfp-kpi-pending" />
        <KpiCard label={tx('rfp.kpi.paid')} value={k ? fmtMoney(k.cashPaidCents) : '—'} sub={tx('rfp.kpi.paidSub')} loading={!k} testId="rfp-kpi-paid" />
        <KpiCard label={tx('rfp.kpi.qualified')} value={nf(k?.qualified)} sub={k ? tx('rfp.kpi.qualifiedSub', { n: nf(k.issuedRewards), pts: nf(k.issuedPoints) }) : undefined} loading={!k} onClick={() => setTab('qualified')} testId="rfp-kpi-qualified" />
        <KpiCard label={tx('rfp.kpi.revenue')} value={k ? fmtMoney(k.associatedRevenueCents) : '—'} sub={tx('rfp.kpi.revenueSub')} loading={!k} testId="rfp-kpi-revenue" />
      </div>
      {k && !k.policy?.configured ? <div className="fk-hint warn" data-testid="rfp-no-policy">{tx('rfp.noPolicy')} {canManage ? <button type="button" className="fk-link" onClick={() => setDlg({ kind: 'policy' })}>{tx('rfp.policy')}</button> : null}</div> : null}

      <div className="rt-filters sg-tools rfp-tools">
        <input className="fk-input fk-search sg-search" type="search" placeholder={tx('rfp.search')} aria-label={tx('rfp.search')} value={search} onChange={(e) => setSearch(e.target.value)} data-testid="rfp-search" />
        <select className="fk-select" aria-label={tx('rfp.rewardType')} value={rewardType} onChange={(e) => setRewardType(e.target.value)} data-testid="rfp-reward-type">
          <option value="">{tx('rfp.rewardType.any')}</option><option value="loyalty_points">{tx('rfp.rewardType.loyalty_points')}</option><option value="cash_payout">{tx('rfp.rewardType.cash_payout')}</option><option value="salon_voucher">{tx('rfp.rewardType.salon_voucher')}</option></select>
        {fo ? <>
          <select className="fk-select" aria-label={tx('rfp.f.risk')} value={xf.eligibility ?? ''} onChange={(e) => setXf((o) => ({ ...o, eligibility: e.target.value || undefined }))} data-testid="rfp-f-risk">
            <option value="">{tx('rfp.f.riskAny')}</option><option value="flagged">{tx('rfp.f.flagged')}</option><option value="clean">{tx('rfp.f.clean')}</option></select>
          {fo.branches.length > 1 ? <select className="fk-select" aria-label={tx('rfp.f.branch')} value={xf.branch ?? ''} onChange={(e) => setXf((o) => ({ ...o, branch: e.target.value || undefined }))} data-testid="rfp-f-branch">
            <option value="">{tx('rfp.f.branchAny')}</option>{fo.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select> : null}
          <select className="fk-select" aria-label={tx('rfp.f.creator')} value={xf.creator ?? ''} onChange={(e) => setXf((o) => ({ ...o, creator: e.target.value || undefined }))} data-testid="rfp-f-creator">
            <option value="">{tx('rfp.f.creatorAny')}</option>{fo.creators.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          <select className="fk-select" aria-label={tx('rfp.f.reviewer')} value={xf.reviewer ?? ''} onChange={(e) => setXf((o) => ({ ...o, reviewer: e.target.value || undefined }))} data-testid="rfp-f-reviewer">
            <option value="">{tx('rfp.f.reviewerAny')}</option>{fo.reviewers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        </> : null}
        <div className="fk-seg rfp-presets">
          {PRESETS.map((p) => <button key={p} type="button" className={preset === p ? 'on' : ''} aria-pressed={preset === p} onClick={() => { setPreset(preset === p ? '' : p); setCalOpen(false); }} data-testid={'rfp-preset-' + p}>{tx('rfp.preset.' + p)}</button>)}
          <button type="button" className={preset === 'custom' ? 'on' : ''} aria-pressed={preset === 'custom'} aria-haspopup="dialog" aria-expanded={calOpen} onClick={() => setCalOpen((o) => !o)} data-testid="rfp-preset-custom">{preset === 'custom' && range ? rangeText : tx('rfp.preset.custom')}</button>
        </div>
        {preset ? <select className="fk-select" aria-label={tx('rfp.basis')} value={basis} onChange={(e) => setBasis(e.target.value)} data-testid="rfp-basis">
          {BASES.map((b) => <option key={b} value={b}>{tx('rfp.basis.' + b)}</option>)}</select> : null}
        <select className="fk-select" aria-label={tx('rfp.sort')} value={sort} onChange={(e) => setSort(e.target.value)} data-testid="rfp-sort">
          {SORTS.map((s) => <option key={s} value={s}>{tx('rfp.sort.' + s)}</option>)}</select>
        {anyFilter ? <button type="button" className="fk-link" onClick={clearAll} data-testid="rfp-clear">{tx('rfp.clear')}</button> : null}
        {calOpen ? <div className="bd-cal" role="dialog" aria-label={tx('rfp.preset.custom')}>
          <RangeCalendar initial={{ from: range?.from, to: range?.to }} today={list?.today ?? deviceToday()}
            onApply={(r) => { setRange(r); setPreset('custom'); setCalOpen(false); }} onCancel={() => setCalOpen(false)} onClear={() => { setRange(null); setPreset(''); setCalOpen(false); }} />
        </div> : null}
      </div>
      {preset ? <div className="fk-hint" data-testid="rfp-basis-note">{tx('rfp.basisNote', { basis: tx('rfp.basis.' + basis), range: list?.range ? `${list.range.from} → ${list.range.to}` : '' })}</div> : null}

      <div className="rfp-two">
        <RecordPanel canManage={canManage} onRecorded={(id) => { setTab('all'); setSort('newest'); setSearch(''); setReload((n) => n + 1); setDlg({ kind: 'referral', id }); }} />
        <section className="fk-panel rfp-approvals" data-testid="rfp-approvals">
          <h3>{tx('rfp.approvals')} <span className="fk-muted">{tx('rfp.approvalsSort')}</span></h3>
          {!aps ? <div className="fk-loading">{tx('rfp.loading')}</div> : aps.items.length === 0 ? <Empty title={tx('rfp.approvalsEmpty')} /> : (
            <ul className="fk-list">{aps.items.map((r: any) => (
              <li key={r.id} className="fk-li" data-testid="rfp-approval">
                <div><div className="fk-li-t">{r.referrer.name} → {r.referred?.name ?? '—'}</div>
                  <div className="fk-muted">{stLabel(r.state)} · {rewardText(r.reward)} · {when(r.reward?.requestedAt ?? r.recordedAt)}{r.flags?.length ? ' · ' + tx('rfp.flagged') : ''}</div></div>
                <button type="button" className="fk-btn ghost" onClick={() => setDlg({ kind: 'referral', id: r.id })} data-testid="rfp-approval-open">{tx('rfp.review')}</button>
              </li>))}</ul>)}
          <Pager info={aps} onPage={setApPage} compact />
        </section>
      </div>

      <section className="fk-panel sg-panel" data-testid="rfp-results">
        <div className="fk-seg rfp-tabs" role="tablist">
          {TABS.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} data-testid={'rfp-tab-' + t}>{tx('rfp.tab.' + t)}</button>)}
        </div>
        <div className="sub rfp-count" data-testid="rfp-count">{list ? tx('rfp.count', { n: nf(list.totalItems) }) : ''}</div>
        <div className="sg-table-wrap">
          {err ? <ErrorRetry message={err} onRetry={() => setReload((n) => n + 1)} /> : !list ? <div className="fk-loading">{tx('rfp.loading')}</div> : rows.length === 0 ? (
            k && k.totalReferrals === 0 ? <Empty title={tx('rfp.empty')}><span className="fk-muted">{tx('rfp.emptyHint', { codes: nf(k.codes) })}</span></Empty> : <Empty title={tx('rfp.noMatch')} />
          ) : (
            <table className="fk-table rt-table sg-table rfp-table">
              <thead><tr><th>{tx('rfp.col.referrer')}</th><th>{tx('rfp.col.referred')}</th><th>{tx('rfp.col.code')}</th><th>{tx('rfp.col.recorded')}</th><th>{tx('rfp.col.state')}</th><th>{tx('rfp.col.reward')}</th><th>{tx('rfp.col.visit')}</th><th></th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id} data-testid="rfp-row">
                  <td><div className="fk-li-t">{r.referrer.name ?? '—'}{r.matchedAs === 'referrer' || r.matchedAs === 'both' ? <span className="fk-chip gold">{tx('rfp.matched.referrer')}</span> : null}</div><div className="fk-muted">{r.referrer.phone ?? ''}</div></td>
                  <td><div className="fk-li-t">{r.referred?.name ?? '—'}{r.matchedAs === 'referred' || r.matchedAs === 'both' ? <span className="fk-chip gold">{tx('rfp.matched.referred')}</span> : null}</div><div className="fk-muted">{r.referred?.phone ?? ''}</div></td>
                  <td><code>{r.code}</code></td>
                  <td>{when(r.recordedAt) ?? '—'}</td>
                  <td><span className={'fk-chip ' + tone(r.state)} data-testid="rfp-state">{stLabel(r.state)}</span>{r.flags?.length ? <span className="fk-chip warn">{tx('rfp.flagged')}</span> : null}</td>
                  <td>{r.reward ? <>{rewardText(r.reward)}<div className="fk-muted">{stLabel(r.reward.state)}</div></> : r.legacyMarkedRewardCents != null ? <span className="fk-muted">{tx('rfp.legacyMarked', { amount: fmtMoney(r.legacyMarkedRewardCents) })}</span> : '—'}</td>
                  <td>{r.ticket ? <>{r.ticket.number ? '#' + r.ticket.number : '—'}<div className="fk-muted">{fmtMoney(r.ticket.totalCents)}</div></> : <span className="fk-muted">{tx('rfp.noVisit')}</span>}</td>
                  <td><button type="button" className="fk-btn ghost sg-why" onClick={() => setDlg({ kind: 'referral', id: r.id })} data-testid="rfp-open">{tx('rfp.details')}</button></td>
                </tr>))}</tbody>
            </table>)}
        </div>
        <footer className="sg-foot">
          <select className="fk-select" aria-label={tx('rfp.rows')} value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} data-testid="rfp-size">
            {SIZES.map((n) => <option key={n} value={n}>{tx('rfp.rows')}: {n}</option>)}</select>
          <Pager info={list} onPage={setPage} />
        </footer>
      </section>

      <div className="rfp-two">
        <section className="fk-panel" data-testid="rfp-performance"><h3>{tx('rfp.performance')}</h3>
          {k ? <dl className="rfp-dl">
            <dt>{tx('rfp.perf.recorded')}</dt><dd>{nf(k.totalReferrals)}</dd>
            <dt>{tx('rfp.perf.qualified')}</dt><dd>{nf(k.qualified)}</dd>
            <dt>{tx('rfp.perf.issued')}</dt><dd>{tx('rfp.perf.issuedValue', { n: nf(k.issuedRewards), pts: nf(k.issuedPoints) })}</dd>
            <dt>{tx('rfp.perf.reversed')}</dt><dd>{nf(k.reversedRewards)}</dd>
            <dt>{tx('rfp.perf.cash')}</dt><dd>{fmtMoney(k.cashPaidCents)} · {tx('rfp.perf.cashNote', { n: nf(k.blockedPayouts) })}</dd>
            <dt>{tx('rfp.perf.revenue')}</dt><dd>{fmtMoney(k.associatedRevenueCents)}</dd>
            {k.legacyMarked?.count ? <><dt>{tx('rfp.perf.legacy')}</dt><dd>{tx('rfp.perf.legacyValue', { n: nf(k.legacyMarked.count), amount: fmtMoney(k.legacyMarked.cents) })}</dd></> : null}
          </dl> : <div className="fk-loading">{tx('rfp.loading')}</div>}
        </section>
        <AlertsPanel reload={reload} onOpen={() => setDlg({ kind: 'health' })} />
      </div>

      {dlg?.kind === 'referral' ? <ReferralDialog id={dlg.id} canManage={canManage} onClose={() => setDlg(null)} onChanged={() => setReload((n) => n + 1)}
        onBook={(id) => nav(`/booking/new?customerId=${encodeURIComponent(id)}&from=referrals`)} onProfile={(id) => nav(`/tenant/customers/profiles?customerId=${encodeURIComponent(id)}`)} /> : null}
      {dlg?.kind === 'health' ? <HealthDialog onClose={() => setDlg(null)} /> : null}
      {dlg?.kind === 'codes' ? <CodesDialog canManage={canManage} onClose={() => setDlg(null)} onChanged={() => setReload((n) => n + 1)} /> : null}
      {dlg?.kind === 'policy' ? <PolicyDialog canManage={canManage} onClose={() => setDlg(null)} onSaved={() => setReload((n) => n + 1)} /> : null}
      {dlg?.kind === 'assistant' ? <AssistantDialog onClose={() => setDlg(null)} onOpenCampaigns={() => nav('/tenant/marketing/campaigns')} /> : null}
    </div>
  );
}

function RecordPanel({ canManage, onRecorded }: { canManage: boolean; onRecorded: (id: string) => void }) {
  const [code, setCode] = useState('');
  const [find, setFind] = useState('');
  const fq = useDebounced(find.trim(), 250);
  const [hits, setHits] = useState<any[]>([]);
  const [picked, setPicked] = useState<{ customerId: string; name: string } | null>(null);
  const [verdict, setVerdict] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [key, setKey] = useState(requestId());
  useEffect(() => {
    if (!fq || picked) { setHits([]); return; }
    let on = true;
    posCustomersApi.quickSearch(fq).then((r: any) => { if (on) setHits((r?.items ?? []).slice(0, 6)); }).catch(() => { if (on) setHits([]); });
    return () => { on = false; };
  }, [fq, picked]);
  useEffect(() => { setVerdict(null); setKey(requestId()); }, [code, picked]);
  const check = async () => {
    if (!code.trim()) { setNote(tx('rfp.form.needCode')); return; }
    setBusy(true); setNote(null);
    try { setVerdict(await posReferralProgramApi.check({ code: code.trim(), referredCustomerId: picked?.customerId ?? null })); }
    catch (e: any) { setNote(errorTextOf(e, tx('rfp.form.checkFailed'))); } finally { setBusy(false); }
  };
  const record = async () => {
    if (!code.trim() || !picked) { setNote(tx('rfp.form.needBoth')); return; }
    setBusy(true); setNote(null);
    try { const r = await posReferralProgramApi.record({ code: code.trim(), referredCustomerId: picked.customerId, idempotencyKey: key });
      setNote(r.duplicate ? tx('rfp.form.duplicate') : r.friendVoucher ? tx('rfp.form.recordedVoucher', { amt: fmtMoney(r.friendVoucher.faceCents), code: r.friendVoucher.code }) : tx('rfp.form.recorded')); setCode(''); setFind(''); setPicked(null); onRecorded(r.id); }
    catch (e: any) { setNote(errorTextOf(e, tx('rfp.form.recordFailed'))); } finally { setBusy(false); }
  };
  const recordable = verdict && (verdict.result === 'ELIGIBLE_TO_RECORD' || verdict.result === 'REVIEW_REQUIRED');
  return (
    <section className="fk-panel rfp-record" data-testid="rfp-record">
      <h3>{tx('rfp.form.title')}</h3>
      <label className="fk-field"><span>{tx('rfp.form.code')}</span>
        <input className="fk-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder={tx('rfp.form.codePh')} data-testid="rfp-code" /></label>
      <label className="fk-field"><span>{tx('rfp.form.customer')}</span>
        {picked ? <div className="rfp-picked"><b>{picked.name}</b> <button type="button" className="fk-link" onClick={() => setPicked(null)} data-testid="rfp-unpick">{tx('rfp.form.change')}</button></div>
          : <input className="fk-input" value={find} onChange={(e) => setFind(e.target.value)} placeholder={tx('rfp.form.customerPh')} data-testid="rfp-find" />}</label>
      {hits.length ? <ul className="fk-list rfp-hits">{hits.map((h: any) => {
        const name = h.displayName ?? h.fullName ?? `${h.firstName ?? ''} ${h.lastName ?? ''}`.trim();
        return <li key={h.customerId} className="fk-li"><button type="button" className="fk-li-t link" onClick={() => { setPicked({ customerId: h.customerId, name }); setHits([]); }} data-testid="rfp-hit">{name}</button><span className="fk-muted">{h.phone ?? ''}</span></li>;
      })}</ul> : null}
      <div className="rfp-form-actions">
        <button type="button" className="fk-btn ghost" onClick={check} disabled={busy} data-testid="rfp-check">{tx('rfp.form.check')}</button>
        <button type="button" className="fk-btn" onClick={record} disabled={busy || !canManage || !picked || !code.trim() || (verdict && !recordable)} data-testid="rfp-record-btn">{tx('rfp.form.record')}</button>
      </div>
      {!canManage ? <div className="fk-muted">{tx('rfp.form.noPermission')}</div> : null}
      {verdict ? <div className={'rfp-verdict ' + (recordable ? 'ok' : 'bad')} data-testid="rfp-verdict" role="status">
        <b>{tx('rfp.elig.' + verdict.result)}</b>
        <ul>{verdict.reasons.map((r: any, i: number) => <li key={i} className={r.ok ? 'ok' : 'bad'}>{r.ok ? '✓' : '✕'} {r.text}</li>)}</ul>
        <div className="fk-muted">{tx('rfp.elig.readOnly')}</div>
      </div> : null}
      {note ? <div className="fk-hint" role="status" data-testid="rfp-note">{note}</div> : null}
    </section>
  );
}

function AlertsPanel({ reload, onOpen }: { reload: number; onOpen: () => void }) {
  const [h, setH] = useState<any | null>(null);
  useEffect(() => { let on = true; posReferralProgramApi.health().then((x) => { if (on) setH(x); }).catch(() => { if (on) setH({ overall: 'unknown', items: [] }); }); return () => { on = false; }; }, [reload]);
  const bad = (h?.items ?? []).filter((i: any) => i.status !== 'ready');
  return (
    <section className="fk-panel" data-testid="rfp-alerts"><h3>{tx('rfp.alerts')}</h3>
      {!h ? <div className="fk-loading">{tx('rfp.loading')}</div> : bad.length === 0 ? <div className="fk-muted">{tx('rfp.alertsNone')}</div> : (
        <ul className="fk-list">{bad.map((i: any) => <li key={i.key} className="fk-li"><span className={'fk-chip ' + (i.status === 'failed' ? 'bad' : 'warn')}>{tx('rfp.hs.' + i.status)}</span> {i.summary}</li>)}</ul>)}
      <button type="button" className="fk-link" onClick={onOpen}>{tx('rfp.health')}</button>
    </section>
  );
}

function ReferralDialog({ id, canManage, onClose, onChanged, onBook, onProfile }: { id: string; canManage: boolean; onClose: () => void; onChanged: () => void; onBook: (id: string) => void; onProfile: (id: string) => void }) {
  const [d, setD] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState('overview');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(async () => { setErr(null); try { setD(await posReferralProgramApi.referral(id)); } catch (e: any) { setErr(errorTextOf(e, tx('rfp.loading'))); } }, [id]);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true); setNote(null);
    try { await fn(); setNote(done); setReason(''); await load(); onChanged(); } catch (e: any) { setNote(errorTextOf(e, tx('rfp.actionFailed'))); } finally { setBusy(false); }
  };
  const TABS2 = ['overview', 'referrer', 'referred', 'visit', 'reward', 'communication', 'audit'];
  const w = d?.rewardDetail;
  return (
    <FitDialog title={tx('rfp.dlg.title')} subtitle={d ? `${d.code} · ${stLabel(d.state)}` : undefined} onClose={onClose} busy={busy} side testId="rfp-dialog"
      footer={<div className="rfp-dlg-actions">
        {d?.referred ? <button type="button" className="fk-btn ghost" onClick={() => onBook(d.referred.customerId)} data-testid="rfp-book">{tx('rfp.dlg.book')}</button> : null}
        {d ? <button type="button" className="fk-btn ghost" onClick={() => onProfile(d.referrer.customerId)}>{tx('rfp.dlg.referrerProfile')}</button> : null}
        {d?.referred ? <button type="button" className="fk-btn ghost" onClick={() => onProfile(d.referred.customerId)}>{tx('rfp.dlg.referredProfile')}</button> : null}
        <button type="button" className="fk-btn" onClick={onClose} data-testid="rfp-close">{tx('rfp.close')}</button></div>}>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !d ? <div className="fk-loading">{tx('rfp.loading')}</div> : (<>
        <div className="fk-seg rfp-dlg-tabs" role="tablist">{TABS2.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} data-testid={'rfp-dtab-' + t}>{tx('rfp.dtab.' + t)}</button>)}</div>
        <div className="rfp-dlg-body">
          {tab === 'overview' ? <dl className="rfp-dl">
            <dt>{tx('rfp.f.id')}</dt><dd><code>{d.overview.id}</code></dd><dt>{tx('rfp.f.code')}</dt><dd>{d.overview.code}</dd><dt>{tx('rfp.f.branch')}</dt><dd>{d.overview.branch ?? '—'}</dd>
            <dt>{tx('rfp.f.state')}</dt><dd><span className={'fk-chip ' + tone(d.state)} data-testid="rfp-dlg-state">{stLabel(d.state)}</span></dd><dt>{tx('rfp.f.recorded')}</dt><dd>{when(d.overview.recordedAt)}</dd>
            <dt>{tx('rfp.f.qualified')}</dt><dd>{when(d.qualifiedAt) ?? '—'}</dd><dt>{tx('rfp.f.policy')}</dt><dd>{d.overview.policyVersion ?? '—'}</dd>
            {d.reviewReason ? <><dt>{tx('rfp.f.review')}</dt><dd>{d.reviewReason}</dd></> : null}
            {d.flags?.length ? <><dt>{tx('rfp.f.flags')}</dt><dd>{d.flags.map((f: any) => <div key={f.code} className="fk-chip warn">{f.detail}</div>)}</dd></> : null}
            {d.legacyMarkedRewardCents != null ? <><dt>{tx('rfp.f.legacy')}</dt><dd>{tx('rfp.legacyMarked', { amount: fmtMoney(d.legacyMarkedRewardCents) })}</dd></> : null}
          </dl> : null}
          {tab === 'referrer' ? <dl className="rfp-dl"><dt>{tx('rfp.f.name')}</dt><dd>{d.referrerProfile.name}</dd><dt>{tx('rfp.f.phone')}</dt><dd>{d.referrerProfile.phone ?? '—'}</dd><dt>{tx('rfp.f.email')}</dt><dd>{d.referrerProfile.email ?? '—'}</dd>
            <dt>{tx('rfp.f.customerId')}</dt><dd><code>{d.referrerProfile.customerId}</code></dd><dt>{tx('rfp.f.prior')}</dt><dd>{tx('rfp.f.priorValue', { n: nf(d.referrerProfile.priorReferrals), r: nf(d.referrerProfile.priorRewarded) })}</dd></dl> : null}
          {tab === 'referred' ? (d.referredProfile ? <dl className="rfp-dl"><dt>{tx('rfp.f.name')}</dt><dd>{d.referredProfile.name}</dd><dt>{tx('rfp.f.phone')}</dt><dd>{d.referredProfile.phone ?? '—'}</dd><dt>{tx('rfp.f.email')}</dt><dd>{d.referredProfile.email ?? '—'}</dd>
            <dt>{tx('rfp.f.visits')}</dt><dd>{nf(d.referredProfile.completedVisits)}{d.referredProfile.firstVisitAt ? ' · ' + when(d.referredProfile.firstVisitAt) : ''}</dd>
            <dt>{tx('rfp.f.consent')}</dt><dd>{tx('px.ch.consent', { sms: d.referredProfile.consent.sms ? '✓' : '✕', email: d.referredProfile.consent.email ? '✓' : '✕' })}</dd>
            <dt>{tx('rfp.f.bookings')}</dt><dd>{d.referredProfile.appointments.length ? d.referredProfile.appointments.map((a: any) => <div key={a.id}>{a.date} {a.startTime} · {statusLabel(['appointment', 'state'], a.status)}</div>) : '—'}</dd></dl> : <Empty title="—" />) : null}
          {tab === 'visit' ? (d.visit ? <dl className="rfp-dl" data-testid="rfp-visit"><dt>{tx('rfp.f.ticket')}</dt><dd>{d.visit.number ? '#' + d.visit.number : d.visit.ticketId}</dd><dt>{tx('rfp.f.paid')}</dt><dd>{fmtMoney(d.visit.totalCents)} · {when(d.visit.paidAt)}</dd>
            <dt>{tx('rfp.f.payments')}</dt><dd>{d.visit.payments.map((p: any, i: number) => <div key={i}>{statusLabel('paymentMethod', p.method)} {fmtMoney(p.amountCents)} · {statusLabel(['payment', 'state'], p.status)}{p.cardLast4 ? ' · ••' + p.cardLast4 : ''}</div>)}</dd>
            <dt>{tx('rfp.f.refunds')}</dt><dd>{d.visit.refunds.length ? d.visit.refunds.map((r: any, i: number) => <div key={i}>{fmtMoney(r.amountCents)} · {statusLabel('refund', r.status)}</div>) : '—'}</dd></dl> : <Empty title={tx('rfp.noVisitLong')} />) : null}
          {tab === 'reward' ? (w ? <dl className="rfp-dl" data-testid="rfp-reward"><dt>{tx('rfp.f.reward')}</dt><dd>{rewardText(w)}</dd><dt>{tx('rfp.f.disposition')}</dt><dd><span className={'fk-chip ' + tone(w.state)}>{tx('rfp.disp.' + w.disposition)}</span></dd>
            <dt>{tx('rfp.f.requested')}</dt><dd>{when(w.requestedAt)}</dd><dt>{tx('rfp.f.decided')}</dt><dd>{when(w.decidedAt) ?? '—'}{w.decisionReason ? ' · ' + w.decisionReason : ''}</dd>
            <dt>{tx('rfp.f.issued')}</dt><dd>{when(w.issuedAt) ?? '—'}</dd><dt>{tx('rfp.f.ledger')}</dt><dd>{w.ledger ? tx('rfp.f.ledgerValue', { delta: nf(w.ledger.delta), bal: nf(w.ledger.balanceAfter) }) : '—'}</dd>
            {w.issueError ? <><dt>{tx('rfp.f.error')}</dt><dd>{w.issueError}</dd></> : null}
            {w.reversedAt ? <><dt>{tx('rfp.f.reversed')}</dt><dd>{when(w.reversedAt)} · {w.reversalReason}{w.reversalShortfall ? ' · ' + tx('rfp.f.shortfall', { n: nf(w.reversalShortfall) }) : ''}</dd></> : null}</dl> : <Empty title={d.qualifiedAt ? tx('rfp.noRewardYet') : tx('rfp.notQualifiedYet')} />) : null}
          {tab === 'communication' ? (d.communication.items.length ? <>
            <table className="fk-table" data-testid="rfp-comm"><tbody>{d.communication.items.map((m: any) => <tr key={m.id}><td>{fmtDateTime(m.at)}</td><td>{tx('rfp.comm.' + m.who)}</td><td>{m.channel}</td><td>{m.status}</td><td>{m.preview}</td></tr>)}</tbody></table>
            <div className="fk-hint">{d.communication.note}</div></> : <Empty title={tx('rfp.comm.none')}>{d.communication.note}</Empty>) : null}
          {tab === 'audit' ? <ol className="rfp-audit" data-testid="rfp-audit">{d.audit.map((e: any, i: number) => <li key={i}><b>{tx('rfp.ev.' + e.type) !== 'rfp.ev.' + e.type ? tx('rfp.ev.' + e.type) : e.type}</b> · {when(e.at)}{e.actor ? ' · ' + e.actor : ''}{e.to ? ' → ' + stLabel(e.to) : ''}{e.reason ? <div className="fk-muted">{e.reason}</div> : null}</li>)}</ol> : null}
        </div>
        {canManage ? <div className="rfp-manage" data-testid="rfp-manage">
          <input className="fk-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tx('rfp.reasonPh')} aria-label={tx('rfp.reasonPh')} data-testid="rfp-reason" />
          {w?.state === 'PENDING_APPROVAL' ? <button type="button" className="fk-btn" disabled={busy} onClick={() => act(() => posReferralProgramApi.review(id, { action: 'approve', reason: reason || null, expectedVersion: d.version }), tx('rfp.done.approved'))} data-testid="rfp-approve">{tx('rfp.approve')}</button> : null}
          {!['REJECTED', 'REVERSED', 'EXPIRED', 'CANCELLED', 'REWARD_ISSUED'].includes(d.state) ? <button type="button" className="fk-btn ghost" disabled={busy || reason.trim().length < 5} onClick={() => act(() => posReferralProgramApi.review(id, { action: 'reject', reason, expectedVersion: d.version }), tx('rfp.done.rejected'))} data-testid="rfp-reject">{tx('rfp.reject')}</button> : null}
          {d.state !== 'UNDER_REVIEW' && !['REJECTED', 'REVERSED', 'EXPIRED', 'CANCELLED'].includes(d.state) ? <button type="button" className="fk-btn ghost" disabled={busy || reason.trim().length < 5} onClick={() => act(() => posReferralProgramApi.review(id, { action: 'investigate', reason, expectedVersion: d.version }), tx('rfp.done.investigate'))} data-testid="rfp-investigate">{tx('rfp.investigate')}</button> : null}
          {d.state === 'UNDER_REVIEW' ? <button type="button" className="fk-btn ghost" disabled={busy} onClick={() => act(() => posReferralProgramApi.review(id, { action: 'clear_review', reason: reason || null, expectedVersion: d.version }), tx('rfp.done.cleared'))} data-testid="rfp-clear-review">{tx('rfp.clearReview')}</button> : null}
          {w && ['APPROVED', 'FAILED'].includes(w.state) ? <button type="button" className="fk-btn ghost" disabled={busy} onClick={() => act(() => posReferralProgramApi.issue(w.id), tx('rfp.done.issued'))} data-testid="rfp-retry">{tx('rfp.retryIssue')}</button> : null}
          {w?.state === 'ISSUED' ? <button type="button" className="fk-btn ghost" disabled={busy || reason.trim().length < 5} onClick={() => act(() => posReferralProgramApi.reverse(w.id, reason), tx('rfp.done.reversed'))} data-testid="rfp-reverse">{tx('rfp.reverse')}</button> : null}
          {note ? <div className="fk-hint" role="status" data-testid="rfp-dlg-note">{note}</div> : null}
        </div> : null}
      </>)}
    </FitDialog>
  );
}

function HealthDialog({ onClose }: { onClose: () => void }) {
  const [h, setH] = useState<any | null>(null); const [err, setErr] = useState<string | null>(null);
  // A18 Nov 6: every run is recorded; the previous run is shown for comparison
  const [prev, setPrev] = useState<any>(null);
  useEffect(() => { posReferralProgramApi.healthLast().then(setPrev).catch(() => setPrev(null)); }, []);
  const run = useCallback(async () => { setErr(null); setH(null); try { setH(await posReferralProgramApi.healthRun()); } catch (e: any) { setErr(errorTextOf(e, tx('rfp.loading'))); } }, []);
  useEffect(() => { void run(); }, [run]);
  return (
    <FitDialog title={tx('rfp.health')} subtitle={tx('rfp.healthSub')} onClose={onClose} wide testId="rfp-health-dialog" footer={<><button type="button" className="fk-btn ghost" onClick={run}>{tx('rfp.refresh')}</button><button type="button" className="fk-btn" onClick={onClose}>{tx('rfp.close')}</button></>}>
      {err ? <ErrorRetry message={err} onRetry={run} /> : !h ? <div className="fk-loading">{tx('rfp.loading')}</div> : (<>
        <div className={'fk-chip ' + (h.overall === 'ready' ? 'ok' : h.overall === 'failed' ? 'bad' : 'warn')} data-testid="rfp-health-overall">{tx('rfp.hs.' + h.overall)}</div>
        {prev ? <div className="fk-muted" data-testid="rfp-health-prev">{tx('rfp.healthPrev', { when: fmtDateTime(prev.at), state: tx('rfp.hs.' + prev.overall) })}</div> : null}
        <table className="fk-table"><thead><tr><th>{tx('rfp.h.part')}</th><th>{tx('rfp.h.status')}</th><th>{tx('rfp.h.summary')}</th><th>{tx('rfp.h.fix')}</th></tr></thead>
          <tbody>{h.items.map((i: any) => <tr key={i.key} data-testid={'rfp-h-' + i.key}><td>{tx('rfp.hk.' + i.key)}</td><td><span className={'fk-chip ' + (i.status === 'ready' ? 'ok' : i.status === 'failed' ? 'bad' : 'warn')}>{tx('rfp.hs.' + i.status)}</span></td>
            <td>{i.summary}<div className="fk-muted">{i.evidence}</div></td><td>{i.fix ?? '—'}</td></tr>)}</tbody></table>
        <div className="fk-muted">{tx('rfp.healthNote')}</div></>)}
    </FitDialog>
  );
}

function CodesDialog({ canManage, onClose, onChanged }: { canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const [search, setSearch] = useState(''); const qq = useDebounced(search.trim(), 300);
  const [page, setPage] = useState(1); const [data, setData] = useState<any | null>(null); const [note, setNote] = useState<string | null>(null);
  const [why, setWhy] = useState('');
  const load = useCallback(async () => { try { setData(await posReferralProgramApi.codes({ q: qq || undefined, page, pageSize: 10 })); } catch (e: any) { setNote(errorTextOf(e, tx('rfp.loading'))); } }, [qq, page]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [qq]);
  const toggle = async (c: any) => {
    const to = c.status === 'active' ? 'disabled' : 'active';
    const reason = to === 'disabled' ? why.trim() : null;
    if (to === 'disabled' && (!reason || reason.length < 5)) { setNote(tx('rfp.codes.reasonNeeded')); return; }
    try { await posReferralProgramApi.codeStatus(c.id, { status: to, reason, expectedVersion: c.version }); setNote(null); setWhy(''); await load(); onChanged(); } catch (e: any) { setNote(errorTextOf(e, tx('rfp.actionFailed'))); }
  };
  return (
    <FitDialog title={tx('rfp.codes')} subtitle={tx('rfp.codesSub')} onClose={onClose} wide testId="rfp-codes-dialog" footer={<button type="button" className="fk-btn" onClick={onClose}>{tx('rfp.close')}</button>}>
      <div className="rfp-codes-tools"><input className="fk-input fk-search" type="search" placeholder={tx('rfp.codes.search')} value={search} onChange={(e) => setSearch(e.target.value)} data-testid="rfp-codes-search" />
        {canManage ? <input className="fk-input" value={why} onChange={(e) => setWhy(e.target.value)} placeholder={tx('rfp.codes.reason')} aria-label={tx('rfp.codes.reason')} data-testid="rfp-codes-reason" /> : null}</div>
      {!data ? <div className="fk-loading">{tx('rfp.loading')}</div> : data.items.length === 0 ? <Empty title={tx('rfp.codes.empty')} /> : (
        <table className="fk-table"><thead><tr><th>{tx('rfp.col.code')}</th><th>{tx('rfp.codes.owner')}</th><th>{tx('rfp.col.state')}</th><th>{tx('rfp.codes.created')}</th><th>{tx('rfp.codes.uses')}</th><th></th></tr></thead>
          <tbody>{data.items.map((c: any) => <tr key={c.id} data-testid="rfp-code-row"><td><code>{c.code}</code></td><td>{c.owner.name ?? '—'}</td><td><span className={'fk-chip ' + (c.status === 'active' ? 'ok' : 'mut')}>{tx('rfp.codes.' + c.status)}</span>{c.disabledReason ? <div className="fk-muted">{c.disabledReason}</div> : null}</td>
            <td>{when(c.createdAt)}</td><td>{nf(c.referrals)}</td><td>{canManage ? <button type="button" className="fk-btn ghost" onClick={() => toggle(c)} data-testid="rfp-code-toggle">{c.status === 'active' ? tx('rfp.codes.disable') : tx('rfp.codes.enable')}</button> : null}</td></tr>)}</tbody></table>)}
      <Pager info={data} onPage={setPage} compact />
      {note ? <div className="fk-hint" role="status">{note}</div> : null}
    </FitDialog>
  );
}

const d$ = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2));
function PolicyDialog({ canManage, onClose, onSaved }: { canManage: boolean; onClose: () => void; onSaved: () => void }) {
  const [p, setP] = useState<any | null>(null); const [f, setF] = useState<any>({}); const [note, setNote] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { posReferralProgramApi.settings().then((x) => { setP(x); setF({ enabled: x.enabled, rewardType: x.rewardType ?? '', rewardPoints: x.rewardPoints ?? '', rewardDollars: x.rewardCents != null ? (x.rewardCents / 100).toFixed(2) : '',
    requiresApproval: x.requiresApproval, separationOfDuties: x.separationOfDuties, minDollars: (x.minQualifyingSpendCents / 100).toFixed(2), windowDays: x.qualificationWindowDays ?? '', graceHours: x.recordGraceHours,
    friendDollars: d$(x.friendRewardCents), referrerDollars: d$(x.referrerRewardCents), vMinDollars: d$(x.voucherMinSpendCents ?? 0), vDays: x.voucherExpiryDays ?? 90, budgetDollars: d$(x.budgetTotalCents), monthlyDollars: d$(x.budgetMonthlyCents),
    perRef: x.perReferrerCap ?? '', warnPct: x.budgetWarnPercent ?? 80 }); }).catch((e) => setNote(errorTextOf(e, tx('rfp.loading')))); }, []);
  const set = (k: string, v: unknown) => setF((o: any) => ({ ...o, [k]: v }));
  const save = async () => {
    setBusy(true); setNote(null);
    const cents = (s: string) => (s === '' ? null : Math.round(Number(s) * 100));
    try {
      await posReferralProgramApi.saveSettings({ enabled: !!f.enabled, rewardType: f.rewardType || null, rewardPoints: f.rewardType === 'loyalty_points' && f.rewardPoints !== '' ? Number(f.rewardPoints) : null,
        rewardCents: f.rewardType === 'cash_payout' ? cents(String(f.rewardDollars)) : null, requiresApproval: !!f.requiresApproval, separationOfDuties: !!f.separationOfDuties,
        minQualifyingSpendCents: cents(String(f.minDollars)) ?? 0, qualificationWindowDays: f.windowDays === '' ? null : Number(f.windowDays), recordGraceHours: Number(f.graceHours), expectedVersion: p.version,
        ...(f.rewardType === 'salon_voucher' ? { friendRewardCents: cents(String(f.friendDollars)), referrerRewardCents: cents(String(f.referrerDollars)), voucherMinSpendCents: cents(String(f.vMinDollars)) ?? 0,
          voucherExpiryDays: Number(f.vDays), budgetTotalCents: cents(String(f.budgetDollars)), budgetMonthlyCents: cents(String(f.monthlyDollars)), perReferrerCap: f.perRef === '' ? null : Number(f.perRef), budgetWarnPercent: Number(f.warnPct) } : {}) });
      onSaved(); onClose();
    } catch (e: any) { setNote(errorTextOf(e, tx('rfp.actionFailed'))); } finally { setBusy(false); }
  };
  return (
    <FitDialog title={tx('rfp.policy')} subtitle={p ? tx('rfp.policySub', { v: String(p.version) }) : undefined} onClose={onClose} busy={busy} testId="rfp-policy-dialog"
      footer={<><button type="button" className="fk-btn ghost" onClick={onClose}>{tx('rfp.close')}</button>{canManage ? <button type="button" className="fk-btn" onClick={save} disabled={busy || !p} data-testid="rfp-policy-save">{tx('rfp.save')}</button> : null}</>}>
      {!p ? <div className="fk-loading">{tx('rfp.loading')}</div> : (<div className="rfp-policy">
        <div className="fk-hint">{tx('rfp.policyNote')}</div>
        <label className="fk-check"><input type="checkbox" checked={!!f.enabled} disabled={!canManage} onChange={(e) => set('enabled', e.target.checked)} data-testid="rfp-pol-enabled" /> {tx('rfp.pol.enabled')}</label>
        <label className="fk-field"><span>{tx('rfp.pol.rewardType')}</span><select className="fk-select" value={f.rewardType} disabled={!canManage} onChange={(e) => set('rewardType', e.target.value)} data-testid="rfp-pol-type">
          <option value="">{tx('rfp.pol.none')}</option><option value="loyalty_points">{tx('rfp.rewardType.loyalty_points')}</option><option value="cash_payout">{tx('rfp.rewardType.cash_payout')}</option><option value="salon_voucher">{tx('rfp.rewardType.salon_voucher')}</option></select></label>
        {f.rewardType === 'loyalty_points' ? <label className="fk-field"><span>{tx('rfp.pol.points')}</span><input className="fk-input" inputMode="numeric" value={f.rewardPoints} disabled={!canManage} onChange={(e) => set('rewardPoints', e.target.value.replace(/\D/g, ''))} data-testid="rfp-pol-points" /></label> : null}
        {f.rewardType === 'cash_payout' ? <><label className="fk-field"><span>{tx('rfp.pol.cash')}</span><input className="fk-input" inputMode="decimal" value={f.rewardDollars} disabled={!canManage} onChange={(e) => set('rewardDollars', e.target.value)} /></label><div className="fk-hint warn">{tx('rfp.pol.cashBlocked')}</div></> : null}
        {f.rewardType === 'salon_voucher' ? <div className="rfp-voucher" data-testid="rfp-pol-voucher">
          <div className="fk-hint">{tx('rfp.pol.voucherNote')}</div>
          {([['friendDollars', 'rfp.pol.friend', 'decimal'], ['referrerDollars', 'rfp.pol.referrer', 'decimal'], ['vMinDollars', 'rfp.pol.vMin', 'decimal'], ['vDays', 'rfp.pol.vDays', 'numeric'],
            ['budgetDollars', 'rfp.pol.budget', 'decimal'], ['monthlyDollars', 'rfp.pol.monthly', 'decimal'], ['perRef', 'rfp.pol.perRef', 'numeric'], ['warnPct', 'rfp.pol.warnPct', 'numeric']] as const).map(([k2, label, mode]) => (
            <label key={k2} className="fk-field"><span>{tx(label)}</span><input className="fk-input" inputMode={mode} value={f[k2]} disabled={!canManage}
              onChange={(e) => set(k2, mode === 'numeric' ? e.target.value.replace(/\D/g, '') : e.target.value)} placeholder={k2 === 'monthlyDollars' || k2 === 'perRef' ? tx('rfp.pol.noLimit') : undefined} data-testid={`rfp-pol-${k2}`} /></label>))}
        </div> : null}
        <label className="fk-check"><input type="checkbox" checked={!!f.requiresApproval} disabled={!canManage} onChange={(e) => set('requiresApproval', e.target.checked)} data-testid="rfp-pol-approval" /> {tx('rfp.pol.approval')}</label>
        <label className="fk-check"><input type="checkbox" checked={!!f.separationOfDuties} disabled={!canManage} onChange={(e) => set('separationOfDuties', e.target.checked)} /> {tx('rfp.pol.sod')}</label>
        <label className="fk-field"><span>{tx('rfp.pol.minSpend')}</span><input className="fk-input" inputMode="decimal" value={f.minDollars} disabled={!canManage} onChange={(e) => set('minDollars', e.target.value)} /></label>
        <label className="fk-field"><span>{tx('rfp.pol.window')}</span><input className="fk-input" inputMode="numeric" value={f.windowDays} disabled={!canManage} onChange={(e) => set('windowDays', e.target.value.replace(/\D/g, ''))} placeholder={tx('rfp.pol.noLimit')} /></label>
        <label className="fk-field"><span>{tx('rfp.pol.grace')}</span><input className="fk-input" inputMode="numeric" value={f.graceHours} disabled={!canManage} onChange={(e) => set('graceHours', e.target.value.replace(/\D/g, ''))} /></label>
        {note ? <div className="fk-hint" role="status" data-testid="rfp-pol-note">{note}</div> : null}
      </div>)}
    </FitDialog>
  );
}

function AssistantDialog({ onClose, onOpenCampaigns }: { onClose: () => void; onOpenCampaigns: () => void }) {
  const [goal, setGoal] = useState<string>('existing_refer_friends'); const [channel, setChannel] = useState<'sms' | 'email'>('sms');
  const [plan, setPlan] = useState<any | null>(null); const [saved, setSaved] = useState<any | null>(null); const [note, setNote] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [key] = useState(requestId());
  const preview = async () => { setBusy(true); setNote(null); setSaved(null); try { setPlan(await posReferralProgramApi.plan({ goal, channel })); } catch (e: any) { setNote(errorTextOf(e, tx('rfp.actionFailed'))); } finally { setBusy(false); } };
  const save = async () => { setBusy(true); setNote(null); try { setSaved(await posReferralProgramApi.save({ goal, channel, message: plan?.proposal?.message, idempotencyKey: key })); } catch (e: any) { setNote(errorTextOf(e, tx('rfp.actionFailed'))); } finally { setBusy(false); } };
  return (
    <FitDialog title={tx('rfp.assistant')} subtitle={tx('rfp.asst.sub')} onClose={onClose} busy={busy} wide testId="rfp-assistant-dialog"
      footer={<><button type="button" className="fk-btn ghost" onClick={onClose}>{tx('rfp.close')}</button>
        <button type="button" className="fk-btn ghost" onClick={preview} disabled={busy} data-testid="rfp-asst-preview">{tx('rfp.asst.preview')}</button>
        {plan?.audience && !saved ? <button type="button" className="fk-btn" onClick={save} disabled={busy} data-testid="rfp-asst-save">{tx('rfp.asst.save')}</button> : null}
        {saved ? <button type="button" className="fk-btn" onClick={onOpenCampaigns} data-testid="rfp-asst-campaigns">{tx('rfp.asst.openCampaigns')}</button> : null}</>}>
      <div className="fk-hint">{tx('rfp.asst.guard')}</div>
      <div className="rfp-asst-form">
        <label className="fk-field"><span>{tx('rfp.asst.goal')}</span><select className="fk-select" value={goal} onChange={(e) => { setGoal(e.target.value); setPlan(null); }} data-testid="rfp-asst-goal">{GOALS.map((g) => <option key={g} value={g}>{tx('rfp.goal.' + g)}</option>)}</select></label>
        <label className="fk-field"><span>{tx('rfp.asst.channel')}</span><select className="fk-select" value={channel} onChange={(e) => { setChannel(e.target.value === 'email' ? 'email' : 'sms'); setPlan(null); }}><option value="sms">{tx('px.ch.sms')}</option><option value="email">{tx('pos.email')}</option></select></label>
      </div>
      {plan ? <div className="rfp-asst-plan" data-testid="rfp-asst-plan">
        <dl className="rfp-dl"><dt>{tx('rfp.perf.recorded')}</dt><dd>{nf(plan.metrics.referralsRecorded)}</dd><dt>{tx('rfp.perf.qualified')}</dt><dd>{nf(plan.metrics.qualifiedVisits)}</dd>
          <dt>{tx('rfp.perf.issued')}</dt><dd>{nf(plan.metrics.rewardsIssued)}</dd><dt>{tx('rfp.perf.revenue')}</dt><dd>{fmtMoney(plan.metrics.associatedRevenueCents)}</dd>
          <dt>{tx('rfp.asst.invites')}</dt><dd>{plan.metrics.invitationsSent ?? tx('rfp.asst.notMeasured')}</dd></dl>
        {plan.audience ? <div data-testid="rfp-asst-audience">{tx('rfp.asst.audience', { sel: nf(plan.audience.selected), elig: nf(plan.audience.eligible), exc: nf(plan.audience.excluded) })}
          {Object.keys(plan.audience.excludedReasons).length ? <div className="fk-muted">{Object.entries(plan.audience.excludedReasons).map(([k2, v]) => `${statusLabel('state', k2)}: ${v}`).join(' · ')}</div> : null}</div> : null}
        {plan.proposal ? <><div className="rfp-asst-msg"><b>{tx('rfp.asst.message')}</b><p>{plan.proposal.message}</p></div><div className="fk-muted">{plan.liability?.note}</div><div className="fk-muted">{plan.estimate?.note}</div></> : null}
        <div className="fk-hint">{plan.guard}</div>
      </div> : null}
      {saved ? <div className="fk-hint ok" role="status" data-testid="rfp-asst-saved">{tx('rfp.asst.saved', { n: nf(saved.eligibleCount ?? saved.eligible ?? saved.summary?.eligible) })}</div> : null}
      {note ? <div className="fk-hint" role="status">{note}</div> : null}
    </FitDialog>
  );
}
