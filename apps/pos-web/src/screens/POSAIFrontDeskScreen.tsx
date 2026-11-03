// POSAIFrontDeskScreen.tsx — AI Center → AI Front Desk (/tenant/ai/receptionist/front-desk). AI Front Desk guide (Oct 31 2026),
// rebuilt in place over /pos/ai/front-desk/* (the old /tenant/ai/receptionist/agents routes are retired). Kept from the original:
// the heading + intent line, the All / Draft / Paused / Archived tabs, + Create Agent and the honest "No agents yet".
// Added (§3.2): summary strip · extra verified states (Setup required / Ready / Active / Degraded) · server search, sort, date
// basis + From/To month calendar, 10/20/50 numbered pages (newest first; a filter that hides a new draft says so) · setup &
// alerts · live routing monitor · activity history · the persisted 8-step Create Agent wizard (Save Draft is a database row,
// version-checked) · the agent profile overlay (8 tabs + Edit / Check Health / Duplicate / Pause / Resume / Archive / Restore /
// Rollback / Close) · owner-approved activation with a preflight (current vs proposed route, blockers, rollback destination).
// "Active" is shown only when the salon is live AND the latest recorded call reached this agent — never from a toggle.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { posAiFrontDeskApi, type FdAgentsQuery, type FdSave } from '../api/posAiFrontDeskApi';
import { posAiApi } from '../api/posAiApi';
import { useCan } from '../components/usePermissions';
import { useAuth } from '../auth/AuthContext';
import { errorTextOf } from '../i18n/error-text';
import { fmtDateTime } from '../i18n/format';
import { FitDialog, Pager, Empty, ErrorRetry, useDebounced, requestId } from '../components/FitKit';
import { RangeCalendar } from '../components/FinanceKit';
import { useInlineConfirm } from '@aipowersalon/ui';

const TABS = ['all', 'draft', 'paused', 'archived', 'setup_required', 'ready', 'active', 'degraded'] as const;
const PERIODS = ['', 'today', 'week', 'month', 'year', 'custom'] as const;
const BASES = ['created', 'updated', 'activated'] as const;
const SORTS = ['newest', 'oldest', 'name_az', 'name_za', 'updated'] as const;
const OV_TABS = ['overview', 'business', 'voice', 'routing', 'booking', 'calls', 'usage', 'health'] as const;
const ACTIONS = ['', 'created', 'saved', 'duplicated', 'activated', 'paused', 'resumed', 'archived', 'restored', 'rolled_back', 'health_checked', 'demoted'] as const;
const today = () => new Date().toISOString().slice(0, 10);
const when = (x: string | null | undefined) => (x ? fmtDateTime(x) : '—');
const BIZ_KEYS = ['business_hours', 'services', 'technicians', 'staff_schedule', 'approved_faqs', 'agent_knowledge', 'knowledge_sync', 'tenant_branch', 'audit_jobs', 'hours', 'faqs', 'booking'];
const bizLabel = (k: string) => (BIZ_KEYS.includes(k) ? t('aifd.biz.' + k) : k);
const tone = (s: string) => (['READY', 'active', 'ok'].includes(s) ? 'fd-ok' : ['FAILED', 'degraded'].includes(s) ? 'fd-bad' : ['WARNING', 'setup_required', 'UNKNOWN', 'BLOCKED_EXTERNAL', 'NOT_CONFIGURED'].includes(s) ? 'fd-warn' : 'fd-muted');
const Badge = ({ s, label }: { s: string; label?: string }) => <span className={'fd-badge ' + tone(s)}>{label ?? t('aifd.state.' + s)}</span>;
type Act = { kind: 'pause' | 'resume' | 'archive' | 'restore' | 'rollback' | 'activate'; agent: any };

