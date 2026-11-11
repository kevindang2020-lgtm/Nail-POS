// POSMessageTemplatesScreen.tsx — Communications → Message Templates (/tenant/communications/templates), Message Templates &
// Automation Center Complete Build Guide (30 Oct 2026). Preserves the original page (Your Templates + the New Template form with
// Name, Channel, Message and Create) and builds the guide's sections on the salon's real template store:
//   summary cards · server search + filters + From/To calendar + numbered pages · the editor with the Smart Variable Assistant
//   and a live (never-sending) preview · the template overlay (versions, Preview & Test, activate / deactivate / archive with
//   automation protection, duplicate) · Template Usage History (customer name / phone / booking / message search) ·
//   Automation Connection Center. Nothing here sends except the separate, confirmed Test Send.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { SYNC_POLICY } from '@aipowersalon/realtime-client';
import { posMessageTemplatesApi as api, type MtRow, type MtDetail, type MtPreview, type MtSummary, type MtUsageRow, type MtWorkflow, type MtHealth, type MtPeriod } from '../api/posMessageTemplatesApi';
import { posCommunicationsApi, newRequestKey } from '../api/posCommunicationsApi';
import { useRealtime } from '../realtime/useRealtime';
import { errorTextOf } from '../i18n/error-text';
import { fmtNumber, fmtInTz } from '../i18n/format';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry, useDebounced } from '../components/FitKit';
import { similarTemplates, type DupHit } from './messageTemplateDup';
import { PeriodBar, periodQuery, type PeriodState, type ServerPeriod } from '../components/FinanceKit';

