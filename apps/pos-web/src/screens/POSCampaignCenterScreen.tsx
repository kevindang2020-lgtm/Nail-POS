// POSCampaignCenterScreen.tsx — Marketing & Growth › Campaign Center (/tenant/marketing/campaigns; /marketing/sms and /marketing/email
// open the SAME screen pre-filtered to that channel — intentional, one campaign engine). Campaign Center Complete Build Guide
// (Oct 30 2026). Every original module is kept — header + New Campaign, the six KPI cards, status / channel / search filters, the
// campaign table (Campaign · Channel · Audience · Status · Sent · Open · Click · Reply · Bookings · Revenue · ROI), Growth Funnel,
// Channel Mix, Revenue by Campaign, the four related cards and the seven Quick Actions — but every number now comes from its
// own source (posCampaignCenterApi): an audience size that was only typed in is shown as an estimate, "Sent" is what the provider
// accepted, opens / clicks / replies that are not tracked say so, and ROI without a real cost is "N/A" (never 0x).
// Added: campaigns ↔ recipients search scopes, From/To month calendar with a date basis, numbered pages 10/20/50, a details
// overlay (Overview · Recipients · Message · Delivery Events · Bookings & Redemptions · Financial · Audit), the six-step New
// Campaign flow (draft → audience → message → schedule → review → approval), Check Campaign System and the Campaign Assistant.
// Nothing on this screen sends: Launch schedules an APPROVED campaign; the server's worker sends with consent re-checked.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { SYNC_POLICY } from '@aipowersalon/realtime-client';
import { posCampaignCenterApi, type CcCampaign, type CcPage } from '../api/posCampaignCenterApi';
import { posCampaignsApi } from '../api/posCampaignsApi';
import { useCan } from '../components/usePermissions';
import { useRealtime } from '../realtime/useRealtime';
import { errorTextOf } from '../i18n/error-text';
import { fmtMoney, fmtNumber, fmtInZone } from '../i18n/format';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry, useDebounced } from '../components/FitKit';
import { PeriodBar, periodQuery, type PeriodState, type ServerPeriod } from '../components/FinanceKit';

const SIZES = [10, 20, 50] as const;
const STATUSES = ['draft', 'awaiting_approval', 'approved', 'scheduled', 'sending', 'completed', 'cancelled'] as const;
const BASES = ['created', 'scheduled', 'started', 'completed'] as const;
const SORTS = ['newest', 'oldest', 'name', 'scheduled'] as const;
const GOALS = ['inactive', 'slow_weekdays', 'new_service', 'repeat_visits'] as const;
const TONE: Record<string, string> = { draft: 'mut', awaiting_approval: 'warn', approved: 'info', scheduled: 'warn', sending: 'info', completed: 'ok', cancelled: 'bad' };
const nf = (n: number | null | undefined) => (n == null ? '—' : fmtNumber(n));
const money = (c: number | null | undefined) => (c == null ? tx('cc.na') : fmtMoney(c));
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) || '—' : '—');
const stLabel = (s: string) => tx('cc.status.' + s);
const outcomeLabel = (o: string | null) => (o ? tx('cc.outcome.' + o) : '');
const chLabel = (c: string) => (c === 'sms' ? 'SMS' : c === 'email' ? tx('pos.email') : tx('pos.push'));
const errText = (e: unknown) => errorTextOf(e, tx('cc.failed'));
/** a translated label, or the raw code when no label exists yet (a new provider / skip reason) — never a blank */
const tr = (key: string, fallback: string | null | undefined) => { const v = tx(key); return v && v !== key ? v : String(fallback ?? ''); };

function Badge({ s }: { s: string }) { return <span className={'fk-chip ' + (TONE[s] ?? 'mut')} data-testid={'cc-status-' + s}>{stLabel(s)}</span>; }