export function POSAIFrontDeskScreen() {
  const nav = useNavigate();
  const can = useCan();
  const { principal } = useAuth();
  const manage = can('ai.manage');
  const isOwner = String(principal?.role ?? '').toUpperCase() === 'OWNER';
  const [f, setF] = useState<FdAgentsQuery>(() => { try { const u = new URLSearchParams(window.location.search); return { status: u.get('status') || 'all', sort: u.get('sort') || 'newest', pageSize: Number(u.get('size')) || 20, page: 1, dateBasis: 'created' }; } catch { return { status: 'all', sort: 'newest', pageSize: 20, page: 1, dateBasis: 'created' }; } });
  const [qText, setQText] = useState(''); const q = useDebounced(qText, 300);
  const [list, setList] = useState<any>(null); const [err, setErr] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<any>(null); const [monitor, setMonitor] = useState<any>(null);
  const [events, setEvents] = useState<any>(null); const [evF, setEvF] = useState<{ action?: string; page?: number }>({ page: 1 });
  const [notice, setNotice] = useState<string | null>(null); const [newId, setNewId] = useState<string | null>(null);
  const [cal, setCal] = useState(false); const [health, setHealth] = useState<any>(null); const [hBusy, setHBusy] = useState(false);
  const [wizardId, setWizardId] = useState<string | null>(null); const [creating, setCreating] = useState(false);
  const [overlay, setOverlay] = useState<string | null>(null); const [act, setAct] = useState<Act | null>(null);

  useEffect(() => { try { const u = new URLSearchParams(); if (f.status && f.status !== 'all') u.set('status', String(f.status)); if (f.sort && f.sort !== 'newest') u.set('sort', String(f.sort)); if (f.pageSize && f.pageSize !== 20) u.set('size', String(f.pageSize)); window.history.replaceState(null, '', window.location.pathname + (u.toString() ? '?' + u : '')); } catch { /* URL state is a convenience only */ } }, [f.status, f.sort, f.pageSize]);
  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setList(await posAiFrontDeskApi.agents({ ...f, q: q || undefined })); }
    catch (e) { setErr(errorTextOf(e, t('aifd.load_failed'))); }
    finally { setLoading(false); }
  }, [f, q]);
  const loadSide = useCallback(async () => {
    const [s, m] = await Promise.allSettled([posAiFrontDeskApi.summary(), posAiFrontDeskApi.monitor()]);
    setSummary(s.status === 'fulfilled' ? s.value : { error: true }); setMonitor(m.status === 'fulfilled' ? m.value : { error: true });
  }, []);
  const loadEvents = useCallback(async () => { try { setEvents(await posAiFrontDeskApi.events({ action: evF.action || undefined, page: evF.page, pageSize: 10 })); } catch (e) { setEvents({ error: errorTextOf(e, t('aifd.load_failed')) }); } }, [evF]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadSide(); }, [loadSide]);
  useEffect(() => { loadEvents(); }, [loadEvents]);
  const refreshAll = () => { load(); loadSide(); loadEvents(); };
  const setFilter = (p: Partial<FdAgentsQuery>) => setF((o) => ({ ...o, ...p, page: p.page ?? 1 }));
  const filtered = !!(q || (f.status && f.status !== 'all') || f.period || f.from || f.to);
  const hiddenNew = newId && list && !list.items.some((a: any) => a.id === newId);

  async function runHealth() {
    setHBusy(true);
    try { setHealth(await posAiFrontDeskApi.health()); } catch (e) { setNotice(errorTextOf(e, t('aifd.load_failed'))); } finally { setHBusy(false); }
  }
  const c = summary?.counts;
  const tiles: { k: string; v: number | undefined; s: string }[] = [
    { k: 'total', v: c?.total, s: 'all' }, { k: 'draft', v: c?.draft, s: 'draft' }, { k: 'setup_required', v: c?.setupRequired, s: 'setup_required' }, { k: 'ready', v: c?.ready, s: 'ready' },
    { k: 'active', v: c?.active, s: 'active' }, { k: 'degraded', v: c?.degraded, s: 'degraded' }, { k: 'paused', v: c?.paused, s: 'paused' }, { k: 'archived', v: c?.archived, s: 'archived' },
  ];

  return (
    <div className="work fd" data-testid="fd-screen">
      <div className="fd-head">
        <div className="vh"><h1>{t('pos.ai_front_desk')}</h1><div className="sub">{t('aifd.intent')}</div></div>
        <div className="fd-head-actions">
          <button className="btn ghost" onClick={() => nav('/tenant/ai/command-center')}>{t('aifd.open_command_center')}</button>
          <button className="btn ghost" onClick={refreshAll} data-testid="fd-refresh">{t('aifd.refresh')}</button>
          <button className="btn ghost" onClick={runHealth} disabled={hBusy} data-testid="fd-check">{hBusy ? t('aifd.checking') : t('aifd.check_system')}</button>
          {manage ? <button className="btn" onClick={() => setCreating(true)} data-testid="fd-create">+ {t('aifd.create_agent')}</button> : null}
        </div>
      </div>
      {notice ? <div className="fd-notice" role="status" data-testid="fd-notice">{notice} <button className="btn ghost sm" onClick={() => setNotice(null)}>{t('aifd.dismiss')}</button></div> : null}

      <div className="fd-tiles" data-testid="fd-summary">
        {tiles.map((x) => (
          <button key={x.k} className={'fd-tile' + (f.status === x.s ? ' on' : '')} onClick={() => setFilter({ status: x.s })} data-testid={'fd-tile-' + x.k}>
            <span className="fd-tile-l">{t('aifd.tile.' + x.k)}</span><span className="fd-tile-v">{summary?.error ? '—' : x.v ?? '…'}</span>
          </button>
        ))}
      </div>
      {summary?.route ? <div className="fd-muted" data-testid="fd-route-line">{t('aifd.route_line', { stage: t('aifd.stage.' + summary.route.stage) })} · {t('aifd.live_rule')}</div> : null}

      <div className="fd-grid">
        <section className="panel fd-card" data-testid="fd-directory">
          <div className="fd-tabs" role="tablist">
            {TABS.map((s) => <button key={s} role="tab" aria-selected={f.status === s} className={'fd-tab' + (f.status === s ? ' on' : '')} onClick={() => setFilter({ status: s })} data-testid={'fd-tab-' + s}>{t('aifd.tab.' + s)}</button>)}
          </div>
          <div className="fd-toolbar">
            <input className="fd-search" value={qText} onChange={(e) => { setQText(e.target.value); setF((o) => ({ ...o, page: 1 })); }} placeholder={t('aifd.search_ph')} aria-label={t('aifd.search_ph')} data-testid="fd-search" />
            <select value={f.sort} onChange={(e) => setFilter({ sort: e.target.value })} aria-label={t('aifd.sort')}>{SORTS.map((s) => <option key={s} value={s}>{t('aifd.sort.' + s)}</option>)}</select>
            <select value={f.dateBasis} onChange={(e) => setFilter({ dateBasis: e.target.value })} aria-label={t('aifd.date_basis')}>{BASES.map((b) => <option key={b} value={b}>{t('aifd.basis.' + b)}</option>)}</select>
            <select value={f.period ?? ''} onChange={(e) => { const p = e.target.value; if (p === 'custom') setCal(true); else setFilter({ period: p || undefined, from: undefined, to: undefined }); }} aria-label={t('aifd.period')} data-testid="fd-period">
              {PERIODS.map((p) => <option key={p} value={p}>{t('aifd.period.' + (p || 'any'))}</option>)}
            </select>
            <button className="btn ghost" onClick={() => setCal(true)} data-testid="fd-cal-open">{f.from ? `${f.from} → ${f.to}` : t('aifd.from_to')}</button>
            {filtered ? <button className="btn ghost" onClick={() => { setQText(''); setF({ status: 'all', sort: 'newest', pageSize: f.pageSize, page: 1, dateBasis: 'created' }); }} data-testid="fd-clear">{t('aifd.clear_all')}</button> : null}
          </div>
          {f.from || f.period ? <div className="fd-muted" data-testid="fd-active-basis">{t('aifd.active_basis', { basis: t('aifd.basis.' + (f.dateBasis || 'created')), range: list?.filters?.window ? `${list.filters.window.from} → ${list.filters.window.to}` : '…' })}</div> : null}
          {hiddenNew ? <div className="fd-notice" data-testid="fd-hidden-new">{t('aifd.hidden_new')} <button className="btn ghost sm" onClick={() => { setQText(''); setF({ status: 'all', sort: 'newest', pageSize: f.pageSize, page: 1, dateBasis: 'created' }); }}>{t('aifd.view_new')}</button></div> : null}
          {loading && !list ? <div className="fd-muted">{t('aifd.loading')}</div>
            : err ? <ErrorRetry message={err} onRetry={load} />
            : list && list.items.length === 0 ? (filtered
              ? <Empty title={t('aifd.no_match')}><button className="btn ghost" onClick={() => { setQText(''); setF({ status: 'all', sort: 'newest', pageSize: f.pageSize, page: 1, dateBasis: 'created' }); }}>{t('aifd.clear_all')}</button></Empty>
              : <Empty title={t('aifd.no_agents')}><div className="fd-muted">{t('aifd.no_agents_hint')}</div>{manage ? <button className="btn" onClick={() => setCreating(true)}>+ {t('aifd.create_agent')}</button> : null}</Empty>)
            : list ? (
              <div className="fd-tbl-wrap">
                <table className="tbl fd-tbl" data-testid="fd-table">
                  <thead><tr><th>{t('aifd.col.agent')}</th><th>{t('aifd.col.state')}</th><th>{t('aifd.col.branch')}</th><th>{t('aifd.col.provider')}</th><th>{t('aifd.col.booking')}</th><th>{t('aifd.col.updated')}</th><th /></tr></thead>
                  <tbody>{list.items.map((a: any) => (
                    <tr key={a.id} className="fd-row" onClick={() => setOverlay(a.id)} data-testid={'fd-row-' + a.id}>
                      <td><div className="fd-name">{a.name}</div><div className="fd-muted">{a.description || t('aifd.no_description')}</div></td>
                      <td><Badge s={a.effective} /></td>
                      <td>{a.branchName ?? t('aifd.all_branches')}</td>
                      <td>{a.providerRef ?? <span className="fd-muted">{t('aifd.not_linked')}</span>}</td>
                      <td>{t('aifd.mode.' + a.bookingMode)}</td>
                      <td className="fd-muted">{when(a.updatedAt)}</td>
                      <td><div className="fd-actions" onClick={(e) => e.stopPropagation()}>
                        <button className="btn ghost sm" onClick={() => setOverlay(a.id)}>{t('aifd.open')}</button>
                        {manage && ['draft', 'ready', 'paused', 'error'].includes(a.status) ? <button className="btn ghost sm" onClick={() => setWizardId(a.id)} data-testid={'fd-edit-' + a.id}>{t('aifd.edit')}</button> : null}
                      </div></td>
                    </tr>))}</tbody>
                </table>
                <div className="fd-pager"><Pager info={list.pagination} onPage={(p) => setF((o) => ({ ...o, page: p }))} />
                  <select value={f.pageSize} onChange={(e) => setFilter({ pageSize: Number(e.target.value) })} aria-label={t('aifd.rows')} data-testid="fd-size">{[10, 20, 50].map((n) => <option key={n} value={n}>{t('aifd.rows_n', { n })}</option>)}</select>
                  <span className="fd-muted" data-testid="fd-total">{t('aifd.total_n', { n: list.pagination.totalItems })}</span></div>
              </div>) : null}
        </section>

        <div className="fd-col">
          <section className="panel fd-card" data-testid="fd-monitor">
            <h2>{t('aifd.monitor')}</h2>
            {!monitor ? <div className="fd-muted">{t('aifd.loading')}</div> : monitor.error ? <ErrorRetry message={t('aifd.load_failed')} onRetry={loadSide} /> : (
              <dl className="fd-dl">
                <dt>{t('aifd.mon.route')}</dt><dd><Badge s={monitor.providerRoute.state} label={monitor.providerRoute.liveAgent ? monitor.providerRoute.liveAgent.name : t('aifd.mon.no_live')} />{monitor.providerRoute.drift ? <span className="fd-warn-t"> {t('aifd.mon.drift')}</span> : null}<div className="fd-muted">{t('aifd.mon.last_call', { at: when(monitor.providerRoute.routedAt), ref: monitor.providerRoute.routedAgentRef ?? '—' })}</div></dd>
                <dt>{t('aifd.mon.health')}</dt><dd><Badge s={monitor.agentHealth.state} /> <span className="fd-muted">{t('aifd.mon.calls', { n: monitor.agentHealth.calls24h, f: monitor.agentHealth.failed24h })}</span></dd>
                <dt>{t('aifd.mon.success')}</dt><dd>{t('aifd.mon.success_v', { a: monitor.callSuccess.answered24h, x: monitor.callSuccess.abandoned24h, h: monitor.callSuccess.handoffs24h })}</dd>
                <dt>{t('aifd.mon.booking')}</dt><dd>{t('aifd.mon.booking_v', { ok: monitor.bookingActions.succeeded24h, bad: monitor.bookingActions.refusedOrFailed24h })} · {monitor.bookingActions.armed ? t('aifd.armed') : t('aifd.handoff_only')}<div className="fd-muted">{t('aifd.pending_rule')}</div></dd>
                <dt>{t('aifd.mon.fallback')}</dt><dd><Badge s={monitor.fallback.state} /> <span className="fd-muted">{t('aifd.mon.fallback_note')}</span></dd>
                <dt>{t('aifd.mon.subscription')}</dt><dd><Badge s={monitor.subscription.state} /> <span className="fd-muted">{t('aifd.mon.quota_na')}</span></dd>
              </dl>)}
          </section>
          <section className="panel fd-card" data-testid="fd-alerts">
            <h2>{t('aifd.alerts')}</h2>
            {health ? (
              <div data-testid="fd-health">
                <div className="fd-health-top"><Badge s={health.overall} /> <span className="fd-muted">{t('aifd.checked_at', { at: when(health.checkedAt) })}</span></div>
                <div className="fd-muted">{t('aifd.read_only')}</div>
                {health.checks.filter((x: any) => x.state !== 'READY').slice(0, 12).map((x: any) => (
                  <div key={x.id} className="fd-hrow"><div className="fd-hrow-head"><b>{x.label}</b><Badge s={x.state} /></div><div className="fd-detail">{x.detail}</div>{x.remedy ? <div className="fd-remedy">{x.remedy}</div> : null}{x.roleRequired ? <div className="fd-muted">{t('aifd.role', { r: x.roleRequired })}</div> : null}</div>))}
                {health.checks.every((x: any) => x.state === 'READY') ? <div className="fd-muted">{t('aifd.all_ready')}</div> : null}
              </div>) : <div className="fd-muted">{t('aifd.alerts_hint')}</div>}
          </section>
        </div>
      </div>

      <section className="panel fd-card" data-testid="fd-history">
        <div className="fd-card-head"><h2>{t('aifd.history')}</h2>
          <select value={evF.action ?? ''} onChange={(e) => setEvF({ action: e.target.value || undefined, page: 1 })} aria-label={t('aifd.history_filter')}>{ACTIONS.map((a) => <option key={a} value={a}>{t('aifd.ev.' + (a || 'any'))}</option>)}</select></div>
        {!events ? <div className="fd-muted">{t('aifd.loading')}</div> : events.error ? <ErrorRetry message={events.error} onRetry={loadEvents} /> : events.items.length === 0 ? <div className="fd-muted">{t('aifd.history_empty')}</div> : (
          <>
            <table className="tbl fd-tbl"><thead><tr><th>{t('aifd.col.when')}</th><th>{t('aifd.col.agent')}</th><th>{t('aifd.col.event')}</th><th>{t('aifd.col.by')}</th><th>{t('aifd.col.reason')}</th></tr></thead>
              <tbody>{events.items.map((e: any) => <tr key={e.id}><td className="fd-muted">{when(e.at)}</td><td>{e.agentName ?? '—'}</td><td>{t('aifd.ev.' + e.action)}</td><td>{e.actor ?? '—'}</td><td>{e.reason ?? '—'}</td></tr>)}</tbody></table>
            <Pager info={events.pagination} onPage={(p) => setEvF((o) => ({ ...o, page: p }))} />
          </>)}
      </section>

      {cal ? <FitDialog title={t('aifd.from_to')} onClose={() => setCal(false)} testId="fd-cal">
        <RangeCalendar today={today()} initial={{ from: f.from, to: f.to }} onApply={(r) => { setFilter({ period: 'custom', from: r.from, to: r.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { setFilter({ period: undefined, from: undefined, to: undefined }); setCal(false); }} />
      </FitDialog> : null}
      {creating ? <CreateDialog onClose={() => setCreating(false)} onCreated={(a) => { setCreating(false); setNewId(a.id); setNotice(t('aifd.created')); setF((o) => ({ ...o, page: 1 })); refreshAll(); setWizardId(a.id); }} /> : null}
      {wizardId ? <Wizard id={wizardId} isOwner={isOwner} onClose={() => { setWizardId(null); refreshAll(); }} onActivate={(a) => setAct({ kind: 'activate', agent: a })} /> : null}
      {overlay ? <AgentOverlay id={overlay} manage={manage} isOwner={isOwner} onClose={() => setOverlay(null)} onEdit={(id) => { setOverlay(null); setWizardId(id); }}
        onAct={(a) => setAct(a)} onDuplicated={(a) => { setOverlay(null); setNewId(a.id); setNotice(t('aifd.duplicated')); refreshAll(); }} onOpenBooking={() => nav('/booking')} onOpenCalls={() => nav('/tenant/ai/receptionist/calls')} /> : null}
      {act ? <ActionDialog act={act} isOwner={isOwner} onClose={() => setAct(null)} onDone={(msg) => { setAct(null); setOverlay(null); setNotice(msg); refreshAll(); }} /> : null}
    </div>
  );
}

function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (a: any) => void }) {
  const [name, setName] = useState(''); const [desc, setDesc] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [key] = useState(() => requestId());
  async function save() {
    if (!name.trim()) { setErr(t('aifd.name_required')); return; }
    setBusy(true); setErr(null);
    try { const r = await posAiFrontDeskApi.create({ name: name.trim(), description: desc.trim() || null, idempotencyKey: key }); onCreated(r.agent); }
    catch (e) { setErr(errorTextOf(e, t('aifd.save_failed'))); } finally { setBusy(false); }
  }
  return (
    <FitDialog title={t('aifd.create_agent')} subtitle={t('aifd.step_of', { n: 1, total: 8 })} onClose={onClose} busy={busy} testId="fd-create-dialog"
      footer={<><button className="btn ghost" onClick={onClose} disabled={busy}>{t('aifd.cancel')}</button><button className="btn" onClick={save} disabled={busy} data-testid="fd-create-save">{busy ? t('aifd.saving') : t('aifd.save_draft')}</button></>}>
      <div className="fd-form">
        <label>{t('aifd.f.name')}<input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} data-testid="fd-create-name" /></label>
        <label>{t('aifd.f.description')}<input value={desc} maxLength={500} onChange={(e) => setDesc(e.target.value)} /></label>
        <div className="fd-muted">{t('aifd.draft_note')}</div>
        {err ? <div className="err">{err}</div> : null}
      </div>
    </FitDialog>
  );
}

