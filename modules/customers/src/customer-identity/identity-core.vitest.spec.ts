// identity-core.vitest.spec.ts — Kevin's sync spec, pinned example by example (Jul 26, 2026).
import { describe, it, expect } from 'vitest';
import {
  normalizePhoneE164, canonicalEmail, canonicalName, maskEmail,
  matchConfidence, decideOnCreate, mayOverwriteIdentity, isStaleWrite,
  shouldFireDailySync, isSyncMissed, hourInTimeZone, isGlobalField,
  type IdentitySnapshot, type GlobalCandidate,
} from './identity-core';

const id = (over: Partial<IdentitySnapshot> = {}): IdentitySnapshot => ({ phone: null, phoneVerified: false, email: null, emailVerified: false, name: null, ...over });
const cand = (gid: string, over: Partial<IdentitySnapshot> = {}): GlobalCandidate => ({ globalCustomerId: gid, ...id(over) });

describe('§5 normalization — the spec examples verbatim', () => {
  it('(856) 555-1234, 856-555-1234, +1 856 555 1234 all normalize to +18565551234', () => {
    expect(normalizePhoneE164('(856) 555-1234')).toBe('+18565551234');
    expect(normalizePhoneE164('856-555-1234')).toBe('+18565551234');
    expect(normalizePhoneE164('+1 856 555 1234')).toBe('+18565551234');
    expect(normalizePhoneE164('(856)555-1234')).toBe(normalizePhoneE164('+18565551234'));
  });
  it('invalid phones are null, never a fabricated identity key', () => {
    expect(normalizePhoneE164('')).toBeNull();
    expect(normalizePhoneE164('call me')).toBeNull();
    expect(normalizePhoneE164('123')).toBeNull();
  });
  it('Kevin@Example.com and kevin@example.com are the same email identity; junk is null', () => {
    expect(canonicalEmail('Kevin@Example.com')).toBe('kevin@example.com');
    expect(canonicalEmail('  kevin@example.com  ')).toBe('kevin@example.com');
    expect(canonicalEmail('not-an-email')).toBeNull();
  });
  it('name normalization collapses spacing/case for comparison only', () => {
    expect(canonicalName('  Kevin   Tran ')).toBe('kevin tran');
  });
  it('masking never echoes the full value', () => {
    expect(maskEmail('kevin@example.com')).toBe('k•••@example.com');
  });
});

describe('§6 confidence ladder', () => {
  const base = { phone: '+18565551234', email: 'kevin@example.com', name: 'kevin tran' };
  it('verified phone + verified email = very_strong; one verified = strong; unverified pair = strong; single = medium; name-only = weak', () => {
    expect(matchConfidence(id({ ...base, phoneVerified: true, emailVerified: true }), id({ ...base, phoneVerified: true, emailVerified: true }))).toBe('very_strong');
    expect(matchConfidence(id({ ...base, phoneVerified: true }), id({ ...base, phoneVerified: true }))).toBe('strong');
    expect(matchConfidence(id(base), id(base))).toBe('strong');
    expect(matchConfidence(id({ phone: base.phone }), id({ phone: base.phone, email: 'other@x.com' }))).toBe('medium');
    expect(matchConfidence(id({ name: 'Kevin Tran' }), id({ name: 'kevin  tran' }))).toBe('weak');
    expect(matchConfidence(id({ phone: '+15550000001' }), id({ phone: '+15550000002' }))).toBe('none');
  });
});