export function POSCampaignCenterScreen({ defaultChannel = '' }: { defaultChannel?: string } = {}) {
  const nav = useNavigate();
  const can = useCan();
  const canManage = can('marketing.manage');
  const [sp, setSp] = useSearchParams();
  const scope = sp.get('scope') === 'recipients' ? 'recipients' : 'campaigns';
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const pageSize = (SIZES as readonly number[]).includes(Number(sp.get('size'))) ? Number(sp.get('size')) : 10;
  const status = (STATUSES as readonly string[]).includes(sp.get('status') ?? '') ? String(sp.get('status')) : '';
  const channel = ['sms', 'email', 'push'].includes(sp.get('channel') ?? '') ? String(sp.get('channel')) : defaultChannel;
  const basis = (BASES as readonly string[]).includes(sp.get('basis') ?? '') ? String(sp.get('basis')) : 'created';
  const sort = (SORTS as readonly string[]).includes(sp.get('sort') ?? '') ? String(sp.get('sort')) : 'newest';
  const period: PeriodState = sp.get('preset') === 'custom' && sp.get('from') && sp.get('to') ? { preset: 'custom', from: sp.get('from')!, to: sp.get('to')! } as PeriodState
    : { preset: (['today', 'week', 'month', 'year', 'all'].includes(sp.get('preset') ?? '') ? sp.get('preset') : 'all') as PeriodState['preset'] } as PeriodState;
  const setView = (patch: Record<string, string | number | null>, resetPage = true) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === '' || v === undefined) next.delete(k); else next.set(k, String(v)); }
    if (resetPage && !('page' in patch)) next.delete('page');
    setSp(next, { replace: true });
  };
  const [search, setSearch] = useState(sp.get('q') ?? ''); const q = useDebounced(search, 300);
  useEffect(() => { if ((sp.get('q') ?? '') !== q) setView({ q: q.trim() || null }); }, [q]);   // eslint-disable-line react-hooks/exhaustive-deps

  const pq = { ...periodQuery(period), basis, ...(channel ? { channel } : {}) };
  const pKey = JSON.stringify(pq);
  const [ov, setOv] = useState<any>(null); const [ovErr, setOvErr] = useState<string | null>(null);
  const [list, setList] = useState<{ items: any[]; pagination: CcPage; period: any } | null>(null); const [listErr, setListErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const seq = useRef(0); const oseq = useRef(0);
  const loadOv = useCallback(() => { const my = ++oseq.current; setOvErr(null); posCampaignCenterApi.overview(JSON.parse(pKey)).then((d) => { if (my === oseq.current) setOv(d); }).catch((e) => { if (my === oseq.current) setOvErr(errText(e)); }); }, [pKey]);
  useEffect(() => { loadOv(); }, [loadOv, reload]);
  useEffect(() => {
    const my = ++seq.current; setListErr(null); setList(null);
    const base = { ...JSON.parse(pKey), q: (sp.get('q') ?? '') || undefined, page, pageSize };
    const p = scope === 'recipients' ? posCampaignCenterApi.searchRecipients(base) : posCampaignCenterApi.list({ ...base, status: status || undefined, sort });
    p.then((d: any) => { if (my !== seq.current) return; setList(d); if (d.pagination.page !== page) setView({ page: d.pagination.page > 1 ? d.pagination.page : null }, false); })
      .catch((e) => { if (my === seq.current) setListErr(errText(e)); });
  }, [pKey, scope, status, sort, page, pageSize, sp.get('q'), reload]);   // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => setReload((n) => n + 1);
  useRealtime(['campaigns', 'marketing', 'notifications'], () => refresh(), { intervalMs: SYNC_POLICY.detailMs });

  // Marketing & Growth §13: the dashboard's Smart Campaign Assistant opens THIS assistant (?assistant=<goal>) — one assistant, not two
  const assistantGoal = (GOALS as readonly string[]).includes(sp.get('assistant') ?? '') ? String(sp.get('assistant')) : null;
  const [dlg, setDlg] = useState<null | { kind: 'detail'; id: string } | { kind: 'wizard'; id?: string } | { kind: 'health'; id?: string } | { kind: 'assistant'; goal?: string }>(assistantGoal ? { kind: 'assistant', goal: assistantGoal } : null);
  const k = ov?.kpis; const per = list?.period ?? ov?.period ?? null;
  const server: ServerPeriod | null = per ? { preset: per.preset, from: per.from, to: per.to, tz: per.tz, today: per.today } as ServerPeriod : null;
  const anyFilter = !!(status || (channel && channel !== defaultChannel) || search || sp.get('preset') || sp.get('basis') || sp.get('sort'));
  const title = defaultChannel === 'sms' ? tx('cc.titleSms') : defaultChannel === 'email' ? tx('cc.titleEmail') : tx('pos.campaign_center');

  return (
    <div className="work cc" data-testid="campaign-center">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{title}</h1>
          <div className="sub">{tx('cc.subtitle', { n: nf(k?.totalCampaigns ?? 0) })}{defaultChannel ? <span className="fk-muted"> · {tx('cc.channelPreset', { ch: chLabel(defaultChannel) })}</span> : null}
            {ov ? <span className="fk-muted" data-testid="cc-updated"> · {tx('cc.updated', { time: when(ov.generatedAt) })}</span> : null}</div></div>
        <div className="fk-head-actions">
          <button type="button" className="fk-btn ghost" onClick={refresh} data-testid="cc-refresh">{tx('cc.refresh')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => setDlg({ kind: 'health' })} data-testid="cc-open-health">{tx('cc.checkSystem')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => setDlg({ kind: 'assistant' })} data-testid="cc-open-assistant">{tx('cc.assistant')}</button>
          <button type="button" className="fk-btn primary" disabled={!canManage} title={!canManage ? tx('cc.noPermission') : undefined} onClick={() => setDlg({ kind: 'wizard' })} data-testid="cc-new">{tx('pos.new_campaign')}</button>
        </div>
      </header>

      <div className="fk-kpis six" data-testid="cc-kpis">
        {ovErr ? <ErrorRetry message={ovErr} onRetry={loadOv} /> : <>
          <KpiCard testId="kpi-revenue" label={tx('pos.campaign_revenue')} loading={!k} value={k ? fmtMoney(k.campaignRevenueCents) : ''} sub={tx('cc.kpi.revenueSub')} />
          <KpiCard testId="kpi-active" label={tx('pos.active_campaigns')} loading={!k} value={k ? nf(k.activeCampaigns) : ''} sub={tx('cc.kpi.activeSub')} />
          <KpiCard testId="kpi-sent" label={tx('pos.total_sent')} loading={!k} value={k ? nf(k.totalSent) : ''} sub={tx('cc.kpi.sentSub')} />
          <KpiCard testId="kpi-roi" label={tx('pos.avg_campaign_roi')} loading={!k} value={k ? (k.avgRoi == null ? tx('cc.na') : `${k.avgRoi}x`) : ''} sub={k?.avgRoi == null ? tx('cc.kpi.roiNa') : tx('cc.kpi.roiSub')} />
          <KpiCard testId="kpi-open" label={tx('pos.avg_open_rate_2')} loading={!k} value={k ? tx('cc.notTracked') : ''} sub={tx('cc.kpi.openSub')} />
          <KpiCard testId="kpi-bookings" label={tx('pos.total_bookings')} loading={!k} tone="gold" value={k ? nf(k.totalBookings) : ''} sub={tx('cc.kpi.bookSub')} />
        </>}
      </div>
      {ov && ov.legacyEstimateTotal > 0 ? <div className="fk-note warn" data-testid="cc-legacy-note">{tx('cc.legacyNote', { n: nf(k?.legacyEstimateCampaigns ?? 0), total: nf(ov.legacyEstimateTotal) })}</div> : null}

      <div className="rt-filters rt-periodrow cc-tools" role="toolbar" aria-label={tx('cc.filters')}>
        <div className="rt-chips" role="tablist" aria-label={tx('cc.scope')}>
          {(['campaigns', 'recipients'] as const).map((s) => <button type="button" role="tab" key={s} aria-selected={scope === s} className={'rt-chip' + (scope === s ? ' on' : '')} onClick={() => { setSearch(''); setView({ scope: s === 'campaigns' ? null : s, q: null }); }} data-testid={'cc-scope-' + s}>{tx('cc.scope.' + s)}</button>)}
        </div>
        {scope === 'campaigns' ? <>
          <select className="fk-select" aria-label={tx('pos.status_filter')} value={status} onChange={(e) => setView({ status: e.target.value || null })} data-testid="cc-status">
            <option value="">{tx('pos.all_statuses')}</option>{STATUSES.map((s) => <option key={s} value={s}>{stLabel(s)}</option>)}
          </select>
          <select className="fk-select" aria-label={tx('pos.channel_filter')} value={channel} onChange={(e) => setView({ channel: e.target.value || null })} data-testid="cc-channel">
            <option value="">{tx('pos.all_channels')}</option><option value="sms">SMS</option><option value="email">{tx('pos.email')}</option><option value="push">{tx('pos.push')}</option>
          </select>
        </> : null}
        <input type="search" className="fk-search cc-search" aria-label={tx(scope === 'campaigns' ? 'cc.searchCampaigns' : 'cc.searchRecipients')} placeholder={tx(scope === 'campaigns' ? 'cc.searchCampaigns' : 'cc.searchRecipients')} value={search} onChange={(e) => setSearch(e.target.value)} data-testid="cc-search" />
        <PeriodBar compact allowAll value={period} onChange={(p) => setView(p.preset === 'custom' ? { preset: 'custom', from: p.from ?? null, to: p.to ?? null } : { preset: p.preset === 'all' ? null : p.preset, from: null, to: null })} server={server}
          basis={scope === 'campaigns' ? basis : undefined} onBasis={scope === 'campaigns' ? (b) => setView({ basis: b === 'created' ? null : b }) : undefined} basisOptions={scope === 'campaigns' ? BASES.map((b) => ({ value: b, label: tx('cc.basis.' + b) })) : undefined} />
        {scope === 'campaigns' ? <select className="fk-select" aria-label={tx('cc.sort')} value={sort} onChange={(e) => setView({ sort: e.target.value === 'newest' ? null : e.target.value })} data-testid="cc-sort">
          {SORTS.map((s) => <option key={s} value={s}>{tx('cc.sort.' + s)}</option>)}</select> : null}
        {anyFilter ? <button type="button" className="fk-link" onClick={() => { setSearch(''); setView({ status: null, channel: null, q: null, preset: null, from: null, to: null, basis: null, sort: null }); }} data-testid="cc-clear">{tx('cc.clearAll')}</button> : null}
      </div>
      {list && per && per.from ? <div className="fk-hint" data-testid="cc-basis-active">{tx('cc.basisActive', { basis: tx('cc.basis.' + (scope === 'campaigns' ? basis : 'event')), from: per.from, to: per.to })}</div> : null}

      <section className="fk-panel cc-table" data-testid="cc-table">
        <div className="fk-panel-body cc-scroll">
          {listErr ? <ErrorRetry message={listErr} onRetry={refresh} /> : !list ? <div className="fk-loading">{tx('pos.loading')}</div>
            : list.items.length === 0 ? <Empty title={scope === 'campaigns' ? (anyFilter ? tx('cc.emptyFiltered') : tx('pos.no_campaigns_yet')) : tx('cc.emptyRecipients')}>{scope === 'campaigns' && anyFilter ? tx('cc.emptyFilteredHint') : null}</Empty>
            : scope === 'campaigns' ? (
              <table className="tbl cc-tbl"><thead><tr>
                <th>{tx('pos.campaign')}</th><th>{tx('pos.channel')}</th><th className="num">{tx('pos.audience')}</th><th>{tx('pos.status')}</th><th className="num">{tx('pos.sent')}</th>
                <th className="num">{tx('pos.open')}</th><th className="num">{tx('pos.click')}</th><th className="num">{tx('pos.reply')}</th><th className="num">{tx('pos.bookings_2')}</th><th className="num">{tx('pos.revenue')}</th><th className="num">ROI</th>
              </tr></thead><tbody>
                {list.items.map((c: CcCampaign) => (
                  <tr key={c.id} className="cc-row" tabIndex={0} onClick={() => setDlg({ kind: 'detail', id: c.id })} onKeyDown={(e) => { if (e.key === 'Enter') setDlg({ kind: 'detail', id: c.id }); }} data-testid={'cc-row-' + c.id}>
                    <td><div className="cc-name">{c.name}</div><div className="sub">{c.offer ?? c.goal ?? ''}</div></td>
                    <td>{chLabel(c.channel)}</td>
                    <td className="num" title={c.counts.selectedIsEstimate ? tx('cc.estimateTip') : undefined}>{c.counts.selectedIsEstimate ? tx('cc.estimate', { n: nf(c.counts.selected) }) : nf(c.counts.selected)}</td>
                    <td><Badge s={c.displayStatus} />{c.outcome ? <div className="sub cc-outcome" data-testid="cc-outcome">{outcomeLabel(c.outcome)}</div> : null}</td>
                    <td className="num">{nf(c.counts.submitted)}</td>
                    <td className="num cc-na" title={tx('cc.notTrackedTip')}>{tx('cc.na')}</td><td className="num cc-na" title={tx('cc.notTrackedTip')}>{tx('cc.na')}</td><td className="num cc-na" title={tx('cc.notTrackedTip')}>{tx('cc.na')}</td>
                    <td className="num">{nf(c.counts.booked)}</td><td className="num">{fmtMoney(c.counts.associatedRevenueCents)}</td>
                    <td className="num" title={c.counts.roiNote}>{c.counts.roi == null ? tx('cc.na') : `${c.counts.roi}x`}</td>
                  </tr>
                ))}
              </tbody></table>
            ) : (
              <table className="tbl cc-tbl"><thead><tr><th>{tx('cc.r.customer')}</th><th>{tx('pos.campaign')}</th><th>{tx('pos.channel')}</th><th>{tx('cc.r.stage')}</th><th>{tx('cc.r.reason')}</th><th>{tx('cc.r.at')}</th></tr></thead>
                <tbody>{list.items.map((r: any, i: number) => (
                  <tr key={(r.sendId ?? r.customerId) + i} className="cc-row" onClick={() => setDlg({ kind: 'detail', id: r.campaignId })} data-testid="cc-recipient-row">
                    <td><div className="cc-name">{r.customerName ?? tx('cc.hiddenName')}</div><div className="sub">{r.contact ?? '—'}</div></td>
                    <td>{r.campaignName}</td><td>{chLabel(r.channel)}</td><td>{tx('cc.stage.' + r.stage)}</td><td>{r.reason ? tr('cc.reason.' + r.reason, r.reason) : r.providerErrorCode ?? '—'}</td><td>{when(r.at)}</td>
                  </tr>))}</tbody></table>
            )}
        </div>
        <div className="fk-panel-foot cc-foot">
          <label className="cp-size"><span>{tx('cc.rows')}</span><select className="fk-select" value={pageSize} onChange={(e) => setView({ size: Number(e.target.value) === 10 ? null : e.target.value })} data-testid="cc-size">{SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          <Pager info={list?.pagination} onPage={(p) => setView({ page: p > 1 ? p : null }, false)} />
        </div>
      </section>

      <div className="cc-charts">
        <section className="fk-panel" data-testid="cc-funnel"><div className="fk-panel-head">{tx('pos.growth_funnel')}</div>
          <div className="fk-panel-body">{!ov ? null : <Funnel stages={ov.funnel} legacy={ov.legacyEstimateTotal} />}</div></section>
        <section className="fk-panel" data-testid="cc-mix"><div className="fk-panel-head">{tx('pos.channel_mix')} <span className="fk-muted">{tx('pos.by_revenue')}</span></div>
          <div className="fk-panel-body">{!ov ? null : (ov.channelMix.filter((m: any) => m.revenueCents > 0).length === 0 ? <div className="fk-muted">{tx('cc.noRevenueYet')}</div>
            : ov.channelMix.filter((m: any) => m.revenueCents > 0).map((m: any) => <div key={m.channel} className="cc-bar"><span>{chLabel(m.channel)}</span><b>{fmtMoney(m.revenueCents)}</b></div>))}
            <div className="fk-hint">{tx('cc.attribution')}</div></div></section>
        <section className="fk-panel" data-testid="cc-revenue"><div className="fk-panel-head">{tx('pos.revenue_by_campaign')}</div>
          <div className="fk-panel-body">{!ov ? null : ov.revenueByCampaign.length === 0 ? <div className="fk-muted">{tx('pos.no_campaign_revenue_yet')}</div>
            : ov.revenueByCampaign.map((r: any) => <div key={r.id} className="cc-bar"><span>{r.name}</span><b>{fmtMoney(r.revenueCents)}</b></div>)}</div></section>
      </div>

      <div className="cc-related">
        {[
          { t: tx('pos.loyalty_rewards'), d: tx('pos.tier_distribution_points_issued_redeemed_top_1di0'), r: '/tenant/marketing/loyalty', b: tx('admin.campaign.open.loyalty') },
          { t: tx('pos.rebooking_retention'), d: tx('pos.overdue_at_risk_win_back_actions_mm4m'), r: '/follow-ups', b: tx('admin.campaign.open.retention') },
          { t: tx('pos.promotions_memberships_gift_cards'), d: tx('pos.active_promos_membership_plans_gift_card_1p0k'), r: '/tenant/marketing/promotions', b: tx('admin.campaign.open.promotions') },
          { t: tx('pos.ai_growth_insights'), d: tx('pos.best_send_time_likely_to_return_1jm1'), r: '/ai', b: tx('admin.management.open.aiCenter') },
        ].map((m) => (
          <section key={m.t} className="fk-panel cc-card"><div className="fk-panel-head">{m.t}</div>
            <div className="fk-panel-body"><div className="sub">{m.d} {tx('pos.managed_in_its_own_module')}</div><button type="button" className="fk-btn" onClick={() => nav(m.r)}>{m.b}</button></div></section>
        ))}
      </div>

      <section className="fk-panel cc-quick" data-testid="cc-quick"><div className="fk-panel-head">{tx('pos.quick_actions_2')}</div>
        <div className="fk-panel-body cc-quick-row">
          {[
            { l: tx('pos.create_campaign'), fn: () => setDlg({ kind: 'wizard' }), dis: !canManage },
            { l: tx('pos.send_sms'), fn: () => nav('/tenant/marketing/sms') },
            { l: tx('pos.send_email'), fn: () => nav('/tenant/marketing/email') },
            { l: tx('pos.launch_promo'), fn: () => nav('/tenant/marketing/promotions') },
            { l: tx('pos.issue_gift_card'), fn: () => nav('/tenant/marketing/promotions') },
            { l: tx('pos.request_review'), fn: () => nav('/follow-ups') },
            { l: tx('pos.view_reports'), fn: () => nav('/reports') },
          ].map((a) => <button type="button" key={a.l} className="fk-btn ghost" disabled={a.dis} onClick={a.fn}>{a.l}</button>)}
        </div></section>

      {dlg?.kind === 'detail' ? <DetailDialog id={dlg.id} canManage={canManage} onClose={() => setDlg(null)} onChanged={refresh} onEdit={(id) => setDlg({ kind: 'wizard', id })} onHealth={(id) => setDlg({ kind: 'health', id })} onOpenCopy={(id) => setDlg({ kind: 'wizard', id })} /> : null}
      {dlg?.kind === 'wizard' ? <WizardDialog id={dlg.id} defaultChannel={defaultChannel === 'email' ? 'email' : 'sms'} onClose={() => { setDlg(null); refresh(); }} /> : null}
      {dlg?.kind === 'health' ? <HealthDialog id={dlg.id} onClose={() => setDlg(null)} /> : null}
      {dlg?.kind === 'assistant' ? <AssistantDialog canManage={canManage} initialGoal={dlg.goal} onClose={() => { setDlg(null); if (assistantGoal) setView({ assistant: null }, false); }} onDraft={(id) => { refresh(); setDlg({ kind: 'wizard', id }); }} /> : null}
    </div>
  );
}

function Funnel({ stages, legacy }: { stages: Array<{ key: string; value: number | null; note: string }>; legacy: number }) {
  const max = Math.max(1, ...stages.map((s) => s.value ?? 0));
  return (
    <div className="cc-funnel">
      {stages.map((s) => (
        <div key={s.key} className="cc-fstage" title={tx('cc.funnel.' + s.key + 'Note')} data-testid={'cc-funnel-' + s.key}>
          <div className="cc-fl"><span>{tx('cc.funnel.' + s.key)}</span><b>{s.value == null ? tx('cc.notTracked') : nf(s.value)}</b></div>
          <div className="cc-ftrack"><div className="cc-ffill" style={{ width: `${s.value == null ? 0 : Math.round((s.value / max) * 100)}%` }} /></div>
        </div>
      ))}
      {legacy > 0 ? <div className="fk-hint" data-testid="cc-funnel-legacy">{tx('cc.funnel.legacy', { n: nf(legacy) })}</div> : null}
    </div>
  );
}

// ── details overlay (guide §09 / §13) ─────────────────────────────────────────────────────────────────────────────────
const TABS = ['overview', 'recipients', 'message', 'events', 'bookings', 'financial', 'audit'] as const;
function DetailDialog({ id, canManage, onClose, onChanged, onEdit, onHealth, onOpenCopy }: { id: string; canManage: boolean; onClose: () => void; onChanged: () => void; onEdit: (id: string) => void; onHealth: (id: string) => void; onOpenCopy: (id: string) => void }) {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState<string | null>(null); const [tab, setTab] = useState<(typeof TABS)[number]>('overview');
  const [busy, setBusy] = useState(false); const [note, setNote] = useState<{ t: string; tone: 'ok' | 'bad' } | null>(null);
  const [askCancel, setAskCancel] = useState(false);
  const load = useCallback(() => { setErr(null); posCampaignCenterApi.detail(id).then(setD).catch((e) => setErr(errText(e))); }, [id]);
  useEffect(() => { load(); }, [load]);
  const act = async (fn: () => Promise<unknown>, ok: string) => { setBusy(true); setNote(null); try { await fn(); setNote({ t: ok, tone: 'ok' }); load(); onChanged(); } catch (e) { setNote({ t: errText(e), tone: 'bad' }); } finally { setBusy(false); } };
  const c = d?.counts;
  const footer = d ? <>
    {note ? <span className={'fk-note ' + note.tone} data-testid="cc-detail-note">{note.t}</span> : null}
    <button type="button" className="fk-btn ghost" onClick={() => onHealth(id)} data-testid="cc-detail-health">{tx('cc.checkThis')}</button>
    {canManage ? <button type="button" className="fk-btn ghost" disabled={busy} onClick={() => act(async () => { const r = await posCampaignCenterApi.duplicate(id); onOpenCopy(r.id); }, tx('cc.duplicated'))} data-testid="cc-duplicate">{tx('cc.duplicate')}</button> : null}
    {canManage && d.status === 'draft' ? <button type="button" className="fk-btn" onClick={() => onEdit(id)} data-testid="cc-edit">{tx('cc.continueSetup')}</button> : null}
    {canManage && d.status === 'scheduled' ? <button type="button" className="fk-btn" disabled={busy} onClick={() => act(() => posCampaignCenterApi.unschedule(id), tx('cc.unscheduled'))} data-testid="cc-unschedule">{tx('cc.unschedule')}</button> : null}
    {canManage && ['draft', 'scheduled', 'in_progress'].includes(d.status) ? (askCancel
      ? <><span className="fk-note warn">{tx('cc.cancelConfirm')}</span><button type="button" className="fk-btn danger" disabled={busy} onClick={() => { setAskCancel(false); void act(() => posCampaignsApi.cancel(id), tx('cc.cancelled')); }} data-testid="cc-cancel-yes">{tx('cc.cancelYes')}</button><button type="button" className="fk-btn ghost" onClick={() => setAskCancel(false)}>{tx('cc.keep')}</button></>
      : <button type="button" className="fk-btn danger" disabled={busy} onClick={() => setAskCancel(true)} data-testid="cc-cancel">{tx('pos.cancel')}</button>) : null}
    <button type="button" className="fk-btn primary" onClick={onClose} data-testid="cc-detail-close">{tx('cc.close')}</button>
  </> : <button type="button" className="fk-btn primary" onClick={onClose}>{tx('cc.close')}</button>;
  return (
    <FitDialog wide title={d?.name ?? tx('pos.loading')} subtitle={d ? <><Badge s={d.displayStatus} /> {d.outcome ? <span className="cc-outcome" data-testid="cc-detail-outcome">{outcomeLabel(d.outcome)}</span> : null}</> : undefined} onClose={onClose} busy={busy} testId="cc-detail" footer={footer}>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !d ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="rt-chips cc-tabs" role="tablist">{TABS.map((t) => <button type="button" role="tab" key={t} aria-selected={tab === t} className={'rt-chip' + (tab === t ? ' on' : '')} onClick={() => setTab(t)} data-testid={'cc-tab-' + t}>{tx('cc.tab.' + t)}</button>)}</div>
        <div className="cc-tabbody">
          {tab === 'overview' ? <>
            <dl className="cc-facts">
              <dt>{tx('pos.channel')}</dt><dd>{chLabel(d.channel)}</dd><dt>{tx('cc.goal')}</dt><dd>{d.goal ?? '—'}</dd>
              <dt>{tx('cc.audienceSource')}</dt><dd>{d.audienceSource === 'segment_snapshot' ? tx('cc.src.snapshot', { v: String(d.snapshotVersion) }) : tx('cc.src.estimate')}</dd>
              <dt>{tx('cc.promotion')}</dt><dd>{d.dealName ?? d.offer ?? '—'}</dd><dt>{tx('cc.createdBy')}</dt><dd>{d.createdBy ?? '—'} · {when(d.createdAt)}</dd>
              <dt>{tx('cc.approval')}</dt><dd>{d.approvedAt ? `${d.approvedBy ?? '—'} · ${when(d.approvedAt)}${d.approvalCurrent ? '' : ' · ' + tx('cc.approvalVoided')}` : tx('cc.notApproved')}</dd>
              <dt>{tx('cc.basis.scheduled')}</dt><dd>{when(d.scheduledAt)}</dd><dt>{tx('cc.basis.started')}</dt><dd>{when(d.startedAt)}</dd><dt>{tx('cc.basis.completed')}</dt><dd>{when(d.completedAt)}</dd>
            </dl>
            <div className="cc-counts" data-testid="cc-counts">
              {(['selected', 'eligible', 'excluded', 'queued', 'attempted', 'submitted', 'delivered', 'failed', 'unknown', 'booked'] as const).map((key) => (
                <div key={key} className="cc-count" title={d.definitions?.[key] ?? ''} data-testid={'cc-count-' + key}><span>{tx('cc.count.' + key)}</span>
                  <b>{key === 'selected' && c.selectedIsEstimate ? tx('cc.estimate', { n: nf(c.selected) }) : nf(c[key as keyof typeof c] as number | null)}</b></div>
              ))}
              {c.simulated > 0 ? <div className="cc-count"><span>{tx('cc.count.simulated')}</span><b>{nf(c.simulated)}</b></div> : null}
            </div>
            {d.readiness && !d.readiness.ok ? <div className="fk-note warn" data-testid="cc-readiness">{d.readiness.message}</div> : null}
            {d.exclusionReasons.length ? <div className="fk-hint">{tx('cc.excludedBecause')} {d.exclusionReasons.map((r: any) => `${tr('cc.reason.' + r.reason, r.reason)} ${r.count}`).join(' · ')}</div> : null}
            {d.sendTimeReasons.length ? <div className="fk-hint">{tx('cc.skippedAtSend')} {d.sendTimeReasons.map((r: any) => `${tr('cc.reason.' + r.reason, r.reason)} ${r.count}`).join(' · ')}</div> : null}
            {d.providerErrors.length ? <div className="fk-hint">{tx('cc.providerErrors')} {d.providerErrors.map((r: any) => `${r.code} × ${r.count}`).join(' · ')}</div> : null}
          </> : null}
          {tab === 'recipients' ? <RecipientsTab id={id} /> : null}
          {tab === 'message' ? <div className="cc-msg">{d.emailSubject ? <div><b>{tx('cc.subject')}</b> {d.emailSubject}</div> : null}<pre className="cc-pre" data-testid="cc-message">{d.messageBody ?? d.offer ?? '—'}</pre><div className="fk-hint">{tx('cc.messageVersion', { v: String(d.messageVersion) })}</div></div> : null}
          {tab === 'events' ? <EventsTab id={id} /> : null}
          {tab === 'bookings' ? <dl className="cc-facts"><dt>{tx('cc.count.booked')}</dt><dd>{nf(c.booked)}</dd><dt>{tx('cc.redemptions')}</dt><dd>{nf(c.redemptions)}</dd><dt>{tx('cc.discountGiven')}</dt><dd>{fmtMoney(c.discountCents)}</dd></dl> : null}
          {tab === 'financial' ? <dl className="cc-facts" data-testid="cc-financial">
            <dt>{tx('cc.associatedRevenue')}</dt><dd>{fmtMoney(c.associatedRevenueCents)}</dd><dt>{tx('cc.discountGiven')}</dt><dd>{fmtMoney(c.discountCents)}</dd>
            <dt>{tx('cc.providerCost')}</dt><dd>{money(c.actualCostCents)}</dd><dt>{tx('cc.budget')}</dt><dd>{fmtMoney(d.budgetCents)}</dd>
            <dt>ROI</dt><dd>{c.roi == null ? tx('cc.na') : `${c.roi}x`} <span className="fk-muted">{c.roiNote}</span></dd>
            {c.legacyRevenueCents > 0 ? <><dt>{tx('cc.legacyRevenue')}</dt><dd>{fmtMoney(c.legacyRevenueCents)}</dd></> : null}
          </dl> : null}
          {tab === 'audit' ? <AuditTab id={id} /> : null}
        </div>
      </>}
    </FitDialog>
  );
}
function RecipientsTab({ id }: { id: string }) {
  const [st, setSt] = useState('all'); const [s, setS] = useState(''); const qq = useDebounced(s, 300); const [page, setPage] = useState(1); const [size, setSize] = useState(10);
  const [d, setD] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setPage(1); }, [st, qq, size]);
  useEffect(() => { setErr(null); posCampaignCenterApi.recipients(id, { status: st, q: qq || undefined, page, pageSize: size }).then(setD).catch((e) => setErr(errText(e))); }, [id, st, qq, page, size]);
  return <>
    <div className="rt-filters">
      <select className="fk-select" value={st} onChange={(e) => setSt(e.target.value)} data-testid="cc-rec-status">{['all', 'eligible', 'excluded', 'queued', 'submitted', 'delivered', 'failed', 'skipped', 'unknown'].map((x) => <option key={x} value={x}>{tx('cc.rs.' + x)}</option>)}</select>
      <input type="search" className="fk-search" placeholder={tx('cc.searchRecipientsIn')} value={s} onChange={(e) => setS(e.target.value)} data-testid="cc-rec-search" />
    </div>
    {d?.maskedBecause ? <div className="fk-hint">{d.maskedBecause}</div> : null}
    {err ? <div className="fk-error">{err}</div> : !d ? <div className="fk-loading">{tx('pos.loading')}</div> : d.items.length === 0 ? <Empty title={tx('cc.emptyRecipients')} /> : (
      <table className="tbl" data-testid="cc-rec-table"><thead><tr><th>{tx('cc.r.customer')}</th><th>{tx('cc.r.selection')}</th><th>{tx('cc.r.consentNow')}</th><th>{tx('cc.r.send')}</th><th>{tx('cc.r.delivery')}</th><th className="num">{tx('cc.count.booked')}</th><th className="num">{tx('cc.redemptions')}</th></tr></thead>
        <tbody>{d.items.map((r: any) => <tr key={r.customerId}><td><div>{r.name ?? tx('cc.hiddenName')}</div><div className="sub">{r.contact ?? '—'}</div></td>
          <td>{r.selection === 'eligible' ? tx('cc.rs.eligible') : `${tx('cc.rs.excluded')} · ${tr('cc.reason.' + r.exclusionReason, r.exclusionReason)}`}</td>
          <td>{r.consentNow ? tx('cc.yes') : tx('cc.no')}</td><td>{r.sendStatus ? `${tx('cc.send.' + r.sendStatus)}${r.sendReason ? ' · ' + tr('cc.reason.' + r.sendReason, r.sendReason) : ''}` : '—'}</td>
          <td>{r.deliveryStatus ? tr('cc.delivery.' + r.deliveryStatus, r.deliveryStatus) : '—'}{r.providerErrorCode ? ` (${r.providerErrorCode})` : ''}</td><td className="num">{r.booked}</td><td className="num">{r.redeemed}</td></tr>)}</tbody></table>)}
    <div className="cc-foot"><label className="cp-size"><span>{tx('cc.rows')}</span><select className="fk-select" value={size} onChange={(e) => setSize(Number(e.target.value))}>{SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</select></label><Pager compact info={d?.pagination} onPage={setPage} /></div>
  </>;
}
function EventsTab({ id }: { id: string }) {
  const [page, setPage] = useState(1); const [d, setD] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setErr(null); posCampaignCenterApi.events(id, { page, pageSize: 10 }).then(setD).catch((e) => setErr(errText(e))); }, [id, page]);
  if (err) return <div className="fk-error">{err}</div>;
  if (!d) return <div className="fk-loading">{tx('pos.loading')}</div>;
  if (d.items.length === 0) return <Empty title={tx('cc.noEvents')}>{tx('cc.noEventsHint')}</Empty>;
  return <><table className="tbl" data-testid="cc-events"><thead><tr><th>{tx('cc.r.at')}</th><th>{tx('cc.r.send')}</th><th>{tx('cc.r.delivery')}</th><th>{tx('cc.r.reason')}</th><th>{tx('cc.version')}</th></tr></thead>
    <tbody>{d.items.map((e: any) => <tr key={e.id}><td>{when(e.updatedAt)}</td><td>{tx('cc.send.' + e.status)}</td><td>{e.deliveryStatus ? tr('cc.delivery.' + e.deliveryStatus, e.deliveryStatus) : '—'}{e.providerErrorCode ? ` (${e.providerErrorCode})` : ''}</td><td>{e.reason ? tr('cc.reason.' + e.reason, e.reason) : '—'}</td><td>v{e.messageVersion}</td></tr>)}</tbody></table>
    <Pager compact info={d.pagination} onPage={setPage} /></>;
}
function AuditTab({ id }: { id: string }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => { posCampaignCenterApi.audit(id).then(setD).catch(() => setD({ items: [] })); }, [id]);
  if (!d) return <div className="fk-loading">{tx('pos.loading')}</div>;
  return d.items.length === 0 ? <Empty title={tx('cc.noAudit')} /> : <ul className="fk-list dense" data-testid="cc-audit">{d.items.map((a: any, i: number) => <li key={i} className="fk-li"><div className="fk-li-main"><div className="fk-li-t">{a.summary ?? a.action}</div><div className="fk-li-s">{a.actor} · {when(a.at)}</div></div></li>)}</ul>;
}

