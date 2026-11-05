// POSAiReportsScreen.tsx — AI Center → AI Business Reports. Wired to /pos/ai-business/reports (pos.reports.view).
// Generate a bounded structured report (daily brief / weekly summary / monthly review / branch comparison); it is
// composed from the same authorized tools, so its numbers match the reports. Jobs list with status; a completed one
// opens its sections. Restricted sections show as such; expired jobs show no content. No fabricated data.
import { useCallback, useEffect, useState } from 'react';
import { posAiBusinessApi } from '../api/posAiBusinessApi';
import { money, reportError } from './reportsCommon';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { growthCode } from './growthLabels';

type Job = {
  id: string; reportType: string; preset: string; status: 'queued' | 'running' | 'completed' | 'failed';
  content: any | null; error: string | null; createdAt: string; completedAt: string | null; expiresAt: string; expired: boolean;
};

const TYPES: { id: string; label: string }[] = [
  { id: 'daily_brief', get label() { return tx('pos.daily_brief'); } },
  { id: 'weekly_summary', get label() { return tx('pos.weekly_summary'); } },
  { id: 'monthly_review', get label() { return tx('pos.monthly_review'); } },
  { id: 'branch_comparison', get label() { return tx('pos.branch_comparison_2'); } },
];
const label = (t: string) => TYPES.find((x) => x.id === t)?.label || t;

// Whitelisted headline numbers pulled from a completed report's sections — shown only when present.
function headline(content: any): { label: string; value: string }[] {
  if (!content || typeof content !== 'object') return [];
  const out: { label: string; value: string }[] = [];
  const push = (l: string, v: string) => out.push({ label: l, value: v });
  const rev = content.revenue && content.revenue.available !== false ? content.revenue : (content.brief?.revenue?.available ? content.brief.revenue : null);
  if (rev && typeof rev.netSalesCents === 'number') push(tx('growth.metric.netSales'), money(rev.netSalesCents));
  const appts = content.appointments?.funnel || content.brief?.appointments;
  if (appts && typeof appts.completed === 'number') push(tx('growth.metric.completedAppts'), String(appts.completed));
  if (content.customers && typeof content.customers.newCustomers === 'number') push(tx('growth.metric.newCustomers'), String(content.customers.newCustomers));
  if (Array.isArray(content.branches?.branches)) push(tx('growth.metric.branches'), String(content.branches.branches.length));
  return out;
}

export function POSAiReportsScreen() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setJobs(await posAiBusinessApi.reportsList() as Job[]); }
    catch (e: any) { setError(reportError(e, tx('growth.noun.yourReports'))); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const generate = useCallback(async (reportType: string) => {
    setBusy(true); setError(null);
    try { const job = await posAiBusinessApi.reportCreate(reportType) as Job; setOpenId(job.id); await load(); }
    catch (e: any) { setError(reportError(e, tx('growth.noun.generatingTheReport'))); }
    finally { setBusy(false); }
  }, [load]);

  const open = jobs.find((j) => j.id === openId) || null;

  return (
    <div className="work">
      <div className="vh ">
        <div>
          <h1>{tx('pos.ai_business_reports')}</h1>
        <div className="sub mb-3">{tx('pos.generate_a_structured_report_from_your_1f8t')}</div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 4, padding: 14 }}>
        <div className="p-h" style={{ padding: 0, marginBottom: 10 }}>{tx('pos.generate_a_report')}</div>
        <div className="flex flex-col md:flex-row flex-wrap whitespace-nowrap sm:items-center justify-between gap-2 mb-1">
          {TYPES.map((t) => (
            <button key={t.id} className="btn w-fit whitespace-nowrap" onClick={() => generate(t.id)} disabled={busy}>{t.label}</button>
          ))}
        </div>
      </div>

      {error && <div className="err" style={{ marginTop: 12 }}>{error}</div>}

      {loading ? <div className="state" style={{ marginTop: 12 }}>{tx('pos.loading_reports')}</div>
        : jobs.length === 0 ? <div className="state" style={{ marginTop: 12 }}>{tx('pos.no_reports_yet_generate_one_above')}</div>
        : (
        <section className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
          <div className="overflow-x-auto w-full"><table className="tbl w-full min-w-max">
            <thead><tr><th>{tx('pos.report')}</th><th>{tx('pos.generated_2')}</th><th>{tx('pos.status')}</th><th style={{ width: 120 }}></th></tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>{label(j.reportType)}<div className="sub">{j.preset}</div></td>
                  <td>{j.completedAt ? new Date(j.completedAt).toLocaleString() : '—'}</td>
                  <td>
                    <span style={{ color: j.status === 'completed' ? 'var(--aps-orange)' : j.status === 'failed' ? '#b3261e' : 'var(--muted)', fontWeight: 600 }}>{growthCode(j.status)}</span>
                    {j.expired && <div className="sub">{tx('pos.expired')}</div>}
                    {j.error && <div className="sub">{j.error}</div>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {j.status === 'completed' && !j.expired && <button className="chip" onClick={() => setOpenId(j.id === openId ? null : j.id)}>{j.id === openId ? tx('pos.hide') : tx('pos.view')}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>
      )}

      {open && open.content && (
        <section className="panel" style={{ marginTop: 12, padding: 14 }}>
          <div className="p-h" style={{ padding: 0, marginBottom: 8 }}>{label(open.reportType)}</div>
          {headline(open.content).length > 0 && (
            <div className="kpis" style={{ marginBottom: 10 }}>
              {headline(open.content).map((h) => (<div className="kpi" key={h.label}><div className="l">{h.label}</div><div className="v">{h.value}</div></div>))}
            </div>
          )}
          <details>
            <summary className="sub" style={{ cursor: 'pointer' }}>{tx('pos.show_full_report_data')}</summary>
            <pre className="panel" style={{ marginTop: 8, padding: 12, overflow: 'auto', fontSize: 12 }}>{JSON.stringify(open.content, null, 2)}</pre>
          </details>
        </section>
      )}
    </div>
  );
}
