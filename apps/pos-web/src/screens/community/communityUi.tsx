// communityUi.tsx — shared look, plain-language labels and error wording for the POS Safety Community screens
// (BUILD_PLAN Phase 8, contract §5). Reuses the Champagne Gold card / button styles of the AI workspaces.
import type React from 'react';
import { NavLink } from 'react-router-dom';
import {
  COMMUNITY_CATEGORIES, type CommunityAuthor, type CommunityCategory, type CommunityPostStatus, type CommunityReportReason,
  type CommunitySeverity, type CommunityVerificationLabel,
} from '@aipowersalon/api-contracts/tenant';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { statusLabelOrNull, humanizeCode } from '../../i18n/status-label';
export { card, cardHead, input, btnGold, btnGhost, btnDanger, muted, errText, okText, pill, when, GOLD } from '../ai-queue/aiQueueUi';

/** The permission keys the server checks on every /community route (packages/permissions rbac.ts). */
export const P = {
  view: 'community.feed.view', incident: 'community.incident.create', draft: 'community.advisory.draft',
  submit: 'community.advisory.submit', approve: 'community.advisory.approve', comment: 'community.comment.create',
  evidence: 'community.evidence.upload', settings: 'community.settings.manage', report: 'community.report.create',
  dispute: 'community.dispute.create', appeal: 'community.appeal.create', follow: 'community.follow',
} as const;
export type Can = (permission: string) => boolean;

