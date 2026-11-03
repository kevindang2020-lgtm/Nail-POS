// POSAIReviewReputationScreen.tsx — AI Center → AI Review & Reputation (/tenant/ai/reputation). Review & Reputation guide
// (Nov 1 2026). Rebuilt IN PLACE: the title, the description, the EIGHT tabs (Overview · Review Inbox · Response Approvals ·
// Serious Complaints · Feedback Trends · Branch Comparison · Review Requests · Integrations) and the SIX cards stay.
// What changed:
//   • the cards come from /pos/reputation/summary — one definition for Overview, Trends and Branches. "Awaiting approval" and
//     "Response rate" used to read a review column the approval flow never updated (so they were always 0), and
//     "Awaiting approval" was counted from the first inbox page only; a failed read showed "—"/empty instead of an error;
//   • every tab has its own search / filters / numbered pages (newest first) and the shared From/To month calendar;
//   • a review opens a full overlay: provider evidence, the stored customer link (role-gated), analysis, the DRAFT, its
//     history, the complaint case, notes — with the workflow on the existing routes: Draft → Send for approval → Approve /
//     Reject (with a reason) → Publish (separate; counts only when the provider confirms). The AI drafts from the stored
//     review, never from text the browser sends. Nothing here refunds, credits, discounts or messages anyone;
//   • Check Reputation System (read-only). Review Requests says the truth: nothing is sent automatically yet.
import { useCallback, useEffect, useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posReputationApi as rp } from '../api/posReputationApi';
import { posAiReviewReputationApi as apiR } from '../api/posAiReviewReputationApi';
import { errorTextOf } from '../i18n/error-text';
import { statusLabel } from '../i18n/status-label';
import { fmtNumber, fmtInZone } from '../i18n/format';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry } from '../components/FitKit';
import { RangeCalendar, isForbidden } from '../components/FinanceKit';
import { useCan } from '../components/usePermissions';

