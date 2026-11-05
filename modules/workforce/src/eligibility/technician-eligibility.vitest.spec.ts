// technician-eligibility.vitest.spec.ts — THE eligibility function, pure (in-memory reader + fake ports).
// Pinned: the order and codes of every refusal, exact-service (not category) skill matching, certification
// expiry/revocation, the override bypassing ONLY schedule/availability, and fail-closed assignability.
import { describe, it, expect } from 'vitest';
import { assertTechnicianEligible, InMemoryEligibilityReader, TechnicianEligibilityError, certificationBlocks, type EligibilityDeps } from './technician-eligibility';
import { FakeAvailabilityPort, FailClosedWorkforceStatePort, PermissiveWorkforceStatePort } from '../workforce-status/workforce-ports';

const T = 't1', B = 'b1', B2 = 'b2';
const reader = () => new InMemoryEligibilityReader({
  mia: { technicianId: 'mia', fullName: 'Mia Chen', employment: 'ACTIVE', rosterBranchId: B, branchIds: [B], approvedServiceIds: ['mani', 'gel'], certifications: [] },
  ava: { technicianId: 'ava', fullName: 'Ava Lee', employment: 'ACTIVE', rosterBranchId: B2, branchIds: [B2], approvedServiceIds: ['mani'], certifications: [] },
  leo: { technicianId: 'leo', fullName: 'Leo Park', employment: 'SUSPENDED', rosterBranchId: B, branchIds: [B], approvedServiceIds: ['mani'], certifications: [] },
  zoe: { technicianId: 'zoe', fullName: 'Zoe Diaz', employment: 'ACTIVE', rosterBranchId: B, branchIds: [B], approvedServiceIds: ['acrylic'], certifications: [{ name: 'Acrylic Safety', status: 'VERIFIED', expiresAt: '2020-01-01' }] },
  kim: { technicianId: 'kim', fullName: 'Kim Vo', employment: 'ACTIVE', rosterBranchId: B, branchIds: [B], approvedServiceIds: ['acrylic'], certifications: [{ name: 'acrylic safety', status: 'VERIFIED', expiresAt: '2099-01-01' }] },
}, {
  mani: { name: 'Manicure', requiredCertification: null }, gel: { name: 'Gel Add-on', requiredCertification: null },
  acrylic: { name: 'Acrylic Full Set', requiredCertification: 'Acrylic Safety' },
});
const deps = (extra: Partial<EligibilityDeps> = {}): EligibilityDeps => ({ reader: reader(), availability: new FakeAvailabilityPort(), workforce: new PermissiveWorkforceStatePort(), now: () => new Date('2026-10-09T12:00:00Z'), ...extra });
const actor = { userId: 'u', role: 'MANAGER', permissions: [] as string[] };
const code = async (p: Promise<unknown>) => { try { await p; return 'OK'; } catch (e: any) { if (e instanceof TechnicianEligibilityError) return e.code; throw e; } };

