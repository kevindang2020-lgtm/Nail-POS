// Super-Admin → AI Scheduling Optimizer — BUILD_PLAN Phase 7 (ai_scheduling_optimizer → complete).
//
// Platform counts only (salons on / stopped, runs, recommendations by status, applied split MANUAL vs AUTOMATED — the old
// screen counted every manual application as an "auto action" — proposals, open conflicts / understaffing, explanation
// source and AI cost), every salon (searchable) and one salon's operational detail: settings state, recent runs, failed
// applications and recommendation counts. The detail is served ONLY inside an active canonical support session for that
// salon (403 SUPPORT_SESSION_REQUIRED → "Start a support session", which opens Support Mode with a reason + step-up).
// Writes — retry / roll back a failed or applied change, switch a salon's optimizer off, the platform-wide switch — need
// super_admin.ai.manage (buttons hidden otherwise; the server refuses regardless), a reason of at least 12 characters
// (audited) and a fresh step-up; a cancelled step-up is reported plainly. Never a customer, appointment or schedule.
import { useCallback, useEffect, useState } from 'react';
import { useInlineAsk } from '@aipowersalon/ui';
import { useAuth } from '../auth/AuthContext';
import {
  superAdminAiSchedulingOptimizerApi as saApi, SCHED_MANAGE_PERMISSION, SCHED_MIN_REASON,
  type SaSchedOverview, type SaSchedTenantRow, type SaSchedTenantDetail,
} from '../api/superAdminAiSchedulingOptimizerApi';

