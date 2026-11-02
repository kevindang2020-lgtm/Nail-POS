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
import { CallHandler, ExecutionContext, HttpException, Inject, Injectable, NestInterceptor, Optional, StreamableFile } from '@nestjs/common';
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
      if (!asked && !(await this.svc!.overSyncLimit(opts, req?.ctx))) return asDownload(await lastOf(next.handle()));
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

/**
 * N-19 (Oct 28 2026): the synchronous answer of a binary export. Nest's Express adapter sends any object through
 * response.json(), and a Buffer is an object — an xlsx / pdf export handler returning its bytes bare answered
 * `{"type":"Buffer","data":[80,75,3,4,…]}` under its own Content-Type / Content-Disposition headers: a "download" no
 * spreadsheet or PDF reader opens (the pay-stub routes had the same bug and return StreamableFile since). Wrapped here,
 * on the one path every @AsyncExport route shares, so the handlers keep returning bytes — which is what the WORKER path
 * stores as the file (exportFileFrom) — and the headers the handler set (passthrough) stay: StreamableFile only fills
 * Content-Type / -Disposition / -Length when they are unset.
 */
export function asDownload<T>(body: T): T | StreamableFile {
  if (Buffer.isBuffer(body)) return new StreamableFile(body);
  if (body instanceof Uint8Array) return new StreamableFile(Buffer.from(body.buffer, body.byteOffset, body.byteLength));
  return body;
}
