// CommunityApprovalsScreen.tsx — /community/approvals: advisories written by the salon's staff that wait for a manager
// (contract §2.5: GET /community/mine?kind=awaiting_approval; POST advisories/:id/approve {expectedVersion};
// POST advisories/:id/return {expectedVersion, note — required}). Approving publishes it — or, for serious categories /
// critical posts, hands it to AI PowerSalon moderation (the screen says which happened). 409 → reload + message.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CommunityMyPostView } from '@aipowersalon/api-contracts/tenant';
import { useCan } from '../../components/usePermissions';
import { useRealtime } from '../../realtime/useRealtime';
import { posCommunityApi as api } from '../../api/posCommunityApi';
import {
  P, CATEGORY_LABEL, CommunityHeader, CommunitySubNav, SeverityPill, StatusPill, body, btnDanger, btnGhost, btnGold, card,
  communityErrorText, errText, isConflict, label, muted, okText, page, pretty, row, textarea, when,
} from './communityUi';
import { t } from '@aipowersalon/mobile-sdk/i18n';

export function approvedText(p: CommunityMyPostView): string {
  if (p.status === 'moderation_review') return t('pos.approved_title_it_now_goes_to_1x3a', { title: String(p.title) });
  if (p.status.startsWith('published_')) return t('pos.approved_and_published_title', { title: String(p.title) });
  return t('pos.approved_title_status', { title: String(p.title), status: String(pretty(p.status)) });
}

/** Safety Community extras 02 — moderation queue SLA view: how many advisories wait and for how long, from each record's
 *  own submitted / last-changed time (updatedAt). Read-only; nothing here approves anything. */
export interface ApprovalBacklog { waiting: number; shown: number; oldestMs: number | null; over24h: number; over72h: number }
const HOUR = 3_600_000;
export function approvalBacklog(items: Pick<CommunityMyPostView, 'updatedAt'>[], total: number, now: number = Date.now()): ApprovalBacklog {
  const ages = items.map((p) => now - Date.parse(p.updatedAt)).filter((a) => Number.isFinite(a) && a >= 0);
  return { waiting: Math.max(total, items.length), shown: items.length, oldestMs: ages.length ? Math.max(...ages) : null,
    over24h: ages.filter((a) => a >= 24 * HOUR).length, over72h: ages.filter((a) => a >= 72 * HOUR).length };
}
export function ageText(ms: number): string {
  if (ms < HOUR) return t('growth.community.sla.age.min', { n: String(Math.max(1, Math.floor(ms / 60_000))) });
  if (ms < 48 * HOUR) return t('growth.community.sla.age.hours', { n: String(Math.floor(ms / HOUR)) });
  return t('growth.community.sla.age.days', { n: String(Math.floor(ms / (24 * HOUR))) });
}

