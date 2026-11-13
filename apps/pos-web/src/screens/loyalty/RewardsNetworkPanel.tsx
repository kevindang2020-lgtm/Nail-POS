// RewardsNetworkPanel.tsx — Customers → Loyalty & Rewards → "Rewards Network" view: the AI PowerSalon Global Loyalty &
// Rewards Network for one salon (LoyaltyTokens.pdf v1.0 §3, §5, §10; LoyaltyRules.pdf v2.0 §3–§4). English + Vietnamese.
//
//   KPI row          Earning mode (the TRUE source in force now) · Active earning rate · Available tokens · Reward value
//                    (read-only: the network's redemption value, never editable here) · Pending funding
//   Earning rule     Global / Custom selector; scheduled changes (cancel before they start); drafts (edit / discard);
//                    the next published global change; Edit custom rule · Use Global Rules
//   Token wallet     balance + alert level, Buy Tokens, purchase history (newest first, paged on the server)
//   Token activity   the wallet ledger (purchase funded, points funded, refund returned …)
//   Rule history     every version with its derived state (Active / Scheduled / Superseded / Draft / Canceled)
//
// Every number is the server's. A custom rule changes ONLY how many points a dollar earns — never what a point is worth or
// what a token is worth (addendum §1.2). Activation and Buy Tokens need a fresh password confirmation (step-up). Buy
// Tokens sends one request key per purchase and re-sends the SAME key when an answer was lost, so a retry never charges
// twice; nothing is spendable until the provider verifies the funds. When no approved provider is connected, Buy Tokens
// says so instead of pretending (BLOCKED_EXTERNAL).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseDollarsToCents } from '@aipowersalon/money';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posRewardsNetworkApi as netApi, type NetworkState, type HistoryItem, type RewardsNetLedgerRow, type Purchase, type Preview, type RateInput, type RewardsNetEarningRate, type RewardsNetPaged, type VersionLite, type PurchaseEvent, type RewardsNetBranchSplit, type RewardsNetPayables, type RewardsNetPayableRow } from '../../api/posRewardsNetworkApi';
import { errorTextOf } from '../../i18n/error-text';
import { fmtMoney, fmtNumber, fmtInZone } from '../../i18n/format';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, ErrorRetry, useFitRows, requestId, useDebounced } from '../../components/FitKit';
import { useStepUp, isStepUpCancelled } from '../access/accessUi';
import { useRealtime } from '../../realtime/useRealtime';

// ── wording helpers (client-side, so Vietnamese never shows the server's English labels) ─────────────────────────────
const errText = (e: unknown, fb: string) => errorTextOf(e, fb);
const whenTime = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) || '—' : '—');
/** points are stored in tenths: 5 → "0.5" */
export const pointsOf = (tenths: number) => fmtNumber((Number(tenths) || 0) / 10, 1);
/** wallet cents → tokens (1 token = tokenValueCents) */
export const tokensOf = (cents: number, tokenValueCents = 100) => fmtNumber((Number(cents) || 0) / Math.max(1, tokenValueCents), 2);
/** Wallet low-balance forecast (backlog GLOBAL LOYALTY · 03): an ESTIMATE from this month's verified token use — available ÷
 *  (used this month ÷ days elapsed). No use this month → null (no estimate is invented). */
export function walletForecastDays(availableCents: number, usedThisMonthCents: number, dayOfMonth: number): number | null {
  if (!(usedThisMonthCents > 0) || !(dayOfMonth >= 1)) return null;
  const perDay = usedThisMonthCents / dayOfMonth;
  return Math.max(0, Math.floor(availableCents / perDay));
}

export function rateText(r: Pick<RewardsNetEarningRate, 'spendIncrementCents' | 'pointTenthsPerIncrement'> | null | undefined): string {
  if (!r) return '—';
  return tx(r.pointTenthsPerIncrement === 10 ? 'rn.rate.one' : 'rn.rate', { spend: fmtMoney(r.spendIncrementCents), points: pointsOf(r.pointTenthsPerIncrement) });
}
const rateDetails = (r: RewardsNetEarningRate | null | undefined) => {
  if (!r) return '';
  const bits = [tx('rn.rate.min', { amount: fmtMoney(r.minEligibleCents) })];
  bits.push(r.perTicketCapTenths != null ? tx('rn.rate.cap', { points: pointsOf(r.perTicketCapTenths) }) : tx('rn.rate.noCap'));
  return bits.join(' · ');
};
const label = (prefix: string, code: string) => { const k = `${prefix}.${code}`; const v = tx(k); return v === k ? code : v; };
const PURCHASE_TONE: Record<string, string> = { FUNDS_VERIFIED: 'ok', REQUESTED: 'info', PROCESSING: 'info', PAYMENT_CONFIRMED: 'info', SETTLEMENT_PENDING: 'warn', UNKNOWN: 'warn',
  FAILED: 'bad', DECLINED: 'bad', REVERSED: 'bad', CHARGED_BACK: 'bad', CANCELED: 'mut' };
const STATE_TONE: Record<string, string> = { ACTIVE: 'ok', SCHEDULED: 'info', DRAFT: 'warn', SUPERSEDED: 'mut', DISCARDED: 'mut', CANCELED: 'mut' };
const ALERT_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'gold'> = { ok: 'gold', low: 'warn', critical: 'bad', empty: 'bad' };
/** a <input type="datetime-local"> value (the device's clock, which at the desk is the salon's) → ISO */
const localToIso = (v: string): string | null => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };

type Dlg = null | { kind: 'custom'; draft?: VersionLite } | { kind: 'global' } | { kind: 'buy' } | { kind: 'purchase'; id: string } | { kind: 'levels' } | { kind: 'branches' } | { kind: 'payables' } | { kind: 'explain' };

/** a server-paged list whose page size is however many rows fit right now */
function usePaged<T>(fetcher: (q: { page: number; pageSize: number }) => Promise<RewardsNetPaged<T>>, pageSize: number) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<RewardsNetPaged<T> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const seq = useRef(0); const f = useRef(fetcher); f.current = fetcher;
  useEffect(() => {
    const my = ++seq.current; setErr(null);
    f.current({ page, pageSize }).then((d) => { if (my === seq.current) { setData(d); if (d.page !== page) setPage(d.page); } })
      .catch((e) => { if (my === seq.current) setErr(errText(e, tx('rn.loadFailed'))); });
  }, [page, pageSize, reload]);
  return { data, err, setPage, refresh: () => setReload((n) => n + 1), toFirst: () => { setPage(1); setReload((n) => n + 1); } };
}

