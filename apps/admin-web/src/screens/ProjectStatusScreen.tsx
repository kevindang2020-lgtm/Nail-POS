import { useCallback, useEffect, useState } from 'react';
import { superAdminApi } from '../api/superAdminApi';

// Super-Admin → Project Status — reads GET /super-admin/project-status/pos-settings (parent + per-section module status)
// and lets an operator re-run a module's readiness check via PATCH .../pos-settings/:moduleKey/recheck. Behind the
// SuperAdminGuard server-side; tenant POS users cannot reach it. Shows the live build/connect/test readiness flags the
// backend computes (route + component + endpoint + api-client + clicks + tests) — never fabricated.
type ModuleStatus = {
  moduleKey: string; label: string; route: string; completionPercent: number;
  status: 'Complete' | 'In Progress' | 'Needs Review' | 'Blocked' | 'Not Started';
  missingReasons: string[];
  frontendRouteExists: boolean; frontendComponentExists: boolean; backendEndpointExists: boolean;
  apiClientConnected: boolean; clicksWorking: boolean; testsPassing: boolean;
  lastCheckedAt?: string; goLivePending?: string[];
};
type PosSettings = { parent: ModuleStatus; sections: ModuleStatus[] };

const tone = (s: string) => (s === 'Complete' ? 'ok' : s === 'Blocked' || s === 'Not Started' ? 'bad' : 'warn');
const flag = (on: boolean, label: string) => (
  <span className={'pill ' + (on ? 'ok' : '')} style={!on ? { opacity: 0.45 } : undefined} key={label}>{on ? '✓ ' : '· '}{label}</span>
);

export function ProjectStatusScreen() {
  const [s, setS] = useState<PosSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    (superAdminApi.projectStatus() as Promise<PosSettings>)
      .then((r) => { setS(r); setError(null); })
      .catch((e: any) => setError(e?.message || 'Failed to load project status.'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const recheck = async (moduleKey: string) => {
    setBusy(moduleKey);
    try { await superAdminApi.recheckModule(moduleKey); load(); }
    catch (e: any) { setError(e?.message || 'Recheck failed.'); }
    finally { setBusy(null); }
  };

  if (error) return <div className="work"><div className="vh"><h1>Project Status</h1></div><div className="err">{error}</div></div>;
  if (!s) return <div className="work"><div className="state">Loading project status…</div></div>;

  const sections = s.sections || [];
  const done = sections.filter((m) => m.status === 'Complete').length;
  const review = sections.filter((m) => m.status === 'Needs Review' || m.status === 'In Progress').length;
  const blocked = sections.filter((m) => m.status === 'Blocked' || m.status === 'Not Started').length;
  const kpis: { l: string; v: string; warn?: boolean }[] = [
    { l: 'Overall', v: `${s.parent.completionPercent}%` },
    { l: 'Status', v: s.parent.status },
    { l: 'Sections', v: String(sections.length) },
    { l: 'Complete', v: String(done) },
    { l: 'In Progress / Review', v: String(review), warn: review > 0 },
    { l: 'Blocked / Not Started', v: String(blocked), warn: blocked > 0 },
  ];

  return (
    <div className="work">
      <div className="vh" style={{ display: 'flex', alignItems: 'center' }}>
        <div> <h1 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 26, display: 'flex', alignItems: 'center', gap: 8 }}>Project Status <span style={{ color: '#DCB056' }} aria-hidden>★</span></h1><div className="sub">POS module readiness · {s.parent.label} · {s.parent.completionPercent}% complete</div></div>
        <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={load}>Refresh</button>
      </div>

      <div className="kpis">
        {kpis.map((c) => (<div className="kpi" key={c.l}><div className="l">{c.l}</div><div className="v" style={c.warn ? { color: 'var(--danger, #B4452F)' } : undefined}>{c.v}</div></div>))}
      </div>

      <section className="panel">
        <h2>Modules</h2>

        <div className="w-full overflow-x-auto">
          <div className="list min-w-[1000px]">
            {sections.length === 0 ? (
              <div className="muted">No module status reported.</div>
            ) : null}

            {sections.map((m) => (
              <div
                key={m.moduleKey}
                style={{
                  borderBottom: '1px solid var(--line, #E7DFce)',
                  padding: '10px 0',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ minWidth: 200 }}>
                    <div className="t">{m.label}</div>
                    <div className="s">{m.route}</div>
                  </div>

                  <span className={'pill ' + tone(m.status)}>{m.status}</span>
                  <span className="s">{m.completionPercent}%</span>

                  <div
                    style={{
                      display: 'flex',
                      gap: 4,
                      flexWrap: 'wrap',
                      marginLeft: 'auto',
                    }}
                  >
                    {flag(m.frontendRouteExists, 'route')}
                    {flag(m.frontendComponentExists, 'component')}
                    {flag(m.backendEndpointExists, 'api')}
                    {flag(m.apiClientConnected, 'client')}
                    {flag(m.clicksWorking, 'clicks')}
                    {flag(m.testsPassing, 'tests')}
                  </div>

                  <button
                    className="btn ghost"
                    disabled={busy === m.moduleKey}
                    onClick={() => recheck(m.moduleKey)}
                  >
                    {busy === m.moduleKey ? 'Rechecking…' : 'Recheck'}
                  </button>
                </div>

                {m.missingReasons && m.missingReasons.length > 0 ? (
                  <div className="s" style={{ marginTop: 4, opacity: 0.8 }}>
                    Missing: {m.missingReasons.join(' · ')}
                  </div>
                ) : null}

                {m.goLivePending && m.goLivePending.length > 0 ? (
                  <div className="s" style={{ marginTop: 2, opacity: 0.8 }}>
                    Go-live pending: {m.goLivePending.join(' · ')}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
