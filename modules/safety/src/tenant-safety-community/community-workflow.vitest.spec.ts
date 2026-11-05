// community-workflow.vitest.spec — BUILD_PLAN Phase 8 (agent A): the full lifecycle table B and the core share. The
// author's submit from every correctable state, withdraw, every moderator decision (label-matched publish — bug 4 made
// every publish `evidence_reviewed`), remove from every visible state (bug 12), restore, relabel, dispute outcomes,
// resolve, and the approver's edit of a live post.
import { describe, it, expect } from 'vitest';
import { transition, publishedStateFor, isPublishedState, type WorkflowContext } from './community-workflow';
import { scanCommunityText } from './community-privacy-scan';

const base: WorkflowContext = { role: 'owner', receptionistApprovalRequired: true, managerApprovalRequired: true, category: 'gift_card_scam', severity: 'moderate' };
const clean = scanCommunityText('suspected gift card scam pattern');
const pii = scanCommunityText('the caller used 201-555-0148');
const card = scanCommunityText('they used card 4111 1111 1111 1111');
const mod = { ...base, role: 'moderator' as const };

describe('publishedStateFor / isPublishedState', () => {
  it('maps every label; unknown never upgrades', () => {
    expect(publishedStateFor('unverified')).toBe('published_unverified');
    expect(publishedStateFor('evidence_reviewed')).toBe('published_evidence_reviewed');
    expect(publishedStateFor('multiple_reports')).toBe('published_multiple_reports');
    expect(publishedStateFor('official_report')).toBe('published_official_report');
    expect(publishedStateFor('bogus')).toBe('published_unverified');
    expect(publishedStateFor(null)).toBe('published_unverified');
  });
  it('isPublishedState is the four published_* states only', () => {
    expect(isPublishedState('published_official_report')).toBe(true);
    expect(isPublishedState('disputed')).toBe(false);
    expect(isPublishedState('resolved')).toBe(false);
    expect(isPublishedState('manager_approval')).toBe(false);
  });
});

describe('submit (author) from every correctable state', () => {
  for (const from of ['incident_draft', 'returned_for_correction', 'evidence_requested', 'sensitive_data_detected'] as const) {
    it(`${from}: blocked → sensitive_data_detected; approval → manager_approval`, () => {
      expect(transition(from, 'submit', { ...base, scan: card })).toEqual({ ok: true, state: 'sensitive_data_detected' });
      expect(transition(from, 'submit', { ...base, scan: clean })).toEqual({ ok: true, state: 'manager_approval' });
    });
  }
  it('redacted customer PII does not block (the redaction is shown to the approver)', () => {
    expect(transition('incident_draft', 'submit', { ...base, scan: pii })).toEqual({ ok: true, state: 'manager_approval' });
  });
  it('managerApprovalRequired=false: an approver publishes straight away (unverified), serious → moderation', () => {
    const noApproval = { ...base, managerApprovalRequired: false, scan: clean };
    expect(transition('incident_draft', 'submit', noApproval)).toEqual({ ok: true, state: 'published_unverified' });
    expect(transition('incident_draft', 'submit', { ...noApproval, severity: 'critical' })).toEqual({ ok: true, state: 'moderation_review' });
    expect(transition('incident_draft', 'submit', { ...noApproval, category: 'account_takeover_attempt' })).toEqual({ ok: true, state: 'moderation_review' });
    expect(transition('incident_draft', 'submit', { ...noApproval, moderationRequired: true })).toEqual({ ok: true, state: 'moderation_review' });
  });
  it('a receptionist needs approval unless the salon turned it off; a technician / moderator cannot submit', () => {
    expect(transition('incident_draft', 'submit', { ...base, role: 'receptionist', managerApprovalRequired: false, scan: clean })).toEqual({ ok: true, state: 'manager_approval' });
    // receptionistApprovalRequired alone decides a receptionist's post (managerApprovalRequired is the approvers' own posts)
    expect(transition('incident_draft', 'submit', { ...base, role: 'receptionist', receptionistApprovalRequired: false, scan: clean })).toEqual({ ok: true, state: 'published_unverified' });
    expect(transition('incident_draft', 'submit', { ...base, role: 'receptionist', receptionistApprovalRequired: false, category: 'threat_or_violence', scan: clean })).toEqual({ ok: true, state: 'moderation_review' });
    expect(transition('incident_draft', 'submit', { ...base, role: 'technician', scan: clean }).ok).toBe(false);
    expect(transition('incident_draft', 'submit', { ...mod, scan: clean }).ok).toBe(false);
  });
  it('submit needs a scan, and is illegal from manager_approval / published', () => {
    expect(transition('incident_draft', 'submit', base)).toEqual({ ok: false, error: 'scan_required' });
    expect(transition('manager_approval', 'submit', { ...base, scan: clean }).ok).toBe(false);
    expect(transition('published_unverified', 'submit', { ...base, scan: clean }).ok).toBe(false);
  });
});

