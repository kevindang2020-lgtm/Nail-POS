// community-moderation.controller.vitest.spec — BUILD_PLAN Phase 8 (agent B): the moderation API over real HTTP (Nest +
// express on an ephemeral port). Proves bug 2 at the edge (the moderator is req.ctx.userId of the SUPER_ADMIN session —
// the old controller read req.user and acted as "undefined"), SuperAdminGuard on every route (a salon OWNER gets 403),
// the { ok:false, code } error envelope with the service's status, and that EVERY write route carries @RequireStepUp.
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Module, RequestMethod, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { STEP_UP_META } from '@aipowersalon/permissions/guards';
import { CommunityModerationController } from './community-moderation.controller';
import { CommunityModerationService, CommunityModerationError } from './community-moderation.service';

const MOD = '8c8c8c8c-0000-4000-8000-000000000001';
const calls: { fn: string; args: unknown[] }[] = [];
const fake = new Proxy({}, {
  get: (_t, fn: string | symbol) => (typeof fn !== 'string' || fn === 'then' || /^on[A-Z]|^before/.test(fn) ? undefined : async (...args: unknown[]) => {
    calls.push({ fn, args });
    if (args.includes('missing')) throw new CommunityModerationError('post_not_found', 404);
    if (fn === 'postAction' && (args[2] as any)?.expectedVersion === 9) throw new CommunityModerationError('version_conflict', 409, { currentVersion: 3 });
    return { ok: true, fn };
  }),
});

@Module({ controllers: [CommunityModerationController], providers: [{ provide: CommunityModerationService, useValue: fake }] })
class TestModule {}

let app: INestApplication; let base = '';
let session: Record<string, unknown> = {};
const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};

beforeAll(async () => {
  app = await NestFactory.create(TestModule, { logger: false });
  app.use((req: any, _res: any, next: () => void) => { req.ctx = session; next(); });   // what the session middleware does
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
});
afterAll(async () => { await app?.close(); });

describe('CommunityModerationController over HTTP', () => {
  it('a salon OWNER (or no session) is refused by SuperAdminGuard', async () => {
    session = { role: 'OWNER', userId: MOD, tenantId: MOD };
    expect((await call('GET', '/super-admin/community-moderation/overview')).status).toBe(403);
    session = {};
    expect((await call('POST', '/super-admin/community-moderation/posts/p1/actions', { action: 'publish' })).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('bug 2: the moderator is the session user (req.ctx.userId), passed to every write', async () => {
    session = { role: 'SUPER_ADMIN', userId: MOD };
    calls.length = 0;
    const r = await call('POST', '/super-admin/community-moderation/posts/p1/actions', { action: 'publish', reason: 'looks right', expectedVersion: 1 });
    expect(r.status).toBe(201);
    expect(calls[0]).toEqual({ fn: 'postAction', args: [{ userId: MOD }, 'p1', { action: 'publish', reason: 'looks right', expectedVersion: 1 }] });
    await call('POST', '/super-admin/community-moderation/appeals/a1/decide', { decision: 'uphold', note: 'decision note' });
    await call('POST', '/super-admin/community-moderation/reports/r1/resolve?kind=comment', { resolution: 'dismissed', reason: 'not supported' });
    await call('POST', '/super-admin/community-moderation/tenants/t1/actions', { action: 'suspend', reason: 'serious abuse' });
    await call('PATCH', '/super-admin/community-moderation/cases/c1', { assignToMe: true });
    expect(calls.slice(1).map((c) => [c.fn, (c.args[0] as any).userId])).toEqual([['decideAppeal', MOD], ['resolveReport', MOD], ['tenantAction', MOD], ['updateCase', MOD]]);
    expect(calls[2].args[2]).toBe('comment');
  });

  it('errors come back as { ok:false, code, ...extra } with the service status', async () => {
    session = { role: 'SUPER_ADMIN', userId: MOD };
    expect(await call('GET', '/super-admin/community-moderation/posts/missing')).toEqual({ status: 404, json: { ok: false, code: 'post_not_found' } });
    expect(await call('POST', '/super-admin/community-moderation/posts/p1/actions', { expectedVersion: 9 })).toEqual({ status: 409, json: { ok: false, code: 'version_conflict', currentVersion: 3 } });
  });

  it('every route in the contract exists with the right verb', async () => {
    session = { role: 'SUPER_ADMIN', userId: MOD };
    const routes: [string, string][] = [['GET', 'overview'], ['GET', 'posts?queue=review'], ['GET', 'posts/x'], ['GET', 'posts/x/comments'], ['POST', 'comments/x/actions'],
      ['GET', 'cases'], ['POST', 'cases'], ['GET', 'cases/x'], ['GET', 'reports'], ['GET', 'disputes'], ['POST', 'disputes/x/decide'], ['GET', 'appeals'],
      ['GET', 'evidence'], ['GET', 'evidence/x/access?caseId=c&reason=r'], ['POST', 'evidence/x/review'], ['POST', 'incidents/x/access'], ['GET', 'tenants'], ['GET', 'tenants/x'],
      ['GET', 'restrictions'], ['GET', 'actions'], ['GET', 'analytics'], ['GET', 'settings'], ['PUT', 'settings']];
    for (const [m, p] of routes) expect([m, p, (await call(m, `/super-admin/community-moderation/${p}`, m === 'GET' ? undefined : {})).status]).toEqual([m, p, m === 'POST' ? 201 : 200]);
  });

  it('every write (and the raw-evidence read) carries @RequireStepUp', () => {
    const proto = CommunityModerationController.prototype as any;
    const handlers = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor');
    const writes = handlers.filter((n) => Reflect.getMetadata(METHOD_METADATA, proto[n]) !== RequestMethod.GET);
    expect(writes.sort()).toEqual(['commentAction', 'decideAppeal', 'decideDispute', 'evidenceReview', 'incidentAccess', 'openCase', 'postAction', 'resolveReport', 'tenantAction', 'updateCase', 'updateSettings']);
    for (const n of [...writes, 'evidenceAccess']) expect([n, Reflect.getMetadata(STEP_UP_META, proto[n])]).toEqual([n, 300]);
    for (const n of handlers.filter((h) => !writes.includes(h) && h !== 'evidenceAccess')) expect([n, Reflect.getMetadata(STEP_UP_META, proto[n])]).toEqual([n, undefined]);
    expect(Reflect.getMetadata(PATH_METADATA, CommunityModerationController)).toBe('super-admin/community-moderation');
  });
});
