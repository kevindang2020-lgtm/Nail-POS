// CommunityDraftsScreen.tsx — /community/drafts: "My advisories" (contract §2.5 GET /community/mine?kind=) — drafts,
// submitted, waiting for approval, published, returned, all — plus the salon's appeals (GET /community/appeals). A row
// opens the editor (/community/drafts/:id); a published one also links to its public page. Paged.
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { CommunityAppealView, CommunityMyListKind, CommunityMyPostView, CommunityPage } from '@aipowersalon/api-contracts/tenant';
import { useCan } from '../../components/usePermissions';
import { useRealtime } from '../../realtime/useRealtime';
import { posCommunityApi as api } from '../../api/posCommunityApi';
import {
  P, CATEGORY_LABEL, EDITABLE, CommunityHeader, CommunitySubNav, SeverityPill, StatusPill, body, btnGhost, btnGold, card,
  communityErrorText, errText, isPublished, muted, page, pretty, row, when,
} from './communityUi';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { CommunityCorrectionsList } from './CommunityOpsCards';   // extras Safety Community 06

type Tab = CommunityMyListKind | 'appeals' | 'corrections';
const TABS = (): [Tab, string][] => [['drafts', t('growth.community.drafts.tab.drafts')], ['returned', t('growth.community.drafts.tab.returned')], ['submitted', t('growth.community.drafts.tab.submitted')], ['awaiting_approval', t('growth.community.drafts.tab.awaiting_approval')], ['published', t('growth.community.drafts.tab.published')], ['all', t('growth.community.drafts.tab.all')], ['appeals', t('growth.community.drafts.tab.appeals')], ['corrections', t('growth.community.drafts.tab.corrections')]];
const tabBtn = (on: boolean): CSSProperties => ({ ...btnGhost, background: on ? '#A96F22' : '#fff', color: on ? '#fff' : '#4A4744', borderColor: on ? '#A96F22' : 'var(--line)' });

export function CommunityDraftsScreen() {
  const can = useCan();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('drafts');
  const [pageNo, setPageNo] = useState(1);
  const [data, setData] = useState<CommunityPage<CommunityMyPostView> | null>(null);
  const [appeals, setAppeals] = useState<CommunityAppealView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!can(P.draft)) return Promise.resolve();
    setError(null);
    if (tab === 'corrections') return Promise.resolve();   // extras Safety Community 06: the list loads itself
    if (tab === 'appeals') return api.appeals().then(setAppeals).catch((e) => setError(communityErrorText(e, t('growth.community.couldNotLoadYourAppeals'))));
    return api.mine(tab, pageNo).then(setData).catch((e) => setError(communityErrorText(e, t('growth.community.couldNotLoadYourAdvisories'))));
  }, [tab, pageNo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useRealtime(['community'], load);

  if (!can(P.draft)) return <div style={page}><CommunityHeader title={t('pos.my_advisories')} /><div style={{ padding: 20, ...muted }}>{t('pos.your_role_cannot_write_community_advisories')}</div></div>;
  const items = data?.items ?? [];
  return (
    <div style={page}>
      <CommunityHeader title={t('pos.my_advisories')} sub={t('pos.your_salon_s_drafts_and_posts_s3ne')}>
        <button style={btnGold} onClick={() => nav('/community/new')}>{t('pos.new_advisory')}</button>
      </CommunityHeader>
      <CommunitySubNav can={can} />
      <div style={body}>
        <div role="tablist" aria-label={t('pos.which_advisories')} style={row}>
          {TABS().filter(([k]) => (k !== 'appeals' && k !== 'corrections') || can(P.appeal)).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} style={tabBtn(tab === k)} onClick={() => { setTab(k); setPageNo(1); }}>{l}</button>)}
        </div>
        {error ? <div role="alert" style={errText}>{error}</div> : null}
        {tab === 'corrections' ? <CommunityCorrectionsList /> : tab === 'appeals' ? (
          !appeals ? <div style={muted}>{t('pos.loading')}</div> : appeals.length === 0 ? <div style={{ ...card, ...muted }}>{t('pos.no_appeals')}</div> : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
              {appeals.map((a) => (
                <li key={a.id} style={card} data-testid="community-appeal-row">
                  <div style={{ ...row, justifyContent: 'space-between' }}><strong style={{ fontSize: 13.5 }}>{pretty(a.subject)}</strong><span style={muted}>{pretty(a.status)}</span></div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>{a.reason}</div>
                  <div style={{ ...muted, marginTop: 4 }}>{t('pos.sent')}{' '}{when(a.createdAt)}{a.decidedAt ? t('pos.decided_decidedat', { decidedAt: String(when(a.decidedAt)) }) : ''}{a.decisionNote ? ` — ${a.decisionNote}` : ''}</div>
                  {a.postId ? <Link to={`/community/posts/${encodeURIComponent(a.postId)}`} style={{ fontSize: 12.5 }}>{t('pos.open_the_post')}</Link> : null}
                </li>
              ))}
            </ul>
          )
        ) : !data ? <div style={muted}>{t('pos.loading')}</div> : items.length === 0 ? <div style={{ ...card, ...muted }} data-testid="community-mine-empty">{t('pos.nothing_here')}</div> : (
          <ul aria-label={t('pos.my_advisories')} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {items.map((p) => (
              <li key={p.id} style={card} data-testid="community-mine-row">
                <div style={{ ...row, justifyContent: 'space-between' }}>
                  <Link to={`/community/drafts/${encodeURIComponent(p.id)}`} style={{ fontWeight: 700, color: '#2C2A27' }}>{p.title || t('pos.untitled_draft')}</Link>
                  <div style={row}><SeverityPill s={p.severity} /><StatusPill s={p.status} /></div>
                </div>
                <div style={{ ...muted, marginTop: 4 }}>{CATEGORY_LABEL[p.category] ?? p.category} {t('pos.updated_3')}{' '}{when(p.updatedAt)}{p.createdByMe ? t('pos.written_by_you') : ''}{p.awaitingMyApproval ? t('pos.waiting_for_your_approval') : ''}</div>
                {p.returnReason ? <div style={{ ...errText, marginTop: 4 }}>{t('pos.note_2')}{' '}{p.returnReason}</div> : null}
                <div style={{ ...row, marginTop: 6 }}>
                  {EDITABLE.includes(p.status) ? <button style={btnGhost} onClick={() => nav(`/community/drafts/${encodeURIComponent(p.id)}`)}>{t('pos.continue_editing')}</button> : null}
                  {isPublished(p.status) || p.status === 'resolved' ? <Link to={`/community/posts/${encodeURIComponent(p.id)}`} style={{ fontSize: 12.5 }}>{t('pos.view_in_the_feed')}</Link> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {tab !== 'appeals' && tab !== 'corrections' && data && (data.page > 1 || data.hasMore) ? (
          <div style={row}>
            <button style={btnGhost} disabled={data.page <= 1} onClick={() => setPageNo((n) => Math.max(1, n - 1))}>{t('pos.previous_page')}</button>
            <span style={muted}>{t('pos.page')}{' '}{data.page} {t('pos.of')}{' '}{Math.max(1, Math.ceil(data.total / Math.max(1, data.pageSize)))}</span>
            <button style={btnGhost} disabled={!data.hasMore} onClick={() => setPageNo((n) => n + 1)}>{t('pos.next_page')}</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
