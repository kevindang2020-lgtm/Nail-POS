// global-tech-identity-core.vitest.spec.ts — the rules that decide "is this the same human being?"
import { describe, it, expect } from 'vitest';
import {
  decideIdentity, decideTechSwitch, formatTechCode, identityKeys, isEmployed, isSalonTerminal, isTechCode,
  managerLookupView, needsSalonAction, needsTechAction, normalizeTechEmail, splitName,
  type ExistingProfile, type GlobalProfileRow, type SwitchableWorkplace,
} from './global-tech-identity-core';

const SALON_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SALON_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('the permanent technician ID', () => {
  it('is zero-padded and stable', () => {
    expect(formatTechCode(1)).toBe('TECH-000001');
    expect(formatTechCode(123)).toBe('TECH-000123');
    expect(formatTechCode(999999)).toBe('TECH-999999');
    expect(isTechCode(formatTechCode(7))).toBe(true);
  });
  it('refuses a sequence value that is not a real allocation', () => {
    expect(() => formatTechCode(0)).toThrow();
    expect(() => formatTechCode(-1)).toThrow();
    expect(() => formatTechCode(1.5)).toThrow();
  });
});

describe('identity keys — the SAME human, typed by two different salons', () => {
  it('one technician, two salons, three formats → ONE hash', () => {
    // This is the entire dedupe. If these three ever diverge, the platform mints a second global account for a
    // technician who already has one, and her followers and rating are split across two people who are one.
    const a = identityKeys({ phone: '(856) 555-1234' });
    const b = identityKeys({ phone: '856-555-1234' });
    const c = identityKeys({ phone: '+1 856 555 1234' });
    expect(a.normalizedPhone).toBe('+18565551234');
    expect(a.phoneHash).toBe(b.phoneHash);
    expect(b.phoneHash).toBe(c.phoneHash);
    expect(a.phoneHash).toBeTruthy();
  });

  it('different people do not collide', () => {
    expect(identityKeys({ phone: '8565551234' }).phoneHash).not.toBe(identityKeys({ phone: '8565559999' }).phoneHash);
  });

  it('email is case-folded, and a non-email is not an identity key', () => {
    expect(identityKeys({ email: 'Olivia@Example.COM' }).emailNormalized).toBe('olivia@example.com');
    expect(normalizeTechEmail('not-an-email')).toBeNull();
    expect(normalizeTechEmail('  ')).toBeNull();
    expect(identityKeys({ email: 'nope' }).emailNormalized).toBeNull();
  });

  it('an unusable phone yields no key rather than a junk one', () => {
    expect(identityKeys({ phone: '123' }).phoneHash).toBeNull();
    expect(identityKeys({}).phoneHash).toBeNull();
    expect(identityKeys({}).emailNormalized).toBeNull();
  });
});

describe('the link decision', () => {
  const found = (over: Partial<ExistingProfile> = {}): ExistingProfile => ({
    profileId: 'p1', techCode: 'TECH-000123', displayName: 'Olivia Brown', status: 'active', matchedOn: 'phone', ...over,
  });

  it('no match → a new global account', () => {
    expect(decideIdentity(null)).toEqual({ action: 'create_new' });
  });

  it('a match → LINK. Never a second account for a person who already has one.', () => {
    expect(decideIdentity(found())).toEqual({
      action: 'link_existing', profileId: 'p1', techCode: 'TECH-000123', matchedOn: 'phone',
    });
  });

  it('an ANONYMIZED match is not a match — a deleted technician is never resurrected by a new hire', () => {
    // The tombstone keeps its tech_code forever. That is what makes "never reuse a technician ID" true, rather
    // than merely stated. Linking here would hand a new person a deleted person's followers and ratings.
    expect(decideIdentity(found({ status: 'anonymized' }))).toEqual({ action: 'create_new' });
  });

  it('a SUSPENDED match REFUSES — a suspension a salon can re-hire around is not a suspension', () => {
    const d = decideIdentity(found({ status: 'suspended' }));
    expect(d.action).toBe('refuse');
    expect(d).toMatchObject({ code: 'platform_suspended' });
    // and it must NOT quietly create a second account instead
    expect(d.action).not.toBe('create_new');
  });
});