// ── New Campaign: six steps (guide §08). Save-as-draft at every step; preview never sends; approval is a separate act. ──
const STEPS = ['details', 'audience', 'content', 'schedule', 'review', 'approval'] as const;
function WizardDialog({ id: initialId, defaultChannel, onClose }: { id?: string; defaultChannel: 'sms' | 'email'; onClose: () => void }) {
  const can = useCan(); const canManage = can('marketing.manage'); const nav = useNavigate();
  const [id, setId] = useState<string | undefined>(initialId); const [step, setStep] = useState<(typeof STEPS)[number]>('details');
  const [f, setF] = useState({ name: '', goal: '', description: '', channel: defaultChannel as string, offer: '', messageBody: '', emailSubject: '', budget: '' });
  const [d, setD] = useState<any>(null); const [sources, setSources] = useState<any[] | null>(null); const [pv, setPv] = useState<any>(null);
  const [when2, setWhen2] = useState<'now' | 'later'>('now'); const [at, setAt] = useState('');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ t: string; tone: 'ok' | 'bad' } | null>(null);
  const reload = useCallback(async (cid: string) => { const x = await posCampaignCenterApi.detail(cid); setD(x); setF((o) => ({ ...o, name: x.name, goal: x.goal ?? '', description: x.description ?? '', channel: x.channel, offer: x.offer ?? '', messageBody: x.messageBody ?? '', emailSubject: x.emailSubject ?? '', budget: x.budgetCents ? String(x.budgetCents / 100) : '' })); return x; }, []);
  useEffect(() => { if (initialId) void reload(initialId).catch((e) => setMsg({ t: errText(e), tone: 'bad' })); }, [initialId, reload]);
  useEffect(() => { if (step === 'audience') posCampaignCenterApi.audienceSources(f.channel).then((r) => setSources(r.items)).catch(() => setSources([])); if ((step === 'review' || step === 'content') && id) posCampaignCenterApi.preview(id).then(setPv).catch(() => setPv(null)); }, [step, id, f.channel]);
  const run = async (fn: () => Promise<unknown>, ok?: string) => { setBusy(true); setMsg(null); try { await fn(); if (ok) setMsg({ t: ok, tone: 'ok' }); return true; } catch (e) { setMsg({ t: errText(e), tone: 'bad' }); return false; } finally { setBusy(false); } };
  const body = () => ({ name: f.name, goal: f.goal || null, description: f.description || null, channel: f.channel, offer: f.offer || null, messageBody: f.messageBody || null, emailSubject: f.channel === 'email' ? (f.emailSubject || null) : null, budgetCents: f.budget ? Math.round(Number(f.budget) * 100) : 0 });
  const save = async () => run(async () => { if (id) { await posCampaignCenterApi.update(id, body()); await reload(id); } else { const r = await posCampaignCenterApi.create(body()); setId(r.id); await reload(r.id); } }, tx('cc.saved'));
  const next = async () => { const i = STEPS.indexOf(step); if (await save()) setStep(STEPS[Math.min(STEPS.length - 1, i + 1)]); };
  const editable = !d || d.status === 'draft';
  return (
    <FitDialog wide title={id ? (d?.name ?? tx('pos.new_campaign_2')) : tx('pos.new_campaign_2')} subtitle={tx('cc.w.sub')} onClose={onClose} busy={busy} testId="cc-wizard"
      footer={<>
        {msg ? <span className={'fk-note ' + msg.tone} data-testid="cc-w-note">{msg.t}</span> : null}
        <button type="button" className="fk-btn ghost" onClick={onClose} data-testid="cc-w-close">{tx('cc.close')}</button>
        {editable && canManage ? <button type="button" className="fk-btn" disabled={busy || !f.name.trim()} onClick={save} data-testid="cc-w-save">{tx('cc.w.saveDraft')}</button> : null}
        {step !== 'approval' && editable && canManage ? <button type="button" className="fk-btn primary" disabled={busy || !f.name.trim()} onClick={next} data-testid="cc-w-next">{tx('cc.w.next')}</button> : null}
      </>}>
      <ol className="cc-steps" aria-label={tx('cc.w.steps')}>{STEPS.map((s, i) => <li key={s}><button type="button" className={'rt-chip' + (step === s ? ' on' : '')} disabled={!id && i > 0} onClick={() => setStep(s)} data-testid={'cc-step-' + s}>{i + 1}. {tx('cc.w.' + s)}</button></li>)}</ol>
      {!editable ? <div className="fk-note warn">{tx('cc.w.notEditable')}</div> : null}
      {step === 'details' ? <div className="cc-form">
        <label>{tx('pos.name_2')}<input className="fk-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={tx('pos.spring_into_glow')} data-testid="cc-w-name" /></label>
        <label>{tx('cc.goal')}<input className="fk-input" value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} /></label>
        <label>{tx('cc.description')}<textarea className="fk-input" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <label>{tx('pos.channel')}<select className="fk-select" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} data-testid="cc-w-channel"><option value="sms">SMS</option><option value="email">{tx('pos.email')}</option></select></label>
        <label>{tx('pos.offer')}<input className="fk-input" value={f.offer} onChange={(e) => setF({ ...f, offer: e.target.value })} placeholder={tx('pos.20_off_gel_mani')} data-testid="cc-w-offer" /></label>
        <label>{tx('pos.budget_2')}<input className="fk-input" inputMode="decimal" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} placeholder="0.00" /></label>
        <div className="fk-hint">{tx('cc.w.budgetNote')}</div>
      </div> : null}
      {step === 'audience' ? <div>
        <div className="fk-hint">{tx('cc.w.audienceHelp')}</div>
        {d ? <div className="fk-note" data-testid="cc-w-audience-now">{d.audienceSource === 'segment_snapshot' ? tx('cc.w.audienceNow', { s: nf(d.counts.selected), e: nf(d.counts.eligible), x: nf(d.counts.excluded) }) : tx('cc.w.noAudience')}</div> : null}
        {!sources ? <div className="fk-loading">{tx('pos.loading')}</div> : sources.length === 0 ? <Empty title={tx('cc.w.noSources')}>{tx('cc.w.noSourcesHint')}</Empty> : (
          <ul className="fk-list" data-testid="cc-w-sources">{sources.map((s) => <li key={s.draftId} className="fk-li"><div className="fk-li-main"><div className="fk-li-t">{tx('sg.seg.' + s.segment)} · {chLabel(s.channel)}</div>
            <div className="fk-li-s">{tx('cc.w.sourceCounts', { s: nf(s.selected), e: nf(s.eligible), x: nf(s.excluded) })} · {when(s.createdAt)}</div></div>
            <div className="fk-li-acts"><button type="button" className="fk-btn" disabled={busy || !id || !editable} onClick={() => run(async () => { await posCampaignCenterApi.setAudience(id!, s.draftId); await reload(id!); }, tx('cc.w.audienceSaved'))} data-testid="cc-w-use-source">{tx('cc.w.use')}</button></div></li>)}</ul>)}
        <button type="button" className="fk-link" onClick={() => nav('/tenant/marketing/segments')} data-testid="cc-w-to-segments">{tx('cc.w.buildInSegments')}</button>
      </div> : null}
      {step === 'content' ? <div className="cc-form">
        {f.channel === 'email' ? <label>{tx('cc.subject')}<input className="fk-input" value={f.emailSubject} onChange={(e) => setF({ ...f, emailSubject: e.target.value })} data-testid="cc-w-subject" /></label> : null}
        <label>{tx('cc.w.message')}<textarea className="fk-input" rows={4} maxLength={1600} value={f.messageBody} onChange={(e) => setF({ ...f, messageBody: e.target.value })} data-testid="cc-w-message" /></label>
        <div className="cc-vars">{tx('cc.w.variables')} {['{salon_name}', '{offer}'].map((v) => <button type="button" key={v} className="fk-chip" onClick={() => setF({ ...f, messageBody: (f.messageBody + ' ' + v).trim() })}>{v}</button>)}</div>
        {pv ? <div className="fk-hint">{tx('cc.w.previewHint')} <b data-testid="cc-w-preview">{pv.asSent}</b></div> : null}
        {pv?.unknownVariables?.length ? <div className="fk-note warn">{tx('cc.w.unknownVars', { v: pv.unknownVariables.join(', ') })}</div> : null}
      </div> : null}
      {step === 'schedule' ? <div className="cc-form">
        <label className="cc-radio"><input type="radio" checked={when2 === 'now'} onChange={() => setWhen2('now')} /> {tx('cc.w.sendNow')}</label>
        <label className="cc-radio"><input type="radio" checked={when2 === 'later'} onChange={() => setWhen2('later')} /> {tx('cc.w.sendLater')}</label>
        {when2 === 'later' ? <input type="datetime-local" className="fk-input" value={at} onChange={(e) => setAt(e.target.value)} data-testid="cc-w-at" /> : null}
        <div className="fk-hint">{tx('cc.w.scheduleNote')}</div>
      </div> : null}
      {step === 'review' ? (!pv ? <div className="fk-loading">{tx('pos.loading')}</div> : <div data-testid="cc-w-review">
        <dl className="cc-facts">
          <dt>{tx('cc.count.selected')}</dt><dd>{nf(pv.selected)}</dd><dt>{tx('cc.count.eligible')}</dt><dd>{nf(pv.eligible)}</dd><dt>{tx('cc.count.excluded')}</dt><dd>{nf(pv.selected - pv.eligible)}</dd>
          {pv.segmentsPerMessage ? <><dt>{tx('cc.w.segments')}</dt><dd>{tx('cc.w.segmentsVal', { per: String(pv.segmentsPerMessage), total: nf(pv.estimatedSegments) })}</dd></> : null}
          <dt>{tx('cc.w.estCost')}</dt><dd>{money(pv.estimatedCostCents)} <span className="fk-muted">{pv.costNote}</span></dd>
        </dl>
        {pv.subject ? <div><b>{tx('cc.subject')}</b> {pv.subject}</div> : null}<pre className="cc-pre">{pv.asSent}</pre>
        <div className="fk-hint">{tx('cc.w.previewNeverSends')}</div>
      </div>) : null}
      {step === 'approval' ? <ApprovalStep id={id} d={d} at={when2 === 'later' && at ? new Date(at).toISOString() : null} busy={busy} run={run} reload={reload} onDone={onClose} />
        : null}
    </FitDialog>
  );
}
function ApprovalStep({ id, d, at, busy, run, reload, onDone }: { id?: string; d: any; at: string | null; busy: boolean; run: (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>; reload: (id: string) => Promise<any>; onDone: () => void }) {
  const can = useCan(); const canManage = can('marketing.manage');
  const [confirm, setConfirm] = useState(false);
  if (!id || !d) return <Empty title={tx('cc.w.saveFirst')} />;
  const ready = d.readiness;
  return (
    <div data-testid="cc-w-approval">
      <dl className="cc-facts">
        <dt>{tx('cc.approval')}</dt><dd data-testid="cc-w-approval-state">{d.approvedAt && d.approvalCurrent ? tx('cc.w.approvedBy', { who: d.approvedBy ?? '—', when: when(d.approvedAt) }) : d.approvedAt ? tx('cc.approvalVoided') : d.submittedAt ? tx('cc.status.awaiting_approval') : tx('cc.notApproved')}</dd>
        <dt>{tx('cc.w.readiness')}</dt><dd data-testid="cc-w-readiness">{ready?.ok ? tx('cc.w.readyToLaunch', { n: nf(ready.eligible) }) : ready?.message ?? '—'}</dd>
      </dl>
      <div className="cc-approve-row">
        {canManage && !d.submittedAt && !d.approvalCurrent ? <button type="button" className="fk-btn" disabled={busy} onClick={() => run(async () => { await posCampaignCenterApi.submit(id); await reload(id); }, tx('cc.w.submitted'))} data-testid="cc-w-submit">{tx('cc.w.requestApproval')}</button> : null}
        {canManage && !d.approvalCurrent ? <button type="button" className="fk-btn" disabled={busy} onClick={() => run(async () => { await posCampaignCenterApi.approve(id); await reload(id); }, tx('cc.w.approved'))} data-testid="cc-w-approve">{tx('cc.w.approve')}</button> : null}
      </div>
      {d.approvalCurrent && ready?.ok ? <div className="cc-launch">
        <label className="cc-radio"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} data-testid="cc-w-confirm" /> {tx('cc.w.confirmSend', { n: nf(ready.eligible), when: at ? when(at) : tx('cc.w.now') })}</label>
        <button type="button" className="fk-btn primary" disabled={busy || !confirm} onClick={async () => { if (await run(() => posCampaignCenterApi.launch(id, at), tx('cc.w.launched'))) setTimeout(onDone, 600); }} data-testid="cc-w-launch">{tx('cc.w.launch')}</button>
      </div> : null}
      <div className="fk-hint">{tx('cc.w.approvalNote')}</div>
    </div>
  );
}

