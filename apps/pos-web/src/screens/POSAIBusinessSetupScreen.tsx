// POSAIBusinessSetupScreen.tsx — AI Center → Business Setup (/tenant/ai/receptionist/business-setup). Rebuilt in place by the AI
// Business Setup guide (Oct 30 2026); the original modules are kept: title + principle, the Readiness rows (Business hours /
// Services / Technicians), the Customer FAQs form (Question · Category · Approved answer · Add FAQ) and Back to Command Center.
//   • Readiness comes from /pos/ai/business-setup/readiness: the SAME canonical tables and eligibility rules the AI receptionist
//     uses, with raw vs eligible counts, exclusions and the source. A count that could not be read shows Unknown + Retry —
//     never 0 (the old screen read `r.services` from a { items } response and printed a false 0).
//   • Add FAQ saves a DRAFT. Only an approved FAQ is AI knowledge; editing an approved FAQ is a pending change that never
//     replaces the live text until it is approved. Owners / managers (ai.manage) edit and approve; everyone with ai.use reads.
//   • Check Business Setup, Preview AI Knowledge and the Knowledge Assistant only read. Preview never books, holds, texts or calls.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posAiBusinessSetupApi, type FaqAction, type FaqQuery } from '../api/posAiBusinessSetupApi';
import { useCan } from '../components/usePermissions';
import { errorTextOf } from '../i18n/error-text';
import { fmtInZone as fmtInZoneOpts } from '../i18n/format';
const fmtInZone = (x: string | null | undefined) => fmtInZoneOpts(x, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
import { FitDialog, Pager, Empty, ErrorRetry, useDebounced, requestId } from '../components/FitKit';
import { RangeCalendar } from '../components/FinanceKit';
import { similarFaqs, faqWords } from './faqDup';

const t = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const STATUS_TONE: Record<string, string> = { READY: 'ok', NEEDS_SETUP: 'warn', STALE: 'warn', FAILED: 'bad', DISABLED: 'muted', UNKNOWN: 'bad' };
const FAQ_STATUS = ['draft', 'pending_review', 'approved', 'needs_review', 'archived'] as const;
const SCOPES = ['faqs', 'services', 'technicians', 'tests', 'history'] as const;
// the sample test questions, read at render in the POS language (the AI answers in the language it is asked)
const SAMPLE_KEYS = ['openSunday', 'pedicurePrice', 'nailArt', 'bookTomorrow', 'cancellation'] as const;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };   // the device's day, not UTC

function StatusBadge({ s }: { s: string }) { return <span className={`ais-badge ais-${STATUS_TONE[s] ?? 'muted'}`} data-testid={`ais-status-${s}`}>{t(`aiset.status.${s}`)}</span>; }
function FaqBadge({ s }: { s: string }) { return <span className={`ais-badge ais-faq-${s}`}>{t(`aiset.faq.${s}`)}</span>; }

