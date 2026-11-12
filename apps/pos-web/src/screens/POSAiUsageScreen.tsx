// POSAiUsageScreen.tsx — AI Center → AI Usage & Limits (/tenant/ai/usage). AI Usage & Limits Complete Build Guide (Oct 30
// 2026): ONE full-screen overview that fits the POS content area at 100 % zoom — compact title · four summary metrics
// (Total Packages · Active Subscriptions · Trials / Pending · Verified Monthly Cost) · the 80/90/100 % alert strip · one
// search / status / category / sort toolbar · a 4 × 2 (3 × 2 / 2 × 2 on narrower widths) card grid · numbered pages.
// Everything detailed lives in overlays: Package Details (one click on a card; Overview · Subscription · Usage · Billing ·
// History · Settings), the cost breakdown, and Usage History (calendar, filters, pages, audited CSV).
// Truthfulness (guide §7): states come from the server (`/tenant/ai/usage-screen`) — a lapsed trial is "Trial expired"
// with no Cancel, Cancelled has no Cancel, Past due is never a healthy renewal, Disabled by admin never suggests that an
// upgrade restores it. Units are never mixed; unlimited / not-metered show no invented percentage. Paid upgrades and
// reactivation are not self-serve here — they open Billing; this page never charges a card.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posAiUsageScreenApi } from '../api/posAiUsageApi';
import { errorTextOf } from '../i18n/error-text';
import { fmtMoney, fmtNumber, fmtInZone } from '../i18n/format';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry, requestId, useDebounced, downloadText, type PageInfo } from '../components/FitKit';
import { PeriodBar, periodQuery, type PeriodState, type ServerPeriod } from '../components/FinanceKit';
import { TENANT_NAV, EXISTING_ROUTES } from '../shell/tenant-nav';
import { useCan } from '../components/usePermissions';
import { InvoicedFigures, InvoiceTable, BranchSettings } from './aiUsageRound2';
import { statusLabel } from '../i18n/status-label';
import { codeLabel } from '../components/peopleLabels';

type State = 'available' | 'trial_available' | 'trialing' | 'trial_expired' | 'active' | 'cancelled' | 'expired' | 'past_due' | 'suspended' | 'disabled_by_admin' | 'unable_to_verify';
type Level = 'ok' | 'warn_80' | 'critical_90' | 'exhausted_100' | 'unlimited' | 'not_metered' | 'unknown';
type Action = 'view_details' | 'start_trial' | 'cancel' | 'upgrade' | 'reactivate' | 'update_billing' | 'open_module';
export type Card = { code: string; name: string; description: string; category: string; posArea: string | null; known: boolean; state: State; storedStatus: string | null; globallyEnabled: boolean; disabledReason: string | null;
  price: { cents: number; currency: string; period: 'monthly' | 'yearly'; monthlyEquivalentCents: number; source: 'subscription' | 'catalog_list' };
  usage: { used: number | null; limit: number; unit: string; percent: number | null; level: Level; periodStart: string | null; periodEnd: string | null; remaining: number | null;
    /** extras AI Usage Limits 03: the server's estimate of the period's end at this period's pace (never a purchase) */
    projection?: { basis: string; elapsedShare: number; projectedUsed: number | null; verdict: 'too_early' | 'fits' | 'close' | 'likely_over'; projectedOverageCents: number | null; atLimit: 'overage' | 'blocked' } | null };
  overage: { enabled: boolean; unitPriceCents: number; estimatedCents: number };
  trial: { days: number; startsAt: string | null; endsAt: string | null; daysLeft: number | null; eligible: boolean };
  lastPaymentStatus: string | null; subscribedAt: string | null; cancelledAt: string | null; actions: Action[]; primaryAction: Action; openAlert: number | null };
type Summary = { asOf: string; kpis: { totalPackages: number; activeSubscriptions: number; pastDue: number; trialsAndPending: number; trialing: number; trialExpired: number; disabled: number };
  cost: { visible: false } | { visible: true; currency: string; recurringMonthlyCents: number; estimatedOverageCents: number; basis: 'reconciled' | 'subscription_records' | 'no_paid_packages';
    lines: { code: string; name: string; cents: number; period: string; monthlyEquivalentCents: number; state: State; paidThisPeriod: boolean; provider: string | null }[];
    trials: { code: string; name: string; endsAt: string | null; afterTrialCents: number; period: string }[]; overageLines: { code: string; name: string; cents: number; over: number; unit: string }[];
    lastBillingEventAt: string | null; billingEvents: number; invoiced?: Invoiced | null };
  alerts: { id: string; code: string; name: string; threshold: number; used: number; limit: number; unit: string; periodStart: string | null; at: string | null }[]; canManage: boolean; canSeeBilling: boolean };
type ListResp = PageInfo & { items: Card[]; counts: Record<string, number>; sort: string; status: string };
// AI-01 (Four-Module guide §11): the provider-invoice figures, kept apart — never one standing in for another
type Amounts = { invoices: number; finalizedInvoices: number; draftInvoices: number; finalizedCents: number | null; finalizedTotalUnknown: boolean; paidCents: number; refundedCents: number;
  outstandingCents: number | null; taxCents: number | null; taxState: 'provided' | 'pending' | 'unknown' | 'none'; prorationCents: number; discountsAndCreditsCents: number; from: string | null };
type Invoice = { id: string; provider: string; number: string | null; reference: string | null; status: string; finalized: boolean; date: string | null; periodStart: string | null; periodEnd: string | null;
  subtotalCents: number | null; prorationCents: number; taxCents: number | null; taxState: string; discountCents: number; creditCents: number; totalCents: number | null; paidCents: number; refundedCents: number; dueCents: number | null };
type Invoiced = { recurringCents: number; estimate: { cents: number; assumptions: string[] }; currentPeriod: Amounts; outstandingAllCents: number | null; invoices: Invoice[];
  lastRun: { status: string; seen: number; created: number; updated: number; unchanged: number; stale: number; rejected: number; errorCode: string | null; at: string | null } | null;
  providerConfigured: boolean; canReconcile: boolean };

