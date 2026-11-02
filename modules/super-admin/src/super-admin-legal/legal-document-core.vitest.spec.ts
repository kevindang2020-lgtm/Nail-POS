import { describe, it, expect } from 'vitest';
import { canTransitionLegalStatus, assertLegalTransition, LegalTransitionError, isContentImmutable, isValidVersion, compareVersions, acceptanceBreakdown, isLegalDocType, DOC_TYPE_LABEL } from './legal-document-core';

describe('legal-document lifecycle', () => {
  it('allows the publish path and treats terminal states correctly', () => {
    expect(canTransitionLegalStatus('draft', 'published')).toBe(true);
    expect(canTransitionLegalStatus('approved', 'published')).toBe(true);
    expect(canTransitionLegalStatus('published', 'superseded')).toBe(true);
    expect(canTransitionLegalStatus('published', 'draft')).toBe(false); // published cannot go back to draft
    expect(canTransitionLegalStatus('archived', 'published')).toBe(false);
    expect(() => assertLegalTransition('published', 'draft')).toThrow(LegalTransitionError);
  });
  it('marks published + terminal versions as content-immutable', () => {
    expect(isContentImmutable('draft')).toBe(false);
    expect(isContentImmutable('approved')).toBe(false);
    expect(isContentImmutable('published')).toBe(true);
    expect(isContentImmutable('superseded')).toBe(true);
    expect(isContentImmutable('retired')).toBe(true);
  });
  it('validates + compares versions', () => {
    expect(isValidVersion('v2.3.0')).toBe(true);
    expect(isValidVersion('2.3')).toBe(false);
    expect(compareVersions('v2.3.0', 'v2.2.0')).toBeGreaterThan(0);
    expect(compareVersions('v2.3.0', 'v2.3.0')).toBe(0);
    expect(compareVersions('v2.1.0', 'v2.10.0')).toBeLessThan(0);
  });
  it('computes acceptance breakdown with pending', () => {
    expect(acceptanceBreakdown(193, 18, 248)).toEqual({ accepted: 193, declined: 18, pending: 37, total: 248 });
    expect(acceptanceBreakdown(10, 0, 5)).toEqual({ accepted: 10, declined: 0, pending: 0, total: 10 }); // total floors at decided
  });
  it('knows document types + labels', () => {
    expect(isLegalDocType('terms_of_service')).toBe(true);
    expect(isLegalDocType('nope')).toBe(false);
    expect(DOC_TYPE_LABEL.privacy_policy).toBe('Privacy Policy');
  });
});