export function RewardsNetworkPanel() {
  const [st, setSt] = useState<NetworkState | null>(null);
  const [stErr, setStErr] = useState<string | null>(null);
  const [hist, setHist] = useState<HistoryItem[] | null>(null);
  const [histErr, setHistErr] = useState<string | null>(null);
  const [histPage, setHistPage] = useState(1);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const stepUp = useStepUp(tx('rn.stepUp'));

  const loadState = useCallback(() => { setStErr(null); return netApi.state().then(setSt).catch((e) => setStErr(errText(e, tx('rn.loadFailed')))); }, []);
  const loadHist = useCallback(() => { setHistErr(null); return netApi.history().then((r) => setHist(r.items)).catch((e) => setHistErr(errText(e, tx('rn.loadFailed')))); }, []);
  const purFit = useFitRows<HTMLDivElement>(46, { min: 2, max: 10 });
  const ledFit = useFitRows<HTMLDivElement>(46, { min: 2, max: 10 });
  const histFit = useFitRows<HTMLDivElement>(46, { min: 2, max: 10 });
  const purchases = usePaged<Purchase>((q) => netApi.purchases(q), purFit.rows);
  const ledger = usePaged<RewardsNetLedgerRow>((q) => netApi.ledger(q), ledFit.rows);
  useEffect(() => { void loadState(); void loadHist(); }, [loadState, loadHist]);
  const refreshAll = useCallback(() => { void loadState(); void loadHist(); purchases.refresh(); ledger.refresh(); }, [loadState, loadHist]);   // eslint-disable-line react-hooks/exhaustive-deps
  // addendum §6.2: another POS, the owner app or Super Admin changed the rule / wallet → every till refetches (ids only)
  useRealtime(['loyalty'], refreshAll, { relevance: (d) => (d?.event === 'loyalty_network_updated' || !d?.event ? 'full' : 'skip') });

  // C1 audit (Nov 4 2026): when the next scheduled change (salon or global) starts, the header refreshes itself — nothing sends
  // an event at that moment, so an open screen kept saying "Scheduled" after the change was live
  useEffect(() => {
    const times = [st?.scheduled?.[0]?.effectiveFrom, st?.globalNext?.effectiveFrom].map((t) => (t ? Date.parse(t) : NaN)).filter((t) => Number.isFinite(t) && t > Date.now());
    if (!times.length) return undefined;
    const wait = Math.min(...times) - Date.now() + 1500;
    if (wait > 2_147_000_000) return undefined;   // beyond what a timer can hold; a later visit loads it
    const h = setTimeout(() => { void loadState(); void loadHist(); }, wait);
    return () => clearTimeout(h);
  }, [st, loadState, loadHist]);

  const done = (text: string) => { setNote({ tone: 'ok', text }); setDlg(null); void loadState(); void loadHist(); purchases.toFirst(); ledger.toFirst(); };
  const fail = (e: unknown, fb: string) => { if (!isStepUpCancelled(e)) setNote({ tone: 'bad', text: errText(e, fb) }); };

  const cancelScheduled = async (v: VersionLite) => {
    setBusy(v.id);
    try { await netApi.cancelScheduled(v.id); done(tx('rn.note.canceled')); } catch (e) { fail(e, tx('rn.err.cancel')); } finally { setBusy(null); }
  };
  const discardDraft = async (v: VersionLite) => {
    setBusy(v.id);
    try { await netApi.discardDraft(v.id); done(tx('rn.note.discarded')); } catch (e) { fail(e, tx('rn.err.discard')); } finally { setBusy(null); }
  };

  const w = st?.wallet; const tv = st?.program.tokenValueCents ?? 100;
  const off = st ? !st.flags.engine : false;
  const enrolled = st?.enrollment.status === 'enrolled';
  const scheduled = st?.scheduled ?? [];
  const nextScheduled = scheduled[0] ?? null;
  const canEdit = !!st?.permissions.canEdit;
  const histSize = histFit.rows;
  const histPageInfo = hist ? { page: histPage, pageSize: histSize, totalItems: hist.length, totalPages: Math.max(1, Math.ceil(hist.length / histSize)) } : null;
  const histItems = hist ? hist.slice((Math.min(histPage, histPageInfo!.totalPages) - 1) * histSize, Math.min(histPage, histPageInfo!.totalPages) * histSize) : [];
  const buyBlockedReason = !st ? null : !st.funding.available ? tx('rn.buy.noProvider') : !st.permissions.canBuyTokens
    ? (!canEdit ? tx('rn.noPermission') : !st.flags.purchases || !st.flags.engine ? tx('rn.buy.off') : !enrolled ? tx('rn.notEnrolled') : tx('rn.buy.paused')) : null;
  const customBlockedReason = !st ? null : st.permissions.canActivate ? null : !canEdit ? tx('rn.noPermission') : !st.flags.customEarning || !st.flags.engine ? tx('rn.custom.off') : tx('rn.notEnrolled');

  const modeLabel = st ? (st.mode === 'CUSTOM' ? tx('rn.mode.custom') : tx('rn.mode.global')) : '';
  const kpiModeSub = !st ? '' : nextScheduled ? tx('rn.kpi.scheduledSub', { mode: nextScheduled.mode === 'CUSTOM' ? tx('rn.mode.customShort') : tx('rn.mode.globalShort'), date: whenTime(nextScheduled.effectiveFrom) })
    : st.effective?.source === 'TENANT_OVERRIDE' ? tx('rn.source.custom') : tx('rn.source.global');

  return (
    <>
      {note ? <div className={'fk-note ' + note.tone} role="status"><span>{note.text}</span><button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></div> : null}

      <div className="fk-kpis five" data-testid="rn-kpis">
        {stErr ? <ErrorRetry message={stErr} onRetry={() => void loadState()} /> : <>
          <KpiCard testId="rn-kpi-mode" label={tx('rn.kpi.mode')} loading={!st} value={modeLabel} sub={kpiModeSub} tone={st?.mode === 'CUSTOM' ? 'gold' : undefined} onClick={() => setDlg(st?.permissions.canActivate ? { kind: 'custom' } : null)} />
          <KpiCard testId="rn-kpi-rate" label={tx('rn.kpi.rate')} loading={!st} value={st ? rateText(st.effective) : ''} sub={st ? (off || st.program.earnPaused ? tx('rn.kpi.earningOff') : rateDetails(st.effective as RewardsNetEarningRate)) : ''} tone={off ? 'warn' : undefined} />
          <KpiCard testId="rn-kpi-tokens" label={tx('rn.kpi.tokens')} loading={!st} value={w ? tokensOf(w.availableCents, tv) : ''} tone={w ? ALERT_TONE[w.alertLevel] ?? 'gold' : undefined}
            sub={w ? tx('rn.kpi.tokensSub', { value: fmtMoney(w.availableCents), level: label('rn.alert', w.alertLevel) }) : ''} onClick={() => ledger.toFirst()} />
          <KpiCard testId="rn-kpi-value" label={tx('rn.kpi.value')} loading={!st} value={st ? tx('rn.value', { points: fmtNumber(st.program.pointsPerRedeemBlock), amount: fmtMoney(st.program.redeemBlockValueCents) }) : ''} sub={st ? tx('rn.kpi.valueSub', { token: fmtMoney(tv) }) : ''} />
          <KpiCard testId="rn-kpi-pending" label={tx('rn.kpi.pending')} loading={!st} value={w ? tokensOf(w.pendingCents, tv) : ''} tone={w && w.pendingPurchases > 0 ? 'warn' : undefined}
            sub={w ? tx('rn.kpi.pendingSub', { n: fmtNumber(w.pendingPurchases), used: tokensOf(w.usedThisMonthCents, tv) }) : ''} onClick={() => purchases.toFirst()} />
        </>}
      </div>

      {st ? <div className={'fk-hint rn-fresh' + (stErr ? ' warn' : '')} data-testid="rn-fresh" aria-live="polite">
        {stErr ? tx('rn.fresh.stale', { time: whenTime(st.generatedAt) }) : tx('rn.fresh.at', { time: whenTime(st.generatedAt) })}
        {' '}<button type="button" className="fk-btn ghost" data-testid="rn-kpi-explain" onClick={() => setDlg({ kind: 'explain' })}>{tx('rn.explain.btn')}</button></div> : null}

      <div className="fk-row two">
        <FitPanel testId="rn-earning" title={tx('rn.earning.title')}
          actions={st ? <span className="fk-hint">{tx('rn.earning.true', { source: st.effective?.source === 'TENANT_OVERRIDE' ? tx('rn.source.custom') : tx('rn.source.global') })}</span> : null}>
          {!st ? (stErr ? <ErrorRetry message={stErr} onRetry={() => void loadState()} /> : <div className="fk-loading">{tx('pos.loading')}</div>) : (
            <div className="rn-earn">
              {off ? <div className="rn-banner warn" role="note">{tx('rn.off')}</div> : !enrolled ? <div className="rn-banner warn" role="note">{tx('rn.notEnrolled')}</div>
                : st.program.earnPaused ? <div className="rn-banner warn" role="note">{tx('rn.earnPaused')}</div> : null}
              <div className="fk-field" role="radiogroup" aria-label={tx('rn.kpi.mode')}>
                <div className="fk-seg rn-seg">
                  <button type="button" role="radio" aria-checked={st.mode === 'GLOBAL'} className={st.mode === 'GLOBAL' ? 'on' : ''} data-testid="rn-mode-global"
                    disabled={!canEdit || st.mode === 'GLOBAL'} onClick={() => setDlg({ kind: 'global' })}>{tx('rn.mode.global')}</button>
                  <button type="button" role="radio" aria-checked={st.mode === 'CUSTOM'} className={st.mode === 'CUSTOM' ? 'on' : ''} data-testid="rn-mode-custom"
                    disabled={!st.permissions.canActivate} title={customBlockedReason ?? undefined} onClick={() => setDlg({ kind: 'custom' })}>{tx('rn.mode.custom')}</button>
                </div>
              </div>
              <div className="rn-current" data-testid="rn-current">
                <div><span className="rn-k">{tx('rn.current')}</span> <b>{modeLabel}</b> · {rateText(st.effective)}</div>
                <div className="fk-hint">{rateDetails(st.effective as RewardsNetEarningRate)}{st.effective?.source === 'TENANT_OVERRIDE' && st.effective.effectiveFrom ? ` · ${tx('rn.since', { date: whenTime(st.effective.effectiveFrom) })}` : ''}</div>
                {st.mode === 'GLOBAL' && st.globalNext ? <div className="fk-hint">{tx('rn.globalNext', { rate: rateText(st.globalNext), date: whenTime(st.globalNext.effectiveFrom) })}</div> : null}
                {/* Batch C decision 2 (Nov 6 2026): custom earning switched off → an ACTIVE custom rule is kept (grandfathered); no new custom changes */}
                {st.mode === 'CUSTOM' && (!st.flags.customEarning || !st.flags.engine) ? <div className="fk-hint" data-testid="rn-custom-kept">{tx('rn.custom.kept')}</div>
                  : customBlockedReason && canEdit ? <div className="fk-hint">{customBlockedReason}</div> : null}
              </div>
              <ul className="fk-list rn-mini" aria-label={tx('rn.scheduledAndDrafts')}>
                {scheduled.map((v) => (
                  <li key={v.id} className="fk-li" data-testid="rn-scheduled">
                    <div className="fk-li-main"><span className="fk-li-t">{tx('rn.scheduledLine', { mode: v.mode === 'CUSTOM' ? tx('rn.mode.custom') : tx('rn.mode.global'), date: whenTime(v.effectiveFrom) })}</span>
                      <span className="fk-li-s">{v.mode === 'CUSTOM' ? rateText(v.rate) : tx('rn.globalRules')}</span></div>
                    <span className="fk-chip info">{tx('rn.state.SCHEDULED')}</span>
                    {canEdit ? <span className="fk-li-acts"><button type="button" className="fk-btn ghost" disabled={busy === v.id} onClick={() => void cancelScheduled(v)}>{tx('rn.cancelChange')}</button></span> : null}
                  </li>
                ))}
                {(st.drafts ?? []).map((v) => (
                  <li key={v.id} className="fk-li" data-testid="rn-draft">
                    <div className="fk-li-main"><span className="fk-li-t">{tx('rn.draftLine', { n: String(v.versionNo) })}</span><span className="fk-li-s">{rateText(v.rate)}</span></div>
                    <span className="fk-chip warn">{tx('rn.state.DRAFT')}</span>
                    {canEdit ? <span className="fk-li-acts">
                      <button type="button" className="fk-ibtn" aria-label={tx('rn.editDraft')} title={tx('rn.editDraft')} disabled={!st.permissions.canActivate} onClick={() => setDlg({ kind: 'custom', draft: v })}>✎</button>
                      <button type="button" className="fk-ibtn" aria-label={tx('rn.discardDraft')} title={tx('rn.discardDraft')} disabled={busy === v.id} onClick={() => void discardDraft(v)}>✕</button>
                    </span> : null}
                  </li>
                ))}
              </ul>
              <div className="rn-actions">
                <button type="button" className="fk-btn primary" data-testid="rn-edit-custom" disabled={!st.permissions.canActivate} title={customBlockedReason ?? undefined} onClick={() => setDlg({ kind: 'custom' })}>
                  {st.mode === 'CUSTOM' ? tx('rn.changeCustom') : tx('rn.setCustom')}</button>
                <button type="button" className="fk-btn ghost" data-testid="rn-use-global" disabled={!canEdit || (st.mode === 'GLOBAL' && !scheduled.some((v) => v.mode === 'CUSTOM'))} onClick={() => setDlg({ kind: 'global' })}>{tx('rn.useGlobal')}</button>
              </div>
              <div className="fk-hint">{tx('rn.customNote', { value: tx('rn.value', { points: fmtNumber(st.program.pointsPerRedeemBlock), amount: fmtMoney(st.program.redeemBlockValueCents) }) })}</div>
            </div>
          )}
        </FitPanel>

        <FitPanel testId="rn-wallet" title={tx('rn.wallet.title')} bodyRef={purFit.ref}
          actions={<><button type="button" className="fk-btn ghost" data-testid="rn-payables" onClick={() => setDlg({ kind: 'payables' })}>{tx('rn.pay.btn')}</button>{w?.branchUsage ? <button type="button" className="fk-btn ghost" data-testid="rn-branches" onClick={() => setDlg({ kind: 'branches' })}>{tx('rn.branches.btn')}</button> : null}{canEdit ? <button type="button" className="fk-btn ghost" data-testid="rn-levels" onClick={() => setDlg({ kind: 'levels' })}>{tx('rn.levels.btn')}</button> : null}<button type="button" className="fk-btn primary" data-testid="rn-buy" disabled={!st || !!buyBlockedReason} title={buyBlockedReason ?? undefined} onClick={() => setDlg({ kind: 'buy' })}>{tx('rn.buy')}</button></>}
          footer={<Pager compact info={purchases.data} onPage={purchases.setPage} />}>
          {buyBlockedReason && st ? <div className="rn-banner" role="note" data-testid="rn-buy-blocked">{buyBlockedReason}</div> : null}
          {w ? (() => { const d = walletForecastDays(w.availableCents, w.usedThisMonthCents, new Date().getDate());
            return <div className={'fk-hint' + (d != null && d <= 14 ? ' warn' : '')} data-testid="rn-forecast">{d == null ? tx('rn.forecast.none') : tx('rn.forecast.days', { n: fmtNumber(d) })}</div>; })() : null}
          {purchases.err ? <ErrorRetry message={purchases.err} onRetry={purchases.refresh} /> : !purchases.data ? <div className="fk-loading">{tx('pos.loading')}</div> : purchases.data.items.length === 0 ? (
            <Empty title={tx('rn.noPurchases')}>{st && !buyBlockedReason ? <button type="button" className="fk-btn ghost" onClick={() => setDlg({ kind: 'buy' })}>{tx('rn.buy')}</button> : null}</Empty>
          ) : (
            <ul className="fk-list">
              {purchases.data.items.map((p) => (
                <li key={p.id} className="fk-li clickable" onClick={() => setDlg({ kind: 'purchase', id: p.id })}>
                  <div className="fk-li-main"><span className="fk-li-t">{tx('rn.purchaseLine', { tokens: tokensOf(p.tokenCents, tv) })}</span><span className="fk-li-s">{fmtMoney(p.amountCents)} · {whenTime(p.createdAt)}</span></div>
                  <span className={'fk-chip ' + (PURCHASE_TONE[p.status] ?? 'mut')}>{label('rn.ps', p.status)}</span>
                  <span className="fk-li-acts"><button type="button" className="fk-ibtn" aria-label={tx('rn.details')} title={tx('rn.details')} onClick={(e) => { e.stopPropagation(); setDlg({ kind: 'purchase', id: p.id }); }}>›</button></span>
                </li>
              ))}
            </ul>
          )}
        </FitPanel>
      </div>

      <div className="fk-row two">
        <FitPanel testId="rn-ledger" title={tx('rn.ledger.title')} bodyRef={ledFit.ref} footer={<Pager compact info={ledger.data} onPage={ledger.setPage} />}>
          {ledger.err ? <ErrorRetry message={ledger.err} onRetry={ledger.refresh} /> : !ledger.data ? <div className="fk-loading">{tx('pos.loading')}</div> : ledger.data.items.length === 0 ? <Empty title={tx('rn.noLedger')} /> : (
            <ul className="fk-list">
              {ledger.data.items.map((l) => (
                <li key={l.id} className="fk-li">
                  <div className="fk-li-main"><span className="fk-li-t">{label('rn.le', l.entryType)}</span><span className="fk-li-s">{whenTime(l.at)} · {tx('rn.balanceAfter', { n: tokensOf(l.balanceAfterCents, tv) })}</span></div>
                  <span className={'fk-li-num ' + (l.deltaCents < 0 ? 'neg' : 'pos')}>{l.deltaCents > 0 ? '+' : '−'}{tokensOf(Math.abs(l.deltaCents), tv)}</span>
                </li>
              ))}
            </ul>
          )}
        </FitPanel>

        <FitPanel testId="rn-history" title={tx('rn.history.title')} bodyRef={histFit.ref} footer={<Pager compact info={histPageInfo} onPage={setHistPage} />}>
          {histErr ? <ErrorRetry message={histErr} onRetry={() => void loadHist()} /> : !hist ? <div className="fk-loading">{tx('pos.loading')}</div> : hist.length === 0 ? <Empty title={tx('rn.noHistory')} /> : (
            <ul className="fk-list">
              {histItems.map((h) => (
                <li key={h.id} className="fk-li">
                  <div className="fk-li-main"><span className="fk-li-t">{tx('rn.versionLine', { n: String(h.versionNo), mode: h.mode === 'CUSTOM' ? tx('rn.mode.custom') : tx('rn.mode.global') })}{h.mode === 'CUSTOM' ? ` · ${rateText(h.rate)}` : ''}</span>
                    <span className="fk-li-s">{h.effectiveFrom ? tx('rn.from', { date: whenTime(h.effectiveFrom) }) : tx('rn.createdOn', { date: whenTime(h.createdAt) })}{h.reason ? ` · ${h.reason}` : ''}</span></div>
                  <span className={'fk-chip ' + (STATE_TONE[h.state] ?? 'mut')}>{label('rn.state', h.state)}</span>
                </li>
              ))}
            </ul>
          )}
        </FitPanel>
      </div>

      <nav className="fk-quick" aria-label={tx('rn.facts')} data-testid="rn-facts">
        <span className="fk-quick-l">{tx('rn.facts')}</span>
        <span className="fk-hint">{tx('rn.fact.funded')}</span>
        <span className="fk-quick-period">{st ? (st.funding.sandbox ? tx('rn.fact.sandbox') : st.funding.available ? '' : tx('rn.fact.noProvider')) : ''}</span>
      </nav>

      {dlg?.kind === 'custom' && st ? <CustomRuleDialog st={st} draft={dlg.draft} stepUpRun={stepUp.run} onClose={() => setDlg(null)} onDone={done} /> : null}
      {dlg?.kind === 'global' && st ? <UseGlobalDialog st={st} onClose={() => setDlg(null)} onDone={done} /> : null}
      {dlg?.kind === 'branches' && w?.branchUsage ? <BranchUsageDialog u={w.branchUsage} tokenValueCents={tv} onClose={() => setDlg(null)} /> : null}
      {dlg?.kind === 'explain' && st ? <KpiExplainDialog st={st} onClose={() => setDlg(null)} /> : null}
      {dlg?.kind === 'payables' ? <PayablesDialog onClose={() => setDlg(null)} /> : null}
      {dlg?.kind === 'levels' && st ? <LevelsDialog st={st} onClose={() => setDlg(null)} onDone={done} /> : null}
      {dlg?.kind === 'buy' && st ? <BuyTokensDialog st={st} stepUpRun={stepUp.run} onClose={() => setDlg(null)} onDone={(msg, id) => { done(msg); if (id) setDlg({ kind: 'purchase', id }); }} /> : null}
      {dlg?.kind === 'purchase' ? <PurchaseDialog id={dlg.id} tokenValueCents={tv} onClose={() => setDlg(null)} /> : null}
      {/* the password prompt opens OVER the editor / Buy Tokens dialog (fk-backdrop is z 80) */}
      {stepUp.prompt ? <div className="rn-stepup">{stepUp.prompt}</div> : null}
    </>
  );
}

