// CommunityFeedScreen.tsx — /community: the Safety Community feed (BUILD_PLAN Phase 8, contract §5). Published,
// sanitized advisories from verified salons. Filters (category, severity, region, active / resolved / all), text search
// (the server refuses customer identifiers — shown in plain words), sort (newest / most active / severity), paging and
// "following only". Each post opens /community/posts/:id. Realtime `community_*` (refetch key "community") reloads.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { CommunityCategory, CommunityFeedQuery, CommunityPage, CommunityPostView, CommunitySeverity } from '@aipowersalon/api-contracts/tenant';
import { useCan } from '../../components/usePermissions';
import { useRealtime } from '../../realtime/useRealtime';
import { posCommunityApi as api } from '../../api/posCommunityApi';
import {
  P, CATEGORIES, CATEGORY_LABEL, SEVERITIES, SEVERITY_LABEL, LABEL_TEXT, CommunityHeader, CommunitySubNav, SeverityPill, StatusPill,
  authorText, body, btnGhost, btnGold, card, communityErrorText, errText, input, muted, page, row, when,
} from './communityUi';
import { t, enPlural } from '@aipowersalon/mobile-sdk/i18n';
import { KpiCard, Pager, FitDialog } from '../../components/FitKit';
import { fmtNumber } from '../../i18n/format';

/** Safety Community SUNMI guide (Nov 9 2026): verified overview cards — each one a real count the role may read, "—" when it
 *  cannot be read (never a guessed 0) and absent when the role has no access to that module. */
type Overview = { active: number | null; following: number | null; drafts: number | null; awaiting: number | null; incidents: number | null };
const count = (p: Promise<{ total?: number } | unknown[]>) => p.then((r) => (Array.isArray(r) ? r.length : Number((r as { total?: number }).total ?? 0))).catch(() => null);

const PAGE_SIZE = 25;   // SUNMI guide (Nov 9 2026): 25 per page, newest first, numbered pages
type Sort = NonNullable<CommunityFeedQuery['sort']>;
type StatusFilter = NonNullable<CommunityFeedQuery['status']>;