describe('assertTechnicianEligible — codes in order', () => {
  it('TECHNICIAN_NOT_FOUND for an unknown technician', async () => {
    expect(await code(assertTechnicianEligible(deps(), { tenantId: T, branchId: B, technicianId: 'nobody', serviceIds: ['mani'], actor }))).toBe('TECHNICIAN_NOT_FOUND');
  });
  it('TECHNICIAN_NOT_ACTIVE for a suspended technician — even with an override', async () => {
    expect(await code(assertTechnicianEligible(deps(), { tenantId: T, branchId: B, technicianId: 'leo', serviceIds: ['mani'], actor: { ...actor, overrideConflicts: true } }))).toBe('TECHNICIAN_NOT_ACTIVE');
  });
  it('TECHNICIAN_BRANCH_ACCESS_DENIED when she is not employed at the branch', async () => {
    expect(await code(assertTechnicianEligible(deps(), { tenantId: T, branchId: B, technicianId: 'ava', serviceIds: ['mani'], actor }))).toBe('TECHNICIAN_BRANCH_ACCESS_DENIED');
    expect(await code(assertTechnicianEligible(deps(), { tenantId: T, branchId: B2, technicianId: 'ava', serviceIds: ['mani'], actor }))).toBe('OK');
  });
  it('TECHNICIAN_NOT_SKILLED is per EXACT service with the pinned message, never per category', async () => {
    // ava holds Manicure but not Gel Add-on → the second service fails
    const e = await assertTechnicianEligible(deps(), { tenantId: T, branchId: B2, technicianId: 'ava', serviceIds: ['mani', 'gel'], actor }).catch((x) => x);
    expect(e).toBeInstanceOf(TechnicianEligibilityError);
    expect(e.code).toBe('TECHNICIAN_NOT_SKILLED');
    expect(e.message).toBe('Ava Lee is not currently approved for this service.');
    expect(e.details.serviceId).toBe('gel');
  });
  it('skills are NEVER overridable', async () => {
    expect(await code(assertTechnicianEligible(deps(), { tenantId: T, branchId: B2, technicianId: 'ava', serviceIds: ['gel'], actor: { ...actor, overrideConflicts: true } }))).toBe('TECHNICIAN_NOT_SKILLED');
  });
  it('an EXPIRED required certification blocks; a valid one (case-insensitive name) passes', async () => {
    expect(await code(assertTechnicianEligible(deps(), { tenantId: T, branchId: B, technicianId: 'zoe', serviceIds: ['acrylic'], actor: { ...actor, overrideConflicts: true } }))).toBe('TECHNICIAN_NOT_SKILLED');
    expect(await code(assertTechnicianEligible(deps(), { tenantId: T, branchId: B, technicianId: 'kim', serviceIds: ['acrylic'], actor }))).toBe('OK');
  });
  it('a REVOKED certification blocks even before its expiry date', () => {
    expect(certificationBlocks({ status: 'REVOKED', expiresAt: '2099-01-01' }, new Date('2026-01-01'))).toBe('revoked');
    expect(certificationBlocks({ status: 'VERIFIED', expiresAt: '2026-01-01' }, new Date('2026-01-02'))).toBe('expired');
    expect(certificationBlocks({ status: 'VERIFIED', expiresAt: '2026-01-02' }, new Date('2026-01-02T10:00:00Z'))).toBeNull();
    expect(certificationBlocks(undefined, new Date())).toBe('missing');
  });
});

describe('schedule / availability (the ONLY overridable checks)', () => {
  it('TECHNICIAN_NOT_AVAILABLE from the AvailabilityPort when `at` is given; the override bypasses it', async () => {
    const availability = new FakeAvailabilityPort({ mia: { available: false, reason: 'LUNCH' } });
    const d = deps({ availability });
    expect(await code(assertTechnicianEligible(d, { tenantId: T, branchId: B, technicianId: 'mia', serviceIds: ['mani'], at: { dateIso: '2026-10-09', startTime: '12:30' }, durationMin: 45, actor }))).toBe('TECHNICIAN_NOT_AVAILABLE');
    expect(availability.calls[0]).toMatchObject({ technicianId: 'mia', dateIso: '2026-10-09', startTime: '12:30', durationMin: 45 });
    expect(await code(assertTechnicianEligible(d, { tenantId: T, branchId: B, technicianId: 'mia', serviceIds: ['mani'], at: { dateIso: '2026-10-09', startTime: '12:30' }, actor: { ...actor, overrideConflicts: true } }))).toBe('OK');
  });
  it('SCHEDULE_CONFLICT carries the conflicting appointment', async () => {
    const d = deps({ availability: new FakeAvailabilityPort({ mia: { available: false, reason: 'CONFLICT', conflictingAppointmentId: 'a9' } }) });
    const e = await assertTechnicianEligible(d, { tenantId: T, branchId: B, technicianId: 'mia', serviceIds: [], at: { dateIso: '2026-10-09', startTime: '09:00' }, actor }).catch((x) => x);
    expect(e.code).toBe('SCHEDULE_CONFLICT'); expect(e.details.conflictingAppointmentId).toBe('a9'); expect(e.httpStatus).toBe(409);
  });
  it('without `at` the schedule engine is not consulted', async () => {
    const availability = new FakeAvailabilityPort({ mia: { available: false, reason: 'LUNCH' } });
    expect(await code(assertTechnicianEligible(deps({ availability }), { tenantId: T, branchId: B, technicianId: 'mia', serviceIds: ['mani'], actor }))).toBe('OK');
    expect(availability.calls).toHaveLength(0);
  });
});