const t = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const when = (iso?: string | null, withTime = false) => (iso ? fmtInZone(iso, withTime ? { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
type Tab = 'overview' | 'inbox' | 'approvals' | 'serious' | 'trends' | 'branches' | 'requests' | 'integrations';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'pos.overview' }, { key: 'inbox', label: 'pos.review_inbox' }, { key: 'approvals', label: 'pos.response_approvals' }, { key: 'serious', label: 'pos.serious_complaints' },
  { key: 'trends', label: 'pos.feedback_trends' }, { key: 'branches', label: 'pos.branch_comparison' }, { key: 'requests', label: 'pos.review_requests' }, { key: 'integrations', label: 'pos.integrations' }];
const PRESETS = ['today', 'yesterday', 'week', 'last_7', 'month', 'last_month', 'last_30', 'last_90', 'year'] as const;
const SOURCES = ['google', 'facebook', 'yelp', 'internal', 'survey', 'sms', 'email', 'app', 'support', 'manual'];
const CHANNELS = ['sms', 'email', 'app', 'whatsapp', 'push'];
const RESPONSES = ['unanswered', 'draft', 'awaiting_approval', 'approved', 'published', 'publish_failed', 'rejected'];
const STATE_TONE: Record<string, string> = { PASSED: 'ok', WARNING: 'warn', FAILED: 'bad', INSUFFICIENT_DATA: '', UNAVAILABLE: 'bad' };
const RESP_TONE: Record<string, string> = { unanswered: 'warn', draft: '', awaiting_approval: 'gold', approved: 'gold', published: 'ok', publish_failed: 'bad', rejected: '' };
const KNOWN = ['DRAFT_UNSAFE', 'NOT_APPROVED', 'PUBLISH_FAILED', 'INTEGRATION_DISCONNECTED', 'INVALID_RESPONSE_TRANSITION', 'DRAFT_NOT_FOUND', 'REVIEW_NOT_FOUND', 'REPUTATION_INVALID_PERIOD', 'REPUTATION_INVALID_FILTER', 'FORBIDDEN', 'PERMISSION_DENIED'];
function errText(e: any, fallbackKey: string) {
  const code = e?.body?.code ?? e?.body?.error ?? e?.code;
  if (typeof code === 'string' && KNOWN.includes(code)) return t('rpx.err.' + code);
  if (isForbidden(e)) return t('rpx.err.PERMISSION_DENIED');
  return errorTextOf(e, t(fallbackKey));
}
const pctText = (v: number | null | undefined) => (v == null ? '—' : `${fmtNumber(v, 1)}%`);
const rating = (v: number | null | undefined) => (v == null ? '—' : fmtNumber(v, 1));
const stars = (n: number | null | undefined) => (n == null ? '—' : t('rpx.stars', { n: fmtNumber(n) }));
type Period = { preset?: string; from?: string; to?: string };

/** the shared period control: presets + the From/To month calendar */
function PeriodBar({ value, onChange, today }: { value: Period; onChange: (p: Period) => void; today?: string }) {
  const [cal, setCal] = useState(false);
  return (
    <div className="rvw-dates">
      <button className={'btn ghost' + (!value.preset ? ' on' : '')} onClick={() => onChange({})}>{t('rpx.preset.all')}</button>
      {PRESETS.map((p) => <button key={p} className={'btn ghost' + (value.preset === p ? ' on' : '')} data-testid={`preset-${p}`} onClick={() => onChange({ preset: p })}>{t('rpx.preset.' + p)}</button>)}
      <button className={'btn ghost' + (value.preset === 'custom' ? ' on' : '')} data-testid="preset-custom" onClick={() => setCal(true)}>{value.preset === 'custom' ? `${value.from} → ${value.to}` : t('rpx.preset.custom')}</button>
      {cal ? <div className="rvw-cal"><RangeCalendar initial={{ from: value.from, to: value.to }} today={today ?? new Date().toISOString().slice(0, 10)}
        onApply={(r) => { onChange({ preset: 'custom', from: r.from, to: r.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { onChange({}); setCal(false); }} /></div> : null}
    </div>
  );
}
function useList<Q extends Record<string, any>>(load: (q: Q) => Promise<any>, init: Q) {
  const [q, setQ] = useState<Q>(init);
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialized query
  useEffect(() => { setErr(null); load(q).then(setD).catch((e) => setErr(errText(e, 'rpx.loadFailed'))); }, [JSON.stringify(q), tick]);
  const set = (p: Partial<Q>, keepPage = false) => setQ((x) => ({ ...x, ...p, page: keepPage ? (p as Record<string, unknown>).page ?? (x as Record<string, unknown>).page : 1 }));
  return { q, set, d, err, reload: () => setTick((n) => n + 1) };
}

export function POSAIReviewReputationScreen() {
  const [tab, setTab] = useState<Tab>('overview');
  const [period, setPeriod] = useState<Period>({});
  const [source, setSource] = useState('');
  const [sum, setSum] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [health, setHealth] = useState<any | 'loading' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const loadSum = useCallback(() => { setErr(null); rp.summary({ ...period, source: source || undefined }).then(setSum).catch((e) => setErr(errText(e, 'rpx.loadFailed'))); }, [period, source]);
  useEffect(() => { loadSum(); }, [loadSum, tick]);
  const m = sum?.metrics;
  const changed = (msg: string) => { setNotice(msg); setTick((n) => n + 1); };
  const goTab = (k: Tab) => { setTab(k); setNotice(null); };

  return (
    <div className="work rvw rpx" data-testid="reputation-screen">
      <div className="vh rvw-head">
        <div><h1>{t('pos.ai_review_and_reputation')}</h1><div className="sub mb-3">{t('pos.monitor_feedback_respond_professionally_with_approval_1lex')}</div></div>
        <div className="rvw-actions">
          <button className="btn ghost" data-testid="rpx-check" onClick={() => { setHealth('loading'); rp.check().then(setHealth).catch((e) => setHealth({ error: errText(e, 'rpx.loadFailed') })); }}>{t('rpx.check')}</button>
        </div>
      </div>
      <div role="tablist" aria-label={t('pos.review_sections')} className="rvw-tabs" data-testid="rpx-tabs">
        {TABS.map((x) => <button key={x.key} role="tab" aria-selected={tab === x.key} className={'btn ghost' + (tab === x.key ? ' on' : '')} data-testid={`tab-${x.key}`} onClick={() => goTab(x.key)}>
          {t(x.label)}{x.key === 'serious' && m?.seriousComplaints ? ` (${fmtNumber(m.seriousComplaints)})` : ''}</button>)}
      </div>
      {notice ? <div className="panel" role="status" data-testid="rpx-notice" style={{ padding: 12 }}>{notice}</div> : null}
      {err ? <ErrorRetry message={err} onRetry={loadSum} /> : null}

      <section className="panel rvw-filters" data-testid="rpx-scope">
        <label className="rvw-f"><span>{t('rpx.col.provider2')}</span>
          <select data-testid="rpx-source" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">{t('rpx.anySource')}</option>{SOURCES.map((s) => <option key={s} value={s}>{t('rpx.src.' + s)}</option>)}
          </select></label>
        <PeriodBar value={period} onChange={setPeriod} today={sum?.period?.today} />
      </section>

      <div className="rvw-kpis" data-testid="rpx-kpis">
        <KpiCard testId="kpi-avg" label={t('pos.average_rating_3')} value={m ? rating(m.averageRating) : '—'} loading={!sum && !err} onClick={() => goTab('inbox')} />
        <KpiCard testId="kpi-reviews" label={t('pos.reviews_2')} value={m ? fmtNumber(m.reviews) : '—'} loading={!sum && !err} onClick={() => goTab('inbox')} />
        <KpiCard testId="kpi-negative" label={t('pos.negative_share')} value={m ? pctText(m.negativeShare) : '—'} loading={!sum && !err} onClick={() => goTab('inbox')} />
        <KpiCard testId="kpi-awaiting" label={t('pos.awaiting_approval')} value={m ? fmtNumber(m.awaitingApproval) : '—'} loading={!sum && !err} tone="gold" onClick={() => goTab('approvals')} />
        <KpiCard testId="kpi-serious" label={t('pos.serious_complaints_2')} value={m ? fmtNumber(m.seriousComplaints) : '—'} loading={!sum && !err} tone={m?.seriousComplaints ? 'bad' : undefined} onClick={() => goTab('serious')} />
        <KpiCard testId="kpi-response" label={t('pos.response_rate')} value={m ? pctText(m.responseRate) : '—'} loading={!sum && !err} onClick={() => goTab('approvals')} />
      </div>
      {sum ? <p className="sub" data-testid="rpx-defs">{t('rpx.defs', { c: fmtNumber(m.classifiedReviews), n: fmtNumber(m.reviews) })}{sum.sampleNote ? ` ${t('rpx.smallSample')}` : ''}
        {' · '}{t('rpx.freshness', { sync: sum.freshness.lastSyncAt ? when(sum.freshness.lastSyncAt, true) : t('rpx.never'), newest: sum.freshness.newestReviewAt ? when(sum.freshness.newestReviewAt) : t('rpx.never') })}</p> : null}

      {tab === 'overview' ? <section className="panel rvw-feed" data-testid="rpx-overview">
        <div className="p-h">{t('rpx.recent')}</div>
        {!sum ? null : sum.recent.length === 0 ? <Empty title={t('rpx.noReviews')} /> : sum.recent.map((r: any) => (
          <div key={r.id} className="rvw-ev" data-testid="rpx-recent" style={{ cursor: 'pointer' }} onClick={() => setOpen(r.id)}>{stars(r.rating)} · {t('rpx.src.' + (r.source ?? 'unknown'))} · {when(r.at)} · <span className="sub">{r.excerpt ?? t('rpx.noText')}</span>
            {' '}<span className={'chip ' + (RESP_TONE[r.response] ?? '')}>{t('rpx.resp.' + r.response)}</span></div>))}
      </section>
        : tab === 'inbox' ? <InboxTab key={`in-${tick}`} period={period} source={source} onOpen={setOpen} />
        : tab === 'approvals' ? <ApprovalsTab key={`ap-${tick}`} onOpen={setOpen} />
        : tab === 'serious' ? <ComplaintsTab key={`co-${tick}`} period={period} onOpen={setOpen} />
        : tab === 'trends' ? <TrendsTab source={source} />
        : tab === 'branches' ? <BranchesTab period={period} source={source} />
        : tab === 'requests' ? <RequestsTab period={period} />
        : <IntegrationsTab />}

      {open ? <ReviewOverlay id={open} onClose={() => setOpen(null)} onChanged={changed} /> : null}
      {health ? <HealthDialog data={health} onClose={() => setHealth(null)} /> : null}
    </div>
  );
}

function InboxTab({ period, source, onOpen }: { period: Period; source: string; onOpen: (id: string) => void }) {
  const [draft, setDraft] = useState('');
  const L = useList((q) => rp.reviews(q), { page: 1, pageSize: 25 } as Record<string, any>);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialized period
  useEffect(() => { L.set({ ...period, preset: period.preset, from: period.from, to: period.to, source: source || undefined }); }, [JSON.stringify(period), source]);
  const d = L.d;
  return (
    <section className="panel rvw-feed" data-testid="rpx-inbox">
      <form className="rvw-filters" onSubmit={(e) => { e.preventDefault(); L.set({ q: draft.trim() || undefined }); }}>
        <input className="rvw-search" data-testid="rpx-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('rpx.searchReviews')} aria-label={t('rpx.searchReviews')} />
        <button className="btn" type="submit">{t('rpx.search')}</button>
        <select data-testid="rpx-rating" value={L.q.rating ?? ''} onChange={(e) => L.set({ rating: e.target.value || undefined })}><option value="">{t('rpx.anyRating')}</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{stars(n)}</option>)}</select>
        <select data-testid="rpx-response" value={L.q.response ?? ''} onChange={(e) => L.set({ response: e.target.value || undefined })}><option value="">{t('rpx.anyResponse')}</option>{RESPONSES.map((x) => <option key={x} value={x}>{t('rpx.resp.' + x)}</option>)}</select>
        <select data-testid="rpx-complaint" value={L.q.complaint ?? ''} onChange={(e) => L.set({ complaint: e.target.value || undefined })}><option value="">{t('rpx.anyComplaint')}</option>{['none', 'open', 'acknowledged', 'resolved'].map((x) => <option key={x} value={x}>{t('rpx.case.' + x)}</option>)}</select>
        <select data-testid="rpx-datefield" value={L.q.dateField ?? 'review'} onChange={(e) => L.set({ dateField: e.target.value === 'review' ? undefined : e.target.value })}>{['review', 'imported'].map((x) => <option key={x} value={x}>{t('rpx.date.' + x)}</option>)}</select>
        <select data-testid="rpx-sort" value={L.q.sort ?? 'newest'} onChange={(e) => L.set({ sort: e.target.value === 'newest' ? undefined : e.target.value })}>{['newest', 'oldest', 'rating_low', 'rating_high'].map((x) => <option key={x} value={x}>{t('rpx.sort.' + x)}</option>)}</select>
        {L.q.q || L.q.rating || L.q.response || L.q.complaint ? <button className="btn ghost" type="button" onClick={() => { setDraft(''); L.set({ q: undefined, rating: undefined, response: undefined, complaint: undefined }); }}>{t('rpx.clear')}</button> : null}
      </form>
      {L.err ? <ErrorRetry message={L.err} onRetry={L.reload} /> : !d ? <div className="state">{t('rpx.loading')}</div> : d.items.length === 0 ? <Empty title={L.q.q || L.q.rating || L.q.response || L.q.complaint ? t('rpx.noMatch') : t('rpx.noReviews')} /> : (
        <div className="rvw-table-wrap"><table className="tbl rvw-table"><thead><tr><th>{t('rpx.col.date')}</th><th>{t('rpx.col.provider')}</th><th>{t('rpx.col.rating')}</th><th>{t('rpx.col.response')}</th><th>{t('rpx.col.complaint')}</th><th /></tr></thead>
          <tbody>{d.items.map((r: any) => <tr key={r.id} data-testid="rpx-row" tabIndex={0} onClick={() => onOpen(r.id)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(r.id); }}>
            <td className="nowrap">{when(r.at)}<div className="sub">{r.reviewer ?? ''}</div></td>
            <td>{t('rpx.src.' + (r.source ?? 'unknown'))}<div className="sub">{r.branch ?? ''}</div></td>
            <td><b>{stars(r.rating)}</b> <span className="sub">{r.excerpt ?? t('rpx.noText')}{r.truncated ? '…' : ''}</span></td>
            <td><span className={'chip ' + (RESP_TONE[r.response] ?? '')} data-testid="rpx-resp">{t('rpx.resp.' + r.response)}</span></td>
            <td>{r.complaint === 'none' ? '—' : <span className="chip bad">{t('rpx.case.' + r.complaint)}</span>}</td>
            <td><button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); onOpen(r.id); }}>{t('rpx.view')}</button></td></tr>)}</tbody></table></div>)}
      <ListFoot d={d} onPage={(p) => L.set({ page: p }, true)} pageSize={L.q.pageSize} onSize={(n) => L.set({ pageSize: n })} />
    </section>
  );
}

