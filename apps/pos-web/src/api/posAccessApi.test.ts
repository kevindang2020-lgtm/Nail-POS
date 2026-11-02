// posAccessApi.test.ts — Phase 9 integration: an override's branch is sent as `scopeBranchId` (a body `branchId` is stripped
// by the API's tenant-context middleware, so it could never reach the handler); no branch → the key is left out.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const post = vi.fn(async (..._a: any[]) => ({}));
vi.mock('./client', () => ({ api: { post: (...a: any[]) => post(...a), get: vi.fn(), put: vi.fn(), del: vi.fn(), patch: vi.fn() }, apiBase: '' }));
import { posAccessApi } from './posAccessApi';

describe('posAccessApi overrides', () => {
  beforeEach(() => post.mockClear());
  it('sends a picked branch as scopeBranchId, never branchId', async () => {
    await (posAccessApi as any).grantOverride('u1', { permission: 'reports.view', effect: 'ALLOW', scopeBranchId: 'b1', reason: 'cover', expiresAt: null });
    const body = post.mock.calls[0][1];
    expect(body).toMatchObject({ permission: 'reports.view', scopeBranchId: 'b1' });
    expect(body).not.toHaveProperty('branchId');
  });
  it('leaves the branch out when the grant covers every branch', async () => {
    await (posAccessApi as any).grantOverride('u1', { permission: 'reports.view', effect: 'DENY', scopeBranchId: null, reason: 'review', expiresAt: null });
    expect(post.mock.calls[0][1]).not.toHaveProperty('scopeBranchId');
  });
});