function ReadinessRow({ c, onGo, onRetry }: { c: any; onGo: (r: string) => void; onRetry: () => void }) {
  const counts = (c.rawCount != null || c.eligibleCount != null) && c.key !== 'business_hours';   // hours: the detail line already says "Open N day(s)"
  return (
    <div className="ais-row" data-testid={`ais-ready-${c.key}`}>
      <span className={`ais-dot ais-${STATUS_TONE[c.status] ?? 'muted'}`} />
      <div className="ais-row-main">
        <div className="ais-row-head"><b>{t(`aiset.check.${c.key}`)}</b><StatusBadge s={c.status} /></div>
        <div className="ais-row-detail">{c.status === 'UNKNOWN' ? t('aiset.unknownDetail', { trace: c.traceId }) : c.detail}</div>
        {counts && c.status !== 'UNKNOWN' ? <div className="ais-counts">{t('aiset.counts', { raw: c.rawCount ?? '—', eligible: c.eligibleCount ?? '—' })}</div> : null}
        {c.exclusions?.length ? <div className="ais-chips">{c.exclusions.map((x: any) => <span key={x.reason} className="ais-chip">{t(`aiset.excl.${x.reason}`)} · {x.count}</span>)}</div> : null}
        {c.warnings?.length ? <ul className="ais-warn">{c.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul> : null}
        <div className="ais-source">{t('aiset.source', { source: c.source })}</div>
      </div>
      {c.status === 'UNKNOWN' ? <button className="btn ghost" onClick={onRetry}>{t('aiset.retry')}</button>
        : c.action ? <button className="btn ghost" onClick={() => onGo(c.action.route)}>{t('aiset.edit')}</button> : null}
    </div>
  );
}

function presetDays(p: 'today' | 'week' | 'month' | 'year', today: string): { from: string; to: string } {
  const d = new Date(today + 'T12:00:00Z');
  const ymd = (x: Date) => x.toISOString().slice(0, 10);
  if (p === 'today') return { from: today, to: today };
  if (p === 'week') { const m = new Date(d); m.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return { from: ymd(m), to: today }; }
  if (p === 'month') return { from: today.slice(0, 8) + '01', to: today };
  return { from: today.slice(0, 5) + '01-01', to: today };
}

export function POSAIBusinessSetupScreen() {
  const nav = useNavigate(); const can = useCan(); const canManage = can('ai.manage');
  const [ready, setReady] = useState<any>(null); const [readyErr, setReadyErr] = useState<string | null>(null);
  const [form, setForm] = useState({ question: '', answer: '', category: '' });
  const [formKey, setFormKey] = useState(requestId()); const [saving, setSaving] = useState(false); const [notice, setNotice] = useState<string | null>(null); const [formErr, setFormErr] = useState<string | null>(null);
  const [scope, setScope] = useState<typeof SCOPES[number]>('faqs');
  const [search, setSearch] = useState(''); const dq = useDebounced(search, 300);
  const [f, setF] = useState<FaqQuery & { basis?: string }>({ page: 1, pageSize: 20, sort: 'newest', dateBasis: 'created', basis: 'faq_change' });
  const [list, setList] = useState<any>(null); const [listErr, setListErr] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  const [cal, setCal] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'health' | 'preview' | 'assistant'>(null);
  // A12 Nov 6: the last recorded Check Business Setup run (re-read after the dialog closes)
  const [lastRun, setLastRun] = useState<{ at: string; overall: string } | null>(null);
  useEffect(() => { if (dialog === null) posAiBusinessSetupApi.healthLast().then(setLastRun).catch(() => setLastRun(null)); }, [dialog]);

  const loadReady = useCallback(() => { setReadyErr(null); posAiBusinessSetupApi.readiness().then(setReady).catch((e) => setReadyErr(errorTextOf(e, tx('pos.something_went_wrong')))); }, []);
  useEffect(() => { loadReady(); }, [loadReady]);
  const loadList = useCallback(async () => {
    setLoading(true); setListErr(null);
    try {
      if (scope === 'faqs') setList(await posAiBusinessSetupApi.faqs({ q: dq, status: f.status, category: f.category, tag: f.tag, dateBasis: f.dateBasis, from: f.from, to: f.to, sort: f.sort, page: f.page, pageSize: f.pageSize }));
      else if (scope === 'history') setList(await posAiBusinessSetupApi.history({ basis: f.basis, from: f.from, to: f.to, page: f.page, pageSize: f.pageSize }));
      else setList(await posAiBusinessSetupApi.search({ scope, q: dq, page: f.page, pageSize: f.pageSize }));
    } catch (e) { setListErr(errorTextOf(e, tx('pos.something_went_wrong'))); setList(null); } finally { setLoading(false); }
  }, [scope, dq, f]);
  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { setF((x) => ({ ...x, page: 1 })); }, [dq, scope]);
  const setFilter = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch, page: 1 }));

  // FAQ Duplicate Warning: look for existing questions that ask the same thing (warn only — saving stays allowed)
  const dupQ = useDebounced(form.question, 450);
  const [lookAlikes, setLookAlikes] = useState<Array<{ id: string; question: string }>>([]);
  useEffect(() => {
    const words = [...faqWords(dupQ)].sort((a, b) => b.length - a.length);
    if (words.length < 2) { setLookAlikes([]); return; }
    let live = true;
    Promise.resolve().then(() => posAiBusinessSetupApi.faqs({ q: words[0], page: 1, pageSize: 50 } as FaqQuery))
      .then((r: any) => { if (live) setLookAlikes(similarFaqs(dupQ, (r?.items ?? []) as Array<{ id: string; question: string; status?: string }>)); }, () => { if (live) setLookAlikes([]); });
    return () => { live = false; };
  }, [dupQ]);
  const addFaq = async () => {
    setFormErr(null); setNotice(null);
    if (!form.question.trim() || !form.answer.trim()) { setFormErr(t('aiset.needBoth')); return; }
    setSaving(true);
    try {
      const r = await posAiBusinessSetupApi.createFaq({ question: form.question.trim(), answer: form.answer.trim(), category: form.category.trim() || null, idempotencyKey: formKey });
      setForm({ question: '', answer: '', category: '' }); setFormKey(requestId());
      const visible = scope === 'faqs' && !dq && !f.status && !f.category && !f.from && (f.sort ?? 'newest') === 'newest';
      setNotice(visible ? t('aiset.savedDraft') : t('aiset.savedDraftFiltered'));
      if (scope === 'faqs') setF((x) => ({ ...x, page: 1 }));
      void loadReady(); setOpen(r.id);
    } catch (e) { setFormErr(errorTextOf(e, tx('pos.something_went_wrong'))); } finally { setSaving(false); }
  };
  const clearAll = () => { setSearch(''); setF({ page: 1, pageSize: f.pageSize, sort: 'newest', dateBasis: 'created', basis: 'faq_change' }); };
  const info = list ? { page: list.page, pageSize: list.pageSize, totalItems: list.totalItems, totalPages: list.totalPages } : null;

  return (
    <div className="work ais" data-testid="ai-business-setup">
      <div className="vh ais-head">
        <div><h1>{t('aiset.title')}</h1><div className="sub">{t('aiset.subtitle')}</div></div>
        <div className="ais-head-actions">
          <button className="btn" data-testid="ais-check" onClick={() => setDialog('health')}>{t('aiset.checkSetup')}</button>
          {lastRun ? <span className="sub" data-testid="ais-last-run">{t('aiset.lastRun', { when: fmtInZone(lastRun.at), state: lastRun.overall })}</span> : null}
          <button className="btn ghost" data-testid="ais-preview" onClick={() => setDialog('preview')}>{t('aiset.preview')}</button>
          <button className="btn ghost" data-testid="ais-assistant" onClick={() => setDialog('assistant')}>{t('aiset.assistant')}</button>
        </div>
      </div>

      <div className="ais-grid">
        <section className="panel ais-card" data-testid="ais-readiness">
          <div className="ais-card-head"><h2>{t('aiset.readiness')}</h2><button className="btn ghost" onClick={loadReady}>{t('aiset.refresh')}</button></div>
          <div className="sub ais-note">{t('aiset.readinessNote')}</div>
          {readyErr ? <ErrorRetry message={readyErr} onRetry={loadReady} /> : !ready ? <div className="state">{t('aiset.loading')}</div> : (
            <>
              {ready.core.map((c: any) => <ReadinessRow key={c.key} c={c} onGo={(r) => nav(r)} onRetry={loadReady} />)}
              <div className="ais-sub-head">{t('aiset.supplemental')}</div>
              {ready.supplemental.map((c: any) => <ReadinessRow key={c.key} c={c} onGo={(r) => nav(r)} onRetry={loadReady} />)}
              <div className="ais-source">{t('aiset.checkedAt', { at: fmtInZone(ready.checkedAt) })} · {t(ready.branchScope === 'branch' ? 'aiset.scopeBranch' : 'aiset.scopeAll')}</div>
            </>
          )}
        </section>

        <section className="panel ais-card" data-testid="ais-faq-form">
          <h2>{t('aiset.faqs')}</h2>
          <div className="sub ais-note">{t('aiset.faqsNote')}</div>
          {canManage ? (
            <>
              <div className="ais-form">
                <label>{t('aiset.question')}<input data-testid="ais-q" value={form.question} maxLength={300} placeholder={t('aiset.questionPh')} onChange={(e) => setForm({ ...form, question: e.target.value })} /></label>
                <label>{t('aiset.category')}<input data-testid="ais-cat" value={form.category} maxLength={60} placeholder={t('aiset.categoryPh')} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label>
              </div>
              <label className="ais-full">{t('aiset.answer')}<textarea data-testid="ais-a" value={form.answer} maxLength={2000} rows={3} placeholder={t('aiset.answerPh')} onChange={(e) => setForm({ ...form, answer: e.target.value })} /></label>
              {lookAlikes.length ? <div className="fk-note warn" role="status" data-testid="ais-faq-dup">{t('aiset.faqDup')}{' '}
                {lookAlikes.map((x, i) => <span key={x.id}>{i ? ' · ' : ''}<button type="button" className="fk-link" onClick={() => setOpen(x.id)} data-testid="ais-faq-dup-open">“{x.question}”</button></span>)}</div> : null}
              <div className="ais-form-foot"><button className="btn" data-testid="ais-add" disabled={saving} onClick={addFaq}>{saving ? t('aiset.adding') : t('aiset.addFaq')}</button><span className="sub">{t('aiset.draftHint')}</span></div>
              {formErr ? <div className="err" role="alert">{formErr}</div> : null}
              {notice ? <div className="ok" role="status" data-testid="ais-notice">{notice}</div> : null}
            </>
          ) : <div className="state" data-testid="ais-readonly">{t('aiset.readOnly')}</div>}
        </section>
      </div>

      <ClosuresPanel canManage={canManage} />
      <section className="panel ais-card" data-testid="ais-list">
        <div className="ais-tabs" role="tablist">{SCOPES.map((s) => <button key={s} role="tab" aria-selected={scope === s} className={'btn' + (scope === s ? '' : ' ghost')} data-testid={`ais-scope-${s}`} onClick={() => setScope(s)}>{t(`aiset.scope.${s}`)}</button>)}</div>
        <div className="ais-filters">
          {scope !== 'history' ? <input className="ais-search" data-testid="ais-search" value={search} maxLength={100} placeholder={t('aiset.searchPh')} onChange={(e) => setSearch(e.target.value)} aria-label={t('aiset.searchPh')} /> : null}
          {scope === 'faqs' ? <>
            <select aria-label={t('aiset.statusFilter')} value={f.status ?? ''} onChange={(e) => setFilter({ status: e.target.value || undefined })} data-testid="ais-f-status"><option value="">{t('aiset.allStatuses')}</option>{FAQ_STATUS.map((s) => <option key={s} value={s}>{t(`aiset.faq.${s}`)}</option>)}</select>
            {(list?.tags ?? []).length ? <select aria-label={t('aiset.tagFilter')} value={f.tag ?? ''} onChange={(e) => setFilter({ tag: e.target.value || undefined })} data-testid="ais-tag-filter"><option value="">{t('aiset.allTags')}</option>{list.tags.map((x: string) => <option key={x} value={x}>#{x}</option>)}</select> : null}
            <select aria-label={t('aiset.categoryFilter')} value={f.category ?? ''} onChange={(e) => setFilter({ category: e.target.value || undefined })}><option value="">{t('aiset.allCategories')}</option>{(list?.categories ?? []).map((c: string) => <option key={c} value={c}>{c}</option>)}</select>
            <select aria-label={t('aiset.dateBasis')} value={f.dateBasis} onChange={(e) => setFilter({ dateBasis: e.target.value })}>{['created', 'updated', 'approved'].map((b) => <option key={b} value={b}>{t(`aiset.basis.${b}`)}</option>)}</select>
            <select aria-label={t('aiset.sort')} value={f.sort} onChange={(e) => setFilter({ sort: e.target.value })}>{['newest', 'oldest', 'updated', 'approved', 'question_az'].map((s) => <option key={s} value={s}>{t(`aiset.sortBy.${s}`)}</option>)}</select>
          </> : null}
          {scope === 'history' ? <select aria-label={t('aiset.dateBasis')} value={f.basis} onChange={(e) => setFilter({ basis: e.target.value })}>{['faq_change', 'approval', 'preview'].map((b) => <option key={b} value={b}>{t(`aiset.hbasis.${b}`)}</option>)}</select> : null}
          {scope === 'faqs' || scope === 'history' ? (['today', 'week', 'month', 'year'] as const).map((p) => {
            // Business Setup guide: Today / This week / This month / This year beside the From–To calendar (salon device day)
            const r = presetDays(p, today());
            return <button key={p} className={'btn ghost' + (f.from === r.from && f.to === r.to ? ' on' : '')} data-testid={`ais-preset-${p}`} onClick={() => setFilter({ from: r.from, to: r.to })}>{t('aiset.preset.' + p)}</button>;
          }) : null}
          {scope === 'faqs' || scope === 'history' ? <button className="btn ghost" data-testid="ais-range" onClick={() => setCal(!cal)}>{f.from ? `${f.from} → ${f.to}` : t('aiset.dateRange')}</button> : null}
          <select aria-label={t('aiset.pageSize')} value={f.pageSize} onChange={(e) => setFilter({ pageSize: Number(e.target.value) })} data-testid="ais-size">{[10, 20, 50].map((n) => <option key={n} value={n}>{t('aiset.perPage', { n })}</option>)}</select>
          <button className="btn ghost" onClick={clearAll}>{t('aiset.clearAll')}</button>
        </div>
        {cal ? <div className="ais-cal" data-testid="ais-cal"><RangeCalendar initial={{ from: f.from, to: f.to }} today={today()}
          onApply={(r) => { setFilter({ from: r.from, to: r.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { setFilter({ from: undefined, to: undefined }); setCal(false); }} /></div> : null}
        {f.from && (scope === 'faqs' || scope === 'history') ? <div className="sub ais-note">{t('aiset.rangeNote', { basis: t(scope === 'faqs' ? `aiset.basis.${f.dateBasis}` : `aiset.hbasis.${f.basis}`), from: f.from, to: f.to ?? f.from })}</div> : null}
        {listErr ? <ErrorRetry message={listErr} onRetry={loadList} /> : loading && !list ? <div className="state">{t('aiset.loading')}</div>
          : !list?.items?.length ? <Empty title={t(scope === 'faqs' ? 'aiset.noFaqs' : 'aiset.noResults')} />
          : scope === 'faqs' ? (
            <div className="ais-faqs" data-testid="ais-faq-rows">{list.items.map((x: any) => (
              <button key={x.id} className="ais-faq" onClick={() => setOpen(x.id)} data-testid="ais-faq-row">
                <div className="ais-faq-top"><b>{x.question}</b><FaqBadge s={x.status} />{x.aiServable ? <span className="ais-chip ais-ok">{t('aiset.aiUses')}</span> : null}{x.hasPendingChange ? <span className="ais-chip ais-warn">{t('aiset.pendingChange')}</span> : null}{x.category ? <span className="ais-chip">{x.category}</span> : null}{(x.tags ?? []).map((g: string) => <span key={g} className="ais-chip">#{g}</span>)}</div>
                <div className="ais-faq-a">{x.answer}</div>
                <div className="ais-source">{t('aiset.createdAt', { at: fmtInZone(x.createdAt) })}{x.approvedAt ? ` · ${t('aiset.approvedAt', { at: fmtInZone(x.approvedAt) })}` : ''}</div>
              </button>))}</div>
          ) : (
            <div className="ais-faqs">{list.items.map((x: any, i: number) => (
              <div key={x.id + i} className="ais-faq ais-static" onClick={() => (scope === 'history' || x.kind === 'faq') && setOpen(x.id)}>
                <div className="ais-faq-top"><b>{x.title}</b>
                  {scope === 'history' ? <span className="ais-chip">{t(`aiset.ev.${x.kind}`)}</span> : x.kind === 'history' ? <span className="ais-chip">{t(`aiset.ev.${x.subtitle}`)}</span> : x.subtitle ? <span className="ais-chip">{t(`aiset.sub.${x.subtitle}`)}</span> : null}</div>
                {x.at ? <div className="ais-source">{fmtInZone(x.at)}</div> : null}
                {scope === 'services' ? <a className="ais-link" onClick={(e) => { e.stopPropagation(); nav('/services'); }}>{t('aiset.openServices')}</a> : scope === 'technicians' ? <a className="ais-link" onClick={(e) => { e.stopPropagation(); nav('/technicians'); }}>{t('aiset.openTeam')}</a> : null}
              </div>))}</div>
          )}
        <div className="ais-pager"><Pager info={info} onPage={(p) => setF((x) => ({ ...x, page: p }))} />{info ? <span className="sub">{t('aiset.total', { n: info.totalItems })}</span> : null}</div>
      </section>

      <div className="ais-back"><button className="btn ghost" onClick={() => nav('/tenant/ai/receptionist')}>{t('aiset.back')}</button></div>

      {open ? <FaqOverlay id={open} canManage={canManage} onClose={() => setOpen(null)} onChanged={() => { void loadList(); void loadReady(); }} /> : null}
      {dialog === 'health' ? <HealthDialog onClose={() => setDialog(null)} onGo={(r) => nav(r)} /> : null}
      {dialog === 'preview' ? <PreviewDialog onClose={() => setDialog(null)} /> : null}
      {dialog === 'assistant' ? <AssistantDialog onClose={() => setDialog(null)} onGo={(r) => nav(r)} onDraft={(q) => { setForm({ question: q, answer: '', category: '' }); setDialog(null); setNotice(t('aiset.draftPrefilled')); }} onOpenFaq={(id) => { setDialog(null); setOpen(id); }} /> : null}
    </div>
  );
}

function FaqOverlay({ id, canManage, onClose, onChanged }: { id: string; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'overview' | 'answer' | 'preview' | 'history' | 'audit'>('overview');
  const [tagText, setTagText] = useState<string | null>(null); const [pv, setPv] = useState<any>(null);
  const saveTags = async () => {
    if (tagText === null) return; setBusy(true); setErr(null);
    try { await posAiBusinessSetupApi.setTags(id, tagText.split(',').map((x) => x.trim()).filter(Boolean)); setTagText(null); load(); onChanged(); }
    catch (e) { setErr(errorTextOf(e, tx('pos.something_went_wrong'))); } finally { setBusy(false); }
  };
  const runPreview = async () => { if (!d) return; setPv({ loading: true }); try { setPv(await posAiBusinessSetupApi.preview(d.question)); } catch (e) { setPv({ error: errorTextOf(e, tx('pos.something_went_wrong')) }); } };
  const [edit, setEdit] = useState<null | { question: string; answer: string; category: string; reason: string }>(null);
  const [ask, setAsk] = useState<null | 'reject' | 'archive'>(null); const [reason, setReason] = useState('');
  const load = useCallback(() => { setErr(null); posAiBusinessSetupApi.faq(id).then(setD).catch((e) => setErr(errorTextOf(e, tx('pos.something_went_wrong')))); }, [id]);
  useEffect(() => { load(); }, [load]);
  const run = async (action: FaqAction, extra: Record<string, unknown> = {}) => {
    if (!d) return; setBusy(true); setErr(null);
    try { await posAiBusinessSetupApi.act(id, { action, expectedVersion: d.version, idempotencyKey: requestId(), ...extra } as Parameters<typeof posAiBusinessSetupApi.act>[1]); setEdit(null); setAsk(null); setReason(''); load(); onChanged(); }
    catch (e) { setErr(errorTextOf(e, tx('pos.something_went_wrong'))); } finally { setBusy(false); }
  };
  const pending = d && (d.status !== 'approved' ? true : d.hasPendingChange);
  const actions = useMemo(() => {
    if (!d || !canManage) return [] as FaqAction[];
    const s = d.status; const a: FaqAction[] = [];
    if (s !== 'archived') a.push('edit');
    if ((s === 'draft' || s === 'needs_review') || (s === 'approved' && d.hasPendingChange && !d.submittedAt)) a.push('submit');
    if (pending && s !== 'archived') a.push('approve');
    if (s === 'pending_review' || (s === 'approved' && d.hasPendingChange)) a.push('reject');
    if (s !== 'archived') a.push('archive'); else a.push('restore');
    return a;
  }, [d, canManage, pending]);
  return (
    <FitDialog title={d?.question ?? t('aiset.faq')} subtitle={d ? <><FaqBadge s={d.status} />{d.aiServable ? <span className="ais-chip ais-ok">{t('aiset.aiUses')}</span> : <span className="ais-chip">{t('aiset.aiNotUses')}</span>}</> : null}
      onClose={onClose} busy={busy} wide testId="ais-overlay"
      footer={<div className="ais-actions">{actions.map((a) => <button key={a} className={'btn' + (a === 'approve' ? '' : ' ghost')} disabled={busy} data-testid={`ais-act-${a}`}
        onClick={() => a === 'edit' ? setEdit({ question: d.draftQuestion ?? d.question, answer: d.draftAnswer ?? d.answer, category: d.category ?? '', reason: '' }) : a === 'reject' || a === 'archive' ? setAsk(a) : run(a)}>{t(`aiset.act.${a}`)}</button>)}
        <button className="btn ghost" onClick={onClose} data-testid="ais-close">{t('aiset.close')}</button></div>}>
      {err ? <div className="err" role="alert">{err}</div> : null}
      {!d ? <div className="state">{t('aiset.loading')}</div> : (
        <>
          <div className="ais-tabs">{(['overview', 'answer', 'preview', 'history', 'audit'] as const).map((x) => <button key={x} className={'btn' + (tab === x ? '' : ' ghost')} onClick={() => setTab(x)} data-testid={`ais-tab-${x}`}>{t(`aiset.tab.${x}`)}</button>)}</div>
          {edit ? (
            <div className="ais-edit" data-testid="ais-edit">
              <div className="sub">{d.status === 'approved' ? t('aiset.editApprovedNote') : t('aiset.editDraftNote')}</div>
              <label>{t('aiset.question')}<input value={edit.question} maxLength={300} onChange={(e) => setEdit({ ...edit, question: e.target.value })} /></label>
              <label>{t('aiset.answer')}<textarea rows={4} value={edit.answer} maxLength={2000} onChange={(e) => setEdit({ ...edit, answer: e.target.value })} data-testid="ais-edit-a" /></label>
              <label>{t('aiset.category')}<input value={edit.category} maxLength={60} onChange={(e) => setEdit({ ...edit, category: e.target.value })} /></label>
              <label>{t('aiset.reasonOptional')}<input value={edit.reason} maxLength={500} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} /></label>
              <div className="ais-actions"><button className="btn" disabled={busy} data-testid="ais-save-draft" onClick={() => run('edit', { question: edit.question, answer: edit.answer, category: edit.category || null, reason: edit.reason || null })}>{t('aiset.saveDraft')}</button><button className="btn ghost" onClick={() => setEdit(null)}>{t('aiset.cancel')}</button></div>
            </div>
          ) : ask ? (
            <div className="ais-edit" data-testid="ais-reason">
              <label>{t('aiset.reasonRequired')}<input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} data-testid="ais-reason-input" /></label>
              <div className="ais-actions"><button className="btn" disabled={busy || !reason.trim()} data-testid="ais-reason-ok" onClick={() => run(ask, { reason })}>{t(`aiset.act.${ask}`)}</button><button className="btn ghost" onClick={() => setAsk(null)}>{t('aiset.cancel')}</button></div>
            </div>
          ) : tab === 'overview' ? (
            <dl className="ais-dl">
              <dt>{t('aiset.statusLabel')}</dt><dd>{t(`aiset.faq.${d.status}`)}</dd>
              <dt>{t('aiset.category')}</dt><dd>{d.category ?? '—'}</dd>
              <dt>{t('aiset.scopeLabel')}</dt><dd>{d.branchId ? t('aiset.thisBranch') : t('aiset.allBranches')}</dd>
              <dt>{t('aiset.created')}</dt><dd>{fmtInZone(d.createdAt)}</dd>
              <dt>{t('aiset.approved')}</dt><dd>{d.approvedAt ? fmtInZone(d.approvedAt) : '—'}</dd>
              <dt>{t('aiset.previewUses')}</dt><dd>{d.previewUses}</dd>
              <dt>{t('aiset.version')}</dt><dd>{d.version}</dd>
              <dt>{t('aiset.tags')}</dt><dd data-testid="ais-tags">{tagText !== null ? (
                <span className="ais-actions"><input value={tagText} maxLength={330} onChange={(e) => setTagText(e.target.value)} placeholder={t('aiset.tagsPh')} data-testid="ais-tags-input" />
                  <button className="btn" disabled={busy} onClick={saveTags} data-testid="ais-tags-save">{t('aiset.save')}</button><button className="btn ghost" onClick={() => setTagText(null)}>{t('aiset.cancel')}</button></span>
              ) : <>{(d.tags ?? []).length ? d.tags.map((g: string) => <span key={g} className="ais-chip">#{g}</span>) : '—'}{canManage ? <button className="btn ghost" onClick={() => setTagText((d.tags ?? []).join(', '))} data-testid="ais-tags-edit">{t('aiset.editTags')}</button> : null}</>}</dd>
            </dl>
          ) : tab === 'preview' ? (
            <div data-testid="ais-faq-preview">
              <div className="sub">{t('aiset.previewThisNote')}</div>
              <button className="btn" onClick={runPreview} data-testid="ais-faq-preview-run">{t('aiset.previewThis')}</button>
              {pv?.loading ? <div className="state">{t('aiset.loading')}</div> : pv?.error ? <div className="err">{pv.error}</div> : pv ? (
                <div className="ais-live" data-testid="ais-faq-preview-answer">{pv.answer}<div className="sub">{(pv.sources ?? []).map((x: any) => x.label).join(' · ')}</div>
                  {(pv.sources ?? []).some((x: any) => x.id === d.id) ? <div className="sub">{t('aiset.previewUsedThis')}</div> : <div className="sub">{t('aiset.previewNotThis')}</div>}</div>) : null}
            </div>
          ) : tab === 'answer' ? (
            <div className="ais-answer">
              <h3>{t('aiset.liveAnswer')}</h3>
              {d.approvedRevision ? <div className="ais-live" data-testid="ais-live">{d.approvedRevision.answer}</div> : <div className="sub">{t('aiset.noLive')}</div>}
              {d.draftAnswer || d.status !== 'approved' ? <><h3>{t('aiset.pendingText')}</h3><div className="ais-draft" data-testid="ais-draft">{d.draftAnswer ?? d.answer}</div></> : null}
            </div>
          ) : tab === 'history' ? (
            <ol className="ais-revs">{d.revisions.map((r: any) => <li key={r.id}><b>{t('aiset.revision', { n: r.revisionNo })}</b>{r.isApproved ? <span className="ais-chip ais-ok">{t('aiset.live')}</span> : null}{r.isPendingDraft ? <span className="ais-chip ais-warn">{t('aiset.pending')}</span> : null}
              <div>{r.question}</div><div className="sub">{r.answer}</div><div className="ais-source">{fmtInZone(r.createdAt)}{r.reason ? ` · ${r.reason}` : ''}</div></li>)}</ol>
          ) : (
            <ol className="ais-revs">{d.events.map((e: any) => <li key={e.id}><b>{t(`aiset.ev.${e.action}`)}</b> · {e.actor}<div className="ais-source">{fmtInZone(e.createdAt)}{e.fromStatus ? ` · ${t(`aiset.faq.${e.fromStatus}`)} → ${t(`aiset.faq.${e.toStatus}`)}` : ''}{e.reason ? ` · ${e.reason}` : ''}</div></li>)}</ol>
          )}
        </>
      )}
    </FitDialog>
  );
}

function HealthDialog({ onClose, onGo }: { onClose: () => void; onGo: (r: string) => void }) {
  const [h, setH] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); setH(null); posAiBusinessSetupApi.healthRun().then(setH).catch((e) => setErr(errorTextOf(e, tx('pos.something_went_wrong')))); }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <FitDialog title={t('aiset.checkSetup')} subtitle={h ? <StatusBadge s={h.overall} /> : null} onClose={onClose} wide testId="ais-health" footer={<div className="ais-actions"><button className="btn ghost" onClick={load}>{t('aiset.runAgain')}</button><button className="btn ghost" onClick={onClose}>{t('aiset.close')}</button></div>}>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !h ? <div className="state">{t('aiset.checking')}</div> : (
        <>
          <div className="sub ais-note">{t('aiset.healthNote')}</div>
          {h.checks.map((c: any) => <ReadinessRow key={c.key} c={c} onGo={onGo} onRetry={load} />)}
        </>
      )}
    </FitDialog>
  );
}

function PreviewDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState(''); const [r, setR] = useState<any>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const ask = async (question: string) => { setBusy(true); setErr(null); setQ(question); try { setR(await posAiBusinessSetupApi.preview(question)); } catch (e) { setErr(errorTextOf(e, tx('pos.something_went_wrong'))); } finally { setBusy(false); } };
  return (
    <FitDialog title={t('aiset.preview')} subtitle={t('aiset.previewSub')} onClose={onClose} wide busy={busy} testId="ais-preview-dialog" footer={<button className="btn ghost" onClick={onClose}>{t('aiset.close')}</button>}>
      <div className="ais-samples">{SAMPLE_KEYS.map((k) => { const s = t('aiset.sample.' + k); return <button key={k} className="btn ghost" onClick={() => ask(s)}>{s}</button>; })}</div>
      <div className="ais-ask"><input value={q} maxLength={300} placeholder={t('aiset.previewPh')} onChange={(e) => setQ(e.target.value)} data-testid="ais-preview-q" /><button className="btn" disabled={busy || !q.trim()} onClick={() => ask(q)} data-testid="ais-preview-ask">{t('aiset.ask')}</button></div>
      {err ? <div className="err" role="alert">{err}</div> : null}
      {r ? (
        <div className="ais-result" data-testid="ais-preview-result">
          <div className="ais-faq-top"><span className="ais-chip ais-warn">{t('aiset.previewLabel')}</span><span className="ais-chip">{t(`aiset.outcome.${r.outcome}`)}</span></div>
          <p className="ais-answer-text">{r.answer}</p>
          <h3>{t('aiset.sourcesUsed')}</h3>
          {r.sources.length ? <ul>{r.sources.map((s: any, i: number) => <li key={i}>{t(`aiset.src.${s.type}`)} — {s.label}{s.revisionId ? ` (${t('aiset.approvedRevision')})` : ''}</li>)}</ul> : <div className="sub">{t('aiset.noSources')}</div>}
          <div className="sub">{t('aiset.previewLimits')}</div>
        </div>
      ) : null}
    </FitDialog>
  );
}

function AssistantDialog({ onClose, onGo, onDraft, onOpenFaq }: { onClose: () => void; onGo: (r: string) => void; onDraft: (q: string) => void; onOpenFaq: (id: string) => void }) {
  const [a, setA] = useState<any>(null); const [err, setErr] = useState<string | null>(null); const can = useCan();
  const load = useCallback(() => { setErr(null); posAiBusinessSetupApi.assistant().then(setA).catch((e) => setErr(errorTextOf(e, tx('pos.something_went_wrong')))); }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <FitDialog title={t('aiset.assistant')} subtitle={t('aiset.assistantSub')} onClose={onClose} wide testId="ais-assistant-dialog" footer={<button className="btn ghost" onClick={onClose}>{t('aiset.close')}</button>}>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !a ? <div className="state">{t('aiset.loading')}</div> : !a.suggestions.length ? <Empty title={t('aiset.noSuggestions')} /> : (
        <div className="ais-faqs">{a.suggestions.map((s: any) => (
          <div key={s.key} className="ais-faq ais-static" data-testid="ais-suggestion">
            <div className="ais-faq-top"><span className="ais-chip">{t(`aiset.kind.${s.kind}`)}</span>{s.affected ? <b>{s.affected.name}</b> : null}</div>
            <div><b>{t('aiset.why')}</b> {s.why}</div><div><b>{t('aiset.impact')}</b> {s.impact}</div><div className="sub">{s.suggestion}</div>
            {s.action.draftQuestion ? (can('ai.manage') ? <button className="btn ghost" onClick={() => onDraft(s.action.draftQuestion)}>{t('aiset.draftThis')}</button> : null)
              : s.action.route ? <button className="btn ghost" onClick={() => onGo(s.action.route)}>{t('aiset.openEditor')}</button>
              : s.affected?.type === 'faq' ? <button className="btn ghost" onClick={() => onOpenFaq(s.affected.id)}>{t('aiset.openFaq')}</button> : null}
          </div>))}</div>
      )}
      <div className="sub ais-note">{t('aiset.assistantNote')}</div>
    </FitDialog>
  );
}

// ── A12 Nov 6: holiday closures / special hours (today → +60 days). The AI tells callers about them; removing one archives it.
function ClosuresPanel({ canManage }: { canManage: boolean }) {
  const [l, setL] = useState<any>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ date: '', closed: true, opensAt: '10:00', closesAt: '15:00', note: '', scope: 'salon' as 'salon' | 'branch' });
  const load = useCallback(() => { setErr(null); posAiBusinessSetupApi.closures().then(setL).catch((e) => setErr(errorTextOf(e, tx('pos.something_went_wrong')))); }, []);
  useEffect(() => { load(); }, [load]);
  const add = async () => {
    setBusy(true); setErr(null);
    try { await posAiBusinessSetupApi.addClosure({ date: f.date, closed: f.closed, ...(f.closed ? {} : { opensAt: f.opensAt, closesAt: f.closesAt }), note: f.note.trim() || undefined, scope: f.scope }); setF({ ...f, date: '', note: '' }); load(); }
    catch (e) { setErr(errorTextOf(e, tx('pos.something_went_wrong'))); } finally { setBusy(false); }
  };
  const remove = async (id: string) => { setBusy(true); try { await posAiBusinessSetupApi.removeClosure(id); load(); } catch (e) { setErr(errorTextOf(e, tx('pos.something_went_wrong'))); } finally { setBusy(false); } };
  return (
    <section className="panel ais-card" data-testid="ais-closures">
      <h2>{t('aiset.closures')}</h2>
      <div className="sub">{t('aiset.closuresNote')}</div>
      {err ? <div className="err" role="alert">{err}</div> : null}
      {!l ? <div className="state">{t('aiset.loading')}</div> : !l.items.length ? <div className="sub" data-testid="ais-closures-none">{t('aiset.noClosures')}</div> : (
        <table className="tbl"><tbody>{l.items.map((c: any) => (
          <tr key={c.id} data-testid="ais-closure-row"><td>{c.date}</td><td>{c.closed ? t('aiset.closedDay') : t('aiset.specialHours', { o: c.opensAt, c: c.closesAt })}</td>
            <td>{c.scope === 'branch' ? t('aiset.thisBranch') : t('aiset.allBranches')}</td><td>{c.note ?? ''}</td>
            <td>{canManage ? <button className="btn ghost" disabled={busy} onClick={() => remove(c.id)} data-testid="ais-closure-remove">{t('aiset.remove')}</button> : null}</td></tr>))}</tbody></table>)}
      {canManage ? (
        <div className="ais-actions" style={{ flexWrap: 'wrap' }} data-testid="ais-closure-form">
          <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} aria-label={t('aiset.date')} data-testid="ais-closure-date" />
          <select value={f.closed ? 'closed' : 'special'} onChange={(e) => setF({ ...f, closed: e.target.value === 'closed' })} aria-label={t('aiset.closureKind')} data-testid="ais-closure-kind">
            <option value="closed">{t('aiset.closedDay')}</option><option value="special">{t('aiset.specialHoursShort')}</option></select>
          {!f.closed ? <><input type="time" value={f.opensAt} onChange={(e) => setF({ ...f, opensAt: e.target.value })} aria-label={t('aiset.opens')} /><input type="time" value={f.closesAt} onChange={(e) => setF({ ...f, closesAt: e.target.value })} aria-label={t('aiset.closes')} /></> : null}
          <select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value as 'salon' | 'branch' })} aria-label={t('aiset.scopeLabel')}><option value="salon">{t('aiset.allBranches')}</option><option value="branch">{t('aiset.thisBranch')}</option></select>
          <input value={f.note} maxLength={200} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={t('aiset.closureNotePh')} aria-label={t('aiset.closureNotePh')} />
          <button className="btn" disabled={busy || !f.date} onClick={add} data-testid="ais-closure-add">{t('aiset.addClosure')}</button>
        </div>) : null}
    </section>
  );
}