function ListFoot({ d, onPage, pageSize, onSize }: { d: any; onPage: (p: number) => void; pageSize: number; onSize: (n: number) => void }) {
  return (
    <div className="rvw-pager">
      <Pager info={d ? { page: d.page, pageSize: d.pageSize, totalItems: d.total, totalPages: d.totalPages } : null} onPage={onPage} />
      <label className="rvw-f"><span>{t('rpx.rows')}</span><select value={String(pageSize)} onChange={(e) => onSize(Number(e.target.value))}>{['10', '25', '50', '100'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
    </div>
  );
}

function ApprovalsTab({ onOpen }: { onOpen: (id: string) => void }) {
  const L = useList((q) => rp.approvals(q), { page: 1, pageSize: 25, state: 'awaiting_approval' } as Record<string, any>);
  const d = L.d;
  return (
    <section className="panel rvw-feed" data-testid="rpx-approvals">
      <div className="rvw-tabs">{['awaiting_approval', 'approved', 'publish_failed', 'draft_generated', 'rejected', 'published', 'all'].map((s) => (
        <button key={s} className={'btn ghost' + (L.q.state === s ? ' on' : '')} data-testid={`ap-${s}`} onClick={() => L.set({ state: s })}>{s === 'all' ? t('rpx.all') : t('rpx.resp.' + s)}{d?.counts?.[s] ? ` (${fmtNumber(d.counts[s])})` : ''}</button>))}</div>
      {L.err ? <ErrorRetry message={L.err} onRetry={L.reload} /> : !d ? <div className="state">{t('rpx.loading')}</div> : d.items.length === 0 ? <Empty title={t('rpx.noApprovals')} /> : (
        <div className="rvw-table-wrap"><table className="tbl rvw-table"><thead><tr><th>{t('rpx.col.rating')}</th><th>{t('rpx.col.draft')}</th><th>{t('rpx.col.status')}</th><th>{t('rpx.col.updated')}</th><th>{t('rpx.col.by')}</th><th /></tr></thead>
          <tbody>{d.items.map((x: any) => <tr key={x.reviewId} data-testid="rpx-ap-row" onClick={() => onOpen(x.reviewId)} style={{ cursor: 'pointer' }}>
            <td><b>{stars(x.rating)}</b> <span className="sub">{x.excerpt ?? t('rpx.noText')}</span></td>
            <td className="sub"><b>{t('rpx.ov.draftLabel')}</b> {x.draft ?? ''}</td>
            <td><span className={'chip ' + (RESP_TONE[x.status] ?? '')}>{t('rpx.resp.' + x.status)}</span></td>
            <td className="nowrap">{when(x.updatedAt, true)}</td><td>{x.lastActor ?? '—'}</td>
            <td><button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); onOpen(x.reviewId); }}>{t('rpx.view')}</button></td></tr>)}</tbody></table></div>)}
      <ListFoot d={d} onPage={(p) => L.set({ page: p }, true)} pageSize={L.q.pageSize} onSize={(n) => L.set({ pageSize: n })} />
    </section>
  );
}

