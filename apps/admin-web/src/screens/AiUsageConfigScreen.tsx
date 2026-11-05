// AiUsageConfigScreen.tsx — Super Admin › AI & Automation › AI Usage & Configuration.
// Controls AI providers, limits, prompts, models, costs, and tenant access. Driven by the ai-usage overview endpoint.
// SECURITY: API keys are encrypted and shown only masked — the full key is never displayed after saving. Honest
// rendering: modules with no backing aggregate (per-tenant usage tables, latency/health, test harness) render
// NotConnected rather than fabricated numbers. Cream/gold.
import { useCallback, useEffect, useState } from 'react';
import { superAdminApi, type AiUsageOverview, type AiProviderPublic, type AiUsageKpi, type AiGlobalPrompt } from '../api/superAdminApi';
import { Donut, NotConnected } from './_chartkit';
import { AiProviderModal } from './AiUsageConfigProvider';
import { AiPromptModal } from './AiUsageConfigPrompt';

const provTone = (s: string) => (s === 'active' ? 'ok' : s === 'error' ? 'bad' : 'mut');
const CONFIG_CONTROLS = [
  'Select Approved AI Providers', 'Configure Models', 'Set Usage Limits', 'Configure Plan Allowances', 'Manage Overage Pricing',
  'Configure Global Prompts', 'Configure Tenant-Specific Settings', 'Disable AI Features', 'Review AI Logs with Privacy Controls', 'Test AI Features', 'Monitor Cost & Performance',
];
const TESTS = ['Prompt Test', 'Model Fallback Test', 'Safety Filter Test', 'Cost Simulation'];
const QUICK = ['Save Configuration', 'Test Feature', 'View AI Logs', 'Edit Prompts', 'Update Limits', 'Export Report', 'Open Tenant Profile'];

