// team-onboarding.realtime — TM-05 (gap sweep, Oct 30 2026): adding a team member tells the other Team screens at once
// (team_member_created, ids only) in every branch the member was granted plus the creator's own; a replayed request
// changed nothing and announces nothing.
import { describe, it, expect } from 'vitest';
import { EVENTS } from '@aipowersalon/realtime-contracts';
import { TeamOnboardingController } from './team-onboarding.controller';

const sent: { scope: any; event: string; payload: any }[] = [];
const realtime: any = { toTenant: (scope: any, event: string, payload: any) => { sent.push({ scope, event, payload }); } };
let next: any = null;
const repo: any = { create: async () => next };
const req = { ctx: { tenantId: 'ten_a', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.technicians.view'] }, headers: {} };

describe('team_member_created', () => {
  it('a new member: one ids-only event per room (granted branches + the creator\'s branch, no duplicates)', async () => {
    sent.length = 0;
    next = { memberId: 'm1', branchIds: ['b1', 'b2'], replayed: false, invite: { deliveryStatus: 'sent' } };
    const out: any = await new TeamOnboardingController(repo, realtime).create(req, { role: 'receptionist', fullName: 'Rae' });
    expect(out.memberId).toBe('m1');
    expect(sent.map((x) => x.scope.branchId).sort()).toEqual(['b1', 'b2']);
    expect(sent.every((x) => x.event === EVENTS.teamMemberCreated && x.scope.tenantId === 'ten_a')).toBe(true);
    expect(sent[0].payload).toEqual({ memberId: 'm1' });   // no name, email or phone
  });
  it('a replayed request announces nothing; no emitter is not an error', async () => {
    sent.length = 0;
    next = { memberId: 'm1', branchIds: ['b1'], replayed: true };
    await new TeamOnboardingController(repo, realtime).create(req, {});
    expect(sent).toEqual([]);
    next = { memberId: 'm2', branchIds: ['b1'], replayed: false };
    expect(((await new TeamOnboardingController(repo).create(req, {})) as any).memberId).toBe('m2');
  });
});
