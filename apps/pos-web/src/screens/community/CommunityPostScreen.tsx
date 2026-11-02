// CommunityPostScreen.tsx — /community/posts/:id: THE deep link every community alert / notification opens (contract
// §4 fanout → `/community/posts/:id`; audit: "the deep link exists in no app"). Detail (sanitized body + structured
// fields + verification label), updates from the posting salon, related / possible duplicate posts, threaded comments,
// "we saw this too", follow, report / dispute / appeal, the posting salon's own private evidence, and — for the posting
// salon's approvers — edit, add an update, resolve. Every button is hidden unless BOTH the session permission and the
// server's `viewerActions` allow it (the server re-checks). 409 → reload + message; 403 restrictions in plain words.
import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { CommunityAppealInput, CommunityCommentView, CommunityPostView, CommunityReportReason } from '@aipowersalon/api-contracts/tenant';
import { useCan } from '../../components/usePermissions';
import { useRealtime } from '../../realtime/useRealtime';
import { posCommunityApi as api } from '../../api/posCommunityApi';
import { useCommunityRules } from './CommunityRules';
import { CommunityComments } from './CommunityComments';
import { CommunityEvidencePanel } from './CommunityEvidence';
import {
  P, CATEGORY_LABEL, LABEL_TEXT, REPORT_REASONS, communityChannelLabel, communityAmountLabel, CommunityHeader, CommunitySubNav, SeverityPill, StatusPill, authorText, body,
  btnGhost, btnGold, card, cardHead, communityErrorText, errText, input, isConflict, label, muted, okText, page, row,
  textarea, when,
} from './communityUi';
import { t as tx, enPlural } from '@aipowersalon/mobile-sdk/i18n';

type Panel = 'none' | 'report' | 'dispute' | 'appeal' | 'similar' | 'update' | 'resolve';
const APPEAL_SUBJECTS = (): [CommunityAppealInput['subject'], string][] => [
  ['post_rejected', tx('growth.community.appeal.post_rejected')], ['post_removed', tx('growth.community.appeal.post_removed')], ['verification_status', tx('growth.community.appeal.verification_status')],
  ['severity_change', tx('growth.community.appeal.severity_change')], ['community_suspended', tx('growth.community.appeal.community_suspended')],
];

