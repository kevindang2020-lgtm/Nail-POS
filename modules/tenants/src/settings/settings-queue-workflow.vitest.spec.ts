// settings-queue-workflow.vitest.spec.ts — BUILD_PLAN Phase 6: the duplicate auto-assign / rotation switches are retired
// (audit "parallel implementation 3"). queueWorkflow.autoAssign defaulted to TRUE and nothing read it; assignBy duplicated
// the AI rotation policy. The ONE home is the AI queue-assignment settings.
import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, RETIRED_QUEUE_WORKFLOW_KEYS, withoutRetiredQueueWorkflowKeys } from './settings.dto';
import { InMemorySettingsRepository } from './settings.repository';

describe('queue-workflow settings without the retired switches', () => {
  it('the defaults no longer carry autoAssign / assignBy', () => {
    expect(Object.keys(DEFAULT_SETTINGS.queueWorkflow)).not.toContain('autoAssign');
    expect(Object.keys(DEFAULT_SETTINGS.queueWorkflow)).not.toContain('assignBy');
    expect(DEFAULT_SETTINGS.queueWorkflow).toEqual({ avgServiceMinutes: 45, showWaitToGuest: true, autoFlowToCheckout: true, manualApprovalBeforeCheckout: false, allowReopenService: true, vipPriority: true, appointmentOverWalkIn: true });
  });
  it("a new salon's settings response has no auto-assign switch in queue workflow", async () => {
    const raw = await new InMemorySettingsRepository().getRaw({ tenantId: 't_new', branchId: 'b', userId: 'u', role: 'OWNER', permissions: [] });
    expect(raw.queueWorkflow).not.toHaveProperty('autoAssign');
    expect(raw.queueWorkflow).not.toHaveProperty('assignBy');
  });
  it('a stored row (or an old client) carrying them is cleaned', () => {
    expect(RETIRED_QUEUE_WORKFLOW_KEYS).toEqual(['autoAssign', 'assignBy']);
    expect(withoutRetiredQueueWorkflowKeys({ autoAssign: true, assignBy: 'least_busy', avgServiceMinutes: 30 })).toEqual({ avgServiceMinutes: 30 });
  });
});
