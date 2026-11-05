// POSAiBranchCompareScreen.tsx — AI Center → AI Branch Comparison. Wired to GET /pos/ai-business/branches/compare
// (pos.reports.view). Shows the branches the user is AUTHORIZED to see, side by side, with totals AND normalized
// figures clearly separated (§30) so a smaller branch is not judged just for being smaller. Revenue columns hide
// honestly when the user lacks financial permission; a single-branch user is told there is nothing to compare. No
// fabricated data — every cell comes from the live endpoint.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { posAiBusinessApi } from '../api/posAiBusinessApi';
import { money, PeriodTabs, reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

type Row = {
  branchId: string; branchName: string;
  netSalesCents: number | null; averageTicketCents: number | null; ticketsCount: number | null;
  totalBookings: number; completed: number; cancelledPercent: number; noShowPercent: number;
  revenuePerCompletedAppointmentCents: number | null; completionRate: number;
};
type Comparison = {
  preset: string; partialCurrentPeriod: boolean; financialsIncluded: boolean;
  branches: Row[]; branchCount: number; truncated: boolean; drilldownRoute: string; notes: string[];
};

const pct = (n: number) => `${n}%`;
const dash = <span style={{ color: 'var(--muted)' }}>—</span>;

export function POSAiBranchCompareScreen() {
  const [period, setPeriod] = useState('month');
  const [s, setS] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (p: string) => {
    setLoading(true); setError(null);
    try { setS(await posAiBusinessApi.compareBranches(p) as Comparison); }
    catch (e: any) { setError(reportError(e, t('growth.noun.theBranchComparison'))); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(period); }, [load, period]);

  const rows = s?.branches || [];
  const fin = s?.financialsIncluded !== false;

  return (
    <div className="work">
      <div className="vh">
        <h1>{t('pos.ai_branch_comparison')}</h1>
        <div className="sub mb-3">{t('pos.your_authorized_branches_side_by_side_1h3w')}</div>
      </div>
      <PeriodTabs period={period} onChange={setPeriod} />

      {loading ? <div className="state" style={{ marginTop: 12 }}>{t('pos.loading_branch_comparison')}</div>
        : error ? <div className="err" style={{ marginTop: 12 }}>{error}</div>
        : !s ? <div className="state" style={{ marginTop: 12 }}>{t('pos.no_data')}</div>
        : (
        <>
          {s.partialCurrentPeriod && <div className="sub" style={{ marginTop: 10 }}>{t('pos.today_is_partial_figures_are_still_1a7b')}</div>}

          <section className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
            <div className="p-h" style={{ padding: '14px 14px 0' }}>{t('pos.branches')}</div>
            {rows.length === 0 ? <div className="state" style={{ padding: 16 }}>{t('pos.no_authorized_branches_to_compare')}</div> : (
              <div className="overflow-x-auto w-full"><table className="tbl w-full min-w-max">
                <thead>
                  <tr>
                    <th>{t('pos.branch')}</th>
                    <th style={{ textAlign: 'right' }}>{t('pos.net_sales')}</th>
                    <th style={{ textAlign: 'right' }}>{t('pos.avg_ticket')}</th>
                    <th style={{ textAlign: 'right' }}>{t('pos.bookings_2')}</th>
                    <th style={{ textAlign: 'right' }}>{t('pos.completed_2')}</th>
                    <th style={{ textAlign: 'right' }}>{t('pos.completion')}</th>
                    <th style={{ textAlign: 'right' }}>{t('pos.rev_completed')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.branchId}>
                      <td>{r.branchName}</td>
                      <td style={{ textAlign: 'right' }}>{fin && r.netSalesCents != null ? money(r.netSalesCents) : dash}</td>
                      <td style={{ textAlign: 'right' }}>{fin && r.averageTicketCents != null ? money(r.averageTicketCents) : dash}</td>
                      <td style={{ textAlign: 'right' }}>{r.totalBookings}</td>
                      <td style={{ textAlign: 'right' }}>{r.completed}</td>
                      <td style={{ textAlign: 'right' }}>{pct(r.completionRate)}</td>
                      <td style={{ textAlign: 'right' }}>{fin && r.revenuePerCompletedAppointmentCents != null ? money(r.revenuePerCompletedAppointmentCents) : dash}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </section>

          <div className="sub" style={{ marginTop: 10 }}>
            <Link to={s.drilldownRoute} style={{ color: 'var(--aps-orange)' }}>{t('pos.open_the_sales_report')}</Link>
          </div>

          {s.notes.length > 0 && (
            <ul className="sub" style={{ marginTop: 10, paddingLeft: 18 }}>
              {s.notes.map((n, i) => (<li key={i} style={{ marginBottom: 4 }}>{n}</li>))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
