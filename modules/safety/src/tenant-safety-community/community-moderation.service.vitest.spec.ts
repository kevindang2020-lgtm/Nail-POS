// community-moderation.service.vitest.spec — BUILD_PLAN Phase 8 (agent B): the pure half of the moderation center — request
// validation and the post-action planner over the core's REAL workflow (bugs 4, 5, 12), plus the restrictions port.
import { describe, it, expect } from 'vitest';
import { planPostAction, validatePostAction, visibilityFor, paging, reasonOf, CommunityRestrictions, CommunityModerationService, CommunityModerationError, type PostActionInput } from './community-moderation.service';
import type { PostRow } from './community.repository';

const post = (over: Partial<PostRow> = {}): PostRow => ({
  id: '00000000-0000-4000-8000-000000000001', originTenantId: '00000000-0000-4000-8000-0000000000a1', originBranchId: null, classification: 'community_advisory',
  visibility: 'draft', status: 'moderation_review', category: 'phone_scam', severity: 'high', region: 'NJ', title: 'Caller asks for gift cards',
  redactedBody: 'A caller claiming to be our supplier asked for gift cards.', privacyScanFlags: [], moderationRequired: true, verificationLabel: 'unverified',
  version: 3, createdByUserId: '00000000-0000-4000-8000-0000000000b1', createdAt: '2026-10-01T00:00:00Z', authorDisplay: 'display_name', commentsLocked: false, ...over,
} as PostRow);
const req = (over: Partial<PostActionInput> = {}): PostActionInput => ({ action: 'publish', reason: 'reviewed and fine', expectedVersion: 3, caseId: null, label: null, severity: null, targetPostId: null, messageToTenant: null, redactions: [], ...over });
const NOW = '2026-10-08T12:00:00.000Z';
const plan = (p: PostRow, r: PostActionInput, target: PostRow | null = null) => planPostAction(p, r, { now: NOW, authorLabel: 'Bella Nails', target });
const code = (fn: () => unknown) => { try { fn(); return null; } catch (e: any) { return e instanceof CommunityModerationError ? `${e.status}:${e.code}` : String(e?.message); } };

describe('validatePostAction', () => {
  it('needs a reason of 8+ chars, a known action and a version', () => {
    expect(code(() => validatePostAction({ action: 'publish', reason: 'short', expectedVersion: 1 } as any))).toBe('400:invalid_input');
    expect(code(() => validatePostAction({ action: 'nuke', reason: 'long enough reason', expectedVersion: 1 } as any))).toBe('400:invalid_input');
    expect(code(() => validatePostAction({ action: 'publish', reason: 'long enough reason' } as any))).toBe('400:invalid_input');
    expect(validatePostAction({ action: 'publish', reason: '  long enough reason ', expectedVersion: 2 } as any).reason).toBe('long enough reason');
  });
  it('reject / request_* must carry a message for the salon (the internal reason is never shown as returnReason)', () => {
    for (const action of ['reject', 'request_evidence', 'request_changes'])
      expect(code(() => validatePostAction({ action, reason: 'internal reason here', expectedVersion: 1 } as any))).toBe('400:invalid_input');
    expect(validatePostAction({ action: 'request_changes', reason: 'internal reason here', expectedVersion: 1, messageToTenant: 'Please remove the street name.' } as any).messageToTenant).toBe('Please remove the street name.');
  });
  it('per-action fields are required and typed', () => {
    expect(code(() => validatePostAction({ action: 'set_label', reason: 'long enough reason', expectedVersion: 1 } as any))).toBe('400:invalid_input');
    expect(code(() => validatePostAction({ action: 'set_label', reason: 'long enough reason', expectedVersion: 1, label: 'verified' } as any))).toBe('400:invalid_input');
    expect(code(() => validatePostAction({ action: 'merge_into', reason: 'long enough reason', expectedVersion: 1, targetPostId: 'case-1' } as any))).toBe('400:invalid_input');
    expect(code(() => validatePostAction({ action: 'redact', reason: 'long enough reason', expectedVersion: 1, redactions: [] } as any))).toBe('400:invalid_input');
    expect(code(() => validatePostAction({ action: 'publish', reason: 'long enough reason', expectedVersion: 1, caseId: 'case-abc' } as any))).toBe('400:invalid_input');   // bug 3: no fabricated case ids
  });
});

