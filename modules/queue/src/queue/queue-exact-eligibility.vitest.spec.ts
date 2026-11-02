// queue-exact-eligibility.vitest.spec — deep-scan (Oct 22 2026, extended pilot day): walk-in assignment and Fair Turn's
// hard rule checked the service CATEGORY only, so with a salon's services in one category a technician who is not
// approved for the service (Mary, no acrylic) was recommended. With THE eligibility authority bound (workforce
// TechnicianEligibilityService — the one booking uses) the queue asks it for the exact services; the category rule is
// only the fallback without it.
import { describe, it, expect } from 'vitest';
import { TechnicianEligibilityError } from '@aipowersalon/workforce';
import { InMemoryQueueRepository, type QueueContext } from './queue.repository';
import { QueueService, ValidationError } from './queue.service';

const ctx = (perms: string[] = []): QueueContext => ({ tenantId: 'luxe001', branchId: 'br1', userId: 'u', role: 'OWNER', permissions: ['pos.queue.view', 'pos.queue.assign_technician', ...perms] });
const refusing = (who: string) => ({ asked: [] as any[], async assert(i: any) { this.asked.push(i); if (i.technicianId === who) throw new TechnicianEligibilityError('TECHNICIAN_NOT_SKILLED', 'not approved', {}); return {} as any; } });

describe('queue — exact-service eligibility when the authority is bound', () => {
  it('control: without the authority the CATEGORY rule lets the same assignment through', async () => {
    const d = await new QueueService(new InMemoryQueueRepository()).assignTechnician(ctx(), 'q_5001', { technicianId: 'tech_ava' } as any);
    expect((d as any).assignedTechnicianId ?? (d as any).assignedTechnicianName).toBeTruthy();
  });
  it('assignTechnician refuses a technician the authority says is not approved (even when her categories match)', async () => {
    const svc = new QueueService(new InMemoryQueueRepository());
    const el = refusing('tech_ava'); svc.eligibility = el;
    await expect(svc.assignTechnician(ctx(), 'q_5001', { technicianId: 'tech_ava' } as any)).rejects.toBeInstanceOf(ValidationError);
    expect(el.asked[0]).toMatchObject({ tenantId: 'luxe001', technicianId: 'tech_ava' });
    expect(el.asked[0].serviceIds.length).toBeGreaterThan(0);
  });
  it('assignmentInputs carries the authority\'s answer per candidate (serviceEligible) for Fair Turn\'s hard rule', async () => {
    const svc = new QueueService(new InMemoryQueueRepository());
    svc.eligibility = refusing('tech_ava');
    const inp = await svc.assignmentInputs(ctx(), 'q_5001');
    const ava = inp.candidates.find((c) => c.technicianId === 'tech_ava');
    expect(ava?.serviceEligible).toBe(false);
    expect(inp.candidates.filter((c) => c.technicianId !== 'tech_ava').every((c) => c.serviceEligible === true)).toBe(true);
  });
  it('§24: unbound (the in-memory dev store, no database) → the SAME one function answers (serviceEligible always present), from the fixture technicians\' category skills', async () => {
    const repo = new InMemoryQueueRepository();
    const inp = await new QueueService(repo).assignmentInputs(ctx(), 'q_5001');
    expect(inp.candidates.every((c) => typeof c.serviceEligible === 'boolean')).toBe(true);
    const need = new Set(inp.entry.requiredCategories);
    for (const c of inp.candidates) expect(c.serviceEligible, c.technicianId).toBe([...need].every((k) => c.skills.includes(k)));
  });
  it('§24: the module refuses to boot with a database and no authority (no silent category fallback in production)', async () => {
    const src = (await import('node:fs')).readFileSync(require.resolve('./queue.module.ts'), 'utf8');
    expect(src).toMatch(/repo instanceof KyselyQueueRepository && !eligibility\) throw/);
    const svcSrc = (await import('node:fs')).readFileSync(require.resolve('./queue.service.ts'), 'utf8');
    expect(svcSrc).not.toMatch(/\?\? skillMatch\(/);   // no call-site fallback is left
  });

  // B-82 (Oct 23 2026): the list form — one batch read for every candidate, and the alternates offered to a guest
  const batch = (refuse: string[]) => ({ asserts: 0, batches: [] as any[], async assert() { this.asserts++; return {} as any; },
    async eligibleAmong(i: any) { this.batches.push(i); return new Map(i.technicianIds.map((id: string) => [id, refuse.includes(id) ? { eligible: false, code: 'TECHNICIAN_NOT_SKILLED' } : { eligible: true }])); } });
  it('assignmentInputs asks the authority ONCE for every candidate (the batch), never once per technician', async () => {
    const svc = new QueueService(new InMemoryQueueRepository());
    const el = batch(['tech_ava']); svc.eligibility = el as any;
    const inp = await svc.assignmentInputs(ctx(), 'q_5001');
    expect(el.batches).toHaveLength(1);
    expect(el.asserts).toBe(0);
    expect(el.batches[0].technicianIds.length).toBe(inp.candidates.length);
    expect(inp.candidates.find((c) => c.technicianId === 'tech_ava')?.serviceEligible).toBe(false);
  });
  it('"requested technician busy → alternates" offers only technicians approved for the EXACT services; accepting an unapproved one is refused', async () => {
    const repo = new InMemoryQueueRepository();
    const desk = { ...ctx(['pos.queue.edit', 'pos.queue.change_requested_technician', 'pos.queue.manage']), role: 'FRONT_DESK' } as QueueContext;
    const customer: QueueContext = { tenantId: 'luxe001', branchId: '', userId: 'user_c_q_5002', role: 'CUSTOMER', permissions: [] };
    const plain = new QueueService(repo);
    await plain.changeRequestedTechnician(desk, 'q_5002', { technicianId: 'tech_leo' });
    expect((await plain.customerAlternates(customer, 'q_5002')).alternates.map((a) => a.name)).toEqual(['Ava']);   // control: category rule offers Ava
    const approvedOnly = (ok: string[]) => ({ ...batch([]), async eligibleAmong(i: any) { return new Map(i.technicianIds.map((id: string) => [id, ok.includes(id) ? { eligible: true } : { eligible: false, code: 'TECHNICIAN_NOT_SKILLED' }])); } });
    const svc = new QueueService(repo); svc.eligibility = approvedOnly(['tech_leo']) as any;                    // nobody but the requested one is approved
    expect((await svc.customerAlternates(customer, 'q_5002')).alternates).toEqual([]);                           // Ava (same category) is NOT offered
    await expect(svc.acceptAlternate(customer, 'q_5002', { technicianId: 'tech_ava' })).rejects.toThrow(/just taken|choose another/i);
    // …and the other way round: approved for the exact service decides, whatever her category list says
    const svc2 = new QueueService(repo); svc2.eligibility = approvedOnly(['tech_mia']) as any;
    expect((await svc2.customerAlternates(customer, 'q_5002')).alternates.map((a) => a.technicianId)).toEqual(['tech_mia']);
  });
});