function Wizard({ id, isOwner, onClose, onActivate }: { id: string; isOwner: boolean; onClose: () => void; onActivate: (a: any) => void }) {
  const [w, setW] = useState<any>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(1); const [form, setForm] = useState<Record<string, any>>({}); const [msg, setMsg] = useState<string | null>(null); const [job, setJob] = useState<any>(null);
  const { confirm: askConfirm, confirmUi } = useInlineConfirm();
  const load = useCallback(async () => {
    try { const r = await posAiFrontDeskApi.wizard(id); setW(r); setForm({ ...r.config }); setStep((s) => (s === 1 && r.agent.wizardStep ? Math.min(8, r.agent.wizardStep) : s)); setErr(null); }
    catch (e) { setErr(errorTextOf(e, t('aifd.load_failed'))); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!job || job.status === 'succeeded' || job.status === 'failed') return; const h = setInterval(async () => { try { setJob(await posAiApi.receptionistProvisioningJob(job.id)); } catch { setJob((j: any) => ({ ...j, status: 'failed' })); } }, 2000); return () => clearInterval(h); }, [job]);
  async function save(markDone = true) {
    if (!w) return;
    const b: FdSave = { expectedVersion: w.agent.configVersion, step, markDone };
    if (step === 1) Object.assign(b, { name: form.name, description: form.description ?? null });
    if (step === 3) Object.assign(b, { greeting: form.greeting ?? '', behavior: form.behavior ?? '', afterHoursMessage: form.afterHoursMessage ?? null, handoffDestination: form.handoffDestination || null });
    if (step === 4) Object.assign(b, { bookingMode: form.bookingMode });
    setBusy(true); setMsg(null);
    try { await posAiFrontDeskApi.save(id, b); await load(); setMsg(t('aifd.saved')); if (markDone && step < 8) setStep(step + 1); }
    catch (e) { setMsg(errorTextOf(e, t('aifd.save_failed'))); } finally { setBusy(false); }
  }
  const s = w?.steps?.[step - 1];
  const input = step <= 4;
  const ev = (list: any[] | undefined) => (list ?? []).map((x: any, i: number) => <div key={i} className="fd-hrow"><Badge s={x.state} /> <span className="fd-detail">{x.detail}</span>{x.remedy ? <div className="fd-remedy">{x.remedy}</div> : null}</div>);
  return (
    <FitDialog wide title={w ? `${t('aifd.wizard')} — ${w.agent.name}` : t('aifd.wizard')} subtitle={t('aifd.step_of', { n: step, total: 8 })} onClose={onClose} busy={busy} testId="fd-wizard"
      footer={<>
        <button className="btn ghost" onClick={() => setStep(Math.max(1, step - 1))} disabled={busy || step === 1} data-testid="fd-wz-back">{t('aifd.back')}</button>
        {input ? <button className="btn ghost" onClick={() => save(false)} disabled={busy} data-testid="fd-wz-save">{t('aifd.save_draft')}</button> : null}
        {input ? <button className="btn" onClick={() => save(true)} disabled={busy} data-testid="fd-wz-next">{t('aifd.save_next')}</button>
          : step < 8 ? <button className="btn" onClick={() => setStep(step + 1)} data-testid="fd-wz-next">{t('aifd.next')}</button> : null}
        <button className="btn ghost" onClick={onClose} disabled={busy}>{t('aifd.close')}</button>
      </>}>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !w ? <div className="fd-muted">{t('aifd.loading')}</div> : (
        <div className="fd-wz">
          <ol className="fd-steps">{w.steps.map((x: any) => <li key={x.step} className={(x.step === step ? 'on ' : '') + (x.done ? 'done' : '')}><button onClick={() => setStep(x.step)} data-testid={'fd-wz-step-' + x.step}>{x.step}. {t('aifd.wz.' + x.key)}</button></li>)}</ol>
          <div className="fd-wz-body" data-testid={'fd-wz-body-' + step}>
            <h3>{t('aifd.wz.' + s?.key)} {s?.done ? <Badge s="ok" label={t('aifd.done')} /> : null}</h3>
            {step === 1 ? <div className="fd-form">
              <label>{t('aifd.f.name')}<input value={form.name ?? ''} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="fd-wz-name" /></label>
              <label>{t('aifd.f.description')}<input value={form.description ?? ''} maxLength={500} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
              <div className="fd-muted">{t('aifd.wz.identity_note')}</div></div> : null}
            {step === 2 ? <div>{(s.business ?? []).map((b: any) => <div key={b.key} className="fd-hrow"><b>{bizLabel(b.key)}</b> <Badge s={b.status === 'READY' ? 'READY' : 'WARNING'} label={b.status} /><div className="fd-detail">{b.detail}</div></div>)}
              <div className="fd-muted">{t('aifd.wz.knowledge_note')}</div></div> : null}
            {step === 3 ? <div className="fd-form">
              <label>{t('aifd.f.greeting')}<textarea rows={2} maxLength={600} value={form.greeting ?? ''} onChange={(e) => setForm({ ...form, greeting: e.target.value })} /></label>
              <label>{t('aifd.f.behavior')}<textarea rows={4} maxLength={4000} value={form.behavior ?? ''} onChange={(e) => setForm({ ...form, behavior: e.target.value })} /></label>
              <label>{t('aifd.f.after_hours')}<input maxLength={500} value={form.afterHoursMessage ?? ''} onChange={(e) => setForm({ ...form, afterHoursMessage: e.target.value })} /></label>
              <label>{t('aifd.f.handoff')}<input maxLength={40} value={form.handoffDestination ?? ''} placeholder="+16095550100 · voicemail · front_desk" onChange={(e) => setForm({ ...form, handoffDestination: e.target.value })} data-testid="fd-wz-handoff" /></label>
              <div className="fd-muted">{t('aifd.wz.english_only')}</div></div> : null}
            {step === 4 ? <div className="fd-form">
              {(['handoff_only', 'eligible'] as const).map((m) => <label key={m} className="fd-radio"><input type="radio" name="bm" checked={form.bookingMode === m} onChange={() => setForm({ ...form, bookingMode: m })} data-testid={'fd-wz-mode-' + m} /> {t('aifd.mode.' + m)} — <span className="fd-muted">{t('aifd.mode_hint.' + m)}</span></label>)}
              <div className="fd-muted">{t('aifd.pending_rule')} · {s.salonArmed ? t('aifd.armed') : t('aifd.handoff_only')}</div></div> : null}
            {step === 5 ? <div>{ev(s.evidence)}<div className="fd-muted">{s.providerRef ? t('aifd.provider_linked', { ref: s.providerRef }) : t('aifd.not_linked')}</div>
              {!s.providerRef ? <button className="btn ghost" disabled={busy || (job && job.status !== 'failed' && job.status !== 'succeeded')} onClick={() => askConfirm(t('aifd.provision_confirm'), () => { void (async () => { try { setJob(await posAiApi.provisionReceptionistAgent(id)); } catch (e) { setMsg(errorTextOf(e, t('aifd.save_failed'))); } })(); }, { confirmLabel: t('aifd.provision') })} data-testid="fd-wz-provision">{t('aifd.provision')}</button> : null}
              {job ? <div className="fd-muted" data-testid="fd-wz-job">{t('aifd.job', { s: job.status, p: job.progress ?? 0 })}{job.safeErrorMessage ? ' — ' + job.safeErrorMessage : ''}</div> : null}</div> : null}
            {step === 6 ? <div>{ev(s.evidence)}<div className="fd-muted">{t('aifd.wz.twilio_note')}</div></div> : null}
            {step === 7 ? <div>{ev(s.evidence)}<div className="fd-muted">{t('aifd.wz.test_note')}</div></div> : null}
            {step === 8 ? <Preflight pre={s.preflight} /> : null}
            {step === 8 && s.preflight?.ready ? (isOwner ? <button className="btn" onClick={() => onActivate(w.agent)} data-testid="fd-wz-activate">{t('aifd.activate')}</button> : <div className="fd-notice">{t('aifd.owner_only')}</div>) : null}
            {msg ? <div className="fd-notice" role="status" data-testid="fd-wz-msg">{msg}</div> : null}
            {confirmUi}
          </div>
        </div>)}
    </FitDialog>
  );
}

