// community-interactions.controller.vitest.spec — BUILD_PLAN Phase 8 (agent C): the /community interaction routes at the
// HTTP edge with the REAL session roles. Each route's @RequirePermission key, run through the real RolePermissionGuard
// with the real role → permission map (OWNER / MANAGER / FRONT_DESK / RECEPTION / TECHNICIAN): the front desk may comment,
// report, mark similar and follow but never upload evidence or read analytics; a technician only reads. Plus: the
// session — never the body — is the caller (an empty branch becomes null), and a CommunityError becomes
// `{ ok: false, code, ... }` with its status (a missing storage is 503, never 500).
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ForbiddenException, HttpException } from '@nestjs/common';
import { RolePermissionGuard } from '@aipowersalon/permissions/guards';
import { permissionsFor } from '@aipowersalon/permissions';
import { CommunityInteractionsController, interactionsCtx } from './community-interactions.controller';
import { CommunityError } from './community.service';

const ROUTES: [keyof CommunityInteractionsController, string][] = [
  ['comments', 'community.feed.view'], ['addComment', 'community.comment.create'], ['editComment', 'community.comment.create'],
  ['deleteComment', 'community.comment.create'], ['reportComment', 'community.report.create'], ['similar', 'community.report.create'],
  ['follow', 'community.follow'], ['unfollow', 'community.follow'], ['follows', 'community.follow'], ['createFollow', 'community.follow'], ['deleteFollow', 'community.follow'],
  ['requestUpload', 'community.evidence.upload'], ['completeUpload', 'community.evidence.upload'], ['evidence', 'community.evidence.upload'], ['evidenceAccess', 'community.evidence.upload'],
  ['activeAlerts', 'community.feed.view'], ['analytics', 'community.settings.manage'],
];
const proto = CommunityInteractionsController.prototype as any;
const guard = new RolePermissionGuard(new Reflector());
function allowed(role: string, method: string): boolean {
  const req = { ctx: { tenantId: 't', branchId: 'b', userId: 'u', role, permissions: permissionsFor(role as any) } };
  const ctx: any = { getHandler: () => proto[method], switchToHttp: () => ({ getRequest: () => req }) };
  try { return guard.canActivate(ctx); } catch (e) { if (e instanceof ForbiddenException) return false; throw e; }
}

describe('route permissions', () => {
  it('every route carries exactly its community.* key', () => {
    const reflector = new Reflector();
    for (const [m, key] of ROUTES) expect([m, reflector.get('perm', proto[m])]).toEqual([m, key]);
    const handlers = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor');
    expect(handlers.sort()).toEqual(ROUTES.map(([m]) => m).sort());
  });
  it.each([
    ['OWNER', ROUTES.map(([m]) => m)],
    ['MANAGER', ROUTES.filter(([, k]) => k !== 'community.settings.manage').map(([m]) => m)],
    ['FRONT_DESK', ['comments', 'addComment', 'editComment', 'deleteComment', 'reportComment', 'similar', 'follow', 'unfollow', 'follows', 'createFollow', 'deleteFollow', 'activeAlerts']],
    ['RECEPTION', ['comments', 'addComment', 'editComment', 'deleteComment', 'reportComment', 'similar', 'follow', 'unfollow', 'follows', 'createFollow', 'deleteFollow', 'activeAlerts']],
    ['TECHNICIAN', ['comments', 'activeAlerts']],
  ])('%s with its real session permissions reaches exactly these routes', (role, expected) => {
    expect(ROUTES.map(([m]) => m).filter((m) => allowed(role, m)).sort()).toEqual([...expected].sort());
  });
});

describe('the HTTP edge', () => {
  const fns: Record<string, any> = {};
  const fn = (p: string) => (fns[p] ??= vi.fn());
  const svc: any = new Proxy({}, { get: (_t, p) => fn(String(p).replace(/^__/, '')) });
  const ctl = new CommunityInteractionsController(svc);
  const req = { ctx: { tenantId: 'T', branchId: '', userId: 'U', role: 'RECEPTION' }, body: { tenantId: 'EVIL' } };

  it('the caller comes from the session; an empty branch is null; body fields are picked one by one', async () => {
    expect(interactionsCtx(req)).toEqual({ tenantId: 'T', branchId: null, userId: 'U', role: 'RECEPTION', permissions: [] });   // Phase 9: the session's permissions travel with it
    svc.__addComment.mockResolvedValue({ id: 'c' });
    await ctl.addComment(req, 'P', { body: 'hi', parentId: null, tenantId: 'EVIL', depth: 0 });
    expect(svc.__addComment).toHaveBeenCalledWith({ tenantId: 'T', branchId: null, userId: 'U', role: 'RECEPTION', permissions: [] }, 'P', { body: 'hi', parentId: null });
    svc.__createFollow.mockResolvedValue({});
    await ctl.createFollow(req, { category: 'phone_scam', tenantId: 'EVIL', id: 'x' });
    expect(svc.__createFollow.mock.calls[0][1]).toEqual({ category: 'phone_scam', region: undefined, severityMin: undefined, channels: undefined });
  });
  it.each([
    [new CommunityError('comments_locked', 409), 409, { ok: false, code: 'comments_locked' }],
    [new CommunityError('invalid_input', 400, { field: 'body', message: 'required' }), 400, { ok: false, code: 'invalid_input', field: 'body', message: 'required' }],
    [new CommunityError('evidence_storage_not_configured', 503), 503, { ok: false, code: 'evidence_storage_not_configured' }],
    [Object.assign(new Error('x'), { name: 'EvidenceStorageNotConfigured' }), 503, { ok: false, code: 'evidence_storage_not_configured' }],
  ])('%s → HTTP %s with the code', async (err, status, body) => {
    svc.__requestUpload.mockRejectedValueOnce(err);
    const e = await ctl.requestUpload(req, {}).catch((x) => x);
    expect(e).toBeInstanceOf(HttpException);
    expect(e.getStatus()).toBe(status);
    expect(e.getResponse()).toEqual(body);
  });
  it('an unexpected error is not disguised', async () => {
    svc.__activeAlerts.mockRejectedValueOnce(new TypeError('boom'));
    await expect(ctl.activeAlerts(req)).rejects.toBeInstanceOf(TypeError);
  });
});
