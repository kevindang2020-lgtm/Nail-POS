// async-export.service.ts — BUILD_PLAN Phase 12 (Constitution 5 §32–33): accepting an asynchronous export, running it in
// the worker, handing the file over, and expiring it.
//
// THE RUN (the `api.export` job, class 'report'):
//   1. the operation is claimed (queued → running; a second worker or a duplicate job finds nothing to do);
//   2. the principal is rebuilt from what the person may do NOW (Phase 9 authorization state, read fresh from the
//      database — never the 30 s cache, never widened beyond what the request held): a deactivated, demoted or removed
//      person's queued export ends `failed` / PERMISSION_DENIED;
//   3. the SAME handler runs through Nest's own pipeline for that route — every global, controller and method guard
//      (realm, permission, platform domain, step-up, suspension, MFA, AI entitlement…), the pipes, and the interceptors
//      (the export snapshot of Phase 9 is written right here, when the file is produced) — with the request rebuilt from the
//      operation (route, query and path parameters, tenant, branch) and under the salon's row-level-security tenant;
//   4. its answer becomes ONE file in the PRIVATE store (`<env>/operations/<tenant|platform>/<operationId>/<filename>`);
//   5. the operation records the result (24 h) and the audit trail says who exported what.
import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService, ExternalContextCreator, MetadataScanner } from '@nestjs/core';
import { RouteParamsFactory } from '@nestjs/core/router/route-params-factory';
import { HEADERS_METADATA, METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { DATABASE, enqueueJob, jobHandlerFor, registerJobHandler, runAcrossTenants, runWithTenant, PermanentJobError, type JobContext } from '@aipowersalon/database';
import { ASYNC_EXPORT_META, principalOfRequest, type AsyncExportOptions } from '@aipowersalon/permissions/guards';
import { decide, platformDomainKeyFor } from '@aipowersalon/permissions';
import { KyselyAuthorizationStatePort, authorizeSession } from '@aipowersalon/identity';
import { makePrivateStore, privateObjectKey, safeFilename, type PrivateObjectStore } from '@aipowersalon/media';
import { runTick } from '@aipowersalon/observability';
import { runsBackgroundJob } from '@aipowersalon/config';
import { sql } from 'kysely';
import type { AuditSink } from '@aipowersalon/audit';
import type { AsyncOperationAccepted, AsyncOperationStatus, OperationRealm } from '@aipowersalon/api-contracts';
import {
  EXPIRE_JOB_TYPE, EXPORT_JOB_TYPE, EXPORT_MAX_ATTEMPTS, acceptedBody, exportFileFrom, fillRoute, isUuid, operationErrorFrom,
  realmFor, requestParams, toStatus,
} from './async-export.core';
import { OperationsRepository } from './operations.repository';
import { OperationsExpiryRepository } from './operations-expiry.repository';
import { LegacyExportJobs } from './legacy-export-jobs';

export const PRIVATE_OPERATION_STORE = 'PRIVATE_OPERATION_STORE';
/** DI token: the audit trail (an AuditSink over AuditService — auditSinkFor). */
export const ASYNC_EXPORT_AUDIT = 'ASYNC_EXPORT_AUDIT';
const EXPIRE_EVERY_MS = 15 * 60_000;

interface RegisteredExport { instance: any; methodName: string; route: string; opts: AsyncExportOptions; moduleKey: string }

/** Thrown back to the HTTP layer as the matching status. */
export class OperationHttpError extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message); } }

const joinPath = (...parts: Array<string | string[] | undefined>) =>
  '/' + parts.map((p) => (Array.isArray(p) ? p[0] : p) ?? '').join('/').split('/').filter(Boolean).join('/');