describe('planPostAction — publish (bug 4)', () => {
  it('publishes from moderation_review to the label-matched state, never evidence_reviewed by default', () => {
    const pl = plan(post(), req());
    expect(pl.next.status).toBe('published_unverified');
    expect(pl.next.visibility).toBe('community_published');
    expect(pl.next.authorLabel).toBe('Bella Nails');
    expect(pl.next.publishedAt).toBe(NOW);
    expect(pl.domainEvent).toBe('COMMUNITY_ADVISORY_PUBLISHED');
    expect(pl.fanout).toEqual({ kind: 'published' });
    expect(pl.caseOutcome).toBe('resolved');
  });
  it('evidence_reviewed only when the label says so', () => {
    expect(plan(post(), req({ label: 'evidence_reviewed' })).next.status).toBe('published_evidence_reviewed');
    expect(plan(post({ verificationLabel: 'official_report' }), req()).next.status).toBe('published_official_report');
  });
  it('uses the REAL status: a draft, a rejected or an already-published post cannot be "published" by a moderator', () => {
    for (const status of ['incident_draft', 'rejected', 'manager_approval', 'published_unverified', 'removed'])
      expect(code(() => plan(post({ status: status as any }), req()))).toBe('409:illegal_transition');
  });
  it('a sensitive_data_detected post (bug 5) can be published after a re-scan — and is refused while it still has payment data', () => {
    expect(plan(post({ status: 'sensitive_data_detected' }), req()).next.status).toBe('published_unverified');
    expect(code(() => plan(post({ status: 'sensitive_data_detected', redactedBody: 'card 4111 1111 1111 1111 exp 12/29' }), req()))).toBe('422:sensitive_data_blocked');
  });
  it('re-scan redacts leftover customer PII before publication', () => {
    const pl = plan(post({ redactedBody: 'call back at 609-555-0142 to confirm' }), req());
    expect(pl.next.redactedBody).not.toContain('609-555-0142');
    expect(pl.next.privacyScanFlags).toContain('phone');
  });
  it('keeps the first publication time on a re-publish', () => {
    expect(plan(post({ publishedAt: '2026-09-01T00:00:00.000Z' }), req()).next.publishedAt).toBe('2026-09-01T00:00:00.000Z');
  });
});

describe('planPostAction — returns', () => {
  it('reject → rejected (draft), the salon is told', () => {
    const pl = plan(post({ status: 'evidence_requested' }), req({ action: 'reject', messageToTenant: 'Not enough detail.' }));
    expect(pl.next.status).toBe('rejected'); expect(pl.next.visibility).toBe('draft');
    expect(pl.domainEvent).toBe('COMMUNITY_ADVISORY_RETURNED'); expect(pl.notifyTenant).toBe(true); expect(pl.caseOutcome).toBe('resolved');
  });
  it('request_changes → returned_for_correction; request_evidence → evidence_requested; the case stays open (investigating)', () => {
    expect(plan(post({ status: 'sensitive_data_detected' }), req({ action: 'request_changes', messageToTenant: 'Remove the address.' })).next.status).toBe('returned_for_correction');
    const ev = plan(post(), req({ action: 'request_evidence', messageToTenant: 'Upload the call log.' }));
    expect(ev.next.status).toBe('evidence_requested'); expect(ev.caseOutcome).toBe('investigating');
    expect(code(() => plan(post({ status: 'published_unverified' }), req({ action: 'request_evidence', messageToTenant: 'Upload the call log.' })))).toBe('409:illegal_transition');
  });
});

describe('planPostAction — remove / restore (bug 12)', () => {
  it('removes from every visible state', () => {
    for (const status of ['published_unverified', 'published_evidence_reviewed', 'published_multiple_reports', 'published_official_report', 'disputed', 'corrected', 'resolved']) {
      const pl = plan(post({ status: status as any, visibility: 'community_published' }), req({ action: 'remove' }));
      expect(pl.next.status).toBe('removed'); expect(pl.next.visibility).toBe('removed');
      expect(pl.next.removedReason).toBe('reviewed and fine');
      expect(pl.fanout).toEqual({ kind: 'changed', change: 'removed' });
    }
  });
  it('cannot remove what is not visible', () => {
    expect(code(() => plan(post({ status: 'moderation_review' }), req({ action: 'remove' })))).toBe('409:illegal_transition');
  });
  it('restore lands on the label-matched published state and re-freezes the author label', () => {
    const pl = plan(post({ status: 'removed', visibility: 'removed', verificationLabel: 'multiple_reports', removedReason: 'x', authorLabel: 'old' }), req({ action: 'restore' }));
    expect(pl.next.status).toBe('published_multiple_reports'); expect(pl.next.visibility).toBe('community_published');
    expect(pl.next.removedReason).toBeNull(); expect(pl.next.authorLabel).toBe('Bella Nails'); expect(pl.fanout).toEqual({ kind: 'published' });
  });
});

