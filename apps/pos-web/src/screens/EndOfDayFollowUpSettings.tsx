// Communications → End-of-Day Follow-Ups (/settings/follow-ups) — the management center (EOD Follow-Ups Complete Build
// Guide, Oct 30 2026), rebuilt in place. Keeps the seven original settings and Save, and adds: KPIs from the queue,
// evidence-based health, Preview Tonight (read-only), the follow-up activity history (server search · status ·
// approval · technician · date basis + From–To month calendar · newest first · 10/20/50 pages), the generation run
// log, and a details overlay (approve / return with a note / send with an audited manager exception / open customer /
// book). Server truth only: every number comes from pos/eod-follow-ups/*; nothing is computed from loaded rows.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posFollowUpApi, type FollowUpSettings } from '../api/posFollowUpApi';
import { posEodFollowUpsApi as api, type EodSummary, type EodHealthRow, type HealthState, type EodPreview, type EodTaskRow, type EodPage, type EodRun, type EodTaskDetail, type EodTaskQuery } from '../api/posEodFollowUpsApi';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry, useDebounced } from '../components/FitKit';
import { RangeCalendar, isForbidden } from '../components/FinanceKit';
import { errorTextOf } from '../i18n/error-text';
import { deviceToday } from '../lib/deviceToday';