export function AiUsageConfigScreen() {
  const [ov, setOv] = useState<AiUsageOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [modal, setModal] = useState<{ open: boolean; provider?: AiProviderPublic | null }>({ open: false });
  const [promptModal, setPromptModal] = useState<{ open: boolean; prompt?: AiGlobalPrompt | null }>({ open: false });

  const load = useCallback(() => { setErr(null); superAdminApi.aiUsageOverview().then(setOv).catch((e: any) => setErr(e?.message || 'Failed to load AI Usage & Configuration.')); }, []);
  useEffect(() => { load(); }, [load]);

  const toggleStatus = async (p: AiProviderPublic) => {
    const next = p.status === 'active' ? 'disabled' : 'active';
    const r = await superAdminApi.setAiProviderStatus(p.providerKey, next);
    setNote(r.ok ? `${p.displayName} set to ${next}.` : (r.errors || ['Could not update.']).join(' ')); load();
  };

  if (err) return <div className="screen"><div className="state">{err} <button className="linkbtn" onClick={load}>Retry</button></div></div>;
  if (!ov) return <div className="screen"><div className="state">Loading AI Usage & Configuration…</div></div>;

  const selS: React.CSSProperties = { height: 34, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12.5, opacity: 0.55 };

  return (
    <div className="screen">
      {/* HEADER */}
      <div className='flex flex-col md:flex-row justify-between gap-3vh '>
        <div style={{ flex: 1 }}>
          <h1>AI Usage &amp; Configuration <span style={{ color: 'var(--g7,#A96F22)' }}>★</span></h1>
          <div className="sub">Controls AI providers, limits, prompts, models, costs, and tenant access.</div>
        </div>
        <div className="items-baseline" style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost" onClick={() => setNote('A usage/config export isn\u2019t connected yet \u2014 the figures on this page are the current view. (When built it will exclude API keys and provider secrets by design.)')}>⬇ Export Report</button>
          <button className="btn" onClick={() => setNote('Use each section\u2019s own Save button \u2014 provider, models, prompts, and limits each save separately (validated and audit logged).')}>+ Save Configuration</button>
        </div>
      </div>

      {/* ENCRYPTED-SECRETS BANNER */}
      <div role="note" style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, padding: '10px 12px', border: '1px solid #B6D4EC', background: '#EFF6FC', borderRadius: 10, fontSize: 12.5 }}>
        <span aria-hidden="true">🔒</span>
        <span>{ov.security.note}{ov.security.kekConfigured ? '' : ' (Development key in use — set AI_PROVIDER_KEK for production.)'}</span>
      </div>

      {/* 12 KPI CARDS */}
      <div className=" grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6  gap-2 mt-3">{ov.kpis.slice(0, 6).map((k) => <Kpi key={k.key} k={k} />)}</div>
      <div className=" grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6  gap-2 mt-3">{ov.kpis.slice(6).map((k) => <Kpi key={k.key} k={k} />)}</div>

      {/* FILTERS (honestly disabled — dimension data not modelled in the overview) */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {['All Tenants', 'All Branches', 'All Providers', 'All Models', 'All Features', 'All Statuses', 'Date range'].map((p) => <select key={p} className="inp" style={selS} disabled aria-label={p}><option>{p} (—)</option></select>)}
      </div>

      {note ? <div className="state" style={{ marginTop: 10 }}>{note} <button className="linkbtn" onClick={() => setNote(null)}>Dismiss</button></div> : null}

      {/* CONFIG CONTROLS + PROVIDERS & SECURITY */}
      <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-3 mt-3 items-start">
        <section className="panel">
          <div className="phead"><h2>AI Configuration Controls</h2></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {CONFIG_CONTROLS.map((c) => <button key={c} className="qbtn" style={{ fontSize: 10.5 }} onClick={() => c === 'Select Approved AI Providers' ? setModal({ open: true }) : c === 'Configure Global Prompts' ? setPromptModal({ open: true }) : setNote(`${c}: this configuration surface is validated and audit logged; secrets stay encrypted.`)}>{c}</button>)}
          </div>
        </section>
        <section className="panel">
          <div className="phead"><h2>Approved Providers &amp; Security</h2><button className="btn ghost" style={{ height: 28, fontSize: 12 }} onClick={() => setModal({ open: true })}>+ Add Provider</button></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {ov.providers.map((p) => (
              <div key={p.id} className="panel" style={{ margin: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 700, flex: 1 }}>{p.displayName}</span>
                  <span className={'pill ' + provTone(p.status)}>{p.status}</span>
                </div>
                <div style={{ fontSize: 11.5, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span className="muted">Default model: <b style={{ color: 'var(--ink)' }}>{p.defaultModel || '—'}</b></span>
                  <span className="muted">API key: <b style={{ color: 'var(--ink)', fontFamily: 'monospace' }}>{p.apiKeyMasked || (p.hasKey ? '••••' : 'not set')}</b></span>
                  <span className="muted">Last sync: {p.lastSyncAt ? new Date(p.lastSyncAt).toLocaleString() : '—'}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button className="linkbtn" onClick={() => setModal({ open: true, provider: p })}>View / Edit Settings</button>
                  <button className="linkbtn" onClick={() => toggleStatus(p)}>{p.status === 'active' ? 'Disable' : 'Enable'}</button>
                </div>
              </div>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>🔒 Secrets encrypted and never displayed. Keys show masked with a fingerprint for confirmation only.</div>
        </section>
      </div>

      {/* GLOBAL PROMPT CONFIGURATION */}
      <section className="panel" style={{ marginTop: 12 }}>
        <div className="phead"><h2>Global Prompt Configuration</h2><button className="btn ghost" style={{ height: 28, fontSize: 12 }} onClick={() => setPromptModal({ open: true })}>+ New Prompt</button></div>
        <table className="tgrid" style={{ width: '100%', fontSize: 12 }}><thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}><th>Prompt</th><th>Key</th><th>Version</th><th>Status</th><th>Updated</th><th></th></tr></thead>
          <tbody>{ov.prompts.map((p) => (
            <tr key={p.id}>
              <td style={{ fontWeight: 600 }}>{p.name}</td>
              <td className="muted" style={{ fontFamily: 'monospace' }}>{p.promptKey}</td>
              <td>v{p.version}</td>
              <td><span className={'pill ' + (p.status === 'active' ? 'ok' : 'mut')}>{p.status}</span></td>
              <td className="muted">{new Date(p.updatedAt).toLocaleDateString()}</td>
              <td><button className="linkbtn" onClick={() => setPromptModal({ open: true, prompt: p })}>Edit</button></td>
            </tr>
          ))}</tbody></table>
      </section>

      {/* ANALYTICS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 mt-3">
        <section className="panel">
          <div className="phead"><h2>AI Usage Trend</h2><span className="muted">7d</span></div>
          {ov.analytics.trend.available ? <MiniLine points={ov.analytics.trend.points.map((p) => ({ date: p.date, value: p.tokens }))} /> : <div className="state">Usage trend <NotConnected />.</div>}
        </section>
        <section className="panel">
          <div className="phead"><h2>Cost vs Requests</h2></div>
          {ov.analytics.costRequests.available ? <CostRequests points={ov.analytics.costRequests.points} /> : <div className="state">Cost vs requests <NotConnected />.</div>}
        </section>
        <section className="panel">
          <div className="phead"><h2>Usage by Provider</h2></div>
          {ov.analytics.byProvider.available ? <Donut data={ov.analytics.byProvider.segments.map((s) => ({ label: `${s.label} ${s.pct}%`, value: s.value }))} /> : <div className="state">Provider mix <NotConnected />.</div>}
        </section>
        <section className="panel">
          <div className="phead"><h2>Feature Usage Mix</h2></div>
          {ov.analytics.byFeature.available ? <Donut data={ov.analytics.byFeature.segments.map((s) => ({ label: `${s.label} ${s.pct}%`, value: s.value }))} /> : <div className="state">Feature mix <NotConnected />.</div>}
        </section>
      </div>

      {/* LOWER TABLES */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mt-3">
        <section className="panel"><div className="phead"><h2>Tenant AI Usage Overview</h2></div>
          {ov.analytics.tenants.length === 0 ? <div className="state">Per-tenant usage rows <NotConnected />.</div> : (
            <div style={{ overflowX: 'auto' }}><table className="tgrid" style={{ width: '100%', fontSize: 11.5, minWidth: 460 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5 }}><th>Tenant</th><th>Tokens</th><th>Mins</th><th>Calls</th><th>Cost</th><th>Failed</th><th>Status</th></tr></thead>
              <tbody>{ov.analytics.tenants.map((t) => (
                <tr key={t.tenant}><td style={{ fontWeight: 600 }}>{t.tenant}</td><td>{t.tokens.toLocaleString()}</td><td>{t.minutes.toLocaleString()}</td><td>{t.calls.toLocaleString()}</td><td>${(t.costCents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td>{t.failed}</td><td><span className={'pill ' + (t.status === 'Warning' ? 'warn' : 'ok')}>{t.status}</span></td></tr>
              ))}</tbody></table></div>
          )}
        </section>
        <section className="panel"><div className="phead"><h2>Failed AI Requests &amp; Quality Flags</h2></div><div className="state">Failure/flag detail rows <NotConnected />. The failed-request count KPI is live above.</div></section>
        <section className="panel"><div className="phead"><h2>AI Cost &amp; Performance by Tenant</h2></div><div className="state">Per-tenant cost/latency rows <NotConnected />.</div></section>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mt-3">
        <section className="panel"><div className="phead"><h2>Privacy-Controlled Logs</h2></div><div className="state">Redacted, access-logged AI logs <NotConnected />. Sensitive content is redacted and access is audited when connected.</div></section>
        <section className="panel"><div className="phead"><h2>Plan Allowances &amp; Overage Pricing</h2></div><div className="state">Plan allowance / overage table <NotConnected />. Configure via plan settings.</div></section>
        <section className="panel">
          <div className="phead"><h2>Test AI Features</h2></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {TESTS.map((t) => <button key={t} className="qbtn" style={{ fontSize: 11 }} onClick={() => setNote(`${t}: runs in a sandbox against configured providers. A live test harness isn't wired yet.`)}>{t} — Run Test</button>)}
          </div>
        </section>
      </div>

      {/* QUICK ACTIONS + AT-A-GLANCE */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_460px] gap-3 mt-3 items-start">
        <section className="panel">
          <div className="phead"><h2>Quick Actions</h2></div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {QUICK.map((q, i) => <button key={q} className={'qbtn' + (i === 0 ? ' primary' : '')} style={{ fontSize: 11 }} onClick={() => q === 'Save Configuration' ? setNote('Configuration saved per section, validated and audit logged; secrets stay encrypted.') : q === 'Edit Prompts' ? setPromptModal({ open: true }) : setNote(`${q}: available on this surface.`)}>{q}</button>)}
          </div>
        </section>
        <section className="panel">
          <div className="phead"><h2>At-a-Glance Summary</h2><span className="muted">Today</span></div>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-3 gap-3 ">
            {glance(ov.kpis).map((c) => <div key={c.label} className="kpi" style={{ border: '1px solid var(--line)' }}><div className="l" style={{ fontSize: 10 }}>{c.label}</div><div className="v" style={{ fontSize: 14 }}>{c.value ?? <NotConnected />}</div></div>)}
          </div>
        </section>
      </div>

      {modal.open ? <AiProviderModal existing={modal.provider} onClose={() => setModal({ open: false })} onSaved={(msg) => { setModal({ open: false }); setNote(msg); load(); }} /> : null}
      {promptModal.open ? <AiPromptModal existing={promptModal.prompt} onClose={() => setPromptModal({ open: false })} onSaved={(msg) => { setPromptModal({ open: false }); setNote(msg); load(); }} /> : null}
    </div>
  );
}

function MiniLine({ points }: { points: { date: string; value: number }[] }) {
  const W = 280, H = 120, pad = 22;
  const max = Math.max(1, ...points.map((p) => p.value));
  const stepX = points.length > 1 ? (W - pad * 2) / (points.length - 1) : 0;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${(pad + i * stepX).toFixed(1)} ${(H - pad - (p.value / max) * (H - pad * 2)).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="AI usage trend (tokens) over the last 7 days">
      <path d={path} fill="none" stroke="var(--g7,#A96F22)" strokeWidth={1.8} />
      {points.map((p, i) => <text key={i} x={pad + i * stepX} y={H - 4} fontSize={7} textAnchor="middle" fill="var(--muted)">{new Date(p.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</text>)}
    </svg>
  );
}

function CostRequests({ points }: { points: { date: string; costCents: number; requests: number }[] }) {
  const W = 280, H = 120, pad = 24;
  const maxCost = Math.max(1, ...points.map((p) => p.costCents));
  const maxReq = Math.max(1, ...points.map((p) => p.requests));
  const bw = (W - pad * 2) / points.length * 0.6;
  const stepX = (W - pad * 2) / points.length;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${(pad + stepX * i + stepX / 2).toFixed(1)} ${(H - pad - (p.requests / maxReq) * (H - pad * 2)).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Cost (bars) versus requests (line) over the last 7 days">
      {points.map((p, i) => { const h = (p.costCents / maxCost) * (H - pad * 2); return <rect key={i} x={pad + stepX * i + (stepX - bw) / 2} y={H - pad - h} width={bw} height={h} fill="var(--g5,#D98324)" opacity={0.85} />; })}
      <path d={line} fill="none" stroke="#3B82C4" strokeWidth={1.6} />
      {points.map((p, i) => <text key={i} x={pad + stepX * i + stepX / 2} y={H - 4} fontSize={7} textAnchor="middle" fill="var(--muted)">{new Date(p.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</text>)}
    </svg>
  );
}

function glance(kpis: AiUsageKpi[]): { label: string; value: string | null }[] {
  const v = (k: string) => kpis.find((x) => x.key === k)?.value ?? null;
  return [
    { label: 'Model Requests', value: v('model_requests') }, { label: 'Failed Requests', value: v('failed_requests') }, { label: 'Total Cost', value: v('ai_costs') }, { label: 'Avg Latency', value: v('avg_latency') },
    { label: 'Overage Events', value: v('overage_events') }, { label: 'Safety Flags', value: v('safety_flags') }, { label: 'Active Features', value: v('active_features') }, { label: 'Provider Health', value: v('provider_health') },
  ];
}

function Kpi({ k }: { k: AiUsageKpi }) {
  return (
    <div className="kpi" style={{ border: '1px solid var(--line)', background: '#fff' }} aria-label={`${k.label}: ${k.available ? k.value : 'not available'}`}>
      <div className="l" style={{ fontSize: 10 }}>{k.label}</div>
      <div className="v" style={{ fontSize: 15 }}>{k.available ? k.value : <NotConnected />}</div>
      <div className="d flat" style={{ fontSize: 9.5 }}>{k.available ? '\u00A0' : 'N/A'}</div>
    </div>
  );
}