export function CommunityFeedScreen() {
  const can = useCan();
  const nav = useNavigate();
  const [category, setCategory] = useState<CommunityCategory | ''>('');
  const [severity, setSeverity] = useState<CommunitySeverity | ''>('');
  const [region, setRegion] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [sort, setSort] = useState<Sort>('newest');
  const [followingOnly, setFollowingOnly] = useState(false);
  const [qDraft, setQDraft] = useState('');
  const [q, setQ] = useState('');
  const [pageNo, setPageNo] = useState(1);
  const [data, setData] = useState<CommunityPage<CommunityPostView> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const canView = can(P.view);
  const [ov, setOv] = useState<Overview | null>(null);
  const [health, setHealth] = useState<null | 'loading' | { key: string; ok: boolean | null }[]>(null);
  const canDraft = can(P.draft), canApprove = can(P.approve), canIncident = can(P.incident);   // booleans: stable effect deps
  const loadOverview = useCallback(() => {
    if (!canView) return;
    Promise.all([
      count(api.feed({ status: 'active', page: 1, pageSize: 1 })), count(api.follows()),
      canDraft ? count(api.mine('drafts', 1, 1)) : Promise.resolve(null), canApprove ? count(api.mine('awaiting_approval', 1, 1)) : Promise.resolve(null),
      canIncident ? count(api.incidents(1)) : Promise.resolve(null),
    ]).then(([active, following, drafts, awaiting, incidents]) => setOv({ active, following, drafts, awaiting, incidents }));
  }, [canView, canDraft, canApprove, canIncident]);
  useEffect(() => { loadOverview(); }, [loadOverview]);
  /** read-only: which Community services answer for this role right now — nothing is posted, approved or changed */
  const runHealth = () => {
    setHealth('loading');
    const probe = (key: string, p: Promise<unknown>) => p.then(() => ({ key, ok: true as boolean | null })).catch((e: any) => ({ key, ok: e?.status === 403 ? null : false }));
    Promise.all([probe('feed', api.feed({ page: 1, pageSize: 1 })), probe('settings', api.settings()), probe('alerts', api.activeAlerts()), probe('follows', api.follows()),
      can(P.incident) ? probe('incidents', api.incidents(1)) : Promise.resolve({ key: 'incidents', ok: null })]).then(setHealth);
  };

  const load = useCallback(() => {
    if (!canView) return Promise.resolve();
    const query: CommunityFeedQuery = {
      category: category || undefined, severity: severity || undefined, region: region.trim() || undefined,
      status, sort, followingOnly: followingOnly || undefined, page: pageNo, pageSize: PAGE_SIZE,
    };
    const call = q ? api.search({ ...query, q }) : api.feed(query);
    return call.then((d) => { setData(d); setError(null); })
      .catch((e) => { setError(communityErrorText(e, t('growth.community.couldNotLoadTheCommunityFeed'))); if (q) setData(null); })
      .finally(() => setLoading(false));
  }, [canView, category, severity, region, status, sort, followingOnly, q, pageNo]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['community'], load);

  const reset = () => setPageNo(1);
  if (!canView) {
    return <div style={page}><CommunityHeader title={t('pos.safety_community')} /><div style={{ padding: 20, ...muted }}>{t('pos.you_do_not_have_access_to_u75b')}</div></div>;
  }
  const items = data?.items ?? [];
  return (
    <div style={page}>
      <CommunityHeader title={t('pos.safety_community')} sub={t('pos.sanitized_safety_advisories_shared_by_salons_1jv1')}>
        <button style={btnGhost} data-testid="cmx-refresh" onClick={() => { void load(); loadOverview(); }}>{t('cmx.refresh')}</button>
        <button style={btnGhost} data-testid="cmx-check" onClick={runHealth}>{t('cmx.check')}</button>
        {can(P.draft) ? <button style={btnGold} onClick={() => nav('/community/new')}>{t('pos.new_advisory')}</button> : null}
      </CommunityHeader>
      <div className="rvw-kpis cmx-kpis" data-testid="cmx-kpis" style={{ margin: '12px 20px 0' }}>
        <KpiCard testId="cmx-kpi-active" label={t('cmx.kpi.active')} value={ov ? (ov.active == null ? '—' : fmtNumber(ov.active)) : '—'} loading={!ov} onClick={() => { setStatus('active'); setFollowingOnly(false); reset(); }} />
        <KpiCard testId="cmx-kpi-following" label={t('cmx.kpi.following')} value={ov ? (ov.following == null ? '—' : fmtNumber(ov.following)) : '—'} loading={!ov} onClick={() => { setFollowingOnly(true); reset(); }} />
        {can(P.draft) ? <KpiCard testId="cmx-kpi-drafts" label={t('cmx.kpi.drafts')} value={ov ? (ov.drafts == null ? '—' : fmtNumber(ov.drafts)) : '—'} loading={!ov} onClick={() => nav('/community/drafts')} /> : null}
        {can(P.approve) ? <KpiCard testId="cmx-kpi-awaiting" label={t('cmx.kpi.awaiting')} value={ov ? (ov.awaiting == null ? '—' : fmtNumber(ov.awaiting)) : '—'} loading={!ov} tone={ov?.awaiting ? 'warn' : undefined} onClick={() => nav('/community/approvals')} /> : null}
        {can(P.incident) ? <KpiCard testId="cmx-kpi-incidents" label={t('cmx.kpi.incidents')} value={ov ? (ov.incidents == null ? '—' : fmtNumber(ov.incidents)) : '—'} loading={!ov} onClick={() => nav('/community/incidents')} /> : null}
      </div>
      <CommunitySubNav can={can} />
      <div style={body}>
        <div style={card}>
          <form role="search" aria-label={t('pos.search_the_community')} style={row} onSubmit={(e) => { e.preventDefault(); setQ(qDraft.trim()); reset(); }}>
            <input style={{ ...input, flex: '1 1 220px' }} aria-label={t('pos.search_advisories')} placeholder={t('pos.search_by_what_happened_e_g_1hde')} value={qDraft} onChange={(e) => setQDraft(e.target.value)} />
            <button type="submit" style={btnGhost}>{t('pos.search')}</button>
            {q ? <button type="button" style={btnGhost} onClick={() => { setQ(''); setQDraft(''); reset(); }}>{t('pos.clear_search')}</button> : null}
          </form>
          <div style={{ ...row, marginTop: 10 }}>
            <select style={input} aria-label={t('pos.filter_by_category')} value={category} onChange={(e) => { setCategory(e.target.value as CommunityCategory | ''); reset(); }}>
              <option value="">{t('pos.all_categories_2')}</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
            <select style={input} aria-label={t('pos.filter_by_severity')} value={severity} onChange={(e) => { setSeverity(e.target.value as CommunitySeverity | ''); reset(); }}>
              <option value="">{t('pos.any_severity')}</option>
              {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
            </select>
            <input style={{ ...input, width: 120 }} aria-label={t('pos.filter_by_region')} placeholder={t('pos.region_e_g_nj')} value={region} onChange={(e) => { setRegion(e.target.value); reset(); }} />
            <select style={input} aria-label={t('pos.show')} value={status} onChange={(e) => { setStatus(e.target.value as StatusFilter); reset(); }}>
              <option value="active">{t('pos.active_3')}</option><option value="resolved">{t('pos.resolved_2')}</option><option value="all">{t('pos.all')}</option>
            </select>
            <select style={input} aria-label={t('pos.sort_by')} value={sort} onChange={(e) => { setSort(e.target.value as Sort); reset(); }}>
              <option value="newest">{t('pos.newest')}</option><option value="most_active">{t('pos.most_active')}</option><option value="severity">{t('pos.most_severe')}</option>
            </select>
            <label style={{ ...row, fontSize: 12.5 }}><input type="checkbox" checked={followingOnly} onChange={(e) => { setFollowingOnly(e.target.checked); reset(); }} /> {t('pos.following_only')}</label>
          </div>
        </div>
        {error ? <div role="alert" style={errText} data-testid="community-feed-error">{error}</div> : null}
        {loading && !data ? <div style={muted}>{t('pos.loading')}</div> : items.length === 0 && !error ? (
          <div style={{ ...card, ...muted }} data-testid="community-feed-empty">{q ? t('pos.no_advisories_match_that_search') : t('pos.no_advisories_to_show_yet')}</div>
        ) : (
          <ul aria-label={t('pos.community_advisories')} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
            {items.map((p) => (
              <li key={p.id} data-testid="community-post-row" style={card}>
                <div style={{ ...row, justifyContent: 'space-between' }}>
                  <Link to={`/community/posts/${encodeURIComponent(p.id)}`} style={{ fontWeight: 700, color: '#2C2A27', fontSize: 14.5 }}>{p.title}</Link>
                  <div style={row}><SeverityPill s={p.severity} /><StatusPill s={p.status} /></div>
                </div>
                <div style={{ ...muted, marginTop: 4 }}>
                  {CATEGORY_LABEL[p.category] ?? p.category} · {LABEL_TEXT[p.verificationLabel] ?? p.verificationLabel} · {authorText(p.author)}{p.region ? ` · ${p.region}` : ''} · {when(p.publishedAt)}
                </div>
                <div style={{ fontSize: 13, color: '#4A4744', marginTop: 6, whiteSpace: 'pre-wrap' }}>{p.body.length > 240 ? `${p.body.slice(0, 240)}…` : p.body}</div>
                <div style={{ ...muted, marginTop: 6 }}>
                  {p.counts.comments} {t('pos.comment_2')}{enPlural(p.counts.comments === 1 ? '' : 's')} · {p.counts.similar} {t('pos.similar')}{' '}{p.counts.followers} {t('pos.following')}{p.following ? t('pos.you_follow_this') : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
        {data && (data.page > 1 || data.hasMore) ? (
          <div className="rvw-pager" aria-label={t('pos.pages')} data-testid="cmx-pager">
            <Pager info={{ page: data.page, pageSize: PAGE_SIZE, totalItems: data.total, totalPages: Math.max(data.page + (data.hasMore ? 1 : 0), Math.ceil(data.total / PAGE_SIZE)) }} onPage={setPageNo} />
            <span style={muted}>{data.total} {t('pos.advisor')}{enPlural(data.total === 1 ? 'y' : 'ies')}</span>
          </div>
        ) : null}
      </div>
      {health ? <FitDialog testId="cmx-health" title={t('cmx.check')} onClose={() => setHealth(null)} footer={<button style={btnGhost} onClick={() => setHealth(null)}>{t('pos.close')}</button>}>
        {health === 'loading' ? <div style={muted}>{t('cmx.health.running')}</div> : <>
          <p style={muted}>{t('cmx.health.readOnly')}</p>
          {health.map((h) => <div key={h.key} className="rvw-check" data-testid={`cmx-chk-${h.key}`}>
            <span className={'chip ' + (h.ok ? 'ok' : h.ok === null ? '' : 'bad')}>{t(h.ok ? 'cmx.health.ok' : h.ok === null ? 'cmx.health.noAccess' : 'cmx.health.failed')}</span> <b>{t('cmx.health.k.' + h.key)}</b></div>)}
        </>}
      </FitDialog> : null}
    </div>
  );
}
