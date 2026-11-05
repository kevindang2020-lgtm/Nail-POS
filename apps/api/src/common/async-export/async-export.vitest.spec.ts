// BUILD_PLAN Phase 12 (Constitution 5 §32–33): the pure half of the async operation contract and the HTTP interceptor.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { lastValueFrom, of } from 'rxjs';
import { AsyncExport, ASYNC_EXPORT_META } from '@aipowersalon/permissions/guards';
import {
  realmFor, realmAllowsRole, requestParams, fillRoute, exportFileFrom, filenameFromDisposition, toStatus, locationFor, operationErrorFrom, acceptedBody, wantsAsync,
} from './async-export.core';
import { AsyncExportInterceptor } from './async-export.interceptor';
import { CapturedResponse } from './async-export.service';
import { legacyState } from './legacy-export-jobs';

describe('the decorator', () => {
  it('stores its options and refuses a bad kind / table / limit', () => {
    class C { m() { return 1; } }
    AsyncExport({ kind: 'pos.customers.export', maxSyncRows: 10, estimate: { table: 'customers' } })(C.prototype, 'm', Object.getOwnPropertyDescriptor(C.prototype, 'm')!);
    expect(Reflect.getMetadata(ASYNC_EXPORT_META, C.prototype.m)).toEqual({ kind: 'pos.customers.export', maxSyncRows: 10, estimate: { table: 'customers' } });
    expect(() => AsyncExport({ kind: 'Bad Kind' })).toThrow();
    expect(() => AsyncExport({ kind: 'x.y', estimate: { table: 'customers; drop table x' } })).toThrow();
    expect(() => AsyncExport({ kind: 'x.y', maxSyncRows: 0 })).toThrow();
  });
});

describe('asking for the async answer', () => {
  it('Prefer: respond-async (any position, with params) or ?async=1', () => {
    expect(wantsAsync('respond-async')).toBe(true);
    expect(wantsAsync('return=minimal, respond-async; wait=5')).toBe(true);
    expect(wantsAsync(undefined, '1')).toBe(true);
    expect(wantsAsync(undefined, 'true')).toBe(true);
    expect(wantsAsync('return=minimal')).toBe(false);
    expect(wantsAsync(undefined, '0')).toBe(false);
    expect(wantsAsync(undefined, undefined)).toBe(false);
  });
});

describe('realms', () => {
  it('the route plane first; the shared /me routes by role', () => {
    expect(realmFor('/pos/customers/export', 'MANAGER')).toBe('pos');
    expect(realmFor('/tenant/help/tickets/export', 'OWNER')).toBe('pos');
    expect(realmFor('/owner/reports/:reportId/export', 'OWNER')).toBe('owner');
    expect(realmFor('/tech/me/privacy-export', 'TECHNICIAN')).toBe('tech');
    expect(realmFor('/super-admin/settlements/export', 'SUPER_ADMIN')).toBe('super-admin');
    expect(realmFor('/customer/me/privacy-export', 'CUSTOMER')).toBe('customer');
    expect(realmFor('/me/privacy-export', 'CUSTOMER')).toBe('customer');
    expect(realmFor('/me/privacy-export', 'SUPER_ADMIN')).toBe('super-admin');
    expect(realmFor('/me/privacy-export', 'TECHNICIAN')).toBe('tech');
    expect(realmFor('/me/privacy-export', 'FRONT_DESK')).toBe('pos');
  });
  it('a customer never reads a staff realm, a salon never the platform one', () => {
    expect(realmAllowsRole('super-admin', 'SUPER_ADMIN')).toBe(true);
    expect(realmAllowsRole('super-admin', 'OWNER')).toBe(false);
    expect(realmAllowsRole('pos', 'CUSTOMER')).toBe(false);
    expect(realmAllowsRole('pos', 'SUPER_ADMIN')).toBe(false);
    expect(realmAllowsRole('customer', 'CUSTOMER')).toBe(true);
    expect(realmAllowsRole('owner', 'MANAGER')).toBe(true);
  });
});

describe('what of the request is kept', () => {
  it('query + path parameters as strings; never the tenant / branch a client sent, never the async switch, never objects', () => {
    const p = requestParams({ status: 'active', tenantId: 'evil', branch_id: 'x', async: '1', tags: ['a', 'b'], nested: { a: 1 } }, { reportId: 'staff', tenantId: 'evil' });
    expect(p).toEqual({ query: { status: 'active', tags: ['a', 'b'] }, path: { reportId: 'staff' } });
    expect(fillRoute('/owner/reports/:reportId/export', { reportId: 'staff' })).toBe('/owner/reports/staff/export');
    expect(fillRoute('/x/:id/y', { id: '../a' })).toBe('/x/..%2Fa/y');
  });
});