function Preflight({ pre }: { pre: any }) {
  if (!pre) return null;
  return (
    <div className="fd-pre" data-testid="fd-preflight">
      <div className="fd-route-cmp">
        <div><div className="fd-muted">{t('aifd.current_route')}</div><b>{pre.current ? pre.current.name : t('aifd.no_live_route')}</b></div>
        <div className="fd-arrow">→</div>
        <div><div className="fd-muted">{t('aifd.proposed_route')}</div><b>{pre.proposed.name}</b> <span className="fd-muted">{pre.proposed.providerRef ?? ''}</span></div>
      </div>
      <div className="fd-muted">{t('aifd.scope', { b: pre.scope.branchName ?? t('aifd.all_branches') })} · {t('aifd.mode.' + pre.bookingMode)}</div>
      <div className="fd-detail">{pre.customerBehavior}</div>
      <div className="fd-detail">{pre.billing}</div>
      <div className="fd-detail">{t('aifd.rollback_to', { n: pre.rollback.name })}</div>
      <div className="fd-muted">{pre.external}</div>
      {pre.ready ? <div className="fd-ok-t" data-testid="fd-pre-ready">{t('aifd.pre_ready')}</div> : (
        <div data-testid="fd-blockers"><b>{t('aifd.blockers', { n: pre.blockers.length })}</b>{pre.blockers.map((b: any) => <div key={b.id} className="fd-hrow"><b>{b.label}</b><div className="fd-detail">{b.detail}</div>{b.remedy ? <div className="fd-remedy">{b.remedy}</div> : null}</div>)}</div>)}
    </div>
  );
}

