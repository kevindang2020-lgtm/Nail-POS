// ai-scheduling-ops.common.ts — BUILD_PLAN Phase 7 (agent B): what every operations-half file shares.
//
//   • SchedEngine — the NARROW slice of AiSchedulingService (agent A, ai-scheduling.service.ts) the operations half calls.
//     Exactly the public method names of the Phase 7 contract §2 (findOptions, generate, runDay, customerDecided,
//     expireDue, setTenantKillSwitch, effectiveConfig, get, retry, rollback), every one `(ctx: SchedCtx, …)`.
//   • LazySchedEngine — resolves AiSchedulingService from the module's injector on first use. The engine injects the ops
//     ports (proposals, automation …) and the ops services call the engine back, so a constructor dependency in both
//     directions would be a provider cycle; resolving lazily through ModuleRef breaks it without a forwardRef.
//   • schedSystemCtx — a background job / the AI receptionist acting for a salon: built through `systemContext()` (the ONE
//     factory for a system actor), with only the permissions that job needs, and `actor: 'system'`.
//   • SchedOpsError + schedOpsRun — service errors → HTTP for the ops controllers (A's SchedError is mapped by shape).
import { HttpException, HttpStatus } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import { systemContext, branchOrNull } from '@aipowersalon/tenant-context';
import { addDays } from '@aipowersalon/date-time';
import { hasPermission, WORKER_GRANTS } from '@aipowersalon/permissions';
import type {
  SchedOptionsRequest, SchedOptionsResponse, SchedGenerateRequest, SchedRunRequest, SchedRunDetail, SchedRecommendation,
  SchedApplyRequest,
} from '@aipowersalon/api-contracts/tenant';
import type { SchedCtx } from './ai-scheduling.ports';

export type SchedRunTrigger = 'manual' | 'job' | 'automation';

/** The engine methods the operations half uses (contract §2 names). Return shapes are read defensively (`unwrapRec`). */
export interface SchedEngine {
  findOptions(ctx: SchedCtx, req: SchedOptionsRequest): Promise<SchedOptionsResponse>;
  generate(ctx: SchedCtx, req: SchedGenerateRequest): Promise<unknown>;
  runDay(ctx: SchedCtx, req: SchedRunRequest, trigger: SchedRunTrigger): Promise<SchedRunDetail>;
  customerDecided(ctx: SchedCtx, recommendationId: string, approved: boolean): Promise<unknown>;
  expireDue(ctx: SchedCtx, nowMs: number): Promise<unknown>;
  setTenantKillSwitch(ctx: SchedCtx, killed: boolean, reason: string): Promise<unknown>;
  effectiveConfig(ctx: SchedCtx): Promise<{ enabled: boolean; killed: boolean; automationAllowed: boolean; config: any; platformKilled?: boolean }>;
  get(ctx: SchedCtx, id: string): Promise<unknown>;
  retry(ctx: SchedCtx, id: string, req: SchedApplyRequest): Promise<unknown>;
  rollback(ctx: SchedCtx, id: string, req: SchedApplyRequest): Promise<unknown>;
}

/** A recommendation from either a bare `SchedRecommendation` or a `{ recommendation }` envelope. */
export function unwrapRec(r: unknown): SchedRecommendation | null {
  if (!r || typeof r !== 'object') return null;
  const env = (r as any).recommendation;
  if (env && typeof env === 'object' && typeof env.id === 'string') return env as SchedRecommendation;
  return typeof (r as any).id === 'string' ? (r as SchedRecommendation) : null;
}

/** Resolves AiSchedulingService lazily (see header). `token` is the engine class; tests pass a plain object instead. */
export class LazySchedEngine implements SchedEngine {
  private cached: SchedEngine | null = null;
  constructor(private readonly moduleRef: Pick<ModuleRef, 'get'>, private readonly token: any) {}
  private e(): SchedEngine {
    if (!this.cached) this.cached = this.moduleRef.get(this.token, { strict: false }) as unknown as SchedEngine;
    if (!this.cached) throw new Error('AiSchedulingService is not available in this process');
    return this.cached;
  }
  findOptions(ctx: SchedCtx, req: SchedOptionsRequest) { return this.e().findOptions(ctx, req); }
  generate(ctx: SchedCtx, req: SchedGenerateRequest) { return this.e().generate(ctx, req); }
  runDay(ctx: SchedCtx, req: SchedRunRequest, trigger: SchedRunTrigger) { return this.e().runDay(ctx, req, trigger); }
  customerDecided(ctx: SchedCtx, id: string, approved: boolean) { return this.e().customerDecided(ctx, id, approved); }
  expireDue(ctx: SchedCtx, nowMs: number) { return this.e().expireDue(ctx, nowMs); }
  setTenantKillSwitch(ctx: SchedCtx, killed: boolean, reason: string) { return this.e().setTenantKillSwitch(ctx, killed, reason); }
  effectiveConfig(ctx: SchedCtx) { return this.e().effectiveConfig(ctx); }
  get(ctx: SchedCtx, id: string) { return this.e().get(ctx, id); }
  retry(ctx: SchedCtx, id: string, req: SchedApplyRequest) { return this.e().retry(ctx, id, req); }
  rollback(ctx: SchedCtx, id: string, req: SchedApplyRequest) { return this.e().rollback(ctx, id, req); }
}
export const SCHED_ENGINE = 'SchedEngineRef';