// ── custom earning rule: editor + $5–$100 preview + Save Draft / Review & Activate ─────────────────────────────────────
type RunFn = <T>(action: () => Promise<T>, message?: string) => Promise<T>;
const dollarsText = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2));
function CustomRuleDialog({ st, draft, stepUpRun, onClose, onDone }: { st: NetworkState; draft?: VersionLite; stepUpRun: RunFn; onClose: () => void; onDone: (msg: string) => void }) {
  const seed: RewardsNetEarningRate | null = draft?.rate ?? (st.mode === 'CUSTOM' ? (st.effective as RewardsNetEarningRate) : null) ?? (st.globalNow as RewardsNetEarningRate | null);
  const [spend, setSpend] = useState(dollarsText(seed?.spendIncrementCents ?? 500));
  const [points, setPoints] = useState(seed ? String((seed.pointTenthsPerIncrement ?? 5) / 10) : '0.5');
  const [minimum, setMinimum] = useState(dollarsText(seed?.minEligibleCents ?? 0));
  const [cap, setCap] = useState(seed?.perTicketCapTenths != null ? String(seed.perTicketCapTenths / 10) : '');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [at, setAt] = useState('');
  const [reason, setReason] = useState('');
  const [step, setStep] = useState<'edit' | 'review'>('edit');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pErr, setPErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const L = st.program.limits;

  const parsed = useMemo((): { rate: RateInput | null; problem: string | null } => {
    const s = parseDollarsToCents(spend); const m = parseDollarsToCents(minimum || '0');
    const p = Number(points); const c = cap.trim() === '' ? null : Number(cap);
    if (s == null || s <= 0) return { rate: null, problem: tx('rn.v.spend') };
    if (!Number.isFinite(p) || p <= 0 || Math.abs(p * 10 - Math.round(p * 10)) > 1e-9) return { rate: null, problem: tx('rn.v.points') };
    if (m == null) return { rate: null, problem: tx('rn.v.minimum') };
    if (c != null && (!Number.isFinite(c) || c <= 0 || Math.abs(c * 10 - Math.round(c * 10)) > 1e-9)) return { rate: null, problem: tx('rn.v.cap') };
    return { rate: { spendIncrementCents: s, pointTenthsPerIncrement: Math.round(p * 10), minEligibleCents: m, perTicketCapTenths: c == null ? null : Math.round(c * 10) }, problem: null };
  }, [spend, points, minimum, cap]);
  const key = parsed.rate ? JSON.stringify(parsed.rate) : '';
  const dKey = useDebounced(key, 350);
  useEffect(() => {
    if (!dKey) { setPreview(null); return; }
    let live = true; setPErr(null);
    netApi.preview(JSON.parse(dKey)).then((p) => { if (live) setPreview(p); }).catch((e) => { if (live) { setPreview(null); setPErr(errText(e, tx('rn.err.preview'))); } });
    return () => { live = false; };
  }, [dKey]);
  const ready = !!parsed.rate && !!preview && !pErr && dKey === key;
  const effIso = when === 'later' ? localToIso(at) : null;
  const laterBad = when === 'later' && !effIso;

  const saveDraft = async () => {
    if (!parsed.rate) return; setBusy(true); setErr(null);
    try { await netApi.saveDraft(parsed.rate, draft?.id); onDone(tx('rn.note.draftSaved')); }
    catch (e) { setErr(errText(e, tx('rn.err.save'))); setBusy(false); }
  };
  const activate = async () => {
    if (!parsed.rate) return; setBusy(true); setErr(null);
    try {
      // a draft is activated AS SAVED only when nothing was edited; otherwise the edited rate is activated directly
      const same = draft?.rate && draft.rate.spendIncrementCents === parsed.rate.spendIncrementCents && draft.rate.pointTenthsPerIncrement === parsed.rate.pointTenthsPerIncrement
        && draft.rate.minEligibleCents === parsed.rate.minEligibleCents && (draft.rate.perTicketCapTenths ?? null) === parsed.rate.perTicketCapTenths;
      const body = same ? { draftId: draft!.id, effectiveFrom: effIso, reason: reason.trim() || null } : { ...parsed.rate, effectiveFrom: effIso, reason: reason.trim() || null };
      const r = await stepUpRun(() => netApi.activate(body));
      onDone(r.scheduled ? tx('rn.note.scheduled', { date: whenTime(r.effectiveFrom) }) : tx('rn.note.activated'));
    } catch (e) { if (!isStepUpCancelled(e)) setErr(errText(e, tx('rn.err.activate'))); setBusy(false); }
  };

  const limitsText = tx('rn.limits', { min: fmtMoney(L.minSpendIncrementCents), max: fmtMoney(L.maxSpendIncrementCents), pts: pointsOf(L.maxPointTenthsPerIncrement), cap: pointsOf(L.maxPointTenthsPerTicket) });
  return (
    <FitDialog wide testId="rn-custom-dialog" title={step === 'edit' ? (draft ? tx('rn.custom.editDraftTitle', { n: String(draft.versionNo) }) : tx('rn.custom.title')) : tx('rn.custom.reviewTitle')}
      subtitle={tx('rn.custom.sub')} onClose={onClose} busy={busy}
      footer={step === 'edit' ? <>
        <button type="button" className="fk-btn ghost" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button>
        <button type="button" className="fk-btn ghost" data-testid="rn-save-draft" onClick={() => void saveDraft()} disabled={busy || !parsed.rate}>{tx('rn.saveDraft')}</button>
        <button type="button" className="fk-btn primary" data-testid="rn-review" onClick={() => setStep('review')} disabled={busy || !ready || laterBad}>{tx('rn.reviewActivate')}</button>
      </> : <>
        <button type="button" className="fk-btn ghost" onClick={() => setStep('edit')} disabled={busy}>{tx('rn.back')}</button>
        <button type="button" className="fk-btn primary" data-testid="rn-activate" onClick={() => void activate()} disabled={busy}>{busy ? tx('pos.saving_2') : effIso ? tx('rn.confirmSchedule') : tx('rn.confirmActivate')}</button>
      </>}>
      {step === 'edit' ? <>
        <div className="fk-grid2">
          <label className="fk-field"><span>{tx('rn.f.spend')}</span><input data-autofocus inputMode="decimal" value={spend} onChange={(e) => setSpend(e.target.value)} data-testid="rn-f-spend" /></label>
          <label className="fk-field"><span>{tx('rn.f.points')}</span><input inputMode="decimal" value={points} onChange={(e) => setPoints(e.target.value)} data-testid="rn-f-points" /></label>
          <label className="fk-field"><span>{tx('rn.f.minimum')}</span><input inputMode="decimal" value={minimum} onChange={(e) => setMinimum(e.target.value)} /></label>
          <label className="fk-field"><span>{tx('rn.f.cap')}</span><input inputMode="decimal" value={cap} placeholder={tx('rn.f.capPh')} onChange={(e) => setCap(e.target.value)} /></label>
          <div className="fk-field" role="radiogroup" aria-label={tx('rn.f.when')}><span>{tx('rn.f.when')}</span>
            <div className="fk-seg"><button type="button" className={when === 'now' ? 'on' : ''} aria-pressed={when === 'now'} onClick={() => setWhen('now')}>{tx('rn.f.now')}</button>
              <button type="button" className={when === 'later' ? 'on' : ''} aria-pressed={when === 'later'} onClick={() => setWhen('later')}>{tx('rn.f.later')}</button></div></div>
          {when === 'later' ? <label className="fk-field"><span>{tx('rn.f.at')}</span><input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></label>
            : <label className="fk-field"><span>{tx('rn.f.reason')}</span><input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></label>}
          {when === 'later' ? <label className="fk-field span2"><span>{tx('rn.f.reason')}</span><input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></label> : null}
        </div>
        <div className="fk-hint">{limitsText}</div>
        {parsed.problem ? <div className="fk-err" role="alert">{parsed.problem}</div> : pErr ? <div className="fk-err" role="alert">{pErr}</div> : null}
        <PreviewTable preview={ready ? preview : null} tokenValueCents={st.program.tokenValueCents} />
        <div className="fk-hint">{tx('rn.custom.never', { value: tx('rn.value', { points: fmtNumber(st.program.pointsPerRedeemBlock), amount: fmtMoney(st.program.redeemBlockValueCents) }), token: fmtMoney(st.program.tokenValueCents) })}</div>
      </> : <>
        <dl className="rn-review" data-testid="rn-review-panel">
          <dt>{tx('rn.review.before')}</dt><dd>{st.mode === 'CUSTOM' ? tx('rn.mode.custom') : tx('rn.mode.global')} · {rateText(st.effective)}</dd>
          <dt>{tx('rn.review.after')}</dt><dd>{tx('rn.mode.custom')} · {rateText(parsed.rate)} · {rateDetails(parsed.rate as RewardsNetEarningRate)}</dd>
          <dt>{tx('rn.review.starts')}</dt><dd>{effIso ? whenTime(effIso) : tx('rn.review.immediately')}</dd>
          {reason.trim() ? <><dt>{tx('rn.f.reason')}</dt><dd>{reason.trim()}</dd></> : null}
        </dl>
        <PreviewTable preview={preview} tokenValueCents={st.program.tokenValueCents} />
        <div className="rn-banner" role="note">{tx('rn.review.rules')}</div>
        {err ? <div className="fk-err" role="alert">{err}</div> : null}
      </>}
      {step === 'edit' && err ? <div className="fk-err" role="alert">{err}</div> : null}
    </FitDialog>
  );
}

