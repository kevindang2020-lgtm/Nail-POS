// CommunityAdvisoryEditor.tsx — /community/new and /community/drafts/:id (BUILD_PLAN Phase 8, contract §2.5 / §5).
// Write or fix an advisory: every field of CommunityAdvisoryInput, the privacy-scan result (what was hidden, what other
// salons will see), neutral-wording suggestions (and the optional AI wording help), save draft, submit, withdraw.
// A published post of the user's own salon opens here too: saving then goes through PUT /community/posts/:id (a
// version row + change note; blocked data hides it for moderation). `?fromIncident=<id>` starts an advisory from a
// private incident — explicitly, and the text is sanitized by the server's scan (an incident never becomes an
// advisory automatically). The rules must be accepted first (modal). 409 → reload + message.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type {
  CommunityAdvisoryInput, CommunityAmountRange, CommunityAuthorDisplay, CommunityCategory, CommunityChannel, CommunityMyPostView,
  CommunityScanSummary, CommunitySeverity, CommunitySubmitResult, CommunityWordingIssue,
} from '@aipowersalon/api-contracts/tenant';
import { useCan } from '../../components/usePermissions';
import { posCommunityApi as api } from '../../api/posCommunityApi';
import { useCommunityRules } from './CommunityRules';
import { CommunityEvidencePanel } from './CommunityEvidence';
import {
  P, CATEGORIES, CATEGORY_LABEL, EDITABLE, SEVERITIES, SEVERITY_LABEL, WITHDRAWABLE, CommunityHeader, CommunitySubNav, StatusPill,
  body, btnDanger, btnGhost, btnGold, card, cardHead, communityErrorText, errCode, errText, input, isConflict, isPublished, label,
  muted, okText, page, pretty, row, textarea,
} from './communityUi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

const CHANNELS = (): [CommunityChannel, string][] => [['phone', tx('growth.community.channel.phone')], ['sms', tx('growth.community.channel.sms')], ['email', tx('growth.community.channel.email')], ['in_person', tx('growth.community.channel.in_person')], ['online_booking', tx('growth.community.channel.online_booking')], ['social', tx('growth.community.channel.social')], ['other', tx('growth.community.channel.other')]];
const AMOUNTS = (): [CommunityAmountRange, string][] => [['under_50', tx('growth.community.amount.under_50')], ['50_200', tx('growth.community.amount.50_200')], ['200_500', tx('growth.community.amount.200_500')], ['500_2000', tx('growth.community.amount.500_2000')], ['over_2000', tx('growth.community.amount.over_2000')]];

interface Form {
  category: CommunityCategory | ''; severity: CommunitySeverity; title: string; body: string; region: string; incidentDate: string;
  scamMethod: string; channels: CommunityChannel[]; recommendation: string; tags: string; paymentProcessor: string;
  amountRange: CommunityAmountRange | ''; officialReference: string; authorDisplay: CommunityAuthorDisplay | ''; changeNote: string;
}
const EMPTY: Form = { category: '', severity: 'moderate', title: '', body: '', region: '', incidentDate: '', scamMethod: '', channels: [], recommendation: '', tags: '', paymentProcessor: '', amountRange: '', officialReference: '', authorDisplay: '', changeNote: '' };
const fromPost = (p: CommunityMyPostView): Form => ({
  category: p.category, severity: p.severity, title: p.title, body: p.body, region: p.region ?? '', incidentDate: p.incidentDate ?? '',
  scamMethod: p.scamMethod ?? '', channels: p.channels ?? [], recommendation: p.recommendation ?? '', tags: (p.tags ?? []).join(', '),
  paymentProcessor: p.paymentProcessor ?? '', amountRange: p.amountRange ?? '', officialReference: p.officialReference ?? '', authorDisplay: p.authorDisplay ?? '', changeNote: '',
});
const nul = (s: string) => (s.trim() ? s.trim() : null);
function toInput(f: Form): CommunityAdvisoryInput {
  return {
    category: f.category as CommunityCategory, severity: f.severity, title: f.title.trim(), body: f.body.trim(),
    region: nul(f.region), incidentDate: nul(f.incidentDate), scamMethod: nul(f.scamMethod), channels: f.channels,
    recommendation: nul(f.recommendation), tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), paymentProcessor: nul(f.paymentProcessor),
    amountRange: f.amountRange || null, officialReference: nul(f.officialReference), authorDisplay: f.authorDisplay || null,
  };
}
function resultText(s: string): string {
  if (s === 'manager_approval') return tx('pos.sent_to_a_manager_for_approval');
  if (s === 'moderation_review') return tx('pos.sent_to_ai_powersalon_moderators_serious_1gg8');
  if (s.startsWith('published_')) return tx('pos.published_to_the_safety_community');
  if (s === 'sensitive_data_detected') return tx('pos.personal_data_was_found_edit_the_nt09');
  return tx('pos.status_s', { s: String(pretty(s)) });
}

