// tenant-safety-community core tests — prove the safety invariants the spec requires: private stays private,
// advisories are visible only when published to verified tenants, receptionists can't publish, customer PII is
// blocked/redacted, payment data is blocked, and nothing can auto-deny service / act as a blacklist.
import { describe, it, expect } from 'vitest';
import { canView, isCommunityVisible, assertExplicitAdvisorySubmission, type Viewer, type SafetyRecord } from './community-classification';
import { scanCommunityText, scanDisposition } from './community-privacy-scan';
import { transition, requiresApprovalBeforePublish, type WorkflowContext } from './community-workflow';
import { effectiveCapabilities, can, checkWording, communityPostMayDenyService, relatedReportsDisposition } from './community-permissions';

const viewer = (o: Partial<Viewer>): Viewer => ({ tenantId: 'T1', role: 'owner', communityEnabled: true, canAccessCommunity: true, ...o });
const priv = (o: Partial<SafetyRecord> = {}): SafetyRecord => ({ classification: 'private_incident', ownerTenantId: 'T1', status: 'incident_draft', ...o });
const adv = (o: Partial<SafetyRecord> = {}): SafetyRecord => ({ classification: 'community_advisory', ownerTenantId: 'T1', status: 'published_unverified', ...o });

describe('visibility classification', () => {
  it('a private incident is NEVER visible to another tenant (no moderation case)', () => {
    expect(canView(viewer({ tenantId: 'T2', role: 'owner' }), priv()).allowed).toBe(false);
    expect(canView(viewer({ tenantId: 'T2', role: 'tenant_admin' }), priv()).allowed).toBe(false);
    expect(canView(viewer({ tenantId: 'T2', role: 'moderator', moderationCaseId: null }), priv()).allowed).toBe(false);
  });
  it('a moderator reaches a private incident ONLY under an explicit audited case', () => {
    expect(canView(viewer({ tenantId: 'T2', role: 'moderator', moderationCaseId: 'CASE-1' }), priv()).allowed).toBe(true);
  });
  it('same-tenant receptionist/technician cannot read private incidents', () => {
    expect(canView(viewer({ role: 'receptionist' }), priv()).allowed).toBe(false);
    expect(canView(viewer({ role: 'technician' }), priv()).allowed).toBe(false);
  });
  it('branch manager sees only their branch incidents', () => {
    expect(canView(viewer({ role: 'branch_manager', branchIds: ['B1'] }), priv({ ownerBranchId: 'B1' })).allowed).toBe(true);
    expect(canView(viewer({ role: 'branch_manager', branchIds: ['B1'] }), priv({ ownerBranchId: 'B2' })).allowed).toBe(false);
  });
  it('an advisory is visible to other tenants ONLY once published', () => {
    expect(canView(viewer({ tenantId: 'T2' }), adv({ status: 'manager_approval' })).allowed).toBe(false);
    expect(canView(viewer({ tenantId: 'T2' }), adv({ status: 'moderation_review' })).allowed).toBe(false);
    expect(canView(viewer({ tenantId: 'T2' }), adv({ status: 'published_unverified' })).allowed).toBe(true);
  });
  it('published advisory hidden from tenants without community access / disabled', () => {
    expect(canView(viewer({ tenantId: 'T2', canAccessCommunity: false }), adv()).allowed).toBe(false);
    expect(canView(viewer({ tenantId: 'T2', communityEnabled: false }), adv()).allowed).toBe(false);
  });
  it('removed/archived advisories are not community-visible', () => {
    expect(isCommunityVisible('removed')).toBe(false);
    expect(isCommunityVisible('archived')).toBe(false);
    expect(isCommunityVisible('published_official_report')).toBe(true);
  });
  it('private incident never auto-promotes to advisory', () => {
    expect(assertExplicitAdvisorySubmission({ fromPrivateIncident: true, sanitizedAdvisoryProvided: false, submittedByAuthorizedUser: true }).ok).toBe(false);
    expect(assertExplicitAdvisorySubmission({ fromPrivateIncident: true, sanitizedAdvisoryProvided: true, submittedByAuthorizedUser: false }).ok).toBe(false);
    expect(assertExplicitAdvisorySubmission({ fromPrivateIncident: true, sanitizedAdvisoryProvided: true, submittedByAuthorizedUser: true }).ok).toBe(true);
  });
});