function ComplaintsTab({ period, onOpen }: { period: Period; onOpen: (id: string) => void }) {
  const L = useList((q) => rp.complaints(q), { page: 1, pageSize: 25, state: 'active' } as Record<string, any>);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialized period
  useEffect(() => { L.set({ preset: period.preset, from: period.from, to: period.to }); }, [JSON.stringify(period)]);
  const d = L.d;
  return (
    <section className="panel rvw-feed" data-testid="rpx-complaints">
      <div className="rvw-tabs">{['active', 'open', 'acknowledged', 'resolved', 'all'].map((s) => <button key={s} className={'btn ghost' + (L.q.state === s ? ' on' : '')} data-testid={`co-${s}`} onClick={() => L.set({ state: s })}>{t('rpx.case.' + s)}</button>)}</div>
      <p className="sub">{t('rpx.ov.caseNote')}</p>
      {L.err ? <ErrorRetry message={L.err} onRetry={L.reload} /> : !d ? <div className="state">{t('rpx.loading')}</div> : d.items.length === 0 ? <Empty title={t('rpx.noComplaints')} /> : (
        <div className="rvw-table-wrap"><table className="tbl rvw-table"><thead><tr><th>{t('rpx.col.opened')}</th><th>{t('rpx.col.severity')}</th><th>{t('rpx.col.rating')}</th><th>{t('rpx.col.status')}</th><th>{t('rpx.col.assignee')}</th><th /></tr></thead>
          <tbody>{d.items.map((x: any) => <tr key={x.id} data-testid="rpx-co-row" onClick={() => onOpen(x.reviewId)} style={{ cursor: 'pointer' }}>
            <td className="nowrap">{when(x.openedAt, true)}</td><td><span className="chip bad">{statusLabel('severity', x.severity)}</span></td>
            <td><b>{stars(x.rating)}</b> <span className="sub">{x.excerpt ?? ''}</span></td><td>{t('rpx.case.' + (x.status === 'resolved' || x.status === 'acknowledged' ? x.status : 'open'))}</td><td>{x.assignee ?? '—'}</td>
            <td><button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); onOpen(x.reviewId); }}>{t('rpx.view')}</button></td></tr>)}</tbody></table></div>)}
      <ListFoot d={d} onPage={(p) => L.set({ page: p }, true)} pageSize={L.q.pageSize} onSize={(n) => L.set({ pageSize: n })} />
    </section>
  );
}

