// CommunityComments.tsx — threaded comments on one advisory (contract §4: depth ≤ 3; a removed comment reads
// "[removed by moderator]"). Reply / edit (own, expectedVersion) / delete (own) / report (others'). Posting asks for the
// rules first (useCommunityRules.ensure); a 403 rules_not_acknowledged re-opens them; a locked thread, a commenting
// restriction and a suspension are explained in plain words. Realtime `community_comment_added` reloads via the parent.
import { useState } from 'react';
import type { CommunityCommentView, CommunityReportReason } from '@aipowersalon/api-contracts/tenant';
import { posCommunityApi as api } from '../../api/posCommunityApi';
import {
  P, REPORT_REASONS, type Can, authorText, btnDanger, btnGhost, btnGold, card, cardHead, communityErrorText, errCode, errText,
  input, isConflict, label, muted, okText, row, textarea, when,
} from './communityUi';
import { t } from '@aipowersalon/mobile-sdk/i18n';

export const MAX_DEPTH = 3;

interface Props {
  postId: string;
  comments: CommunityCommentView[];
  can: Can;
  canComment: boolean;      // viewerActions.canComment
  canReport: boolean;       // viewerActions.canReport
  locked: boolean;
  ensureRules: (fn: () => void) => void;
  requireRules: () => void;
  onChanged: () => void;
}

export function CommunityComments(p: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mayComment = p.canComment && p.can(P.comment) && !p.locked;

  const fail = (e: unknown, fallback: string) => {
    if (errCode(e) === 'rules_not_acknowledged') p.requireRules();
    if (isConflict(e)) p.onChanged();
    setError(communityErrorText(e, fallback));
  };
  const post = () => p.ensureRules(async () => {
    const b = text.trim(); if (!b) { setError(t('pos.write_something_first')); return; }
    setBusy(true); setError(null);
    try { await api.addComment(p.postId, { body: b }); setText(''); p.onChanged(); }
    catch (e) { fail(e, t('growth.community.yourCommentWasNotPosted')); }
    finally { setBusy(false); }
  });

  const count = (cs: CommunityCommentView[]): number => cs.reduce((n, c) => n + 1 + count(c.replies ?? []), 0);
  return (
    <section style={card} aria-label={t('pos.comments')} data-testid="community-comments">
      <div style={cardHead}>{t('pos.comments')}{' '}<span style={muted}>{count(p.comments)}</span></div>
      {p.locked ? <div style={muted} data-testid="community-comments-locked">{t('pos.comments_are_closed_on_this_post')}</div> : null}
      {mayComment ? (
        <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
          <textarea style={textarea} aria-label={t('pos.add_a_comment')} placeholder={t('pos.share_what_helped_your_salon_stay_4na3')} value={text} onChange={(e) => setText(e.target.value)} />
          <div style={row}><button style={btnGold} disabled={busy} onClick={post}>{t('pos.post_comment')}</button></div>
        </div>
      ) : null}
      {error ? <div role="alert" style={errText}>{error}</div> : null}
      {p.comments.length === 0 ? <div style={muted}>{t('pos.no_comments_yet')}</div> : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {p.comments.map((c) => <CommentItem key={c.id} c={c} {...p} mayComment={mayComment} fail={fail} />)}
        </ul>
      )}
    </section>
  );
}