const SIZES = [10, 20, 50] as const;
const STATUSES = ['current', 'draft', 'active', 'inactive', 'archived', 'all'] as const;
const BASES = ['created', 'updated', 'last_used'] as const;
const SORTS = ['newest', 'oldest', 'name', 'updated', 'most_used'] as const;
const U_BASES = ['created', 'sent', 'provider_event'] as const;
const U_STATUSES = ['all', 'submitted', 'delivered', 'failed', 'blocked', 'unknown', 'simulated'] as const;
const TONE: Record<string, string> = { active: 'ok', draft: 'info', inactive: 'warn', archived: 'mut', delivered: 'ok', sent: 'info', submitted: 'info', failed: 'bad', blocked: 'bad', unknown: 'mut', simulated: 'mut', pending: 'mut', ready: 'ok', attention: 'warn', info: 'info' };
const nf = (n: number) => fmtNumber(n);
const errText = (e: unknown) => errorTextOf(e, tx('mt.err.generic'));
const isForbidden = (e: unknown) => { const x = e as { status?: number; code?: string } | null; return !!x && (x.status === 403 || x.code === 'PERMISSION_DENIED'); };
const when = (iso: string | null | undefined, tz?: string) => (iso ? fmtInTz(iso, tz, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const catLabel = (c: string | null | undefined) => (c ? tx('mt.cat.' + c) : tx('mt.cat.none'));
const wfLabel = (k: string) => tx('mt.wf.' + k);
/** a validation finding in the cashier's language, by its code (the server's English sentence is never shown raw) */
const vText = (x: { code: string; token?: string }) => tx('mt.v.' + x.code, { token: x.token ?? '' });
function Chip({ s, label }: { s: string; label?: string }) { return <span className={'fk-chip ' + (TONE[s] ?? 'mut')} data-testid={'mt-chip-' + s}>{label ?? tx('mt.st.' + s)}</span>; }
const periodState = (sp: URLSearchParams, prefix = ''): PeriodState => (sp.get(prefix + 'preset') === 'custom' && sp.get(prefix + 'from') && sp.get(prefix + 'to')
  ? { preset: 'custom', from: sp.get(prefix + 'from')!, to: sp.get(prefix + 'to')! } as PeriodState
  : { preset: (['today', 'week', 'month', 'year', 'all'].includes(sp.get(prefix + 'preset') ?? '') ? sp.get(prefix + 'preset') : 'all') as PeriodState['preset'] } as PeriodState);
const serverOf = (p: MtPeriod | null | undefined): ServerPeriod | null => (p ? { preset: p.preset, from: p.from, to: p.to, tz: p.tz, today: p.today } as ServerPeriod : null);

type Form = { id?: string; recordVersion?: number; name: string; channel: 'sms' | 'email'; category: string; subject: string; description: string; body: string };
const BLANK: Form = { name: '', channel: 'sms', category: '', subject: '', description: '', body: '' };
const formOf = (d: MtDetail): Form => ({ id: d.template.id, recordVersion: d.template.recordVersion, name: d.template.name, channel: d.template.channel, category: d.template.category ?? '', subject: d.template.subject ?? '', description: d.template.description ?? '', body: d.template.body });
const sameForm = (a: Form, b: Form) => a.name === b.name && a.channel === b.channel && a.category === b.category && a.subject === b.subject && a.description === b.description && a.body === b.body;

export function POSMessageTemplatesScreen() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const setView = (patch: Record<string, string | number | null>, pageKey: 'page' | 'upage' = 'page') => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === '' || v === undefined) next.delete(k); else next.set(k, String(v)); }
    if (!(pageKey in patch)) next.delete(pageKey);
    setSp(next, { replace: true });
  };
  // ── library view state (URL: filters / page / date basis — never a phone number) ──
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const pageSize = (SIZES as readonly number[]).includes(Number(sp.get('size'))) ? Number(sp.get('size')) : 10;
  const status = (STATUSES as readonly string[]).includes(sp.get('status') ?? '') ? String(sp.get('status')) : 'current';
  const channel = ['sms', 'email'].includes(sp.get('channel') ?? '') ? String(sp.get('channel')) : '';
  const category = sp.get('category') ?? '';
  const basis = (BASES as readonly string[]).includes(sp.get('basis') ?? '') ? String(sp.get('basis')) : 'created';
  const sort = (SORTS as readonly string[]).includes(sp.get('sort') ?? '') ? String(sp.get('sort')) : 'newest';
  const period = periodState(sp);
  const [search, setSearch] = useState(sp.get('q') ?? ''); const q = useDebounced(search, 300);
  useEffect(() => { if ((sp.get('q') ?? '') !== q.trim()) setView({ q: q.trim() || null }); }, [q]);   // eslint-disable-line react-hooks/exhaustive-deps

  const [summary, setSummary] = useState<MtSummary | null>(null); const [sumErr, setSumErr] = useState<unknown>(null);
  const [list, setList] = useState<Awaited<ReturnType<typeof api.list>> | null>(null); const [listErr, setListErr] = useState<unknown>(null);
  const [reload, setReload] = useState(0); const refresh = () => setReload((n) => n + 1);
  const seq = useRef(0);
  const loadSummary = useCallback(() => { setSumErr(null); api.summary().then(setSummary, setSumErr); }, []);
  useEffect(() => { loadSummary(); }, [loadSummary, reload]);
  const lq = JSON.stringify({ ...periodQuery(period), basis, status, channel, category, sort, q: sp.get('q') ?? '', page, pageSize });
  useEffect(() => {
    const my = ++seq.current; setListErr(null);
    api.list(JSON.parse(lq)).then((d) => { if (my !== seq.current) return; setList(d); if (d.page !== page) setView({ page: d.page > 1 ? d.page : null }); }, (e) => { if (my === seq.current) setListErr(e); });
  }, [lq, reload]);   // eslint-disable-line react-hooks/exhaustive-deps
  useRealtime(['notifications', 'communications'], () => refresh(), { intervalMs: SYNC_POLICY.detailMs });

  const canManage = !!summary?.canManage;
  const [dlg, setDlg] = useState<null | { kind: 'detail'; id: string } | { kind: 'health' } | { kind: 'message'; row: MtUsageRow }>(null);
  const [newKey, setNewKey] = useState(0);   // remounts the New Template editor (New Template button / after Create)
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null);
  const anyFilter = !!(search || channel || category || status !== 'current' || sp.get('preset') || sp.get('basis') || sp.get('sort'));
  const k = summary?.kpis;

  if (sumErr && isForbidden(sumErr)) return <div className="work"><div className="err" style={{ marginTop: 12 }} data-testid="mt-forbidden">{tx('mt.noPermission')}</div></div>;

  return (
    <div className="work mt" data-testid="message-templates">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.message_templates')}</h1>
          <div className="sub">{tx('pos.reusable_sms_email_messages')}{summary ? <span className="fk-muted" data-testid="mt-updated"> · {tx('mt.updated', { time: when(summary.checkedAt, summary.month.tz) })}</span> : null}</div></div>
        <div className="fk-head-actions">
          <button type="button" className="fk-btn primary" disabled={!canManage} title={!canManage ? tx('mt.noManage') : undefined} onClick={() => { setNewKey((n) => n + 1); editorRef.current?.scrollIntoView({ block: 'nearest' }); }} data-testid="mt-new">{tx('pos.new_template')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => setDlg({ kind: 'health' })} data-testid="mt-open-health">{tx('mt.check')}</button>
          <button type="button" className="fk-btn ghost" onClick={refresh} data-testid="mt-refresh">{tx('mt.refresh')}</button>
        </div>
      </header>

      <div className="fk-kpis six" data-testid="mt-kpis">
        {sumErr ? <ErrorRetry message={errText(sumErr)} onRetry={loadSummary} /> : <>
          <KpiCard testId="mt-kpi-total" label={tx('mt.kpi.total')} loading={!k} value={k ? nf(k.total) : ''} sub={tx('mt.kpi.totalSub')} onClick={() => setView({ status: null })} />
          <KpiCard testId="mt-kpi-active" label={tx('mt.kpi.active')} loading={!k} tone="ok" value={k ? nf(k.active) : ''} sub={k ? tx('mt.kpi.activeSub', { d: nf(k.drafts), i: nf(k.inactive) }) : ''} onClick={() => setView({ status: 'active' })} />
          <KpiCard testId="mt-kpi-sms" label="SMS" loading={!k} value={k ? nf(k.sms) : ''} sub={tx('mt.kpi.notArchived')} onClick={() => setView({ channel: 'sms' })} />
          <KpiCard testId="mt-kpi-email" label={tx('pos.email')} loading={!k} value={k ? nf(k.email) : ''} sub={tx('mt.kpi.notArchived')} onClick={() => setView({ channel: 'email' })} />
          <KpiCard testId="mt-kpi-used" label={tx('mt.kpi.used')} loading={!k} tone="gold" value={k ? nf(k.usedThisMonthMessages) : ''} sub={k ? tx('mt.kpi.usedSub', { n: nf(k.usedThisMonthTemplates) }) : ''} />
          <KpiCard testId="mt-kpi-archived" label={tx('mt.kpi.archived')} loading={!k} value={k ? nf(k.archived) : ''} sub={tx('mt.kpi.archivedSub')} onClick={() => setView({ status: 'archived' })} />
        </>}
      </div>
      {note ? <div className={'fk-note ' + note.tone} role="status" data-testid="mt-note"><span>{note.text}</span><button type="button" className="fk-link" onClick={() => setNote(null)}>{tx('pos.close')}</button></div> : null}

      <div className="rt-filters rt-periodrow mt-tools" role="toolbar" aria-label={tx('mt.filters')}>
        <input type="search" className="fk-search mt-search" aria-label={tx('mt.search')} placeholder={tx('mt.search')} value={search} onChange={(e) => setSearch(e.target.value)} data-testid="mt-search" />
        <select className="fk-select" aria-label={tx('pos.channel')} value={channel} onChange={(e) => setView({ channel: e.target.value || null })} data-testid="mt-channel">
          <option value="">{tx('mt.allChannels')}</option><option value="sms">SMS</option><option value="email">{tx('pos.email')}</option>
        </select>
        <select className="fk-select" aria-label={tx('mt.status')} value={status} onChange={(e) => setView({ status: e.target.value === 'current' ? null : e.target.value })} data-testid="mt-status">
          {STATUSES.map((s) => <option key={s} value={s}>{tx('mt.stf.' + s)}</option>)}
        </select>
        <select className="fk-select" aria-label={tx('mt.category')} value={category} onChange={(e) => setView({ category: e.target.value || null })} data-testid="mt-category">
          <option value="">{tx('mt.allCategories')}</option>{(summary?.categories ?? []).map((c) => <option key={c.key} value={c.key}>{catLabel(c.key)}</option>)}
        </select>
        <PeriodBar compact allowAll value={period} server={serverOf(list?.period)}
          onChange={(p) => setView(p.preset === 'custom' ? { preset: 'custom', from: p.from ?? null, to: p.to ?? null } : { preset: p.preset === 'all' ? null : p.preset, from: null, to: null })}
          basis={basis} onBasis={(b) => setView({ basis: b === 'created' ? null : b })} basisOptions={BASES.map((b) => ({ value: b, label: tx('mt.basis.' + b) }))} />
        <select className="fk-select" aria-label={tx('mt.sort')} value={sort} onChange={(e) => setView({ sort: e.target.value === 'newest' ? null : e.target.value })} data-testid="mt-sort">
          {SORTS.map((s) => <option key={s} value={s}>{tx('mt.sort.' + s)}</option>)}
        </select>
        {anyFilter ? <button type="button" className="fk-link" onClick={() => { setSearch(''); setView({ q: null, channel: null, status: null, category: null, preset: null, from: null, to: null, basis: null, sort: null }); }} data-testid="mt-clear">{tx('mt.clearAll')}</button> : null}
      </div>
      {list?.period?.from ? <div className="fk-hint" data-testid="mt-basis-active">{tx('mt.basisActive', { basis: tx('mt.basis.' + basis), from: list.period.from, to: list.period.to ?? '' })}</div> : null}

      <div className="mt-main">
        <section className="fk-panel mt-lib" data-testid="mt-library">
          <div className="fk-panel-head"><h2>{tx('pos.your_templates')}</h2>{list ? <span className="fk-muted" data-testid="mt-total">{tx('mt.matching', { n: nf(list.totalItems) })}</span> : null}</div>
          <div className="fk-panel-body mt-scroll">
            {listErr ? (isForbidden(listErr) ? <div className="err">{tx('mt.noPermission')}</div> : <ErrorRetry message={errText(listErr)} onRetry={refresh} />)
              : !list ? <div className="state">{tx('pos.loading_templates')}</div>
              : list.items.length === 0 ? <Empty title={anyFilter ? tx('mt.noMatch') : tx('pos.no_templates_yet_create_one_on_1dpy')}>{anyFilter ? <button type="button" className="fk-link" onClick={() => { setSearch(''); setView({ q: null, channel: null, status: null, category: null, preset: null, from: null, to: null, basis: null }); }}>{tx('mt.clearAll')}</button> : null}</Empty>
              : (
                <table className="tbl mt-tbl" data-testid="mt-table">
                  <thead><tr><th>{tx('pos.name')}</th><th>{tx('pos.channel')}</th><th>{tx('mt.category')}</th><th>{tx('mt.status')}</th><th>{tx('mt.lastUpdated')}</th><th>{tx('mt.createdBy')}</th><th className="num">{tx('mt.usage')}</th><th aria-label={tx('mt.actions')} /></tr></thead>
                  <tbody>{list.items.map((r: MtRow) => (
                    <tr key={r.id} className="mt-row" tabIndex={0} onClick={() => setDlg({ kind: 'detail', id: r.id })} onKeyDown={(e) => { if (e.key === 'Enter') setDlg({ kind: 'detail', id: r.id }); }} data-testid="mt-row">
                      <td><div className="mt-name">{r.name}</div><div className="sub mt-prev">{r.subject ? <b>{r.subject} · </b> : null}{r.bodyPreview}</div>
                        {r.problems ? <span className="fk-chip bad">{tx('mt.problems', { n: String(r.problems) })}</span> : null}{r.activeBindings ? <span className="fk-chip info">{tx('mt.inAutomations', { n: String(r.activeBindings) })}</span> : null}</td>
                      <td style={{ textTransform: 'uppercase', fontWeight: 700, fontSize: 12 }}>{r.channel === 'email' ? tx('pos.email') : 'SMS'}</td>
                      <td>{catLabel(r.category)}</td>
                      <td><Chip s={r.status} /> <span className="sub">v{r.version}</span></td>
                      <td className="sub">{when(r.updatedAt, list.period.tz)}</td>
                      <td className="sub">{r.createdByName ?? (r.createdAtKnown ? '—' : tx('mt.unknownCreator'))}</td>
                      <td className="num">{nf(r.usageCount)}</td>
                      <td><button type="button" className="fk-link" onClick={(e) => { e.stopPropagation(); setDlg({ kind: 'detail', id: r.id }); }}>{tx('mt.view')}</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
          </div>
          <div className="fk-panel-foot mt-foot">
            <Pager info={list ? { page: list.page, pageSize: list.pageSize, totalItems: list.totalItems, totalPages: list.totalPages } : null} onPage={(p) => setView({ page: p > 1 ? p : null })} />
            <label className="mt-size">{tx('mt.rows')} <select className="fk-select" value={pageSize} onChange={(e) => setView({ size: Number(e.target.value) === 10 ? null : e.target.value })} data-testid="mt-size">{SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          </div>
        </section>

        <section className="fk-panel mt-editor" ref={editorRef} data-testid="mt-new-panel">
          <div className="fk-panel-head"><h2>{tx('pos.new_template')}</h2></div>
          <div className="fk-panel-body">
            <Editor key={newKey} initial={BLANK} summary={summary} canManage={canManage}
              onSaved={(d, activated) => { setNote({ tone: 'ok', text: activated ? tx('mt.createdActive', { name: d.template.name }) : tx('mt.createdDraft', { name: d.template.name }) }); setNewKey((n) => n + 1); setSearch(''); setView({ q: null, status: activated ? null : 'draft', sort: null, preset: null, from: null, to: null }); refresh(); }} />
          </div>
        </section>
      </div>
      <div className="sub" style={{ fontSize: 12 }}>{tx('mt.footnote')}</div>

      <div className="mt-below">
        <UsageHistory sp={sp} setView={setView} reload={reload} onOpen={(row) => setDlg({ kind: 'message', row })} />
        <Connections reload={reload} canManage={canManage} onChanged={refresh} onOpenTemplate={(id) => setDlg({ kind: 'detail', id })} />
      </div>

      {dlg?.kind === 'detail' ? <DetailDialog id={dlg.id} summary={summary} canManage={canManage} onClose={() => setDlg(null)} onChanged={refresh} onOpen={(id) => setDlg({ kind: 'detail', id })}
        onUsage={(id) => { setDlg(null); setView({ utpl: id }, 'upage'); }} /> : null}
      {dlg?.kind === 'health' ? <HealthDialog onClose={() => setDlg(null)} onOpen={(id) => setDlg({ kind: 'detail', id })} /> : null}
      {dlg?.kind === 'message' ? <MessageDialog row={dlg.row} tz={list?.period.tz} onClose={() => setDlg(null)} nav={nav} /> : null}
    </div>
  );
}

// ── the editor (New Template panel + the overlay): Smart Variable Assistant + live preview that never sends ───────────────
function Editor({ initial, summary, canManage, onSaved, onConflict }: { initial: Form; summary: MtSummary | null; canManage: boolean; onSaved: (d: MtDetail, activated: boolean) => void; onConflict?: (current: any) => void }) {
  const [f, setF] = useState<Form>(initial);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [problems, setProblems] = useState<{ code: string; token?: string; message: string }[]>([]);
  const body = useRef<HTMLTextAreaElement | null>(null);
  const editing = !!initial.id;
  const dirty = !sameForm(f, initial);
  // the Smart Variable Assistant: only the variables this category can actually fill; click inserts at the cursor
  const [vq, setVq] = useState('');
  const vars = useMemo(() => (summary?.variables ?? []).filter((v) => v.categories.includes('*') || (f.category ? v.categories.includes(f.category) : false))
    .filter((v) => !vq || (v.label + ' ' + v.token).toLowerCase().includes(vq.toLowerCase())), [summary, f.category, vq]);
  const insert = (token: string) => {
    const el = body.current; const t = `{${token}}`;
    const s = el ? el.selectionStart ?? f.body.length : f.body.length; const e2 = el ? el.selectionEnd ?? s : s;
    const next = f.body.slice(0, s) + t + f.body.slice(e2);
    setF({ ...f, body: next });
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(s + t.length, s + t.length); } });
  };
  // live preview (sample data, server-rendered with the same renderer the senders use; never sends)
  const draft = useDebounced(JSON.stringify({ channel: f.channel, category: f.category || null, subject: f.subject || null, body: f.body }), 400);
  const [pv, setPv] = useState<MtPreview | null>(null);
  useEffect(() => {
    const d = JSON.parse(draft) as { channel: string; category: string | null; subject: string | null; body: string }; if (!d.body.trim()) { setPv(null); return; }
    let live = true; api.preview({ draft: d }).then((r) => { if (live) setPv(r); }, () => { if (live) setPv(null); });
    return () => { live = false; };
  }, [draft]);
  // duplicate-template warning for NEW drafts only (warns, never blocks)
  const dupKey = useDebounced(editing ? '' : JSON.stringify({ name: f.name, channel: f.channel, body: f.body }), 500);
  const [dupes, setDupes] = useState<DupHit[]>([]);
  useEffect(() => {
    if (!dupKey) { setDupes([]); return; }
    const d = JSON.parse(dupKey) as { name: string; channel: string; body: string };
    if (!d.name.trim() && d.body.trim().length < 12) { setDupes([]); return; }
    let live = true; api.list({ channel: d.channel, pageSize: 50 }).then((l) => { if (live) setDupes(similarTemplates(d, l.items)); }, () => { if (live) setDupes([]); });
    return () => { live = false; };
  }, [dupKey]);
  const save = async (activate: boolean) => {
    if (!f.name.trim() || !f.body.trim()) { setErr(tx('pos.name_and_body_are_required')); return; }
    setBusy(true); setErr(null); setProblems([]);
    try {
      const d = editing
        ? await api.update(initial.id!, { recordVersion: initial.recordVersion!, name: f.name.trim(), channel: f.channel, body: f.body, category: f.category || null, subject: f.channel === 'email' ? f.subject : null, description: f.description || null })
        : await api.create({ name: f.name.trim(), channel: f.channel, body: f.body, category: f.category || null, subject: f.channel === 'email' ? f.subject : null, description: f.description || null, activate });
      onSaved(d, activate);
    } catch (e: any) {
      if (e?.code === 'TEMPLATE_VERSION_CONFLICT' && onConflict) onConflict(e?.details?.current ?? e?.current ?? null);
      setErr(errText(e)); const v = e?.details?.validation ?? e?.validation; if (v?.errors) setProblems(v.errors);
    } finally { setBusy(false); }
  };
  const sms = pv?.rendered.sms;
  return (
    <div className="mt-form" data-testid="mt-form">
      <div className="lf"><label htmlFor="mt-name">{tx('pos.name')}</label>
        <input id="mt-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={tx('pos.e_g_appointment_confirmation')} maxLength={120} data-testid="mt-f-name" /></div>
      <div className="mt-row2">
        <div className="lf"><label htmlFor="mt-ch">{tx('pos.channel')}</label>
          <select id="mt-ch" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value as 'sms' | 'email' })} data-testid="mt-f-channel"><option value="sms">SMS</option><option value="email">{tx('pos.email')}</option></select></div>
        <div className="lf"><label htmlFor="mt-cat">{tx('mt.category')}</label>
          <select id="mt-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} data-testid="mt-f-category"><option value="">{tx('mt.cat.none')}</option>{(summary?.categories ?? []).map((c) => <option key={c.key} value={c.key}>{catLabel(c.key)} · {tx('mt.class.' + c.messageClass)}</option>)}</select></div>
      </div>
      {f.channel === 'email' ? <div className="lf"><label htmlFor="mt-subj">{tx('mt.subject')}</label><input id="mt-subj" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} maxLength={200} data-testid="mt-f-subject" /></div> : null}
      <div className="lf" style={{ alignItems: 'flex-start' }}><label htmlFor="mt-body" style={{ marginTop: 10 }}>{tx('pos.message')}</label>
        <textarea id="mt-body" ref={body} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} rows={5} placeholder={tx('pos.hi_name_this_is_a_reminder_1piv')} data-testid="mt-f-body" /></div>
      <div className="mt-vars" data-testid="mt-vars">
        <div className="mt-vars-h"><b>{tx('mt.vars.title')}</b><input type="search" className="fk-search" value={vq} onChange={(e) => setVq(e.target.value)} placeholder={tx('mt.vars.search')} aria-label={tx('mt.vars.search')} /></div>
        <div className="mt-vars-list">{vars.map((v) => <button type="button" key={v.token} className="mt-var" onClick={() => insert(v.token)} title={v.source} data-testid={'mt-var-' + v.token}>{v.label}<code>{`{${v.token}}`}</code></button>)}</div>
        <div className="sub mt-vars-note">{f.category ? tx('mt.vars.forCategory', { cat: catLabel(f.category) }) : tx('mt.vars.pickCategory')} {tx('mt.vars.legacy')}</div>
      </div>
      <div className="lf"><label htmlFor="mt-desc">{tx('mt.description')}</label><input id="mt-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={500} /></div>
      <div className="mt-preview" data-testid="mt-live-preview" aria-live="polite">
        <div className="mt-preview-h"><b>{tx('mt.preview.title')}</b><span className="fk-chip mut">{tx('mt.preview.sample')}</span>
          {sms ? <span className="fk-chip info" data-testid="mt-segments">{tx('mt.preview.sms', { enc: sms.encoding, units: String(sms.units), seg: String(sms.segments) })}</span> : null}</div>
        {pv ? <>{pv.rendered.subject ? <div className="mt-subjline">{pv.rendered.subject}</div> : null}<div className="mt-rendered" data-testid="mt-rendered">{pv.rendered.text}</div>
          {[...pv.validation.errors, ...pv.validation.warnings].map((x, i) => <div key={i} className={'mt-finding ' + (i < pv.validation.errors.length ? 'bad' : 'warn')} data-testid="mt-finding">{vText(x)}</div>)}</>
          : <div className="sub">{tx('mt.preview.empty')}</div>}
      </div>
      {dupes.length ? <div className="fk-note warn" role="status" data-testid="mt-dup-warn">{tx('mt.dupWarn', { names: dupes.map((x) => x.name).join(', ') })}</div> : null}
      {problems.length ? <div className="fk-note bad" role="alert">{problems.map((p) => vText(p)).join(' ')}</div> : null}
      <div className="mt-actions">
        {editing ? <button type="button" className="fk-btn primary" disabled={busy || !canManage || !dirty} onClick={() => save(false)} data-testid="mt-save">{busy ? tx('pos.saving_2') : tx('mt.save')}</button>
          : <>
            <button type="button" className="fk-btn primary" disabled={busy || !canManage} onClick={() => save(true)} data-testid="mt-create">{busy ? tx('pos.saving_2') : tx('pos.create_2')}</button>
            <button type="button" className="fk-btn" disabled={busy || !canManage} onClick={() => save(false)} data-testid="mt-save-draft">{tx('mt.saveDraft')}</button>
          </>}
        {dirty && !editing ? <button type="button" className="fk-link" onClick={() => { setF(initial); setErr(null); setProblems([]); }}>{tx('mt.clearForm')}</button> : null}
        {err ? <span className="mt-err" role="alert" data-testid="mt-form-err">{err}</span> : null}
      </div>
      {!canManage ? <div className="sub">{tx('mt.noManage')}</div> : null}
    </div>
  );
}