function PreviewTable({ preview, tokenValueCents }: { preview: Preview | null; tokenValueCents: number }) {
  if (!preview) return <div className="fk-loading rn-preview-wait">{tx('rn.preview.wait')}</div>;
  return (
    <table className="rn-table" data-testid="rn-preview">
      <caption>{tx('rn.preview.caption')}</caption>
      <thead><tr><th scope="col">{tx('rn.preview.sale')}</th><th scope="col">{tx('rn.preview.points')}</th><th scope="col">{tx('rn.preview.cost')}</th><th scope="col">{tx('rn.preview.global')}</th><th scope="col">{tx('rn.preview.diff')}</th></tr></thead>
      <tbody>{preview.rows.map((r) => (
        <tr key={r.eligibleCents}>
          <th scope="row">{fmtMoney(r.eligibleCents)}</th>
          <td>{pointsOf(r.pointTenths)}</td>
          <td>{tokensOf(r.tokenCostCents, tokenValueCents)}</td>
          <td>{tx('rn.preview.globalCell', { points: pointsOf(r.globalPointTenths), tokens: tokensOf(r.globalTokenCostCents, tokenValueCents) })}</td>
          <td className={r.differenceCents > 0 ? 'neg' : r.differenceCents < 0 ? 'pos' : ''}>{r.differenceCents === 0 ? '0' : (r.differenceCents > 0 ? '+' : '−') + tokensOf(Math.abs(r.differenceCents), tokenValueCents)}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

// ── return to the AI PowerSalon global rules (explicit confirmation) ───────────────────────────────────────────────────
/** C1 audit (Nov 4 2026) LoyaltyTokens §5.6: the salon's own low / critical token-balance warnings (blank = platform default). */
function LevelsDialog({ st, onClose, onDone }: { st: NetworkState; onClose: () => void; onDone: (msg: string) => void }) {
  const w = st.wallet;
  const txt = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2));
  const [low, setLow] = useState(w.levelsOwn ? txt(w.lowBalanceCents) : '');
  const [crit, setCrit] = useState(w.levelsOwn ? txt(w.criticalBalanceCents) : '');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const cents = (v: string): number | null | 'bad' => { if (!v.trim()) return null; const c = parseDollarsToCents(v); return c == null || c < 0 ? 'bad' : c; };
  const lowC = cents(low), critC = cents(crit);
  const bad = lowC === 'bad' || critC === 'bad';
  const go = async () => {
    if (bad) return;
    setBusy(true); setErr(null);
    try { await netApi.setWalletLevels({ lowBalanceCents: lowC as number | null, criticalBalanceCents: critC as number | null }); onDone(tx('rn.levels.saved')); }
    catch (e) { setErr(errText(e, tx('rn.levels.failed'))); setBusy(false); }
  };
  return (
    <FitDialog testId="rn-levels-dialog" title={tx('rn.levels.title')} onClose={onClose} busy={busy}
      footer={<><button type="button" className="fk-btn ghost" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button>
        <button type="button" className="fk-btn primary" data-testid="rn-levels-save" disabled={busy || bad} onClick={() => void go()}>{busy ? tx('pos.saving_2') : tx('rn.levels.save')}</button></>}>
      <p className="rn-p">{tx('rn.levels.body', { low: fmtMoney(w.platformLowBalanceCents ?? 0), critical: fmtMoney(w.platformCriticalBalanceCents ?? 0) })}</p>
      <div className="fk-grid2">
        <label className="fk-field"><span>{tx('rn.levels.low')}</span><input inputMode="decimal" value={low} placeholder={txt(w.platformLowBalanceCents)} onChange={(e) => setLow(e.target.value)} data-testid="rn-levels-low" /></label>
        <label className="fk-field"><span>{tx('rn.levels.critical')}</span><input inputMode="decimal" value={crit} placeholder={txt(w.platformCriticalBalanceCents)} onChange={(e) => setCrit(e.target.value)} data-testid="rn-levels-critical" /></label>
      </div>
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
    </FitDialog>
  );
}

function UseGlobalDialog({ st, onClose, onDone }: { st: NetworkState; onClose: () => void; onDone: (msg: string) => void }) {
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [at, setAt] = useState('');
  const [reason, setReason] = useState('');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const effIso = when === 'later' ? localToIso(at) : null;
  const go = async () => {
    setBusy(true); setErr(null);
    try { const r = await netApi.useGlobal({ effectiveFrom: effIso, reason: reason.trim() || null }); onDone(r.scheduled ? tx('rn.note.globalScheduled', { date: whenTime(r.effectiveFrom) }) : tx('rn.note.global')); }
    catch (e) { setErr(errText(e, tx('rn.err.global'))); setBusy(false); }
  };
  return (
    <FitDialog testId="rn-global-dialog" title={tx('rn.global.title')} onClose={onClose} busy={busy}
      footer={<><button type="button" className="fk-btn ghost" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button>
        <button type="button" className="fk-btn primary" data-testid="rn-global-confirm" disabled={busy || !ok || (when === 'later' && !effIso)} onClick={() => void go()}>{busy ? tx('pos.saving_2') : tx('rn.useGlobal')}</button></>}>
      <p className="rn-p">{tx('rn.global.body', { rate: rateText(st.globalNow) })}</p>
      <div className="fk-grid2">
        <div className="fk-field" role="radiogroup" aria-label={tx('rn.f.when')}><span>{tx('rn.f.when')}</span>
          <div className="fk-seg"><button type="button" className={when === 'now' ? 'on' : ''} aria-pressed={when === 'now'} onClick={() => setWhen('now')}>{tx('rn.f.now')}</button>
            <button type="button" className={when === 'later' ? 'on' : ''} aria-pressed={when === 'later'} onClick={() => setWhen('later')}>{tx('rn.f.later')}</button></div></div>
        {when === 'later' ? <label className="fk-field"><span>{tx('rn.f.at')}</span><input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></label> : <span />}
        <label className="fk-field span2"><span>{tx('rn.f.reason')}</span><input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></label>
      </div>
      <label className="fk-check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} data-testid="rn-global-ok" /> {tx('rn.global.confirm')}</label>
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
    </FitDialog>
  );
}

// ── Buy Tokens: choose → review → confirm (step-up, one request key) → result / Verification Pending ──────────────────
const BUY_KEY = 'aps.rn.buyKey';
type Held = { key: string; tokens: number };
const readHeld = (): Held | null => { try { const v = sessionStorage.getItem(BUY_KEY); return v ? (JSON.parse(v) as Held) : null; } catch { return null; } };
const writeHeld = (h: Held | null) => { try { if (h) sessionStorage.setItem(BUY_KEY, JSON.stringify(h)); else sessionStorage.removeItem(BUY_KEY); } catch { /* a private window: the key lives in memory only */ } };
const UNSETTLED = ['REQUESTED', 'PROCESSING', 'UNKNOWN'];

function BuyTokensDialog({ st, stepUpRun, onClose, onDone }: { st: NetworkState; stepUpRun: RunFn; onClose: () => void; onDone: (msg: string, purchaseId?: string) => void }) {
  const held = useRef<Held | null>(readHeld());
  const presets = st.program.purchasePresetsTokens?.length ? st.program.purchasePresetsTokens : [10, 25, 50, 100, 250, 500];
  const [tokens, setTokens] = useState<number>(held.current?.tokens ?? presets[2] ?? 50);
  const [other, setOther] = useState('');
  const [step, setStep] = useState<'choose' | 'review' | 'result'>(held.current ? 'review' : 'choose');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Purchase | null>(null);
  const [lost, setLost] = useState(false);
  const max = st.program.maxPurchaseTokens;
  const qty = other.trim() ? Number(other) : tokens;
  const qtyOk = Number.isInteger(qty) && qty >= 1 && qty <= max;
  const amountCents = qtyOk ? qty * st.program.tokenValueCents : 0;

  const confirm = async () => {
    // ONE key per logical purchase: kept until the server answers with a settled state, re-sent on every retry
    const h: Held = held.current && held.current.tokens === qty ? held.current : { key: requestId(), tokens: qty };
    held.current = h; writeHeld(h);
    setBusy(true); setErr(null); setLost(false);
    try {
      const p = await stepUpRun(() => netApi.buyTokens(qty, h.key));
      setResult(p); setStep('result');
      if (!UNSETTLED.includes(p.status)) { held.current = null; writeHeld(null); }
    } catch (e: any) {
      if (isStepUpCancelled(e)) { setBusy(false); return; }
      const status = Number(e?.status ?? 0);
      if (!status || status >= 500 && status !== 503) { setLost(true); setStep('result'); }   // the answer was lost: Verification Pending, same key kept
      else { if (status !== 409) { held.current = null; writeHeld(null); } setErr(errText(e, tx('rn.err.buy'))); }
    } finally { setBusy(false); }
  };
  const recheck = async () => {
    if (result) { setBusy(true); try { const p = await netApi.purchase(result.id); setResult(p); if (!UNSETTLED.includes(p.status)) { held.current = null; writeHeld(null); } } catch (e) { setErr(errText(e, tx('rn.err.load'))); } finally { setBusy(false); } }
    else await confirm();   // no answer at all: re-send with the SAME key — the server returns the same purchase
  };

  const pending = lost || (result && UNSETTLED.includes(result.status));
  return (
    <FitDialog testId="rn-buy-dialog" title={step === 'choose' ? tx('rn.buy.title') : step === 'review' ? tx('rn.buy.reviewTitle') : pending ? tx('rn.buy.pendingTitle') : tx('rn.buy.doneTitle')}
      subtitle={tx('rn.buy.sub', { token: fmtMoney(st.program.tokenValueCents) })} onClose={onClose} busy={busy}
      footer={step === 'choose' ? <>
        <button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.cancel')}</button>
        <button type="button" className="fk-btn primary" data-testid="rn-buy-review" disabled={!qtyOk} onClick={() => setStep('review')}>{tx('rn.buy.review')}</button>
      </> : step === 'review' ? <>
        <button type="button" className="fk-btn ghost" onClick={() => { held.current = null; writeHeld(null); setStep('choose'); }} disabled={busy}>{tx('rn.back')}</button>
        <button type="button" className="fk-btn primary" data-testid="rn-buy-confirm" disabled={busy || !qtyOk} onClick={() => void confirm()}>{busy ? tx('rn.buy.submitting') : tx('rn.buy.confirm', { amount: fmtMoney(amountCents) })}</button>
      </> : <>
        {pending ? <button type="button" className="fk-btn ghost" data-testid="rn-buy-recheck" disabled={busy} onClick={() => void recheck()}>{tx('rn.buy.checkAgain')}</button> : null}
        <button type="button" className="fk-btn primary" onClick={() => onDone(pending ? tx('rn.note.buyPending') : result?.status === 'FUNDS_VERIFIED' ? tx('rn.note.buyFunded') : tx('rn.note.buySent'), result?.id)}>{tx('rn.done')}</button>
      </>}>
      {step === 'choose' ? <>
        <div className="rn-presets" role="radiogroup" aria-label={tx('rn.buy.amount')}>
          {presets.map((n) => (
            <button key={n} type="button" role="radio" aria-checked={!other && tokens === n} className={'rn-preset' + (!other && tokens === n ? ' on' : '')} onClick={() => { setTokens(n); setOther(''); }} data-testid={`rn-preset-${n}`}>
              <b>{fmtNumber(n)}</b><span>{fmtMoney(n * st.program.tokenValueCents)}</span></button>
          ))}
        </div>
        <label className="fk-field"><span>{tx('rn.buy.other', { max: fmtNumber(max) })}</span><input inputMode="numeric" value={other} onChange={(e) => setOther(e.target.value.replace(/[^\d]/g, ''))} /></label>
        {!qtyOk ? <div className="fk-err" role="alert">{tx('rn.buy.qtyBad', { max: fmtNumber(max) })}</div> : null}
        <div className="fk-hint">{tx('rn.buy.funds')}</div>
      </> : step === 'review' ? <>
        <dl className="rn-review" data-testid="rn-buy-review-panel">
          <dt>{tx('rn.buy.tokens')}</dt><dd>{fmtNumber(qty)}</dd>
          <dt>{tx('rn.buy.total')}</dt><dd><b>{fmtMoney(amountCents)}</b></dd>
          <dt>{tx('rn.buy.balanceNow')}</dt><dd>{tokensOf(st.wallet.availableCents, st.program.tokenValueCents)}</dd>
          <dt>{tx('rn.buy.paidBy')}</dt><dd>{st.funding.sandbox ? tx('rn.buy.sandbox') : tx('rn.buy.provider')}</dd>
        </dl>
        <div className="rn-banner" role="note">{tx('rn.buy.funds')}</div>
        {held.current ? <div className="fk-hint">{tx('rn.buy.resuming')}</div> : null}
        {err ? <div className="fk-err" role="alert">{err}</div> : null}
      </> : <>
        {lost ? <div className="rn-banner warn" role="status" data-testid="rn-buy-pending">{tx('rn.buy.lost')}</div>
          : result ? <dl className="rn-review" data-testid="rn-buy-result">
            <dt>{tx('rn.buy.tokens')}</dt><dd>{tokensOf(result.tokenCents, st.program.tokenValueCents)}</dd>
            <dt>{tx('rn.buy.total')}</dt><dd>{fmtMoney(result.amountCents)}</dd>
            <dt>{tx('rn.status')}</dt><dd><span className={'fk-chip ' + (PURCHASE_TONE[result.status] ?? 'mut')}>{label('rn.ps', result.status)}</span></dd>
          </dl> : null}
        {result ? <div className="fk-hint">{label('rn.psHelp', result.status)}</div> : null}
        {err ? <div className="fk-err" role="alert">{err}</div> : null}
      </>}
    </FitDialog>
  );
}

function PurchaseDialog({ id, tokenValueCents, onClose }: { id: string; tokenValueCents: number; onClose: () => void }) {
  const [p, setP] = useState<(Purchase & { events?: PurchaseEvent[] }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); netApi.purchase(id).then(setP).catch((e) => setErr(errText(e, tx('rn.err.load')))); }, [id]);
  useEffect(() => { load(); }, [load]);
  return (
    <FitDialog side testId="rn-purchase-dialog" title={tx('rn.purchase.title')} onClose={onClose}>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !p ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <dl className="rn-review">
          <dt>{tx('rn.buy.tokens')}</dt><dd>{tokensOf(p.tokenCents, tokenValueCents)}</dd>
          <dt>{tx('rn.buy.total')}</dt><dd>{fmtMoney(p.amountCents)}{p.feeCents ? ` · ${tx('rn.fee', { amount: fmtMoney(p.feeCents) })}` : ''}</dd>
          <dt>{tx('rn.status')}</dt><dd><span className={'fk-chip ' + (PURCHASE_TONE[p.status] ?? 'mut')}>{label('rn.ps', p.status)}</span></dd>
          <dt>{tx('rn.requested')}</dt><dd>{whenTime(p.createdAt)}</dd>
          {p.confirmedAt ? <><dt>{tx('rn.confirmed')}</dt><dd>{whenTime(p.confirmedAt)}</dd></> : null}
          {p.fundedAt ? <><dt>{tx('rn.funded')}</dt><dd>{whenTime(p.fundedAt)}</dd></> : null}
          {p.providerRefLast6 ? <><dt>{tx('rn.ref')}</dt><dd>…{p.providerRefLast6}</dd></> : null}
        </dl>
        <div className="fk-hint">{label('rn.psHelp', p.status)}</div>
        {Array.isArray(p.events) && p.events.length ? (
          <ul className="fk-list rn-mini" aria-label={tx('rn.purchase.timeline')}>
            {p.events.map((e, i) => <li key={i} className="fk-li"><div className="fk-li-main"><span className="fk-li-t">{label('rn.ps', e.to)}</span><span className="fk-li-s">{whenTime(e.at)}</span></div></li>)}
          </ul>
        ) : null}
      </>}
    </FitDialog>
  );
}