const STATUSES = ['all', 'active', 'trialing', 'trial_expired', 'cancelled', 'past_due', 'disabled', 'available'] as const;
const CATEGORIES = ['front_desk', 'operations', 'growth', 'finance', 'insights', 'unknown'] as const;
const SORTS = ['catalog', 'name', 'newest', 'usage', 'cost'] as const;
const nf = (n: number) => fmtNumber(n || 0);
const day = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric' }) || '—' : '—');
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) || '—' : '—');
const unitLabel = (u: string, n?: number) => tx('aiu.unit.' + u, { n: nf(n ?? 0) });
export const stateLabel = (s: string) => tx('aiu.state.' + s);
const STATE_TONE: Record<string, string> = { active: 'ok', trialing: 'info', trial_available: 'gold', available: 'mut', trial_expired: 'warn', cancelled: 'mut', expired: 'mut', past_due: 'bad', suspended: 'bad', disabled_by_admin: 'mut', unable_to_verify: 'warn' };
const LEVEL_TONE: Record<string, string> = { warn_80: 'warn', critical_90: 'bad', exhausted_100: 'bad' };
// a 403 reads as a permission message, never the server's raw word ("forbidden") — Nov 2 2026
const errText = (e: unknown, fb: string) => ((e as { status?: number } | null)?.status === 403 || (e as { code?: string } | null)?.code === 'PERMISSION_DENIED' ? tx('pos.you_do_not_have_permission_for_7x5k') : errorTextOf(e, fb));
const priceText = (c: Card) => c.price.cents > 0 ? `${fmtMoney(c.price.cents)}${c.price.period === 'yearly' ? tx('aiu.perYear') : tx('aiu.perMonth')}` : tx('aiu.included');
/** the AI module's own page — from the shell's navigation (the same routes the sidebar opens) */
const FALLBACK_ROUTES: Record<string, string> = { ai_customer_profile_assistant: '/tenant/ai/customer-profile', ai_phone_call_assistant: '/tenant/ai/receptionist' };
export function moduleRouteOf(code: string): string | null {
  for (const sec of TENANT_NAV) for (const it of sec.items ?? []) if (it.aiPackageCode === code && it.route) return it.route;
  const f = FALLBACK_ROUTES[code]; return f && EXISTING_ROUTES.has(f) ? f : null;
}
/** columns that fit the grid's actual CSS width (guide §4: 4 × 2 only when it truly fits; 3 / 2 / 1 otherwise) */
function useGridCols() {
  const ref = useRef<HTMLDivElement | null>(null); const [cols, setCols] = useState(4);
  useEffect(() => {
    const el = ref.current; if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => { const w = e?.contentRect.width ?? 0; setCols(w >= 1180 ? 4 : w >= 860 ? 3 : w >= 560 ? 2 : 1); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  return { ref, cols };
}

export function POSAiUsageScreen() {
  const nav = useNavigate();
  const can = useCan();
  const [sum, setSum] = useState<Summary | null>(null); const [sumErr, setSumErr] = useState<unknown>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const loadSummary = useCallback(() => { setSumErr(null); posAiUsageScreenApi.summary().then(setSum).catch(setSumErr); }, []);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  const [search, setSearch] = useState(''); const q = useDebounced(search, 300);
  // AI Plans' five tabs (SUNMI addendum, Nov 8 2026) open this screen at a view: ?view=catalog | subscriptions | billing | usage
  const [params] = useSearchParams(); const view = params.get('view');
  const [status, setStatus] = useState<string>(view === 'subscriptions' ? 'active' : 'all'); const [category, setCategory] = useState(''); const [sort, setSort] = useState('catalog');
  useEffect(() => {
    const target = view === 'catalog' || view === 'subscriptions' ? 'aiu-packages' : null;   // billing: the cost & invoices dialog (below)
    if (!target) return;
    let tries = 0; const id = setInterval(() => { const el = document.querySelector(`[data-testid="${target}"]`); if (el || ++tries > 40) { clearInterval(id); el?.scrollIntoView?.({ block: 'start' }); } }, 100);
    return () => clearInterval(id);
  }, [view]);
  const [page, setPage] = useState(1);
  const grid = useGridCols(); const pageSize = grid.cols * 2;
  const [list, setList] = useState<ListResp | null>(null); const [listErr, setListErr] = useState<unknown>(null);
  const [reload, setReload] = useState(0); const seq = useRef(0);
  useEffect(() => {
    const my = ++seq.current; setListErr(null);
    posAiUsageScreenApi.packages({ q: q.trim() || undefined, status: status !== 'all' ? status : undefined, category: category || undefined, sort, page, pageSize })
      .then((d: ListResp) => { if (my !== seq.current) return; setList(d); if (d.page !== page) setPage(d.page); })
      .catch((e) => { if (my === seq.current) setListErr(e); });
  }, [q, status, category, sort, page, pageSize, reload]);
  useEffect(() => { setPage(1); }, [q, status, category, sort]);
  const refresh = () => { loadSummary(); setReload((n) => n + 1); };
  const clear = () => { setSearch(''); setStatus('all'); setCategory(''); setSort('catalog'); };

  const [dlg, setDlg] = useState<null | { kind: 'detail'; code: string } | { kind: 'cost' } | { kind: 'history'; code?: string }>(null);
  const k = sum?.kpis; const cost = sum?.cost;
  const openCard = (c: Card) => setDlg({ kind: 'detail', code: c.code });
  const runPrimary = (c: Card) => {
    const a = c.primaryAction;
    if (a === 'open_module') { const r = moduleRouteOf(c.code); if (r) nav(r); else openCard(c); return; }
    if (a === 'upgrade' || a === 'reactivate' || a === 'update_billing') { nav('/tenant/account/subscription'); return; }
    openCard(c);   // start trial / view details → the details overlay holds the confirmation
  };
  const [allAlerts, setAllAlerts] = useState(false);
  const ack = async (id: string) => { try { await posAiUsageScreenApi.acknowledge(id); loadSummary(); setReload((n) => n + 1); } catch (e) { setNote({ tone: 'bad', text: errText(e, tx('aiu.ackFailed')) }); } };
  const filtered = !!(search || status !== 'all' || category || sort !== 'catalog');
  // AI Usage Limits guide (Nov 1 2026): Check AI Usage & Subscriptions — read-only evidence for what this page shows
  const [health, setHealth] = useState<any | 'loading' | null>(null);
  const runCheck = () => { setHealth('loading'); posAiUsageScreenApi.check().then(setHealth).catch((e) => setHealth({ error: errText(e, tx('aiu.loadFailed')) })); };

  return (
    <div className="work fit aiu" data-testid="ai-usage-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.ai_usage_limits')}</h1><div className="sub">{tx('aiu.subtitle')}</div></div>
        <div className="fk-head-actions">
          <span className="fk-hint aiu-asof" title={sum ? when(sum.asOf) : undefined}>{sum ? tx('aiu.asOf', { t: when(sum.asOf) }) : ''}</span>
          <button type="button" className="fk-btn ghost" onClick={refresh} data-testid="aiu-refresh">{tx('aiu.refresh')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => setDlg({ kind: 'history' })} data-testid="aiu-open-history">{tx('aiu.history')}</button>
          <button type="button" className="fk-btn primary" onClick={runCheck} data-testid="aiu-check">{tx('aiux.check')}</button>
        </div>
      </header>
      {health ? <FitDialog wide testId="aiu-health" title={tx('aiux.check')} onClose={() => setHealth(null)}
        subtitle={health !== 'loading' && !health.error ? tx('aiux.overall', { s: tx('aiux.state.' + health.overall), at: when(health.checkedAt) }) : undefined}
        footer={<button type="button" className="fk-btn ghost" onClick={() => setHealth(null)}>{tx('pos.close')}</button>}>
        {health === 'loading' ? <div className="state">{tx('aiux.running')}</div> : health.error ? <div className="err" role="alert">{health.error}</div> : <>
          <p className="sub">{tx('aiux.readOnly')}{health.reused ? ` ${tx('aiux.recent')}` : ''}</p>
          {health.checks.map((x: any) => <div key={x.key} className="rvw-check" data-testid={`chk-${x.key}`}>
            <div><span className={'chip ' + (x.state === 'FAILED' ? 'bad' : x.state === 'WARNING' ? 'warn' : x.state === 'PASSED' ? 'ok' : '')}>{tx('aiux.state.' + x.state)}</span> <b>{tx('aiux.k.' + x.key)}</b>{x.count ? <span className="sub"> · {fmtNumber(x.count)}</span> : null}</div>
            <div className="sub">{tx('aiux.d.' + x.key + '.' + x.state)}</div></div>)}
        </>}
      </FitDialog> : null}
      {note ? <div className={'fk-note ' + note.tone} role="status"><span>{note.text}</span><button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></div> : null}

      <div className="fk-kpis" data-testid="aiu-kpis">
        {sumErr ? <ErrorRetry message={errText(sumErr, tx('aiu.loadFailed'))} onRetry={loadSummary} /> : <>
          <KpiCard testId="aiu-kpi-active" label={tx('aiu.kpi.active')} loading={!k} tone="ok" value={k ? nf(k.activeSubscriptions) : ''} sub={k ? (k.pastDue ? tx('aiu.kpi.activeSubPastDue', { n: nf(k.pastDue) }) : tx('aiu.kpi.activeSub')) : ''} onClick={() => setStatus('active')} />
          <KpiCard testId="aiu-kpi-cost" label={tx('aiu.kpi.cost')} loading={!sum} tone="gold"
            value={!cost ? '' : !cost.visible ? tx('aiu.restricted') : `${fmtMoney(cost.recurringMonthlyCents)}`}
            sub={!cost ? '' : !cost.visible ? tx('aiu.kpi.costRestricted') : tx('aiu.basis.' + cost.basis)} onClick={cost?.visible ? () => setDlg({ kind: 'cost' }) : undefined} />
          <KpiCard testId="aiu-kpi-total" label={tx('aiu.kpi.total')} loading={!k} value={k ? nf(k.totalPackages) : ''} sub={tx('aiu.kpi.totalSub')} onClick={() => { clear(); }} />
          <KpiCard testId="aiu-kpi-trials" label={tx('aiu.kpi.trials')} loading={!k} tone={k && k.trialsAndPending ? 'warn' : undefined} value={k ? nf(k.trialsAndPending) : ''}
            sub={k ? tx('aiu.kpi.trialsSub', { t: nf(k.trialing), e: nf(k.trialExpired), p: nf(k.pastDue) }) : ''} onClick={() => setStatus('trialing')} />
        </>}
      </div>

      {sum && sum.alerts.length ? (
        <div className={'aiu-alerts' + (allAlerts ? ' all' : '')} role="status" aria-live="polite" data-testid="aiu-alerts">
          {sum.alerts.slice(0, allAlerts ? undefined : 1).map((a) => (
            <div key={a.id} className={'aiu-alert t' + a.threshold}>
              <b>{a.threshold}%</b>
              <span className="aiu-alert-t">{tx(a.threshold >= 100 ? 'aiu.alert.100' : a.threshold >= 90 ? 'aiu.alert.90' : 'aiu.alert.80', { name: a.name, used: nf(a.used), limit: unitLabel(a.unit, a.limit), left: nf(Math.max(0, a.limit - a.used)) })}</span>
              <button type="button" className="fk-link" onClick={() => setDlg({ kind: 'detail', code: a.code })}>{tx('aiu.viewDetails')}</button>
              <button type="button" className="fk-btn ghost sm" onClick={() => ack(a.id)} data-testid="aiu-ack">{tx('aiu.ack')}</button>
            </div>
          ))}
          {sum.alerts.length > 1 ? <button type="button" className="fk-link aiu-more" onClick={() => setAllAlerts((v) => !v)} aria-expanded={allAlerts} data-testid="aiu-more-alerts">{allAlerts ? tx('aiu.fewerAlerts') : tx('aiu.moreAlerts', { n: nf(sum.alerts.length - 1) })}</button> : null}
        </div>
      ) : <div className="aiu-alerts empty" aria-hidden />}

      <div className="aiu-toolbar" role="toolbar" aria-label={tx('aiu.toolbar')}>
        <input type="search" className="fk-search" aria-label={tx('aiu.search')} placeholder={tx('aiu.search')} value={search} onChange={(e) => setSearch(e.target.value)} data-testid="aiu-search" />
        <div className="fk-seg aiu-status" role="group" aria-label={tx('aiu.statusFilter')}>
          {STATUSES.map((s) => <button type="button" key={s} className={status === s ? 'on' : ''} aria-pressed={status === s} onClick={() => setStatus(s)} data-testid={'aiu-status-' + s}>
            {tx('aiu.filter.' + s)}{list?.counts ? <span className="aiu-n">{nf(list.counts[s] ?? 0)}</span> : null}</button>)}
        </div>
        <select className="fk-select" aria-label={tx('aiu.category')} value={category} onChange={(e) => setCategory(e.target.value)} data-testid="aiu-category">
          <option value="">{tx('aiu.cat.all')}</option>{CATEGORIES.map((c) => <option key={c} value={c}>{tx('aiu.cat.' + c)}</option>)}
        </select>
        <select className="fk-select" aria-label={tx('aiu.sort')} value={sort} onChange={(e) => setSort(e.target.value)} data-testid="aiu-sort">
          {SORTS.map((s) => <option key={s} value={s}>{tx('aiu.sort.' + s)}</option>)}
        </select>
        {filtered ? <button type="button" className="fk-link" onClick={clear} data-testid="aiu-clear">{tx('pos.clear_all')}</button> : null}
      </div>

      <section className="aiu-grid-wrap fk-panel" data-testid="aiu-packages" aria-label={tx('aiu.packages')}>
        <div className={'aiu-grid c' + grid.cols} ref={grid.ref}>
          {listErr ? <ErrorRetry message={errText(listErr, tx('aiu.loadFailed'))} onRetry={() => setReload((n) => n + 1)} />
            : !list ? Array.from({ length: pageSize }).map((_, i) => <div key={i} className="aiu-card skel" aria-hidden />)
            : list.items.length === 0 ? <Empty title={tx('aiu.noMatch')}>{filtered ? <button type="button" className="fk-btn ghost" onClick={clear}>{tx('pos.clear_all')}</button> : null}</Empty>
            : list.items.map((c) => <PackageCard key={c.code} c={c} onOpen={() => openCard(c)} onPrimary={() => runPrimary(c)} />)}
        </div>
        <div className="aiu-foot"><Pager info={list} onPage={setPage} label={tx('aiu.packages')} /><span className="fk-hint">{list ? tx('aiu.sortNote', { s: tx('aiu.sort.' + list.sort) }) : ''}</span></div>
      </section>

      {dlg?.kind === 'detail' ? <DetailDialog code={dlg.code} onClose={() => setDlg(null)} onChanged={(text) => { setNote({ tone: 'ok', text }); refresh(); }}
        openHistory={(code) => setDlg({ kind: 'history', code })} openModule={(r) => nav(r)} openBilling={() => nav('/tenant/account/subscription')} /> : null}
      {/* AI Plans → Billing History: open the cost & invoices dialog once the summary is here (only when the role may see cost) */}
      <BillingDeepLink open={view === 'billing' && !!cost?.visible} onOpen={() => setDlg({ kind: 'cost' })} />
      {dlg?.kind === 'cost' && cost?.visible ? <CostDialog cost={cost} onClose={() => setDlg(null)} openPackage={(code) => setDlg({ kind: 'detail', code })} /> : null}
      {dlg?.kind === 'history' ? <HistoryDialog initialCode={dlg.code} canExport={can('reports.export') || can('subscription.manage')} onClose={() => setDlg(null)} /> : null}
    </div>
  );
}

/** one card: the whole non-control surface opens Details (Enter / Space too); the primary button keeps its own action */
function PackageCard({ c, onOpen, onPrimary }: { c: Card; onOpen: () => void; onPrimary: () => void }) {
  const key = (e: KeyboardEvent<HTMLDivElement>) => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } };
  const u = c.usage;
  const bar = u.percent != null ? Math.min(100, u.percent) : null;
  return (
    <div className={'aiu-card s-' + c.state} role="button" tabIndex={0} onClick={onOpen} onKeyDown={key} data-testid="aiu-card" data-code={c.code}
      aria-label={tx('aiu.cardAria', { name: c.name, state: stateLabel(c.state) })}>
      <div className="aiu-card-h">
        <div className="aiu-card-t"><b>{c.name}</b><span>{tx('aiu.cat.' + c.category)}</span></div>
        <span className={'fk-chip ' + (STATE_TONE[c.state] ?? 'mut')} data-testid="aiu-state">{stateLabel(c.state)}</span>
      </div>
      <p className="aiu-desc">{c.known ? c.description : tx('aiu.unknownPackage', { code: c.code })}</p>
      <div className="aiu-line"><span>{priceText(c)}</span>
        <span className="aiu-usage" data-testid="aiu-usage">{u.level === 'not_metered' ? <span className="fk-muted">{tx('aiu.notMetered')}</span>
          : u.level === 'unknown' ? <span className="fk-muted">{tx('aiu.usageUnknown')}</span>
          : u.level === 'unlimited' ? tx('aiu.unlimited', { used: unitLabel(u.unit, u.used ?? 0) })
          : <>{nf(u.used ?? 0)} / {unitLabel(u.unit, u.limit)}{u.percent != null ? ` · ${u.percent}%` : ''}</>}</span></div>
      <div className="aiu-bar" aria-hidden>{bar != null ? <i className={LEVEL_TONE[u.level] ?? ''} style={{ width: `${bar}%` }} /> : null}</div>
      <div className="aiu-meta">
        {u.level === 'exhausted_100' || u.level === 'critical_90' || u.level === 'warn_80' ? <span className={'aiu-lv ' + LEVEL_TONE[u.level]} role="status">{tx('aiu.level.' + u.level)}</span> : null}
        <span className="fk-hint">{c.state === 'trialing' && c.trial.daysLeft != null ? tx('aiu.trialLeft', { n: String(c.trial.daysLeft), date: day(c.trial.endsAt) })
          : c.state === 'trial_expired' ? tx('aiu.trialEndedOn', { date: day(c.trial.endsAt) })
          : c.state === 'disabled_by_admin' ? tx('aiu.disabledByAdmin')
          : u.periodEnd ? tx('aiu.resets', { date: day(u.periodEnd) }) : c.state === 'trial_available' ? tx('aiu.trialDays', { n: String(c.trial.days) }) : ''}</span>
      </div>
      <div className="aiu-card-f">
        <button type="button" className={'fk-btn ' + (c.primaryAction === 'view_details' ? 'ghost' : 'primary')} onClick={(e) => { e.stopPropagation(); onPrimary(); }} data-testid="aiu-primary">
          {tx('aiu.action.' + c.primaryAction)}</button>
      </div>
    </div>
  );
}

// ── Package Details (owner priority 3) ──────────────────────────────────────────────────────────────────────────────────
const TABS = ['overview', 'subscription', 'usage', 'billing', 'history', 'settings'] as const;
export function DetailDialog({ code, onClose, onChanged, openHistory, openModule, openBilling }: { code: string; onClose: () => void; onChanged: (t: string) => void; openHistory: (code: string) => void;
  openModule: (route: string) => void; openBilling: () => void }) {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState<unknown>(null); const [tab, setTab] = useState<(typeof TABS)[number]>('overview');
  const [confirm, setConfirm] = useState<null | 'start_trial' | 'cancel'>(null); const [busy, setBusy] = useState(false); const [actErr, setActErr] = useState<string | null>(null);
  const key = useRef(requestId());
  const load = useCallback(() => { setErr(null); posAiUsageScreenApi.detail(code).then(setD).catch(setErr); }, [code]);
  useEffect(() => { load(); }, [load]);
  const c: Card | undefined = d?.package;
  const route = c ? moduleRouteOf(c.code) : null;
  const act = async () => {
    if (!c || !confirm || busy) return; setBusy(true); setActErr(null);
    try {
      if (confirm === 'start_trial') { await posAiUsageScreenApi.startTrial(c.code, { idempotencyKey: key.current, confirm: true }); onChanged(tx('aiu.trialStarted', { name: c.name })); }
      else { await posAiUsageScreenApi.cancel(c.code, { idempotencyKey: key.current, confirm: true, expectedStatus: c.storedStatus }); onChanged(tx('aiu.cancelled', { name: c.name })); }
      setConfirm(null); key.current = requestId(); load();   // re-read the server state after the change
    } catch (e: any) { setActErr(errText(e, tx('aiu.actionFailed'))); key.current = requestId(); if (e?.code === 'AI_STATE_CHANGED' || e?.code === 'AI_ACTION_NOT_ALLOWED') load(); }
    finally { setBusy(false); }
  };
  const max = Math.max(1, ...((d?.usage?.daily ?? []) as Array<{ used: number }>).map((x) => x.used));
  return (
    <FitDialog wide title={c?.name ?? tx('aiu.details')} subtitle={c ? <><span className={'fk-chip ' + (STATE_TONE[c.state] ?? 'mut')}>{stateLabel(c.state)}</span> · {tx('aiu.cat.' + c.category)} · <code>{c.code}</code></> : undefined}
      onClose={onClose} busy={busy} testId="aiu-detail"
      footer={<>
        {c && route && c.actions.includes('open_module') ? <button type="button" className="fk-btn ghost" onClick={() => openModule(route)} data-testid="aiu-open-module">{tx('aiu.action.open_module')}</button> : null}
        {c ? <button type="button" className="fk-btn ghost" onClick={() => openHistory(c.code)}>{tx('aiu.history')}</button> : null}
        {c && (c.actions.includes('upgrade') || c.actions.includes('reactivate') || c.actions.includes('update_billing')) ? <button type="button" className="fk-btn ghost" onClick={openBilling} data-testid="aiu-billing">
          {tx('aiu.action.' + (c.actions.includes('update_billing') ? 'update_billing' : c.actions.includes('reactivate') ? 'reactivate' : 'upgrade'))}</button> : null}
        {c?.actions.includes('cancel') && !confirm ? <button type="button" className="fk-btn ghost danger" onClick={() => { setConfirm('cancel'); setTab('subscription'); }} data-testid="aiu-cancel">{tx('aiu.action.cancel')}</button> : null}
        {c?.actions.includes('start_trial') && !confirm ? <button type="button" className="fk-btn primary" onClick={() => { setConfirm('start_trial'); setTab('subscription'); }} data-testid="aiu-trial">{tx('aiu.action.start_trial')}</button> : null}
        {confirm ? <><button type="button" className="fk-btn ghost" onClick={() => { setConfirm(null); setActErr(null); }} disabled={busy}>{tx('pos.cancel')}</button>
          <button type="button" className={'fk-btn primary' + (confirm === 'cancel' ? ' danger' : '')} onClick={act} disabled={busy} data-testid="aiu-confirm">{busy ? tx('pos.saving_2') : tx('aiu.confirm.' + confirm)}</button></> : null}
        <button type="button" className="fk-btn ghost" onClick={onClose} data-testid="aiu-detail-close">{tx('pos.close')}</button>
      </>}>
      {err ? <ErrorRetry message={errText(err, tx('aiu.loadFailed'))} onRetry={load} /> : !c ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="fk-tabs" role="tablist">{TABS.map((t) => <button type="button" role="tab" key={t} aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} data-testid={'aiu-tab-' + t}>{tx('aiu.tab.' + t)}</button>)}</div>
        {confirm ? <div className={'aiu-confirm ' + confirm} role="alert" data-testid="aiu-confirm-box">
          {confirm === 'start_trial' ? tx('aiu.confirmTrial', { name: c.name, days: String(c.trial.days), price: priceText(c) }) : tx('aiu.confirmCancel', { name: c.name, state: stateLabel(c.state) })}
          {actErr ? <div className="fk-err">{actErr}</div> : null}</div> : null}
        {tab === 'overview' ? <div className="aiu-d">
          <p className="aiu-p">{c.known ? c.description : tx('aiu.unknownPackage', { code: c.code })}</p>
          <dl className="fk-dl"><dt>{tx('aiu.posArea')}</dt><dd>{c.posArea ?? '—'}</dd><dt>{tx('aiu.price')}</dt><dd>{priceText(c)} <span className="fk-muted">· {tx('aiu.priceSource.' + c.price.source)}</span></dd>
            <dt>{tx('aiu.included')}</dt><dd>{c.usage.limit > 0 ? unitLabel(c.usage.unit, c.usage.limit) : tx('aiu.noFixedLimit')}</dd>
            <dt>{tx('aiu.next')}</dt><dd data-testid="aiu-next">{tx('aiu.nextStep.' + c.state)}</dd></dl>
          {route ? null : <div className="fk-hint">{tx('aiu.noModulePage')}</div>}
        </div> : null}
        {tab === 'subscription' ? <dl className="fk-dl aiu-d">
          <dt>{tx('aiu.state')}</dt><dd>{stateLabel(c.state)}{c.storedStatus ? <span className="fk-muted"> · {tx('aiu.stored', { s: c.storedStatus })}</span> : null}</dd>
          <dt>{tx('aiu.plan')}</dt><dd>{c.storedStatus ? `${priceText(c)} · ${tx('aiu.period.' + c.price.period)}` : '—'}</dd>
          <dt>{tx('aiu.trialStart')}</dt><dd>{day(c.trial.startsAt)}</dd><dt>{tx('aiu.trialEnd')}</dt><dd>{day(c.trial.endsAt)}</dd>
          <dt>{tx('aiu.subscribedOn')}</dt><dd>{day(c.subscribedAt)}</dd><dt>{tx('aiu.cancelledOn')}</dt><dd>{day(c.cancelledAt)}</dd>
          <dt>{tx('aiu.lastPayment')}</dt><dd>{c.lastPaymentStatus ?? '—'}</dd>
        </dl> : null}
        {tab === 'subscription' && d.why ? <EntitlementWhy why={d.why} /> : null}
        {tab === 'usage' ? <div className="aiu-d">
          <dl className="fk-dl"><dt>{tx('aiu.used')}</dt><dd>{c.usage.used == null ? tx(c.usage.level === 'unknown' ? 'aiu.usageUnknown' : 'aiu.notMetered') : unitLabel(c.usage.unit, c.usage.used)}</dd>
            <dt>{tx('aiu.limit')}</dt><dd>{c.usage.limit > 0 ? unitLabel(c.usage.unit, c.usage.limit) : tx('aiu.noFixedLimit')}</dd>
            <dt>{tx('aiu.remaining')}</dt><dd>{c.usage.remaining == null ? '—' : unitLabel(c.usage.unit, c.usage.remaining)}</dd>
            <dt>{tx('aiu.periodLabel')}</dt><dd>{c.usage.periodStart ? `${day(c.usage.periodStart)} – ${day(c.usage.periodEnd)}` : '—'}</dd>
            <dt>{tx('aiu.atLimit')}</dt><dd>{c.overage.enabled ? tx('aiu.overageOn', { p: fmtMoney(c.overage.unitPriceCents), u: unitLabel(c.usage.unit, 1) }) : tx('aiu.overageOff')}</dd></dl>
          <div className="fk-hint">{tx('aiu.countsRule')}</div>
          {c.usage.projection ? (() => { const p = c.usage.projection; return (
            <div className={'fk-hint' + (p.verdict === 'likely_over' ? ' warn' : '')} data-testid="aiu-projection">
              <b>{tx('aiu.proj.title')}</b>{' '}
              {p.verdict === 'too_early' || p.projectedUsed == null ? tx('aiu.proj.tooEarly', { pct: fmtNumber(Math.round(p.elapsedShare * 100)) })
                : tx('aiu.proj.' + p.verdict, { n: unitLabel(c.usage.unit, p.projectedUsed), limit: unitLabel(c.usage.unit, c.usage.limit), pct: fmtNumber(Math.round(p.elapsedShare * 100)) })}
              {p.verdict === 'likely_over' ? ' ' + (p.atLimit === 'overage' && p.projectedOverageCents != null ? tx('aiu.proj.overage', { amount: fmtMoney(p.projectedOverageCents) }) : tx('aiu.proj.blocked')) : ''}
              {' '}{tx('aiu.proj.note')}
            </div>); })() : null}
          {d.usage.daily.length ? <div className="aiu-days" data-testid="aiu-daily">{d.usage.daily.map((x: any) => <div key={x.date} title={`${x.date}: ${nf(x.used)}`}><i style={{ height: `${(x.used / max) * 100}%` }} /><span>{x.date.slice(8)}</span></div>)}</div> : null}
          {d.alerts.length ? <ul className="fk-list dense">{d.alerts.map((a: any, i: number) => <li key={i} className="fk-li"><div className="fk-li-main"><span className="fk-li-t">{a.threshold}% · {nf(a.used)} / {unitLabel(a.unit, a.limit)}</span><span className="fk-li-s">{when(a.at)}</span></div>
            {a.acknowledgedAt ? <span className="fk-chip mut">{tx('aiu.acked')}</span> : <span className="fk-chip warn">{tx('aiu.open')}</span>}</li>)}</ul> : null}
        </div> : null}
        {tab === 'billing' ? (!d.billing.visible ? <div className="fk-hint">{tx('aiu.billingRestricted')}</div> : <div className="aiu-d">
          {d.billing.invoiced ? <><InvoicedFigures x={d.billing.invoiced} /><InvoiceTable x={d.billing.invoiced} onReconciled={load} /></> : null}
          <h3 className="fk-h3">{tx('aiu2.billingEvents')}</h3>
          {d.billing.events.length === 0 ? <div className="fk-hint">{tx('aiu.noBilling')}</div>
          : <table className="fk-table"><thead><tr><th>{tx('aiu.when')}</th><th>{tx('aiu.event')}</th><th>{tx('aiu.provider')}</th><th>{tx('aiu.change')}</th></tr></thead>
            <tbody>{d.billing.events.map((b: any, i: number) => <tr key={i}><td>{when(b.at)}</td><td>{statusLabel('aiBilling', b.type)}</td><td>{b.provider ?? '—'}</td><td>{b.from ?? '—'} → {b.to ?? '—'}</td></tr>)}</tbody></table>}</div>) : null}
        {tab === 'history' ? (d.history.length === 0 ? <div className="fk-hint">{tx('aiu.noHistory')}</div>
          : <ul className="fk-list dense" data-testid="aiu-history-list">{d.history.map((h: any, i: number) => <li key={i} className="fk-li"><div className="fk-li-main"><span className="fk-li-t">{statusLabel('aiBilling', h.type)}</span><span className="fk-li-s">{when(h.at)} · {tx('aiu.kind.' + h.kind)}{h.actor ? ` · ${h.actor}` : ''}</span></div>
            {h.from || h.to ? <span className="fk-muted">{h.from ?? '—'} → {h.to ?? '—'}</span> : null}</li>)}</ul>) : null}
        {tab === 'settings' ? <div className="aiu-d"><dl className="fk-dl">
          <dt>{tx('aiu.platform')}</dt><dd>{d.settings.globallyEnabled ? tx('aiu.platformOn') : tx('aiu.platformOff', { r: d.settings.disabledReason ?? '—' })}</dd>
          <dt>{tx('aiu.salonSub')}</dt><dd>{d.settings.storedStatus ?? tx('aiu.none')}</dd>
          <dt>{tx('aiu.limitSource')}</dt><dd>{tx('aiu.limitFrom.' + d.settings.limitSource)}</dd>
          <dt>{tx('aiu.atLimit')}</dt><dd>{d.settings.overageEnabled ? tx('aiu.overageOnShort') : tx('aiu.overageOff')}</dd>
        </dl>
          {d.settings.branches ? <BranchSettings code={c.code} b={d.settings.branches} onSaved={(text) => { onChanged(text); load(); }} /> : null}</div> : null}
      </>}
    </FitDialog>
  );
}

