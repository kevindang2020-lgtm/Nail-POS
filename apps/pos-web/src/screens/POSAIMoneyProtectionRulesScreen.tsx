// POSAIMoneyProtectionRulesScreen.tsx — AI Center → AI Money Protection → Rules & Detection. Wired to
// GET /pos/ai-money-protection/rules (ai_money_protection.view). Read-only transparency into what the module
// detects: every rule with its category, layer, severity, evaluation mode, thresholds, and whether it is enabled
// for this deployment. Every rule requires human review; none acts on money automatically.
import { useEffect, useState } from 'react';
import { posAIMoneyProtectionApi } from '../api/posAIMoneyProtectionApi';
import { reportError } from './reportsCommon';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

import { growthCode } from './growthLabels';
type Rule = {
  id: string; alertType: string; name: string; category: string; layer: string; severity: string;
  evaluationMode: string; humanReview: boolean; description: string; defaultThresholds: Record<string, number | string>; enabled: boolean;
};
type Flags = { enabled: boolean; deterministicRules: boolean; baselines: boolean; reconciliation: boolean; aiSummaries: boolean; autoExactDuplicatePrevention: boolean };
type CatalogResp = { rules: Rule[]; flags: Flags };

const label = (t: string) => growthCode(t, 'aiMoneyProtection');
const sevStyle = (s: string) => {
  if (s === 'CRITICAL') return { bg: '#FDECEC', color: '#B3261E' };
  if (s === 'HIGH') return { bg: '#FEF3E6', color: '#C2410C' };
  if (s === 'MEDIUM') return { bg: '#FDF6E3', color: '#A96F22' };
  return { bg: '#F3F4F6', color: '#6B7280' };
};
const humanKey = (k: string) => growthCode(k.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase(), 'aiMoneyProtection');
const thresholds = (t: Record<string, number | string>) => { const e = Object.entries(t); return e.length ? e.map(([k, v]) => `${humanKey(k)}: ${v}`).join(' · ') : '—'; };

export function POSAIMoneyProtectionRulesScreen() {
  const [data, setData] = useState<CatalogResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    (async () => {
      try { const d = await posAIMoneyProtectionApi.rules() as CatalogResp; if (alive) setData(d); }
      catch (e: any) { if (alive) setError(reportError(e, tx('growth.noun.rules'))); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) return <div className="work"><div className="state">{tx('pos.loading_rules')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!data) return <div className="work"><div className="state">{tx('pos.no_rules')}</div></div>;

  const rules = data.rules || [];
  return (
    <div className="work">
      <div className="vh">
        <h1>{tx('pos.money_protection_rules_detection')}</h1>
        <div className="sub mb-3">{tx('pos.what_this_module_looks_for_and_n6oq')}</div>
      </div>

      <div className="panel" style={{ marginBottom: 16, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, background: '#FFFDF9', border: '1px solid #EBE5D9' }}>
        <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#FDF6E3', color: '#A96F22', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        </div>
        <div style={{ fontSize: 13.5, color: '#4B5563', lineHeight: 1.4 }}>
          {tx('pos.automatic_exact_duplicate_prevention_is')}{' '}<strong style={{ color: data.flags.autoExactDuplicatePrevention ? '#2E7D32' : '#111827' }}>{data.flags.autoExactDuplicatePrevention ? tx('pos.enabled_2') : tx('pos.off_default')}</strong>
          {' '}{tx('pos.this_is_the_only_capability_that_1kte')}
        </div>
      </div>

      <section className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="overflow-x-auto w-full">
          <table className="tbl w-full min-w-max">
            <thead>
              <tr>
                <th style={{ padding: '10px 12px' }}>{tx('pos.rule')}</th>
                <th className="whitespace-nowrap" style={{ padding: '10px 12px' }}>{tx('pos.category')}</th>
                <th className="whitespace-nowrap" style={{ padding: '10px 12px' }}>{tx('pos.layer')}</th>
                <th className="whitespace-nowrap" style={{ padding: '10px 12px' }}>{tx('pos.severity_2')}</th>
                <th className="whitespace-nowrap" style={{ padding: '10px 12px' }}>{tx('pos.mode')}</th>
                <th className="whitespace-nowrap" style={{ padding: '10px 12px' }}>{tx('pos.thresholds')}</th>
                <th className="whitespace-nowrap text-center" style={{ padding: '10px 12px' }}>{tx('pos.human_review')}</th>
                <th className="whitespace-nowrap text-center" style={{ padding: '10px 12px' }}>{tx('pos.status')}</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => {
                const st = sevStyle(r.severity);
                return (
                  <tr key={r.id} className="hover:bg-black/5 transition-colors">
                    <td style={{ padding: '12px 12px', verticalAlign: 'top' }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5, color: '#111827', marginBottom: 2 }}>{r.name}</div>
                      <div style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.4 }}>{r.description}</div>
                    </td>
                    <td style={{ padding: '12px 12px', verticalAlign: 'top', color: '#374151' }}>{label(r.category)}</td>
                    <td style={{ padding: '12px 12px', verticalAlign: 'top', color: '#374151' }}>{label(r.layer)}</td>
                    <td style={{ padding: '12px 12px', verticalAlign: 'top' }}>
                      <span style={{ background: st.bg, color: st.color, padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, letterSpacing: '0.02em', display: 'inline-block' }}>{growthCode(r.severity, 'level')}</span>
                    </td>
                    <td style={{ padding: '12px 12px', verticalAlign: 'top', color: '#374151' }}>{label(r.evaluationMode)}</td>
                    <td style={{ padding: '12px 12px', verticalAlign: 'top', fontSize: 12, color: '#4B5563' }}>{thresholds(r.defaultThresholds)}</td>
                    <td style={{ padding: '12px 12px', verticalAlign: 'top', textAlign: 'center' }}>
                      {r.humanReview ? <span style={{ color: '#6B7280', fontSize: 12.5 }}>{tx('pos.required')}</span> : '—'}
                    </td>
                    <td style={{ padding: '12px 12px', verticalAlign: 'top', textAlign: 'center' }}>
                      <span style={{ background: r.enabled ? '#E8F5E9' : '#F3F4F6', color: r.enabled ? '#2E7D32' : '#6B7280', padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, display: 'inline-block' }}>{r.enabled ? tx('pos.enabled') : tx('pos.off')}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