function AgentOverlay({ id, manage, isOwner, onClose, onEdit, onAct, onDuplicated, onOpenBooking, onOpenCalls }: { id: string; manage: boolean; isOwner: boolean; onClose: () => void; onEdit: (id: string) => void; onAct: (a: Act) => void; onDuplicated: (a: any) => void; onOpenBooking: () => void; onOpenCalls: () => void }) {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState<string | null>(null); const [tab, setTab] = useState<typeof OV_TABS[number]>('overview');
  const [calls, setCalls] = useState<any>(null); const [cPage, setCPage] = useState(1); const [ev, setEv] = useState<any>(null); const [hc, setHc] = useState<any>(null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => { try { setD(await posAiFrontDeskApi.detail(id)); setErr(null); } catch (e) { setErr(errorTextOf(e, t('aifd.load_failed'))); } }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === 'calls') posAiFrontDeskApi.calls(id, { page: cPage, pageSize: 10 }).then(setCalls).catch((e) => setCalls({ error: errorTextOf(e, t('aifd.load_failed')) })); }, [tab, id, cPage]);
  useEffect(() => { if (tab === 'health') posAiFrontDeskApi.events({ agentId: id, pageSize: 10 }).then(setEv).catch((e) => setEv({ error: errorTextOf(e, t('aifd.load_failed')) })); }, [tab, id]);
  const o = d?.overview;
  const footer = o ? (
    <div className="fd-ov-actions">
      {manage && ['draft', 'ready', 'paused', 'error'].includes(o.status) ? <button className="btn ghost" onClick={() => onEdit(id)} data-testid="fd-ov-edit">{t('aifd.edit')}</button> : null}
      <button className="btn ghost" disabled={busy} onClick={async () => { setBusy(true); try { setHc(await posAiFrontDeskApi.agentHealth(id)); setTab('health'); } catch (e) { setMsg(errorTextOf(e, t('aifd.load_failed'))); } finally { setBusy(false); } }} data-testid="fd-ov-health">{t('aifd.check_health')}</button>
      <button className="btn ghost" onClick={() => setTab('calls')}>{t('aifd.view_calls')}</button>
      {manage ? <button className="btn ghost" disabled={busy} onClick={async () => { setBusy(true); try { const r = await posAiFrontDeskApi.duplicate(id, requestId()); onDuplicated(r.agent); } catch (e) { setMsg(errorTextOf(e, t('aifd.save_failed'))); } finally { setBusy(false); } }} data-testid="fd-ov-duplicate">{t('aifd.duplicate')}</button> : null}
      {manage && o.status !== 'paused' && o.status !== 'archived' ? <button className="btn ghost" onClick={() => onAct({ kind: 'pause', agent: o })} data-testid="fd-ov-pause">{t('aifd.pause')}</button> : null}
      {manage && o.status === 'paused' ? <button className="btn ghost" onClick={() => onAct({ kind: 'resume', agent: o })} data-testid="fd-ov-resume">{t('aifd.resume')}</button> : null}
      {manage && o.status !== 'archived' && o.status !== 'live' ? <button className="btn ghost" onClick={() => onAct({ kind: 'archive', agent: o })} data-testid="fd-ov-archive">{t('aifd.archive')}</button> : null}
      {manage && o.status === 'archived' ? <button className="btn ghost" onClick={() => onAct({ kind: 'restore', agent: o })} data-testid="fd-ov-restore">{t('aifd.restore')}</button> : null}
      {isOwner && o.status === 'live' && d.routing.rollbackTo ? <button className="btn ghost" onClick={() => onAct({ kind: 'rollback', agent: o })} data-testid="fd-ov-rollback">{t('aifd.rollback')}</button> : null}
      {isOwner && ['ready', 'paused'].includes(o.status) ? <button className="btn" onClick={() => onAct({ kind: 'activate', agent: o })} data-testid="fd-ov-activate">{t('aifd.activate')}</button> : null}
      <button className="btn ghost" onClick={onClose} data-testid="fd-ov-close">{t('aifd.close')}</button>
    </div>) : <button className="btn ghost" onClick={onClose}>{t('aifd.close')}</button>;
  return (
    <FitDialog wide title={o ? o.name : t('aifd.agent')} subtitle={o ? <Badge s={o.effective} /> : undefined} onClose={onClose} busy={busy} testId="fd-overlay" footer={footer}>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !d ? <div className="fd-muted">{t('aifd.loading')}</div> : (
        <div className="fd-ov">
          <div className="fd-tabs" role="tablist">{OV_TABS.map((x) => <button key={x} role="tab" aria-selected={tab === x} className={'fd-tab' + (tab === x ? ' on' : '')} onClick={() => setTab(x)} data-testid={'fd-ov-tab-' + x}>{t('aifd.ov.' + x)}</button>)}</div>
          {msg ? <div className="fd-notice">{msg}</div> : null}
          <div className="fd-ov-body" data-testid={'fd-ov-body-' + tab}>
            {tab === 'overview' ? <dl className="fd-dl">
              <dt>{t('aifd.ov.id')}</dt><dd>{o.id}</dd><dt>{t('aifd.col.state')}</dt><dd><Badge s={o.effective} /> <span className="fd-muted">{t('aifd.canonical', { s: o.status })}</span></dd>
              <dt>{t('aifd.col.branch')}</dt><dd>{o.branchName ?? t('aifd.all_branches')}</dd><dt>{t('aifd.ov.creator')}</dt><dd>{d.overview.creatorName ?? '—'}</dd>
              <dt>{t('aifd.ov.created')}</dt><dd>{when(o.createdAt)}</dd><dt>{t('aifd.col.updated')}</dt><dd>{when(o.updatedAt)}</dd>
              <dt>{t('aifd.ov.verified')}</dt><dd>{when(o.lastVerifiedAt)}</dd><dt>{t('aifd.ov.version')}</dt><dd>{o.configVersion}</dd></dl> : null}
            {tab === 'business' ? <div>{(d.business.core ?? []).map((b: any) => <div key={b.key} className="fd-hrow"><b>{bizLabel(b.key)}</b> <span className="fd-muted">{b.status}</span><div className="fd-detail">{b.detail}</div></div>)}<div className="fd-muted">{t('aifd.versions', { n: d.business.versions })}</div></div> : null}
            {tab === 'voice' ? <dl className="fd-dl"><dt>{t('aifd.f.greeting')}</dt><dd>{d.voice.greeting ?? '—'}</dd><dt>{t('aifd.f.behavior')}</dt><dd className="fd-pre-wrap">{d.voice.behavior ?? '—'}</dd>
              <dt>{t('aifd.f.after_hours')}</dt><dd>{d.voice.afterHoursMessage ?? '—'}</dd><dt>{t('aifd.col.provider')}</dt><dd>{d.voice.providerRef ?? t('aifd.not_linked')}{d.voice.sharedWithOtherSalon ? <span className="fd-warn-t"> {t('aifd.shared')}</span> : null}</dd>
              <dt>{t('aifd.ov.language')}</dt><dd>{t('aifd.english_only')}</dd></dl> : null}
            {tab === 'routing' ? <dl className="fd-dl"><dt>{t('aifd.current_route')}</dt><dd>{d.routing.current ? d.routing.current.name : t('aifd.no_live_route')}</dd>
              <dt>{t('aifd.ov.twilio')}</dt><dd><Badge s={d.routing.twilioAccount} /> <Badge s={d.routing.twilioRoute} /></dd>
              <dt>{t('aifd.ov.last_call')}</dt><dd>{when(d.routing.routedAt)} <span className="fd-muted">{d.routing.routedAgentRef ?? ''}</span></dd>
              <dt>{t('aifd.ov.verified')}</dt><dd>{when(d.routing.lastVerifiedAt)}</dd><dt>{t('aifd.rollback')}</dt><dd>{d.routing.rollbackTo ? t('aifd.has_rollback') : t('aifd.no_rollback')}</dd>
              <dt /><dd className="fd-muted">{d.routing.externalNote}</dd></dl> : null}
            {tab === 'booking' ? <dl className="fd-dl"><dt>{t('aifd.col.booking')}</dt><dd>{t('aifd.mode.' + d.booking.mode)} · {d.booking.salonArmed ? t('aifd.armed') : t('aifd.handoff_only')}</dd>
              <dt>{t('aifd.ov.last_booking')}</dt><dd>{when(d.booking.lastBookingSuccessAt)}</dd><dt>{t('aifd.f.handoff')}</dt><dd>{d.booking.handoffDestination ?? t('aifd.not_set')}</dd>
              <dt /><dd className="fd-muted">{t('aifd.pending_rule')}</dd><dt /><dd><button className="btn ghost sm" onClick={onOpenBooking}>{t('aifd.open_booking')}</button></dd></dl> : null}
            {tab === 'calls' ? (!calls ? <div className="fd-muted">{t('aifd.loading')}</div> : calls.error ? <div className="err">{calls.error}</div> : calls.items.length === 0 ? <div className="fd-muted">{calls.note ?? t('aifd.no_calls')}</div> : <>
              <table className="tbl fd-tbl"><thead><tr><th>{t('aifd.col.when')}</th><th>{t('aifd.col.call')}</th><th>{t('aifd.col.duration')}</th><th>{t('aifd.col.booking')}</th><th>{t('aifd.col.handoff')}</th><th>{t('aifd.col.error')}</th></tr></thead>
                <tbody>{calls.items.map((x: any) => <tr key={x.providerCallId}><td className="fd-muted">{when(x.at)}</td><td>{x.callRef}</td><td>{x.durationSeconds == null ? '—' : x.durationSeconds + 's'}</td><td>{x.booking ?? '—'}</td><td>{x.handoff ?? '—'}</td><td>{x.error ?? '—'}</td></tr>)}</tbody></table>
              <Pager info={calls.pagination} onPage={setCPage} /><button className="btn ghost sm" onClick={onOpenCalls}>{t('aifd.open_ai_calls')}</button><div className="fd-muted">{t('aifd.transcripts_note')}</div></>) : null}
            {tab === 'usage' ? <dl className="fd-dl"><dt>{t('aifd.ov.entitlement')}</dt><dd><Badge s={d.usage.entitlement} /> <span className="fd-muted">{d.usage.entitlementDetail}</span></dd>
              <dt>{t('aifd.ov.calls_month')}</dt><dd>{d.usage.callsThisMonth}</dd><dt>{t('aifd.ov.minutes_month')}</dt><dd>{d.usage.voiceMinutesThisMonth}</dd>
              <dt>{t('aifd.ov.charges')}</dt><dd><Badge s="UNKNOWN" /> <span className="fd-muted">{d.usage.chargesNote}</span></dd><dt>{t('aifd.ov.quota')}</dt><dd className="fd-muted">{t('aifd.mon.quota_na')}</dd></dl> : null}
            {tab === 'health' ? <div>
              {hc ? <div data-testid="fd-ov-health-result"><Badge s={hc.overall} /> <span className="fd-muted">{t('aifd.checked_at', { at: when(hc.checkedAt) })} · {t('aifd.read_only')}</span>
                {hc.checks.filter((x: any) => x.group === 'Agent').map((x: any) => <div key={x.id} className="fd-hrow"><div className="fd-hrow-head"><b>{x.label}</b><Badge s={x.state} /></div><div className="fd-detail">{x.detail}</div>{x.remedy ? <div className="fd-remedy">{x.remedy}</div> : null}</div>)}</div>
                : d.health.last ? <div className="fd-muted">{t('aifd.last_check', { s: d.health.last.overall, at: when(d.health.last.checkedAt) })}</div> : <div className="fd-muted">{t('aifd.never_checked')}</div>}
              <h3>{t('aifd.recent_errors')}</h3>{d.health.recentErrors.length ? d.health.recentErrors.map((x: any) => <div key={x.callRef} className="fd-detail">{when(x.at)} · {x.callRef} · {x.error}</div>) : <div className="fd-muted">{t('aifd.no_errors')}</div>}
              <h3>{t('aifd.audit')}</h3>{!ev ? null : ev.error ? <div className="err">{ev.error}</div> : ev.items.map((e: any) => <div key={e.id} className="fd-detail">{when(e.at)} · {t('aifd.ev.' + e.action)} · {e.actor ?? '—'}{e.reason ? ' — ' + e.reason : ''}</div>)}
            </div> : null}
          </div>
        </div>)}
    </FitDialog>
  );
}

