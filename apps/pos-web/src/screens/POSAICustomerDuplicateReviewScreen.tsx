// POSAICustomerDuplicateReviewScreen.tsx — AI Center → Customer Profile → Duplicate Review (/tenant/ai/customer-profile/duplicates).
// Duplicate Review guides (FULL + COMPLETE, Nov 1 2026). Rebuilt IN PLACE: the title, the subtitle, the candidate table
// (Customer · Phone · Email · Visits · Keep this one) and "Merge into this" stay — but "Merge into this" now only PROPOSES the
// clicked profile as the one to keep and opens the comparison; nothing changes until a separate preview and a confirmed merge.
// Added: real data freshness (last scan, rule version) instead of a static "Live", Scan now, KPIs, search (name · phone ·
// email · customer / group / appointment / ticket id), status / confidence / reason filters, a date field with presets and a
// From/To month calendar, numbered pages 10/25/50/100 (newest detected first), the side-by-side comparison with evidence and
// history, Keep Separate / Review Later / In review / notes, the read-only merge preview (rows that move, blockers, required
// acknowledgements) and the read-only Check Duplicate Review System. No browser alerts; Close / Cancel never merge.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posDuplicateReviewApi, newMergeKey, type DuplicateQuery } from '../api/posDuplicateReviewApi';
import { errorTextOf } from '../i18n/error-text';
import { fmtNumber, fmtInZone, fmtMoney } from '../i18n/format';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry } from '../components/FitKit';
import { RangeCalendar, isForbidden } from '../components/FinanceKit';
import { useCan } from '../components/usePermissions';
import { deviceToday } from '../lib/deviceToday';