describe('privacy scanner', () => {
  it('BLOCKS payment card + SSN (cannot publish)', () => {
    const s = scanCommunityText('customer paid with 4111 1111 1111 1111 ssn 123-45-6789');
    expect(s.blocked).toBe(true);
    expect(scanDisposition(s)).toBe('blocked');
    expect(s.redactedText).not.toContain('4111');
    expect(s.redactedText).not.toContain('123-45-6789');
  });
  it('REDACTS + flags customer phone and email (route to review)', () => {
    const s = scanCommunityText('call the client at 201-555-0148 or email jane.doe@example.com');
    expect(s.blocked).toBe(false);
    expect(s.flagged).toBe(true);
    expect(scanDisposition(s)).toBe('needs_review');
    expect(s.redactedText).toContain('[REDACTED_PHONE]');
    expect(s.redactedText).toContain('[REDACTED_EMAIL]');
    expect(s.redactedText).not.toContain('201-555-0148');
    expect(s.redactedText).not.toContain('jane.doe@example.com');
  });
  it('clean scam-pattern text passes', () => {
    const s = scanCommunityText('caller claimed to be from support and asked for a gift card to release a booking');
    expect(scanDisposition(s)).toBe('clean');
  });
});

describe('workflow state machine', () => {
  const base: WorkflowContext = { role: 'branch_manager', receptionistApprovalRequired: true, category: 'scam_alert', severity: 'moderate', managerApprovalRequired: true };
  it('a blocked scan sends the post to sensitive_data_detected, never forward', () => {
    const scan = scanCommunityText('card 4111 1111 1111 1111');
    const r = transition('tenant_review', 'run_privacy_scan', { ...base, scan });
    expect(r).toEqual({ ok: true, state: 'sensitive_data_detected' });
  });
  it('a clean scan advances to manager_approval', () => {
    const scan = scanCommunityText('suspected gift-card scam pattern');
    expect(transition('tenant_review', 'run_privacy_scan', { ...base, scan })).toEqual({ ok: true, state: 'manager_approval' });
  });
  it('receptionist/technician cannot approve', () => {
    expect(transition('manager_approval', 'manager_approve', { ...base, role: 'receptionist' }).ok).toBe(false);
    expect(transition('manager_approval', 'manager_approve', { ...base, role: 'technician' }).ok).toBe(false);
  });
  it('manager approval publishes ordinary categories but routes serious ones to moderation', () => {
    expect(transition('manager_approval', 'manager_approve', base)).toEqual({ ok: true, state: 'published_unverified' });
    expect(transition('manager_approval', 'manager_approve', { ...base, category: 'threat_or_violence' })).toEqual({ ok: true, state: 'moderation_review' });
    expect(transition('manager_approval', 'manager_approve', { ...base, severity: 'critical' })).toEqual({ ok: true, state: 'moderation_review' });
  });
  it('only a moderator can remove a published post', () => {
    expect(transition('published_unverified', 'remove', base).ok).toBe(false);
    expect(transition('published_unverified', 'remove', { ...base, role: 'moderator' })).toEqual({ ok: true, state: 'removed' });
  });
  it('illegal transitions are rejected', () => {
    expect(transition('incident_draft', 'moderator_publish', base).ok).toBe(false);
  });
  it('receptionist posts require approval by default', () => {
    expect(requiresApprovalBeforePublish({ role: 'receptionist', receptionistApprovalRequired: true, managerApprovalRequired: false })).toBe(true);
    expect(requiresApprovalBeforePublish({ role: 'technician', receptionistApprovalRequired: false, managerApprovalRequired: false })).toBe(true);
  });
});

describe('permissions + safety guardrails', () => {
  it('receptionist has no submit/approve; technician has nothing by default', () => {
    expect(can('receptionist', 'submit_advisory')).toBe(false);
    expect(can('receptionist', 'approve_advisory')).toBe(false);
    expect(can('receptionist', 'create_advisory_draft')).toBe(true);
    expect(effectiveCapabilities('technician').size).toBe(0);
  });
  it('tenant settings can never grant forbidden capabilities (safety floor)', () => {
    // try to grant a receptionist approve/moderate — must be ignored
    const caps = effectiveCapabilities('receptionist', ['approve_advisory', 'moderate']);
    expect(caps.has('approve_advisory')).toBe(false);
    expect(caps.has('moderate')).toBe(false);
  });
  it('moderate is never tenant-grantable to any tenant role', () => {
    expect(effectiveCapabilities('owner', ['moderate']).has('moderate')).toBe(false);
  });
  it('accusatory wording is rejected unless an official report + moderation approve it', () => {
    expect(checkWording('this customer is a scammer', { officialReportReferenced: false, moderationApprovedWording: false }).ok).toBe(false);
    expect(checkWording('this customer is a scammer', { officialReportReferenced: true, moderationApprovedWording: true }).ok).toBe(true);
    expect(checkWording('a pattern requiring caution', { officialReportReferenced: false, moderationApprovedWording: false }).ok).toBe(true);
  });
  it('a community post can NEVER auto-deny service (hard invariant)', () => {
    expect(communityPostMayDenyService()).toBe(false);
  });
  it('related-reports needs >=2 reliable indicators and never labels "known scammer"', () => {
    expect(relatedReportsDisposition(1, 1).surface).toBe(false);
    const r = relatedReportsDisposition(3, 2);
    expect(r.surface).toBe(true);
    expect(r.label).toBe('possible related reports');
  });
});
