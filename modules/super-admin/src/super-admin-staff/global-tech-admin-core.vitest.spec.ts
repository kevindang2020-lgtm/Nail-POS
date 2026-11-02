// global-tech-admin-core.vitest.spec.ts — the two irreversible acts, and the rules that refuse them.
import { describe, it, expect } from 'vitest';
import {
  anonymizedDisplayName, decideAnonymize, decideMerge,
  type DeleteRequestState, type MergeCandidate,
} from './global-tech-admin-core';

const SALON_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SALON_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const cand = (over: Partial<MergeCandidate> = {}): MergeCandidate => ({
  profileId: 'p1', techCode: 'TECH-000001', displayName: 'Olivia Brown', status: 'active', tenantIds: [SALON_A], ...over,
});

describe('decideMerge', () => {
  it('merges two accounts for one human at two different salons — the ordinary case', () => {
    const d = decideMerge(cand(), cand({ profileId: 'p2', techCode: 'TECH-000002', tenantIds: [SALON_B] }));
    expect(d).toMatchObject({ ok: true, canonicalId: 'p1', duplicateId: 'p2' });
  });

  it('REFUSES when both profiles are on the roster at the SAME salon', () => {
    // That salon has two technicians rows for one person — two schedules, two commission settings, and possibly
    // two payroll histories. Merging would silently pick a winner between them, and the platform is the one party
    // that cannot know which roster row is real. It refuses and names the salon.
    const d = decideMerge(cand({ tenantIds: [SALON_A, SALON_B] }), cand({ profileId: 'p2', techCode: 'TECH-000002', tenantIds: [SALON_B] }));
    expect(d.ok).toBe(false);
    expect(d).toMatchObject({ code: 'shared_salon', sharedTenantIds: [SALON_B] });
    expect((d as any).message).toContain('payroll');
  });

  it('refuses to merge a profile into itself', () => {
    expect(decideMerge(cand(), cand())).toMatchObject({ ok: false, code: 'same_profile' });
  });

  it('a tombstone is not a person — an anonymized or already-merged profile cannot take part', () => {
    expect(decideMerge(cand({ status: 'anonymized' }), cand({ profileId: 'p2', tenantIds: [SALON_B] })))
      .toMatchObject({ ok: false, code: 'not_mergeable' });
    expect(decideMerge(cand(), cand({ profileId: 'p2', status: 'merged', tenantIds: [SALON_B] })))
      .toMatchObject({ ok: false, code: 'not_mergeable' });
  });

  it('a SUSPENDED account can still be merged — suspension is not deletion', () => {
    expect(decideMerge(cand({ status: 'suspended' }), cand({ profileId: 'p2', tenantIds: [SALON_B] })).ok).toBe(true);
  });

  it('a missing profile is not_found, not a crash', () => {
    expect(decideMerge(null, cand())).toMatchObject({ ok: false, code: 'not_found' });
    expect(decideMerge(cand(), null)).toMatchObject({ ok: false, code: 'not_found' });
  });
});

describe('decideAnonymize', () => {
  const req = (over: Partial<DeleteRequestState> = {}): DeleteRequestState => ({
    requestId: 'r1', profileId: 'p1', status: 'approved', reason: 'Technician requested erasure', legalHold: false, ...over,
  });

  it('erases only with a request, an approval, a reason, and no legal hold', () => {
    expect(decideAnonymize('active', req())).toEqual({ ok: true, requestId: 'r1', profileId: 'p1' });
  });

  it('THERE IS NO PATH FROM "Super Admin opens a screen" TO "a person is erased"', () => {
    expect(decideAnonymize('active', null)).toMatchObject({ ok: false, code: 'no_request' });
  });

  it('a request is not an approval — the decision is a second act, by a named human', () => {
    expect(decideAnonymize('active', req({ status: 'pending' }))).toMatchObject({ ok: false, code: 'not_approved' });
    expect(decideAnonymize('active', req({ status: 'rejected' }))).toMatchObject({ ok: false, code: 'not_approved' });
  });

  it('a LEGAL HOLD blocks it. Not warns — blocks.', () => {
    expect(decideAnonymize('active', req({ legalHold: true }))).toMatchObject({ ok: false, code: 'legal_hold' });
    // and it blocks even an APPROVED request — the hold outranks the approval
    expect(decideAnonymize('active', req({ status: 'approved', legalHold: true }))).toMatchObject({ ok: false, code: 'legal_hold' });
  });

  it('an irreversible act with no stated reason is one nobody can answer for later', () => {
    expect(decideAnonymize('active', req({ reason: '   ' }))).toMatchObject({ ok: false, code: 'no_reason' });
  });

  it('already anonymized is reported, not retried — nobody should be nudged into repeating this', () => {
    expect(decideAnonymize('anonymized', req())).toMatchObject({ ok: false, code: 'already_anonymized' });
  });
});

describe('the tombstone', () => {
  it('keeps the tech_code, so the id can never be handed to anybody else', () => {
    const name = anonymizedDisplayName('TECH-000123');
    expect(name).toContain('TECH-000123');
    // Every ticket, payroll line and audit entry at every salon she worked at still points here. A support agent
    // reading them six months from now must see that this WAS somebody, erased on purpose — not a lost row.
    expect(name.toLowerCase()).toContain('anonymized');
  });
});
