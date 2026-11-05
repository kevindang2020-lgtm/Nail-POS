// Super-Admin → AI Queue Assignment — BUILD_PLAN Phase 6 (ai_queue_assignment). The audit's UI row "Super Admin
// oversight screen: MISSING" (admin-web never called /super-admin/ai-queue-assignment).
//
// Platform totals (bug 12: salons counted as DISTINCT salons, not branch rows; AI calls by the statuses AiPlatform really
// writes; auto-assignments counted apart from staff acceptances — bug 13), the background jobs' last runs, every salon
// (searchable) with its auto-assign state and open alerts, and one salon's detail: each location's EFFECTIVE settings
// (on / allowed / what blocks it, thresholds, rotation, last auto-run and scan), the salon defaults, open alerts (reasons
// are minutes and counts — never a guest), 30-day decisions and AI calls, and the settings change log.
// The salon-wide auto-assign kill switch needs super_admin.ai.manage (the buttons are hidden without it — the server
// refuses regardless), a reason of at least 12 characters (audited) and a fresh step-up — the shared client re-confirms
// and retries once; a cancelled step-up is reported plainly.
import { useCallback, useEffect, useState } from 'react';
import { useInlineAsk } from '@aipowersalon/ui';
import { useAuth } from '../auth/AuthContext';
import {
  superAdminAiQueueAssignmentApi as aqApi, AQ_MANAGE_PERMISSION, AQ_MIN_KILL_REASON,
  type AqPlatformOverview, type AqSalonRow, type AqSalonDetail, type AqEffectiveSettings,
} from '../api/superAdminAiQueueAssignmentApi';

