// POSAICustomerRecommendationsScreen.tsx — AI Center → AI Customer Profile → Recommendations (§19). Look up a
// customer, see service suggestions built from their real completed history and the tenant's ACTIVE catalog. Inactive
// services are never suggested; when the catalog can't be read (permission) it degrades to "rebook usual" with
// availability unconfirmed. Nothing is booked or changed automatically.
import { useCallback, useState } from 'react';
import { posAiCustomerProfileApi as apiP } from '../api/posAiCustomerProfileApi';
import { CustomerLookup, ConfidenceChip, EvidenceList, Freshness, ErrorBox, InsufficientData, profileError } from './aiCustomerProfileCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

const CATEGORY: Record<string, string> = { get rebook_usual() { return t('growth.aiProfile.recommendation.rebook_usual'); }, get previously_requested() { return t('growth.aiProfile.recommendation.previously_requested'); }, get complementary() { return t('growth.aiProfile.recommendation.complementary'); } };

export function POSAICustomerRecommendationsScreen() {
  const [selected, setSelected] = useState<any>(null);
  const [rec, setRec] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const pick = useCallback(async (c: any) => {
    setSelected(c); setRec(null); setError(null); setLoading(true);
    try { setRec(await apiP.recommendations(c.customerId || c.id)); }
    catch (e: any) { setError(profileError(e, t('growth.noun.serviceRecommendations'))); }
    finally { setLoading(false); }
  }, []);

  const name = (c: any) => c?.displayName || c?.fullName || [c?.firstName, c?.lastName].filter(Boolean).join(' ');

  return (
    <div className="work">
      <div className="vh flex flex-col sm:flex-row gap-3 justify-between">
        <div>
          <h1>{t('pos.service_recommendations')}</h1>
        <div className="sub mb-3">{t('pos.suggestions_from_real_visit_history_and_uafw')}</div>
        </div></div>

      {!selected ? <CustomerLookup onPick={pick} /> : (
        <section className="panel" style={{ marginTop: 12, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <strong>{name(selected)}</strong>
            <button className="btn w-fit whitespace-nowrap"  onClick={() => { setSelected(null); setRec(null); }}>{t('pos.new_search')}</button>
          </div>
          {loading ? <div className="state">{t('pos.finding_relevant_services')}</div>
            : error ? <ErrorBox message={error} />
            : rec ? (
              rec.recommendations?.length ? <>
                {!rec.catalogAvailable && <div className="sub" style={{ marginBottom: 10 }}>{t('pos.showing_usual_services_only_current_availability_17zt')}</div>}
                {rec.recommendations.map((r: any, i: number) => (
                  <div key={i} style={{ padding: '10px 0', borderTop: i ? '1px solid var(--line)' : 'none' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                      <strong>{r.serviceName}</strong>
                      <span className="chip" style={{ borderColor: 'var(--line)', color: 'var(--muted)' }}>{CATEGORY[r.category] || r.category}</span>
                      <ConfidenceChip level={r.confidence} />
                      {r.availabilityConfirmed ? null : <span className="sub" style={{ fontSize: 12 }}>{t('pos.availability_unconfirmed')}</span>}
                    </div>
                    <EvidenceList items={r.evidence} />
                  </div>
                ))}
              </> : <InsufficientData>{t('pos.not_enough_history_to_recommend_a_1iu0')}</InsufficientData>
            ) : null}
          <div style={{ marginTop: 10 }}><Freshness f={rec?.freshness} /></div>
        </section>
      )}
    </div>
  );
}