const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '—');
const when = (iso?: string | null) => { if (!iso) return 'never'; const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const label = (k: string) => k.replace(/_/g, ' ');
const counts = (r: Record<string, number> | null | undefined) => Object.entries(r ?? {}).filter(([, v]) => v > 0).map(([k, v]) => `${label(k)} ${v}`).join(' · ');
const failMessage = (e: any, fallback: string) => (e?.code === 'STEP_UP_REQUIRED'
  ? 'Not changed — this needs you to confirm your identity again (step-up), and that was not completed.'
  : e?.message || fallback);

type Detail = SaSchedTenantDetail | 'failed' | 'needs-session' | null;

export function AiSchedulingOversightScreen() {
  const { principal } = useAuth();
  const canManage = !!principal?.permissions?.includes(SCHED_MANAGE_PERMISSION);
  const [overview, setOverview] = useState<SaSchedOverview | 'failed' | null>(null);
  const [salons, setSalons] = useState<SaSchedTenantRow[] | 'failed' | null>(null);
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { ask, askUi } = useInlineAsk();

  const loadOverview = useCallback(() => { saApi.overview().then(setOverview).catch(() => setOverview('failed')); }, []);
  const loadSalons = useCallback(() => { saApi.tenants(search).then(setSalons).catch(() => setSalons('failed')); }, [search]);
  const loadDetail = useCallback((tenantId: string) => {
    setDetail(null); setDetailErr(null);
    saApi.tenant(tenantId).then(setDetail).catch((e: any) => {
      if (e?.code === 'SUPPORT_SESSION_REQUIRED' || e?.status === 403) { setDetail('needs-session'); setDetailErr(e?.message || null); }
      else { setDetail('failed'); setDetailErr(e?.message || null); }
    });
  }, []);
  useEffect(() => { loadOverview(); }, [loadOverview]);
  useEffect(() => { loadSalons(); }, [loadSalons]);
  useEffect(() => { if (openId) loadDetail(openId); }, [openId, loadDetail]);
  const reloadAll = (tenantId?: string) => { loadOverview(); loadSalons(); if (tenantId && openId === tenantId) loadDetail(tenantId); };

  const withReason = (question: string, confirmLabel: string, run: (reason: string) => Promise<unknown>, done: string, tenantId?: string) => ask(question, (reason) => {
    void run(reason).then(() => { setNotice(done); reloadAll(tenantId); }).catch((e: any) => setNotice(failMessage(e, 'Not changed.')));
  }, { minLength: SCHED_MIN_REASON, inputLabel: 'Reason', confirmLabel });

  const nameOf = (tenantId: string) => (Array.isArray(salons) ? salons.find((s) => s.tenantId === tenantId)?.tenantName : null) ?? 'this salon';
  const disable = (t: { tenantId: string; tenantName: string }) => withReason(
    `Switch the AI Scheduling Optimizer off for every location of ${t.tenantName}? No suggestions are generated and automation stops until the salon turns it back on. Why?`,
    'Switch off', (r) => saApi.disable(t.tenantId, r), `The optimizer is switched off for ${t.tenantName}.`, t.tenantId);
  const platform = (killed: boolean) => withReason(
    killed ? 'Pause the AI Scheduling Optimizer for EVERY salon? Nothing is generated or automated anywhere until it is switched back on. Why?' : 'Switch the AI Scheduling Optimizer back on platform-wide? Each salon’s own settings apply again. Why?',
    killed ? 'Pause everywhere' : 'Switch back on', (r) => saApi.platformSwitch(killed, r), killed ? 'The optimizer is paused platform-wide.' : 'The optimizer is back on platform-wide.');
  const recAction = (tenantId: string, recommendationId: string, action: 'retry' | 'rollback') => withReason(
    action === 'retry' ? 'Retry applying this change for the salon (it re-checks the appointment first)? Why?' : 'Roll this applied change back (the appointment returns to where it was)? Why?',
    action === 'retry' ? 'Retry' : 'Roll back', (r) => (action === 'retry' ? saApi.retry(tenantId, recommendationId, r) : saApi.rollback(tenantId, recommendationId, r)),
    action === 'retry' ? 'Retry sent.' : 'Rolled back.', tenantId);
  const startSession = (tenantId: string) => ask(`Open a support session for ${nameOf(tenantId)} to see its optimizer detail? It is time-limited and audited. Why?`, (reason) => {
    void saApi.startSupportSession(tenantId, reason).then((r: any) => {
      if (r?.ok === false) { setNotice(r?.errors?.[0] || 'Could not open a support session.'); return; }
      setNotice('Support session started.'); window.dispatchEvent(new CustomEvent('aps:support-mode-changed')); loadDetail(tenantId);
    }).catch((e: any) => setNotice(failMessage(e, 'Could not open a support session.')));
  }, { minLength: SCHED_MIN_REASON, inputLabel: 'Reason', confirmLabel: 'Start support session' });

  const o = overview && overview !== 'failed' ? overview : null;
  const cards: [string, string][] = o ? [
    ['Salons with it on', n(o.enabledTenants)], ['Salons switched off', n(o.killedTenants)],
    ['Runs (all)', n(o.runs.total)], ['Runs (24 h)', n(o.runs.last24h)], ['Runs failed', n(o.runs.failed)],
    ['Applied by staff', n(o.applied.manual)], ['Applied automatically', n(o.applied.automated)], ['Apply failed', n(o.applied.failed)],
    ['Open conflicts', n(o.conflictsOpen)], ['Understaffed periods', n(o.understaffingOpen)],
    ['Explanations (AI / template)', `${n(o.explanations.llm)} / ${n(o.explanations.template)}`], ['AI cost (30 days)', `$${((o.llmCostMicroUsd30d ?? 0) / 1_000_000).toFixed(2)}`],
  ] : [];
  const d = detail && typeof detail === 'object' ? detail : null;

  return (
    <div style={{ padding: 24, display: 'grid', gap: 18 }} data-testid="sched-oversight">
      <h1 style={{ margin: 0, fontSize: 22 }}>AI Scheduling Optimizer</h1>
      {notice && <div role="status" style={{ padding: 10, background: '#F3F0E8', borderRadius: 8 }}>{notice}</div>}
      {askUi}
      {o?.platformKilled ? <div data-testid="sched-platform-off" style={{ padding: 10, borderRadius: 8, background: '#FBEDEA', color: '#B85B4D' }}>The optimizer is paused platform-wide — no salon generates or automates changes.</div> : null}
      {canManage && o ? <div><button onClick={() => platform(!o.platformKilled)}>{o.platformKilled ? 'Switch back on platform-wide…' : 'Pause for every salon…'}</button></div> : null}
      {overview === 'failed' ? <div role="alert">Could not load the overview.</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 10 }}>
          {cards.map(([l, v]) => <div key={l} data-testid="sched-card" style={{ border: '1px solid #e5e1d8', borderRadius: 10, padding: 10 }}><div style={{ fontSize: 11, color: '#6b7280' }}>{l}</div><div style={{ fontWeight: 800, fontSize: 18 }}>{v}</div></div>)}
        </div>
      )}
      {o && (
        <div style={{ fontSize: 13, display: 'grid', gap: 4 }}>
          <div data-testid="sched-recs-by-status">Recommendations by status: {counts(o.recommendations) || 'none'}</div>
          <div data-testid="sched-proposals">Customer proposals: {counts(o.proposals) || 'none'}</div>
          <div style={{ color: '#6b7280' }}>Updated {when(o.generatedAt)}</div>
        </div>
      )}

      <section>
        <h2 style={{ fontSize: 16 }}>Salons</h2>
        <input aria-label="Search salons" placeholder="Salon name" value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 8 }} />
        {!canManage && <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }} data-testid="sched-view-only">View only — switching the optimizer off, retrying or rolling back needs the AI management permission.</div>}
        {salons === 'failed' ? <div role="alert">Could not load salons.</div> : salons && salons.length === 0 ? <div>{search.trim() ? 'No salon matches.' : 'No salon uses the optimizer yet.'}</div> : (
          <table style={{ width: '100%', fontSize: 13 }}>
            <thead><tr><th align="left">Salon</th><th align="left">Optimizer</th><th align="right">Runs (30d)</th><th align="right">Applied (30d)</th><th align="right">Failed (30d)</th><th align="left">Last run</th><th /></tr></thead>
            <tbody>{(salons ?? []).map((t) => (
              <tr key={t.tenantId} data-testid="sched-tenant">
                <td>{t.tenantName}</td>
                <td>{t.killed ? <span style={{ color: '#B85B4D' }}>Switched off (kill switch)</span> : t.enabled ? 'On' : 'Off'}</td>
                <td align="right">{t.runs30d}</td><td align="right">{t.applied30d}</td>
                <td align="right">{t.failed30d ? <span style={{ color: '#B85B4D' }}>{t.failed30d}</span> : 0}</td>
                <td>{when(t.lastRunAt)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button onClick={() => setOpenId(openId === t.tenantId ? null : t.tenantId)} aria-expanded={openId === t.tenantId}>{openId === t.tenantId ? 'Close' : 'Details'}</button>
                  {canManage && !t.killed ? <>{' '}<button onClick={() => disable(t)}>Switch off…</button></> : null}
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>

      {openId && (
        <section data-testid="sched-detail" style={{ border: '1px solid #e5e1d8', borderRadius: 12, padding: 14, display: 'grid', gap: 12 }}>
          {detail === 'needs-session' ? (
            <div data-testid="sched-needs-session" style={{ fontSize: 13 }}>
              {detailErr || 'This salon’s detail is shown only inside an active support session for it.'}{' '}
              <button onClick={() => startSession(openId)}>Start a support session…</button>
            </div>
          ) : detail === 'failed' ? <div role="alert">{detailErr || 'Could not load this salon.'}</div> : !d ? <div>Loading…</div> : (<>
            <h2 style={{ fontSize: 16, margin: 0 }}>{nameOf(d.tenantId)}</h2>
            <div style={{ fontSize: 13 }} data-testid="sched-detail-settings">
              Optimizer {d.settings.killed ? 'switched off (kill switch)' : d.settings.enabled ? 'on' : 'off'} · automation {d.settings.automationAllowed ? 'allowed (safe actions)' : 'off'} · settings v{d.settings.version}
              <span style={{ color: '#6b7280' }}> · support session {d.supportSessionId.slice(0, 8)}</span>
            </div>
            <div style={{ fontSize: 13 }}>Recommendations: {counts(d.recommendationsByStatus) || 'none'}</div>
            <div>
              <h3 style={{ fontSize: 14, margin: '4px 0' }}>Recent runs</h3>
              {d.runs.length === 0 ? <div style={{ fontSize: 13 }}>No runs yet.</div> : (
                <table style={{ width: '100%', fontSize: 13 }}><thead><tr><th align="left">Started</th><th align="left">Scope</th><th align="left">Status</th><th align="left">Error</th></tr></thead>
                  <tbody>{d.runs.slice(0, 15).map((r) => <tr key={r.id} data-testid="sched-detail-run"><td>{when(r.startedAt)}</td><td>{label(r.scope)}</td><td>{r.status}</td><td>{r.errorCode ?? ''}</td></tr>)}</tbody></table>
              )}
            </div>
            <div>
              <h3 style={{ fontSize: 14, margin: '4px 0' }}>Applications that need attention</h3>
              {d.failedApplications.length === 0 ? <div style={{ fontSize: 13 }}>None.</div> : (
                <table style={{ width: '100%', fontSize: 13 }}><thead><tr><th align="left">Recommendation</th><th align="left">Status</th><th align="left">Error</th><th align="right">Attempt</th><th align="left">Updated</th><th /></tr></thead>
                  <tbody>{d.failedApplications.map((f) => (
                    <tr key={f.recommendationId} data-testid="sched-failed-app">
                      <td>{f.recommendationId.slice(0, 8)}</td><td>{label(f.status)}</td><td>{f.errorCode ?? '—'}</td><td align="right">{f.attempt}</td><td>{when(f.updatedAt)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{canManage ? <>
                        {f.status === 'application_failed' ? <button onClick={() => recAction(d.tenantId, f.recommendationId, 'retry')}>Retry…</button> : null}
                        {f.status === 'applied' ? <button onClick={() => recAction(d.tenantId, f.recommendationId, 'rollback')}>Roll back…</button> : null}
                      </> : null}</td>
                    </tr>
                  ))}</tbody></table>
              )}
            </div>
          </>)}
        </section>
      )}
    </div>
  );
}
