// AICustomerProfilePanel.tsx — the collapsible, READ-ONLY AI Profile panel (spec §8). Embed on the customer profile
// page / search drawer / booking context. It summarizes one customer using the Stage 1–3 endpoints, shows evidence +
// confidence + freshness, and NEVER mutates. Tabs appear only when data is available; churn is a separate manage-gated
// screen (not shown here). Booking is handed off, never auto-booked.
import { useCallback, useEffect, useState } from 'react';
import { posAiCustomerProfileApi as apiP } from '../api/posAiCustomerProfileApi';
import { ConfidenceChip, EvidenceList, Freshness, Loading, ErrorBox, InsufficientData, inactivityLabel, profileError, DASH } from './aiCustomerProfileCommon';
import { t as tx, enPlural } from '@aipowersalon/mobile-sdk/i18n';

type Tab = 'overview' | 'preferences' | 'rebooking' | 'calls';

export function AICustomerProfilePanel({ customerId, defaultOpen = true }: { customerId: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [tab, setTab] = useState<Tab>('overview');
  const [ov, setOv] = useState<any>(null);
  const [prefs, setPrefs] = useState<any>(null);
  const [tech, setTech] = useState<any>(null);
  const [reb, setReb] = useState<any>(null);
  const [calls, setCalls] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!customerId) return;
    setLoading(true); setError(null);
    try {
      const [o, p, t, r, cl] = await Promise.all([
        apiP.overview(customerId), apiP.servicePreferences(customerId),
        apiP.technicianPreference(customerId), apiP.rebooking(customerId),
        apiP.callSummary(customerId).catch(() => null),
      ]);
      setOv(o); setPrefs(p); setTech(t); setReb(r); setCalls(cl);
    } catch (e: any) { setError(profileError(e, tx('admin.aiProfile.noun'))); }
    finally { setLoading(false); }
  }, [customerId]);
  useEffect(() => { if (open) load(); }, [open, load]);

  return (
    <section className="panel" style={{ marginTop: 12, overflow: 'hidden' }} aria-label={tx('pos.ai_customer_profile')}>
      <button className="p-h" onClick={() => setOpen(o => !o)} aria-expanded={open}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}>
        <span style={{ fontFamily: 'var(--display, "Playfair Display", serif)', color: 'var(--aps-orange)' }}>{tx('pos.ai_profile')}</span>
        <span className="sub" style={{ fontSize: 12 }}>{open ? tx('pos.hide') : tx('pos.show')}</span>
      </button>

      {open && (
        <div style={{ padding: '0 14px 14px' }}>
          {loading ? <Loading label={tx('pos.reading_this_customer_s_history')} />
            : error ? <ErrorBox message={error} onRetry={load} />
            : !ov ? <InsufficientData>{tx('pos.no_customer_summary_available')}</InsufficientData>
            : (
            <>
              <div className="seg" role="tablist" aria-label={tx('pos.profile_view')} style={{ marginBottom: 10 }}>
                {(['overview', 'preferences', 'rebooking', 'calls'] as Tab[]).map(t => (
                  <button key={t} role="tab" aria-selected={tab === t} className={`seg-btn ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
                    {t === 'overview' ? tx('pos.overview') : t === 'preferences' ? tx('admin.aiProfile.tab.preferences') : t === 'rebooking' ? tx('pos.rebooking') : tx('pos.calls')}
                  </button>
                ))}
              </div>

              {tab === 'overview' && (
                <div className="kpis">
                  <div className="kpi"><div className="l">{tx('pos.completed_visits')}</div><div className="v">{ov.completedVisits}</div></div>
                  <div className="kpi"><div className="l">{tx('pos.last_visit')}</div><div className="v" style={{ fontSize: 16 }}>{ov.lastVisit ? ov.lastVisit.slice(0, 10) : DASH}</div></div>
                  <div className="kpi"><div className="l">{tx('pos.next_appointment')}</div><div className="v" style={{ fontSize: 16 }}>{ov.nextAppointment ? ov.nextAppointment.slice(0, 10) : DASH}</div></div>
                  <div className="kpi"><div className="l">{tx('pos.most_booked')}</div><div className="v" style={{ fontSize: 16 }}>{ov.mostBookedService || DASH}</div></div>
                  <div className="kpi"><div className="l">{tx('pos.status')}</div><div className="v" style={{ fontSize: 16 }}>{inactivityLabel(ov.inactivityStatus)}</div></div>
                  <div className="kpi"><div className="l">{tx('pos.profile_complete')}</div><div className="v" style={{ fontSize: 16 }}>{ov.completenessPercent}%</div></div>
                </div>
              )}

              {tab === 'preferences' && (
                <div>
                  <div className="sub" style={{ marginBottom: 6 }}>{tx('pos.likely_technician')}</div>
                  {tech?.preference && tech.preference.confidence !== 'insufficient'
                    ? <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}><strong>{tech.preference.technicianName}</strong><ConfidenceChip level={tech.preference.confidence} /></div>
                    : <InsufficientData>{tx('pos.not_enough_completed_visits_to_identify_1ayv')}</InsufficientData>}
                  {tech?.preference && <EvidenceList items={tech.preference.evidence} />}

                  <div className="sub" style={{ margin: '12px 0 6px' }}>{tx('pos.likely_services')}</div>
                  {prefs?.preferences?.length ? prefs.preferences.slice(0, 3).map((p: any, i: number) => (
                    <div key={i} style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}><strong>{p.serviceName}</strong><ConfidenceChip level={p.confidence} /></div>
                      <EvidenceList items={p.evidence} />
                    </div>
                  )) : <InsufficientData>{tx('pos.no_service_preference_yet')}</InsufficientData>}
                </div>
              )}

              {tab === 'rebooking' && (
                reb?.eligible
                  ? <div>
                      <div style={{ marginBottom: 6 }}><strong>{tx('pos.rebooking_opportunity')}</strong> {reb.reason}.</div>
                      <div className="sub">{tx('pos.last_service')}{' '}{reb.lastService || DASH} {tx('pos.last_visit_2')}{' '}{reb.lastVisit ? reb.lastVisit.slice(0, 10) : DASH}</div>
                      <div className="sub" style={{ marginTop: 8 }}>{tx('pos.book_through_the_ai_booking_assistant_1re4')}</div>
                    </div>
                  : <InsufficientData>{reb?.reason || tx('pos.no_rebooking_opportunity_right_now')}</InsufficientData>
              )}

              {tab === 'calls' && (
                !calls || !calls.connected
                  ? <InsufficientData>{tx('pos.no_ai_phone_call_history_on_271g')}</InsufficientData>
                  : <div>
                      <div style={{ marginBottom: 6 }}><strong>{calls.totalCalls}</strong> {tx('pos.call')}{enPlural(calls.totalCalls === 1 ? '' : 's')} · {calls.aiHandledCalls} {tx('pos.ai_handled')}</div>
                      {calls.lastCall && <div className="sub">
                        {tx('pos.last_call')}{' '}{calls.lastCall.at ? calls.lastCall.at.slice(0, 10) : DASH} · {calls.lastCall.direction}
                        {calls.lastCall.intent ? ` · ${calls.lastCall.intent}` : ''}{calls.lastCall.outcome ? ` · ${calls.lastCall.outcome}` : ''}
                        {calls.lastCall.appointmentAction ? tx('pos.led_to_a_booking') : ''}
                      </div>}
                      <div className="sub" style={{ marginTop: 6, fontSize: 12 }}>{tx('pos.transcripts_and_recordings_are_not_shown_r5wj')}</div>
                    </div>
              )}

              <div style={{ marginTop: 10 }}><Freshness f={ov.freshness} /></div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
