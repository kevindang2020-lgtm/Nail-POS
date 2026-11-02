// BUILD_PLAN Phase 12 (Constitution 5 §32–33): the async operation contract end to end on the migrated schema, in a real
// Nest HTTP app: a decorated export asked for with `Prefer: respond-async` → 202 → the job worker (the production
// JobClassLoop) runs the SAME handler through the route's guards and interceptors as the same person → the file in the
// private store → status → download; the export snapshot is written by the worker; a demoted person's queued export
// fails PERMISSION_DENIED; another salon gets 404; the result expires.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'reflect-metadata';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { CanActivate, Controller, ForbiddenException, Get, Global, Injectable, MiddlewareConsumer, Module, NestMiddleware, NestModule, Query, Req, UseGuards } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, NestFactory, Reflector } from '@nestjs/core';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { DATABASE } from '@aipowersalon/database';
import { permissionsFor, platformPermissionsFor } from '@aipowersalon/permissions';
import { RequirePermission, RolePermissionGuard, TenantAuthGuard, AsyncExport } from '@aipowersalon/permissions/guards';
import { ExportSnapshotInterceptor } from '../export-snapshot.interceptor';
import { JobClassLoop } from '../../jobs/job-worker';
import { AsyncExportModule } from './async-export.module';
import { AsyncExportInterceptor } from './async-export.interceptor';
import { AsyncExportService } from './async-export.service';

const T1 = 'a1200000-0000-4000-8000-000000000001', T2 = 'a1200000-0000-4000-8000-000000000002';
const B1 = 'b1200000-0000-4000-8000-000000000001', B2 = 'b1200000-0000-4000-8000-000000000002';
const MGR = 'c1200000-0000-4000-8000-000000000001', FD = 'c1200000-0000-4000-8000-000000000002', OWN2 = 'c1200000-0000-4000-8000-000000000003', OWN1 = 'c1200000-0000-4000-8000-000000000004';
const PEOPLE: Record<string, { tenantId: string; branchId: string; role: string }> = {
  [MGR]: { tenantId: T1, branchId: B1, role: 'MANAGER' }, [FD]: { tenantId: T1, branchId: B1, role: 'FRONT_DESK' },
  [OWN1]: { tenantId: T1, branchId: B1, role: 'OWNER' }, [OWN2]: { tenantId: T2, branchId: B2, role: 'OWNER' },
};
let db: any; let app: any; let base = ''; let svc: AsyncExportService; let root = '';
let runs = 0;
let salonSuspended = false;   // what a route guard of the app (SuspendedAccessGuard, a plan gate…) decides at RUN time
@Injectable() class SuspensionGuard implements CanActivate { canActivate() { if (salonSuspended) throw new ForbiddenException({ code: 'TENANT_SUSPENDED', message: 'This salon is suspended.' }); return true; } }
const quiet = { warn: () => undefined, error: () => undefined, log: () => undefined } as any;

@Injectable() class TestSession implements NestMiddleware {
  use(req: any, _res: any, next: () => void) {
    const u = String(req.headers['x-test-user'] ?? ''); const p = PEOPLE[u];
    if (p) req.ctx = { tenantId: p.tenantId, branchId: p.branchId, userId: u, role: p.role, permissions: permissionsFor(p.role as any) };
    next();
  }
}
@UseGuards(TenantAuthGuard)
@Controller('pos/proof-customers')
class ProofExportController {
  @AsyncExport({ kind: 'test.proof-customers.export' }) @RequirePermission('pos.customers.export') @Get('export')
  async export(@Req() r: any, @Query('prefix') prefix?: string) {
    runs++;
    const rows: any = await sql`select full_name from customers where tenant_id = ${r.ctx.tenantId} and full_name like ${(prefix ?? 'P12') + '%'} order by full_name`.execute(db);
    return { format: 'csv', filename: 'proof-customers.csv', csv: ['Name', ...rows.rows.map((x: any) => x.full_name)].join('\n') + '\n' };
  }
  @AsyncExport({ kind: 'test.proof-customers.guarded-export' }) @RequirePermission('pos.customers.export') @UseGuards(SuspensionGuard) @Get('guarded-export')
  guarded() { runs++; return { format: 'csv', filename: 'g.csv', csv: 'Name\n' }; }
}
@Global() @Module({ providers: [{ provide: DATABASE, useFactory: () => db }], exports: [DATABASE] }) class DbModule {}
@Module({
  imports: [DbModule, AsyncExportModule],
  controllers: [ProofExportController],
  providers: [
    // (vitest emits no decorator metadata: the app's guards / interceptors get their dependencies by factory here)
    { provide: APP_GUARD, useFactory: (r: Reflector) => new RolePermissionGuard(r), inject: [Reflector] },
    { provide: APP_INTERCEPTOR, useExisting: AsyncExportInterceptor },
    { provide: APP_INTERCEPTOR, useFactory: (r: Reflector, d: any) => new ExportSnapshotInterceptor(r, d), inject: [Reflector, DATABASE] },
  ],
})
class ProofApp implements NestModule { configure(c: MiddlewareConsumer) { c.apply(TestSession).forRoutes('*'); } }

