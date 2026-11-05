// AIPackagesScreen.tsx — AI package tier per tenant (spec §13), bound to the CANONICAL tenant_ai_packages table
// (append-only history; the newest row is the current package — same read super-admin-tenants uses). Shows the
// ai_calls limit/usage alongside; deeper per-feature toggles are not modeled in this table (honest scope note below).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { superAdminApi } from '../api/superAdminApi';

const TIERS = ['None', 'AI Basic', 'AI Pro'];
const FEATURES: [string, string][] = [
  ['ai_receptionist', 'AI Receptionist'], ['ai_booking', 'AI Booking'], ['ai_customer_insights', 'AI Customer Insights'],
  ['ai_reports', 'AI Reports'], ['ai_reminders', 'AI Reminders'], ['ai_workflow_assistant', 'AI Workflow Assistant'], ['voice_assistant', 'Voice Assistant'],
];

export function AIPackagesScreen() {
  const nav = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    superAdminApi.aiPackages()
      .then((r: any) => { setRows(Array.isArray(r) ? r : []); setErr(null); })
      .catch((e: any) => setErr(e?.message || 'Failed to load AI packages.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const save = async (tenantId: string) => {
    const pkg = edit[tenantId];
    if (!pkg) return;
    setBusy(tenantId); setErr(null);
    try { await superAdminApi.setAiPackage(tenantId, pkg); setEdit((e) => { const n = { ...e }; delete n[tenantId]; return n; }); load(); }
    catch (e: any) { setErr(e?.message || 'Could not change the package.'); }
    finally { setBusy(null); }
  };
  const pct = (used?: number | null, lim?: number | null) => (used == null || !lim ? null : Math.min(100, Math.round((used / lim) * 100)));

  return (
    <div className="work">
      <div className="vh"><h1>AI Packages</h1><div className="sub">Package tier per tenant (history kept; newest wins) · ai_calls usage vs limit shown — edit limits on Usage Limits</div></div>
      {err ? <div className="err" style={{ margin: '10px 0' }}>{err}</div> : null}
      {loading ? <div className="state">Loading…</div> : rows.length === 0 ? <div className="state">No tenants yet.</div> : (
        <section className="panel" style={{ marginTop: 12 }}>
          <div className="w-full min-w-0 overflow-x-auto">
            <div className="list min-w-[900px]" style={{ maxHeight: 'none' }}>
            {rows.map((t) => {
              const p = pct(t.aiCallsUsed, t.aiCallsLimit);
              return (
                <div key={t.tenantId}>
                <div className="row">
                  <div style={{ minWidth: 0 }}>
                    <div className="t">{t.tenantName} <span className="muted">· {t.tenantCode}</span></div>
                    <div className="s">AI calls: {t.aiCallsUsed ?? '—'} / {t.aiCallsLimit ?? 'no limit set'}{p != null ? ` (${p}%)` : ''}</div>
                  </div>
                  <span className={'pill' + (t.package !== 'None' ? ' ok' : '')} style={{ marginLeft: 'auto' }}>{t.package}</span>
                  <select value={edit[t.tenantId] ?? t.package} onChange={(e) => setEdit({ ...edit, [t.tenantId]: e.target.value })} style={{ minHeight: 32, border: '1px solid var(--line)', borderRadius: 11, padding: '8px 10px', fontFamily: 'inherit', background: '#FFFDF8' }}>
                    {TIERS.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                    <button className="btn !min-h-[30px]" disabled={busy === t.tenantId || !edit[t.tenantId] || edit[t.tenantId] === t.package} onClick={() => save(t.tenantId)}>{busy === t.tenantId ? 'Saving…' : 'Change Package'}</button>
                    <button className="btn ghost !min-h-[30px]" onClick={() => nav('/usage-limits')}>Limits</button>
                  <button className="btn ghost !min-h-[30px]" onClick={() => setOpenId(openId === t.tenantId ? null : t.tenantId)}>{openId === t.tenantId ? 'Close' : 'Features'}</button>
                </div>
                {openId === t.tenantId ? (
                  <div className="panel" style={{ margin: '6px 0 12px', background: '#FFFDF8' }}>
                    <div className="s muted" style={{ marginBottom: 8 }}>Per-feature access (spec §13). The package tier gates all AI — on tier <b>None</b> every feature is off regardless of overrides. Inherit = on within an AI tier.</div>
                    {FEATURES.map(([key, label]) => {
                      const eff = t.effectiveFeatures?.[key] === true;
                      const ov = t.featureOverrides?.[key];
                      const k = t.tenantId + '|' + key;
                      const setF = (v: boolean | null) => { setBusy(k); setErr(null); superAdminApi.setAiFeature(t.tenantId, key, v).then(load).catch((e: any) => setErr(e?.message || 'Could not change the feature.')).finally(() => setBusy(null)); };
                      return (
                        <div key={key} className="row" style={{ minHeight: 44 }}>
                          <div className="t" style={{ fontSize: 13 }}>{label} <span className="muted" style={{ fontWeight: 500 }}>· {ov === undefined ? 'inherited' : ov ? 'forced on' : 'forced off'}</span></div>
                          <span className={'pill' + (eff ? ' ok' : '')} style={{ marginLeft: 'auto' }}>{eff ? 'On' : 'Off'}</span>
                          <button className="btn ghost" disabled={busy === k || ov === true} onClick={() => setF(true)}>On</button>
                          <button className="btn ghost" disabled={busy === k || ov === false} onClick={() => setF(false)}>Off</button>
                          <button className="btn ghost" disabled={busy === k || ov === undefined} onClick={() => setF(null)}>Inherit</button>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                </div>
              );
            })}
          </div>
          </div>
          <div className="s muted" style={{ marginTop: 10 }}>Per-feature toggles are live (spec §13): tap Features on a tenant. Effective access flows to the tenant's POS settings automatically.</div>
        </section>
      )}
    </div>
  );
}
