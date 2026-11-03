// POSAICampaignResultsScreen.tsx — AI Center → AI Marketing → Campaign Results (/tenant/ai/marketing/results). Campaign Results guide
// (Nov 3 2026). Before: a plain list of every campaign (no search, no pages) and a per-campaign card read from the old counters —
// "Sent" from campaigns.sent_count (which nothing wrote), "Message cost" = the campaign's BUDGET, and open / click rates for text
// messages that have no open event. Now:
//   • the period totals (salon time): messages accepted / delivered / failed, campaign-link bookings and the visits they became,
//     associated revenue on paid tickets that redeemed a campaign code, provider cost and cost per booking (N/A when 0 bookings);
//   • Campaign Center's campaign list (search · status · channel · period · numbered pages, newest first);
//   • per campaign, every stage from its own source — the audience snapshot, the send ledger, the provider's delivery report,
//     booking-link conversions, code redemptions on paid tickets — with what each figure is checked against.
// Loading or refreshing this page never sends, schedules or changes a campaign.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { KpiCard, ErrorRetry, FitDialog } from '../components/FitKit';
import { MkPeriodBar, MkHealthButton, CampaignLibrary, mt, mkErr, mkMoney, mkNum, mkWhen, type MkPeriod } from '../components/MarketingKit';
import { posAIMarketingApi } from '../api/posAIMarketingApi';
import { posCampaignCenterApi } from '../api/posCampaignCenterApi';

const STAGES = ['selected', 'eligible', 'excluded', 'queued', 'attempted', 'submitted', 'delivered', 'failed', 'unknown', 'simulated', 'skippedAtSend', 'booked', 'redemptions'] as const;

export function POSAICampaignResultsScreen() {
  const [period, setPeriod] = useState<MkPeriod>({ preset: 'month' });
  const [s, setS] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState<any>(null);
  const load = useCallback(() => { setErr(null); posAIMarketingApi.center.summary(period).then(setS).catch((e) => setErr(mkErr(e))); }, [period]);
  useEffect(() => { load(); }, [load, tick]);
  const k = s?.cards;
  const cards = [
    { key: 'sent', v: mkNum(k?.messagesSent), sub: k ? mt('amk.kpi.delivered', { d: mkNum(k.delivered), f: mkNum(k.failed) }) : undefined },
    { key: 'bookings', v: mkNum(k?.bookings), sub: k ? mt('amk.kpi.completed', { n: mkNum(k.completedVisits) }) : undefined },
    { key: 'revenue', v: mkMoney(k?.associatedRevenueCents), sub: k ? mt('amk.res.tickets', { n: mkNum(k.associatedTickets) }) : undefined },
    { key: 'spent', v: k ? (k.actualCostCents == null ? mt('amk.notReported') : mkMoney(k.actualCostCents)) : '—' },
    { key: 'costPerBooking', v: k?.costPerBookingCents == null ? mt('amk.na') : mkMoney(k.costPerBookingCents) },
  ];
  return (
    <div className="work rvw" data-testid="amk-results">
      <div className="rvw-head">
        <div className="vh"><h1>{mt('amk.res.title')}</h1><div className="sub">{mt('amk.res.sub')}</div></div>
        <div className="rvw-actions">
          <button type="button" className="btn ghost" data-testid="amk-refresh" onClick={() => setTick((n) => n + 1)}>{mt('amk.refresh')}</button>
          <MkHealthButton />
        </div>
      </div>
      <MkPeriodBar value={period} onChange={setPeriod} today={s?.period?.today} />
      {err ? <ErrorRetry message={err} onRetry={load} /> : null}
      <div className="amk-kpis" data-testid="amk-res-kpis">
        {cards.map((c) => <KpiCard key={c.key} testId={`amk-res-${c.key}`} label={mt('amk.kpi.' + c.key)} value={s ? c.v : '—'} sub={c.sub} loading={!s && !err} />)}
      </div>
      {s ? <p className="sub">{s.definitions?.associatedRevenue ? mt('amk.associated') : null} {mt('amk.res.basis')}</p> : null}
      <CampaignLibrary tick={tick} title={mt('amk.res.list')} onOpen={setOpen} />
      {open ? <CampaignFunnel id={open.id} name={open.name} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function CampaignFunnel({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { let on = true; setErr(null); posCampaignCenterApi.detail(id).then((x) => on && setD(x)).catch((e) => on && setErr(mkErr(e))); return () => { on = false; }; }, [id, tick]);
  const c = d?.counts;
  return (
    <FitDialog wide testId="amk-res-detail" title={name} onClose={onClose}
      footer={<><Link className="btn" to={`/tenant/marketing/campaigns?q=${encodeURIComponent(id)}`}>{mt('amk.res.openCenter')}</Link><button className="btn ghost" onClick={onClose}>{mt('amk.close')}</button></>}>
      {err ? <ErrorRetry message={err} onRetry={() => setTick((n) => n + 1)} /> : !d ? <div className="state">{mt('amk.loading')}</div> : <>
        <p className="sub">{mt('amk.cst.' + d.displayStatus)}{d.outcome ? ` · ${mt('amk.outcome.' + d.outcome)}` : ''} · {mt('amk.channel.' + d.channel)} · {mkWhen(d.createdAt)}</p>
        <table className="tbl"><thead><tr><th>{mt('amk.res.stage')}</th><th className="num">{mt('amk.res.count')}</th><th>{mt('amk.res.source')}</th></tr></thead><tbody>
          {STAGES.map((st) => <tr key={st} data-testid={`amk-stage-${st}`}><td>{mt('amk.stage.' + st)}</td><td className="num">{c[st] == null ? '—' : mkNum(c[st])}</td><td className="sub">{mt('amk.stageSrc.' + st)}</td></tr>)}
          <tr><td>{mt('amk.stage.revenue')}</td><td className="num">{mkMoney(c.associatedRevenueCents)}</td><td className="sub">{mt('amk.stageSrc.revenue')}</td></tr>
          <tr><td>{mt('amk.stage.cost')}</td><td className="num" data-testid="amk-stage-cost">{c.actualCostCents == null ? (c.submitted ? mt('amk.notReported') : mkMoney(0)) : mkMoney(c.actualCostCents)}</td><td className="sub">{mt('amk.stageSrc.cost')}</td></tr>
          <tr><td>{mt('amk.stage.budget')}</td><td className="num">{mkMoney(d.budgetCents)}</td><td className="sub">{mt('amk.stageSrc.budget')}</td></tr>
          <tr><td>{mt('amk.stage.costPerBooking')}</td><td className="num">{c.actualCostCents && c.booked ? mkMoney(Math.round(c.actualCostCents / c.booked)) : mt('amk.na')}</td><td className="sub">{mt('amk.stageSrc.costPerBooking')}</td></tr>
        </tbody></table>
        {c.selectedIsEstimate ? <p className="sub">{mt('amk.res.estimateNote')}</p> : null}
        {c.legacySentCount !== c.submitted && c.legacySentCount ? <p className="sub">{mt('amk.res.legacy', { o: mkNum(c.legacySentCount), n: mkNum(c.submitted) })}</p> : null}
        <p className="sub">{mt('amk.associated')}</p>
      </>}
    </FitDialog>
  );
}
