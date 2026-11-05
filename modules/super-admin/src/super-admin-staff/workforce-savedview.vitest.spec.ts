import { describe, it, expect, vi } from 'vitest';
import { SuperAdminStaffService } from './super-admin-staff.service';

// Service contract for saved views (§6): owner is always ctx.userId; a default save clears prior defaults first;
// invalid input and missing identity are refused before persistence; delete is owner-scoped.
function harness() {
  const repo = {
    listSavedViews: vi.fn(async () => [{ id: 'v1', name: 'Active techs', filters: { role: 'technician' }, isDefault: true, createdAt: null }]),
    createSavedView: vi.fn(async () => ({ id: 'v2' })),
    clearDefaultViews: vi.fn(async () => undefined),
    deleteSavedView: vi.fn(async () => true),
  };
  return { svc: new SuperAdminStaffService(repo as any), repo };
}
const ctx = { userId: 'admin-1' };

describe('SuperAdminStaffService saved views (§6)', () => {
  it('lists the owner’s views for a surface', async () => {
    const { svc, repo } = harness();
    const views = await svc.getSavedViews(ctx, 'workforce');
    expect(views).toHaveLength(1);
    expect(repo.listSavedViews).toHaveBeenCalledWith('admin-1', 'workforce');
  });

  it('returns no views without a signed-in identity', async () => {
    const { svc, repo } = harness();
    const views = await svc.getSavedViews({}, 'workforce');
    expect(views).toEqual([]);
    expect(repo.listSavedViews).not.toHaveBeenCalled();
  });

  it('saves a view for the current owner and normalizes filters', async () => {
    const { svc, repo } = harness();
    const r = await svc.saveView(ctx, 'workforce', { name: '  Suspended  ', filters: { status: 'suspended', junk: 1 } });
    expect(r).toEqual({ ok: true, id: 'v2' });
    expect(repo.clearDefaultViews).not.toHaveBeenCalled();
    expect(repo.createSavedView).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: 'admin-1', surface: 'workforce', name: 'Suspended', filtersJson: JSON.stringify({ status: 'suspended' }), isDefault: false }));
  });

  it('clears prior defaults when saving a default view', async () => {
    const { svc, repo } = harness();
    await svc.saveView(ctx, 'workforce', { name: 'Default', filters: {}, isDefault: true });
    expect(repo.clearDefaultViews).toHaveBeenCalledWith('admin-1', 'workforce');
    expect(repo.createSavedView).toHaveBeenCalledWith(expect.objectContaining({ isDefault: true }));
  });

  it('refuses invalid input and missing identity before persisting', async () => {
    const { svc, repo } = harness();
    await expect(svc.saveView(ctx, 'workforce', { name: '   ' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(svc.saveView({}, 'workforce', { name: 'X' })).rejects.toMatchObject({ code: 'invalid' });
    expect(repo.createSavedView).not.toHaveBeenCalled();
  });

  it('deletes owner-scoped', async () => {
    const { svc, repo } = harness();
    const r = await svc.deleteView(ctx, 'v1');
    expect(r).toEqual({ ok: true, deleted: true });
    expect(repo.deleteSavedView).toHaveBeenCalledWith('v1', 'admin-1');
  });
});