function TrendsTab({ source }: { source: string }) {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { rp.trends({ months: 12, source: source || undefined }).then(setD).catch((e) => setErr(errText(e, 'rpx.loadFailed'))); }, [source]);
  return (
    <section className="panel rvw-feed" data-testid="rpx-trends">
      <p className="sub">{t('rpx.trendNote')}</p>
      {err ? <div className="err">{err}</div> : !d ? <div className="state">{t('rpx.loading')}</div> : (
        <div className="rvw-table-wrap"><table className="tbl rvw-table"><thead><tr><th>{t('rpx.col.month')}</th><th>{t('rpx.col.count')}</th><th>{t('pos.average_rating_3')}</th><th>{t('pos.negative_share')}</th><th>{t('pos.response_rate')}</th><th /></tr></thead>
          <tbody>{d.months.map((x: any) => <tr key={x.month} data-testid="rpx-trend-row"><td>{x.month}</td><td className="num">{fmtNumber(x.reviews)}</td><td className="num">{rating(x.averageRating)}</td>
            <td className="num">{pctText(x.negativeShare)}</td><td className="num">{pctText(x.responseRate)}</td><td className="sub">{x.sample !== 'ok' ? t('rpx.sample.' + x.sample) : null}</td></tr>)}</tbody></table></div>)}
    </section>
  );
}

function BranchesTab({ period, source }: { period: Period; source: string }) {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { rp.branches({ ...period, source: source || undefined }).then(setD).catch((e) => setErr(errText(e, 'rpx.loadFailed'))); }, [JSON.stringify(period), source]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="panel rvw-feed" data-testid="rpx-branches">
      <p className="sub">{t('rpx.branchNote')}</p>
      {err ? <div className="err">{err}</div> : !d ? <div className="state">{t('rpx.loading')}</div> : (
        <div className="rvw-table-wrap"><table className="tbl rvw-table"><thead><tr><th>{t('rpx.col.branch')}</th><th>{t('rpx.col.count')}</th><th>{t('pos.average_rating_3')}</th><th>{t('pos.negative_share')}</th><th>{t('pos.response_rate')}</th>
          <th>{t('pos.awaiting_approval')}</th><th>{t('pos.serious_complaints_2')}</th><th>{t('rpx.col.sent')}</th></tr></thead>
          <tbody>{d.branches.map((b: any) => <tr key={b.branchId} data-testid="rpx-branch-row"><td>{b.name}</td>{b.metrics ? <>
            <td className="num">{fmtNumber(b.metrics.reviews)}</td><td className="num">{rating(b.metrics.averageRating)}</td><td className="num">{pctText(b.metrics.negativeShare)}</td>
            <td className="num">{pctText(b.metrics.responseRate)}</td><td className="num">{fmtNumber(b.metrics.awaitingApproval)}</td><td className="num">{fmtNumber(b.metrics.seriousComplaints)}</td></>
            : <td colSpan={6} className="sub">{t('rpx.na')}</td>}<td className="num">{fmtNumber(b.requestsSent)}</td></tr>)}</tbody></table></div>)}
    </section>
  );
}