/** Safety Community extras 03 — Safe Draft Completeness Assistant: what context the draft still lacks (all optional
 *  fields — warnings, never a block) and whether evidence is attached. Neutral wording stays the server's deterministic
 *  check plus the optional "Suggest neutral wording" help; this list only points at them. */
export type DraftGap = 'region' | 'incidentDate' | 'scamMethod' | 'channels' | 'recommendation' | 'evidence' | 'evidenceAfterSave';
export function draftGaps(f: Pick<Form, 'region' | 'incidentDate' | 'scamMethod' | 'channels' | 'recommendation'>, evidenceCount: number | null): DraftGap[] {
  const out: DraftGap[] = [];
  if (!f.region.trim()) out.push('region');
  if (!f.incidentDate.trim()) out.push('incidentDate');
  if (!f.scamMethod.trim()) out.push('scamMethod');
  if (!f.channels.length) out.push('channels');
  if (!f.recommendation.trim()) out.push('recommendation');
  if (evidenceCount == null) out.push('evidenceAfterSave'); else if (evidenceCount === 0) out.push('evidence');
  return out;
}

export function CommunityAdvisoryEditor() {
  const { id: routeId } = useParams();
  const [params] = useSearchParams();
  const fromIncidentId = params.get('fromIncident');
  const can = useCan();
  const nav = useNavigate();
  const rules = useCommunityRules(can(P.view));
  const [id, setId] = useState<string | null>(routeId ?? null);
  const [post, setPost] = useState<CommunityMyPostView | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [scan, setScan] = useState<CommunityScanSummary | null>(null);
  const [wording, setWording] = useState<CommunityWordingIssue | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [allowAnonymous, setAllowAnonymous] = useState(false);

  useEffect(() => { setAllowAnonymous(!!rules.settings?.allowAnonymous); }, [rules.settings]);
  // the rules come first — before the first draft and whenever the version changes
  useEffect(() => { if (rules.loaded && !rules.acknowledged && !rules.open) rules.require(); }, [rules.loaded, rules.acknowledged]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadPost = useCallback((pid: string) => api.myPost(pid).then((p) => { setPost(p); setForm(fromPost(p)); setDirty(false); }).catch((e) => setError(communityErrorText(e, tx('growth.community.couldNotLoadThisAdvisory')))), []);
  // a draft created on this page moves the URL to /community/drafts/:id — do not reload over the state we already hold
  const known = useRef<string | null>(null);
  useEffect(() => { if (routeId && routeId !== known.current) { known.current = routeId; setId(routeId); loadPost(routeId); } }, [routeId, loadPost]);
  useEffect(() => {
    if (routeId || !fromIncidentId) return;
    api.incident(fromIncidentId).then((inc) => setForm((f) => ({ ...f, category: inc.category, severity: inc.severity, incidentDate: inc.occurredOn ?? '' })))
      .catch((e) => setError(communityErrorText(e, tx('growth.community.couldNotLoadThePrivateIncident'))));
  }, [routeId, fromIncidentId]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };
  const status = post?.status ?? 'incident_draft';
  const published = !!post && (isPublished(status));
  const editable = !post || EDITABLE.includes(status) || published;
  const mayWrite = published ? can(P.submit) : can(P.draft);

  const applyResult = (r: CommunitySubmitResult) => { setPost(r.post); setForm(fromPost(r.post)); setScan(r.scan); setWording(r.wording); setDirty(false); };
  const fail = async (e: unknown, fallback: string) => {
    if (errCode(e) === 'rules_not_acknowledged') rules.require();
    if (isConflict(e) && id) await loadPost(id);
    const d = (e as { details?: Record<string, any> } | null)?.details;
    const sugg = d?.suggestions ?? d?.error?.suggestions;
    if (errCode(e) === 'wording_requires_rewrite' && Array.isArray(sugg)) setWording({ matched: String(d?.matched ?? d?.error?.matched ?? ''), suggestions: sugg });
    setError(communityErrorText(e, fallback));
  };
  const validate = (): string | null => {
    if (!form.category) return tx('pos.choose_a_category');
    if (form.title.trim().length < 5) return tx('pos.give_the_advisory_a_short_title_cqsb');
    if (form.body.trim().length < 20) return tx('pos.describe_what_happened_at_least_20_msu9');
    return null;
  };

  /** save (create / update draft / edit published) → the saved post (or null on failure) */
  const save = async (): Promise<CommunityMyPostView | null> => {
    const v = validate(); if (v) { setError(v); return null; }
    if (!id) {
      const created = await api.createAdvisory({ ...toInput(form), fromIncidentId: fromIncidentId || null });
      known.current = created.id; setId(created.id); setPost(created); setForm(fromPost(created)); setDirty(false);
      setScan(created.privacyScanFlags?.length ? { blocked: false, flagged: true, categories: created.privacyScanFlags, redactedPreview: created.body } : null);
      nav(`/community/drafts/${encodeURIComponent(created.id)}`, { replace: true });
      return created;
    }
    if (!post) return null;
    if (!dirty) return post;
    const u = { ...toInput(form), expectedVersion: post.version, changeNote: nul(form.changeNote) };
    const r = published ? await api.editPost(id, u) : await api.updateAdvisory(id, u);
    applyResult(r);
    return r.post;
  };
  const onSave = () => rules.ensure(async () => {
    setBusy(true); setError(null); setNotice(null);
    try { const p = await save(); if (p) setNotice(published ? tx('pos.changes_saved_other_salons_see_the_281m') : tx('pos.draft_saved_nothing_is_shared_until_197r')); }
    catch (e) { await fail(e, tx('growth.community.theAdvisoryWasNotSaved')); }
    finally { setBusy(false); }
  });
  const onSubmit = () => rules.ensure(async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const p = await save(); if (!p) return;
      const r = await api.submit(p.id, p.version, !!form.officialReference.trim());
      applyResult(r);
      setNotice(resultText(r.post.status));
    } catch (e) { await fail(e, tx('growth.community.theAdvisoryWasNotSubmitted')); }
    finally { setBusy(false); }
  });
  const onWithdraw = async () => {
    if (!post) return;
    setBusy(true); setError(null); setNotice(null);
    try { const p = await api.withdraw(post.id, post.version); setPost(p); setForm(fromPost(p)); setNotice(tx('growth.community.withdrawnItIsADraftAgain')); }
    catch (e) { await fail(e, tx('growth.community.couldNotWithdraw')); }
    finally { setBusy(false); }
  };
  const onAssist = async () => {
    setError(null); setSuggestion(null);
    try { const r = await api.assist(form.body); setSuggestion(r.suggestion || null); if (!r.suggestion) setNotice(tx('growth.community.noWordingChangesSuggested')); }
    catch (e) { setError(communityErrorText(e, tx('growth.community.writingHelpIsNotAvailable'))); }
  };

  if (!can(P.draft) && !can(P.submit)) return <div style={page}><CommunityHeader title={tx('pos.safety_community')} /><div style={{ padding: 20, ...muted }}>{tx('pos.your_role_cannot_write_community_advisories')}</div></div>;
  const ro = !editable || !mayWrite;
  return (
    <div style={page}>
      <CommunityHeader title={published ? tx('pos.edit_published_advisory') : id ? tx('pos.edit_advisory') : tx('pos.new_advisory')} sub={tx('pos.describe_what_happened_and_how_to_1qfi')} />
      <CommunitySubNav can={can} />
      <div style={body}>
        {post ? (
          <div style={{ ...card, display: 'grid', gap: 6 }} data-testid="community-editor-status">
            <div style={row}><StatusPill s={status} />{post.moderationRequired ? <span style={muted}>{tx('pos.moderators_review_this_category_severity_before_14c9')}</span> : null}</div>
            {post.returnReason ? <div style={errText} data-testid="community-return-reason">{tx('pos.note_from_the_reviewer')}{' '}{post.returnReason}</div> : null}
            {!editable ? <div style={muted}>{tx('pos.this_advisory_cannot_be_edited_while_hx18')}{' '}{pretty(status)}.</div> : null}
          </div>
        ) : null}
        {fromIncidentId && !id ? <div style={{ ...card, ...muted }} data-testid="community-from-incident">{tx('pos.starting_from_one_of_your_private_1521')}</div> : null}
        <form style={{ ...card, display: 'grid', gap: 10 }} aria-label={tx('pos.advisory')} onSubmit={(e) => { e.preventDefault(); onSave(); }}>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}>
            <label style={label}>{tx('pos.category')}
              <select style={input} value={form.category} disabled={ro} onChange={(e) => set('category', e.target.value as CommunityCategory)}>
                <option value="">{tx('pos.choose')}</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              </select>
            </label>
            <label style={label}>{tx('pos.severity_2')}
              <select style={input} value={form.severity} disabled={ro} onChange={(e) => set('severity', e.target.value as CommunitySeverity)}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
              </select>
            </label>
            <label style={label}>{tx('pos.region_optional')}<input style={input} value={form.region} disabled={ro} placeholder={tx('pos.e_g_nj')} onChange={(e) => set('region', e.target.value)} /></label>
            <label style={label}>{tx('pos.when_it_happened_optional')}<input type="date" style={input} value={form.incidentDate} disabled={ro} onChange={(e) => set('incidentDate', e.target.value)} /></label>
          </div>
          <label style={label}>{tx('pos.title')}<input style={input} value={form.title} disabled={ro} maxLength={140} onChange={(e) => set('title', e.target.value)} /></label>
          <label style={label}>{tx('pos.what_happened')}
            <textarea style={{ ...textarea, minHeight: 130 }} value={form.body} disabled={ro} onChange={(e) => set('body', e.target.value)}
              placeholder={tx('pos.example_a_caller_claiming_to_be_1dxb')} />
          </label>
          <label style={label}>{tx('pos.how_it_was_attempted_optional')}<input style={input} value={form.scamMethod} disabled={ro} onChange={(e) => set('scamMethod', e.target.value)} /></label>
          <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
            <legend style={{ ...label, marginBottom: 4 }}>{tx('pos.channels_optional')}</legend>
            <div style={row}>
              {CHANNELS().map(([k, l]) => (
                <label key={k} style={{ ...row, fontSize: 12.5 }}>
                  <input type="checkbox" disabled={ro} checked={form.channels.includes(k)} onChange={(e) => set('channels', e.target.checked ? [...form.channels, k] : form.channels.filter((c) => c !== k))} /> {l}
                </label>
              ))}
            </div>
          </fieldset>
          <label style={label}>{tx('pos.what_helped_what_other_salons_should_qwxp')}<textarea style={textarea} value={form.recommendation} disabled={ro} onChange={(e) => set('recommendation', e.target.value)} /></label>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}>
            <label style={label}>{tx('pos.tags_optional_comma_separated')}<input style={input} value={form.tags} disabled={ro} onChange={(e) => set('tags', e.target.value)} /></label>
            <label style={label}>{tx('pos.payment_processor_optional')}<input style={input} value={form.paymentProcessor} disabled={ro} onChange={(e) => set('paymentProcessor', e.target.value)} /></label>
            <label style={label}>{tx('pos.amount_involved_optional')}
              <select style={input} value={form.amountRange} disabled={ro} onChange={(e) => set('amountRange', e.target.value as CommunityAmountRange | '')}>
                <option value="">{tx('pos.not_shared')}</option>
                {AMOUNTS().map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label style={label}>{tx('pos.official_report_reference_optional')}<input style={input} value={form.officialReference} disabled={ro} placeholder={tx('pos.e_g_police_report_number')} onChange={(e) => set('officialReference', e.target.value)} /></label>
            <label style={label}>{tx('pos.show_my_salon_as')}
              <select style={input} value={form.authorDisplay} disabled={ro} onChange={(e) => set('authorDisplay', e.target.value as CommunityAuthorDisplay | '')}>
                <option value="">{tx('pos.salon_default')}</option>
                <option value="tenant_name">{tx('pos.our_salon_name')}</option>
                <option value="display_name">{tx('pos.our_community_display_name')}</option>
                {allowAnonymous ? <option value="anonymous">{tx('pos.anonymous_a_salon_in')}</option> : null}
              </select>
            </label>
          </div>
          {published ? <label style={label}>{tx('pos.what_changed_shown_in_the_version_1hr5')}<input style={input} value={form.changeNote} onChange={(e) => set('changeNote', e.target.value)} /></label> : null}
          {!ro ? (
            <div style={row}>
              <button type="submit" style={btnGhost} disabled={busy}>{published ? tx('pos.save_changes') : tx('pos.save_draft_2')}</button>
              {!published ? <button type="button" style={btnGold} disabled={busy} onClick={onSubmit}>{tx('pos.submit_advisory')}</button> : null}
              <button type="button" style={btnGhost} disabled={busy || form.body.trim().length < 10} onClick={onAssist}>{tx('pos.suggest_neutral_wording')}</button>
            </div>
          ) : null}
          {post && WITHDRAWABLE.includes(status) && can(P.draft) ? <div style={row}><button type="button" style={btnDanger} disabled={busy} onClick={onWithdraw}>{tx('pos.withdraw_to_draft')}</button></div> : null}
        </form>
        {!ro && !published ? (() => {
          const gaps = draftGaps(form, post ? (post.evidence?.count ?? 0) : null);
          return (
            <section style={card} aria-label={tx('growth.community.gaps.title')} data-testid="community-draft-gaps">
              <div style={cardHead}>{tx('growth.community.gaps.title')}</div>
              {gaps.length === 0 ? <div style={okText} data-testid="community-draft-gaps-ok">{tx('growth.community.gaps.none')}</div> : (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{gaps.map((g) => <li key={g} data-testid={`community-gap-${g}`}>{tx('growth.community.gaps.' + g)}</li>)}</ul>
              )}
              <div style={{ ...muted, marginTop: 6 }}>{tx('growth.community.gaps.wording')}</div>
            </section>
          );
        })() : null}
        {notice ? <div role="status" style={okText} data-testid="community-submit-result">{notice}</div> : null}
        {error ? <div role="alert" style={errText} data-testid="community-editor-error">{error}</div> : null}
        {suggestion ? (
          <section style={card} aria-label={tx('pos.suggested_wording')}>
            <div style={cardHead}>{tx('pos.suggested_wording')}{' '}<span style={muted}>{tx('pos.ai_suggestion_check_it_before_you_5rvi')}</span></div>
            <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{suggestion}</div>
            <div style={{ ...row, marginTop: 8 }}><button style={btnGhost} onClick={() => { set('body', suggestion); setSuggestion(null); }}>{tx('pos.use_this_wording')}</button></div>
          </section>
        ) : null}
        {wording ? (
          <section style={card} aria-label={tx('pos.wording_check')} data-testid="community-wording">
            <div style={cardHead}>{tx('pos.wording_check')}</div>
            <div style={{ fontSize: 13 }}>“{wording.matched}{tx('pos.sounds_like_an_accusation_neutral_alternatives_lcjk')}</div>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13 }}>{wording.suggestions.map((s) => <li key={s}>{s}</li>)}</ul>
          </section>
        ) : null}
        {scan || (post?.privacyScanFlags?.length ?? 0) > 0 ? (
          <section style={card} aria-label={tx('pos.privacy_check')} data-testid="community-scan">
            <div style={cardHead}>{tx('pos.privacy_check')}</div>
            {scan?.blocked ? <div style={errText}>{tx('pos.card_bank_or_id_numbers_were_bgg3')}</div> : null}
            {(scan?.categories ?? post?.privacyScanFlags ?? []).length ? (
              <div style={{ fontSize: 13 }}>{tx('pos.hidden_before_sharing')}{' '}{(scan?.categories ?? post?.privacyScanFlags ?? []).map(pretty).join(', ')}.</div>
            ) : <div style={okText}>{tx('pos.no_personal_data_found')}</div>}
            {scan?.redactedPreview ? <><div style={{ ...muted, marginTop: 8 }}>{tx('pos.what_other_salons_will_see')}</div><div style={{ fontSize: 13, whiteSpace: 'pre-wrap', background: '#F7F2EA', borderRadius: 8, padding: '8px 10px' }} data-testid="community-redacted-preview">{scan.redactedPreview}</div></> : null}
          </section>
        ) : null}
        {id && post && can(P.evidence) ? <CommunityEvidencePanel postId={id} canUpload={post.viewerActions?.canUploadEvidence ?? true} /> : null}
      </div>
      {rules.modal}
    </div>
  );
}
