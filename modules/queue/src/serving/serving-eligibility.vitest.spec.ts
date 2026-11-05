// serving-eligibility.vitest.spec — merge Oct 12 2026 (other chat's workforce audit P1 #21 + P0 #7, ported onto OUR
// TechnicianEligibilityService and resolveManagerOverride). Serving start / assign technician / assign helper consult THE ONE
// eligibility function (active, this branch, approved for every line, assignable when live); the workforce state projection
// follows start / pause / resume; `managerOverride` is honoured only with pos.booking.override_conflict.
import { describe, it, expect } from 'vitest';
import { TechnicianEligibilityService, InMemoryEligibilityReader, PermissiveWorkforceStatePort } from '@aipowersalon/workforce';
import { InMemoryServingRepository, type ServingContext } from './serving.repository';
import { ServingService, ForbiddenError, ValidationError, ConflictError } from './serving.service';

const PERMS = ['pos.serving.view', 'pos.serving.start', 'pos.serving.pause_resume', 'pos.serving.edit_services', 'pos.serving.assign_technician', 'pos.serving.assign_helper', 'pos.serving.mark_done'];
const owner = (over: Partial<ServingContext> = {}): ServingContext => ({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: PERMS, ...over });
const rec = (id: string, name: string, approved: string[], over: any = {}) => ({ technicianId: id, fullName: name, employment: 'ACTIVE' as const, rosterBranchId: 'br_cherryhill', branchIds: ['br_cherryhill'], approvedServiceIds: approved, certifications: [], ...over });

function harness(techs: Record<string, any>, settings: any = {}) {
  const repo = new InMemoryServingRepository();
  const workforce = new PermissiveWorkforceStatePort();
  const eligibility = new TechnicianEligibilityService({ reader: new InMemoryEligibilityReader(techs, { svc_mani: { name: 'Signature Manicure', requiredCertification: null }, svc_gel: { name: 'Gel Add-on', requiredCertification: null } }), workforce });
  const orig = repo.settings.bind(repo);
  (repo as any).settings = async (c: any) => ({ ...(await orig(c)), ...settings });
  return { repo, workforce, svc: new ServingService(repo, undefined, undefined, eligibility) };
}

describe('Serving consults THE ONE eligibility function', () => {
  it('start refuses a technician not approved for a line on the ticket (422 vocabulary → ValidationError) and records nothing', async () => {
    const { svc, workforce } = harness({ tech_leo: rec('tech_leo', 'Leo', []) });
    await expect(svc.start(owner(), 'sv_4003')).rejects.toThrow(ValidationError);
    await expect(svc.start(owner(), 'sv_4003')).rejects.toThrow(/not currently approved/);
    expect(workforce.transitions.filter((t: any) => t.kind === 'serviceStarted')).toHaveLength(0);
  });
  it('start of an approved technician succeeds and projects serviceStarted; pause projects servicePaused', async () => {
    const { svc, workforce } = harness({ tech_leo: rec('tech_leo', 'Leo', ['svc_mani']) });
    await svc.start(owner(), 'sv_4003');
    expect(workforce.transitions.some((t: any) => t.kind === 'serviceStarted' && t.technicianId === 'tech_leo')).toBe(true);
    await svc.pause(owner(), 'sv_4003');
    expect(workforce.transitions.some((t: any) => t.kind === 'servicePaused' && t.technicianId === 'tech_leo')).toBe(true);
  });
  it('a technician of ANOTHER branch is refused (403 vocabulary → ForbiddenError); a suspended one is refused', async () => {
    const { svc } = harness({ tech_ava: rec('tech_ava', 'Ava', ['svc_mani', 'svc_gel'], { branchIds: ['br_other'], rosterBranchId: 'br_other' }), tech_mia: rec('tech_mia', 'Mia', ['svc_mani', 'svc_gel'], { employment: 'SUSPENDED' }) });
    await expect(svc.assignTechnician(owner(), 'sv_4001', { technicianId: 'tech_ava' })).rejects.toThrow(ForbiddenError);
    await expect(svc.assignTechnician(owner(), 'sv_4003', { technicianId: 'tech_mia' })).rejects.toThrow(/not active/);
  });
  it('a helper must be eligible for the ticket\'s services too, but "already serving" does not apply to a team session', async () => {
    const { svc, repo } = harness({ tech_mia: rec('tech_mia', 'Mia', ['svc_mani', 'svc_gel']), tech_ava: rec('tech_ava', 'Ava', ['svc_mani']) }, { allowHelperTechnician: true });
    await expect(svc.assignHelper(owner(), 'sv_4001', { technicianId: 'tech_ava' })).rejects.toThrow(/not currently approved/);   // gel line
    const { svc: s2 } = harness({ tech_ava: rec('tech_ava', 'Ava', ['svc_mani', 'svc_gel']) }, { allowHelperTechnician: true });
    await s2.assignHelper(owner(), 'sv_4001', { technicianId: 'tech_ava' });
    expect(repo).toBeDefined();
  });
  it('ConflictError carries the code for an eligibility "already serving" refusal', async () => {
    const { svc, workforce } = harness({ tech_ava: rec('tech_ava', 'Ava', ['svc_mani', 'svc_gel']) });
    (workforce as any).isAssignable = async () => ({ assignable: false, reason: 'IN_SERVICE', snapshot: { service: 'IN_SERVICE' } });
    const e: any = await svc.assignTechnician(owner(), 'sv_4001', { technicianId: 'tech_ava' }).catch((x) => x);
    expect(e).toBeInstanceOf(ConflictError);
    expect(e.code).toBe('TECHNICIAN_ALREADY_SERVING');
  });
});