export const SCHED_PACKAGE = 'ai_scheduling_optimizer';

/** A job / receptionist acting for a salon. Built through systemContext() — never by hand — then shaped as a SchedCtx. */
export function schedSystemCtx(tenantId: string, branchId: string | null, actor: string, permissions: string[] = []): SchedCtx {
  const s = systemContext({ tenantId, branchId: branchId ?? null, actor, permissions });
  return { tenantId: s.tenantId, branchId: branchOrNull(s.branchId), userId: s.userId, role: s.role, permissions: [...s.permissions], actor: 'system' };
}
export const isSystemActor = (ctx: SchedCtx): boolean => ctx.actor === 'system' || ctx.actor === 'automation';
/** BUILD_PLAN Phase 9: a scheduling JOB acts as its named worker principal (worker:<job>) with exactly the keys declared
 *  for it in packages/permissions worker-principals.ts — never a hand-written permission list. */
export function schedWorkerCtx(job: 'scheduling-daily-scan' | 'scheduling-expiry' | 'scheduling-insights', tenantId: string, branchId: string | null): SchedCtx {
  return schedSystemCtx(tenantId, branchId, `worker:${job}`, [...WORKER_GRANTS[job]]);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID_RE.test(s);
export const uuidOrNull = (s: unknown): string | null => (isUuid(s) ? s : null);
export const iso = (v: unknown): string | null => (v == null ? null : new Date(v as any).toISOString());
export const rowsOf = (r: any): any[] => (r && Array.isArray(r.rows) ? r.rows : []);
export const isYmd = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
/** 'YYYY-MM-DD' n days after `ymd`, pure UTC calendar arithmetic. */
export function addDaysYmd(ymd: string, n: number): string { return addDays(ymd, n); }

export type SchedOpsErrorCode = 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION' | 'VERSION_CONFLICT' | 'INVALID_STATE' | 'SUPPORT_SESSION_REQUIRED' | 'UNAVAILABLE';
const STATUS: Record<SchedOpsErrorCode, number> = { FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION: 400, VERSION_CONFLICT: 409, INVALID_STATE: 409, SUPPORT_SESSION_REQUIRED: 403, UNAVAILABLE: 503 };
export class SchedOpsError extends Error {
  readonly status: number;
  constructor(readonly code: SchedOpsErrorCode, message?: string, readonly extra?: Record<string, unknown>) { super(message || code); this.name = 'SchedOpsError'; this.status = STATUS[code]; }
}

/** The caller holds `key` (system / automation actors are gated by the job that built them, not here). */
export function needPerm(ctx: SchedCtx, key: string): void {
  if (!ctx?.tenantId) throw new SchedOpsError('FORBIDDEN', 'Not authenticated');
  if (isSystemActor(ctx) && (ctx.permissions || []).includes(key)) return;
  if (!ctx.userId || !hasPermission(ctx as any, key)) throw new SchedOpsError('FORBIDDEN', 'Missing ' + key);
}

export function schedCtxFrom(req: any): SchedCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: branchOrNull(c.branchId), userId: c.userId, role: c.role, permissions: c.permissions || [], actor: 'user', requestId: c.requestId ?? null, correlationId: c.correlationId ?? null };
}

/** Service errors → HTTP. SchedOpsError and A's SchedError (by shape: name + numeric status + code) keep their code. */
export async function schedOpsRun<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof HttpException) throw e;
    if (e instanceof SchedOpsError || (e?.name === 'SchedError' && typeof e?.status === 'number')) {
      throw new HttpException({ ok: false, code: e.code, message: e.message, ...(e.extra || {}) }, e.status);
    }
    if (/Forbidden/.test(String(e?.name ?? ''))) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    throw e;
  }
}