describe('a handler answer → one stored file', () => {
  it('a { csv } envelope: the CSV is the file; the envelope is remembered so a client gets its old shape back', () => {
    const f = exportFileFrom({ format: 'csv', filename: 'pos-customers.csv', csv: 'Name\nAnn\nBob\n' }, {}, 'k')!;
    expect(f.bytes.toString()).toBe('Name\nAnn\nBob\n');
    expect(f).toMatchObject({ contentType: 'text/csv; charset=utf-8', filename: 'pos-customers.csv', rows: 2, shape: { fields: { format: 'csv', filename: 'pos-customers.csv' }, contentField: 'csv', encoding: 'utf8' } });
  });
  it('{ content, encoding: base64, mime } and { base64, contentType }', () => {
    const a = exportFileFrom({ ok: true, filename: 'r.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', encoding: 'base64', content: Buffer.from('PK').toString('base64'), rowCount: 7 }, {}, 'k')!;
    expect(a.bytes.toString()).toBe('PK'); expect(a.rows).toBe(7); expect(a.shape).toMatchObject({ contentField: 'content', encoding: 'base64' });
    const b = exportFileFrom({ base64: Buffer.from('%PDF').toString('base64'), contentType: 'application/pdf', filename: 'x.pdf' }, {}, 'k')!;
    expect(b).toMatchObject({ contentType: 'application/pdf', filename: 'x.pdf' }); expect(b.bytes.toString()).toBe('%PDF');
  });
  it('CSV text and a Buffer take their type and name from the headers the handler set', () => {
    const t = exportFileFrom('a,b\n1,2\n', { 'Content-Type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="leads.csv"' }, 'k')!;
    expect(t).toMatchObject({ filename: 'leads.csv', rows: 1 }); expect(t.shape).toBeUndefined();
    const x = exportFileFrom(Buffer.from([1, 2, 3]), { 'content-type': 'application/pdf' }, 'sa-queue')!;
    expect(x).toMatchObject({ contentType: 'application/pdf', filename: 'sa-queue.pdf' });
    expect(filenameFromDisposition(`attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.csv`)).toBe('résumé.csv');
  });
  it('a JSON document (privacy export) is stored as JSON; nothing handed over → null', () => {
    const j = exportFileFrom({ profile: { a: 1 }, items: [1, 2] }, {}, 'me-privacy')!;
    expect(j).toMatchObject({ contentType: 'application/json', filename: 'me-privacy.json', rows: 2 });
    expect(JSON.parse(j.bytes.toString())).toEqual({ profile: { a: 1 }, items: [1, 2] });
    expect(exportFileFrom({ disabledReason: 'not configured', format: 'pdf' }, {}, 'k')).toBeNull();
    expect(exportFileFrom('', {}, 'k')).toBeNull();
    expect(exportFileFrom(null, {}, 'k')).toBeNull();
  });
});