const t = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const when = (iso?: string | null, withTime = false) => (iso ? fmtInZone(iso, withTime ? { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const money = (cents: number) => fmtMoney(cents);
const URL_KEYS = ['status', 'confidence', 'reason', 'dateField', 'preset', 'from', 'to', 'sort', 'page', 'pageSize'] as const;
const STATUSES = ['open', 'pending', 'in_review', 'deferred', 'kept_separate', 'merged', 'failed', 'resolved', 'all'];
const CONFIDENCES = ['exact', 'strong', 'possible'];
const REASONS = ['phone', 'email', 'name'];
const DATE_FIELDS = ['detected', 'updated', 'reviewed', 'merged', 'customer_created'];
const PRESETS = ['today', 'yesterday', 'week', 'last_7', 'month', 'last_30', 'last_month', 'year'] as const;
const SORTS = ['newest', 'oldest', 'confidence', 'members', 'updated'];
const CONF_TONE: Record<string, string> = { exact: 'ok', strong: 'ok', possible: 'warn' };
const STATE_TONE: Record<string, string> = { PASSED: 'ok', WARNING: 'warn', FAILED: 'bad', INSUFFICIENT_DATA: '', UNAVAILABLE: 'bad' };
const FRESH_TONE: Record<string, string> = { up_to_date: 'ok', stale: 'warn', failed: 'bad', never: 'warn', running: '' };
/** server codes the reviewer can act on — shown in the POS language, never the server's English */
const KNOWN_ERRORS = ['DUPLICATE_STALE_PREVIEW', 'DUPLICATE_ACK_REQUIRED', 'DUPLICATE_MERGE_BLOCKED', 'DUPLICATE_ALREADY_MERGED', 'DUPLICATE_STALE_VERSION',
  'DUPLICATE_REASON_REQUIRED', 'DUPLICATE_OUT_OF_SCOPE', 'DUPLICATE_GROUP_NOT_FOUND', 'DUPLICATE_INVALID_PERIOD', 'DUPLICATE_SEARCH_TOO_SHORT', 'DUPLICATE_SCAN_FAILED',
  'DUPLICATE_MERGE_FAILED', 'DUPLICATE_MERGE_CONFLICT', 'PERMISSION_DENIED'];
function errText(e: any, fallbackKey: string) {
  const code = e?.body?.code ?? e?.code;
  if (typeof code === 'string' && KNOWN_ERRORS.includes(code)) return t('dup.err.' + code);
  if (isForbidden(e)) return t('dup.err.PERMISSION_DENIED');
  return errorTextOf(e, t(fallbackKey));
}

export function POSAICustomerDuplicateReviewScreen() {
  const can = useCan();
  const [sp, setSp] = useSearchParams();
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const f = useMemo(() => { const o: Record<string, string> = {}; for (const k of URL_KEYS) { const v = sp.get(k); if (v) o[k] = v; } return o; }, [sp]);
  const setF = (patch: Record<string, string | null>, keepPage = false) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    if (!keepPage) next.delete('page');
    setSp(next, { replace: true });
  };
  const query: DuplicateQuery = { ...f, q: q || undefined, page: Number(f.page ?? 1), pageSize: Number(f.pageSize ?? 25) };

  const [sum, setSum] = useState<any>(null);
  const [list, setList] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [cal, setCal] = useState(false);
  const [open, setOpen] = useState<{ id: string; survivorId?: string } | null>(null);
  const [health, setHealth] = useState<any | 'loading' | null>(null);
  const [newer, setNewer] = useState(false);
  const seq = useRef(0);
  const autoScanned = useRef(false);

  const load = useCallback(async (silent = false) => {
    const mine = ++seq.current;
    if (!silent) setLoading(true);
    setErr(null);
    try {
      const [s, l] = await Promise.all([posDuplicateReviewApi.summary(), posDuplicateReviewApi.groups(query)]);
      if (mine !== seq.current) return;
      setSum(s); setList(l); setNewer(false);
      return s;
    } catch (e) { if (mine === seq.current) setErr(errText(e, 'dup.loadFailed')); }
    finally { if (mine === seq.current && !silent) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialized query: the object is rebuilt every render
  }, [JSON.stringify(query)]);

  const scan = useCallback(async () => {
    setScanning(true); setNotice(null);
    try { const r = await posDuplicateReviewApi.scan(); setNotice(r?.reused ? t('dup.scanReused') : t('dup.scanDone', { n: r?.scan?.groupsFound ?? 0 })); }
    catch (e) { setErr(errText(e, 'dup.err.DUPLICATE_SCAN_FAILED')); }
    finally { setScanning(false); await load(true); }
  }, [load]);

  useEffect(() => {
    load().then((s) => {
      // the queue is only as good as its last scan: a never-run or stale scanner runs once on open (rate-limited server-side)
      if (!autoScanned.current && s && ['never', 'stale'].includes(s.freshness?.state)) { autoScanned.current = true; void scan(); }
    });
  }, [load, scan]);
  // new candidates never move the reviewer off their case: they are announced, and shown on request
  useEffect(() => {
    const h = setInterval(() => {
      if (open || cal || !sum) return;
      posDuplicateReviewApi.summary().then((s) => { if (s?.latestDetectedAt && s.latestDetectedAt !== sum.latestDetectedAt) setNewer(true); }).catch(() => undefined);
    }, 60_000);
    return () => clearInterval(h);
  }, [sum, open, cal]);

  const k = sum?.kpis;
  const fr = sum?.freshness;
  const anyFilter = URL_KEYS.some((x) => f[x] && x !== 'page' && x !== 'pageSize') || !!q;
  const clearAll = () => { setDraft(''); setQ(''); setSp(new URLSearchParams(), { replace: true }); };
  const submit = (e?: { preventDefault: () => void }) => { e?.preventDefault(); setQ(draft.trim()); setF({}, false); };
  const sel = (key: string, label: string, options: [string, string][], testId: string, anyLabel: string) => (
    <label className="rvw-f"><span>{label}</span>
      <select data-testid={testId} value={f[key] ?? ''} onChange={(e) => setF({ [key]: e.target.value || null })}>
        <option value="">{anyLabel}</option>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select></label>
  );

  return (
    <div className="work rvw dupx" data-testid="duplicate-review-screen">
      <div className="vh rvw-head">
        <div><h1>{t('pos.duplicate_review')}</h1><div className="sub mb-3">{t('pos.possible_duplicate_customer_records_review_and_p8cc')}</div></div>
        <div className="rvw-actions">
          <span className={'chip ' + (FRESH_TONE[fr?.state] ?? '')} data-testid="dup-freshness" title={fr?.ruleVersion ? t('dup.rule', { v: fr.ruleVersion }) : undefined}>
            {scanning ? t('dup.fresh.scanning') : fr ? t('dup.fresh.' + fr.state, { at: when(fr.lastSuccessAt, true) }) : '…'}</span>
          <button className="btn ghost" data-testid="dup-scan" disabled={scanning} onClick={() => void scan()}>{t('dup.scanNow')}</button>
          <button className="btn ghost" data-testid="dup-refresh" onClick={() => load()}>{t('dup.refresh')}</button>
          <button className="btn" data-testid="dup-check" onClick={() => { setHealth('loading'); posDuplicateReviewApi.check().then(setHealth).catch((e) => setHealth({ error: errText(e, 'dup.loadFailed') })); }}>{t('dup.check')}</button>
        </div>
      </div>

      {notice ? <div className="panel" role="status" data-testid="dup-notice" style={{ padding: 12, marginBottom: 10 }}>{notice}</div> : null}

      <form className="panel rvw-filters" data-testid="dup-searchbar" onSubmit={submit}>
        <input className="rvw-search" data-testid="dup-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('dup.searchPh')} aria-label={t('dup.searchPh')} />
        <button className="btn" type="submit" data-testid="dup-search-btn">{t('pos.search')}</button>
        {q ? <button className="btn ghost" type="button" onClick={() => { setDraft(''); setQ(''); setF({}, false); }}>{t('dup.clearSearch')}</button> : null}
      </form>

      {err ? <ErrorRetry message={err} onRetry={() => load()} /> : null}

      <div className="rvw-kpis" data-testid="dup-kpis">
        <KpiCard testId="kpi-open" label={t('dup.kpi.open')} loading={loading && !k} tone="gold" value={k ? fmtNumber(k.open) : '—'} sub={t('dup.kpi.openSub')} onClick={() => setF({ status: null })} />
        <KpiCard testId="kpi-high" label={t('dup.kpi.high')} loading={loading && !k} value={k ? fmtNumber(k.highConfidence) : '—'} sub={t('dup.kpi.highSub')} onClick={() => setF({ confidence: 'strong' })} />
        <KpiCard testId="kpi-deferred" label={t('dup.kpi.deferred')} loading={loading && !k} value={k ? fmtNumber(k.deferred) : '—'} onClick={() => setF({ status: 'deferred' })} />
        <KpiCard testId="kpi-kept" label={t('dup.kpi.kept')} loading={loading && !k} value={k ? fmtNumber(k.keptSeparate) : '—'} onClick={() => setF({ status: 'kept_separate' })} />
        <KpiCard testId="kpi-merged" label={t('dup.kpi.merged')} loading={loading && !k} value={k ? fmtNumber(k.merged) : '—'} sub={k ? t('dup.kpi.mergedSub', { n: k.merged30d }) : undefined} onClick={() => setF({ status: 'merged' })} />
        <KpiCard testId="kpi-failed" label={t('dup.kpi.failed')} loading={loading && !k} tone={k?.failed ? 'bad' : undefined} value={k ? fmtNumber(k.failed) : '—'} onClick={() => setF({ status: 'failed' })} />
      </div>

      <section className="panel rvw-filters" data-testid="dup-filters">
        <label className="rvw-f"><span>{t('dup.f.status')}</span>
          <select data-testid="flt-status" value={f.status ?? 'open'} onChange={(e) => setF({ status: e.target.value === 'open' ? null : e.target.value })}>
            {STATUSES.map((s) => <option key={s} value={s}>{t('dup.status.' + s)}</option>)}
          </select></label>
        {sel('confidence', t('dup.f.confidence'), CONFIDENCES.map((c) => [c, t('dup.conf.' + c)] as [string, string]), 'flt-confidence', t('dup.any'))}
        {sel('reason', t('dup.f.reason'), REASONS.map((r) => [r, t('dup.reason.' + r)] as [string, string]), 'flt-reason', t('dup.any'))}
        <label className="rvw-f"><span>{t('dup.f.sort')}</span>
          <select data-testid="flt-sort" value={f.sort ?? 'newest'} onChange={(e) => setF({ sort: e.target.value === 'newest' ? null : e.target.value })}>
            {SORTS.map((s) => <option key={s} value={s}>{t('dup.sort.' + s)}</option>)}
          </select></label>
        <div className="rvw-dates" data-testid="dup-dates">
          <label className="rvw-f"><span>{t('dup.f.dateField')}</span>
            <select data-testid="flt-datefield" value={f.dateField ?? 'detected'} onChange={(e) => setF({ dateField: e.target.value === 'detected' ? null : e.target.value })}>
              {DATE_FIELDS.map((d) => <option key={d} value={d}>{t('dup.date.' + d)}</option>)}
            </select></label>
          <button className={'btn ghost' + (!f.preset ? ' on' : '')} data-testid="preset-all" onClick={() => setF({ preset: null, from: null, to: null })}>{t('dup.preset.all')}</button>
          {PRESETS.map((p) => <button key={p} className={'btn ghost' + (f.preset === p ? ' on' : '')} data-testid={`preset-${p}`} onClick={() => setF({ preset: p, from: null, to: null })}>{t('dup.preset.' + p)}</button>)}
          <button className={'btn ghost' + (f.preset === 'custom' ? ' on' : '')} data-testid="preset-custom" onClick={() => setCal(true)}>{f.preset === 'custom' ? `${f.from} → ${f.to}` : t('dup.preset.custom')}</button>
        </div>
        {anyFilter ? <button className="btn ghost" data-testid="flt-clear" onClick={clearAll}>{t('dup.clearAll')}</button> : null}
        {cal ? <div className="rvw-cal" data-testid="dup-cal"><RangeCalendar initial={{ from: f.from, to: f.to }} today={list?.period?.today ?? deviceToday()}
          onApply={(r) => { setF({ preset: 'custom', from: r.from, to: r.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { setF({ preset: null, from: null, to: null }); setCal(false); }} /></div> : null}
      </section>

      <section className="rvw-feed" data-testid="dup-results">
        <div className="p-h">{t('dup.candidates')}
          <span className="sub rvw-scope" data-testid="dup-count">{list ? t('dup.count', { n: fmtNumber(list.total), order: t('dup.sort.' + (list.applied?.sort ?? 'newest')) }) : ''}</span>
          {newer ? <button className="btn ghost sm" data-testid="dup-newer" onClick={() => { setF({ page: null, sort: null }); load(); }}>{t('dup.newer')}</button> : null}
        </div>
        {loading && !list ? <div className="state">{t('pos.scanning_for_duplicate_records')}</div>
          : !list ? null
          : list.items.length === 0 ? <Empty title={anyFilter ? t('dup.noMatch') : fr?.state === 'never' ? t('dup.neverScanned') : fr?.state === 'failed' ? t('dup.scanFailedEmpty') : t('pos.no_duplicate_candidates_your_customer_records_8r5c')}>
              {anyFilter ? <button className="btn ghost" onClick={clearAll}>{t('dup.clearAll')}</button> : null}</Empty>
          : list.items.map((g: any) => (
            <section className="panel dupx-group" key={g.id} data-testid="dup-group" style={{ marginTop: 12, padding: 14 }}>
              <div className="dupx-group-head">
                <strong>{t('pos.possible_duplicate')}</strong>
                <span className={'chip ' + (CONF_TONE[g.confidence] ?? '')} data-testid="dup-confidence" title={t('dup.confHint')}>{t('dup.conf.' + g.confidence)}</span>
                {g.reasons.map((r: string) => <span key={r} className="chip">{t('dup.reasonChip.' + r)}</span>)}
                {g.why.includes('name_only') ? <span className="chip warn" data-testid="dup-name-only">{t('dup.why.name_only')}</span> : null}
                {g.why.includes('shared_contact_different_names') ? <span className="chip warn">{t('dup.why.shared_contact_different_names')}</span> : null}
                {g.why.includes('contact_conflict') ? <span className="chip warn">{t('dup.why.contact_conflict')}</span> : null}
                <span className={'chip ' + (g.status === 'merged' ? 'ok' : g.status === 'failed' ? 'bad' : '')} data-testid="dup-status">{t('dup.status.' + g.status)}</span>
                <span className="sub dupx-detected">{t('dup.detected', { at: when(g.detectedAt, true) })}</span>
                <button className="btn ghost sm" data-testid="dup-compare" onClick={() => setOpen({ id: g.id })}>{t('dup.compare')}</button>
              </div>
              <div className="rvw-table-wrap"><table className="tbl w-full">
                <thead><tr><th>{t('pos.customer')}</th><th>{t('pos.phone')}</th><th>{t('pos.email')}</th><th style={{ textAlign: 'right' }}>{t('pos.visits')}</th><th>{t('pos.keep_this_one')}</th></tr></thead>
                <tbody>{g.members.map((m: any) => (
                  <tr key={m.customerId} data-testid="dup-member">
                    <td>{m.name || '—'}{m.archived ? <span className="chip bad">{t('dup.archived')}</span> : null}<div className="sub">{m.createdAt ? t('dup.created', { d: when(m.createdAt) }) : ''}</div></td>
                    <td className="nowrap">{m.phone ?? <span className="sub">{t('dup.notProvided')}</span>}</td>
                    <td>{m.email ?? <span className="sub">{t('dup.notProvided')}</span>}</td>
                    <td style={{ textAlign: 'right' }}>{m.visits == null ? '—' : fmtNumber(m.visits)}</td>
                    <td>{['merged', 'kept_separate', 'resolved'].includes(g.status) || m.archived ? null
                      : <button className="seg-btn" data-testid="dup-merge-into" title={t('dup.mergeIntoHint')} onClick={() => setOpen({ id: g.id, survivorId: m.customerId })}>{t('pos.merge_into_this')}</button>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            </section>
          ))}
        <div className="rvw-pager">
          <Pager info={list ? { page: list.page, pageSize: list.pageSize, totalItems: list.total, totalPages: list.totalPages } : null} onPage={(p) => setF({ page: String(p) }, true)} />
          <label className="rvw-f"><span>{t('dup.rows')}</span>
            <select data-testid="dup-pagesize" value={String(query.pageSize)} onChange={(e) => setF({ pageSize: e.target.value === '25' ? null : e.target.value })}>
              {['10', '25', '50', '100'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select></label>
        </div>
        {list ? <p className="sub" data-testid="dup-foot">{list.contact === 'full' ? t('dup.contactFull') : t('dup.contactMasked')} · {t('dup.noAutoMerge')}</p> : null}
      </section>

      {open ? <CompareOverlay groupId={open.id} initialSurvivor={open.survivorId} canEdit={can('pos.customers.edit')} canMerge={can('pos.customers.merge')}
        onClose={() => setOpen(null)} onChanged={(msg) => { if (msg) setNotice(msg); void load(true); }} /> : null}
      {health ? <HealthDialog data={health} onClose={() => setHealth(null)} /> : null}
    </div>
  );
}

const ROWS: { key: string; labelKey: string; v: (m: any) => React.ReactNode }[] = [
  { key: 'name', labelKey: 'dup.c.name', v: (m) => m.name || '—' },
  { key: 'id', labelKey: 'dup.c.id', v: (m) => <span className="mono">{m.customerId.slice(0, 8)}</span> },
  { key: 'phone', labelKey: 'dup.c.phone', v: (m) => (m.phone ? <>{m.phone} {m.phoneVerified ? <span className="chip ok">{t('dup.verified')}</span> : <span className="chip">{t('dup.notVerified')}</span>}</> : <span className="sub">{t('dup.notProvided')}</span>) },
  { key: 'email', labelKey: 'dup.c.email', v: (m) => m.email ?? <span className="sub">{t('dup.notProvided')}</span> },
  { key: 'created', labelKey: 'dup.c.created', v: (m) => when(m.createdAt) },
  { key: 'updated', labelKey: 'dup.c.updated', v: (m) => when(m.updatedAt, true) },
  { key: 'branch', labelKey: 'dup.c.branch', v: (m) => m.branch ?? '—' },
  { key: 'visits', labelKey: 'dup.c.visits', v: (m) => `${fmtNumber(m.visits)} · ${when(m.lastVisit)}` },
  { key: 'upcoming', labelKey: 'dup.c.upcoming', v: (m) => (m.upcomingAppointments ? `${fmtNumber(m.upcomingAppointments)} · ${m.nextAppointment ?? ''}` : '0') },
  { key: 'canceled', labelKey: 'dup.c.canceled', v: (m) => fmtNumber(m.canceledOrNoShow) },
  { key: 'open', labelKey: 'dup.c.openTickets', v: (m) => (m.openTickets ? <span className="chip bad">{fmtNumber(m.openTickets)}</span> : '0') },
  { key: 'tech', labelKey: 'dup.c.technician', v: (m) => `${m.lastTechnician ?? '—'}${m.preferredTechnician ? ` · ${t('dup.prefers', { n: m.preferredTechnician })}` : ''}` },
  { key: 'loyalty', labelKey: 'dup.c.loyalty', v: (m) => (m.loyalty.points == null ? t('dup.notEnrolled') : `${fmtNumber(m.loyalty.points)}${m.loyalty.tier ? ` · ${m.loyalty.tier}` : ''}`) },
  { key: 'membership', labelKey: 'dup.c.memberships', v: (m) => fmtNumber(m.activeMemberships) },
  { key: 'gift', labelKey: 'dup.c.giftCards', v: (m) => (m.giftCards.count ? `${fmtNumber(m.giftCards.count)} · ${money(m.giftCards.balanceCents)}` : '0') },
  { key: 'cards', labelKey: 'dup.c.savedCards', v: (m) => fmtNumber(m.paymentMethods) },
  { key: 'consent', labelKey: 'dup.c.consent', v: (m) => `${t('dup.sms')}: ${m.consent.sms == null ? '—' : m.consent.sms ? t('dup.yes') : t('dup.no')} · ${t('dup.emailShort')}: ${m.consent.email == null ? '—' : m.consent.email ? t('dup.yes') : t('dup.no')}` },
  { key: 'tags', labelKey: 'dup.c.tags', v: (m) => (m.tags.length ? m.tags.join(', ') : '—') },
];

export function CompareOverlay({ groupId, initialSurvivor, canEdit, canMerge, onClose, onChanged }: { groupId: string; initialSurvivor?: string; canEdit: boolean; canMerge: boolean; onClose: () => void; onChanged: (msg?: string) => void }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [survivor, setSurvivor] = useState<string | undefined>(initialSurvivor);
  const [mode, setMode] = useState<'compare' | 'keep' | 'defer' | 'note' | 'preview'>('compare');
  const [note, setNote] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [pv, setPv] = useState<any>(null);
  const [acks, setAcks] = useState<Record<string, boolean>>({});
  const mergeKey = useRef<string | null>(null);
  const reload = useCallback(() => { setErr(null); posDuplicateReviewApi.group(groupId).then(setD).catch((e) => setErr(errText(e, 'dup.loadFailed'))); }, [groupId]);
  useEffect(() => { reload(); }, [reload]);
  const g = d?.group;
  const closed = g && ['merged', 'kept_separate', 'resolved'].includes(g.status);

  const decide = async (decision: string, extra: { note?: string; dueOn?: string } = {}) => {
    setBusy(true); setActionErr(null);
    try { await posDuplicateReviewApi.decide(groupId, { decision, expectedVersion: g.version, ...extra }); setMode('compare'); setNote(''); setDue(''); reload(); onChanged(t('dup.saved.' + decision)); }
    catch (e) { setActionErr(errText(e, 'dup.saveFailed')); }
    finally { setBusy(false); }
  };
  const addNote = async () => {
    setBusy(true); setActionErr(null);
    try { await posDuplicateReviewApi.note(groupId, note.trim()); setNote(''); setMode('compare'); reload(); }
    catch (e) { setActionErr(errText(e, 'dup.saveFailed')); }
    finally { setBusy(false); }
  };
  const preview = async () => {
    if (!survivor) return;
    setBusy(true); setActionErr(null); setPv(null); setAcks({}); mergeKey.current = newMergeKey();
    try { setPv(await posDuplicateReviewApi.preview(groupId, survivor)); setMode('preview'); }
    catch (e) { setActionErr(errText(e, 'dup.loadFailed')); }
    finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!pv || !survivor || busy) return;
    setBusy(true); setActionErr(null);
    try {
      const r = await posDuplicateReviewApi.merge(groupId, { survivorId: survivor, previewHash: pv.previewHash, idempotencyKey: mergeKey.current ?? newMergeKey(), acknowledged: Object.keys(acks).filter((x) => acks[x]) });
      if (r?.status === 'completed') { onChanged(t('dup.merged')); onClose(); return; }
      setActionErr(t('dup.err.' + (r?.errorCode ?? 'DUPLICATE_MERGE_FAILED')));
    } catch (e) { setActionErr(errText(e, 'dup.err.DUPLICATE_MERGE_FAILED')); mergeKey.current = newMergeKey(); }
    finally { setBusy(false); }
  };
  const allAcked = pv ? pv.acknowledgements.every((a: any) => acks[a.code]) : false;

  return (
    <FitDialog wide testId="dup-overlay" busy={busy} title={t('dup.ov.title', { n: d?.members?.length ?? 2 })}
      subtitle={g ? <>{t('dup.conf.' + g.confidence)} · {t('dup.status.' + g.status)} · {t('dup.detected', { at: when(g.detectedAt, true) })}</> : undefined} onClose={onClose}
      footer={<div className="rvw-ov-foot" data-testid="dup-actions">
        {mode === 'preview' ? <>
          <button className="btn ghost" data-testid="dup-back" onClick={() => setMode('compare')} disabled={busy}>{t('dup.back')}</button>
          {canMerge ? <button className="btn" data-testid="dup-confirm" disabled={busy || !pv?.canMerge || !allAcked} onClick={() => void confirm()}>{busy ? t('pos.merging') : t('dup.confirmMerge')}</button>
            : <span className="sub" data-testid="dup-no-merge">{t('dup.noMergePermission')}</span>}
        </> : mode !== 'compare' ? <>
          <button className="btn ghost" onClick={() => setMode('compare')} disabled={busy}>{t('pos.cancel')}</button>
          {mode === 'keep' ? <button className="btn" data-testid="dup-keep-save" disabled={busy || !note.trim()} onClick={() => void decide('keep_separate', { note: note.trim() })}>{t('pos.keep_separate')}</button> : null}
          {mode === 'defer' ? <button className="btn" data-testid="dup-defer-save" disabled={busy} onClick={() => void decide('defer', { note: note.trim() || undefined, dueOn: due || undefined })}>{t('dup.reviewLater')}</button> : null}
          {mode === 'note' ? <button className="btn" data-testid="dup-note-save" disabled={busy || !note.trim()} onClick={() => void addNote()}>{t('dup.addNote')}</button> : null}
        </> : <>
          {!closed && canMerge ? <button className="btn ghost" data-testid="dup-keep" onClick={() => setMode('keep')}>{t('pos.keep_separate')}</button> : null}
          {!closed && canEdit ? <button className="btn ghost" data-testid="dup-defer" onClick={() => setMode('defer')}>{t('dup.reviewLater')}</button> : null}
          {!closed && canEdit && g?.status !== 'in_review' ? <button className="btn ghost" data-testid="dup-inreview" onClick={() => void decide('in_review')}>{t('dup.markInReview')}</button> : null}
          {closed && canEdit && g?.status !== 'merged' ? <button className="btn ghost" data-testid="dup-reopen" onClick={() => void decide('reopen')}>{t('dup.reopen')}</button> : null}
          {canEdit ? <button className="btn ghost" data-testid="dup-note" onClick={() => setMode('note')}>{t('dup.addNote')}</button> : null}
          {!closed ? <button className="btn" data-testid="dup-preview" disabled={!survivor || busy} title={survivor ? undefined : t('dup.chooseFirst')} onClick={() => void preview()}>{t('dup.previewMerge')}</button> : null}
          <button className="btn ghost" data-testid="dup-close" onClick={onClose}>{t('dup.close')}</button>
        </>}
      </div>}>
      {err ? <div className="err">{err}</div> : !d ? <div className="state">{t('dup.loading')}</div> : <>
        {actionErr ? <p className="err" role="alert" data-testid="dup-action-err">{actionErr}</p> : null}
        {mode === 'preview' && pv ? <PreviewPanel pv={pv} acks={acks} setAcks={setAcks} /> : <>
          <div className="rvw-table-wrap"><table className="tbl dupx-compare" data-testid="dup-compare">
            <thead><tr><th />{d.members.map((m: any) => (
              <th key={m.customerId}>
                <label className="dupx-keep"><input type="radio" name="dup-survivor" data-testid="dup-survivor" disabled={closed || m.archived || m.missing} checked={survivor === m.customerId} onChange={() => setSurvivor(m.customerId)} />
                  {survivor === m.customerId ? <b>{t('dup.keepThis')}</b> : survivor ? <span className="sub">{t('dup.mergesIn')}</span> : t('pos.keep_this_one')}</label>
              </th>))}</tr></thead>
            <tbody>{ROWS.map((r) => (
              <tr key={r.key} data-testid={`cmp-${r.key}`}><th scope="row">{t(r.labelKey)}</th>{d.members.map((m: any) => <td key={m.customerId}>{m.missing ? '—' : r.v(m)}</td>)}</tr>
            ))}</tbody>
          </table></div>
          <h4>{t('dup.evidence')}</h4>
          <div className="dupx-evidence" data-testid="dup-evidence">
            {(d.evidence?.signals ?? []).map((s: any) => <span key={s.field} className={'chip ' + (s.state === 'match' ? 'ok' : s.state === 'conflict' ? 'bad' : '')} data-testid={`ev-${s.field}`}>
              {t('dup.reason.' + s.field)}: {t('dup.state.' + s.state, { p: s.present, of: s.of })}</span>)}
            <p className="sub">{t('dup.confExplain.' + g.confidence)} {t('dup.rule', { v: g.ruleVersion })}</p>
          </div>
          {mode === 'keep' || mode === 'defer' || mode === 'note' ? <div className="dupx-form" data-testid="dup-form">
            <label className="rvw-f"><span>{mode === 'keep' ? t('dup.reasonRequired') : t('dup.noteOptional')}</span>
              <textarea data-testid="dup-note-input" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
            {mode === 'defer' ? <label className="rvw-f"><span>{t('dup.dueOn')}</span><input type="date" data-testid="dup-due" value={due} onChange={(e) => setDue(e.target.value)} /></label> : null}
            {mode === 'keep' ? <p className="sub">{t('dup.keepExplain')}</p> : null}
          </div> : null}
          <h4>{t('dup.history')}</h4>
          <div data-testid="dup-events">{d.events.length ? d.events.map((e: any) => (
            <div key={e.id} className="rvw-ev"><b>{t('dup.ev.' + e.type)}</b> · {when(e.at, true)}{e.note ? <> · <span>{e.note}</span></> : null}</div>
          )) : <p className="sub">—</p>}</div>
        </>}
      </>}
    </FitDialog>
  );
}

function PreviewPanel({ pv, acks, setAcks }: { pv: any; acks: Record<string, boolean>; setAcks: (a: Record<string, boolean>) => void }) {
  return (
    <div data-testid="dup-preview-panel">
      <p className="sub">{t('dup.pv.readOnly')}</p>
      <dl className="rvw-dl">
        <dt>{t('dup.pv.keep')}</dt><dd data-testid="pv-survivor"><b>{pv.survivor.name ?? '—'}</b> <span className="mono sub">{pv.survivor.customerId.slice(0, 8)}</span></dd>
        <dt>{t('dup.pv.mergeArchive')}</dt><dd data-testid="pv-sources">{pv.sources.map((s: any) => <div key={s.customerId}>{s.name ?? '—'} <span className="mono sub">{s.customerId.slice(0, 8)}</span></div>)}</dd>
      </dl>
      <h4>{t('dup.pv.moves')}</h4>
      {Object.keys(pv.moves).length ? <ul data-testid="pv-moves">{Object.entries(pv.moves).map(([k, n]) => <li key={k}>{t('dup.table.' + k)}: {fmtNumber(n as number)}</li>)}</ul> : <p className="sub">{t('dup.pv.nothingMoves')}</p>}
      {pv.blockers.length ? <div className="panel dupx-block" data-testid="pv-blockers"><b>{t('dup.pv.blocked')}</b>
        <ul>{pv.blockers.map((b: any) => <li key={b.code} data-testid={`pv-block-${b.code}`}>{t('dup.block.' + b.code, { n: b.detail?.count ?? b.detail?.profiles ?? '' })}</li>)}</ul></div> : null}
      {pv.acknowledgements.length ? <div className="dupx-acks" data-testid="pv-acks"><b>{t('dup.pv.confirmEach')}</b>
        {pv.acknowledgements.map((a: any) => (
          <label key={a.code} className="dupx-ack"><input type="checkbox" data-testid={`ack-${a.code}`} checked={!!acks[a.code]} onChange={(e) => setAcks({ ...acks, [a.code]: e.target.checked })} />
            {t('dup.ack.' + a.code, { n: a.detail?.count ?? a.detail?.profiles ?? '', amount: a.detail?.balanceCents != null ? money(a.detail.balanceCents) : '' })}</label>
        ))}</div> : null}
      <p className="sub">{t('dup.pv.never')}</p>
      <p className="sub">{t('dup.pv.undo')} {t('dup.pv.expires', { at: when(pv.expiresAt, true) })}</p>
    </div>
  );
}

function HealthDialog({ data, onClose }: { data: any; onClose: () => void }) {
  return (
    <FitDialog wide testId="dup-health" title={t('dup.check')} subtitle={data && data !== 'loading' && !data.error ? t('dup.health.overall', { s: t('dup.health.' + data.overall), at: when(data.checkedAt, true) }) : undefined} onClose={onClose}
      footer={<button className="btn ghost" onClick={onClose}>{t('dup.close')}</button>}>
      {data === 'loading' ? <div className="state">{t('dup.health.running')}</div> : data.error ? <div className="err">{data.error}</div> : <>
        <p className="sub">{t('dup.health.readOnly')}{data.reused ? ` ${t('dup.health.recent')}` : ''}</p>
        {data.checks.map((c: any) => (
          <div key={c.key} className="rvw-check" data-testid={`chk-${c.key}`}>
            <div><span className={'chip ' + (STATE_TONE[c.state] ?? '')} data-testid={`chk-${c.key}-state`}>{t('dup.health.' + c.state)}</span> <b>{t('dup.health.k.' + c.key)}</b>{c.count ? <span className="sub"> · {fmtNumber(c.count)}</span> : null}</div>
            <div className="sub">{t('dup.health.d.' + c.key + '.' + c.state)}</div>
          </div>
        ))}
      </>}
    </FitDialog>
  );
}
