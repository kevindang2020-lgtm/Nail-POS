// AiSubscriptionsScreen.tsx — Super-Admin manager for the 15 paid AI assistant packages (tenant_ai_subscriptions via
// super-admin/ai). Summary cards + package table with rollup; click a package to see its subscribers and assign / grant
// trial / change limit / cancel. Distinct from the legacy per-tenant tier screen at /ai-packages.
import { useEffect, useState, useCallback, useMemo } from 'react';
import { useInlineAsk } from '@aipowersalon/ui';
import { superAdminApi } from '../api/superAdminApi';

const money = (cents: number) => '$' + (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const STATUS_PILL: Record<string, string> = { active: ' ok', trialing: ' ok' };
const inp = { minHeight: 40, border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px', fontFamily: 'inherit', background: '#FFFDF8', width: '100%' } as const;

type Pkg = Awaited<ReturnType<typeof superAdminApi.aiAdminPackages>>['packages'][number];
type Sub = Awaited<ReturnType<typeof superAdminApi.aiAdminPackageTenants>>[number];

export function AiSubscriptionsScreen() {
  const [data, setData] = useState<Awaited<ReturnType<typeof superAdminApi.aiAdminPackages>> | null>(null);
  const [loading, setLoading] = useState(true);
  const { ask, askUi } = useInlineAsk();
  const [err, setErr] = useState<string | null>(null);
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [subsBusy, setSubsBusy] = useState(false);
  const [assignFor, setAssignFor] = useState<Pkg | null>(null);
  const [assign, setAssign] = useState({ tenantId: '', trial: false, usageLimit: '', overageEnabled: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof superAdminApi.aiAdminUsageSummary>>>([]);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([superAdminApi.aiAdminPackages(), superAdminApi.aiAdminUsageSummary().catch(() => [])])
      .then(([d, u]) => { setData(d); setUsage(u as any); setErr(null); })
      .catch((e: any) => setErr(e?.message || 'Failed to load AI packages.'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const openPackage = (code: string) => {
    if (openCode === code) { setOpenCode(null); return; }
    setOpenCode(code); setSubsBusy(true); setSubs([]);
    superAdminApi.aiAdminPackageTenants(code).then(setSubs).catch(() => setSubs([])).finally(() => setSubsBusy(false));
  };
  const refreshSubs = (code: string) => superAdminApi.aiAdminPackageTenants(code).then(setSubs).catch(() => {});

  const submitAssign = async () => {
    if (!assignFor || !assign.tenantId.trim()) { setNote('Tenant ID is required.'); return; }
    setBusy('assign'); setNote(null);
    try {
      await superAdminApi.aiAdminAssign(assign.tenantId.trim(), {
        packageCode: assignFor.code, trial: assign.trial, overageEnabled: assign.overageEnabled,
        ...(assign.usageLimit ? { usageLimit: Number(assign.usageLimit) } : {}),
      });
      setNote(`${assign.trial ? 'Trial granted' : 'Package assigned'} for ${assignFor.name}.`);
      const code = assignFor.code; setAssignFor(null); setAssign({ tenantId: '', trial: false, usageLimit: '', overageEnabled: false });
      load(); if (openCode === code) refreshSubs(code);
    } catch (e: any) { setNote(e?.message || 'Could not assign the package.'); } finally { setBusy(null); }
  };
  const cancelSub = async (s: Sub) => {
    setBusy(s.tenantId + s.packageCode); setNote(null);
    try { await superAdminApi.aiAdminCancel(s.tenantId, s.packageCode); load(); refreshSubs(s.packageCode); }
    catch (e: any) { setNote(e?.message || 'Could not cancel.'); } finally { setBusy(null); }
  };
  const setLimit = (s: Sub) => ask(`New monthly usage limit for ${s.tenantName || s.tenantId} (0 = unlimited):`, (v) => { void applyLimit(s, v); },
    { defaultValue: String(s.usageLimit), inputLabel: 'Monthly usage limit', confirmLabel: 'Set limit' });
  const applyLimit = async (s: Sub, v: string) => {
    setBusy(s.tenantId + s.packageCode); setNote(null);
    try { await superAdminApi.aiAdminUpdate(s.tenantId, s.packageCode, { usageLimit: Number(v) || 0 }); load(); refreshSubs(s.packageCode); }
    catch (e: any) { setNote(e?.message || 'Could not update the limit.'); } finally { setBusy(null); }
  };

  const usageByCode = useMemo(() => {
    const m = new Map<string, { calls: number; amount: number; micro: number }>();
    for (const r of usage) { const e = m.get(r.packageCode) ?? { calls: 0, amount: 0, micro: 0 }; e.calls += r.calls; e.amount += r.usageAmount; e.micro += r.costMicroUsd; m.set(r.packageCode, e); }
    return m;
  }, [usage]);
  const totalMicro = useMemo(() => usage.reduce((a, r) => a + r.costMicroUsd, 0), [usage]);
  const totalCalls = useMemo(() => usage.reduce((a, r) => a + r.calls, 0), [usage]);
  const usd = (micro: number) => `$${(micro / 1_000_000).toFixed(micro >= 1_000_000 ? 2 : 4)}`;

  const t = data?.totals;
  return (
    <div className="work">
      <div className="vh"><h1>AI Subscriptions</h1><div className="sub">The 15 paid AI assistant packages · assign, grant trials, set limits, cancel · revenue and usage roll up per package</div></div>
      {note ? <div className="state" style={{ margin: '8px 0' }}>{note}</div> : null}
      {err ? <div className="err" style={{ margin: '10px 0' }}>{err} <button className="linkbtn" onClick={load}>Retry</button></div> : null}

      <div className="kpis k4" style={{ margin: '10px 0 14px' }}>
        <div className="kpi"><div className="l">AI Packages</div><div className="v">{data?.packages.length ?? 15}</div></div>
        <div className="kpi"><div className="l">Subscriptions</div><div className="v">{t?.subscribers ?? 0}</div></div>
        <div className="kpi"><div className="l">Active</div><div className="v">{t?.activeSubscribers ?? 0}</div></div>
        <div className="kpi"><div className="l">AI MRR</div><div className="v">{money(t?.mrrCents ?? 0)}</div></div>
      </div>
      <div className="muted" style={{ margin: '-6px 0 14px' }}>AI usage cost to date (COGS): <strong>{usd(totalMicro)}</strong> across {totalCalls.toLocaleString()} calls · provider token spend, summed from usage logs</div>

      {loading ? <div className="state">Loading…</div> : (
        <section className="panel">
          <div className="w-full min-w-0 overflow-x-auto">
            <div className="list min-w-[900px]" style={{ maxHeight: 'none' }}>
            {(data?.packages ?? []).map((p) => (
              <div key={p.code}>
                <div className="row">
                  <div style={{ minWidth: 0 }}>
                    <div className="t">{p.name} <span className="muted">· {p.category}</span></div>
                    <div className="s">{money(p.monthlyPriceCents)}/mo · {p.includedUsageLimit.toLocaleString()} {p.usageUnit} included · {p.trialDays}-day trial{(() => { const u = usageByCode.get(p.code); return u && u.calls > 0 ? ` · ${u.calls.toLocaleString()} calls · ${usd(u.micro)} cost` : ''; })()}</div>
                  </div>
                  <span className="pill" style={{ marginLeft: 'auto' }}>{p.subscribers} subs</span>
                  <span className={'pill' + (p.activeSubscribers ? ' ok' : '')}>{p.activeSubscribers} active</span>
                  <span className="pill">{money(p.mrrCents)} MRR</span>
                  <button className="btn !min-h-[25px]" onClick={() => { setAssignFor(p); setNote(null); }}>Assign</button>
                  <button className="btn ghost !min-h-[25px]" onClick={() => openPackage(p.code)}>{openCode === p.code ? 'Close' : 'Subscribers'}</button>
                </div>
                {openCode === p.code ? (
                  <div className="panel" style={{ margin: '6px 0 12px', background: '#FFFDF8' }}>
                    {subsBusy ? <div className="state">Loading subscribers…</div> : subs.length === 0 ? <div className="s muted">No tenants subscribed to this package.</div> : (
                      <table className="ttable" style={{ width: '100%' }}>
                        <thead><tr><th>Tenant</th><th>Status</th><th>Limit</th><th>Overage</th><th>Trial ends</th><th></th></tr></thead>
                        <tbody>
                          {subs.map((s) => (
                            <tr key={s.tenantId}>
                              <td>{s.tenantName || s.tenantId}</td>
                              <td><span className={'pill' + (STATUS_PILL[s.status] || '')}>{s.status}</span></td>
                              <td>{s.usageLimit === 0 ? 'Unlimited' : s.usageLimit.toLocaleString()}</td>
                              <td>{s.overageEnabled ? 'On' : 'Off'}</td>
                              <td>{s.trialEndsAt ? new Date(s.trialEndsAt).toLocaleDateString() : '—'}</td>
                              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                                <button className="btn ghost" disabled={busy === s.tenantId + s.packageCode} onClick={() => setLimit(s)}>Limit</button>
                                <button className="btn ghost" disabled={busy === s.tenantId + s.packageCode || s.status === 'cancelled'} onClick={() => cancelSub(s)}>Cancel</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          </div>
        </section>
      )}

      {assignFor ? (
        <div className="modal" onClick={() => setAssignFor(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="phead"><h2>Assign · {assignFor.name}</h2><button className="linkbtn" onClick={() => setAssignFor(null)}>Close</button></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 2px' }}>
              <label>Tenant ID<input style={inp} placeholder="tenant UUID" value={assign.tenantId} onChange={(e) => setAssign({ ...assign, tenantId: e.target.value })} /></label>
              <label>Monthly usage limit<input style={inp} placeholder={`default ${assignFor.includedUsageLimit} (0 = unlimited)`} value={assign.usageLimit} onChange={(e) => setAssign({ ...assign, usageLimit: e.target.value })} /></label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={assign.trial} onChange={(e) => setAssign({ ...assign, trial: e.target.checked })} /> Grant {assignFor.trialDays}-day trial (else active/paid)</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={assign.overageEnabled} onChange={(e) => setAssign({ ...assign, overageEnabled: e.target.checked })} /> Allow overage beyond the limit</label>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn ghost" onClick={() => setAssignFor(null)}>Cancel</button>
                <button className="btn" disabled={busy === 'assign'} onClick={submitAssign}>{busy === 'assign' ? 'Saving…' : assign.trial ? 'Grant Trial' : 'Assign Package'}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {askUi}
    </div>
  );
}
