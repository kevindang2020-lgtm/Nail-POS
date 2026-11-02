// skill-review.vitest.spec.ts — Functional Decision 7: the skill-request review runs
// DRAFT -> SUBMITTED -> UNDER_REVIEW -> MORE_INFORMATION_REQUIRED -> APPROVED / REJECTED, only a manager reviews,
// asking for more information needs a note, and the reviewer's note reaches the repository (it used to be dropped).
import { describe, it, expect, beforeEach } from 'vitest';
import { TechService } from './tech.service';
import { canReviewSkillRequest } from './tech.repository';
import type { TechContext } from './tech.repository';

const manager: TechContext = { tenantId: 't1', branchId: 'b1', userId: 'm1', role: 'MANAGER', permissions: ['technicians.edit'] };
const tech: TechContext = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'TECHNICIAN', permissions: ['tech.skills.request'] };

describe('canReviewSkillRequest — the allowed reviewer moves', () => {
  it('a submitted (or legacy pending) request can go to any reviewer step', () => {
    for (const from of ['submitted', 'pending']) for (const to of ['under_review', 'more_information_required', 'approved', 'rejected']) expect(canReviewSkillRequest(from, to)).toBe(true);
  });
  it('under review can ask for more information or be decided, but not go back to under review', () => {
    expect(canReviewSkillRequest('under_review', 'more_information_required')).toBe(true);
    expect(canReviewSkillRequest('under_review', 'approved')).toBe(true);
    expect(canReviewSkillRequest('under_review', 'under_review')).toBe(false);
  });
  it('waiting on the technician: the reviewer may still decide, but cannot move it back to review themselves', () => {
    expect(canReviewSkillRequest('more_information_required', 'approved')).toBe(true);
    expect(canReviewSkillRequest('more_information_required', 'rejected')).toBe(true);
    expect(canReviewSkillRequest('more_information_required', 'under_review')).toBe(false);
  });
  it('a draft never reaches the reviewer and a decided request is final', () => {
    for (const to of ['under_review', 'more_information_required', 'approved', 'rejected']) {
      expect(canReviewSkillRequest('draft', to)).toBe(false);
      expect(canReviewSkillRequest('approved', to)).toBe(false);
      expect(canReviewSkillRequest('rejected', to)).toBe(false);
    }
  });
  it('nothing else is a reviewer decision', () => {
    expect(canReviewSkillRequest('submitted', 'submitted')).toBe(false);
    expect(canReviewSkillRequest('submitted', 'draft')).toBe(false);
  });
});

describe('TechService.decideSkillChange', () => {
  let calls: any[]; let svc: TechService;
  beforeEach(() => {
    calls = [];
    const port: any = {
      recordAudit: async () => {},
      decideSkillChangeRequest: async (_c: any, id: string, decision: string, by: string, notes: string | null) => {
        calls.push({ id, decision, by, notes });
        return { id, serviceId: 's1', serviceName: 'Gel', requestType: 'add', note: null, status: decision, createdAt: '', decidedAt: null, technicianId: 'tech1', technicianName: 'Mia', reviewNotes: notes };
      },
      resolveTechnicianId: async () => 'tech1',
    };
    svc = new TechService(port);
  });

  it('a manager can start a review — the reviewer is recorded', async () => {
    const r = await svc.decideSkillChange(manager, 'r1', 'under_review');
    expect(r.status).toBe('under_review');
    expect(calls).toEqual([{ id: 'r1', decision: 'under_review', by: 'm1', notes: null }]);
  });

  it('asking for more information requires a note, and the note reaches the repository', async () => {
    await expect(svc.decideSkillChange(manager, 'r1', 'more_information_required')).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(svc.decideSkillChange(manager, 'r1', 'more_information_required', '   ')).rejects.toMatchObject({ code: 'invalid_state' });
    expect(calls).toEqual([]);
    await svc.decideSkillChange(manager, 'r1', 'more_information_required', '  Please add a photo of a finished set.  ');
    expect(calls[0]).toMatchObject({ decision: 'more_information_required', notes: 'Please add a photo of a finished set.' });
  });

  it('approve / reject carry the optional note through (it used to be dropped by the controller and service)', async () => {
    await svc.decideSkillChange(manager, 'r1', 'rejected', 'Needs the e-file certificate first.');
    expect(calls[0]).toMatchObject({ decision: 'rejected', notes: 'Needs the e-file certificate first.' });
  });

  it('a technician cannot review (no self-granting)', async () => {
    await expect(svc.decideSkillChange(tech, 'r1', 'approved')).rejects.toMatchObject({ code: 'forbidden' });
    expect(calls).toEqual([]);
  });

  it('anything that is not a reviewer decision is refused before the repository', async () => {
    for (const d of ['submitted', 'draft', 'pending', 'bogus']) await expect(svc.decideSkillChange(manager, 'r1', d as any)).rejects.toMatchObject({ code: 'invalid_state' });
    expect(calls).toEqual([]);
  });
});