/** The response object a handler sees in the worker: it only collects headers (status codes are irrelevant there). */
export class CapturedResponse {
  statusCode = 200;
  readonly headers: Record<string, string> = {};
  readonly locals: Record<string, unknown> = {};
  headersSent = false;
  setHeader(k: string, v: unknown) { this.headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v); return this; }
  getHeader(k: string) { return this.headers[k.toLowerCase()]; }
  removeHeader(k: string) { delete this.headers[k.toLowerCase()]; }
  set(k: string | Record<string, unknown>, v?: unknown) { if (typeof k === 'string') this.setHeader(k, v); else for (const [a, b] of Object.entries(k)) this.setHeader(a, b); return this; }
  header(k: string | Record<string, unknown>, v?: unknown) { return this.set(k, v); }
  type(t: string) { return this.setHeader('content-type', t.includes('/') ? t : t === 'csv' ? 'text/csv' : `application/${t}`); }
  attachment(name?: string) { if (name) this.setHeader('content-disposition', `attachment; filename="${name}"`); return this; }
  status(code: number) { this.statusCode = code; return this; }
  // A handler that writes the body itself (not passthrough) is not async-capable; these keep it from crashing.
  send(_b?: unknown) { return this; }
  json(_b?: unknown) { return this; }
  end() { return this; }
}