describe('withdraw / approve / return', () => {
  it('withdraw back to a draft from the three pending states only', () => {
    for (const s of ['manager_approval', 'sensitive_data_detected', 'returned_for_correction'] as const) expect(transition(s, 'withdraw', base)).toEqual({ ok: true, state: 'incident_draft' });
    expect(transition('moderation_review', 'withdraw', base).ok).toBe(false);
    expect(transition('published_unverified', 'withdraw', base).ok).toBe(false);
    expect(transition('manager_approval', 'withdraw', { ...base, role: 'technician' }).ok).toBe(false);
  });
  it('manager approval honours a sticky moderationRequired; return needs an approver', () => {
    expect(transition('manager_approval', 'manager_approve', { ...base, moderationRequired: true })).toEqual({ ok: true, state: 'moderation_review' });
    expect(transition('manager_approval', 'manager_return', { ...base, role: 'receptionist' }).ok).toBe(false);
    expect(transition('manager_approval', 'manager_return', base)).toEqual({ ok: true, state: 'returned_for_correction' });
  });
});

describe('moderator decisions (agent B uses these with the REAL status)', () => {
  it('publish lands on the label, from review or sensitive — never evidence_reviewed by default (bug 4)', () => {
    expect(transition('moderation_review', 'moderator_publish', mod)).toEqual({ ok: true, state: 'published_unverified' });
    expect(transition('sensitive_data_detected', 'moderator_publish', { ...mod, verificationLabel: 'evidence_reviewed' })).toEqual({ ok: true, state: 'published_evidence_reviewed' });
    expect(transition('incident_draft', 'moderator_publish', mod).ok).toBe(false);
    expect(transition('rejected', 'moderator_publish', mod).ok).toBe(false);
    expect(transition('moderation_review', 'moderator_publish', base)).toEqual({ ok: false, error: 'moderator_required' });
  });
  it('reject / request changes / request evidence', () => {
    for (const s of ['moderation_review', 'sensitive_data_detected', 'evidence_requested'] as const) expect(transition(s, 'moderator_reject', mod)).toEqual({ ok: true, state: 'rejected' });
    for (const s of ['moderation_review', 'sensitive_data_detected'] as const) expect(transition(s, 'moderator_request_changes', mod)).toEqual({ ok: true, state: 'returned_for_correction' });
    expect(transition('moderation_review', 'moderator_request_evidence', mod)).toEqual({ ok: true, state: 'evidence_requested' });
    expect(transition('sensitive_data_detected', 'moderator_request_evidence', mod).ok).toBe(false);
    expect(transition('moderation_review', 'moderator_reject', base).ok).toBe(false);
  });
  it('remove from every visible state (bug 12), restore to the label', () => {
    for (const s of ['published_unverified', 'published_evidence_reviewed', 'published_multiple_reports', 'published_official_report', 'disputed', 'corrected', 'resolved'] as const) {
      expect(transition(s, 'remove', mod)).toEqual({ ok: true, state: 'removed' });
      expect(transition(s, 'remove', base).ok).toBe(false);
    }
    expect(transition('incident_draft', 'remove', mod).ok).toBe(false);
    expect(transition('removed', 'restore', { ...mod, verificationLabel: 'official_report' })).toEqual({ ok: true, state: 'published_official_report' });
    expect(transition('removed', 'restore', base).ok).toBe(false);
  });
  it('relabel and dispute outcomes', () => {
    expect(transition('published_unverified', 'relabel', { ...mod, verificationLabel: 'multiple_reports' })).toEqual({ ok: true, state: 'published_multiple_reports' });
    expect(transition('disputed', 'relabel', mod).ok).toBe(false);
    expect(transition('published_unverified', 'relabel', base).ok).toBe(false);
    expect(transition('disputed', 'dispute_upheld', { ...mod, verificationLabel: 'evidence_reviewed' })).toEqual({ ok: true, state: 'published_evidence_reviewed' });
    expect(transition('disputed', 'dispute_upheld', base).ok).toBe(false);
    expect(transition('disputed', 'correct', mod)).toEqual({ ok: true, state: 'corrected' });
    expect(transition('published_official_report', 'dispute', base)).toEqual({ ok: true, state: 'disputed' });
  });
  it('resolve from published / corrected / disputed by an approver or a moderator', () => {
    for (const s of ['published_unverified', 'published_multiple_reports', 'published_official_report', 'corrected', 'disputed'] as const) {
      expect(transition(s, 'resolve', base)).toEqual({ ok: true, state: 'resolved' });
      expect(transition(s, 'resolve', mod)).toEqual({ ok: true, state: 'resolved' });
    }
    expect(transition('published_unverified', 'resolve', { ...base, role: 'receptionist' }).ok).toBe(false);
    expect(transition('manager_approval', 'resolve', base).ok).toBe(false);
  });
});

describe('edit of a live post (approver)', () => {
  it('payment / ID data hides it for moderation; a newly-serious edit goes to review; otherwise unchanged', () => {
    expect(transition('published_unverified', 'edit', { ...base, scan: card })).toEqual({ ok: true, state: 'sensitive_data_detected' });
    expect(transition('published_unverified', 'edit', { ...base, scan: clean, moderationRequired: true })).toEqual({ ok: true, state: 'moderation_review' });
    expect(transition('corrected', 'edit', { ...base, scan: pii })).toEqual({ ok: true, state: 'corrected' });
    expect(transition('published_unverified', 'edit', { ...base, role: 'receptionist', scan: clean }).ok).toBe(false);
    expect(transition('resolved', 'edit', { ...base, scan: clean }).ok).toBe(false);
    expect(transition('published_unverified', 'edit', base)).toEqual({ ok: false, error: 'scan_required' });
  });
});
