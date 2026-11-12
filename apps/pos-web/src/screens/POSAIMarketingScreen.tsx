// POSAIMarketingScreen.tsx — AI Center → AI Marketing Assistant (/tenant/ai/marketing). AI Marketing Assistant guide (Nov 3 2026).
// Keeps the photographed page — seven cards, Reach & Consent, Recommended Campaigns, "reviewed and approved before anything sends",
// "associated, not caused" — and fills it with verified numbers:
//   • the cards take a period (presets + From/To month calendar, salon time), each with one event time;
//   • Reach & Consent shows opted in vs actually reachable (contact + not opted out), overlap and union;
//   • "Message cost" is the provider cost of messages actually sent; campaign BUDGETS are shown separately (the photographed
//     "$100.00 with 0 sent" was a budget summed as cost);
//   • recommendations come from the Customer Retention rule and the Segments consent verdict, with the eligibility funnel;
//   • the campaign library is Campaign Center's (search · status · channel · period · numbered pages, newest first);
//   • Check AI Marketing System (read-only).
// Nothing here sends, schedules or approves; drafts are saved into Campaign Center from the Campaign Builder.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { KpiCard, ErrorRetry, FitDialog } from '../components/FitKit';
import { MkPeriodBar, MkHealthButton, MkFunnel, CampaignLibrary, mt, mkErr, mkMoney, mkNum, mkWhen, type MkPeriod } from '../components/MarketingKit';
import { posAIMarketingApi, type MkKind } from '../api/posAIMarketingApi';