function RequestsTab({ period }: { period: Period }) {
  const L = useList((q) => rp.requests(q), { page: 1, pageSize: 25, state: 'all' } as Record<string, any>);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialized period
  useEffect(() => { L.set({ preset: period.preset, from: period.from, to: period.to }); }, [JSON.stringify(period)]);
  const d = L.d;
  return (
    <section className="panel rvw-feed" data-testid="rpx-requests">
      <p className="sub" data-testid="rpx-requests-note">{t('rpx.requestsNote')}</p>
      {d?.overdueNotSent ? <p className="warn" data-testid="rpx-overdue">{t('rpx.overdue', { n: fmtNumber(d.overdueNotSent) })}</p> : null}
      <div className="rvw-tabs">{['all', 'scheduled', 'sent', 'delivered', 'failed', 'skipped', 'opted_out', 'converted'].map((s) => <button key={s} className={'btn ghost' + (L.q.state === s ? ' on' : '')} onClick={() => L.set({ state: s })}>{t('rpx.req.' + s)}{d?.counts?.[s] ? ` (${fmtNumber(d.counts[s])})` : ''}</button>)}</div>
      {L.err ? <ErrorRetry message={L.err} onRetry={L.reload} /> : !d ? <div className="state">{t('rpx.loading')}</div> : d.items.length === 0 ? <Empty title={t('rpx.noRequests')} /> : (
        <div className="rvw-table-wrap"><table className="tbl rvw-table"><thead><tr><th>{t('rpx.col.customer')}</th><th>{t('rpx.col.channel')}</th><th>{t('rpx.col.scheduled')}</th><th>{t('rpx.col.status')}</th></tr></thead>
          <tbody>{d.items.map((x: any) => <tr key={x.id} data-testid="rpx-req-row"><td>{x.customer ?? '—'}</td><td>{t('rpx.src.' + (CHANNELS.includes(x.channel) ? x.channel : 'unknown'))}</td><td className="nowrap">{when(x.scheduledFor, true)}</td>
            <td><span className={'chip ' + (x.status === 'scheduled' ? 'warn' : '')}>{t('rpx.req.' + x.status)}</span></td></tr>)}</tbody></table></div>)}
      <ListFoot d={d} onPage={(p) => L.set({ page: p }, true)} pageSize={L.q.pageSize} onSize={(n) => L.set({ pageSize: n })} />
    </section>
  );
}

function IntegrationsTab() {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { rp.integrations().then(setD).catch((e) => setErr(errText(e, 'rpx.loadFailed'))); }, []);
  return (
    <section className="panel rvw-feed" data-testid="rpx-integrations">
      {err ? <div className="err">{err}</div> : !d ? <div className="state">{t('rpx.loading')}</div> : <>
        <table className="tbl rvw-table"><thead><tr><th>{t('rpx.col.provider2')}</th><th>{t('rpx.col.connection')}</th><th>{t('rpx.col.lastSync')}</th><th>{t('rpx.col.publish')}</th></tr></thead>
          <tbody>{d.providers.map((p: any) => <tr key={p.provider} data-testid={`rpx-prov-${p.provider}`}><td>{t('rpx.prov.' + p.provider)}{p.account ? <div className="sub">{p.account}</div> : null}</td>
            <td><span className={'chip ' + (p.connected ? 'ok' : '')}>{t('rpx.conn.' + (p.connected ? 'active' : p.status))}</span>{!p.connected ? <div className="sub">{t('rpx.notConnectedNote')}</div> : null}</td>
            <td className="nowrap">{p.lastSuccessAt ? when(p.lastSuccessAt, true) : '—'}</td><td className="sub">{p.canPublishReplies ? t('rpx.canPublish') : t('rpx.cannotPublish')}</td></tr>)}</tbody></table>
        <h4>{t('rpx.importsTitle')}</h4>
        <ul>{d.imports.map((x: any) => <li key={x.source}>{t('rpx.src.' + (x.source ?? 'unknown'))}: {fmtNumber(x.reviews)} · {x.lastSyncAt ? when(x.lastSyncAt, true) : t('rpx.never')}</li>)}</ul>
      </>}
    </section>
  );
}

