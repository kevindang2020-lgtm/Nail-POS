import { describe, it, expect } from 'vitest';
import { skillMatch, isEligible, scoreTechnician, recommendTechnician, type RecoTech } from './tech-recommendation';

const T = (o: Partial<RecoTech> & { technicianId: string; name: string }): RecoTech => ({ available: true, skills: [], ...o });

describe('technician recommendation', () => {
  it('skillMatch requires every required category to be covered', () => {
    expect(skillMatch(['Acrylic', 'Gel X'], ['Gel X'])).toBe(true);
    expect(skillMatch(['Acrylic'], ['Gel X'])).toBe(false);
    expect(skillMatch(['Acrylic'], [])).toBe(true);
  });
  it('isEligible needs availability AND skill', () => {
    expect(isEligible(T({ technicianId: 't1', name: 'A', skills: ['Gel X'] }), ['Gel X'])).toBe(true);
    expect(isEligible(T({ technicianId: 't2', name: 'B', skills: ['Gel X'], available: false }), ['Gel X'])).toBe(false);
    expect(isEligible(T({ technicianId: 't3', name: 'C', skills: ['Acrylic'] }), ['Gel X'])).toBe(false);
  });
  it('requested + previous + low load rank a tech higher; ineligible never wins', () => {
    const techs = [
      T({ technicianId: 't1', name: 'Skilled Busy', skills: ['Gel X'], activeLoad: 4 }),
      T({ technicianId: 't2', name: 'Requested', skills: ['Gel X'], activeLoad: 1, isRequested: true }),
      T({ technicianId: 't3', name: 'Unskilled', skills: ['Pedicure'] }),
      T({ technicianId: 't4', name: 'Offline', skills: ['Gel X'], available: false }),
    ];
    const r = recommendTechnician(techs, ['Gel X']);
    expect(r.best?.name).toBe('Requested');
    expect(r.all.find((x) => x.name === 'Unskilled')?.eligible).toBe(false);
    expect(r.all.find((x) => x.name === 'Offline')?.eligible).toBe(false);
    // alternatives are eligible only
    expect(r.alternatives.every((a) => a.eligible)).toBe(true);
  });
  it('scoreTechnician explains its reasoning', () => {
    const s = scoreTechnician(T({ technicianId: 't', name: 'X', skills: ['Gel X'], activeLoad: 2, isRequested: true }), ['Gel X']);
    expect(s.reasons).toContain('Skill match');
    expect(s.reasons).toContain('Requested by guest');
    expect(s.reasons.some((r) => /active/.test(r))).toBe(true);
  });
  it('returns no best when nobody is eligible', () => {
    const r = recommendTechnician([T({ technicianId: 't', name: 'X', skills: ['Pedicure'] })], ['Gel X']);
    expect(r.best).toBeUndefined();
  });
});
