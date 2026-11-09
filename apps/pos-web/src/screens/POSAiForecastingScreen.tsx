// POSAiForecastingScreen.tsx — AI Center → AI Analytics & Forecasting. Read-only workspace over the forecasting engine:
// Appointment and Revenue forecasts (point + 80% prediction interval band, model + backtested accuracy + confidence),
// and an operational No-Show risk list (transparent reason codes + permitted, non-punitive actions). Nothing here is an
// action; forecasts are labeled decision-support, never guarantees. Honest states: insufficient history / permission /
// error render clearly; nulls (e.g. un-backtested accuracy) show as “—”, never fabricated.
import { useCallback, useEffect, useState } from 'react';
import { posAiForecastingApi } from '../api/posAiForecastingApi';
import { money, reportError } from './reportsCommon';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

import { growthCode } from './growthLabels';
import { ForecastHistory, ForecastCheckButton } from './ForecastHistory';
import { fmtInZone, fmtNumber } from '../i18n/format';   // the location's clock (not the device's)
import { KpiCard } from '../components/FitKit';
type Tab = 'appointments' | 'revenue' | 'noshow';
const TABS = (): [Tab, string][] => [['appointments', tx('growth.aiForecast.tab.appointments')], ['revenue', tx('growth.aiForecast.tab.revenue')], ['noshow', tx('growth.aiForecast.tab.noshow')]];
const titleCase = (s: string) => growthCode(s, 'level');
const pct = (w: number | null | undefined) => (w == null ? '—' : `${(w * 100).toFixed(1)}%`);

const LEVEL_COLOR: Record<string, string> = {
  very_high: '#B85B4D', high: '#C6772E', moderate: '#D09A36', low: 'var(--muted)', insufficient_data: 'var(--muted)',
};