export function CommunityApprovalsScreen() {
  const can = useCan();
  const [items, setItems] = useState<CommunityMyPostView[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [returning, setReturning] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!can(P.approve)) return Promise.resolve();
    return api.mine('awaiting_approval', 1, 50).then((r) => { setItems(r.items); setTotal(Number(r.total) || 0); }).catch((e) => setError(communityErrorText(e, t('growth.community.couldNotLoadTheApprovals'))));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useRealtime(['community'], load);

  const act = async (p: CommunityMyPostView, fn: () => Promise<CommunityMyPostView>, ok: (r: CommunityMyPostView) => string) => {
    setBusy(p.id); setError(null); setNotice(null);
    try { const r = await fn(); setNotice(ok(r)); setReturning(null); setNote(''); await load(); }
    catch (e) { if (isConflict(e)) await load(); setError(communityErrorText(e, t('pos.that_did_not_work'))); }
    finally { setBusy(null); }
  };

  if (!can(P.approve)) return <div style={page}><CommunityHeader title={t('pos.advisory_approvals')} /><div style={{ padding: 20, ...muted }}>{t('pos.only_owners_and_managers_approve_community_eu8i')}</div></div>;
  return (
    <div style={page}>
      <CommunityHeader title={t('pos.advisory_approvals')} sub={t('pos.check_each_advisory_names_no_one_dzup')} />
      <CommunitySubNav can={can} />
      <div style={body}>
        {notice ? <div role="status" style={okText} data-testid="community-approval-result">{notice}</div> : null}
        {error ? <div role="alert" style={errText}>{error}</div> : null}
        {items && items.length ? (() => {
          const b = approvalBacklog(items, total);
          return (
            <section style={card} aria-label={t('growth.community.sla.title')} data-testid="community-approval-sla">
              <div style={{ ...row, justifyContent: 'space-between' }}>
                <strong>{t('growth.community.sla.backlog', { n: String(b.waiting) })}</strong>
                <span data-testid="community-approval-oldest">{b.oldestMs == null ? '—' : (b.shown < b.waiting ? t('growth.community.sla.oldestShown', { age: ageText(b.oldestMs), n: String(b.shown) }) : t('growth.community.sla.oldest', { age: ageText(b.oldestMs) }))}</span>
              </div>
              <div style={{ ...row, marginTop: 4 }}>
                <span className={b.over24h ? 'pill warn' : 'pill'} data-testid="community-approval-over24">{t('growth.community.sla.over24', { n: String(b.over24h) })}</span>
                <span className={b.over72h ? 'pill bad' : 'pill'} data-testid="community-approval-over72">{t('growth.community.sla.over72', { n: String(b.over72h) })}</span>
              </div>
              <div style={{ ...muted, marginTop: 4 }}>{t('growth.community.sla.rule')}</div>
            </section>
          );
        })() : null}
        {!items ? <div style={muted}>{t('pos.loading')}</div> : items.length === 0 ? <div style={{ ...card, ...muted }} data-testid="community-approvals-empty">{t('pos.nothing_is_waiting_for_approval')}</div> : (
          <ul aria-label={t('pos.advisories_waiting_for_approval')} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
            {items.map((p) => (
              <li key={p.id} style={card} data-testid="community-approval-row">
                <div style={{ ...row, justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: 14.5 }}>{p.title}</strong>
                  <div style={row}><SeverityPill s={p.severity} /><StatusPill s={p.status} /></div>
                </div>
                <div style={{ ...muted, marginTop: 4 }}>{CATEGORY_LABEL[p.category] ?? p.category} {t('pos.submitted_2')}{' '}{when(p.updatedAt)}{Number.isFinite(Date.parse(p.updatedAt)) ? <span data-testid="community-approval-age">{' · '}{t('growth.community.sla.waiting', { age: ageText(Math.max(0, Date.now() - Date.parse(p.updatedAt))) })}</span> : null}{p.createdByMe ? t('pos.written_by_you') : ''}{p.moderationRequired ? t('pos.moderators_review_it_after_you_approve') : ''}</div>
                <div style={{ fontSize: 13, marginTop: 6, whiteSpace: 'pre-wrap' }}>{p.body}</div>
                {p.privacyScanFlags?.length ? <div style={{ ...muted, marginTop: 6 }}>{t('pos.hidden_by_the_privacy_check')}{' '}{p.privacyScanFlags.map(pretty).join(', ')}.</div> : null}
                {p.recommendation ? <div style={{ fontSize: 12.5, marginTop: 4 }}><strong>{t('pos.what_helped')}</strong> {p.recommendation}</div> : null}
                <div style={{ ...row, marginTop: 8 }}>
                  <button style={btnGold} disabled={busy === p.id} aria-label={t('pos.approve_title', { title: String(p.title) })} onClick={() => act(p, () => api.approve(p.id, p.version), approvedText)}>{t('pos.approve')}</button>
                  <button style={btnGhost} disabled={busy === p.id} aria-label={t('pos.return_title', { title: String(p.title) })} onClick={() => { setReturning(p.id); setNote(''); }}>{t('pos.return_for_correction')}</button>
                  <Link to={`/community/drafts/${encodeURIComponent(p.id)}`} style={{ fontSize: 12.5 }}>{t('pos.open')}</Link>
                </div>
                {returning === p.id ? (
                  <div role="group" aria-label={t('pos.return_title_for_correction', { title: String(p.title) })} style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                    <label style={label}>{t('pos.note_for_the_writer')}<textarea style={textarea} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('pos.what_needs_to_change')} /></label>
                    <div style={row}>
                      <button style={btnDanger} disabled={busy === p.id || note.trim().length < 3} onClick={() => act(p, () => api.returnAdvisory(p.id, p.version, note.trim()), () => t('pos.returned_title_to_the_writer', { title: String(p.title) }))}>{t('pos.send_back')}</button>
                      <button style={btnGhost} onClick={() => setReturning(null)}>{t('pos.cancel')}</button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