describe('the wire', () => {
  const row = (o: Record<string, unknown>) => ({ id: '11111111-1111-4111-8111-111111111111', kind: 'pos.customers.export', realm: 'pos', status: 'queued', created_at: '2026-10-08T10:00:00Z', ...o });
  it('202 body + Location on the prefix the request came in on', () => {
    expect(acceptedBody('pos', 'abc')).toEqual({ operationId: 'abc', status: 'queued', statusUrl: '/pos/operations/abc', pollAfterMs: 1000 });
    expect(locationFor('/api/v1/pos/customers/export', '/pos/operations/abc')).toBe('/api/v1/pos/operations/abc');
    expect(locationFor('/pos/customers/export?x=1', '/pos/operations/abc')).toBe('/pos/operations/abc');
  });
  it('a success carries its download (and the synchronous shape); past its time it reads expired, no URL', () => {
    const later = new Date(Date.now() + 3_600_000).toISOString();
    const s = toStatus(row({ status: 'succeeded', started_at: '2026-10-08T10:00:01Z', finished_at: '2026-10-08T10:00:02Z', expires_at: later, progress: 100,
      result_meta: { filename: 'c.csv', contentType: 'text/csv', bytes: 12, rows: 2, shape: { fields: { format: 'csv' }, contentField: 'csv', encoding: 'utf8' } } }));
    expect(s).toMatchObject({ status: 'succeeded', progress: 100, result: { downloadUrl: '/pos/operations/11111111-1111-4111-8111-111111111111/download', filename: 'c.csv', rows: 2, body: { contentField: 'csv' } } });
    const e = toStatus(row({ status: 'succeeded', expires_at: '2020-01-01T00:00:00Z', result_meta: { filename: 'c.csv', contentType: 'text/csv', bytes: 1 } }));
    expect(e.status).toBe('expired'); expect(e.result).toBeUndefined();
    expect(toStatus(row({ status: 'failed', error: { code: 'PERMISSION_DENIED', message: 'no' } })).error).toEqual({ code: 'PERMISSION_DENIED', message: 'no' });
  });
  it('errors: a 403 keeps its code and is final; a 5xx is retryable and never leaks its message', () => {
    expect(operationErrorFrom({ status: 403, response: { code: 'PERMISSION_DENIED', message: 'Missing permission: x' } })).toEqual({ code: 'PERMISSION_DENIED', message: 'Missing permission: x', retryable: false });
    expect(operationErrorFrom(new Error('connection refused at 10.0.0.3'))).toEqual({ code: 'INTERNAL_ERROR', message: 'The export failed on our side.', retryable: true });
  });
  it('the pre-Phase-12 job states map onto the contract', () => {
    expect(['pending', 'processing', 'ready', 'failed', 'expired'].map((s) => legacyState('billing', s, false))).toEqual(['queued', 'running', 'succeeded', 'failed', 'expired']);
    expect(legacyState('billing', 'ready', true)).toBe('expired');
    expect(['queued', 'running', 'completed', 'failed'].map((s) => legacyState('revenue', s, false))).toEqual(['queued', 'running', 'succeeded', 'failed']);
  });
  it('the worker response collects headers the way Express handlers set them', () => {
    const r = new CapturedResponse();
    r.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="a.csv"' }); r.setHeader('Cache-Control', 'no-store'); r.status(201);
    expect(r.headers).toEqual({ 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="a.csv"', 'cache-control': 'no-store' });
  });
});

describe('the interceptor', () => {
  const meta = { kind: 'pos.customers.export' };
  const reflector = (m: any, perm: string | null = 'pos.customers.export') => ({ get: (k: string) => (k === ASYNC_EXPORT_META ? m : perm) }) as any;
  const http = (req: any, res: any) => ({ getType: () => 'http', getHandler: () => () => undefined, switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) }) as any;
  const resMock = () => { const h: Record<string, string> = {}; return { h, code: 200, status(c: number) { this.code = c; return this; }, setHeader(k: string, v: string) { h[k.toLowerCase()] = v; } }; };
  const svc = (over = false) => { const calls: any[] = []; return { calls, overSyncLimit: async () => over, accept: async (req: any, o: any, p: any) => { calls.push({ route: req.route.path, o, p }); return acceptedBody('pos', 'op-1'); } } as any; };

  it('no header and under the limit → the handler answers exactly as before', async () => {
    const s = svc(); const res = resMock();
    const out = await lastValueFrom(new AsyncExportInterceptor(reflector(meta), s).intercept(http({ method: 'GET', headers: {}, query: {}, route: { path: '/pos/customers/export' } }, res), { handle: () => of({ csv: 'a' }) }));
    expect(out).toEqual({ csv: 'a' }); expect(s.calls).toHaveLength(0); expect(res.code).toBe(200);
  });
  it('Prefer: respond-async → 202, Location, Preference-Applied; the handler does not run', async () => {
    const s = svc(); const res = resMock(); let ran = false;
    const req = { method: 'GET', headers: { prefer: 'respond-async' }, query: { async: '1', status: 'a' }, originalUrl: '/api/v1/pos/customers/export', route: { path: '/pos/customers/export' } };
    const out = await lastValueFrom(new AsyncExportInterceptor(reflector(meta), s).intercept(http(req, res), { handle: () => { ran = true; return of({ csv: 'a' }); } }));
    expect(ran).toBe(false); expect(res.code).toBe(202);
    expect(out).toEqual({ operationId: 'op-1', status: 'queued', statusUrl: '/pos/operations/op-1', pollAfterMs: 1000 });
    expect(res.h).toMatchObject({ location: '/api/v1/pos/operations/op-1', 'preference-applied': 'respond-async' });
    expect(s.calls[0]).toMatchObject({ route: '/pos/customers/export', p: 'pos.customers.export' });
    expect(req.query).toEqual({ status: 'a' });   // the switch never reaches the handler as a filter
  });
  it('over the route\'s own limit → 202 without being asked (no Preference-Applied)', async () => {
    const s = svc(true); const res = resMock();
    await lastValueFrom(new AsyncExportInterceptor(reflector(meta), s).intercept(http({ method: 'GET', headers: {}, query: {}, route: { path: '/pos/customers/export' } }, res), { handle: () => of('x') }));
    expect(res.code).toBe(202); expect(res.h['preference-applied']).toBeUndefined();
  });
  it('in the worker (the rebuilt request) and on an undecorated route the handler always runs', async () => {
    for (const [m, req] of [[meta, { method: 'GET', headers: { prefer: 'respond-async' }, __asyncOperationId: 'x', query: {} }], [undefined, { method: 'GET', headers: { prefer: 'respond-async' }, query: {} }]] as const) {
      const s = svc(); const out = await lastValueFrom(new AsyncExportInterceptor(reflector(m), s).intercept(http(req, resMock()), { handle: () => of('ran') }));
      expect(out).toBe('ran'); expect(s.calls).toHaveLength(0);
    }
  });
});