describe('what a salon may see about a technician it has NOT hired', () => {
  const row = (over: Partial<GlobalProfileRow> = {}): GlobalProfileRow => ({
    profileId: 'p1', techCode: 'TECH-000123', displayName: 'Olivia Brown', avatarUrl: null,
    yearsExperience: 6, overallRating: 4.8, ratingCount: 52, portfolioPhotoCount: 14, status: 'active',
    normalizedPhone: '+18565551234', emailNormalized: 'olivia@example.com',
    activeTenantIds: [SALON_A, SALON_B], ...over,
  });

  it('NEVER discloses which other salons the technician works at', () => {
    // A manager typing a phone number is asking "does this person have an account?" — they are NOT asking
    // "where else does this person work". Returning the salon list would hand every manager on the platform a
    // competitor-roster tool built out of a technician's employment history, which she never consented to.
    const view = managerLookupView(row(), SALON_A);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(SALON_B);
    expect(serialized).not.toContain(SALON_A);
    expect(view).not.toHaveProperty('activeTenantIds');
  });

  it('discloses a COUNT, and whether one of them is mine', () => {
    expect(managerLookupView(row(), SALON_A)).toMatchObject({
      found: true, techCode: 'TECH-000123', activeSalonCount: 2, alreadyAtThisSalon: true,
    });
    expect(managerLookupView(row(), 'cccccccc-cccc-cccc-cccc-cccccccccccc')).toMatchObject({
      alreadyAtThisSalon: false, activeSalonCount: 2,
    });
  });

  it('does not leak the technician’s private contact details to a salon that has not hired them', () => {
    const serialized = JSON.stringify(managerLookupView(row(), SALON_A));
    expect(serialized).not.toContain('+18565551234');
    expect(serialized).not.toContain('olivia@example.com');
  });

  it('a tombstone is not a person you can hire', () => {
    expect(managerLookupView(row({ status: 'anonymized' }), SALON_A)).toEqual({ found: false });
  });
});

describe('the employment relationship', () => {
  it('only ACTIVE means the technician can work here and select this salon in the app', () => {
    expect(isEmployed('active')).toBe(true);
    for (const s of ['pending_invite', 'pending_tech_approval', 'pending_salon_approval', 'suspended', 'former', 'rejected', 'revoked', 'cancelled']) {
      expect(isEmployed(s)).toBe(false);
    }
  });

  it('routes each pending state to the party that actually has to act', () => {
    expect(needsTechAction('pending_invite')).toBe(true);
    expect(needsTechAction('pending_tech_approval')).toBe(true);
    expect(needsTechAction('pending_salon_approval')).toBe(false);
    expect(needsSalonAction('pending_salon_approval')).toBe(true);
    expect(needsSalonAction('pending_tech_approval')).toBe(false);
  });

  it('a salon’s entire vocabulary of destruction stops at its own door', () => {
    // The salon can end ITS relationship. None of these words reaches global_tech_profiles.
    expect(isSalonTerminal('suspended')).toBe(true);
    expect(isSalonTerminal('former')).toBe(true);
    expect(isSalonTerminal('revoked')).toBe(true);
    expect(isSalonTerminal('anonymized')).toBe(false);   // Super Admin only
    expect(isSalonTerminal('deleted')).toBe(false);      // not a word this system has
  });
});

describe('names', () => {
  it('keeps multi-part surnames intact', () => {
    expect(splitName('Olivia Brown')).toEqual({ firstName: 'Olivia', lastName: 'Brown', fullName: 'Olivia Brown' });
    expect(splitName('  Maria  del Carmen  Ruiz ')).toEqual({
      firstName: 'Maria', lastName: 'del Carmen Ruiz', fullName: 'Maria del Carmen Ruiz',
    });
    expect(splitName('Cher')).toEqual({ firstName: 'Cher', lastName: '', fullName: 'Cher' });
    expect(splitName('')).toEqual({ firstName: '', lastName: '', fullName: '' });
  });
});

