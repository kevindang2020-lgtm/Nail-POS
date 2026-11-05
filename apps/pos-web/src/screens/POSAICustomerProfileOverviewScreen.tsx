// POSAICustomerProfileOverviewScreen.tsx — AI Center → AI Customer Profile → Overview (§44). Tenant-scoped aggregate.
// Shows ONLY metrics actually computed (duplicate-candidate groups today); others render as em-dash with a note —
// never fabricated. A Refresh recomputes the cached aggregate.
import { useCallback, useEffect, useState } from 'react';
import { posAiCustomerProfileApi as apiP } from '../api/posAiCustomerProfileApi';
import { Loading, ErrorBox, Freshness, profileError, DASH } from './aiCustomerProfileCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

export function POSAICustomerProfileOverviewScreen() {
  const [s, setS] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setS(await apiP.tenantOverview()); }
    catch (e: any) { setError(profileError(e, t('growth.noun.theCustomerIntelligenceOverview'))); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(async () => {
    setBusy(true); setError(null);
    try { setS(await apiP.refreshTenantOverview()); }
    catch (e: any) { setError(profileError(e, t('growth.noun.theCustomerIntelligenceOverview'))); }
    finally { setBusy(false); }
  }, []);

  return (
    <div className="work">
      <div className="vh flex flex-col sm:flex-row gap-3 justify-between">
        <div>
        <div>
          <h1>{t('pos.customer_intelligence')}</h1>
        <div className="sub mb-3">{t('pos.tenant_wide_customer_profile_signals')}</div>
        </div></div>
        <button className="btn w-fit whitespace-nowrap"  onClick={refresh} disabled={busy}>{busy ? t('pos.refreshing') : t('pos.refresh')}</button>
      </div>

      {loading ? <Loading label={t('pos.loading_customer_intelligence')} />
        : error ? <ErrorBox message={error} onRetry={load} />
        : (
        <>
          <div className="kpis" style={{ marginTop: 12 }}>
            <div className="kpi"><div className="l">{t('pos.duplicate_candidate_groups')}</div><div className="v" style={{ color: 'var(--aps-orange)' }}>{s?.duplicateCandidateGroups ?? 0}</div><div className="d">{t('pos.needs_review')}</div></div>
            <div className="kpi"><div className="l">{t('pos.active_customers')}</div><div className="v">{s?.active ?? DASH}</div><div className="d">{s?.withUpcomingAppointment != null ? t('pos.withupcomingappointment_with_upcoming', { withUpcomingAppointment: String(s.withUpcomingAppointment) }) : ''}</div></div>
            <div className="kpi"><div className="l">{t('pos.inactive_customers')}</div><div className="v">{s?.totalScanned != null ? (s.inactive + s.longTermInactive) : DASH}</div><div className="d">{t('pos.no_recent_completed_visit')}</div></div>
            <div className="kpi"><div className="l">{t('pos.churn_watch_coarse')}</div><div className="v">{s?.coarseChurnWatch ?? DASH}</div><div className="d">{t('pos.review_shortlist_not_a_verdict')}</div></div>
            <div className="kpi"><div className="l">{t('pos.rebooking_opportunities')}</div><div className="v">{s?.rebookingOpportunities ?? DASH}</div><div className="d">{t('pos.no_future_appointment')}</div></div>
            <div className="kpi"><div className="l">{t('pos.customers_scanned')}</div><div className="v" style={{ fontSize: 20 }}>{s?.totalScanned ?? DASH}</div><div className="d">{s?.truncated ? t('pos.capped_at_scancap', { scanCap: String(s.scanCap) }) : t('pos.full_directory')}</div></div>
          </div>
          <section className="panel" style={{ marginTop: 12, padding: 14 }}>
            <div className="p-h" style={{ padding: 0, marginBottom: 6 }}>{t('pos.how_to_use_this')}</div>
            <div className="sub">{t('pos.these_counts_come_from_a_scan_bpi3')}{' '}<strong>{t('pos.churn_watch')}</strong> {t('pos.for_the_explained_evidence_backed_risk_1s1y')}{' '}<strong>{t('pos.duplicate_review')}</strong> {t('pos.to_merge_or')}{' '}<strong>{t('pos.rebooking')}</strong> / <strong>{t('pos.recommendations')}</strong> {t('pos.for_per_customer_actions_press')}{' '}<strong>{t('pos.refresh')}</strong> {t('pos.to_recompute')}</div>
            <div style={{ marginTop: 10 }}><Freshness f={{ generatedAt: s?.generatedAt, source: s?.freshness?.source }} /></div>
          </section>
        </>
      )}
    </div>
  );
}