export function CommunityPostScreen() {
  const { id = '' } = useParams();
  const can = useCan();
  const nav = useNavigate();
  const rules = useCommunityRules(can(P.view));
  const [post, setPost] = useState<CommunityPostView | null>(null);
  const [comments, setComments] = useState<CommunityCommentView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>('none');
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  // panel fields
  const [reason, setReason] = useState<CommunityReportReason>('contains_personal_info');
  const [text, setText] = useState('');
  const [extra, setExtra] = useState('');
  const [subject, setSubject] = useState<CommunityAppealInput['subject']>('post_rejected');

  const load = useCallback(() => {
    if (!id) return Promise.resolve();
    return Promise.all([
      api.post(id).then((p) => { setPost(p); setError(null); }).catch((e) => { setPost(null); setError(communityErrorText(e, tx('growth.community.couldNotLoadThisPost'))); }),
      api.comments(id).then(setComments).catch(() => setComments([])),
    ]).then(() => setTick((t) => t + 1));
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['community'], load);

  const open = (p: Panel) => { setPanel(p); setText(''); setExtra(''); setNotice(null); setError(null); };
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setError(null); setNotice(null);
    try { await fn(); setPanel('none'); setNotice(ok); await load(); }
    catch (e) { if (isConflict(e)) await load(); setError(communityErrorText(e)); }
    finally { setBusy(false); }
  };

  if (!can(P.view)) return <div style={page}><CommunityHeader title={tx('pos.safety_community')} /><div style={{ padding: 20, ...muted }}>{tx('pos.you_do_not_have_access_to_u75b')}</div></div>;
  if (!post) {
    return (
      <div style={page}>
        <CommunityHeader title={tx('pos.safety_community')} />
        <CommunitySubNav can={can} />
        <div style={body}>{error ? <div role="alert" style={errText}>{error}</div> : <div style={muted}>{tx('pos.loading')}</div>}<Link to="/community">{tx('pos.back_to_the_feed')}</Link></div>
      </div>
    );
  }
  const va = post.viewerActions;
  const facts: [string, string | null][] = [
    [tx('growth.community.fact.category'), CATEGORY_LABEL[post.category] ?? post.category], [tx('growth.community.fact.verification'), LABEL_TEXT[post.verificationLabel] ?? post.verificationLabel],
    [tx('growth.community.fact.region'), post.region], [tx('growth.community.fact.when'), post.incidentDate], [tx('growth.community.fact.how'), post.scamMethod],
    [tx('growth.community.fact.channels'), post.channels?.length ? post.channels.map(communityChannelLabel).join(', ') : null], [tx('growth.community.fact.processor'), post.paymentProcessor],
    [tx('growth.community.fact.amount'), post.amountRange ? communityAmountLabel(post.amountRange) : null],
    [tx('growth.community.fact.officialReport'), post.officialReference], [tx('growth.community.fact.tags'), post.tags?.length ? post.tags.join(', ') : null],
  ];
  return (
    <div style={page}>
      <CommunityHeader title={tx('pos.safety_community')} sub={tx('pos.a_sanitized_advisory_a_post_is_fd9m')} />
      <CommunitySubNav can={can} />
      <div style={body}>
        <article style={card} aria-labelledby="community-post-title" data-testid="community-post">
          <div style={{ ...row, justifyContent: 'space-between' }}>
            <h2 id="community-post-title" style={{ margin: 0, fontSize: 18, fontFamily: 'var(--aps-font-head, Playfair Display)' }}>{post.title}</h2>
            <div style={row}><SeverityPill s={post.severity} /><StatusPill s={post.status} /></div>
          </div>
          <div style={{ ...muted, marginTop: 4 }}>{authorText(post.author)} {tx('pos.published')}{' '}{when(post.publishedAt)}{post.lastActivityAt ? tx('pos.last_activity_lastactivityat', { lastActivityAt: String(when(post.lastActivityAt)) }) : ''}</div>
          <div style={{ marginTop: 10, fontSize: 13.5, whiteSpace: 'pre-wrap', color: '#2C2A27' }} data-testid="community-post-body">{post.body}</div>
          {post.recommendation ? <div style={{ marginTop: 10, fontSize: 13, background: '#F3F6EC', borderRadius: 8, padding: '8px 10px' }}><strong>{tx('pos.what_helped')}</strong> {post.recommendation}</div> : null}
          <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 12px', fontSize: 12.5, marginTop: 10 }}>
            {facts.filter(([, v]) => v).map(([k, v]) => <Fragment key={k}><dt style={{ color: '#8A857E' }}>{k}</dt><dd style={{ margin: 0 }}>{v}</dd></Fragment>)}
          </dl>
          <div style={{ ...muted, marginTop: 8 }}>
            {post.counts.comments} {tx('pos.comment_2')}{enPlural(post.counts.comments === 1 ? '' : 's')} · {post.counts.similar} {tx('pos.salon')}{enPlural(post.counts.similar === 1 ? '' : 's')} {tx('pos.saw_something_similar')}{' '}{post.counts.followers} {tx('pos.following')}
            {post.evidence.count > 0 ? tx('pos.count_evidence_file_plural_v2', { count: String(post.evidence.count), plural: String(post.evidence.count === 1 ? '' : 's'), v2: String(post.evidence.reviewed ? tx('pos.reviewed_by_moderators') : '') }) : ''}
          </div>
          {post.resolvedAt ? <div style={{ ...okText, marginTop: 6 }} data-testid="community-resolved">{tx('pos.resolved_2')}{' '}{when(post.resolvedAt)}{post.resolutionNote ? ` — ${post.resolutionNote}` : ''}</div> : null}
          {post.similarReportedByMe ? <div style={{ ...muted, marginTop: 4 }}>{tx('pos.your_salon_reported_a_similar_experience')}</div> : null}

          <div style={{ ...row, marginTop: 12 }} aria-label={tx('pos.post_actions')}>
            {va.canFollow && can(P.follow) ? (
              <button style={btnGhost} disabled={busy} onClick={() => act(() => (post.following ? api.unfollowPost(post.id) : api.followPost(post.id)), post.following ? tx('pos.you_no_longer_follow_this_post') : tx('pos.you_will_be_told_about_updates_utm1'))}>
                {post.following ? tx('pos.unfollow') : tx('pos.follow')}
              </button>
            ) : null}
            {va.canMarkSimilar && can(P.report) && !post.similarReportedByMe ? <button style={btnGhost} onClick={() => open('similar')}>{tx('pos.we_saw_this_too')}</button> : null}
            {va.canEdit && can(P.submit) ? <button style={btnGhost} onClick={() => nav(`/community/drafts/${encodeURIComponent(post.id)}`)}>{tx('pos.edit_post')}</button> : null}
            {va.canAddUpdate && can(P.submit) ? <button style={btnGhost} onClick={() => open('update')}>{tx('pos.add_update')}</button> : null}
            {va.canResolve && can(P.submit) ? <button style={btnGhost} onClick={() => open('resolve')}>{tx('pos.mark_resolved')}</button> : null}
            {va.canReport && can(P.report) ? <button style={btnGhost} onClick={() => open('report')}>{tx('pos.report_post')}</button> : null}
            {va.canDispute && can(P.dispute) ? <button style={btnGhost} onClick={() => open('dispute')}>{tx('pos.dispute')}</button> : null}
            {va.canAppeal && can(P.appeal) ? <button style={btnGhost} onClick={() => open('appeal')}>{tx('pos.appeal')}</button> : null}
          </div>
          {notice ? <div role="status" style={{ ...okText, marginTop: 8 }}>{notice}</div> : null}
          {error ? <div role="alert" style={{ ...errText, marginTop: 8 }}>{error}</div> : null}

          {panel === 'report' ? (
            <div role="dialog" aria-label={tx('pos.report_this_post')} style={{ ...card, marginTop: 10, display: 'grid', gap: 8 }}>
              <label style={label}>{tx('pos.reason_2')}<select style={input} value={reason} onChange={(e) => setReason(e.target.value as CommunityReportReason)}>{REPORT_REASONS().map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label style={label}>{tx('pos.details_optional')}<textarea style={textarea} value={text} onChange={(e) => setText(e.target.value)} /></label>
              <div style={row}><button style={btnGold} disabled={busy} onClick={() => act(() => api.reportPost(post.id, { reason, detail: text.trim() || null }), tx('growth.community.reportedModeratorsWillReviewThisPost'))}>{tx('pos.send_report')}</button><button style={btnGhost} onClick={() => setPanel('none')}>{tx('pos.cancel')}</button></div>
            </div>
          ) : null}
          {panel === 'dispute' ? (
            <div role="dialog" aria-label={tx('pos.dispute_this_post')} style={{ ...card, marginTop: 10, display: 'grid', gap: 8 }}>
              <div style={muted}>{tx('pos.a_disputed_post_is_labelled_disputed_4l6a')}</div>
              <label style={label}>{tx('pos.what_is_wrong_with_this_post')}<textarea style={textarea} value={text} onChange={(e) => setText(e.target.value)} /></label>
              <label style={label}>{tx('pos.you_are_disputing_as')}
                <select style={input} value={extra || 'tenant'} onChange={(e) => setExtra(e.target.value)}><option value="tenant">{tx('pos.a_salon')}</option><option value="subject">{tx('pos.the_person_or_business_it_describes')}</option></select>
              </label>
              <div style={row}><button style={btnGold} disabled={busy || text.trim().length < 10} onClick={() => act(() => api.dispute(post.id, { reason: text.trim(), raisedByKind: extra === 'subject' ? 'subject' : 'tenant' }), tx('growth.community.disputeSentThePostIsLabelled'))}>{tx('pos.send_dispute')}</button><button style={btnGhost} onClick={() => setPanel('none')}>{tx('pos.cancel')}</button></div>
            </div>
          ) : null}
          {panel === 'appeal' ? (
            <div role="dialog" aria-label={tx('pos.appeal_a_moderation_decision')} style={{ ...card, marginTop: 10, display: 'grid', gap: 8 }}>
              <label style={label}>{tx('pos.what_are_you_appealing')}<select style={input} value={subject} onChange={(e) => setSubject(e.target.value as CommunityAppealInput['subject'])}>{APPEAL_SUBJECTS().map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label style={label}>{tx('pos.why_should_moderators_look_again')}<textarea style={textarea} value={text} onChange={(e) => setText(e.target.value)} /></label>
              <div style={row}><button style={btnGold} disabled={busy || text.trim().length < 10} onClick={() => act(() => api.appeal(post.id, { subject, reason: text.trim() }), tx('growth.community.appealSentADifferentModeratorWill'))}>{tx('pos.send_appeal')}</button><button style={btnGhost} onClick={() => setPanel('none')}>{tx('pos.cancel')}</button></div>
            </div>
          ) : null}
          {panel === 'similar' ? (
            <div role="dialog" aria-label={tx('pos.report_a_similar_experience')} style={{ ...card, marginTop: 10, display: 'grid', gap: 8 }}>
              <label style={label}>{tx('pos.when_did_it_happen_optional')}<input type="date" style={input} value={extra} onChange={(e) => setExtra(e.target.value)} /></label>
              <label style={label}>{tx('pos.anything_others_should_know_optional_no_99pf')}<textarea style={textarea} value={text} onChange={(e) => setText(e.target.value)} /></label>
              <div style={row}><button style={btnGold} disabled={busy} onClick={() => act(() => api.markSimilar(post.id, { note: text.trim() || null, occurredOn: extra || null }), tx('growth.community.thanksYourSalonSSimilarExperience'))}>{tx('pos.report_similar_experience')}</button><button style={btnGhost} onClick={() => setPanel('none')}>{tx('pos.cancel')}</button></div>
            </div>
          ) : null}
          {panel === 'update' ? (
            <div role="dialog" aria-label={tx('pos.add_an_update')} style={{ ...card, marginTop: 10, display: 'grid', gap: 8 }}>
              <label style={label}>{tx('pos.update')}<textarea style={textarea} value={text} onChange={(e) => setText(e.target.value)} /></label>
              <div style={row}><button style={btnGold} disabled={busy || !text.trim()} onClick={() => act(() => api.addUpdate(post.id, text.trim()), tx('growth.community.updatePosted'))}>{tx('pos.post_update')}</button><button style={btnGhost} onClick={() => setPanel('none')}>{tx('pos.cancel')}</button></div>
            </div>
          ) : null}
          {panel === 'resolve' ? (
            <div role="dialog" aria-label={tx('pos.mark_this_post_resolved')} style={{ ...card, marginTop: 10, display: 'grid', gap: 8 }}>
              <label style={label}>{tx('pos.resolution_note')}<textarea style={textarea} value={text} onChange={(e) => setText(e.target.value)} /></label>
              <div style={row}><button style={btnGold} disabled={busy || !text.trim()} onClick={() => act(() => api.resolve(post.id, post.version, text.trim()), tx('growth.community.markedResolved'))}>{tx('pos.confirm_resolved')}</button><button style={btnGhost} onClick={() => setPanel('none')}>{tx('pos.cancel')}</button></div>
            </div>
          ) : null}
        </article>

        {post.updates?.length ? (
          <section style={card} aria-label={tx('pos.updates')}>
            <div style={cardHead}>{tx('pos.updates_from_the_posting_salon')}</div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
              {post.updates.map((u) => <li key={u.id} data-testid="community-update"><div style={muted}>{authorText(u.author)} · {when(u.createdAt)}</div><div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{u.body}</div></li>)}
            </ul>
          </section>
        ) : null}
        {post.related?.length ? (
          <section style={card} aria-label={tx('pos.related_posts')}>
            <div style={cardHead}>{tx('pos.related_posts')}</div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
              {post.related.map((r) => (
                <li key={r.id} style={row} data-testid="community-related">
                  <Link to={`/community/posts/${encodeURIComponent(r.id)}`}>{r.title}</Link>
                  <SeverityPill s={r.severity} />
                  <span style={muted}>{r.relation === 'possible_duplicate' ? tx('pos.possible_duplicate_2') : r.relation === 'merged_into' ? tx('pos.merged_into_this') : 'related'}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {post.author.isOwnSalon && can(P.evidence) ? <CommunityEvidencePanel postId={post.id} canUpload={va.canUploadEvidence} tick={tick} /> : null}
        <CommunityComments postId={post.id} comments={comments} can={can} canComment={va.canComment} canReport={va.canReport}
          locked={post.commentsLocked} ensureRules={rules.ensure} requireRules={rules.require} onChanged={load} />
      </div>
      {rules.modal}
    </div>
  );
}