// §24 (Kevin, Oct 27 2026 — reverses 3fa531bc's fail-closed rule): through the REAL workforce authority, a technician with NO
// services set up is assignable / offered through the category fallback; a configured one missing the exact service is not.
describe('queue — §24 the category fallback for a technician with no services set up (the real authority)', () => {
  it('unconfigured → assignable and among the candidates (basis fallback); configured but missing the exact service → refused', async () => {
    const { TechnicianEligibilityService, InMemoryEligibilityReader } = await import('@aipowersalon/workforce');
    const repo = new InMemoryQueueRepository();
    const probe = new QueueService(repo);
    const inp0 = await probe.assignmentInputs(ctx(), 'q_5001');
    const serviceIds: string[] = (inp0.entry as any).serviceIds ?? (await (probe as any).itemOr404(ctx(), 'q_5001')).services.map((s: any) => s.serviceId);
    expect(serviceIds.length).toBeGreaterThan(0);
    const svcs = Object.fromEntries(serviceIds.map((id) => [id, { name: id, requiredCertification: null, categoryName: 'Nails' }]));
    const rec = (id: string, approved: string[]) => ({ technicianId: id, fullName: id, employment: 'ACTIVE' as const, rosterBranchId: 'br1', branchIds: ['br1'], approvedServiceIds: approved, certifications: [] });
    const others = inp0.candidates.map((c) => c.technicianId).filter((id) => id !== 'tech_ava');
    const reader = new InMemoryEligibilityReader({ tech_ava: rec('tech_ava', []), ...Object.fromEntries(others.map((id) => [id, rec(id, ['some-other-service'])])) }, svcs);
    const svc = new QueueService(repo); svc.eligibility = new TechnicianEligibilityService({ reader });
    const inp = await svc.assignmentInputs(ctx(), 'q_5001');
    expect(inp.candidates.find((c) => c.technicianId === 'tech_ava')?.serviceEligible).toBe(true);
    for (const id of others) expect(inp.candidates.find((c) => c.technicianId === id)?.serviceEligible, id).toBe(false);
    const v = await svc.eligibility.eligibleAmong({ tenantId: 'luxe001', branchId: 'br1', technicianIds: ['tech_ava', ...others], serviceIds });
    expect(v.get('tech_ava')).toMatchObject({ eligible: true, basis: 'category_fallback_unconfigured' });
    if (others[0]) {
      expect(v.get(others[0])).toMatchObject({ eligible: false, basis: 'exact' });
      await expect(svc.assignTechnician(ctx(), 'q_5001', { technicianId: others[0] } as any)).rejects.toBeInstanceOf(ValidationError);
    }
    const d = await svc.assignTechnician(ctx(), 'q_5001', { technicianId: 'tech_ava' } as any);
    expect((d as any).assignedTechnicianId ?? (d as any).assignedTechnicianName).toBeTruthy();
  });
  // Remaining Production §24 (Oct 28 2026 audit): the item detail's "technician eligible" flag is the authority's answer
  it('the detail flag follows the authority, not the category guess', async () => {
    const svc = new QueueService(new InMemoryQueueRepository());
    const d0 = await svc.assignTechnician(ctx(), 'q_5001', { technicianId: 'tech_ava' } as any);
    expect(d0).toBeTruthy();
    const refuse = { async assert() { return {} as any; }, async eligibleAmong(i: any) { return new Map(i.technicianIds.map((id: string) => [id, { eligible: false, code: 'TECHNICIAN_NOT_SKILLED' }])); } };
    svc.eligibility = refuse as any;
    expect((await svc.detail(ctx(), 'q_5001')).technicianEligible).toBe(false);
    svc.eligibility = { ...refuse, async eligibleAmong(i: any) { return new Map(i.technicianIds.map((id: string) => [id, { eligible: true }])); } } as any;
    expect((await svc.detail(ctx(), 'q_5001')).technicianEligible).toBe(true);
  });
});
