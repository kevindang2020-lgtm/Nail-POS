import { describe, it, expect } from 'vitest';
import { ReceptionCopilotLearningService } from './reception-copilot-learning.service';

const viewer = { tenantId: 'ten_A', branchId: 'br_1', userId: 'u1', role: 'MANAGER', permissions: ['reception_copilot.view_learning'] } as any;
const approver = { ...viewer, permissions: ['reception_copilot.view_learning', 'reception_copilot.approve_learning'] } as any;
const nobody = { ...viewer, permissions: [] } as any;

describe('ReceptionCopilotLearningService (§36) permission gates', () => {
  const svc = new ReceptionCopilotLearningService(null as any, { rollup: async () => ({ helpful: 0, notHelpful: 0, dismissed: 0, helpfulRate: 0, byKind: [] }) } as any);
  it('generate/list require view_learning', async () => {
    await expect(svc.generateSuggestions(nobody)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(svc.listSuggestions(nobody)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
  it('approve/dismiss require approve_learning (view alone is not enough)', async () => {
    await expect(svc.approveSuggestion(viewer, 's1')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(svc.dismissSuggestion(viewer, 's1')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
  it('null DB is a safe no-op for a permitted caller', async () => {
    expect(await svc.generateSuggestions(viewer)).toEqual({ created: 0, suggestions: [] });
    expect(await svc.approveSuggestion(approver, 's1')).toEqual({ approved: false, version: null });
  });
});
