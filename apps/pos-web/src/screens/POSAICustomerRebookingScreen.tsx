// POSAICustomerRebookingScreen.tsx — AI Center → AI Customer Profile → Rebooking (§21). Look up a customer, see an
// advisory rebooking opportunity (suppressed when a future appointment exists). Booking is handed to the AI Booking
// Assistant — nothing books automatically.
import { useCallback, useState } from 'react';
import { posAiCustomerProfileApi as apiP } from '../api/posAiCustomerProfileApi';
import { CustomerLookup, Freshness, ErrorBox, InsufficientData, profileError, DASH } from './aiCustomerProfileCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

export function POSAICustomerRebookingScreen() {
  const [selected, setSelected] = useState<any>(null);
  const [reb, setReb] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const pick = useCallback(async (c: any) => {
    setSelected(c); setReb(null); setError(null); setLoading(true);
    try { setReb(await apiP.rebooking(c.customerId || c.id)); }
    catch (e: any) { setError(profileError(e, t('growth.noun.rebookingOpportunities'))); }
    finally { setLoading(false); }
  }, []);

  const name = (c: any) => c?.displayName || c?.fullName || [c?.firstName, c?.lastName].filter(Boolean).join(' ');

  return (
    <div className="work">
      <div className="vh flex flex-col sm:flex-row gap-3 justify-between">
        <div>
          <h1>{t('pos.rebooking_opportunities_2')}</h1>
        <div className="sub mb-3">{t('pos.advisory_only_booking_always_goes_through_12t8')}</div>
        </div></div>

      {!selected ? <CustomerLookup onPick={pick} /> : (
        <section className="panel" style={{ marginTop: 12, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <strong>{name(selected)}</strong>
            <button className="btn w-fit whitespace-nowrap"  onClick={() => { setSelected(null); setReb(null); }}>{t('pos.new_search')}</button>
          </div>
          {loading ? <div className="state">{t('pos.checking_for_a_rebooking_opportunity')}</div>
            : error ? <ErrorBox message={error} />
            : reb ? (
              reb.eligible ? <>
                <div style={{ marginBottom: 6 }}><strong>{t('pos.rebooking_opportunity')}</strong> {reb.reason}.</div>
                <div className="kpis" style={{ marginTop: 8 }}>
                  <div className="kpi"><div className="l">{t('pos.last_service_2')}</div><div className="v" style={{ fontSize: 16 }}>{reb.lastService || DASH}</div></div>
                  <div className="kpi"><div className="l">{t('pos.last_visit')}</div><div className="v" style={{ fontSize: 16 }}>{reb.lastVisit ? reb.lastVisit.slice(0, 10) : DASH}</div></div>
                  <div className="kpi"><div className="l">{t('pos.typical_interval')}</div><div className="v" style={{ fontSize: 16 }}>{reb.typicalIntervalDays ? t('pos.typicalintervaldays_days', { typicalIntervalDays: String(reb.typicalIntervalDays) }) : DASH}</div></div>
                </div>
                <div className="sub" style={{ marginTop: 10 }}>{t('pos.continue_in_the_ai_booking_assistant_8j2x')}</div>
              </> : <InsufficientData>{reb.reason || t('pos.no_rebooking_opportunity_right_now')}</InsufficientData>
            ) : null}
          <div style={{ marginTop: 10 }}><Freshness f={reb?.freshness} /></div>
        </section>
      )}
    </div>
  );
}
