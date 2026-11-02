// POSAIMoneyProtectionSettingsScreen.tsx — AI Center → AI Money Protection → Settings. Wired to GET /rules
// (catalog + defaults) + GET /settings (tenant overrides) and POST /settings/:ruleId (ai_money_protection.
// manage_settings). Lets an authorized user enable/disable a rule, override its severity, and tune bounded
// thresholds. Validation is enforced server-side; a rejected value surfaces its message inline.
import { useEffect, useState } from 'react';
import { posAIMoneyProtectionApi } from '../api/posAIMoneyProtectionApi';
import { reportError } from './reportsCommon';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

import { growthCode } from './growthLabels';
type Rule = { id: string; name: string; category: string; layer: string; severity: string; defaultThresholds: Record<string, number | string>; enabled: boolean };
type Setting = { ruleId: string; enabled: boolean; severityOverride: string | null; thresholds: Record<string, number> };
type Draft = { enabled: boolean; severityOverride: string; thresholds: Record<string, string> };

const SEVERITIES = ['', 'INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const label = (t: string) => growthCode((t || '').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase(), 'aiMoneyProtection');

export function POSAIMoneyProtectionSettingsScreen() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [rowMsg, setRowMsg] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    (async () => {
      try {
        const [cat, settings] = await Promise.all([
          posAIMoneyProtectionApi.rules() as Promise<{ rules: Rule[] }>,
          posAIMoneyProtectionApi.getSettings() as Promise<Record<string, Setting>>,
        ]);
        if (!alive) return;
        setRules(cat.rules || []);
        const d: Record<string, Draft> = {};
        for (const r of cat.rules || []) {
          const s = settings?.[r.id];
          d[r.id] = {
            enabled: s ? s.enabled : true,
            severityOverride: s?.severityOverride ?? '',
            thresholds: Object.fromEntries(Object.entries(r.defaultThresholds).map(([k, v]) => [k, String(s?.thresholds?.[k] ?? v)])),
          };
        }
        setDrafts(d);
      } catch (e: any) { if (alive) setError(reportError(e, tx('growth.noun.settings'))); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  const patch = (id: string, p: Partial<Draft>) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...p } }));
  const patchThreshold = (id: string, k: string, v: string) => setDrafts((d) => ({ ...d, [id]: { ...d[id], thresholds: { ...d[id].thresholds, [k]: v } } }));

  const save = async (r: Rule) => {
    const d = drafts[r.id]; if (!d) return;
    setSaving(r.id); setRowMsg((m) => ({ ...m, [r.id]: '' }));
    const thresholds: Record<string, number> = {};
    for (const [k, v] of Object.entries(d.thresholds)) if (v !== '' && Number.isFinite(Number(v))) thresholds[k] = Number(v);
    try {
      await posAIMoneyProtectionApi.updateSetting(r.id, { enabled: d.enabled, severityOverride: d.severityOverride || null, thresholds });
      setRowMsg((m) => ({ ...m, [r.id]: 'Saved.' }));
    } catch (e: any) { setRowMsg((m) => ({ ...m, [r.id]: reportError(e, tx('growth.noun.save')) })); }
    finally { setSaving(null); }
  };

  if (loading) return <div className="work"><div className="state">{tx('pos.loading_settings')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;

  return (
    <div className="work">
      <div className="vh">
        <h1>{tx('pos.money_protection_settings')}</h1>
        <div className="sub mb-3">{tx('pos.enable_disable_rules_adjust_severity_and_1pnq')}</div>
      </div>

      <section className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="overflow-x-auto w-full">
          <table className="tbl w-full min-w-max">
            <thead>
              <tr>
                <th style={{ padding: '10px 12px' }}>{tx('pos.rule')}</th>
                <th className="whitespace-nowrap text-center" style={{ padding: '10px 12px' }}>{tx('pos.enabled')}</th>
                <th className="whitespace-nowrap" style={{ padding: '10px 12px' }}>{tx('pos.severity_override')}</th>
                <th className="whitespace-nowrap" style={{ padding: '10px 12px' }}>{tx('pos.thresholds')}</th>
                <th className="whitespace-nowrap" style={{ padding: '10px 12px', textAlign: 'right' }}>{tx('pos.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {(rules || []).map((r) => {
                const d = drafts[r.id]; if (!d) return null;
                const tKeys = Object.keys(r.defaultThresholds);
                return (
                  <tr key={r.id} className="hover:bg-black/5 transition-colors">
                    <td style={{ padding: '12px 12px', verticalAlign: 'top' }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5, color: '#111827', marginBottom: 2 }}>{r.name}</div>
                      <div style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.4 }}>{label(r.category)} · {label(r.layer)} {tx('pos.default')}{' '}{growthCode(r.severity, 'level')}</div>
                    </td>
                    <td style={{ padding: '12px 12px', verticalAlign: 'top', textAlign: 'center' }}>
                      <input type="checkbox" checked={d.enabled} onChange={(e) => patch(r.id, { enabled: e.target.checked })} aria-label={tx('pos.enable_name', { name: String(r.name) })} style={{ width: 16, height: 16, cursor: 'pointer', marginTop: 2 }} />
                    </td>
                    <td style={{ padding: '12px 12px', verticalAlign: 'top' }}>
                      <select value={d.severityOverride} onChange={(e) => patch(r.id, { severityOverride: e.target.value })} aria-label={tx('pos.severity_override_for_name', { name: String(r.name) })} style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '4px 8px', fontSize: 13, background: '#fff', width: 120, outline: 'none' }}>
                        {SEVERITIES.map((s) => <option key={s || 'default'} value={s}>{s || tx('pos.default_4')}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '12px 12px', verticalAlign: 'top' }}>
                      {tKeys.length === 0 ? <span style={{ color: '#9CA3AF', fontSize: 13 }}>—</span> : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                          {tKeys.map((k) => (
                            <label key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#4B5563' }}>
                              {label(k)}:
                              <input type="number" value={d.thresholds[k]} onChange={(e) => patchThreshold(r.id, k, e.target.value)} aria-label={tx('pos.k_for_name', { k: String(label(k)), name: String(r.name) })} style={{ width: 64, border: '1px solid var(--line)', borderRadius: 6, padding: '4px 8px', fontSize: 13, textAlign: 'center', outline: 'none' }} />
                            </label>
                          ))}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '12px 12px', verticalAlign: 'top', textAlign: 'right' }}>
                      <button className="btn w-fit whitespace-nowrap" type="button" onClick={() => save(r)} disabled={saving === r.id} style={{ height: 30, padding: '0 14px', fontSize: 13 }}>
                        {saving === r.id ? tx('pos.saving_2') : tx('pos.save_2')}
                      </button>
                      {rowMsg[r.id] && <div style={{ fontSize: 12, color: rowMsg[r.id] === 'Saved.' ? 'var(--ok, #2e7d32)' : 'var(--danger, #b3261e)', marginTop: 4, fontWeight: 500 }}>{rowMsg[r.id]}</div>}
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