// ── Check Campaign System (guide §12) — read-only ────────────────────────────────────────────────────────────────────
function HealthDialog({ id, onClose }: { id?: string; onClose: () => void }) {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  const run = useCallback(() => { setErr(null); setD(null); posCampaignCenterApi.healthCheck(id ?? null).then(setD).catch((e) => setErr(errText(e))); }, [id]);
  useEffect(() => { run(); }, [run]);
  return (
    <FitDialog wide title={tx('cc.checkSystem')} subtitle={tx('cc.h.sub')} onClose={onClose} testId="cc-health"
      footer={<><button type="button" className="fk-btn ghost" onClick={run} data-testid="cc-h-rerun">{tx('cc.h.rerun')}</button><button type="button" className="fk-btn primary" onClick={onClose} data-testid="cc-h-close">{tx('cc.close')}</button></>}>
      {err ? <ErrorRetry message={err} onRetry={run} /> : !d ? <div className="fk-loading">{tx('cc.h.checking')}</div> : <>
        <div className={'fk-note ' + (d.overall === 'ready' ? 'ok' : d.overall === 'failed' ? 'bad' : 'warn')} data-testid="cc-h-overall">{tx('cc.h.overall', { s: tx('cc.h.s.' + d.overall) })} · {when(d.observedAt)} · {tx('cc.h.noSend')}</div>
        <ul className="fk-list" data-testid="cc-h-findings">{d.findings.map((x: any, i: number) => <li key={i} className="fk-li"><div className="fk-li-main"><div className="fk-li-t"><span className={'fk-chip ' + (x.status === 'ready' ? 'ok' : x.status === 'failed' ? 'bad' : 'warn')}>{tx('cc.h.s.' + x.status)}</span> {tr('cc.h.sys.' + x.subsystem, x.subsystem)}</div>
          <div className="fk-li-s">{x.summary}</div><div className="fk-li-s fk-muted">{x.evidence}</div>{x.nextStep ? <div className="fk-li-s"><b>{tx('cc.h.next')}</b> {x.nextStep}</div> : null}</div></li>)}</ul>
        {d.trace ? <div className="fk-hint" data-testid="cc-h-trace">{tx('cc.h.trace')} {Object.entries(d.trace).filter(([, v]) => v != null && typeof v !== 'object').map(([kk, v]) => `${kk}: ${String(v)}`).join(' · ')}</div> : null}
      </>}
    </FitDialog>
  );
}

