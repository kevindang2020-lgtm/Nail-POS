// POSCustomerNotesScreen.tsx — Customers → Customer Notes (/tenant/customers/notes). Customer Notes SUNMI guide (Nov 9 2026).
//
// The original page (search a customer, then edit their notes: warnings, allergies, salon notes, style, service + technician
// preferences, "visible to the customer") stays — the search is in the header and the editor opens as a dialog, saving through
// the same PATCH /pos/customers/:id/notes (offline → a DRAFT on this device, Decision 33).
// Around it, the guide's workspace (read from /pos/customer-notes/*, which owns no note text):
//   • four cards — customers with notes · safety warnings · preferences recorded · needs review
//   • search (customer name · phone · note words) · category · review state · which date (updated / reviewed) + presets / From–To
//   • the notes table, newest first, pages 10/25/50/100 — one row per customer and category, a visit note per ticket
//   • a note's details: every category, the review history, and Review & Accuracy for safety notes (confirm the text you read,
//     or mark it for correction with a reason — an edit puts it back into "needs review")
//   • Check Customer Notes System (read-only)
import { useCallback, useEffect, useRef, useState } from 'react';
import { posCustomersApi } from '../api/posCustomersApi';
import { posCustomerNotesApi, type CustomerNotesQuery } from '../api/posCustomerNotesApi';
import type { CnListResponse, CnSummaryResponse, CnDetailResponse, CnCheckResponse } from '@aipowersalon/api-contracts/tenant';
import { reportError } from './reportsCommon';
import { saveDraft, isOfflineFailure } from '../api/offline-drafts';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry } from '../components/FitKit';
import { RangeCalendar, isForbidden } from '../components/FinanceKit';
import { errorTextOf } from '../i18n/error-text';
import { fmtNumber, fmtInZone } from '../i18n/format';
import { deviceToday } from '../lib/deviceToday';

const t = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
type CustomerItem = { customerId: string; fullName: string; phone: string; visitsCount: number };
type Notes = { salonNotes: string; allergyNotes: string; preferredStyle: string; preferredTechnician: string; servicePreferences: string; warnings: string; customerVisible: boolean };
const EMPTY: Notes = { salonNotes: '', allergyNotes: '', preferredStyle: '', preferredTechnician: '', servicePreferences: '', warnings: '', customerVisible: false };
const CATEGORIES = ['general', 'service_preference', 'technician_preference', 'allergy', 'warning', 'visit'] as const;
const REVIEWS = ['needs_review', 'reviewed', 'needs_correction', 'not_required'] as const;
const REVIEW_TONE: Record<string, string> = { needs_review: 'warn', reviewed: 'ok', needs_correction: 'bad', not_required: '' };
const CAT_TONE: Record<string, string> = { allergy: 'bad', warning: 'bad', visit: '', general: '', service_preference: 'ok', technician_preference: 'ok' };
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const errText = (e: unknown, fallback: string) => {
  const code = (e as { code?: string; body?: { code?: string }; details?: { code?: string } } | null);
  const c = code?.body?.code ?? code?.details?.code ?? code?.code;
  if (c && ['CUSTOMER_NOTES_CHANGED', 'CUSTOMER_NOTES_REASON_REQUIRED', 'CUSTOMER_NOTES_INVALID_PERIOD', 'CUSTOMER_NOTES_SEARCH_TOO_SHORT', 'CUSTOMER_NOTES_NOT_FOUND'].includes(c)) return t('cnx.err.' + c);
  if (isForbidden(e)) return t('cnx.err.forbidden');
  return errorTextOf(e, fallback);
};

// extras (Nov 11 2026) — structured nail-service quick notes: chips write "Shape: Almond" style lines into Preferred style;
// one line per group (a new pick replaces the old one), free text stays as typed
const QUICK: { group: string; values: string[] }[] = [
  { group: 'shape', values: ['square', 'round', 'oval', 'squoval', 'almond', 'coffin', 'stiletto'] },
  { group: 'length', values: ['short', 'medium', 'long'] },
  { group: 'finish', values: ['gel', 'dip', 'acrylic', 'regular', 'builder'] },
];
export function applyQuickNote(text: string, groupLabel: string, valueLabel: string): string {
  const lines = String(text ?? '').split('\n').filter((l) => !l.toLowerCase().startsWith(groupLabel.toLowerCase() + ':'));
  const kept = lines.filter((l, i) => l.trim() || i < lines.length - 1);
  return [`${groupLabel}: ${valueLabel}`, ...kept].join('\n').replace(/\n+$/, '');
}

