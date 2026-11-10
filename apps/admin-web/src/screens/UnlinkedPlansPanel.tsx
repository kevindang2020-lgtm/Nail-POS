// UnlinkedPlansPanel.tsx — Super Admin → Plans: salons whose subscription plan text matches no feature-catalogue plan
// (their Features page lists nothing) and a one-click, audited link. Linking sets the subscription's plan_code only — the
// plan text, price, status and period are untouched (batch 8 decision 3, Nov 9 2026).
import { useCallback, useEffect, useState } from 'react';
import { superAdminPlansApi, type UnlinkedTenantsResponse } from '../api/superAdminPlansApi';

const box = { background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 4px 18px rgba(169, 111, 34, 0.06)' } as const;

export function UnlinkedPlansPanel() {
  const [d, setD] = useState<UnlinkedTenantsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); superAdminPlansApi.unlinkedTenants().then(setD).catch((e: Error) => setErr(e?.message || 'Could not load salons.')); }, []);
  useEffect(load, [load]);
  const link = async (tenantId: string) => {
    const code = pick[tenantId]; const why = (reason[tenantId] || '').trim();
    if (!code || why.length < 5) return;
    setBusy(tenantId); setMsg(null);
    try { const r = await superAdminPlansApi.linkTenantPlan(tenantId, code, why); setMsg(`Linked "${r.planText}" to ${r.planCode}. Price and status were not changed.`); load(); }
    catch (e) { setMsg((e as Error)?.message || 'Link failed.'); }
    finally { setBusy(null); }
  };
  return (
    <section className="panel" aria-label="Salons not linked to a catalogue plan" data-testid="sa-unlinked-plans" style={box}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Salons not linked to a catalogue plan</h2>
        <span className="muted" style={{ fontSize: 12 }}>{d ? `· ${d.tenants.length}` : ''}</span>
        <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={load}>Refresh</button>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>Their plan name matches no plan in the catalogue, so their Features and limits pages show nothing. Linking only connects the plan — it never changes price, status or billing.</p>
      {err ? <div className="err">{err}</div> : !d ? <div className="muted">Loading…</div> : d.tenants.length === 0 ? <div className="muted" data-testid="sa-unlinked-none">Every salon's plan is linked.</div> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {d.tenants.map((t) => (
            <div key={t.tenantId} data-testid="sa-unlinked-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', border: '1px solid var(--line)', borderRadius: 10, padding: 10 }}>
              <div style={{ flex: '1 1 200px', minWidth: 0 }}><div style={{ fontWeight: 700 }}>{t.tenantName || t.tenantCode || t.tenantId}</div>
                <div className="muted" style={{ fontSize: 12 }}>{t.tenantCode || '—'} · plan "{t.planText}" · {t.status}</div></div>
              <select aria-label={`Catalogue plan for ${t.tenantName || t.tenantId}`} value={pick[t.tenantId] || ''} onChange={(e) => setPick((c) => ({ ...c, [t.tenantId]: e.target.value }))}>
                <option value="">Choose a catalogue plan…</option>
                {d.plans.map((p) => <option key={p.code} value={p.code}>{p.name} ({p.code}){p.status !== 'active' ? ` · ${p.status}` : ''}</option>)}
              </select>
              <input aria-label="Reason" placeholder="Reason (at least 5 characters)" value={reason[t.tenantId] || ''} onChange={(e) => setReason((c) => ({ ...c, [t.tenantId]: e.target.value }))} style={{ flex: '1 1 200px' }} />
              <button className="btn" data-testid="sa-unlinked-link" disabled={busy === t.tenantId || !pick[t.tenantId] || (reason[t.tenantId] || '').trim().length < 5} onClick={() => link(t.tenantId)}>{busy === t.tenantId ? 'Linking…' : 'Link to plan'}</button>
            </div>
          ))}
        </div>
      )}
      {msg ? <div className="muted" data-testid="sa-unlinked-msg" style={{ marginTop: 8, fontSize: 12 }}>{msg}</div> : null}
    </section>
  );
}
