import { describe, it, expect } from 'vitest';
import {
  classifyPhone, classifyEmail, isPhoneVerified, consentFor, recordCompleteness,
  detectDuplicatesWithinTenant, duplicateRiskByCustomer, detectCrossTenantAlerts, dataIntegrityScore,
  COMPLETENESS_WEIGHTS, type CustomerLike,
} from './customer-data-governance-core';

const mk = (o: Partial<CustomerLike> = {}): CustomerLike => ({
  id: 'c1', tenantId: 't1', branchId: 'b1',
  fullName: 'Emily Johnson', normalizedPhone: '+12025550123',
  email: 'emily@example.com', phoneVerifiedAt: '2026-06-01T00:00:00Z',
  status: 'active', marketingSmsOptIn: true,
  marketingEmailOptIn: true, marketingOptIn: true,
  createdById: 'u1', createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z',
  ...o,
});

describe('phone/email validation', () => {
  it('classifies phones', () => {
    expect(classifyPhone('+12025550123')).toBe('valid');
    expect(classifyPhone('2025550123')).toBe('valid');
    expect(classifyPhone('123')).toBe('invalid');
    expect(classifyPhone('not-a-phone')).toBe('invalid');
    expect(classifyPhone(null)).toBe('missing');
    expect(classifyPhone('   ')).toBe('missing');
  });
  it('tracks verification separately from validity', () => {
    expect(isPhoneVerified('2026-06-01T00:00:00Z')).toBe(true);
    expect(isPhoneVerified(null)).toBe(false);
  });
  it('classifies emails', () => {
    expect(classifyEmail('a@b.com')).toBe('valid');
    expect(classifyEmail('bad@nodot')).toBe('invalid');
    expect(classifyEmail('no-at-sign')).toBe('invalid');
    expect(classifyEmail(null)).toBe('missing');
  });
});

describe('consent (purpose-specific)', () => {
  it('breaks consent down per purpose and never treats one as universal', () => {
    expect(consentFor({ marketingSmsOptIn: true, marketingEmailOptIn: false, marketingOptIn: false })).toEqual({ sms: true, email: false, general: false, status: 'consented' });
    expect(consentFor({ marketingSmsOptIn: false, marketingEmailOptIn: false, marketingOptIn: false }).status).toBe('not_consented');
  });
});

describe('record completeness', () => {
  it('scores a fully-populated record at 100', () => {
    expect(recordCompleteness(mk()).score).toBe(100);
  });
  it('reports missing + invalid fields and deducts their weights', () => {
    const r = recordCompleteness(mk({ fullName: null, email: 'bad', normalizedPhone: null }));
    expect(r.missing).toContain('full_name');
    expect(r.missing).toContain('phone');
    expect(r.invalid).toContain('email');
    expect(r.score).toBe(100 - COMPLETENESS_WEIGHTS.fullName - COMPLETENESS_WEIGHTS.validPhone - COMPLETENESS_WEIGHTS.validEmail);
  });
});

describe('within-tenant duplicate detection', () => {
  it('clusters same-phone records within one tenant as high risk', () => {
    const cs = [mk({ id: 'a', normalizedPhone: '+12025550100' }), mk({ id: 'b', normalizedPhone: '+12025550100', email: 'other@x.com' })];
    const clusters = detectDuplicatesWithinTenant(cs).filter((c) => c.reason === 'phone');
    expect(clusters).toHaveLength(1);
    expect(clusters[0].ids).toEqual(['a', 'b']);
    expect(clusters[0].risk).toBe('high');
  });
  it('NEVER clusters the same phone across different tenants', () => {
    const cs = [mk({ id: 'a', tenantId: 't1', normalizedPhone: '+12025550100' }), mk({ id: 'b', tenantId: 't2', normalizedPhone: '+12025550100' })];
    expect(detectDuplicatesWithinTenant(cs)).toHaveLength(0); // separate tenants → not a duplicate
  });
  it('assigns each customer its highest duplicate risk', () => {
    const cs = [mk({ id: 'a', normalizedPhone: '+12025550100' }), mk({ id: 'b', normalizedPhone: '+12025550100', email: 'z@z.com' })];
    const risk = duplicateRiskByCustomer(cs);
    expect(risk.get('a')).toBe('high');
    expect(risk.get('b')).toBe('high');
  });
});

describe('cross-tenant integrity alerts (protected, minimum-necessary)', () => {
  it('flags the same phone under different tenants as an alert (not a merge) with a masked key only', () => {
    const cs = [mk({ id: 'a', tenantId: 't1', normalizedPhone: '+12025550100', email: null }), mk({ id: 'b', tenantId: 't2', normalizedPhone: '+12025550100', email: null })];
    const alerts = detectCrossTenantAlerts(cs);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].reason).toBe('phone');
    expect(alerts[0].tenantIds).toEqual(['t1', 't2']);
    expect(alerts[0].recordCount).toBe(2);
    expect(alerts[0].maskedKey).toMatch(/\*\*\*/);          // no raw identifier exposed
    expect(JSON.stringify(alerts[0])).not.toContain('Emily'); // no customer PII leaks across tenants
  });
  it('does NOT flag the same phone within one tenant as cross-tenant', () => {
    const cs = [mk({ id: 'a', tenantId: 't1', normalizedPhone: '+12025550100' }), mk({ id: 'b', tenantId: 't1', normalizedPhone: '+12025550100' })];
    expect(detectCrossTenantAlerts(cs)).toHaveLength(0);
  });
});

describe('data integrity score', () => {
  it('is 100 for a clean population', () => {
    expect(dataIntegrityScore({ total: 1000, invalidPhone: 0, invalidEmail: 0, incomplete: 0, duplicateRecords: 0, crossTenantIncidents: 0 })).toBe(100);
  });
  it('deducts weighted penalties by rate and clamps to [0,100]', () => {
    const s = dataIntegrityScore({ total: 100, invalidPhone: 100, invalidEmail: 100, incomplete: 100, duplicateRecords: 100, crossTenantIncidents: 100 });
    expect(s).toBe(0); // every record bad → full penalty, clamped
    const partial = dataIntegrityScore({ total: 1000, invalidPhone: 50, invalidEmail: 0, incomplete: 0, duplicateRecords: 0, crossTenantIncidents: 0 });
    expect(partial).toBeGreaterThan(95); // 5% invalid-phone → small deduction
    expect(partial).toBeLessThan(100);
  });
  it('returns 100 for an empty population (no data to fault)', () => {
    expect(dataIntegrityScore({ total: 0, invalidPhone: 0, invalidEmail: 0, incomplete: 0, duplicateRecords: 0, crossTenantIncidents: 0 })).toBe(100);
  });
});
