// technician-eligibility-batch.vitest.spec.ts — B-82 / 200-technician scale (Oct 23 2026): eligibleAmong is the SAME rule as
// assertTechnicianEligible (steps 1–5: existence, employment, branch, exact service + add-on cover, certification) for a
// whole list at once. Pinned: for every technician × every service set, the batch verdict equals the single assert's.
import { describe, it, expect } from 'vitest';
import { assertTechnicianEligible, eligibleAmong, InMemoryEligibilityReader, TechnicianEligibilityError, type EligibilityDeps } from './technician-eligibility';

const T = 't1', B = 'b1', B2 = 'b2';
const reader = () => new InMemoryEligibilityReader({
  mia: { technicianId: 'mia', fullName: 'Mia', employment: 'ACTIVE', rosterBranchId: B, branchIds: [B], approvedServiceIds: ['mani', 'gel'], certifications: [] },
  ava: { technicianId: 'ava', fullName: 'Ava', employment: 'ACTIVE', rosterBranchId: B2, branchIds: [B2], approvedServiceIds: ['mani'], certifications: [] },
  leo: { technicianId: 'leo', fullName: 'Leo', employment: 'SUSPENDED', rosterBranchId: B, branchIds: [B], approvedServiceIds: ['mani'], certifications: [] },
  zoe: { technicianId: 'zoe', fullName: 'Zoe', employment: 'ACTIVE', rosterBranchId: B, branchIds: [B], approvedServiceIds: ['acrylic'], certifications: [{ name: 'Acrylic Safety', status: 'VERIFIED', expiresAt: '2026-01-01' }] },
  kim: { technicianId: 'kim', fullName: 'Kim', employment: 'ACTIVE', rosterBranchId: B, branchIds: [B], approvedServiceIds: ['acrylic'], certifications: [{ name: 'acrylic safety', status: 'VERIFIED', expiresAt: '2099-01-01' }] },
  old: { technicianId: 'old', fullName: 'Old', employment: 'ACTIVE', rosterBranchId: B, branchIds: [B], approvedServiceIds: [], certifications: [], legacySkillsUnconfigured: true },
  ned: { technicianId: 'ned', fullName: 'Ned', employment: 'ACTIVE', rosterBranchId: null, branchIds: [B], approvedServiceIds: ['mani', 'acrylic'], certifications: [] },
}, {
  mani: { name: 'Manicure', requiredCertification: null }, gel: { name: 'Gel', requiredCertification: null },
  art: { name: 'Nail Art', requiredCertification: null, isAddOn: true },
  acrylic: { name: 'Acrylic Full Set', requiredCertification: 'Acrylic Safety' },
});
const deps = (): EligibilityDeps => ({ reader: reader(), now: () => new Date('2026-10-23T12:00:00Z') });
const TECHS = ['mia', 'ava', 'leo', 'zoe', 'kim', 'old', 'ned', 'nobody'];
const SETS = [[], ['mani'], ['gel'], ['mani', 'gel'], ['acrylic'], ['art'], ['mani', 'art'], ['acrylic', 'art'], ['mani', 'acrylic'], ['unknown-svc']];

describe('eligibleAmong ≡ assertTechnicianEligible (steps 1–5)', () => {
  for (const branchId of [B, B2, null]) for (const serviceIds of SETS) {
    it(`branch ${branchId ?? '(none)'} · [${serviceIds.join(', ')}]`, async () => {
      const batch = await eligibleAmong(deps(), { tenantId: T, branchId, technicianIds: TECHS, serviceIds });
      for (const id of TECHS) {
        const single = await assertTechnicianEligible(deps(), { tenantId: T, branchId, technicianId: id, serviceIds, actor: {} }).then(() => 'OK', (e) => (e instanceof TechnicianEligibilityError ? e.code : 'THROW'));
        const v = batch.get(id)!;
        expect(v.eligible ? 'OK' : v.code, `${id}`).toBe(single);
      }
    });
  }
  it('the exact-service rule, not the category: Ava (manicure only) is never eligible for gel; an add-on rides on a main', async () => {
    const v = await eligibleAmong(deps(), { tenantId: T, branchId: B2, technicianIds: ['ava'], serviceIds: ['mani', 'gel'] });
    expect(v.get('ava')).toMatchObject({ eligible: false, code: 'TECHNICIAN_NOT_SKILLED' });
    expect((await eligibleAmong(deps(), { tenantId: T, branchId: B2, technicianIds: ['ava'], serviceIds: ['mani', 'art'] })).get('ava')!.eligible).toBe(true);
    expect((await eligibleAmong(deps(), { tenantId: T, branchId: B2, technicianIds: ['ava'], serviceIds: ['art'] })).get('ava')!.eligible).toBe(false);   // add-on alone is checked exactly
  });
  it('an expired required certification blocks; a current one passes', async () => {
    const v = await eligibleAmong(deps(), { tenantId: T, branchId: B, technicianIds: ['zoe', 'kim'], serviceIds: ['acrylic'] });
    expect(v.get('zoe')).toMatchObject({ eligible: false, code: 'TECHNICIAN_NOT_SKILLED' });
    expect(v.get('kim')!.eligible).toBe(true);
  });
  it('an empty list answers an empty map (no reads)', async () => {
    expect((await eligibleAmong(deps(), { tenantId: T, branchId: B, technicianIds: [], serviceIds: ['mani'] })).size).toBe(0);
  });
});

