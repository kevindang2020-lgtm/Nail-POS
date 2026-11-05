// idempotency.ts — Constitution 5 §61–66 (Step 3, Oct 4 2026): `@Idempotent()` on a route makes an `Idempotency-Key`
// request run ONCE. The first request claims the key (an 'inflight' row), runs, and stores its answer; a retry with the
// same key gets that stored answer back (`Idempotent-Replayed: true`) instead of running again.
//   • same key, DIFFERENT request (body/params/route)        → 422 IDEMPOTENCY_KEY_REUSED
//   • same key while the first is still running              → 409 IDEMPOTENCY_IN_PROGRESS (retryable)
//   • the first request FAILED                               → its claim is released, so a real retry can run
//   • a claim older than 60 s that never finished (a crash) → the next request takes it over
// Keys are scoped to the caller (salon + who). Rows expire after 24 h. No key → the route behaves as before unless the
// route says `required: true` (only where every client already sends one).
import { CallHandler, ExecutionContext, HttpException, Inject, Injectable, NestInterceptor, Optional, SetMetadata, UseInterceptors, applyDecorators } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { Observable, from, lastValueFrom } from 'rxjs';
import { sql } from 'kysely';
import { DATABASE } from '../kysely.provider';
import { sweepExpiredIdempotency } from './idempotency-sweep';
// Registered codes (packages/api-contracts errors.ts); the envelope filter turns these bodies into `error:{…}`.
const fail = (code: 'VALIDATION_FAILED' | 'IDEMPOTENCY_KEY_REUSED' | 'IDEMPOTENCY_IN_PROGRESS', status: number, message: string, details?: Record<string, unknown>) =>
  new HttpException({ code, message, ...(details ? { details } : {}) }, status);

const META = 'aps:idempotent';
export const STALE_INFLIGHT_MS = 60_000;
const KEY_RE = /^[A-Za-z0-9_\-:.]{8,200}$/;

export function Idempotent(opts: { required?: boolean } = {}) {
  return applyDecorators(SetMetadata(META, { required: !!opts.required }), UseInterceptors(IdempotencyInterceptor));
}

