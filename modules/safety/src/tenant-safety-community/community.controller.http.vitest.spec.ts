// community.controller.http.vitest.spec — BUILD_PLAN Phase 8 (agent A): the core routes over REAL HTTP through the REAL
// guards (TenantAuthGuard + RolePermissionGuard) with the REAL session roles and their RBAC permissions
// (permissionsFor(role) — what the session middleware puts on req.ctx). This is the test whose absence hid bug 1: every
// tenant user mapped to "technician" and got 403 on every write.
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { RolePermissionGuard } from '@aipowersalon/permissions/guards';
import { permissionsFor, type Role } from '@aipowersalon/permissions';
import { COMMUNITY_RULES_VERSION } from '@aipowersalon/api-contracts/tenant';
import { CommunityController } from './community.controller';
import { CommunityService } from './community.service';
import { InMemoryCommunityRepo } from './community.repository';
import { InMemoryCommunityEvents } from './community-events';

// vitest (esbuild) emits no design:paramtypes; tsc does in the real build — declare the guard's one dependency.
Reflect.defineMetadata('design:paramtypes', [Reflector], RolePermissionGuard);

const id = (n: number) => `b8b8b8b8-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TA = id(1), TB = id(2), BA = id(3);
const USERS: Record<string, { tenantId: string; userId: string; role: Role; branchId: string }> = {
  owner: { tenantId: TA, userId: id(11), role: 'OWNER', branchId: BA },
  manager: { tenantId: TA, userId: id(12), role: 'MANAGER', branchId: BA },
  desk: { tenantId: TA, userId: id(13), role: 'FRONT_DESK', branchId: BA },
  reception: { tenantId: TA, userId: id(14), role: 'RECEPTION', branchId: BA },
  tech: { tenantId: TA, userId: id(15), role: 'TECHNICIAN', branchId: BA },
  otherOwner: { tenantId: TB, userId: id(21), role: 'OWNER', branchId: '' },
  admin: { tenantId: '', userId: id(31), role: 'SUPER_ADMIN' as Role, branchId: '' },
};

const repo = new InMemoryCommunityRepo();
for (const t of [TA, TB]) repo.setSettings({ tenantId: t, enabled: true, receptionistApprovalRequired: true, managerApprovalRequired: true, roleGrants: {}, roleRemovals: {} });
repo.setTenantName(TA, 'Bella Nails');
const svc = new CommunityService(repo, { events: new InMemoryCommunityEvents() });

@Module({ controllers: [CommunityController], providers: [{ provide: CommunityService, useValue: svc }] })
class TestModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // stands in for the session middleware: the server-derived ctx, never the body
    consumer.apply((req: any, _res: any, next: () => void) => {
      const u = USERS[String(req.headers['x-test-user'] ?? '')];
      if (u) req.ctx = { ...u, permissions: permissionsFor(u.role) };
      next();
    }).forRoutes('*');
  }
}

let app: any; let base = '';
async function call(user: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${base}/community${path}`, { method, headers: { 'content-type': 'application/json', 'x-test-user': user }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}
const gift = { category: 'gift_card_scam', severity: 'high', title: 'Gift card callers', body: 'a caller asked for gift cards; call back number 201-555-0148' };

beforeAll(async () => {
  app = await NestFactory.create(TestModule, { logger: false });
  await app.listen(0);
  base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  for (const u of ['owner', 'manager', 'desk', 'reception', 'otherOwner']) expect((await call(u, 'POST', '/rules/acknowledge', { rulesVersion: COMMUNITY_RULES_VERSION })).status).toBe(200);
});
afterAll(async () => { await app?.close(); });