// Oct 28 2026 (multi-technician plan lines): the same batch read also says, per technician, which of the visit's services she
// may do on her OWN line — so the AI plan never routes a line to someone the authority would refuse, with no second read.
describe('allowedServiceIds — the per-line answer from the same batch', () => {
  for (const branchId of [B, B2, null]) for (const serviceIds of SETS.filter((s) => s.length)) {
    it(`a main service is allowed exactly when assert() for that service alone passes · ${branchId ?? '(none)'} · [${serviceIds.join(', ')}]`, async () => {
      const batch = await eligibleAmong(deps(), { tenantId: T, branchId, technicianIds: TECHS, serviceIds });
      for (const id of TECHS) for (const sid of serviceIds.filter((s) => s !== 'art')) {
        const alone = await assertTechnicianEligible(deps(), { tenantId: T, branchId, technicianId: id, serviceIds: [sid], actor: {} }).then(() => true, () => false);
        expect((batch.get(id)?.allowedServiceIds ?? []).includes(sid), `${id} · ${sid}`).toBe(alone);
      }
    });
  }
  it('whole-visit eligible ⇒ every line allowed; split skills are named per line', async () => {
    const v = await eligibleAmong(deps(), { tenantId: T, branchId: B, technicianIds: ['mia', 'ned', 'kim'], serviceIds: ['mani', 'acrylic'] });
    expect(v.get('ned')).toMatchObject({ eligible: false, allowedServiceIds: ['mani'] });      // approved for acrylic, but no Acrylic Safety certificate
    expect((await eligibleAmong(deps(), { tenantId: T, branchId: B, technicianIds: ['mia'], serviceIds: ['mani', 'gel'] })).get('mia')).toMatchObject({ eligible: true, allowedServiceIds: ['mani', 'gel'] });
    expect(v.get('mia')).toMatchObject({ eligible: false, allowedServiceIds: ['mani'] });      // not approved for acrylic
    expect(v.get('kim')).toMatchObject({ eligible: false, allowedServiceIds: ['acrylic'] });   // certified acrylic only
  });
  it('an add-on line rides on the visit\'s main service; a not-active technician gets no line at all', async () => {
    const v = await eligibleAmong(deps(), { tenantId: T, branchId: B, technicianIds: ['mia', 'leo', 'nobody'], serviceIds: ['mani', 'art'] });
    expect(v.get('mia')!.allowedServiceIds).toEqual(['mani', 'art']);
    expect(v.get('leo')!.allowedServiceIds).toEqual([]);
    expect(v.get('nobody')!.allowedServiceIds).toEqual([]);
    expect((await eligibleAmong(deps(), { tenantId: T, branchId: B, technicianIds: ['mia'], serviceIds: ['art'] })).get('mia')!.allowedServiceIds).toEqual([]);
  });
  it('the category fallback (no services set up) applies per line too', async () => {
    const v = await eligibleAmong(deps(), { tenantId: T, branchId: B, technicianIds: ['old'], serviceIds: ['mani', 'acrylic'] });
    const alone = await assertTechnicianEligible(deps(), { tenantId: T, branchId: B, technicianId: 'old', serviceIds: ['mani'], actor: {} }).then(() => true, () => false);
    expect(v.get('old')!.allowedServiceIds!.includes('mani')).toBe(alone);
    expect(v.get('old')!.allowedServiceIds!.includes('acrylic')).toBe(false);   // a required certification she does not hold
  });
});