describe('planPostAction — edits', () => {
  it('redact replaces the text, re-scans and keeps the status', () => {
    const pl = plan(post({ status: 'sensitive_data_detected', redactedBody: 'Her name is Jane at 12 Elm Street, call 856-555-0100' }),
      req({ action: 'redact', redactions: [{ field: 'body', find: 'Jane', replaceWith: '[name]' }] }));
    expect(pl.next.redactedBody).toContain('[name]');
    expect(pl.next.redactedBody).not.toContain('856-555-0100');
    expect(pl.next.status).toBe('sensitive_data_detected');
    expect(pl.redacted).toEqual([{ field: 'body' }]);
    expect(code(() => plan(post(), req({ action: 'redact', redactions: [{ field: 'title', find: 'nowhere', replaceWith: 'x' }] })))).toBe('400:invalid_input');
  });
  it('set_label on a published post moves to the matching state; elsewhere it only changes the label', () => {
    const pub = plan(post({ status: 'published_unverified', visibility: 'community_published' }), req({ action: 'set_label', label: 'official_report' }));
    expect(pub.next.status).toBe('published_official_report'); expect(pub.fanout).toEqual({ kind: 'changed', change: 'label' });
    const rev = plan(post(), req({ action: 'set_label', label: 'evidence_reviewed' }));
    expect(rev.next.status).toBe('moderation_review'); expect(rev.next.verificationLabel).toBe('evidence_reviewed'); expect(rev.fanout).toBeNull();
    expect(code(() => plan(post(), req({ action: 'set_label', label: 'unverified' })))).toBe('409:no_change');
  });
  it('set_severity, lock / unlock comments', () => {
    expect(plan(post(), req({ action: 'set_severity', severity: 'critical' })).next.severity).toBe('critical');
    expect(plan(post(), req({ action: 'lock_comments' })).next.commentsLocked).toBe(true);
    expect(code(() => plan(post(), req({ action: 'unlock_comments' })))).toBe('409:no_change');
  });
  it('mark_resolved shows only the message, never the internal reason', () => {
    const pl = plan(post({ status: 'published_unverified', visibility: 'community_published' }), req({ action: 'mark_resolved', messageToTenant: 'The supplier confirmed the scam ended.' }));
    expect(pl.next.status).toBe('resolved'); expect(pl.next.resolutionNote).toBe('The supplier confirmed the scam ended.'); expect(pl.next.resolvedAt).toBe(NOW);
  });
});

describe('planPostAction — merge / link', () => {
  const target = post({ id: '00000000-0000-4000-8000-000000000002', status: 'published_unverified', visibility: 'community_published' });
  it('merging a visible duplicate removes it and links merged_into', () => {
    const pl = plan(post({ status: 'published_unverified', visibility: 'community_published' }), req({ action: 'merge_into', targetPostId: target.id }), target);
    expect(pl.next.status).toBe('removed'); expect(pl.next.mergedIntoPostId).toBe(target.id);
    expect(pl.relate).toEqual({ targetPostId: target.id, relation: 'merged_into' }); expect(pl.fanout).toEqual({ kind: 'changed', change: 'merged' });
  });
  it('merging a duplicate still in review rejects it; a hidden target or self is refused', () => {
    expect(plan(post(), req({ action: 'merge_into', targetPostId: target.id }), target).next.status).toBe('rejected');
    expect(code(() => plan(post(), req({ action: 'merge_into', targetPostId: target.id }), { ...target, status: 'removed' } as PostRow))).toBe('409:merge_target_not_visible');
    expect(code(() => plan(post(), req({ action: 'link_related', targetPostId: post().id }), post()))).toBe('400:invalid_input');
  });
});

describe('helpers', () => {
  it('visibility follows the status', () => {
    expect(visibilityFor('published_official_report')).toBe('community_published');
    expect(visibilityFor('disputed')).toBe('community_published');
    expect(visibilityFor('removed')).toBe('removed');
    expect(visibilityFor('rejected')).toBe('draft');
  });
  it('paging: page ≥ 1, pageSize ≤ 50', () => {
    expect(paging({})).toEqual({ page: 1, pageSize: 20, limit: 20, offset: 0 });
    expect(paging({ page: '3', pageSize: '10' }).offset).toBe(20);
    expect(code(() => paging({ pageSize: 51 }))).toBe('400:invalid_input');
    expect(code(() => paging({ page: 0 }))).toBe('400:invalid_input');
  });
  it('reasonOf trims and enforces length', () => {
    expect(code(() => reasonOf('       a       '))).toBe('400:invalid_input');
    expect(reasonOf('enough here')).toBe('enough here');
  });
  it('the restrictions port reads salon-wide + the user’s own kinds', async () => {
    const r = new CommunityRestrictions({ activeKinds: async () => ['posting_restricted'] });
    expect(await r.active('t', 'u')).toEqual({ suspended: false, postingRestricted: true, commentingRestricted: false });
  });
  it('bug 2: no moderator uuid → 403 before anything is read', async () => {
    const svc = new CommunityModerationService({} as any, { emit: async () => undefined });
    await expect(svc.overview({ userId: undefined as any })).rejects.toMatchObject({ code: 'moderator_identity_required', status: 403 });
    await expect(svc.postAction({ userId: 'case-x' }, 'p', {})).rejects.toMatchObject({ code: 'moderator_identity_required' });
  });
});