/** Extras (GLOBAL LOYALTY REWARDS 13): ONE salon wallet, attributed per branch for this salon month — every number is the server's,
 *  including whether the branch rows add up to the wallet and whether any earning was funded twice. Read-only. */
function BranchUsageDialog({ u, tokenValueCents, onClose }: { u: RewardsNetBranchSplit; tokenValueCents: number; onClose: () => void }) {
  return (
    <FitDialog title={tx('rn.branches.title')} onClose={onClose} testId="rn-branches-dlg">
      <p className="fk-hint">{tx('rn.branches.since', { date: whenTime(u.since) })}</p>
      {u.rows.length === 0 ? <Empty title={tx('rn.branches.none')} /> : (
        <table className="rn-table" data-testid="rn-branches-table">
          <thead><tr><th>{tx('rn.branches.branch')}</th><th>{tx('rn.branches.earnings')}</th><th>{tx('rn.branches.points')}</th><th>{tx('rn.branches.funded')}</th><th>{tx('rn.branches.redeemed')}</th></tr></thead>
          <tbody>
            {u.rows.map((r) => (
              <tr key={r.branchId ?? 'none'} data-testid="rn-branch-row">
                <td>{r.branchName ?? (r.branchId ? '—' : tx('rn.branches.unassigned'))}</td>
                <td>{fmtNumber(r.earnings)}</td>
                <td>{pointsOf(r.pointTenths)}</td>
                <td>{tokensOf(r.fundedCents, tokenValueCents)}</td>
                <td>{tx('rn.branches.redeemedCell', { n: fmtNumber(r.redemptions), amount: fmtMoney(r.redeemedValueCents) })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className={'fk-hint' + (u.matchesWallet ? '' : ' warn')} data-testid="rn-branches-match">{u.matchesWallet
        ? tx('rn.branches.matches', { n: tokensOf(u.totalFundedCents, tokenValueCents) })
        : tx('rn.branches.mismatch', { a: tokensOf(u.totalFundedCents, tokenValueCents), b: tokensOf(u.walletUsedCents, tokenValueCents) })}</p>
      <p className={'fk-hint' + (u.doubleFunded ? ' warn' : '')} data-testid="rn-branches-double">{u.doubleFunded ? tx('rn.branches.double', { n: fmtNumber(u.doubleFunded) }) : tx('rn.branches.noDouble')}</p>
    </FitDialog>
  );
}

/** Extras (GLOBAL LOYALTY REWARDS 07 + 10): what the rewards network owes THIS salon for points it accepted. Every stage, reason,
 *  provider answer and journal line is the server's record — read-only; payouts are never requested from here. The strip on top
 *  says whether a payout provider is connected, the last VERIFIED settlement, and provider answers still awaited (pending)
 *  apart from answers that never came (unknown). */
const STAGE_TONE: Record<string, string> = { PAYABLE: 'info', PROCESSING: 'warn', PAID: 'ok', EXCEPTION: 'bad', CLOSED: 'mut' };
const ATTEMPT_TONE: Record<string, string> = { SETTLED: 'ok', SUBMITTED: 'info', REQUESTED: 'info', UNKNOWN: 'warn', FAILED: 'bad' };
function PayablesDialog({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>('');
  const [data, setData] = useState<RewardsNetPayables | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true; setErr(null);
    netApi.reimbursements({ page, pageSize: 8, status: status || null }).then((d) => { if (live) setData(d); }).catch((e) => { if (live) setErr(errText(e, tx('rn.err.load'))); });
    return () => { live = false; };
  }, [page, status, reload]);
  const s = data?.settlement;
  const info = data ? { page: data.page, pageSize: data.pageSize, totalItems: data.total, totalPages: data.pageCount } : null;
  return (
    <FitDialog wide testId="rn-pay-dlg" title={tx('rn.pay.title')} subtitle={tx('rn.pay.sub')} onClose={onClose} footer={<Pager compact info={info} onPage={setPage} />}>
      {err ? <ErrorRetry message={err} onRetry={() => setReload((n) => n + 1)} /> : !data ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="rn-banner" role="note" data-testid="rn-pay-fresh">
          <div data-testid="rn-pay-provider">{data.provider.connected ? tx('rn.pay.providerOn') : tx('rn.pay.providerOff')}</div>
          <div data-testid="rn-pay-last">{s?.lastVerifiedAt ? tx('rn.pay.lastVerified', { date: whenTime(s.lastVerifiedAt) }) : tx('rn.pay.noVerified')}</div>
          <div data-testid="rn-pay-waiting">{s && s.waitingOnProvider > 0 ? tx('rn.pay.waiting', { n: fmtNumber(s.waitingOnProvider), date: whenTime(s.oldestWaitingSince) }) : tx('rn.pay.noWaiting')}</div>
          <div data-testid="rn-pay-unknown" className={s && s.unknownAnswer > 0 ? 'warn' : ''}>{s && s.unknownAnswer > 0 ? tx('rn.pay.unknown', { n: fmtNumber(s.unknownAnswer), date: whenTime(s.oldestUnknownSince) }) : tx('rn.pay.noUnknown')}</div>
        </div>
        <div className="fk-seg" role="group" aria-label={tx('rn.status')} data-testid="rn-pay-filter">
          <button type="button" className={status === '' ? 'on' : ''} onClick={() => { setStatus(''); setPage(1); }}>{tx('rn.pay.all', { n: fmtNumber(data.totals.reduce((a, t) => a + t.count, 0)) })}</button>
          {data.totals.map((t) => (
            <button key={t.status} type="button" className={status === t.status ? 'on' : ''} data-testid={'rn-pay-total-' + t.status} onClick={() => { setStatus(t.status); setPage(1); }}>
              {tx('rn.pay.totalChip', { label: label('rn.pay.st', t.status), n: fmtNumber(t.count), amount: fmtMoney(t.owedCents) })}</button>
          ))}
        </div>
        {data.items.length === 0 ? <Empty title={tx('rn.pay.none')} /> : (
          <ul className="fk-list" data-testid="rn-pay-list">
            {data.items.map((r) => (
              <li key={r.id} className="fk-li clickable" data-testid="rn-pay-row" onClick={() => setOpen(open === r.id ? null : r.id)}>
                <div className="fk-li-main"><span className="fk-li-t">{tx('rn.pay.line', { amount: fmtMoney(r.owedCents), status: label('rn.pay.st', r.status) })}</span>
                  <span className="fk-li-s">{whenTime(r.createdAt)} · {label('rn.pay.why', r.why)}</span>
                  {open === r.id ? <PayableEvidence r={r} /> : null}</div>
                <span className={'fk-chip ' + (STAGE_TONE[r.stage] ?? 'mut')}>{label('rn.pay.stage', r.stage)}</span>
              </li>
            ))}
          </ul>
        )}
      </>}
    </FitDialog>
  );
}
function PayableEvidence({ r }: { r: RewardsNetPayableRow }) {
  return (
    <div className="rn-evidence" data-testid="rn-pay-evidence" onClick={(e) => e.stopPropagation()}>
      <dl className="rn-review">
        <dt>{tx('rn.pay.amount')}</dt><dd>{fmtMoney(r.amountCents)}{r.adjustedCents ? ` · ${tx('rn.pay.adjusted', { amount: fmtMoney(r.adjustedCents) })}` : ''}</dd>
        {r.holdReason ? <><dt>{tx('rn.pay.holdReason')}</dt><dd data-testid="rn-pay-hold">{r.holdReason}</dd></> : null}
        {r.paidAt ? <><dt>{tx('rn.pay.paidAt')}</dt><dd>{whenTime(r.paidAt)}{r.settlementRef ? ` · ${tx('rn.pay.ref', { ref: r.settlementRef })}` : ''}</dd></> : null}
      </dl>
      <div className="fk-hint">{tx('rn.pay.attempts')}</div>
      {r.attempts.length === 0 ? <div className="fk-hint" data-testid="rn-pay-no-attempts">{tx('rn.pay.noAttempts')}</div> : (
        <ul className="fk-list rn-mini">
          {r.attempts.map((a) => (
            <li key={a.id} className="fk-li" data-testid="rn-pay-attempt">
              <div className="fk-li-main"><span className="fk-li-t">{tx('rn.pay.attemptLine', { amount: fmtMoney(a.amountCents), date: whenTime(a.requestedAt) })}</span>
                <span className="fk-li-s">{[a.settlementRef ? tx('rn.pay.ref', { ref: a.settlementRef }) : null, a.signatureVerified ? tx('rn.pay.verified') : null,
                  a.settledAt ? tx('rn.pay.settledAt', { date: whenTime(a.settledAt) }) : null, a.failureCode ? label('rn.pay.fail', a.failureCode) : null].filter(Boolean).join(' · ') || '—'}</span></div>
              <span className={'fk-chip ' + (ATTEMPT_TONE[a.status] ?? 'mut')}>{label('rn.pay.at', a.status)}</span>
            </li>
          ))}
        </ul>
      )}
      {r.adjustments.length ? <ul className="fk-list rn-mini" aria-label={tx('rn.pay.adjustments')}>
        {r.adjustments.map((a, i) => <li key={i} className="fk-li" data-testid="rn-pay-adjustment"><div className="fk-li-main"><span className="fk-li-t">{label('rn.pay.adj', a.kind)} · {fmtMoney(a.amountCents)}</span><span className="fk-li-s">{whenTime(a.at)}</span></div></li>)}
      </ul> : null}
      <div className="fk-hint">{tx('rn.pay.journal')}</div>
      {r.journal.length === 0 ? <div className="fk-hint">—</div> : (
        <table className="rn-table" data-testid="rn-pay-journal">
          <thead><tr><th>{tx('rn.pay.j.entry')}</th><th>{tx('rn.pay.j.account')}</th><th>{tx('rn.pay.j.debit')}</th><th>{tx('rn.pay.j.credit')}</th><th>{tx('rn.pay.j.at')}</th></tr></thead>
          <tbody>{r.journal.map((j, i) => (
            <tr key={i}><td>{label('rn.pay.je', j.entryType)}</td><td>{label('rn.pay.acct', j.account)}</td><td>{j.debitCents ? fmtMoney(j.debitCents) : '—'}</td><td>{j.creditCents ? fmtMoney(j.creditCents) : '—'}</td><td>{whenTime(j.at)}</td></tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

/** Extras (GLOBAL LOYALTY REWARDS 10): where each KPI on this page comes from — formula, scope, currency, rule version and the
 *  server time it was read — and what an unknown / missing value means. Text only; every number is the server's state. */
function KpiExplainDialog({ st, onClose }: { st: NetworkState; onClose: () => void }) {
  const w = st.wallet; const tv = st.program.tokenValueCents;
  const version = st.effective?.versionNo != null ? String(st.effective.versionNo) : '—';
  const rows: { k: string; label: string; how: string; now: string }[] = [
    { k: 'mode', label: tx('rn.kpi.mode'), how: tx('rn.explain.mode', { version }), now: st.mode === 'CUSTOM' ? tx('rn.mode.custom') : tx('rn.mode.global') },
    { k: 'rate', label: tx('rn.kpi.rate'), how: tx('rn.explain.rate'), now: rateText(st.effective) },
    { k: 'tokens', label: tx('rn.kpi.tokens'), how: tx('rn.explain.tokens', { token: fmtMoney(tv) }), now: w?.exists ? tokensOf(w.availableCents, tv) : tx('rn.explain.noWallet') },
    { k: 'value', label: tx('rn.kpi.value'), how: tx('rn.explain.value'), now: tx('rn.value', { points: fmtNumber(st.program.pointsPerRedeemBlock), amount: fmtMoney(st.program.redeemBlockValueCents) }) },
    { k: 'pending', label: tx('rn.kpi.pending'), how: tx('rn.explain.pending'), now: w?.exists ? tokensOf(w.pendingCents, tv) : tx('rn.explain.noWallet') },
  ];
  return (
    <FitDialog side testId="rn-explain-dlg" title={tx('rn.explain.title')} onClose={onClose}>
      <dl className="rn-review" data-testid="rn-explain-common">
        <dt>{tx('rn.explain.scope')}</dt><dd>{tx('rn.explain.scopeV')}</dd>
        <dt>{tx('rn.explain.currency')}</dt><dd>{tx('rn.explain.currencyV', { token: fmtMoney(tv) })}</dd>
        <dt>{tx('rn.explain.refreshed')}</dt><dd>{whenTime(st.generatedAt)}</dd>
      </dl>
      <ul className="fk-list rn-mini">
        {rows.map((r) => (
          <li key={r.k} className="fk-li" data-testid={'rn-explain-' + r.k}>
            <div className="fk-li-main"><span className="fk-li-t">{r.label} · {r.now}</span><span className="fk-li-s">{r.how}</span></div>
          </li>
        ))}
      </ul>
      <p className="fk-hint">{tx('rn.explain.unknown')}</p>
    </FitDialog>
  );
}
