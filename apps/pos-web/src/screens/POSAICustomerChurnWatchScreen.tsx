// POSAICustomerChurnWatchScreen.tsx — AI Center → AI Customer Profile → Churn Watch (§49). Look up a customer, then
// see a CAUTIOUS, explainable churn-risk indicator (never a certainty). Manage-gated on the server (a view-only user
// gets a permission message). Churn is an internal operational signal — it is never shown to the customer.
import { useCallback, useState } from 'react';
import { posCustomersApi } from '../api/posCustomersApi';
import { posAiCustomerProfileApi as apiP } from '../api/posAiCustomerProfileApi';
import { RiskChip, EvidenceList, Freshness, ErrorBox, InsufficientData, profileError } from './aiCustomerProfileCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

export function POSAICustomerChurnWatchScreen() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [churn, setChurn] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (e?: any) => {
    e?.preventDefault?.();
    const term = q.trim();
    if (term.length < 2) { setResults([]); return; }
    setSearching(true); setError(null);
    try { const r: any = await posCustomersApi.quickSearch(term); setResults(r?.customers || r?.items || r || []); }
    catch (err: any) { setError(profileError(err, 'customers')); }
    finally { setSearching(false); }
  }, [q]);

  const pick = useCallback(async (c: any) => {
    setSelected(c); setChurn(null); setError(null); setLoading(true);
    try { setChurn(await apiP.churn(c.customerId || c.id)); }
    catch (err: any) { setError(profileError(err, 'churn indicators')); }
    finally { setLoading(false); }
  }, []);

  return (
    <div className="work">
      <div className="vh flex flex-col sm:flex-row gap-3 justify-between">
        <div>
          <h1>{t('pos.churn_watch')}</h1>
        <div className="sub mb-3">{t('pos.a_cautious_internal_risk_signal_never_1igm')}</div>
        </div></div>

      <form onSubmit={search} className="seg" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxWidth: 520 }}>
        <input aria-label={t('pos.search_customers')} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('pos.search_by_name_phone_or_email')}
          style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, font: 'inherit' }} />
        <button className="btn w-fit whitespace-nowrap"  type="submit" disabled={searching}>{searching ? t('pos.searching_2') : t('pos.search')}</button>
      </form>

      {results.length > 0 && !selected && (
        <section className="panel" style={{ marginTop: 12, padding: 0, overflow: 'hidden' }}>
          <div className="overflow-x-auto w-full"><table className="tbl w-full min-w-max">
            <thead><tr><th>{t('pos.customer')}</th><th>{t('pos.phone')}</th><th style={{ width: 120 }}></th></tr></thead>
            <tbody>{results.map((c: any) => (
              <tr key={c.customerId || c.id}>
                <td>{c.displayName || c.fullName || [c.firstName, c.lastName].filter(Boolean).join(' ')}</td>
                <td style={{ color: 'var(--muted)' }}>{c.phone || '—'}</td>
                <td><button className="seg-btn" onClick={() => pick(c)}>{t('pos.evaluate')}</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      )}

      {selected && (
        <section className="panel" style={{ marginTop: 12, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <strong>{selected.displayName || selected.fullName || [selected.firstName, selected.lastName].filter(Boolean).join(' ')}</strong>
            <button className="seg-btn" onClick={() => { setSelected(null); setChurn(null); }}>{t('pos.back_to_results')}</button>
          </div>
          {loading ? <div className="state">{t('pos.evaluating_churn_risk')}</div>
            : error ? <ErrorBox message={error} />
            : churn ? (
            churn.level === 'insufficient'
              ? <InsufficientData>{churn.evidence?.[0] || t('pos.not_enough_history_to_assess_churn_1yfd')}</InsufficientData>
              : <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}><span className="sub">{t('pos.churn_risk')}</span><RiskChip level={churn.level} /></div>
                  <EvidenceList items={churn.evidence} />
                  <div className="sub" style={{ marginTop: 10, fontStyle: 'italic' }}>{churn.note}</div>
                  <div style={{ marginTop: 10 }}><Freshness f={churn.freshness} /></div>
                </>
          ) : null}
        </section>
      )}

      {error && !selected && <ErrorBox message={error} />}
    </div>
  );
}