function ActionDialog({ act, isOwner, onClose, onDone }: { act: Act; isOwner: boolean; onClose: () => void; onDone: (msg: string) => void }) {
  const [reason, setReason] = useState(''); const [ok, setOk] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [pre, setPre] = useState<any>(null); const [key] = useState(() => requestId());
  const needsOwner = act.kind === 'activate' || act.kind === 'rollback' || (act.kind === 'resume' && !!act.agent.activatedAt);
  useEffect(() => { if (act.kind === 'activate' || act.kind === 'resume' || act.kind === 'rollback') posAiFrontDeskApi.preview(act.agent.id).then(setPre).catch((e) => setErr(errorTextOf(e, t('aifd.load_failed')))); }, [act]);
  const needsConfirm = act.kind !== 'pause' && act.kind !== 'restore';
  const blocked = (act.kind === 'activate' || (act.kind === 'resume' && act.agent.activatedAt)) && pre && !pre.ready;
  async function go() {
    setBusy(true); setErr(null);
    const b = { expectedVersion: act.agent.configVersion, reason, idempotencyKey: key, confirm: ok };
    try { await posAiFrontDeskApi[act.kind](act.agent.id, b); onDone(t('aifd.done_' + act.kind)); }
    catch (e) { setErr(errorTextOf(e, t('aifd.save_failed'))); }
    finally { setBusy(false); }
  }
  const title = useMemo(() => t('aifd.confirm_' + act.kind, { n: act.agent.name }), [act]);
  return (
    <FitDialog title={title} onClose={onClose} busy={busy} testId="fd-action"
      footer={<><button className="btn ghost" onClick={onClose} disabled={busy}>{t('aifd.cancel')}</button>
        <button className="btn" onClick={go} disabled={busy || reason.trim().length < 5 || (needsConfirm && !ok) || !!blocked || (needsOwner && !isOwner)} data-testid="fd-action-go">{t('aifd.' + act.kind)}</button></>}>
      <div className="fd-form">
        <div className="fd-detail">{t('aifd.explain_' + act.kind)}</div>
        {pre ? <Preflight pre={pre} /> : null}
        {needsOwner && !isOwner ? <div className="fd-notice">{t('aifd.owner_only')}</div> : null}
        <label>{t('aifd.reason')}<input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} data-testid="fd-action-reason" /></label>
        {needsConfirm ? <label className="fd-radio"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} data-testid="fd-action-confirm" /> {t('aifd.i_confirm_' + act.kind)}</label> : null}
        {err ? <div className="err" data-testid="fd-action-err">{err}</div> : null}
      </div>
    </FitDialog>
  );
}