export const CATEGORY_LABEL: Record<CommunityCategory, string> = {
  get payment_fraud_attempt() { return tx('growth.community.category.payment_fraud_attempt'); }, get chargeback_abuse() { return tx('growth.community.category.chargeback_abuse'); }, get fake_payment_confirmation() { return tx('growth.community.category.fake_payment_confirmation'); },
  get counterfeit_currency() { return tx('growth.community.category.counterfeit_currency'); }, get stolen_payment_method_concern() { return tx('growth.community.category.stolen_payment_method_concern'); }, get gift_card_scam() { return tx('growth.community.category.gift_card_scam'); },
  get phone_scam() { return tx('growth.community.category.phone_scam'); }, get phishing_email_or_text() { return tx('growth.community.category.phishing_email_or_text'); }, get fake_vendor_or_supplier() { return tx('growth.community.category.fake_vendor_or_supplier'); },
  get fake_ai_powersalon_representative() { return tx('growth.community.category.fake_ai_powersalon_representative'); }, get account_takeover_attempt() { return tx('growth.community.category.account_takeover_attempt'); },
  get impersonation_of_staff() { return tx('growth.community.category.impersonation_of_staff'); }, get booking_no_show_pattern() { return tx('growth.community.category.booking_no_show_pattern'); }, get fake_booking_spam() { return tx('growth.community.category.fake_booking_spam'); },
  get refund_abuse() { return tx('growth.community.category.refund_abuse'); }, get coupon_or_deal_abuse() { return tx('growth.community.category.coupon_or_deal_abuse'); }, get review_extortion() { return tx('growth.community.category.review_extortion'); },
  get theft_or_shoplifting() { return tx('growth.community.category.theft_or_shoplifting'); }, get property_damage() { return tx('growth.community.category.property_damage'); }, get harassment_or_abusive_conduct() { return tx('growth.community.category.harassment_or_abusive_conduct'); },
  get threat_or_violence() { return tx('growth.community.category.threat_or_violence'); }, get employee_safety_incident() { return tx('growth.community.category.employee_safety_incident'); }, get customer_safety_incident() { return tx('growth.community.category.customer_safety_incident'); },
  get health_or_hygiene_concern() { return tx('growth.community.category.health_or_hygiene_concern'); }, get product_recall_or_safety_alert() { return tx('growth.community.category.product_recall_or_safety_alert'); },
  get data_breach_or_privacy_concern() { return tx('growth.community.category.data_breach_or_privacy_concern'); }, get other() { return tx('growth.community.category.other'); },
};
export const CATEGORIES = COMMUNITY_CATEGORIES;
export const SEVERITIES: CommunitySeverity[] = ['informational', 'low', 'moderate', 'high', 'critical'];
export const SEVERITY_LABEL: Record<CommunitySeverity, string> = { get informational() { return tx('growth.community.severity.informational'); }, get low() { return tx('growth.community.severity.low'); }, get moderate() { return tx('growth.community.severity.moderate'); }, get high() { return tx('growth.community.severity.high'); }, get critical() { return tx('growth.community.severity.critical'); } };
export const SEVERITY_TONE: Record<CommunitySeverity, { bg: string; fg: string }> = {
  informational: { bg: '#F3ECE1', fg: '#6C6965' }, low: { bg: '#EEF2E6', fg: '#56703A' }, moderate: { bg: '#FBEEDD', fg: '#9B6B1E' },
  high: { bg: '#F7DDD3', fg: '#B4451E' }, critical: { bg: '#F4CFC4', fg: '#8F2F13' },
};
export const STATUS_LABEL: Record<CommunityPostStatus, string> = {
  get incident_draft() { return tx('growth.community.status.incident_draft'); }, get tenant_review() { return tx('growth.community.status.tenant_review'); }, get privacy_scan() { return tx('growth.community.status.privacy_scan'); }, get manager_approval() { return tx('growth.community.status.manager_approval'); },
  get moderation_review() { return tx('growth.community.status.moderation_review'); }, get published_unverified() { return tx('growth.community.status.published_unverified'); },
  get published_evidence_reviewed() { return tx('growth.community.status.published_evidence_reviewed'); }, get published_multiple_reports() { return tx('growth.community.status.published_multiple_reports'); },
  get published_official_report() { return tx('growth.community.status.published_official_report'); }, get returned_for_correction() { return tx('growth.community.status.returned_for_correction'); },
  get sensitive_data_detected() { return tx('growth.community.status.sensitive_data_detected'); }, get insufficient_information() { return tx('growth.community.status.insufficient_information'); },
  get evidence_requested() { return tx('growth.community.status.evidence_requested'); }, get rejected() { return tx('growth.community.status.rejected'); }, get disputed() { return tx('growth.community.status.disputed'); }, get corrected() { return tx('growth.community.status.corrected'); },
  get resolved() { return tx('growth.community.status.resolved'); }, get removed() { return tx('growth.community.status.removed'); }, get archived() { return tx('growth.community.status.archived'); },
};
export const LABEL_TEXT: Record<CommunityVerificationLabel, string> = {
  get unverified() { return tx('growth.community.label.unverified'); }, get evidence_reviewed() { return tx('growth.community.label.evidence_reviewed'); }, get multiple_reports() { return tx('growth.community.label.multiple_reports'); }, get official_report() { return tx('growth.community.label.official_report'); },
};
// label tables translate when read (getters / functions) — a language switch re-labels in place
export const REPORT_REASONS = (): [CommunityReportReason, string][] => [
  ['contains_personal_info', tx('growth.community.reportReason.contains_personal_info')], ['accusatory_or_defamatory', tx('growth.community.reportReason.accusatory_or_defamatory')], ['inaccurate', tx('growth.community.reportReason.inaccurate')], ['spam', tx('growth.community.reportReason.spam')], ['harassment', tx('growth.community.reportReason.harassment')], ['other', tx('growth.community.reportReason.other')],
];
/** statuses the author may still edit (contract §2: draft / returned / sensitive / evidence requested) */
export const EDITABLE: CommunityPostStatus[] = ['incident_draft', 'returned_for_correction', 'sensitive_data_detected', 'evidence_requested'];
/** statuses the author may withdraw back to a draft */
export const WITHDRAWABLE: CommunityPostStatus[] = ['manager_approval', 'sensitive_data_detected', 'returned_for_correction'];
export const isPublished = (s: CommunityPostStatus) => s.startsWith('published_') || s === 'disputed' || s === 'corrected';

