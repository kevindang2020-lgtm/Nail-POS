// POSReviewsScreen.tsx — Marketing & Growth → Reviews (/tenant/marketing/reviews). Reviews & Reputation guide (Oct 30 2026).
// Rebuilt IN PLACE: the header, the five KPI cards, Rating Distribution, At a Glance, the Review Feed and Hide stay where they
// were. Added: Needs Attention, server search (customer only through a real link · technician · comment · IDs · ticket), filters,
// a From/To month calendar with a date basis, newest-first pages 10/20/50, the review overlay (review / customer / technician /
// visit / reply history / moderation trail, Close, Open Booking), reason-coded Hide / Unhide (version-checked, recorded), the
// assistant's facts and the read-only Check Review System. Every number is the server's, with its scope stated.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posReviewsCenterApi, type ReviewQuery } from '../api/posReviewsCenterApi';
import { useCan } from '../components/usePermissions';
import { errorTextOf } from '../i18n/error-text';
import { fmtNumber, fmtInZone, fmtMoney } from '../i18n/format';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry, useDebounced, requestId } from '../components/FitKit';
import { RangeCalendar, isForbidden } from '../components/FinanceKit';

const t = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const stars = (n: number | null | undefined) => { if (n == null) return '☆☆☆☆☆'; const full = Math.max(0, Math.min(5, Math.round(n))); return '★★★★★'.slice(0, full) + '☆☆☆☆☆'.slice(0, 5 - full); };
const when = (iso?: string | null, withTime = false) => (iso ? fmtInZone(iso, withTime ? { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const URL_KEYS = ['rating', 'comment', 'visibility', 'followup', 'technician', 'service', 'source', 'basis', 'preset', 'from', 'to', 'sort', 'page', 'pageSize'] as const;
const HIDE_REASONS = ['spam', 'abusive_language', 'personal_information', 'wrong_salon_or_customer', 'duplicate', 'test_review', 'other'];
const STATE_TONE: Record<string, 'ok' | 'warn' | 'bad' | undefined> = { READY: 'ok', WARNING: 'warn', FAILED: 'bad', UNKNOWN: undefined };

export function POSReviewsScreen() {
  const nav = useNavigate();
  const can = useCan();
  const canManage = can('marketing.manage') || can('pos.marketing.manage');   // the role grant is `marketing.manage` (useCan matches literally)
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');   // the search text never goes into the URL (it can hold a phone or email)
  const dq = useDebounced(q, 300);
  const f = useMemo(() => { const o: Record<string, string> = {}; for (const k of URL_KEYS) { const v = sp.get(k); if (v) o[k] = v; } return o; }, [sp]);
  const setF = (patch: Record<string, string | null>, keepPage = false) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    if (!keepPage) next.delete('page');
    setSp(next, { replace: true });
  };
  const query: ReviewQuery = { ...f, q: dq || undefined, page: Number(f.page ?? 1), pageSize: Number(f.pageSize ?? 20) };
  // the KPI strip follows the date range AND the technician / source filters of the list beside it
  const range = { ...(f.preset ? { preset: f.preset, from: f.from, to: f.to } : {}), technician: f.technician || undefined, source: f.source || undefined };

  const [sum, setSum] = useState<any>(null);
  const [list, setList] = useState<any>(null);
  const [opts, setOpts] = useState<{ technicians: { id: string; name: string }[]; services: { id: string; name: string }[]; sources: { source: string; count: number }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [cal, setCal] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [mod, setMod] = useState<{ id: string; action: 'hide' | 'unhide'; version: number; rating: number; external: boolean } | null>(null);
  const [health, setHealth] = useState<any | 'loading' | null>(null);
  const [insights, setInsights] = useState<any | 'loading' | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setErr(null);
    try {
      const [s, l] = await Promise.all([posReviewsCenterApi.summary(range), posReviewsCenterApi.reviews(query)]);
      setSum(s); setList(l); setLoadedAt(new Date().toISOString());
    } catch (e) { setErr(isForbidden(e) ? t('rvw.noAccess') : errorTextOf(e, t('rvw.loadFailed'))); }
    finally { if (!silent) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(query), JSON.stringify(range)]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { posReviewsCenterApi.options().then(setOpts).catch(() => setOpts(null)); }, []);
  // live refresh: a new matching review shows up on its own; an open overlay or dialog is never interrupted
  useEffect(() => { const h = setInterval(() => { if (!openId && !mod && !cal) load(true); }, 60_000); return () => clearInterval(h); }, [load, openId, mod, cal]);

  const k = sum;
  const dist: { star: number; count: number }[] = k?.ratingDistribution ?? [];
  const maxBucket = Math.max(1, ...dist.map((d) => d.count));
  const anyFilter = URL_KEYS.some((x) => f[x] && x !== 'page' && x !== 'pageSize') || !!q;
  const sel = (key: string, label: string, options: [string, string][], testId: string) => (
    <label className="rvw-f"><span>{label}</span>
      <select data-testid={testId} value={f[key] ?? ''} onChange={(e) => setF({ [key]: e.target.value || null })}>
        <option value="">{t('rvw.any')}</option>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select></label>
  );

  return (
    <div className="work rvw" data-testid="reviews-screen">
      <div className="vh rvw-head">
        <div><h1>{t('rvw.title')}</h1><div className="sub">{t('rvw.subtitle')}</div></div>
        <div className="rvw-actions">
          <span className="sub" data-testid="rvw-updated">{loadedAt ? t('rvw.updated', { time: when(loadedAt, true) }) : ''}</span>
          <button className="btn ghost" data-testid="rvw-refresh" onClick={() => load()}>{t('rvw.refresh')}</button>
          <button className="btn ghost" data-testid="rvw-assistant" onClick={() => { setInsights('loading'); posReviewsCenterApi.insights(range).then(setInsights).catch((e) => setInsights({ error: errorTextOf(e, t('rvw.loadFailed')) })); }}>{t('rvw.assistant')}</button>
          <button className="btn" data-testid="rvw-check" onClick={() => { setHealth('loading'); posReviewsCenterApi.check().then(setHealth).catch((e) => setHealth({ error: errorTextOf(e, t('rvw.loadFailed')) })); }}>{t('rvw.check')}</button>
        </div>
      </div>

      {err ? <ErrorRetry message={err} onRetry={() => load()} /> : null}

      <div className="rvw-kpis" data-testid="rvw-kpis">
        <KpiCard testId="kpi-avg" label={t('rvw.kpi.avg')} loading={loading && !k} tone="gold"
          value={k?.averageRating == null ? t('rvw.na') : k.averageRating.toFixed(1)}
          sub={<span title={k?.scope?.rating}><span className="rvw-stars">{stars(k?.averageRating)}</span> {k ? t('rvw.kpi.avgSub', { n: fmtNumber(k.verifiedReviews) }) : ''}</span>} />
        <KpiCard testId="kpi-total" label={t('rvw.kpi.total')} loading={loading && !k} value={k ? fmtNumber(k.totalReviews) : '—'} sub={k ? t('rvw.kpi.totalSub', { s: fmtNumber(k.spamCount) }) : undefined} />
        <KpiCard testId="kpi-public" label={t('rvw.kpi.public')} loading={loading && !k} value={k ? fmtNumber(k.publicCount) : '—'} sub={t('rvw.kpi.publicSub')} onClick={() => setF({ visibility: 'public' })} />
        <KpiCard testId="kpi-hidden" label={t('rvw.kpi.hidden')} loading={loading && !k} value={k ? fmtNumber(k.hiddenCount) : '—'} tone={k?.hiddenLowStarCount ? 'warn' : undefined}
          sub={k?.hiddenLowStarCount ? t('rvw.kpi.hiddenLow', { n: fmtNumber(k.hiddenLowStarCount) }) : t('rvw.kpi.hiddenSub')} onClick={() => setF({ visibility: 'hidden' })} />
        <KpiCard testId="kpi-five" label={t('rvw.kpi.five')} loading={loading && !k} value={k?.fiveStarPercent == null ? t('rvw.na') : `${k.fiveStarPercent}%`} sub={t('rvw.kpi.fiveSub')} />
        <KpiCard testId="kpi-attention" label={t('rvw.kpi.attention')} loading={loading && !k} value={k ? fmtNumber(k.needsAttention) : '—'} tone={k?.needsAttention ? 'bad' : 'ok'}
          sub={t('rvw.kpi.attentionSub')} onClick={() => setF({ followup: 'needs_attention', sort: 'attention' })} />
      </div>

      <div className="rvw-analysis">
        <section className="panel" data-testid="rvw-dist">
          <div className="p-h">{t('rvw.dist')}<span className="sub rvw-scope">{t('rvw.distScope')}</span></div>
          {!k ? null : k.verifiedReviews === 0 ? <Empty title={t('rvw.noReviews')} /> : dist.map((d) => (
            <button key={d.star} className="rvw-bar" data-testid={`dist-${d.star}`} onClick={() => setF({ rating: String(d.star) })} aria-label={t('rvw.filterStars', { n: d.star })}>
              <span className="rvw-bar-l">{d.star}★</span>
              <span className="rvw-bar-t"><span style={{ width: `${Math.round((d.count / maxBucket) * 100)}%` }} /></span>
              <span className="rvw-bar-n">{d.count}</span>
            </button>
          ))}
        </section>
        <section className="panel" data-testid="rvw-glance">
          <div className="p-h">{t('rvw.glance')}</div>
          {k ? <ul className="rvw-glance">
            <li data-testid="glance-written">{t('rvw.glanceWritten', { n: fmtNumber(k.withCommentCount), total: fmtNumber(k.totalReviews) })}</li>
            <li data-testid="glance-hidden">{t('rvw.glanceHidden', { n: fmtNumber(k.hiddenCount) })}</li>
            <li data-testid="glance-five">{k.fiveStarPercent == null ? t('rvw.glanceFiveNa') : t('rvw.glanceFive', { p: k.fiveStarPercent })}</li>
            <li data-testid="glance-all">{k.averageAllReceived == null ? t('rvw.glanceAllNa') : t('rvw.glanceAll', { a: k.averageAllReceived.toFixed(1), n: fmtNumber(k.receivedReviews) })}</li>
            <li className="sub">{t('rvw.glanceScope')}</li>
          </ul> : null}
        </section>
      </div>

      <section className="panel rvw-filters" data-testid="rvw-filters">
        <input className="rvw-search" data-testid="rvw-search" value={q} onChange={(e) => { setQ(e.target.value); if (f.page) setF({}, false); }} placeholder={t('rvw.searchPh')} aria-label={t('rvw.searchPh')} />
        {sel('rating', t('rvw.f.rating'), [['5', '5★'], ['4', '4★'], ['3', '3★'], ['2', '2★'], ['1', '1★']], 'flt-rating')}
        {sel('comment', t('rvw.f.comment'), [['written', t('rvw.f.written')], ['star_only', t('rvw.f.starOnly')]], 'flt-comment')}
        {sel('visibility', t('rvw.f.visibility'), [['public', t('rvw.vis.public')], ['not_public', t('rvw.vis.not_public')], ['hidden', t('rvw.vis.hidden')], ['spam', t('rvw.vis.spam')]], 'flt-visibility')}
        {sel('followup', t('rvw.f.followup'), [['unanswered', t('rvw.fu.unanswered')], ['responded', t('rvw.fu.responded')], ['needs_attention', t('rvw.fu.needs_attention')], ['reviewed', t('rvw.fu.reviewed')]], 'flt-followup')}
        {sel('technician', t('rvw.f.technician'), [['none', t('rvw.noTech')], ...(opts?.technicians ?? []).map((x) => [x.id, x.name] as [string, string])], 'flt-technician')}
        {sel('service', t('rvw.f.service'), (opts?.services ?? []).map((x) => [x.id, x.name] as [string, string]), 'flt-service')}
        {sel('source', t('rvw.f.source'), (opts?.sources ?? []).map((x) => [x.source, `${t('rvw.src.' + x.source)} (${x.count})`] as [string, string]), 'flt-source')}
        {sel('sort', t('rvw.f.sort'), [['oldest', t('rvw.sort.oldest')], ['lowest', t('rvw.sort.lowest')], ['highest', t('rvw.sort.highest')], ['moderated', t('rvw.sort.moderated')], ['attention', t('rvw.sort.attention')]], 'flt-sort')}
        <div className="rvw-dates" data-testid="rvw-dates">
          {(['today', 'week', 'month', 'year'] as const).map((p) => <button key={p} className={'btn ghost' + (f.preset === p ? ' on' : '')} data-testid={`preset-${p}`} onClick={() => setF({ preset: f.preset === p ? null : p, from: null, to: null })}>{t('rvw.preset.' + p)}</button>)}
          <button className={'btn ghost' + (f.preset === 'custom' ? ' on' : '')} data-testid="preset-custom" onClick={() => setCal(true)}>{f.preset === 'custom' ? `${f.from} → ${f.to}` : t('rvw.preset.custom')}</button>
          <label className="rvw-f"><span>{t('rvw.f.basis')}</span>
            <select data-testid="flt-basis" value={f.basis ?? 'submitted'} onChange={(e) => setF({ basis: e.target.value === 'submitted' ? null : e.target.value })}>
              {['submitted', 'service', 'moderated', 'response'].map((b) => <option key={b} value={b}>{t('rvw.basis.' + b)}</option>)}
            </select></label>
        </div>
        {anyFilter ? <button className="btn ghost" data-testid="flt-clear" onClick={() => { setQ(''); setSp(new URLSearchParams(), { replace: true }); }}>{t('rvw.clearAll')}</button> : null}
        {cal ? <div className="rvw-cal" data-testid="rvw-cal"><RangeCalendar initial={{ from: f.from, to: f.to }} today={list?.today ?? new Date().toISOString().slice(0, 10)}
          onApply={(r) => { setF({ preset: 'custom', from: r.from, to: r.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { setF({ preset: null, from: null, to: null }); setCal(false); }} /></div> : null}
      </section>

      <section className="panel rvw-feed" data-testid="rvw-feed">
        <div className="p-h">{t('rvw.feed')}
          <span className="sub rvw-scope" data-testid="rvw-count">{list ? t('rvw.count', { n: fmtNumber(list.totalItems), basis: t('rvw.basis.' + (list.basis ?? 'submitted')), range: list.range ? `${list.range.from} – ${list.range.to}` : t('rvw.allTime') }) : ''}</span>
        </div>
        {loading && !list ? <div className="state">{t('rvw.loading')}</div> : !list || list.items.length === 0 ? <Empty title={anyFilter ? t('rvw.noMatch') : t('rvw.noReviews')} /> : (
          <div className="rvw-table-wrap">
            <table className="tbl rvw-table">
              <thead><tr><th>{t('rvw.col.customer')}</th><th>{t('rvw.col.rating')}</th><th>{t('rvw.col.comment')}</th><th>{t('rvw.col.technician')}</th><th>{t('rvw.col.service')}</th><th>{t('rvw.col.date')}</th><th>{t('rvw.col.visibility')}</th><th></th></tr></thead>
              <tbody>{list.items.map((r: any) => (
                <tr key={r.id} data-testid="rvw-row" className={r.isHidden || r.isSpam ? 'muted' : ''} onClick={() => setOpenId(r.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(r.id); }}>
                  <td>{r.customer ? r.customer.name : <span className="sub">{t('rvw.anonymous')}</span>}</td>
                  <td className="rvw-stars" title={String(r.rating)}>{stars(r.rating)}</td>
                  <td className="rvw-comment">{r.comment ?? <span className="sub">{t('rvw.starOnly')}</span>}{r.needsAttention ? <span className="chip bad">{t('rvw.attentionChip')}</span> : null}</td>
                  <td>{r.technician?.name ?? <span className="sub">—</span>}</td>
                  <td>{r.serviceName ?? <span className="sub">—</span>}</td>
                  <td className="nowrap">{when(r.submittedAt)}</td>
                  <td><span className={'chip ' + (r.visibility === 'public' ? 'ok' : r.visibility === 'hidden' || r.visibility === 'spam' ? 'bad' : '')}>{t('rvw.vis.' + r.visibility)}</span>{r.external ? <span className="chip">{t('rvw.src.' + r.source)}</span> : null}</td>
                  <td className="nowrap" onClick={(e) => e.stopPropagation()}>
                    {canManage ? <button className="btn ghost" data-testid={r.isHidden ? 'rvw-unhide' : 'rvw-hide'} onClick={() => setMod({ id: r.id, action: r.isHidden ? 'unhide' : 'hide', version: r.moderationVersion, rating: r.rating, external: r.external })}>{r.isHidden ? t('rvw.unhide') : t('rvw.hide')}</button> : null}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <div className="rvw-pager">
          <Pager info={list} onPage={(p) => setF({ page: String(p) }, true)} />
          <label className="rvw-f"><span>{t('rvw.rows')}</span>
            <select data-testid="rvw-pagesize" value={String(query.pageSize)} onChange={(e) => setF({ pageSize: e.target.value === '20' ? null : e.target.value })}>
              {['10', '20', '50'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select></label>
        </div>
      </section>

      {openId ? <ReviewOverlay id={openId} canManage={canManage} onClose={() => setOpenId(null)} onModerate={(m) => setMod(m)}
        onBook={(cid) => nav(`/booking/new?customerId=${encodeURIComponent(cid)}&from=reviews`)} onProfile={(cid) => nav(`/tenant/customers/profiles?customerId=${encodeURIComponent(cid)}`)} /> : null}
      {mod ? <ModerateDialog m={mod} onClose={() => setMod(null)} onDone={() => { setMod(null); load(true); if (openId) { const x = openId; setOpenId(null); setTimeout(() => setOpenId(x), 0); } }} /> : null}
      {health ? <HealthDialog data={health} onClose={() => setHealth(null)} /> : null}
      {insights ? <InsightsDialog data={insights} onClose={() => setInsights(null)} onOpen={(id) => { setInsights(null); setOpenId(id); }} onDrafts={() => nav('/tenant/ai/reviews')} /> : null}
    </div>
  );
}

function ReviewOverlay({ id, canManage, onClose, onModerate, onBook, onProfile }: { id: string; canManage: boolean; onClose: () => void; onModerate: (m: { id: string; action: 'hide' | 'unhide'; version: number; rating: number; external: boolean }) => void; onBook: (cid: string) => void; onProfile: (cid: string) => void }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState('review');
  useEffect(() => { setD(null); setErr(null); posReviewsCenterApi.review(id).then(setD).catch((e) => setErr(errorTextOf(e, t('rvw.loadFailed')))); }, [id]);
  const tabs = ['review', 'customer', 'technician', 'visit', 'response', 'moderation'];
  const r = d?.review;
  return (
    <FitDialog wide testId="rvw-overlay" title={t('rvw.ov.title')} subtitle={r ? `${stars(r.rating)} · ${when(r.submittedAt)}` : undefined} onClose={onClose}
      footer={<div className="rvw-ov-foot">
        {d?.customer?.canBook ? <button className="btn" data-testid="ov-book" onClick={() => onBook(d.customer.id)}>{t('rvw.ov.book')}</button>
          : <button className="btn" disabled title={t('rvw.ov.bookDisabled')} data-testid="ov-book">{t('rvw.ov.book')}</button>}
        {d?.customer ? <button className="btn ghost" data-testid="ov-profile" onClick={() => onProfile(d.customer.id)}>{t('rvw.ov.profile')}</button> : null}
        {canManage && r ? <button className="btn ghost" data-testid="ov-moderate" onClick={() => onModerate({ id: r.id, action: r.isHidden ? 'unhide' : 'hide', version: r.moderationVersion, rating: r.rating, external: r.external })}>{r.isHidden ? t('rvw.unhide') : t('rvw.hide')}</button> : null}
        <button className="btn ghost" data-testid="ov-close" onClick={onClose}>{t('rvw.close')}</button>
      </div>}>
      {err ? <div className="err">{err}</div> : !d ? <div className="state">{t('rvw.loading')}</div> : <>
        <div className="rvw-tabs" role="tablist">{tabs.map((x) => <button key={x} role="tab" aria-selected={tab === x} className={'btn ghost' + (tab === x ? ' on' : '')} data-testid={`ov-tab-${x}`} onClick={() => setTab(x)}>{t('rvw.ov.tab.' + x)}</button>)}</div>
        <div className="rvw-ov-body" data-testid={`ov-${tab}`}>
          {tab === 'review' ? <dl className="rvw-dl">
            <dt>{t('rvw.ov.id')}</dt><dd className="mono">{r.id}</dd>
            <dt>{t('rvw.ov.rating')}</dt><dd><span className="rvw-stars">{stars(r.rating)}</span> {r.rating}</dd>
            <dt>{t('rvw.ov.comment')}</dt><dd data-testid="ov-comment">{r.comment ?? <span className="sub">{t('rvw.starOnly')}</span>}</dd>
            {r.tags?.length ? <><dt>{t('rvw.ov.tags')}</dt><dd>{r.tags.join(', ')}</dd></> : null}
            <dt>{t('rvw.ov.source')}</dt><dd>{t('rvw.src.' + r.source)}{r.externalReviewId ? ` · ${r.externalReviewId}` : ''}</dd>
            <dt>{t('rvw.ov.branch')}</dt><dd>{r.branch?.name ?? '—'}</dd>
            <dt>{t('rvw.ov.visibility')}</dt><dd data-testid="ov-visibility">{t('rvw.vis.' + (r.isSpam ? 'spam' : r.isHidden ? 'hidden' : r.isPublic ? 'public' : 'not_public'))}{r.hiddenReason ? ` — ${r.hiddenReason}` : ''}</dd>
            <dt>{t('rvw.ov.metric')}</dt><dd data-testid="ov-metric">{d.metric.why}</dd>
            <dt>{t('rvw.ov.created')}</dt><dd>{when(r.createdAt, true)} · {t('rvw.ov.updatedAt')} {when(r.updatedAt, true)}</dd>
            <dt>{t('rvw.ov.scope')}</dt><dd data-testid="ov-scope">{d.moderationScope}</dd>
          </dl> : null}
          {tab === 'customer' ? (d.customer ? <dl className="rvw-dl">
            <dt>{t('rvw.ov.name')}</dt><dd>{d.customer.name}</dd>
            <dt>{t('rvw.ov.phone')}</dt><dd>{d.customer.phone ?? '—'}</dd><dt>{t('rvw.ov.email')}</dt><dd>{d.customer.email ?? '—'}</dd>
            {d.customer.contactMasked ? <><dt /><dd className="sub">{t('rvw.ov.masked')}</dd></> : null}
            <dt>{t('rvw.ov.visits')}</dt><dd>{fmtNumber(d.customer.visits)} · {t('rvw.ov.lastVisit')} {when(d.customer.lastVisitAt)}</dd>
            <dt>{t('rvw.ov.reviews')}</dt><dd>{fmtNumber(d.customer.reviews)}</dd><dt>{t('rvw.ov.messages')}</dt><dd>{fmtNumber(d.customer.messages)}</dd>
            <dt>{t('rvw.ov.prior')}</dt><dd>{d.customer.priorReviews.length ? d.customer.priorReviews.map((p: any) => `${stars(p.rating)} ${when(p.at)}`).join(' · ') : '—'}</dd>
          </dl> : <Empty title={t('rvw.ov.anonymous')}>{t('rvw.ov.anonymousSub')}</Empty>) : null}
          {tab === 'technician' ? (d.technician ? <dl className="rvw-dl" data-testid="ov-tech-stats">
            <dt>{t('rvw.ov.technician')}</dt><dd>{d.technician.name}</dd>
            <dt>{t('rvw.ov.verifiedRating')}</dt><dd>{d.technician.verifiedAverage == null ? t('rvw.na') : d.technician.verifiedAverage.toFixed(1)} ({t('rvw.ov.nReviews', { n: d.technician.verifiedCount })})</dd>
            <dt>{t('rvw.ov.last90')}</dt><dd>{d.technician.last90Average == null ? t('rvw.na') : d.technician.last90Average.toFixed(1)} ({t('rvw.ov.nReviews', { n: d.technician.last90Count })})</dd>
            <dt>{t('rvw.ov.publicRating')}</dt><dd>{d.technician.publicAverage == null ? t('rvw.na') : d.technician.publicAverage.toFixed(1)} ({t('rvw.ov.nReviews', { n: d.technician.publicCount })})</dd>
            <dt /><dd className="sub">{t('rvw.ov.techScope')}</dd>
          </dl> : <Empty title={t('rvw.ov.noTech')} />) : null}
          {tab === 'visit' ? (d.visit ? <dl className="rvw-dl">
            <dt>{t('rvw.ov.ticket')}</dt><dd>{d.visit.ticketNumber ?? d.visit.ticketId ?? '—'} {d.visit.ticketStatus ? `· ${d.visit.ticketStatus}` : ''}</dd>
            <dt>{t('rvw.ov.service')}</dt><dd>{d.visit.serviceName ?? '—'}</dd>
            <dt>{t('rvw.ov.paid')}</dt><dd>{when(d.visit.paidAt, true)}{d.visit.totalCents != null ? ` · ${fmtMoney(d.visit.totalCents)}` : ''}</dd>
            <dt>{t('rvw.ov.appointment')}</dt><dd>{d.visit.appointmentDate ? `${d.visit.appointmentDate} ${d.visit.appointmentStart ?? ''} · ${d.visit.appointmentStatus ?? ''}` : '—'}</dd>
          </dl> : <Empty title={t('rvw.ov.noVisit')} />) : null}
          {tab === 'response' ? <div>
            <p className="sub" data-testid="ov-publishable">{t('rvw.ov.pub.' + d.response.publishable)}</p>
            {d.response.draft ? <div className="panel"><b>{t('rvw.ov.draftStatus', { s: d.response.draft.status, v: d.response.draft.version })}</b>{d.response.draft.aiGenerated ? <span className="chip">{t('rvw.ov.aiTag')}</span> : null}<p>{d.response.draft.text}</p></div> : <Empty title={t('rvw.ov.noResponse')} />}
            {[...d.response.approvals.map((a: any) => ({ at: a.at, txt: `${t('rvw.ov.approval')}: ${a.action}${a.reason ? ` — ${a.reason}` : ''}` })), ...d.response.publications.map((p: any) => ({ at: p.at, txt: `${t('rvw.ov.publication')}: ${p.result}${p.error ? ` — ${p.error}` : ''}` }))]
              .sort((a, b) => (a.at < b.at ? 1 : -1)).map((x, i) => <div key={i} className="rvw-ev"><span className="sub">{when(x.at, true)}</span> {x.txt}</div>)}
            {r.technicianResponse ? <div className="rvw-ev"><span className="sub">{when(r.technicianResponseAt, true)}</span> {t('rvw.ov.techResponse')}: {r.technicianResponse}</div> : null}
          </div> : null}
          {tab === 'moderation' ? (d.moderation.length ? d.moderation.map((e: any, i: number) => (
            <div key={i} className="rvw-ev" data-testid="ov-mod-event"><span className="sub">{when(e.at, true)}</span> <b>{t('rvw.mod.' + e.action)}</b> · {e.actor?.name ?? t('rvw.ov.unknownActor')}
              {e.reasonCode ? ` · ${t('rvw.reason.' + e.reasonCode)}` : ''}{e.reasonText ? ` — ${e.reasonText}` : ''}{e.evidence ? ` (${e.evidence})` : ''}</div>
          )) : <Empty title={t('rvw.ov.noModeration')} />) : null}
        </div>
      </>}
    </FitDialog>
  );
}

function ModerateDialog({ m, onClose, onDone }: { m: { id: string; action: 'hide' | 'unhide'; version: number; rating: number; external: boolean }; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [text, setText] = useState('');
  const [evidence, setEvidence] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [key] = useState(() => requestId());
  const hide = m.action === 'hide';
  const low = m.rating <= 2;
  const ok = !hide || (reason && (reason !== 'other' || text.trim().length >= 5) && !(low && reason === 'other'));
  const go = async () => {
    setBusy(true); setErr(null);
    try { await posReviewsCenterApi.moderate(m.id, { action: m.action, reasonCode: hide ? reason : null, reasonText: text.trim() || null, evidence: evidence.trim() || null, expectedVersion: m.version, idempotencyKey: key }); onDone(); }
    catch (e) { setErr(errorTextOf(e, t('rvw.mod.failed'))); }
    finally { setBusy(false); }
  };
  return (
    <FitDialog testId="rvw-moderate" title={hide ? t('rvw.mod.hideTitle') : t('rvw.mod.unhideTitle')} onClose={onClose} busy={busy}
      footer={<><button className="btn ghost" onClick={onClose}>{t('rvw.cancel')}</button><button className="btn" data-testid="mod-confirm" disabled={!ok || busy} onClick={go}>{hide ? t('rvw.hide') : t('rvw.unhide')}</button></>}>
      <p data-testid="mod-scope">{m.external ? t('rvw.mod.externalScope') : hide ? t('rvw.mod.hideScope') : t('rvw.mod.unhideScope')}</p>
      {hide ? <>
        {low ? <p className="warn" data-testid="mod-low">{t('rvw.mod.lowWarn')}</p> : null}
        <label className="rvw-f block"><span>{t('rvw.mod.reason')}</span>
          <select data-testid="mod-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">{t('rvw.mod.choose')}</option>{HIDE_REASONS.filter((x) => !(low && x === 'other')).map((x) => <option key={x} value={x}>{t('rvw.reason.' + x)}</option>)}
          </select></label>
      </> : null}
      <label className="rvw-f block"><span>{hide ? t('rvw.mod.details') : t('rvw.mod.note')}</span><textarea data-testid="mod-text" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} /></label>
      {hide ? <label className="rvw-f block"><span>{t('rvw.mod.evidence')}</span><input data-testid="mod-evidence" value={evidence} maxLength={500} onChange={(e) => setEvidence(e.target.value)} /></label> : null}
      {err ? <div className="err" data-testid="mod-error">{err}</div> : null}
    </FitDialog>
  );
}

function HealthDialog({ data, onClose }: { data: any; onClose: () => void }) {
  return (
    <FitDialog wide testId="rvw-health" title={t('rvw.check')} subtitle={data && data !== 'loading' && !data.error ? t('rvw.health.overall', { s: t('rvw.health.' + data.overall), at: when(data.checkedAt, true) }) : undefined} onClose={onClose}
      footer={<button className="btn ghost" onClick={onClose}>{t('rvw.close')}</button>}>
      {data === 'loading' ? <div className="state">{t('rvw.health.running')}</div> : data.error ? <div className="err">{data.error}</div> : <>
        <p className="sub">{t('rvw.health.readOnly')}</p>
        {data.checks.map((c: any) => (
          <div key={c.key} className="rvw-check" data-testid={`chk-${c.key}`}>
            <div><span className={'chip ' + (STATE_TONE[c.state] ?? '')} data-testid={`chk-${c.key}-state`}>{t('rvw.health.' + c.state)}</span> <b>{t('rvw.health.k.' + c.key)}</b></div>
            <div className="sub">{c.evidence}</div>
            {c.action ? <div><b>{t('rvw.health.next')}</b> {c.action}</div> : null}
          </div>
        ))}
      </>}
    </FitDialog>
  );
}

function InsightsDialog({ data, onClose, onOpen, onDrafts }: { data: any; onClose: () => void; onOpen: (id: string) => void; onDrafts: () => void }) {
  return (
    <FitDialog testId="rvw-insights" title={t('rvw.assistant')} onClose={onClose}
      footer={<><button className="btn ghost" data-testid="ins-drafts" onClick={onDrafts}>{t('rvw.ins.drafts')}</button><button className="btn ghost" onClick={onClose}>{t('rvw.close')}</button></>}>
      {data === 'loading' ? <div className="state">{t('rvw.loading')}</div> : data.error ? <div className="err">{data.error}</div> : <>
        <p className="sub">{t('rvw.ins.rules')}</p>
        {data.status === 'insufficient_written_feedback'
          ? <div className="panel" data-testid="ins-insufficient"><b>{t('rvw.ins.insufficient')}</b><p>{t('rvw.ins.insufficientSub', { n: data.writtenComments, min: data.minimum, s: data.starOnly })}</p></div>
          : <div data-testid="ins-themes"><p>{t('rvw.ins.basis', { n: data.writtenComments, neg: data.negativeWritten ?? 0 })}</p>
            {data.themes.length ? data.themes.map((x: any) => <div key={x.theme} className="rvw-ev"><b>{x.theme}</b> · {t('rvw.ov.nReviews', { n: x.reviews })}{x.reviewIds.slice(0, 3).map((id: string) => <button key={id} className="btn ghost sm" onClick={() => onOpen(id)}>{t('rvw.ins.open')}</button>)}</div>)
              : <p className="sub">{t('rvw.ins.noThemes')}</p>}</div>}
      </>}
    </FitDialog>
  );
}