export function POSAIMarketingScreen() {
  const [period, setPeriod] = useState<MkPeriod>({ preset: 'month' });
  const [tick, setTick] = useState(0);
  const [s, setS] = useState<any>(null);
  const [sErr, setSErr] = useState<string | null>(null);
  const [channel, setChannel] = useState<'sms' | 'email'>('sms');
  const [recs, setRecs] = useState<any>(null);
  const [rErr, setRErr] = useState<string | null>(null);
  const [funnel, setFunnel] = useState<MkKind | null>(null);
  const nav = useNavigate();
  // AI Marketing 10 — Source verification: each card opens the existing source it is counted from (no new ledger):
  // the campaign cards → Campaign Center's list below with the card's own status set; message / booking / revenue / cost
  // cards → Campaign Results for the same period (per-campaign send ledger, delivery reports, bookings, redemptions).
  const [libFocus, setLibFocus] = useState<{ status: string; n: number } | null>(null);
  const LIB_STATUS: Record<string, string> = { active: 'sending', scheduled: 'scheduled', drafts: 'all_drafts' };
  const openSource = (key: string) => {
    if (LIB_STATUS[key]) { setLibFocus((x) => ({ status: LIB_STATUS[key], n: (x?.n ?? 0) + 1 })); return; }
    const qs = new URLSearchParams({ preset: period.preset, ...(period.from ? { from: period.from } : {}), ...(period.to ? { to: period.to } : {}) });
    nav(`/tenant/ai/marketing/results?${qs.toString()}`);
  };

  const loadS = useCallback(() => { setSErr(null); posAIMarketingApi.center.summary(period).then(setS).catch((e) => setSErr(mkErr(e))); }, [period]);
  useEffect(() => { loadS(); }, [loadS, tick]);
  const loadR = useCallback(() => { setRErr(null); setRecs(null); posAIMarketingApi.center.recommendations(channel).then(setRecs).catch((e) => setRErr(mkErr(e))); }, [channel]);
  useEffect(() => { loadR(); }, [loadR, tick]);

  const k = s?.cards; const reach = s?.reach; const cost = s?.cost;
  const cards: { key: string; v: string; sub?: string }[] = [
    { key: 'active', v: mkNum(k?.activeCampaigns) },
    { key: 'scheduled', v: mkNum(k?.scheduledCampaigns) },
    { key: 'drafts', v: mkNum(k?.draftCampaigns), sub: k?.awaitingApproval ? mt('amk.kpi.awaiting', { n: k.awaitingApproval }) : undefined },
    { key: 'sent', v: mkNum(k?.messagesSent), sub: k ? mt('amk.kpi.delivered', { d: mkNum(k.delivered), f: mkNum(k.failed) }) : undefined },
    { key: 'bookings', v: mkNum(k?.bookings), sub: k ? mt('amk.kpi.completed', { n: mkNum(k.completedVisits) }) : undefined },
    { key: 'revenue', v: mkMoney(k?.associatedRevenueCents) },
    { key: 'costPerBooking', v: k?.costPerBookingCents == null ? mt('amk.na') : mkMoney(k.costPerBookingCents) },
  ];
  return (
    <div className="work rvw" data-testid="amk-screen">
      <div className="rvw-head">
        <div className="vh">
          <h1>{mt('amk.title')}</h1>
          <div className="sub">{mt('amk.policy')}</div>
          {s ? <div className="sub" data-testid="amk-updated">{mt('amk.updated', { at: mkWhen(s.generatedAt), tz: s.period?.timeZone ?? '' })}</div> : null}
        </div>
        <div className="rvw-actions">
          <button type="button" className="btn ghost" data-testid="amk-refresh" onClick={() => setTick((n) => n + 1)}>{mt('amk.refresh')}</button>
          <MkHealthButton />
          <Link className="btn" to="/tenant/ai/marketing/builder">{mt('amk.openBuilder')}</Link>
        </div>
      </div>

      <MkPeriodBar value={period} onChange={setPeriod} today={s?.period?.today} />
      {sErr ? <ErrorRetry message={sErr} onRetry={loadS} /> : null}
      <div className="amk-kpis" data-testid="amk-kpis">
        {cards.map((c) => <KpiCard key={c.key} testId={`amk-kpi-${c.key}`} label={mt('amk.kpi.' + c.key)} value={s ? c.v : '—'} sub={c.sub} loading={!s && !sErr} onClick={() => openSource(c.key)} />)}
      </div>
      <p className="sub" data-testid="amk-source-note">{mt('amk.sourceNote')}</p>
      {k && !k.costComplete ? <p className="sub" data-testid="amk-cost-partial">{mt('amk.costPartial', { n: mkNum(k.costedMessages), t: mkNum(k.messagesSent) })}</p> : null}

      <div className="rvw-analysis">
        <section className="panel" style={{ padding: 12 }} data-testid="amk-reach">
          <div className="p-h">{mt('amk.reach.title')}</div>
          {!reach ? <div className="state">{sErr ? '—' : mt('amk.loading')}</div> : <table className="tbl"><tbody>
            <tr><td>{mt('amk.reach.smsIn')}</td><td className="num" data-testid="amk-sms-in">{mkNum(reach.sms.optedIn)}</td></tr>
            <tr><td className="sub">{mt('amk.reach.reachable')}</td><td className="num" data-testid="amk-sms-ok">{mkNum(reach.sms.reachable)}</td></tr>
            <tr><td>{mt('amk.reach.emailIn')}</td><td className="num">{mkNum(reach.email.optedIn)}</td></tr>
            <tr><td className="sub">{mt('amk.reach.reachable')}</td><td className="num">{mkNum(reach.email.reachable)}</td></tr>
            <tr><td>{mt('amk.reach.suppressed')}</td><td className="num">{mkNum(reach.suppressed.total)}</td></tr>
            <tr><td>{mt('amk.reach.either')}</td><td className="num" data-testid="amk-either">{mkNum(reach.reachableEither)}</td></tr>
            <tr><td className="sub">{mt('amk.reach.both')}</td><td className="num">{mkNum(reach.reachableBoth)}</td></tr>
            <tr><td>{mt('amk.reach.spent')}</td><td className="num" data-testid="amk-spent">{k?.actualCostCents == null ? mt('amk.notReported') : mkMoney(k.actualCostCents)}</td></tr>
            <tr><td className="sub">{mt('amk.reach.budgets')}</td><td className="num" data-testid="amk-budgets">{mkMoney(cost?.budgetsCents)}</td></tr>
          </tbody></table>}
          {cost && cost.explanation !== 'none' ? <p className="sub" data-testid="amk-cost-expl">{mt('amk.costExpl.' + cost.explanation, { b: mkMoney(cost.budgetsCents), n: mkNum(cost.campaignsWithBudget) })}</p> : null}
          <p className="sub">{mt('amk.reach.noteNoContact', { s: mkNum(reach?.sms.noContact), o: mkNum(reach?.sms.optedOut) })}</p>
          <p className="sub">{mt('amk.associated')}</p>
        </section>

        <section className="panel" style={{ padding: 12, minWidth: 0 }} data-testid="amk-recs">
          <div className="p-h" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <span>{mt('amk.recs.title')}</span>
            <span className="rvw-dates">{(['sms', 'email'] as const).map((c) => <button key={c} type="button" className={'btn ghost' + (channel === c ? ' on' : '')} data-testid={`amk-rch-${c}`} onClick={() => setChannel(c)}>{mt('amk.channel.' + c)}</button>)}</span>
          </div>
          {rErr ? <ErrorRetry message={rErr} onRetry={loadR} /> : !recs ? <div className="state">{mt('amk.loading')}</div> : (
            <div className="amk-recs">{recs.items.map((r: any) => (
              <div key={r.kind} className="amk-rec" data-testid={`amk-rec-${r.kind}`}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <b>{mt('amk.kind.' + r.kind)}</b>
                  <span className={'chip ' + (r.status === 'ready' ? 'ok' : r.status === 'unavailable' ? 'bad' : '')} data-testid="amk-rec-status">{mt('amk.recStatus.' + r.status)}</span>
                </div>
                {r.status === 'unavailable' ? <div className="err">{mt('amk.recUnavailable')}</div> : <>
                  <div className="sub">{r.criteria}</div>
                  <div className="amk-rec-n">{mt('amk.recCounts', { m: mkNum(r.matched), e: mkNum(r.eligible), x: mkNum(r.excludedTotal) })}</div>
                  {r.status === 'no_match' ? <div className="sub">{mt('amk.why.no_match.' + r.kind)}</div> : null}
                  {r.topExclusion ? <div className="sub" data-testid="amk-rec-why">{mt('amk.why.no_eligible', { r: mt('amk.reason.' + r.topExclusion.reason), n: mkNum(r.topExclusion.count) })}</div> : null}
                  {r.kind === 'winback' && r.neverVisited ? <div className="sub">{mt('amk.neverVisited', { n: mkNum(r.neverVisited) })}</div> : null}
                  {r.status === 'ready' ? <div className="sub">{r.estimatedCostCents != null ? mt('amk.recCost', { m: mkMoney(r.estimatedCostCents) }) : mt('amk.recCostNone')}</div> : null}
                  <div className="rvw-actions" style={{ marginTop: 6 }}>
                    <button type="button" className="btn ghost" data-testid={`amk-view-${r.kind}`} onClick={() => setFunnel(r.kind)}>{mt('amk.viewEligibility')}</button>
                    {r.openTo ? <Link className="btn ghost" to={r.openTo}>{mt('amk.openBirthdays')}</Link>
                      : r.canSaveDraft ? <Link className="btn" data-testid={`amk-build-${r.kind}`} to={`/tenant/ai/marketing/builder?kind=${r.kind}&channel=${channel}`}>{mt('amk.buildDraft')}</Link> : null}
                  </div>
                </>}
              </div>))}
            </div>)}
          <p className="sub">{mt('amk.recs.note')}</p>
        </section>
      </div>

      <CampaignLibrary tick={tick} focus={libFocus} />
      {funnel ? <FitDialog wide testId="amk-funnel-dialog" title={mt('amk.funnelTitle', { k: mt('amk.kind.' + funnel) })} onClose={() => setFunnel(null)}
        footer={<button className="btn ghost" onClick={() => setFunnel(null)}>{mt('amk.close')}</button>}>
        <MkFunnel kind={funnel} channel="both" />
      </FitDialog> : null}
    </div>
  );
}