describe('§7 creation decision — CASE A / B / C', () => {
  it('CASE B: no candidates → create', () => {
    expect(decideOnCreate(id({ phone: '+18565551234' }), [])).toEqual({ kind: 'create' });
  });
  it('CASE A: one strong (verified phone) candidate → link, no duplicate global', () => {
    const d = decideOnCreate(id({ phone: '+18565551234', phoneVerified: true }), [cand('G1', { phone: '+18565551234', phoneVerified: true })]);
    expect(d).toMatchObject({ kind: 'link', globalCustomerId: 'G1' });
  });
  it('name-only similarity NEVER links and never blocks creation (§6/§39 ambiguous-match rule)', () => {
    const d = decideOnCreate(id({ name: 'Kevin Tran' }), [cand('G1', { name: 'kevin tran' })]);
    expect(d).toEqual({ kind: 'create' });
  });
  it('single medium (phone matches, candidate has no verified conflicting email) → link at medium', () => {
    const d = decideOnCreate(id({ phone: '+18565551234', email: 'new@x.com' }), [cand('G1', { phone: '+18565551234', email: 'old@x.com', emailVerified: false })]);
    expect(d).toMatchObject({ kind: 'link', globalCustomerId: 'G1', confidence: 'medium' });
  });
  it('phone matches but the candidate has a DIFFERENT VERIFIED email → review, never silent link', () => {
    const d = decideOnCreate(id({ phone: '+18565551234', email: 'new@x.com' }), [cand('G1', { phone: '+18565551234', email: 'old@x.com', emailVerified: true })]);
    expect(d).toMatchObject({ kind: 'review', reason: 'IDENTIFIER_CONFLICTS_WITH_VERIFIED' });
  });
  it('§39 CONFLICT: phone matches customer X while email matches customer Y → review both, no destructive choice', () => {
    const d = decideOnCreate(
      id({ phone: '+18565551234', email: 'kevin@example.com' }),
      [cand('GX', { phone: '+18565551234' }), cand('GY', { email: 'kevin@example.com' })],
    );
    expect(d).toMatchObject({ kind: 'review', reason: 'PHONE_AND_EMAIL_MATCH_DIFFERENT_CUSTOMERS' });
    expect((d as any).candidateIds.sort()).toEqual(['GX', 'GY']);
  });
  it('two strong candidates (a pre-existing duplicate) → review, never pick one', () => {
    const d = decideOnCreate(id({ phone: '+18565551234', phoneVerified: true }), [
      cand('G1', { phone: '+18565551234', phoneVerified: true }),
      cand('G2', { phone: '+18565551234', phoneVerified: true }),
    ]);
    expect(d).toMatchObject({ kind: 'review', reason: 'MULTIPLE_STRONG_MATCHES' });
  });
});

describe('§12 verified precedence + §30 stale guard + §11 ownership', () => {
  it('verified value never yields to an unverified conflicting value', () => {
    expect(mayOverwriteIdentity({ value: '+18565551111', verified: true }, { value: '+18565559999', verified: false })).toBe(false);
    expect(mayOverwriteIdentity({ value: '+18565551111', verified: true }, { value: '+18565559999', verified: true })).toBe(true);
    expect(mayOverwriteIdentity({ value: '+18565551111', verified: false }, { value: '+18565559999', verified: false })).toBe(true);
    expect(mayOverwriteIdentity({ value: '+18565551111', verified: true }, { value: '+18565551111', verified: false })).toBe(false); // no-op
  });
  it('a 7:00 PM snapshot cannot overwrite a 7:01 PM customer edit', () => {
    expect(isStaleWrite('2026-07-26T19:00:00Z', '2026-07-26T19:01:00Z')).toBe(true);
    expect(isStaleWrite('2026-07-26T19:00:00Z', '2026-07-26T18:59:00Z')).toBe(false);
  });
  it('ownership: identity fields are global; notes/opt-ins/preferences are tenant-only', () => {
    expect(isGlobalField('normalized_phone')).toBe(true);
    expect(isGlobalField('first_name')).toBe(true);
    expect(isGlobalField('notes')).toBe(false);
    expect(isGlobalField('marketing_sms_opt_in')).toBe(false);
    expect(isGlobalField('preferred_technician_id')).toBe(false);
  });
});

describe('§3 schedule (19:00 America/New_York) + §38 watchdog', () => {
  // 2026-07-26 is EDT (UTC-4): 23:10Z = 19:10 New York.
  const sevenPmNY = new Date('2026-07-26T23:10:00Z');
  const noonNY = new Date('2026-07-26T16:00:00Z');
  it('hour extraction respects the timezone (23:10Z = 19 in New York)', () => {
    expect(hourInTimeZone(sevenPmNY, 'America/New_York')).toBe(19);
    expect(hourInTimeZone(noonNY, 'America/New_York')).toBe(12);
  });
  it('fires in the 7 PM NY window once ~a day; quiet at noon; quiet if tonight already ran', () => {
    expect(shouldFireDailySync(sevenPmNY, null)).toBe(true);
    expect(shouldFireDailySync(noonNY, null)).toBe(false);
    expect(shouldFireDailySync(sevenPmNY, new Date(sevenPmNY.getTime() - 23 * 3_600_000).toISOString())).toBe(true);
    expect(shouldFireDailySync(sevenPmNY, new Date(sevenPmNY.getTime() - 1 * 3_600_000).toISOString())).toBe(false);
  });
  it('watchdog: >26h without a completed run = MISSED; bootstrap (never ran) is not a miss', () => {
    expect(isSyncMissed(sevenPmNY, new Date(sevenPmNY.getTime() - 30 * 3_600_000).toISOString())).toBe(true);
    expect(isSyncMissed(sevenPmNY, new Date(sevenPmNY.getTime() - 10 * 3_600_000).toISOString())).toBe(false);
    expect(isSyncMissed(sevenPmNY, null)).toBe(false);
  });
});