describe('every route names its permission (the catalog keys from rbac.ts)', () => {
  const ROUTES: Record<string, [number, string, string]> = {   // handler → [RequestMethod, path, permission]
    settings: [0, 'settings', 'community.feed.view'], updateSettings: [2, 'settings', 'community.settings.manage'],
    // round 9 (Safety Community 06 / 08 / 09): read-only corrections inbox, role preview and the sanitized diagnostics export
    corrections: [0, 'corrections', 'community.appeal.create'], rolePreview: [0, 'role-preview', 'community.settings.manage'],
    diagnosticsExport: [0, 'diagnostics/export', 'community.settings.manage'],
    acknowledge: [1, 'rules/acknowledge', 'community.feed.view'], feed: [0, 'feed', 'community.feed.view'], search: [0, 'search', 'community.feed.view'],
    view: [0, 'posts/:id', 'community.feed.view'], mine: [0, 'mine', 'community.advisory.draft'], mineOne: [0, 'mine/:id', 'community.advisory.draft'],
    assist: [1, 'advisories/assist', 'community.advisory.draft'], create: [1, 'advisories', 'community.advisory.draft'],
    update: [2, 'advisories/:id', 'community.advisory.draft'], submit: [1, 'advisories/:id/submit', 'community.advisory.draft'],
    approve: [1, 'advisories/:id/approve', 'community.advisory.approve'], returnForCorrection: [1, 'advisories/:id/return', 'community.advisory.approve'],
    withdraw: [1, 'advisories/:id/withdraw', 'community.advisory.draft'], edit: [2, 'posts/:id', 'community.advisory.submit'],
    addUpdate: [1, 'posts/:id/updates', 'community.advisory.submit'], resolve: [1, 'posts/:id/resolve', 'community.advisory.submit'],
    report: [1, 'posts/:id/report', 'community.report.create'], dispute: [1, 'posts/:id/dispute', 'community.dispute.create'],
    appeal: [1, 'posts/:id/appeal', 'community.appeal.create'], appeals: [0, 'appeals', 'community.appeal.create'],
    incidents: [0, 'incidents', 'community.incident.create'], createIncident: [1, 'incidents', 'community.incident.create'], incident: [0, 'incidents/:id', 'community.incident.create'],
  };
  it('method, path and permission of every handler', () => {
    const proto = CommunityController.prototype as any;
    const handlers = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor');
    expect(handlers.sort()).toEqual(Object.keys(ROUTES).sort());
    for (const [h, [method, path, perm]] of Object.entries(ROUTES)) {
      expect([h, Reflect.getMetadata('method', proto[h]), Reflect.getMetadata('path', proto[h]), Reflect.getMetadata('perm', proto[h])]).toEqual([h, method, path, perm]);
      expect(permissionsFor('OWNER')).toContain(perm);                  // every key is in the catalog (OWNER holds all)
    }
  });
});