describe('assignability (workforce state)', () => {
  it('fails CLOSED: the stub answers not assignable → TECHNICIAN_NOT_AVAILABLE', async () => {
    expect(await code(assertTechnicianEligible(deps({ workforce: new FailClosedWorkforceStatePort() }), { tenantId: T, branchId: B, technicianId: 'mia', serviceIds: ['mani'], requireAssignable: true, actor }))).toBe('TECHNICIAN_NOT_AVAILABLE');
  });
  it('a live service → TECHNICIAN_ALREADY_SERVING; BREAK → not available; the override bypasses availability only', async () => {
    const wf = new PermissiveWorkforceStatePort({ mia: { assignable: false, service: 'SERVING', reason: 'IN_SERVICE' }, zoe: { assignable: false, presence: 'BREAK', reason: 'ON_BREAK' } });
    expect(await code(assertTechnicianEligible(deps({ workforce: wf }), { tenantId: T, branchId: B, technicianId: 'mia', serviceIds: ['mani'], requireAssignable: true, actor }))).toBe('TECHNICIAN_ALREADY_SERVING');
    expect(await code(assertTechnicianEligible(deps({ workforce: wf }), { tenantId: T, branchId: B, technicianId: 'zoe', serviceIds: [], requireAssignable: true, actor }))).toBe('TECHNICIAN_NOT_AVAILABLE');
    expect(await code(assertTechnicianEligible(deps({ workforce: wf }), { tenantId: T, branchId: B, technicianId: 'mia', serviceIds: ['mani'], requireAssignable: true, actor: { ...actor, overrideConflicts: true } }))).toBe('OK');
  });
  it('requireAssignable=false (helper / team session) skips the workforce question', async () => {
    const wf = new PermissiveWorkforceStatePort({ mia: { assignable: false, service: 'SERVING' } });
    expect(await code(assertTechnicianEligible(deps({ workforce: wf }), { tenantId: T, branchId: B, technicianId: 'mia', serviceIds: ['mani'], requireAssignable: false, actor }))).toBe('OK');
  });
});

