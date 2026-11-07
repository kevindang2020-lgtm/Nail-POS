// MyMetricsCard.tsx — F5 §73 (Nov 6 2026): one place for my Today / This week / This month numbers. Each comes from its own
// record on the server (time clock, breaks, completed services, the turn ledger); a number the server could not read shows
// "—", never 0.
import { useEffect, useState } from 'react';
import type { TechMetricsResponse } from '@aipowersalon/api-contracts/tenant';
import { techApi } from '../api/techApi';

const PERIODS = [['today', 'Today'], ['week', 'This week'], ['month', 'This month']] as const;
const hm = (m: number | null) => (m == null ? '—' : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`);

export function MyMetricsCard() {
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('today');
  const [m, setM] = useState<TechMetricsResponse | null>(null); const [err, setErr] = useState(false);
  useEffect(() => { let on = true; setErr(false); techApi.metrics(period).then((x) => on && setM(x)).catch(() => on && setErr(true)); return () => { on = false; }; }, [period]);
  return (
    <section className="card" data-testid="my-metrics" aria-label="My metrics">
      <div className="row" role="tablist" aria-label="Period">
        {PERIODS.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={period === k} className={period === k ? 'chip on' : 'chip'} onClick={() => setPeriod(k)} data-testid={`my-metrics-${k}`}>{label}</button>)}
      </div>
      {err ? <div className="muted">Could not load your numbers.</div> : !m ? <div className="muted">Loading…</div> : (
        <dl className="kv" data-testid="my-metrics-values">
          <dt>On the clock</dt><dd>{hm(m.clockedMinutes)}</dd>
          <dt>Breaks</dt><dd>{hm(m.breakMinutes)}</dd>
          <dt>In service</dt><dd>{hm(m.serviceMinutes)}</dd>
          <dt>Ready time</dt><dd data-testid="my-metrics-ready">{hm(m.readyMinutes)}</dd>
          <dt>Turns</dt><dd data-testid="my-metrics-turns">{m.turnUnits ?? '—'}</dd>
          <dt>Services</dt><dd>{m.services ?? '—'}</dd>
        </dl>)}
    </section>
  );
}
