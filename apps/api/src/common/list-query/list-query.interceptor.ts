// list-query.interceptor.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the one choke point that
// runs parseListQuery (@aipowersalon/database) on every list endpoint that declared a ListQuerySpec — `@ListQuery(spec)`
// on the handler, or `@ListQueries({ handler: spec })` on the controller.
//
//   1. validate the request's query against the spec — unknown filter[x] → 400 INVALID_FILTER, undeclared sort → 400
//      INVALID_SORT, a range over maxDays → 400 DATE_RANGE_TOO_LARGE (codes in the api-contracts ERROR_REGISTRY), with
//      `details` naming the field and what is allowed;
//   2. write the canonical parameters back under the legacy names the handler reads (filter[status] → status,
//      sort=-name → sortBy/sortDir, q → search, limit → pageSize, from/to → startDate/endDate) — so today's clients and
//      the new syntax reach the same handler code, and nothing breaks;
//   3. leave the validated result on `req.listQuery` for repositories that use applyListQuery.
//
// Date-only bounds are the branch's calendar day (branches.timezone via branchTimeZone) — looked up only when a request
// actually sends one. Registered after OffsetCursorInterceptor, so a cursor's sort / size are validated like any other.
import { BadRequestException, CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor, Optional } from '@nestjs/common';
import { from, mergeMap, type Observable } from 'rxjs';
import { isYmd } from '@aipowersalon/date-time';
import {
  DATABASE, type AppDatabase, branchTimeZone, tenantTimeZone, DEFAULT_SALON_TIME_ZONE,
  listQuerySpecOf, parseListQuery, writeLegacyParams, ListQueryError, type ListQuerySpec, type ParsedListQuery,
} from '@aipowersalon/database';

/** Does this request carry a date-only bound for the spec's range (so the branch zone matters)? */
export function needsTimeZone(query: Record<string, any>, spec: ListQuerySpec): boolean {
  const dr = spec.dateRange;
  if (!dr) return false;
  return ['from', 'to', ...(dr.from ?? []), ...(dr.to ?? [])].some((n) => isYmd(String(query?.[n] ?? '').trim()));
}

/** Parse + write back, as one function the interceptor and the tests share. Throws the 400 the client sees. */
export function applyListQuerySpec(query: Record<string, any>, spec: ListQuerySpec, timeZone: string, nowMs?: number): ParsedListQuery {
  try {
    const parsed = parseListQuery(query, spec, { timeZone, nowMs });
    writeLegacyParams(query, spec, parsed);
    return parsed;
  } catch (e) {
    if (e instanceof ListQueryError) throw new BadRequestException({ code: e.code, message: e.message, details: e.details });
    throw e;
  }
}

@Injectable()
export class ListQueryInterceptor implements NestInterceptor {
  constructor(@Optional() @Inject(DATABASE) private readonly db?: AppDatabase) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const spec = listQuerySpecOf(ctx.getHandler());
    if (!spec) return next.handle();
    const req = ctx.switchToHttp().getRequest();
    if (req.method !== 'GET' && req.method !== 'HEAD') return next.handle();
    const query: Record<string, any> = req.query ?? {};
    if (!needsTimeZone(query, spec)) {
      req.listQuery = applyListQuerySpec(query, spec, DEFAULT_SALON_TIME_ZONE);
      return next.handle();
    }
    return from(this.zone(req)).pipe(mergeMap((tz) => { req.listQuery = applyListQuerySpec(query, spec, tz); return next.handle(); }));
  }

  private async zone(req: any): Promise<string> {
    const t = req.ctx?.tenantId; const b = req.ctx?.branchId;
    if (!this.db || !t) return DEFAULT_SALON_TIME_ZONE;
    return b ? branchTimeZone(this.db, t, b) : tenantTimeZone(this.db, t);
  }
}