// Fix Oct 12 2026 (wave-2 regression): starting / taking over THIS ticket is not "take ANOTHER guest". The only
// workforce refusal there is a live service elsewhere; not clocked in (salons that do not use the time clock) and
// "already holds this ticket" were never refusals before the merge and are not now.
describe('requireNotServing — the start / live-reassign question', () => {
  const wf = (snap: any, assignable = false, reason = 'NOT_CLOCKED_IN') => ({ get: async () => snap, isAssignable: async () => ({ assignable, reason, snapshot: snap }) }) as any;
  const run = (w: any, over: any = {}) => code(assertTechnicianEligible(deps({ workforce: w }), { tenantId: T, branchId: B, technicianId: 'mia', serviceIds: ['mani'], requireNotServing: true, actor, ...over } as any));
  it('a technician who is not clocked in (no time clock at this salon) may start her own ticket', async () => {
    expect(await run(wf({ employment: 'ACTIVE', clock: 'CLOCKED_OUT', shift: 'OFF_SHIFT', queue: 'OFF_SHIFT', service: 'IDLE', presence: 'AWAY' }))).toBe('OK');
  });
  it('a technician who already holds this ticket (queue ASSIGNED) may start it', async () => {
    expect(await run(wf({ employment: 'ACTIVE', clock: 'CLOCKED_IN', shift: 'ON_SHIFT', queue: 'ASSIGNED', service: 'IDLE', presence: 'PRESENT' }, false, 'ALREADY_ASSIGNED'))).toBe('OK');
  });
  it('a live service elsewhere (serving or paused) → TECHNICIAN_ALREADY_SERVING; the override still bypasses it', async () => {
    expect(await run(wf({ employment: 'ACTIVE', clock: 'CLOCKED_IN', shift: 'ON_SHIFT', queue: 'SERVING', service: 'SERVING', presence: 'PRESENT' }, false, 'IN_SERVICE'))).toBe('TECHNICIAN_ALREADY_SERVING');
    expect(await run(wf({ employment: 'ACTIVE', clock: 'CLOCKED_IN', shift: 'ON_SHIFT', queue: 'ASSIGNED', service: 'PAUSED', presence: 'PRESENT' }, false, 'ALREADY_ASSIGNED'))).toBe('TECHNICIAN_ALREADY_SERVING');
    expect(await run(wf({ service: 'SERVING' }, false, 'IN_SERVICE'), { actor: { ...actor, overrideConflicts: true } })).toBe('OK');
  });
  it('skills are still checked first (never bypassed)', async () => {
    expect(await code(assertTechnicianEligible(deps(), { tenantId: T, branchId: B, technicianId: 'ava', serviceIds: ['gel'], requireNotServing: true, actor: { ...actor, overrideConflicts: true } } as any))).not.toBe('OK');
  });
});

// Fix Oct 12 2026: a technician that existed before the exact-service model (migration 631 marks her
// legacy_unconfigured — no service mapping at all) keeps the pre-deploy behaviour: no skills refusal. One with ANY
// mapping (or created after 631) is exact-service.
describe('legacy (pre-631) technicians with no service mapping', () => {
  const r = () => { const x = reader(); x.techs.old = { technicianId: 'old', fullName: 'Old Timer', employment: 'ACTIVE', rosterBranchId: B, branchIds: [B], approvedServiceIds: [], certifications: [], legacySkillsUnconfigured: true } as any;
    x.techs.newbie = { technicianId: 'newbie', fullName: 'New Hire', employment: 'ACTIVE', rosterBranchId: B, branchIds: [B], approvedServiceIds: [], certifications: [] } as any;
    x.techs.oldmapped = { technicianId: 'oldmapped', fullName: 'Old Mapped', employment: 'ACTIVE', rosterBranchId: B, branchIds: [B], approvedServiceIds: ['mani'], certifications: [], legacySkillsUnconfigured: true } as any; return x; };
  it('unconfigured legacy → OK for any service; a post-631 technician with no grant → NOT_SKILLED', async () => {
    expect(await code(assertTechnicianEligible(deps({ reader: r() }), { tenantId: T, branchId: B, technicianId: 'old', serviceIds: ['mani', 'gel'], actor }))).toBe('OK');
    expect(await code(assertTechnicianEligible(deps({ reader: r() }), { tenantId: T, branchId: B, technicianId: 'newbie', serviceIds: ['mani'], actor }))).toBe('TECHNICIAN_NOT_SKILLED');
  });
  it('a legacy technician WITH a mapping is exact-service', async () => {
    expect(await code(assertTechnicianEligible(deps({ reader: r() }), { tenantId: T, branchId: B, technicianId: 'oldmapped', serviceIds: ['gel'], actor }))).toBe('TECHNICIAN_NOT_SKILLED');
  });
  it('a required certification still applies to an unconfigured legacy technician', async () => {
    expect(await code(assertTechnicianEligible(deps({ reader: r() }), { tenantId: T, branchId: B, technicianId: 'old', serviceIds: ['acrylic'], actor }))).toBe('TECHNICIAN_NOT_SKILLED');
  });
});