function ReviewOverlay({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: (msg: string) => void }) {
  const can = useCan();
  const manage = can('pos.ai_review_reputation.manage');
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actErr, setActErr] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const reload = useCallback(() => { setErr(null); rp.review(id).then(setD).catch((e) => setErr(errText(e, 'rpx.loadFailed'))); }, [id]);
  useEffect(() => { reload(); }, [reload]);
  const act = async (fn: () => Promise<unknown>, doneKey: string) => {
    setBusy(true); setActErr(null);
    try { await fn(); reload(); onChanged(t('rpx.done.' + doneKey)); setRejecting(false); setReason(''); setNote(''); }
    catch (e) { setActErr(errText(e, 'rpx.saveFailed')); reload(); }
    finally { setBusy(false); }
  };
  const st = d?.response?.draftStatus as string | null;
  const draftable = !st || ['draft_generated', 'needs_revision', 'rejected', 'publish_failed'].includes(st);
  return (
    <FitDialog wide testId="rpx-overlay" busy={busy} title={t('rpx.ov.title')} subtitle={d ? `${stars(d.rating)} · ${t('rpx.src.' + (d.source ?? 'unknown'))} · ${when(d.at)}` : undefined} onClose={onClose}
      footer={<div className="rvw-ov-foot">
        {manage && d && draftable ? <button className="btn" data-testid="rpx-draft" disabled={busy} onClick={() => void act(() => apiR.draft(id, st ? 'regenerate' : 'generate'), 'drafted')}>{st ? t('rpx.ov.regenerate') : t('rpx.ov.generate')}</button> : null}
        {manage && st && ['draft_generated', 'needs_revision'].includes(st) ? <>
          <button className="btn ghost" data-testid="rpx-shorten" disabled={busy} onClick={() => void act(() => apiR.draft(id, 'shorten'), 'drafted')}>{t('rpx.ov.shorten')}</button>
          <button className="btn ghost" data-testid="rpx-warmer" disabled={busy} onClick={() => void act(() => apiR.draft(id, 'warmer'), 'drafted')}>{t('rpx.ov.warmer')}</button>
          <button className="btn" data-testid="rpx-submit" disabled={busy} onClick={() => void act(() => apiR.requestApproval(id), 'submitted')}>{t('rpx.ov.submit')}</button></> : null}
        {manage && st === 'awaiting_approval' ? <>
          <button className="btn" data-testid="rpx-approve" disabled={busy} onClick={() => void act(() => apiR.approve(id), 'approved')}>{t('rpx.ov.approve')}</button>
          <button className="btn ghost" data-testid="rpx-reject" disabled={busy} onClick={() => setRejecting(true)}>{t('rpx.ov.reject')}</button></> : null}
        {manage && st === 'approved' && d?.response?.canPublishToProvider ? <button className="btn" data-testid="rpx-publish" disabled={busy} onClick={() => void act(() => apiR.publish(id), 'published')}>{t('rpx.ov.publish')}</button> : null}
        {manage && d?.complaint && d.complaint.status === 'open' ? <button className="btn ghost" data-testid="rpx-ack" disabled={busy} onClick={() => void act(() => apiR.acknowledge(d.complaint.id), 'acknowledged')}>{t('rpx.ov.acknowledge')}</button> : null}
        {manage && d?.complaint && d.complaint.status !== 'resolved' ? <button className="btn ghost" data-testid="rpx-resolve" disabled={busy} onClick={() => void act(() => apiR.resolveEscalation(d.complaint.id, id), 'resolved')}>{t('rpx.ov.resolve')}</button> : null}
        {d?.reviewerUrl ? <a className="btn ghost" href={d.reviewerUrl} target="_blank" rel="noreferrer noopener">{t('rpx.ov.openSource')}</a> : null}
        <button className="btn ghost" data-testid="rpx-close" onClick={onClose}>{t('rpx.close')}</button>
      </div>}>
      {err ? <div className="err">{err}</div> : !d ? <div className="state">{t('rpx.loading')}</div> : <>
        {actErr ? <p className="err" role="alert" data-testid="rpx-act-err">{actErr}</p> : null}
        <blockquote data-testid="rpx-text" style={{ margin: 0 }}>{d.text ?? t('rpx.noText')}</blockquote>
        <dl className="rvw-dl">
          <dt>{t('rpx.ov.source')}</dt><dd>{t('rpx.src.' + (d.source ?? 'unknown'))}{d.reviewer ? ` · ${d.reviewer}` : ''}{d.branch ? ` · ${d.branch}` : ''}</dd>
          {d.externalId ? <><dt>{t('rpx.ov.externalId')}</dt><dd className="sub">{d.externalId}</dd></> : null}
          <dt /><dd className="sub">{t('rpx.ov.imported', { at: when(d.importedAt, true), sync: d.lastSyncAt ? when(d.lastSyncAt, true) : t('rpx.never') })}</dd>
          <dt>{t('rpx.ov.customer')}</dt><dd data-testid="rpx-customer">{!d.customer ? <span className="sub">{t('rpx.ov.noCustomer')}</span> : d.customer.restricted ? <span className="sub">{t('rpx.ov.restricted')}</span> : `${d.customer.name ?? '—'}${d.customer.phone ? ` · ${d.customer.phone}` : ''}`}</dd>
          <dt>{t('rpx.ov.analysis')}</dt><dd>{d.analysis ? t('rpx.ov.analysisLine', { s: statusLabel('sentiment', d.analysis.sentiment), sev: statusLabel('severity', d.analysis.severity), c: d.analysis.confidence == null ? '—' : fmtNumber(d.analysis.confidence, 2) }) : <span className="sub">{t('rpx.ov.noAnalysis')}</span>}</dd>
        </dl>
        <h4>{t('rpx.ov.response')} <span className={'chip ' + (RESP_TONE[d.response.state] ?? '')} data-testid="rpx-ov-state">{t('rpx.resp.' + d.response.state)}</span></h4>
        {d.response.text ? <div className="panel" style={{ padding: 10 }} data-testid="rpx-draft-text"><b>{t('rpx.ov.draftLabel')}</b> · {t('rpx.ov.version', { v: fmtNumber(d.response.version ?? 0) })}<div>{d.response.text}</div></div> : <p className="sub">{t('rpx.ov.noDraft')}</p>}
        {d.response.state === 'approved' ? <p className="sub">{d.response.canPublishToProvider ? t('rpx.ov.publishNote') : t('rpx.ov.noProviderPublish')}</p> : null}
        {rejecting ? <div className="dupx-form"><label className="rvw-f"><span>{t('rpx.ov.rejectReason')}</span><textarea data-testid="rpx-reject-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <button className="btn ghost" onClick={() => setRejecting(false)}>{t('rpx.cancel')}</button>
          <button className="btn" data-testid="rpx-reject-save" disabled={busy || !reason.trim()} onClick={() => void act(() => apiR.reject(id, reason.trim()), 'rejected')}>{t('rpx.ov.reject')}</button></div> : null}
        {d.response.approvals.length ? <><h4>{t('rpx.ov.history')}</h4>{d.response.approvals.map((a: any, i: number) => <div key={i} className="rvw-ev">{when(a.at, true)} · <b>{t('rpx.act.' + a.action)}</b>{a.by ? ` · ${a.by}` : ''}{a.reason ? ` · ${a.reason}` : ''}</div>)}</> : null}
        {d.complaint ? <><h4>{t('rpx.ov.complaint')}</h4><p data-testid="rpx-case">{t('rpx.case.' + (d.complaint.status === 'resolved' || d.complaint.status === 'acknowledged' ? d.complaint.status : 'open'))} · {statusLabel('severity', d.complaint.severity)}
          {d.complaint.signals.length ? ` · ${t('rpx.ov.signals', { s: d.complaint.signals.join(', ') })}` : ''}{d.complaint.assignee ? ` · ${d.complaint.assignee}` : ''}</p><p className="sub">{t('rpx.ov.caseNote')}</p></> : null}
        <h4>{t('rpx.ov.notes')}</h4>
        {d.notes.map((n: any) => <div key={n.id} className="rvw-ev">{when(n.at, true)}{n.by ? ` · ${n.by}` : ''} · {n.note}</div>)}
        {manage ? <div className="rvw-filters"><input className="rvw-search" data-testid="rpx-note" value={note} maxLength={4000} placeholder={t('rpx.ov.notePlaceholder')} onChange={(e) => setNote(e.target.value)} />
          <button className="btn ghost" data-testid="rpx-note-save" disabled={busy || !note.trim()} onClick={() => void act(() => apiR.addNote(id, note.trim()), 'noted')}>{t('rpx.ov.addNote')}</button></div> : null}
        {d.recovery.length ? <><h4>{t('rpx.ov.recovery')}</h4>{d.recovery.map((x: any, i: number) => <div key={i} className="rvw-ev">{when(x.at)} · {statusLabel('recoveryAction', x.type)} · {statusLabel('recoveryStatus', x.status)}</div>)}</> : null}
        <p className="sub">{t('rpx.ov.noMoney')}</p>
      </>}
    </FitDialog>
  );
}