/** Stable JSON: object keys sorted, so {a,b} and {b,a} are the same request. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v as any).sort().filter((k) => (v as any)[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canonical((v as any)[k])).join(',') + '}';
}
export function requestHash(method: string, route: string, params: unknown, body: unknown): string {
  return createHash('sha256').update(`${method.toUpperCase()} ${route}\n${canonical(params ?? {})}\n${canonical(body ?? {})}`).digest('hex');
}
export function scopeOf(ctx: any): string | null {
  if (!ctx?.userId) return null;
  return `${ctx.tenantId || '-'}:${ctx.actorType || ctx.role || 'user'}:${ctx.userId}`;
}

export type Claim = { kind: 'proceed' } | { kind: 'replay'; status: number; body: unknown } | { kind: 'conflict' } | { kind: 'inflight' };

/** The store, separate from Nest so it is testable on real Postgres. */
export class IdempotencyStore {
  constructor(private readonly db: any) {}
  async claim(p: { scope: string; key: string; tenantId: string | null; method: string; route: string; hash: string }, now = new Date(), attempt = 0): Promise<Claim> {
    // An expired row is as good as absent: clear it first (same scope+key only).
    await sql`delete from api_idempotency where scope = ${p.scope} and idem_key = ${p.key} and tenant_id is not distinct from ${p.tenantId} and expires_at <= ${now}`.execute(this.db);
    const ins = await sql<{ scope: string }>`insert into api_idempotency (scope, idem_key, tenant_id, method, route, request_hash)
      values (${p.scope}, ${p.key}, ${p.tenantId}, ${p.method}, ${p.route}, ${p.hash}) on conflict (scope, idem_key) do nothing returning scope`.execute(this.db);
    if (ins.rows.length) return { kind: 'proceed' };
    const row = (await sql<any>`select request_hash, state, response_status, response_body, created_at, tenant_id from api_idempotency
      where scope = ${p.scope} and idem_key = ${p.key} and tenant_id is not distinct from ${p.tenantId}`.execute(this.db)).rows[0];
    // Released between our insert and read: try ONCE more. A second miss means the key is held under another tenant id
    // (cannot happen while the scope names the salon) — answer 'in progress' (safe, retryable), never loop.
    if (!row) return attempt < 1 ? this.claim(p, now, attempt + 1) : { kind: 'inflight' };
    if (row.request_hash !== p.hash) return { kind: 'conflict' };
    if (row.state === 'done') return { kind: 'replay', status: Number(row.response_status), body: row.response_body };
    // inflight: take over a claim that has been running far too long (the process died mid-request)
    const stale = new Date(now.getTime() - STALE_INFLIGHT_MS);
    const took = await sql<{ scope: string }>`update api_idempotency set created_at = ${now} where scope = ${p.scope} and idem_key = ${p.key}
      and tenant_id is not distinct from ${p.tenantId} and state = 'inflight' and created_at < ${stale} returning scope`.execute(this.db);
    return took.rows.length ? { kind: 'proceed' } : { kind: 'inflight' };
  }
  async complete(scope: string, key: string, tenantId: string | null, status: number, body: unknown): Promise<void> {
    await sql`update api_idempotency set state = 'done', response_status = ${status}, response_body = ${JSON.stringify(body ?? null)}::jsonb,
      completed_at = now() where scope = ${scope} and idem_key = ${key} and tenant_id is not distinct from ${tenantId}`.execute(this.db);
  }
  async release(scope: string, key: string, tenantId: string | null): Promise<void> {
    await sql`delete from api_idempotency where scope = ${scope} and idem_key = ${key} and tenant_id is not distinct from ${tenantId} and state = 'inflight'`.execute(this.db);
  }
  /** Bounded: at most `limit` expired rows per call — across salons, so it lives in idempotency-sweep.ts. */
  sweepExpired(now = new Date(), limit = 1000): Promise<number> { return sweepExpiredIdempotency(this.db, now, limit); }
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly store: IdempotencyStore | null;
  private claims = 0;
  constructor(private readonly reflector: Reflector, @Optional() @Inject(DATABASE) db: any) { this.store = db ? new IdempotencyStore(db) : null; }
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return from(this.run(context, next));
  }
  private async run(context: ExecutionContext, next: CallHandler): Promise<unknown> {
    const meta = this.reflector.get<{ required: boolean }>(META, context.getHandler()) ?? { required: false };
    const req = context.switchToHttp().getRequest(); const res = context.switchToHttp().getResponse();
    const raw = req?.headers?.['idempotency-key'];
    const key = typeof raw === 'string' ? raw.trim() : '';
    if (!key) {
      if (meta.required) throw fail('VALIDATION_FAILED', 400, 'This action needs an Idempotency-Key header.', { header: 'Idempotency-Key' });
      return lastValueFrom(next.handle());
    }
    if (!KEY_RE.test(key)) throw fail('VALIDATION_FAILED', 400, 'Idempotency-Key must be 8–200 letters, digits or - _ : .', { header: 'Idempotency-Key' });
    const scope = scopeOf(req?.ctx);
    if (!this.store || !scope) return lastValueFrom(next.handle());           // no database (unit wiring) or no caller: nothing to scope by
    const route = String(req.route?.path ?? req.path ?? '');
    const method = String(req.method ?? 'POST').toUpperCase();
    if (++this.claims % 500 === 0) void this.store.sweepExpired().catch(() => undefined);   // keep the table bounded
    const tenantId: string | null = req.ctx?.tenantId ?? null;
    const c = await this.store.claim({ scope, key, tenantId, method, route, hash: requestHash(method, route, req.params, req.body) });
    if (c.kind === 'conflict') throw fail('IDEMPOTENCY_KEY_REUSED', 422, 'This key was already used for a different request.');
    if (c.kind === 'inflight') throw fail('IDEMPOTENCY_IN_PROGRESS', 409, 'This request is still being processed. Try again in a moment.');
    if (c.kind === 'replay') { res?.status?.(c.status); res?.setHeader?.('Idempotent-Replayed', 'true'); return c.body; }
    try {
      const body = await lastValueFrom(next.handle());
      // Nest applies the route's status (its @HttpCode, else 201 for POST) AFTER interceptors — store that, not the
      // response's status mid-flight, so the replay answers with the same status as the original.
      const status = Number(this.reflector.get<number>('__httpCode__', context.getHandler()) ?? (method === 'POST' ? 201 : 200));
      await this.store.complete(scope, key, tenantId, status, body);
      return body;
    } catch (e) {
      await this.store.release(scope, key, tenantId).catch(() => undefined);        // a failed attempt must not block the real retry
      throw e;
    }
  }
}