describe('managerOverride is honoured only with pos.booking.override_conflict (P0 #7)', () => {
  it('addService with managerOverride but without the permission is refused; with it the edit goes through', async () => {
    const { svc } = harness({}, { allowServiceEditDuringServing: false });
    await expect(svc.addService(owner(), 'sv_4001', { serviceId: 'svc_gel', managerOverride: true } as any)).rejects.toThrow(ForbiddenError);
    await svc.addService(owner({ permissions: [...PERMS, 'pos.booking.override_conflict'] }), 'sv_4001', { serviceId: 'svc_gel', managerOverride: true } as any);
    expect(svc.auditLog().some((a) => a.actionType === 'manager_override_used')).toBe(true);
  });
});

// Fix Oct 12 2026 (wave-2 regression, live-multitech-queue "start 400"): a fresh start / a live reassignment asks only
// "is she serving someone ELSE" (not clocked in — a salon without the time clock — is not a refusal), and on a shared
// visit the primary technician is checked against HER lines, never another line technician's.
describe('start / reassign: the live-service question and line ownership', () => {
  const notClockedIn = (w: any) => { w.isAssignable = async () => ({ assignable: false, reason: 'NOT_CLOCKED_IN', snapshot: { employment: 'ACTIVE', clock: 'CLOCKED_OUT', service: 'IDLE', queue: 'OFF_SHIFT' } }); };
  it('a technician who is not clocked in can start her ticket', async () => {
    const { svc, workforce } = harness({ tech_leo: rec('tech_leo', 'Leo', ['svc_mani']) });
    notClockedIn(workforce);
    await expect(svc.start(owner(), 'sv_4003')).resolves.toBeTruthy();
  });
  it('a technician serving another guest cannot start a second one', async () => {
    const { svc, workforce } = harness({ tech_leo: rec('tech_leo', 'Leo', ['svc_mani']) });
    (workforce as any).isAssignable = async () => ({ assignable: false, reason: 'IN_SERVICE', snapshot: { service: 'SERVING' } });
    const e: any = await svc.start(owner(), 'sv_4003').catch((x) => x);
    expect(e).toBeInstanceOf(ConflictError);
  });
  it('a shared visit: the primary is checked against her own (and unowned) lines only — another line technician\'s pedicure is not hers', async () => {
    const { svc, repo } = harness({ tech_leo: rec('tech_leo', 'Leo', ['svc_mani']) });
    const t: any = await repo.ticket(owner(), 'sv_4003');
    t.lines.push({ serviceLineId: 'l4b', serviceId: 'svc_pedi', serviceName: 'Spa Pedicure', priceCents: 6500, technicianId: 'tech_ava', technicianName: 'Ava', status: 'pending', estDurationMin: 55 });
    await expect(svc.start(owner(), 'sv_4003')).resolves.toBeTruthy();
    // an UNOWNED line she is not approved for still refuses
    t.lines.push({ serviceLineId: 'l4c', serviceId: 'svc_gel', serviceName: 'Gel Add-on', priceCents: 1500, status: 'pending', estDurationMin: 15 });
    const { svc: s2, repo: r2 } = harness({ tech_leo: rec('tech_leo', 'Leo', ['svc_mani']) });
    const t2: any = await r2.ticket(owner(), 'sv_4003');
    t2.lines.push({ serviceLineId: 'l4c', serviceId: 'svc_gel', serviceName: 'Gel Add-on', priceCents: 1500, status: 'pending', estDurationMin: 15 });
    await expect(s2.start(owner(), 'sv_4003')).rejects.toThrow(/not currently approved/);
  });
  it('reassigning a live ticket to a technician who is not clocked in (but serves no one) is allowed', async () => {
    const { svc, workforce } = harness({ tech_ava: rec('tech_ava', 'Ava', ['svc_mani', 'svc_gel']) });
    notClockedIn(workforce);
    await expect(svc.assignTechnician(owner(), 'sv_4001', { technicianId: 'tech_ava' })).resolves.toBeTruthy();
  });
});