function CommentItem(props: Props & { c: CommunityCommentView; mayComment: boolean; fail: (e: unknown, f: string) => void }) {
  const { c, mayComment, fail } = props;
  const [mode, setMode] = useState<'none' | 'reply' | 'edit' | 'report' | 'delete'>('none');
  const [text, setText] = useState('');
  const [reason, setReason] = useState<CommunityReportReason>('contains_personal_info');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, ok: string | null, fallback: string) => {
    setBusy(true); setDone(null);
    try { await fn(); setMode('none'); setText(''); if (ok) setDone(ok); props.onChanged(); }
    catch (e) { fail(e, fallback); }
    finally { setBusy(false); }
  };
  const depth = Math.max(1, c.depth || 1);
  const by = authorText(c.author);
  return (
    <li>
      <article aria-label={t('pos.comment_from_v0', { v0: String(c.author?.label || t('pos.a_salon_2')) })} data-testid="community-comment" style={{ borderLeft: depth > 1 ? '2px solid #EADFCB' : undefined, paddingLeft: depth > 1 ? 10 : 0 }}>
        <div style={{ ...muted, fontSize: 12 }}>{by} · {when(c.createdAt)}{c.edited && !c.removed ? t('pos.edited') : ''}</div>
        <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', color: c.removed ? '#8A857E' : '#2C2A27', fontStyle: c.removed ? 'italic' : undefined }}>{c.body}</div>
        {!c.removed ? (
          <div style={{ ...row, marginTop: 4 }}>
            {mayComment && depth < MAX_DEPTH ? <button style={btnGhost} onClick={() => props.ensureRules(() => { setMode('reply'); setText(''); })} aria-label={t('pos.reply_to_comment_from_v0', { v0: String(c.author?.label || t('pos.a_salon_2')) })}>{t('pos.reply')}</button> : null}
            {c.mine && props.can(P.comment) ? <button style={btnGhost} onClick={() => { setMode('edit'); setText(c.body); }}>{t('pos.edit')}</button> : null}
            {c.mine && props.can(P.comment) ? <button style={btnDanger} onClick={() => setMode('delete')}>{t('pos.delete')}</button> : null}
            {!c.mine && props.canReport && props.can(P.report) ? <button style={btnGhost} onClick={() => setMode('report')}>{t('pos.report')}</button> : null}
          </div>
        ) : null}
        {done ? <div role="status" style={okText}>{done}</div> : null}
        {mode === 'reply' || mode === 'edit' ? (
          <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
            <textarea style={textarea} aria-label={mode === 'reply' ? t('pos.your_reply') : t('pos.edit_your_comment')} value={text} onChange={(e) => setText(e.target.value)} />
            <div style={row}>
              <button style={btnGold} disabled={busy || !text.trim()} onClick={() => run(
                () => (mode === 'reply' ? api.addComment(props.postId, { body: text.trim(), parentId: c.id }) : api.editComment(c.id, { body: text.trim(), expectedVersion: c.version })),
                null, mode === 'reply' ? t('pos.your_reply_was_not_posted') : t('pos.your_edit_was_not_saved'))}>{mode === 'reply' ? t('pos.post_reply') : t('pos.save_comment')}</button>
              <button style={btnGhost} onClick={() => setMode('none')}>{t('pos.cancel')}</button>
            </div>
          </div>
        ) : null}
        {mode === 'delete' ? (
          <div role="group" aria-label={t('pos.delete_this_comment')} style={{ ...row, marginTop: 6 }}>
            <span style={muted}>{t('pos.delete_this_comment')}</span>
            <button style={btnDanger} disabled={busy} onClick={() => run(() => api.deleteComment(c.id), null, t('growth.community.theCommentWasNotDeleted'))}>{t('pos.yes_delete')}</button>
            <button style={btnGhost} onClick={() => setMode('none')}>{t('pos.keep_it')}</button>
          </div>
        ) : null}
        {mode === 'report' ? (
          <div role="group" aria-label={t('pos.report_this_comment')} style={{ display: 'grid', gap: 6, marginTop: 6 }}>
            <label style={label}>{t('pos.reason_2')}
              <select style={input} value={reason} onChange={(e) => setReason(e.target.value as CommunityReportReason)}>
                {REPORT_REASONS().map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label style={label}>{t('pos.details_optional')}<input style={input} value={detail} onChange={(e) => setDetail(e.target.value)} /></label>
            <div style={row}>
              <button style={btnGold} disabled={busy} onClick={() => run(() => api.reportComment(c.id, { reason, detail: detail.trim() || null }), t('growth.community.reportedModeratorsWillReviewIt'), t('growth.community.theReportWasNotSent'))}>{t('pos.send_report')}</button>
              <button style={btnGhost} onClick={() => setMode('none')}>{t('pos.cancel')}</button>
            </div>
          </div>
        ) : null}
      </article>
      {c.replies?.length ? (
        <ul style={{ listStyle: 'none', padding: '0 0 0 14px', margin: '6px 0 0', display: 'grid', gap: 8 }}>
          {c.replies.map((r) => <CommentItem key={r.id} {...props} c={r} />)}
        </ul>
      ) : null}
    </li>
  );
}