// ── verified monthly cost (owner priority 1) ────────────────────────────────────────────────────────────────────────────
function BillingDeepLink({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  const done = useRef(false);
  useEffect(() => { if (open && !done.current) { done.current = true; onOpen(); } }, [open, onOpen]);
  return null;
}

function CostDialog({ cost, onClose, openPackage }: { cost: Extract<Summary['cost'], { visible: true }>; onClose: () => void; openPackage: (code: string) => void }) {
  return (
    <FitDialog wide title={tx('aiu.kpi.cost')} subtitle={tx('aiu.basis.' + cost.basis)} onClose={onClose} testId="aiu-cost"
      footer={<button type="button" className="fk-btn primary" onClick={onClose}>{tx('pos.close')}</button>}>
      <div className="aiu-cost-total"><b data-testid="aiu-cost-total">{fmtMoney(cost.recurringMonthlyCents)}</b><span>{tx('aiu.recurringMonthly')}</span></div>
      {cost.invoiced ? <InvoicedFigures x={cost.invoiced} /> : null}
      {cost.lines.length === 0 ? <div className="fk-hint">{tx('aiu.noPaid')}</div> : <table className="fk-table" data-testid="aiu-cost-lines"><thead><tr><th>{tx('aiu.package')}</th><th>{tx('aiu.plan')}</th><th className="num">{tx('aiu.monthlyEq')}</th><th>{tx('aiu.paymentThisPeriod')}</th></tr></thead>
        <tbody>{cost.lines.map((l) => <tr key={l.code}><td><button type="button" className="fk-link" onClick={() => openPackage(l.code)}>{l.name}</button>{l.state === 'past_due' ? <span className="fk-chip bad"> {stateLabel('past_due')}</span> : null}</td>
          <td>{fmtMoney(l.cents)} · {tx('aiu.period.' + l.period)}</td><td className="num">{fmtMoney(l.monthlyEquivalentCents)}{l.period === 'yearly' ? <span className="fk-muted"> {tx('aiu.normalized')}</span> : null}</td>
          <td>{l.paidThisPeriod ? tx('aiu.recorded') : <span className="fk-muted">{tx('aiu.notRecorded')}</span>}</td></tr>)}</tbody></table>}
      {cost.trials.length ? <><h3 className="fk-h3">{tx('aiu.trialsNotCost')}</h3><ul className="fk-list dense">{cost.trials.map((tr) => <li key={tr.code} className="fk-li"><div className="fk-li-main"><span className="fk-li-t">{tr.name}</span><span className="fk-li-s">{tx('aiu.afterTrial', { date: day(tr.endsAt), price: fmtMoney(tr.afterTrialCents) })}</span></div></li>)}</ul></> : null}
      {cost.overageLines.length ? <><h3 className="fk-h3">{tx('aiu.overageEst', { s: fmtMoney(cost.estimatedOverageCents) })}</h3><ul className="fk-list dense">{cost.overageLines.map((o) => <li key={o.code} className="fk-li"><span className="fk-li-t">{o.name}</span><span>{unitLabel(o.unit, o.over)} · {fmtMoney(o.cents)}</span></li>)}</ul></> : null}
      <div className="fk-hint">{tx('aiu.costRule')} {cost.lastBillingEventAt ? tx('aiu.lastBillingEvent', { t: when(cost.lastBillingEventAt), n: nf(cost.billingEvents) }) : tx('aiu.noBillingEvents')}</div>
    </FitDialog>
  );
}

// ── Usage History (§15) ────────────────────────────────────────────────────────────────────────────────────────────────
export function HistoryDialog({ initialCode, canExport, onClose }: { initialCode?: string; canExport: boolean; onClose: () => void }) {
  const [period, setPeriod] = useState<PeriodState>({ preset: 'month' }); const [basis, setBasis] = useState('occurred');
  const [code, setCode] = useState(initialCode ?? ''); const [status, setStatus] = useState('all'); const [page, setPage] = useState(1);
  const [d, setD] = useState<any>(null); const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const query = useMemo(() => ({ ...periodQuery(period), basis, packageCode: code || undefined, status: status !== 'all' ? status : undefined }), [period, basis, code, status]);
  const qk = JSON.stringify(query);
  useEffect(() => { setPage(1); }, [qk]);
  useEffect(() => { let alive = true; setErr(null); posAiUsageScreenApi.history({ ...JSON.parse(qk), page, pageSize: 8 }).then((r) => alive && setD(r)).catch((e) => alive && setErr(e)); return () => { alive = false; }; }, [qk, page]);
  const server: ServerPeriod | null = d ? { preset: d.period.preset, from: d.period.from, to: d.period.to, tz: d.period.timeZone, today: d.period.today } : null;
  const doExport = async () => { setBusy(true); setMsg(null); try { const csv = await posAiUsageScreenApi.exportHistory(JSON.parse(qk)); downloadText(`ai-usage-${d?.period.from ?? ''}-to-${d?.period.to ?? ''}.csv`, csv); setMsg(tx('aiu.exported')); } catch (e) { setMsg(errText(e, tx('aiu.exportFailed'))); } finally { setBusy(false); } };
  const PKGS = useMemo(() => [...new Set(((d?.items ?? []) as Array<{ code: string }>).map((r) => r.code))], [d]);
  return (
    <FitDialog wide title={tx('aiu.history')} subtitle={d ? tx('aiu.historySub', { n: nf(d.totalItems), c: nf(d.totalUsedSuccess) }) : undefined} onClose={onClose} busy={busy} testId="aiu-history"
      footer={<><Pager info={d} onPage={setPage} />{canExport ? <button type="button" className="fk-btn ghost" onClick={doExport} disabled={busy} data-testid="aiu-export">{busy ? tx('pos.loading') : tx('aiu.export')}</button> : null}
        <button type="button" className="fk-btn primary" onClick={onClose} data-testid="aiu-history-close">{tx('pos.close')}</button></>}>
      <div className="aiu-hbar">
        <PeriodBar compact value={period} onChange={setPeriod} server={server} basis={basis} onBasis={setBasis} basisOptions={[{ value: 'occurred', label: tx('aiu.basis.occurred') }, { value: 'current_period', label: tx('aiu.basis.current_period') }]} />
        <select className="fk-select" aria-label={tx('aiu.package')} value={code} onChange={(e) => setCode(e.target.value)} data-testid="aiu-h-package">
          <option value="">{tx('aiu.allPackages')}</option>{[...new Set([...(initialCode ? [initialCode] : []), ...PKGS])].map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <select className="fk-select" aria-label={tx('aiu.statusFilter')} value={status} onChange={(e) => setStatus(e.target.value)} data-testid="aiu-h-status">
          {['all', 'success', 'error', 'blocked'].map((s) => <option key={s} value={s}>{tx('aiu.hstatus.' + s)}</option>)}</select>
      </div>
      {msg ? <div className="fk-hint" role="status">{msg}</div> : null}
      {err ? <div className="fk-err" role="alert">{errText(err, tx('aiu.loadFailed'))}</div> : !d ? <div className="fk-loading">{tx('pos.loading')}</div> : d.items.length === 0 ? <Empty title={tx('aiu.noUsage')} /> : (
        <table className="fk-table" data-testid="aiu-history-table"><thead><tr><th>{tx('aiu.time')}</th><th>{tx('aiu.package')}</th><th>{tx('aiu.unitH')}</th><th className="num">{tx('aiu.qty')}</th><th>{tx('aiu.statusH')}</th><th>{tx('aiu.ref')}</th><th>{tx('aiu.periodLabel')}</th></tr></thead>
          <tbody>{d.items.map((r: any) => <tr key={r.id}><td>{when(r.at)}</td><td>{r.name}</td><td>{r.unit}</td><td className="num">{nf(r.quantity)}</td>
            <td><span className={'fk-chip ' + (r.counted ? 'ok' : 'mut')}>{tx('aiu.hst.' + (r.status === 'success' ? 'success' : r.status.startsWith('blocked') ? 'blocked' : 'error'))}</span></td><td className="fk-muted">{r.reference ?? '—'}</td><td>{tx('aiu.bp.' + r.billingPeriod)}</td></tr>)}</tbody></table>
      )}
    </FitDialog>
  );
}

/** Extras (AI Usage Limits 02): why the package is Active / Blocked — the server returns the AI-call gate's own decision and the
 *  facts behind it (platform switch, subscription row, trial, plans that list it, last provider event); nothing is decided here. */
type GateAnswer = { allowed: boolean; reason: string };
type EntitlementWhyView = { entitled: boolean; gate: GateAnswer; forYou: GateAnswer | null; state: string;
  platform: { enabled: boolean; disabledReason: string | null };
  subscription: { status: string; provider: string | null; lastPaymentStatus: string | null; period: string; priceSource: string } | null;
  trial: { startsAt: string | null; endsAt: string | null; daysLeft: number | null } | null;
  plans: { code: string; name: string; status: string | null; trialEndsAt: string | null; cancelledAt: string | null }[];
  lastVerified: { at: string | null; provider: string | null; eventType: string | null } | null };
const gateText = (r: string) => codeLabel('aiu.why.r.' + r, r);
const subText = (st: string) => codeLabel('aiu.why.s.' + st, st);
export function EntitlementWhy({ why }: { why: EntitlementWhyView }) {
  return <section className="aiu-d" data-testid="aiu-why">
    <h3 className="fk-h3">{why.entitled ? tx('aiu.why.titleOn') : tx('aiu.why.titleOff')}</h3>
    <div className={'fk-note ' + (why.entitled ? 'ok' : 'warn')} data-testid="aiu-why-gate">{tx('aiu.why.gate', { r: gateText(why.gate.reason) })}</div>
    {why.forYou && why.forYou.allowed !== why.gate.allowed ? <div className="fk-hint" data-testid="aiu-why-you">{tx('aiu.why.you', { r: gateText(why.forYou.reason) })}</div> : null}
    <dl className="fk-dl">
      <dt>{tx('aiu.why.platform')}</dt><dd data-testid="aiu-why-platform">{why.platform.enabled ? tx('aiu.platformOn') : tx('aiu.platformOff', { r: why.platform.disabledReason ?? '—' })}</dd>
      <dt>{tx('aiu.why.own')}</dt><dd data-testid="aiu-why-sub">{why.subscription ? tx('aiu.why.sub', { s: subText(why.subscription.status), p: tx('aiu.period.' + why.subscription.period) })
        + (why.subscription.lastPaymentStatus ? ' · ' + tx('aiu.why.lastPay', { s: codeLabel('aiu.why.pay.' + why.subscription.lastPaymentStatus, why.subscription.lastPaymentStatus) }) : '') : tx('aiu.why.noSub')}</dd>
      <dt>{tx('aiu.why.trial')}</dt><dd data-testid="aiu-why-trial">{why.trial ? (why.trial.daysLeft != null ? tx('aiu.why.trialLeft', { n: nf(why.trial.daysLeft) }) : tx('aiu.why.trialEnded', { d: day(why.trial.endsAt) })) : '—'}</dd>
      <dt>{tx('aiu.why.plans')}</dt><dd data-testid="aiu-why-plans">{why.plans.length === 0 ? tx('aiu.why.noPlan') : why.plans.map((pl) => `${pl.name} · ${pl.status ? subText(pl.status) : tx('aiu.why.planNone')}`).join(' | ')}</dd>
      <dt>{tx('aiu.why.verified')}</dt><dd data-testid="aiu-why-verified">{why.lastVerified?.at ? tx('aiu.why.verifiedAt', { d: when(why.lastVerified.at), p: why.lastVerified.provider ?? '—' }) : tx('aiu.why.neverVerified')}</dd>
    </dl>
  </section>;
}