export const authorText = (a: CommunityAuthor | null | undefined) => (a ? `${a.label}${a.isOwnSalon ? tx('pos.your_salon_2') : ''}` : tx('pos.a_salon'));
const codeText = (key: string, code: string) => { const s = tx(key); return s === key ? humanizeCode(code) : s; };
/** a channel / amount-range code as the editor names it (growth.community.channel.* / .amount.*) */
export const communityChannelLabel = (c: string) => codeText(`growth.community.channel.${c}`, c);
export const communityAmountLabel = (a: string) => codeText(`growth.community.amount.${a}`, a);
export const pretty = (s: string | null | undefined) => statusLabelOrNull('community', s) ?? humanizeCode(s || '');

type Err = { status?: number; code?: string; message?: string; details?: Record<string, any> } | null;
const detail = (e: Err, k: string): any => e?.details?.[k] ?? e?.details?.error?.[k];
/** the codes that mean "reload what you are looking at" */
export const isConflict = (e: unknown) => {
  const x = e as Err;
  return x?.status === 409 && (x?.code === 'version_conflict' || x?.code === 'VERSION_CONFLICT' || !x?.code || x.code === 'ERROR');
};
export const errCode = (e: unknown) => (e as Err)?.code || '';

/** One plain sentence for a server error (contract §1–§4 error codes). 403 restrictions are explained, not hidden. */
export function communityErrorText(e: unknown, fallback = tx('pos.that_did_not_work')): string {
  const err = e as Err;
  switch (err?.code) {
    case 'version_conflict': case 'VERSION_CONFLICT': return tx('pos.someone_else_changed_this_a_moment_1yb7');
    case 'community_suspended': return tx('pos.ai_powersalon_moderators_have_suspended_your_116l');
    case 'posting_restricted': case 'community_posting_restricted': return tx('pos.ai_powersalon_moderators_have_paused_posting_1h6j');
    case 'commenting_restricted': case 'community_commenting_restricted': return tx('pos.ai_powersalon_moderators_have_paused_commenting_m4ft');
    case 'community_disabled': return tx('pos.the_safety_community_is_turned_off_pdkp');
    case 'rules_not_acknowledged': return tx('pos.please_read_and_accept_the_community_1ofm');
    case 'comments_locked': return tx('pos.comments_are_closed_on_this_post');
    case 'search_identifier_rejected': return tx('pos.search_by_what_happened_not_by_110s');
    case 'rate_limited': { const m = detail(err, 'retryAfterMinutes'); return tx('pos.too_many_attempts_please_wait_v0_e0h0', { v0: String(m ? tx('pos.about_m_minute_plural', { m: String(m), plural: String(m === 1 ? '' : 's') }) : tx('pos.a_little')) }); }
    case 'evidence_storage_not_configured': return tx('pos.evidence_uploads_are_not_available_yet_13sz');
    case 'evidence_upload_failed': return tx('pos.the_file_could_not_be_uploaded_ent9');
    case 'ai_not_configured': return tx('pos.writing_help_is_not_available_right_1xpk');
    case 'wording_requires_rewrite': return tx('pos.some_words_sound_like_an_accusation_13ez');
    case 'advisory_submission_rejected': { const r = detail(err, 'reason'); return tx('pos.this_advisory_cannot_be_submitted_v0', { v0: String(r ? `: ${pretty(String(r))}` : '.') }); }
    case 'comment_contains_payment_data': return tx('pos.remove_card_bank_or_id_numbers_psed');
    case 'not_visible': case 'post_not_found': return tx('pos.this_post_is_not_available_it_l5oe');
    case 'not_your_post': return tx('pos.only_the_salon_that_wrote_this_1mq3');
    case 'permission_denied': return tx('pos.your_role_cannot_do_this_in_eydt');
    case 'reason_required': return tx('pos.please_give_a_reason');
    case 'invalid_input': { const f = detail(err, 'field'); return tx('pos.please_check_v0_and_try_again', { v0: String(f ? pretty(String(f)) : tx('pos.the_form')) }); }
    case 'already_reported': return tx('pos.your_salon_has_already_reported_this');
    default: break;
  }
  if (err?.status === 409) return tx('pos.someone_else_changed_this_a_moment_1yb7');
  if (err?.status === 403) return tx('pos.you_do_not_have_permission_for_1yot');
  if (err?.status === 503) return tx('pos.this_part_of_the_safety_community_15hf');
  return err?.message || fallback;
}

