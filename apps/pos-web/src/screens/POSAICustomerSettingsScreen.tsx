// POSAICustomerSettingsScreen.tsx — AI Center → AI Customer Profile → Settings (§52). Read-only view of the EFFECTIVE
// settings resolved for this salon (platform → tenant → branch → user), including whether the assistant is disabled
// and at which level. Editing per-tenant overrides is a Super Admin / durable-store follow-up; this screen shows the
// truth honestly rather than pretending to save.
import { useCallback, useEffect, useState } from 'react';
import { posAiCustomerProfileApi as apiP } from '../api/posAiCustomerProfileApi';
import { Loading, ErrorBox, Freshness, profileError } from './aiCustomerProfileCommon';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

const ROW = (): [string, (t: any) => string][] => [
  [tx('growth.aiProfile.setting.minServiceVisits'), (t) => String(t.minVisitsForServicePref)],
  [tx('growth.aiProfile.setting.minTechVisits'), (t) => String(t.minVisitsForTechPref)],
  [tx('growth.aiProfile.setting.minCadenceVisits'), (t) => String(t.minVisitsForCadence)],
  [tx('growth.aiProfile.setting.inactiveAfter'), (t) => tx('pos.inactivedays_days', { inactiveDays: String(t.inactiveDays) })],
  [tx('growth.aiProfile.setting.longTermAfter'), (t) => tx('pos.longterminactivedays_days', { longTermInactiveDays: String(t.longTermInactiveDays) })],
];

export function POSAICustomerSettingsScreen() {
  const [s, setS] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setS(await apiP.settings()); }
    catch (e: any) { setError(profileError(e, tx('growth.noun.theseSettings'))); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = useCallback(async () => {
    if (!s) return;
    setBusy(true); setActionErr(null);
    try { setS(await apiP.updateSettings('tenant', { enabled: !s.enabled })); }
    catch (e: any) { setActionErr(profileError(e, tx('growth.noun.thisSetting'))); }
    finally { setBusy(false); }
  }, [s]);

  return (
    <div className="work">
      <div className="vh"><h1>{tx('pos.settings')}</h1>
        <div className="sub mb-3">{tx('pos.effective_ai_customer_profile_settings_for_1fmy')}</div></div>

      {loading ? <Loading label={tx('pos.loading_settings')} />
        : error ? <ErrorBox message={error} onRetry={load} />
        : s ? (
        <>
          <section className="panel" style={{ padding: 16, marginTop: 12 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
              <strong>{tx('pos.assistant')}</strong>
              <span className="chip" style={{ borderColor: 'var(--line)', color: s.enabled ? 'var(--aps-orange)' : '#a12d2d', fontWeight: 700 }}>
                {s.enabled ? tx('pos.enabled') : tx('pos.disabled')}
              </span>
              {!s.enabled && s.disabledAtLevel && <span className="sub">{tx('pos.turned_off_at_the')}{' '}{s.disabledAtLevel} {tx('pos.level')}</span>}
              <button className="btn sm:ml-auto ml-0"  onClick={toggle} disabled={busy}>
                {busy ? tx('pos.saving_2') : s.enabled ? tx('pos.disable_for_this_salon') : tx('pos.enable_for_this_salon')}
              </button>
            </div>
            {actionErr && <ErrorBox message={actionErr} />}
          </section>

          <section className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
            <div className="p-h" style={{ padding: '14px 14px 0' }}>{tx('pos.thresholds')}</div>
            <div className="overflow-x-auto w-full"><table className="tbl w-full min-w-max">
              <thead><tr><th>{tx('pos.setting')}</th><th style={{ textAlign: 'right' }}>{tx('pos.value')}</th></tr></thead>
              <tbody>{ROW().map(([label, fn]) => (
                <tr key={label}><td>{label}</td><td style={{ textAlign: 'right' }}>{s.tunables ? fn(s.tunables) : '—'}</td></tr>
              ))}</tbody>
            </table></div>
          </section>

          <div className="sub" style={{ marginTop: 8, fontSize: 12 }}>
            {tx('pos.these_are_the_values_in_effect_1kop')}
          </div>
          <div style={{ marginTop: 8 }}><Freshness f={s.freshness} /></div>
        </>
      ) : null}
    </div>
  );
}