function HealthDialog({ data, onClose }: { data: any; onClose: () => void }) {
  return (
    <FitDialog wide testId="rpx-health" title={t('rpx.check')} subtitle={data && data !== 'loading' && !data.error ? t('rpx.health.overall', { s: t('rpx.health.' + data.overall), at: when(data.checkedAt, true) }) : undefined} onClose={onClose}
      footer={<button className="btn ghost" onClick={onClose}>{t('rpx.close')}</button>}>
      {data === 'loading' ? <div className="state">{t('rpx.health.running')}</div> : data.error ? <div className="err">{data.error}</div> : <>
        <p className="sub">{t('rpx.health.readOnly')}{data.reused ? ` ${t('rpx.health.recent')}` : ''}</p>
        {data.checks.map((x: any) => (
          <div key={x.key} className="rvw-check" data-testid={`chk-${x.key}`}>
            <div><span className={'chip ' + (STATE_TONE[x.state] ?? '')} data-testid={`chk-${x.key}-state`}>{t('rpx.health.' + x.state)}</span> <b>{t('rpx.health.k.' + x.key)}</b>{x.count ? <span className="sub"> · {fmtNumber(x.count)}</span> : null}</div>
            <div className="sub">{t('rpx.health.d.' + x.key + '.' + x.state)}</div>
          </div>
        ))}
      </>}
    </FitDialog>
  );
}