describe('switching salon', () => {
  const wp = (over: Partial<SwitchableWorkplace> = {}): SwitchableWorkplace => ({
    tenantId: SALON_A, branchId: 'br-a', salonName: 'Luxe Nails', status: 'active', tenantStatus: 'active',
    userId: 'user-at-a', userStatus: 'active', role: 'TECHNICIAN', ...over,
  });

  it('switches into a salon the technician actively works at', () => {
    expect(decideTechSwitch([wp()], SALON_A)).toEqual({
      ok: true, tenantId: SALON_A, branchId: 'br-a', userId: 'user-at-a', role: 'TECHNICIAN', salonName: 'Luxe Nails',
    });
  });

  it('a tampered tenantId cannot put a technician into a salon they do not work at', () => {
    // The requested id is used ONLY to look up a membership the SERVER resolved. It never becomes the answer.
    const d = decideTechSwitch([wp()], SALON_B);
    expect(d.ok).toBe(false);
    expect(d).toMatchObject({ reason: 'not_available' });
  });

  it('"not one of your salons" is INDISTINGUISHABLE from "no such salon"', () => {
    // Otherwise a technician can enumerate every salon on the platform by watching the error text change.
    const notMine = decideTechSwitch([wp()], SALON_B);
    const noSuchSalon = decideTechSwitch([], 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz');
    expect(notMine).toEqual(noSuchSalon);
  });

  it('a PENDING invite is not a workplace yet', () => {
    expect(decideTechSwitch([wp({ status: 'pending_tech_approval' })], SALON_A)).toMatchObject({ ok: false, reason: 'not_employed' });
    expect(decideTechSwitch([wp({ status: 'former' })], SALON_A)).toMatchObject({ ok: false, reason: 'not_employed' });
  });

  it('a salon that suspended the technician has, by that act, closed the switch into it', () => {
    expect(decideTechSwitch([wp({ status: 'suspended' })], SALON_A)).toMatchObject({ ok: false, reason: 'access_suspended' });
    expect(decideTechSwitch([wp({ userStatus: 'suspended' })], SALON_A)).toMatchObject({ ok: false, reason: 'access_suspended' });
    expect(decideTechSwitch([wp({ userStatus: 'inactive' })], SALON_A)).toMatchObject({ ok: false, reason: 'access_suspended' });
  });

  it('an inactive salon cannot be switched into', () => {
    expect(decideTechSwitch([wp({ tenantStatus: 'suspended' })], SALON_A)).toMatchObject({ ok: false, reason: 'salon_inactive' });
  });

  it('no login row in that salon → nothing to become, and it does not say so', () => {
    expect(decideTechSwitch([wp({ userId: null })], SALON_A)).toMatchObject({ ok: false, reason: 'not_available' });
  });

  it('the session takes the TARGET salon’s role — authority never rides along from the source salon', () => {
    // Salon A granting payment permissions must not smuggle them into Salon B, which granted nothing. The
    // decision hands back the target's role so the caller derives permissions from THAT, never from the session
    // it is switching away from.
    const d = decideTechSwitch([wp({ tenantId: SALON_B, role: 'TECHNICIAN', userId: 'user-at-b' })], SALON_B);
    expect(d).toMatchObject({ ok: true, userId: 'user-at-b', role: 'TECHNICIAN' });
    expect(d).not.toMatchObject({ userId: 'user-at-a' });
  });

  it('picks the RIGHT salon out of several', () => {
    const list = [wp(), wp({ tenantId: SALON_B, salonName: 'Belle Palace', userId: 'user-at-b', branchId: 'br-b' })];
    expect(decideTechSwitch(list, SALON_B)).toMatchObject({ ok: true, tenantId: SALON_B, userId: 'user-at-b', salonName: 'Belle Palace' });
  });
});