export const page: React.CSSProperties = { height: '100%', overflow: 'auto', background: 'var(--aps-page, #F7EFE3)', fontFamily: 'var(--aps-font-body, Hanken Grotesk)' };
export const header: React.CSSProperties = { display: 'flex', gap: 12, padding: '14px 20px', borderBottom: '1px solid var(--line)', background: '#FFFCF6', flexWrap: 'wrap', alignItems: 'center' };
export const titleStyle: React.CSSProperties = { fontWeight: 800, fontSize: 18, fontFamily: 'var(--aps-font-head, Playfair Display)', color: '#2C2A27', margin: 0 };
export const body: React.CSSProperties = { padding: 20, display: 'grid', gap: 16, maxWidth: 1100 };
export const row: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' };
export const label: React.CSSProperties = { display: 'grid', gap: 4, fontSize: 12.5, color: '#4A4744', fontWeight: 600 };
export const textarea: React.CSSProperties = { minHeight: 90, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', background: '#fff', fontSize: 13, fontFamily: 'inherit', resize: 'vertical' };

export function SeverityPill({ s }: { s: CommunitySeverity }) {
  const t = SEVERITY_TONE[s] ?? SEVERITY_TONE.moderate;
  return <span style={{ background: t.bg, color: t.fg, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>{SEVERITY_LABEL[s] ?? s}</span>;
}
export function StatusPill({ s }: { s: CommunityPostStatus }) {
  const on = isPublished(s) || s === 'resolved';
  const warn = s === 'returned_for_correction' || s === 'sensitive_data_detected' || s === 'evidence_requested' || s === 'manager_approval' || s === 'moderation_review';
  const bad = s === 'rejected' || s === 'removed';
  const tone = bad ? { bg: '#F7DDD3', fg: '#B4451E' } : warn ? { bg: '#FBEEDD', fg: '#9B6B1E' } : on ? { bg: '#E4F0E7', fg: '#3B6B47' } : { bg: '#F3ECE1', fg: '#6C6965' };
  return <span data-testid="community-status" style={{ background: tone.bg, color: tone.fg, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>{STATUS_LABEL[s] ?? pretty(s)}</span>;
}

const tabStyle = ({ isActive }: { isActive: boolean }): React.CSSProperties => ({
  height: 32, padding: '0 12px', borderRadius: 8, border: `1px solid ${isActive ? '#A96F22' : 'var(--line)'}`, background: isActive ? '#A96F22' : '#fff',
  color: isActive ? '#fff' : '#4A4744', fontSize: 12.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', textDecoration: 'none',
});
/** the Safety Community's own section links — each hidden by the permission its page needs */
export function CommunitySubNav({ can }: { can: Can }) {
  const links: [string, string, string][] = [
    ['/community', tx('growth.community.nav.feed'), P.view], ['/community/new', tx('growth.community.nav.new'), P.draft], ['/community/drafts', tx('growth.community.nav.drafts'), P.draft],
    ['/community/approvals', tx('growth.community.nav.approvals'), P.approve], ['/community/incidents', tx('growth.community.nav.incidents'), P.incident], ['/community/settings', tx('growth.community.nav.settings'), P.view],
  ];
  return (
    <nav aria-label={tx('pos.safety_community_sections')} style={{ padding: '12px 20px 0', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {links.filter(([, , p]) => can(p)).map(([to, l]) => <NavLink key={to} to={to} end style={tabStyle}>{l}</NavLink>)}
    </nav>
  );
}

export function CommunityHeader({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div style={header}>
      <div style={{ display: 'grid', gap: 2 }}>
        <h1 style={titleStyle}>{title}</h1>
        {sub ? <span style={{ color: '#8A857E', fontSize: 12.5 }}>{sub}</span> : null}
      </div>
      {children ? <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>{children}</div> : null}
    </div>
  );
}