@Injectable()
export class AsyncExportService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('AsyncExport');
  private readonly registry = new Map<string, RegisteredExport>();
  private readonly repo: OperationsRepository | null;
  private readonly legacy: LegacyExportJobs | null;
  private readonly expiry: OperationsExpiryRepository | null;
  private readonly store: PrivateObjectStore;
  private timer?: ReturnType<typeof setInterval>;
  private readonly invokers = new Map<string, (...args: any[]) => Promise<any>>();
  private creator: ExternalContextCreator | null = null;
  private readonly moduleKeys = new Map<any, string>();

  constructor(
    @Optional() @Inject(DATABASE) private readonly db?: any,
    @Optional() @Inject(DiscoveryService) private readonly discovery?: DiscoveryService,
    @Optional() @Inject(MetadataScanner) private readonly scanner?: MetadataScanner,
    @Optional() @Inject(ExternalContextCreator) private readonly external?: ExternalContextCreator,
    @Optional() @Inject(PRIVATE_OPERATION_STORE) store?: PrivateObjectStore,
    @Optional() @Inject(ASYNC_EXPORT_AUDIT) private readonly audit?: AuditSink | null,
  ) {
    this.repo = db ? new OperationsRepository(db) : null;
    this.legacy = db ? new LegacyExportJobs(db) : null;
    this.expiry = db ? new OperationsExpiryRepository(db) : null;
    this.store = store ?? makePrivateStore();
  }

  onModuleInit(): void {
    this.discover();
    if (!jobHandlerFor(EXPORT_JOB_TYPE)) registerJobHandler(EXPORT_JOB_TYPE, (p, ctx) => this.runExportJob(p, ctx));
    if (!jobHandlerFor(EXPIRE_JOB_TYPE)) registerJobHandler(EXPIRE_JOB_TYPE, () => this.expireDue());
    if (!this.db || process.env.NODE_ENV === 'test' || !runsBackgroundJob('report')) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'api.operations.expire', jobClass: 'report', everyMs: EXPIRE_EVERY_MS }, () => this.expireDue()).catch(() => undefined); }, EXPIRE_EVERY_MS);
    (this.timer as any).unref?.();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  // ── registry ────────────────────────────────────────────────────────────────────────────────────────────────────
  private key(route: string, kind: string) { return `${kind} ${route}`; }
  /** Every @AsyncExport GET handler in the application, by (kind, route template). */
  discover(): void {
    if (!this.discovery || !this.scanner) return;
    for (const w of this.discovery.getControllers()) {
      const instance = w.instance; if (!instance || !w.metatype) continue;
      const base = Reflect.getMetadata(PATH_METADATA, w.metatype);
      const proto = Object.getPrototypeOf(instance);
      for (const methodName of this.scanner.getAllMethodNames(proto)) {
        const fn = proto[methodName];
        const opts: AsyncExportOptions | undefined = Reflect.getMetadata(ASYNC_EXPORT_META, fn);
        if (!opts) continue;
        if (Reflect.getMetadata(METHOD_METADATA, fn) !== RequestMethod.GET) { this.log.warn(`@AsyncExport on a non-GET handler ${w.metatype.name}.${methodName} — ignored`); continue; }
        const route = joinPath(base, Reflect.getMetadata(PATH_METADATA, fn));
        this.registry.set(this.key(route, opts.kind), { instance, methodName, route, opts, moduleKey: String((w as any).host?.token ?? '') });
      }
    }
  }
  registered(): Array<{ kind: string; route: string }> { return [...this.registry.values()].map((r) => ({ kind: r.opts.kind, route: r.route })); }

  // ── accept (the HTTP request) ───────────────────────────────────────────────────────────────────────────────────
  /** Should this request run asynchronously on its own (its row estimate is over the route's synchronous limit)? */
  async overSyncLimit(opts: AsyncExportOptions, ctx: any): Promise<boolean> {
    if (!opts.maxSyncRows || !opts.estimate || !this.db) return false;
    const t = opts.estimate.table;
    if (!/^[a-z_][a-z0-9_]*$/.test(t)) return false;
    const tenant = opts.estimate.platform ? null : (isUuid(ctx?.tenantId) ? ctx.tenantId : null);
    if (!opts.estimate.platform && !tenant) return false;
    try {
      const r: any = await sql`select count(*)::int as n from (select 1 from ${sql.table(t)} ${tenant ? sql`where tenant_id = ${tenant}` : sql``} limit ${opts.maxSyncRows + 1}) x`.execute(this.db);
      return Number(r.rows[0]?.n ?? 0) > opts.maxSyncRows;
    } catch { return false; }   // an estimate that cannot be read never blocks the synchronous answer
  }

  async accept(req: any, opts: AsyncExportOptions, permission: string | null): Promise<AsyncOperationAccepted> {
    if (!this.repo || !this.db) throw new OperationHttpError(503, 'SERVICE_UNAVAILABLE', 'Background exports are not available right now.');
    const ctx = req?.ctx ?? {};
    const route = String(req?.route?.path ?? '');
    if (!ctx.userId || !route) throw new OperationHttpError(401, 'AUTH_REQUIRED', 'Please sign in again.');
    const realm = realmFor(route, ctx.role);
    // an unkeyed platform route is authorized by its DERIVED key (PlatformDomainGuard): that is the export's key here too
    if (!permission && ctx.role === 'SUPER_ADMIN') permission = platformDomainKeyFor(route, 'GET');
    const tenantId = isUuid(ctx.tenantId) && ctx.role !== 'SUPER_ADMIN' ? ctx.tenantId : null;
    const id = await this.repo.create({
      tenantId, branchId: isUuid(ctx.branchId) ? ctx.branchId : null, realm, actorUserId: String(ctx.userId), actorRole: String(ctx.role ?? ''),
      kind: opts.kind, route, permission, params: requestParams(req?.query, req?.params),
      principal: { permissions: Array.isArray(ctx.authz?.grant) ? ctx.authz.grant : (ctx.permissions ?? []), ...(req?.sessionId ? { sid: String(req.sessionId) } : {}) } as any,
    });
    const job = await enqueueJob(this.db, { jobClass: 'report', jobType: EXPORT_JOB_TYPE, tenantId, payload: { operationId: id }, idempotencyKey: id,
      maxAttempts: EXPORT_MAX_ATTEMPTS, createdBy: isUuid(ctx.userId) ? ctx.userId : null, priority: 2 });
    await this.repo.setJob(id, tenantId, job.id);
    await this.auditOp(ctx, tenantId, 'export.requested', id, { kind: opts.kind, route, permission });
    return acceptedBody(realm, id);
  }

  // ── run (the worker) ────────────────────────────────────────────────────────────────────────────────────────────
  async runExportJob(payload: Record<string, unknown>, job: Pick<JobContext, 'attempt' | 'tenantId'>): Promise<unknown> {
    if (!this.repo) throw new PermanentJobError('no database');
    const id = String(payload?.operationId ?? '');
    if (!isUuid(id)) throw new PermanentJobError('bad operation id');
    const tenant = isUuid(job.tenantId) ? job.tenantId : null;   // the salon the job was enqueued FOR (null: a platform export)
    const op = await runAcrossTenants('async export worker: load the operation', () => this.repo!.byId(id, tenant));
    if (!op) throw new PermanentJobError('operation gone');
    if (!(await runAcrossTenants('async export worker: claim', () => this.repo!.claim(id, tenant, job.attempt > 1)))) return { skipped: op.status };
    try {
      const file = await this.produce(op);
      if (!file) {
        await this.repo.fail(id, tenant, { code: 'NOTHING_TO_EXPORT', message: 'The export had nothing to hand over.' });
        return { ok: false };
      }
      const owner = op.tenant_id ? String(op.tenant_id) : 'platform';
      const filename = safeFilename(file.filename, `${String(op.kind).replace(/[^a-z0-9]+/g, '-')}.bin`);
      const key = privateObjectKey('operations', owner, id, filename);
      await this.store.put(key, file.bytes, file.contentType);
      const ok = await runAcrossTenants('async export worker: record', () => this.repo!.succeed(id, tenant, key, { filename, contentType: file.contentType, bytes: file.bytes.length, rows: file.rows, shape: file.shape }));
      if (!ok) return { skipped: 'finished elsewhere' };   // same key, same content: the other run's file stands
      await this.auditOp({ userId: op.actor_user_id, role: op.actor_role, branchId: op.branch_id }, op.tenant_id, 'export.completed', id, { kind: op.kind, rows: file.rows ?? null, bytes: file.bytes.length });
      return { ok: true, bytes: file.bytes.length, rows: file.rows ?? null };
    } catch (e: any) {
      const err = operationErrorFrom(e);
      if (err.retryable && job.attempt < EXPORT_MAX_ATTEMPTS) { await runAcrossTenants('async export worker: requeue', () => this.repo!.requeue(id, tenant)); throw e; }
      await runAcrossTenants('async export worker: fail', () => this.repo!.fail(id, tenant, { code: err.code, message: err.message }));
      await this.auditOp({ userId: op.actor_user_id, role: op.actor_role, branchId: op.branch_id }, op.tenant_id, 'export.failed', id, { kind: op.kind, code: err.code });
      throw new PermanentJobError(`${err.code}: ${err.message}`);
    }
  }

  /** The principal the person has NOW, narrowed to what the request held. Throws 403 PERMISSION_DENIED when gone. */
  async principalNow(op: any): Promise<Record<string, unknown>> {
    const denied = (reason: string) => Object.assign(new Error(`The person who asked for this export may no longer run it (${reason}).`), { status: 403, response: { code: 'PERMISSION_DENIED', reason, message: 'You no longer have permission to run this export.' } });
    const principal = typeof op.principal === 'string' ? JSON.parse(op.principal) : (op.principal ?? {});
    const held: string[] = Array.isArray(principal.permissions) ? principal.permissions.map(String) : [];
    const tenantId = op.tenant_id ? String(op.tenant_id) : null;
    const base = { tenantId: tenantId ?? '', branchId: op.branch_id ? String(op.branch_id) : '', userId: String(op.actor_user_id) };
    if (op.actor_role === 'CUSTOMER') {
      // a customer is a users row with role CUSTOMER; a closed or suspended account loses its queued export
      const r: any = isUuid(base.userId) ? await runAcrossTenants('async export worker: customer account', () => sql`select coalesce(status, 'active') as status from users where id = ${base.userId} and role = 'CUSTOMER' and ${tenantId ? sql`tenant_id = ${tenantId}` : sql`tenant_id is null`} limit 1`.execute(this.db)) : { rows: [] };
      if (r.rows.length === 0 || String(r.rows[0].status).toLowerCase() !== 'active') throw denied('account_inactive');
      return { ...base, role: 'CUSTOMER', permissions: held };
    }
    const state = await runAcrossTenants('async export worker: authorization state', () => new KyselyAuthorizationStatePort(this.db).load(base.userId, tenantId));
    // No versions on purpose: the stored list is re-checked against the CURRENT grant and never widened (authorizeSession).
    const a = authorizeSession({ userId: base.userId, role: String(op.actor_role), tenantId, branchId: base.branchId || null, permissions: held }, state);
    if (!a.ok) throw denied(a.reason);
    if (op.permission && String(op.permission).length && !String(op.permission).startsWith('route:')) {
      const d = decide(principalOfRequest({ ...base, role: a.role, permissions: a.permissions, authz: a.authz } as any), String(op.permission));
      if (!d.allowed) throw denied(d.reason);
    }
    return { ...base, role: a.role, permissions: a.permissions, authz: a.authz, ...(principal.sid ? { sessionId: String(principal.sid) } : {}) };
  }

  /** Run the route's own handler through its guards, pipes and interceptors as the person, and turn the answer into a file. */
  async produce(op: any): Promise<ReturnType<typeof exportFileFrom>> {
    const reg = this.registry.get(this.key(String(op.route), String(op.kind)));
    if (!reg) throw Object.assign(new Error(`no async export handler for ${op.kind} ${op.route}`), { status: 410, response: { code: 'RESOURCE_NOT_FOUND', message: 'This export is no longer available.' } });
    const ctx = await this.principalNow(op);
    const params = typeof op.params === 'string' ? JSON.parse(op.params) : (op.params ?? {});
    const path = String(fillRoute(reg.route, params.path ?? {}));
    const query = { ...(params.query ?? {}) };
    const req: any = {
      method: 'GET', url: path, originalUrl: path, path, baseUrl: '', route: { path: reg.route }, params: { ...(params.path ?? {}) }, query,
      headers: { 'x-async-operation': String(op.id) }, ctx, ip: 'async-export-worker', __asyncOperationId: String(op.id),
      sessionId: (ctx as any).sessionId ?? undefined, get(h: string) { return (this.headers as any)[String(h).toLowerCase()]; }, header(h: string) { return (this.headers as any)[String(h).toLowerCase()]; },
    };
    const res = new CapturedResponse();
    for (const h of (Reflect.getMetadata(HEADERS_METADATA, reg.instance[reg.methodName]) ?? []) as Array<{ name: string; value: string }>) res.setHeader(h.name, h.value);
    const invoke = this.invokerFor(reg);
    const run = () => invoke(req, res, () => undefined);
    const body = op.actor_role === 'SUPER_ADMIN' ? await runAcrossTenants('async export: a Super Admin export runs across salons, as it does on the request', run)
      : await runWithTenant(op.tenant_id ? String(op.tenant_id) : '', run);
    return exportFileFrom(body, res.headers, String(op.kind).replace(/[^a-z0-9]+/g, '-'));
  }

  private invokerFor(reg: RegisteredExport): (...args: any[]) => Promise<any> {
    const k = this.key(reg.route, reg.opts.kind);
    let f = this.invokers.get(k);
    if (f) return f;
    if (!this.external) throw new Error('ExternalContextCreator is not available');
    // Nest's ExternalContextCreator finds a handler's module by looking for the class among each module's PROVIDERS — a
    // controller is not one, so the module is not found and every controller- and method-level guard / interceptor /
    // pipe is silently dropped (only the global ones run). A creator of our own that knows the controller's module (from
    // discovery) resolves them exactly as the router does. (Proved by the pgtest's run-time guard case.)
    if (!this.creator) {
      const container = (this.external as any).container;
      this.creator = container ? ExternalContextCreator.fromContainer(container) : this.external;
      const own = this.creator as any; const original = own.getContextModuleKey.bind(own);
      own.getContextModuleKey = (ctor: any) => this.moduleKeys.get(ctor) ?? original(ctor);
    }
    this.moduleKeys.set(reg.instance.constructor, reg.moduleKey);
    const routeParams = new RouteParamsFactory();
    const paramsFactory = { exchangeKeyForValue: (type: number, data: any, args: any[]) => routeParams.exchangeKeyForValue(type, data, { req: args[0], res: args[1], next: args[2] }) };
    f = this.creator!.create(reg.instance, reg.instance[reg.methodName], reg.methodName, ROUTE_ARGS_METADATA, paramsFactory as any, undefined, undefined,
      { guards: true, interceptors: true, filters: false }, 'http') as any;
    this.invokers.set(k, f!);
    return f!;
  }

  // ── read / download ─────────────────────────────────────────────────────────────────────────────────────────────
  private scopeOf(ctx: any, realm: OperationRealm): string | null { return realm === 'super-admin' ? null : (isUuid(ctx?.tenantId) ? ctx.tenantId : '00000000-0000-0000-0000-000000000000'); }

  /** The requester, or (same salon / the platform) a holder of the export's own permission. Anyone else: not found. */
  private mayRead(ctx: any, op: any): boolean {
    if (String(op.actor_user_id) === String(ctx?.userId ?? '')) return true;
    if (op.realm === 'customer' || !op.permission || String(op.permission).startsWith('route:')) return false;
    return decide(principalOfRequest(ctx), String(op.permission)).allowed;
  }

  async status(ctx: any, realm: OperationRealm, id: string): Promise<AsyncOperationStatus> {
    const op = await this.readable(ctx, realm, id).catch(async (e) => {
      // the pre-Phase-12 background exports (billing, revenue residuals) are operations too — same shape, same routes
      const l = realm === 'super-admin' && this.legacy ? await this.legacy.status(ctx, id) : null;
      if (l) return { __legacy: l };
      throw e;
    });
    return op.__legacy ?? toStatus(op);
  }
  async list(ctx: any, realm: OperationRealm, limit?: number, f: { status?: string; kind?: string } = {}): Promise<{ items: AsyncOperationStatus[] }> {
    if (!this.repo) return { items: [] };
    const rows = await this.repo.list(realm, this.scopeOf(ctx, realm), String(ctx?.userId ?? ''), limit, f);
    return { items: rows.map((r) => toStatus(r)) };
  }
  async download(ctx: any, realm: OperationRealm, id: string): Promise<{ bytes: Buffer; filename: string; contentType: string }> {
    const op = await this.readable(ctx, realm, id).catch(async (e) => {
      const l = realm === 'super-admin' && this.legacy ? await this.legacy.download(ctx, id) : null;
      if (!l) throw e;
      if (l.file) return { __legacy: l.file };
      throw new OperationHttpError(l.status === 'expired' ? 410 : 409, l.status === 'expired' ? 'OPERATION_EXPIRED' : 'OPERATION_NOT_READY', l.status === 'expired' ? 'That file has expired. Run the export again.' : 'That file is not ready.');
    });
    if (op.__legacy) return op.__legacy;
    const st = toStatus(op);
    if (st.status === 'expired') throw new OperationHttpError(410, 'OPERATION_EXPIRED', 'That file has expired. Run the export again.');
    if (st.status !== 'succeeded' || !op.result_key) throw new OperationHttpError(409, 'OPERATION_NOT_READY', st.status === 'failed' ? 'That export failed — run it again.' : 'That file is still being prepared. Try again in a moment.');
    const bytes = await this.store.get(String(op.result_key));
    if (!bytes) throw new OperationHttpError(410, 'OPERATION_EXPIRED', 'That file has expired. Run the export again.');
    await this.auditOp(ctx, op.tenant_id, 'export.downloaded', id, { kind: op.kind, bytes: bytes.length, requester: String(op.actor_user_id) === String(ctx?.userId ?? '') });
    return { bytes, filename: st.result!.filename, contentType: st.result!.contentType };
  }
  private async readable(ctx: any, realm: OperationRealm, id: string): Promise<any> {
    const nf = new OperationHttpError(404, 'RESOURCE_NOT_FOUND', 'That export could not be found.');
    if (!this.repo || !isUuid(id)) throw nf;
    const op = await this.repo.find(id, realm, this.scopeOf(ctx, realm));
    if (!op || !this.mayRead(ctx, op)) throw nf;
    return op;
  }

  // ── expiry ──────────────────────────────────────────────────────────────────────────────────────────────────────
  async expireDue(): Promise<{ expired: number }> {
    if (!this.expiry) return { expired: 0 };
    let n = 0;
    const due = await runAcrossTenants('async export expiry sweep', () => this.expiry!.dueForExpiry());
    for (const d of due) {
      if (d.result_key) await this.store.remove(String(d.result_key)).catch(() => undefined);
      if (await runAcrossTenants('async export expiry sweep', () => this.expiry!.markExpired(String(d.id)))) n++;
    }
    return { expired: n };
  }

  private async auditOp(ctx: any, tenantId: string | null, action: string, id: string, metadata: Record<string, unknown>): Promise<void> {
    if (!this.audit) return;
    try {
      await this.audit.record({ tenantId: tenantId ?? null, branchId: isUuid(ctx?.branchId) ? ctx.branchId : null, userId: isUuid(ctx?.userId) ? ctx.userId : null, role: ctx?.role ?? null,
        module: 'api_operations', action, resourceType: 'api_operation', resourceId: id, summary: `${action} ${String(metadata.kind ?? '')}`.trim(), metadata });
    } catch { /* the audit trail never fails the export */ }
  }
}