const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '—');
const pct = (r: number | null | undefined) => (r == null ? '—' : `${Math.round(r * 100)}%`);
const when = (iso?: string | null) => { if (!iso) return 'never'; const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const label = (k: string) => k.replace(/_/g, ' ');
const counts = (r: Record<string, number> | null | undefined) => Object.entries(r ?? {}).filter(([, v]) => v > 0).map(([k, v]) => `${label(k)} ${v}`).join(' · ');
const BLOCKED: Record<string, string> = { platform: 'the platform-wide switch', salon_kill_switch: 'the salon kill switch', disabled: 'switched off' };
const failMessage = (e: any, fallback: string) => (e?.code === 'STEP_UP_REQUIRED'
  ? 'Not changed — this needs you to confirm your identity again (step-up), and that was not completed.'
  : e?.message || fallback);
const autoText = (eff: AqEffectiveSettings | null) => {
  if (!eff) return '—';
  if (eff.autoAllowed) return 'On';
  if (eff.autoBlockedBy === 'disabled' || !eff.autoEnabled) return 'Off';
  return `On, but blocked by ${BLOCKED[eff.autoBlockedBy ?? ''] ?? label(String(eff.autoBlockedBy))}`;
};

export function AiQueueAssignmentOversightScreen() {
  const { principal } = useAuth();
  const canManage = !!principal?.permissions?.includes(AQ_MANAGE_PERMISSION);
  const [overview, setOverview] = useState<AqPlatformOverview | 'failed' | null>(null);
  const [salons, setSalons] = useState<AqSalonRow[] | 'failed' | null>(null);
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AqSalonDetail | 'failed' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { ask, askUi } = useInlineAsk();

  const loadDetail = useCallback((tenantId: string) => {
    setDetail(null);
    aqApi.tenant(tenantId).then(setDetail).catch(() => setDetail('failed'));
  }, []);
  const loadOverview = useCallback(() => { aqApi.overview().then(setOverview).catch(() => setOverview('failed')); }, []);
  const loadSalons = useCallback(() => { aqApi.tenants(search).then(setSalons).catch(() => setSalons('failed')); }, [search]);
  useEffect(() => { loadOverview(); }, [loadOverview]);
  useEffect(() => { loadSalons(); }, [loadSalons]);
  useEffect(() => { if (openId) loadDetail(openId); }, [openId, loadDetail]);

  const toggleKill = (tenantId: string, name: string, killed: boolean) => ask(
    killed
      ? `Stop AI auto-assignment for every location of ${name}? Suggestions keep working; nothing is assigned automatically until it is switched back on. Why?`
      : `Allow AI auto-assignment again for ${name}? Locations that have it on will start auto-assigning. Why?`,
    (reason) => {
      void aqApi.setAutoKill(tenantId, killed, reason)
        .then((r) => { setNotice(r.killed ? `Auto-assignment stopped for ${name}.` : `Auto-assignment allowed again for ${name}.`); loadOverview(); loadSalons(); if (openId === tenantId) loadDetail(tenantId); })
        .catch((e: any) => setNotice(failMessage(e, 'Not changed.')));
    },
    { minLength: AQ_MIN_KILL_REASON, inputLabel: 'Reason', confirmLabel: killed ? 'Stop auto-assign' : 'Allow auto-assign' },
  );

  const o = overview && overview !== 'failed' ? overview : null;
  const cards: [string, string][] = o ? [
    ['Salons using it', n(o.salons.using)], ['Salons with the AI package', n(o.salons.entitled)], ['Salons with auto-assign on', n(o.salons.autoEnabled)], ['Salons stopped', n(o.salons.autoKilled)],
    ['Recommendations (30 days)', n(o.recommendations.last30Days)], ['Recommendations (all time)', n(o.recommendations.total)], ['Staff acceptance', pct(o.decisions.acceptanceRate)],
    ['Accepted', n(o.decisions.accepted)], ['Rejected', n(o.decisions.rejected)], ['Overridden', n(o.decisions.overridden)], ['Auto-assigned', n(o.decisions.auto_assigned)],
    ['Open alerts', n(o.alerts.open)], ['Alerts resolved automatically', n(o.alerts.autoResolved)],
  ] : [];
  const d = detail && detail !== 'failed' ? detail : null;
  const branchName = (id: string) => d?.branches.find((b) => b.branchId === id)?.name ?? id.slice(0, 8);

  return (
    <div style={{ padding: 24, display: 'grid', gap: 18 }} data-testid="aq-oversight">
      <h1 style={{ margin: 0, fontSize: 22 }}>AI Queue Assignment</h1>
      {notice && <div role="status" style={{ padding: 10, background: '#F3F0E8', borderRadius: 8 }}>{notice}</div>}
      {askUi}
      {o?.platformAutoActionsDisabled ? <div data-testid="aq-platform-off" style={{ padding: 10, borderRadius: 8, background: '#FBEDEA', color: '#B85B4D' }}>AI auto-actions are switched off platform-wide (Kill Switches) — no salon auto-assigns.</div> : null}
      {overview === 'failed' ? <div role="alert">Could not load the overview.</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 10 }}>
          {cards.map(([l, v]) => <div key={l} data-testid="aq-card" style={{ border: '1px solid #e5e1d8', borderRadius: 10, padding: 10 }}><div style={{ fontSize: 11, color: '#6b7280' }}>{l}</div><div style={{ fontWeight: 800, fontSize: 18 }}>{v}</div></div>)}
        </div>
      )}
      {o && (
        <div style={{ fontSize: 13, display: 'grid', gap: 4 }}>
          {counts(o.alerts.openByType) && <div data-testid="aq-alert-types">Open alerts by type: {counts(o.alerts.openByType)}</div>}
          {counts(o.alerts.openBySeverity) && <div data-testid="aq-alert-severity">Open alerts by severity: {counts(o.alerts.openBySeverity)}</div>}
          <div data-testid="aq-calls">AI explanation calls: {counts(o.aiCalls) || 'none'}</div>
          <div data-testid="aq-jobs">Background jobs: last scan {when(o.jobs.lastScanAt)} · last auto-run {when(o.jobs.lastAutoRunAt)} · {o.jobs.branchesScannedLast10Min} location(s) scanned in the last 10 minutes</div>
        </div>
      )}

      <section>
        <h2 style={{ fontSize: 16 }}>Salons</h2>
        <input aria-label="Search salons" placeholder="Salon name" value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 8 }} />
        {!canManage && <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }} data-testid="aq-view-only">View only — stopping a salon’s auto-assignment needs the AI management permission.</div>}
        {salons === 'failed' ? <div role="alert">Could not load salons.</div> : salons && salons.length === 0 ? <div>{search.trim() ? 'No salon matches.' : 'No salon has AI queue assignment set up yet.'}</div> : (
          <table style={{ width: '100%', fontSize: 13 }}>
            <thead><tr><th align="left">Salon</th><th align="left">Auto-assign</th><th align="right">Open alerts</th><th align="right">Staff decisions (30d)</th><th align="right">Auto-assigned (30d)</th><th align="left">Last auto-run</th><th /></tr></thead>
            <tbody>{(salons ?? []).map((t) => (
              <tr key={t.tenantId} data-testid="aq-tenant">
                <td>{t.name}{t.status !== 'active' ? <span style={{ color: '#6b7280' }}> ({t.status})</span> : null}</td>
                <td>{t.autoKilled ? <span style={{ color: '#B85B4D' }}>Stopped{t.autoKilledReason ? ` — ${t.autoKilledReason}` : ''}</span> : t.branchesAutoOn > 0 ? `On at ${t.branchesAutoOn} of ${t.branches}` : 'Off'}</td>
                <td align="right">{t.openAlerts}{t.criticalAlerts ? <span style={{ color: '#B85B4D' }}> ({t.criticalAlerts} critical)</span> : null}</td>
                <td align="right">{t.decisions30d}</td>
                <td align="right">{t.autoAssigned30d}</td>
                <td>{when(t.lastAutoRunAt)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button onClick={() => setOpenId(openId === t.tenantId ? null : t.tenantId)} aria-expanded={openId === t.tenantId}>{openId === t.tenantId ? 'Close' : 'Details'}</button>
                  {canManage && <>{' '}<button onClick={() => toggleKill(t.tenantId, t.name, !t.autoKilled)}>{t.autoKilled ? 'Allow auto-assign…' : 'Stop auto-assign…'}</button></>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>

      {openId && (
        <section data-testid="aq-detail" style={{ border: '1px solid #e5e1d8', borderRadius: 12, padding: 14, display: 'grid', gap: 12 }}>
          {detail === 'failed' ? <div role="alert">Could not load this salon.</div> : !d ? <div>Loading…</div> : (<>
            <h2 style={{ fontSize: 16, margin: 0 }}>{d.tenant.name}</h2>
            <div data-testid="aq-detail-auto" style={{ fontSize: 13 }}>
              {d.auto.salonKilled
                ? <span style={{ color: '#B85B4D' }}>Auto-assignment is stopped for this salon{d.auto.salonKilledReason ? ` — ${d.auto.salonKilledReason}` : ''}.</span>
                : <span>Auto-assignment is allowed for this salon · acting at {d.auto.branchesAllowed} of {d.branches.length} location(s).</span>}
              {d.auto.platformAutoActionsDisabled ? <span style={{ color: '#B85B4D' }}> The platform-wide switch is off.</span> : null}
              {canManage && <>{' '}<button onClick={() => toggleKill(d.tenant.tenantId, d.tenant.name, !d.auto.salonKilled)}>{d.auto.salonKilled ? 'Allow auto-assign…' : 'Stop auto-assign…'}</button></>}
            </div>

            <div>
              <h3 style={{ fontSize: 14, margin: '4px 0' }}>Locations</h3>
              {d.branches.length === 0 ? <div style={{ fontSize: 13 }}>No locations.</div> : (
                <table style={{ width: '100%', fontSize: 13 }}>
                  <thead><tr><th align="left">Location</th><th align="left">Auto-assign</th><th align="left">Wait alerts (min)</th><th align="left">Rotation</th><th align="right">Open alerts</th><th align="left">Last auto-run</th><th align="left">Last scan</th></tr></thead>
                  <tbody>{d.branches.map((b) => (
                    <tr key={b.branchId} data-testid="aq-branch">
                      <td>{b.name}{b.status !== 'active' ? ` (${b.status})` : ''}</td>
                      <td>{autoText(b.effective)}</td>
                      <td>{b.effective ? `${b.effective.waitApproachingMin} / ${b.effective.waitExceededMin} / ${b.effective.waitSevereMin} / ${b.effective.waitCriticalMin}` : '—'}</td>
                      <td>{b.effective ? label(b.effective.rotationPolicy) : '—'}</td>
                      <td align="right">{b.openAlerts}</td>
                      <td>{when(b.lastAutoRunAt)}</td>
                      <td>{when(b.lastScanAt)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>

            <div>
              <h3 style={{ fontSize: 14, margin: '4px 0' }}>Salon defaults</h3>
              {d.salonSettings ? (
                <div data-testid="aq-settings" style={{ fontSize: 13, display: 'grid', gap: 2 }}>
                  <div>Wait alerts at {d.salonSettings.waitApproachingMin} / {d.salonSettings.waitExceededMin} / {d.salonSettings.waitSevereMin} / {d.salonSettings.waitCriticalMin} min · stuck after {d.salonSettings.stuckMinutes} min · late grace {d.salonSettings.lateGraceMin} min</div>
                  <div>Rotation: {label(d.salonSettings.rotationPolicy)}</div>
                  <div>Auto-assign {d.salonSettings.autoEnabled ? 'on' : 'off'} · confidence floor {pct(d.salonSettings.autoConfidenceFloor)} · up to {d.salonSettings.autoMaxPerRun} per run · after {d.salonSettings.autoDelaySeconds}s</div>
                  <div>Never auto-assigns: {Object.entries(d.salonSettings.autoExclusions ?? {}).filter(([, v]) => v === true || (Array.isArray(v) && v.length > 0)).map(([k, v]) => (Array.isArray(v) ? `${label(k)} (${v.length})` : label(k))).join(', ') || 'no exclusions'}</div>
                  <div style={{ color: '#6b7280' }}>Settings version {d.salonSettings.version}</div>
                </div>
              ) : <div style={{ fontSize: 13 }}>Platform defaults (nothing saved for this salon).</div>}
            </div>

            <div>
              <h3 style={{ fontSize: 14, margin: '4px 0' }}>Open alerts</h3>
              {d.openAlerts.length === 0 ? <div style={{ fontSize: 13 }}>No open alerts.</div> : (
                <table style={{ width: '100%', fontSize: 13 }}>
                  <thead><tr><th align="left">Type</th><th align="left">Severity</th><th align="left">What</th><th align="left">Location</th><th align="right">Age</th></tr></thead>
                  <tbody>{d.openAlerts.map((a) => (
                    <tr key={a.id} data-testid="aq-alert">
                      <td>{label(a.type)}</td><td>{label(a.severity)}</td><td>{a.reason}</td><td>{branchName(a.branchId)}</td><td align="right">{a.ageMinutes} min</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>

            <div style={{ fontSize: 13 }} data-testid="aq-detail-30d">
              <div>Decisions (30 days): {counts(d.decisions30d) || 'none'}</div>
              <div>AI calls (30 days): {counts(d.aiCalls30d) || 'none'}</div>
            </div>

            {d.versions.length > 0 && (
              <div>
                <h3 style={{ fontSize: 14, margin: '4px 0' }}>Settings changes</h3>
                <ul style={{ fontSize: 13, margin: 0, paddingLeft: 18 }}>
                  {d.versions.slice(0, 10).map((v) => <li key={`${v.branchId ?? 'salon'}-${v.version}`} data-testid="aq-version">v{v.version} · {label(v.change)}{v.reason ? ` — ${v.reason}` : ''} · {when(v.createdAt)}</li>)}
                </ul>
              </div>
            )}
          </>)}
        </section>
      )}
    </div>
  );
}