// Compact confidence-band chart: shaded lower..upper band with the point line. Pure SVG, no deps.
function BandChart({ horizon, fmt }: { horizon: any[]; fmt: (n: number) => string }) {
  if (!horizon || horizon.length === 0) return null;
  const W = 640, H = 140, pad = 28;
  const ys = horizon.flatMap((h) => [h.lower ?? h.lowerCents ?? 0, h.upper ?? h.upperCents ?? 0]);
  const max = Math.max(1, ...ys), min = Math.min(0, ...ys);
  const x = (i: number) => pad + (i * (W - 2 * pad)) / Math.max(1, horizon.length - 1);
  const y = (v: number) => H - pad - ((v - min) / (max - min || 1)) * (H - 2 * pad);
  const P = (sel: (h: any) => number) => horizon.map((h, i) => `${x(i)},${y(sel(h))}`).join(' ');
  const pt = (h: any) => (h.point ?? h.pointCents ?? h.demand ?? 0);
  const lo = (h: any) => (h.lower ?? h.lowerCents ?? 0);
  const hi = (h: any) => (h.upper ?? h.upperCents ?? 0);
  const band = `${horizon.map((h, i) => `${x(i)},${y(hi(h))}`).join(' ')} ${horizon.slice().reverse().map((h, i) => `${x(horizon.length - 1 - i)},${y(lo(h))}`).join(' ')}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="140" role="img" aria-label={tx('pos.forecast_with_prediction_interval')}>
      <polygon points={band} fill="var(--aps-orange)" opacity="0.12" />
      <polyline points={P(hi)} fill="none" stroke="var(--aps-orange)" strokeWidth="1" opacity="0.35" strokeDasharray="3 3" />
      <polyline points={P(lo)} fill="none" stroke="var(--aps-orange)" strokeWidth="1" opacity="0.35" strokeDasharray="3 3" />
      <polyline points={P(pt)} fill="none" stroke="var(--aps-orange)" strokeWidth="2" />
      <text x={pad} y={H - 6} fontSize="10" fill="var(--muted)">{horizon[0]?.date}</text>
      <text x={W - pad} y={H - 6} fontSize="10" fill="var(--muted)" textAnchor="end">{horizon[horizon.length - 1]?.date}</text>
      <text x={pad} y={14} fontSize="10" fill="var(--muted)">{fmt(max)}</text>
    </svg>
  );
}

function ForecastView({ data, kind, accuracy }: { data: any; kind: 'appointments' | 'revenue'; accuracy?: any }) {
  const isMoney = kind === 'revenue';
  const fmt = (n: number) => (isMoney ? money(n) : String(Math.round(n)));
  const total = isMoney ? data.forecastTotalCents : data.horizon.reduce((a: number, h: any) => a + (h.point ?? 0), 0);
  const trackedPct = (w: number | null | undefined) => (w == null ? null : `${(w * 100).toFixed(1)}%`);
  return (
    <>
      {accuracy && (
        <div className="panel" style={{ padding: '8px 12px', marginBottom: 10, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="sub" style={{ fontWeight: 600 }}>{tx('pos.tracked_accuracy')}</span>
          {accuracy.evaluated > 0 ? (
            <>
              <span className="sub">{tx('pos.realized_wape')}{' '}<b>{trackedPct(accuracy.wape)}</b></span>
              <span className="sub">{tx('pos.interval_coverage')}{' '}<b>{accuracy.coverage == null ? '—' : `${(accuracy.coverage * 100).toFixed(0)}%`}</b></span>
              <span className="sub">{accuracy.evaluated} {tx('pos.day_s_evaluated')}</span>
            </>
          ) : <span className="sub">{accuracy.note}</span>}
        </div>
      )}
      <div className="kpis">
        <div className="kpi"><div className="k-l">{tx('pos.model')}</div><div className="k-v" style={{ fontSize: 18 }}>{titleCase(data.method)}</div></div>
        <div className="kpi"><div className="k-l">{tx('pos.confidence_3')}</div><div className="k-v" style={{ fontSize: 18, color: LEVEL_COLOR[data.confidence] }}>{titleCase(data.confidence)}</div></div>
        <div className="kpi"><div className="k-l">{tx('pos.backtest_wape')}</div><div className="k-v" style={{ fontSize: 18 }}>{pct(data.accuracy?.wape)}</div></div>
        <div className="kpi"><div className="k-l">{tx('pos.data_quality')}</div><div className="k-v" style={{ fontSize: 18 }}>{titleCase(data.dataQuality)}</div></div>
        <div className="kpi"><div className="k-l">{data.horizonDays}{tx('pos.day_total')}</div><div className="k-v" style={{ fontSize: 18 }}>{fmt(total)}</div></div>
      </div>
      <div className="panel" style={{ padding: 12, marginTop: 12 }}>
        <div className="sub" style={{ marginBottom: 6 }}>{data.horizonDays}{tx('pos.day_forecast_shaded_band_80_prediction_1hs5')}</div>
        <BandChart horizon={data.horizon} fmt={fmt} />
      </div>
      <section className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
        <div className="overflow-x-auto w-full"><table className="tbl w-full min-w-max">
          <thead><tr><th>{tx('pos.date')}</th><th>{tx('pos.forecast')}</th><th>{tx('pos.low_80')}</th><th>{tx('pos.high_80')}</th></tr></thead>
          <tbody>
            {data.horizon.map((h: any) => (
              <tr key={h.step}>
                <td>{h.date}</td>
                <td>{fmt(h.point ?? h.pointCents)}</td>
                <td>{fmt(h.lower ?? h.lowerCents)}</td>
                <td>{fmt(h.upper ?? h.upperCents)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>
      <div className="sub" style={{ marginTop: 10 }}>{data.selectionReason} · {data.disclaimer}</div>
    </>
  );
}

function NoShowView({ data }: { data: any }) {
  if (!data.items || data.items.length === 0) return <div className="state">{tx('pos.no_upcoming_appointments_to_assess')}</div>;
  return (
    <>
      <div className="sub" style={{ marginBottom: 10 }}>{tx('pos.model')}{' '}{data.modelVersion} · {data.disclaimer}</div>
      <section className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="overflow-x-auto w-full"><table className="tbl w-full min-w-max">
          <thead><tr><th>{tx('pos.when')}</th><th>{tx('pos.customer')}</th><th>{tx('pos.risk')}</th><th>{tx('pos.why')}</th><th>{tx('pos.suggested_non_punitive')}</th></tr></thead>
          <tbody>
            {data.items.map((i: any) => (
              <tr key={i.appointmentId}>
                <td>{fmtInZone(i.startTime, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                <td>{i.customerName || '—'}</td>
                <td><span className="chip" style={{ color: LEVEL_COLOR[i.level], borderColor: LEVEL_COLOR[i.level] }}>{titleCase(i.level)}</span><div className="sub">{tx('pos.conf')}{' '}{titleCase(i.confidence)}</div></td>
                <td><div className="sub">{i.reasons.map((r: any) => r.label).join('; ') || '—'}</div></td>
                <td><div className="sub">{i.permittedActions.join('; ')}</div></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>
    </>
  );
}

export function POSAiForecastingScreen() {
  const [tab, setTab] = useState<Tab>('appointments');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [appt, setAppt] = useState<any | null>(null);
  const [rev, setRev] = useState<any | null>(null);
  const [acc, setAcc] = useState<Record<string, any>>({});
  const [ns, setNs] = useState<any | null>(null);
  // how much verified history each forecast has — the same series the forecast uses (AI Analytics & Forecasting guide, Nov 2026)
  const [ready, setReady] = useState<any | null>(null);
  const [readyErr, setReadyErr] = useState<string | null>(null);
  useEffect(() => { posAiForecastingApi.readiness().then(setReady).catch((e: any) => setReadyErr(reportError(e, tx('fcx.readiness')))); }, []);
  const [lastRun, setLastRun] = useState<Record<string, string | null> | null>(null);   // Last Forecast card (forecast history)
  useEffect(() => { posAiForecastingApi.center.summary().then((d: any) => setLastRun(d?.lastRun ?? {})).catch(() => setLastRun(null)); }, []);

  const load = useCallback((t: Tab) => {
    setLoading(true); setError(null);
    const call = t === 'appointments' ? posAiForecastingApi.appointments().then(setAppt)
      : t === 'revenue' ? posAiForecastingApi.revenue().then(setRev)
        : posAiForecastingApi.noShowRisk().then(setNs);
    // Tracked (realized) accuracy is secondary — never block or fail the forecast on it.
    if (t === 'appointments' || t === 'revenue') {
      posAiForecastingApi.accuracy(t).then((a: any) => setAcc((prev) => ({ ...prev, [t]: a }))).catch(() => {});
    }
    call.catch((e: any) => setError(reportError(e, tx('growth.noun.theForecast')))).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(tab); }, [tab, load]);

  return (
    <div className="work">
      <div className="vh flex flex-col xl:flex-row gap-3 justify-between">
        <div>
          <h1>{tx('pos.ai_analytics_forecasting')}</h1>
        <div className="sub mb-3">{tx('pos.statistical_forecasts_from_your_own_history_1vwb')}</div>
        </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }} data-testid="fcx-modes">
        {TABS().map(([id, label]) => (
          <button className={"btn w-fit whitespace-nowrap " + (tab === id ? "active" : "")} key={id} aria-pressed={tab === id} data-testid={`fcx-mode-${id}`}
            onClick={() => setTab(id)}>{label}</button>
        ))}
        <ForecastCheckButton />
      </div>
      </div>


      {/* SUNMI addendum (Nov 8 2026) + original §C "Data Readiness Cards": six even cards for the selected mode, every value
          read from the source (No-Show Risk reads the booking history) — Available History, Required History, Valid Records,
          Forecast Readiness, Last Forecast, Data Quality. A role without the financial permission is told so, not shown zeros. */}
      <section className="panel fcx-ready-panel" style={{ padding: 12, marginBottom: 12 }} data-testid="fcx-readiness">
        <div className="p-h">{tx('fcx.readiness')} · {tx('growth.aiForecast.tab.' + tab)}{ready ? ` · ${tx('fcx.source.' + ready.sources[tab === 'revenue' ? 'revenue' : 'appointments'])}` : ''}</div>
        {readyErr ? <div className="err">{readyErr}</div> : !ready ? <div className="state">{tx('pos.loading')}</div> : (() => {
          const d = tab === 'revenue' ? 'revenue' : 'appointments'; const r = ready[d];
          if (r.restricted) return <div className="sub" data-testid="fcx-restricted">{tx('fcx.restricted')}</div>;
          const valid = Math.max(0, r.historyDays - (r.zeroDays ?? 0));
          const last = lastRun ? lastRun[tab] ?? lastRun[d] ?? null : undefined;
          return <div className="fcx-ready6" data-testid="fcx-ready-cards">
            <KpiCard testId="fcx-r-available" label={tx('fcx.r.available')} value={tx('fcx.daysN', { n: fmtNumber(r.historyDays) })} sub={r.firstDay ? tx('fcx.since', { d: r.firstDay }) : tx('fcx.noHistory')} />
            <KpiCard testId="fcx-r-required" label={tx('fcx.r.required')} value={tx('fcx.daysN', { n: fmtNumber(r.minimum) })} sub={tx('fcx.r.requiredSub')} />
            <KpiCard testId="fcx-r-valid" label={tx('fcx.r.valid')} value={tx('fcx.daysN', { n: fmtNumber(valid) })} sub={tx('fcx.r.validSub')} />
            <KpiCard testId="fcx-r-ready" label={tx('fcx.r.ready')} tone={r.ready ? 'ok' : 'warn'} value={r.ready ? tx('fcx.r.readyYes') : tx('fcx.r.readyNo')} sub={r.ready ? tx('fcx.ready') : tx('fcx.short', { n: String(r.daysShort) })} />
            <KpiCard testId="fcx-r-last" label={tx('fcx.r.last')} value={last === undefined ? '—' : last ? fmtInZone(last, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : tx('fch.never')} sub={last === undefined ? tx('fcx.r.lastUnknown') : tx('fcx.r.lastSub')} />
            <KpiCard testId="fcx-r-quality" label={tx('fcx.r.quality')} tone={r.zeroDays ? 'warn' : r.historyDays ? 'ok' : undefined} value={!r.historyDays ? '—' : r.zeroDays ? tx('fcx.r.gaps', { n: fmtNumber(r.zeroDays) }) : tx('fcx.r.noGaps')} sub={r.lastDay ? tx('fcx.r.lastDay', { d: r.lastDay }) : tx('fcx.noHistory')} />
          </div>;
        })()}
        <div className="sub" style={{ marginTop: 6 }}>{tx('fcx.note')}</div>
      </section>
      {error && <div className="err" style={{ marginBottom: 12 }}>{error}</div>}
      {loading && <div className="state">{tx('pos.loading')}</div>}

      {!loading && !error && tab === 'appointments' && appt && <ForecastView data={appt} kind="appointments" accuracy={acc.appointments} />}
      {!loading && !error && tab === 'revenue' && rev && <ForecastView data={rev} kind="revenue" accuracy={acc.revenue} />}
      {!loading && !error && tab === 'noshow' && ns && <NoShowView data={ns} />}
      <ForecastHistory />
    </div>
  );
}
