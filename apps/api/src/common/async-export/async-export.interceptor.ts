// async-export.interceptor.ts — BUILD_PLAN Phase 12 (Constitution 5 §32–33): the HTTP side of @AsyncExport.
//
// On a decorated export GET, AFTER every guard has passed (so only an authorized request is ever queued):
//   • the client asked for the asynchronous answer (`Prefer: respond-async`, or `?async=1`), or the route's own row
//     estimate is over its `maxSyncRows` → record an api_operations row, enqueue `api.export`, answer
//     202 { operationId, status: 'queued', statusUrl, pollAfterMs } + `Location: <statusUrl>` + `Preference-Applied`;
//   • otherwise → the handler runs exactly as before (no client breaks);
//   • in the worker (the request it rebuilt carries __asyncOperationId) → the handler runs.
// Registered BEFORE ExportSnapshotInterceptor: a 202 hands nothing over, so no export snapshot is written for it — the
// snapshot is written in the worker, when the file is produced.
import { CallHandler, ExecutionContext, HttpException, Inject, Injectable, NestInterceptor, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from, type Observable } from 'rxjs';
import { ASYNC_EXPORT_META, type AsyncExportOptions } from '@aipowersalon/permissions/guards';
import { PREFER_RESPOND_ASYNC } from '@aipowersalon/api-contracts';
import { locationFor, wantsAsync } from './async-export.core';
import { AsyncExportService, OperationHttpError } from './async-export.service';

@Injectable()
export class AsyncExportInterceptor implements NestInterceptor {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Optional() @Inject(AsyncExportService) private readonly svc?: AsyncExportService) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const opts = this.reflector.get<AsyncExportOptions | undefined>(ASYNC_EXPORT_META, context.getHandler());
    if (!opts || !this.svc) return next.handle();
    const req = context.switchToHttp().getRequest();
    if (req?.__asyncOperationId || String(req?.method ?? 'GET').toUpperCase() !== 'GET') return next.handle();
    const res = context.switchToHttp().getResponse();
    const asked = wantsAsync(req?.headers?.prefer, req?.query?.async);
    if (req?.query && 'async' in req.query) delete req.query.async;   // never a filter the handler sees
    return from((async () => {
      if (!asked && !(await this.svc!.overSyncLimit(opts, req?.ctx))) return await lastOf(next.handle());
      const permission = this.reflector.get<string>('perm', context.getHandler()) ?? null;
      try {
        const body = await this.svc!.accept(req, opts, permission);
        res.status?.(202);
        res.setHeader?.('Location', locationFor(String(req?.originalUrl ?? req?.url ?? ''), body.statusUrl));
        if (asked) res.setHeader?.('Preference-Applied', PREFER_RESPOND_ASYNC);
        res.setHeader?.('Retry-After', String(Math.max(1, Math.round(body.pollAfterMs / 1000))));
        return body;
      } catch (e) {
        if (e instanceof OperationHttpError) throw new HttpException({ code: e.code, message: e.message }, e.status);
        throw e;
      }
    })());
  }
}

function lastOf<T>(o: Observable<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => { let v: T; o.subscribe({ next: (x) => { v = x; }, error: reject, complete: () => resolve(v) }); });
}