// ── Campaign Assistant (guide §14) — suggestions + drafts only ─────────────────────────────────────────────────────────
function AssistantDialog({ canManage, initialGoal, onClose, onDraft }: { canManage: boolean; initialGoal?: string; onClose: () => void; onDraft: (id: string) => void }) {
  const [goal, setGoal] = useState<string>(initialGoal ?? 'inactive'); const [s, setS] = useState<any>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [name, setName] = useState(''); const [body, setBody] = useState('');
  useEffect(() => { setErr(null); setS(null); posCampaignCenterApi.suggest(goal).then((x) => { setS(x); setName(x.suggestedName); setBody(x.messageDraft); }).catch((e) => setErr(errText(e))); }, [goal]);
  const save = async () => { setBusy(true); try { const r = await posCampaignCenterApi.saveSuggestion({ goal, name, messageBody: body }); onDraft(r.id); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } };
  return (
    <FitDialog wide title={tx('cc.assistant')} subtitle={tx('cc.a.sub')} onClose={onClose} busy={busy} testId="cc-assistant"
      footer={<><button type="button" className="fk-btn ghost" onClick={onClose}>{tx('cc.close')}</button>{canManage ? <button type="button" className="fk-btn primary" disabled={busy || !s} onClick={save} data-testid="cc-a-save">{tx('cc.a.saveDraft')}</button> : null}</>}>
      <div className="rt-chips">{GOALS.map((g) => <button type="button" key={g} className={'rt-chip' + (goal === g ? ' on' : '')} onClick={() => setGoal(g)} data-testid={'cc-a-goal-' + g}>{tx('cc.a.goal.' + g)}</button>)}</div>
      {err ? <div className="fk-error">{err}</div> : !s ? <div className="fk-loading">{tx('pos.loading')}</div> : <div className="cc-form" data-testid="cc-a-result">
        <div className="fk-note">{tx('cc.a.isSuggestion')}</div>
        <label>{tx('pos.name_2')}<input className="fk-input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <div><b>{tx('pos.audience')}</b> {s.audience}</div>
        <div data-testid="cc-a-count"><b>{tx('cc.a.liveCount')}</b> {nf(s.liveEligibleEstimate)}</div>
        <label>{tx('cc.w.message')}<textarea className="fk-input" rows={3} value={body} onChange={(e) => setBody(e.target.value)} /></label>
        <div><b>{tx('cc.a.when')}</b> {s.schedule}</div>
        <div><b>{tx('cc.w.estCost')}</b> {money(s.estimatedCostCents)} <span className="fk-muted">{s.costNote}</span></div>
        <ul className="cc-risks">{s.risks.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul>
      </div>}
    </FitDialog>
  );
}

export default POSCampaignCenterScreen;