const as = (user: string) => async (path: string, hdr: Record<string, string> = {}) => {
  const r = await fetch(base + path, { headers: { 'x-test-user': user, ...hdr } });
  const text = await r.text(); let body: any = text; try { body = JSON.parse(text); } catch { /* text */ }
  return { status: r.status, body, text, headers: r.headers };
};
const drain = async () => { const w = new JobClassLoop(db, 'report', 'proof-worker', { pollMs: 10, idlePollMs: 20, leaseMs: 60_000, concurrency: 2, perTenantCap: 10 }, quiet); for (let i = 0; i < 5; i++) await w.pump(); await w.stop(5_000); };
const status = async (id: string) => (await sql<any>`select status, error from api_operations where id = ${id}`.execute(db)).rows[0];

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'p12-ops-')); process.env.PRIVATE_FILES_ROOT = root;
  db = kyselyFor(await migratedPglite());
  for (const [t, b, slug] of [[T1, B1, 'p12-one'], [T2, B2, 'p12-two']]) {
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${t}, ${slug}, ${slug}, ${slug}, ${slug.toUpperCase()}, 'active')`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${b}, ${t}, ${slug}, 'active')`.execute(db);
  }
  for (const [id, p] of Object.entries(PEOPLE)) {
    await sql`insert into users (id, tenant_id, branch_id, email, password_hash, status, role, first_name, last_name, full_name) values (${id}, ${p.tenantId}, ${p.branchId}, ${id + '@p12.test'}, 'x', 'active', ${p.role}, 'P', 'Twelve', 'P Twelve')`.execute(db);
  }
  for (const [n, t, b] of [['P12 Ann', T1, B1], ['P12 Bob', T1, B1], ['P12 Zed-of-salon-two', T2, B2]]) await sql`insert into customers (tenant_id, branch_id, first_name, last_name, full_name) values (${t}, ${b}, 'x', 'y', ${n})`.execute(db);
  app = await NestFactory.create(ProofApp, { logger: false });
  await app.listen(0);
  base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  svc = app.get(AsyncExportService);
}, 180_000);
afterAll(async () => { await app?.close(); rmSync(root, { recursive: true, force: true }); delete process.env.PRIVATE_FILES_ROOT; });