/** extras (Customer Notes 6 · 02): stale / conflicting preference detection — two different values of one nail-service group
 *  (shape, length, finish) named in the preference fields (e.g. "Almond" in Preferred style but "Square" in Service preferences)
 *  is flagged for a person to review, with where each came from. Nothing is changed or chosen automatically. */
export function noteConflicts(n: Pick<Notes, 'preferredStyle' | 'servicePreferences'>, label: (k: string) => string): { group: string; hits: { value: string; field: 'preferredStyle' | 'servicePreferences' }[] }[] {
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const out: { group: string; hits: { value: string; field: 'preferredStyle' | 'servicePreferences' }[] }[] = [];
  for (const g of QUICK) {
    const hits: { value: string; field: 'preferredStyle' | 'servicePreferences' }[] = [];
    for (const field of ['preferredStyle', 'servicePreferences'] as const) {
      const text = String(n[field] ?? '');
      for (const v of g.values) {
        const word = label('cnx.q.' + g.group + '.' + v);
        if (new RegExp(`(^|[^\\p{L}])${esc(word)}([^\\p{L}]|$)`, 'iu').test(text) && !hits.some((h) => h.value === word && h.field === field)) hits.push({ value: word, field });
      }
    }
    if (new Set(hits.map((h) => h.value.toLowerCase())).size > 1) out.push({ group: label('cnx.q.' + g.group), hits });
  }
  return out;
}
/** the original notes editor — same fields, same save (and offline draft) */
function NotesEditor({ customer, onClose, onSaved }: { customer: { customerId: string; fullName: string; phone?: string | null }; onClose: () => void; onSaved: () => void }) {
  const [notes, setNotes] = useState<Notes | null>(null);
  const [base, setBase] = useState<Notes | null>(null);   // Decision 33: the notes as loaded — an offline draft is checked against them
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    posCustomersApi.getNotes(customer.customerId).then((n) => { setNotes({ ...EMPTY, ...(n || {}) }); setBase({ ...EMPTY, ...(n || {}) }); }).catch((e) => setError(reportError(e, 'these notes')));
  }, [customer.customerId]);
  const up = (k: keyof Notes) => (v: string) => setNotes((n) => (n ? { ...n, [k]: v } : n));
  // extras (Nov 11 2026) — safe draft recovery: closing with unsaved edits asks first (never auto-saves, never auto-submits)
  const dirty = !!notes && !!base && JSON.stringify(notes) !== JSON.stringify(base);
  const [askClose, setAskClose] = useState(false);
  const tryClose = () => { if (dirty && !saving) setAskClose(true); else onClose(); };
  // extras (Customer Profiles 06) — version check before a save: the notes are read again and compared with what this
  // editor loaded; when someone else changed them meanwhile, nothing is written until the user picks "Load theirs" (their
  // version replaces the form) or "Save mine anyway" (a confirmed overwrite). A failed re-read never blocks the save.
  const [conflict, setConflict] = useState<Notes | null>(null);
  const save = async (force = false) => {
    if (!notes) return;
    setSaving(true); setNote(null);
    if (!force && base) {
      const current = await posCustomersApi.getNotes(customer.customerId).then((n) => ({ ...EMPTY, ...(n || {}) }) as Notes, () => null);
      if (current && JSON.stringify(current) !== JSON.stringify(base)) { setConflict(current); setSaving(false); return; }
    }
    setConflict(null);
    try { const saved = await posCustomersApi.setNotes(customer.customerId, notes as any); setNotes({ ...EMPTY, ...(saved || notes) }); setBase({ ...EMPTY, ...(saved || notes) }); setNote({ ok: true, text: t('cnx.saved') }); onSaved(); }
    catch (e: any) {
      if (isOfflineFailure(e) && saveDraft({ kind: 'customer_notes', targetId: customer.customerId, label: customer.fullName, payload: notes as any, base: (base ?? EMPTY) as any })) setNote({ ok: true, text: t('pos.you_re_offline_these_notes_are_1uh7') });
      else setNote({ ok: false, text: e?.message || t('pos.could_not_save_notes_you_may_1din') });
    } finally { setSaving(false); }
  };
  const field = (label: string, k: keyof Notes, rows = 2, hint?: string) => (
    <label className="cnx-field"><span><b>{label}</b>{hint ? <span className="sub"> — {hint}</span> : null}</span>
      <textarea value={String(notes?.[k] ?? '')} onChange={(e) => up(k)(e.target.value)} rows={rows} data-testid={`cnx-ed-${k}`} /></label>
  );
  return (
    <FitDialog wide testId="cnx-editor" title={customer.fullName || t('pos.unnamed_customer')} subtitle={customer.phone || undefined} onClose={tryClose} busy={saving}
      footer={askClose ? <><span className="err" role="alert" data-testid="cnx-ed-unsaved">{t('cnx.unsaved')}</span>
        <button className="btn ghost" data-testid="cnx-ed-keep" onClick={() => setAskClose(false)}>{t('cnx.keepEditing')}</button>
        <button className="btn danger" data-testid="cnx-ed-discard" onClick={onClose}>{t('cnx.discard')}</button></> : <>{note ? <span className={note.ok ? 'ok' : 'err'} role="status" data-testid="cnx-ed-note">{note.text}</span> : null}
        <button className="btn ghost" data-testid="cnx-ed-close" onClick={tryClose}>{t('pos.close')}</button>
        <button className="btn" data-testid="cnx-ed-save" disabled={!notes || saving} onClick={() => save()}>{saving ? t('pos.saving_2') : t('pos.save_notes')}</button></>}>
      {error ? <div className="err">{error}</div> : !notes ? <div className="state">{t('pos.loading_notes')}</div> : <>
        {conflict ? <div className="err" role="alert" data-testid="cnx-ed-conflict">{t('cnx.conflict')}
          <button className="btn ghost" data-testid="cnx-ed-load-theirs" onClick={() => { setNotes(conflict); setBase(conflict); setConflict(null); }}>{t('cnx.loadTheirs')}</button>
          <button className="btn danger" data-testid="cnx-ed-save-anyway" disabled={saving} onClick={() => save(true)}>{t('cnx.saveAnyway')}</button></div> : null}
        {field(t('pos.warnings'), 'warnings', 2, t('people.customer.notes.warningsHint'))}
        {field(t('pos.allergies'), 'allergyNotes', 2)}
        {field(t('pos.salon_notes'), 'salonNotes', 3)}
        <div className="cnx-quick" data-testid="cnx-quick" style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '2px 0 6px' }}>
          {QUICK.map((g) => (
            <div key={g.group} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
              <span className="sub" style={{ minWidth: 64 }}>{t('cnx.q.' + g.group)}</span>
              {g.values.map((v) => (
                <button key={v} type="button" className="chip" style={{ minHeight: 36 }} data-testid={'cnx-q-' + g.group + '-' + v}
                  onClick={() => setNotes((n) => (n ? { ...n, preferredStyle: applyQuickNote(String(n.preferredStyle ?? ''), t('cnx.q.' + g.group), t('cnx.q.' + g.group + '.' + v)) } : n))}>
                  {t('cnx.q.' + g.group + '.' + v)}</button>
              ))}
            </div>
          ))}
        </div>
        {(() => { const cs = noteConflicts(notes, (k) => t(k)); return cs.length ? <div className="fk-note warn" role="status" data-testid="cnx-pref-conflict">
          <b>{t('cnx.pc.title')}</b>{cs.map((c) => <div key={c.group} data-testid="cnx-pref-conflict-row">{c.group}: {c.hits.map((h) => `${h.value} (${h.field === 'preferredStyle' ? t('pos.preferred_style') : t('people.customer.notes.servicePreferencesTitle')})`).join(' · ')}</div>)}
          <div className="sub">{t('cnx.pc.note')}</div></div> : null; })()}
        <div className="cnx-two">{field(t('pos.preferred_style'), 'preferredStyle', 2)}{field(t('people.customer.notes.servicePreferencesTitle'), 'servicePreferences', 2)}</div>
        {field(t('people.customer.notes.preferredTechnicianTitle'), 'preferredTechnician', 1)}
        <label className="cnx-visible"><input type="checkbox" checked={notes.customerVisible} onChange={(e) => setNotes({ ...notes, customerVisible: e.target.checked })} data-testid="cnx-ed-visible" />
          <span><b>{t('pos.visible_to_the_customer')}</b><div className="sub">{t('pos.if_checked_the_customer_can_view_ynoe')}</div></span></label>
        <p className="sub">{t('cnx.safetyEditNote')}</p>
      </>}
    </FitDialog>
  );
}