describe('real roles through the real guards', () => {
  it('every staff role reads the feed; TECHNICIAN passes the route key but the salon has not granted view_community', async () => {
    for (const u of ['owner', 'manager', 'desk', 'reception']) expect((await call(u, 'GET', '/feed')).status).toBe(200);
    expect(await call('tech', 'GET', '/feed')).toMatchObject({ status: 403, body: { ok: false, code: 'permission_denied' } });
    expect((await call('admin', 'GET', '/feed')).status).toBe(403);               // TenantAuthGuard: Super Admin is not a salon user
    expect((await call('nobody', 'GET', '/feed')).status).toBe(403);
  });

  it('RECEPTION drafts + submits, MANAGER approves (bug 1 end to end), the other salon then sees it — without salon A ids', async () => {
    const d = await call('reception', 'POST', '/advisories', gift);
    expect(d.status).toBe(201);
    expect(d.body.body).toContain('[REDACTED_PHONE]');
    const s = await call('reception', 'POST', `/advisories/${d.body.id}/submit`, { expectedVersion: d.body.version });
    expect(s).toMatchObject({ status: 200, body: { post: { status: 'manager_approval' } } });
    expect((await call('desk', 'POST', `/advisories/${d.body.id}/approve`, { expectedVersion: s.body.post.version })).status).toBe(403);   // RBAC: no advisory.approve
    const a = await call('manager', 'POST', `/advisories/${d.body.id}/approve`, { expectedVersion: s.body.post.version });
    expect(a).toMatchObject({ status: 200, body: { status: 'published_unverified' } });
    const seen = await call('otherOwner', 'GET', `/posts/${d.body.id}`);
    expect(seen.status).toBe(200);
    const json = JSON.stringify(seen.body);
    for (const x of [TA, BA, USERS.reception.userId, USERS.manager.userId]) expect(json).not.toContain(x);
    expect(seen.body.author.label).toBe('Bella Nails');
  });

  it('a draft is 404 to the other salon; a stale version is 409', async () => {
    const d = await call('owner', 'POST', '/advisories', { ...gift, body: 'a caller asked for gift cards at the desk' });
    expect((await call('otherOwner', 'GET', `/posts/${d.body.id}`)).status).toBe(404);
    expect((await call('otherOwner', 'GET', `/mine/${d.body.id}`)).status).toBe(404);
    expect(await call('owner', 'POST', `/advisories/${d.body.id}/submit`, { expectedVersion: 99 })).toMatchObject({ status: 409, body: { ok: false, code: 'version_conflict' } });
  });

  it('bad input is 400 invalid_input naming the field', async () => {
    expect(await call('owner', 'POST', '/advisories', { ...gift, severity: 'apocalyptic' })).toMatchObject({ status: 400, body: { code: 'invalid_input', field: 'severity' } });
    expect(await call('owner', 'GET', '/feed?pageSize=500')).toMatchObject({ status: 400, body: { field: 'pageSize' } });
    expect(await call('owner', 'GET', '/search?q=201-555-0148')).toMatchObject({ status: 400, body: { code: 'search_identifier_rejected', field: 'q' } });
    expect(await call('owner', 'GET', '/posts/not-a-uuid')).toMatchObject({ status: 404 });
  });

  it('settings: OWNER only (MANAGER lacks community.settings.manage); everyone reads', async () => {
    expect((await call('manager', 'PUT', '/settings', { expectedVersion: 1, enabled: true })).status).toBe(403);
    const r = await call('owner', 'PUT', '/settings', { expectedVersion: 1, displayName: 'Downtown' });
    expect(r).toMatchObject({ status: 200, body: { version: 2, displayName: 'Downtown' } });
    expect((await call('desk', 'GET', '/settings')).body).toMatchObject({ displayName: 'Downtown', rulesAcknowledgedByMe: true, rulesVersion: COMMUNITY_RULES_VERSION });
  });

  it('report / dispute / appeal keys: FRONT_DESK may report but not dispute or appeal', async () => {
    const d = await call('owner', 'POST', '/advisories', { ...gift, severity: 'moderate', body: 'a caller asked for gift cards at the desk' });
    const s = await call('owner', 'POST', `/advisories/${d.body.id}/submit`, { expectedVersion: d.body.version });
    await call('manager', 'POST', `/advisories/${d.body.id}/approve`, { expectedVersion: s.body.post.version });
    // salon B has no FRONT_DESK user here; RBAC is per role, so the same-salon desk shows the route keys
    expect((await call('desk', 'POST', `/posts/${d.body.id}/dispute`, { reason: 'not like that at all' })).status).toBe(403);
    expect((await call('desk', 'POST', `/posts/${d.body.id}/appeal`, { subject: 'post_removed', reason: 'please look again' })).status).toBe(403);
    expect(await call('desk', 'POST', `/posts/${d.body.id}/report`, { reason: 'spam' })).toMatchObject({ status: 400, body: { code: 'cannot_report_own_post' } });
    expect(await call('otherOwner', 'POST', `/posts/${d.body.id}/report`, { reason: 'spam' })).toMatchObject({ status: 200, body: { ok: true } });
    expect(await call('otherOwner', 'POST', `/posts/${d.body.id}/dispute`, { reason: 'not like that at all' })).toMatchObject({ status: 200, body: { ok: true, status: 'disputed' } });
  });

  it('private incidents: RECEPTION logs but cannot read the list; OWNER reads; the other salon never', async () => {
    const i = await call('reception', 'POST', '/incidents', { category: 'theft_or_shoplifting', severity: 'high', occurredOn: '2026-10-06', rawDetail: 'raw detail' });
    expect(i.status).toBe(201);
    expect(i.body.branchId).toBe(BA);
    expect((await call('reception', 'GET', '/incidents')).body).toMatchObject({ code: 'incident_read_not_allowed' });
    expect((await call('owner', 'GET', '/incidents')).body.items.map((x: any) => x.id)).toContain(i.body.id);
    expect((await call('otherOwner', 'GET', `/incidents/${i.body.id}`)).status).toBe(404);
    expect((await call('tech', 'POST', '/incidents', { category: 'other' })).status).toBe(403);
  });

  it('assist without an AI backend is an honest 503', async () => {
    expect(await call('owner', 'POST', '/advisories/assist', { body: 'a caller asked for gift cards at the desk' })).toMatchObject({ status: 503, body: { code: 'ai_not_configured' } });
  });
});
