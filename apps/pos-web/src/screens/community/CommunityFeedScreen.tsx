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

const PAGE_SIZE = 20;
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
        {can(P.draft) ? <button style={btnGold} onClick={() => nav('/community/new')}>{t('pos.new_advisory')}</button> : null}
      </CommunityHeader>
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
          <div style={row} aria-label={t('pos.pages')}>
            <button style={btnGhost} disabled={data.page <= 1} onClick={() => setPageNo((n) => Math.max(1, n - 1))}>{t('pos.previous_page')}</button>
            <span style={muted}>{t('pos.page')}{' '}{data.page} · {data.total} {t('pos.advisor')}{enPlural(data.total === 1 ? 'y' : 'ies')}</span>
            <button style={btnGhost} disabled={!data.hasMore} onClick={() => setPageNo((n) => n + 1)}>{t('pos.next_page')}</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