const TIME_OPTS = ['18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30', '22:00'];
const EXPIRE_OPTS = [0, 12, 24, 48, 72];
const COOLDOWN_OPTS = [0, 12, 24, 48, 72, 168];
const labelTime = (t: string) => { const [h, m] = t.split(':'); let hh = Number(h); const ap = hh < 12 ? 'AM' : 'PM'; hh = hh % 12 || 12; return `${hh}:${m} ${ap}`; };
const when = (iso: string | null | undefined, tz?: string) => (iso ? new Date(iso).toLocaleString(undefined, { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const TONE: Record<HealthState, 'ok' | 'warn' | 'bad' | undefined> = { ready: 'ok', pending: 'warn', attention_required: 'warn', failed: 'bad', unknown: 'warn', not_used: undefined, off: undefined };
const stText = (s: string) => tx(`eod.st.${s}`);
const errText = (e: unknown) => errorTextOf(e, tx('eod.loadError'));

function Toggle({ label, hint, on, onChange, testId }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return (
    <div className="eod-set-row">
      <div><div className="t">{label}</div>{hint ? <div className="s">{hint}</div> : null}</div>
      <button type="button" className={'btn' + (on ? '' : ' ghost')} onClick={() => onChange(!on)} aria-pressed={on} data-testid={testId}>{on ? tx('eod.on') : tx('eod.off')}</button>
    </div>
  );
}

export function EndOfDayFollowUpSettings() {
  const nav = useNavigate();
  const [summary, setSummary] = useState<EodSummary | null>(null);
  const [health, setHealth] = useState<{ overall: HealthState; rows: EodHealthRow[] } | null>(null);
  const [s, setS] = useState<FollowUpSettings | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<EodPreview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [filters, setFilters] = useState<EodTaskQuery>({ status: '', approval: '', technicianId: '', basis: 'generated', sort: 'newest', page: 1, pageSize: 20 });
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 300);
  const [tasks, setTasks] = useState<EodPage<EodTaskRow> | null>(null);
  const [tasksErr, setTasksErr] = useState<unknown>(null);
  const [runs, setRuns] = useState<EodPage<EodRun> | null>(null);
  const [runPage, setRunPage] = useState(1);
  const [calOpen, setCalOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [techs, setTechs] = useState<{ id: string; name: string }[]>([]);

  const loadTop = useCallback(async () => {
    try {
      const [sum, h] = await Promise.all([api.summary(), api.health()]);
      setSummary(sum); setHealth(h); setS(sum.settings); setErr(null);
    } catch (e) { setErr(e); }
  }, []);
  const loadTasks = useCallback(async () => {
    try { const r = await api.tasks({ ...filters, q: q || undefined }); setTasks(r); setTasksErr(null); setTechs((cur) => { const m = new Map(cur.map((x) => [x.id, x.name])); for (const i of r.items) m.set(i.technicianId, i.technicianName); return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)); }); }
    catch (e) { setTasksErr(e); }
  }, [filters, q]);
  const loadRuns = useCallback(async () => { try { setRuns(await api.runs(runPage, 10)); } catch { setRuns(null); } }, [runPage]);
  useEffect(() => { void loadTop(); }, [loadTop]);
  useEffect(() => { void loadTasks(); }, [loadTasks]);
  useEffect(() => { void loadRuns(); }, [loadRuns]);
  useEffect(() => { setFilters((f) => (f.page === 1 ? f : { ...f, page: 1 })); }, [q]);
  const refreshAll = () => { void loadTop(); void loadTasks(); void loadRuns(); };
  const setF = (p: Partial<EodTaskQuery>) => setFilters((f) => ({ ...f, ...p, page: p.page ?? 1 }));

  const patch = (p: Partial<FollowUpSettings>) => setS((cur) => (cur ? { ...cur, ...p } : cur));
  const save = async () => {
    if (!s) return;
    setBusy(true); setNote(null);
    try {
      const saved = await posFollowUpApi.saveSettings({
        enabled: s.enabled, generationTime: s.generationTime, allowTechEditMessage: s.allowTechEditMessage, allowCustomerReplies: s.allowCustomerReplies,
        requireManagerApproval: s.requireManagerApproval, reminderToTech: s.reminderToTech, createMode: s.createMode, autoExpirePendingHours: s.autoExpirePendingHours,
        contactCooldownHours: s.contactCooldownHours,
      });
      setS(saved); setNote(tx('eod.saved')); void loadTop();
    } catch (e) { setNote(errText(e)); } finally { setBusy(false); }
  };
  const openPreview = async () => { setPreviewOpen(true); setPreview(null); try { setPreview(await api.preview()); } catch (e) { setNote(errText(e)); setPreviewOpen(false); } };

  if (err && isForbidden(err)) return <div className="work"><div className="err" data-testid="eod-forbidden">{tx('eod.noPermission')}</div></div>;
  const k = summary?.kpis;
  const tz = summary?.timezone;
  const pageInfo = tasks ? { page: tasks.page, pageSize: tasks.pageSize, totalItems: tasks.total, totalPages: tasks.totalPages } : null;
  const anyFilter = !!(q || filters.status || filters.approval || filters.technicianId || filters.from);

  return (
    <div className="work eod">
      <header className="eod-head">
        <div className="vh" style={{ marginBottom: 0 }}><h1 data-testid="eod-title">{tx('eod.title')}</h1>
          <div className="sub">{tx('eod.sub')}{summary ? ` · ${tx('eod.updated', { time: when(summary.generatedAt, tz) })}` : ''}</div></div>
        <div className="eod-head-actions">
          <button type="button" className="btn ghost" onClick={refreshAll} data-testid="eod-refresh">{tx('eod.refresh')}</button>
          <button type="button" className="btn ghost" onClick={() => nav('/follow-ups')}>{tx('eod.openQueue')}</button>
        </div>
      </header>
      {err ? <ErrorRetry message={errText(err)} onRetry={refreshAll} /> : null}
      {note ? <div className="muted" role="status" style={{ marginBottom: 8 }} data-testid="eod-note">{note}</div> : null}

      <div className="eod-kpis" data-testid="eod-kpis">
        <KpiCard label={tx('eod.kpi.automation')} loading={!health} value={!s?.enabled ? tx('eod.kpi.off') : tx(`eod.state.${health?.overall ?? 'unknown'}`)} tone={s?.enabled ? TONE[health?.overall ?? 'unknown'] : undefined} testId="eod-kpi-automation" />
        <KpiCard label={tx('eod.kpi.nextRun')} loading={!summary} value={summary?.nextRun ? labelTime(summary.nextRun.localTime) : tx('eod.kpi.noRun')} sub={summary?.nextRun ? `${summary.nextRun.businessDate}${summary.nextRun.dueNow ? ` · ${tx('eod.kpi.dueNow')}` : ''}` : undefined} testId="eod-kpi-next" />
        <KpiCard label={tx('eod.kpi.pending')} loading={!k} value={k ? k.pending + k.awaitingApproval + k.rejected : '—'} sub={k ? tx('eod.kpi.pendingSub', { n: String(k.awaitingApproval), r: String(k.rejected) }) : undefined} testId="eod-kpi-pending" onClick={() => setF({ status: 'unsent' })} />
        <KpiCard label={tx('eod.kpi.sentToday')} loading={!k} value={k?.sentToday ?? '—'} tone="ok" testId="eod-kpi-sent" />
        <KpiCard label={tx('eod.kpi.failed')} loading={!k} value={k ? k.failedToday + k.expiredToday : '—'} sub={k ? tx('eod.kpi.failedSub', { f: String(k.failedToday), e: String(k.expiredToday) }) : undefined} tone={k && k.failedToday + k.expiredToday > 0 ? 'warn' : undefined} testId="eod-kpi-failed" />
        <KpiCard label={tx('eod.kpi.booked')} loading={!k} value={k?.bookedAfter30d ?? '—'} sub={tx('eod.kpi.bookedSub')} testId="eod-kpi-booked" />
      </div>

      <div className="eod-grid">
        <section className="panel" data-testid="eod-settings">
          <h3 className="eod-h3">{tx('eod.settings')}</h3>
          {!s ? <div className="muted">…</div> : (
            <div className="eod-set">
              <Toggle label={tx('eod.set.enabled')} hint={tx('eod.set.enabledHint')} on={s.enabled} onChange={(v) => patch({ enabled: v })} testId="eod-set-enabled" />
              <div className="eod-set-row"><div><div className="t">{tx('eod.set.time')}</div><div className="s">{tx('eod.set.timeHint', { tz: s.timezone })}</div></div>
                <select className="fk-select" aria-label={tx('eod.set.time')} value={s.generationTime} onChange={(e) => patch({ generationTime: e.target.value })} data-testid="eod-set-time">
                  {(TIME_OPTS.includes(s.generationTime) ? TIME_OPTS : [s.generationTime, ...TIME_OPTS]).map((v) => <option key={v} value={v}>{labelTime(v)}</option>)}
                </select></div>
              <Toggle label={tx('eod.set.edit')} on={s.allowTechEditMessage} onChange={(v) => patch({ allowTechEditMessage: v })} />
              <div className="eod-set-row"><div><div className="t">{tx('eod.set.expire')}</div><div className="s">{tx('eod.set.expireHint')}</div></div>
                <select className="fk-select" aria-label={tx('eod.set.expire')} value={s.autoExpirePendingHours} onChange={(e) => patch({ autoExpirePendingHours: Number(e.target.value) })} data-testid="eod-set-expire">
                  {(EXPIRE_OPTS.includes(s.autoExpirePendingHours) ? EXPIRE_OPTS : [s.autoExpirePendingHours, ...EXPIRE_OPTS]).map((v) => <option key={v} value={v}>{v === 0 ? tx('eod.never') : tx('eod.hours', { n: String(v) })}</option>)}
                </select></div>
              <Toggle label={tx('eod.set.replies')} on={s.allowCustomerReplies} onChange={(v) => patch({ allowCustomerReplies: v })} />
              <Toggle label={tx('eod.set.approval')} on={s.requireManagerApproval} onChange={(v) => patch({ requireManagerApproval: v })} testId="eod-set-approval" />
              <Toggle label={tx('eod.set.notify')} hint={tx('eod.set.notifyHint')} on={s.reminderToTech} onChange={(v) => patch({ reminderToTech: v })} />
              <div className="eod-set-row"><div><div className="t">{tx('eod.set.cooldown')}</div><div className="s">{tx('eod.set.cooldownHint')}</div></div>
                <select className="fk-select" aria-label={tx('eod.set.cooldown')} value={s.contactCooldownHours} onChange={(e) => patch({ contactCooldownHours: Number(e.target.value) })} data-testid="eod-set-cooldown">
                  {(COOLDOWN_OPTS.includes(s.contactCooldownHours) ? COOLDOWN_OPTS : [s.contactCooldownHours, ...COOLDOWN_OPTS]).map((v) => <option key={v} value={v}>{v === 0 ? tx('eod.off') : tx('eod.hours', { n: String(v) })}</option>)}
                </select></div>
              <div className="eod-save"><button type="button" className="btn" disabled={busy} onClick={save} data-testid="eod-save">{busy ? tx('eod.saving') : tx('eod.save')}</button></div>
            </div>
          )}
        </section>
        <section className="panel" data-testid="eod-health">
          <div className="eod-panel-head"><h3 className="eod-h3">{tx('eod.health')}</h3>
            <button type="button" className="btn" onClick={openPreview} data-testid="eod-preview-btn" title={tx('eod.previewHint')}>{tx('eod.preview')}</button></div>
          <div className="s" style={{ marginBottom: 6 }}>{tx('eod.previewHint')}</div>
          {!health ? <div className="muted">…</div> : (
            <ul className="eod-health">{health.rows.map((r) => (
              <li key={r.key} data-testid={`eod-h-${r.key}`}>
                <div className="eod-h-top"><b>{tx(`eod.hk.${r.key}`)}</b><span className={`eod-chip ${TONE[r.state] ?? 'neutral'}`}>{tx(`eod.state.${r.state}`)}</span></div>
                <div className="s">{r.detail}</div>
                <div className="s eod-ev">{r.evidence}{r.nextStep ? ` — ${r.nextStep}` : ''}</div>
              </li>))}</ul>
          )}
        </section>
      </div>

      <section className="panel" data-testid="eod-activity">
        <h3 className="eod-h3">{tx('eod.activity')}</h3>
        <div className="eod-filters">
          <input className="fk-input eod-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx('eod.searchPh')} aria-label={tx('eod.searchPh')} data-testid="eod-search" />
          <select className="fk-select" aria-label={tx('eod.f.status')} value={filters.status} onChange={(e) => setF({ status: e.target.value })} data-testid="eod-f-status">
            <option value="">{tx('eod.f.allStatuses')}</option><option value="unsent">{tx('eod.f.unsent')}</option><option value="sent">{tx('eod.f.sentGroup')}</option><option value="closed">{tx('eod.f.closed')}</option>
            {['pending', 'pending_manager_approval', 'rejected', 'expired', 'skipped', 'customer_not_available'].map((v) => <option key={v} value={v}>{stText(v)}</option>)}
          </select>
          <select className="fk-select" aria-label={tx('eod.f.approval')} value={filters.approval} onChange={(e) => setF({ approval: e.target.value })} data-testid="eod-f-approval">
            <option value="">{tx('eod.f.anyApproval')}</option><option value="awaiting">{tx('eod.f.awaiting')}</option><option value="rejected">{tx('eod.f.rejected')}</option><option value="approved">{tx('eod.f.approved')}</option>
          </select>
          <select className="fk-select" aria-label={tx('eod.f.tech')} value={filters.technicianId} onChange={(e) => setF({ technicianId: e.target.value })} data-testid="eod-f-tech">
            <option value="">{tx('eod.f.allTechs')}</option>{techs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <select className="fk-select" aria-label={tx('eod.f.basis')} value={filters.basis} onChange={(e) => setF({ basis: e.target.value })} data-testid="eod-f-basis">
            {['generated', 'due', 'sent', 'expired'].map((v) => <option key={v} value={v}>{tx(`eod.basis.${v}`)}</option>)}
          </select>
          <button type="button" className="btn ghost" onClick={() => setCalOpen(true)} data-testid="eod-f-dates">{filters.from && filters.to ? `${filters.from} – ${filters.to}` : tx('eod.f.anyDate')}</button>
          <select className="fk-select" aria-label={tx('eod.f.sort')} value={filters.sort} onChange={(e) => setF({ sort: e.target.value })} data-testid="eod-f-sort">
            <option value="newest">{tx('eod.sort.newest')}</option><option value="due">{tx('eod.sort.due')}</option>
          </select>
          {anyFilter ? <button type="button" className="btn ghost" onClick={() => { setSearch(''); setFilters({ status: '', approval: '', technicianId: '', basis: 'generated', sort: 'newest', page: 1, pageSize: filters.pageSize }); }} data-testid="eod-f-clear">{tx('eod.f.clear')}</button> : null}
        </div>
        {filters.from ? <div className="s" style={{ margin: '4px 0' }} data-testid="eod-basis-note">{tx('eod.basisNote', { basis: tx(`eod.basis.${filters.basis}`) })} · {filters.from} – {filters.to}</div> : null}
        {calOpen ? (
          <div className="eod-cal" data-testid="eod-cal">
            <RangeCalendar initial={{ from: filters.from, to: filters.to }} today={summary?.today ?? deviceToday()}
              onApply={(r) => { setF({ from: r.from, to: r.to }); setCalOpen(false); }} onCancel={() => setCalOpen(false)} onClear={() => { setF({ from: undefined, to: undefined }); setCalOpen(false); }} />
          </div>
        ) : null}
        {tasksErr ? <ErrorRetry message={errText(tasksErr)} onRetry={loadTasks} /> : !tasks ? <div className="muted">…</div> : tasks.items.length === 0 ? (
          <Empty title={anyFilter ? tx('eod.empty') : tx('eod.emptyAll')} />
        ) : (
          <div className="eod-table-wrap"><table className="tbl" data-testid="eod-table">
            <thead><tr><th>{tx('eod.col.customer')}</th><th>{tx('eod.col.tech')}</th><th>{tx('eod.col.service')}</th><th>{tx('eod.col.date')}</th><th>{tx('eod.col.status')}</th><th>{tx('eod.col.reason')}</th><th>{tx('eod.col.actions')}</th></tr></thead>
            <tbody>{tasks.items.map((r) => (
              <tr key={r.id} data-testid="eod-row">
                <td><b>{r.customerName}</b>{r.customerPhoneLast4 ? <div className="s">•••{r.customerPhoneLast4}</div> : null}</td>
                <td>{r.technicianName}</td><td>{r.serviceName}</td><td>{r.businessDate}</td>
                <td><span className={`eod-chip st-${r.status}`}>{stText(r.status)}</span></td>
                <td className="s">{r.managerNote ?? r.reason ?? (r.overridden ? tx('eod.d.override') : '')}</td>
                <td><button type="button" className="btn ghost sm" onClick={() => setDetailId(r.id)} data-testid="eod-row-details">{tx('eod.details')}</button></td>
              </tr>))}</tbody>
          </table></div>
        )}
        <div className="eod-pagerow">
          <Pager info={pageInfo} onPage={(p) => setFilters((f) => ({ ...f, page: p }))} />
          <label className="s">{tx('eod.f.rows')} <select className="fk-select" value={filters.pageSize} onChange={(e) => setF({ pageSize: Number(e.target.value) })} data-testid="eod-f-rows">{[10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        </div>
      </section>

      <section className="panel" data-testid="eod-runs">
        <h3 className="eod-h3">{tx('eod.runs')}</h3>
        {!runs || runs.items.length === 0 ? <Empty title={tx('eod.run.none')} /> : (
          <div className="eod-table-wrap"><table className="tbl">
            <thead><tr><th>{tx('eod.run.col.date')}</th><th>{tx('eod.run.col.status')}</th><th>{tx('eod.run.col.counts')}</th><th>{tx('eod.run.col.trigger')}</th></tr></thead>
            <tbody>{runs.items.map((r) => (
              <tr key={r.id} data-testid="eod-run-row"><td>{r.businessDate}</td><td>{r.status}{r.error ? <div className="s">{r.error}</div> : null}</td>
                <td>{r.candidates} · {r.created} · {r.excluded}{r.excluded ? <div className="s">{Object.entries(r.exclusions).filter(([, n]) => n).map(([why, n]) => `${tx(`eod.why.${why}`)} ${n}`).join(' · ')}</div> : null}</td>
                <td>{tx(`eod.run.trigger.${r.trigger}`)}</td></tr>))}</tbody>
          </table></div>
        )}
        <Pager info={runs ? { page: runs.page, pageSize: runs.pageSize, totalItems: runs.total, totalPages: runs.totalPages } : null} onPage={setRunPage} compact />
      </section>

      {previewOpen ? <PreviewDialog p={preview} onClose={() => setPreviewOpen(false)} /> : null}
      {detailId ? <DetailDialog id={detailId} tz={tz} onClose={() => setDetailId(null)} onChanged={() => { void loadTasks(); void loadTop(); }} openCustomer={(id, name) => nav(`/customers?customerId=${encodeURIComponent(id)}&q=${encodeURIComponent(name)}`)}
        book={(id) => nav(`/booking/new?customerId=${encodeURIComponent(id)}&from=eod-follow-ups`)} /> : null}
    </div>
  );
}

function PreviewDialog({ p, onClose }: { p: EodPreview | null; onClose: () => void }) {
  return (
    <FitDialog title={tx('eod.preview')} subtitle={p ? tx('eod.pv.for', { date: p.businessDate, tz: p.timezone }) : undefined} onClose={onClose} wide testId="eod-preview"
      footer={<button type="button" className="btn" onClick={onClose}>{tx('eod.a.close')}</button>}>
      {!p ? <div className="muted">…</div> : (
        <div className="eod-pv">
          <div className="s eod-ev" data-testid="eod-pv-note">{p.note}</div>
          <div className="eod-pv-totals" data-testid="eod-pv-totals">
            <div><b>{p.totals.candidates}</b><span>{tx('eod.pv.candidates')}</span></div>
            <div><b data-testid="eod-pv-create">{p.totals.wouldCreate}</b><span>{tx('eod.pv.wouldCreate')}</span></div>
            <div><b>{p.totals.excluded}</b><span>{tx('eod.pv.excluded')}</span></div>
            <div><b>{p.totals.noApp}</b><span>{tx('eod.pv.noApp')}</span></div>
          </div>
          {p.totals.candidates === 0 ? <Empty title={tx('eod.pv.none')} /> : (<>
            <h4>{tx('eod.pv.reasons')}</h4>
            <div className="s" data-testid="eod-pv-reasons">{Object.entries(p.totals.reasons).map(([why, n]) => `${tx(`eod.why.${why}`)}: ${n}`).join(' · ')}</div>
            <h4>{tx('eod.pv.byTech')}</h4>
            <table className="tbl"><tbody>{p.technicians.map((x) => <tr key={x.technicianId}><td>{x.technicianName}</td><td>{x.wouldCreate}</td><td className="s">{x.excluded ? `${tx('eod.pv.excluded')} ${x.excluded}` : ''}{x.noApp ? ` · ${tx('eod.pv.noApp')} ${x.noApp}` : ''}</td></tr>)}</tbody></table>
            <h4>{tx('eod.pv.rows')}</h4>
            <table className="tbl"><tbody>{p.rows.map((r, i) => <tr key={i}><td>{r.customerName}</td><td>{r.technicianName}</td><td>{r.serviceName}</td><td className="s">{r.excluded ? tx(`eod.why.${r.excluded}`) : tx('eod.why.included')}{r.noApp && !r.excluded ? ` · ${tx('eod.pv.noApp')}` : ''}</td></tr>)}</tbody></table>
          </>)}
        </div>
      )}
    </FitDialog>
  );
}

function DetailDialog({ id, tz, onClose, onChanged, openCustomer, book }: { id: string; tz?: string; onClose: () => void; onChanged: () => void; openCustomer: (id: string, name: string) => void; book: (id: string) => void }) {
  const [d, setD] = useState<EodTaskDetail | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [needOverride, setNeedOverride] = useState(false);
  const [reason, setReason] = useState('');
  const load = useCallback(async () => { try { setD(await api.task(id)); setErr(null); } catch (e) { setErr(e); } }, [id]);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg(tx('eod.a.done')); setNeedOverride(false); setReason(''); await load(); onChanged(); }
    catch (e) { const code = (e as { code?: string })?.code; if (code === 'FOLLOWUP_ALREADY_BOOKED' || code === 'FOLLOWUP_RECENTLY_CONTACTED') setNeedOverride(true); setMsg(errorTextOf(e, tx('eod.loadError'))); }
    finally { setBusy(false); }
  };
  const unsent = d && ['pending', 'pending_manager_approval', 'customer_not_available'].includes(d.status);
  const ov = needOverride && reason.trim().length >= 5 ? { reason: reason.trim() } : null;
  const footer = d ? (
    <div className="eod-dfoot">
      <button type="button" className="btn ghost" onClick={() => openCustomer(d.customerId, d.customerName)}>{tx('eod.a.openCustomer')}</button>
      <button type="button" className="btn ghost" onClick={() => book(d.customerId)} data-testid="eod-d-book">{tx('eod.a.openBooking')}</button>
      {d.status === 'pending_manager_approval' ? <button type="button" className="btn" disabled={busy || (needOverride && !ov)} onClick={() => act(() => api.approve(d.id, { override: ov }))} data-testid="eod-d-approve">{needOverride ? tx('eod.a.sendAnyway') : tx('eod.a.approve')}</button>
        : unsent ? <button type="button" className="btn" disabled={busy || (needOverride && !ov)} onClick={() => act(() => api.send(d.id, { override: ov }))} data-testid="eod-d-send">{needOverride ? tx('eod.a.sendAnyway') : tx('eod.a.send')}</button> : null}
      <button type="button" className="btn ghost" onClick={onClose} data-testid="eod-d-close">{tx('eod.a.close')}</button>
    </div>
  ) : <button type="button" className="btn ghost" onClick={onClose}>{tx('eod.a.close')}</button>;
  return (
    <FitDialog title={tx('eod.d.title')} subtitle={d ? `${d.customerName} · ${stText(d.status)}` : undefined} onClose={onClose} busy={busy} wide testId="eod-detail" footer={footer}>
      {err ? <ErrorRetry message={errText(err)} onRetry={load} /> : !d ? <div className="muted">…</div> : (
        <div className="eod-detail">
          {msg ? <div className="muted" role="status" data-testid="eod-d-msg">{msg}</div> : null}
          <dl className="eod-dl">
            <dt>{tx('eod.d.customer')}</dt><dd>{d.customerName}{d.customerPhone ? ` · ${d.customerPhone}` : ''}</dd>
            <dt>{tx('eod.d.tech')}</dt><dd>{d.technicianName}</dd>
            <dt>{tx('eod.d.service')}</dt><dd>{d.serviceName} · {d.businessDate}</dd>
            <dt>{tx('eod.d.ticket')}</dt><dd>{d.ticketNumber ?? '—'}</dd>
            <dt>{tx('eod.d.generated')}</dt><dd>{when(d.createdAt, tz)}</dd>
            {d.submittedAt ? <><dt>{tx('eod.d.submitted')}</dt><dd>{when(d.submittedAt, tz)}</dd></> : null}
            {d.sentAt ? <><dt>{tx('eod.d.sent')}</dt><dd>{when(d.sentAt, tz)}</dd></> : null}
            {d.expiredAt ? <><dt>{tx('eod.d.expired')}</dt><dd data-testid="eod-d-expired">{when(d.expiredAt, tz)}{d.reason ? ` · ${d.reason}` : ''}</dd></> : null}
            <dt>{tx('eod.d.delivery')}</dt><dd data-testid="eod-d-delivery">{d.delivery ? `${tx('eod.d.deliveredInbox', { t: when(d.delivery.deliveredToInboxAt, tz) })} · ${d.delivery.readAt ? tx('eod.d.read', { t: when(d.delivery.readAt, tz) }) : tx('eod.d.unread')}` : tx('eod.d.noDelivery')}</dd>
            {d.managerNote ? <><dt>{tx('eod.d.managerNote')}</dt><dd>{d.managerNote}</dd></> : null}
            {d.overrideReason ? <><dt>{tx('eod.d.override')}</dt><dd>{d.overrideReason}</dd></> : null}
            {d.bookedAfter ? <><dt>{tx('eod.d.booked')}</dt><dd>{d.bookedAfter.date} · {d.bookedAfter.label}</dd></> : null}
          </dl>
          <h4>{d.sentMessage ? tx('eod.d.sentMessage') : tx('eod.d.draft')}</h4>
          <div className="eod-msg">{d.sentMessage ?? d.draft}</div>
          {needOverride ? (
            <label className="eod-field">{tx('eod.a.overrideReason')}<input className="fk-input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} data-testid="eod-d-override" /></label>
          ) : null}
          {d.status === 'pending_manager_approval' ? (
            <div className="eod-reject">
              <label className="eod-field">{tx('eod.a.rejectNote')}<input className="fk-input" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} maxLength={1000} data-testid="eod-d-reject-note" /></label>
              <button type="button" className="btn ghost" disabled={busy || rejectNote.trim().length < 3} onClick={() => act(() => api.reject(d.id, rejectNote.trim()))} data-testid="eod-d-reject">{tx('eod.a.reject')}</button>
            </div>
          ) : null}
          <h4>{tx('eod.d.timeline')}</h4>
          <ul className="eod-timeline" data-testid="eod-d-timeline">{d.timeline.map((e, i) => <li key={i}><span className="s">{when(e.at, tz)}</span> {e.action.replace(/_/g, ' ')}{e.role ? ` · ${e.role}` : ''}</li>)}</ul>
        </div>
      )}
    </FitDialog>
  );
}