// ── the template overlay: details, edit (version-checked), versions, Preview & Test, status with automation protection ────
function DetailDialog({ id, summary, canManage, onClose, onChanged, onOpen, onUsage }: { id: string; summary: MtSummary | null; canManage: boolean; onClose: () => void; onChanged: () => void; onOpen: (id: string) => void; onUsage: (id: string) => void }) {
  const [d, setD] = useState<MtDetail | null>(null); const [err, setErr] = useState<unknown>(null);
  const [tab, setTab] = useState<'edit' | 'versions' | 'test' | 'automations'>('edit');
  const [editKey, setEditKey] = useState(0); const [conflict, setConflict] = useState(false);
  const [askClose, setAskClose] = useState(false); const dirtyRef = useRef(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null);
  const load = useCallback(() => { setErr(null); api.detail(id).then((x) => { setD(x); setConflict(false); setEditKey((n) => n + 1); }, setErr); }, [id]);
  useEffect(() => { load(); }, [load]);
  const close = () => { if (dirtyRef.current && !askClose) { setAskClose(true); return; } onClose(); };
  const [busy, setBusy] = useState(false);
  const [replacement, setReplacement] = useState<{ to: 'inactive' | 'archived'; bindings: any[] } | null>(null); const [repId, setRepId] = useState('');
  const [repOptions, setRepOptions] = useState<MtRow[]>([]);
  const status = async (to: 'active' | 'inactive' | 'archived', extra: { replacementTemplateId?: string; confirm?: boolean } = {}) => {
    if (!d) return; setBusy(true); setMsg(null);
    try { const r = await api.setStatus(id, { to, recordVersion: d.template.recordVersion, ...extra }); setD(r); setReplacement(null); setMsg({ tone: 'ok', text: tx('mt.statusDone', { st: tx('mt.st.' + r.template.status) }) + (r.movedBindings ? ' ' + tx('mt.moved', { n: String(r.movedBindings) }) : '') }); onChanged(); }
    catch (e: any) {
      if (e?.code === 'TEMPLATE_IN_USE' && to !== 'active') {
        setReplacement({ to, bindings: e?.details?.bindings ?? e?.bindings ?? [] });
        api.list({ status: 'active', channel: d.template.channel, category: d.template.category ?? undefined, pageSize: 50 }).then((l) => setRepOptions(l.items.filter((x) => x.id !== id)), () => setRepOptions([]));
      } else setMsg({ tone: 'bad', text: errText(e) });
      if (e?.code === 'TEMPLATE_VERSION_CONFLICT') load();
    } finally { setBusy(false); }
  };
  const dup = async () => { setBusy(true); try { const r = await api.duplicate(id); onChanged(); onOpen(r.template.id); } catch (e) { setMsg({ tone: 'bad', text: errText(e) }); } finally { setBusy(false); } };
  // Version Rollback Assistant: restoring an earlier version saves its content as a NEW version through the
  // normal audited update path (history is never rewritten); the server re-validates it.
  const [restoreV, setRestoreV] = useState<number | null>(null);
  const restore = async (v: number) => {
    if (!d) return; const src = d.versions.find((x) => x.version === v); if (!src) return;
    const tt = d.template; setBusy(true); setMsg(null);
    try {
      const r = await api.update(id, { recordVersion: tt.recordVersion, name: tt.name, channel: tt.channel, body: src.body, category: tt.category, subject: tt.channel === 'email' ? (src.subject ?? null) : null, description: tt.description });
      setD(r); setRestoreV(null); setEditKey((n) => n + 1); setMsg({ tone: 'ok', text: tx('mt.restored', { from: String(v), v: String(r.template.version) }) }); onChanged();
    } catch (e: any) { setMsg({ tone: 'bad', text: errText(e) }); if (e?.code === 'TEMPLATE_VERSION_CONFLICT') load(); }
    finally { setBusy(false); }
  };
  const t = d?.template;
  return (
    <FitDialog wide title={t ? t.name : tx('mt.template')} subtitle={t ? <span><Chip s={t.status} /> v{t.version} · {t.channel === 'email' ? tx('pos.email') : 'SMS'} · {catLabel(t.category)}</span> : undefined} onClose={close} busy={busy} testId="mt-detail"
      footer={t ? <div className="mt-dlg-foot">
        {t.status === 'draft' || t.status === 'inactive' ? <button type="button" className="fk-btn primary" disabled={!canManage || busy} onClick={() => status('active')} data-testid="mt-activate">{tx('mt.activate')}</button> : null}
        {t.status === 'active' ? <button type="button" className="fk-btn" disabled={!canManage || busy} onClick={() => status('inactive')} data-testid="mt-deactivate">{tx('mt.deactivate')}</button> : null}
        {t.status !== 'archived' ? <button type="button" className="fk-btn danger" disabled={!canManage || busy} onClick={() => status('archived')} data-testid="mt-archive">{tx('mt.archive')}</button>
          : <button type="button" className="fk-btn" disabled={!canManage || busy} onClick={() => status('inactive')} data-testid="mt-restore">{tx('mt.restore')}</button>}
        <button type="button" className="fk-btn" disabled={!canManage || busy} onClick={dup} data-testid="mt-duplicate">{tx('mt.duplicate')}</button>
        <button type="button" className="fk-btn ghost" onClick={() => onUsage(id)} data-testid="mt-view-usage">{tx('mt.viewUsage')}</button>
        <button type="button" className="fk-btn ghost" onClick={close} data-testid="mt-close">{tx('pos.close')}</button>
      </div> : undefined}>
      {err ? <ErrorRetry message={errText(err)} onRetry={load} /> : !d || !t ? <div className="state">{tx('pos.loading')}</div> : <>
        {askClose ? <div className="fk-note warn" role="alert" data-testid="mt-unsaved"><span>{tx('mt.unsaved')}</span><span><button type="button" className="fk-link" onClick={onClose}>{tx('mt.discard')}</button><button type="button" className="fk-link" onClick={() => setAskClose(false)}>{tx('mt.keepEditing')}</button></span></div> : null}
        {msg ? <div className={'fk-note ' + msg.tone} role="status" data-testid="mt-dlg-note">{msg.text}</div> : null}
        {replacement ? <div className="fk-note warn mt-replace" role="alert" data-testid="mt-in-use">
          <div><b>{tx('mt.inUse.title', { n: String(replacement.bindings.length) })}</b><div>{replacement.bindings.map((b: any) => wfLabel(b.workflow)).join(', ')}</div><div className="sub">{tx('mt.inUse.help')}</div></div>
          <select className="fk-select" value={repId} onChange={(e) => setRepId(e.target.value)} aria-label={tx('mt.inUse.pick')} data-testid="mt-replacement"><option value="">{tx('mt.inUse.pick')}</option>{repOptions.map((o) => <option key={o.id} value={o.id}>{o.name} (v{o.version})</option>)}</select>
          <button type="button" className="fk-btn primary" disabled={!repId || busy} onClick={() => status(replacement.to, { replacementTemplateId: repId, confirm: true })} data-testid="mt-replace-confirm">{tx('mt.inUse.confirm')}</button>
          <button type="button" className="fk-link" onClick={() => setReplacement(null)}>{tx('mt.cancel')}</button>
        </div> : null}
        <div className="mt-tabs" role="tablist">{(['edit', 'versions', 'test', 'automations'] as const).map((x) => <button type="button" role="tab" key={x} aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)} data-testid={'mt-tab-' + x}>{tx('mt.tab.' + x)}</button>)}</div>
        <dl className="mt-facts"><dt>{tx('mt.created')}</dt><dd>{t.createdAtKnown ? `${when(t.createdAt)} · ${t.createdByName ?? '—'}` : tx('mt.createdUnknown')}</dd>
          <dt>{tx('mt.lastUpdated')}</dt><dd>{when(t.updatedAt)}{t.updatedByName ? ` · ${t.updatedByName}` : ''}</dd>
          <dt>{tx('mt.usage')}</dt><dd>{tx('mt.usageFacts', { n: nf(t.usageCount), last: when(t.lastUsedAt) })}</dd>
          <dt>{tx('mt.branch')}</dt><dd>{t.branchName ?? tx('mt.allBranches')}</dd></dl>
        {d.validation.errors.length ? <div className="fk-note bad" data-testid="mt-detail-problems">{d.validation.errors.map((e) => vText(e)).join(' ')}</div> : null}
        {tab === 'edit' ? (t.status === 'archived' ? <div className="fk-note warn">{tx('mt.archivedNoEdit')}</div> : <>
          {conflict ? <div className="fk-note bad" role="alert" data-testid="mt-conflict"><span>{tx('mt.conflict')}</span><button type="button" className="fk-link" onClick={load}>{tx('mt.reload')}</button></div> : null}
          <EditorTracked key={editKey} initial={formOf(d)} summary={summary} canManage={canManage} dirtyRef={dirtyRef}
            onSaved={(x) => { setD(x); setEditKey((n) => n + 1); setMsg({ tone: 'ok', text: tx('mt.savedVersion', { v: String(x.template.version) }) }); onChanged(); }} onConflict={() => setConflict(true)} />
        </>) : null}
        {tab === 'versions' ? <ul className="mt-versions" data-testid="mt-versions">{d.versions.map((v) => <li key={v.version}>
          <div className="mt-vh"><b>v{v.version}</b>{v.version === t.version ? <span className="fk-chip ok">{tx('mt.current')}</span> : null}{v.backfilled ? <span className="fk-chip mut">{tx('mt.backfilled')}</span> : null}<span className="sub">{when(v.createdAt)} · {v.byName ?? '—'}</span></div>
          {v.subject ? <div className="mt-subjline">{v.subject}</div> : null}<div className="mt-rendered">{v.body}</div>
          {v.version !== t.version && t.status !== 'archived' && canManage ? (restoreV === v.version
            ? <div className="fk-note warn" data-testid="mt-restore-confirm-box"><span>{tx('mt.restoreAsk', { from: String(v.version), v: String(t.version + 1) })}</span>
                <button type="button" className="fk-btn primary" disabled={busy} onClick={() => restore(v.version)} data-testid="mt-restore-confirm">{tx('mt.restoreYes')}</button>
                <button type="button" className="fk-link" onClick={() => setRestoreV(null)}>{tx('mt.cancel')}</button></div>
            : <button type="button" className="fk-link" disabled={busy} onClick={() => setRestoreV(v.version)} data-testid="mt-restore-version">{tx('mt.restoreVersion')}</button>) : null}</li>)}</ul> : null}
        {tab === 'test' ? <PreviewTest d={d} summary={summary} canManage={canManage} /> : null}
        {tab === 'automations' ? <TemplateAutomations d={d} /> : null}
      </>}
    </FitDialog>
  );
}
function EditorTracked(p: { initial: Form; summary: MtSummary | null; canManage: boolean; dirtyRef: { current: boolean }; onSaved: (d: MtDetail) => void; onConflict: () => void }) {
  // wraps the editor to report unsaved changes to the overlay's Close (unsaved-change warning, guide §07)
  const wrap = useRef<HTMLDivElement | null>(null);
  useEffect(() => { const el = wrap.current; if (!el) return; const on = () => { p.dirtyRef.current = true; }; el.addEventListener('input', on); return () => { el.removeEventListener('input', on); p.dirtyRef.current = false; }; }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={wrap}><Editor initial={p.initial} summary={p.summary} canManage={p.canManage} onSaved={(d) => { p.dirtyRef.current = false; p.onSaved(d); }} onConflict={p.onConflict} /></div>;
}

function PreviewTest({ d, summary, canManage }: { d: MtDetail; summary: MtSummary | null; canManage: boolean }) {
  const [version, setVersion] = useState(d.template.version);
  const [cq, setCq] = useState(''); const [cands, setCands] = useState<{ id: string; name: string | null; phoneMasked: string | null }[]>([]); const [cust, setCust] = useState<{ id: string; name: string | null } | null>(null);
  const [pv, setPv] = useState<MtPreview | null>(null); const [pvErr, setPvErr] = useState<string | null>(null);
  useEffect(() => { let live = true; setPvErr(null); api.preview({ templateId: d.template.id, version, ...(cust ? { customerId: cust.id } : {}) }).then((r) => { if (live) setPv(r); }, (e) => { if (live) setPvErr(errText(e)); }); return () => { live = false; }; }, [d.template.id, version, cust]);
  const dq = useDebounced(cq, 300);
  useEffect(() => { if (dq.trim().length < 2) { setCands([]); return; } posCommunicationsApi.inbox.customers(dq.trim()).then((r) => setCands(r.items), () => setCands([])); }, [dq]);
  // Test Send: a separate, deliberate action — a typed recipient, an explicit confirmation, one key per intended test
  const [to, setTo] = useState(''); const [confirm, setConfirm] = useState(false); const [tBusy, setTBusy] = useState(false); const [tRes, setTRes] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null);
  const key = useRef<{ to: string; v: number; key: string } | null>(null);
  const test = async () => {
    if (!key.current || key.current.to !== to.trim() || key.current.v !== version) key.current = { to: to.trim(), v: version, key: newRequestKey() };
    setTBusy(true); setTRes(null);
    try {
      const r = await api.testSend(d.template.id, { to: to.trim(), version, confirm: true }, key.current.key);
      setTRes({ tone: r.status === 'submitted' || r.status === 'simulated' ? 'ok' : 'bad', text: tx('mt.test.result.' + r.status, { to: r.target, why: r.errorCode ?? '' }) + (r.duplicate ? ' ' + tx('mt.test.duplicate') : '') });
      setConfirm(false);
    } catch (e) { setTRes({ tone: 'bad', text: errText(e) }); }
    finally { setTBusy(false); }
  };
  const sms = pv?.rendered.sms;
  return (
    <div className="mt-pt" data-testid="mt-preview-test">
      <div className="mt-row2">
        <label className="lf"><span>{tx('mt.version')}</span><select className="fk-select" value={version} onChange={(e) => setVersion(Number(e.target.value))} data-testid="mt-pv-version">{d.versions.map((v) => <option key={v.version} value={v.version}>v{v.version}</option>)}</select></label>
        {summary?.canPreviewCustomer ? <div className="lf mt-cust"><span>{tx('mt.pv.customer')}</span>
          {cust ? <span className="fk-chip info">{cust.name ?? '—'} <button type="button" className="fk-chip-x" aria-label={tx('mt.pv.useSample')} onClick={() => setCust(null)}>✕</button></span>
            : <><input type="search" className="fk-search" value={cq} onChange={(e) => setCq(e.target.value)} placeholder={tx('mt.pv.customerSearch')} data-testid="mt-pv-customer" />
              {cands.length ? <div className="mt-cands">{cands.map((c) => <button type="button" key={c.id} className="mt-cand" onClick={() => { setCust({ id: c.id, name: c.name }); setCq(''); setCands([]); }}>{c.name ?? '—'} <span className="sub">{c.phoneMasked ?? ''}</span></button>)}</div> : null}</>}
        </div> : null}
      </div>
      <div className="mt-preview" data-testid="mt-preview-box">
        <div className="mt-preview-h"><b>{tx('mt.preview.title')}</b><span className={'fk-chip ' + (pv?.source === 'customer' ? 'warn' : 'mut')}>{pv?.source === 'customer' ? tx('mt.preview.real') : tx('mt.preview.sample')}</span>
          {sms ? <span className="fk-chip info">{tx('mt.preview.sms', { enc: sms.encoding, units: String(sms.units), seg: String(sms.segments) })}</span> : null}<span className="fk-chip ok">{tx('mt.preview.noSend')}</span></div>
        {pvErr ? <div className="err">{pvErr}</div> : pv ? <>{pv.rendered.subject ? <div className="mt-subjline">{pv.rendered.subject}</div> : null}
          <div className="mt-rendered" data-testid="mt-pv-text">{pv.rendered.text}</div>
          {pv.unresolved.length ? <div className="mt-finding warn">{tx('mt.pv.missing', { list: pv.unresolved.map((m) => `{${m}}`).join(', ') })}</div> : null}</> : <div className="state">{tx('pos.loading')}</div>}
      </div>
      <section className="mt-test" data-testid="mt-test">
        <h3>{tx('mt.test.title')}</h3>
        <div className="sub">{tx(d.template.channel === 'email' ? 'mt.test.helpEmail' : 'mt.test.helpSms')}</div>
        <div className="mt-row2">
          <input className="fk-search" value={to} onChange={(e) => { setTo(e.target.value); setConfirm(false); }} placeholder={tx(d.template.channel === 'email' ? 'mt.test.toEmail' : 'mt.test.toPhone')} aria-label={tx('mt.test.to')} disabled={!canManage} data-testid="mt-test-to" />
          <label className="mt-confirm"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} disabled={!canManage || !to.trim()} data-testid="mt-test-confirm" /> {tx('mt.test.confirm')}</label>
          <button type="button" className="fk-btn primary" disabled={!canManage || !confirm || !to.trim() || tBusy || d.template.status === 'archived'} onClick={test} data-testid="mt-test-send">{tBusy ? tx('mt.test.sending') : tx('mt.test.send')}</button>
        </div>
        {!canManage ? <div className="sub">{tx('mt.noManage')}</div> : null}
        {tRes ? <div className={'fk-note ' + tRes.tone} role="status" data-testid="mt-test-result">{tRes.text}</div> : null}
        {d.tests.length ? <ul className="mt-tests">{d.tests.map((x) => <li key={x.id}><Chip s={x.delivery} label={tx('mt.dl.' + x.delivery)} /> v{x.version} → {x.target} · {when(x.createdAt)} · {x.byName ?? '—'}{x.errorCode ? <span className="sub"> ({x.errorCode})</span> : null}</li>)}</ul> : null}
      </section>
    </div>
  );
}