const NOTES_QUERY_KEY = 'aps.cnx.query';
const NOTES_QUERY_DEFAULT: CustomerNotesQuery = { page: 1, pageSize: 25, sort: 'newest' };
export function readNotesQuery(): CustomerNotesQuery {
  try { const raw = sessionStorage.getItem(NOTES_QUERY_KEY); if (raw) { const v = JSON.parse(raw); if (v && typeof v === 'object') return { ...NOTES_QUERY_DEFAULT, ...v }; } } catch { /* unavailable storage → defaults */ }
  return { ...NOTES_QUERY_DEFAULT };
}
function writeNotesQuery(q: CustomerNotesQuery) { try { sessionStorage.setItem(NOTES_QUERY_KEY, JSON.stringify(q)); } catch { /* best effort */ } }

export function POSCustomerNotesScreen() {
  // ── the original customer search (header) ──
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CustomerItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [findErr, setFindErr] = useState<string | null>(null);
  const [searchedFor, setSearchedFor] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!query.trim()) { setResults([]); return; }
    timer.current = setTimeout(() => {
      setSearching(true);
      setFindErr(null);
      posCustomersApi.quickSearch(query).then((r) => { setResults((r?.items || []) as CustomerItem[]); setSearchedFor(query); }).catch((e) => { setResults([]); setFindErr(reportError(e, 'customers')); }).finally(() => setSearching(false));
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query]);
  const [editing, setEditing] = useState<{ customerId: string; fullName: string; phone?: string | null } | null>(null);

  // ── the workspace ──
  const [sum, setSum] = useState<CnSummaryResponse | null>(null); const [sumErr, setSumErr] = useState<string | null>(null);
  // Persistent search state: the list query (search, filters, sort, page) survives leaving the screen and coming back in
  // this browser tab (sessionStorage — per device, cleared with the tab; storage failures fall back to the defaults)
  const [f, setFState] = useState<CustomerNotesQuery>(() => readNotesQuery());
  const [draft, setDraft] = useState(() => f.q ?? '');
  useEffect(() => { writeNotesQuery(f); }, [f]);
  const [list, setList] = useState<CnListResponse | null>(null); const [listErr, setListErr] = useState<string | null>(null);
  const [cal, setCal] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [health, setHealth] = useState<CnCheckResponse | 'loading' | { error: string } | null>(null);
  const seq = useRef(0);
  const setF = (p: Partial<CustomerNotesQuery>, keepPage = false) => setFState((cur) => ({ ...cur, ...p, page: keepPage ? (p.page ?? cur.page) : 1 }));
  const loadSum = useCallback(() => { setSumErr(null); posCustomerNotesApi.summary().then(setSum).catch((e) => setSumErr(errText(e, t('cnx.loadFailed')))); }, []);
  const loadList = useCallback(() => {
    const my = ++seq.current; setListErr(null);
    posCustomerNotesApi.list(f).then((d) => { if (my === seq.current) setList(d); }).catch((e) => { if (my === seq.current) setListErr(errText(e, t('cnx.loadFailed'))); });
  }, [f]);
  useEffect(loadSum, [loadSum]);
  useEffect(loadList, [loadList]);
  const refresh = () => { loadSum(); loadList(); };
  const runCheck = () => { setHealth('loading'); posCustomerNotesApi.check().then(setHealth).catch((e) => setHealth({ error: errText(e, t('cnx.loadFailed')) })); };
  const c = sum?.cards;
  const anyFilter = !!(f.q || f.category || f.review || f.preset);

  return (
    <div className="work" data-testid="cnx-screen">
      <div className="vh cnx-head">
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <h1>{t('pos.customer_notes')}</h1>
          <div className="sub">{t('pos.allergies_warnings_and_preferences_handle_with_1g67')}</div>
        </div>
        <div className="cnx-find">
          <input type="search" className="rvw-search" data-testid="cnx-find" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('pos.search_by_name_phone_or_email_2')} aria-label={t('cnx.findLabel')} />
          {searching ? <span className="sub">{t('pos.searching')}</span> : null}
          {results.length ? <div className="cnx-find-list" role="listbox" data-testid="cnx-find-list">
            {results.map((r) => <button key={r.customerId} type="button" role="option" aria-selected={false} className="cnx-find-item" data-testid="cnx-find-item"
              onClick={() => { setEditing({ customerId: r.customerId, fullName: r.fullName, phone: r.phone }); setQuery(''); setResults([]); }}>
              <b>{r.fullName || t('pos.unnamed_customer')}</b><span className="sub">{r.phone || t('pos.no_phone_on_file')}</span></button>)}
          </div> : findErr ? <div className="cnx-find-list err" role="alert" data-testid="cnx-find-err">{findErr}</div>
            : query.trim() && !searching && searchedFor === query ? <div className="cnx-find-list sub">{t('pos.no_profiles_found')}</div> : null}
        </div>
        <button className="btn ghost" data-testid="cnx-check" onClick={runCheck}>{t('cnx.check')}</button>
        <button className="btn ghost" data-testid="cnx-refresh" onClick={refresh}>{t('cnx.refresh')}</button>
      </div>

      {sumErr ? <ErrorRetry message={sumErr} onRetry={loadSum} /> : null}
      <div className="rvw-kpis cnx-kpis" data-testid="cnx-kpis">
        <KpiCard testId="cnx-kpi-customers" label={t('cnx.kpi.customers')} value={c ? fmtNumber(c.customersWithNotes) : '—'} loading={!sum && !sumErr} sub={t('cnx.kpi.customersSub')} onClick={() => setF({ category: undefined, review: undefined })} />
        <KpiCard testId="cnx-kpi-warnings" label={t('cnx.kpi.warnings')} value={c ? fmtNumber(c.safetyWarnings) : '—'} loading={!sum && !sumErr} tone={c?.safetyWarnings ? 'bad' : undefined} sub={t('cnx.kpi.warningsSub')} onClick={() => setF({ category: 'warning', review: undefined })} />
        <KpiCard testId="cnx-kpi-preferences" label={t('cnx.kpi.preferences')} value={c ? fmtNumber(c.preferencesRecorded) : '—'} loading={!sum && !sumErr} tone="ok" sub={t('cnx.kpi.preferencesSub')} onClick={() => setF({ category: 'service_preference', review: undefined })} />
        <KpiCard testId="cnx-kpi-review" label={t('cnx.kpi.review')} value={c ? fmtNumber(c.needsReview) : '—'} loading={!sum && !sumErr} tone={c?.needsReview ? 'warn' : 'ok'}
          sub={sum?.needsCorrection ? t('cnx.kpi.reviewSubCorr', { n: fmtNumber(sum.needsCorrection) }) : t('cnx.kpi.reviewSub')} onClick={() => setF({ review: 'needs_review', category: undefined })} />
      </div>

      <section className="panel rvw-filters" data-testid="cnx-filters">
        <form className="cnx-searchrow" onSubmit={(e) => { e.preventDefault(); setF({ q: draft.trim() || undefined }); }}>
          <input className="rvw-search" type="search" data-testid="cnx-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('cnx.searchPh')} aria-label={t('cnx.searchPh')} />
          <button className="btn" type="submit" data-testid="cnx-search-btn">{t('cnx.search')}</button>
        </form>
        <label className="rvw-f"><span>{t('cnx.f.category')}</span>
          <select data-testid="cnx-category" value={f.category ?? ''} onChange={(e) => setF({ category: e.target.value || undefined })}>
            <option value="">{t('cnx.cat.all')}</option>{CATEGORIES.map((k) => <option key={k} value={k}>{t('cnx.cat.' + k)}</option>)}</select></label>
        <label className="rvw-f"><span>{t('cnx.f.review')}</span>
          <select data-testid="cnx-review" value={f.review ?? ''} onChange={(e) => setF({ review: e.target.value || undefined })}>
            <option value="">{t('cnx.rv.all')}</option>{REVIEWS.map((k) => <option key={k} value={k}>{t('cnx.rv.' + k)}</option>)}</select></label>
        <label className="rvw-f"><span>{t('cnx.f.sort')}</span>
          <select data-testid="cnx-sort" value={f.sort ?? 'newest'} onChange={(e) => setF({ sort: e.target.value })}>
            {['newest', 'oldest', 'name'].map((k) => <option key={k} value={k}>{t('cnx.sort.' + k)}</option>)}</select></label>
        <div className="rvw-dates" data-testid="cnx-dates">
          <label className="rvw-f"><span>{t('cnx.f.dateField')}</span>
            <select data-testid="cnx-datefield" value={f.dateField ?? 'updated'} onChange={(e) => setF({ dateField: e.target.value === 'updated' ? undefined : e.target.value })}>
              <option value="updated">{t('cnx.date.updated')}</option><option value="reviewed">{t('cnx.date.reviewed')}</option></select></label>
          <button className={'btn ghost' + (!f.preset ? ' on' : '')} data-testid="cnx-preset-all" onClick={() => setF({ preset: undefined, from: undefined, to: undefined })}>{t('cnx.preset.all')}</button>
          {(['today', 'week', 'month', 'year'] as const).map((p) => <button key={p} className={'btn ghost' + (f.preset === p ? ' on' : '')} data-testid={`cnx-preset-${p}`} onClick={() => setF({ preset: p, from: undefined, to: undefined })}>{t('cnx.preset.' + p)}</button>)}
          <button className={'btn ghost' + (f.preset === 'custom' ? ' on' : '')} data-testid="cnx-preset-custom" onClick={() => setCal(true)}>{f.preset === 'custom' ? `${f.from} → ${f.to}` : t('cnx.preset.custom')}</button>
        </div>
        {anyFilter ? <button className="btn ghost" data-testid="cnx-clear" onClick={() => { setDraft(''); setFState({ page: 1, pageSize: f.pageSize, sort: 'newest' }); }}>{t('cnx.clear')}</button> : null}
        {cal ? <div className="rvw-cal" data-testid="cnx-cal"><RangeCalendar initial={{ from: f.from, to: f.to }} today={list?.period.today ?? deviceToday()}
          onApply={(r) => { setF({ preset: 'custom', from: r.from, to: r.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { setF({ preset: undefined, from: undefined, to: undefined }); setCal(false); }} /></div> : null}
      </section>

      <section className="panel rvw-feed" data-testid="cnx-results">
        <div className="p-h">{t('cnx.list')}<span className="sub rvw-scope" data-testid="cnx-count">{list ? t('cnx.count', { n: fmtNumber(list.total) }) : ''}</span></div>
        {listErr ? <ErrorRetry message={listErr} onRetry={loadList} />
          : !list ? <div className="state">{t('cnx.loading')}</div>
          : list.items.length === 0 ? <Empty title={anyFilter ? t('cnx.noMatch') : t('cnx.empty')} />
          : <div className="rvw-table-wrap"><table className="tbl rvw-table cnx-table">
            <thead><tr><th>{t('cnx.col.customer')}</th><th>{t('cnx.col.category')}</th><th>{t('cnx.col.note')}</th><th>{t('cnx.col.review')}</th><th>{t('cnx.col.updated')}</th><th /></tr></thead>
            <tbody>{list.items.map((r) => (
              <tr key={`${r.customerId}:${r.category}:${r.ticketId ?? ''}`} data-testid="cnx-row">
                <td><b>{r.customer ?? t('pos.unnamed_customer')}</b>{r.phone ? <div className="sub">{r.phone}</div> : null}</td>
                <td><span className={'chip ' + (CAT_TONE[r.category] ?? '')}>{t('cnx.cat.' + r.category)}</span>{r.ticketId ? <div className="sub">{t('cnx.visitTicket')}</div> : null}</td>
                <td className="cnx-preview">{r.preview.text}{r.preview.truncated ? '…' : ''}</td>
                <td><span className={'chip ' + (REVIEW_TONE[r.review] ?? '')} data-testid="cnx-row-review">{t('cnx.rv.' + r.review)}</span>{r.reviewedAt ? <div className="sub">{when(r.reviewedAt)}</div> : null}</td>
                <td className="sub">{when(r.at)}</td>
                <td className="nowrap cnx-acts"><button className="btn ghost sm" data-testid="cnx-view" onClick={() => setOpen(r.customerId)}>{t('cnx.view')}</button>{' '}
                  <button className="btn ghost sm" data-testid="cnx-edit" onClick={() => setEditing({ customerId: r.customerId, fullName: r.customer ?? '', phone: r.phone })}>{t('cnx.edit')}</button></td>
              </tr>))}</tbody></table></div>}
        <div className="rvw-pager">
          <Pager info={list ? { page: list.page, pageSize: list.pageSize, totalItems: list.total, totalPages: list.totalPages } : null} onPage={(p) => setF({ page: p }, true)} />
          <label className="rvw-f"><span>{t('cnx.rows')}</span><select data-testid="cnx-pagesize" value={String(f.pageSize ?? 25)} onChange={(e) => setF({ pageSize: Number(e.target.value) })}>
            {['10', '25', '50', '100'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
        </div>
        <p className="sub">{t('cnx.footNote')}</p>
      </section>

      {open ? <NoteDetail customerId={open} onClose={() => setOpen(null)} onEdit={(cu) => { setOpen(null); setEditing(cu); }} onChanged={refresh} /> : null}
      {editing ? <NotesEditor customer={editing} onClose={() => setEditing(null)} onSaved={refresh} /> : null}
      {health ? <FitDialog wide testId="cnx-health" title={t('cnx.check')} onClose={() => setHealth(null)} footer={<button className="btn ghost" onClick={() => setHealth(null)}>{t('pos.close')}</button>}
        subtitle={health !== 'loading' && !('error' in health) ? t('cnx.health.overall', { s: t('cnx.health.' + health.overall), at: when(health.checkedAt) }) : undefined}>
        {health === 'loading' ? <div className="state">{t('cnx.health.running')}</div> : 'error' in health ? <div className="err">{health.error}</div> : <>
          <p className="sub">{t('cnx.health.readOnly')}</p>
          {health.checks.map((x) => <div key={x.key} className="rvw-check" data-testid={`cnx-chk-${x.key}`}>
            <div><span className={'chip ' + (x.state === 'READY' ? 'ok' : x.state === 'WARNING' ? 'warn' : 'bad')}>{t('cnx.health.' + x.state)}</span> <b>{t('cnx.health.k.' + x.key)}</b>{x.count ? <span className="sub"> · {fmtNumber(x.count)}</span> : null}</div>
            <div className="sub">{t('cnx.health.d.' + x.key + '.' + x.state)}</div></div>)}
        </>}
      </FitDialog> : null}
    </div>
  );
}

/** Customer Notes extras 04 — the review receipt under a safety note: who acknowledged it, when, the decision and WHICH
 *  version of the text (a short form of the text's own hash); an acknowledgment of an earlier text is never shown as
 *  covering the current one. Read-only (from the detail's own review history). */
function ReviewReceipt({ category, hash, history }: { category: string; hash: string; history: CnDetailResponse['history'] }) {
  const cur = history.find((h) => h.category === category && h.current);
  const older = cur ? null : history.find((h) => h.category === category);
  const ver = hash.slice(0, 8);
  return (
    <div className={'sub cnx-receipt' + (cur ? '' : ' warn')} data-testid={`cnx-receipt-${category}`}>
      {cur ? t('cnx.receipt.current', { d: t('cnx.dec.' + cur.decision), who: cur.reviewer ?? '—', at: when(cur.at), v: ver })
        : older ? t('cnx.receipt.older', { d: t('cnx.dec.' + older.decision), who: older.reviewer ?? '—', at: when(older.at), v: ver })
        : t('cnx.receipt.none', { v: ver })}
    </div>
  );
}

/** one customer's notes: every category, the safety review, the history */
function NoteDetail({ customerId, onClose, onEdit, onChanged }: { customerId: string; onClose: () => void; onEdit: (c: { customerId: string; fullName: string; phone?: string | null }) => void; onChanged: () => void }) {
  const [d, setD] = useState<CnDetailResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [correct, setCorrect] = useState<{ category: 'allergy' | 'warning'; hash: string } | null>(null);
  const [reason, setReason] = useState('');
  const [actErr, setActErr] = useState<string | null>(null);
  useEffect(() => { posCustomerNotesApi.detail(customerId).then(setD).catch((e) => setErr(errText(e, t('cnx.loadFailed')))); }, [customerId]);
  const review = (category: 'allergy' | 'warning', hash: string, decision: 'confirmed' | 'needs_correction', why?: string) => {
    setBusy(true); setActErr(null);
    posCustomerNotesApi.review({ customerId, category, contentHash: hash, decision, reason: why ?? null })
      .then((n) => { setD(n); setCorrect(null); setReason(''); onChanged(); })
      .catch((e) => { setActErr(errText(e, t('cnx.loadFailed'))); if ((e as { status?: number })?.status === 409) posCustomerNotesApi.detail(customerId).then(setD).catch(() => undefined); })
      .finally(() => setBusy(false));
  };
  return (
    <FitDialog wide testId="cnx-detail" title={d?.customer.name ?? t('cnx.detail')} subtitle={d ? `${d.customer.phone ?? ''}${d.customer.updatedAt ? ` · ${t('cnx.updatedAt', { at: when(d.customer.updatedAt) })}` : ''}` : undefined} onClose={onClose} busy={busy}
      footer={<>{d ? <button className="btn" data-testid="cnx-detail-edit" onClick={() => onEdit({ customerId, fullName: d.customer.name ?? '', phone: d.customer.phone })}>{t('cnx.editNotes')}</button> : null}
        <button className="btn ghost" data-testid="cnx-detail-close" onClick={onClose}>{t('pos.close')}</button></>}>
      {err ? <div className="err">{err}</div> : !d ? <div className="state">{t('cnx.loading')}</div> : <>
        {actErr ? <div className="err" role="alert" data-testid="cnx-act-err">{actErr}</div> : null}
        {d.entries.length === 0 ? <Empty title={t('cnx.noNotes')} /> : d.entries.map((e) => (
          <div key={`${e.category}:${e.ticketId ?? ''}`} className="panel cnx-entry" data-testid={`cnx-entry-${e.category}`}>
            <div className="cnx-entry-h"><span className={'chip ' + (CAT_TONE[e.category] ?? '')}>{t('cnx.cat.' + e.category)}</span>
              <span className={'chip ' + (REVIEW_TONE[e.review] ?? '')}>{t('cnx.rv.' + e.review)}</span><span className="sub">{when(e.at)}</span></div>
            <p className="cnx-text">{e.text}</p>
            {e.safety ? <ReviewReceipt category={e.category} hash={e.hash} history={d.history} /> : null}
            {e.safety ? (correct?.category === e.category ? <div className="cnx-correct">
                <label className="rvw-f"><span>{t('cnx.correctWhy')}</span><input value={reason} maxLength={500} onChange={(ev) => setReason(ev.target.value)} data-testid="cnx-reason" /></label>
                <button className="btn ghost" onClick={() => setCorrect(null)}>{t('pos.cancel')}</button>
                <button className="btn" data-testid="cnx-correct-go" disabled={busy || !reason.trim()} onClick={() => review(e.category as 'allergy' | 'warning', e.hash, 'needs_correction', reason.trim())}>{t('cnx.markCorrect')}</button></div>
              : <div className="cnx-review-acts">
                <button className="btn ghost" data-testid={`cnx-confirm-${e.category}`} disabled={busy || e.review === 'reviewed'} onClick={() => review(e.category as 'allergy' | 'warning', e.hash, 'confirmed')}>{t('cnx.confirm')}</button>
                <button className="btn ghost" data-testid={`cnx-needs-${e.category}`} disabled={busy} onClick={() => setCorrect({ category: e.category as 'allergy' | 'warning', hash: e.hash })}>{t('cnx.needsCorrection')}</button>
                <span className="sub">{t('cnx.reviewNote')}</span></div>) : null}
          </div>))}
        <div className="p-h" style={{ marginTop: 12 }}>{t('cnx.history')}</div>
        {d.history.length === 0 ? <div className="sub">{t('cnx.noHistory')}</div> : <ul className="fk-list dense" data-testid="cnx-history">{d.history.map((h, i) => (
          <li key={i} className="fk-li"><div className="fk-li-main"><b>{t('cnx.cat.' + h.category)}</b> · {t('cnx.dec.' + h.decision)}{h.reason ? ` — ${h.reason}` : ''}
            <div className="sub">{h.reviewer ?? '—'} · {when(h.at)}{h.current ? '' : ` · ${t('cnx.olderText')}`}</div></div></li>))}</ul>}
      </>}
    </FitDialog>
  );
}
