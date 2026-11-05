// version-precondition.ts — Constitution 5 §57–58 (Step 4, Oct 4 2026): HTTP ETag / If-Match over the resource version
// this repo ALREADY uses (§57 allows "a consistently implemented resource version field" — booking, queue, customers,
// memberships, customer-phone all enforce `expectedVersion`). One mechanism, two spellings; no second conflict system.
//   • A GET answering ONE item with a whole-number `version` (or `recordVersion`) → `ETag: "<version>"`.
//   • A write with `If-Match: "12"` (or W/"12") → `expectedVersion: 12` for the route's existing check.
//     `If-Match: *` = no precondition. An If-Match that is not a version (e.g. a content hash) → 400: ignoring it
//     would let the client believe it was protected. Both If-Match and a DIFFERENT expectedVersion → 400.
//   • A stale write stays 409 VERSION_CONFLICT (§58's standardized form), sent by the route as today.
// A route without a version check ignores expectedVersion, so clients send If-Match only where they received an ETag.
import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export type IfMatch = { kind: 'none' } | { kind: 'any' } | { kind: 'version'; version: number } | { kind: 'invalid' };
export function parseIfMatch(raw: unknown): IfMatch {
  const v = typeof raw === 'string' ? raw.trim() : Array.isArray(raw) ? String(raw[0] ?? '').trim() : '';
  if (!v) return { kind: 'none' };
  if (v === '*') return { kind: 'any' };
  const m = /^(?:W\/)?"(\d{1,15})"$/.exec(v);
  return m ? { kind: 'version', version: Number(m[1]) } : { kind: 'invalid' };
}
export function versionOf(body: unknown): number | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  for (const k of ['version', 'recordVersion'] as const) {
    const n = (body as any)[k];
    if (typeof n === 'number' && Number.isInteger(n) && n >= 0) return n;
  }
  return null;
}
const bad = (message: string) => new HttpException({ code: 'VALIDATION_FAILED', message, details: { header: 'If-Match' } }, 400);

@Injectable()
export class VersionPreconditionInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest(); const res = context.switchToHttp().getResponse();
    const method = String(req?.method ?? 'GET').toUpperCase();
    if (WRITE.has(method)) {
      const im = parseIfMatch(req?.headers?.['if-match']);
      if (im.kind === 'invalid') throw bad('If-Match must be a version from this API\'s ETag, like "12".');
      if (im.kind === 'version') {
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) req.body = {};
        const given = req.body.expectedVersion;
        if (given != null && Number(given) !== im.version) throw bad('If-Match and expectedVersion disagree — send one of them.');
        req.body.expectedVersion = im.version;
      }
      return next.handle();
    }
    if (method !== 'GET') return next.handle();
    return next.handle().pipe(map((body) => {
      const v = versionOf(body);
      if (v !== null && res && !res.headersSent && typeof res.setHeader === 'function') res.setHeader('ETag', `"${v}"`);
      return body;
    }));
  }
}