function TemplateAutomations({ d }: { d: MtDetail }) {
  return d.bindings.filter((b) => b.active).length === 0
    ? <div className="sub" data-testid="mt-no-automations">{tx('mt.noAutomations')}</div>
    : <ul className="mt-tests" data-testid="mt-automations">{d.bindings.filter((b) => b.active).map((b) => <li key={b.id}><b>{wfLabel(b.workflow)}</b> · {b.channel.toUpperCase()} · v{b.version} ({tx('mt.strategy.' + b.strategy)}) · {b.branchName ?? tx('mt.allBranches')}</li>)}</ul>;
}

// ── Template Usage History (guide §11): customer name / phone / booking / message — separate from template definitions ────
function UsageHistory({ sp, setView, reload, onOpen }: { sp: URLSearchParams; setView: (p: Record<string, string | number | null>, k?: 'page' | 'upage') => void; reload: number; onOpen: (r: MtUsageRow) => void }) {
  const page = Math.max(1, Number(sp.get('upage')) || 1);
  const size = (SIZES as readonly number[]).includes(Number(sp.get('usize'))) ? Number(sp.get('usize')) : 10;
  const st = (U_STATUSES as readonly string[]).includes(sp.get('ust') ?? '') ? String(sp.get('ust')) : 'all';
  const ch = ['sms', 'email'].includes(sp.get('uch') ?? '') ? String(sp.get('uch')) : '';
  const basis = (U_BASES as readonly string[]).includes(sp.get('ubasis') ?? '') ? String(sp.get('ubasis')) : 'created';
  const tpl = sp.get('utpl') ?? '';
  const period = periodState(sp, 'u');
  // the search text stays in component state, never in the URL (it can be a phone number — guide §12)
  const [search, setSearch] = useState(''); const q = useDebounced(search, 350);
  const [data, setData] = useState<Awaited<ReturnType<typeof api.usage>> | null>(null); const [err, setErr] = useState<unknown>(null);
  const seq = useRef(0);
  const key = JSON.stringify({ ...periodQuery(period), basis, status: st === 'all' ? undefined : st, channel: ch || undefined, templateId: tpl || undefined, q: q.trim() || undefined, page, pageSize: size });
  useEffect(() => { const my = ++seq.current; setErr(null); api.usage(JSON.parse(key)).then((d) => { if (my === seq.current) setData(d); }, (e) => { if (my === seq.current) setErr(e); }); }, [key, reload]);
  useEffect(() => { if (page !== 1) setView({ upage: null }, 'upage'); }, [q]);   // eslint-disable-line react-hooks/exhaustive-deps
  const up = (p: Record<string, string | number | null>) => setView(p, 'upage');
  const pp = (p: PeriodState) => up(p.preset === 'custom' ? { upreset: 'custom', ufrom: p.from ?? null, uto: p.to ?? null } : { upreset: p.preset === 'all' ? null : p.preset, ufrom: null, uto: null });
  return (
    <section className="fk-panel mt-usage" data-testid="mt-usage">
      <div className="fk-panel-head"><h2>{tx('mt.usage.title')}</h2>{data ? <span className="fk-muted">{tx('mt.matching', { n: nf(data.totalItems) })}</span> : null}</div>
      <div className="fk-panel-body">
        <div className="rt-filters mt-tools" role="toolbar" aria-label={tx('mt.usage.title')}>
          <input type="search" className="fk-search mt-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx('mt.usage.search')} aria-label={tx('mt.usage.search')} data-testid="mt-usage-search" />
          <select className="fk-select" value={st} onChange={(e) => up({ ust: e.target.value === 'all' ? null : e.target.value })} aria-label={tx('mt.usage.status')} data-testid="mt-usage-status">{U_STATUSES.map((s) => <option key={s} value={s}>{tx('mt.dlf.' + s)}</option>)}</select>
          <select className="fk-select" value={ch} onChange={(e) => up({ uch: e.target.value || null })} aria-label={tx('pos.channel')}><option value="">{tx('mt.allChannels')}</option><option value="sms">SMS</option><option value="email">{tx('pos.email')}</option></select>
          <PeriodBar compact allowAll value={period} onChange={pp} server={serverOf(data?.period)} basis={basis} onBasis={(b) => up({ ubasis: b === 'created' ? null : b })} basisOptions={U_BASES.map((b) => ({ value: b, label: tx('mt.ubasis.' + b) }))} />
          {tpl ? <span className="fk-chip info" data-testid="mt-usage-tpl">{tx('mt.usage.oneTemplate')} <button type="button" className="fk-chip-x" aria-label={tx('mt.clearAll')} onClick={() => up({ utpl: null })}>✕</button></span> : null}
        </div>
        {err ? <ErrorRetry message={errText(err)} onRetry={() => setSearch((s) => s)} /> : !data ? <div className="state">{tx('pos.loading')}</div>
          : data.items.length === 0 ? <Empty title={tx('mt.usage.none')}><div className="sub">{data.unlinkedNote ? tx('mt.usage.unlinked') : null}</div></Empty>
          : <div className="mt-scroll"><table className="tbl mt-tbl" data-testid="mt-usage-table">
            <thead><tr><th>{tx('mt.usage.time')}</th><th>{tx('mt.template')}</th><th>{tx('mt.usage.customer')}</th><th>{tx('pos.channel')}</th><th>{tx('mt.usage.source')}</th><th>{tx('mt.usage.send')}</th><th>{tx('mt.usage.delivery')}</th><th aria-label={tx('mt.actions')} /></tr></thead>
            <tbody>{data.items.map((r) => (
              <tr key={r.id} className="mt-row" tabIndex={0} onClick={() => onOpen(r)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(r); }} data-testid="mt-usage-row">
                <td className="sub">{when(r.createdAt, data.period.tz)}</td><td>{r.templateName} <span className="sub">v{r.version}</span></td>
                <td>{r.customerName ?? '—'}<div className="sub">{r.recipient ?? ''}</div></td><td>{r.channel.toUpperCase()}</td><td>{wfLabel(r.workflow)}</td>
                <td><Chip s={r.sendOutcome} label={tx('mt.so.' + r.sendOutcome)} /></td><td><Chip s={r.delivery} label={tx('mt.dl.' + r.delivery)} /></td>
                <td><button type="button" className="fk-link" onClick={(e) => { e.stopPropagation(); onOpen(r); }}>{tx('mt.usage.view')}</button></td>
              </tr>))}</tbody></table></div>}
      </div>
      <div className="fk-panel-foot mt-foot">
        <Pager info={data ? { page: data.page, pageSize: data.pageSize, totalItems: data.totalItems, totalPages: data.totalPages } : null} onPage={(p) => up({ upage: p > 1 ? p : null })} />
        <label className="mt-size">{tx('mt.rows')} <select className="fk-select" value={size} onChange={(e) => up({ usize: Number(e.target.value) === 10 ? null : e.target.value })}>{SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
      </div>
    </section>
  );
}

