// super-admin-voice.controller.vitest.spec.ts — the admin management API. Verifies it delegates to the real services,
// never leaks the key secret hash, returns the raw key exactly once on issue, and requires tenant scoping.
import { describe, it, expect, vi } from 'vitest';
import { SuperAdminVoiceController } from './super-admin-voice.controller';

function ctrl(over: any = {}) {
  const keys = over.keys ?? {
    list: vi.fn(async () => [{ id: 'k1', tenantId: 't1', branchId: 'b1', label: 'Retell', provider: 'retell', prefix: 'vk_live_ab12', secretHash: 'SECRETHASH', lastUsedMs: null, expiresMs: null, revokedMs: null, createdMs: 1 }]),
    issue: vi.fn(async () => ({ raw: 'vk_live_the_only_time_shown', row: { id: 'k2', tenantId: 't1', branchId: 'b1', label: 'x', provider: 'retell', prefix: 'vk_live_zz99', secretHash: 'SECRETHASH2', lastUsedMs: null, expiresMs: null, revokedMs: null, createdMs: 2 } })),
    revoke: vi.fn(async () => true),
  };
  const outcomes = over.outcomes ?? { list: vi.fn(async () => [{ id: 'oc1' }]), get: vi.fn(async () => ({ id: 'oc1' })) };
  const learning = over.learning ?? {
    listSuggestions: vi.fn(async () => [{ id: 'sg1', status: 'open' }]),
    approveSuggestion: vi.fn(async () => ({ suggestion: { id: 'sg1', status: 'approved' }, draftVersion: { id: 'pv1', status: 'draft' } })),
    rejectSuggestion: vi.fn(async () => ({ id: 'sg1', status: 'rejected' })),
    submitForReview: vi.fn(async () => ({ id: 'pv1', status: 'pending_review' })),
    activatePromptVersion: vi.fn(async () => ({ id: 'pv1', status: 'active' })),
    rollback: vi.fn(async () => ({ id: 'pv0', status: 'active' })),
    activePrompt: vi.fn(async () => ({ id: 'pv1', status: 'active' })),
  };
  const metrics = { snapshot: () => ({ since: '2026-07-04T00:00:00.000Z', totalRequests: 0, totalErrors: 0, successRatePct: null, idempotentReplays: 0, rateLimitEvents: 0, handoffs: 0, byOperation: {}, byErrorCode: {} }) };
  return { c: new SuperAdminVoiceController(keys as any, outcomes as any, learning as any, metrics as any), keys, outcomes, learning };
}
const req = { ctx: { userId: 'admin_1' } };

describe('SuperAdminVoiceController — keys', () => {
  it('lists keys WITHOUT the secret hash', async () => {
    const { c } = ctrl();
    const out: any = await c.listKeys('t1');
    expect(out[0].prefix).toBe('vk_live_ab12');
    expect(JSON.stringify(out)).not.toContain('SECRETHASH'); // secret hash never leaves the server
  });

  it('issues a key and returns the raw value exactly once', async () => {
    const { c, keys } = ctrl();
    const out: any = await c.issueKey(req, { tenantId: 't1', branchId: 'b1', label: 'Retell main' });
    expect(out.raw).toBe('vk_live_the_only_time_shown');
    expect(out.key.secretHash).toBeUndefined();          // redacted
    expect(keys.issue).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', branchId: 'b1', createdByUserId: 'admin_1' }));
  });

  it('requires tenantId on list and branchId+label on issue', async () => {
    const { c } = ctrl();
    await expect(c.listKeys(undefined as any)).rejects.toThrow();
    await expect(c.issueKey(req, { tenantId: 't1' })).rejects.toThrow();
  });

  it('revoke delegates with tenant scope', async () => {
    const { c, keys } = ctrl();
    const out: any = await c.revokeKey('t1', 'k1');
    expect(keys.revoke).toHaveBeenCalledWith('t1', 'k1');
    expect(out.revoked).toBe(true);
  });
});

describe('SuperAdminVoiceController — calls + learning', () => {
  it('lists call outcomes for the tenant', async () => {
    const { c, outcomes } = ctrl();
    await c.listCalls('t1', 'b1', '10');
    expect(outcomes.list).toHaveBeenCalledWith('t1', { branchId: 'b1', limit: 10 });
  });

  it('approve delegates to the learning service (drafts only, per the service)', async () => {
    const { c, learning } = ctrl();
    const out: any = await c.approve(req, 't1', 'sg1', { newPromptBody: 'new body' });
    expect(learning.approveSuggestion).toHaveBeenCalledWith({ tenantId: 't1', branchId: '' }, 'sg1', 'admin_1', 'new body', undefined);
    expect(out.draftVersion.status).toBe('draft'); // approval yields a draft, never active
  });

  it('activate is an explicit endpoint (separate from approve)', async () => {
    const { c, learning } = ctrl();
    await c.activate(req, 't1', 'pv1', {});
    expect(learning.activatePromptVersion).toHaveBeenCalledWith({ tenantId: 't1', branchId: '' }, 'pv1', 'admin_1', undefined);
  });
});
