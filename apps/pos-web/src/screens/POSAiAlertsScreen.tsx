// POSAiAlertsScreen.tsx — AI Center → AI Business Alerts. Wired to /pos/ai-business/alerts (pos.ai.view) and
// /pos/ai-business/alerts/:id/evaluate (pos.reports.view). Create rules that watch one bounded metric and fire when
// it crosses a threshold (with a minimum sample size so small samples can't trip an alert). "Evaluate now" checks the
// rule against current data. Scheduled delivery runs server-side; this screen manages the rules and previews them.
import { useCallback, useEffect, useState } from 'react';
import { posAiBusinessApi } from '../api/posAiBusinessApi';
import { money, reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

type Metric = 'net_sales' | 'average_ticket' | 'completed_appointments' | 'cancellation_rate' | 'no_show_rate' | 'customer_retention';
type Alert = {
  id: string; title: string; metricId: Metric; operator: 'lt' | 'gt'; threshold: number; preset: string;
  minSampleSize: number; frequency: string; channel: string; active: boolean;
  createdAt: string; lastCheckedAt: string | null; lastTriggeredAt: string | null;
};
type Evaluation = { metricId: Metric; unit: 'currency_cents' | 'count' | 'percent'; value: number; threshold: number; operator: 'lt' | 'gt'; sampleSize: number; sampleOk: boolean; triggered: boolean; reason: string };

const METRICS: { id: Metric; label: string; unit: 'currency_cents' | 'count' | 'percent' }[] = [
  { id: 'net_sales', get label() { return t('pos.net_sales_2'); }, unit: 'currency_cents' },
  { id: 'average_ticket', get label() { return t('pos.average_ticket_2'); }, unit: 'currency_cents' },
  { id: 'completed_appointments', get label() { return t('pos.completed_appointments'); }, unit: 'count' },
  { id: 'cancellation_rate', get label() { return t('pos.cancellation_rate'); }, unit: 'percent' },
  { id: 'no_show_rate', get label() { return t('pos.no_show_rate_2'); }, unit: 'percent' },
  { id: 'customer_retention', get label() { return t('pos.customer_retention_2'); }, unit: 'percent' },
];
const PRESETS = ['today', 'yesterday', 'week', 'month'];
const unitOf = (m: Metric) => METRICS.find((x) => x.id === m)!.unit;
const fmt = (v: number, unit: string) => (unit === 'currency_cents' ? money(v) : unit === 'percent' ? `${v}%` : String(v));

export function POSAiAlertsScreen() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [evals, setEvals] = useState<Record<string, Evaluation>>({});

  // create form
  const [title, setTitle] = useState('');
  const [metricId, setMetricId] = useState<Metric>('net_sales');
  const [operator, setOperator] = useState<'lt' | 'gt'>('lt');
  const [thresholdText, setThresholdText] = useState('');
  const [preset, setPreset] = useState('today');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setAlerts(await posAiBusinessApi.alertsList() as Alert[]); }
    catch (e: any) { setError(reportError(e, t('growth.noun.yourAlerts'))); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = useCallback(async () => {
    const raw = Number(thresholdText);
    if (!title.trim() || !Number.isFinite(raw) || raw < 0) { setError(t('pos.enter_a_title_and_a_non_108p')); return; }
    // Money thresholds are entered in dollars; store integer cents.
    const threshold = unitOf(metricId) === 'currency_cents' ? Math.round(raw * 100) : Math.round(raw);
    try {
      await posAiBusinessApi.alertCreate({ title: title.trim(), metricId, operator, threshold, preset });
      setTitle(''); setThresholdText(''); await load();
    } catch (e: any) { setError(reportError(e, t('growth.noun.creatingTheAlert'))); }
  }, [title, metricId, operator, thresholdText, preset, load]);

  const toggle = useCallback(async (a: Alert) => {
    try { await posAiBusinessApi.alertUpdate(a.id, { active: !a.active }); await load(); } catch { /* ignore */ }
  }, [load]);
  const remove = useCallback(async (id: string) => {
    try { await posAiBusinessApi.alertDelete(id); await load(); } catch { /* ignore */ }
  }, [load]);
  const evaluate = useCallback(async (id: string) => {
    try { const ev = await posAiBusinessApi.alertEvaluate(id) as Evaluation; setEvals((m) => ({ ...m, [id]: ev })); }
    catch (e: any) { setError(reportError(e, t('growth.noun.evaluatingTheAlert'))); }
  }, []);

  const thresholdUnit = unitOf(metricId);

  return (
    <div className="work">
      <div className="vh">
        <h1>{t('pos.ai_business_alerts')}</h1>
        <div className="sub mb-3">{t('pos.watch_a_metric_and_get_notified_16ll')}</div>
      </div>

      <div className="panel" style={{ marginTop: 4, padding: 14 }}>
        <div className="p-h" style={{ padding: 0, marginBottom: 10 }}>{t('pos.new_alert')}</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-9 2xl:grid-cols-12 gap-3 items-center">
          <input className="in lg:col-span-3 w-full" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', height: 34 }} placeholder={t('pos.alert_name')} value={title} onChange={(e) => setTitle(e.target.value)} />
          <select className="in lg:col-span-2 w-full" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', height: 34 }} value={metricId} onChange={(e) => setMetricId(e.target.value as Metric)} aria-label={t('pos.metric')}>
            {METRICS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <select className="in lg:col-span-2 w-full" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', height: 34 }} value={operator} onChange={(e) => setOperator(e.target.value as 'lt' | 'gt')} aria-label={t('pos.operator')}>
            <option value="lt">{t('pos.falls_below')}</option>
            <option value="gt">{t('pos.rises_above')}</option>
          </select>
          <input className="in lg:col-span-2 w-full" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', height: 34 }} placeholder={thresholdUnit === 'currency_cents' ? t('pos.amount') : thresholdUnit === 'percent' ? t('growth.aiAlerts.percent') : t('growth.aiAlerts.count')} value={thresholdText} onChange={(e) => setThresholdText(e.target.value)} inputMode="decimal" aria-label={t('pos.threshold')} />
          <select className="in lg:col-span-2 w-full" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', height: 34 }} value={preset} onChange={(e) => setPreset(e.target.value)} aria-label={t('pos.period')}>
            {PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <button className="btn w-full lg:col-span-1 whitespace-nowrap" style={{ height: 34 }} onClick={create}>{t('pos.create_alert')}</button>
        </div>
      </div>

      {error && <div className="err" style={{ marginTop: 12 }}>{error}</div>}

      {loading ? <div className="state" style={{ marginTop: 12 }}>{t('pos.loading_alerts')}</div>
        : alerts.length === 0 ? <div className="state" style={{ marginTop: 12 }}>{t('pos.no_alerts_yet_create_one_above')}</div>
        : (
        <section className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
          <div className="overflow-x-auto w-full"><table className="tbl w-full min-w-max">
            <thead><tr><th>{t('pos.alert')}</th><th className="whitespace-nowrap">{t('pos.condition')}</th><th className="whitespace-nowrap">{t('pos.period')}</th><th className="whitespace-nowrap">{t('pos.status')}</th><th className="whitespace-nowrap" style={{ textAlign: 'right' }}>{t('pos.actions')}</th></tr></thead>
            <tbody>
              {alerts.map((a) => {
                const ev = evals[a.id];
                return (
                  <tr key={a.id}>
                    <td>{a.title}</td>
                    <td>{METRICS.find((m) => m.id === a.metricId)?.label} {a.operator === 'lt' ? 'below' : 'above'} {fmt(a.threshold, unitOf(a.metricId))}<div className="sub">{t('pos.min_sample')}{' '}{a.minSampleSize}</div></td>
                    <td>{a.preset}</td>
                    <td>
                      <button className="chip" onClick={() => toggle(a)}>{a.active ? t('pos.active_3') : t('pos.paused')}</button>
                      {a.lastTriggeredAt && <div className="sub">{t('pos.last_fired')}{' '}{new Date(a.lastTriggeredAt).toLocaleDateString()}</div>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="chip" onClick={() => evaluate(a.id)}>{t('pos.evaluate_now')}</button>{' '}
                      <button className="chip" onClick={() => remove(a.id)} aria-label={t('pos.delete_title', { title: String(a.title) })}>{t('pos.delete')}</button>
                      {ev && (
                        <div className="sub" style={{ marginTop: 6, textAlign: 'left' }}>
                          <span style={{ color: ev.triggered ? 'var(--aps-orange)' : 'var(--muted)', fontWeight: 600 }}>{ev.triggered ? t('pos.would_fire') : 'OK'}</span>
                          {' · '}{t('pos.value_2')}{' '}{fmt(ev.value, ev.unit)}{' · '}{ev.reason}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </section>
      )}
    </div>
  );
}
