// community-risk-matching.vitest.spec.ts — proves the strict controls the spec attaches to this feature. The
// most important test is the first one: it is OFF, and cannot be switched on by a flag alone.
import { describe, it, expect } from 'vitest';
import {
  DISABLED_BY_DEFAULT, isActivated, assertActivated, RiskMatchingDisabled,
  fingerprint, evaluateRelatedReports, type FingerprintHit,
} from './community-risk-matching';

const SALT = 'a-sufficiently-long-platform-salt';

describe('activation gate (disabled by default)', () => {
  it('is DISABLED out of the box', () => {
    expect(isActivated(DISABLED_BY_DEFAULT)).toBe(false);
    expect(() => assertActivated(DISABLED_BY_DEFAULT)).toThrow(RiskMatchingDisabled);
  });
  it('a deploy flag ALONE cannot switch it on — the legal/privacy policy approval is required', () => {
    const flagOnly = { featureEnabled: true, legalPrivacyPolicyApproved: false, approvedPolicyRef: null };
    expect(isActivated(flagOnly)).toBe(false);
    try { assertActivated(flagOnly); expect.unreachable(); }
    catch (e: any) { expect(e.reason).toBe('policy_not_approved'); }
  });
  it('activates only with the flag AND an approved, referenced policy', () => {
    expect(isActivated({ featureEnabled: true, legalPrivacyPolicyApproved: true, approvedPolicyRef: 'privacy-v3' })).toBe(true);
    // approval without the flag is still off
    expect(isActivated({ featureEnabled: false, legalPrivacyPolicyApproved: true, approvedPolicyRef: 'privacy-v3' })).toBe(false);
  });
});

describe('fingerprints are one-way and un-probeable', () => {
  it('never returns or contains the raw value', () => {
    const fp = fingerprint('phone', '(201) 555-0148', SALT);
    expect(fp).not.toContain('201');
    expect(fp).not.toContain('5550148');
    expect(fp).toMatch(/^[a-f0-9]{64}$/);       // opaque hash
  });
  it('normalizes so the same person matches across formats', () => {
    expect(fingerprint('phone', '201-555-0148', SALT)).toBe(fingerprint('phone', '+1 (201) 555.0148', SALT));
    expect(fingerprint('email', ' Jane@X.com ', SALT)).toBe(fingerprint('email', 'jane@x.com', SALT));
  });
  it('a DIFFERENT salt yields a different hash — a tenant cannot compute hashes to probe for a person', () => {
    expect(fingerprint('phone', '201-555-0148', SALT)).not.toBe(fingerprint('phone', '201-555-0148', 'another-platform-salt-value'));
  });
  it('refuses to hash without a strong salt (never a bare, reversible digest)', () => {
    expect(() => fingerprint('phone', '2015550148', '')).toThrow(/SALT/);
    expect(() => fingerprint('phone', '2015550148', 'short')).toThrow(/SALT/);
  });
});

describe('related-reports evaluation', () => {
  const hit = (postId: string, kind: any, reliability: any = 'reliable'): FingerprintHit => ({ postId, indicatorKind: kind, reliability });

  it('a SINGLE match never surfaces — one coincidence is not a signal', () => {
    const r = evaluateRelatedReports([hit('p1', 'phone')]);
    expect(r.surfaced).toBe(false);
    expect(r.matchingReports).toBe(0);
    expect(r.label).toBe('insufficient_indicators');
  });
  it('weak indicators alone never surface', () => {
    const r = evaluateRelatedReports([hit('p1', 'phone', 'weak'), hit('p2', 'device', 'weak')]);
    expect(r.surfaced).toBe(false);
  });
  it('two reliable indicators across two reports surface a CAUTIOUS label', () => {
    const r = evaluateRelatedReports([hit('p1', 'phone'), hit('p2', 'device')]);
    expect(r.surfaced).toBe(true);
    expect(r.label).toBe('possible related reports');    // never "known scammer"
    expect(r.matchingReports).toBe(2);
  });
  it('NEVER exposes the reporting salons, and NEVER permits denying service', () => {
    const r = evaluateRelatedReports([hit('p1', 'phone'), hit('p2', 'device')]);
    expect(r.reportingTenants).toEqual([]);
    expect(r.mayDenyService).toBe(false);
    expect(r.staffReviewRequired).toBe(true);
    expect(r.guidance).toContain('not a reason to refuse service');
    expect(JSON.stringify(r)).not.toMatch(/scammer|criminal|fraudster|guilty/i);
  });
  it('the result carries no identity — only a count', () => {
    const r = evaluateRelatedReports([hit('p1', 'phone'), hit('p2', 'email')]);
    expect(Object.keys(r)).not.toContain('phone');
    expect(Object.keys(r)).not.toContain('identity');
    expect(typeof r.matchingReports).toBe('number');
  });
});