describe('the async export contract in a real Nest app', () => {
  let opId = '';
  it('discovers the decorated handler', () => {
    expect(svc.registered()).toContainEqual({ kind: 'test.proof-customers.export', route: '/pos/proof-customers/export' });
  });
  it('without the header the export answers synchronously, exactly as before', async () => {
    const r = await as(MGR)('/pos/proof-customers/export');
    expect(r.status).toBe(200); expect(r.body.csv).toBe('Name\nP12 Ann\nP12 Bob\n'); expect(runs).toBe(1);
  });
  it('Prefer: respond-async → 202 + Location; nothing runs on the request; a queued api.export job', async () => {
    const r = await as(MGR)('/pos/proof-customers/export?prefix=P12&tenantId=' + T2, { prefer: 'respond-async' });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ status: 'queued', pollAfterMs: 1000 });
    expect(r.headers.get('location')).toBe(r.body.statusUrl);
    opId = r.body.operationId;
    expect(runs).toBe(1);
    const row: any = (await sql`select o.*, j.job_type, j.job_class from api_operations o join jobs j on j.id = o.job_id where o.id = ${opId}`.execute(db)).rows[0];
    expect(row).toMatchObject({ status: 'queued', realm: 'pos', tenant_id: T1, actor_user_id: MGR, permission: 'pos.customers.export', job_type: 'api.export', job_class: 'report' });
    expect(row.params).toEqual({ query: { prefix: 'P12' }, path: {} });   // a client-sent tenantId is never kept
    expect((await as(MGR)(`/pos/operations/${opId}`)).body).toMatchObject({ operationId: opId, status: 'queued', kind: 'test.proof-customers.export' });
  });
  it('the worker runs the SAME handler as the same person → the file in the private store → status → download', async () => {
    await drain();
    expect(runs).toBe(2);
    const s = await as(MGR)(`/pos/operations/${opId}`);
    expect(s.body).toMatchObject({ status: 'succeeded', progress: 100, result: { filename: 'proof-customers.csv', rows: 2, contentType: 'text/csv; charset=utf-8', downloadUrl: `/pos/operations/${opId}/download`, body: { contentField: 'csv', fields: { format: 'csv' } } } });
    const key = (await sql<any>`select result_key from api_operations where id = ${opId}`.execute(db)).rows[0].result_key;
    expect(key).toMatch(new RegExp(`^[a-z]+/operations/${T1}/${opId}/proof-customers\\.csv$`));
    expect(existsSync(join(root, key))).toBe(true);
    const d = await as(MGR)(s.body.result.downloadUrl);
    expect(d.status).toBe(200); expect(d.text).toBe('Name\nP12 Ann\nP12 Bob\n');
    expect(d.headers.get('content-disposition')).toBe(`attachment; filename="proof-customers.csv"; filename*=UTF-8''proof-customers.csv`);   // RFC 6266 (Security Deep Scan D10)
    expect(d.headers.get('cache-control')).toBe('private, no-store');
    const snap: any = (await sql`select * from export_snapshots where user_id = ${MGR} order by created_at desc limit 1`.execute(db)).rows[0];
    expect(snap).toMatchObject({ tenant_id: T1, permission: 'pos.customers.export', row_count: 2, route: 'GET /pos/proof-customers/export' });
  });
  it('a second drain does nothing (the operation is finished; the job is succeeded)', async () => {
    await drain(); expect(runs).toBe(2);
  });
  it("another salon gets 404 — on the status, the download and in its list; a same-salon colleague without the export key too", async () => {
    for (const p of [`/pos/operations/${opId}`, `/pos/operations/${opId}/download`]) expect((await as(OWN2)(p)).status).toBe(404);
    expect((await as(OWN2)('/pos/operations')).body.items).toEqual([]);
    expect((await as(FD)(`/pos/operations/${opId}`)).status).toBe(404);
    expect((await as(OWN1)(`/pos/operations/${opId}`)).status).toBe(200);   // the owner holds the export's own key
    expect((await as(MGR)(`/owner/operations/${opId}`)).status).toBe(404);   // another realm
    expect((await as(MGR)('/pos/operations/not-a-uuid')).status).toBe(404);
  });
  it('a person demoted while the export waits: it fails PERMISSION_DENIED when it runs, and the handler never runs', async () => {
    const r = await as(MGR)('/pos/proof-customers/export', { prefer: 'respond-async' });
    expect(r.status).toBe(202);
    await sql`update users set role = 'FRONT_DESK' where id = ${MGR}`.execute(db);
    await drain();
    expect(runs).toBe(2);
    expect(await status(r.body.operationId)).toMatchObject({ status: 'failed', error: { code: 'PERMISSION_DENIED' } });
    const s = await as(OWN1)(`/pos/operations/${r.body.operationId}`);
    expect(s.body).toMatchObject({ status: 'failed', error: { code: 'PERMISSION_DENIED' } }); expect(s.body.result).toBeUndefined();
    expect((await as(OWN1)(`/pos/operations/${r.body.operationId}/download`)).body).toMatchObject({ code: 'OPERATION_NOT_READY' });
    await sql`update users set role = 'MANAGER' where id = ${MGR}`.execute(db);
  });
  it("the worker runs the route's OWN guards at run time: a guard that now refuses fails the export with its code", async () => {
    const r = await as(OWN1)('/pos/proof-customers/guarded-export', { prefer: 'respond-async' });
    expect(r.status).toBe(202);
    salonSuspended = true;
    await drain();
    salonSuspended = false;
    expect(await status(r.body.operationId)).toMatchObject({ status: 'failed', error: { code: 'TENANT_SUSPENDED' } });
    expect(runs).toBe(2);
  });
  it('a deactivated account fails too', async () => {
    const r = await as(OWN1)('/pos/proof-customers/export', { prefer: 'respond-async' });
    await sql`update users set status = 'inactive' where id = ${OWN1}`.execute(db);
    await drain();
    expect(await status(r.body.operationId)).toMatchObject({ status: 'failed', error: { code: 'PERMISSION_DENIED' } });
    await sql`update users set status = 'active' where id = ${OWN1}`.execute(db);
  });
  it('after 24 h the sweep deletes the file: the status reads expired and the download is 410', async () => {
    await sql`update api_operations set expires_at = now() - interval '1 minute' where id = ${opId}`.execute(db);
    expect((await as(MGR)(`/pos/operations/${opId}`)).body.status).toBe('expired');
    expect((await as(MGR)(`/pos/operations/${opId}/download`)).status).toBe(410);
    const key = (await sql<any>`select result_key from api_operations where id = ${opId}`.execute(db)).rows[0].result_key;
    expect((await svc.expireDue()).expired).toBeGreaterThanOrEqual(1);
    expect(existsSync(join(root, key))).toBe(false);
    expect(await status(opId)).toMatchObject({ status: 'expired' });
  });
  it('the pre-Phase-12 background exports read through the same contract (billing + revenue-residual jobs)', async () => {
    const SA = 'c1200000-0000-4000-8000-0000000000aa', OTHER = 'c1200000-0000-4000-8000-0000000000ab';
    const b: any = (await sql`insert into billing_export_jobs (report, format, status, filename, content_type, content_b64, download_token_hash, created_by_user_id, completed_at, expires_at, row_count)
      values ('invoices', 'csv', 'ready', 'invoices.csv', 'text/csv', ${Buffer.from('Invoice\nA-1\n').toString('base64')}, 'h-p12', ${SA}, now(), now() + interval '1 hour', 1) returning id`.execute(db)).rows[0];
    const rv: any = (await sql`insert into revenue_export_jobs (dataset, format, filters, status, requested_by) values ('records', 'csv', '{}'::jsonb, 'queued', ${SA}) returning id`.execute(db)).rows[0];
    const finance = { role: 'SUPER_ADMIN', userId: OTHER, permissions: platformPermissionsFor('PLATFORM_FINANCE') };
    const onboarding = { role: 'SUPER_ADMIN', userId: OTHER, permissions: platformPermissionsFor('PLATFORM_ONBOARDING') };
    expect(await svc.status(finance, 'super-admin', b.id)).toMatchObject({ operationId: b.id, kind: 'super-admin.billing.export-job', status: 'succeeded', result: { filename: 'invoices.csv', rows: 1, downloadUrl: `/super-admin/operations/${b.id}/download` } });
    expect((await svc.download(finance, 'super-admin', b.id)).bytes.toString()).toBe('Invoice\nA-1\n');
    expect(await svc.status({ role: 'SUPER_ADMIN', userId: SA, permissions: [] }, 'super-admin', rv.id)).toMatchObject({ status: 'queued', kind: 'super-admin.revenue-residuals.export-job' });   // the requester
    await expect(svc.status(onboarding, 'super-admin', b.id)).rejects.toMatchObject({ status: 404 });   // neither the requester nor a billing key holder
    await expect(svc.status({ role: 'OWNER', userId: OWN1, tenantId: T1, permissions: permissionsFor('OWNER') }, 'pos', b.id)).rejects.toMatchObject({ status: 404 });   // never in a salon realm
  });
});