function MessageDialog({ row, tz, onClose, nav }: { row: MtUsageRow; tz?: string; onClose: () => void; nav: (to: string) => void }) {
  return (
    <FitDialog title={tx('mt.msg.title')} subtitle={`${row.templateName} v${row.version} · ${wfLabel(row.workflow)}`} onClose={onClose} testId="mt-message"
      footer={<div className="mt-dlg-foot">
        {row.customerId ? <button type="button" className="fk-btn" onClick={() => nav(`/tenant/customers?customer=${encodeURIComponent(row.customerId!)}`)}>{tx('mt.msg.customer')}</button> : null}
        {row.threadId ? <button type="button" className="fk-btn" onClick={() => nav(`/tenant/communications/inbox?thread=${encodeURIComponent(row.threadId!)}`)}>{tx('mt.msg.conversation')}</button> : null}
        {row.appointmentId ? <button type="button" className="fk-btn" onClick={() => nav(`/booking?appointment=${encodeURIComponent(row.appointmentId!)}`)}>{tx('mt.msg.booking')}</button> : null}
        <button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.close')}</button></div>}>
      <dl className="mt-facts"><dt>{tx('mt.usage.customer')}</dt><dd>{row.customerName ?? '—'} {row.recipient ? <span className="sub">{row.recipient}</span> : null}</dd>
        <dt>{tx('mt.usage.time')}</dt><dd>{when(row.createdAt, tz)}</dd><dt>{tx('mt.usage.send')}</dt><dd><Chip s={row.sendOutcome} label={tx('mt.so.' + row.sendOutcome)} />{row.reason ? <span className="sub"> ({row.reason})</span> : null}</dd>
        <dt>{tx('mt.usage.delivery')}</dt><dd><Chip s={row.delivery} label={tx('mt.dl.' + row.delivery)} />{row.providerEventAt ? <span className="sub"> {when(row.providerEventAt, tz)}</span> : null}</dd>
        <dt>{tx('mt.msg.provider')}</dt><dd>{row.providerRef ?? '—'}</dd></dl>
      {row.renderedSubject ? <div className="mt-subjline">{row.renderedSubject}</div> : null}
      <div className="mt-rendered" data-testid="mt-message-text">{row.renderedBody}</div>
      <div className="sub" style={{ marginTop: 8 }}>{tx('mt.msg.snapshot')}</div>
    </FitDialog>
  );
}

// ── Automation Connection Center (guide §14) ────────────────────────────────────────────────────────────────────────────────
function Connections({ reload, canManage, onChanged, onOpenTemplate }: { reload: number; canManage: boolean; onChanged: () => void; onOpenTemplate: (id: string) => void }) {
  const [data, setData] = useState<{ workflows: MtWorkflow[] } | null>(null); const [err, setErr] = useState<unknown>(null);
  const load = useCallback(() => { setErr(null); api.connections(null).then(setData, setErr); }, []);
  useEffect(() => { load(); }, [load, reload]);
  const [pick, setPick] = useState<{ wf: MtWorkflow; channel: 'sms' | 'email' } | null>(null); const [opts, setOpts] = useState<MtRow[]>([]); const [sel, setSel] = useState(''); const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const openPick = (wf: MtWorkflow, channel: 'sms' | 'email') => { setPick({ wf, channel }); setSel(''); api.list({ status: 'active', channel, category: wf.categories[0], pageSize: 50 }).then((l) => setOpts(l.items), () => setOpts([])); };
  const connect = async () => { if (!pick || !sel) return; setBusy(true); setMsg(null); try { await api.bind({ workflow: pick.wf.key, channel: pick.channel, templateId: sel }); setMsg({ tone: 'ok', text: tx('mt.conn.connected', { wf: wfLabel(pick.wf.key) }) }); setPick(null); load(); onChanged(); } catch (e) { setMsg({ tone: 'bad', text: errText(e) }); } finally { setBusy(false); } };
  const disconnect = async (b: { id: string; recordVersion: number; workflow: string }) => { setBusy(true); setMsg(null); try { await api.unbind(b.id, b.recordVersion); setMsg({ tone: 'ok', text: tx('mt.conn.disconnected', { wf: wfLabel(b.workflow) }) }); load(); onChanged(); } catch (e) { setMsg({ tone: 'bad', text: errText(e) }); } finally { setBusy(false); } };
  return (
    <section className="fk-panel mt-conn" data-testid="mt-connections">
      <div className="fk-panel-head"><h2>{tx('mt.conn.title')}</h2></div>
      <div className="fk-panel-body">
        <div className="sub" style={{ marginBottom: 6 }}>{tx('mt.conn.help')}</div>
        {msg ? <div className={'fk-note ' + msg.tone} role="status" data-testid="mt-conn-note">{msg.text}</div> : null}
        {err ? <ErrorRetry message={errText(err)} onRetry={load} /> : !data ? <div className="state">{tx('pos.loading')}</div> : <ul className="mt-wfs">{data.workflows.map((w) => (
          <li key={w.key} className="mt-wf" data-testid={'mt-wf-' + w.key}>
            <div className="mt-wf-h"><b>{wfLabel(w.key)}</b>
              {w.workflowActive === true ? <span className="fk-chip ok">{tx('mt.conn.on')}</span> : w.workflowActive === false ? <span className="fk-chip mut">{tx('mt.conn.off')}</span> : null}
              {w.bindable ? <span className="fk-chip info">{tx('mt.conn.bindable')}</span> : <span className="fk-chip mut">{tx('mt.conn.notBindable')}</span>}</div>
            <div className="sub">{tx('mt.wfsrc.' + w.key)}</div>
            {w.bindings.map((b) => <div key={b.id} className="mt-bind" data-testid="mt-binding">
              <span>{tx('mt.conn.uses')} <button type="button" className="fk-link" onClick={() => onOpenTemplate(b.templateId)}>{b.templateName}</button> v{b.version} · {b.channel.toUpperCase()} · {tx('mt.strategy.' + b.strategy)} · {b.branchName ?? tx('mt.allBranches')}</span>
              {!b.healthy ? <span className="fk-chip bad">{tx('mt.conn.broken')}</span> : null}
              {canManage ? <button type="button" className="fk-link" disabled={busy} onClick={() => disconnect(b)} data-testid="mt-disconnect">{tx('mt.conn.disconnect')}</button> : null}
            </div>)}
            {w.lastUsedAt ? <div className="sub">{tx('mt.conn.lastUse', { time: when(w.lastUsedAt), n: nf(w.messagesFromTemplates) })}</div> : null}
            {w.bindable && canManage ? <div className="mt-bind-actions">{w.channels.map((c) => <button type="button" key={c} className="fk-btn" disabled={busy} onClick={() => openPick(w, c as 'sms' | 'email')} data-testid={'mt-connect-' + w.key + '-' + c}>{tx('mt.conn.connect', { ch: c.toUpperCase() })}</button>)}</div> : null}
            {pick && pick.wf.key === w.key ? <div className="mt-pick" data-testid="mt-pick">
              <select className="fk-select" value={sel} onChange={(e) => setSel(e.target.value)} aria-label={tx('mt.conn.pick')} data-testid="mt-pick-select"><option value="">{opts.length ? tx('mt.conn.pick') : tx('mt.conn.noneEligible', { cat: catLabel(w.categories[0]) })}</option>{opts.map((o) => <option key={o.id} value={o.id}>{o.name} (v{o.version})</option>)}</select>
              <button type="button" className="fk-btn primary" disabled={!sel || busy} onClick={connect} data-testid="mt-pick-connect">{tx('mt.conn.confirm')}</button>
              <button type="button" className="fk-link" onClick={() => setPick(null)}>{tx('mt.cancel')}</button>
              <div className="sub">{tx('mt.conn.noSend')}</div>
            </div> : null}
          </li>))}</ul>}
      </div>
    </section>
  );
}

function HealthDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
  const [h, setH] = useState<MtHealth | null>(null); const [err, setErr] = useState<unknown>(null);
  const run = useCallback(() => { setErr(null); setH(null); api.health().then(setH, setErr); }, []);
  useEffect(() => { run(); }, [run]);
  return (
    <FitDialog wide title={tx('mt.health.title')} subtitle={h ? tx('mt.health.ran', { time: when(h.checkedAt) }) : undefined} onClose={onClose} testId="mt-health"
      footer={<div className="mt-dlg-foot"><button type="button" className="fk-btn" onClick={run}>{tx('mt.health.again')}</button><button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.close')}</button></div>}>
      <div className="sub" style={{ marginBottom: 8 }}>{tx('mt.health.help')}</div>
      {err ? <ErrorRetry message={errText(err)} onRetry={run} /> : !h ? <div className="state">{tx('pos.loading')}</div> : <ul className="mt-findings" data-testid="mt-health-list">{h.findings.map((x, i) => (
        <li key={i} className={'mt-hf ' + x.status} data-testid={'mt-hf-' + x.key}><Chip s={x.status} label={tx('mt.hs.' + x.status)} /> <b>{tx('mt.hfk.' + x.key)}</b>
          <div className="sub">{x.message}</div>{x.templateId ? <button type="button" className="fk-link" onClick={() => onOpen(x.templateId!)}>{tx('mt.view')}</button> : null}</li>))}</ul>}
    </FitDialog>
  );
}
